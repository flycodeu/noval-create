import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
  BatchInspectionCategory,
  BatchInspectionRecord,
  BatchInspectionStatus,
  BatchRollbackImpactPreview,
  BatchRollbackMode,
  BatchRollbackRecord,
  BatchRollbackResult,
  BatchSnapshotStatus,
  BatchSnapshotSummary,
  BatchWorkbenchData,
  GlobalLockLibrary,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  antiAiRuleHits,
  chapterBatchInspections,
  chapterBatchRollbacks,
  chapterBatchSnapshots,
  chapterContracts,
  chapterFactExtracts,
  chapterGateRuns,
  chapterRecallRuntimeSnapshots,
  chapterSegments,
  chapterVersions,
  chapterWritebackDiffs,
  chapterWritebackRuns,
  chapters,
  characterRelations,
  characterStateVersions,
  foreshadowLedger,
  globalLockLibraries,
  novels,
  revisionTasks,
  sceneContracts,
  storyFacts,
  storyItems,
  storyThreads,
  tasks,
  timelineEvents,
  worldStateVersions,
} from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'

type SnapshotPayload = {
  novelId: number
  chapterIds: number[]
  chapterNums: number[]
  capturedAt: string
  tables: {
    chapters: typeof chapters.$inferSelect[]
    chapterVersions: typeof chapterVersions.$inferSelect[]
    chapterSegments: typeof chapterSegments.$inferSelect[]
    chapterContracts: typeof chapterContracts.$inferSelect[]
    sceneContracts: typeof sceneContracts.$inferSelect[]
    chapterWritebackRuns: typeof chapterWritebackRuns.$inferSelect[]
    chapterFactExtracts: typeof chapterFactExtracts.$inferSelect[]
    chapterWritebackDiffs: typeof chapterWritebackDiffs.$inferSelect[]
    chapterGateRuns: typeof chapterGateRuns.$inferSelect[]
    chapterRecallRuntimeSnapshots: typeof chapterRecallRuntimeSnapshots.$inferSelect[]
    antiAiRuleHits: typeof antiAiRuleHits.$inferSelect[]
    revisionTasks: typeof revisionTasks.$inferSelect[]
    characterStateVersions: typeof characterStateVersions.$inferSelect[]
    worldStateVersions: typeof worldStateVersions.$inferSelect[]
    storyThreads: typeof storyThreads.$inferSelect[]
    storyFacts: typeof storyFacts.$inferSelect[]
    timelineEvents: typeof timelineEvents.$inferSelect[]
    storyItems: typeof storyItems.$inferSelect[]
    characterRelations: typeof characterRelations.$inferSelect[]
    foreshadowLedger: typeof foreshadowLedger.$inferSelect[]
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asText(item)).filter(Boolean)
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.trunc(item))
}

