import type { WebContents } from 'electron'
import type { ChatOptions, Message } from '../adapters/base.adapter'
import { parseAiJsonResult } from '../utils/json'
import type { ChapterContext } from './context.service'
import {
  collectSceneDesignFieldGaps,
  formatScenePlan,
  loadScenePlanContractSeeds,
  normalizeScenePlan,
  writeBackSceneDesignFields,
  type ScenePlanStep,
} from './chapter-scene-plan'
import type { ChapterComplexity } from './chapter-pipeline-context'
import { reconcileScenePlanForContracts } from './scene-plan-reconciliation'
import { buildScenePlanPrompt } from './story-prompts'
import { executeChatTask } from './task.service'
import { buildPipelineFailureOutput, ChapterPipelineStageError } from './chapter-pipeline-errors'

export interface ChapterPromptNarrativeFields {
  povGuidance: string
  sensoryGuidance: string
  narrativeRatioGuidance: string
}

export interface ChapterPromptGuidance {
  povRotationGuidance: string
  storyPacingGuidance: string
  hookContinuityGuidance: string
  expressionDedupGuidance: string
  summaryHealthGuidance: string
  voiceEvolutionGuidance: string
}

export interface ChapterPlannerPromptInput {
  novelTitle: string
  genre: string
  chapterNum: number
  chapterTitle: string
  plotPoints: string
  emotionTone: string
  targetWords: number
  storyCore: string
  context: ChapterContext
  consistencyNotes: string
  runtimeAssertions: string[]
  narrativeFields: ChapterPromptNarrativeFields
  guidance: ChapterPromptGuidance
  protagonistReference: string
  protagonistRule: string
  promptTier: ChapterComplexity
  designGateDirective?: string
  rhythmSection?: string
}

export interface PlannerStageOutput {
  scenePlan: ScenePlanStep[]
  scenePlanText: string
  sceneDesignFieldGaps: string[]
}

export interface PlannerExecutionOutput extends PlannerStageOutput {
  taskId?: number
  contractVersion: string
  reused: boolean
}

export interface ResolvePlannerModelOutputInput {
  chapterId: number
  novelId: number
  rawOutput: string
  fallbackScenePlan: ScenePlanStep[]
  persistScenePlan: (scenePlan: ScenePlanStep[]) => void
  contractSeeds?: Parameters<typeof reconcileScenePlanForContracts>[1]
  writeBackDesignFields?: (chapterId: number, scenePlan: ScenePlanStep[]) => number
}

export function buildChapterPlannerMessages(input: ChapterPlannerPromptInput): Message[] {
  const { context } = input
  return [{
    role: 'user',
    content: buildScenePlanPrompt({
      novelTitle: input.novelTitle,
      genre: input.genre,
      chapterNum: input.chapterNum,
      chapterTitle: input.chapterTitle,
      chapterGoal: context.chapterGoal,
      hardConstraintContext: context.hardConstraintContext,
      dialogueVoiceLocks: context.dialogueVoiceLocks,
      designGateDirective: input.designGateDirective,
      rhythmSection: input.rhythmSection,
      plotPoints: input.plotPoints,
      emotionTone: input.emotionTone,
      targetWords: input.targetWords,
      storyCore: input.storyCore,
      writingContractSummary: context.writingContractSummary,
      relationSummary: context.relationSummary,
      currentArc: context.currentArc,
      worldRules: context.worldRules,
      characterStates: context.characterStates,
      worldStates: context.worldStates,
      mapSummary: context.mapSummary,
      itemSummary: context.itemSummary,
      previousSummaries: context.previousSummaries,
      previousChapterContext: context.previousChapterContext,
      lastChapterEnding: context.lastChapterEnding,
      chapterBridgePlan: context.chapterBridgePlan,
      stepMemorySummary: context.stepMemorySummary,
      runtimeAssertions: input.runtimeAssertions,
      continuitySummary: context.continuitySummary,
      openLoops: context.openLoops,
      dueForeshadows: context.dueForeshadows,
      continuityNotes: context.continuityNotes,
      timelineSummary: context.timelineSummary,
      timelineOpenThreads: context.timelineOpenThreads,
      longTermMemory: context.longTermMemory,
      recalledMemory: context.recalledMemory,
      consistencyNotes: input.consistencyNotes,
      activeThreads: context.activeThreads,
      ...input.narrativeFields,
      ...input.guidance,
      protagonistReference: input.protagonistReference,
      protagonistRule: input.protagonistRule,
      promptTier: input.promptTier,
    }),
  }]
}

export function resolvePlannerModelOutput(input: ResolvePlannerModelOutputInput): PlannerStageOutput {
  const parsed = parseAiJsonResult<unknown>(input.rawOutput, 'array', {
    channel: 'chapter',
    message: '章节场景规划 JSON 解析失败，已回退到后备场景计划继续生成。',
    consoleSummary: `[chapter:warn] scene-plan-json-fallback chapter=${input.chapterId}`,
    context: {
      chapterId: input.chapterId,
      novelId: input.novelId,
      stage: 'scene-plan',
    },
  })
  const normalized = parsed.success
    ? normalizeScenePlan(parsed.data, input.fallbackScenePlan)
    : input.fallbackScenePlan
  const reconciliation = reconcileScenePlanForContracts(
    normalized,
    input.contractSeeds || loadScenePlanContractSeeds(input.chapterId),
  )

  if (reconciliation.corrections.length > 0) {
    console.warn(
      `[chapter:plan] 已按章节合同收口场景计划 chapter=${input.chapterId}：${reconciliation.corrections.join('；')}`,
    )
  }
  input.persistScenePlan(reconciliation.plan)
  const writeBack = input.writeBackDesignFields || writeBackSceneDesignFields
  writeBack(input.chapterId, reconciliation.plan)

  const sceneDesignFieldGaps = collectSceneDesignFieldGaps(reconciliation.plan)
  if (sceneDesignFieldGaps.length > 0) {
    console.warn(`[chapter:plan] 场景设计字段缺口 chapter=${input.chapterId}：${sceneDesignFieldGaps.length} 项`)
  }

  return {
    scenePlan: reconciliation.plan,
    scenePlanText: formatScenePlan(reconciliation.plan),
    sceneDesignFieldGaps,
  }
}

