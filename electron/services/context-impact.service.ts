import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapters, novels, storyItems, timelineEvents } from '../database/schema'
import { buildNovelConsistencyReport, type ConsistencyIssue } from './consistency.service'

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))]
  } catch {
    return []
  }
}

function stringifyStringArray(values: string[]): string {
  return JSON.stringify([...new Set(values.map((item) => item.trim()).filter(Boolean))])
}

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function parseAiScore(raw?: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const preferred = typeof parsed.overall_score === 'number'
      ? parsed.overall_score
      : typeof parsed.score === 'number'
        ? parsed.score
        : null
    return typeof preferred === 'number' && Number.isFinite(preferred) ? preferred : null
  } catch {
    return null
  }
}

function parseReviewState(raw?: string | null): { severity?: string; rewriteRequired: boolean } {
  if (!raw) return { rewriteRequired: false }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      severity: typeof parsed.severity === 'string' ? parsed.severity : undefined,
      rewriteRequired: parsed.rewrite_required === true,
    }
  } catch {
    return { rewriteRequired: false }
  }
}

function mergeReasons(raw: string | null | undefined, reasons: string[]): string {
  return stringifyStringArray([...parseStringArray(raw), ...reasons])
}

export interface NovelContextStatus {
  novelId: number
  contextVersion: number
  totalChapterCount: number
  staleChapterCount: number
  staleChapterIds: number[]
}

export interface ChapterPublishCheckItem {
  key: string
  label: string
  status: 'pass' | 'warning' | 'blocker'
  detail: string
}

export interface ChapterPublishCheck {
  chapterId: number
  chapterNum: number
  ready: boolean
  summary: string
  blockerCount: number
  warningCount: number
  staleReasons: string[]
  chapterContextVersion: number
  novelContextVersion: number
  checklist: ChapterPublishCheckItem[]
}

export function getNovelContextStatus(novelId: number): NovelContextStatus {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throw new Error('小说不存在')
  }

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const staleChapterIds = chapterRows
    .filter((chapter) => parseStringArray(chapter.staleReasonJson).length > 0)
    .map((chapter) => chapter.id)

  return {
    novelId,
    contextVersion: novel.contextVersion || 1,
    totalChapterCount: chapterRows.length,
    staleChapterCount: staleChapterIds.length,
    staleChapterIds,
  }
}

export function markNovelContextChanged(novelId: number, reasons: string | string[]): number {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throw new Error('小说不存在')
  }

  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) {
    return novel.contextVersion || 1
  }

  const nextVersion = (novel.contextVersion || 1) + 1
  const now = new Date().toISOString()

  getSqlite().transaction(() => {
    db.update(novels).set({
      contextVersion: nextVersion,
      updatedAt: now,
    }).where(eq(novels.id, novelId)).run()

    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }
  })()

  return nextVersion
}

export function markSubsequentChaptersStale(
  novelId: number,
  chapterNum: number,
  reasons: string | string[],
): void {
  const db = getDb()
  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) return

  const now = new Date().toISOString()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.chapterNum > chapterNum)

  if (chapterRows.length === 0) return

  getSqlite().transaction(() => {
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }
  })()
}

export function markChapterContextCurrent(chapterId: number): void {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throw new Error('章节不存在')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throw new Error('小说不存在')
  }

  db.update(chapters).set({
    contextVersion: novel.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

function collectChapterRelatedIssues(
  novelId: number,
  chapterId: number,
  chapterNum: number,
): ConsistencyIssue[] {
  const db = getDb()
  const report = buildNovelConsistencyReport(novelId)
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const currentChapter = chapterRows.find((item) => item.id === chapterId)
  const chapterIdToNum = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const relatedEvents = eventRows.filter((event) => {
    if (currentChapter?.partId && event.partId === currentChapter.partId) return true
    if (currentChapter?.volumeId && event.volumeId === currentChapter.volumeId) return true
    if (event.chapterStartId === chapterId || event.chapterEndId === chapterId) return true
    const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
    return typeof startNum === 'number' && typeof endNum === 'number'
      ? chapterNum >= startNum && chapterNum <= endNum
      : typeof startNum === 'number'
        ? chapterNum === startNum
        : typeof endNum === 'number'
          ? chapterNum === endNum
          : false
  })
  const relatedEventIds = new Set(relatedEvents.map((event) => event.id))
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const relatedItems = itemRows.filter((item) =>
    parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => relatedEventIds.has(id)))
  const relatedItemIds = new Set(relatedItems.map((item) => item.id))

  return report.issues.filter((issue) =>
    ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === chapterId)
    || (issue.entityType === 'timeline' && issue.entityId ? relatedEventIds.has(issue.entityId) : false)
    || (issue.entityType === 'item' && issue.entityId ? relatedItemIds.has(issue.entityId) : false))
}

