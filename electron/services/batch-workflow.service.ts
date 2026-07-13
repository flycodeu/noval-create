import type { WebContents } from 'electron'
import { asc, desc, eq } from 'drizzle-orm'
import type {
  ChapterBatchAutoGenerateStatus,
  ChapterBatchGenerateOptions,
  ChapterQualityAnalysisOptions,
  ChapterQualityAnalysisStatus,
  CharacterAutoGenerateStatus,
  CharacterBatchGenerationOptions,
  FactionAutoGenerateStatus,
  FactionBatchGenerationOptions,
  ItemAutoGenerateStatus,
  StoryItemGenerateOptions,
  StoryThreadAutoGenerateStatus,
  SubplotAutoGenerateRequest,
  SubplotAutoGenerateStatus,
  TimelineAutoGenerateStatus,
  TimelineGenerateOptions,
  WritebackSyncStatus,
} from '../../src/types'
import { getOperatingModeRuntimePolicy } from '../../src/shared/operating-mode'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { normalizeWritebackSyncStatus } from '../../src/shared/writeback-status'
import type { StoryThreadBatchGenerateOptions, StoryThreadBatchGenerationResult } from '../../src/shared/story-thread-generation'
import { hasResumableWorkflowCheckpoint } from '../../src/shared/workflow-resilience'
import {
  getFactionGenerationPreset,
  getItemGenerationProfile,
  getStoryThreadGenerationPreset,
  getTimelineGenerationPreset,
  type NovelAssetScaleInput,
} from '../../src/shared/creation-tools'
import { parseWorldRulesJson } from '../../src/shared/genre-system'
import { getDb } from '../database/db'
import { characters, chapters, factions, genres, novels, tasks, worldMap } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { aiCheckChapter, generateChapterContent, getChapter } from './chapter.service'
import { generateCharacterBatchChunk } from './character.service'
import { runChapterPublishCheck } from './context-impact.service'
import { getFeedbackRecurrenceBatchPauseSignal } from './feedback-recurrence.service'
import { generateFactionBatchChunk } from './faction.service'
import { loadSubplotAutoGenerateContext, polishGeneratedSubplots, tryGenerateSubplotBatch } from './core-settings.service'
import { generateStoryItemsBatchChunk } from './item.service'
import { generateStoryThreadBatchChunk } from './story-thread.service'
import {
  createTask,
  getTaskRecord,
  parseTaskControl,
  parseTaskProgress,
  updateTask,
  updateTaskControl,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import { generateTimelineBatchChunk } from './timeline.service'
import {
  createChapterBatchSnapshot,
  createBatchInspection,
  markChapterBatchSnapshotCompleted,
} from './batch-workbench.service'

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_WORKFLOW_WAIT_TIMEOUT_MS = 15 * 60 * 1000
const MAX_WORKFLOW_WAIT_TIMEOUT_MS = 2 * 60 * 60 * 1000
const WORKFLOW_WAIT_TIMEOUT_ENV = 'NOVELFORGE_BATCH_WAIT_TIMEOUT_MS'
const MAX_FACTION_GENERATION_COUNT = 200
const MAX_ENTITY_GENERATION_COUNT = 200
const MAX_THREAD_GENERATION_COUNT = 160
const MAX_SUBPLOT_GENERATION_COUNT = 40
const activeBatchWorkflows = new Set<number>()
const batchWorkflowStartLocks = new Map<string, Promise<unknown>>()
const ACTIVE_BATCH_WORKFLOW_RUNNING_STATUSES = new Set(['pending', 'running', 'cancel_requested'])

function logWorkflowError(taskId: number) {
  return (err: unknown) => console.error(`[batch-workflow] Unhandled error in task ${taskId}:`, err)
}

type TaskRow = typeof tasks.$inferSelect
type BatchWorkflowTaskType =
  | 'faction_auto_generate'
  | 'character_auto_generate'
  | 'item_auto_generate'
  | 'timeline_auto_generate'
  | 'story_thread_auto_generate'
  | 'subplot_auto_generate'
  | 'chapter_batch_generate'
  | 'chapter_quality_analysis'

async function withBatchWorkflowStartLock<T>(
  type: BatchWorkflowTaskType,
  novelId: number,
  start: () => Promise<T>,
): Promise<T> {
  const key = `${type}:${novelId}`
  const existing = batchWorkflowStartLocks.get(key)
  if (existing) return existing as Promise<T>

  const pending = Promise.resolve().then(start)
  batchWorkflowStartLocks.set(key, pending)
  try {
    return await pending
  } finally {
    if (batchWorkflowStartLocks.get(key) === pending) batchWorkflowStartLocks.delete(key)
  }
}

function isActiveBatchWorkflowStatus(status?: string | null): boolean {
  return ACTIVE_BATCH_WORKFLOW_RUNNING_STATUSES.has(status || '')
}

function cleanupInactiveBatchWorkflowEntries(): void {
  for (const taskId of activeBatchWorkflows) {
    const task = getTaskRecord(taskId)
    if (!task || task.runnerType !== 'workflow' || !isBatchWorkflowType(task.type) || !isActiveBatchWorkflowStatus(task.status)) {
      activeBatchWorkflows.delete(taskId)
    }
  }
}

function tryRegisterActiveBatchWorkflow(taskId: number): boolean {
  cleanupInactiveBatchWorkflowEntries()
  if (activeBatchWorkflows.has(taskId)) return false
  activeBatchWorkflows.add(taskId)
  return true
}

function unregisterActiveBatchWorkflow(taskId: number): void {
  activeBatchWorkflows.delete(taskId)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveWorkflowWaitTimeoutMs(): number {
  const configured = Number(process.env[WORKFLOW_WAIT_TIMEOUT_ENV])
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, MAX_WORKFLOW_WAIT_TIMEOUT_MS)
  }
  return DEFAULT_WORKFLOW_WAIT_TIMEOUT_MS
}

function asRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isFinite(item))
}

function asWritebackSyncStatus(value: unknown): WritebackSyncStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const phase = typeof record.phase === 'string' ? record.phase : ''
  if (phase !== 'idle' && phase !== 'preparing' && phase !== 'ready' && phase !== 'applying' && phase !== 'applied' && phase !== 'failed') {
    return undefined
  }
  return normalizeWritebackSyncStatus(record)
}

function parseChapterWritebackSyncStatus(raw?: string | null): WritebackSyncStatus | undefined {
  if (!raw) return undefined
  try {
    return asWritebackSyncStatus(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

function getWritebackPhaseLabel(phase?: WritebackSyncStatus['phase']): string {
  if (phase === 'preparing') return '准备回写'
  if (phase === 'ready') return '待确认'
  if (phase === 'applying') return '正在应用'
  if (phase === 'applied') return '已应用'
  if (phase === 'failed') return '回写失败'
  return '空闲'
}

function clampPositiveInt(value: unknown, fallback: number, min = 1, max = 50): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

function parseCharacterOptions(raw?: string | null): CharacterBatchGenerationOptions {
  const record = asRecord(raw)
  return {
    majorCount: clampPositiveInt(record.majorCount, 0, 0, 50),
    minorCount: clampPositiveInt(record.minorCount, 0, 0, 50),
    antagonistCount: clampPositiveInt(record.antagonistCount, 0, 0, 50),
    supportingCount: clampPositiveInt(record.supportingCount, 0, 0, 50),
    genderRatio: typeof record.genderRatio === 'string' ? record.genderRatio : '',
    preferredSpecies: asStringArray(record.preferredSpecies),
    factionBias: asStringArray(record.factionBias),
    helperRoles: asStringArray(record.helperRoles),
    batchSize: clampPositiveInt(record.batchSize, 6, 1, 20),
    specialRequirements: typeof record.specialRequirements === 'string' ? record.specialRequirements : '',
    relationSeedMode: record.relationSeedMode === 'conflict-heavy' || record.relationSeedMode === 'ally-heavy'
      ? record.relationSeedMode
      : 'balanced',
    requiredItemLinks: asStringArray(record.requiredItemLinks),
    diversityConstraints: asStringArray(record.diversityConstraints),
  }
}

type ParsedFactionBatchGenerationOptions = Omit<FactionBatchGenerationOptions, 'count' | 'batchSize'> & {
  count?: number
  batchSize?: number
}

function parseFactionOptions(raw?: string | null): ParsedFactionBatchGenerationOptions {
  const record = asRecord(raw)
  return {
    count: typeof record.count === 'undefined'
      ? undefined
      : clampPositiveInt(record.count, 8, 1, MAX_FACTION_GENERATION_COUNT),
    batchSize: typeof record.batchSize === 'undefined'
      ? undefined
      : clampPositiveInt(record.batchSize, 1, 1, 8),
    preferredTypes: asStringArray(record.preferredTypes) as FactionBatchGenerationOptions['preferredTypes'],
    relationshipDensity: record.relationshipDensity === 'sparse' || record.relationshipDensity === 'dense'
      ? record.relationshipDensity
      : 'balanced',
    allowCharacterlessFactions: record.allowCharacterlessFactions !== false,
    preferExistingCharacters: record.preferExistingCharacters !== false,
    specialRequirements: typeof record.specialRequirements === 'string' ? record.specialRequirements : '',
  }
}

function parseItemOptions(raw?: string | null): StoryItemGenerateOptions {
  const record = asRecord(raw)
  return {
    count: typeof record.count === 'undefined'
      ? undefined
      : clampPositiveInt(record.count, 8, 1, MAX_ENTITY_GENERATION_COUNT),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 12),
    focus: typeof record.focus === 'string' ? record.focus : '',
    refreshTemplates: record.refreshTemplates === true,
    templateOnly: record.templateOnly === true,
  }
}

function parseTimelineOptions(raw?: string | null): TimelineGenerateOptions {
  const record = asRecord(raw)
  return {
    count: typeof record.count === 'undefined'
      ? undefined
      : clampPositiveInt(record.count, 10, 1, MAX_ENTITY_GENERATION_COUNT),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 12),
    focus: typeof record.focus === 'string' ? record.focus : '',
  }
}

function parseThreadOptions(raw?: string | null): StoryThreadBatchGenerateOptions {
  const record = asRecord(raw)
  return {
    count: typeof record.count === 'undefined'
      ? undefined
      : clampPositiveInt(record.count, 8, 1, MAX_THREAD_GENERATION_COUNT),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 12),
    focus: typeof record.focus === 'string' ? record.focus : '',
  }
}

function parseSubplotRequest(raw?: string | null): SubplotAutoGenerateRequest {
  const record = asRecord(raw)
  return {
    novelId: clampPositiveInt(record.novelId, 0, 0, Number.MAX_SAFE_INTEGER),
    subplotCount: clampPositiveInt(record.subplotCount, 8, 1, MAX_SUBPLOT_GENERATION_COUNT),
    storyGoal: typeof record.storyGoal === 'string' ? record.storyGoal : '',
    coreConflict: typeof record.coreConflict === 'string' ? record.coreConflict : '',
    mainPlot: typeof record.mainPlot === 'string' ? record.mainPlot : '',
    requirements: typeof record.requirements === 'string' ? record.requirements : undefined,
  }
}

function resolveWorkflowAssetScale(novelId: number): { genreName?: string; scaleInput: NovelAssetScaleInput } {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) {
    return { scaleInput: {} }
  }
  const genre = novel.genreId
    ? db.select().from(genres).where(eq(genres.id, novel.genreId)).get()
    : null
  const genreName = typeof genre?.name === 'string' ? genre.name : undefined
  const rules = parseWorldRulesJson(novel.worldRulesJson, genreName)
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const factionRows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  return {
    genreName,
    scaleInput: {
      launchMode: novel.launchMode,
      targetWords: novel.targetWords,
      settingsJson: novel.settingsJson,
      mapDepth: Math.max(
        ...rules.mapBlueprint.levels.map((level) => level.depth),
        ...mapRows.map((row) => Number(row.level || 0)),
        1,
      ),
      factionCount: Math.max(rules.factionSystem.length, factionRows.length),
      speciesCount: Math.max(
        rules.speciesSystem.length,
        new Set(characterRows.map((character) => character.species).filter(Boolean)).size,
      ),
      powerSystemCount: rules.powerSystems.length,
    },
  }
}

