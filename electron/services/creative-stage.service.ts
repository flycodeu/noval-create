import { and, asc, desc, eq, not } from 'drizzle-orm'
import { creativeStageAssets, creativeStages, novels } from '../database/schema'
import { getDb } from '../database/db'
import { markNovelContextChanged } from './context-impact.service'
import {
  buildCreativeStagePromptSummary,
  clampChapterRange,
  type CreativeStage,
  type CreativeStageAssetBinding,
  type CreativeStageAssetInput,
  type CreativeStageCreateInput,
  type CreativeStageContext,
  type CreativeStageStatus,
} from '../../src/shared/creative-stages'
import { throwUserFacingError } from '../utils/user-facing-error'

function asText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asOptionalId(value?: number | null): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
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
  markNovelContextChanged(novelId, 'Creative stage created')
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
  markNovelContextChanged(current.novelId, 'Creative stage updated')
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
      markNovelContextChanged(stage.novelId, 'Creative stage asset updated')
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
      markNovelContextChanged(stage.novelId, 'Creative stage asset updated')
      return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, existing.id)).all()[0])
    }
  }
  if (input.id) {
    const current = db.select().from(creativeStageAssets).where(and(eq(creativeStageAssets.id, input.id), eq(creativeStageAssets.stageId, stage.id))).all()[0]
    if (!current) throwUserFacingError('creativeStage.assetNotFound')
    db.update(creativeStageAssets).set(values).where(eq(creativeStageAssets.id, input.id)).run()
    markNovelContextChanged(stage.novelId, 'Creative stage asset updated')
    return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, input.id)).all()[0])
  }
  const result = db.insert(creativeStageAssets).values({ ...values, createdAt: now }).run()
  markNovelContextChanged(stage.novelId, 'Creative stage asset bound')
  return assetView(db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, Number(result.lastInsertRowid))).all()[0])
}

export function removeCreativeStageAsset(assetId: number): void {
  const db = getDb()
  const current = db.select().from(creativeStageAssets).where(eq(creativeStageAssets.id, assetId)).all()[0]
  if (!current) return
  db.delete(creativeStageAssets).where(eq(creativeStageAssets.id, assetId)).run()
  markNovelContextChanged(current.novelId, 'Creative stage asset unbound')
}

export function getCreativeStageContext(novelId: number, stageId: number): CreativeStageContext {
  const stage = getStageRow(stageId)
  if (stage.novelId !== novelId) throwUserFacingError('creativeStage.notFound')
  const view = stageView(stage, getStageCounts(stage.id))
  const assets = listCreativeStageAssets(stage.id)
  return {
    stage: view,
    assets,
    activeCharacterIds: assets.filter((asset) => asset.assetType === 'character' && asset.assetId && asset.status !== 'retired').map((asset) => asset.assetId as number),
    activeMapIds: assets.filter((asset) => asset.assetType === 'map' && asset.assetId && asset.status !== 'retired').map((asset) => asset.assetId as number),
    promptSummary: buildCreativeStagePromptSummary({ stage: view, assets }),
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
  if (stageId) return getCreativeStageContext(novelId, stageId)

  const candidates = listCreativeStages(novelId)
    .filter((stage) => stageContainsChapter(stage, chapterNum))
    .sort((left, right) => {
      const statusDelta = STAGE_STATUS_PRIORITY[left.status] - STAGE_STATUS_PRIORITY[right.status]
      if (statusDelta !== 0) return statusDelta
      const leftSpan = (left.chapterEnd ?? Number.MAX_SAFE_INTEGER) - (left.chapterStart ?? 1)
      const rightSpan = (right.chapterEnd ?? Number.MAX_SAFE_INTEGER) - (right.chapterStart ?? 1)
      return leftSpan - rightSpan || left.sequence - right.sequence || left.id - right.id
    })

  return candidates[0] ? getCreativeStageContext(novelId, candidates[0].id) : null
}

/** Resolve the active authoring stage for workflows that are not chapter-bound. */
export function resolveActiveCreativeStageContext(novelId: number, stageId?: number): CreativeStageContext | null {
  if (stageId) return getCreativeStageContext(novelId, stageId)
  const stage = listCreativeStages(novelId)
    .sort((left, right) => STAGE_STATUS_PRIORITY[left.status] - STAGE_STATUS_PRIORITY[right.status] || left.sequence - right.sequence)
    .find((item) => item.status !== 'completed')
  return stage ? getCreativeStageContext(novelId, stage.id) : null
}
