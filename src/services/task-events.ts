import { useTaskStore } from '../stores/task.store'
import {
  parseChapterGenerationProgressEvent,
  parseTaskChunkEvent,
  parseTaskCompleteEvent,
  parseTaskProgressEvent,
  parseTaskStatusEvent,
} from '../shared/task-stream-events'

/**
 * Single global subscription point for task-related IPC events.
 *
 * Responsibilities:
 * - Own the ONLY writer path from IPC events into the task store.
 * - Throttle high-frequency stream chunks (buffer + timed flush) so a long
 *   generation does not trigger a store update per token.
 * - Re-dispatch novel-scoped progress channels (character/ai:*) to page-level
 *   subscribers through onTaskBridgeEvent, so pages migrate off raw
 *   window.electron.on without changing backend contracts.
 */

const CHUNK_FLUSH_INTERVAL_MS = 100

export type TaskBridgeChannel =
  | 'chapter:generation-progress'
  | 'character:batch-progress'
  | 'ai:core-settings-progress'
  | 'ai:premise-progress'
  | 'ai:world-rules-progress'

const REBROADCAST_CHANNELS: TaskBridgeChannel[] = [
  'chapter:generation-progress',
  'character:batch-progress',
  'ai:core-settings-progress',
  'ai:premise-progress',
  'ai:world-rules-progress',
]

type BridgeListener = (payload: unknown) => void

let initialized = false
let disposers: Array<() => void> = []
const chunkBuffers = new Map<number, string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Map<TaskBridgeChannel, Set<BridgeListener>>()

function flushChunkBuffers(): void {
  flushTimer = null
  if (chunkBuffers.size === 0) return
  const { appendStreamChunk } = useTaskStore.getState()
  chunkBuffers.forEach((chunk, taskId) => {
    if (chunk) appendStreamChunk(taskId, chunk)
  })
  chunkBuffers.clear()
}

function queueChunk(taskId: number, chunk: string): void {
  chunkBuffers.set(taskId, `${chunkBuffers.get(taskId) || ''}${chunk}`)
  if (flushTimer === null) {
    flushTimer = setTimeout(flushChunkBuffers, CHUNK_FLUSH_INTERVAL_MS)
  }
}

function flushTaskNow(taskId: number): void {
  const pending = chunkBuffers.get(taskId)
  if (pending) {
    chunkBuffers.delete(taskId)
    useTaskStore.getState().appendStreamChunk(taskId, pending)
  }
}

function rebroadcast(channel: TaskBridgeChannel, payload: unknown): void {
  const channelListeners = listeners.get(channel)
  if (!channelListeners) return
  channelListeners.forEach((listener) => {
    try {
      listener(payload)
    } catch (error) {
      console.error(`[task-events] listener error on ${channel}`, error)
    }
  })
}

/**
 * Subscribe to a bridge-forwarded channel. Returns an unsubscribe function.
 * Pages should prefer this over window.electron.on so all IPC subscriptions
 * stay in one place.
 */
export function onTaskBridgeEvent(channel: TaskBridgeChannel, listener: BridgeListener): () => void {
  const channelListeners = listeners.get(channel) || new Set<BridgeListener>()
  channelListeners.add(listener)
  listeners.set(channel, channelListeners)
  return () => {
    channelListeners.delete(listener)
  }
}

export function initTaskEventBridge(): () => void {
  if (initialized) return disposeTaskEventBridge
  const electron = typeof window !== 'undefined' ? window.electron : undefined
  if (typeof electron?.on !== 'function') return () => {}
  initialized = true

  const store = () => useTaskStore.getState()

  disposers.push(electron.on('task:stream-chunk', (data: unknown) => {
    const event = parseTaskChunkEvent(data)
    if (event) queueChunk(event.taskId, event.chunk)
  }))

  disposers.push(electron.on('task:status-change', (data: unknown) => {
    const event = parseTaskStatusEvent(data)
    if (event?.status === 'running') store().addStream(event.taskId)
  }))

  disposers.push(electron.on('task:complete', (data: unknown) => {
    const event = parseTaskCompleteEvent(data)
    if (!event || !['success', 'failed', 'cancelled'].includes(event.status)) return
    flushTaskNow(event.taskId)
    if (event.error) {
      store().setTaskError(event.taskId, { code: null, message: event.error })
    }
    store().completeStream(
      event.taskId,
      event.status === 'success' ? 'completed' : event.status === 'cancelled' ? 'cancelled' : 'failed',
    )
  }))

  disposers.push(electron.on('task:progress', (data: unknown) => {
    const event = parseTaskProgressEvent(data)
    if (!event) return
    if (event.current !== null && event.total !== null) {
      store().updateTaskProgress(event.taskId, {
        current: event.current,
        total: event.total,
        percent: event.percent,
      })
    }
    if (event.stage) store().updateTaskStage(event.taskId, event.stage, event.label)
  }))

  disposers.push(electron.on('chapter:generation-progress', (data: unknown) => {
    rebroadcast('chapter:generation-progress', data)
    const event = parseChapterGenerationProgressEvent(data)
    if (!event) return
    const taskId = event.streamTaskId ?? event.taskId
    if (taskId === null) return
    store().updateTaskStage(taskId, event.stage, event.label)
    if (event.total > 0) {
      store().updateTaskProgress(taskId, { current: event.completed, total: event.total })
    }
    store().upsertTaskMeta(taskId, {
      chapterId: event.chapterId,
      taskType: 'chapter_generation',
      title: event.label,
    })
  }))

  REBROADCAST_CHANNELS
    .filter((channel) => channel !== 'chapter:generation-progress')
    .forEach((channel) => {
      disposers.push(electron.on(channel, (data: unknown) => rebroadcast(channel, data)))
    })

  return disposeTaskEventBridge
}

export function disposeTaskEventBridge(): void {
  disposers.forEach((dispose) => {
    try {
      dispose()
    } catch {
      // listener already removed
    }
  })
  disposers = []
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  flushChunkBuffers()
  chunkBuffers.clear()
  listeners.clear()
  initialized = false
}

export const __testing = {
  queueChunk,
  flushChunkBuffers,
  chunkBuffers,
}