function resolveFactionWorkflowOptions(novelId: number, raw?: string | null): FactionBatchGenerationOptions {
  const parsed = parseFactionOptions(raw)
  if (typeof parsed.count === 'number' && typeof parsed.batchSize === 'number') {
    return parsed as FactionBatchGenerationOptions
  }
  const { genreName, scaleInput } = resolveWorkflowAssetScale(novelId)
  const preset = getFactionGenerationPreset(genreName, scaleInput)
  return {
    ...parsed,
    count: parsed.count ?? preset.count,
    batchSize: parsed.batchSize ?? preset.batchSize,
  }
}

function resolveItemWorkflowOptions(novelId: number, raw?: string | null): StoryItemGenerateOptions {
  const parsed = parseItemOptions(raw)
  if (typeof parsed.count === 'number') return parsed
  const { genreName, scaleInput } = resolveWorkflowAssetScale(novelId)
  return {
    ...parsed,
    count: getItemGenerationProfile(genreName, scaleInput).defaultBatch,
  }
}

function resolveTimelineWorkflowOptions(novelId: number, raw?: string | null): TimelineGenerateOptions {
  const parsed = parseTimelineOptions(raw)
  if (typeof parsed.count === 'number') return parsed
  const { genreName, scaleInput } = resolveWorkflowAssetScale(novelId)
  return {
    ...parsed,
    count: getTimelineGenerationPreset(genreName, scaleInput).count,
  }
}

function resolveThreadWorkflowOptions(novelId: number, raw?: string | null): StoryThreadBatchGenerateOptions {
  const parsed = parseThreadOptions(raw)
  if (typeof parsed.count === 'number') return parsed
  const { genreName, scaleInput } = resolveWorkflowAssetScale(novelId)
  return {
    ...parsed,
    count: getStoryThreadGenerationPreset(genreName, scaleInput).count,
  }
}

function parseChapterBatchOptions(raw?: string | null): ChapterBatchGenerateOptions {
  const record = asRecord(raw)
  const chapterIds = [...new Set(
    asNumberArray(record.chapterIds)
      .map((item) => Math.round(item))
      .filter((item) => item > 0),
  )]
  return {
    chapterIds,
    batchSize: 1,
  }
}

function appendUniqueNumber(values: number[], next?: number | null): number[] {
  if (typeof next !== 'number' || !Number.isFinite(next)) return values
  return values.includes(next) ? values : [...values, next]
}

function appendUniqueStrings(values: string[], next?: string | string[] | null): string[] {
  const entries = Array.isArray(next) ? next : next ? [next] : []
  const seen = new Set(values)
  const appended = [...values]
  for (const entry of entries) {
    const normalized = typeof entry === 'string' ? entry.trim() : ''
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    appended.push(normalized)
  }
  return appended
}

function getChapterBatchRuntimePolicy(novelId: number) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).get()
  return getOperatingModeRuntimePolicy({
    launchMode: novel?.launchMode,
    targetWords: novel?.targetWords,
    settingsJson: novel?.settingsJson,
  })
}

function toRuntimePolicySnapshot(runtimePolicy: ReturnType<typeof getOperatingModeRuntimePolicy>): NonNullable<ChapterBatchAutoGenerateStatus['runtimePolicySnapshot']> {
  return {
    operatingMode: runtimePolicy.operatingMode,
    chapterGenerationMode: runtimePolicy.chapterGenerationMode,
    backgroundPrecomputeEnabled: runtimePolicy.backgroundPrecomputeEnabled,
    requireWritebackReady: runtimePolicy.requireWritebackReady,
    recallPauseThreshold: runtimePolicy.recallPauseThreshold,
    checkpointGapWarningThreshold: runtimePolicy.checkpointGapWarningThreshold,
    mainThreadPressureStrategy: runtimePolicy.mainThreadPressureStrategy,
    strategySummary: runtimePolicy.strategySummary,
  }
}

function readChapterPipelineSignals(task: TaskRow | null | undefined): {
  recallDegraded: boolean
  failureCode?: string
  lastFailureRole?: string
} {
  const progress = parseTaskProgress<Record<string, unknown>>(task)
  const recallSnapshot = progress.recallSnapshot
  return {
    recallDegraded: Boolean(
      recallSnapshot
      && typeof recallSnapshot === 'object'
      && !Array.isArray(recallSnapshot)
      && (recallSnapshot as Record<string, unknown>).degraded === true,
    ),
    failureCode: typeof progress.failureCode === 'string' ? progress.failureCode : undefined,
    lastFailureRole: typeof progress.lastFailureRole === 'string' ? progress.lastFailureRole : undefined,
  }
}

function getLatestWorkflowByType(novelId: number, type: BatchWorkflowTaskType) {
  const db = getDb()
  return db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .find((task) => task.type === type && task.runnerType === 'workflow') || null
}

function reconcileStaleBatchWorkflowTask(task: TaskRow | null): TaskRow | null {
  cleanupInactiveBatchWorkflowEntries()
  if (!task || task.runnerType !== 'workflow') return task
  if (activeBatchWorkflows.has(task.id)) return task
  if (!['running', 'cancel_requested'].includes(task.status || '')) return task

  const progress = parseTaskProgress<Record<string, unknown>>(task)
  updateTaskProgress(task.id, {
    ...progress,
    message: '应用重启后后台流程已暂停，可继续。',
  })
  updateTaskStatus(task.id, 'paused', undefined, {
    errorMessage: task.errorMessage || '应用重启后后台流程已暂停',
    currentChildTaskId: null,
  })
  return getTaskRecord(task.id)
}

function isCancelled(taskId: number): boolean {
  return Boolean(parseTaskControl(getTaskRecord(taskId))?.cancelRequested)
}

function createBaseStatus(taskId: number, novelId: number, requestedCount: number, batchSize: number, totalBatches: number) {
  return {
    taskId,
    novelId,
    status: 'pending' as const,
    requestedCount,
    batchSize,
    currentBatch: 0,
    totalBatches,
    resumeCursor: 0,
    generatedCount: 0,
    retryCount: 0,
    lastError: '',
    completed: requestedCount <= 0,
    message: requestedCount <= 0 ? '当前没有需要生成的内容。' : '等待开始后台生成。',
    batchDigest: '',
  }
}

function createInitialCharacterStatus(taskId: number, novelId: number, options: CharacterBatchGenerationOptions): CharacterAutoGenerateStatus {
  const requestedCount = options.majorCount + options.minorCount + (options.antagonistCount || 0) + (options.supportingCount || 0)
  const batchSize = Math.max(1, options.batchSize)
  const totalBatches = Math.max(1, Math.ceil(requestedCount / batchSize))
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, batchSize, totalBatches),
    acceptedIds: [],
    warnings: [],
    majorGenerated: 0,
    minorGenerated: 0,
    antagonistGenerated: 0,
    supportingGenerated: 0,
  }
}

function createInitialFactionStatus(taskId: number, novelId: number, options: FactionBatchGenerationOptions): FactionAutoGenerateStatus {
  return createInitialEntityStatus(
    taskId,
    novelId,
    clampPositiveInt(options.count, 8, 1, MAX_FACTION_GENERATION_COUNT),
    clampPositiveInt(options.batchSize, 1, 1, 8),
  )
}

function toCharacterStatus(taskId: number, task: TaskRow): CharacterAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<CharacterAutoGenerateStatus>>(task)
  const options = parseCharacterOptions(task.inputJson)
  const fallback = createInitialCharacterStatus(taskId, task.novelId || 0, options)
  return {
    ...fallback,
    status: task.status as CharacterAutoGenerateStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    acceptedIds: asNumberArray(progress.acceptedIds),
    warnings: asStringArray(progress.warnings),
    majorGenerated: typeof progress.majorGenerated === 'number' ? progress.majorGenerated : 0,
    minorGenerated: typeof progress.minorGenerated === 'number' ? progress.minorGenerated : 0,
    antagonistGenerated: typeof progress.antagonistGenerated === 'number' ? progress.antagonistGenerated : 0,
    supportingGenerated: typeof progress.supportingGenerated === 'number' ? progress.supportingGenerated : 0,
  }
}

function toFactionStatus(taskId: number, task: TaskRow): FactionAutoGenerateStatus {
  const options = resolveFactionWorkflowOptions(task.novelId || 0, task.inputJson)
  return toEntityStatus(taskId, task, {
    requestedCount: options.count,
    batchSize: options.batchSize,
  })
}

function createInitialEntityStatus(
  taskId: number,
  novelId: number,
  requestedCount: number,
  batchSize: number,
): ItemAutoGenerateStatus {
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, batchSize, Math.max(1, Math.ceil(requestedCount / Math.max(1, batchSize)))),
    acceptedIds: [],
    warnings: [],
  }
}

function toEntityStatus(
  taskId: number,
  task: TaskRow,
  options: { requestedCount: number; batchSize: number },
): ItemAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<ItemAutoGenerateStatus>>(task)
  const fallback = createInitialEntityStatus(taskId, task.novelId || 0, options.requestedCount, options.batchSize)
  return {
    ...fallback,
    status: task.status as ItemAutoGenerateStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    acceptedIds: asNumberArray(progress.acceptedIds),
    warnings: asStringArray(progress.warnings),
  }
}

function createInitialThreadStatus(taskId: number, novelId: number, options: StoryThreadBatchGenerateOptions): StoryThreadAutoGenerateStatus {
  const requestedCount = clampPositiveInt(options.count, 8, 1, MAX_THREAD_GENERATION_COUNT)
  const batchSize = clampPositiveInt(options.batchSize, Math.min(requestedCount, 4), 1, 12)
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, batchSize, Math.max(1, Math.ceil(requestedCount / Math.max(1, batchSize)))),
    acceptedIds: [],
    warnings: [],
  }
}

function toThreadStatus(taskId: number, task: TaskRow): StoryThreadAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<StoryThreadAutoGenerateStatus>>(task)
  const fallback = createInitialThreadStatus(taskId, task.novelId || 0, resolveThreadWorkflowOptions(task.novelId || 0, task.inputJson))
  return {
    ...fallback,
    status: task.status as StoryThreadAutoGenerateStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    acceptedIds: asNumberArray(progress.acceptedIds),
    warnings: asStringArray(progress.warnings),
  }
}

function createInitialSubplotStatus(taskId: number, request: SubplotAutoGenerateRequest): SubplotAutoGenerateStatus {
  const requestedCount = clampPositiveInt(request.subplotCount, 8, 1, MAX_SUBPLOT_GENERATION_COUNT)
  const batchSize = Math.min(3, requestedCount)
  return {
    ...createBaseStatus(taskId, request.novelId, requestedCount, batchSize, Math.max(1, Math.ceil(requestedCount / Math.max(1, batchSize)))),
    subplots: [],
    warnings: [],
  }
}

function toSubplotStatus(taskId: number, task: TaskRow): SubplotAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<SubplotAutoGenerateStatus>>(task)
  const fallback = createInitialSubplotStatus(taskId, parseSubplotRequest(task.inputJson))
  return {
    ...fallback,
    status: task.status as SubplotAutoGenerateStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    subplots: Array.isArray(progress.subplots) ? progress.subplots : fallback.subplots,
    warnings: asStringArray(progress.warnings),
  }
}

