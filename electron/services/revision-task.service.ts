import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, revisionTasks, storyArcs, worldMap } from '../database/schema'
import type { ChapterGateLevel, RevisionAutoFixResult, RevisionTask, RewritePlan } from '../../src/types'
import { buildNovelConsistencyReport } from './consistency.service'
import { getNovelContextStatus, markNovelContextChanged, runChapterPublishCheck } from './context-impact.service'
import * as chapterService from './chapter.service'
import * as characterService from './character.service'
import * as itemService from './item.service'
import * as mapService from './map.service'
import * as storyThreadService from './story-thread.service'
import * as timelineService from './timeline.service'
import { throwUserFacingError } from '../utils/user-facing-error'

interface RevisionTaskQueryFilters {
  novelId: number
  taskSource?: 'manual' | 'system'
  status?: 'open' | 'in_progress' | 'resolved' | 'ignored'
  severity?: 'high' | 'medium' | 'low'
  keyword?: string
  relatedPage?: string
  entityType?: string
  entityId?: number
  page?: number
  pageSize?: number
}

interface RevisionOriginMeta extends Record<string, unknown> {
  issueCategory?: string
  autoFixable?: boolean
  entityLabel?: string
  suggestion?: string
  lastError?: string
  rewritePlan?: RewritePlan
  recheckItems?: string[]
  rewriteAttempts?: number
  maxRewriteAttempts?: number
  lastRecheckFailedItems?: string[]
  lastRecheckGateLevel?: ChapterGateLevel
  lastRecheckAt?: string
}

interface SystemRevisionDraft {
  issueKey: string
  taskType: string
  severity: 'high' | 'medium' | 'low'
  title: string
  description?: string
  fixBrief?: string
  relatedPage?: string
  entityType?: string
  entityId?: number
  chapterId?: number
  originMeta: RevisionOriginMeta
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeTaskSource(value: unknown): 'manual' | 'system' {
  return asText(value) === 'system' ? 'system' : 'manual'
}

function normalizeStatus(value: unknown): 'open' | 'in_progress' | 'resolved' | 'ignored' {
  const text = asText(value)
  if (text === 'in_progress' || text === 'resolved' || text === 'ignored') return text
  return 'open'
}

function normalizeSeverity(value: unknown): 'high' | 'medium' | 'low' {
  const text = asText(value)
  if (text === 'high' || text === 'low') return text
  return 'medium'
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function sanitizeRevisionTaskPayload(
  data: Partial<typeof revisionTasks.$inferInsert>,
): Partial<typeof revisionTasks.$inferInsert> {
  const next: Partial<typeof revisionTasks.$inferInsert> = {}

  if ('taskSource' in data) next.taskSource = normalizeTaskSource(data.taskSource)
  if ('issueKey' in data) next.issueKey = asText(data.issueKey) || null
  if (typeof data.taskType === 'string') next.taskType = asText(data.taskType)
  if ('status' in data) next.status = normalizeStatus(data.status)
  if ('severity' in data) next.severity = normalizeSeverity(data.severity)
  if (typeof data.title === 'string') next.title = asText(data.title)
  if (typeof data.description === 'string') next.description = asText(data.description)
  if (typeof data.fixBrief === 'string') next.fixBrief = asText(data.fixBrief)
  if (typeof data.relatedPage === 'string') next.relatedPage = asText(data.relatedPage)
  if (typeof data.entityType === 'string') next.entityType = asText(data.entityType)
  if ('entityId' in data) next.entityId = typeof data.entityId === 'number' ? Math.round(data.entityId) : null
  if ('chapterId' in data) next.chapterId = typeof data.chapterId === 'number' ? Math.round(data.chapterId) : null
  if (typeof data.originMetaJson === 'string') next.originMetaJson = data.originMetaJson
  if (typeof data.lastDetectedAt === 'string') next.lastDetectedAt = data.lastDetectedAt
  if (typeof data.resolvedAt === 'string') next.resolvedAt = data.resolvedAt

  return next
}

function getRelatedPage(taskType: string) {
  switch (taskType) {
    case 'timeline':
      return 'timeline'
    case 'item':
      return 'items'
    case 'character':
    case 'relation':
      return 'characters'
    case 'voice':
      return 'theme-voice'
    case 'thread':
      return 'threads'
    case 'map':
      return 'map'
    case 'outline':
      return 'outline'
    case 'chapter':
    case 'continuity':
      return 'writing'
    default:
      return 'revision'
  }
}

function normalizeIssueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 120)
}

