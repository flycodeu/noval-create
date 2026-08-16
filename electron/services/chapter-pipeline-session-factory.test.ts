import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialChapterPipelineSnapshot } from './chapter-pipeline-state'

const mocks = vi.hoisted(() => ({
  createRuntime: vi.fn(),
  createBindings: vi.fn(),
}))

vi.mock('./chapter-pipeline-runtime', () => ({
  ChapterPipelineRuntime: {
    create: mocks.createRuntime,
  },
  createChapterPipelineRuntimeBindings: mocks.createBindings,
}))

import { createChapterPipelineSession } from './chapter-pipeline-session'

describe('chapter pipeline session factory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const runtime = {
      workflowTaskId: 101,
      snapshot: createInitialChapterPipelineSnapshot(1, 101, '', {
        content: '第一章旧稿',
        contextVersion: 3,
      }),
    }
    mocks.createRuntime.mockResolvedValue(runtime)
    mocks.createBindings.mockReturnValue({
      shouldRun: vi.fn(),
      sync: vi.fn(),
      setStatus: vi.fn(),
      startRole: vi.fn(),
      finishRole: vi.fn(),
      reuseRole: vi.fn(),
      failRole: vi.fn(),
    })
  })

  it('creates chapter 1 runtime and keeps CAS state behind one binding closure', async () => {
    const persistUsableDraft = vi.fn(() => '第一章新稿')
    const session = await createChapterPipelineSession({
      chapter: {
        id: 1,
        novelId: 7,
        chapterNum: 1,
        content: '第一章旧稿',
        reviewNotesJson: '',
      } as never,
      modelConfigId: 9,
      executionMode: 'balanced',
      initialContextVersion: 3,
      previousStatus: 'outline',
      resumeSourceTaskId: 88,
      loadRetrySnapshot: () => JSON.stringify({
        kind: 'chapter_pipeline',
        chapterId: 1,
        roles: { planner: { taskId: 77 } },
      }),
      buildRecoveryHint: () => ({
        kind: 'open_page',
        label: '恢复',
        description: '恢复章节流水线。',
      }),
      getOutputRefs: (state) => ({
        chapterId: 1,
        contentHash: state.latestUsableDraft,
        scenePlanHash: '',
        reviewNotesHash: state.latestReviewNotesJson,
      }),
      onProgress: vi.fn(),
      persistUsableDraft,
      updateFailureStatus: vi.fn(),
    })

    expect(mocks.createRuntime).toHaveBeenCalledWith(expect.objectContaining({
      chapterId: 1,
      novelId: 7,
      modelConfigId: 9,
      initialContent: '第一章旧稿',
      initialContextVersion: 3,
      resumeSourceTaskId: 88,
    }))
    expect(session.state).toMatchObject({
      expectedContent: '第一章旧稿',
      expectedContextVersion: 3,
      hasCommittedContent: false,
    })
    expect(session.retrySnapshot?.roles?.planner?.taskId).toBe(77)

    const bindingInput = mocks.createBindings.mock.calls[0][0]
    session.state.expectedContent = '第一章检查点稿'
    session.state.expectedContextVersion = 4
    expect(bindingInput.persistUsableDraft('第一章保留稿', 'review-json')).toBe('第一章新稿')
    expect(persistUsableDraft).toHaveBeenCalledWith({
      expectedContent: '第一章检查点稿',
      expectedContextVersion: 4,
      content: '第一章保留稿',
      reviewNotesJson: 'review-json',
    })
  })

  it('keeps chapter 2 snapshot mutations visible to runtime bindings', async () => {
    const session = await createChapterPipelineSession({
      chapter: {
        id: 2,
        novelId: 7,
        chapterNum: 2,
        content: '第二章旧稿',
        reviewNotesJson: 'old-review',
      } as never,
      executionMode: 'premium',
      initialContextVersion: 5,
      previousStatus: 'reviewing',
      buildRecoveryHint: () => ({
        kind: 'resume',
        label: '继续',
        description: '继续章节流水线。',
      }),
      getOutputRefs: () => ({
        chapterId: 2,
        contentHash: '',
        scenePlanHash: '',
        reviewNotesHash: '',
      }),
      onProgress: vi.fn(),
      persistUsableDraft: ({ content }) => content,
      updateFailureStatus: vi.fn(),
    })

    const bindingInput = mocks.createBindings.mock.calls[0][0]
    const nextSnapshot = { ...session.state.snapshot, contractVersion: 'contract-v2' }
    bindingInput.setSnapshot(nextSnapshot)
    bindingInput.setHasCommittedContent(true)
    bindingInput.setExpectedContent('第二章新稿')

    expect(bindingInput.getSnapshot()).toBe(nextSnapshot)
    expect(bindingInput.getHasCommittedContent()).toBe(true)
    expect(session.state.expectedContent).toBe('第二章新稿')
  })
})
