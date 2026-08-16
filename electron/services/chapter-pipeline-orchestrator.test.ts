import { describe, expect, it, vi } from 'vitest'
import { createInitialChapterPipelineSnapshot } from './chapter-pipeline-state'

const mocks = vi.hoisted(() => ({
  executePlanner: vi.fn(),
  executeWriter: vi.fn(),
  runCritic: vi.fn(),
  runEnforcer: vi.fn(),
}))

vi.mock('./chapter-pipeline-planner', async () => {
  const actual = await vi.importActual<typeof import('./chapter-pipeline-planner')>('./chapter-pipeline-planner')
  return { ...actual, executeChapterPlannerPhase: mocks.executePlanner }
})

vi.mock('./chapter-pipeline-writer', async () => {
  const actual = await vi.importActual<typeof import('./chapter-pipeline-writer')>('./chapter-pipeline-writer')
  return { ...actual, executeChapterWriterPhase: mocks.executeWriter }
})

vi.mock('./chapter-pipeline-review', async () => {
  const actual = await vi.importActual<typeof import('./chapter-pipeline-review')>('./chapter-pipeline-review')
  return {
    ...actual,
    runChapterCriticStage: mocks.runCritic,
    runChapterEnforcerStage: mocks.runEnforcer,
  }
})

import {
  executeChapterCriticRuntimePhase,
  executeChapterEnforcerRuntimePhase,
  executeChapterPlannerRuntimePhase,
  executeChapterWriterRuntimePhase,
} from './chapter-pipeline-orchestrator'
import { createChapterPipelineDraftState } from './chapter-pipeline-session'
import { buildFallbackReviewNotes } from './chapter-review-notes'