function parseRecord(raw?: string | null): Record<string, unknown> | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parsePayload(raw?: string | null): SnapshotPayload | null {
  const parsed = parseRecord(raw)
  if (!parsed) return null
  const tables = parseRecord(JSON.stringify(parsed.tables)) || {}
  return {
    novelId: typeof parsed.novelId === 'number' ? parsed.novelId : 0,
    chapterIds: toNumberArray(parsed.chapterIds),
    chapterNums: toNumberArray(parsed.chapterNums),
    capturedAt: asText(parsed.capturedAt) || '',
    tables: {
      chapters: Array.isArray(tables.chapters) ? tables.chapters as typeof chapters.$inferSelect[] : [],
      chapterVersions: Array.isArray(tables.chapterVersions) ? tables.chapterVersions as typeof chapterVersions.$inferSelect[] : [],
      chapterSegments: Array.isArray(tables.chapterSegments) ? tables.chapterSegments as typeof chapterSegments.$inferSelect[] : [],
      chapterContracts: Array.isArray(tables.chapterContracts) ? tables.chapterContracts as typeof chapterContracts.$inferSelect[] : [],
      sceneContracts: Array.isArray(tables.sceneContracts) ? tables.sceneContracts as typeof sceneContracts.$inferSelect[] : [],
      chapterWritebackRuns: Array.isArray(tables.chapterWritebackRuns) ? tables.chapterWritebackRuns as typeof chapterWritebackRuns.$inferSelect[] : [],
      chapterFactExtracts: Array.isArray(tables.chapterFactExtracts) ? tables.chapterFactExtracts as typeof chapterFactExtracts.$inferSelect[] : [],
      chapterWritebackDiffs: Array.isArray(tables.chapterWritebackDiffs) ? tables.chapterWritebackDiffs as typeof chapterWritebackDiffs.$inferSelect[] : [],
      chapterGateRuns: Array.isArray(tables.chapterGateRuns) ? tables.chapterGateRuns as typeof chapterGateRuns.$inferSelect[] : [],
      chapterRecallRuntimeSnapshots: Array.isArray(tables.chapterRecallRuntimeSnapshots) ? tables.chapterRecallRuntimeSnapshots as typeof chapterRecallRuntimeSnapshots.$inferSelect[] : [],
      antiAiRuleHits: Array.isArray(tables.antiAiRuleHits) ? tables.antiAiRuleHits as typeof antiAiRuleHits.$inferSelect[] : [],
      revisionTasks: Array.isArray(tables.revisionTasks) ? tables.revisionTasks as typeof revisionTasks.$inferSelect[] : [],
      characterStateVersions: Array.isArray(tables.characterStateVersions) ? tables.characterStateVersions as typeof characterStateVersions.$inferSelect[] : [],
      worldStateVersions: Array.isArray(tables.worldStateVersions) ? tables.worldStateVersions as typeof worldStateVersions.$inferSelect[] : [],
      storyThreads: Array.isArray(tables.storyThreads) ? tables.storyThreads as typeof storyThreads.$inferSelect[] : [],
      storyFacts: Array.isArray(tables.storyFacts) ? tables.storyFacts as typeof storyFacts.$inferSelect[] : [],
      timelineEvents: Array.isArray(tables.timelineEvents) ? tables.timelineEvents as typeof timelineEvents.$inferSelect[] : [],
      storyItems: Array.isArray(tables.storyItems) ? tables.storyItems as typeof storyItems.$inferSelect[] : [],
      characterRelations: Array.isArray(tables.characterRelations) ? tables.characterRelations as typeof characterRelations.$inferSelect[] : [],
      foreshadowLedger: Array.isArray(tables.foreshadowLedger) ? tables.foreshadowLedger as typeof foreshadowLedger.$inferSelect[] : [],
    },
  }
}

function buildSnapshotSummaryText(chapterNums: number[]): string {
  const sorted = [...new Set(chapterNums)].sort((left, right) => left - right)
  if (sorted.length === 0) return '空批次快照'
  return sorted.length === 1
    ? `第${sorted[0]}章批次快照`
    : `第${sorted[0]}-${sorted[sorted.length - 1]}章批次快照`
}

function parseTaskMessage(task?: typeof tasks.$inferSelect | null): string {
  if (!task) return ''
  const progress = parseRecord(task.progressJson)
  return asText(progress?.message) || asText(task.outputText) || asText(task.errorMessage)
}

function mapGlobalLockRow(row: typeof globalLockLibraries.$inferSelect | null | undefined, novelId: number): GlobalLockLibrary {
  return {
    novelId,
    lockedCanonFacts: safeParseStringArray(row?.lockedCanonFactsJson),
    lockedParagraphs: safeParseStringArray(row?.lockedParagraphsJson),
    lockedStyleRules: safeParseStringArray(row?.lockedStyleRulesJson),
    lockedCharacterVoice: safeParseStringArray(row?.lockedCharacterVoiceJson),
    updatedAt: asText(row?.updatedAt) || nowIso(),
  }
}