export function loadReusablePlannerOutput(
  scenePlanJson: string | null | undefined,
  fallbackScenePlan: ScenePlanStep[],
): PlannerStageOutput | null {
  const scenePlan = scenePlanJson?.trim()
    ? normalizeScenePlan(JSON.parse(scenePlanJson) as unknown, fallbackScenePlan)
    : []
  if (scenePlan.length === 0) return null
  return {
    scenePlan,
    scenePlanText: formatScenePlan(scenePlan),
    sceneDesignFieldGaps: collectSceneDesignFieldGaps(scenePlan),
  }
}

export async function runChapterPlannerStage(input: {
  shouldRun: boolean
  chapterId: number
  novelId: number
  modelConfigId?: number
  sender?: WebContents
  messages: Message[]
  chatOptions: ChatOptions
  fallbackScenePlan: ScenePlanStep[]
  storedScenePlanJson?: string | null
  priorTaskId?: number
  startRole: (messages: Message[]) => Promise<number>
  validateContracts: () => string
  onContractValidated: (contractVersion: string, taskId: number) => void
  failRole: (taskId: number, error: unknown) => never
  persistScenePlan: (scenePlan: ScenePlanStep[]) => void
  setUpstreamTaskId: (taskId?: number) => void
}): Promise<PlannerExecutionOutput> {
  if (!input.shouldRun) {
    const output = loadReusablePlannerOutput(input.storedScenePlanJson, input.fallbackScenePlan)
    if (!output) {
      throw new ChapterPipelineStageError('contract_blocked', '没有可复用的 Planner 场景快照，无法从当前节点重试。', {
        blocked: true,
        rewriteScope: 'contract_replan',
      })
    }
    const contractVersion = input.validateContracts()
    input.setUpstreamTaskId(input.priorTaskId)
    return { ...output, taskId: input.priorTaskId, contractVersion, reused: true }
  }

  const taskId = await input.startRole(input.messages)
  let contractVersion = ''
  try {
    contractVersion = input.validateContracts()
    input.onContractValidated(contractVersion, taskId)
  } catch (error) {
    const message = error instanceof Error ? error.message : '章节流水线启动前合同校验未通过。'
    input.failRole(taskId, new ChapterPipelineStageError('contract_blocked', message, {
      blocked: true,
      rewriteScope: 'contract_replan',
      outputText: buildPipelineFailureOutput('contract_blocked', message, { rewriteScope: 'contract_replan' }),
      cause: error,
    }))
  }
  const rawOutput = await executeChatTask(taskId, {
    type: 'chapter_planner',
    novelId: input.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: input.chapterId,
    inputJson: JSON.stringify(input.messages),
    messages: input.messages,
    modelConfigId: input.modelConfigId,
    chatOpts: input.chatOptions,
    retryable: true,
    sender: input.sender,
  })
  return {
    ...resolvePlannerModelOutput({
      chapterId: input.chapterId,
      novelId: input.novelId,
      rawOutput,
      fallbackScenePlan: input.fallbackScenePlan,
      persistScenePlan: input.persistScenePlan,
    }),
    taskId,
    contractVersion,
    reused: false,
  }
}

/**
 * Owns the planner boundary: prompt construction and the durable planner
 * runner stay together, while the chapter service only consumes the result.
 */
export async function executeChapterPlannerPhase(input: {
  prompt: ChapterPlannerPromptInput
  shouldRun: boolean
  chapterId: number
  novelId: number
  modelConfigId?: number
  sender?: WebContents
  chatOptions: ChatOptions
  fallbackScenePlan: ScenePlanStep[]
  storedScenePlanJson?: string | null
  priorTaskId?: number
  startRole: (messages: Message[]) => Promise<number>
  validateContracts: () => string
  onContractValidated: (contractVersion: string, taskId: number) => void
  failRole: (taskId: number, error: unknown) => never
  persistScenePlan: (scenePlan: ScenePlanStep[]) => void
  setUpstreamTaskId: (taskId?: number) => void
}): Promise<PlannerExecutionOutput> {
  const messages = buildChapterPlannerMessages(input.prompt)
  return runChapterPlannerStage({
    shouldRun: input.shouldRun,
    chapterId: input.chapterId,
    novelId: input.novelId,
    modelConfigId: input.modelConfigId,
    sender: input.sender,
    messages,
    chatOptions: input.chatOptions,
    fallbackScenePlan: input.fallbackScenePlan,
    storedScenePlanJson: input.storedScenePlanJson,
    priorTaskId: input.priorTaskId,
    startRole: input.startRole,
    validateContracts: input.validateContracts,
    onContractValidated: input.onContractValidated,
    failRole: input.failRole,
    persistScenePlan: input.persistScenePlan,
    setUpstreamTaskId: input.setUpstreamTaskId,
  })
}