function buildIssueKey(input: {
  taskType: string
  entityType?: string
  entityId?: number
  chapterId?: number
  title: string
}): string {
  return [
    normalizeIssueKeyPart(input.taskType),
    normalizeIssueKeyPart(input.entityType || 'novel'),
    typeof input.entityId === 'number' ? String(input.entityId) : 'none',
    typeof input.chapterId === 'number' ? String(input.chapterId) : 'none',
    normalizeIssueKeyPart(input.title),
  ].join(':')
}

function isAutoFixableTask(
  taskType: string,
  entityType?: string,
  entityId?: number,
  title?: string,
): boolean {
  if (typeof entityId !== 'number' || entityId <= 0) return false

  if (entityType === 'character' || entityType === 'item' || entityType === 'timeline' || entityType === 'thread') {
    return true
  }

  if (entityType === 'chapter') {
    return taskType === 'chapter'
      || taskType === 'continuity'
      || title === '章节缺少摘要'
      || title === '章节缺少连续性记忆'
      || title === '已写章节缺少细纲'
      || title === '章节编号重复'
      || title === '章节编号出现断档'
      || Boolean(title?.includes('需要同步上下文'))
  }

  if (entityType === 'map') {
    return taskType === 'map'
  }

  if (entityType === 'arc') {
    return taskType === 'outline'
  }

  return false
}

function parseStringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))]
    : []
}

function normalizeOriginMetaRewritePlan(value: unknown): RewritePlan | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const scope = typeof record.scope === 'string'
    ? record.scope
    : ''
  if (
    scope !== 'paragraph_patch'
    && scope !== 'scene_rewrite'
    && scope !== 'chapter_rewrite'
    && scope !== 'contract_replan'
  ) {
    return undefined
  }
  return {
    scope,
    targetSegmentId: typeof record.targetSegmentId === 'number' ? record.targetSegmentId : undefined,
    targetExcerpt: typeof record.targetExcerpt === 'string' ? record.targetExcerpt.trim() : undefined,
    goals: parseStringArrayValue(record.goals),
    preserve: parseStringArrayValue(record.preserve),
    recheckItems: parseStringArrayValue(record.recheckItems),
  }
}

function serializeOriginMeta(meta: RevisionOriginMeta): string {
  return JSON.stringify(meta)
}

function parseOriginMeta(raw?: string | null): RevisionOriginMeta {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return {
      ...parsed,
      issueCategory: typeof parsed.issueCategory === 'string' ? parsed.issueCategory : undefined,
      autoFixable: typeof parsed.autoFixable === 'boolean' ? parsed.autoFixable : undefined,
      entityLabel: typeof parsed.entityLabel === 'string' ? parsed.entityLabel : undefined,
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : undefined,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      rewritePlan: normalizeOriginMetaRewritePlan(parsed.rewritePlan),
      recheckItems: parseStringArrayValue(parsed.recheckItems),
      rewriteAttempts: typeof parsed.rewriteAttempts === 'number' ? parsed.rewriteAttempts : undefined,
      maxRewriteAttempts: typeof parsed.maxRewriteAttempts === 'number' ? parsed.maxRewriteAttempts : undefined,
      lastRecheckFailedItems: parseStringArrayValue(parsed.lastRecheckFailedItems),
      lastRecheckGateLevel:
        parsed.lastRecheckGateLevel === 'pass'
        || parsed.lastRecheckGateLevel === 'warning'
        || parsed.lastRecheckGateLevel === 'blocker'
        || parsed.lastRecheckGateLevel === 'rewrite'
          ? parsed.lastRecheckGateLevel
          : undefined,
      lastRecheckAt: typeof parsed.lastRecheckAt === 'string' ? parsed.lastRecheckAt : undefined,
    }
  } catch {
    return {}
  }
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parseContinuityState(raw?: string | null) {
  if (!raw) {
    return {
      plotProgress: [] as string[],
      characterStateChanges: [] as string[],
      worldStateChanges: [] as string[],
      openLoops: [] as string[],
      continuityNotes: [] as string[],
      arcProgress: '',
    }
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      plotProgress: parseStringArray(JSON.stringify(parsed.plot_progress || [])),
      characterStateChanges: parseStringArray(JSON.stringify(parsed.character_state_changes || [])),
      worldStateChanges: parseStringArray(JSON.stringify(parsed.world_state_changes || [])),
      openLoops: parseStringArray(JSON.stringify(parsed.open_loops || [])),
      continuityNotes: parseStringArray(JSON.stringify(parsed.continuity_notes || [])),
      arcProgress: typeof parsed.arc_progress === 'string' ? parsed.arc_progress.trim() : '',
    }
  } catch {
    return {
      plotProgress: [] as string[],
      characterStateChanges: [] as string[],
      worldStateChanges: [] as string[],
      openLoops: [] as string[],
      continuityNotes: [] as string[],
      arcProgress: '',
    }
  }
}