function safeParseStringArray(raw?: string | null): string[] {
  if (!raw?.trim()) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function loadTask(taskId?: number | null): typeof tasks.$inferSelect | null {
  if (typeof taskId !== 'number') return null
  return getDb().select().from(tasks).where(eq(tasks.id, taskId)).all()[0] || null
}

function mapSnapshotRow(row: typeof chapterBatchSnapshots.$inferSelect): BatchSnapshotSummary {
  const task = loadTask(row.workflowTaskId)
  const chapterIds = safeParseNumberArray(row.chapterIdsJson)
  const chapterNums = safeParseNumberArray(row.chapterNumsJson)
  const sortedChapterNums = [...chapterNums].sort((left, right) => left - right)
  return {
    id: row.id,
    novelId: row.novelId,
    workflowTaskId: typeof row.workflowTaskId === 'number' ? row.workflowTaskId : undefined,
    title: row.title,
    status: (row.status || 'active') as BatchSnapshotStatus,
    chapterIds,
    chapterNums: sortedChapterNums,
    chapterStart: sortedChapterNums[0],
    chapterEnd: sortedChapterNums[sortedChapterNums.length - 1],
    summary: row.summaryText || buildSnapshotSummaryText(sortedChapterNums),
    latestTaskStatus: task?.status as BatchSnapshotSummary['latestTaskStatus'],
    latestTaskMessage: parseTaskMessage(task) || undefined,
    latestRollbackMode: (row.latestRollbackMode || '') as BatchRollbackMode || undefined,
    rolledBackAt: row.rolledBackAt || undefined,
    createdAt: row.createdAt || nowIso(),
    updatedAt: row.updatedAt || nowIso(),
  }
}

function safeParseNumberArray(raw?: string | null): number[] {
  if (!raw?.trim()) return []
  try {
    return toNumberArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function mapInspectionRow(row: typeof chapterBatchInspections.$inferSelect): BatchInspectionRecord {
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    chapterId: typeof row.chapterId === 'number' ? row.chapterId : undefined,
    chapterNum: typeof row.chapterNum === 'number' ? row.chapterNum : undefined,
    category: (row.category || 'continuity') as BatchInspectionCategory,
    status: (row.status || 'pass') as BatchInspectionStatus,
    note: row.note || '',
    createdAt: row.createdAt || nowIso(),
    updatedAt: row.updatedAt || nowIso(),
  }
}

function mapRollbackRow(row: typeof chapterBatchRollbacks.$inferSelect): BatchRollbackRecord {
  const impact = parseRecord(row.impactJson) as unknown as BatchRollbackImpactPreview | null
  const restoredCounts = parseRecord(row.restoredCountsJson) || {}
  return {
    id: row.id,
    snapshotId: row.snapshotId,
    mode: row.mode as BatchRollbackMode,
    summary: row.summary,
    impact: impact || {
      snapshotId: row.snapshotId,
      mode: row.mode as BatchRollbackMode,
      chapterCount: 0,
      affectedChapters: [],
      affectedCounts: {},
      warnings: [],
    },
    restoredCounts: Object.fromEntries(Object.entries(restoredCounts).map(([key, value]) => [key, typeof value === 'number' ? value : Number(value) || 0])),
    createdAt: row.createdAt || nowIso(),
  }
}

function ensureNovelExists(novelId: number): void {
  const row = getDb().select({ id: novels.id }).from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!row) throwUserFacingError('novel.notFound')
}

function loadSnapshotRow(snapshotId: number): typeof chapterBatchSnapshots.$inferSelect {
  const row = getDb().select().from(chapterBatchSnapshots).where(eq(chapterBatchSnapshots.id, snapshotId)).all()[0]
  if (!row) throwUserFacingError('common.notFound')
  return row
}

function buildImpactPreviewFromPayload(
  snapshotId: number,
  mode: BatchRollbackMode,
  payload: SnapshotPayload,
): BatchRollbackImpactPreview {
  const affectedCounts: Record<string, number> = {
    chapters: payload.tables.chapters.length,
    chapterVersions: payload.tables.chapterVersions.length,
    chapterSegments: payload.tables.chapterSegments.length,
    chapterContracts: payload.tables.chapterContracts.length,
    sceneContracts: payload.tables.sceneContracts.length,
    chapterGateRuns: payload.tables.chapterGateRuns.length,
    chapterRecallRuntimeSnapshots: payload.tables.chapterRecallRuntimeSnapshots.length,
    antiAiRuleHits: payload.tables.antiAiRuleHits.length,
  }
  const warnings: string[] = []

  if (mode !== 'chapter_rollback') {
    affectedCounts.chapterWritebackRuns = payload.tables.chapterWritebackRuns.length
    affectedCounts.chapterFactExtracts = payload.tables.chapterFactExtracts.length
    affectedCounts.chapterWritebackDiffs = payload.tables.chapterWritebackDiffs.length
    affectedCounts.characterStateVersions = payload.tables.characterStateVersions.length
    affectedCounts.worldStateVersions = payload.tables.worldStateVersions.length
    affectedCounts.revisionTasks = payload.tables.revisionTasks.filter((item) => payload.chapterIds.includes(item.chapterId || 0)).length
  }

  if (mode === 'batch_full_rollback') {
    affectedCounts.storyThreads = payload.tables.storyThreads.length
    affectedCounts.storyFacts = payload.tables.storyFacts.length
    affectedCounts.timelineEvents = payload.tables.timelineEvents.length
    affectedCounts.storyItems = payload.tables.storyItems.length
    affectedCounts.characterRelations = payload.tables.characterRelations.length
    affectedCounts.foreshadowLedger = payload.tables.foreshadowLedger.length
    affectedCounts.revisionTasks = payload.tables.revisionTasks.length
    warnings.push('全量回滚会恢复本批开始前的全书线程、物品、时间轴、谜题、关系与伏笔状态。')
  } else if (mode === 'batch_content_rollback') {
    warnings.push('内容回滚只恢复章节正文、合同、章后回写草稿与本批章节状态，不恢复全书资产表。')
  } else {
    warnings.push('单章回滚只恢复批次内章节自身内容与章级衍生记录。')
  }

  return {
    snapshotId,
    mode,
    chapterCount: payload.chapterIds.length,
    affectedChapters: payload.tables.chapters
      .map((row) => ({
        chapterId: row.id,
        chapterNum: row.chapterNum,
        title: row.title || `第${row.chapterNum}章`,
      }))
      .sort((left, right) => left.chapterNum - right.chapterNum),
    affectedCounts,
    warnings,
  }
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value)
}