export function runChapterPublishCheck(chapterId: number): ChapterPublishCheck {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throw new Error('章节不存在')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throw new Error('小说不存在')
  }

  const staleReasons = parseStringArray(chapter.staleReasonJson)
  const consistencyIssues = collectChapterRelatedIssues(chapter.novelId, chapter.id, chapter.chapterNum)
  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const mediumIssues = consistencyIssues.filter((issue) => issue.severity === 'medium')
  const aiScore = parseAiScore(chapter.aiScoreJson)
  const reviewState = parseReviewState(chapter.reviewNotesJson)

  const checklist: ChapterPublishCheckItem[] = [
    {
      key: 'content',
      label: '正文已完成',
      status: chapter.content?.trim() ? 'pass' : 'blocker',
      detail: chapter.content?.trim() ? '当前章节已有正文。' : '当前章节还没有正文内容。',
    },
    {
      key: 'summary',
      label: '摘要已刷新',
      status: chapter.summary?.trim() ? 'pass' : 'blocker',
      detail: chapter.summary?.trim() ? '章节摘要已经生成。' : '需要先刷新摘要和后续承接信息。',
    },
    {
      key: 'continuity',
      label: '连续性记忆已更新',
      status: chapter.continuityStateJson?.trim() ? 'pass' : 'blocker',
      detail: chapter.continuityStateJson?.trim() ? '连续性记忆可用于后文承接。' : '需要先补齐连续性记忆。',
    },
    {
      key: 'context',
      label: '上下文未过期',
      status: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1) ? 'pass' : 'blocker',
      detail: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1)
        ? '章节上下文与当前全书版本一致。'
        : `需要先处理这些过期原因：${staleReasons.join('；') || '上下文版本落后于当前设定。'}`,
    },
    {
      key: 'consistency',
      label: '无高优先级结构风险',
      status: highIssues.length === 0 ? 'pass' : 'blocker',
      detail: highIssues.length === 0
        ? '没有命中当前章节的高优先级结构问题。'
        : highIssues.slice(0, 3).map((issue) => issue.title).join('；'),
    },
    {
      key: 'ai_score',
      label: 'AI 体检已完成',
      status: typeof aiScore === 'number' ? (aiScore >= 60 ? 'pass' : 'warning') : 'warning',
      detail: typeof aiScore === 'number'
        ? `当前 AI 体检分数为 ${aiScore}。`
        : '还没有执行 AI 体检，建议在发布前跑一次。',
    },
    {
      key: 'review',
      label: '审校意见已处理',
      status: reviewState.rewriteRequired || reviewState.severity === 'high' ? 'warning' : 'pass',
      detail: reviewState.rewriteRequired || reviewState.severity === 'high'
        ? '当前审校结果仍建议重写或存在高风险意见。'
        : '当前没有需要强制处理的审校意见。',
    },
    {
      key: 'scene_plan',
      label: '场景计划可追溯',
      status: chapter.scenePlanJson?.trim() ? 'pass' : 'warning',
      detail: chapter.scenePlanJson?.trim() ? '可以追溯到当前章节的场景拆解。' : '当前缺少场景计划，后续排查承接问题会更难。',
    },
    {
      key: 'outline',
      label: '章节大纲存在',
      status: chapter.outline?.trim() ? 'pass' : 'warning',
      detail: chapter.outline?.trim() ? '章节大纲已保留。' : '当前章节缺少明确大纲，建议补齐后再标记完成。',
    },
    {
      key: 'medium_issues',
      label: '中优先级风险可控',
      status: mediumIssues.length <= 2 ? 'pass' : 'warning',
      detail: mediumIssues.length <= 2
        ? '没有堆积过多中优先级结构问题。'
        : mediumIssues.slice(0, 3).map((issue) => issue.title).join('；'),
    },
  ]

  const blockerCount = checklist.filter((item) => item.status === 'blocker').length
  const warningCount = checklist.filter((item) => item.status === 'warning').length

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    ready: blockerCount === 0,
    summary: blockerCount === 0
      ? warningCount === 0
        ? '当前章节可以直接标记为完成。'
        : '当前章节可以发布，但还有若干建议先处理的风险。'
      : '当前章节还不能标记为完成，请先处理阻塞项。',
    blockerCount,
    warningCount,
    staleReasons,
    chapterContextVersion: chapter.contextVersion || 1,
    novelContextVersion: novel.contextVersion || 1,
    checklist,
  }
}
