import { WebContents } from 'electron'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import { modelConfigs, tasks } from '../database/schema'
import { BaseAdapter, Message, ChatOptions } from '../adapters/base.adapter'
import { RESUMABLE_WORKFLOW_TYPES as SHARED_RESUMABLE_WORKFLOW_TYPES } from '../../src/shared/workflow-resilience'
import {
  createAdapter,
  getDefaultModelConfigRecord,
  getModelConfigRecord,
  getModelProviderOptions,
  getProviderRuntimeDefaults,
} from './model.service'
import { appendVariationMessage, buildVariationDigest } from './variation-control.service'
import { throwUserFacingError } from '../utils/user-facing-error'

export type TaskType =
  | 'init'
  | 'character_gen'
  | 'chapter_planner'
  | 'chapter_writer'
  | 'chapter_critic'
  | 'chapter_rewriter'
  | 'chapter_canonizer'
  | 'chapter_finalize'
  | 'chapter_scene_plan'
  | 'chapter_draft'
  | 'chapter_outline'
  | 'chapter_review'
  | 'chapter_write'
  | 'summary'
  | 'continuity'
  | 'review'
  | 'ai_check'
  | 'expand_background'
  | 'faction_generate'
  | 'generate_relations'
  | 'generate_map'
  | 'map_auto_generate'
  | 'world_rules_auto_generate'
  | 'faction_auto_generate'
  | 'character_auto_generate'
  | 'item_auto_generate'
  | 'timeline_auto_generate'
  | 'story_thread_auto_generate'
  | 'subplot_auto_generate'
  | 'chapter_batch_generate'
  | 'chapter_quality_analysis'
  | 'generate_arcs'
  | 'generate_items'
  | 'generate_timeline'
  | 'subplot_framework'
  | 'core_settings_generate'
  | 'premise_generate'
  | 'world_rules_generate'
  | 'project_brief_generate'
  | 'theme_voice_generate'
  | 'planning_draft'
  | 'entity_discovery'
  | 'story_thread_generate'

export type TaskRunnerType = 'chat' | 'stream' | 'workflow'
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'cancel_requested'

export type TaskPipelineRole =
  | 'planner'
  | 'writer'
  | 'critic'
  | 'rewriter'
  | 'canonizer'
  | 'finalize'

export type TaskPipelineStage =
  | 'pending'
  | 'running'
  | 'paused'
  | 'failed'
  | 'success'
  | 'blocked'

export interface TaskRecoveryHint {
  kind: 'open_page' | 'resume'
  label: string
  description: string
  path?: string
}

export interface TaskControlState {
  cancelRequested?: boolean
  maxRetries?: number
  retryCount?: number
  batchKey?: string
  contentAttemptNumber?: number
}

interface TaskQueryFilters {
  novelId?: number
  status?: TaskStatus
  type?: string
  page?: number
  pageSize?: number
}

interface TaskHistoryClearFilters {
  novelId?: number
  status?: TaskStatus
  type?: string
}

export interface TaskStats {
  total: number
  pendingCount: number
  runningCount: number
  cancelRequestedCount: number
  pausedCount: number
  successCount: number
  failedCount: number
  cancelledCount: number
}

export interface TaskPipelineRoleStat {
  role: TaskPipelineRole
  total: number
  successCount: number
  failedCount: number
  runningCount: number
  pausedCount: number
  blockedCount: number
  avgDurationMs: number
  tokensUsedTotal: number
}

export interface TaskPipelineStats {
  totalPipelineCount: number
  activePipelineCount: number
  roleStats: TaskPipelineRoleStat[]
  commonRecoveryHints: Array<{
    label: string
    count: number
  }>
}

export interface ClearTaskHistoryResult {
  deletedCount: number
  deletedTaskIds: number[]
}

interface CreateTaskOptions {
  type: TaskType
  novelId?: number
  modelConfigId?: number
  relatedEntityType?: string
  relatedEntityId?: number
  inputJson?: string
  runnerType?: TaskRunnerType
  retryable?: boolean
  parentTaskId?: number
  currentChildTaskId?: number
  pipelineRole?: TaskPipelineRole
  pipelineStage?: TaskPipelineStage
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  recoveryHintJson?: string
  controlJson?: string
  progressJson?: string
  status?: TaskStatus
}

interface RunTaskOptions extends CreateTaskOptions {
  messages: Message[]
  chatOpts?: Partial<ChatOptions>
  sender?: WebContents
  onChunk?: (chunk: string, fullOutput: string, taskId: number) => void | Promise<void>
  onSuccess?: (outputText: string, taskId: number) => Promise<unknown> | unknown
}

interface TaskModelRuntime {
  configId: number
  provider: string
  maxConcurrency: number
  temperature: number
  maxTokens: number
  providerOptions?: ChatOptions['providerOptions']
  adapter: BaseAdapter
}

interface QueuedTaskEntry {
  taskId: number
  modelConfigId: number
  runtime: TaskModelRuntime
  resolve: (runtime: TaskModelRuntime) => void
  reject: (error: Error) => void
}