function captureSnapshotPayload(novelId: number, chapterIds: number[]): SnapshotPayload {
  const db = getDb()
  const normalizedChapterIds = [...new Set(chapterIds.filter((item) => Number.isFinite(item) && item > 0))]
  const chapterRows = normalizedChapterIds.length > 0
    ? db.select().from(chapters).where(inArray(chapters.id, normalizedChapterIds)).all()
    : []
  if (chapterRows.length === 0) throwUserFacingError('chapter.notFound')

  const chapterIdsSet = new Set(chapterRows.map((row) => row.id))
  const runRows = db.select().from(chapterWritebackRuns).where(inArray(chapterWritebackRuns.chapterId, [...chapterIdsSet])).all()
  const runIds = runRows.map((row) => row.id)

  return {
    novelId,
    chapterIds: chapterRows.map((row) => row.id),
    chapterNums: chapterRows.map((row) => row.chapterNum),
    capturedAt: nowIso(),
    tables: {
      chapters: chapterRows,
      chapterVersions: db.select().from(chapterVersions).where(inArray(chapterVersions.chapterId, [...chapterIdsSet])).all(),
      chapterSegments: db.select().from(chapterSegments).where(inArray(chapterSegments.chapterId, [...chapterIdsSet])).all(),
      chapterContracts: db.select().from(chapterContracts).where(inArray(chapterContracts.chapterId, [...chapterIdsSet])).all(),
      sceneContracts: db.select().from(sceneContracts).where(inArray(sceneContracts.chapterId, [...chapterIdsSet])).all(),
      chapterWritebackRuns: runRows,
      chapterFactExtracts: runIds.length > 0 ? db.select().from(chapterFactExtracts).where(inArray(chapterFactExtracts.runId, runIds)).all() : [],
      chapterWritebackDiffs: runIds.length > 0 ? db.select().from(chapterWritebackDiffs).where(inArray(chapterWritebackDiffs.runId, runIds)).all() : [],
      chapterGateRuns: db.select().from(chapterGateRuns).where(inArray(chapterGateRuns.chapterId, [...chapterIdsSet])).all(),
      chapterRecallRuntimeSnapshots: db.select().from(chapterRecallRuntimeSnapshots).where(inArray(chapterRecallRuntimeSnapshots.chapterId, [...chapterIdsSet])).all(),
      antiAiRuleHits: db.select().from(antiAiRuleHits).where(inArray(antiAiRuleHits.chapterId, [...chapterIdsSet])).all(),
      revisionTasks: db.select().from(revisionTasks).where(eq(revisionTasks.novelId, novelId)).all(),
      characterStateVersions: db.select().from(characterStateVersions).where(inArray(characterStateVersions.chapterId, [...chapterIdsSet])).all(),
      worldStateVersions: db.select().from(worldStateVersions).where(inArray(worldStateVersions.chapterId, [...chapterIdsSet])).all(),
      storyThreads: db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
      storyFacts: db.select().from(storyFacts).where(eq(storyFacts.novelId, novelId)).all(),
      timelineEvents: db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
      storyItems: db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
      characterRelations: db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all(),
      foreshadowLedger: db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, novelId)).all(),
    },
  }
}

