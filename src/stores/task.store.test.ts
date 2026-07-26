import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_STREAM_CONTENT_LENGTH, useTaskStore } from './task.store'

function resetStore() {
  useTaskStore.setState({ tasks: [], streams: {}, runningCount: 0 })
}

describe('task.store', () => {
  beforeEach(resetStore)

  it('tracks running count across stream lifecycle', () => {
    const store = useTaskStore.getState()
    store.addStream(1)
    store.addStream(2)
    expect(useTaskStore.getState().runningCount).toBe(2)

    useTaskStore.getState().completeStream(1, 'completed')
    expect(useTaskStore.getState().runningCount).toBe(1)

    useTaskStore.getState().clearStream(2)
    expect(useTaskStore.getState().runningCount).toBe(0)
  })

  it('caps stream content and flags head truncation', () => {
    const store = useTaskStore.getState()
    store.addStream(1)
    useTaskStore.getState().appendStreamChunk(1, 'HEAD-')
    useTaskStore.getState().appendStreamChunk(1, 'x'.repeat(MAX_STREAM_CONTENT_LENGTH))

    const stream = useTaskStore.getState().streams[1]
    expect(stream.content.length).toBe(MAX_STREAM_CONTENT_LENGTH)
    expect(stream.truncatedHead).toBe(true)
    expect(stream.content.startsWith('HEAD-')).toBe(false)
  })

  it('derives percent when progress omits it', () => {
    useTaskStore.getState().addStream(1)
    useTaskStore.getState().updateTaskProgress(1, { current: 3, total: 12 })
    expect(useTaskStore.getState().streams[1].progress).toEqual({ current: 3, total: 12, percent: 25 })

    useTaskStore.getState().updateTaskProgress(1, { current: 1, total: 0 })
    expect(useTaskStore.getState().streams[1].progress?.percent).toBeNull()
  })

  it('merges meta and keeps stage label when stage updates omit it', () => {
    useTaskStore.getState().addStream(1, { novelId: 9 })
    useTaskStore.getState().upsertTaskMeta(1, { chapterId: 33 })
    useTaskStore.getState().updateTaskStage(1, 'drafting', '正文初稿')
    useTaskStore.getState().updateTaskStage(1, 'reviewing')

    const stream = useTaskStore.getState().streams[1]
    expect(stream.meta).toEqual({ novelId: 9, chapterId: 33 })
    expect(stream.stage).toBe('reviewing')
    expect(stream.stageLabel).toBe('正文初稿')
  })

  it('clears error when a stream restarts', () => {
    useTaskStore.getState().addStream(1)
    useTaskStore.getState().setTaskError(1, { code: 'empty_output', message: '空输出' })
    useTaskStore.getState().completeStream(1, 'failed')
    useTaskStore.getState().addStream(1)

    expect(useTaskStore.getState().streams[1].error).toBeNull()
    expect(useTaskStore.getState().streams[1].status).toBe('running')
  })

  it('prunes only completed streams beyond the retention limit', () => {
    for (let taskId = 1; taskId <= 14; taskId += 1) {
      useTaskStore.getState().addStream(taskId)
      if (taskId <= 12) useTaskStore.getState().completeStream(taskId, 'completed')
    }

    const streams = useTaskStore.getState().streams
    const completed = Object.values(streams).filter((stream) => stream.status !== 'running')
    const running = Object.values(streams).filter((stream) => stream.status === 'running')
    expect(completed.length).toBeLessThanOrEqual(10)
    expect(running.length).toBe(2)
    expect(useTaskStore.getState().runningCount).toBe(2)
  })
})
