import type { WebContents } from 'electron'
import type { chapters } from '../database/schema'
import type { AiExecutionMode } from '../../src/types'
import type { ChapterContext, HardConstraintSourceLabel } from './context.service'
import type { ScenePlanStep } from './chapter-scene-plan'
import type { ThemeVoiceDocument } from '../../src/shared/theme-voice'
import type { SemanticGatePolicy } from '../../src/shared/semantic-gate-policy'
import type { ChapterReviewNotes } from './chapter-review-notes'
import type { WriterExecutionOutput } from './chapter-pipeline-writer'
import type { CriticExecutionOutput, EnforcerExecutionOutput } from './chapter-pipeline-review'
import type { PlannerExecutionOutput } from './chapter-pipeline-planner'
import type { ChapterPublishCheck } from './chapter-publish-types'
import type { ChapterPipelineSnapshot } from './chapter-pipeline-state'
import {
  parseChapterPipelineSnapshot,
  type ChapterPipelineFailureCode,
  type ChapterPipelineRole,
  type StepMemoryRuntimeState,
} from './chapter-pipeline-state'
import {
  ChapterPipelineRuntime,
  createChapterPipelineRuntimeBindings,
  type ChapterPipelineRuntimeBindings,
  type RuntimeProgress,
} from './chapter-pipeline-runtime'
import type { TaskRecoveryHint } from '../../src/types'
import type {
  ChapterComplexity,
  ChapterPipelinePromptGuidanceBundle,
  ChapterRawContext,
  StageContextResolverPayload,
} from './chapter-pipeline-context'

/**
 * 流水线在阶段之间流动的可变状态。
 *
 * 只有这一份实例在 façade 与各阶段模块之间共享，阶段模块通过它读写正文、审校
 * 快照与 CAS 期望值，避免每个阶段各自复制状态转换语义。
 */
export interface ChapterPipelineDraftState {
  snapshot: ChapterPipelineSnapshot
  contractVersion: string
  hasCommittedContent: boolean
  latestUsableDraft: string
  latestReviewNotesJson: string
  /** CAS 写回时的期望正文，随每次成功写入推进。 */
  expectedContent: string
  /** CAS 写回时的期望上下文版本，随 contextVersion 检查点推进。 */
  expectedContextVersion: number
}

export interface ChapterPipelineExecutionModeResolution {
  mode: AiExecutionMode
  source: string
}

/**
 * 单次流水线运行内不再变化的准备产物。上下文准备阶段构造一次，之后各阶段只读。
 */
export interface ChapterPipelineStageShared {
  chapterId: number
  chapter: typeof chapters.$inferSelect
  rawContext: ChapterRawContext
  novel: ChapterRawContext['novel']
  profile: ChapterRawContext['profile']
  sender?: WebContents
  runtime: ChapterPipelineRuntime
  bindings: ChapterPipelineRuntimeBindings
  /** 精确节点重试时的上游快照，用于复用已固化的角色产物。 */
  retrySnapshot: Partial<ChapterPipelineSnapshot> | null

  complexity: ChapterComplexity
  executionMode: ChapterPipelineExecutionModeResolution
  activePromptOverrideKeys: string[]
  preserveConstraintLabels?: HardConstraintSourceLabel[]

  themeVoice: ThemeVoiceDocument
  storyCore: string
  consistencyNotes: string
  structuralAlertsSummary: string
  chapterTitle: string
  chapterWordTarget: number
  fallbackScenePlan: ScenePlanStep[]

  draftResolution: StageContextResolverPayload
  promptGuidance: ChapterPipelinePromptGuidanceBundle
  semanticGatePolicy: SemanticGatePolicy
  glossaryTerms: string[]
  guardrailKnownTerms: string[]
}

export function createChapterPipelineDraftState(init: {
  snapshot: ChapterPipelineSnapshot
  contractVersion: string
  latestReviewNotesJson: string
  expectedContent: string
  expectedContextVersion: number
}): ChapterPipelineDraftState {
  return {
    snapshot: init.snapshot,
    contractVersion: init.contractVersion,
    hasCommittedContent: false,
    latestUsableDraft: '',
    latestReviewNotesJson: init.latestReviewNotesJson,
    expectedContent: init.expectedContent,
    expectedContextVersion: init.expectedContextVersion,
  }
}