function createInitialChapterBatchStatus(taskId: number, novelId: number, options: ChapterBatchGenerateOptions): ChapterBatchAutoGenerateStatus {
  const requestedCount = options.chapterIds.length
  const runtimePolicy = getChapterBatchRuntimePolicy(novelId)
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, 1, Math.max(1, requestedCount)),
    chapterIds: [...options.chapterIds],
    completedChapterIds: [],
    failedChapterIds: [],
    warnings: [],
    consecutiveRecallFallbackChapters: 0,
    snapshotId: undefined,
    runtimePolicySnapshot: toRuntimePolicySnapshot(runtimePolicy),
    message: requestedCount <= 0 ? '当前没有需要批量生成的章节。' : '等待开始章节批量生成。',
  }
}

function toChapterBatchStatus(taskId: number, task: TaskRow): ChapterBatchAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<ChapterBatchAutoGenerateStatus>>(task)
  const fallback = createInitialChapterBatchStatus(taskId, task.novelId || 0, parseChapterBatchOptions(task.inputJson))
  return {
    ...fallback,
    status: task.status as ChapterBatchAutoGenerateStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    totalBatches: typeof progress.totalBatches === 'number' ? progress.totalBatches : fallback.totalBatches,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    chapterIds: asNumberArray(progress.chapterIds).length > 0 ? asNumberArray(progress.chapterIds) : fallback.chapterIds,
    completedChapterIds: asNumberArray(progress.completedChapterIds),
    failedChapterIds: asNumberArray(progress.failedChapterIds),
    warnings: asStringArray(progress.warnings),
    currentChapterId: typeof progress.currentChapterId === 'number' ? progress.currentChapterId : undefined,
    currentChapterNum: typeof progress.currentChapterNum === 'number' ? progress.currentChapterNum : undefined,
    pauseReason: typeof progress.pauseReason === 'string' ? progress.pauseReason : undefined,
    blockedChapterId: typeof progress.blockedChapterId === 'number' ? progress.blockedChapterId : undefined,
    blockedTaskId: typeof progress.blockedTaskId === 'number' ? progress.blockedTaskId : undefined,
    consecutiveRecallFallbackChapters: typeof progress.consecutiveRecallFallbackChapters === 'number'
      ? progress.consecutiveRecallFallbackChapters
      : 0,
    snapshotId: typeof progress.snapshotId === 'number' ? progress.snapshotId : undefined,
    currentWritebackStatus: asWritebackSyncStatus(progress.currentWritebackStatus),
    activeGuardrailReason: typeof progress.activeGuardrailReason === 'string' ? progress.activeGuardrailReason : undefined,
    runtimePolicySnapshot: progress.runtimePolicySnapshot && typeof progress.runtimePolicySnapshot === 'object' && !Array.isArray(progress.runtimePolicySnapshot)
      ? progress.runtimePolicySnapshot as ChapterBatchAutoGenerateStatus['runtimePolicySnapshot']
      : fallback.runtimePolicySnapshot,
  }
}

function parseChapterQualityAnalysisOptions(raw?: string | null): ChapterQualityAnalysisOptions {
  const record = asRecord(raw)
  return {
    chapterIds: asNumberArray(record.chapterIds),
    includeAiCheck: record.includeAiCheck !== false,
    includePublishCheck: record.includePublishCheck !== false,
  }
}

function normalizeChapterQualityAnalysisIds(value: unknown): number[] {
  return [...new Set(
    asNumberArray(value)
      .map((item) => Math.round(item))
      .filter((item) => item > 0),
  )]
}

function normalizeChapterQualityAnalysisOptions(novelId: number, options: ChapterQualityAnalysisOptions = {}): ChapterQualityAnalysisOptions {
  const explicitIds = normalizeChapterQualityAnalysisIds(options.chapterIds)
  const availableChapters = getDb().select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.content?.trim())
  const explicitIdSet = new Set(explicitIds)
  const chapterIds = explicitIds.length > 0
    ? availableChapters.filter((chapter) => explicitIdSet.has(chapter.id)).map((chapter) => chapter.id)
    : availableChapters.map((chapter) => chapter.id)
  return {
    chapterIds,
    includeAiCheck: options.includeAiCheck !== false,
    includePublishCheck: options.includePublishCheck !== false,
  }
}

function createInitialChapterQualityAnalysisStatus(
  taskId: number,
  novelId: number,
  options: ChapterQualityAnalysisOptions,
): ChapterQualityAnalysisStatus {
  const chapterIds = asNumberArray(options.chapterIds)
  const requestedCount = chapterIds.length
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, 1, Math.max(1, requestedCount)),
    chapterIds,
    completedChapterIds: [],
    failedChapterIds: [],
    warnings: [],
    inspectionIds: [],
    publishBlockedChapterIds: [],
    publishRewriteChapterIds: [],
    generatedRevisionTaskCount: 0,
    aiCheckFailureCount: 0,
    publishCheckFailureCount: 0,
    message: requestedCount <= 0 ? '当前没有可分析的章节正文。' : '等待开始逐章 AI 体检队列。',
  }
}

function toChapterQualityAnalysisStatus(taskId: number, task: TaskRow): ChapterQualityAnalysisStatus {
  const progress = parseTaskProgress<Partial<ChapterQualityAnalysisStatus>>(task)
  const fallback = createInitialChapterQualityAnalysisStatus(taskId, task.novelId || 0, parseChapterQualityAnalysisOptions(task.inputJson))
  return {
    ...fallback,
    status: task.status as ChapterQualityAnalysisStatus['status'],
    currentBatch: typeof progress.currentBatch === 'number' ? progress.currentBatch : fallback.currentBatch,
    totalBatches: typeof progress.totalBatches === 'number' ? progress.totalBatches : fallback.totalBatches,
    resumeCursor: typeof progress.resumeCursor === 'number' ? progress.resumeCursor : fallback.resumeCursor,
    generatedCount: typeof progress.generatedCount === 'number' ? progress.generatedCount : fallback.generatedCount,
    retryCount: typeof progress.retryCount === 'number' ? progress.retryCount : fallback.retryCount,
    lastError: typeof progress.lastError === 'string' ? progress.lastError : fallback.lastError,
    completed: progress.completed === true || fallback.completed,
    message: typeof progress.message === 'string' ? progress.message : fallback.message,
    batchDigest: typeof progress.batchDigest === 'string' ? progress.batchDigest : fallback.batchDigest,
    chapterIds: asNumberArray(progress.chapterIds).length > 0 ? asNumberArray(progress.chapterIds) : fallback.chapterIds,
    completedChapterIds: asNumberArray(progress.completedChapterIds),
    failedChapterIds: asNumberArray(progress.failedChapterIds),
    warnings: asStringArray(progress.warnings),
    currentChapterId: typeof progress.currentChapterId === 'number' ? progress.currentChapterId : undefined,
    currentChapterNum: typeof progress.currentChapterNum === 'number' ? progress.currentChapterNum : undefined,
    snapshotId: typeof progress.snapshotId === 'number' ? progress.snapshotId : undefined,
    inspectionIds: asNumberArray(progress.inspectionIds),
    publishBlockedChapterIds: asNumberArray(progress.publishBlockedChapterIds),
    publishRewriteChapterIds: asNumberArray(progress.publishRewriteChapterIds),
    generatedRevisionTaskCount: typeof progress.generatedRevisionTaskCount === 'number' ? progress.generatedRevisionTaskCount : 0,
    aiCheckFailureCount: typeof progress.aiCheckFailureCount === 'number' ? progress.aiCheckFailureCount : 0,
    publishCheckFailureCount: typeof progress.publishCheckFailureCount === 'number' ? progress.publishCheckFailureCount : 0,
  }
}

function mergeWarnings(current: string[], next?: string | string[] | null): string[] {
  const values = Array.isArray(next) ? next : next ? [next] : []
  return [...current, ...values.filter((item) => item.trim())]
}

function getRunningTask(taskId: number, sender?: WebContents) {
  const task = getTaskRecord(taskId)
  if (!task || !task.novelId) {
    throwUserFacingError('workflow.taskNotFound', { taskId })
  }
  updateTaskControl(taskId, {
    ...parseTaskControl(task),
    cancelRequested: false,
    maxRetries: DEFAULT_MAX_RETRIES,
  })
  updateTaskStatus(taskId, 'running', sender)
  return task
}

function ensureSuccessfulTask(task: TaskRow) {
  if (task.status === 'success') return
  const progress = parseTaskProgress<Record<string, unknown>>(task)
  const message = typeof progress.message === 'string' && progress.message.trim()
    ? progress.message
    : (task.errorMessage || '后台批量流程未成功完成')
  throw new Error(message)
}

type BatchWorkflowProgress =
  | CharacterAutoGenerateStatus
  | FactionAutoGenerateStatus
  | ItemAutoGenerateStatus
  | TimelineAutoGenerateStatus
  | StoryThreadAutoGenerateStatus
  | SubplotAutoGenerateStatus
  | ChapterBatchAutoGenerateStatus
  | ChapterQualityAnalysisStatus

function getBatchWorkflowProgress(taskId: number, task: TaskRow): BatchWorkflowProgress {
  if (task.type === 'character_auto_generate') {
    return toCharacterStatus(taskId, task)
  }

  if (task.type === 'faction_auto_generate') {
    return toFactionStatus(taskId, task)
  }

  if (task.type === 'item_auto_generate') {
    const options = resolveItemWorkflowOptions(task.novelId || 0, task.inputJson)
    return toEntityStatus(taskId, task, {
      requestedCount: options.count || 8,
      batchSize: options.batchSize || 4,
    })
  }

  if (task.type === 'timeline_auto_generate') {
    const options = resolveTimelineWorkflowOptions(task.novelId || 0, task.inputJson)
    return toEntityStatus(taskId, task, {
      requestedCount: options.count || 10,
      batchSize: options.batchSize || 4,
    })
  }

  if (task.type === 'story_thread_auto_generate') {
    return toThreadStatus(taskId, task)
  }

  if (task.type === 'chapter_batch_generate') {
    return toChapterBatchStatus(taskId, task)
  }

  if (task.type === 'chapter_quality_analysis') {
    return toChapterQualityAnalysisStatus(taskId, task)
  }

  return toSubplotStatus(taskId, task)
}

function settleBatchWorkflowFatalError(taskId: number, sender: WebContents | undefined, error: unknown) {
  const task = getTaskRecord(taskId)
  if (!task || task.runnerType !== 'workflow' || !isBatchWorkflowType(task.type)) {
    console.error(`[batch-workflow] Fatal workflow recovery failed for task ${taskId}:`, error)
    return
  }

  const control = parseTaskControl(task)
  const progress = getBatchWorkflowProgress(taskId, task)
  const isAbort = error instanceof Error && error.name === 'AbortError'

  updateTaskControl(taskId, {
    ...control,
    cancelRequested: false,
  })

  if (isAbort || control.cancelRequested) {
    updateTaskProgress(taskId, {
      ...progress,
      status: 'cancelled',
      retryCount: 0,
      lastError: '',
      message: task.type === 'subplot_auto_generate' ? '支线批量生成已停止。' : '批量生成已停止。',
    }, sender)
    updateTaskStatus(taskId, 'cancelled', sender, {
      errorMessage: '用户已取消',
      currentChildTaskId: null,
    })
    return
  }

  const errorMessage = error instanceof Error ? error.message : '后台批量流程失败'
  const resumeMessage = progress.generatedCount > 0 || progress.resumeCursor > 0
    ? '后台批量流程发生异常，已保留当前进度，可继续。'
    : '后台批量流程在准备阶段失败，任务已暂停，可继续。'

  updateTaskProgress(taskId, {
    ...progress,
    status: 'paused',
    retryCount: Math.max(progress.retryCount, control.retryCount || 0),
    lastError: errorMessage,
    message: resumeMessage,
  }, sender)
  updateTaskStatus(taskId, 'paused', sender, {
    errorMessage,
    currentChildTaskId: null,
  })
}