describe('chapter pipeline orchestrator', () => {
  it('wires Planner task callbacks and contract checkpoints through the shared session', async () => {
    let plannerInput: Record<string, unknown> | undefined
    mocks.executePlanner.mockImplementation(async (input: Record<string, unknown>) => {
      plannerInput = input
      return {
        scenePlan: [{ scene_order: 1 }],
        scenePlanText: '场景1',
        sceneDesignFieldGaps: [],
        contractVersion: 'contract-v2',
        taskId: 71,
        reused: false,
      }
    })
    const state = {
      snapshot: createInitialChapterPipelineSnapshot(1, 70, '', { content: '', contextVersion: 3 }),
      contractVersion: '',
    }
    const bindings = {
      startRole: vi.fn().mockResolvedValue(71),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      sync: vi.fn(),
    }
    const runtime = { setUpstreamTaskId: vi.fn() }
    const persistVersion = vi.fn()

    const output = await executeChapterPlannerRuntimePhase({
      prompt: {} as never,
      shouldRun: true,
      chapterId: 1,
      novelId: 7,
      chatOptions: {},
      fallbackScenePlan: [],
      state: state as never,
      runtime,
      bindings: bindings as never,
      validateContracts: () => 'contract-v2',
      persistScenePlan: vi.fn(),
      persistTaskContractVersion: persistVersion,
    })

    expect(output.contractVersion).toBe('contract-v2')
    await (plannerInput?.startRole as (messages: unknown[]) => Promise<number>)([])
    expect(bindings.startRole).toHaveBeenCalledWith(
      'planner',
      'chapter_planner',
      '先把章节合同落成可执行的场景链。',
      { inputJson: '[]', runnerType: 'chat' },
    )
    ;(plannerInput?.onContractValidated as (version: string, taskId: number) => void)('contract-v2', 71)
    expect(state.snapshot).toMatchObject({
      contractVersion: 'contract-v2',
      roles: { planner: { contractVersion: 'contract-v2' } },
    })
    expect(persistVersion).toHaveBeenCalledWith(71, 'contract-v2')
    ;(plannerInput?.setUpstreamTaskId as (taskId: number) => void)(71)
    expect(runtime.setUpstreamTaskId).toHaveBeenCalledWith(71)
  })

  it('runs Writer through the shared task contract and commits its CAS checkpoint', async () => {
    let writerInput: Record<string, unknown> | undefined
    mocks.executeWriter.mockImplementation(async (input: Record<string, unknown>) => {
      writerInput = input
      return {
        content: '第二章新稿',
        titleMismatchRisk: '',
        taskId: 72,
        reused: false,
        resumed: false,
      }
    })
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(2, 70, '', { content: '第二章旧稿', contextVersion: 4 }),
      contractVersion: 'contract-v2',
      latestReviewNotesJson: '',
      expectedContent: '第二章旧稿',
      expectedContextVersion: 4,
    })
    const runtime = {
      adoptSnapshot: vi.fn(),
      checkpointContent: vi.fn(() => ({
        ...state.snapshot,
        partialContent: '第二章新稿',
        resumeSourceTaskId: 72,
      })),
    }
    const bindings = {
      startRole: vi.fn().mockResolvedValue(72),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      sync: vi.fn(),
      finishRole: vi.fn(),
      reuseRole: vi.fn(),
    }
    const persistContent = vi.fn(() => '第二章新稿')

    const output = await executeChapterWriterRuntimePhase({
      promptInput: {} as never,
      shouldRun: true,
      chapterId: 2,
      novelId: 7,
      chapterNum: 2,
      chapterTitle: '缺页',
      chatOptions: {},
      contractVersion: 'contract-v2',
      scenePlanText: '场景1',
      initialContent: '第二章旧稿',
      state,
      runtime: runtime as never,
      bindings: bindings as never,
      chapterContent: '第二章旧稿',
      persistContent,
    })

    expect(output).toMatchObject({ draftContent: '第二章新稿', writerTaskId: 72 })
    await (writerInput?.startRole as (messages: unknown[], resumed: boolean) => Promise<number>)([], false)
    expect(bindings.startRole).toHaveBeenCalledWith(
      'writer',
      'chapter_writer',
      'Writer 正在按章节合同与场景计划生成正文初稿。',
      { inputJson: '[]', runnerType: 'chat' },
    )
    expect(persistContent).toHaveBeenCalledWith({
      expectedContent: '第二章旧稿',
      expectedContextVersion: 4,
      content: '第二章新稿',
    })
    expect(bindings.finishRole).toHaveBeenCalledWith('writer', 72, '正文初稿已生成，等待 Critic 审校。')
  })

  it('commits Critic and Enforcer review snapshots without duplicating fresh role completion', async () => {
    let criticInput: Record<string, unknown> | undefined
    let enforcerInput: Record<string, unknown> | undefined
    const criticNotes = { ...buildFallbackReviewNotes(''), summary: 'Critic 已完成' }
    const enforcedNotes = {
      ...criticNotes,
      critical_fixes: [...criticNotes.critical_fixes, '清理 AI 味表达'],
    }
    mocks.runCritic.mockImplementation(async (input: Record<string, unknown>) => {
      criticInput = input
      return {
        reviewNotes: criticNotes,
        semanticReview: null,
        effectiveMode: 'off',
        taskId: 81,
        reused: false,
      }
    })
    mocks.runEnforcer.mockImplementation(async (input: Record<string, unknown>) => {
      enforcerInput = input
      ;(input.persistReviewNotes as (notes: typeof enforcedNotes) => void)(enforcedNotes)
      ;(input.finishRole as (taskId: number) => void)(82)
      return { reviewNotes: enforcedNotes, taskId: 82, reused: false }
    })
    const state = createChapterPipelineDraftState({
      snapshot: createInitialChapterPipelineSnapshot(2, 80, '', { content: '正文', contextVersion: 4 }),
      contractVersion: 'contract-v2',
      latestReviewNotesJson: '',
      expectedContent: '正文',
      expectedContextVersion: 4,
    })
    const bindings = {
      startRole: vi.fn().mockResolvedValueOnce(81).mockResolvedValueOnce(82),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
      finishRole: vi.fn(),
      reuseRole: vi.fn(),
    }
    const persistCritic = vi.fn()
    const persistEnforcer = vi.fn()

    const criticOutput = await executeChapterCriticRuntimePhase({
      shouldRun: true,
      chapterId: 2,
      novelId: 7,
      promptInput: {} as never,
      chatOptions: {},
      contractVersion: 'contract-v2',
      initialReviewNotes: buildFallbackReviewNotes(''),
      enrichInput: {} as never,
      semanticInput: {} as never,
      state,
      bindings: bindings as never,
      persistReviewNotes: persistCritic,
    })
    await (criticInput?.startRole as (messages: unknown[]) => Promise<number>)([])
    expect(criticOutput.reviewNotes).toBe(criticNotes)
    expect(persistCritic).toHaveBeenCalledWith(2, JSON.stringify(criticNotes))
    expect(bindings.finishRole).toHaveBeenCalledWith('critic', 81, 'Critic 审校完成，已生成本章修订意见。')

    const enforcerOutput = await executeChapterEnforcerRuntimePhase({
      shouldRun: true,
      reviewNotes: criticNotes,
      novelId: 7,
      chapterId: 2,
      chapterNum: 2,
      content: '正文',
      genre: '悬疑',
      knownTerms: [],
      state,
      bindings: bindings as never,
      persistReviewNotesJson: persistEnforcer,
    })
    await (enforcerInput?.startRole as () => Promise<number>)()
    expect(enforcerOutput.reviewNotes).toBe(enforcedNotes)
    expect(persistEnforcer).toHaveBeenCalledWith(JSON.stringify(enforcedNotes))
    expect(bindings.finishRole).toHaveBeenCalledWith('enforcer', 82, 'Enforcer 校验完成。')
    expect(bindings.finishRole).toHaveBeenCalledTimes(2)
  })
})