function buildFallbackChapterOutline(chapter: typeof chapters.$inferSelect): string {
  const continuity = parseContinuityState(chapter.continuityStateJson)
  const title = chapter.title?.trim() || `第${chapter.chapterNum}章`
  const chapterGoal = chapter.summary?.trim() || title
  const plotProgress = continuity.plotProgress.length > 0 ? continuity.plotProgress : [chapterGoal]
  const characterChanges = continuity.characterStateChanges
  const worldChanges = continuity.worldStateChanges
  const openLoops = continuity.openLoops
  const continuityNotes = continuity.continuityNotes
  const nextSeed = chapter.nextChapterSeed?.trim() || continuityNotes[0] || ''

  return [
    `本章目标：${chapterGoal}`,
    '',
    '核心推进：',
    ...plotProgress.slice(0, 4).map((item) => `- ${item}`),
    '',
    characterChanges.length > 0 ? '人物变化：' : '',
    ...characterChanges.slice(0, 4).map((item) => `- ${item}`),
    '',
    worldChanges.length > 0 ? '世界变化：' : '',
    ...worldChanges.slice(0, 3).map((item) => `- ${item}`),
    '',
    openLoops.length > 0 ? '待回收：' : '',
    ...openLoops.slice(0, 4).map((item) => `- ${item}`),
    '',
    continuity.arcProgress ? `弧线推进：${continuity.arcProgress}` : '',
    nextSeed ? `下章引子：${nextSeed}` : '',
  ].filter(Boolean).join('\n')
}

function renumberNovelChapters(novelId: number): void {
  const db = getDb()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .all()

  if (chapterRows.length === 0) return
  // 统一使用章节服务的事务与完整引用重映射，避免这里只修 storyArc/thread
  // 而遗漏人物首次出现、词条、记忆检查点和对白指纹等章节号引用。
  chapterService.batchRenumberChapters(chapterRows.map((chapter) => chapter.id), 1)
}