export interface CreateChapterPipelineSessionInput {
  chapter: typeof chapters.$inferSelect
  sender?: WebContents
  idempotencyKey?: string
  stageId?: number
  resumeDraft?: string
  resumeSourceTaskId?: number
  retryNodeRole?: ChapterPipelineRole
  retrySourceNodeRunId?: number
  retryReason?: string
  retryUpstreamSnapshotId?: string | null
  executionMode: AiExecutionMode
  modelConfigId?: number
  initialContextVersion: number
  previousStatus: string
  onWorkflowTaskCreated?(taskId: number): void
  loadRetrySnapshot?(taskId: number): string | null | undefined
  buildRecoveryHint(role: ChapterPipelineRole, failureCode?: ChapterPipelineFailureCode): TaskRecoveryHint
  getOutputRefs(state: ChapterPipelineDraftState): {
    chapterId: number
    contentHash: string
    scenePlanHash: string
    reviewNotesHash: string
  }
  onProgress(snapshot: ChapterPipelineSnapshot, progress: RuntimeProgress): void
  persistUsableDraft(input: {
    expectedContent: string
    expectedContextVersion: number
    content: string
    reviewNotesJson: string
  }): string
  updateFailureStatus(status: string, restorePrevious: boolean): void
}

export interface ChapterPipelineSession {
  runtime: ChapterPipelineRuntime
  bindings: ChapterPipelineRuntimeBindings
  state: ChapterPipelineDraftState
  retrySnapshot: Partial<ChapterPipelineSnapshot> | null
}

export async function createChapterPipelineSession(
  input: CreateChapterPipelineSessionInput,
): Promise<ChapterPipelineSession> {
  const { chapter } = input
  const stateRef: { current?: ChapterPipelineDraftState } = {}
  const runtime = await ChapterPipelineRuntime.create({
    chapterId: chapter.id,
    novelId: chapter.novelId,
    modelConfigId: input.modelConfigId,
    sender: input.sender,
    idempotencyKey: input.idempotencyKey,
    stageId: input.stageId,
    resumeDraft: input.resumeDraft,
    resumeSourceTaskId: input.resumeSourceTaskId,
    executionMode: input.executionMode,
    initialContent: chapter.content || '',
    initialContextVersion: input.initialContextVersion,
    initialContractVersion: '',
    retry: {
      retryNodeRole: input.retryNodeRole,
      retrySourceNodeRunId: input.retrySourceNodeRunId,
      retryReason: input.retryReason,
      retryUpstreamSnapshotId: input.retryUpstreamSnapshotId,
    },
    onWorkflowTaskCreated: input.onWorkflowTaskCreated,
    buildRecoveryHint: input.buildRecoveryHint,
    getOutputRefs: () => {
      if (!stateRef.current) throw new Error('Chapter pipeline session state is not initialized')
      return input.getOutputRefs(stateRef.current)
    },
    onProgress: input.onProgress,
  })
  const state = createChapterPipelineDraftState({
    snapshot: runtime.snapshot,
    contractVersion: '',
    latestReviewNotesJson: chapter.reviewNotesJson || '',
    expectedContent: chapter.content || '',
    expectedContextVersion: input.initialContextVersion,
  })
  stateRef.current = state
  const bindings = createChapterPipelineRuntimeBindings({
    runtime,
    chapter,
    chapterId: chapter.id,
    previousStatus: input.previousStatus,
    getSnapshot: () => state.snapshot,
    setSnapshot: (snapshot) => { state.snapshot = snapshot },
    getLatestUsableDraft: () => state.latestUsableDraft,
    getLatestReviewNotesJson: () => state.latestReviewNotesJson,
    getHasCommittedContent: () => state.hasCommittedContent,
    setHasCommittedContent: (value) => { state.hasCommittedContent = value },
    persistUsableDraft: (content, reviewNotesJson) => input.persistUsableDraft({
      expectedContent: state.expectedContent,
      expectedContextVersion: state.expectedContextVersion,
      content,
      reviewNotesJson,
    }),
    setExpectedContent: (content) => { state.expectedContent = content },
    updateFailureStatus: input.updateFailureStatus,
    buildRecoveryHint: input.buildRecoveryHint,
  })
  const retrySnapshotJson = input.resumeSourceTaskId && input.loadRetrySnapshot
    ? input.loadRetrySnapshot(input.resumeSourceTaskId)
    : undefined
  return {
    runtime,
    bindings,
    state,
    retrySnapshot: parseChapterPipelineSnapshot(retrySnapshotJson),
  }
}

/**
 * 记录一个角色复用了不可变快照：只更新角色状态与上游任务指针，不重复调用模型。
 */
export function adoptReusedRoleSnapshot(input: {
  state: ChapterPipelineDraftState
  shared: Pick<ChapterPipelineStageShared, 'runtime' | 'bindings'>
  role: keyof ChapterPipelineSnapshot['roles']
  detail: string
  taskId?: number
  outputText?: string
  extraSnapshot?: Partial<Pick<
    ChapterPipelineSnapshot,
    'contractVersion' | 'stepMemory' | 'partialContent' | 'resumeSourceTaskId' | 'canonRunId'
  >>
}): void {
  const { state, shared } = input
  shared.bindings.reuseRole(input.role, {
    taskId: input.taskId,
    detail: input.detail,
    outputText: input.outputText,
    snapshot: input.extraSnapshot,
  })
  state.snapshot = shared.runtime.snapshot
}

