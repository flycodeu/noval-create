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
  | 'generate_arcs'
  | 'generate_items'
  | 'generate_timeline'
  | 'subplot_framework'
  | 'core_settings_generate'
  | 'premise_generate'
  | 'world_rules_generate'

interface CreateTaskOptions {
  type: TaskType
  novelId?: number
  modelConfigId?: number
  relatedEntityType?: string
  relatedEntityId?: number
  inputJson?: string
  runnerType?: 'chat' | 'stream'
  retryable?: boolean
}

interface RunTaskOptions extends CreateTaskOptions {
  messages: Message[]
  chatOpts?: Partial<ChatOptions>
  sender?: WebContents
  onSuccess?: (outputText: string, taskId: number) => Promise<unknown> | unknown
}

const abortControllers = new Map<number, AbortController>()

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
    status: 'pending',
  }).run()

  return Number(result.lastInsertRowid)
}

function notifyStatus(sender: WebContents | undefined, taskId: number, status: string) {
  if (sender && !sender.isDestroyed()) {
    sender.send('task:status-change', { taskId, status })
  }
}

function notifyComplete(
  sender: WebContents | undefined,
  payload: { taskId: number; status: string; output?: string; error?: string; result?: unknown },
) {
  if (sender && !sender.isDestroyed()) {
    sender.send('task:complete', payload)
  }
}

export async function runStreamTask(opts: RunTaskOptions): Promise<number> {
  const db = getDb()
  const inputJson = opts.inputJson || JSON.stringify(opts.messages)
  const taskId = await createTask({
    ...opts,
    inputJson,
    runnerType: 'stream',
    retryable: opts.retryable ?? true,
  })
  const controller = new AbortController()
  abortControllers.set(taskId, controller)

  db.update(tasks).set({
    status: 'running',
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()

  notifyStatus(opts.sender, taskId, 'running')

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

      db.update(tasks).set({
        status: 'success',
        outputText: fullOutput,
        durationMs,
        tokensUsed,
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run()

      notifyComplete(opts.sender, {
        taskId,
        status: 'success',
        output: fullOutput,
        result,
      })
    } catch (error: unknown) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      const status = isAbort ? 'cancelled' : 'failed'
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      db.update(tasks).set({
        status,
        errorMessage: isAbort ? 'User cancelled' : errorMessage,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run()

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

async function executeChatTask(taskId: number, opts: RunTaskOptions): Promise<string> {
  const db = getDb()

  db.update(tasks).set({
    status: 'running',
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()

  notifyStatus(opts.sender, taskId, 'running')

  const startTime = Date.now()

  try {
    const adapter = opts.modelConfigId
      ? await getAdapterById(opts.modelConfigId)
      : await getDefaultAdapter()

    const result = await adapter.chat(opts.messages, {
      ...opts.chatOpts,
    })

    const finalResult = opts.onSuccess ? await opts.onSuccess(result, taskId) : undefined

    db.update(tasks).set({
      status: 'success',
      outputText: result,
      durationMs: Date.now() - startTime,
      tokensUsed: adapter.countTokens(result),
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()

    notifyComplete(opts.sender, {
      taskId,
      status: 'success',
      output: result,
      result: finalResult,
    })

    return result
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    db.update(tasks).set({
      status: 'failed',
      errorMessage,
      durationMs: Date.now() - startTime,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()

    notifyComplete(opts.sender, {
      taskId,
      status: 'failed',
      error: errorMessage,
    })

    throw error
  }
}

async function startChatTask(opts: RunTaskOptions): Promise<number> {
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

export function cancelTask(taskId: number): boolean {
  const controller = abortControllers.get(taskId)
  if (!controller) return false

  controller.abort()
  return true
}

export async function retryTask(taskId: number, sender?: WebContents): Promise<number> {
  const db = getDb()
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0]
  if (!task) throw new Error(`Task ${taskId} not found`)
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