export function createChapterBatchSnapshot(novelId: number, workflowTaskId: number, chapterIds: number[]): BatchSnapshotSummary {
  const db = getDb()
  const payload = captureSnapshotPayload(novelId, chapterIds)
  const now = nowIso()
  const result = db.insert(chapterBatchSnapshots).values({
    novelId,
    workflowTaskId,
    title: buildSnapshotSummaryText(payload.chapterNums),
    status: 'active',
    summaryText: `${buildSnapshotSummaryText(payload.chapterNums)} · 已保存 ${payload.chapterIds.length} 章的批次快照。`,
    chapterIdsJson: safeStringify(payload.chapterIds),
    chapterNumsJson: safeStringify(payload.chapterNums),
    snapshotJson: safeStringify(payload),
    createdAt: now,
    updatedAt: now,
  }).run()
  return mapSnapshotRow(loadSnapshotRow(Number(result.lastInsertRowid)))
}

export function getGlobalLockLibrary(novelId: number): GlobalLockLibrary {
  ensureNovelExists(novelId)
  const row = getDb().select().from(globalLockLibraries).where(eq(globalLockLibraries.novelId, novelId)).all()[0] || null
  return mapGlobalLockRow(row, novelId)
}

export function updateGlobalLockLibrary(novelId: number, patch: Partial<GlobalLockLibrary>): GlobalLockLibrary {
  ensureNovelExists(novelId)
  const db = getDb()
  const current = getGlobalLockLibrary(novelId)
  const next: GlobalLockLibrary = {
    novelId,
    lockedCanonFacts: Array.isArray(patch.lockedCanonFacts) ? toStringArray(patch.lockedCanonFacts) : current.lockedCanonFacts,
    lockedParagraphs: Array.isArray(patch.lockedParagraphs) ? toStringArray(patch.lockedParagraphs) : current.lockedParagraphs,
    lockedStyleRules: Array.isArray(patch.lockedStyleRules) ? toStringArray(patch.lockedStyleRules) : current.lockedStyleRules,
    lockedCharacterVoice: Array.isArray(patch.lockedCharacterVoice) ? toStringArray(patch.lockedCharacterVoice) : current.lockedCharacterVoice,
    updatedAt: nowIso(),
  }
  db.insert(globalLockLibraries).values({
    novelId,
    lockedCanonFactsJson: safeStringify(next.lockedCanonFacts),
    lockedParagraphsJson: safeStringify(next.lockedParagraphs),
    lockedStyleRulesJson: safeStringify(next.lockedStyleRules),
    lockedCharacterVoiceJson: safeStringify(next.lockedCharacterVoice),
    updatedAt: next.updatedAt,
  }).onConflictDoUpdate({
    target: globalLockLibraries.novelId,
    set: {
      lockedCanonFactsJson: safeStringify(next.lockedCanonFacts),
      lockedParagraphsJson: safeStringify(next.lockedParagraphs),
      lockedStyleRulesJson: safeStringify(next.lockedStyleRules),
      lockedCharacterVoiceJson: safeStringify(next.lockedCharacterVoice),
      updatedAt: next.updatedAt,
    },
  }).run()
  return next
}

