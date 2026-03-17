import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapters,
  characters,
  storyArcs,
  storyItems,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { listLinkedItemIds, listLinkedTimelineEventIds } from './link-sync.service'

export type ConsistencySeverity = 'high' | 'medium' | 'low'

export interface ConsistencyIssue {
  id: string
  severity: ConsistencySeverity
  category: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'outline' | 'continuity'
  title: string
  description: string
  suggestion: string
  entityType?: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'arc'
  entityId?: number
  entityLabel?: string
}

export interface NovelConsistencyReport {
  generatedAt: string
  readinessScore: number
  overview: string
  issueCount: number
  highCount: number
  mediumCount: number
  lowCount: number
  focusAreas: string[]
  metrics: {
    chapterCount: number
    chaptersMissingSummary: number
    chaptersMissingContinuity: number
    timelineCount: number
    linkedTimelineCount: number
    itemCount: number
    bidirectionalLinkCount: number
  }
  issues: ConsistencyIssue[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((value) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value)))
      .filter((value) => Number.isFinite(value))
  } catch {
    return []
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function pushIssue(
  issues: ConsistencyIssue[],
  severity: ConsistencySeverity,
  category: ConsistencyIssue['category'],
  title: string,
  description: string,
  suggestion: string,
  meta: Partial<Pick<ConsistencyIssue, 'entityType' | 'entityId' | 'entityLabel'>> = {},
) {
  issues.push({
    id: `${category}-${issues.length + 1}`,
    severity,
    category,
    title,
    description,
    suggestion,
    ...meta,
  })
}

function getChapterNumMap(novelId: number) {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  return new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
}

function buildOverview(highCount: number, mediumCount: number, lowCount: number): string {
  if (highCount > 0) {
    return `当前存在 ${highCount} 个高优先级冲突，建议先修复结构问题再继续大批量生成。`
  }
  if (mediumCount > 0) {
    return `当前没有致命冲突，但还有 ${mediumCount} 个中等级问题会持续放大。`
  }
  if (lowCount > 0) {
    return `当前结构已经能继续写作，只剩 ${lowCount} 个轻度提醒需要逐步收口。`
  }
  return '当前未发现明显结构冲突，可以继续推进正文与细化设定。'
}

export function buildConsistencyPromptSummary(report: NovelConsistencyReport, limit = 6): string {
  if (report.issues.length === 0) {
    return '当前结构体检未发现明显冲突，可按既定计划继续推进。'
  }

  return report.issues
    .slice(0, limit)
    .map((issue) => `- [${issue.severity}] ${issue.title}：${issue.description}。修复建议：${issue.suggestion}`)
    .join('\n')
}

export function buildNovelConsistencyReport(novelId: number): NovelConsistencyReport {
  const db = getDb()
  const issueList: ConsistencyIssue[] = []

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const eventRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()

  const chapterNumMap = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
  const characterIdSet = new Set(characterRows.map((row) => row.id))
  const arcIdSet = new Set(arcRows.map((row) => row.id))
  const eventIdSet = new Set(eventRows.map((row) => row.id))
  const itemIdSet = new Set(itemRows.map((row) => row.id))
  const mapIdSet = new Set(mapRows.map((row) => row.id))

  const protagonists = characterRows.filter((row) => row.roleType === 'protagonist')
  if (protagonists.length === 0) {
    pushIssue(
      issueList,
      'high',
      'character',
      '缺少主角',
      '当前人物表里没有主角，后续人物关系、正文称谓和大纲都会失去锚点。',
      '先补一个主角，再批量生成人物和章节内容。',
    )
  } else if (protagonists.length > 1) {
    pushIssue(
      issueList,
      'high',
      'character',
      '主角数量冲突',
      `当前标记了 ${protagonists.length} 位主角，会导致正文称谓和主线重心混乱。`,
      '只保留一个主角标记，其余角色改成 major / supporting / antagonist。',
    )
  }

  const chapterNums = new Set<number>()
  chapterRows.forEach((chapter, index) => {
    if (chapterNums.has(chapter.chapterNum)) {
      pushIssue(
        issueList,
        'high',
        'chapter',
        '章节编号重复',
        `第 ${chapter.chapterNum} 章出现了重复记录。`,
        '调整章节编号，确保时间轴和故事弧只对应唯一章节。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第${chapter.chapterNum}章` },
      )
    }
    chapterNums.add(chapter.chapterNum)

    const previous = chapterRows[index - 1]
    if (previous && chapter.chapterNum - previous.chapterNum > 1) {
      pushIssue(
        issueList,
        'medium',
        'chapter',
        '章节编号存在断档',
        `第 ${previous.chapterNum} 章和第 ${chapter.chapterNum} 章之间存在空档。`,
        '确认是否故意留空；如果不是，补齐章节编号或调整时间轴。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第${chapter.chapterNum}章` },
      )
    }

    const hasContent = Boolean(asText(chapter.content))
    if (hasContent && !asText(chapter.summary)) {
      pushIssue(
        issueList,
        'medium',
        'continuity',
        '章节缺少摘要',
        `第 ${chapter.chapterNum} 章已有正文，但没有摘要。`,
        '执行一次“更新摘要”，让后续长文记忆和体检有稳定锚点。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第${chapter.chapterNum}章` },
      )
    }

    if (hasContent && !asText(chapter.continuityStateJson)) {
      pushIssue(
        issueList,
        'medium',
        'continuity',
        '章节缺少连续性记忆',
        `第 ${chapter.chapterNum} 章已有正文，但没有连续性记忆。`,
        '执行一次“更新摘要”，补齐剧情推进、人物变化和待回收事项。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第${chapter.chapterNum}章` },
      )
    }

    if ((chapter.status === 'draft' || chapter.status === 'final') && !asText(chapter.outline)) {
      pushIssue(
        issueList,
        'medium',
        'chapter',
        '已写章节缺少细纲',
        `第 ${chapter.chapterNum} 章已经进入 ${chapter.status} 状态，但没有保留本章大纲。`,
        '补一版章节细纲，避免后续时间轴和回收点失去来源。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第${chapter.chapterNum}章` },
      )
    }
  })

  const sortedArcs = [...arcRows].sort((left, right) => (left.chapterStart || 0) - (right.chapterStart || 0))
  sortedArcs.forEach((arc, index) => {
    const start = arc.chapterStart ?? 0
    const end = arc.chapterEnd ?? 0
    if (start && end && start > end) {
      pushIssue(
        issueList,
        'high',
        'outline',
        '故事弧章节范围反转',
        `${arc.arcName} 的起始章节大于结束章节。`,
        '修正故事弧章节范围，保证大纲和时间轴可以正确关联。',
        { entityType: 'arc', entityId: arc.id, entityLabel: arc.arcName },
      )
    }

    const previous = sortedArcs[index - 1]
    if (previous && previous.chapterEnd && arc.chapterStart && previous.chapterEnd >= arc.chapterStart) {
      pushIssue(
        issueList,
        'medium',
        'outline',
        '故事弧范围重叠',
        `${previous.arcName} 与 ${arc.arcName} 的章节范围存在重叠。`,
        '重新梳理故事弧范围，避免同一章同时归属多个主弧。',
        { entityType: 'arc', entityId: arc.id, entityLabel: arc.arcName },
      )
    }
  })

  mapRows.forEach((node) => {
    if (node.parentId && !mapIdSet.has(node.parentId)) {
      pushIssue(
        issueList,
        'high',
        'map',
        '地图节点父级丢失',
        `${node.name} 的父节点不存在。`,
        '修正地图层级，避免地点、势力和场景挂到孤立节点上。',
        { entityType: 'map', entityId: node.id, entityLabel: node.name },
      )
    }
  })

  eventRows.forEach((event) => {
    const startNum = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined
    if (typeof startNum === 'number' && typeof endNum === 'number' && startNum > endNum) {
      pushIssue(
        issueList,
        'high',
        'timeline',
        '时间轴章节范围反转',
        `${event.eventTitle} 的起始章节大于结束章节。`,
        '调整事件对应章节范围，避免正文和时间轴顺序冲突。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (event.arcId && !arcIdSet.has(event.arcId)) {
      pushIssue(
        issueList,
        'medium',
        'timeline',
        '时间轴事件挂到了不存在的故事弧',
        `${event.eventTitle} 引用了失效的故事弧。`,
        '重新绑定故事弧，或者清空该事件的故事弧引用。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (event.locationMapId && !mapIdSet.has(event.locationMapId)) {
      pushIssue(
        issueList,
        'high',
        'timeline',
        '时间轴事件地点失效',
        `${event.eventTitle} 引用了已失效的地点。`,
        '重新绑定地点，避免事件成为无落点记录。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    const presentIds = parseNumberArray(event.presentCharacterIdsJson)
    const affectedIds = parseNumberArray(event.affectedCharacterIdsJson)
    const missingCharacters = [...presentIds, ...affectedIds].filter((id) => !characterIdSet.has(id))
    if (missingCharacters.length > 0) {
      pushIssue(
        issueList,
        'high',
        'timeline',
        '时间轴事件人物引用失效',
        `${event.eventTitle} 包含 ${missingCharacters.length} 个已失效人物引用。`,
        '重新选择在场人物和受影响人物，避免人物状态统计失真。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    const linkedItemIds = listLinkedItemIds(event.linkedItemIdsJson)
    linkedItemIds.forEach((itemId) => {
      if (!itemIdSet.has(itemId)) {
        pushIssue(
          issueList,
          'high',
          'timeline',
          '时间轴事件物品引用失效',
          `${event.eventTitle} 引用了已删除物品 #${itemId}。`,
          '清理失效物品，或重新绑定正确物品。',
          { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
        )
        return
      }

      const item = itemRows.find((row) => row.id === itemId)
      const backLinks = listLinkedTimelineEventIds(item?.linkedTimelineEventIdsJson)
      if (!backLinks.includes(event.id)) {
        pushIssue(
          issueList,
          'high',
          'timeline',
          '事件与物品没有双向同步',
          `${event.eventTitle} 关联了 ${item?.itemName || `物品#${itemId}` }，但物品侧没有回写这个事件。`,
          '执行一次结构体检或重新保存该事件/物品，补齐双向联动。',
          { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
        )
      }
    })

    if (
      !event.chapterStartId &&
      !event.chapterEndId &&
      !event.locationMapId &&
      presentIds.length === 0 &&
      linkedItemIds.length === 0
    ) {
      pushIssue(
        issueList,
        'low',
        'timeline',
        '时间轴事件过于孤立',
        `${event.eventTitle} 目前没有章节、地点、人物或物品挂点。`,
        '至少补一个章节范围或地点，再补人物/物品挂点。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (
      event.status === 'planned' &&
      ((typeof startNum === 'number' && chapterRows.some((row) => row.chapterNum >= startNum && asText(row.content))) ||
        (typeof endNum === 'number' && chapterRows.some((row) => row.chapterNum >= endNum && asText(row.content))))
    ) {
      pushIssue(
        issueList,
        'low',
        'timeline',
        '时间轴状态未跟正文进度同步',
        `${event.eventTitle} 对应章节已经有正文，但事件状态还停留在 planned。`,
        '重新保存章节或事件，让事件状态同步到 written / resolved。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }
  })

  itemRows.forEach((item) => {
    if (item.parentItemId && !itemIdSet.has(item.parentItemId)) {
      pushIssue(
        issueList,
        'medium',
        'item',
        '物品模板引用失效',
        `${item.itemName} 引用了不存在的模板。`,
        '重新选择模板，或清空模板引用。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (item.ownerCharacterId && !characterIdSet.has(item.ownerCharacterId)) {
      pushIssue(
        issueList,
        'high',
        'item',
        '物品持有者失效',
        `${item.itemName} 绑定的持有者已不存在。`,
        '重新绑定持有者，避免人物装备链断裂。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (item.locationMapId && !mapIdSet.has(item.locationMapId)) {
      pushIssue(
        issueList,
        'high',
        'item',
        '物品地点失效',
        `${item.itemName} 绑定的地点已不存在。`,
        '重新绑定地点，避免关键物品去向丢失。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    const linkedEvents = listLinkedTimelineEventIds(item.linkedTimelineEventIdsJson)
    linkedEvents.forEach((eventId) => {
      if (!eventIdSet.has(eventId)) {
        pushIssue(
          issueList,
          'high',
          'item',
          '物品事件引用失效',
          `${item.itemName} 引用了已删除事件 #${eventId}。`,
          '清理失效事件，或重新绑定正确时间轴节点。',
          { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
        )
        return
      }

      const event = eventRows.find((row) => row.id === eventId)
      const backLinks = listLinkedItemIds(event?.linkedItemIdsJson)
      if (!backLinks.includes(item.id)) {
        pushIssue(
          issueList,
          'high',
          'item',
          '物品与事件没有双向同步',
          `${item.itemName} 关联了 ${event?.eventTitle || `事件#${eventId}` }，但事件侧没有回写这个物品。`,
          '重新保存该物品或事件，补齐双向联动。',
          { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
        )
      }
    })

    const linkedCharacters = parseNumberArray(item.linkedCharacterIdsJson).filter((id) => !characterIdSet.has(id))
    if (linkedCharacters.length > 0) {
      pushIssue(
        issueList,
        'medium',
        'item',
        '物品角色引用失效',
        `${item.itemName} 的关联角色里有 ${linkedCharacters.length} 个失效引用。`,
        '重新选择关联角色，避免物品关系链出现空洞。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (
      item.itemKind === 'instance' &&
      !item.ownerCharacterId &&
      !item.locationMapId &&
      linkedEvents.length === 0 &&
      parseNumberArray(item.linkedCharacterIdsJson).length === 0
    ) {
      pushIssue(
        issueList,
        'low',
        'item',
        '物品实例仍然悬空',
        `${item.itemName} 还没有挂到人物、地点或事件。`,
        '至少给它一个持有人、出现地点或相关事件，避免变成摆设。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }
  })

  const chaptersMissingSummary = chapterRows.filter((row) => asText(row.content) && !asText(row.summary)).length
  const chaptersMissingContinuity = chapterRows.filter((row) => asText(row.content) && !asText(row.continuityStateJson)).length
  const linkedTimelineCount = eventRows.filter((row) => row.chapterStartId || row.chapterEndId || row.locationMapId).length
  const bidirectionalLinkCount = itemRows.filter((item) =>
    listLinkedTimelineEventIds(item.linkedTimelineEventIdsJson)
      .every((eventId) => eventRows.some((event) => event.id === eventId && listLinkedItemIds(event.linkedItemIdsJson).includes(item.id))),
  ).length

  const highCount = issueList.filter((issue) => issue.severity === 'high').length
  const mediumCount = issueList.filter((issue) => issue.severity === 'medium').length
  const lowCount = issueList.filter((issue) => issue.severity === 'low').length
  const readinessScore = Math.max(0, 100 - highCount * 18 - mediumCount * 9 - lowCount * 4)

  const categoryWeight = new Map<string, number>()
  issueList.forEach((issue) => {
    const current = categoryWeight.get(issue.category) || 0
    const weight = issue.severity === 'high' ? 3 : issue.severity === 'medium' ? 2 : 1
    categoryWeight.set(issue.category, current + weight)
  })

  const focusAreas = [...categoryWeight.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([category]) => {
      switch (category) {
        case 'timeline':
          return '优先清理时间轴挂点和事件顺序。'
        case 'item':
          return '优先补齐物品与人物/事件的双向联动。'
        case 'chapter':
        case 'continuity':
          return '优先补摘要、连续性记忆和章节细纲。'
        case 'map':
          return '优先修正地图节点层级和失效地点。'
        case 'outline':
          return '优先整理故事弧范围和章节归属。'
        default:
          return '优先稳定人物主线锚点。'
      }
    })

  return {
    generatedAt: new Date().toISOString(),
    readinessScore,
    overview: buildOverview(highCount, mediumCount, lowCount),
    issueCount: issueList.length,
    highCount,
    mediumCount,
    lowCount,
    focusAreas,
    metrics: {
      chapterCount: chapterRows.length,
      chaptersMissingSummary,
      chaptersMissingContinuity,
      timelineCount: eventRows.length,
      linkedTimelineCount,
      itemCount: itemRows.length,
      bidirectionalLinkCount,
    },
    issues: issueList,
  }
}
