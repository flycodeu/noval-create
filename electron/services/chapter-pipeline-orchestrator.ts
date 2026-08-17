import type { ProgressSink } from '../utils/progress-sink'
import type { ChatOptions } from '../adapters/base.adapter'
import type { ScenePlanStep } from './chapter-scene-plan'
import {
  executeChapterPlannerPhase,
  type ChapterPlannerPromptInput,
  type PlannerExecutionOutput,
} from './chapter-pipeline-planner'
import {
  checkpointPlannerContractVersion,
  commitCriticStageOutput,
  commitEnforcerStageOutput,
  commitWriterStageOutput,
  setDraftReviewNotes,
  type ChapterPipelineDraftState,
} from './chapter-pipeline-session'
import type { ChapterPipelineRuntime } from './chapter-pipeline-runtime'
import type { ChapterPipelineRuntimeBindings } from './chapter-pipeline-runtime'
import {
  runChapterCriticStage,
  runChapterEnforcerStage,
} from './chapter-pipeline-review'
import { executeChapterWriterPhase } from './chapter-pipeline-writer'

/**
 * 只负责把 Planner 阶段接到共享 runtime；prompt 与持久化仍由调用方提供，
 * 这样阶段模块不需要反向依赖 chapter.service 的数据库 façade。
 */
export async function executeChapterPlannerRuntimePhase(input: {
  prompt: ChapterPlannerPromptInput
  shouldRun: boolean
  chapterId: number
  novelId: number
  modelConfigId?: number
  sender?: ProgressSink
  chatOptions: ChatOptions
  fallbackScenePlan: ScenePlanStep[]
  storedScenePlanJson?: string | null
  priorTaskId?: number
  state: ChapterPipelineDraftState
  runtime: Pick<ChapterPipelineRuntime, 'setUpstreamTaskId'>
  bindings: Pick<ChapterPipelineRuntimeBindings, 'startRole' | 'failRole' | 'sync'>
  validateContracts: () => string
  persistScenePlan: (scenePlan: ScenePlanStep[]) => void
  persistTaskContractVersion: (taskId: number, contractVersion: string) => void
}): Promise<PlannerExecutionOutput> {
  return executeChapterPlannerPhase({
    prompt: input.prompt,
    shouldRun: input.shouldRun,
    chapterId: input.chapterId,
    novelId: input.novelId,
    modelConfigId: input.modelConfigId,
    sender: input.sender,
    chatOptions: input.chatOptions,
    fallbackScenePlan: input.fallbackScenePlan,
    storedScenePlanJson: input.storedScenePlanJson,
    priorTaskId: input.priorTaskId,
    startRole: (messages) => input.bindings.startRole(
      'planner',
      'chapter_planner',
      '先把章节合同落成可执行的场景链。',
      { inputJson: JSON.stringify(messages), runnerType: 'chat' },
    ),
    validateContracts: input.validateContracts,
    onContractValidated: (contractVersion, taskId) => checkpointPlannerContractVersion({
      state: input.state,
      bindings: input.bindings,
      taskId,
      contractVersion,
      persistTaskContractVersion: input.persistTaskContractVersion,
    }),
    failRole: (taskId, error) => input.bindings.failRole('planner', taskId, error, { blocked: true }),
    persistScenePlan: input.persistScenePlan,
    setUpstreamTaskId: (taskId) => input.runtime.setUpstreamTaskId(taskId),
  })
}

type ChapterWriterPhaseInput = Parameters<typeof executeChapterWriterPhase>[0]

export async function executeChapterWriterRuntimePhase(input: Omit<
  ChapterWriterPhaseInput,
  'startRole' | 'failRole'
> & {
  state: ChapterPipelineDraftState
  runtime: ChapterPipelineRuntime
  bindings: ChapterPipelineRuntimeBindings
  chapterContent: string
  resumeSourceTaskId?: number
  persistContent: Parameters<typeof commitWriterStageOutput>[0]['persistContent']
}): Promise<ReturnType<typeof commitWriterStageOutput>> {
  const {
    state,
    runtime,
    bindings,
    chapterContent,
    resumeSourceTaskId,
    persistContent,
    ...phaseInput
  } = input
  const output = await executeChapterWriterPhase({
    ...phaseInput,
    startRole: (messages, resumed) => bindings.startRole(
      'writer',
      'chapter_writer',
      resumed
        ? 'Writer 已接收失败流程保留稿，将直接进入 Critic 与后续质量门。'
        : 'Writer 正在按章节合同与场景计划生成正文初稿。',
      { inputJson: JSON.stringify(messages), runnerType: resumed ? 'workflow' : 'chat' },
    ),
    failRole: (taskId, error, blocked) => bindings.failRole('writer', taskId, error, { blocked }),
  })
  return commitWriterStageOutput({
    state,
    runtime,
    bindings,
    chapterContent,
    writerOutput: output,
    resumeSourceTaskId,
    persistContent,
  })
}

type ChapterCriticPhaseInput = Parameters<typeof runChapterCriticStage>[0]

export async function executeChapterCriticRuntimePhase(input: Omit<
  ChapterCriticPhaseInput,
  'startRole' | 'failRole'
> & {
  state: ChapterPipelineDraftState
  bindings: ChapterPipelineRuntimeBindings
  persistReviewNotes: (chapterId: number, reviewNotesJson: string) => void
}): Promise<Awaited<ReturnType<typeof runChapterCriticStage>>> {
  const { state, bindings, persistReviewNotes, ...phaseInput } = input
  const output = await runChapterCriticStage({
    ...phaseInput,
    startRole: (messages) => bindings.startRole(
      'critic',
      'chapter_critic',
      'Critic 正在检查连续性、节奏、角色口吻与语言问题。',
      { inputJson: JSON.stringify(messages), runnerType: 'chat' },
    ),
    failRole: (taskId, error, blocked) => bindings.failRole('critic', taskId, error, { blocked }),
  })
  const reviewNotes = commitCriticStageOutput({
    state,
    bindings,
    chapterId: phaseInput.chapterId,
    output,
    persistReviewNotes,
  })
  return { ...output, reviewNotes }
}

type ChapterEnforcerPhaseInput = Parameters<typeof runChapterEnforcerStage>[0]

export async function executeChapterEnforcerRuntimePhase(input: Omit<
  ChapterEnforcerPhaseInput,
  'startRole' | 'persistReviewNotes' | 'finishRole' | 'failRole'
> & {
  state: ChapterPipelineDraftState
  bindings: ChapterPipelineRuntimeBindings
  persistReviewNotesJson: (reviewNotesJson: string) => void
}): Promise<Awaited<ReturnType<typeof runChapterEnforcerStage>>> {
  const { state, bindings, persistReviewNotesJson, ...phaseInput } = input
  const output = await runChapterEnforcerStage({
    ...phaseInput,
    startRole: () => bindings.startRole(
      'enforcer',
      'chapter_critic',
      'Enforcer 强制防 AI 味和对话指纹拦截。',
      { inputJson: JSON.stringify({
        draftContent: phaseInput.content,
        novelId: phaseInput.novelId,
        chapterId: phaseInput.chapterId,
      }) },
    ),
    persistReviewNotes: (reviewNotes) => {
      persistReviewNotesJson(setDraftReviewNotes(state, reviewNotes))
    },
    finishRole: (taskId) => bindings.finishRole('enforcer', taskId, 'Enforcer 校验完成。'),
    failRole: (taskId, error) => bindings.failRole('enforcer', taskId, error, { blocked: true }),
  })
  return {
    ...output,
    reviewNotes: commitEnforcerStageOutput({ state, bindings, output }),
  }
}