async function runCharacterAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (!tryRegisterActiveBatchWorkflow(taskId)) return

  try {
    const task = getRunningTask(taskId, sender)
    const options = parseCharacterOptions(task.inputJson)
    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialCharacterStatus(taskId, task.novelId || 0, options), sender)
    }

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break
      const control = parseTaskControl(latestTask)
      const progress = toCharacterStatus(taskId, latestTask)

      if (control.cancelRequested) {
        updateTaskProgress(taskId, { ...progress, status: 'cancelled', message: '人物批量生成已停止。' }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.requestedCount <= 0 || progress.generatedCount >= progress.requestedCount) {
        const done = {
          ...progress,
          status: 'success' as const,
          completed: true,
          message: `人物批量任务完成，已生成 ${progress.generatedCount}/${progress.requestedCount} 位角色。`,
        }
        updateTaskProgress(taskId, done, sender)
        updateTaskStatus(taskId, 'success', sender, { outputText: done.message, errorMessage: null, currentChildTaskId: null })
        break
      }

      const maxAttempts = Math.max(
        Math.ceil(progress.requestedCount / Math.max(1, progress.batchSize)) + DEFAULT_MAX_RETRIES,
        progress.requestedCount * 2,
      )
      if (progress.resumeCursor >= maxAttempts) {
        const paused = {
          ...progress,
          status: 'paused' as const,
          completed: false,
          lastError: `人物批量任务达到最大尝试次数，当前仅生成 ${progress.generatedCount}/${progress.requestedCount} 位角色。`,
          message: '已达到最大尝试次数，仍未补齐人物配额。请调整角色要求或减少数量后继续。',
        }
        updateTaskProgress(taskId, paused, sender)
        updateTaskStatus(taskId, 'paused', sender, { errorMessage: paused.lastError, currentChildTaskId: null })
        break
      }

      const effectiveTotalBatches = Math.max(
        progress.totalBatches,
        progress.resumeCursor + Math.ceil(Math.max(1, progress.requestedCount - progress.generatedCount) / Math.max(1, progress.batchSize)),
      )
      const currentBatch = progress.resumeCursor + 1
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        totalBatches: effectiveTotalBatches,
        currentBatch,
        completed: false,
        message: `正在执行第 ${currentBatch}/${effectiveTotalBatches} 批人物生成。`,
      }, sender)

      try {
        const remainingCounts = {
          majorCount: Math.max(0, options.majorCount - progress.majorGenerated),
          minorCount: Math.max(0, options.minorCount - progress.minorGenerated),
          antagonistCount: Math.max(0, (options.antagonistCount || 0) - progress.antagonistGenerated),
          supportingCount: Math.max(0, (options.supportingCount || 0) - progress.supportingGenerated),
        }
        const remainingRoleQueue = [
          ...Array.from({ length: remainingCounts.majorCount }, () => 'major' as const),
          ...Array.from({ length: remainingCounts.antagonistCount }, () => 'antagonist' as const),
          ...Array.from({ length: remainingCounts.supportingCount }, () => 'supporting' as const),
          ...Array.from({ length: remainingCounts.minorCount }, () => 'minor' as const),
        ]
        const batchRoleQueue = remainingRoleQueue.slice(0, Math.max(1, Math.min(progress.batchSize, remainingRoleQueue.length)))
        const countRole = (role: typeof batchRoleQueue[number]) => batchRoleQueue.filter((item) => item === role).length
        const remaining = {
          ...options,
          majorCount: countRole('major'),
          minorCount: countRole('minor'),
          antagonistCount: countRole('antagonist'),
          supportingCount: countRole('supporting'),
          batchSize: Math.max(1, batchRoleQueue.length),
        }
        const result = await generateCharacterBatchChunk(latestTask.novelId, remaining, {
          parentTaskId: taskId,
          sender,
          batchIndex: currentBatch,
          totalBatches: effectiveTotalBatches,
        })
        const nextGeneratedCount = progress.generatedCount + result.ids.length
        const nextTotalBatches = nextGeneratedCount >= progress.requestedCount
          ? effectiveTotalBatches
          : Math.max(
              effectiveTotalBatches,
              progress.resumeCursor + 1 + Math.ceil((progress.requestedCount - nextGeneratedCount) / Math.max(1, progress.batchSize)),
            )
        const nextProgress: CharacterAutoGenerateStatus = {
          ...progress,
          status: 'running',
          totalBatches: nextTotalBatches,
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: nextGeneratedCount,
          retryCount: 0,
          lastError: '',
          acceptedIds: [...progress.acceptedIds, ...result.ids],
          warnings: mergeWarnings(progress.warnings, result.warning),
          batchDigest: result.batchDigest || progress.batchDigest,
          majorGenerated: progress.majorGenerated + result.majorGenerated,
          minorGenerated: progress.minorGenerated + result.minorGenerated,
          antagonistGenerated: progress.antagonistGenerated + result.antagonistGenerated,
          supportingGenerated: progress.supportingGenerated + result.supportingGenerated,
          completed: nextGeneratedCount >= progress.requestedCount,
          message: result.ids.length > 0
            ? `第 ${currentBatch}/${nextTotalBatches} 批已完成，新增 ${result.ids.length} 位角色。`
            : (result.warning || `第 ${currentBatch}/${nextTotalBatches} 批未生成可用人物。`),
        }
        updateTaskControl(taskId, { ...parseTaskControl(latestTask), cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 })
        updateTaskProgress(taskId, nextProgress, sender)
      } catch (error) {
        const currentTask = getTaskRecord(taskId) || latestTask
        const currentControl = parseTaskControl(currentTask)
        const currentProgress = toCharacterStatus(taskId, currentTask)
        const nextRetryCount = (currentControl.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : '人物批量生成失败'
        updateTaskControl(taskId, { ...currentControl, maxRetries: DEFAULT_MAX_RETRIES, retryCount: nextRetryCount })
        if (nextRetryCount > DEFAULT_MAX_RETRIES) {
          updateTaskProgress(taskId, {
            ...currentProgress,
            status: 'paused',
            retryCount: nextRetryCount,
            lastError: errorMessage,
            message: `人物批次连续失败 ${nextRetryCount} 次，任务已暂停。`,
          }, sender)
          updateTaskStatus(taskId, 'paused', sender, { errorMessage, currentChildTaskId: null })
          break
        }
        updateTaskProgress(taskId, {
          ...currentProgress,
          status: 'running',
          retryCount: nextRetryCount,
          lastError: errorMessage,
          message: `当前人物批次失败，正在进行第 ${nextRetryCount} 次重试。`,
        }, sender)
      }
    }
  } catch (error) {
    settleBatchWorkflowFatalError(taskId, sender, error)
  } finally {
    unregisterActiveBatchWorkflow(taskId)
  }
}

async function runSimpleEntityWorkflow(
  taskId: number,
  sender: WebContents | undefined,
  type: 'faction' | 'item' | 'timeline' | 'thread',
) {
  if (!tryRegisterActiveBatchWorkflow(taskId)) return

  try {
    const task = getRunningTask(taskId, sender)
    if (!task.progressJson) {
      if (type === 'faction') {
        const opts = resolveFactionWorkflowOptions(task.novelId || 0, task.inputJson)
        updateTaskProgress(taskId, createInitialFactionStatus(taskId, task.novelId || 0, opts), sender)
      } else if (type === 'item') {
        const opts = resolveItemWorkflowOptions(task.novelId || 0, task.inputJson)
        updateTaskProgress(taskId, createInitialEntityStatus(taskId, task.novelId || 0, opts.count || 8, opts.batchSize || 4), sender)
      } else if (type === 'timeline') {
        const opts = resolveTimelineWorkflowOptions(task.novelId || 0, task.inputJson)
        updateTaskProgress(taskId, createInitialEntityStatus(taskId, task.novelId || 0, opts.count || 10, opts.batchSize || 4), sender)
      } else {
        updateTaskProgress(taskId, createInitialThreadStatus(taskId, task.novelId || 0, resolveThreadWorkflowOptions(task.novelId || 0, task.inputJson)), sender)
      }
    }

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break
      const control = parseTaskControl(latestTask)
      const progress = type === 'thread'
        ? toThreadStatus(taskId, latestTask)
        : toEntityStatus(
            taskId,
            latestTask,
            type === 'faction'
              ? { requestedCount: resolveFactionWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).count || 8, batchSize: resolveFactionWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).batchSize || 1 }
              : type === 'item'
              ? { requestedCount: resolveItemWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).count || 8, batchSize: resolveItemWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).batchSize || 4 }
              : { requestedCount: resolveTimelineWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).count || 10, batchSize: resolveTimelineWorkflowOptions(latestTask.novelId || 0, latestTask.inputJson).batchSize || 4 },
          )

      if (control.cancelRequested) {
        updateTaskProgress(taskId, { ...progress, status: 'cancelled', message: '批量生成已停止。' }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.completed || progress.generatedCount >= progress.requestedCount) {
        const done = {
          ...progress,
          status: 'success' as const,
          completed: true,
          message: `批量任务完成，已生成 ${progress.generatedCount}/${progress.requestedCount} 条内容。`,
        }
        updateTaskProgress(taskId, done, sender)
        updateTaskStatus(taskId, 'success', sender, { outputText: done.message, errorMessage: null, currentChildTaskId: null })
        break
      }

      const maxAttempts = Math.max(
        Math.ceil(progress.requestedCount / Math.max(1, progress.batchSize)) + DEFAULT_MAX_RETRIES,
        progress.requestedCount * 2,
      )
      if (progress.resumeCursor >= maxAttempts) {
        const paused = {
          ...progress,
          status: 'paused' as const,
          completed: false,
          lastError: `批量任务达到最大尝试次数，当前仅生成 ${progress.generatedCount}/${progress.requestedCount} 条。`,
          message: `已达到最大尝试次数，仍未补齐目标数量。请调整聚焦方向或减少目标后继续。`,
        }
        updateTaskProgress(taskId, paused, sender)
        updateTaskStatus(taskId, 'paused', sender, { errorMessage: paused.lastError, currentChildTaskId: null })
        break
      }

      const effectiveTotalBatches = Math.max(
        progress.totalBatches,
        progress.resumeCursor + Math.ceil(Math.max(1, progress.requestedCount - progress.generatedCount) / Math.max(1, progress.batchSize)),
      )
      const currentBatch = progress.resumeCursor + 1
      updateTaskProgress(taskId, {
        ...progress,
        totalBatches: effectiveTotalBatches,
        status: 'running',
        currentBatch,
        completed: false,
        message: `正在执行第 ${currentBatch}/${effectiveTotalBatches} 批。`,
      }, sender)

      try {
        const batchCount = Math.min(progress.batchSize, Math.max(0, progress.requestedCount - progress.generatedCount))
        const result = type === 'faction'
          ? await generateFactionBatchChunk(latestTask.novelId, {
              ...resolveFactionWorkflowOptions(latestTask.novelId, latestTask.inputJson),
              count: batchCount,
              batchSize: batchCount,
            }, {
              parentTaskId: taskId,
              sender,
              batchIndex: currentBatch,
              totalBatches: effectiveTotalBatches,
            })
          : type === 'item'
          ? await generateStoryItemsBatchChunk(latestTask.novelId, {
              ...resolveItemWorkflowOptions(latestTask.novelId, latestTask.inputJson),
              count: batchCount,
              batchSize: batchCount,
            }, {
              parentTaskId: taskId,
              sender,
              batchIndex: currentBatch,
              totalBatches: effectiveTotalBatches,
            })
          : type === 'timeline'
            ? await generateTimelineBatchChunk(latestTask.novelId, {
                ...resolveTimelineWorkflowOptions(latestTask.novelId, latestTask.inputJson),
                count: batchCount,
                batchSize: batchCount,
              }, {
                parentTaskId: taskId,
                sender,
                batchIndex: currentBatch,
                totalBatches: effectiveTotalBatches,
              })
            : await generateStoryThreadBatchChunk(latestTask.novelId, {
                ...resolveThreadWorkflowOptions(latestTask.novelId, latestTask.inputJson),
                count: batchCount,
                batchSize: batchCount,
              }, {
                parentTaskId: taskId,
                sender,
                batchIndex: currentBatch,
                totalBatches: effectiveTotalBatches,
              })

        const chunkWarnings = 'warnings' in result ? result.warnings : result.warning
        const nextWarnings = mergeWarnings(progress.warnings, chunkWarnings)
        const nextGeneratedCount = progress.generatedCount + result.ids.length
        const nextTotalBatches = nextGeneratedCount >= progress.requestedCount
          ? effectiveTotalBatches
          : Math.max(
              effectiveTotalBatches,
              progress.resumeCursor + 1 + Math.ceil((progress.requestedCount - nextGeneratedCount) / Math.max(1, progress.batchSize)),
            )
        const nextProgress = {
          ...progress,
          status: 'running' as const,
          totalBatches: nextTotalBatches,
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: nextGeneratedCount,
          retryCount: 0,
          lastError: '',
          acceptedIds: [...progress.acceptedIds, ...result.ids],
          warnings: nextWarnings,
          batchDigest: result.batchDigest || progress.batchDigest,
          completed: nextGeneratedCount >= progress.requestedCount,
          message: result.ids.length > 0
            ? `第 ${currentBatch}/${nextTotalBatches} 批已完成，新增 ${result.ids.length} 条。`
            : (Array.isArray(chunkWarnings)
              ? (chunkWarnings[0] || `第 ${currentBatch}/${nextTotalBatches} 批没有生成可用结果。`)
              : (chunkWarnings || `第 ${currentBatch}/${nextTotalBatches} 批没有生成可用结果。`)),
        }
        updateTaskControl(taskId, { ...parseTaskControl(latestTask), cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 })
        updateTaskProgress(taskId, nextProgress, sender)
      } catch (error) {
        const currentTask = getTaskRecord(taskId) || latestTask
        const currentControl = parseTaskControl(currentTask)
        const currentProgress = type === 'thread'
          ? toThreadStatus(taskId, currentTask)
          : toEntityStatus(
              taskId,
              currentTask,
              type === 'faction'
                ? { requestedCount: resolveFactionWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).count || 8, batchSize: resolveFactionWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).batchSize || 1 }
                : type === 'item'
                ? { requestedCount: resolveItemWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).count || 8, batchSize: resolveItemWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).batchSize || 4 }
                : { requestedCount: resolveTimelineWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).count || 10, batchSize: resolveTimelineWorkflowOptions(currentTask.novelId || 0, currentTask.inputJson).batchSize || 4 },
            )
        const nextRetryCount = (currentControl.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : '批量生成失败'
        updateTaskControl(taskId, { ...currentControl, maxRetries: DEFAULT_MAX_RETRIES, retryCount: nextRetryCount })
        if (nextRetryCount > DEFAULT_MAX_RETRIES) {
          updateTaskProgress(taskId, {
            ...currentProgress,
            status: 'paused',
            retryCount: nextRetryCount,
            lastError: errorMessage,
            message: `当前批次连续失败 ${nextRetryCount} 次，任务已暂停。`,
          }, sender)
          updateTaskStatus(taskId, 'paused', sender, { errorMessage, currentChildTaskId: null })
          break
        }
        updateTaskProgress(taskId, {
          ...currentProgress,
          status: 'running',
          retryCount: nextRetryCount,
          lastError: errorMessage,
          message: `当前批次失败，正在进行第 ${nextRetryCount} 次重试。`,
        }, sender)
      }
    }
  } catch (error) {
    settleBatchWorkflowFatalError(taskId, sender, error)
  } finally {
    unregisterActiveBatchWorkflow(taskId)
  }
}