export function setDraftReviewNotes(
  state: ChapterPipelineDraftState,
  reviewNotes: ChapterReviewNotes,
): string {
  state.latestReviewNotesJson = JSON.stringify(reviewNotes)
  return state.latestReviewNotesJson
}

export function commitWriterStageOutput(input: {
  state: ChapterPipelineDraftState
  runtime: ChapterPipelineRuntime
  bindings: ChapterPipelineRuntimeBindings
  chapterContent: string
  writerOutput: WriterExecutionOutput
  resumeSourceTaskId?: number
  persistContent: (input: {
    expectedContent: string
    expectedContextVersion: number
    content: string
  }) => string
}): { draftContent: string; draftTitleMismatchRisk: string; writerTaskId: number } {
  const { state, runtime, bindings, writerOutput } = input
  const draftContent = writerOutput.content
  const writerTaskId = writerOutput.taskId || 0
  state.latestUsableDraft = draftContent.trim()
  if (!writerOutput.reused) {
    state.expectedContent = input.persistContent({
      expectedContent: state.expectedContent,
      expectedContextVersion: state.expectedContextVersion,
      content: state.latestUsableDraft,
    })
    state.hasCommittedContent = true
    runtime.adoptSnapshot(state.snapshot)
    state.snapshot = runtime.checkpointContent({
      persistedContent: state.latestUsableDraft,
      resumableContent: state.latestUsableDraft,
      resumeSourceTaskId: writerTaskId,
    })
    bindings.sync({ outputText: 'Writer 初稿已保存为待人工审核/可重试草稿。' })
    bindings.finishRole(
      'writer',
      writerTaskId,
      writerOutput.resumed ? '保留稿已重新进入完整审校链。' : '正文初稿已生成，等待 Critic 审校。',
    )
  } else {
    state.hasCommittedContent = true
    state.expectedContent = input.chapterContent || state.expectedContent
    bindings.reuseRole('writer', {
      taskId: writerTaskId || undefined,
      detail: '复用不可变 Writer 快照，未重复生成正文。',
      outputText: '已复用 Writer 不可变快照，直接进入指定节点。',
      snapshot: {
        partialContent: state.latestUsableDraft,
        resumeSourceTaskId: input.resumeSourceTaskId,
      },
    })
  }
  return {
    draftContent,
    draftTitleMismatchRisk: writerOutput.titleMismatchRisk,
    writerTaskId,
  }
}

export function commitCriticStageOutput(input: {
  state: ChapterPipelineDraftState
  bindings: ChapterPipelineRuntimeBindings
  chapterId: number
  output: CriticExecutionOutput
  persistReviewNotes: (chapterId: number, reviewNotesJson: string) => void
}): ChapterReviewNotes {
  const reviewNotes = input.output.reviewNotes
  input.state.latestReviewNotesJson = JSON.stringify(reviewNotes)
  if (!input.output.reused && typeof input.output.taskId === 'number') {
    input.persistReviewNotes(input.chapterId, input.state.latestReviewNotesJson)
    input.bindings.finishRole('critic', input.output.taskId, 'Critic 审校完成，已生成本章修订意见。')
  } else {
    input.bindings.reuseRole('critic', {
      taskId: input.output.taskId,
      detail: '复用不可变 Critic 快照，未重复调用模型。',
      outputText: '已复用 Critic 不可变快照，直接进入指定节点。',
    })
  }
  return reviewNotes
}

export function commitEnforcerStageOutput(input: {
  state: ChapterPipelineDraftState
  bindings: ChapterPipelineRuntimeBindings
  output: EnforcerExecutionOutput
}): ChapterReviewNotes {
  input.state.latestReviewNotesJson = JSON.stringify(input.output.reviewNotes)
  if (input.output.reused) {
    input.bindings.reuseRole('enforcer', {
      taskId: input.output.taskId,
      detail: '复用不可变 Enforcer 快照，未重复执行护栏扫描。',
      outputText: '已复用 Enforcer 不可变快照，直接进入指定节点。',
    })
  }
  return input.output.reviewNotes
}

export interface RewriterStageCommitOutput {
  content: string
  reviewNotes: ChapterReviewNotes
  publishCheck: ChapterPublishCheck
  taskId: number
  reused: boolean
}

