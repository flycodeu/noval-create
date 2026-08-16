import { and, asc, eq } from 'drizzle-orm'
import type { WebContents } from 'electron'
import type { ChatOptions, Message } from '../adapters/base.adapter'
import { getDb } from '../database/db'
import { characters } from '../database/schema'
import { parseAiJsonResult } from '../utils/json'
import type { SemanticGateReview } from '../../src/shared/semantic-gate'
import { CORE_SEMANTIC_GATE_DIMENSIONS, type SemanticGateMode, type SemanticGatePolicy } from '../../src/shared/semantic-gate-policy'
import { analyzeChapterDialogueAgainstNovel } from './dialogue-fingerprint.service'
import { persistAntiAiRuleHits } from './anti-ai-rule.service'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'
import type { ChapterContext } from './context.service'
import { pickProtagonistDramaticEngine } from './context-cards'
import { buildPipelineFailureOutput, ChapterPipelineStageError } from './chapter-pipeline-errors'
import type { ChapterComplexity } from './chapter-pipeline-context'
import type {
  ChapterPromptGuidance,
  ChapterPromptNarrativeFields,
} from './chapter-pipeline-planner'
import {
  applyContractValidationToReviewNotes,
  applyCriticSemanticGateOutcomeToReviewNotes,
  applyDialogueAnalysisToReviewNotes,
  applyHistoricalGroundingToReviewNotes,
  applyHumanizationAnalysisToReviewNotes,
  applyLongWindowQualitySignalsToReviewNotes,
  applyProvenanceAndOperatingModeToReviewNotes,
  applyReadingExperienceToReviewNotes,
  applyStyleComplianceToReviewNotes,
  applyWordShapeObservation,
  collectSemanticGateHeuristicHints,
  dedupeTextList,
  enhanceReviewNotesWithGuardrails,
  hasReviewNotes,
  normalizeReviewNotes,
  type ChapterReviewNotes,
} from './chapter-review-notes'
import { hasSceneDesignDeclarations, type ScenePlanStep } from './chapter-scene-plan'
import { runChapterSemanticGate } from './semantic-gate/semantic-gate-runner.service'
import { buildChapterReviewPrompt } from './story-prompts'
import { executeChatTask, updateTaskStatus } from './task.service'
import { assertContractDrivenStageInputs } from './chapter-pipeline-writer'

export interface ChapterReviewPromptInput {
  novelTitle: string
  genre: string
  chapterNum: number
  chapterTitle: string
  storyCore: string
  context: ChapterContext
  themeChapterTest: string
  consistencyNotes: string
  structuralAlertsSummary: string
  arcProgress: string
  arcProgressStatus: string
  arcProgressCheckpoint: string
  scenePlanText: string
  draftContent: string
  runtimeAssertions: string[]
  narrativeFields: ChapterPromptNarrativeFields
  guidance: ChapterPromptGuidance
  protagonistReference: string
  protagonistRule: string
  promptTier: ChapterComplexity
}

export interface ReviewNovelGroundingInput {
  worldRulesJson?: string | null
  expandedBackground?: string | null
  synopsis?: string | null
  userBackground?: string | null
  historicalProfileJson?: string | null
  projectCanonProfileJson?: string | null
  canonConstraintSetJson?: string | null
  sourceLedgerJson?: string | null
  canonSourceLedgerJson?: string | null
  canonFactCardsJson?: string | null
  launchMode?: string | null
  targetWords?: number | null
  settingsJson?: string | null
}

export interface EnrichCriticReviewInput {
  reviewNotes: ChapterReviewNotes
  content: string
  chapterId: number
  novelId: number
  chapterNum: number
  emotionTone: string
  chapterWordTarget: number
  genre: string
  titleMismatchRisk: string
  semanticGateMode: SemanticGateMode
  glossaryTerms: string[]
  scenePlanJson?: string | null
  sceneDesignFieldGaps: string[]
  novel: ReviewNovelGroundingInput
}

export interface ApplyGroundingReviewInput {
  reviewNotes: ChapterReviewNotes
  content: string
  chapterId: number
  novelId: number
  chapterNum: number
  emotionTone: string
  genre: string
  glossaryTerms: string[]
  scenePlanJson?: string | null
  novel: ReviewNovelGroundingInput
}