function pauseChapterBatchWorkflow(
  taskId: number,
  sender: WebContents | undefined,
  progress: ChapterBatchAutoGenerateStatus,
  options: {
    message: string
    errorMessage: string
    chapterId?: number
    chapterNum?: number
    childTaskId?: number
    warnings?: string | string[]
    consecutiveRecallFallbackChapters?: number
    currentWritebackStatus?: WritebackSyncStatus
    activeGuardrailReason?: string
  },
) {
  const nextProgress: ChapterBatchAutoGenerateStatus = {
    ...progress,
    status: 'paused',
    currentBatch: Math.min(progress.totalBatches, progress.resumeCursor + 1),
    completed: false,
    lastError: options.errorMessage,
    message: options.message,
    pauseReason: options.message,
    blockedChapterId: options.chapterId,
    blockedTaskId: options.childTaskId,
    currentChapterId: options.chapterId ?? progress.currentChapterId,
    currentChapterNum: options.chapterNum ?? progress.currentChapterNum,
    currentWritebackStatus: options.currentWritebackStatus || progress.currentWritebackStatus,
    failedChapterIds: appendUniqueNumber(progress.failedChapterIds, options.chapterId),
    warnings: appendUniqueStrings(progress.warnings, options.warnings),
    activeGuardrailReason: options.activeGuardrailReason || progress.activeGuardrailReason,
    consecutiveRecallFallbackChapters: typeof options.consecutiveRecallFallbackChapters === 'number'
      ? options.consecutiveRecallFallbackChapters
      : progress.consecutiveRecallFallbackChapters,
  }
  updateTaskProgress(taskId, nextProgress, sender)
  updateTaskStatus(taskId, 'paused', sender, {
    errorMessage: options.errorMessage,
    currentChildTaskId: null,
  })
}

async function runChapterBatchGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (!tryRegisterActiveBatchWorkflow(taskId)) return

  try {
    const task = getRunningTask(taskId, sender)
    const options = parseChapterBatchOptions(task.inputJson)
    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialChapterBatchStatus(taskId, task.novelId || 0, options), sender)
    }

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break
      const control = parseTaskControl(latestTask)
      const progress = toChapterBatchStatus(taskId, latestTask)
      const runtimePolicy = getChapterBatchRuntimePolicy(latestTask.novelId)
      const runtimePolicySnapshot = toRuntimePolicySnapshot(runtimePolicy)

      if (control.cancelRequested) {
        updateTaskProgress(taskId, {
          ...progress,
          status: 'cancelled',
          runtimePolicySnapshot,
          message: '章节批量生成已停止。',
        }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.completed || progress.resumeCursor >= progress.totalBatches || progress.resumeCursor >= progress.chapterIds.length) {
        if (typeof progress.snapshotId === 'number') {
          markChapterBatchSnapshotCompleted(progress.snapshotId)
        }
        const done: ChapterBatchAutoGenerateStatus = {
          ...progress,
          status: 'success',
          completed: true,
          runtimePolicySnapshot,
          activeGuardrailReason: undefined,
          currentChapterId: undefined,
          currentChapterNum: undefined,
          blockedChapterId: undefined,
          blockedTaskId: undefined,
          pauseReason: undefined,
          message: `章节批量任务完成，已完成 ${progress.completedChapterIds.length}/${progress.chapterIds.length} 章。`,
        }
        updateTaskProgress(taskId, done, sender)
        updateTaskStatus(taskId, 'success', sender, { outputText: done.message, errorMessage: null, currentChildTaskId: null })
        break
      }

      const chapterId = progress.chapterIds[progress.resumeCursor]
      const chapter = typeof chapterId === 'number' ? getChapter(chapterId) : null
      const currentBatch = progress.resumeCursor + 1

      if (!chapter || chapter.novelId !== latestTask.novelId) {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          message: `第 ${currentBatch}/${progress.totalBatches} 章缺失或不属于当前作品，任务已暂停。`,
          errorMessage: '章节不存在或归属作品不匹配',
          activeGuardrailReason: '正文串行链路要求当前章归属明确，异常章节会立即暂停。',
        })
        break
      }

      const chapterNum = chapter.chapterNum
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        currentBatch,
        runtimePolicySnapshot,
        activeGuardrailReason: runtimePolicy.operatingMode === 'million_longform'
          ? '百万字模式护栏：正文保持串行，允许后台预计算，但章后回写必须先闭环。'
          : undefined,
        currentChapterId: chapterId,
        currentChapterNum: chapterNum,
        currentWritebackStatus: parseChapterWritebackSyncStatus(chapter.writebackStatusJson),
        blockedChapterId: undefined,
        blockedTaskId: undefined,
        pauseReason: undefined,
        message: `正在生成第 ${currentBatch}/${progress.totalBatches} 章（第 ${chapterNum} 章）。`,
      }, sender)

      const childTaskId = await generateChapterContent(chapterId, sender)
      updateTask(taskId, { currentChildTaskId: childTaskId })
      const childTask = await waitForWorkflowTask(childTaskId)
      const childSignals = readChapterPipelineSignals(childTask)

      if (childTask.status !== 'success') {
        const childError = childTask.errorMessage || (typeof childTask.outputText === 'string' && childTask.outputText.trim()) || '章节流水线未成功完成'
        const childReason = childSignals.failureCode
          ? `${childError}（${childSignals.failureCode}${childSignals.lastFailureRole ? ` / ${childSignals.lastFailureRole}` : ''}）`
          : childError
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `第 ${chapterNum} 章流水线未完成，章节批量任务已暂停：${childReason}`,
          errorMessage: childError,
        })
        break
      }

      const publishCheck = runChapterPublishCheck(chapterId)
      if (publishCheck.gateLevel === 'blocker' || publishCheck.gateLevel === 'rewrite') {
        const gateLabel = publishCheck.gateLevel === 'rewrite' ? '要求重写' : '阻断'
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `第 ${chapterNum} 章章节门${gateLabel}，章节批量任务已暂停：${publishCheck.summary}`,
          errorMessage: publishCheck.summary,
        })
        break
      }

      const refreshedChapter = getChapter(chapterId)
      const writebackStatus = parseChapterWritebackSyncStatus(refreshedChapter?.writebackStatusJson)
      if (runtimePolicy.requireWritebackReady && (writebackStatus?.blockedGeneration || writebackStatus?.canonApplied === false || writebackStatus?.readyForNextChapter === false)) {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `第 ${chapterNum} 章等待章后回写完成，章节批量任务已暂停：${writebackStatus.lastError || '请先处理当前章的回写同步状态。'}`,
          errorMessage: writebackStatus.lastError || '章后回写未完成',
          warnings: `第 ${chapterNum} 章回写状态：${getWritebackPhaseLabel(writebackStatus.phase)}`,
          currentWritebackStatus: writebackStatus,
          activeGuardrailReason: runtimePolicy.operatingMode === 'million_longform'
            ? '百万字模式护栏生效：章后回写未闭环前，不允许推进下一章，避免状态乱序。'
            : '章后回写护栏生效：当前章状态尚未回写完成。',
        })
        break
      }

      const feedbackPauseSignal = getFeedbackRecurrenceBatchPauseSignal(chapter.novelId, chapterNum)
      if (feedbackPauseSignal) {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `第 ${chapterNum} 章触发审校复现闭环暂停：${feedbackPauseSignal.detail}`,
          errorMessage: feedbackPauseSignal.detail,
          warnings: `审校复现高风险：${feedbackPauseSignal.title}`,
        })
        break
      }

      const nextRecallStreak = childSignals.recallDegraded
        ? progress.consecutiveRecallFallbackChapters + 1
        : 0
      if (nextRecallStreak >= runtimePolicy.recallPauseThreshold) {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `最近已连续 ${nextRecallStreak} 章召回降级，章节批量任务已在第 ${chapterNum} 章后自动暂停。`,
          errorMessage: '连续召回降级达到暂停阈值',
          warnings: `第 ${chapterNum} 章召回已降级，连续 ${nextRecallStreak} 章触发自动暂停（阈值 ${runtimePolicy.recallPauseThreshold}）。`,
          consecutiveRecallFallbackChapters: nextRecallStreak,
          activeGuardrailReason: runtimePolicy.operatingMode === 'million_longform'
            ? `百万字模式护栏生效：连续召回降级达到 ${runtimePolicy.recallPauseThreshold} 章，先恢复记忆链路再继续。`
            : `召回护栏生效：连续召回降级达到 ${runtimePolicy.recallPauseThreshold} 章。`,
        })
        break
      }

      const nextWarnings = appendUniqueStrings(progress.warnings, [
        publishCheck.gateLevel === 'warning' ? `第 ${chapterNum} 章章节门告警：${publishCheck.summary}` : '',
        childSignals.recallDegraded ? `第 ${chapterNum} 章召回已降级，但未达到自动暂停阈值 ${runtimePolicy.recallPauseThreshold}。` : '',
      ])
      const nextProgress: ChapterBatchAutoGenerateStatus = {
        ...progress,
        status: 'running',
        currentBatch,
        runtimePolicySnapshot,
        resumeCursor: progress.resumeCursor + 1,
        generatedCount: progress.generatedCount + 1,
        retryCount: 0,
        lastError: '',
        completed: progress.resumeCursor + 1 >= progress.totalBatches,
        chapterIds: progress.chapterIds,
        completedChapterIds: appendUniqueNumber(progress.completedChapterIds, chapterId),
        failedChapterIds: progress.failedChapterIds,
        warnings: nextWarnings,
        currentChapterId: chapterId,
        currentChapterNum: chapterNum,
        currentWritebackStatus: writebackStatus,
        blockedChapterId: undefined,
        blockedTaskId: undefined,
        pauseReason: undefined,
        activeGuardrailReason: runtimePolicy.operatingMode === 'million_longform'
          ? '百万字模式护栏已接管：正文串行执行，继续推进前必须保持回写闭环。'
          : undefined,
        consecutiveRecallFallbackChapters: nextRecallStreak,
        batchDigest: chapter.title || `第${chapterNum}章`,
        message: `第 ${chapterNum} 章已完成，可继续处理下一章。`,
      }
      updateTaskControl(taskId, {
        ...parseTaskControl(latestTask),
        cancelRequested: false,
        maxRetries: DEFAULT_MAX_RETRIES,
        retryCount: 0,
      })
      updateTaskProgress(taskId, nextProgress, sender)
      updateTask(taskId, { currentChildTaskId: null })
    }
  } catch (error) {
    settleBatchWorkflowFatalError(taskId, sender, error)
  } finally {
    unregisterActiveBatchWorkflow(taskId)
  }
}