interface ModelQueueState {
  active: number
  limit: number
  pendingTaskIds: number[]
}

const abortControllers = new Map<number, AbortController>()
const queuedTaskEntries = new Map<number, QueuedTaskEntry>()
const modelQueueStates = new Map<number, ModelQueueState>()
const RESUMABLE_WORKFLOW_TYPES = new Set<TaskType>(SHARED_RESUMABLE_WORKFLOW_TYPES)
const TASK_HEARTBEAT_INTERVAL_MS = 15_000
const RATE_LIMIT_RETRY_LIMIT = 3
const RATE_LIMIT_BASE_DELAY_MS = 1_500
const RATE_LIMIT_MAX_DELAY_MS = 12_000
const ENDED_TASK_STATUSES: TaskStatus[] = ['success', 'failed', 'cancelled']
const MAX_STREAM_OUTPUT_LENGTH = 524_288 // ~512K 字符安全上限
const CHAPTER_PIPELINE_ROLES: TaskPipelineRole[] = ['planner', 'writer', 'critic', 'rewriter', 'canonizer', 'finalize']

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 10) {
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

function buildTaskWhereClause(filters: Pick<TaskQueryFilters, 'novelId' | 'status' | 'type'>) {
  const whereClauses = []

  if (typeof filters.novelId === 'number') {
    whereClauses.push(eq(tasks.novelId, filters.novelId))
  }
  if (filters.status) {
    whereClauses.push(eq(tasks.status, filters.status))
  }
  if (typeof filters.type === 'string' && filters.type.trim()) {
    whereClauses.push(eq(tasks.type, filters.type.trim()))
  }

  if (whereClauses.length === 0) return undefined
  if (whereClauses.length === 1) return whereClauses[0]
  return and(...whereClauses)
}

function listTaskRows(filters: Pick<TaskQueryFilters, 'novelId' | 'status' | 'type'> = {}) {
  const db = getDb()
  const whereClause = buildTaskWhereClause(filters)

  if (whereClause) {
    return db.select().from(tasks)
      .where(whereClause)
      .orderBy(desc(tasks.updatedAt), desc(tasks.createdAt), desc(tasks.id))
      .all()
  }

  return db.select().from(tasks)
    .orderBy(desc(tasks.updatedAt), desc(tasks.createdAt), desc(tasks.id))
    .all()
}

function computeRetryTemperature(baseTemperature: number, attemptNumber: number): number {
  const normalizedBase = Math.max(0, Math.min(1, baseTemperature))
  if (attemptNumber <= 1) return normalizedBase
  if (normalizedBase === 0) return 0.01
  return Math.max(0, Math.min(0.95, normalizedBase + (attemptNumber - 1) * 0.05))
}

function countPreviousAttempts(
  novelId: number | null | undefined,
  entityType: string | null | undefined,
  entityId: number | null | undefined,
  taskType: string,
): number {
  if (!novelId || !entityType || !entityId) return 0
  const db = getDb()
  const rows = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.novelId, novelId))
    .all()
    .filter(
      (row) => {
        const t = getTaskRecord(row.id)
        return t
          && t.type === taskType
          && t.relatedEntityType === entityType
          && t.relatedEntityId === entityId
          && (t.status === 'success' || t.status === 'failed')
      },
  )
  return rows.length
}