export interface CriticSemanticReviewInput {
  reviewNotes: ChapterReviewNotes
  policy: SemanticGatePolicy
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  chapterContent: string
  modelConfigId?: number
  contractSummary: string
  scenePlanSummary: string
  protagonistReference: string
  scenePlan: ScenePlanStep[]
  designTerms?: string[]
}

export interface CriticSemanticReviewOutput {
  reviewNotes: ChapterReviewNotes
  semanticReview: SemanticGateReview | null
  effectiveMode: SemanticGateMode
}

export interface CriticExecutionOutput extends CriticSemanticReviewOutput {
  taskId?: number
  reused: boolean
}

export function buildChapterCriticMessages(input: ChapterReviewPromptInput): Message[] {
  const { context } = input
  return [{
    role: 'user',
    content: buildChapterReviewPrompt({
      novelTitle: input.novelTitle,
      genre: input.genre,
      chapterNum: input.chapterNum,
      chapterTitle: input.chapterTitle,
      chapterGoal: context.chapterGoal,
      hardConstraintContext: context.hardConstraintContext,
      dialogueVoiceLocks: context.dialogueVoiceLocks,
      storyCore: input.storyCore,
      writingContractSummary: context.writingContractSummary,
      themeChapterTest: input.themeChapterTest,
      relationSummary: context.relationSummary,
      currentArc: context.currentArc,
      worldRules: context.worldRules,
      characterStates: context.characterStates,
      worldStates: context.worldStates,
      mapSummary: context.mapSummary,
      itemSummary: context.itemSummary,
      previousChapterContext: context.previousChapterContext,
      chapterBridgePlan: context.chapterBridgePlan,
      stepMemorySummary: context.stepMemorySummary,
      runtimeAssertions: input.runtimeAssertions,
      continuitySummary: context.continuitySummary,
      openLoops: context.openLoops,
      dueForeshadows: context.dueForeshadows,
      timelineSummary: context.timelineSummary,
      longTermMemory: context.longTermMemory,
      recalledMemory: context.recalledMemory,
      consistencyNotes: input.consistencyNotes,
      structuralAlertsSummary: input.structuralAlertsSummary,
      arcProgress: input.arcProgress,
      arcProgressStatus: input.arcProgressStatus,
      arcProgressCheckpoint: input.arcProgressCheckpoint,
      scenePlan: input.scenePlanText,
      draftContent: input.draftContent,
      ...input.narrativeFields,
      ...input.guidance,
      scenePlanSummary: context.scenePlanSummary,
      draftTextSummary: context.draftTextSummary,
      contractVersionSummary: context.contractVersionSummary,
      reviewRiskSummary: context.reviewRiskSummary,
      reviewProofSummary: context.reviewProofSummary,
      publishGateRiskSummary: context.publishGateRiskSummary,
      protagonistReference: input.protagonistReference,
      protagonistRule: input.protagonistRule,
      promptTier: input.promptTier,
    }),
  }]
}

export function parseCriticReviewOutput(
  rawOutput: string,
  input: { chapterId: number; novelId: number; chapterContent: string },
): ChapterReviewNotes {
  const parsed = parseAiJsonResult<unknown>(rawOutput, 'object', {
    channel: 'chapter',
    message: '章节审校 JSON 无法解析，已阻断自动入稿并保留 Writer 初稿。',
    consoleSummary: `[chapter:warn] review-json-fallback chapter=${input.chapterId}`,
    context: {
      chapterId: input.chapterId,
      novelId: input.novelId,
      stage: 'review',
    },
  })
  if (!parsed.success) {
    throw new ChapterPipelineStageError(
      'invalid_output',
      'Critic 未返回可验证的结构化审校结果，Writer 初稿已保留；请重试审校流水线。',
      {
        outputText: buildPipelineFailureOutput(
          'invalid_output',
          'Critic 审校结果不是有效 JSON，缺少自动发布所需的质量证据。',
        ),
      },
    )
  }
  const reviewNotes = normalizeReviewNotes(parsed.data, { chapterContent: input.chapterContent })
  if (!hasReviewNotes(reviewNotes)) {
    throw new ChapterPipelineStageError(
      'invalid_output',
      'Critic 返回了空审校结果，Writer 初稿已保留；请重试审校流水线。',
      {
        outputText: buildPipelineFailureOutput(
          'invalid_output',
          'Critic 结构化结果未包含摘要、风险或修订证据。',
        ),
      },
    )
  }
  return reviewNotes
}