export function buildGlobalLockContext(novelId: number): {
  canonFactSummary: string
  lockedParagraphSummary: string
  styleRuleSummary: string
  characterVoiceSummary: string
} {
  const library = getGlobalLockLibrary(novelId)
  return {
    canonFactSummary: library.lockedCanonFacts.length > 0 ? `作者锁定事实：${library.lockedCanonFacts.join('；')}` : '',
    lockedParagraphSummary: library.lockedParagraphs.length > 0 ? `作者锁定段落：${library.lockedParagraphs.join('；')}` : '',
    styleRuleSummary: library.lockedStyleRules.length > 0 ? `作者锁定风格：${library.lockedStyleRules.join('；')}` : '',
    characterVoiceSummary: library.lockedCharacterVoice.length > 0 ? `作者锁定口吻：${library.lockedCharacterVoice.join('；')}` : '',
  }
}

export function getBatchWorkbenchData(novelId: number, snapshotId?: number): BatchWorkbenchData {
  ensureNovelExists(novelId)
  const db = getDb()
  const snapshots = db.select().from(chapterBatchSnapshots)
    .where(eq(chapterBatchSnapshots.novelId, novelId))
    .orderBy(desc(chapterBatchSnapshots.createdAt), desc(chapterBatchSnapshots.id))
    .all()
    .map(mapSnapshotRow)
  const activeSnapshot = typeof snapshotId === 'number'
    ? snapshots.find((item) => item.id === snapshotId) || null
    : snapshots[0] || null
  const inspections = activeSnapshot
    ? db.select().from(chapterBatchInspections).where(eq(chapterBatchInspections.snapshotId, activeSnapshot.id)).orderBy(desc(chapterBatchInspections.createdAt), desc(chapterBatchInspections.id)).all().map(mapInspectionRow)
    : []
  const rollbacks = activeSnapshot
    ? db.select().from(chapterBatchRollbacks).where(eq(chapterBatchRollbacks.snapshotId, activeSnapshot.id)).orderBy(desc(chapterBatchRollbacks.createdAt), desc(chapterBatchRollbacks.id)).all().map(mapRollbackRow)
    : []
  return {
    snapshots,
    activeSnapshot,
    inspections,
    rollbacks,
    globalLockLibrary: getGlobalLockLibrary(novelId),
  }
}

export function createBatchInspection(snapshotId: number, data: {
  chapterId?: number
  chapterNum?: number
  category: BatchInspectionCategory
  status: BatchInspectionStatus
  note: string
}): BatchInspectionRecord {
  const snapshot = loadSnapshotRow(snapshotId)
  const chapterIds = safeParseNumberArray(snapshot.chapterIdsJson)
  if (typeof data.chapterId === 'number' && !chapterIds.includes(data.chapterId)) {
    throwUserFacingError('common.loadFailed')
  }
  const now = nowIso()
  const result = getDb().insert(chapterBatchInspections).values({
    snapshotId,
    chapterId: data.chapterId,
    chapterNum: data.chapterNum,
    category: data.category,
    status: data.status,
    note: asText(data.note),
    createdAt: now,
    updatedAt: now,
  }).run()
  const row = getDb().select().from(chapterBatchInspections).where(eq(chapterBatchInspections.id, Number(result.lastInsertRowid))).all()[0]
  if (!row) throwUserFacingError('common.notFound')
  return mapInspectionRow(row)
}

export function previewBatchRollback(snapshotId: number, mode: BatchRollbackMode): BatchRollbackImpactPreview {
  const snapshot = loadSnapshotRow(snapshotId)
  const payload = parsePayload(snapshot.snapshotJson)
  if (!payload) throwUserFacingError('history.undoCheckpointCorrupt')
  return buildImpactPreviewFromPayload(snapshotId, mode, payload)
}

function replaceRows(table: any, rows: Record<string, unknown>[]) {
  const db = getDb()
  if (rows.length === 0) return
  db.insert(table).values(rows as any).run()
}