function buildAbortError(message = '用户已取消'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function resolveTaskModelConfig(modelConfigId?: number | null): typeof modelConfigs.$inferSelect {
  if (typeof modelConfigId === 'number') {
    return getModelConfigRecord(modelConfigId)
  }
  return getDefaultModelConfigRecord()
}

function buildTaskModelRuntime(modelConfigId?: number | null): TaskModelRuntime {
  const config = resolveTaskModelConfig(modelConfigId)
  return {
    configId: config.id,
    provider: config.provider,
    maxConcurrency: Math.max(1, config.maxConcurrency || 2),
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.85,
    maxTokens: typeof config.maxTokens === 'number' && config.maxTokens > 0
      ? Math.round(config.maxTokens)
      : getProviderRuntimeDefaults(config.provider).maxTokens,
    providerOptions: getModelProviderOptions(config),
    adapter: createAdapter(config),
  }
}

function getModelQueueState(runtime: TaskModelRuntime): ModelQueueState {
  const existing = modelQueueStates.get(runtime.configId)
  if (existing) {
    existing.limit = Math.max(1, runtime.maxConcurrency)
    return existing
  }

  const created: ModelQueueState = {
    active: 0,
    limit: Math.max(1, runtime.maxConcurrency),
    pendingTaskIds: [],
  }
  modelQueueStates.set(runtime.configId, created)
  return created
}

function releaseModelSlot(modelConfigId: number) {
  const state = modelQueueStates.get(modelConfigId)
  if (!state) return

  state.active = Math.max(0, state.active - 1)
  while (state.active < state.limit && state.pendingTaskIds.length > 0) {
    const nextTaskId = state.pendingTaskIds.shift()
    if (typeof nextTaskId !== 'number') break

    const queued = queuedTaskEntries.get(nextTaskId)
    if (!queued) continue
    queuedTaskEntries.delete(nextTaskId)
    state.active += 1
    queued.resolve(queued.runtime)
  }

  if (state.active === 0 && state.pendingTaskIds.length === 0) {
    modelQueueStates.delete(modelConfigId)
  }
}

function removeQueuedTask(taskId: number): boolean {
  const queued = queuedTaskEntries.get(taskId)
  if (!queued) return false

  queuedTaskEntries.delete(taskId)
  const state = modelQueueStates.get(queued.modelConfigId)
  if (state) {
    state.pendingTaskIds = state.pendingTaskIds.filter((id) => id !== taskId)
    if (state.active === 0 && state.pendingTaskIds.length === 0) {
      modelQueueStates.delete(queued.modelConfigId)
    }
  }

  queued.reject(buildAbortError())
  return true
}

async function acquireModelSlot(
  taskId: number,
  modelConfigId: number | null | undefined,
  signal: AbortSignal,
): Promise<{ runtime: TaskModelRuntime; release: () => void }> {
  if (signal.aborted) throw buildAbortError()

  const runtime = buildTaskModelRuntime(modelConfigId)
  if (signal.aborted) throw buildAbortError()

  const state = getModelQueueState(runtime)
  if (state.active < state.limit) {
    state.active += 1
    return {
      runtime,
      release: () => releaseModelSlot(runtime.configId),
    }
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      if (!queuedTaskEntries.has(taskId)) return
      queuedTaskEntries.delete(taskId)
      state.pendingTaskIds = state.pendingTaskIds.filter((id) => id !== taskId)
      if (state.active === 0 && state.pendingTaskIds.length === 0) {
        modelQueueStates.delete(runtime.configId)
      }
      reject(buildAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
    state.pendingTaskIds.push(taskId)
    queuedTaskEntries.set(taskId, {
      taskId,
      modelConfigId: runtime.configId,
      runtime,
      resolve: (resolvedRuntime) => {
        signal.removeEventListener('abort', onAbort)
        resolve({
          runtime: resolvedRuntime,
          release: () => releaseModelSlot(resolvedRuntime.configId),
        })
      },
      reject: (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    })
  })
}

type ErrorLike = Error & {
  code?: string
  cause?: unknown
  statusCode?: number
  retryAfterMs?: number
}

function parseJsonObject<T extends object>(raw?: string | null): T {
  if (!raw) return {} as T
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : {} as T
  } catch {
    return {} as T
  }
}

function parseTaskRecoveryHint(raw?: string | null): TaskRecoveryHint | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const kind = record.kind === 'resume' ? 'resume' : record.kind === 'open_page' ? 'open_page' : null
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    if (!kind || !label || !description) return null
    return {
      kind,
      label,
      description,
      path: path || undefined,
    }
  } catch {
    return null
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || /abort|cancel|取消/i.test(error.message))
}

function collectErrorDetails(
  error: unknown,
  seen = new Set<unknown>(),
): { codes: string[]; messages: string[]; names: string[]; statusCodes: number[]; retryAfterMs: number[] } {
  if (!error || seen.has(error)) {
    return { codes: [], messages: [], names: [], statusCodes: [], retryAfterMs: [] }
  }
  seen.add(error)

  if (!(error instanceof Error)) {
    return { codes: [], messages: [], names: [], statusCodes: [], retryAfterMs: [] }
  }

  const typed = error as ErrorLike
  const nested = typed.cause
    ? collectErrorDetails(typed.cause, seen)
    : { codes: [], messages: [], names: [], statusCodes: [], retryAfterMs: [] }
  const statusCode = typeof typed.statusCode === 'number' && Number.isFinite(typed.statusCode)
    ? typed.statusCode
    : null
  const retryAfterMs = typeof typed.retryAfterMs === 'number' && Number.isFinite(typed.retryAfterMs)
    ? typed.retryAfterMs
    : null

  return {
    codes: [typed.code || '', ...nested.codes].filter(Boolean),
    messages: [typed.message || '', ...nested.messages].filter(Boolean),
    names: [typed.name || '', ...nested.names].filter(Boolean),
    statusCodes: [statusCode, ...nested.statusCodes].filter((value): value is number => typeof value === 'number'),
    retryAfterMs: [retryAfterMs, ...nested.retryAfterMs].filter((value): value is number => typeof value === 'number'),
  }
}