function buildGroundingInput(input: Pick<ApplyGroundingReviewInput, 'genre' | 'glossaryTerms' | 'novel'>) {
  return {
    genreName: input.genre,
    worldRulesJson: input.novel.worldRulesJson,
    backgroundText: [
      input.novel.expandedBackground,
      input.novel.synopsis,
      input.novel.userBackground,
    ].filter(Boolean).join('\n'),
    glossaryTerms: input.glossaryTerms,
    historicalProfileJson: input.novel.historicalProfileJson,
    projectCanonProfileJson: input.novel.projectCanonProfileJson,
    canonConstraintSetJson: input.novel.canonConstraintSetJson,
    sourceLedgerJson: input.novel.sourceLedgerJson,
    canonSourceLedgerJson: input.novel.canonSourceLedgerJson,
    canonFactCardsJson: input.novel.canonFactCardsJson,
  }
}

export function applyGroundingAndLongWindowReviewNotes(
  input: ApplyGroundingReviewInput,
): ChapterReviewNotes {
  const groundingInput = buildGroundingInput(input)
  const groundedNotes = applyHistoricalGroundingToReviewNotes(input.reviewNotes, groundingInput)
  const provenanceNotes = applyProvenanceAndOperatingModeToReviewNotes(groundedNotes, {
    ...groundingInput,
    novelId: input.novelId,
    chapterNum: input.chapterNum,
    launchMode: input.novel.launchMode,
    targetWords: input.novel.targetWords,
    settingsJson: input.novel.settingsJson,
    scenePlanJson: input.scenePlanJson,
  })
  return applyLongWindowQualitySignalsToReviewNotes(provenanceNotes, input.content, {
    novelId: input.novelId,
    chapterNum: input.chapterNum,
    chapterId: input.chapterId,
    genre: input.genre,
    chapterFunction: provenanceNotes.chapter_function_primary || provenanceNotes.pace_marker,
    emotionTone: input.emotionTone,
  })
}

export function enrichCriticReviewNotes(input: EnrichCriticReviewInput): ChapterReviewNotes {
  const commonAnalysis = {
    chapterId: input.chapterId,
    genre: input.genre,
    chapterFunction: input.reviewNotes.chapter_function_primary || input.reviewNotes.pace_marker,
    emotionTone: input.emotionTone,
  }
  let notes = enhanceReviewNotesWithGuardrails(input.reviewNotes, input.content, input.genre)
  notes = applyHumanizationAnalysisToReviewNotes(notes, input.content, commonAnalysis)
  notes = applyDialogueAnalysisToReviewNotes(notes, input.novelId, input.chapterNum, input.content)
  notes = applyStyleComplianceToReviewNotes(notes, input.novelId, input.content)
  notes = applyReadingExperienceToReviewNotes(notes, input.content)
  notes = applyWordShapeObservation(notes, input.content, input.chapterWordTarget)
  if (input.titleMismatchRisk) {
    notes = {
      ...notes,
      title_alignment_risks: dedupeTextList([...notes.title_alignment_risks, input.titleMismatchRisk]),
    }
  }
  notes = applyContractValidationToReviewNotes(notes, validateChapterContractDelivery({
    chapterId: input.chapterId,
    content: input.content,
    reviewNotes: notes,
  }, { advisoryOnly: input.semanticGateMode === 'enforce' }))
  notes = applyGroundingAndLongWindowReviewNotes({
    reviewNotes: notes,
    content: input.content,
    chapterId: input.chapterId,
    novelId: input.novelId,
    chapterNum: input.chapterNum,
    emotionTone: input.emotionTone,
    genre: input.genre,
    glossaryTerms: input.glossaryTerms,
    scenePlanJson: input.scenePlanJson,
    novel: input.novel,
  })
  if (input.sceneDesignFieldGaps.length > 0) {
    notes = {
      ...notes,
      design_field_gaps: dedupeTextList([
        ...(notes.design_field_gaps || []),
        ...input.sceneDesignFieldGaps,
      ]),
    }
  }
  return notes
}

