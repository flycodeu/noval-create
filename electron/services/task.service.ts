import { WebContents } from 'electron'
import { getDb } from '../database/db'
import { tasks } from '../database/schema'
import { eq } from 'drizzle-orm'
import { getDefaultAdapter, getAdapterById } from './model.service'
import { Message, ChatOptions } from '../adapters/base.adapter'

type TaskType = 'init' | 'character_gen' | 'chapter_outline' | 'chapter_write' | 'summary' | 'review' | 'ai_check' | 'expand_background' | 'generate_relations' | 'generate_map' | 'generate_arcs'

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

  // 更新为运行中
  db.update(tasks).set({ status: 'running', updatedAt: new Date().toISOString() }).where(eq(tasks.id, taskId)).run()

  if (opts.sender) {
    opts.sender.send('task:status-change', { taskId, status: 'running' })
  }

  const startTime = Date.now()
  let fullOutput = ''

  // 异步执行，不阻塞
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
        opts.sender.send('task:complete', { taskId, status: 'success', output: fullOutput })
      }
    } catch (e: unknown) {
      const isAbort = e instanceof Error && e.name === 'AbortError'
      const status = isAbort ? 'cancelled' : 'failed'
      const errorMessage = e instanceof Error ? e.message : '未知错误'

      db.update(tasks).set({
        status,
        errorMessage: isAbort ? '用户取消' : errorMessage,
        outputText: fullOutput || null,
        durationMs: Date.now() - startTime,
        updatedAt: new Date().toISOString(),
      }).where(eq(tasks.id, taskId)).run()

      if (opts.sender && !opts.sender.isDestroyed()) {
        opts.sender.send('task:complete', { taskId, status, error: errorMessage })
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

  db.update(tasks).set({ status: 'running', updatedAt: new Date().toISOString() }).where(eq(tasks.id, taskId)).run()

  const startTime = Date.now()

  try {
    const adapter = opts.modelConfigId
      ? await getAdapterById(opts.modelConfigId)
      : await getDefaultAdapter()

    const result = await adapter.chat(opts.messages, {
      ...opts.chatOpts,
    })

    const durationMs = Date.now() - startTime
    const tokensUsed = adapter.countTokens(result)

    db.update(tasks).set({
      status: 'success',
      outputText: result,
      durationMs,
      tokensUsed,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()

    return result
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : '未知错误'
    db.update(tasks).set({
      status: 'failed',
      errorMessage,
      durationMs: Date.now() - startTime,
      updatedAt: new Date().toISOString(),
    }).where(eq(tasks.id, taskId)).run()
    throw e
  }
}

export function cancelTask(taskId: number): boolean {
  const controller = abortControllers.get(taskId)
  if (controller) {
    controller.abort()
    return true
  }
  return false
}

export async function retryTask(taskId: number, sender?: WebContents): Promise<number> {
  const db = getDb()
  const taskRows = db.select().from(tasks).where(eq(tasks.id, taskId)).all()
  if (taskRows.length === 0) throw new Error(`Task ${taskId} not found`)

  const task = taskRows[0]
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
