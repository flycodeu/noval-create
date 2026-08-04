import { and, asc, desc, eq, not } from 'drizzle-orm'
import {
  chapterGateRuns,
  characters,
  chapters,
  creativeStageAssets,
  creativeStages,
  factions,
  novels,
  storyItems,
  storyThreads,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { getDb, getSqlite } from '../database/db'
import { markNovelContextChanged } from './context-impact.service'
import {
  assessCreativeStageHandoff,
  normalizeCreativeStageHandoffList,
  type CreativeStageHandoffArtifact,
  type CreativeStageHandoffContent,
  type CreativeStageHandoffInput,
  type CreativeStageHandoffPacket,
  type CreativeStageHandoffReviewContent,
} from '../../src/shared/creative-stages'
import { createArtifact, listArtifacts, requireArtifact, updateArtifactLifecycle } from './artifact.service'
import {
  buildCreativeStagePromptSummary,
  buildCreativeStageQualitySnapshot,
  assessCreativeStageContext,
  buildCreativeStageContextPacket,
  creativeStageAssetKey,
  getCreativeStageContextGenerationBlockers,
  clampChapterRange,
  formatCreativeStageRange,
  type CreativeStage,
  type CreativeStageAssetBinding,
  type CreativeStageAssetInput,
  type CreativeStageCreateInput,
  type CreativeStageContext,
  type CreativeStageGateLevel,
  type CreativeStageHandoffStatus,
  type CreativeStageStatus,
} from '../../src/shared/creative-stages'
import { throwUserFacingError } from '../utils/user-facing-error'
import { resolveCreativeStageAssetBriefs, selectCreativeStageAssetBindings } from './creative-stage-retrieval.service'
import { safeParseChapterGateScoreBreakdown } from './chapter-gate-utils'

function asText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalId(value?: number | null): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function normalizeStageGateLevel(value?: string | null): CreativeStageGateLevel | undefined {
  return value === 'pass' || value === 'warning' || value === 'blocker' || value === 'rewrite' ? value : undefined
}

function parseStageGateIssueKeys(value?: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8)
      : []
  } catch {
    return []
  }
}