export function commitRewriterStageOutput(input: {
  state: ChapterPipelineDraftState
  bindings: ChapterPipelineRuntimeBindings
  output: RewriterStageCommitOutput
  resumeSourceTaskId?: number
}): Omit<RewriterStageCommitOutput, 'reused'> {
  const { state, bindings, output } = input
  state.latestUsableDraft = output.content.trim()
  state.latestReviewNotesJson = JSON.stringify(output.reviewNotes)
  if (output.reused) {
    bindings.reuseRole('rewriter', {
      taskId: output.taskId || undefined,
      detail: '复用不可变 Rewriter 快照，未重复生成正文。',
      outputText: '已复用 Rewriter 不可变快照，直接进入指定节点。',
      snapshot: {
        partialContent: output.content,
        resumeSourceTaskId: input.resumeSourceTaskId,
      },
    })
  } else {
    bindings.finishRole('rewriter', output.taskId, '正文已完成重写，准备生成 Canon 差异草案。')
  }
  state.snapshot = {
    ...state.snapshot,
    partialContent: output.content,
    resumeReason: undefined,
    resumeSourceTaskId: output.taskId,
  }
  bindings.sync()
  return {
    content: output.content,
    reviewNotes: output.reviewNotes,
    publishCheck: output.publishCheck,
    taskId: output.taskId,
  }
}

export function checkpointChapterPipelineContextVersion(input: {
  state: ChapterPipelineDraftState
  runtime: ChapterPipelineRuntime
  bindings: Pick<ChapterPipelineRuntimeBindings, 'sync'>
  contextVersion: number
}): void {
  if (input.state.snapshot.baseContextVersion === input.contextVersion) return
  input.state.expectedContextVersion = input.contextVersion
  input.runtime.adoptSnapshot(input.state.snapshot)
  input.state.snapshot = input.runtime.checkpointContext(input.contextVersion)
  input.bindings.sync()
}

export function checkpointPlannerContractVersion(input: {
  state: ChapterPipelineDraftState
  bindings: Pick<ChapterPipelineRuntimeBindings, 'sync'>
  taskId: number
  contractVersion: string
  persistTaskContractVersion: (taskId: number, contractVersion: string) => void
}): void {
  input.state.snapshot = {
    ...input.state.snapshot,
    contractVersion: input.contractVersion,
    roles: {
      ...input.state.snapshot.roles,
      planner: {
        ...input.state.snapshot.roles.planner,
        contractVersion: input.contractVersion,
      },
    },
  }
  input.bindings.sync()
  input.persistTaskContractVersion(input.taskId, input.contractVersion)
}

export function commitPlannerStageOutput(input: {
  state: ChapterPipelineDraftState
  bindings: Pick<ChapterPipelineRuntimeBindings, 'sync' | 'finishRole' | 'reuseRole'>
  output: PlannerExecutionOutput
  stepMemory: StepMemoryRuntimeState
}): void {
  input.state.contractVersion = input.output.contractVersion
  input.state.snapshot = {
    ...input.state.snapshot,
    contractVersion: input.state.contractVersion,
    stepMemory: input.stepMemory,
  }
  if (input.output.reused) {
    input.bindings.reuseRole('planner', {
      taskId: input.output.taskId,
      detail: '复用不可变 Planner 快照，未重复调用模型。',
      extra: { contractVersion: input.state.contractVersion },
    })
  } else if (typeof input.output.taskId === 'number') {
    input.bindings.sync()
    input.bindings.finishRole(
      'planner',
      input.output.taskId,
      `场景计划已固化 ${input.output.scenePlan.length} 段。`,
    )
  }
}

export function commitChapterPipelineSuccess(input: {
  state: ChapterPipelineDraftState
  runtime: ChapterPipelineRuntime
  bindings: Pick<ChapterPipelineRuntimeBindings, 'setStatus'>
  chapterNum: number
  result: {
    summary: string
    nextChapterSeed: string
  }
}): void {
  input.state.snapshot = {
    ...input.state.snapshot,
    currentRole: 'finalize',
    currentStage: 'completed',
    status: 'success',
    message: '章节已完成角色化流水线，并落成 Canon 草案。',
    recoveryHint: undefined,
  }
  input.bindings.setStatus('success', {
    currentChildTaskId: null,
    outputText: [
      `第${input.chapterNum}章流水线完成。`,
      input.result.summary ? `摘要：${input.result.summary}` : '',
      input.result.nextChapterSeed ? `下一章开场建议：${input.result.nextChapterSeed}` : '',
    ].filter(Boolean).join(' '),
    errorMessage: null,
    recoveryHintJson: null,
  })
  input.runtime.emitProgress({
    stage: 'completed',
    label: '完成入稿',
    detail: '章节已完成角色化流水线，并写入摘要、连续性与 Canon 草案。',
    status: 'success',
    role: 'finalize',
  })
}

export type ChapterPipelineStageContexts = {
  scenePlanContext: ChapterContext
  draftContext: ChapterContext
  reviewContext: ChapterContext
  rewriteContext: ChapterContext
}
