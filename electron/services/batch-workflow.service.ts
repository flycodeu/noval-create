import type { WebContents } from 'electron'
import { desc, eq } from 'drizzle-orm'
import type {
  ChapterBatchAutoGenerateStatus,
  ChapterBatchGenerateOptions,
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
} from '../../src/types'
import type { StoryThreadBatchGenerateOptions, StoryThreadBatchGenerationResult } from '../../src/shared/story-thread-generation'
import { hasResumableWorkflowCheckpoint } from '../../src/shared/workflow-resilience'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import { generateChapterContent, getChapter } from './chapter.service'
import { generateCharacterBatchChunk } from './character.service'
import { runChapterPublishCheck } from './context-impact.service'
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

const DEFAULT_MAX_RETRIES = 2
const CHAPTER_BATCH_RECALL_PAUSE_THRESHOLD = 3
const activeBatchWorkflows = new Set<number>()
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

function parseFactionOptions(raw?: string | null): FactionBatchGenerationOptions {
  const record = asRecord(raw)
  return {
    count: clampPositiveInt(record.count, 8, 1, 24),
    batchSize: clampPositiveInt(record.batchSize, 1, 1, 6),
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
    count: clampPositiveInt(record.count, 8, 1, 24),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 12),
    focus: typeof record.focus === 'string' ? record.focus : '',
    refreshTemplates: record.refreshTemplates === true,
    templateOnly: record.templateOnly === true,
  }
}

function parseTimelineOptions(raw?: string | null): TimelineGenerateOptions {
  const record = asRecord(raw)
  return {
    count: clampPositiveInt(record.count, 10, 1, 24),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 12),
    focus: typeof record.focus === 'string' ? record.focus : '',
  }
}

function parseThreadOptions(raw?: string | null): StoryThreadBatchGenerateOptions {
  const record = asRecord(raw)
  return {
    count: clampPositiveInt(record.count, 8, 1, 20),
    batchSize: clampPositiveInt(record.batchSize, 4, 1, 6),
    focus: typeof record.focus === 'string' ? record.focus : '',
  }
}

function parseSubplotRequest(raw?: string | null): SubplotAutoGenerateRequest {
  const record = asRecord(raw)
  return {
    novelId: clampPositiveInt(record.novelId, 0, 0, Number.MAX_SAFE_INTEGER),
    subplotCount: clampPositiveInt(record.subplotCount, 8, 1, 20),
    storyGoal: typeof record.storyGoal === 'string' ? record.storyGoal : '',
    coreConflict: typeof record.coreConflict === 'string' ? record.coreConflict : '',
    mainPlot: typeof record.mainPlot === 'string' ? record.mainPlot : '',
    requirements: typeof record.requirements === 'string' ? record.requirements : undefined,
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
  const totalBatches = Math.max(1, Math.max(3, requestedCount))
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, Math.max(1, options.batchSize), totalBatches),
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
    clampPositiveInt(options.count, 8, 1, 24),
    clampPositiveInt(options.batchSize, 1, 1, 6),
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
  const options = parseFactionOptions(task.inputJson)
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
  const requestedCount = clampPositiveInt(options.count, 8, 1, 20)
  const batchSize = clampPositiveInt(options.batchSize, Math.min(requestedCount, 4), 1, 6)
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, batchSize, Math.max(1, Math.ceil(requestedCount / Math.max(1, batchSize)))),
    acceptedIds: [],
    warnings: [],
  }
}

