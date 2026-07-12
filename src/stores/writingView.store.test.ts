import { beforeEach, describe, expect, it } from 'vitest'
import { useWritingViewStore } from './writingView.store'

describe('writingView.store generation isolation', () => {
  beforeEach(() => {
    useWritingViewStore.setState({
      activeGeneration: {
        chapterId: null,
        taskId: null,
        streamTaskId: null,
        stage: null,
        status: 'idle',
        error: null,
        label: null,
        detail: null,
        startedAt: null,
        finishedAt: null,
      },
      lastGenerationByChapter: {},
    })
  })

  it('does not leak a running task into another chapter', () => {
    const store = useWritingViewStore.getState()
    store.startGeneration({ chapterId: 1, taskId: 101 })
    useWritingViewStore.getState().updateGenerationStage({
      chapterId: 1,
      taskId: 101,
      streamTaskId: 201,
      stage: 'drafting',
      label: '第一章生成中',
    })
    useWritingViewStore.getState().startGeneration({ chapterId: 2 })

    expect(useWritingViewStore.getState().activeGeneration).toMatchObject({
      chapterId: 2,
      taskId: null,
      streamTaskId: null,
      stage: null,
      label: null,
    })
    expect(useWritingViewStore.getState().lastGenerationByChapter[1]).toMatchObject({
      chapterId: 1,
      taskId: 101,
      streamTaskId: 201,
      status: 'running',
    })
  })

  it('keeps task metadata when the same chapter resumes', () => {
    useWritingViewStore.getState().startGeneration({ chapterId: 1, taskId: 101 })
    useWritingViewStore.getState().updateGenerationStage({ chapterId: 1, streamTaskId: 201, stage: 'reviewing' })
    useWritingViewStore.getState().startGeneration({ chapterId: 1 })

    expect(useWritingViewStore.getState().activeGeneration).toMatchObject({
      chapterId: 1,
      taskId: 101,
      streamTaskId: 201,
      stage: 'reviewing',
    })
  })
})