export function isTransientModelNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false

  const details = collectErrorDetails(error)
  const codes = new Set(details.codes)
  if (
    codes.has('ECONNRESET')
    || codes.has('ECONNABORTED')
    || codes.has('ETIMEDOUT')
    || codes.has('EAI_AGAIN')
    || codes.has('EPIPE')
    || codes.has('UND_ERR_SOCKET')
    || codes.has('UND_ERR_CONNECT_TIMEOUT')
    || codes.has('UND_ERR_HEADERS_TIMEOUT')
    || codes.has('UND_ERR_BODY_TIMEOUT')
    || codes.has('REQUEST_TIMEOUT')
  ) return true

  const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()
  return [
    'fetch failed',
    'terminated',
    'other side closed',
    'read econnreset',
    'connection reset',
    'network error',
    'socket',
    'timed out',
  ].some((pattern) => combinedText.includes(pattern))
}

function describeTransientNetworkError(error: unknown): string {
  const details = collectErrorDetails(error)
  const code = details.codes[0] || ''
  const combinedText = [...details.messages, ...details.names].join(' ').toLowerCase()

  if (code === 'ECONNRESET' || combinedText.includes('econnreset')) return '连接被远端重置（ECONNRESET）'
  if (code === 'UND_ERR_SOCKET' || combinedText.includes('other side closed')) return '连接被对端中断（UND_ERR_SOCKET）'
  if (code === 'REQUEST_TIMEOUT' || code === 'ETIMEDOUT' || combinedText.includes('timed out')) return '请求超时'
  if (combinedText.includes('terminated')) return '连接在响应过程中被中断'

  const firstMessage = details.messages.find(Boolean)
  if (firstMessage && !/^fetch failed$/i.test(firstMessage.trim())) return firstMessage
  return code ? `网络异常（${code}）` : '网络异常'
}

function isRateLimitError(error: unknown): boolean {
  if (isAbortError(error)) return false

  const details = collectErrorDetails(error)
  if (details.statusCodes.includes(429)) return true
  const combinedText = [...details.messages, ...details.names, ...details.codes]
    .join(' ')
    .toLowerCase()

  return [
    '429',
    'rate limit',
    'too many requests',
    'quota exceeded',
    'retry later',
    'retry after',
    'requests per min',
    'requests per minute',
    'rate_limit',
    'resource_exhausted',
  ].some((pattern) => combinedText.includes(pattern))
}