function createAnalysisInspection(
  snapshotId: number | undefined,
  params: {
    chapterId?: number
    chapterNum?: number
    status: 'pass' | 'warning' | 'blocked'
    category: 'ai' | 'continuity'
    note: string
  },
): number | undefined {
  if (typeof snapshotId !== 'number') return undefined
  try {
    return createBatchInspection(snapshotId, {
      chapterId: params.chapterId,
      chapterNum: params.chapterNum,
      category: params.category,
      status: params.status,
      note: params.note,
    }).id
  } catch (error) {
    console.warn('[chapter-quality-analysis] failed to create inspection:', error)
    return undefined
  }
}

async function runChapterQualityAnalysisWorkflow(taskId: number, sender?: WebContents) {
  if (!tryRegisterActiveBatchWorkflow(taskId)) return

  try {
    const task = getRunningTask(taskId, sender)
    const options = parseChapterQualityAnalysisOptions(task.inputJson)
    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialChapterQualityAnalysisStatus(taskId, task.novelId || 0, options), sender)
    }

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break
      const control = parseTaskControl(latestTask)
      const progress = toChapterQualityAnalysisStatus(taskId, latestTask)

      if (control.cancelRequested) {
        updateTaskProgress(taskId, {
          ...progress,
          status: 'cancelled',
          message: '逐章 AI 体检队列已停止。',
        }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.resumeCursor >= progress.chapterIds.length) {
        const failedCount = progress.failedChapterIds.length
        let warnings = progress.warnings
        if (typeof progress.snapshotId === 'number') {
          try {
            markChapterBatchSnapshotCompleted(progress.snapshotId)
          } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误'
            warnings = appendUniqueStrings(warnings, `逐章分析快照完成标记失败：${message}`)
          }
        }
        const done: ChapterQualityAnalysisStatus = {
          ...progress,
          status: 'success',
          completed: true,
          warnings,
          currentChapterId: undefined,
          currentChapterNum: undefined,
          message: failedCount > 0
            ? `逐章分析完成：${progress.completedChapterIds.length}/${progress.chapterIds.length} 章执行成功，${failedCount} 章失败已记录。`
            : `逐章分析完成：${progress.completedChapterIds.length}/${progress.chapterIds.length} 章执行成功。`,
        }
        updateTaskProgress(taskId, done, sender)
        updateTaskStatus(taskId, 'success', sender, {
          outputText: done.message,
          errorMessage: null,
          currentChildTaskId: null,
        })
        break
      }

      const currentBatch = progress.resumeCursor + 1
      const chapterId = progress.chapterIds[progress.resumeCursor]
      const chapter = getChapter(chapterId)
      const chapterNum = chapter?.chapterNum || currentBatch
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        currentBatch,
        currentChapterId: chapterId,
        currentChapterNum: chapterNum,
        message: `正在分析第 ${chapterNum} 章（${currentBatch}/${progress.totalBatches}）。`,
      }, sender)

      let nextProgress = toChapterQualityAnalysisStatus(taskId, getTaskRecord(taskId) || latestTask)
      const nextWarnings: string[] = [...nextProgress.warnings]
      let inspectionIds = [...nextProgress.inspectionIds]
      let failed = false
      let generatedRevisionTaskCount = nextProgress.generatedRevisionTaskCount
      let aiCheckFailureCount = nextProgress.aiCheckFailureCount
      let publishCheckFailureCount = nextProgress.publishCheckFailureCount
      let publishBlockedChapterIds = [...nextProgress.publishBlockedChapterIds]
      let publishRewriteChapterIds = [...nextProgress.publishRewriteChapterIds]

      try {
        if (!chapter) {
          throw new Error(`章节 ${chapterId} 不存在。`)
        }

        if (options.includeAiCheck !== false) {
          try {
            await aiCheckChapter(chapterId)
          } catch (error) {
            failed = true
            aiCheckFailureCount += 1
            const message = error instanceof Error ? error.message : 'AI 体检失败'
            nextWarnings.push(`第 ${chapterNum} 章 AI 体检失败：${message}`)
            const inspectionId = createAnalysisInspection(nextProgress.snapshotId, {
              chapterId,
              chapterNum,
              category: 'ai',
              status: 'blocked',
              note: `AI 体检失败：${message}`,
            })
            if (typeof inspectionId === 'number') inspectionIds = appendUniqueNumber(inspectionIds, inspectionId)
          }
        }

        if (options.includePublishCheck !== false) {
          try {
            const publishCheck = runChapterPublishCheck(chapterId)
            generatedRevisionTaskCount += publishCheck.generatedTaskCount || 0
            const inspectionStatus = publishCheck.gateLevel === 'blocker' || publishCheck.gateLevel === 'rewrite'
              ? 'blocked'
              : publishCheck.gateLevel === 'warning'
                ? 'warning'
                : 'pass'
            if (publishCheck.gateLevel === 'blocker') {
              publishBlockedChapterIds = appendUniqueNumber(publishBlockedChapterIds, chapterId)
              nextWarnings.push(`第 ${chapterNum} 章发布门阻断：${publishCheck.summary}`)
            } else if (publishCheck.gateLevel === 'rewrite') {
              publishRewriteChapterIds = appendUniqueNumber(publishRewriteChapterIds, chapterId)
              nextWarnings.push(`第 ${chapterNum} 章发布门要求重写：${publishCheck.summary}`)
            } else if (publishCheck.gateLevel === 'warning') {
              nextWarnings.push(`第 ${chapterNum} 章发布门告警：${publishCheck.summary}`)
            }
            const inspectionId = createAnalysisInspection(nextProgress.snapshotId, {
              chapterId,
              chapterNum,
              category: 'continuity',
              status: inspectionStatus,
              note: `发布前检查：${publishCheck.summary}；重写 ${publishCheck.rewriteCount}，阻断 ${publishCheck.blockerCount}，预警 ${publishCheck.warningCount}。`,
            })
            if (typeof inspectionId === 'number') inspectionIds = appendUniqueNumber(inspectionIds, inspectionId)
          } catch (error) {
            failed = true
            publishCheckFailureCount += 1
            const message = error instanceof Error ? error.message : '发布前检查失败'
            nextWarnings.push(`第 ${chapterNum} 章发布前检查失败：${message}`)
            const inspectionId = createAnalysisInspection(nextProgress.snapshotId, {
              chapterId,
              chapterNum,
              category: 'continuity',
              status: 'blocked',
              note: `发布前检查失败：${message}`,
            })
            if (typeof inspectionId === 'number') inspectionIds = appendUniqueNumber(inspectionIds, inspectionId)
          }
        }
      } catch (error) {
        failed = true
        const message = error instanceof Error ? error.message : '逐章分析失败'
        nextWarnings.push(`第 ${chapterNum} 章分析失败：${message}`)
        const inspectionId = createAnalysisInspection(nextProgress.snapshotId, {
          chapterId,
          chapterNum,
          category: 'continuity',
          status: 'blocked',
          note: `逐章分析失败：${message}`,
        })
        if (typeof inspectionId === 'number') inspectionIds = appendUniqueNumber(inspectionIds, inspectionId)
      }

      nextProgress = {
        ...nextProgress,
        status: 'running',
        currentBatch,
        resumeCursor: nextProgress.resumeCursor + 1,
        generatedCount: nextProgress.generatedCount + 1,
        retryCount: 0,
        lastError: '',
        completed: nextProgress.resumeCursor + 1 >= nextProgress.totalBatches,
        completedChapterIds: failed
          ? nextProgress.completedChapterIds
          : appendUniqueNumber(nextProgress.completedChapterIds, chapterId),
        failedChapterIds: failed
          ? appendUniqueNumber(nextProgress.failedChapterIds, chapterId)
          : nextProgress.failedChapterIds,
        warnings: appendUniqueStrings([], nextWarnings),
        currentChapterId: chapterId,
        currentChapterNum: chapterNum,
        inspectionIds,
        publishBlockedChapterIds,
        publishRewriteChapterIds,
        generatedRevisionTaskCount,
        aiCheckFailureCount,
        publishCheckFailureCount,
        batchDigest: chapter?.title || `第${chapterNum}章`,
        message: failed
          ? `第 ${chapterNum} 章分析完成但存在失败项，已记录后继续。`
          : `第 ${chapterNum} 章分析完成。`,
      }
      updateTaskProgress(taskId, nextProgress, sender)
    }
  } catch (error) {
    settleBatchWorkflowFatalError(taskId, sender, error)
  } finally {
    unregisterActiveBatchWorkflow(taskId)
  }
}