function restoreChapterScopedPayload(payload: SnapshotPayload, includeWriteback: boolean): Record<string, number> {
  const db = getDb()
  const currentRunIds = db.select({ id: chapterWritebackRuns.id }).from(chapterWritebackRuns)
    .where(inArray(chapterWritebackRuns.chapterId, payload.chapterIds))
    .all()
    .map((row) => row.id)
  const snapshotRunIds = payload.tables.chapterWritebackRuns.map((row) => row.id)
  const combinedRunIds = [...new Set([...currentRunIds, ...snapshotRunIds])]

  if (combinedRunIds.length > 0) {
    db.delete(chapterWritebackDiffs).where(inArray(chapterWritebackDiffs.runId, combinedRunIds)).run()
    db.delete(chapterFactExtracts).where(inArray(chapterFactExtracts.runId, combinedRunIds)).run()
  }
  if (includeWriteback) {
    db.delete(chapterWritebackRuns).where(inArray(chapterWritebackRuns.chapterId, payload.chapterIds)).run()
  }
  db.delete(sceneContracts).where(inArray(sceneContracts.chapterId, payload.chapterIds)).run()
  db.delete(chapterContracts).where(inArray(chapterContracts.chapterId, payload.chapterIds)).run()
  db.delete(chapterSegments).where(inArray(chapterSegments.chapterId, payload.chapterIds)).run()
  db.delete(chapterVersions).where(inArray(chapterVersions.chapterId, payload.chapterIds)).run()
  db.delete(chapterGateRuns).where(inArray(chapterGateRuns.chapterId, payload.chapterIds)).run()
  db.delete(chapterRecallRuntimeSnapshots).where(inArray(chapterRecallRuntimeSnapshots.chapterId, payload.chapterIds)).run()
  db.delete(antiAiRuleHits).where(inArray(antiAiRuleHits.chapterId, payload.chapterIds)).run()
  db.delete(characterStateVersions).where(inArray(characterStateVersions.chapterId, payload.chapterIds)).run()
  db.delete(worldStateVersions).where(inArray(worldStateVersions.chapterId, payload.chapterIds)).run()
  db.delete(chapters).where(inArray(chapters.id, payload.chapterIds)).run()

  replaceRows(chapters, payload.tables.chapters)
  replaceRows(chapterVersions, payload.tables.chapterVersions)
  replaceRows(chapterSegments, payload.tables.chapterSegments)
  replaceRows(chapterContracts, payload.tables.chapterContracts)
  replaceRows(sceneContracts, payload.tables.sceneContracts)
  replaceRows(chapterGateRuns, payload.tables.chapterGateRuns)
  replaceRows(chapterRecallRuntimeSnapshots, payload.tables.chapterRecallRuntimeSnapshots)
  replaceRows(antiAiRuleHits, payload.tables.antiAiRuleHits)
  replaceRows(characterStateVersions, payload.tables.characterStateVersions)
  replaceRows(worldStateVersions, payload.tables.worldStateVersions)
  if (includeWriteback) {
    replaceRows(chapterWritebackRuns, payload.tables.chapterWritebackRuns)
    replaceRows(chapterFactExtracts, payload.tables.chapterFactExtracts)
    replaceRows(chapterWritebackDiffs, payload.tables.chapterWritebackDiffs)
  }

  return {
    chapters: payload.tables.chapters.length,
    chapterVersions: payload.tables.chapterVersions.length,
    chapterSegments: payload.tables.chapterSegments.length,
    chapterContracts: payload.tables.chapterContracts.length,
    sceneContracts: payload.tables.sceneContracts.length,
    chapterGateRuns: payload.tables.chapterGateRuns.length,
    chapterRecallRuntimeSnapshots: payload.tables.chapterRecallRuntimeSnapshots.length,
    antiAiRuleHits: payload.tables.antiAiRuleHits.length,
    characterStateVersions: payload.tables.characterStateVersions.length,
    worldStateVersions: payload.tables.worldStateVersions.length,
    ...(includeWriteback
      ? {
        chapterWritebackRuns: payload.tables.chapterWritebackRuns.length,
        chapterFactExtracts: payload.tables.chapterFactExtracts.length,
        chapterWritebackDiffs: payload.tables.chapterWritebackDiffs.length,
      }
      : {}),
  }
}

function restoreRevisionTasks(payload: SnapshotPayload, full: boolean): number {
  const db = getDb()
  if (full) {
    db.delete(revisionTasks).where(eq(revisionTasks.novelId, payload.novelId)).run()
    replaceRows(revisionTasks, payload.tables.revisionTasks)
    return payload.tables.revisionTasks.length
  }
  const scopedRows = payload.tables.revisionTasks.filter((row) => payload.chapterIds.includes(row.chapterId || 0))
  db.delete(revisionTasks).where(and(
    eq(revisionTasks.novelId, payload.novelId),
    inArray(revisionTasks.chapterId, payload.chapterIds),
  )).run()
  replaceRows(revisionTasks, scopedRows)
  return scopedRows.length
}