function stageView(row: typeof creativeStages.$inferSelect, counts: { active: number; planned: number; core: number }): CreativeStage {
  return {
    id: row.id,
    novelId: row.novelId,
    sequence: row.sequence || 0,
    name: row.name,
    kind: (row.kind || 'chapter-window') as CreativeStage['kind'],
    status: (row.status || 'planned') as CreativeStageStatus,
    chapterStart: row.chapterStart ?? undefined,
    chapterEnd: row.chapterEnd ?? undefined,
    volumeId: row.volumeId ?? undefined,
    partId: row.partId ?? undefined,
    objective: row.objective || '',
    storySummary: row.storySummary || '',
    handoffSummary: row.handoffSummary || '',
    constraintsJson: row.constraintsJson || undefined,
    contextVersion: row.contextVersion || 1,
    activeAssetCount: counts.active,
    plannedAssetCount: counts.planned,
    coreAssetCount: counts.core,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function assetView(row: typeof creativeStageAssets.$inferSelect): CreativeStageAssetBinding {
  return {
    id: row.id,
    novelId: row.novelId,
    stageId: row.stageId,
    assetType: row.assetType as CreativeStageAssetBinding['assetType'],
    assetId: row.assetId ?? undefined,
    placeholderName: row.placeholderName || undefined,
    role: (row.role || 'supporting') as CreativeStageAssetBinding['role'],
    detailLevel: (row.detailLevel || 'outline') as CreativeStageAssetBinding['detailLevel'],
    status: (row.status || 'planned') as CreativeStageAssetBinding['status'],
    requestedFieldsJson: row.requestedFieldsJson || undefined,
    notes: row.notes || undefined,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function getStageRow(stageId: number) {
  const row = getDb().select().from(creativeStages).where(eq(creativeStages.id, stageId)).all()[0]
  if (!row) throwUserFacingError('creativeStage.notFound')
  return row
}

function getStageCounts(stageId: number) {
  const rows = getDb().select().from(creativeStageAssets).where(eq(creativeStageAssets.stageId, stageId)).all()
  return {
    active: rows.filter((row) => ['active', 'draft'].includes(row.status || '')).length,
    planned: rows.filter((row) => ['planned', 'deferred'].includes(row.status || '')).length,
    core: rows.filter((row) => row.role === 'core').length,
  }
}

function markStageContextChanged(stageId: number, novelId: number, reason: string): number {
  const nextVersion = markNovelContextChanged(novelId, reason)
  getDb().update(creativeStages)
    .set({ contextVersion: nextVersion, updatedAt: new Date().toISOString() })
    .where(eq(creativeStages.id, stageId))
    .run()
  return nextVersion
}

function assertStageAssetBelongsToNovel(
  novelId: number,
  assetType: CreativeStageAssetBinding['assetType'],
  assetId: number | null,
): void {
  if (!assetId) return
  const db = getDb()
  if (assetType === 'character') {
    const exists = db.select({ id: characters.id }).from(characters)
      .where(and(eq(characters.id, assetId), eq(characters.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'map') {
    const exists = db.select({ id: worldMap.id }).from(worldMap)
      .where(and(eq(worldMap.id, assetId), eq(worldMap.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'faction') {
    const exists = db.select({ id: factions.id }).from(factions)
      .where(and(eq(factions.id, assetId), eq(factions.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'item') {
    const exists = db.select({ id: storyItems.id }).from(storyItems)
      .where(and(eq(storyItems.id, assetId), eq(storyItems.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'thread') {
    const exists = db.select({ id: storyThreads.id }).from(storyThreads)
      .where(and(eq(storyThreads.id, assetId), eq(storyThreads.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'timeline') {
    const exists = db.select({ id: timelineEvents.id }).from(timelineEvents)
      .where(and(eq(timelineEvents.id, assetId), eq(timelineEvents.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'outline') {
    const exists = db.select({ id: chapters.id }).from(chapters)
      .where(and(eq(chapters.id, assetId), eq(chapters.novelId, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
  if (assetType === 'world') {
    const exists = db.select({ id: novels.id }).from(novels)
      .where(and(eq(novels.id, assetId), eq(novels.id, novelId))).all()[0]
    if (!exists) throwUserFacingError('creativeStage.assetNotFound')
  }
}

function getHandoffContent(artifact: CreativeStageHandoffArtifact): CreativeStageHandoffContent {
  return artifact.content
}

function assertHandoffBelongsToStage(artifact: CreativeStageHandoffArtifact, stage: typeof creativeStages.$inferSelect): void {
  if (artifact.novelId !== stage.novelId || getHandoffContent(artifact).stageId !== stage.id) {
    throwUserFacingError('creativeStage.handoffNotFound')
  }
}

function toHandoffPacket(artifact: CreativeStageHandoffArtifact): CreativeStageHandoffPacket {
  return {
    artifactId: artifact.id,
    status: 'approved',
    version: artifact.version,
    contextVersion: artifact.contextVersion,
    content: getHandoffContent(artifact),
  }
}

export function resolveCreativeStageHandoffStatus(input: {
  hasCurrentApprovedHandoff: boolean
  latestApprovedContextVersion?: number
  projectContextVersion: number
  latestArtifactStatus?: CreativeStageHandoffStatus
  hasLegacyHandoff: boolean
}): CreativeStageHandoffStatus {
  if (input.hasCurrentApprovedHandoff) return 'approved'
  if (
    input.latestApprovedContextVersion !== undefined
    && input.latestApprovedContextVersion !== input.projectContextVersion
  ) return 'stale'
  return input.latestArtifactStatus || (input.hasLegacyHandoff ? 'legacy' : 'missing')
}

export function listCreativeStageHandoffs(novelId: number, stageId: number): CreativeStageHandoffArtifact[] {
  const stage = getStageRow(stageId)
  if (stage.novelId !== novelId) throwUserFacingError('creativeStage.notFound')
  return listArtifacts({ novelId, kind: 'creative_stage_handoff', limit: 200 })
    .filter((artifact): artifact is CreativeStageHandoffArtifact => (
      typeof artifact.content === 'object'
      && artifact.content !== null
      && Number((artifact.content as { stageId?: unknown }).stageId) === stageId
    ))
}

export function createCreativeStageHandoff(input: CreativeStageHandoffInput): CreativeStageHandoffArtifact {
  const stage = getStageRow(input.stageId)
  const novel = getDb().select().from(novels).where(eq(novels.id, stage.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const content: CreativeStageHandoffContent = {
    schemaVersion: 'creative-stage-handoff-v1',
    stageId: stage.id,
    stageName: stage.name,
    chapterRange: formatCreativeStageRange({
      chapterStart: stage.chapterStart ?? undefined,
      chapterEnd: stage.chapterEnd ?? undefined,
    }),
    changes: normalizeCreativeStageHandoffList(input.changes),
    costs: normalizeCreativeStageHandoffList(input.costs),
    openQuestions: normalizeCreativeStageHandoffList(input.openQuestions),
    nextPressure: asText(input.nextPressure),
    assetContinuity: (input.assetContinuity || [])
      .filter((item) => item && asText(item.name))
      .slice(0, 30)
      .map((item) => ({
        assetType: item.assetType,
        name: asText(item.name),
        change: item.change,
        note: asText(item.note),
      })),
  }
  return createArtifact({
    novelId: stage.novelId,
    kind: 'creative_stage_handoff',
    status: 'draft',
    parentArtifactId: input.parentArtifactId || null,
    content,
    contextVersion: novel.contextVersion || 1,
    producerType: input.producerType || 'human',
    producerId: input.producerId || 'stage-planner',
    producerClient: input.producerClient || 'novelforge-stage-planner',
    modelConfigId: input.modelConfigId,
    taskId: input.taskId,
    idempotencyKey: input.idempotencyKey || undefined,
  }) as CreativeStageHandoffArtifact
}

export function reviewCreativeStageHandoff(artifactId: string): {
  handoff: CreativeStageHandoffArtifact
  review: ReturnType<typeof requireArtifact<CreativeStageHandoffReviewContent>>
} {
  const handoff = requireArtifact<CreativeStageHandoffContent>(artifactId) as CreativeStageHandoffArtifact
  if (handoff.kind !== 'creative_stage_handoff') throwUserFacingError('creativeStage.handoffNotFound')
  const stage = getStageRow(handoff.content.stageId)
  assertHandoffBelongsToStage(handoff, stage)
  const assessment = assessCreativeStageHandoff(handoff.content)
  return getSqlite().transaction(() => {
    const review = createArtifact<CreativeStageHandoffReviewContent>({
      novelId: handoff.novelId,
      kind: 'creative_stage_handoff_review',
      status: assessment.hardBlockers.length > 0 ? 'rejected' : 'reviewed',
      parentArtifactId: handoff.id,
      content: {
        schemaVersion: 'creative-stage-handoff-review-v1',
        sourceArtifactId: handoff.id,
        status: assessment.hardBlockers.length > 0 ? 'blocked' : 'pass',
        hardBlockers: assessment.hardBlockers,
        warnings: assessment.warnings,
        checkedAt: new Date().toISOString(),
      },
      contextVersion: handoff.contextVersion,
      producerType: 'system',
      producerId: 'creative-stage-handoff-reviewer-v1',
      producerClient: 'novelforge-stage-planner',
    })
    const updated = updateArtifactLifecycle(handoff.id, {
      status: assessment.hardBlockers.length > 0 ? 'rejected' : 'reviewed',
      reviewArtifactId: review.id,
    }) as CreativeStageHandoffArtifact
    return { handoff: updated, review }
  })()
}

export function approveCreativeStageHandoff(artifactId: string): CreativeStageHandoffArtifact {
  const handoff = requireArtifact<CreativeStageHandoffContent>(artifactId) as CreativeStageHandoffArtifact
  if (handoff.kind !== 'creative_stage_handoff') throwUserFacingError('creativeStage.handoffNotFound')
  if (handoff.status !== 'reviewed') throwUserFacingError('creativeStage.handoffReviewRequired')
  const stage = getStageRow(handoff.content.stageId)
  assertHandoffBelongsToStage(handoff, stage)
  const novel = getDb().select().from(novels).where(eq(novels.id, stage.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  if (handoff.contextVersion !== (novel.contextVersion || 1)) {
    throwUserFacingError('creativeStage.handoffContextStale', {
      artifactVersion: handoff.contextVersion,
      currentVersion: novel.contextVersion || 1,
    })
  }
  return getSqlite().transaction(() => {
    listCreativeStageHandoffs(stage.novelId, stage.id)
      .filter((item) => item.id !== handoff.id && item.status === 'approved')
      .forEach((item) => updateArtifactLifecycle(item.id, { status: 'superseded' }))
    const approved = updateArtifactLifecycle(handoff.id, { status: 'approved' }) as CreativeStageHandoffArtifact
    getDb().update(creativeStages)
      .set({ contextVersion: novel.contextVersion || 1, updatedAt: new Date().toISOString() })
      .where(eq(creativeStages.id, stage.id))
      .run()
    return approved
  })()
}

/**
 * A caller that explicitly pins a generation to a stage must not silently use
 * a stale or incomplete stage snapshot. Calls without stageId keep the legacy
 * auto-resolution path and are intentionally not blocked here.
 */
export function assertCreativeStageContextReadyForGeneration(context: CreativeStageContext): void {
  if (context.health.status === 'ready') return
  const details = getCreativeStageContextGenerationBlockers(context.health)
  throwUserFacingError('creativeStage.contextNotReady', {
    detail: details.join('；') || '请先在阶段计划中确认当前窗口。',
  })
}

export function listCreativeStages(novelId: number, includeArchived = false): CreativeStage[] {
  const rows = getDb().select().from(creativeStages)
    .where(includeArchived ? eq(creativeStages.novelId, novelId) : and(eq(creativeStages.novelId, novelId), not(eq(creativeStages.status, 'archived'))))
    .orderBy(asc(creativeStages.sequence), asc(creativeStages.id))
    .all()
  return rows.map((row) => stageView(row, getStageCounts(row.id)))
}

export function getCreativeStage(stageId: number): CreativeStage | null {
  const row = getDb().select().from(creativeStages).where(eq(creativeStages.id, stageId)).all()[0]
  return row ? stageView(row, getStageCounts(row.id)) : null
}

export function createCreativeStage(novelId: number, input: CreativeStageCreateInput): CreativeStage {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const name = asText(input.name)
  if (!name) throwUserFacingError('creativeStage.nameRequired')
  const last = db.select({ sequence: creativeStages.sequence }).from(creativeStages)
    .where(eq(creativeStages.novelId, novelId))
    .orderBy(desc(creativeStages.sequence), desc(creativeStages.id)).all()[0]
  const range = clampChapterRange(input.chapterStart, input.chapterEnd)
  const now = new Date().toISOString()
  const result = db.insert(creativeStages).values({
    novelId,
    sequence: (last?.sequence || 0) + 1,
    name,
    kind: input.kind || 'chapter-window',
    status: input.status || 'planned',
    chapterStart: range.chapterStart ?? null,
    chapterEnd: range.chapterEnd ?? null,
    volumeId: asOptionalId(input.volumeId),
    partId: asOptionalId(input.partId),
    objective: asText(input.objective),
    storySummary: asText(input.storySummary),
    handoffSummary: asText(input.handoffSummary),
    constraintsJson: asText(input.constraintsJson) || null,
    contextVersion: novel.contextVersion || 1,
    createdAt: now,
    updatedAt: now,
  }).run()
  markStageContextChanged(Number(result.lastInsertRowid), novelId, 'Creative stage created')
  return getCreativeStage(Number(result.lastInsertRowid)) as CreativeStage
}

export function updateCreativeStage(input: { id: number } & Partial<CreativeStageCreateInput>): CreativeStage {
  const db = getDb()
  const current = getStageRow(input.id)
  const range = clampChapterRange(input.chapterStart ?? current.chapterStart ?? undefined, input.chapterEnd ?? current.chapterEnd ?? undefined)
  const patch: Partial<typeof creativeStages.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  }
  if (input.name !== undefined) patch.name = asText(input.name) || current.name
  if (input.kind !== undefined) patch.kind = input.kind
  if (input.status !== undefined) patch.status = input.status
  if (input.chapterStart !== undefined || input.chapterEnd !== undefined) {
    patch.chapterStart = range.chapterStart ?? null
    patch.chapterEnd = range.chapterEnd ?? null
  }
  if (input.volumeId !== undefined) patch.volumeId = asOptionalId(input.volumeId)
  if (input.partId !== undefined) patch.partId = asOptionalId(input.partId)
  if (input.objective !== undefined) patch.objective = asText(input.objective)
  if (input.storySummary !== undefined) patch.storySummary = asText(input.storySummary)
  if (input.handoffSummary !== undefined) patch.handoffSummary = asText(input.handoffSummary)
  if (input.constraintsJson !== undefined) patch.constraintsJson = asText(input.constraintsJson) || null
  db.update(creativeStages).set(patch).where(eq(creativeStages.id, input.id)).run()
  markStageContextChanged(current.id, current.novelId, 'Creative stage updated')
  return getCreativeStage(input.id) as CreativeStage
}

export function archiveCreativeStage(stageId: number): CreativeStage {
  return updateCreativeStage({ id: stageId, status: 'archived' })
}

export function listCreativeStageAssets(stageId: number): CreativeStageAssetBinding[] {
  getStageRow(stageId)
  return getDb().select().from(creativeStageAssets)
    .where(eq(creativeStageAssets.stageId, stageId))
    .orderBy(asc(creativeStageAssets.role), asc(creativeStageAssets.assetType), asc(creativeStageAssets.id))
    .all()
    .map(assetView)
}

export function upsertCreativeStageAsset(input: CreativeStageAssetInput): CreativeStageAssetBinding {
  const db = getDb()
  const stage = getStageRow(input.stageId)
  const now = new Date().toISOString()
  const values = {
    novelId: stage.novelId,
    stageId: stage.id,
    assetType: input.assetType,
    assetId: asOptionalId(input.assetId),
    placeholderName: asText(input.placeholderName) || null,
    role: input.role || 'supporting',
    detailLevel: input.detailLevel || 'outline',
    status: input.status || 'planned',
    requestedFieldsJson: asText(input.requestedFieldsJson) || null,
    notes: asText(input.notes) || null,
    updatedAt: now,
  }
  assertStageAssetBelongsToNovel(stage.novelId, input.assetType, values.assetId)
  if (values.assetId) {
    const existing = db.select().from(creativeStageAssets)
      .where(and(
        eq(creativeStageAssets.stageId, stage.id),
        eq(creativeStageAssets.assetType, input.assetType),
        eq(creativeStageAssets.assetId, values.assetId),
      ))
      .all()[0]
    if (existing) {
      db.update(creativeStageAssets).set(values).where(eq(creativeStageAssets.id, existing.id)).run()
      markStageContextChanged(stage.id, stage.novelId, 'Creative stage asset updated')
      return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, existing.id)).all()[0])
    }
  } else if (values.placeholderName) {
    const existing = db.select().from(creativeStageAssets)
      .where(and(
        eq(creativeStageAssets.stageId, stage.id),
        eq(creativeStageAssets.assetType, input.assetType),
        eq(creativeStageAssets.placeholderName, values.placeholderName),
      ))
      .all()[0]
    if (existing) {
      db.update(creativeStageAssets).set(values).where(eq(creativeStageAssets.id, existing.id)).run()
      markStageContextChanged(stage.id, stage.novelId, 'Creative stage asset updated')
      return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, existing.id)).all()[0])
    }
  }
  if (input.id) {
    const current = db.select().from(creativeStageAssets).where(and(eq(creativeStageAssets.id, input.id), eq(creativeStageAssets.stageId, stage.id))).all()[0]
    if (!current) throwUserFacingError('creativeStage.assetNotFound')
    db.update(creativeStageAssets).set(values).where(eq(creativeStageAssets.id, input.id)).run()
    markStageContextChanged(stage.id, stage.novelId, 'Creative stage asset updated')
    return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, input.id)).all()[0])
  }
  const result = db.insert(creativeStageAssets).values({ ...values, createdAt: now }).run()
  markStageContextChanged(stage.id, stage.novelId, 'Creative stage asset bound')
  return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, Number(result.lastInsertRowid))).all()[0])
}

export function removeCreativeStageAsset(assetId: number): void {
  const db = getDb()
  const current = db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, assetId)).all()[0]
  if (!current) return
  db.delete(creativeStageAssets).where(eq(creativeStageAssets.id, assetId)).run()
  markStageContextChanged(current.stageId, current.novelId, 'Creative stage asset unbound')
}

export function getCreativeStageContext(novelId: number, stageId: number, chapterNum?: number): CreativeStageContext {
  const stage = getStageRow(stageId)
  if (stage.novelId !== novelId) throwUserFacingError('creativeStage.notFound')
  const novel = getDb().select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const view = stageView(stage, getStageCounts(stage.id))
  const assets = listCreativeStageAssets(stage.id)
  const assetBriefs = resolveCreativeStageAssetBriefs(novelId, assets)
  const chapter = typeof chapterNum === 'number'
    ? getDb().select().from(chapters).where(and(eq(chapters.novelId, novelId), eq(chapters.chapterNum, chapterNum))).all()[0]
    : undefined
  const chapterSignal = chapterNum === undefined
    ? undefined
    : [
        view.name,
        view.objective,
        view.storySummary,
        chapter?.title,
        chapter?.outline,
        chapter?.scenePlanJson,
      ].filter(Boolean).join('\n')
  const promptAssets = selectCreativeStageAssetBindings(assets, assetBriefs, chapterSignal)
  const promptAssetKeys = new Set(promptAssets.map((asset) => creativeStageAssetKey(asset)))
  const promptAssetBriefs = assetBriefs.filter((brief) => promptAssetKeys.has(creativeStageAssetKey(brief)))
  const handoffs = listCreativeStageHandoffs(novelId, stageId)
  const latestArtifact = handoffs[0]
  const latestApproved = handoffs.find((artifact) => artifact.status === 'approved')
  const projectContextVersion = novel.contextVersion || 1
  const approvedHandoff = latestApproved && latestApproved.contextVersion === projectContextVersion
    ? toHandoffPacket(latestApproved)
    : undefined
  const handoffStatus = resolveCreativeStageHandoffStatus({
    hasCurrentApprovedHandoff: Boolean(approvedHandoff),
    latestApprovedContextVersion: latestApproved?.contextVersion,
    projectContextVersion,
    latestArtifactStatus: latestArtifact?.status,
    hasLegacyHandoff: Boolean(view.handoffSummary),
  })
  const health = assessCreativeStageContext(
    { ...view, handoffSummary: approvedHandoff ? '结构化交接已确认' : view.handoffSummary },
    promptAssets.length,
    projectContextVersion,
    latestApproved?.contextVersion,
  )
  if (latestArtifact && latestArtifact.status !== 'approved') {
    health.warnings.push(`阶段存在${latestArtifact.status === 'reviewed' ? '待作者确认' : '未审阅'}的交接工件，当前不会进入正文召回。`)
  }
  const stageChapters = getDb().select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()
    .filter((chapter) => stageContainsChapter(view, chapter.chapterNum))
  const stageChapterIds = new Set(stageChapters.map((chapter) => chapter.id))
  const latestGateByChapterId = new Map<number, typeof chapterGateRuns.$inferSelect>()
  getDb().select().from(chapterGateRuns)
    .where(eq(chapterGateRuns.novelId, novelId))
    .all()
    .filter((row) => stageChapterIds.has(row.chapterId))
    .sort((left, right) => right.id - left.id)
    .forEach((row) => {
      if (!latestGateByChapterId.has(row.chapterId)) latestGateByChapterId.set(row.chapterId, row)
    })
  const stageEnd = view.chapterEnd
  const quality = buildCreativeStageQualitySnapshot(
    stageChapters.map((chapter) => {
      const gate = latestGateByChapterId.get(chapter.id)
      const scoreBreakdown = safeParseChapterGateScoreBreakdown(gate?.scoreBreakdownJson)
      return {
        chapterNum: chapter.chapterNum,
        hasContent: Boolean(chapter.content?.trim()),
        hasSummary: Boolean(chapter.summary?.trim()),
        hasContinuity: Boolean(chapter.continuityStateJson?.trim()),
        ...(gate ? {
          gateLevel: normalizeStageGateLevel(gate.gateLevel),
          gateReady: gate.ready === 1,
          gateScore: scoreBreakdown?.totalScore,
          gateBlockerCount: gate.blockerCount || 0,
          gateWarningCount: gate.warningCount || 0,
          gateIssueKeys: parseStageGateIssueKeys(gate.topIssueKeysJson),
        } : {}),
      }
    }),
    {
      handoffRequired: view.status === 'completed'
        || (typeof stageEnd === 'number' && stageChapters.some((chapter) => chapter.chapterNum >= stageEnd && Boolean(chapter.content?.trim()))),
      handoffStatus,
      approvedHandoff: approvedHandoff?.content,
    },
  )
  const packet = buildCreativeStageContextPacket(view, promptAssets, projectContextVersion, approvedHandoff, handoffStatus, promptAssetBriefs)
  return {
    stage: view,
    assets,
    activeCharacterIds: assets
      .filter((asset) => asset.assetType === 'character' && asset.assetId && !['retired', 'deferred'].includes(asset.status))
      .map((asset) => asset.assetId as number),
    activeMapIds: assets
      .filter((asset) => asset.assetType === 'map' && asset.assetId && !['retired', 'deferred'].includes(asset.status))
      .map((asset) => asset.assetId as number),
    promptSummary: buildCreativeStagePromptSummary({ stage: view, assets: promptAssets, handoff: approvedHandoff, assetBriefs: promptAssetBriefs }),
    health,
    quality,
    packet,
  }
}

const STAGE_STATUS_PRIORITY: Record<CreativeStageStatus, number> = {
  active: 0,
  locked: 1,
  planned: 2,
  completed: 3,
  archived: 4,
}

function stageContainsChapter(stage: CreativeStage, chapterNum: number): boolean {
  if (typeof stage.chapterStart === 'number' && chapterNum < stage.chapterStart) return false
  if (typeof stage.chapterEnd === 'number' && chapterNum > stage.chapterEnd) return false
  return true
}

/** Resolve the stage that should own a chapter when the caller did not pin one explicitly. */
export function resolveCreativeStageContextForChapter(
  novelId: number,
  chapterNum: number,
  stageId?: number,
): CreativeStageContext | null {
  if (stageId) return getCreativeStageContext(novelId, stageId, chapterNum)

  const candidates = listCreativeStages(novelId)
    .filter((stage) => stageContainsChapter(stage, chapterNum))
    .sort((left, right) => {
      const statusDelta = STAGE_STATUS_PRIORITY[left.status] - STAGE_STATUS_PRIORITY[right.status]
      if (statusDelta !== 0) return statusDelta
      const leftSpan = (left.chapterEnd ?? Number.MAX_SAFE_INTEGER) - (left.chapterStart ?? 1)
      const rightSpan = (right.chapterEnd ?? Number.MAX_SAFE_INTEGER) - (right.chapterStart ?? 1)
      return leftSpan - rightSpan || left.sequence - right.sequence || left.id - right.id
    })

  return candidates[0] ? getCreativeStageContext(novelId, candidates[0].id, chapterNum) : null
}

/** Resolve the active authoring stage for workflows that are not chapter-bound. */
export function resolveActiveCreativeStageContext(novelId: number, stageId?: number): CreativeStageContext | null {
  if (stageId) return getCreativeStageContext(novelId, stageId)
  const stage = listCreativeStages(novelId)
    .sort((left, right) => STAGE_STATUS_PRIORITY[left.status] - STAGE_STATUS_PRIORITY[right.status] || left.sequence - right.sequence)
    .find((item) => item.status !== 'completed')
  return stage ? getCreativeStageContext(novelId, stage.id) : null
}