function getProtagonistDramaticEngine(novelId: number): string {
  try {
    const db = getDb()
    const rows = db.select().from(characters)
      .where(and(eq(characters.novelId, novelId), eq(characters.roleType, 'protagonist')))
      .orderBy(asc(characters.sortOrder), asc(characters.id))
      .all()
    return pickProtagonistDramaticEngine(rows)
  } catch {
    return ''
  }
}

export async function applyCriticSemanticReview(
  input: CriticSemanticReviewInput,
): Promise<CriticSemanticReviewOutput> {
  if (input.policy.mode === 'off' || !input.chapterContent.trim()) {
    return {
      reviewNotes: input.reviewNotes,
      semanticReview: null,
      effectiveMode: input.policy.mode,
    }
  }
  const dimensions = [...CORE_SEMANTIC_GATE_DIMENSIONS]
  if (hasSceneDesignDeclarations(input.scenePlan)) dimensions.push('design_subtext')
  const dramaticEngine = getProtagonistDramaticEngine(input.novelId)
  if (dramaticEngine) dimensions.push('dramatic_drive')
  if (input.designTerms) dimensions.push('design_alignment')

  const gateRun = await runChapterSemanticGate({
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    chapterTitle: input.chapterTitle,
    chapterContent: input.chapterContent,
    dimensions,
    stage: 'critic',
    mode: input.policy.mode,
    modelConfigId: input.modelConfigId,
    contractSummary: input.contractSummary,
    scenePlanSummary: input.scenePlanSummary,
    protagonistBrief: input.protagonistReference,
    dramaticEngine: dramaticEngine || undefined,
    designTerms: input.designTerms,
    heuristicHints: collectSemanticGateHeuristicHints(input.reviewNotes),
  })
  const outcome = applyCriticSemanticGateOutcomeToReviewNotes(input.reviewNotes, {
    review: gateRun.review,
    degraded: gateRun.degraded,
  }, input.policy)
  let reviewNotes = outcome.reviewNotes
  if (outcome.restoreHeuristicContractBlockers) {
    reviewNotes = applyContractValidationToReviewNotes(reviewNotes, validateChapterContractDelivery({
      chapterId: input.chapterId,
      content: input.chapterContent,
      reviewNotes,
    }))
    console.warn(`[semantic-gate] critic 语义评审失败，本章回退启发式门 chapter=${input.chapterId}`)
  }
  return {
    reviewNotes,
    semanticReview: gateRun.degraded ? null : gateRun.review,
    effectiveMode: outcome.effectiveMode,
  }
}

export function applyReviewEnforcer(input: {
  reviewNotes: ChapterReviewNotes
  novelId: number
  chapterId: number
  chapterNum: number
  content: string
  genre: string
  knownTerms: string[]
}): ChapterReviewNotes {
  const notes = { ...input.reviewNotes, critical_fixes: [...input.reviewNotes.critical_fixes] }
  const antiAiResult = persistAntiAiRuleHits({
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    content: input.content,
    genre: input.genre,
    knownTerms: input.knownTerms,
  })
  if (antiAiResult.hits.length > 0) {
    notes.critical_fixes.push(`【反 AI 味护栏拦截】存在典型 AI 常见违规表达：${antiAiResult.hits.map((hit) => hit.ruleCode).join('、')}，必须在改写环节清理！`)
  }
  const dialogueReview = analyzeChapterDialogueAgainstNovel(input.novelId, input.chapterNum, input.content)
  if (dialogueReview.risks.length > 0 || dialogueReview.drifts.length > 0 || dialogueReview.similarities.length > 0) {
    notes.critical_fixes.push('【对话指纹护栏拦截】角色对白存在口吻漂移、角色同质化或对白风险，必须基于角色性格重写！')
  }
  return notes
}

