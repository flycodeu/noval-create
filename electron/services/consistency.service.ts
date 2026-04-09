import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapters,
  characterRelations,
  characters,
  novels,
  storyArcs,
  storyItems,
  storyThreads,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { listLinkedItemIds, listLinkedTimelineEventIds } from './link-sync.service'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { getWorldStateLedgerSnapshot, type WorldStateSeverity } from './world-state.service'

export type ConsistencySeverity = 'high' | 'medium' | 'low'

export interface ConsistencyIssue {
  id: string
  severity: ConsistencySeverity
  category: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'outline' | 'continuity' | 'thread' | 'voice' | 'relation' | 'worldState'
  title: string
  description: string
  suggestion: string
  entityType?: 'character' | 'chapter' | 'timeline' | 'item' | 'map' | 'arc' | 'thread' | 'faction' | 'relation' | 'location'
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
    writingContractTagCount: number
    protagonistRelationCount: number
    styledRelationCount: number
    subtextRelationCount: number
    ratedRelationCount: number
    worldStateTrackedEntityCount: number
    worldStateDriftAlertCount: number
    worldStateConflictAlertCount: number
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

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function normalizeSignaturePart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function buildThreadSimilaritySignature(row: typeof storyThreads.$inferSelect): string {
  return [
    normalizeSignaturePart(row.threadType || 'subplot'),
    normalizeSignaturePart(row.summary || ''),
    normalizeSignaturePart(row.premise || ''),
    normalizeSignaturePart(row.payoffCondition || ''),
    typeof row.startChapter === 'number' ? String(row.startChapter) : '',
    typeof row.targetPayoffChapter === 'number' ? String(row.targetPayoffChapter) : '',
  ].filter(Boolean).join('|')
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

function mapWorldStateSeverity(severity: WorldStateSeverity): ConsistencySeverity {
  if (severity === 'critical') return 'high'
  if (severity === 'warning') return 'medium'
  return 'low'
}

function worldStateEntityLabel(entityType: 'character' | 'faction' | 'item' | 'relation' | 'location'): string {
  switch (entityType) {
    case 'character':
      return '人物'
    case 'faction':
      return '势力'
    case 'item':
      return '物品'
    case 'relation':
      return '关系'
    case 'location':
      return '地点'
    default:
      return entityType
  }
}

function buildOverview(highCount: number, mediumCount: number, lowCount: number): string {
  if (highCount > 0) {
    return `当前存在 ${highCount} 个高优先级结构问题，建议先修关键冲突再继续批量生成。`
  }
  if (mediumCount > 0) {
    return `当前没有致命冲突，但还有 ${mediumCount} 个中优先问题会持续放大。`
  }
  if (lowCount > 0) {
    return `当前结构可以继续推进，但还有 ${lowCount} 个轻度问题值得尽快收口。`
  }
  return '当前未发现明显结构冲突，可以继续推进结构、正文和精修。'
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
  const issues: ConsistencyIssue[] = []
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const themeVoice = parseThemeVoiceDocument(novel?.themeVoiceJson)

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const threadRows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  const eventRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  const worldStateLedger = getWorldStateLedgerSnapshot(novelId, {
    entityLimit: 200,
    alertLimit: 256,
    conflictEntityLimit: 32,
  })

  const latestChapterNum = chapterRows.reduce((maxValue, row) => Math.max(maxValue, row.chapterNum || 0), 0)
  const chapterNumMap = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
  const characterIdSet = new Set(characterRows.map((row) => row.id))
  const arcIdSet = new Set(arcRows.map((row) => row.id))
  const eventIdSet = new Set(eventRows.map((row) => row.id))
  const itemIdSet = new Set(itemRows.map((row) => row.id))
  const mapIdSet = new Set(mapRows.map((row) => row.id))

  const protagonists = characterRows.filter((row) => row.roleType === 'protagonist')
  const protagonistIds = new Set(protagonists.map((row) => row.id))
  const protagonistRelationRows = relationRows.filter((row) =>
    protagonistIds.has(row.charAId) || protagonistIds.has(row.charBId),
  )
  const writingContractTagCount = themeVoice.writingContractTags.length
  const styledRelationCount = relationRows.filter((row) => asText(row.interactionStyle)).length
  const subtextRelationCount = relationRows.filter((row) => asText(row.subtextRule)).length
  const ratedRelationCount = relationRows.filter((row) =>
    typeof row.intimacyLevel === 'number' || typeof row.tensionLevel === 'number',
  ).length
  const protagonistRelationCount = protagonistRelationRows.length
  const protagonistStyledCount = protagonistRelationRows.filter((row) => asText(row.interactionStyle)).length
  const protagonistSubtextCount = protagonistRelationRows.filter((row) => asText(row.subtextRule)).length
  const protagonistRatedCount = protagonistRelationRows.filter((row) =>
    typeof row.intimacyLevel === 'number' || typeof row.tensionLevel === 'number',
  ).length

  if (writingContractTagCount === 0) {
    pushIssue(
      issues,
      'medium',
      'voice',
      '整本书还没有写作类型锚点',
      '当前 Theme Voice 里还没有“爽文 / 写实 / 言情”等全书级写作类型，后续生成更容易在节奏、情绪兑现和语言边界上漂移。',
      '先在主题与文风页补上写作类型标签，再继续批量生成故事设计和正文。',
    )
  } else if (!asText(themeVoice.styleRules) || !asText(themeVoice.dialogueRules)) {
    pushIssue(
      issues,
      'medium',
      'voice',
      '写作类型还没有翻译成语言规则',
      `当前已经选了 ${writingContractTagCount} 个写作类型标签，但文风规则或对白规则仍然偏空，模型很难把“阅读预期”落实成具体语气与节奏。`,
      '把写作类型落实到风格规则、对白规则和描写规则里，明确什么该加速、什么必须克制、什么不能写成统一口吻。',
    )
  }

  if (protagonists.length === 0) {
    pushIssue(
      issues,
      'high',
      'character',
      '缺少主角',
      '当前角色系统里没有主角，后续称呼、主线推进和人物关系都会失去锚点。',
      '先补一个主角，再继续扩人物网络和章节内容。',
    )
  } else if (protagonists.length > 1) {
    pushIssue(
      issues,
      'high',
      'character',
      '主角数量冲突',
      `当前标记了 ${protagonists.length} 位主角，容易造成叙事重心和称呼规则混乱。`,
      '保留一个真正的主角，其余角色改成 major、supporting 或 antagonist。',
    )
  }

  if (protagonists.length > 0 && protagonistRelationCount === 0) {
    const anchor = protagonists[0]
    pushIssue(
      issues,
      'high',
      'relation',
      '主角还没有关键人物关系',
      `${anchor.fullName} 当前没有任何已定义的人物关系，后续对白、情感线和冲突站位都会失去抓手。`,
      '先补主角与家人、朋友、陌生人、对立者或上下级的核心关系，再继续扩正文。',
      { entityType: 'character', entityId: anchor.id, entityLabel: anchor.fullName },
    )
  } else if (
    protagonists.length > 0
    && protagonistRelationCount > 0
    && (
      protagonistStyledCount < protagonistRelationCount
      || protagonistSubtextCount < Math.ceil(protagonistRelationCount / 2)
      || protagonistRatedCount < Math.ceil(protagonistRelationCount / 2)
    )
  ) {
    const anchor = protagonists[0]
    pushIssue(
      issues,
      'medium',
      'relation',
      '主角关系还没写成可落地对白的模型',
      `主角已有 ${protagonistRelationCount} 条关系，但只有 ${protagonistStyledCount} 条写了互动方式、${protagonistSubtextCount} 条写了潜台词、${protagonistRatedCount} 条写了强弱等级。`,
      '优先补主角关键关系的互动方式、潜台词和亲密/张力等级，让不同关系能真正进入对白与场景动作。',
      { entityType: 'character', entityId: anchor.id, entityLabel: anchor.fullName },
    )
  }

  if (
    relationRows.length > 0
    && (
      styledRelationCount < Math.ceil(relationRows.length / 2)
      || subtextRelationCount < Math.ceil(relationRows.length / 3)
      || ratedRelationCount < Math.ceil(relationRows.length / 2)
    )
  ) {
    pushIssue(
      issues,
      'medium',
      'relation',
      '人物关系还停留在标签层',
      `当前共 ${relationRows.length} 条关系，但只有 ${styledRelationCount} 条写了互动方式、${subtextRelationCount} 条写了潜台词、${ratedRelationCount} 条写了强弱等级。`,
      '把关系从“朋友 / 家人 / 敌对”的标签，补成能直接约束称呼、语气、试探方式和情绪动作的互动模型。',
    )
  }

  const chapterNums = new Set<number>()
  chapterRows.forEach((chapter, index) => {
    if (chapterNums.has(chapter.chapterNum)) {
      pushIssue(
        issues,
        'high',
        'chapter',
        '章节编号重复',
        `第 ${chapter.chapterNum} 章存在重复记录。`,
        '调整章节编号，确保时间轴和故事弧都只对应一个稳定章位。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第 ${chapter.chapterNum} 章` },
      )
    }
    chapterNums.add(chapter.chapterNum)

    const previous = chapterRows[index - 1]
    if (previous && chapter.chapterNum - previous.chapterNum > 1) {
      pushIssue(
        issues,
        'medium',
        'chapter',
        '章节编号出现断档',
        `第 ${previous.chapterNum} 章和第 ${chapter.chapterNum} 章之间存在空档。`,
        '确认是否有意留空；如果不是，补齐章节编号或重新校准结构。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第 ${chapter.chapterNum} 章` },
      )
    }

    const hasContent = Boolean(asText(chapter.content))
    if (hasContent && !asText(chapter.summary)) {
      pushIssue(
        issues,
        'medium',
        'continuity',
        '章节缺少摘要',
        `第 ${chapter.chapterNum} 章已有正文，但没有摘要。`,
        '先刷新摘要，给后续长文记忆和修订回查提供稳定锚点。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第 ${chapter.chapterNum} 章` },
      )
    }

    if (hasContent && !asText(chapter.continuityStateJson)) {
      pushIssue(
        issues,
        'medium',
        'continuity',
        '章节缺少连续性记忆',
        `第 ${chapter.chapterNum} 章已有正文，但没有连续性状态。`,
        '刷新连续性状态，补齐剧情推进、人物变化和待回收事项。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第 ${chapter.chapterNum} 章` },
      )
    }

    if ((chapter.status === 'draft' || chapter.status === 'final') && !asText(chapter.outline)) {
      pushIssue(
        issues,
        'medium',
        'chapter',
        '已写章节缺少细纲',
        `第 ${chapter.chapterNum} 章已经进入 ${chapter.status} 状态，但没有细纲。`,
        '补一版章节细纲，避免后续结构追踪和回收点失去来源。',
        { entityType: 'chapter', entityId: chapter.id, entityLabel: chapter.title || `第 ${chapter.chapterNum} 章` },
      )
    }
  })

  const sortedArcs = [...arcRows].sort((left, right) => (left.chapterStart || 0) - (right.chapterStart || 0))
  sortedArcs.forEach((arc, index) => {
    const start = arc.chapterStart ?? 0
    const end = arc.chapterEnd ?? 0

    if (start && end && start > end) {
      pushIssue(
        issues,
        'high',
        'outline',
        '故事弧章位反转',
        `${arc.arcName} 的起始章位大于结束章位。`,
        '修正故事弧范围，保证大纲与时间轴能正确对齐。',
        { entityType: 'arc', entityId: arc.id, entityLabel: arc.arcName },
      )
    }

    const previous = sortedArcs[index - 1]
    if (previous && previous.chapterEnd && arc.chapterStart && previous.chapterEnd >= arc.chapterStart) {
      pushIssue(
        issues,
        'medium',
        'outline',
        '故事弧范围重叠',
        `${previous.arcName} 与 ${arc.arcName} 的章节范围存在重叠。`,
        '重新梳理故事弧边界，避免同一章在结构上承担过多主线任务。',
        { entityType: 'arc', entityId: arc.id, entityLabel: arc.arcName },
      )
    }
  })

  mapRows.forEach((node) => {
    if (node.parentId && !mapIdSet.has(node.parentId)) {
      pushIssue(
        issues,
        'high',
        'map',
        '地图节点父级丢失',
        `${node.name} 的父节点不存在。`,
        '修正地图层级，避免地点关系链断裂。',
        { entityType: 'map', entityId: node.id, entityLabel: node.name },
      )
    }
  })

  if (threadRows.length === 0) {
    pushIssue(
      issues,
      'medium',
      'thread',
      '缺少故事线程',
      '当前还没有任何可追踪的故事线程，后续章节很难稳定回收冲突和悬念。',
      '先补出主线、关系线或悬念线，再继续批量写作。',
    )
  } else {
    const mainThreads = threadRows.filter((row) => row.threadType === 'main')
    if (mainThreads.length === 0) {
      pushIssue(
        issues,
        'high',
        'thread',
        '缺少主线线程',
        '当前线程列表里没有主线线程，结构页和时间轴缺少总推进链。',
        '补一条 main 线程，明确主推进目标、起始章和回收条件。',
      )
    } else if (mainThreads.length > 1) {
      pushIssue(
        issues,
        'high',
        'thread',
        '主线线程数量冲突',
        `当前存在 ${mainThreads.length} 条主线线程，容易导致结构重心不稳定。`,
        '保留一条真正的主线，其余转成 subplot、mystery、relationship 或 payoff。',
      )
    }

    const seenThreadSignatures = new Map<string, typeof storyThreads.$inferSelect>()
    threadRows.forEach((thread) => {
      const activeLike = thread.status !== 'resolved' && thread.status !== 'abandoned'

      if (activeLike && typeof thread.startChapter !== 'number') {
        pushIssue(
          issues,
          'medium',
          'thread',
          '线程缺少起始章位',
          `${thread.title} 仍在推进中，但没有起始章位。`,
          '补充 startChapter，让结构页、时间轴和章节回查都能追踪这条线程。',
          { entityType: 'thread', entityId: thread.id, entityLabel: thread.title },
        )
      }

      if (activeLike && typeof thread.targetPayoffChapter !== 'number') {
        pushIssue(
          issues,
          'medium',
          'thread',
          '线程缺少回收章位',
          `${thread.title} 仍在推进中，但没有目标回收章位。`,
          '补充 targetPayoffChapter 或至少写清回收条件，避免线程悬空。',
          { entityType: 'thread', entityId: thread.id, entityLabel: thread.title },
        )
      }

      if (
        activeLike
        && typeof thread.targetPayoffChapter === 'number'
        && latestChapterNum > 0
        && thread.targetPayoffChapter < latestChapterNum
      ) {
        pushIssue(
          issues,
          'medium',
          'thread',
          '线程已过回收窗口',
          `${thread.title} 仍未解决，但目标回收章位已经落后于当前正文进度。`,
          '要么尽快回收这条线程，要么重设章位并同步当前状态。',
          { entityType: 'thread', entityId: thread.id, entityLabel: thread.title },
        )
      }

      if (
        thread.status === 'resolved'
        && typeof thread.targetPayoffChapter === 'number'
        && latestChapterNum > 0
        && thread.targetPayoffChapter > latestChapterNum
      ) {
        pushIssue(
          issues,
          'low',
          'thread',
          '线程状态早于正文进度',
          `${thread.title} 已标记为 resolved，但回收章位还在当前正文之后。`,
          '检查这条线程是提前结清了，还是章位和状态没有同步更新。',
          { entityType: 'thread', entityId: thread.id, entityLabel: thread.title },
        )
      }

      const signature = buildThreadSimilaritySignature(thread)
      if (!signature || !activeLike) return

      const previous = seenThreadSignatures.get(signature)
      if (previous) {
        pushIssue(
          issues,
          'medium',
          'thread',
          '线程功能位高度重复',
          `${thread.title} 与 ${previous.title} 的冲突抓手、回收条件或章位过于接近。`,
          '保留一条更清晰的线程，另一条改成明显不同的功能位或直接合并。',
          { entityType: 'thread', entityId: thread.id, entityLabel: thread.title },
        )
        return
      }

      seenThreadSignatures.set(signature, thread)
    })
  }

  eventRows.forEach((event) => {
    const startNum = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined

    if (typeof startNum === 'number' && typeof endNum === 'number' && startNum > endNum) {
      pushIssue(
        issues,
        'high',
        'timeline',
        '时间轴章节范围反转',
        `${event.eventTitle} 的起始章位大于结束章位。`,
        '调整事件对应章节范围，避免正文顺序和时间轴冲突。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (event.arcId && !arcIdSet.has(event.arcId)) {
      pushIssue(
        issues,
        'medium',
        'timeline',
        '时间轴事件引用了失效故事弧',
        `${event.eventTitle} 关联的故事弧已经不存在。`,
        '重新绑定故事弧，或清空无效引用。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (event.locationMapId && !mapIdSet.has(event.locationMapId)) {
      pushIssue(
        issues,
        'high',
        'timeline',
        '时间轴事件地点失效',
        `${event.eventTitle} 关联的地点已经失效。`,
        '重新绑定地点，避免事件失去落点。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    const presentIds = parseNumberArray(event.presentCharacterIdsJson)
    const affectedIds = parseNumberArray(event.affectedCharacterIdsJson)
    const missingCharacters = [...presentIds, ...affectedIds].filter((id) => !characterIdSet.has(id))
    if (missingCharacters.length > 0) {
      pushIssue(
        issues,
        'high',
        'timeline',
        '时间轴事件人物引用失效',
        `${event.eventTitle} 包含 ${missingCharacters.length} 个已经失效的人物引用。`,
        '重新选择在场人物和受影响人物，避免后续统计失真。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    const linkedItemIds = listLinkedItemIds(event.linkedItemIdsJson)
    linkedItemIds.forEach((itemId) => {
      if (!itemIdSet.has(itemId)) {
        pushIssue(
          issues,
          'high',
          'timeline',
          '时间轴事件物品引用失效',
          `${event.eventTitle} 引用了已删除物品 #${itemId}。`,
          '清理无效物品，或重新绑定正确物品。',
          { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
        )
        return
      }

      const item = itemRows.find((row) => row.id === itemId)
      const backLinks = listLinkedTimelineEventIds(item?.linkedTimelineEventIdsJson)
      if (!backLinks.includes(event.id)) {
        pushIssue(
          issues,
          'high',
          'timeline',
          '事件与物品没有双向同步',
          `${event.eventTitle} 关联了 ${item?.itemName || `物品#${itemId}` }，但物品侧没有回写这条事件。`,
          '重存该事件或物品，补齐双向关联。',
          { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
        )
      }
    })

    if (event.anchorInvalid) {
      pushIssue(
        issues,
        'medium',
        'timeline',
        '时间轴结构锚点失效',
        `${event.eventTitle} 绑定的结构锚点已经失效。`,
        '重新选择卷、部、章节或场景落点，避免事件漂浮。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (
      !event.volumeId
      && !event.partId
      && !event.chapterStartId
      && !event.chapterEndId
      && !event.segmentId
      && !event.locationMapId
      && presentIds.length === 0
      && linkedItemIds.length === 0
    ) {
      pushIssue(
        issues,
        'low',
        'timeline',
        '时间轴事件过于孤立',
        `${event.eventTitle} 没有章节、地点、人物或物品挂点。`,
        '至少补一个章节范围或地点，再补人物或物品挂点。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }

    if (
      event.status === 'planned'
      && ((typeof startNum === 'number' && chapterRows.some((row) => row.chapterNum >= startNum && asText(row.content)))
        || (typeof endNum === 'number' && chapterRows.some((row) => row.chapterNum >= endNum && asText(row.content))))
    ) {
      pushIssue(
        issues,
        'low',
        'timeline',
        '时间轴状态未跟正文同步',
        `${event.eventTitle} 对应章节已经有正文，但事件状态仍停留在 planned。`,
        '重存事件或章节，让状态推进到 written 或 resolved。',
        { entityType: 'timeline', entityId: event.id, entityLabel: event.eventTitle },
      )
    }
  })

  itemRows.forEach((item) => {
    if (item.parentItemId && !itemIdSet.has(item.parentItemId)) {
      pushIssue(
        issues,
        'medium',
        'item',
        '物品模板引用失效',
        `${item.itemName} 引用了不存在的模板。`,
        '重新选择模板，或清空无效模板引用。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (item.ownerCharacterId && !characterIdSet.has(item.ownerCharacterId)) {
      pushIssue(
        issues,
        'high',
        'item',
        '物品持有者失效',
        `${item.itemName} 绑定的持有者已经不存在。`,
        '重新绑定持有者，避免人物装备链断裂。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (item.locationMapId && !mapIdSet.has(item.locationMapId)) {
      pushIssue(
        issues,
        'high',
        'item',
        '物品地点失效',
        `${item.itemName} 绑定的地点已经不存在。`,
        '重新绑定地点，避免关键物品失去去向。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    const linkedEvents = listLinkedTimelineEventIds(item.linkedTimelineEventIdsJson)
    linkedEvents.forEach((eventId) => {
      if (!eventIdSet.has(eventId)) {
        pushIssue(
          issues,
          'high',
          'item',
          '物品事件引用失效',
          `${item.itemName} 引用了已删除事件 #${eventId}。`,
          '清理无效事件，或重新绑定正确时间轴节点。',
          { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
        )
        return
      }

      const event = eventRows.find((row) => row.id === eventId)
      const backLinks = listLinkedItemIds(event?.linkedItemIdsJson)
      if (!backLinks.includes(item.id)) {
        pushIssue(
          issues,
          'high',
          'item',
          '物品与事件没有双向同步',
          `${item.itemName} 关联了 ${event?.eventTitle || `事件#${eventId}` }，但事件侧没有回写这件物品。`,
          '重存该物品或事件，补齐双向关联。',
          { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
        )
      }
    })

    const missingLinkedCharacters = parseNumberArray(item.linkedCharacterIdsJson).filter((id) => !characterIdSet.has(id))
    if (missingLinkedCharacters.length > 0) {
      pushIssue(
        issues,
        'medium',
        'item',
        '物品角色引用失效',
        `${item.itemName} 的关联角色里有 ${missingLinkedCharacters.length} 个失效引用。`,
        '重新选择关联角色，避免物品关系链出现空洞。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }

    if (
      item.itemKind === 'instance'
      && !item.ownerCharacterId
      && !item.locationMapId
      && linkedEvents.length === 0
      && parseNumberArray(item.linkedCharacterIdsJson).length === 0
    ) {
      pushIssue(
        issues,
        'low',
        'item',
        '物品实例仍然悬空',
        `${item.itemName} 还没有挂到人物、地点或事件上。`,
        '至少给它一个持有人、地点或关联事件，避免沦为摆设。',
        { entityType: 'item', entityId: item.id, entityLabel: item.itemName },
      )
    }
  })

  worldStateLedger.conflictEntities.forEach((entity) => {
    const alert = worldStateLedger.alerts.find((item) => item.entityType === entity.entityType && item.entityId === entity.entityId)
    const severity = mapWorldStateSeverity(entity.severity)
    const issueTitle = entity.conflictCount > 0
      ? `${worldStateEntityLabel(entity.entityType)}状态存在硬冲突`
      : `${worldStateEntityLabel(entity.entityType)}状态存在跳变缺口`
    const issueDescription = entity.reasons.length > 0
      ? `${entity.entityName} 当前账本命中 ${entity.alertCount} 条状态告警：${entity.reasons.join('；')}。`
      : `${entity.entityName} 当前账本存在 ${entity.alertCount} 条状态告警，需要补齐来源和承接。`
    const suggestion = alert?.alertType === 'conflict'
      ? '先修正该实体的当前事实，再回查相关章节、关系和挂点，确保总账与正文一致。'
      : '补齐导致状态变化的事件原因，并确认章节承接里已经写明这次变化。'
    pushIssue(
      issues,
      severity,
      'worldState',
      issueTitle,
      issueDescription,
      suggestion,
      {
        entityType: entity.entityType,
        entityId: entity.entityId,
        entityLabel: entity.entityName,
      },
    )
  })

  const chaptersMissingSummary = chapterRows.filter((row) => asText(row.content) && !asText(row.summary)).length
  const chaptersMissingContinuity = chapterRows.filter((row) => asText(row.content) && !asText(row.continuityStateJson)).length
  const linkedTimelineCount = eventRows.filter((row) =>
    row.volumeId
    || row.partId
    || row.chapterStartId
    || row.chapterEndId
    || row.segmentId
    || row.locationMapId).length
  const bidirectionalLinkCount = itemRows.filter((item) =>
    listLinkedTimelineEventIds(item.linkedTimelineEventIdsJson)
      .every((eventId) => eventRows.some((event) => event.id === eventId && listLinkedItemIds(event.linkedItemIdsJson).includes(item.id))),
  ).length

  const highCount = issues.filter((issue) => issue.severity === 'high').length
  const mediumCount = issues.filter((issue) => issue.severity === 'medium').length
  const lowCount = issues.filter((issue) => issue.severity === 'low').length
  const readinessScore = Math.max(0, 100 - highCount * 18 - mediumCount * 9 - lowCount * 4)

  const categoryWeight = new Map<string, number>()
  issues.forEach((issue) => {
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
          return '优先清理时间轴挂点、事件顺序和失效引用。'
        case 'thread':
          return '优先补主线线程、回收章位和重复功能位。'
        case 'item':
          return '优先补齐物品与人物、地点、事件之间的双向关联。'
        case 'voice':
          return '优先把写作类型翻译成节奏、对白和语言硬规则。'
        case 'relation':
          return '优先补主角关键关系的互动方式、潜台词和强弱等级。'
        case 'worldState':
          return '优先按世界状态总账回查冲突实体，统一修正物品、势力、关系和地点事实。'
        case 'chapter':
        case 'continuity':
          return '优先补摘要、连续性记忆和章节细纲。'
        case 'map':
          return '优先修正地图层级和失效地点。'
        case 'outline':
          return '优先整理故事弧范围和章节归属。'
        default:
          return '优先稳住角色锚点和主线重心。'
      }
    })

  return {
    generatedAt: new Date().toISOString(),
    readinessScore,
    overview: buildOverview(highCount, mediumCount, lowCount),
    issueCount: issues.length,
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
      writingContractTagCount,
      protagonistRelationCount,
      styledRelationCount,
      subtextRelationCount,
      ratedRelationCount,
      worldStateTrackedEntityCount: worldStateLedger.overview.trackedEntityCount,
      worldStateDriftAlertCount: worldStateLedger.overview.driftAlertCount,
      worldStateConflictAlertCount: worldStateLedger.overview.conflictAlertCount,
    },
    issues,
  }
}
