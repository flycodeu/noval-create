import { WebContents } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { Message, ChatOptions } from '../adapters/base.adapter'
import { getAdapterById, getDefaultAdapter } from './model.service'

export type TaskType =
  | 'init'
  | 'character_gen'
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
  | 'generate_relations'
  | 'generate_map'
  | 'map_auto_generate'
  | 'world_rules_auto_generate'
  | 'generate_arcs'
  | 'generate_items'
  | 'generate_timeline'
  | 'subplot_framework'
  | 'core_settings_generate'
  | 'premise_generate'
  | 'world_rules_generate'
  | 'project_brief_generate'
  | 'theme_voice_generate'
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

export interface TaskControlState {
  cancelRequested?: boolean
  maxRetries?: number
  retryCount?: number
  batchKey?: string
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
  controlJson?: string
  progressJson?: string
  status?: TaskStatus
}

interface RunTaskOptions extends CreateTaskOptions {
  messages: Message[]
  chatOpts?: Partial<ChatOptions>
  sender?: WebContents
  onSuccess?: (outputText: string, taskId: number) => Promise<unknown> | unknown
}

const abortControllers = new Map<number, AbortController>()

type ErrorLike = Error & {
  code?: string
  cause?: unknown
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === 'AbortError' || /abort|cancel/i.test(error.message))
}

function collectErrorDetails(error: unknown, seen = new Set<unknown>()): { codes: string[]; messages: string[]; names: string[] } {
  if (!error || seen.has(error)) return { codes: [], messages: [], names: [] }
  seen.add(error)

  if (!(error instanceof Error)) return { codes: [], messages: [], names: [] }

  const typed = error as ErrorLike
  const nested = typed.cause ? collectErrorDetails(typed.cause, seen) : { codes: [], messages: [], names: [] }

  return {
    codes: [typed.code || '', ...nested.codes].filter(Boolean),
    messages: [typed.message || '', ...nested.messages].filter(Boolean),
    names: [typed.name || '', ...nested.names].filter(Boolean),
  }
}

function isTransientModelNetworkError(error: unknown): boolean {
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

function normalizeTaskErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (isAbortError(error)) return 'User cancelled'
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
    controlJson: opts.controlJson,
    progressJson: opts.progressJson,
    status: opts.status || 'pending',
  }).run()

  return Number(result.lastInsertRowid)
}

export function getTaskRecord(taskId: number) {
  const db = getDb()
  return db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0] || null
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

function notifyStatus(sender: WebContents | undefined, taskId: number, status: TaskStatus) {
  if (sender && !sender.isDestroyed()) {
    sender.send('task:status-change', { taskId, status })
  }
}

function notifyProgress(sender: WebContents | undefined, taskId: number, progress: object) {
  if (sender && !sender.isDestroyed()) {
    sender.send('task:progress', { taskId, progress })
  }
}

function notifyComplete(
  sender: WebContents | undefined,
  payload: { taskId: number; status: TaskStatus; output?: string; error?: string; result?: unknown },
) {
  if (sender && !sender.isDestroyed()) {
    sender.send('task:complete', payload)
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

export async function runStreamTask(opts: RunTaskOptions): Promise<number> {
  const inputJson = opts.inputJson || JSON.stringify(opts.messages)
  const taskId = await createTask({
    ...opts,
    inputJson,
    runnerType: 'stream',
    retryable: opts.retryable ?? true,
  })
  const controller = new AbortController()
  abortControllers.set(taskId, controller)

  updateTaskStatus(taskId, 'running', opts.sender)

  const startTime = Date.now()
  let fullOutput = ''

  ;(async () => {
    try {
      const adapter = opts.modelConfigId
        ? await getAdapterById(opts.modelConfigId)
        : await getDefaultAdapter()

      await adapter.stream(opts.messages, {
        ...opts.chatOpts,
        signal: controller.signal,
        onStream: (chunk) => {
          fullOutput += chunk
          if (opts.sender && !opts.sender.isDestroyed()) {
            opts.sender.send('task:stream-chunk', { taskId, chunk })
          }
        },
      })

      const result = opts.onSuccess ? await opts.onSuccess(fullOutput, taskId) : undefined
      const durationMs = Date.now() - startTime
      const tokensUsed = adapter.countTokens(fullOutput)

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
    } catch (error: unknown) {
      const status: TaskStatus = isAbortError(error) ? 'cancelled' : 'failed'
      const errorMessage = normalizeTaskErrorMessage(error)

      updateTask(taskId, {
        status,
        errorMessage: status === 'cancelled' ? 'User cancelled' : errorMessage,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
      })

      notifyComplete(opts.sender, {
        taskId,
        status,
        error: errorMessage,
      })
    } finally {
      abortControllers.delete(taskId)
    }
  })()

  return taskId
}

export async function executeChatTask(taskId: number, opts: RunTaskOptions): Promise<string> {
  const controller = new AbortController()
  abortControllers.set(taskId, controller)
  updateTaskStatus(taskId, 'running', opts.sender)

  const startTime = Date.now()

  try {
    const adapter = opts.modelConfigId
      ? await getAdapterById(opts.modelConfigId)
      : await getDefaultAdapter()

    const result = await adapter.chat(opts.messages, {
      ...opts.chatOpts,
      signal: controller.signal,
    })

    const finalResult = opts.onSuccess ? await opts.onSuccess(result, taskId) : undefined

    updateTask(taskId, {
      status: 'success',
      outputText: result,
      durationMs: Date.now() - startTime,
      tokensUsed: adapter.countTokens(result),
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
      errorMessage: aborted ? 'User cancelled' : errorMessage,
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

    if (typeof task.currentChildTaskId !== 'number') {
      updateTaskStatus(taskId, 'cancelled', sender, {
        controlJson: nextControlJson,
        currentChildTaskId: null,
        errorMessage: 'User cancelled',
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
  if (!controller) return false

  controller.abort()
  return true
}

export async function retryTask(taskId: number, sender?: WebContents): Promise<number> {
  const task = getTaskRecord(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)
  if (task.runnerType === 'workflow') {
    throw new Error('Workflow tasks should be resumed instead of retried.')
  }
  if (!task.retryable) throw new Error('This task cannot be retried safely.')
  if (!task.inputJson) throw new Error('This task does not have replayable input.')

  const messages = JSON.parse(task.inputJson)
  if (!Array.isArray(messages)) {
    throw new Error('Task input is not a replayable message array.')
  }

  const baseOptions: RunTaskOptions = {
    type: task.type as TaskType,
    novelId: task.novelId || undefined,
    modelConfigId: task.modelConfigId || undefined,
    relatedEntityType: task.relatedEntityType || undefined,
    relatedEntityId: task.relatedEntityId || undefined,
    inputJson: task.inputJson || undefined,
    messages,
    sender,
    retryable: Boolean(task.retryable),
  }

  if (task.runnerType === 'stream') {
    return runStreamTask(baseOptions)
  }

  return startChatTask(baseOptions)
}

