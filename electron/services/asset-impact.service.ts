import { desc, eq } from 'drizzle-orm'
import type {
  AssetChangeEvent as AppAssetChangeEvent,
  AssetChangeImpact as AppAssetChangeImpact,
  AssetChangeOperation,
  AssetImpactLevel,
  AssetImpactResolutionStatus,
  AssetImpactSummary,
  AssetImpactTargetType,
} from '../../src/types'
import { getDb } from '../database/db'
import { translateContextChangeReason } from '../../src/shared/context-change-reasons'
import {
  assetChangeEvents,
  assetChangeImpacts,
  chapterContracts,
  chapterWritebackDiffs,
  chapterWritebackRuns,
  chapters,
  characterStateVersions,
  foreshadowLedger,
  revisionTasks,
  sceneContracts,
  storyThreads,
  timelineEvents,
  volumeDesigns,
  worldStateVersions,
} from '../database/schema'

interface AssetChangeEventInput {
  novelId: number
  assetType: string
  assetId?: number | null
  assetLabel?: string | null
  operation?: AssetChangeOperation
  changeReason?: string | null
  impactLevel?: AssetImpactLevel
  triggeredBy?: string | null
  payload?: unknown
}

interface ImpactDraft {
  targetType: AssetImpactTargetType
  targetId?: number | null
  chapterId?: number | null
  targetLabel: string
  impactReason: string
  detail?: string | null
  confidence: number
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function parseJsonArray(raw?: string | null): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseNumberArray(raw?: string | null): number[] {
  return [...new Set(parseJsonArray(raw)
    .map((item) => asNumber(item))
    .filter((item): item is number => typeof item === 'number' && item > 0))]
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function stringifyPayload(value: unknown): string | null {
  if (value === undefined) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function mapEventRow(row: typeof assetChangeEvents.$inferSelect): AppAssetChangeEvent {
  return {
    id: row.id,
    novelId: row.novelId,
    assetType: row.assetType,
    assetId: row.assetId,
    assetLabel: row.assetLabel,
    operation: (row.operation || 'update') as AssetChangeOperation,
    changeReason: row.changeReason,
    impactLevel: (row.impactLevel || 'medium') as AssetImpactLevel,
    triggeredBy: row.triggeredBy,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function mapImpactRow(
  row: typeof assetChangeImpacts.$inferSelect,
  event?: typeof assetChangeEvents.$inferSelect | null,
): AppAssetChangeImpact {
  return {
    id: row.id,
    eventId: row.eventId,
    novelId: row.novelId,
    targetType: row.targetType as AssetImpactTargetType,
    targetId: row.targetId,
    chapterId: row.chapterId,
    targetLabel: row.targetLabel,
    impactReason: row.impactReason,
    detail: row.detail,
    confidence: row.confidence,
    resolutionStatus: (row.resolutionStatus || 'pending') as AssetImpactResolutionStatus,
    relatedTaskId: row.relatedTaskId,
    eventAssetType: event?.assetType,
    eventAssetId: event?.assetId,
    eventAssetLabel: event?.assetLabel,
    eventOperation: event ? (event.operation as AssetChangeOperation) : undefined,
    eventCreatedAt: event?.createdAt || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function buildImpactKey(draft: ImpactDraft): string {
  return [
    draft.targetType,
    draft.targetId || 0,
    draft.chapterId || 0,
    normalizeKey(draft.targetLabel),
  ].join(':')
}

function pushImpact(drafts: Map<string, ImpactDraft>, draft: ImpactDraft) {
  const key = buildImpactKey(draft)
  const existing = drafts.get(key)
  if (!existing || existing.confidence < draft.confidence) {
    drafts.set(key, draft)
  }
}

function buildChapterLabel(chapterMap: Map<number, typeof chapters.$inferSelect>, chapterId?: number | null): string {
  if (!chapterId) return '章节'
  const chapter = chapterMap.get(chapterId)
  return chapter ? `第${chapter.chapterNum}章` : `章节#${chapterId}`
}

function matchesAssetReference(ref: unknown, input: AssetChangeEventInput): boolean {
  const assetId = typeof input.assetId === 'number' ? input.assetId : null
  const assetLabel = asText(input.assetLabel)
  const assetType = normalizeKey(input.assetType)
  if (typeof ref === 'number') return assetId !== null && ref === assetId
  if (typeof ref === 'string') {
    const normalized = normalizeKey(ref)
    return (assetId !== null && normalized.includes(String(assetId)))
      || (assetLabel && normalized.includes(normalizeKey(assetLabel)))
      || normalized.includes(assetType)
  }
  if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return false

  const record = ref as Record<string, unknown>
  const refId = asNumber(record.id ?? record.assetId ?? record.entityId ?? record.refId)
  const refType = normalizeKey(asText(record.type ?? record.assetType ?? record.entityType ?? record.kind))
  const refLabel = normalizeKey(asText(record.label ?? record.assetLabel ?? record.title ?? record.name))
  if (assetId !== null && refId === assetId) {
    return !refType || refType.includes(assetType)
  }
  if (assetLabel && refLabel) {
    return refLabel.includes(normalizeKey(assetLabel))
  }
  return false
}

function inferRelatedPage(targetType: AssetImpactTargetType): string {
  switch (targetType) {
    case 'chapter':
      return 'writing'
    case 'chapter_contract':
    case 'scene_contract':
      return 'contracts'
    case 'thread':
      return 'threads'
    case 'timeline':
      return 'timeline'
    case 'volume_design':
      return 'volume-design'
    default:
      return 'revision'
  }
}

function inferSeverity(level: AssetImpactLevel, confidence: number): 'high' | 'medium' | 'low' {
  if (level === 'high' || confidence >= 0.94) return 'high'
  if (level === 'low' && confidence < 0.8) return 'low'
  return 'medium'
}

function buildTaskTitle(
  event: typeof assetChangeEvents.$inferSelect,
  draft: ImpactDraft,
  chapterMap: Map<number, typeof chapters.$inferSelect>,
): string {
  const assetLabel = event.assetLabel || event.assetType
  const chapterLabel = buildChapterLabel(chapterMap, draft.chapterId)
  switch (draft.targetType) {
    case 'chapter':
      return `${chapterLabel}需要同步 ${assetLabel}`
    case 'chapter_contract':
      return `${chapterLabel}合同需要同步 ${assetLabel}`
    case 'scene_contract':
      return `${chapterLabel}场景合同需要同步 ${assetLabel}`
    case 'timeline':
      return `时间轴需要复核 ${assetLabel}`
    case 'thread':
      return `线程需要同步 ${assetLabel}`
    case 'foreshadow':
      return `伏笔账本需要同步 ${assetLabel}`
    case 'character_state':
      return `人物状态总账需要复核 ${assetLabel}`
    case 'world_state':
      return `世界状态总账需要复核 ${assetLabel}`
    case 'volume_design':
      return `卷设计需要同步 ${assetLabel}`
    default:
      return `需要同步 ${assetLabel}`
  }
}

function upsertImpactTask(
  event: typeof assetChangeEvents.$inferSelect,
  draft: ImpactDraft,
  chapterMap: Map<number, typeof chapters.$inferSelect>,
): number | null {
  const db = getDb()
  const issueKey = `asset-impact:${event.id}:${draft.targetType}:${draft.targetId || 0}:${draft.chapterId || 0}`
  const now = new Date().toISOString()
  const payload = JSON.stringify({
    eventId: event.id,
    assetType: event.assetType,
    assetId: event.assetId,
    assetLabel: event.assetLabel,
    operation: event.operation,
    targetType: draft.targetType,
    targetId: draft.targetId || null,
    chapterId: draft.chapterId || null,
    confidence: draft.confidence,
    impactReason: draft.impactReason,
  })
  const existing = db.select().from(revisionTasks).where(eq(revisionTasks.issueKey, issueKey)).all()[0]
  if (existing) {
    db.update(revisionTasks).set({
      status: existing.status === 'resolved' ? 'open' : existing.status,
      severity: inferSeverity((event.impactLevel || 'medium') as AssetImpactLevel, draft.confidence),
      title: buildTaskTitle(event, draft, chapterMap),
      description: [draft.impactReason, draft.detail || '', event.changeReason || ''].filter(Boolean).join('\n'),
      relatedPage: inferRelatedPage(draft.targetType),
      entityType: draft.targetType,
      entityId: draft.targetId || null,
      chapterId: draft.chapterId || null,
      originMetaJson: payload,
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
    return existing.id
  }

  const insert = db.insert(revisionTasks).values({
    novelId: event.novelId,
    taskSource: 'system',
    taskType: 'continuity',
    status: 'open',
    severity: inferSeverity((event.impactLevel || 'medium') as AssetImpactLevel, draft.confidence),
    title: buildTaskTitle(event, draft, chapterMap),
    description: [draft.impactReason, draft.detail || '', event.changeReason || ''].filter(Boolean).join('\n'),
    fixBrief: '同步受影响的章节、合同或总账，再重新检查上下文和章后回写。',
    relatedPage: inferRelatedPage(draft.targetType),
    entityType: draft.targetType,
    entityId: draft.targetId || null,
    chapterId: draft.chapterId || null,
    issueKey,
    originMetaJson: payload,
    lastDetectedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run()
  return Number(insert.lastInsertRowid)
}

function analyzeImpactDrafts(input: AssetChangeEventInput): ImpactDraft[] {
  const db = getDb()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, input.novelId)).all()
  const chapterMap = new Map(chapterRows.map((row) => [row.id, row] as const))
  const chapterContractRows = db.select().from(chapterContracts).where(eq(chapterContracts.novelId, input.novelId)).all()
  const sceneContractRows = db.select().from(sceneContracts).where(eq(sceneContracts.novelId, input.novelId)).all()
  const threadRows = db.select().from(storyThreads).where(eq(storyThreads.novelId, input.novelId)).all()
  const timelineRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, input.novelId)).all()
  const foreshadowRows = db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, input.novelId)).all()
  const volumeDesignRows = db.select().from(volumeDesigns).where(eq(volumeDesigns.novelId, input.novelId)).all()
  const drafts = new Map<string, ImpactDraft>()
  const assetId = typeof input.assetId === 'number' ? input.assetId : null

  if (input.assetType === 'novel') {
    [...chapterRows]
      .sort((left, right) => right.chapterNum - left.chapterNum)
      .slice(0, 6)
      .forEach((chapter) => {
        pushImpact(drafts, {
          targetType: 'chapter',
          targetId: chapter.id,
          chapterId: chapter.id,
          targetLabel: buildChapterLabel(chapterMap, chapter.id),
          impactReason: '全局设定或文风护栏已调整，最近章节需要优先同步。',
          detail: input.changeReason || null,
          confidence: 0.78,
        })
      })
    volumeDesignRows.forEach((row) => {
      pushImpact(drafts, {
        targetType: 'volume_design',
        targetId: row.id,
        targetLabel: `卷设计#${row.volumeId}`,
        impactReason: '全局设定变化可能影响卷承诺、主冲突和高潮约束。',
        detail: input.changeReason || null,
        confidence: 0.74,
      })
    })
    return [...drafts.values()]
  }

  chapterContractRows.forEach((row) => {
    const chapterLabel = `${buildChapterLabel(chapterMap, row.chapterId)}合同`
    if (input.assetType === 'thread' && assetId !== null && parseNumberArray(row.servedThreadIdsJson).includes(assetId)) {
      pushImpact(drafts, {
        targetType: 'chapter_contract',
        targetId: row.id,
        chapterId: row.chapterId,
        targetLabel: chapterLabel,
        impactReason: '章节合同显式服务该线程，需要同步承接与兑现约束。',
        detail: asText(row.chapterGoal),
        confidence: 0.96,
      })
    }
    if (input.assetType === 'foreshadow' && assetId !== null && parseNumberArray(row.requiredForeshadowIdsJson).includes(assetId)) {
      pushImpact(drafts, {
        targetType: 'chapter_contract',
        targetId: row.id,
        chapterId: row.chapterId,
        targetLabel: chapterLabel,
        impactReason: '章节合同显式依赖该伏笔，需要同步埋设或回收计划。',
        detail: asText(row.chapterGoal),
        confidence: 0.95,
      })
    }
    if (parseJsonArray(row.requiredAssetRefsJson).some((ref) => matchesAssetReference(ref, input))) {
      pushImpact(drafts, {
        targetType: 'chapter_contract',
        targetId: row.id,
        chapterId: row.chapterId,
        targetLabel: chapterLabel,
        impactReason: '章节合同显式引用了已变更资产，需要重新校对本章注入内容。',
        detail: asText(row.chapterGoal),
        confidence: 0.94,
      })
    }
  })

  if (input.assetType === 'foreshadow' && assetId !== null) {
    sceneContractRows.forEach((row) => {
      if (!parseNumberArray(row.requiredForeshadowIdsJson).includes(assetId)) return
      pushImpact(drafts, {
        targetType: 'scene_contract',
        targetId: row.id,
        chapterId: row.chapterId,
        targetLabel: `${buildChapterLabel(chapterMap, row.chapterId)}场景合同`,
        impactReason: '场景合同显式依赖该伏笔，需要同步揭示节奏。',
        detail: asText(row.sceneGoal),
        confidence: 0.95,
      })
    })
  }

  if (assetId !== null) {
    threadRows.forEach((row) => {
      const linked = input.assetType === 'character'
        ? parseNumberArray(row.relatedCharacterIdsJson).includes(assetId)
        : input.assetType === 'item'
          ? parseNumberArray(row.relatedItemIdsJson).includes(assetId)
          : input.assetType === 'timeline'
            ? parseNumberArray(row.relatedTimelineEventIdsJson).includes(assetId)
            : row.id === assetId
      if (!linked) return
      pushImpact(drafts, {
        targetType: 'thread',
        targetId: row.id,
        targetLabel: row.title,
        impactReason: '故事线程与该资产存在显式关联，需要同步当前状态与回收计划。',
        detail: asText(row.currentState || row.summary),
        confidence: input.assetType === 'thread' ? 0.98 : 0.9,
      })
    })

    if (input.assetType === 'thread') {
      foreshadowRows.forEach((row) => {
        if (row.linkedThreadId !== assetId) return
        pushImpact(drafts, {
          targetType: 'foreshadow',
          targetId: row.id,
          chapterId: row.sourceChapterId,
          targetLabel: row.title,
          impactReason: '伏笔账本绑定了该线程，需要同步埋设、到期或回收状态。',
          detail: asText(row.detail),
          confidence: 0.92,
        })
      })
    }

    timelineRows.forEach((row) => {
      const linked = input.assetType === 'character'
        ? parseNumberArray(row.presentCharacterIdsJson).includes(assetId) || parseNumberArray(row.affectedCharacterIdsJson).includes(assetId)
        : input.assetType === 'item'
          ? parseNumberArray(row.linkedItemIdsJson).includes(assetId)
          : input.assetType === 'thread'
            ? parseNumberArray(row.openThreadsJson).includes(assetId)
            : row.id === assetId
      if (!linked) return
      const anchorChapterId = row.chapterEndId || row.chapterStartId || null
      pushImpact(drafts, {
        targetType: 'timeline',
        targetId: row.id,
        chapterId: anchorChapterId,
        targetLabel: row.eventTitle,
        impactReason: '时间轴事件显式引用了该资产，需要同步事件因果与章节锚点。',
        detail: asText(row.eventSummary || row.eventResult),
        confidence: input.assetType === 'timeline' ? 0.98 : 0.91,
      })
      if (anchorChapterId) {
        pushImpact(drafts, {
          targetType: 'chapter',
          targetId: anchorChapterId,
          chapterId: anchorChapterId,
          targetLabel: buildChapterLabel(chapterMap, anchorChapterId),
          impactReason: `时间轴事件“${row.eventTitle}”已受影响，关联章节需要复核承接。`,
          detail: asText(row.eventSummary || row.eventResult),
          confidence: 0.86,
        })
      }
      if (row.volumeId) {
        const volumeDesign = volumeDesignRows.find((item) => item.volumeId === row.volumeId)
        if (volumeDesign) {
          pushImpact(drafts, {
            targetType: 'volume_design',
            targetId: volumeDesign.id,
            targetLabel: `卷设计#${volumeDesign.volumeId}`,
            impactReason: '时间轴关键事件所在卷的冲突与高潮设计可能需要同步。',
            detail: asText(volumeDesign.volumePromise || volumeDesign.mainConflict),
            confidence: 0.82,
          })
        }
      }
    })
  }

  if (input.assetType === 'character' && assetId !== null) {
    db.select().from(characterStateVersions).where(eq(characterStateVersions.novelId, input.novelId)).all()
      .filter((row) => row.characterId === assetId)
      .sort((left, right) => right.chapterNum - left.chapterNum || right.id - left.id)
      .slice(0, 3)
      .forEach((row) => {
        pushImpact(drafts, {
          targetType: 'character_state',
          targetId: row.id,
          chapterId: row.chapterId,
          targetLabel: `${buildChapterLabel(chapterMap, row.chapterId)}人物状态`,
          impactReason: '人物状态总账已有对应章节快照，设定变更后需要复核。',
          detail: asText(row.summaryText || row.changeReason),
          confidence: 0.88,
        })
      })
  }

  if (assetId !== null && ['item', 'timeline', 'thread'].includes(input.assetType)) {
    db.select().from(worldStateVersions).where(eq(worldStateVersions.novelId, input.novelId)).all()
      .filter((row) => normalizeKey(row.entityType) === normalizeKey(input.assetType) && row.entityId === assetId)
      .sort((left, right) => right.chapterNum - left.chapterNum || right.id - left.id)
      .slice(0, 3)
      .forEach((row) => {
        pushImpact(drafts, {
          targetType: 'world_state',
          targetId: row.id,
          chapterId: row.chapterId,
          targetLabel: `${buildChapterLabel(chapterMap, row.chapterId)}世界状态`,
          impactReason: '世界状态总账已有对应快照，资产变更后需要复核。',
          detail: asText(row.summaryText || row.changeReason),
          confidence: 0.86,
        })
      })
  }

  return [...drafts.values()]
}

export function recordAssetChangeEvent(input: AssetChangeEventInput): AppAssetChangeEvent {
  const db = getDb()
  const now = new Date().toISOString()
  const assetLabel = asText(input.assetLabel) || `${input.assetType}#${input.assetId || 'pending'}`
  const insert = db.insert(assetChangeEvents).values({
    novelId: input.novelId,
    assetType: input.assetType,
    assetId: input.assetId ?? null,
    assetLabel,
    operation: input.operation || 'update',
    changeReason: input.changeReason ? translateContextChangeReason(input.changeReason) : null,
    impactLevel: input.impactLevel || 'medium',
    triggeredBy: input.triggeredBy || 'system',
    payloadJson: stringifyPayload(input.payload),
    createdAt: now,
    updatedAt: now,
  }).run()
  const eventId = Number(insert.lastInsertRowid)
  const eventRow = db.select().from(assetChangeEvents).where(eq(assetChangeEvents.id, eventId)).all()[0]
  if (!eventRow) {
    throw new Error('asset change event insert failed')
  }

  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, input.novelId)).all()
  const chapterMap = new Map(chapterRows.map((row) => [row.id, row] as const))
  const impacts = analyzeImpactDrafts(input)
  impacts.forEach((draft) => {
    const taskId = upsertImpactTask(eventRow, draft, chapterMap)
    db.insert(assetChangeImpacts).values({
      eventId,
      novelId: input.novelId,
      targetType: draft.targetType,
      targetId: draft.targetId ?? null,
      chapterId: draft.chapterId ?? null,
      targetLabel: draft.targetLabel,
      impactReason: draft.impactReason,
      detail: draft.detail || null,
      confidence: draft.confidence,
      resolutionStatus: 'pending',
      relatedTaskId: taskId,
      createdAt: now,
      updatedAt: now,
    }).run()
  })

  return mapEventRow(eventRow)
}

export function listAssetChangeEvents(novelId: number): AppAssetChangeEvent[] {
  return getDb().select().from(assetChangeEvents)
    .where(eq(assetChangeEvents.novelId, novelId))
    .orderBy(desc(assetChangeEvents.id))
    .all()
    .map(mapEventRow)
}

export function listActiveImpactsForChapter(novelId: number, chapterId: number): AppAssetChangeImpact[] {
  const db = getDb()
  const rows = db.select().from(assetChangeImpacts)
    .where(eq(assetChangeImpacts.novelId, novelId))
    .orderBy(desc(assetChangeImpacts.id))
    .all()
    .filter((row) => row.chapterId === chapterId)
    .filter((row) => row.resolutionStatus === 'pending' || row.resolutionStatus === 'reviewed')
    .slice(0, 12)
  const eventById = new Map(
    db.select().from(assetChangeEvents).where(eq(assetChangeEvents.novelId, novelId)).all()
      .map((row) => [row.id, row] as const),
  )
  return rows.map((row) => mapImpactRow(row, eventById.get(row.eventId) || null))
}

export function getNovelAssetImpactSummary(novelId: number): AssetImpactSummary {
  const db = getDb()
  const eventRows = db.select().from(assetChangeEvents)
    .where(eq(assetChangeEvents.novelId, novelId))
    .orderBy(desc(assetChangeEvents.id))
    .all()
  const impactRows = db.select().from(assetChangeImpacts)
    .where(eq(assetChangeImpacts.novelId, novelId))
    .orderBy(desc(assetChangeImpacts.id))
    .all()
  const pendingImpacts = impactRows.filter((row) => row.resolutionStatus === 'pending' || row.resolutionStatus === 'reviewed')
  const affectedChapterCount = new Set(
    pendingImpacts
      .map((row) => row.chapterId)
      .filter((value): value is number => typeof value === 'number' && value > 0),
  ).size
  const topImpactLabels = [...new Set(pendingImpacts.map((row) => row.targetLabel).filter(Boolean))].slice(0, 5)
  const runIds = db.select().from(chapterWritebackRuns)
    .where(eq(chapterWritebackRuns.novelId, novelId))
    .all()
    .map((row) => row.id)
  const pendingManualConfirmationCount = runIds.length === 0
    ? 0
    : db.select().from(chapterWritebackDiffs).all()
      .filter((row) => runIds.includes(row.runId))
      .filter((row) => row.writebackStatus !== 'applied')
      .filter((row) => row.canonDecision === 'pending')
      .filter((row) => row.verificationStatus === 'needs_review' || row.verificationStatus === 'conflicted')
      .length

  return {
    novelId,
    totalEventCount: eventRows.length,
    pendingImpactCount: pendingImpacts.length,
    pendingManualConfirmationCount,
    affectedChapterCount,
    latestImpactEventAt: eventRows[0]?.createdAt || null,
    topImpactLabels,
  }
}

export function resolveChapterAssetImpacts(
  novelId: number,
  chapterId: number,
  resolutionStatus: Extract<AssetImpactResolutionStatus, 'reviewed' | 'resolved'> = 'resolved',
): number {
  const db = getDb()
  const now = new Date().toISOString()
  const rows = db.select().from(assetChangeImpacts)
    .where(eq(assetChangeImpacts.novelId, novelId))
    .all()
    .filter((row) => row.chapterId === chapterId)
    .filter((row) => row.resolutionStatus === 'pending' || row.resolutionStatus === 'reviewed')
  rows.forEach((row) => {
    db.update(assetChangeImpacts).set({
      resolutionStatus,
      updatedAt: now,
    }).where(eq(assetChangeImpacts.id, row.id)).run()
    if (row.relatedTaskId) {
      db.update(revisionTasks).set({
        status: resolutionStatus === 'resolved' ? 'resolved' : 'in_progress',
        resolvedAt: resolutionStatus === 'resolved' ? now : null,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.relatedTaskId)).run()
    }
  })
  return rows.length
}
