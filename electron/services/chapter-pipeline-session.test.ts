import { describe, expect, it, vi } from 'vitest'
import {
  adoptReusedRoleSnapshot,
  checkpointChapterPipelineContextVersion,
  commitChapterPipelineSuccess,
  commitCriticStageOutput,
  commitEnforcerStageOutput,
  commitRewriterStageOutput,
  commitWriterStageOutput,
  createChapterPipelineDraftState,
  setDraftReviewNotes,
} from './chapter-pipeline-session'
import { createInitialChapterPipelineSnapshot } from './chapter-pipeline-state'
import { buildFallbackReviewNotes } from './chapter-review-notes'

describe('chapter pipeline session', () => {
  it('keeps mutable chapter 1 CAS and review state in one session object', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(1, 101, '', {
        content: '第一章旧稿',
        contextVersion: 3,
      }),
      contractVersion: '',
      latestReviewNotesJson: '',
      expectedContent: '第一章旧稿',
      expectedContextVersion: 3,
    })

    expect(state).toMatchObject({
      contractVersion: '',
      hasCommittedContent: false,
      latestUsableDraft: '',
      expectedContent: '第一章旧稿',
      expectedContextVersion: 3,
    })
    expect(setDraftReviewNotes(state, {
      ...buildFallbackReviewNotes(''),
      summary: '审校完成',
      rewrite_required: false,
      severity: 'low',
    })).toContain('审校完成')
    expect(state.latestReviewNotesJson).toContain('审校完成')
  })

  it('delegates chapter 2 reused role transitions to the runtime binding', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(2, 102, '', {
        content: '第二章旧稿',
        contextVersion: 4,
      }),
      contractVersion: '',
      latestReviewNotesJson: '',
      expectedContent: '第二章旧稿',
      expectedContextVersion: 4,
    })
    const nextSnapshot = {
      ...state.snapshot,
      contractVersion: 'contract-v2',
    }
    const reuseRole = vi.fn(() => undefined)
    const runtime = { snapshot: nextSnapshot }

    adoptReusedRoleSnapshot({
      state,
      shared: {
        runtime: runtime as never,
        bindings: { reuseRole } as never,
      },
      role: 'planner',
      taskId: 88,
      detail: '复用 Planner 快照',
      extraSnapshot: { contractVersion: 'contract-v2' },
    })

    expect(reuseRole).toHaveBeenCalledWith('planner', {
      taskId: 88,
      detail: '复用 Planner 快照',
      outputText: undefined,
      snapshot: { contractVersion: 'contract-v2' },
    })
    expect(state.snapshot).toBe(nextSnapshot)
  })

  it('persists Writer output before advancing the runtime checkpoint', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(1, 103, '', { content: '', contextVersion: 2 }),
      contractVersion: 'contract-v1',
      latestReviewNotesJson: '',
      expectedContent: '旧稿',
      expectedContextVersion: 2,
    })
    const nextSnapshot = { ...state.snapshot, partialContent: '新稿' }
    const runtime = {
      adoptSnapshot: vi.fn(),
      checkpointContent: vi.fn(() => nextSnapshot),
    }
    const bindings = {
      sync: vi.fn(),
      finishRole: vi.fn(),
      reuseRole: vi.fn(),
    }

    const result = commitWriterStageOutput({
      state,
      runtime: runtime as never,
      bindings: bindings as never,
      chapterContent: '旧稿',
      writerOutput: { content: '新稿', titleMismatchRisk: '', taskId: 44, reused: false, resumed: false },
      persistContent: ({ expectedContent, expectedContextVersion, content }) => {
        expect({ expectedContent, expectedContextVersion, content }).toEqual({
          expectedContent: '旧稿',
          expectedContextVersion: 2,
          content: '新稿',
        })
        return '新稿'
      },
    })

    expect(result).toMatchObject({ draftContent: '新稿', writerTaskId: 44 })
    expect(state.expectedContent).toBe('新稿')
    expect(runtime.checkpointContent).toHaveBeenCalledWith({
      persistedContent: '新稿',
      resumableContent: '新稿',
      resumeSourceTaskId: 44,
    })
    expect(bindings.finishRole).toHaveBeenCalledWith('writer', 44, '正文初稿已生成，等待 Critic 审校。')
  })

  it('persists Critic notes only for a fresh run and reuses the role snapshot otherwise', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(2, 104, '', { content: '', contextVersion: 2 }),
      contractVersion: '', latestReviewNotesJson: '', expectedContent: '', expectedContextVersion: 2,
    })
    const bindings = { finishRole: vi.fn(), reuseRole: vi.fn() }
    const persist = vi.fn()
    const notes = { ...buildFallbackReviewNotes(''), summary: '已审校' }
    expect(commitCriticStageOutput({
      state, bindings: bindings as never, chapterId: 2,
      output: { reviewNotes: notes, semanticReview: null, effectiveMode: 'off', taskId: 9, reused: false },
      persistReviewNotes: persist,
    })).toBe(notes)
    expect(persist).toHaveBeenCalledWith(2, JSON.stringify(notes))
    expect(bindings.finishRole).toHaveBeenCalledWith('critic', 9, 'Critic 审校完成，已生成本章修订意见。')

    commitEnforcerStageOutput({
      state, bindings: bindings as never,
      output: { reviewNotes: notes, taskId: 10, reused: true },
    })
    expect(bindings.reuseRole).toHaveBeenCalledWith('enforcer', expect.objectContaining({ taskId: 10 }))
  })

  it('commits fresh and reused Rewriter outputs through one snapshot boundary', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(3, 105, '', { content: '旧稿', contextVersion: 4 }),
      contractVersion: '', latestReviewNotesJson: '', expectedContent: '旧稿', expectedContextVersion: 4,
    })
    const bindings = { finishRole: vi.fn(), reuseRole: vi.fn(), sync: vi.fn() }
    const notes = { ...buildFallbackReviewNotes(''), summary: '重写已验收' }
    const publishCheck = { ready: true, summary: '通过' }

    expect(commitRewriterStageOutput({
      state,
      bindings: bindings as never,
      output: {
        content: '  新正文  ',
        reviewNotes: notes,
        publishCheck: publishCheck as never,
        taskId: 21,
        reused: false,
      },
    })).toEqual({ content: '  新正文  ', reviewNotes: notes, publishCheck, taskId: 21 })
    expect(state.latestUsableDraft).toBe('新正文')
    expect(state.latestReviewNotesJson).toBe(JSON.stringify(notes))
    expect(state.snapshot).toMatchObject({
      partialContent: '  新正文  ',
      resumeSourceTaskId: 21,
    })
    expect(bindings.finishRole).toHaveBeenCalledWith('rewriter', 21, '正文已完成重写，准备生成 Canon 差异草案。')
    expect(bindings.sync).toHaveBeenCalledTimes(1)

    commitRewriterStageOutput({
      state,
      bindings: bindings as never,
      output: {
        content: '复用正文',
        reviewNotes: notes,
        publishCheck: publishCheck as never,
        taskId: 18,
        reused: true,
      },
      resumeSourceTaskId: 17,
    })
    expect(bindings.reuseRole).toHaveBeenCalledWith('rewriter', {
      taskId: 18,
      detail: '复用不可变 Rewriter 快照，未重复生成正文。',
      outputText: '已复用 Rewriter 不可变快照，直接进入指定节点。',
      snapshot: { partialContent: '复用正文', resumeSourceTaskId: 17 },
    })
    expect(state.snapshot).toMatchObject({ partialContent: '复用正文', resumeSourceTaskId: 18 })
    expect(bindings.sync).toHaveBeenCalledTimes(2)
  })

  it('checkpoints contextVersion once and commits the final pipeline status', () => {
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(4, 106, '', { content: '正文', contextVersion: 5 }),
      contractVersion: '', latestReviewNotesJson: '', expectedContent: '正文', expectedContextVersion: 5,
    })
    const checkpointedSnapshot = { ...state.snapshot, baseContextVersion: 6 }
    const runtime = {
      adoptSnapshot: vi.fn(),
      checkpointContext: vi.fn(() => checkpointedSnapshot),
      emitProgress: vi.fn(),
    }
    const bindings = { sync: vi.fn(), setStatus: vi.fn() }

    checkpointChapterPipelineContextVersion({
      state,
      runtime: runtime as never,
      bindings,
      contextVersion: 6,
    })
    checkpointChapterPipelineContextVersion({
      state,
      runtime: runtime as never,
      bindings,
      contextVersion: 6,
    })
    expect(state.expectedContextVersion).toBe(6)
    expect(runtime.checkpointContext).toHaveBeenCalledTimes(1)
    expect(bindings.sync).toHaveBeenCalledTimes(1)

    commitChapterPipelineSuccess({
      state,
      runtime: runtime as never,
      bindings,
      chapterNum: 4,
      result: { summary: '已完成', nextChapterSeed: '下一章线索' },
    })
    expect(state.snapshot).toMatchObject({
      currentRole: 'finalize',
      currentStage: 'completed',
      status: 'success',
      recoveryHint: undefined,
    })
    expect(bindings.setStatus).toHaveBeenCalledWith('success', expect.objectContaining({
      currentChildTaskId: null,
      outputText: '第4章流水线完成。 摘要：已完成 下一章开场建议：下一章线索',
      errorMessage: null,
      recoveryHintJson: null,
    }))
    expect(runtime.emitProgress).toHaveBeenCalledWith({
      stage: 'completed',
      label: '完成入稿',
      detail: '章节已完成角色化流水线，并写入摘要、连续性与 Canon 草案。',
      status: 'success',
      role: 'finalize',
    })
  })
})