function toThreadStatus(taskId: number, task: TaskRow): StoryThreadAutoGenerateStatus {
  const progress = parseTaskProgress<Partial<StoryThreadAutoGenerateStatus>>(task)
  const fallback = createInitialThreadStatus(taskId, task.novelId || 0, parseThreadOptions(task.inputJson))
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
  const requestedCount = clampPositiveInt(request.subplotCount, 8, 1, 20)
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
  return {
    ...createBaseStatus(taskId, novelId, requestedCount, 1, Math.max(1, requestedCount)),
    chapterIds: [...options.chapterIds],
    completedChapterIds: [],
    failedChapterIds: [],
    warnings: [],
    consecutiveRecallFallbackChapters: 0,
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

function getBatchWorkflowProgress(taskId: number, task: TaskRow): BatchWorkflowProgress {
  if (task.type === 'character_auto_generate') {
    return toCharacterStatus(taskId, task)
  }

  if (task.type === 'faction_auto_generate') {
    return toFactionStatus(taskId, task)
  }

  if (task.type === 'item_auto_generate') {
    const options = parseItemOptions(task.inputJson)
    return toEntityStatus(taskId, task, {
      requestedCount: options.count || 8,
      batchSize: options.batchSize || 4,
    })
  }

  if (task.type === 'timeline_auto_generate') {
    const options = parseTimelineOptions(task.inputJson)
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

      if (progress.completed || progress.generatedCount >= progress.requestedCount || progress.resumeCursor >= progress.totalBatches) {
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

      const currentBatch = progress.resumeCursor + 1
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        currentBatch,
        message: `正在执行第 ${currentBatch}/${progress.totalBatches} 批人物生成。`,
      }, sender)

      try {
        const remaining = {
          ...options,
          majorCount: Math.max(0, options.majorCount - progress.majorGenerated),
          minorCount: Math.max(0, options.minorCount - progress.minorGenerated),
          antagonistCount: Math.max(0, (options.antagonistCount || 0) - progress.antagonistGenerated),
          supportingCount: Math.max(0, (options.supportingCount || 0) - progress.supportingGenerated),
        }
        const result = await generateCharacterBatchChunk(latestTask.novelId, remaining, {
          parentTaskId: taskId,
          sender,
          batchIndex: currentBatch,
          totalBatches: progress.totalBatches,
        })
        const nextProgress: CharacterAutoGenerateStatus = {
          ...progress,
          status: 'running',
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: progress.generatedCount + result.ids.length,
          retryCount: 0,
          lastError: '',
          acceptedIds: [...progress.acceptedIds, ...result.ids],
          warnings: mergeWarnings(progress.warnings, result.warning),
          batchDigest: result.batchDigest || progress.batchDigest,
          majorGenerated: progress.majorGenerated + result.majorGenerated,
          minorGenerated: progress.minorGenerated + result.minorGenerated,
          antagonistGenerated: progress.antagonistGenerated + result.antagonistGenerated,
          supportingGenerated: progress.supportingGenerated + result.supportingGenerated,
          completed: progress.generatedCount + result.ids.length >= progress.requestedCount || progress.resumeCursor + 1 >= progress.totalBatches,
          message: result.ids.length > 0
            ? `第 ${currentBatch}/${progress.totalBatches} 批已完成，新增 ${result.ids.length} 位角色。`
            : (result.warning || `第 ${currentBatch}/${progress.totalBatches} 批未生成可用人物。`),
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
        const opts = parseFactionOptions(task.inputJson)
        updateTaskProgress(taskId, createInitialFactionStatus(taskId, task.novelId || 0, opts), sender)
      } else if (type === 'item') {
        const opts = parseItemOptions(task.inputJson)
        updateTaskProgress(taskId, createInitialEntityStatus(taskId, task.novelId || 0, opts.count || 8, opts.batchSize || 4), sender)
      } else if (type === 'timeline') {
        const opts = parseTimelineOptions(task.inputJson)
        updateTaskProgress(taskId, createInitialEntityStatus(taskId, task.novelId || 0, opts.count || 10, opts.batchSize || 4), sender)
      } else {
        updateTaskProgress(taskId, createInitialThreadStatus(taskId, task.novelId || 0, parseThreadOptions(task.inputJson)), sender)
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
              ? { requestedCount: parseFactionOptions(latestTask.inputJson).count || 8, batchSize: parseFactionOptions(latestTask.inputJson).batchSize || 1 }
              : type === 'item'
              ? { requestedCount: parseItemOptions(latestTask.inputJson).count || 8, batchSize: parseItemOptions(latestTask.inputJson).batchSize || 4 }
              : { requestedCount: parseTimelineOptions(latestTask.inputJson).count || 10, batchSize: parseTimelineOptions(latestTask.inputJson).batchSize || 4 },
          )

      if (control.cancelRequested) {
        updateTaskProgress(taskId, { ...progress, status: 'cancelled', message: '批量生成已停止。' }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.completed || progress.resumeCursor >= progress.totalBatches) {
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

      const currentBatch = progress.resumeCursor + 1
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        currentBatch,
        message: `正在执行第 ${currentBatch}/${progress.totalBatches} 批。`,
      }, sender)

      try {
        const batchCount = Math.min(progress.batchSize, Math.max(0, progress.requestedCount - progress.generatedCount))
        const result = type === 'faction'
          ? await generateFactionBatchChunk(latestTask.novelId, {
              ...parseFactionOptions(latestTask.inputJson),
              count: batchCount,
              batchSize: batchCount,
            }, {
              parentTaskId: taskId,
              sender,
              batchIndex: currentBatch,
              totalBatches: progress.totalBatches,
            })
          : type === 'item'
          ? await generateStoryItemsBatchChunk(latestTask.novelId, {
              ...parseItemOptions(latestTask.inputJson),
              count: batchCount,
              batchSize: batchCount,
            }, {
              parentTaskId: taskId,
              sender,
              batchIndex: currentBatch,
              totalBatches: progress.totalBatches,
            })
          : type === 'timeline'
            ? await generateTimelineBatchChunk(latestTask.novelId, {
                ...parseTimelineOptions(latestTask.inputJson),
                count: batchCount,
                batchSize: batchCount,
              }, {
                parentTaskId: taskId,
                sender,
                batchIndex: currentBatch,
                totalBatches: progress.totalBatches,
              })
            : await generateStoryThreadBatchChunk(latestTask.novelId, {
                ...parseThreadOptions(latestTask.inputJson),
                count: batchCount,
                batchSize: batchCount,
              }, {
                parentTaskId: taskId,
                sender,
                batchIndex: currentBatch,
                totalBatches: progress.totalBatches,
              })

        const chunkWarnings = 'warnings' in result ? result.warnings : result.warning
        const nextWarnings = mergeWarnings(progress.warnings, chunkWarnings)
        const nextProgress = {
          ...progress,
          status: 'running' as const,
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: progress.generatedCount + result.ids.length,
          retryCount: 0,
          lastError: '',
          acceptedIds: [...progress.acceptedIds, ...result.ids],
          warnings: nextWarnings,
          batchDigest: result.batchDigest || progress.batchDigest,
          completed: progress.resumeCursor + 1 >= progress.totalBatches,
          message: result.ids.length > 0
            ? `第 ${currentBatch}/${progress.totalBatches} 批已完成，新增 ${result.ids.length} 条。`
            : (Array.isArray(chunkWarnings)
              ? (chunkWarnings[0] || `第 ${currentBatch}/${progress.totalBatches} 批没有生成可用结果。`)
              : (chunkWarnings || `第 ${currentBatch}/${progress.totalBatches} 批没有生成可用结果。`)),
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
                ? { requestedCount: parseFactionOptions(currentTask.inputJson).count || 8, batchSize: parseFactionOptions(currentTask.inputJson).batchSize || 1 }
                : type === 'item'
                ? { requestedCount: parseItemOptions(currentTask.inputJson).count || 8, batchSize: parseItemOptions(currentTask.inputJson).batchSize || 4 }
                : { requestedCount: parseTimelineOptions(currentTask.inputJson).count || 10, batchSize: parseTimelineOptions(currentTask.inputJson).batchSize || 4 },
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
    failedChapterIds: appendUniqueNumber(progress.failedChapterIds, options.chapterId),
    warnings: appendUniqueStrings(progress.warnings, options.warnings),
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

      if (control.cancelRequested) {
        updateTaskProgress(taskId, {
          ...progress,
          status: 'cancelled',
          message: '章节批量生成已停止。',
        }, sender)
        updateTaskStatus(taskId, 'cancelled', sender, { errorMessage: '用户已取消', currentChildTaskId: null })
        break
      }

      if (progress.completed || progress.resumeCursor >= progress.totalBatches || progress.resumeCursor >= progress.chapterIds.length) {
        const done: ChapterBatchAutoGenerateStatus = {
          ...progress,
          status: 'success',
          completed: true,
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
        })
        break
      }

      const chapterNum = chapter.chapterNum
      updateTaskProgress(taskId, {
        ...progress,
        status: 'running',
        currentBatch,
        currentChapterId: chapterId,
        currentChapterNum: chapterNum,
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
      if (publishCheck.gateLevel === 'blocker') {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `第 ${chapterNum} 章章节门阻断，章节批量任务已暂停：${publishCheck.summary}`,
          errorMessage: publishCheck.summary,
        })
        break
      }

      const nextRecallStreak = childSignals.recallDegraded
        ? progress.consecutiveRecallFallbackChapters + 1
        : 0
      if (nextRecallStreak >= CHAPTER_BATCH_RECALL_PAUSE_THRESHOLD) {
        pauseChapterBatchWorkflow(taskId, sender, progress, {
          chapterId,
          chapterNum,
          childTaskId,
          message: `最近已连续 ${nextRecallStreak} 章召回降级，章节批量任务已在第 ${chapterNum} 章后自动暂停。`,
          errorMessage: '连续召回降级达到暂停阈值',
          warnings: `第 ${chapterNum} 章召回已降级，连续 ${nextRecallStreak} 章触发自动暂停。`,
          consecutiveRecallFallbackChapters: nextRecallStreak,
        })
        break
      }

      const nextWarnings = appendUniqueStrings(progress.warnings, [
        publishCheck.gateLevel === 'warning' ? `第 ${chapterNum} 章章节门告警：${publishCheck.summary}` : '',
        childSignals.recallDegraded ? `第 ${chapterNum} 章召回已降级，但未达到自动暂停阈值。` : '',
      ])
      const nextProgress: ChapterBatchAutoGenerateStatus = {
        ...progress,
        status: 'running',
        currentBatch,
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
        blockedChapterId: undefined,
        blockedTaskId: undefined,
        pauseReason: undefined,
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
        if (progress.resumeCursor >= progress.totalBatches) {
          const polished = await polishGeneratedSubplots(
            context,
            request.storyGoal,
            request.coreConflict,
            request.mainPlot,
            progress.subplots,
          )
          const success = polished.subplots.length > 0
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

        const currentBatch = progress.resumeCursor + 1
        updateTaskProgress(taskId, {
          ...progress,
          status: 'running',
          currentBatch,
          message: `正在执行第 ${currentBatch}/${progress.totalBatches} 批支线生成。`,
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
          progress.totalBatches,
          {
            parentTaskId: taskId,
            sender,
          },
        )

        const nextSubplots = batchResult ? [...progress.subplots, ...batchResult.accepted] : progress.subplots
        const nextWarnings = mergeWarnings(progress.warnings, [
          warning || '',
          batchResult?.warningMessage || '',
        ].filter(Boolean))
        const nextProgress: SubplotAutoGenerateStatus = {
          ...progress,
          status: 'running',
          currentBatch,
          resumeCursor: progress.resumeCursor + 1,
          generatedCount: nextSubplots.length,
          retryCount: 0,
          lastError: '',
          completed: progress.resumeCursor + 1 >= progress.totalBatches,
          subplots: nextSubplots,
          warnings: nextWarnings,
          batchDigest: batchResult?.accepted.slice(0, 2).map((item) => item.name).join('、') || progress.batchDigest,
          message: batchResult
            ? `第 ${currentBatch}/${progress.totalBatches} 批已完成，新增 ${batchResult.accepted.length} 条支线。`
            : (warning || `第 ${currentBatch}/${progress.totalBatches} 批未生成可用支线。`),
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

async function waitForWorkflowTask(taskId: number) {
  while (true) {
    const task = getTaskRecord(taskId)
    if (!task) throwUserFacingError('workflow.taskNotFound', { taskId })
    if (['success', 'failed', 'cancelled', 'paused'].includes(task.status || '')) {
      return task
    }
    await sleep(400)
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
}

export async function startFactionAutoGenerateWorkflow(novelId: number, options: FactionBatchGenerationOptions, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'faction_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.factionPausedExists')

  const normalized = parseFactionOptions(JSON.stringify(options))
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

export async function startCharacterAutoGenerateWorkflow(novelId: number, options: CharacterBatchGenerationOptions, sender?: WebContents) {
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

export async function startItemAutoGenerateWorkflow(novelId: number, options: StoryItemGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'item_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.itemPausedExists')

  const normalized = parseItemOptions(JSON.stringify(options))
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

export async function startTimelineAutoGenerateWorkflow(novelId: number, options: TimelineGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'timeline_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.timelinePausedExists')

  const normalized = parseTimelineOptions(JSON.stringify(options))
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

export async function startStoryThreadAutoGenerateWorkflow(novelId: number, options: StoryThreadBatchGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'story_thread_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throwUserFacingError('batch.threadPausedExists')

  const normalized = parseThreadOptions(JSON.stringify(options))
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

export async function startSubplotAutoGenerateWorkflow(request: SubplotAutoGenerateRequest, sender?: WebContents) {
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

export async function startChapterBatchGenerateWorkflow(novelId: number, options: ChapterBatchGenerateOptions, sender?: WebContents) {
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
  updateTaskProgress(taskId, { ...initial, taskId }, sender)
  void runChapterBatchGenerateWorkflow(taskId, sender).catch(logWorkflowError(taskId))
  return taskId
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
    ? toEntityStatus(taskId, task, { requestedCount: parseItemOptions(task.inputJson).count || 8, batchSize: parseItemOptions(task.inputJson).batchSize || 4 })
    : null
}

export function getTimelineAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'timeline_auto_generate'
    ? toEntityStatus(taskId, task, { requestedCount: parseTimelineOptions(task.inputJson).count || 10, batchSize: parseTimelineOptions(task.inputJson).batchSize || 4 })
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
    requestedCount: status?.requestedCount || clampPositiveInt(options.count, 8, 1, 20),
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
  createInitialChapterBatchStatus,
  parseChapterBatchOptions,
  runChapterBatchGenerateWorkflow,
  toChapterBatchStatus,
  runSubplotAutoGenerateWorkflow,
}
