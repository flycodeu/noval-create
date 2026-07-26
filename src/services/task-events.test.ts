import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeTaskEventBridge, initTaskEventBridge, onTaskBridgeEvent } from './task-events'
import { useTaskStore } from '../stores/task.store'

type Handler = (data: unknown) => void

function installFakeElectron() {
  const handlers = new Map<string, Handler[]>()
  const electron = {
    on: vi.fn((channel: string, handler: Handler) => {
      const list = handlers.get(channel) || []
      list.push(handler)
      handlers.set(channel, list)
      return () => {
        const current = handlers.get(channel) || []
        handlers.set(channel, current.filter((item) => item !== handler))
      }
    }),
  }
  ;(globalThis as { window?: unknown }).window = { electron }
  const emit = (channel: string, payload: unknown) => {
    (handlers.get(channel) || []).forEach((handler) => handler(payload))
  }
  return { emit, handlers }
}

describe('task-events bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTaskStore.setState({ tasks: [], streams: {}, runningCount: 0 })
  })

  afterEach(() => {
    disposeTaskEventBridge()
    vi.useRealTimers()
    delete (globalThis as { window?: unknown }).window
  })

  it('coalesces stream chunks into a single store write per flush window', () => {
    const { emit } = installFakeElectron()
    initTaskEventBridge()

    emit('task:status-change', { taskId: 1, status: 'running' })
    emit('task:stream-chunk', { taskId: 1, chunk: 'A' })
    emit('task:stream-chunk', { taskId: 1, chunk: 'B' })
    emit('task:stream-chunk', { taskId: 1, chunk: 'C' })

    expect(useTaskStore.getState().streams[1].content).toBe('')
    vi.advanceTimersByTime(120)
    expect(useTaskStore.getState().streams[1].content).toBe('ABC')
  })

  it('flushes pending chunks before completing a task and records errors', () => {
    const { emit } = installFakeElectron()
    initTaskEventBridge()

    emit('task:status-change', { taskId: 2, status: 'running' })
    emit('task:stream-chunk', { taskId: 2, chunk: '结尾' })
    emit('task:complete', { taskId: 2, status: 'failed', error: '模型超时' })

    const stream = useTaskStore.getState().streams[2]
    expect(stream.content).toBe('结尾')
    expect(stream.status).toBe('failed')
    expect(stream.error?.message).toBe('模型超时')
  })

  it('maps chapter generation progress into stage, progress and meta', () => {
    const { emit } = installFakeElectron()
    initTaskEventBridge()

    emit('chapter:generation-progress', {
      chapterId: 77,
      streamTaskId: 5,
      stage: 'drafting',
      label: '正文初稿',
      completed: 2,
      total: 6,
      status: 'running',
    })

    const stream = useTaskStore.getState().streams[5]
    expect(stream.stage).toBe('drafting')
    expect(stream.stageLabel).toBe('正文初稿')
    expect(stream.progress).toEqual({ current: 2, total: 6, percent: 33 })
    expect(stream.meta).toMatchObject({ chapterId: 77, taskType: 'chapter_generation' })
  })

  it('rebroadcasts novel-scoped channels to registered listeners', () => {
    const { emit } = installFakeElectron()
    initTaskEventBridge()

    const received: unknown[] = []
    const unsubscribe = onTaskBridgeEvent('character:batch-progress', (payload) => received.push(payload))
    emit('character:batch-progress', { batch: 1, total: 3, newIds: [4] })
    expect(received).toEqual([{ batch: 1, total: 3, newIds: [4] }])

    unsubscribe()
    emit('character:batch-progress', { batch: 2, total: 3, newIds: [] })
    expect(received).toHaveLength(1)
  })

  it('parses task:progress payloads defensively', () => {
    const { emit } = installFakeElectron()
    initTaskEventBridge()

    emit('task:progress', { taskId: 9, progress: { current: 4, total: 8, stage: 'export', label: '导出中' } })
    const stream = useTaskStore.getState().streams[9]
    expect(stream.progress).toEqual({ current: 4, total: 8, percent: 50 })
    expect(stream.stage).toBe('export')

    emit('task:progress', { taskId: 9, progress: 'garbage' })
    expect(useTaskStore.getState().streams[9].progress).toEqual({ current: 4, total: 8, percent: 50 })
  })
})