async function runSubplotAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (!tryRegisterActiveBatchWorkflow(taskId)) return

  try {
    const task = getRunningTask(taskId, sender)
    const request = parseSubplotRequest(task.inputJson)
    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialSubplotStatus(taskId, request), sender)
    }
    const context = await loadSubplotAutoGenerateContext(request)

    while (true) {
      const latestTask = getTaskRecord(taskId)
      if (!latestTask || !latestTask.novelId) break
      const control = parseTaskControl(latestTask)
      const progress = toSubplotStatus(taskId, latestTask)

      if (control.cancelRequested) {
        updateTaskProgress(taskId, { ...progress, status: 'cancelled', message: '支线批量生成已停止。' }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      try {
        if (progress.generatedCount >= progress.requestedCount) {
          const polished = await polishGeneratedSubplots(
            context,
            request.storyGoal,
            request.coreConflict,
            request.mainPlot,
            progress.subplots,
          )
          const success = polished.subplots.length >= progress.requestedCount
          const done: SubplotAutoGenerateStatus = {
            ...progress,
            status: success ? 'success' : 'failed',
            completed: true,
            subplots: polished.subplots,
            warnings: mergeWarnings(progress.warnings, polished.warning),
            generatedCount: polished.subplots.length,
            message: success
              ? `支线批量任务完成，已生成 ${polished.subplots.length}/${progress.requestedCount} 条支线。`
              : '支线批量任务未产出可用结果。',
          }
          updateTaskProgress(taskId, done, sender)
          updateTaskStatus(taskId, success ? 'success' : 'failed', sender, {
            outputText: done.message,
            errorMessage: success ? null : done.message,
            currentChildTaskId: null,
          })
          break
        }

        const maxAttempts = Math.max(
          Math.ceil(progress.requestedCount / Math.max(1, progress.batchSize)) + DEFAULT_MAX_RETRIES,
          progress.requestedCount * 2,
        )
        if (progress.resumeCursor >= maxAttempts) {
          const polished = await polishGeneratedSubplots(
            context,
            request.storyGoal,
            request.coreConflict,
            request.mainPlot,
            progress.subplots,
          )
          const partial = polished.subplots.length > 0
          const message = partial
            ? `支线批量任务达到最大尝试次数，当前仅生成 ${polished.subplots.length}/${progress.requestedCount} 条支线。请调整聚焦方向或减少目标后继续。`
            : '支线批量任务达到最大尝试次数，未产出可用结果。'
          const stopped: SubplotAutoGenerateStatus = {
            ...progress,
            status: partial ? 'paused' : 'failed',
            completed: false,
            subplots: polished.subplots,
            warnings: mergeWarnings(progress.warnings, polished.warning),
            generatedCount: polished.subplots.length,
            lastError: message,
            message,
          }
          updateTaskProgress(taskId, stopped, sender)
          updateTaskStatus(taskId, partial ? 'paused' : 'failed', sender, {
            outputText: partial ? undefined : stopped.message,
            errorMessage: stopped.message,
            currentChildTaskId: null,
          })
          break
        }

        const effectiveTotalBatches = Math.max(
          progress.totalBatches,
          progress.resumeCursor + Math.ceil(Math.max(1, progress.requestedCount - progress.generatedCount) / Math.max(1, progress.batchSize)),
        )
        const currentBatch = progress.resumeCursor + 1
        updateTaskProgress(taskId, {
          ...progress,
          status: 'running',
          totalBatches: effectiveTotalBatches,
          currentBatch,
          completed: false,
          message: `正在执行第 ${currentBatch}/${effectiveTotalBatches} 批支线生成。`,
        }, sender)

        const batchCount = Math.min(progress.batchSize, Math.max(0, progress.requestedCount - progress.generatedCount))
        const { batchResult, warning } = await tryGenerateSubplotBatch(
          context,
          request.storyGoal,
          request.coreConflict,
          request.mainPlot,
          batchCount,
          progress.subplots,
          currentBatch,
          effectiveTotalBatches,
          {
            parentTaskId: taskId,
            sender,
          },
        )

        const nextSubplots = batchResult ? [...progress.subplots, ...batchResult.accepted] : progress.subplots
        const nextTotalBatches = nextSubplots.length >= progress.requestedCount
          ? effectiveTotalBatches
          : Math.max(
              effectiveTotalBatches,
              progress.resumeCursor + 1 + Math.ceil((progress.requestedCount - nextSubplots.length) / Math.max(1, progress.batchSize)),
            )
        const nextWarnings = mergeWarnings(progress.warnings, [
          warning || '',
          batchResult?.warningMessage || '',
        ].filter(Boolean))
        const nextProgress: SubplotAutoGenerateStatus = {
          ...progress,
          status: 'running',
          totalBatches: nextTotalBatches,
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: nextSubplots.length,
          retryCount: 0,
          lastError: '',
          completed: nextSubplots.length >= progress.requestedCount,
          subplots: nextSubplots,
          warnings: nextWarnings,
          batchDigest: batchResult?.accepted.slice(0, 2).map((item) => item.name).join('、') || progress.batchDigest,
          message: batchResult
            ? `第 ${currentBatch}/${nextTotalBatches} 批已完成，新增 ${batchResult.accepted.length} 条支线。`
            : (warning || `第 ${currentBatch}/${nextTotalBatches} 批未生成可用支线。`),
        }
        updateTaskControl(taskId, {
          ...parseTaskControl(latestTask),
          cancelRequested: false,
          maxRetries: DEFAULT_MAX_RETRIES,
          retryCount: 0,
        })
        updateTaskProgress(taskId, nextProgress, sender)
      } catch (error) {
        const currentTask = getTaskRecord(taskId) || latestTask
        const currentControl = parseTaskControl(currentTask)
        const currentProgress = toSubplotStatus(taskId, currentTask)
        const isAbort = error instanceof Error && error.name === 'AbortError'

        if (isAbort || currentControl.cancelRequested) {
          updateTaskControl(taskId, {
            ...currentControl,
            cancelRequested: false,
          })
          updateTaskProgress(taskId, {
            ...currentProgress,
            status: 'cancelled',
            retryCount: 0,
            lastError: '',
            message: '支线批量生成已停止。',
          }, sender)
          updateTaskStatus(taskId, 'cancelled', sender, {
            errorMessage: '用户已取消',
            currentChildTaskId: null,
          })
          break
        }

        const nextRetryCount = (currentControl.retryCount || 0) + 1
        const errorMessage = error instanceof Error ? error.message : '支线批量生成失败'
        const exhaustedBatches = currentProgress.resumeCursor >= currentProgress.totalBatches

        updateTaskControl(taskId, {
          ...currentControl,
          maxRetries: DEFAULT_MAX_RETRIES,
          retryCount: nextRetryCount,
        })

        if (nextRetryCount > DEFAULT_MAX_RETRIES) {
          updateTaskProgress(taskId, {
            ...currentProgress,
            status: 'paused',
            retryCount: nextRetryCount,
            lastError: errorMessage,
            message: exhaustedBatches
              ? `支线结果整理连续失败 ${nextRetryCount} 次，任务已暂停。`
              : `当前支线批次连续失败 ${nextRetryCount} 次，任务已暂停。`,
          }, sender)
          updateTaskStatus(taskId, 'paused', sender, {
            errorMessage,
            currentChildTaskId: null,
          })
          break
        }

        updateTaskProgress(taskId, {
          ...currentProgress,
          status: 'running',
          retryCount: nextRetryCount,
          lastError: errorMessage,
          message: exhaustedBatches
            ? `支线结果整理失败，正在进行第 ${nextRetryCount} 次重试。`
            : `当前支线批次失败，正在进行第 ${nextRetryCount} 次重试。`,
        }, sender)
      }
    }
  } catch (error) {
    settleBatchWorkflowFatalError(taskId, sender, error)
  } finally {
    unregisterActiveBatchWorkflow(taskId)
  }
}

async function waitForWorkflowTask(taskId: number, timeoutMs = resolveWorkflowWaitTimeoutMs()) {
  const deadline = Date.now() + Math.max(1, Math.min(timeoutMs, MAX_WORKFLOW_WAIT_TIMEOUT_MS))

  while (true) {
    const task = getTaskRecord(taskId)
    if (!task) throwUserFacingError('workflow.taskNotFound', { taskId })
    if (['success', 'failed', 'cancelled', 'paused'].includes(task.status || '')) {
      return task
    }

    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      const errorMessage = formatUserFacingMessage('workflow.waitTimedOut')
      const progress = parseTaskProgress<Record<string, unknown>>(task)
      updateTaskProgress(taskId, {
        ...progress,
        status: 'paused',
        lastError: errorMessage,
        message: errorMessage,
      })
      updateTaskStatus(taskId, 'paused', undefined, {
        errorMessage,
        currentChildTaskId: null,
      })
      return getTaskRecord(taskId) || {
        ...task,
        status: 'paused',
        errorMessage,
        currentChildTaskId: null,
      }
    }

    await sleep(Math.min(400, remainingMs))
  }
}

export function isBatchWorkflowType(type?: string | null): type is BatchWorkflowTaskType {
  return type === 'faction_auto_generate'
    || type === 'character_auto_generate'
    || type === 'item_auto_generate'
    || type === 'timeline_auto_generate'
    || type === 'story_thread_auto_generate'
    || type === 'subplot_auto_generate'
    || type === 'chapter_batch_generate'
    || type === 'chapter_quality_analysis'
}

