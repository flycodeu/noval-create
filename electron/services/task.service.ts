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
  | 'world_rules_generate'

interface CreateTaskOptions {
  type: TaskType
  novelId?: number
  modelConfigId?: number
  relatedEntityType?: string
  relatedEntityId?: number
  inputJson?: string
}

interface RunStreamTaskOptions extends CreateTaskOptions {
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
    status: 'pending',
  }).run()

  return Number(result.lastInsertRowid)
}

export async function runStreamTask(opts: RunStreamTaskOptions): Promise<number> {
  const db = getDb()
  const taskId = await createTask(opts)
  const controller = new AbortController()
  abortControllers.set(taskId, controller)

  db.update(tasks).set({
    status: 'running',
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()

  if (opts.sender && !opts.sender.isDestroyed()) {
    opts.sender.send('task:status-change', { taskId, status: 'running' })
  }

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

      if (opts.sender && !opts.sender.isDestroyed()) {
        opts.sender.send('task:complete', {
          taskId,
          status: 'success',
          output: fullOutput,
          result,
        })
      }
    } catch (error: unknown) {
      const isAbort = error instanceof Error && error.name === 'AbortError'
      const status = isAbort ? 'cancelled' : 'failed'
      const errorMessage = error instanceof Error ? error.message : '未知错误'

      db.update(tasks).set({
        status,
        errorMessage: isAbort ? '用户取消' : errorMessage,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run()

      if (opts.sender && !opts.sender.isDestroyed()) {
        opts.sender.send('task:complete', {
          taskId,
          status,
          error: errorMessage,
        })
      }
    } finally {
      abortControllers.delete(taskId)
    }
  })()

  return taskId
}

export async function runChatTask(opts: RunStreamTaskOptions): Promise<string> {
  const db = getDb()
  const taskId = await createTask(opts)

  db.update(tasks).set({
    status: 'running',
    updatedAt: new Date().toISOString(),
  }).where(eq(tasks.id, taskId)).run()

  const startTime = Date.now()

  try {
    const adapter = opts.modelConfigId
      ? await getAdapterById(opts.modelConfigId)
      : await getDefaultAdapter()

    const result = await adapter.chat(opts.messages, {
      ...opts.chatOpts,
    })

    db.update(tasks).set({
      status: 'success',
      outputText: result,
      durationMs: Date.now() - startTime,
      tokensUsed: adapter.countTokens(result),
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()

    return result
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'

    db.update(tasks).set({
      status: 'failed',
      errorMessage,
      durationMs: Date.now() - startTime,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()

    throw error
  }
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

  const messages = task.inputJson ? JSON.parse(task.inputJson) : []

  return runStreamTask({
    type: task.type as TaskType,
    novelId: task.novelId || undefined,
    modelConfigId: task.modelConfigId || undefined,
    relatedEntityType: task.relatedEntityType || undefined,
    relatedEntityId: task.relatedEntityId || undefined,
    inputJson: task.inputJson || undefined,
    messages,
    sender,
  })
}