export interface EnforcerExecutionOutput {
  reviewNotes: ChapterReviewNotes
  taskId?: number
  reused: boolean
}

export async function runChapterEnforcerStage(input: {
  shouldRun: boolean
  reviewNotes: ChapterReviewNotes
  novelId: number
  chapterId: number
  chapterNum: number
  content: string
  genre: string
  knownTerms: string[]
  priorTaskId?: number
  startRole: () => Promise<number>
  persistReviewNotes: (reviewNotes: ChapterReviewNotes) => void
  finishRole: (taskId: number) => void
  failRole: (taskId: number, error: unknown) => never
}): Promise<EnforcerExecutionOutput> {
  if (!input.shouldRun) {
    return {
      reviewNotes: input.reviewNotes,
      taskId: input.priorTaskId,
      reused: true,
    }
  }

  const taskId = await input.startRole()
  try {
    const reviewNotes = applyReviewEnforcer(input)
    input.persistReviewNotes(reviewNotes)
    input.finishRole(taskId)
    return { reviewNotes, taskId, reused: false }
  } catch (error) {
    input.failRole(taskId, error instanceof Error ? error : new Error('Enforcer 环节异常'))
  }
}

export async function runChapterCriticStage(input: {
  shouldRun: boolean
  chapterId: number
  novelId: number
  modelConfigId?: number
  sender?: WebContents
  promptInput: ChapterReviewPromptInput
  chatOptions: ChatOptions
  contractVersion: string
  initialReviewNotes: ChapterReviewNotes
  priorTaskId?: number
  recoveryHintJson?: string
  enrichInput: Omit<EnrichCriticReviewInput, 'reviewNotes'>
  semanticInput: Omit<CriticSemanticReviewInput, 'reviewNotes'>
  startRole: (messages: Message[]) => Promise<number>
  failRole: (taskId: number, error: unknown, blocked?: boolean) => never
}): Promise<CriticExecutionOutput> {
  if (!input.shouldRun) {
    if (!hasReviewNotes(input.initialReviewNotes)) {
      throw new ChapterPipelineStageError('invalid_output', '没有可复用的 Critic 审校快照，无法从当前节点重试。', {
        blocked: true,
        outputText: buildPipelineFailureOutput('invalid_output', '没有可复用的 Critic 审校快照。'),
      })
    }
    return {
      reviewNotes: input.initialReviewNotes,
      semanticReview: null,
      effectiveMode: input.semanticInput.policy.mode,
      taskId: input.priorTaskId,
      reused: true,
    }
  }

  const messages = buildChapterCriticMessages(input.promptInput)
  const taskId = await input.startRole(messages)
  try {
    assertContractDrivenStageInputs(
      'critic',
      input.contractVersion,
      input.promptInput.context.writingContractSummary,
      input.promptInput.scenePlanText,
    )
  } catch (error) {
    updateTaskStatus(taskId, 'failed', input.sender, {
      pipelineStage: 'blocked',
      errorMessage: error instanceof Error ? error.message : 'Critic 缺少合同输入',
      recoveryHintJson: input.recoveryHintJson,
    })
    input.failRole(taskId, error, true)
  }
  const rawOutput = await executeChatTask(taskId, {
    type: 'chapter_critic',
    novelId: input.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: input.chapterId,
    inputJson: JSON.stringify(messages),
    messages,
    modelConfigId: input.modelConfigId,
    chatOpts: input.chatOptions,
    retryable: true,
    sender: input.sender,
  })
  let reviewNotes: ChapterReviewNotes
  try {
    reviewNotes = parseCriticReviewOutput(rawOutput, {
      chapterId: input.chapterId,
      novelId: input.novelId,
      chapterContent: input.promptInput.draftContent,
    })
  } catch (error) {
    input.failRole(taskId, error)
  }
  reviewNotes = enrichCriticReviewNotes({ ...input.enrichInput, reviewNotes })
  return {
    ...await applyCriticSemanticReview({ ...input.semanticInput, reviewNotes }),
    taskId,
    reused: false,
  }
}