async function startFactionAutoGenerateWorkflowUnlocked(novelId: number, options: FactionBatchGenerationOptions, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'faction_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.factionPausedExists')

  const normalized = resolveFactionWorkflowOptions(novelId, JSON.stringify(options))
  const initial = createInitialFactionStatus(0, novelId, normalized)
  const taskId = await createTask({
    type: 'faction_auto_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runSimpleEntityWorkflow(taskId, sender, 'faction').catch(logWorkflowError(taskId))
  return taskId
}

export async function startFactionAutoGenerateWorkflow(novelId: number, options: FactionBatchGenerationOptions, sender?: WebContents) {
  return withBatchWorkflowStartLock('faction_auto_generate', novelId, () => startFactionAutoGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startCharacterAutoGenerateWorkflowUnlocked(novelId: number, options: CharacterBatchGenerationOptions, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'character_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.characterPausedExists')

  const normalized = parseCharacterOptions(JSON.stringify(options))
  const initial = createInitialCharacterStatus(0, novelId, normalized)
  const taskId = await createTask({
    type: 'character_auto_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runCharacterAutoGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  return taskId
}

export async function startCharacterAutoGenerateWorkflow(novelId: number, options: CharacterBatchGenerationOptions, sender?: WebContents) {
  return withBatchWorkflowStartLock('character_auto_generate', novelId, () => startCharacterAutoGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startItemAutoGenerateWorkflowUnlocked(novelId: number, options: StoryItemGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'item_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.itemPausedExists')

  const normalized = resolveItemWorkflowOptions(novelId, JSON.stringify(options))
  const initial = createInitialEntityStatus(0, novelId, normalized.count || 8, normalized.batchSize || 4)
  const taskId = await createTask({
    type: 'item_auto_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runSimpleEntityWorkflow(taskId, sender, 'item').catch(logWorkflowError(taskId))
  return taskId
}

export async function startItemAutoGenerateWorkflow(novelId: number, options: StoryItemGenerateOptions = {}, sender?: WebContents) {
  return withBatchWorkflowStartLock('item_auto_generate', novelId, () => startItemAutoGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startTimelineAutoGenerateWorkflowUnlocked(novelId: number, options: TimelineGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'timeline_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.timelinePausedExists')

  const normalized = resolveTimelineWorkflowOptions(novelId, JSON.stringify(options))
  const initial = createInitialEntityStatus(0, novelId, normalized.count || 10, normalized.batchSize || 4)
  const taskId = await createTask({
    type: 'timeline_auto_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runSimpleEntityWorkflow(taskId, sender, 'timeline').catch(logWorkflowError(taskId))
  return taskId
}

export async function startTimelineAutoGenerateWorkflow(novelId: number, options: TimelineGenerateOptions = {}, sender?: WebContents) {
  return withBatchWorkflowStartLock('timeline_auto_generate', novelId, () => startTimelineAutoGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startStoryThreadAutoGenerateWorkflowUnlocked(novelId: number, options: StoryThreadBatchGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'story_thread_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.threadPausedExists')

  const normalized = resolveThreadWorkflowOptions(novelId, JSON.stringify(options))
  const initial = createInitialThreadStatus(0, novelId, normalized)
  const taskId = await createTask({
    type: 'story_thread_auto_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runSimpleEntityWorkflow(taskId, sender, 'thread').catch(logWorkflowError(taskId))
  return taskId
}

export async function startStoryThreadAutoGenerateWorkflow(novelId: number, options: StoryThreadBatchGenerateOptions = {}, sender?: WebContents) {
  return withBatchWorkflowStartLock('story_thread_auto_generate', novelId, () => startStoryThreadAutoGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startSubplotAutoGenerateWorkflowUnlocked(request: SubplotAutoGenerateRequest, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(request.novelId, 'subplot_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.subplotPausedExists')

  const normalized = parseSubplotRequest(JSON.stringify(request))
  const initial = createInitialSubplotStatus(0, normalized)
  const taskId = await createTask({
    type: 'subplot_auto_generate',
    novelId: normalized.novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runSubplotAutoGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  return taskId
}

export async function startSubplotAutoGenerateWorkflow(request: SubplotAutoGenerateRequest, sender?: WebContents) {
  return withBatchWorkflowStartLock('subplot_auto_generate', request.novelId, () => startSubplotAutoGenerateWorkflowUnlocked(request, sender))
}

async function startChapterBatchGenerateWorkflowUnlocked(novelId: number, options: ChapterBatchGenerateOptions, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'chapter_batch_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.chapterPausedExists')

  const normalized = parseChapterBatchOptions(JSON.stringify(options))
  const initial = createInitialChapterBatchStatus(0, novelId, normalized)
  const taskId = await createTask({
    type: 'chapter_batch_generate',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  let snapshotId: number | undefined
  try {
    if (normalized.chapterIds.length > 0) {
      snapshotId = createChapterBatchSnapshot(novelId, taskId, normalized.chapterIds).id
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '批次快照创建失败'
    updateTaskProgress(taskId, {
      ...initial,
      taskId,
      status: 'failed',
      completed: true,
      lastError: errorMessage,
      message: `批次快照创建失败，章节批量任务未启动：${errorMessage}`,
    }, sender)
    updateTaskStatus(taskId, 'failed', sender, {
      errorMessage,
      currentChildTaskId: null,
    })
    throw error
  }
  updateTaskProgress(taskId, { ...initial, taskId, snapshotId }, sender)
  void runChapterBatchGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  return taskId
}

export async function startChapterBatchGenerateWorkflow(novelId: number, options: ChapterBatchGenerateOptions, sender?: WebContents) {
  return withBatchWorkflowStartLock('chapter_batch_generate', novelId, () => startChapterBatchGenerateWorkflowUnlocked(novelId, options, sender))
}

async function startChapterQualityAnalysisWorkflowUnlocked(novelId: number, options: ChapterQualityAnalysisOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'chapter_quality_analysis'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id

  const normalized = normalizeChapterQualityAnalysisOptions(novelId, options)
  const initial = createInitialChapterQualityAnalysisStatus(0, novelId, normalized)
  const taskId = await createTask({
    type: 'chapter_quality_analysis',
    novelId,
    inputJson: JSON.stringify(normalized),
    runnerType: 'workflow',
    retryable: true,
    recoveryHintJson: JSON.stringify({
      kind: 'resume',
      label: '继续逐章 AI 体检队列',
      description: '从上次中断的章节继续执行 AI 体检与发布前检查。',
      path: `/novels/${novelId}/quality`,
    }),
    controlJson: JSON.stringify({ cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 }),
    progressJson: JSON.stringify(initial),
  })
  let snapshotId: number | undefined
  try {
    if ((normalized.chapterIds || []).length > 0) {
      snapshotId = createChapterBatchSnapshot(novelId, taskId, normalized.chapterIds || []).id
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '逐章分析快照创建失败'
    updateTaskProgress(taskId, {
      ...initial,
      taskId,
      status: 'failed',
      completed: true,
      lastError: errorMessage,
      message: `逐章分析快照创建失败，队列未启动：${errorMessage}`,
    }, sender)
    updateTaskStatus(taskId, 'failed', sender, {
      errorMessage,
      currentChildTaskId: null,
    })
    throw error
  }
  updateTaskProgress(taskId, { ...initial, taskId, snapshotId }, sender)
  void runChapterQualityAnalysisWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  return taskId
}

export async function startChapterQualityAnalysisWorkflow(novelId: number, options: ChapterQualityAnalysisOptions = {}, sender?: WebContents) {
  return withBatchWorkflowStartLock('chapter_quality_analysis', novelId, () => startChapterQualityAnalysisWorkflowUnlocked(novelId, options, sender))
}

export function getCharacterAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'character_auto_generate' ? toCharacterStatus(taskId, task) : null
}

export function getFactionAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'faction_auto_generate' ? toFactionStatus(taskId, task) : null
}

export function getItemAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'item_auto_generate'
    ? toEntityStatus(taskId, task, { requestedCount: resolveItemWorkflowOptions(task.novelId || 0, task.inputJson).count || 8, batchSize: resolveItemWorkflowOptions(task.novelId || 0, task.inputJson).batchSize || 4 })
    : null
}

export function getTimelineAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'timeline_auto_generate'
    ? toEntityStatus(taskId, task, { requestedCount: resolveTimelineWorkflowOptions(task.novelId || 0, task.inputJson).count || 10, batchSize: resolveTimelineWorkflowOptions(task.novelId || 0, task.inputJson).batchSize || 4 })
    : null
}

export function getStoryThreadAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'story_thread_auto_generate' ? toThreadStatus(taskId, task) : null
}

export function getSubplotAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'subplot_auto_generate' ? toSubplotStatus(taskId, task) : null
}

export function getChapterBatchAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'chapter_batch_generate' ? toChapterBatchStatus(taskId, task) : null
}

export function getChapterQualityAnalysisStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'chapter_quality_analysis' ? toChapterQualityAnalysisStatus(taskId, task) : null
}

export function getLatestFactionAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'faction_auto_generate'))
}

export function getLatestCharacterAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'character_auto_generate'))
}

export function getLatestItemAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'item_auto_generate'))
}

export function getLatestTimelineAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'timeline_auto_generate'))
}

export function getLatestStoryThreadAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'story_thread_auto_generate'))
}

export function getLatestSubplotAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'subplot_auto_generate'))
}

export function getLatestChapterBatchAutoGenerateTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'chapter_batch_generate'))
}

export function getLatestChapterQualityAnalysisTask(novelId: number) {
  return reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'chapter_quality_analysis'))
}

async function resumeBatchWorkflow(taskId: number, sender: WebContents | undefined, type: BatchWorkflowTaskType) {
  cleanupInactiveBatchWorkflowEntries()
  const task = getTaskRecord(taskId)
  if (!task || task.runnerType !== 'workflow' || task.type !== type) {
    throwUserFacingError('workflow.taskNotFound', { taskId })
  }
  if (activeBatchWorkflows.has(taskId)) {
    throwUserFacingError('workflow.taskRunningCannotResume', { taskId })
  }
  updateTask(taskId, {
    status: 'pending',
    errorMessage: null,
    currentChildTaskId: null,
  })
  updateTaskControl(taskId, {
    ...parseTaskControl(task),
    cancelRequested: false,
    retryCount: 0,
  })
  const progress = getBatchWorkflowProgress(taskId, task)
  updateTaskProgress(taskId, {
    ...progress,
    status: 'pending',
    retryCount: 0,
    lastError: '',
    message: progress.resumeCursor >= progress.totalBatches
      ? '准备继续执行后台流程。'
      : `准备继续执行第 ${progress.resumeCursor + 1}/${progress.totalBatches} 批。`,
  }, sender)

  if (type === 'faction_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'faction').catch(logWorkflowError(taskId))
  } else if (type === 'character_auto_generate') {
    void runCharacterAutoGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  } else if (type === 'item_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'item').catch(logWorkflowError(taskId))
  } else if (type === 'timeline_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'timeline').catch(logWorkflowError(taskId))
  } else if (type === 'story_thread_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'thread').catch(logWorkflowError(taskId))
  } else if (type === 'chapter_batch_generate') {
    void runChapterBatchGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  } else if (type === 'chapter_quality_analysis') {
    void runChapterQualityAnalysisWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  } else {
    void runSubplotAutoGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  }
  return taskId
}

export async function resumeBatchAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  const task = getTaskRecord(taskId)
  if (!task || !isBatchWorkflowType(task.type)) {
    throwUserFacingError('workflow.taskNotFound', { taskId })
  }
  if (task.status !== 'paused' || !hasResumableWorkflowCheckpoint(task)) {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  return resumeBatchWorkflow(taskId, sender, task.type)
}

export async function generateFactionsViaWorkflow(novelId: number, options: FactionBatchGenerationOptions, sender?: WebContents) {
  const taskId = await startFactionAutoGenerateWorkflow(novelId, options, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  return getFactionAutoGenerateStatus(taskId)?.acceptedIds || []
}

export async function generateCharactersViaWorkflow(novelId: number, options: CharacterBatchGenerationOptions, sender?: WebContents) {
  const taskId = await startCharacterAutoGenerateWorkflow(novelId, options, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  return toCharacterStatus(taskId, task).acceptedIds
}

export async function generateItemsViaWorkflow(novelId: number, options: StoryItemGenerateOptions = {}, sender?: WebContents) {
  if (options.templateOnly) {
    return generateStoryItemsBatchChunk(novelId, options, { sender }).then((result) => result.ids)
  }
  const taskId = await startItemAutoGenerateWorkflow(novelId, options, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  return getItemAutoGenerateStatus(taskId)?.acceptedIds || []
}

export async function generateTimelineViaWorkflow(novelId: number, options: TimelineGenerateOptions = {}, sender?: WebContents) {
  const taskId = await startTimelineAutoGenerateWorkflow(novelId, options, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  return getTimelineAutoGenerateStatus(taskId)?.acceptedIds || []
}

export async function generateStoryThreadsViaWorkflow(novelId: number, options: StoryThreadBatchGenerateOptions = {}, sender?: WebContents): Promise<StoryThreadBatchGenerationResult> {
  const taskId = await startStoryThreadAutoGenerateWorkflow(novelId, options, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  const status = getStoryThreadAutoGenerateStatus(taskId)
  return {
    ids: status?.acceptedIds || [],
    requestedCount: status?.requestedCount || clampPositiveInt(options.count, 8, 1, MAX_THREAD_GENERATION_COUNT),
    createdCount: status?.generatedCount || 0,
    warnings: status?.warnings || [],
  }
}

export async function generateSubplotsViaWorkflow(request: SubplotAutoGenerateRequest, sender?: WebContents) {
  const taskId = await startSubplotAutoGenerateWorkflow(request, sender)
  const task = await waitForWorkflowTask(taskId)
  ensureSuccessfulTask(task)
  return getSubplotAutoGenerateStatus(taskId)?.subplots || []
}

export const __testing = {
  createInitialCharacterStatus,
  createInitialChapterBatchStatus,
  createInitialChapterQualityAnalysisStatus,
  createInitialEntityStatus,
  createInitialFactionStatus,
  createInitialThreadStatus,
  parseChapterBatchOptions,
  parseChapterQualityAnalysisOptions,
  parseFactionOptions,
  parseItemOptions,
  parseSubplotRequest,
  parseTimelineOptions,
  parseThreadOptions,
  resolveFactionWorkflowOptions,
  resolveItemWorkflowOptions,
  resolveTimelineWorkflowOptions,
  resolveThreadWorkflowOptions,
  createInitialSubplotStatus,
  waitForWorkflowTask,
  runCharacterAutoGenerateWorkflow,
  runChapterBatchGenerateWorkflow,
  runChapterQualityAnalysisWorkflow,
  runSimpleEntityWorkflow,
  toChapterBatchStatus,
  toChapterQualityAnalysisStatus,
  runSubplotAutoGenerateWorkflow,
}