function getRateLimitDelayMs(attempt: number, error: unknown): number {
  const details = collectErrorDetails(error)
  const retryAfterMs = details.retryAfterMs.find((value) => typeof value === 'number' && Number.isFinite(value))
  if (typeof retryAfterMs === 'number') {
    return Math.max(1_000, Math.min(30_000, retryAfterMs))
  }
  const combinedText = details.messages.join(' ')
  const retryAfterMatch = combinedText.match(/retry[- ]after[: ]+(\d+)/i)
  if (retryAfterMatch) {
    return Math.max(1_000, Math.min(30_000, Number(retryAfterMatch[1]) * 1_000))
  }
  return Math.min(RATE_LIMIT_MAX_DELAY_MS, RATE_LIMIT_BASE_DELAY_MS * (2 ** attempt))
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw buildAbortError()

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(buildAbortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function executeChatWithRateLimitRetries(
  adapter: BaseAdapter,
  messages: Message[],
  opts: Partial<ChatOptions> & { signal: AbortSignal },
): Promise<string> {
  let lastError: unknown

  for (let attempt = 0; attempt < RATE_LIMIT_RETRY_LIMIT; attempt += 1) {
    try {
      return await adapter.chat(messages, opts)
    } catch (error) {
      if (opts.signal.aborted || !isRateLimitError(error) || attempt >= RATE_LIMIT_RETRY_LIMIT - 1) {
        throw error
      }
      lastError = error
      await delay(getRateLimitDelayMs(attempt, error), opts.signal)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('模型限流后重试仍失败')
}

async function executeStreamWithRateLimitRetries(
  adapter: BaseAdapter,
  messages: Message[],
  opts: Partial<ChatOptions> & { signal: AbortSignal; onStream?: (chunk: string) => void },
): Promise<void> {
  for (let attempt = 0; attempt < RATE_LIMIT_RETRY_LIMIT; attempt += 1) {
    let receivedChunk = false

    try {
      await adapter.stream(messages, {
        ...opts,
        onStream: (chunk) => {
          receivedChunk = true
          opts.onStream?.(chunk)
        },
      })
      return
    } catch (error) {
      if (opts.signal.aborted || receivedChunk || !isRateLimitError(error) || attempt >= RATE_LIMIT_RETRY_LIMIT - 1) {
        throw error
      }
      await delay(getRateLimitDelayMs(attempt, error), opts.signal)
    }
  }
}

function normalizeTaskErrorMessage(error: unknown, fallback = '未知错误'): string {
  if (isAbortError(error)) return '用户已取消'
  if (isRateLimitError(error)) return '模型请求触发速率限制，系统已自动退避后仍失败。请稍后重试。'
  if (isTransientModelNetworkError(error)) {
    return `模型服务连接不稳定：${describeTransientNetworkError(error)}。请稍后重试。`
  }
  return error instanceof Error ? error.message : fallback
}

export async function createTask(opts: CreateTaskOptions): Promise<number> {
  const db = getDb()
  const result = db.insert(tasks).values({
    type: opts.type,
    novelId: opts.novelId,
    modelConfigId: opts.modelConfigId,
    relatedEntityType: opts.relatedEntityType,
    relatedEntityId: opts.relatedEntityId,
    inputJson: opts.inputJson,
    runnerType: opts.runnerType || 'chat',
    retryable: opts.retryable ? 1 : 0,
    parentTaskId: opts.parentTaskId,
    currentChildTaskId: opts.currentChildTaskId,
    pipelineRole: opts.pipelineRole,
    pipelineStage: opts.pipelineStage,
    upstreamTaskId: opts.upstreamTaskId,
    contractVersion: opts.contractVersion,
    canonRunId: opts.canonRunId,
    recoveryHintJson: opts.recoveryHintJson,
    controlJson: opts.controlJson,
    progressJson: opts.progressJson,
    status: opts.status || 'pending',
  }).run()

  return Number(result.lastInsertRowid)
}

export function listTasks(novelId?: number) {
  return listTaskRows({ novelId })
}

export function queryTasks(filters: TaskQueryFilters) {
  const paging = normalizePaging(filters.page, filters.pageSize, 10)
  const items = listTaskRows(filters)

  return buildPagedResult(
    items.slice(paging.offset, paging.offset + paging.pageSize),
    paging.page,
    paging.pageSize,
    items.length,
  )
}

export function getTaskStats(novelId?: number): TaskStats {
  return listTaskRows({ novelId }).reduce<TaskStats>((result, task) => {
    result.total += 1
    if (task.status === 'pending') result.pendingCount += 1
    if (task.status === 'running') result.runningCount += 1
    if (task.status === 'cancel_requested') result.cancelRequestedCount += 1
    if (task.status === 'paused') result.pausedCount += 1
    if (task.status === 'success') result.successCount += 1
    if (task.status === 'failed') result.failedCount += 1
    if (task.status === 'cancelled') result.cancelledCount += 1
    return result
  }, {
    total: 0,
    pendingCount: 0,
    runningCount: 0,
    cancelRequestedCount: 0,
    pausedCount: 0,
    successCount: 0,
    failedCount: 0,
    cancelledCount: 0,
  })
}

export function getTaskPipelineStats(novelId?: number): TaskPipelineStats {
  const rows = listTaskRows({ novelId })
  const chapterPipelineTasks = rows.filter((task) => task.type === 'chapter_write' && task.runnerType === 'workflow')
  const roleTasks = rows.filter((task) => (
    task.relatedEntityType === 'chapter'
    && typeof task.pipelineRole === 'string'
    && (typeof task.parentTaskId === 'number' || task.type !== 'chapter_write' || task.runnerType !== 'workflow')
  ))
  const recoveryCounts = new Map<string, number>()

  const roleStats = CHAPTER_PIPELINE_ROLES.map<TaskPipelineRoleStat>((role) => {
    const scoped = roleTasks.filter((task) => task.pipelineRole === role)
    let durationCount = 0
    let durationSum = 0
    let tokensUsedTotal = 0

    scoped.forEach((task) => {
      if (typeof task.durationMs === 'number' && task.durationMs > 0) {
        durationCount += 1
        durationSum += task.durationMs
      }
      if (typeof task.tokensUsed === 'number' && task.tokensUsed > 0) {
        tokensUsedTotal += task.tokensUsed
      }
      const recoveryHint = parseTaskRecoveryHint(task.recoveryHintJson)
      if (recoveryHint && (task.status === 'failed' || task.status === 'paused')) {
        recoveryCounts.set(recoveryHint.label, (recoveryCounts.get(recoveryHint.label) || 0) + 1)
      }
    })

    return {
      role,
      total: scoped.length,
      successCount: scoped.filter((task) => task.status === 'success').length,
      failedCount: scoped.filter((task) => task.status === 'failed').length,
      runningCount: scoped.filter((task) => task.status === 'running' || task.status === 'cancel_requested').length,
      pausedCount: scoped.filter((task) => task.status === 'paused').length,
      blockedCount: scoped.filter((task) => task.pipelineStage === 'blocked').length,
      avgDurationMs: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
      tokensUsedTotal,
    }
  })

  return {
    totalPipelineCount: chapterPipelineTasks.length,
    activePipelineCount: chapterPipelineTasks.filter((task) => (
      task.status === 'pending'
      || task.status === 'running'
      || task.status === 'paused'
      || task.status === 'cancel_requested'
    )).length,
    roleStats,
    commonRecoveryHints: [...recoveryCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([label, count]) => ({ label, count })),
  }
}

export function clearTaskHistory(filters: TaskHistoryClearFilters = {}): ClearTaskHistoryResult {
  const rows = listTaskRows(filters)
    .filter((task) => ENDED_TASK_STATUSES.includes(task.status as TaskStatus))
  const deletedTaskIds = rows.map((task) => task.id)

  if (deletedTaskIds.length === 0) {
    return {
      deletedCount: 0,
      deletedTaskIds: [],
    }
  }

  const db = getDb()
  db.delete(tasks).where(inArray(tasks.id, deletedTaskIds)).run()

  return {
    deletedCount: deletedTaskIds.length,
    deletedTaskIds,
  }
}

export function getTaskRecord(taskId: number) {
  const db = getDb()
  return db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0] || null
}

export function getLatestChapterPipelineTask(chapterId: number) {
  return listTaskRows({})
    .filter((task) => (
      task.type === 'chapter_write'
      && task.runnerType === 'workflow'
      && task.relatedEntityType === 'chapter'
      && task.relatedEntityId === chapterId
    ))[0] || null
}

export function parseTaskControl(task: Pick<typeof tasks.$inferSelect, 'controlJson'> | null | undefined): TaskControlState {
  return parseJsonObject<TaskControlState>(task?.controlJson)
}

export function parseTaskProgress<T extends object>(task: Pick<typeof tasks.$inferSelect, 'progressJson'> | null | undefined): T {
  return parseJsonObject<T>(task?.progressJson)
}

export function updateTask(taskId: number, data: Partial<typeof tasks.$inferInsert>) {
  const db = getDb()
  db.update(tasks).set({
    ...data,
    updatedAt: data.updatedAt || new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()
}

function startTaskHeartbeat(taskId: number): () => void {
  const timer = setInterval(() => {
    const current = getTaskRecord(taskId)
    if (!current || (current.status !== 'running' && current.status !== 'cancel_requested')) return
    updateTask(taskId, {
      updatedAt: new Date().toISOString(),
    })
  }, TASK_HEARTBEAT_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

function notifyStatus(sender: WebContents | undefined, taskId: number, status: TaskStatus) {
  safeSend(sender, 'task:status-change', { taskId, status })
}

function notifyProgress(sender: WebContents | undefined, taskId: number, progress: object) {
  safeSend(sender, 'task:progress', { taskId, progress })
}

function notifyComplete(
  sender: WebContents | undefined,
  payload: { taskId: number; status: TaskStatus; output?: string; error?: string; result?: unknown },
) {
  safeSend(sender, 'task:complete', payload)
}

function safeSend(sender: WebContents | undefined, channel: string, payload: unknown): void {
  try {
    if (sender && !sender.isDestroyed()) {
      sender.send(channel, payload)
    }
  } catch {
    // 窗口在 isDestroyed 检查与 send 之间被销毁，安全忽略
  }
}

export function updateTaskStatus(taskId: number, status: TaskStatus, sender?: WebContents, extra: Partial<typeof tasks.$inferInsert> = {}) {
  updateTask(taskId, {
    ...extra,
    status,
  })
  notifyStatus(sender, taskId, status)
}

export function updateTaskProgress(taskId: number, progress: object, sender?: WebContents) {
  updateTask(taskId, {
    progressJson: JSON.stringify(progress),
  })
  notifyProgress(sender, taskId, progress)
}

export function updateTaskControl(taskId: number, control: TaskControlState) {
  updateTask(taskId, {
    controlJson: JSON.stringify(control),
  })
}

export async function executeStreamTask(taskId: number, opts: RunTaskOptions): Promise<{ output: string; result?: unknown }> {
  const controller = new AbortController()
  abortControllers.set(taskId, controller)

  const startTime = Date.now()
  let fullOutput = ''
  let outputLimitExceeded = false
  let stopHeartbeat = () => {}
  let release = () => {}

  try {
    const acquired = await acquireModelSlot(taskId, opts.modelConfigId, controller.signal)
    release = acquired.release
    updateTaskStatus(taskId, 'running', opts.sender)
    stopHeartbeat = startTaskHeartbeat(taskId)
    const chatOpts = opts.chatOpts || {}

    await executeStreamWithRateLimitRetries(acquired.runtime.adapter, opts.messages, {
      temperature: acquired.runtime.temperature,
      maxTokens: acquired.runtime.maxTokens,
      ...chatOpts,
      providerOptions: {
        ...acquired.runtime.providerOptions,
        ...chatOpts.providerOptions,
      },
      signal: controller.signal,
      onStream: (chunk) => {
        fullOutput += chunk
        if (fullOutput.length > MAX_STREAM_OUTPUT_LENGTH) {
          outputLimitExceeded = true
          controller.abort()
          return
        }
        void opts.onChunk?.(chunk, fullOutput, taskId)
        safeSend(opts.sender, 'task:stream-chunk', { taskId, chunk })
      },
    })

    const result = opts.onSuccess ? await opts.onSuccess(fullOutput, taskId) : undefined
    const durationMs = Date.now() - startTime
    const tokensUsed = acquired.runtime.adapter.countTokens(fullOutput)

    updateTask(taskId, {
      status: 'success',
      outputText: fullOutput,
      durationMs,
      tokensUsed,
    })

    notifyComplete(opts.sender, {
      taskId,
      status: 'success',
      output: fullOutput,
      result,
    })

    return { output: fullOutput, result }
  } catch (error: unknown) {
    if (outputLimitExceeded) {
      const limitMsg = `流式输出超过最大限制 (${MAX_STREAM_OUTPUT_LENGTH} 字符)，已中止任务`
      updateTask(taskId, {
        status: 'failed',
        errorMessage: limitMsg,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
      })
      notifyComplete(opts.sender, { taskId, status: 'failed', error: limitMsg })
      throw new Error(limitMsg)
    }
    const currentTask = getTaskRecord(taskId)
    const aborted = isAbortError(error) || currentTask?.status === 'cancel_requested'
    const status: TaskStatus = isAbortError(error) ? 'cancelled' : 'failed'
    const errorMessage = normalizeTaskErrorMessage(error)

    updateTask(taskId, {
      status: aborted ? 'cancelled' : status,
      errorMessage: aborted ? '用户已取消' : errorMessage,
      outputText: fullOutput || null,
      durationMs: Date.now() - startTime,
    })

    notifyComplete(opts.sender, {
      taskId,
      status: aborted ? 'cancelled' : status,
      error: errorMessage,
    })

    throw error
  } finally {
    stopHeartbeat()
    release()
    abortControllers.delete(taskId)
  }
}

export async function runStreamTask(opts: RunTaskOptions): Promise<number> {
  const inputJson = opts.inputJson || JSON.stringify(opts.messages)
  const taskId = await createTask({
    ...opts,
    inputJson,
    runnerType: 'stream',
    retryable: opts.retryable ?? true,
  })

  void executeStreamTask(taskId, {
    ...opts,
    inputJson,
  }).catch((err) => {
    console.error(`[runStreamTask] Unhandled error in task ${taskId}:`, err)
  })

  return taskId
}

export async function executeChatTask(taskId: number, opts: RunTaskOptions): Promise<string> {
  const controller = new AbortController()
  abortControllers.set(taskId, controller)

  const startTime = Date.now()
  let stopHeartbeat = () => {}
  let release = () => {}

  try {
    const acquired = await acquireModelSlot(taskId, opts.modelConfigId, controller.signal)
    release = acquired.release
    updateTaskStatus(taskId, 'running', opts.sender)
    stopHeartbeat = startTaskHeartbeat(taskId)
    const chatOpts = opts.chatOpts || {}

    const result = await executeChatWithRateLimitRetries(acquired.runtime.adapter, opts.messages, {
      temperature: acquired.runtime.temperature,
      maxTokens: acquired.runtime.maxTokens,
      ...chatOpts,
      providerOptions: {
        ...acquired.runtime.providerOptions,
        ...chatOpts.providerOptions,
      },
      signal: controller.signal,
    })

    const finalResult = opts.onSuccess ? await opts.onSuccess(result, taskId) : undefined

    updateTask(taskId, {
      status: 'success',
      outputText: result,
      durationMs: Date.now() - startTime,
      tokensUsed: acquired.runtime.adapter.countTokens(result),
      currentChildTaskId: null,
    })

    notifyComplete(opts.sender, {
      taskId,
      status: 'success',
      output: result,
      result: finalResult,
    })

    return result
  } catch (error: unknown) {
    const currentTask = getTaskRecord(taskId)
    const aborted = isAbortError(error) || currentTask?.status === 'cancel_requested'
    const status: TaskStatus = aborted ? 'cancelled' : 'failed'
    const errorMessage = normalizeTaskErrorMessage(error)

    updateTask(taskId, {
      status,
      errorMessage: aborted ? '用户已取消' : errorMessage,
      durationMs: Date.now() - startTime,
      currentChildTaskId: null,
    })

    notifyComplete(opts.sender, {
      taskId,
      status,
      error: errorMessage,
    })

    throw error
  } finally {
    stopHeartbeat()
    release()
    abortControllers.delete(taskId)
  }
}

export async function startChatTask(opts: RunTaskOptions): Promise<number> {
  const inputJson = opts.inputJson || JSON.stringify(opts.messages)
  const taskId = await createTask({
    ...opts,
    inputJson,
    runnerType: 'chat',
    retryable: opts.retryable ?? false,
  })

  void executeChatTask(taskId, {
    ...opts,
    inputJson,
  }).catch(() => {
    // executeChatTask already persists failures.
  })

  return taskId
}

export async function runChatTask(opts: RunTaskOptions): Promise<string> {
  const inputJson = opts.inputJson || JSON.stringify(opts.messages)
  const taskId = await createTask({
    ...opts,
    inputJson,
    runnerType: 'chat',
    retryable: opts.retryable ?? false,
  })

  return executeChatTask(taskId, {
    ...opts,
    inputJson,
  })
}

export function cancelTask(taskId: number, sender?: WebContents): boolean {
  const task = getTaskRecord(taskId)
  if (!task) return false

  if (task.runnerType === 'workflow') {
    const control = parseTaskControl(task)
    const nextControlJson = JSON.stringify({
      ...control,
      cancelRequested: true,
    })
    const shouldPauseWorkflow = RESUMABLE_WORKFLOW_TYPES.has(task.type as TaskType)

    if (typeof task.currentChildTaskId !== 'number') {
      updateTaskStatus(taskId, shouldPauseWorkflow ? 'cancel_requested' : 'cancelled', sender, {
        controlJson: nextControlJson,
        currentChildTaskId: null,
        errorMessage: shouldPauseWorkflow ? null : '用户已取消',
      })
      return true
    }

    updateTaskStatus(taskId, 'cancel_requested', sender, {
      controlJson: nextControlJson,
    })
    cancelTask(task.currentChildTaskId, sender)
    return true
  }

  const controller = abortControllers.get(taskId)
  const wasQueued = removeQueuedTask(taskId)

  if (wasQueued) {
    updateTaskStatus(taskId, 'cancelled', sender, {
      controlJson: JSON.stringify({
        ...parseTaskControl(task),
        cancelRequested: true,
      }),
      errorMessage: '用户已取消',
      currentChildTaskId: null,
    })
    controller?.abort()
    return true
  }

  if (!controller) return false

  updateTaskStatus(taskId, 'cancel_requested', sender, {
    controlJson: JSON.stringify({
      ...parseTaskControl(task),
      cancelRequested: true,
    }),
  })
  controller.abort()
  return true
}

export function recoverOrphanedTasks(): number {
  const db = getDb()
  const recoveryTimestamp = new Date().toISOString()
  const orphanedTasks = db.select().from(tasks).all()
    .filter((task) => {
      if (task.status === 'running' || task.status === 'cancel_requested') return true
      return task.runnerType !== 'workflow' && task.status === 'pending'
    })

  orphanedTasks.forEach((task) => {
    const recoveredStatus: TaskStatus = task.status === 'cancel_requested' ? 'cancelled' : 'failed'
    updateTask(task.id, {
      status: recoveredStatus,
      currentChildTaskId: null,
      errorMessage: recoveredStatus === 'cancelled'
        ? '任务在应用重启前已收到取消请求，已自动收尾。'
        : task.status === 'pending'
          ? '任务在应用重启前仍在队列中，已自动标记为失败。'
          : '任务在应用重启前异常中断，已自动标记为失败。',
      updatedAt: recoveryTimestamp,
    })
  })

  abortControllers.clear()
  queuedTaskEntries.clear()
  modelQueueStates.clear()
  return orphanedTasks.length
}

export async function retryTask(taskId: number, sender?: WebContents): Promise<number> {
  const task = getTaskRecord(taskId)
  if (!task) throwUserFacingError('task.notFound', { id: taskId })
  if (task.runnerType === 'workflow') {
    throwUserFacingError('task.workflowUseResume')
  }
  if (!task.retryable) throwUserFacingError('task.retryUnsupported')
  if (!task.inputJson) throwUserFacingError('task.replayInputMissing')

  const messages = JSON.parse(task.inputJson)
  if (!Array.isArray(messages)) {
    throwUserFacingError('task.replayInputInvalid')
  }

  const previousAttempts = countPreviousAttempts(
    task.novelId,
    task.relatedEntityType,
    task.relatedEntityId,
    task.type,
  )
  const attemptNumber = previousAttempts + 1
  const runtime = buildTaskModelRuntime(task.modelConfigId || undefined)
  const temperature = computeRetryTemperature(runtime.temperature, attemptNumber)
  const retryMessages = appendVariationMessage(messages as Message[], {
    attemptNumber,
    rejectedDigests: task.outputText ? [buildVariationDigest(task.outputText)] : [],
  })

  const controlState: TaskControlState = { contentAttemptNumber: attemptNumber }

  const baseOptions: RunTaskOptions = {
    type: task.type as TaskType,
    novelId: task.novelId || undefined,
    modelConfigId: task.modelConfigId || undefined,
    relatedEntityType: task.relatedEntityType || undefined,
    relatedEntityId: task.relatedEntityId || undefined,
    inputJson: JSON.stringify(retryMessages),
    messages: retryMessages,
    sender,
    retryable: Boolean(task.retryable),
    parentTaskId: task.parentTaskId || undefined,
    pipelineRole: task.pipelineRole as TaskPipelineRole | undefined,
    pipelineStage: task.pipelineStage as TaskPipelineStage | undefined,
    upstreamTaskId: task.upstreamTaskId || undefined,
    contractVersion: task.contractVersion || undefined,
    canonRunId: task.canonRunId || undefined,
    recoveryHintJson: task.recoveryHintJson || undefined,
    chatOpts: { temperature },
    controlJson: JSON.stringify(controlState),
  }

  if (task.runnerType === 'stream') {
    return runStreamTask(baseOptions)
  }

  return startChatTask(baseOptions)
}
