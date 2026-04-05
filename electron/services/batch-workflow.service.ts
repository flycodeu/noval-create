import type { WebContents } from 'electron'
import { desc, eq } from 'drizzle-orm'
import type {
  CharacterAutoGenerateStatus,
  CharacterBatchGenerationOptions,
  ItemAutoGenerateStatus,
  StoryItemGenerateOptions,
  StoryThreadAutoGenerateStatus,
  SubplotAutoGenerateRequest,
  SubplotAutoGenerateStatus,
  TimelineAutoGenerateStatus,
  TimelineGenerateOptions,
} from '../../src/types'
import type { StoryThreadBatchGenerateOptions, StoryThreadBatchGenerationResult } from '../../src/shared/story-thread-generation'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { generateCharacterBatchChunk } from './character.service'
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
const activeBatchWorkflows = new Set<number>()

type TaskRow = typeof tasks.$inferSelect
type BatchWorkflowTaskType =
  | 'character_auto_generate'
  | 'item_auto_generate'
  | 'timeline_auto_generate'
  | 'story_thread_auto_generate'
  | 'subplot_auto_generate'

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

function getLatestWorkflowByType(novelId: number, type: BatchWorkflowTaskType) {
  const db = getDb()
  return db.select().from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .find((task) => task.type === type && task.runnerType === 'workflow') || null
}

function reconcileStaleBatchWorkflowTask(task: TaskRow | null): TaskRow | null {
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

function mergeWarnings(current: string[], next?: string | string[] | null): string[] {
  const values = Array.isArray(next) ? next : next ? [next] : []
  return [...current, ...values.filter((item) => item.trim())]
}

function getRunningTask(taskId: number, sender?: WebContents) {
  const task = getTaskRecord(taskId)
  if (!task || !task.novelId) {
    throw new Error(`工作流任务 ${taskId} 不存在`)
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

async function runCharacterAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (activeBatchWorkflows.has(taskId)) return
  activeBatchWorkflows.add(taskId)

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
  } finally {
    activeBatchWorkflows.delete(taskId)
  }
}

async function runSimpleEntityWorkflow(
  taskId: number,
  sender: WebContents | undefined,
  type: 'item' | 'timeline' | 'thread',
) {
  if (activeBatchWorkflows.has(taskId)) return
  activeBatchWorkflows.add(taskId)

  try {
    const task = getRunningTask(taskId, sender)
    if (!task.progressJson) {
      if (type === 'item') {
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
            type === 'item'
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
        const result = type === 'item'
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
              type === 'item'
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
  } finally {
    activeBatchWorkflows.delete(taskId)
  }
}

async function runSubplotAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  if (activeBatchWorkflows.has(taskId)) return
  activeBatchWorkflows.add(taskId)

  try {
    const task = getRunningTask(taskId, sender)
    const request = parseSubplotRequest(task.inputJson)
    const context = await loadSubplotAutoGenerateContext(request)
    if (!task.progressJson) {
      updateTaskProgress(taskId, createInitialSubplotStatus(taskId, request), sender)
    }

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

      if (progress.resumeCursor >= progress.totalBatches) {
        const polished = await polishGeneratedSubplots(context, request.storyGoal, request.coreConflict, request.mainPlot, progress.subplots)
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
      updateTaskControl(taskId, { ...parseTaskControl(latestTask), cancelRequested: false, maxRetries: DEFAULT_MAX_RETRIES, retryCount: 0 })
      updateTaskProgress(taskId, nextProgress, sender)
    }
  } finally {
    activeBatchWorkflows.delete(taskId)
  }
}

async function waitForWorkflowTask(taskId: number) {
  while (true) {
    const task = getTaskRecord(taskId)
    if (!task) throw new Error(`工作流任务 ${taskId} 不存在`)
    if (['success', 'failed', 'cancelled', 'paused'].includes(task.status || '')) {
      return task
    }
    await sleep(400)
  }
}

export function isBatchWorkflowType(type?: string | null): type is BatchWorkflowTaskType {
  return type === 'character_auto_generate'
    || type === 'item_auto_generate'
    || type === 'timeline_auto_generate'
    || type === 'story_thread_auto_generate'
    || type === 'subplot_auto_generate'
}

export async function startCharacterAutoGenerateWorkflow(novelId: number, options: CharacterBatchGenerationOptions, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'character_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throw new Error('当前已有暂停中的人物批量任务，请先继续或取消。')

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
  void runCharacterAutoGenerateWorkflow(taskId, sender)
  return taskId
}

export async function startItemAutoGenerateWorkflow(novelId: number, options: StoryItemGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'item_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throw new Error('当前已有暂停中的物品批量任务，请先继续或取消。')

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
  void runSimpleEntityWorkflow(taskId, sender, 'item')
  return taskId
}

export async function startTimelineAutoGenerateWorkflow(novelId: number, options: TimelineGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'timeline_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throw new Error('当前已有暂停中的时间轴批量任务，请先继续或取消。')

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
  void runSimpleEntityWorkflow(taskId, sender, 'timeline')
  return taskId
}

export async function startStoryThreadAutoGenerateWorkflow(novelId: number, options: StoryThreadBatchGenerateOptions = {}, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(novelId, 'story_thread_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throw new Error('当前已有暂停中的故事线程批量任务，请先继续或取消。')

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
  void runSimpleEntityWorkflow(taskId, sender, 'thread')
  return taskId
}

export async function startSubplotAutoGenerateWorkflow(request: SubplotAutoGenerateRequest, sender?: WebContents) {
  const existing = reconcileStaleBatchWorkflowTask(getLatestWorkflowByType(request.novelId, 'subplot_auto_generate'))
  if (existing && ['pending', 'running', 'cancel_requested'].includes(existing.status || '')) return existing.id
  if (existing?.status === 'paused') throw new Error('当前已有暂停中的支线批量任务，请先继续或取消。')

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
  void runSubplotAutoGenerateWorkflow(taskId, sender)
  return taskId
}

export function getCharacterAutoGenerateStatus(taskId: number) {
  const task = reconcileStaleBatchWorkflowTask(getTaskRecord(taskId))
  return task?.type === 'character_auto_generate' ? toCharacterStatus(taskId, task) : null
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

async function resumeBatchWorkflow(taskId: number, sender: WebContents | undefined, type: BatchWorkflowTaskType) {
  const task = getTaskRecord(taskId)
  if (!task || task.runnerType !== 'workflow' || task.type !== type) {
    throw new Error(`工作流任务 ${taskId} 不存在`)
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

  if (type === 'character_auto_generate') {
    void runCharacterAutoGenerateWorkflow(taskId, sender)
  } else if (type === 'item_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'item')
  } else if (type === 'timeline_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'timeline')
  } else if (type === 'story_thread_auto_generate') {
    void runSimpleEntityWorkflow(taskId, sender, 'thread')
  } else {
    void runSubplotAutoGenerateWorkflow(taskId, sender)
  }
  return taskId
}

export async function resumeBatchAutoGenerateWorkflow(taskId: number, sender?: WebContents) {
  const task = getTaskRecord(taskId)
  if (!task || !isBatchWorkflowType(task.type)) {
    throw new Error(`工作流任务 ${taskId} 不存在`)
  }
  return resumeBatchWorkflow(taskId, sender, task.type)
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