function restoreNovelWideAssets(payload: SnapshotPayload): Record<string, number> {
  const db = getDb()
  db.delete(foreshadowLedger).where(eq(foreshadowLedger.novelId, payload.novelId)).run()
  db.delete(timelineEvents).where(eq(timelineEvents.novelId, payload.novelId)).run()
  db.delete(storyFacts).where(eq(storyFacts.novelId, payload.novelId)).run()
  db.delete(storyItems).where(eq(storyItems.novelId, payload.novelId)).run()
  db.delete(characterRelations).where(eq(characterRelations.novelId, payload.novelId)).run()
  db.delete(storyThreads).where(eq(storyThreads.novelId, payload.novelId)).run()

  replaceRows(storyThreads, payload.tables.storyThreads)
  replaceRows(storyFacts, payload.tables.storyFacts)
  replaceRows(storyItems, payload.tables.storyItems)
  replaceRows(characterRelations, payload.tables.characterRelations)
  replaceRows(timelineEvents, payload.tables.timelineEvents)
  replaceRows(foreshadowLedger, payload.tables.foreshadowLedger)

  return {
    storyThreads: payload.tables.storyThreads.length,
    storyFacts: payload.tables.storyFacts.length,
    storyItems: payload.tables.storyItems.length,
    characterRelations: payload.tables.characterRelations.length,
    timelineEvents: payload.tables.timelineEvents.length,
    foreshadowLedger: payload.tables.foreshadowLedger.length,
  }
}

export function applyBatchRollback(snapshotId: number, mode: BatchRollbackMode): BatchRollbackResult {
  const db = getDb()
  const sqlite = getSqlite()
  const snapshot = loadSnapshotRow(snapshotId)
  const payload = parsePayload(snapshot.snapshotJson)
  if (!payload) throwUserFacingError('history.undoCheckpointCorrupt')
  const impact = buildImpactPreviewFromPayload(snapshotId, mode, payload)
  const createdAt = nowIso()
  let rollbackId = 0
  let restoredCounts: Record<string, number> = {}

  sqlite.transaction(() => {
    restoredCounts = restoreChapterScopedPayload(payload, mode !== 'chapter_rollback')
    restoredCounts.revisionTasks = restoreRevisionTasks(payload, mode === 'batch_full_rollback')
    if (mode === 'batch_full_rollback') {
      restoredCounts = {
        ...restoredCounts,
        ...restoreNovelWideAssets(payload),
      }
    }

    const insert = db.insert(chapterBatchRollbacks).values({
      snapshotId,
      mode,
      summary: mode === 'chapter_rollback'
        ? '已恢复批次章节内容与章级衍生记录。'
        : mode === 'batch_content_rollback'
          ? '已恢复批次正文、合同、回写草稿与章节状态。'
          : '已恢复本批开始前的正文、合同、状态与全书资产快照。',
      impactJson: safeStringify(impact),
      restoredCountsJson: safeStringify(restoredCounts),
      createdAt,
    }).run()
    rollbackId = Number(insert.lastInsertRowid)

    db.update(chapterBatchSnapshots).set({
      status: 'rolled_back',
      rolledBackAt: createdAt,
      latestRollbackMode: mode,
      updatedAt: createdAt,
    }).where(eq(chapterBatchSnapshots.id, snapshotId)).run()
  })()

  const nextSnapshot = mapSnapshotRow(loadSnapshotRow(snapshotId))
  const rollbackRow = db.select().from(chapterBatchRollbacks).where(eq(chapterBatchRollbacks.id, rollbackId)).all()[0]
  if (!rollbackRow) throwUserFacingError('common.notFound')
  return {
    snapshot: nextSnapshot,
    rollback: mapRollbackRow(rollbackRow),
  }
}

export function markChapterBatchSnapshotCompleted(snapshotId: number): void {
  getDb().update(chapterBatchSnapshots).set({
    status: 'completed',
    updatedAt: nowIso(),
  }).where(eq(chapterBatchSnapshots.id, snapshotId)).run()
}