async function repairChapterTask(task: typeof revisionTasks.$inferSelect): Promise<void> {
  const chapterId = typeof task.chapterId === 'number'
    ? task.chapterId
    : typeof task.entityId === 'number'
      ? task.entityId
      : null
  if (!chapterId) throwUserFacingError('revision.chapterIdMissing')

  const current = chapterService.getChapter(chapterId)
  if (!current) throwUserFacingError('chapter.notFound')
  const originMeta = parseOriginMeta(task.originMetaJson)

  if (originMeta.issueCategory === 'chapter_gate' && originMeta.rewritePlan) {
    const rewritePlan = originMeta.rewritePlan
    const recheckItems = originMeta.recheckItems && originMeta.recheckItems.length > 0
      ? originMeta.recheckItems
      : rewritePlan.recheckItems
    const maxRewriteAttempts = Math.max(1, originMeta.maxRewriteAttempts || 2)
    const rewriteAttempts = Math.max(0, originMeta.rewriteAttempts || 0)

    if (rewritePlan.scope === 'contract_replan') {
      updateOriginMeta(task.id, (meta) => ({
        ...meta,
        autoFixable: false,
      }))
      throwUserFacingError('revision.chapterGateManualOnly')
    }

    if (rewriteAttempts >= maxRewriteAttempts) {
      updateOriginMeta(task.id, (meta) => ({
        ...meta,
        autoFixable: false,
      }))
      throwUserFacingError('revision.chapterGateRewriteFailedMax', { count: rewriteAttempts })
    }

    updateOriginMeta(task.id, (meta) => ({
      ...meta,
      rewriteAttempts: rewriteAttempts + 1,
      maxRewriteAttempts,
      lastRecheckAt: new Date().toISOString(),
      lastRecheckFailedItems: [],
    }))

    try {
      await chapterService.generateChapterContent(chapterId)
      const publishCheck = runChapterPublishCheck(chapterId)
      const failedItems = publishCheck.checklist
        .filter((item) => recheckItems.includes(item.key))
        .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
        .map((item) => item.label)

      updateOriginMeta(task.id, (meta) => ({
        ...meta,
        lastRecheckAt: new Date().toISOString(),
        lastRecheckGateLevel: publishCheck.gateLevel,
        lastRecheckFailedItems: failedItems,
        autoFixable: failedItems.length > 0 && rewriteAttempts + 1 >= maxRewriteAttempts
          ? false
          : meta.autoFixable,
      }))

      if (failedItems.length > 0) {
        if (rewriteAttempts + 1 >= maxRewriteAttempts) {
          throwUserFacingError('revision.chapterGateRewriteStillFailingManual', { items: failedItems.join('、') })
        }
        throwUserFacingError('revision.chapterGateRewriteStillFailing', { items: failedItems.join('、') })
      }

      return
    } catch (error) {
      const message = error instanceof Error ? error.message : '章节门自动重写失败。'
      let failedItems: string[] = originMeta.lastRecheckFailedItems || []
      let gateLevel: ChapterGateLevel | undefined

      try {
        const publishCheck = runChapterPublishCheck(chapterId)
        failedItems = publishCheck.checklist
          .filter((item) => recheckItems.includes(item.key))
          .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
          .map((item) => item.label)
        gateLevel = publishCheck.gateLevel
      } catch {
        // ignore secondary gate read failure
      }

      updateOriginMeta(task.id, (meta) => ({
        ...meta,
        lastRecheckAt: new Date().toISOString(),
        lastRecheckGateLevel: gateLevel || meta.lastRecheckGateLevel,
        lastRecheckFailedItems: failedItems,
        autoFixable: rewriteAttempts + 1 >= maxRewriteAttempts ? false : meta.autoFixable,
      }))

      if (rewriteAttempts + 1 >= maxRewriteAttempts) {
        throwUserFacingError('revision.chapterGateRewriteMaxReached', { message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  const title = task.title || ''
  const needsMemoryRefresh =
    task.taskType === 'continuity'
    || title === '章节缺少摘要'
    || title === '章节缺少连续性记忆'
    || title.includes('需要同步上下文')

  if (needsMemoryRefresh) {
    await chapterService.generateChapterSummary(chapterId)
  }

  if (title === '已写章节缺少细纲') {
    const refreshed = chapterService.getChapter(chapterId)
    if (!refreshed) return
    if (!refreshed.summary?.trim() || !refreshed.continuityStateJson?.trim()) {
      await chapterService.generateChapterSummary(chapterId)
    }
    const latest = chapterService.getChapter(chapterId)
    if (!latest) return
    const outline = buildFallbackChapterOutline(latest)
    chapterService.updateChapter(chapterId, {
      title: latest.title?.trim() || `第${latest.chapterNum}章`,
      outline,
    })
  }

  if (title === '章节编号重复' || title === '章节编号出现断档') {
    renumberNovelChapters(current.novelId)
  }
}

function repairMapTask(task: typeof revisionTasks.$inferSelect): void {
  const entityId = typeof task.entityId === 'number' ? task.entityId : null
  if (!entityId) throwUserFacingError('revision.mapEntityIdMissing')

  const node = mapService.getMapNode(entityId)
  if (!node) throwUserFacingError('map.nodeNotFound')

  const db = getDb()
  const parent = typeof node.parentId === 'number'
    ? db.select().from(worldMap).where(eq(worldMap.id, node.parentId)).all()[0]
    : null

  mapService.updateMapItem(entityId, {
    parentId: parent?.id ?? null,
    level: parent ? Math.max(2, (parent.level || 1) + 1) : 1,
    parentRuleType: parent ? (parent.nodeType || parent.locationType || '') : '',
  })
}

function repairOutlineTask(task: typeof revisionTasks.$inferSelect): void {
  const entityId = typeof task.entityId === 'number' ? task.entityId : null
  if (!entityId) throwUserFacingError('revision.arcIdMissing')

  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, entityId)).all()[0]
  if (!arc) throwUserFacingError('storyArc.notFound')

  const title = task.title || ''
  if (title === '故事弧章位反转') {
    const nextStart = typeof arc.chapterEnd === 'number' ? arc.chapterEnd : arc.chapterStart
    const nextEnd = typeof arc.chapterStart === 'number' ? arc.chapterStart : arc.chapterEnd
    db.update(storyArcs).set({
      chapterStart: nextStart ?? null,
      chapterEnd: nextEnd ?? null,
    }).where(eq(storyArcs.id, arc.id)).run()
    markNovelContextChanged(arc.novelId, 'Story outline changed')
    return
  }

  if (title === '故事弧范围重叠') {
    const arcRows = db.select().from(storyArcs)
      .where(eq(storyArcs.novelId, arc.novelId))
      .orderBy(asc(storyArcs.chapterStart), asc(storyArcs.arcOrder), asc(storyArcs.id))
      .all()
    const index = arcRows.findIndex((row) => row.id === arc.id)
    const previous = index > 0 ? arcRows[index - 1] : null
    const minStart = previous?.chapterEnd ? previous.chapterEnd + 1 : Math.max(1, arc.chapterStart || 1)
    const nextStart = Math.max(1, minStart)
    const nextEnd = typeof arc.chapterEnd === 'number' && arc.chapterEnd >= nextStart
      ? arc.chapterEnd
      : nextStart
    db.update(storyArcs).set({
      chapterStart: nextStart,
      chapterEnd: nextEnd,
    }).where(eq(storyArcs.id, arc.id)).run()
    markNovelContextChanged(arc.novelId, 'Story outline changed')
  }
}

function mapRevisionTask(row: typeof revisionTasks.$inferSelect): RevisionTask {
  const taskSource = normalizeTaskSource(row.taskSource)
  const originMeta = parseOriginMeta(row.originMetaJson)
  return {
    id: row.id,
    novelId: row.novelId,
    taskSource,
    issueKey: row.issueKey || undefined,
    taskType: row.taskType || 'continuity',
    status: normalizeStatus(row.status),
    severity: normalizeSeverity(row.severity),
    title: row.title,
    description: row.description || undefined,
    fixBrief: row.fixBrief || undefined,
    relatedPage: row.relatedPage || undefined,
    entityType: row.entityType || undefined,
    entityId: typeof row.entityId === 'number' ? row.entityId : undefined,
    chapterId: typeof row.chapterId === 'number' ? row.chapterId : undefined,
    originMetaJson: row.originMetaJson || undefined,
    lastDetectedAt: row.lastDetectedAt || undefined,
    resolvedAt: row.resolvedAt || undefined,
    autoFixable: taskSource === 'system'
      ? (typeof originMeta.autoFixable === 'boolean'
          ? originMeta.autoFixable
          : isAutoFixableTask(row.taskType || 'continuity', row.entityType || undefined, row.entityId || undefined, row.title))
      : false,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function buildSystemTaskDrafts(novelId: number): SystemRevisionDraft[] {
  const report = buildNovelConsistencyReport(novelId)
  const contextStatus = getNovelContextStatus(novelId)
  const db = getDb()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const chapterNumById = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))

  const drafts: SystemRevisionDraft[] = report.issues.map((issue) => {
    const chapterId = issue.entityType === 'chapter' && typeof issue.entityId === 'number'
      ? issue.entityId
      : undefined

    return {
      issueKey: buildIssueKey({
        taskType: issue.category,
        entityType: issue.entityType,
        entityId: issue.entityId,
        chapterId,
        title: issue.title,
      }),
      taskType: issue.category,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      fixBrief: issue.suggestion,
      relatedPage: getRelatedPage(issue.category),
      entityType: issue.entityType,
      entityId: issue.entityId,
      chapterId,
      originMeta: {
        issueCategory: issue.category,
        autoFixable: isAutoFixableTask(issue.category, issue.entityType, issue.entityId, issue.title),
        entityLabel: issue.entityLabel,
        suggestion: issue.suggestion,
      },
    }
  })

  contextStatus.staleChapterIds.forEach((chapterId) => {
    const chapterNum = chapterNumById.get(chapterId)
    const title = chapterNum ? `第 ${chapterNum} 章需要同步上下文` : '章节需要同步上下文'
    drafts.push({
      issueKey: buildIssueKey({
        taskType: 'continuity',
        entityType: 'chapter',
        entityId: chapterId,
        chapterId,
        title,
      }),
      taskType: 'continuity',
      severity: 'medium',
      title,
      description: '设定、结构或资产已经变化，当前章节仍在引用旧的上下文快照。',
      fixBrief: '先刷新摘要与连续性记忆，必要时重生成章节或回查场景承接。',
      relatedPage: 'writing',
      entityType: 'chapter',
      entityId: chapterId,
      chapterId,
      originMeta: {
        issueCategory: 'continuity',
        autoFixable: true,
        entityLabel: chapterNum ? `第 ${chapterNum} 章` : undefined,
        suggestion: '先刷新摘要与连续性记忆，必要时重生成章节或回查场景承接。',
      },
    })
  })

  return drafts
}

export function syncSystemRevisionTasks(novelId: number): void {
  const db = getDb()
  const now = new Date().toISOString()
  const drafts = buildSystemTaskDrafts(novelId)
  const existingRows = db.select().from(revisionTasks)
    .where(and(
      eq(revisionTasks.novelId, novelId),
      eq(revisionTasks.taskSource, 'system'),
    ))
    .orderBy(desc(revisionTasks.updatedAt), desc(revisionTasks.id))
    .all()

  const existingByKey = new Map(
    existingRows
      .filter((row) => row.issueKey)
      .map((row) => [row.issueKey as string, row]),
  )
  const activeKeys = new Set<string>()

  drafts.forEach((draft) => {
    activeKeys.add(draft.issueKey)
    const existing = existingByKey.get(draft.issueKey)

    if (!existing) {
      db.insert(revisionTasks).values({
        novelId,
        taskSource: 'system',
        issueKey: draft.issueKey,
        taskType: draft.taskType,
        status: 'open',
        severity: draft.severity,
        title: draft.title,
        description: draft.description || null,
        fixBrief: draft.fixBrief || null,
        relatedPage: draft.relatedPage || null,
        entityType: draft.entityType || null,
        entityId: draft.entityId ?? null,
        chapterId: draft.chapterId ?? null,
        originMetaJson: serializeOriginMeta(draft.originMeta),
        lastDetectedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      return
    }

    const previousStatus = normalizeStatus(existing.status)
    const nextStatus = previousStatus === 'ignored'
      ? 'ignored'
      : previousStatus === 'resolved'
        ? 'open'
        : previousStatus

    db.update(revisionTasks).set({
      taskType: draft.taskType,
      status: nextStatus,
      severity: draft.severity,
      title: draft.title,
      description: draft.description || null,
      fixBrief: draft.fixBrief || null,
      relatedPage: draft.relatedPage || null,
      entityType: draft.entityType || null,
      entityId: draft.entityId ?? null,
      chapterId: draft.chapterId ?? null,
      originMetaJson: serializeOriginMeta({
        ...parseOriginMeta(existing.originMetaJson),
        ...draft.originMeta,
      }),
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
  })

  existingRows
    .filter((row) => row.issueKey && !activeKeys.has(row.issueKey))
    .forEach((row) => {
      const previousStatus = normalizeStatus(row.status)
      if (previousStatus === 'ignored' || previousStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })
}

function listRevisionRows(novelId: number, sync = true) {
  if (sync) syncSystemRevisionTasks(novelId)
  const db = getDb()
  return db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .orderBy(desc(revisionTasks.updatedAt), desc(revisionTasks.id))
    .all()
}

export function listRevisionTasks(novelId: number) {
  return listRevisionRows(novelId).map(mapRevisionTask)
}

export function getRevisionTask(id: number) {
  const db = getDb()
  const row = db.select().from(revisionTasks).where(eq(revisionTasks.id, id)).all()[0]
  return row ? mapRevisionTask(row) : null
}

export function queryRevisionTasks(filters: RevisionTaskQueryFilters) {
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const keyword = asText(filters.keyword).toLowerCase()
  const items = listRevisionRows(filters.novelId)
    .map(mapRevisionTask)
    .filter((task) => !filters.taskSource || task.taskSource === filters.taskSource)
    .filter((task) => !filters.status || task.status === filters.status)
    .filter((task) => !filters.severity || task.severity === filters.severity)
    .filter((task) => !filters.relatedPage || task.relatedPage === filters.relatedPage)
    .filter((task) => !filters.entityType || task.entityType === filters.entityType)
    .filter((task) => filters.entityId === undefined || task.entityId === filters.entityId)
    .filter((task) => {
      if (!keyword) return true
      const haystack = [
        task.title,
        task.description,
        task.fixBrief,
        task.relatedPage,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword)
    })

  return buildPagedResult(
    items.slice(paging.offset, paging.offset + paging.pageSize),
    paging.page,
    paging.pageSize,
    items.length,
  )
}

export function getRevisionTaskStats(filters: RevisionTaskQueryFilters) {
  const items = queryRevisionTasks({
    ...filters,
    page: 1,
    pageSize: 1000,
  }).items

  return items.reduce((result, task) => {
    result.total += 1
    if (task.status === 'open') result.openCount += 1
    if (task.status === 'in_progress') result.inProgressCount += 1
    if (task.status === 'resolved') result.resolvedCount += 1
    if (task.severity === 'high' && task.status !== 'resolved' && task.status !== 'ignored') {
      result.blockerCount += 1
    }
    return result
  }, {
    total: 0,
    openCount: 0,
    inProgressCount: 0,
    resolvedCount: 0,
    blockerCount: 0,
  })
}

export function getRevisionCenterSnapshot(novelId: number) {
  const tasks = listRevisionRows(novelId).map(mapRevisionTask)
  const stats = tasks.reduce((result, task) => {
    result.total += 1
    if (task.status === 'open') result.openCount += 1
    if (task.status === 'in_progress') result.inProgressCount += 1
    if (task.status === 'resolved') result.resolvedCount += 1
    if (task.severity === 'high' && task.status !== 'resolved' && task.status !== 'ignored') {
      result.blockerCount += 1
    }
    return result
  }, {
    total: 0,
    openCount: 0,
    inProgressCount: 0,
    resolvedCount: 0,
    blockerCount: 0,
  })

  return { tasks, stats }
}

export function createRevisionTask(novelId: number, data: Partial<typeof revisionTasks.$inferInsert>) {
  const db = getDb()
  const now = new Date().toISOString()
  const result = db.insert(revisionTasks).values({
    novelId,
    taskSource: 'manual',
    taskType: 'continuity',
    status: 'open',
    severity: 'medium',
    title: data.title || '未命名修订任务',
    createdAt: now,
    updatedAt: now,
    ...sanitizeRevisionTaskPayload(data),
  }).run()
  return Number(result.lastInsertRowid)
}

export function updateRevisionTask(id: number, data: Partial<typeof revisionTasks.$inferInsert>) {
  const db = getDb()
  const current = db.select().from(revisionTasks).where(eq(revisionTasks.id, id)).all()[0]
  if (!current) return

  const now = new Date().toISOString()
  if (normalizeTaskSource(current.taskSource) === 'system') {
    const nextStatus = 'status' in data ? normalizeStatus(data.status) : normalizeStatus(current.status)
    db.update(revisionTasks).set({
      status: nextStatus,
      resolvedAt: nextStatus === 'resolved'
        ? now
        : nextStatus === 'open' || nextStatus === 'in_progress'
          ? null
          : current.resolvedAt,
      updatedAt: now,
    }).where(eq(revisionTasks.id, id)).run()
    return
  }

  db.update(revisionTasks).set({
    ...sanitizeRevisionTaskPayload(data),
    updatedAt: now,
  }).where(eq(revisionTasks.id, id)).run()
}

export function deleteRevisionTask(id: number) {
  const db = getDb()
  const current = db.select().from(revisionTasks).where(eq(revisionTasks.id, id)).all()[0]
  if (!current || normalizeTaskSource(current.taskSource) === 'system') return
  db.delete(revisionTasks).where(eq(revisionTasks.id, id)).run()
}

function updateOriginMeta(taskId: number, updater: (current: RevisionOriginMeta) => RevisionOriginMeta) {
  const db = getDb()
  const current = db.select().from(revisionTasks).where(eq(revisionTasks.id, taskId)).all()[0]
  if (!current) return
  const next = updater(parseOriginMeta(current.originMetaJson))
  db.update(revisionTasks).set({
    originMetaJson: serializeOriginMeta(next),
    updatedAt: new Date().toISOString(),
  }).where(eq(revisionTasks.id, taskId)).run()
}

async function runTaskAutoFix(current: typeof revisionTasks.$inferSelect): Promise<void> {
  const entityType = current.entityType || undefined
  const entityId = typeof current.entityId === 'number' ? current.entityId : undefined

  if (!isAutoFixableTask(current.taskType || 'continuity', entityType, entityId, current.title)) {
    throwUserFacingError('revision.autoFixUnsupported')
  }

  if (entityType === 'character') {
    await characterService.regenerateCharacter(entityId as number)
    return
  }

  if (entityType === 'item') {
    await itemService.regenerateStoryItem(entityId as number, { mode: 'repair' })
    return
  }

  if (entityType === 'timeline') {
    await timelineService.regenerateTimelineEvent(entityId as number, { mode: 'repair' })
    return
  }

  if (entityType === 'thread') {
    await storyThreadService.regenerateStoryThread(entityId as number, { mode: 'repair' })
    return
  }

  if (entityType === 'chapter') {
    await repairChapterTask(current)
    return
  }

  if (entityType === 'map') {
    repairMapTask(current)
    return
  }

  if (entityType === 'arc') {
    repairOutlineTask(current)
  }
}

export async function autoFixRevisionTask(id: number): Promise<RevisionAutoFixResult> {
  const db = getDb()
  const current = db.select().from(revisionTasks).where(eq(revisionTasks.id, id)).all()[0]
  if (!current) {
    return {
      taskId: id,
      novelId: 0,
      status: 'failed',
      message: '修订任务不存在。',
    }
  }

  const relatedPage = current.relatedPage || getRelatedPage(current.taskType || 'revision')
  const entityType = current.entityType || undefined
  const entityId = typeof current.entityId === 'number' ? current.entityId : undefined

  if (normalizeTaskSource(current.taskSource) !== 'system' || !isAutoFixableTask(current.taskType || 'continuity', entityType, entityId, current.title)) {
    return {
      taskId: current.id,
      novelId: current.novelId,
      status: 'unsupported',
      message: '当前问题不支持一键 AI 修复，请前往对应页面处理。',
      relatedPage,
      refreshedTask: mapRevisionTask(current),
    }
  }

  db.update(revisionTasks).set({
    status: 'in_progress',
    resolvedAt: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(revisionTasks.id, current.id)).run()

  try {
    await runTaskAutoFix(current)
    updateOriginMeta(current.id, (meta) => ({ ...meta, lastError: '' }))
    syncSystemRevisionTasks(current.novelId)
    const refreshedTask = getRevisionTask(current.id)
    return {
      taskId: current.id,
      novelId: current.novelId,
      status: 'fixed',
      message: refreshedTask?.status === 'resolved'
        ? 'AI 修复已完成，问题已通过复检。'
        : 'AI 修复已执行，但问题仍需继续处理。',
      relatedPage,
      refreshedTask,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '自动修复失败。'
    db.update(revisionTasks).set({
      status: 'open',
      updatedAt: new Date().toISOString(),
    }).where(eq(revisionTasks.id, current.id)).run()
    updateOriginMeta(current.id, (meta) => ({ ...meta, lastError: message }))
    return {
      taskId: current.id,
      novelId: current.novelId,
      status: 'failed',
      message,
      relatedPage,
      refreshedTask: getRevisionTask(current.id),
    }
  }
}
