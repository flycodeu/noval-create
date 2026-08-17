import type { ProgressSink } from '../utils/progress-sink'
import type { ChatOptions, Message } from '../adapters/base.adapter'
import { parseAiJsonResult } from '../utils/json'
import {
  collectQualityGuardrailFindings,
  hasBlockingGuardrailFindings,
  shouldForceRepair,
} from '../../src/shared/content-guardrails'
import {
  CORE_SEMANTIC_GATE_DIMENSIONS,
  type SemanticGateMode,
  type SemanticGatePolicy,
} from '../../src/shared/semantic-gate-policy'
import {
  collectBlockerDimensions,
  SEMANTIC_GATE_DIMENSION_SPECS,
  type SemanticGateReview,
} from '../../src/shared/semantic-gate'
import { analyzeChapterDialogueAgainstNovel } from './dialogue-fingerprint.service'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'
import type { ChapterContext } from './context.service'
import type { ChapterPublishCheck } from './context-impact.service'
import type { ChapterComplexity } from './chapter-pipeline-context'
import { buildPipelineFailureOutput, ChapterPipelineStageError } from './chapter-pipeline-errors'
import type {
  ChapterPromptGuidance,
  ChapterPromptNarrativeFields,
} from './chapter-pipeline-planner'
import {
  applyGroundingAndLongWindowReviewNotes,
  type ReviewNovelGroundingInput,
} from './chapter-pipeline-review'
import {
  applyContractValidationToReviewNotes,
  applyDialogueAnalysisToReviewNotes,
  applyHumanizationAnalysisToReviewNotes,
  applyReadingExperienceToReviewNotes,
  applyRewriteDeltaToReviewNotes,
  applyStyleComplianceToReviewNotes,
  applyWordShapeObservation,
  collectSemanticGateHeuristicHints,
  countNarrativeWords,
  dedupeTextList,
  enhanceReviewNotesWithGuardrails,
  formatReviewNotes,
  stripChapterHeadingNoise,
  formatSemanticGateBlockerFix,
  mergeSeverity,
  type ChapterReviewNotes,
} from './chapter-review-notes'
import {
  buildDialogueRepairDirective,
  buildReviewPrioritySummary,
  buildStructuralRepairDirective,
  buildRewriteMiniReviewVerdict,
  type ReviewPrioritySummary,
  type RewriteMiniReviewVerdict,
} from './chapter-pipeline-policy.service'
import {
  chooseBetterRepairCandidate,
  chooseBetterGuardrailCandidate,
  guardrailRepairScore,
  judgeRepairOutcome,
  rewriteOutcomeScore,
} from './chapter-repair-loop'
import { getDefaultChapterTitle } from './chapter-scene-plan'
import { buildChapterRewritePrompt } from './story-prompts'
import {
  executeStreamTask,
  isTransientModelNetworkError,
  runChatTask,
  updateTask,
  updateTaskStatus,
} from './task.service'
import { runChapterSemanticGate } from './semantic-gate/semantic-gate-runner.service'
import {
  buildVariationDigest,
  isCandidateTooSimilar,
} from './variation-control.service'
import {
  enforceLockedParagraphProtection,
  markLockedParagraphsInContent,
} from './chapter-pipeline-writer'
import { persistAntiAiRuleHits } from './anti-ai-rule.service'
import type { ChapterRewriteScope } from '../../src/types'

export const STYLE_REPAIRABLE_GUARDRAIL_CODES = new Set([
  'low_value_body_detail',
  'dash_abuse',
  'high_frequency_repetition',
  'parenthetical_explanation_abuse',
  'soft_voice_cliche',
  'paragraph_simile_stacking',
  'eye_open_close_standalone_paragraph',
  'atmospheric_imagery_overuse',
  'uniform_paragraph_rhythm',
])

export interface RewriterChapterInput {
  id: number
  novelId: number
  chapterNum: number
  title?: string | null
  emotionTone?: string | null
  targetWords?: number | null
  scenePlanJson?: string | null
}

export interface RewriterNovelInput extends ReviewNovelGroundingInput {
  title: string
  modelConfigId?: number | null
}

export interface RewriterProfileInput {
  genre: string
  protagonistReference: string
  protagonistRule: string
}

export interface ChapterRepairInput {
  chapter: RewriterChapterInput
  novel: RewriterNovelInput
  context: ChapterContext
  storyCore: string
  profile: RewriterProfileInput
  scenePlanText: string
  consistencyNotes: string
  structuralAlertsSummary: string
  reviewNotes: ChapterReviewNotes
  content: string
  lockedParagraphs: string[]
  promptTier: ChapterComplexity
  knownTerms: string[]
  targetWords: number
  attemptNumber?: number
  rejectedDigests?: string[]
}

export interface ChapterRewriterPromptInput {
  novelTitle: string
  genre: string
  chapterNum: number
  chapterTitle: string
  emotionTone: string
  targetWords: number
  storyCore: string
  context: ChapterContext
  themeChapterTest: string
  consistencyNotes: string
  structuralAlertsSummary: string
  scenePlanText: string
  draftContent: string
  prioritizedReviewNotesText: string
  structuralRepairDirective: string
  lockedParagraphs: string[]
  runtimeAssertions: string[]
  narrativeFields: ChapterPromptNarrativeFields
  guidance: ChapterPromptGuidance
  protagonistReference: string
  protagonistRule: string
  promptTier: ChapterComplexity
  attemptNumber: number
  rejectedDigests: string[]
}

export interface RewriteOutcome {
  content: string
  reviewNotes: ChapterReviewNotes
  miniReview: RewriteMiniReviewVerdict
  dialogueAnalysis: ReturnType<typeof analyzeChapterDialogueAgainstNovel>
}

export interface RepairSemanticEvaluatorInput {
  mode: SemanticGateMode
  criticReview: SemanticGateReview | null
  maxCalls: number
  initialCallsUsed?: number
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  modelConfigId?: number
  contractSummary: string
  scenePlanSummary: string
  protagonistReference: string
}

export class RepairSemanticEvaluator {
  private readonly input: RepairSemanticEvaluatorInput
  private used: number

  constructor(input: RepairSemanticEvaluatorInput) {
    this.input = input
    this.used = input.initialCallsUsed || 0
  }

  get callsUsed(): number {
    return this.used
  }

  hasBudget(): boolean {
    return this.used < this.input.maxCalls
  }

  consumeCall(): void {
    this.used += 1
  }

  async evaluate(candidateContent: string): Promise<SemanticGateReview | null> {
    if (this.input.mode !== 'enforce' || !this.input.criticReview) return null
    const relevant = this.input.criticReview.verdicts
      .filter((verdict) => verdict.status === 'blocker' || verdict.status === 'warning')
    if (relevant.length === 0 || !candidateContent.trim()) return null
    if (!this.hasBudget()) {
      console.warn(`[semantic-gate] 修复复评超出预算（${this.input.maxCalls} 次/章），跳过 chapter=${this.input.chapterId}`)
      return null
    }
    this.consumeCall()
    const judgement = await judgeRepairOutcome({
      previousBlockerVerdicts: this.input.criticReview.verdicts,
      repairedContent: candidateContent,
      runGate: (dimensions, hints) => runChapterSemanticGate({
        novelId: this.input.novelId,
        chapterId: this.input.chapterId,
        chapterNum: this.input.chapterNum,
        chapterTitle: this.input.chapterTitle,
        chapterContent: candidateContent,
        dimensions,
        stage: 'repair_review',
        mode: this.input.mode,
        modelConfigId: this.input.modelConfigId,
        contractSummary: this.input.contractSummary,
        scenePlanSummary: this.input.scenePlanSummary,
        protagonistBrief: this.input.protagonistReference,
        heuristicHints: hints,
      }),
    })
    return judgement.degraded ? null : judgement.review
  }
}

export interface RewriterStreamAttemptResult {
  taskId: number
  result: { output: string }
}

export interface RewriterCandidateLoopOutput {
  taskId: number
  attemptNumber: number
  rejectedDigests: string[]
  rawResult: { output: string }
  outcome: RewriteOutcome
}

export function createChapterRewriterMessageBuilder(
  base: Omit<ChapterRewriterPromptInput, 'draftContent' | 'structuralRepairDirective' | 'attemptNumber' | 'rejectedDigests'>,
): (
  attemptNumber: number,
  rejectedDigests: string[],
  draftContent: string,
  structuralRepairDirective?: string,
) => Message[] {
  return (attemptNumber, rejectedDigests, draftContent, structuralRepairDirective = '') => (
    buildChapterRewriterMessages({
      ...base,
      draftContent,
      structuralRepairDirective,
      attemptNumber,
      rejectedDigests,
    })
  )
}

export function createRewriterStreamAttemptRunner(input: {
  novelId: number
  chapterId: number
  modelConfigId?: number
  sender?: ProgressSink
  defaultChatOptions: RewriterChatOptions
  buildMessages: (attemptNumber: number, rejectedDigests: string[], draftContent?: string) => Message[]
  startRole: (messages: Message[], detail: string) => Promise<number>
  validateInputs: () => void
  recoveryHintJson?: string
  failRole: (taskId: number, error: unknown) => never
  onChunk: (fullOutput: string, taskId: number) => void
}): (
  attemptNumber: number,
  rejectedDigests: string[],
  detail: string,
  chatOptions?: RewriterChatOptions,
  draftContent?: string,
) => Promise<RewriterStreamAttemptResult> {
  const startTask = async (messages: Message[], detail: string) => {
    const taskId = await input.startRole(messages, detail)
    try {
      input.validateInputs()
    } catch (error) {
      updateTaskStatus(taskId, 'failed', input.sender, {
        pipelineStage: 'blocked',
        errorMessage: error instanceof Error ? error.message : 'Rewriter 缺少合同输入',
        recoveryHintJson: input.recoveryHintJson,
      })
      input.failRole(taskId, error)
    }
    return taskId
  }
  return async (attemptNumber, rejectedDigests, detail, chatOptions, draftContent) => {
    const messages = input.buildMessages(attemptNumber, rejectedDigests, draftContent)
    let taskId = await startTask(messages, detail)
    let networkRetryCount = 0
    while (true) {
      let receivedOutput = ''
      try {
        const result = await executeStreamTask(taskId, {
          type: 'chapter_rewriter',
          novelId: input.novelId,
          relatedEntityType: 'chapter',
          relatedEntityId: input.chapterId,
          inputJson: JSON.stringify(messages),
          messages,
          modelConfigId: input.modelConfigId,
          chatOpts: chatOptions || input.defaultChatOptions,
          sender: input.sender,
          onChunk: async (_chunk, fullOutput) => {
            receivedOutput = fullOutput
            input.onChunk(fullOutput, taskId)
          },
        })
        return { taskId, result }
      } catch (error) {
        if (isTransientModelNetworkError(error) && networkRetryCount < 1) {
          networkRetryCount += 1
          updateTask(taskId, {
            outputText: receivedOutput.trim()
              ? '流式连接中断，未提交不完整输出；已自动新建 Rewriter 任务重试一次。'
              : '流式连接在返回正文前中断，已自动新建 Rewriter 任务重试一次。',
          })
          taskId = await startTask(messages, `${detail}（网络中断自动重试 ${networkRetryCount}/1）`)
          continue
        }
        throw error
      }
    }
  }
}

export interface PublishGateRepairOutput {
  content: string
  reviewNotes: ChapterReviewNotes
  miniReview: RewriteMiniReviewVerdict
  publishCheck: ChapterPublishCheck
  taskId: number
  attemptNumber: number
  rejectedDigests: string[]
}

function dialogueRepairScore(
  analysis: ReturnType<typeof analyzeChapterDialogueAgainstNovel>,
): number {
  return analysis.similarities.length * 3
    + analysis.drifts.length * 2
    + analysis.fillerRisks.length
    + analysis.infoDensityRisks.length
}

function isCandidateBetter(input: {
  current: RewriteOutcome
  candidate: RewriteOutcome
  candidateSemantic: SemanticGateReview | null
  criticSemanticReview: SemanticGateReview | null
  originalLength: number
  genre: string
  knownTerms: string[]
  compareDialogueOnTie?: boolean
}): boolean {
  if (input.candidateSemantic) {
    return chooseBetterRepairCandidate(
      { content: input.current.content, reviewNotes: input.current.reviewNotes },
      { content: input.candidate.content, reviewNotes: input.candidate.reviewNotes },
      {
        currentSemantic: input.criticSemanticReview || undefined,
        candidateSemantic: input.candidateSemantic,
        originalLength: input.originalLength,
        genre: input.genre,
        knownTerms: input.knownTerms,
      },
    ).content === input.candidate.content
  }
  const currentScore = rewriteOutcomeScore(input.current, input.genre, input.knownTerms)
  const candidateScore = rewriteOutcomeScore(input.candidate, input.genre, input.knownTerms)
  return candidateScore < currentScore
    || Boolean(input.compareDialogueOnTie
      && candidateScore === currentScore
      && dialogueRepairScore(input.candidate.dialogueAnalysis) < dialogueRepairScore(input.current.dialogueAnalysis))
}

export async function runRewriterCandidateLoop(input: {
  draftContent: string
  reviewPrioritySummary: ReviewPrioritySummary
  requiresFullRewrite: boolean
  genre: string
  knownTerms: string[]
  criticSemanticReview: SemanticGateReview | null
  runAttempt: (
    attemptNumber: number,
    rejectedDigests: string[],
    detail: string,
    chatOptions?: RewriterChatOptions,
    structuralDirective?: string,
  ) => Promise<RewriterStreamAttemptResult>
  processOutcome: (
    rawOutput: string,
    attemptNumber: number,
    rejectedDigests: string[],
  ) => Promise<RewriteOutcome>
  evaluateSemantics: (content: string) => Promise<SemanticGateReview | null>
  markAttemptComplete: (taskId: number, message: string, includeStatusUpdate: boolean) => void
  resolvePremiumChatOptions: () => RewriterChatOptions | undefined
}): Promise<RewriterCandidateLoopOutput> {
  let attemptNumber = 1
  let rejectedDigests: string[] = []
  let run = await input.runAttempt(attemptNumber, rejectedDigests, 'Rewriter 正在按 Critic 结论修正文稿。')

  if (isCandidateTooSimilar(run.result.output, [input.draftContent])
    && (input.requiresFullRewrite || input.reviewPrioritySummary.counts.high > 0)) {
    rejectedDigests = [buildVariationDigest(run.result.output)]
    input.markAttemptComplete(run.taskId, '首轮重写与初稿过近，已切换变体重试。', true)
    attemptNumber = 2
    run = await input.runAttempt(
      attemptNumber,
      rejectedDigests,
      'Rewriter 首轮改写幅度不足，正在切到变体重试。',
    )
  }

  let outcome = await input.processOutcome(run.result.output, attemptNumber, rejectedDigests)
  const dialogueDirective = buildDialogueRepairDirective({
    similarities: outcome.dialogueAnalysis.similarities,
    drifts: outcome.dialogueAnalysis.drifts,
    fillerRisks: outcome.dialogueAnalysis.fillerRisks,
    infoDensityRisks: outcome.dialogueAnalysis.infoDensityRisks,
  })
  const retryDialogue = dialogueDirective.length > 0
  if ((outcome.miniReview.needsHumanReview || retryDialogue) && outcome.content.trim() && attemptNumber < 3) {
    let structuralDirective = [
      buildStructuralRepairDirective(outcome.miniReview.narrativeDelta, [
        ...outcome.reviewNotes.critical_fixes,
        ...outcome.reviewNotes.reader_hook_risks,
        ...outcome.reviewNotes.arc_progress_risks,
        ...outcome.reviewNotes.continuity_risks,
      ]),
      dialogueDirective,
    ].filter(Boolean).join('\n\n') || [
      '【结构性修复指令（上一轮重写与初稿过于接近）】',
      '本轮必须在保持事实连续性的前提下拉开与初稿的差异：重排至少一个场景的切入点，改变冲突交锋的走向或结果，补入可见代价或新增风险。',
      '不允许仅替换措辞、调整语序或润色修辞。',
    ].join('\n')
    rejectedDigests = [...rejectedDigests, buildVariationDigest(run.result.output)]
    input.markAttemptComplete(
      run.taskId,
      retryDialogue
        ? '对白质量复检仍有风险，已带具体证据自动发起定向重写。'
        : '重写差异门未通过，已带差异门结论自动发起结构性重写。',
      true,
    )
    attemptNumber = 3
    const premiumOptions = retryDialogue ? undefined : input.resolvePremiumChatOptions()
    run = await input.runAttempt(
      attemptNumber,
      rejectedDigests,
      retryDialogue
        ? 'Rewriter 正在按对白质量证据进行定向重写。'
        : premiumOptions
          ? 'Rewriter 正在按差异门结论以 premium 路由进行结构性重写。'
          : 'Rewriter 正在按差异门结论进行结构性重写。',
      premiumOptions,
      structuralDirective,
    )
    const retried = await input.processOutcome(run.result.output, attemptNumber, rejectedDigests)
    const originalLength = countNarrativeWords(input.draftContent)
    const semantic = await input.evaluateSemantics(retried.content)
    if (isCandidateBetter({
      current: outcome,
      candidate: retried,
      candidateSemantic: semantic,
      criticSemanticReview: input.criticSemanticReview,
      originalLength,
      genre: input.genre,
      knownTerms: input.knownTerms,
      compareDialogueOnTie: true,
    })) outcome = retried

    if (outcome.miniReview.needsHumanReview && outcome.content.trim()) {
      structuralDirective = [
        buildStructuralRepairDirective(outcome.miniReview.narrativeDelta, [
          ...outcome.reviewNotes.critical_fixes,
          ...outcome.reviewNotes.reader_hook_risks,
          ...outcome.reviewNotes.arc_progress_risks,
          ...outcome.reviewNotes.continuity_risks,
        ]),
        dialogueDirective,
      ].filter(Boolean).join('\n\n')
      rejectedDigests = [...rejectedDigests, buildVariationDigest(run.result.output)]
      input.markAttemptComplete(
        run.taskId,
        '上一轮结构修复仍未达标，已带最新差异证据发起最后一次有界重写。',
        false,
      )
      attemptNumber = 4
      run = await input.runAttempt(
        attemptNumber,
        rejectedDigests,
        'Rewriter 正在按最新结构差异证据执行最后一次有界重写。',
        premiumOptions,
        structuralDirective,
      )
      const finalRetry = await input.processOutcome(run.result.output, attemptNumber, rejectedDigests)
      const finalSemantic = await input.evaluateSemantics(finalRetry.content)
      if (isCandidateBetter({
        current: outcome,
        candidate: finalRetry,
        candidateSemantic: finalSemantic,
        criticSemanticReview: input.criticSemanticReview,
        originalLength,
        genre: input.genre,
        knownTerms: input.knownTerms,
      })) outcome = finalRetry
    }
  }

  return {
    taskId: run.taskId,
    attemptNumber,
    rejectedDigests,
    rawResult: run.result,
    outcome,
  }
}

export function buildPublishGateRepairDirective(
  publishCheck: ChapterPublishCheck,
  reviewNotes: ChapterReviewNotes,
): string {
  const repairItems = publishCheck.checklist.filter((item) => (
    (item.status === 'blocker' || item.status === 'rewrite')
    && !['summary', 'continuity', 'context'].includes(item.key)
  ))
  if (repairItems.length === 0) return ''
  const contractIssues = (publishCheck.contractValidation?.itemResults || [])
    .filter((item) => item.verdict && item.verdict !== 'pass')
    .slice(0, 8)
    .map((item) => {
      const record = item as unknown as Record<string, unknown>
      return `- 合同 ${String(record.contractItemType || record.key || 'item')}：${String(record.expected || record.rewriteHint || record.actual || '')}`
    })
  return [
    '【章节验收门定向修复（必须先修硬缺口）】',
    ...repairItems.slice(0, 8).map((item) => `- ${item.key}：${item.detail}`),
    ...contractIssues,
    ...[
      ...reviewNotes.critical_fixes,
      ...reviewNotes.reader_hook_risks,
      ...reviewNotes.arc_progress_risks,
    ].slice(0, 6).map((item) => `- 审校指定问题：${item}`),
    '差异门变化验收：至少新增一处“主动选择 -> 他人反应 -> 可见后果”，以及一处物件、资格、时间、责任或关系状态的改变；不能只替换同义词、调整顺序或重复原有结果。',
    '如果本章目标只被提及，必须把它改成一次具体决定、拒绝、退回、补录、交接或承担，并让角色因此面对新的下一步压力。',
    '合同硬缺口必须在正文中写成可核验的动作、地点、时间、结果状态或下一步责任，不得只靠审校备注补足。',
    '对白硬缺口必须删除空转接话；每个回合都要带立场、事实、动作、责任或关系变化，并保留人物各自声线。',
    '只修复上述验收缺口，保留已确认事件、数字、人物设定和章节主线；输出完整正文，不要解释。',
  ].join('\n')
}

export async function runPublishGateRepair(input: {
  chapterId: number
  content: string
  reviewNotes: ChapterReviewNotes
  miniReview: RewriteMiniReviewVerdict
  publishCheck: ChapterPublishCheck
  taskId: number
  attemptNumber: number
  rejectedDigests: string[]
  genre: string
  knownTerms: string[]
  markCurrentAttempt: (taskId: number, message: string) => void
  runAttempt: (
    attemptNumber: number,
    rejectedDigests: string[],
    detail: string,
    directive: string,
    content: string,
  ) => Promise<RewriterStreamAttemptResult>
  processOutcome: (
    output: string,
    attemptNumber: number,
    rejectedDigests: string[],
  ) => Promise<RewriteOutcome>
  recheckRisks: (reviewNotes: ChapterReviewNotes, content: string) => Promise<ChapterReviewNotes>
  persistAccepted: (outcome: RewriteOutcome, taskId: number) => Promise<ChapterPublishCheck>
}): Promise<PublishGateRepairOutput> {
  const directive = buildPublishGateRepairDirective(input.publishCheck, input.reviewNotes)
  const current = { ...input }
  if (!directive || !input.content.trim() || input.attemptNumber >= 5) return current

  const rejectedDigests = [...input.rejectedDigests, buildVariationDigest(input.content)]
  try {
    input.markCurrentAttempt(input.taskId, '章节验收门发现硬缺口，已回灌具体证据执行最后一次定向重写。')
    const attemptNumber = 5
    const run = await input.runAttempt(
      attemptNumber,
      rejectedDigests,
      'Rewriter 正在按章节验收门证据修复合同、对白与开篇硬缺口。',
      directive,
      input.content,
    )
    const candidate = await input.processOutcome(run.result.output, attemptNumber, rejectedDigests)
    const accepted = !candidate.miniReview.needsHumanReview
      || rewriteOutcomeScore(candidate, input.genre, input.knownTerms)
        < rewriteOutcomeScore({ content: input.content, miniReview: input.miniReview }, input.genre, input.knownTerms)
    if (!accepted || !candidate.content.trim()) {
      console.warn(`[chapter:pipeline] 章节验收门候选未改善，保留原稿 chapter=${input.chapterId}`)
      return { ...current, taskId: run.taskId, attemptNumber, rejectedDigests }
    }
    candidate.reviewNotes = await input.recheckRisks(candidate.reviewNotes, candidate.content)
    const publishCheck = await input.persistAccepted(candidate, run.taskId)
    console.warn(`[chapter:pipeline] 章节验收门定向重写${publishCheck.ready ? '通过' : '仍有阻塞'} chapter=${input.chapterId}`)
    return {
      content: candidate.content,
      reviewNotes: candidate.reviewNotes,
      miniReview: candidate.miniReview,
      publishCheck,
      taskId: run.taskId,
      attemptNumber,
      rejectedDigests,
    }
  } catch (error) {
    console.warn(`[chapter:pipeline] 章节验收门定向重写失败，保留原稿 chapter=${input.chapterId}:`, error instanceof Error ? error.message : error)
    return current
  }
}

export function getPublishCheckRewriteFailureMeta(publishCheck: ChapterPublishCheck): {
  rewriteScope: ChapterRewriteScope
  targetSegmentId?: number | null
} {
  return {
    rewriteScope: publishCheck.rewritePlan?.scope
      || (publishCheck.rewriteTarget?.kind === 'segment' ? 'scene_rewrite' : 'chapter_rewrite'),
    targetSegmentId: typeof publishCheck.rewritePlan?.targetSegmentId === 'number'
      ? publishCheck.rewritePlan.targetSegmentId
      : publishCheck.rewriteTarget?.kind === 'segment'
        ? publishCheck.rewriteTarget.segmentId
        : null,
  }
}

export function buildRewriterReleaseError(input: {
  miniReview: RewriteMiniReviewVerdict
  rewriteScope: ChapterRewriteScope
  publishCheck: ChapterPublishCheck
}): ChapterPipelineStageError | null {
  if (input.miniReview.needsHumanReview) {
    const message = `重写轻量复检未通过：${input.miniReview.reason}`
    return new ChapterPipelineStageError('human_review_required', message, {
      blocked: true,
      rewriteScope: input.rewriteScope,
      outputText: buildPipelineFailureOutput('human_review_required', message, { rewriteScope: input.rewriteScope }),
    })
  }
  const meta = getPublishCheckRewriteFailureMeta(input.publishCheck)
  if (input.publishCheck.gateLevel === 'rewrite') {
    const message = `章节门要求重写：${input.publishCheck.summary}`
    return new ChapterPipelineStageError('gate_rewrite_required', message, {
      blocked: true,
      rewriteScope: meta.rewriteScope,
      targetSegmentId: meta.targetSegmentId,
      outputText: buildPipelineFailureOutput('gate_rewrite_required', message, meta),
    })
  }
  if (!input.publishCheck.ready) {
    const message = `章节门未通过：${input.publishCheck.summary}`
    return new ChapterPipelineStageError('human_review_required', message, {
      blocked: true,
      rewriteScope: meta.rewriteScope,
      targetSegmentId: meta.targetSegmentId,
      outputText: buildPipelineFailureOutput('human_review_required', message, meta),
    })
  }
  return null
}

export async function runRewriterQualityPipeline(input: {
  candidateLoop: Parameters<typeof runRewriterCandidateLoop>[0]
  postProcess: Omit<Parameters<typeof prepareRewriterCandidateForPublish>[0], 'content' | 'reviewNotes'>
  gateRepair: Omit<Parameters<typeof runPublishGateRepair>[0],
    'content' | 'reviewNotes' | 'miniReview' | 'publishCheck' | 'taskId' | 'attemptNumber' | 'rejectedDigests'>
  goldenReview: Omit<Parameters<typeof runGoldenChapterSemanticReview>[0], 'reviewNotes' | 'content'>
  persistCandidate: (candidate: {
    content: string
    reviewNotes: ChapterReviewNotes
    reviewNotesJson: string
    taskId: number
  }) => Promise<ChapterPublishCheck>
  persistGoldenReview: (reviewNotes: ChapterReviewNotes) => void
  rerunHeuristicPublishCheck: () => ChapterPublishCheck
  finalizePublishArtifacts: (publishCheck: ChapterPublishCheck) => void
  syncRevisionState: () => void
  failRole: (taskId: number, error: unknown, blocked?: boolean) => never
  rewriteScope: ChapterRewriteScope
}): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
  miniReview: RewriteMiniReviewVerdict
  publishCheck: ChapterPublishCheck
  taskId: number
}> {
  const candidate = await runRewriterCandidateLoop(input.candidateLoop)
  let content = candidate.outcome.content
  let reviewNotes = candidate.outcome.reviewNotes
  let miniReview = candidate.outcome.miniReview
  let taskId = candidate.taskId
  const prepared = await prepareRewriterCandidateForPublish({
    ...input.postProcess,
    content,
    reviewNotes,
  })
  content = prepared.content
  reviewNotes = prepared.reviewNotes
  if (prepared.failureError) input.failRole(taskId, prepared.failureError)

  let publishCheck = await input.persistCandidate({
    content,
    reviewNotes,
    reviewNotesJson: prepared.reviewNotesJson,
    taskId,
  })
  const gateRepair = await runPublishGateRepair({
    ...input.gateRepair,
    content,
    reviewNotes,
    miniReview,
    publishCheck,
    taskId,
    attemptNumber: candidate.attemptNumber,
    rejectedDigests: candidate.rejectedDigests,
  })
  content = gateRepair.content
  reviewNotes = gateRepair.reviewNotes
  miniReview = gateRepair.miniReview
  publishCheck = gateRepair.publishCheck
  taskId = gateRepair.taskId
  input.finalizePublishArtifacts(publishCheck)

  const golden = await runGoldenChapterSemanticReview({
    ...input.goldenReview,
    reviewNotes,
    content,
  })
  reviewNotes = golden.reviewNotes
  if (golden.reviewNotesChanged) input.persistGoldenReview(reviewNotes)
  if (golden.fallbackToHeuristic) publishCheck = input.rerunHeuristicPublishCheck()
  if (golden.blockerSummary) {
    const message = `黄金章节语义终验未通过：${golden.blockerSummary}`
    input.failRole(taskId, new ChapterPipelineStageError('human_review_required', message, {
      blocked: true,
      rewriteScope: 'chapter_rewrite',
      outputText: buildPipelineFailureOutput('human_review_required', message, { rewriteScope: 'chapter_rewrite' }),
    }), true)
  }
  input.syncRevisionState()
  const releaseError = buildRewriterReleaseError({ miniReview, rewriteScope: input.rewriteScope, publishCheck })
  if (releaseError) input.failRole(taskId, releaseError, true)
  return { content, reviewNotes, miniReview, publishCheck, taskId }
}

export function buildChapterRewriterMessages(input: ChapterRewriterPromptInput): Message[] {
  const { context } = input
  return [{
    role: 'user',
    content: buildChapterRewritePrompt({
      novelTitle: input.novelTitle,
      genre: input.genre,
      chapterNum: input.chapterNum,
      chapterTitle: input.chapterTitle,
      chapterGoal: context.chapterGoal,
      hardConstraintContext: context.hardConstraintContext,
      dialogueVoiceLocks: context.dialogueVoiceLocks,
      emotionTone: input.emotionTone,
      targetWords: input.targetWords,
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
      structuralAlertsSummary: input.structuralAlertsSummary,
      scenePlan: input.scenePlanText,
      draftContent: input.draftContent,
      reviewNotes: [input.prioritizedReviewNotesText, input.structuralRepairDirective]
        .filter(Boolean)
        .join('\n\n'),
      lockedParagraphs: input.lockedParagraphs,
      activeThreads: context.activeThreads,
      ...input.narrativeFields,
      ...input.guidance,
      protagonistReference: input.protagonistReference,
      protagonistRule: input.protagonistRule,
      promptTier: input.promptTier,
      attemptNumber: input.attemptNumber,
      rejectedDigests: input.rejectedDigests,
    }),
  }]
}

function buildGuardrailRepairMessages(
  input: ChapterRepairInput,
  content: string,
  reviewNotes: ChapterReviewNotes,
  attemptNumber: number | undefined,
  rejectedDigests: string[] | undefined,
): Message[] {
  const { chapter, context, novel, profile } = input
  return [{
    role: 'user',
    content: buildChapterRewritePrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
      chapterGoal: context.chapterGoal,
      hardConstraintContext: context.hardConstraintContext,
      dialogueVoiceLocks: context.dialogueVoiceLocks,
      emotionTone: chapter.emotionTone || '平稳',
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
      continuitySummary: context.continuitySummary,
      openLoops: context.openLoops,
      dueForeshadows: context.dueForeshadows,
      continuityNotes: context.continuityNotes,
      timelineSummary: context.timelineSummary,
      timelineOpenThreads: context.timelineOpenThreads,
      longTermMemory: context.longTermMemory,
      recalledMemory: context.recalledMemory,
      consistencyNotes: input.consistencyNotes,
      structuralAlertsSummary: input.structuralAlertsSummary,
      scenePlan: input.scenePlanText,
      draftContent: markLockedParagraphsInContent(content, input.lockedParagraphs),
      reviewNotes: formatReviewNotes(reviewNotes),
      lockedParagraphs: input.lockedParagraphs,
      activeThreads: context.activeThreads,
      protagonistReference: profile.protagonistReference,
      protagonistRule: profile.protagonistRule,
      promptTier: input.promptTier,
      attemptNumber,
      rejectedDigests,
    }),
  }]
}

async function runGuardrailRepairAttempt(
  input: ChapterRepairInput,
  content: string,
  reviewNotes: ChapterReviewNotes,
  attemptNumber: number | undefined,
  rejectedDigests: string[] | undefined,
): Promise<string> {
  return (await runChatTask({
    type: 'chapter_write',
    novelId: input.chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: input.chapter.id,
    messages: buildGuardrailRepairMessages(
      input,
      content,
      reviewNotes,
      attemptNumber,
      rejectedDigests,
    ),
    modelConfigId: input.novel.modelConfigId || undefined,
  })).trim()
}

function applyGuardrailReview(
  input: ChapterRepairInput,
  reviewNotes: ChapterReviewNotes,
  content: string,
  findings: ReturnType<typeof collectQualityGuardrailFindings>,
): ChapterReviewNotes {
  const notes = enhanceReviewNotesWithGuardrails(reviewNotes, content, input.profile.genre, findings)
  return applyHumanizationAnalysisToReviewNotes(notes, content, {
    chapterId: input.chapter.id,
    genre: input.profile.genre,
    chapterFunction: reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
    emotionTone: input.chapter.emotionTone || '',
  })
}

export async function repairChapterOutputIfNeeded(input: ChapterRepairInput): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
}> {
  const originalContent = input.content.trim()
  const findings = collectQualityGuardrailFindings(originalContent, input.profile.genre, {
    knownTerms: input.knownTerms,
  })
  if (findings.length === 0 || !shouldForceRepair(findings)) {
    return { content: originalContent, reviewNotes: input.reviewNotes }
  }
  const repairNotes = applyGuardrailReview(input, input.reviewNotes, originalContent, findings)
  try {
    const repairedContent = await runGuardrailRepairAttempt(
      input,
      originalContent,
      repairNotes,
      input.attemptNumber,
      input.rejectedDigests,
    )
    if (!repairedContent) return { content: originalContent, reviewNotes: repairNotes }

    const protectedRepaired = enforceLockedParagraphProtection(
      repairedContent,
      input.lockedParagraphs,
      originalContent,
      repairNotes,
    )
    if (protectedRepaired.violated) return protectedRepaired

    const finalFindings = collectQualityGuardrailFindings(
      protectedRepaired.content,
      input.profile.genre,
      { knownTerms: input.knownTerms },
    )
    if (finalFindings.length === 0 || !shouldForceRepair(finalFindings)) {
      return {
        content: protectedRepaired.content,
        reviewNotes: finalFindings.length > 0
          ? applyGuardrailReview(input, protectedRepaired.reviewNotes, protectedRepaired.content, finalFindings)
          : applyHumanizationAnalysisToReviewNotes(
              protectedRepaired.reviewNotes,
              protectedRepaired.content,
              {
                chapterId: input.chapter.id,
                genre: input.profile.genre,
                chapterFunction: protectedRepaired.reviewNotes.chapter_function_primary
                  || protectedRepaired.reviewNotes.pace_marker,
                emotionTone: input.chapter.emotionTone || '',
              },
            ),
      }
    }

    const secondRepairNotes = applyGuardrailReview(
      input,
      protectedRepaired.reviewNotes,
      protectedRepaired.content,
      finalFindings,
    )
    try {
      const secondContent = await runGuardrailRepairAttempt(
        input,
        protectedRepaired.content,
        secondRepairNotes,
        (input.attemptNumber || 1) + 1,
        [...(input.rejectedDigests || []), buildVariationDigest(protectedRepaired.content)],
      )
      if (secondContent) {
        const protectedSecond = enforceLockedParagraphProtection(
          secondContent,
          input.lockedParagraphs,
          protectedRepaired.content,
          secondRepairNotes,
        )
        return chooseBetterGuardrailCandidate(
          { content: protectedRepaired.content, reviewNotes: protectedRepaired.reviewNotes },
          { content: protectedSecond.content, reviewNotes: protectedSecond.reviewNotes },
          input.profile.genre,
          input.knownTerms,
        )
      }
    } catch {
      // A failed bounded second attempt keeps the usable first repair.
    }
    return { content: protectedRepaired.content, reviewNotes: secondRepairNotes }
  } catch {
    return { content: originalContent, reviewNotes: repairNotes }
  }
}

export async function processChapterRewriteOutcome(input: {
  rewriteOutput: string
  originalDraft: string
  lockedFallbackContent: string
  chapterTitle: string
  chapterWordTarget: number
  semanticGateMode: SemanticGateMode
  glossaryTerms: string[]
  repairInput: Omit<ChapterRepairInput, 'content' | 'reviewNotes'>
  reviewNotes: ChapterReviewNotes
}): Promise<RewriteOutcome> {
  const { repairInput } = input
  const protectedOutput = enforceLockedParagraphProtection(
    input.rewriteOutput,
    repairInput.lockedParagraphs,
    input.lockedFallbackContent,
    input.reviewNotes,
  )
  const repaired = await repairChapterOutputIfNeeded({
    ...repairInput,
    reviewNotes: protectedOutput.reviewNotes,
    content: protectedOutput.content,
  })
  const repairedContent = stripChapterHeadingNoise(
    repaired.content,
    repairInput.chapter.chapterNum,
    input.chapterTitle,
  ).content
  let reviewNotes = applyHumanizationAnalysisToReviewNotes(repaired.reviewNotes, repairedContent, {
    chapterId: repairInput.chapter.id,
    genre: repairInput.profile.genre,
    chapterFunction: repaired.reviewNotes.chapter_function_primary || repaired.reviewNotes.pace_marker,
    emotionTone: repairInput.chapter.emotionTone || '',
  })
  const dialogueAnalysis = analyzeChapterDialogueAgainstNovel(
    repairInput.chapter.novelId,
    repairInput.chapter.chapterNum,
    repairedContent,
  )
  reviewNotes = applyDialogueAnalysisToReviewNotes(
    reviewNotes,
    repairInput.chapter.novelId,
    repairInput.chapter.chapterNum,
    repairedContent,
    dialogueAnalysis,
    { replaceExistingSignals: true },
  )
  reviewNotes = applyStyleComplianceToReviewNotes(reviewNotes, repairInput.chapter.novelId, repairedContent)
  reviewNotes = applyReadingExperienceToReviewNotes(reviewNotes, repairedContent)
  reviewNotes = applyWordShapeObservation(reviewNotes, repairedContent, input.chapterWordTarget)
  reviewNotes = applyContractValidationToReviewNotes(reviewNotes, validateChapterContractDelivery({
    chapterId: repairInput.chapter.id,
    content: repairedContent,
    reviewNotes,
  }, { advisoryOnly: input.semanticGateMode === 'enforce' }))
  reviewNotes = applyGroundingAndLongWindowReviewNotes({
    reviewNotes,
    content: repairedContent,
    chapterId: repairInput.chapter.id,
    novelId: repairInput.chapter.novelId,
    chapterNum: repairInput.chapter.chapterNum,
    emotionTone: repairInput.chapter.emotionTone || '',
    genre: repairInput.profile.genre,
    glossaryTerms: input.glossaryTerms,
    scenePlanJson: repairInput.chapter.scenePlanJson,
    novel: repairInput.novel,
  })
  const miniReview = buildRewriteMiniReviewVerdict({
    originalContent: input.originalDraft,
    rewrittenContent: repairedContent,
    reviewPrioritySummary: buildReviewPrioritySummary(reviewNotes),
    reviewNotes,
  })
  return {
    content: repairedContent,
    reviewNotes: applyRewriteDeltaToReviewNotes(reviewNotes, miniReview.narrativeDelta),
    miniReview,
    dialogueAnalysis,
  }
}

export async function applyPostRewriteStyleRepair(input: {
  content: string
  genre: string
  knownTerms: string[]
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  modelConfigId?: number
  criticSemanticReview: SemanticGateReview | null
  evaluateSemantics: (content: string) => Promise<SemanticGateReview | null>
}): Promise<{
  content: string
  findings: ReturnType<typeof collectQualityGuardrailFindings>
}> {
  let content = input.content
  let findings = collectQualityGuardrailFindings(content, input.genre, { knownTerms: input.knownTerms })
  const styleOnly = findings.length > 0
    && findings.every((finding) => STYLE_REPAIRABLE_GUARDRAIL_CODES.has(finding.code))
  if (!hasBlockingGuardrailFindings(findings) || !styleOnly || !content.trim()) {
    return { content, findings }
  }
  try {
    const rawOutput = (await runChatTask({
      type: 'chapter_write',
      novelId: input.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapterId,
      messages: [{
        role: 'user',
        content: [
          '你是最终语言质检编辑，只做局部风格修复，不重排事件，不新增情节，不改变人物立场、事实、数字和对白结果。',
          '必须修复下面列出的全部风格命中，并输出完整正文，不要解释、不要标题。',
          ...findings.map((finding) => `- ${finding.code}：${finding.excerpt || finding.message}`),
          '高频姓名/称谓：在不造成指代歧义时，用动作主语、代词、职业或关系称呼替换部分机械重复；不要把主角姓名连续放进相邻句。',
          '低价值身体/声音细节：删除不改变行动、判断、阻力或后果的手指、眼睛、喉咙、嗓音微动作；只保留能改变现场的信息。',
          '破折号和括号：删除解释型、假停顿型用法，只有真实抢话、打断或语气断裂才保留。',
          '保持原文至少 75% 的篇幅，保留全部事件顺序、冲突结果、伏笔和代价。',
          '',
          '正文：',
          content,
        ].join('\n'),
      }],
      modelConfigId: input.modelConfigId,
    })).trim()
    const candidate = stripChapterHeadingNoise(rawOutput, input.chapterNum, input.chapterTitle).content
    const candidateWords = countNarrativeWords(candidate)
    const currentScore = guardrailRepairScore(findings)
    const candidateFindings = collectQualityGuardrailFindings(candidate, input.genre, { knownTerms: input.knownTerms })
    const candidateScore = guardrailRepairScore(candidateFindings)
    const candidateSemantic = candidate ? await input.evaluateSemantics(candidate) : null
    const currentBlockerDimensions = new Set(
      input.criticSemanticReview ? collectBlockerDimensions(input.criticSemanticReview) : [],
    )
    const semanticRegressed = candidateSemantic
      ? collectBlockerDimensions(candidateSemantic).some((dimension) => !currentBlockerDimensions.has(dimension))
      : false
    if (
      candidate
      && !semanticRegressed
      && candidateWords >= Math.round(countNarrativeWords(content) * 0.75)
      && candidateScore < currentScore
    ) {
      content = candidate
      findings = candidateFindings
      console.warn(`[chapter:pipeline] 后验风格质检修复采纳 chapter=${input.chapterId}：${currentScore}→${candidateScore}`)
    } else {
      console.warn(`[chapter:pipeline] 后验风格质检候选未改善，保留原稿 chapter=${input.chapterId}`)
    }
  } catch (error) {
    console.warn(`[chapter:pipeline] 后验风格质检失败，保留原稿 chapter=${input.chapterId}:`, error instanceof Error ? error.message : error)
  }
  return { content, findings }
}

export async function prepareRewriterCandidateForPublish(input: {
  content: string
  reviewNotes: ChapterReviewNotes
  genre: string
  knownTerms: string[]
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  emotionTone: string
  scenePlanText: string
  modelConfigId?: number
  criticSemanticReview: SemanticGateReview | null
  evaluateSemantics: (content: string) => Promise<SemanticGateReview | null>
  /** 风险复检完成后回调，用于把最近一份完整稿登记为可恢复的保稿基线。 */
  onRiskRechecked?: (reviewNotes: ChapterReviewNotes, content: string) => void
}): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
  reviewNotesJson: string
  failureError: ChapterPipelineStageError | null
}> {
  const reviewNotes = await runRewriteRiskRecheck({
    reviewNotes: input.reviewNotes,
    content: input.content,
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    chapterTitle: input.chapterTitle,
    scenePlanText: input.scenePlanText,
    modelConfigId: input.modelConfigId,
  })
  input.onRiskRechecked?.(reviewNotes, input.content)
  persistAntiAiRuleHits({
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    content: input.content,
    genre: input.genre,
    knownTerms: input.knownTerms,
  })
  const styleRepair = await applyPostRewriteStyleRepair({
    ...input,
    criticSemanticReview: input.criticSemanticReview,
    content: input.content,
  })
  const content = styleRepair.content
  const reviewNotesJson = JSON.stringify(applyHumanizationAnalysisToReviewNotes(
    enhanceReviewNotesWithGuardrails(reviewNotes, content, input.genre, styleRepair.findings),
    content,
    {
      chapterId: input.chapterId,
      genre: input.genre,
      chapterFunction: reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
      emotionTone: input.emotionTone,
    },
  ))
  persistAntiAiRuleHits({
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    content,
    genre: input.genre,
    knownTerms: input.knownTerms,
  })

  const blockingSummary = styleRepair.findings
    .filter((finding) => finding.severity === 'high')
    .map((finding) => `${finding.code}${finding.excerpt ? `：${finding.excerpt}` : ''}`)
    .slice(0, 6)
    .join('；')
  if (!hasBlockingGuardrailFindings(styleRepair.findings)) {
    return { content, reviewNotes, reviewNotesJson, failureError: null }
  }
  const message = [
    'Rewriter 二次修复后仍存在高风险 AI 味或模板化表达，需人工介入复核。',
    blockingSummary ? `具体命中：${blockingSummary}` : '',
  ].filter(Boolean).join(' ')
  return {
    content,
    reviewNotes,
    reviewNotesJson,
    failureError: new ChapterPipelineStageError('anti_ai_failed', message, {
      rewriteScope: 'chapter_rewrite',
      outputText: buildPipelineFailureOutput('anti_ai_failed', message, { rewriteScope: 'chapter_rewrite' }),
    }),
  }
}

export interface GoldenSemanticReviewOutput {
  reviewNotes: ChapterReviewNotes
  reviewNotesChanged: boolean
  fallbackToHeuristic: boolean
  blockerSummary: string
}

export async function runGoldenChapterSemanticReview(input: {
  policy: SemanticGatePolicy
  evaluator: RepairSemanticEvaluator
  reviewNotes: ChapterReviewNotes
  content: string
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  modelConfigId?: number
  contractSummary: string
  scenePlanSummary: string
  protagonistReference: string
}): Promise<GoldenSemanticReviewOutput> {
  const unchanged = {
    reviewNotes: input.reviewNotes,
    reviewNotesChanged: false,
    fallbackToHeuristic: false,
    blockerSummary: '',
  }
  if (input.policy.mode !== 'enforce'
    || !input.policy.goldenChapterNums.includes(input.chapterNum)
    || !input.content.trim()) return unchanged

  if (!input.evaluator.hasBudget()) {
    return {
      ...unchanged,
      reviewNotes: {
        ...input.reviewNotes,
        semantic_review_warnings: dedupeTextList([
          ...(input.reviewNotes.semantic_review_warnings || []),
          `黄金章节 golden_final 语义复核因超出本章语义调用预算（${input.policy.maxSemanticCallsPerChapter} 次）被跳过。`,
        ]),
      },
      reviewNotesChanged: true,
    }
  }
  input.evaluator.consumeCall()
  const gateRun = await runChapterSemanticGate({
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    chapterTitle: input.chapterTitle,
    chapterContent: input.content,
    dimensions: CORE_SEMANTIC_GATE_DIMENSIONS,
    stage: 'golden_final',
    mode: 'enforce',
    modelConfigId: input.modelConfigId,
    contractSummary: input.contractSummary,
    scenePlanSummary: input.scenePlanSummary,
    protagonistBrief: input.protagonistReference,
    heuristicHints: collectSemanticGateHeuristicHints(input.reviewNotes),
  })
  if (gateRun.degraded) {
    if (input.policy.fallbackMode === 'heuristic') {
      console.warn(`[semantic-gate] golden_final 语义评审失败，已回退启发式验收 chapter=${input.chapterId}`)
      return { ...unchanged, fallbackToHeuristic: true }
    }
    return {
      ...unchanged,
      reviewNotes: {
        ...input.reviewNotes,
        semantic_review_warnings: dedupeTextList([
          ...(input.reviewNotes.semantic_review_warnings || []),
          '语义评审缺席：golden_final 语义门调用失败，按 warn-pass 策略放行本章。',
        ]),
      },
      reviewNotesChanged: true,
    }
  }
  const blockers = gateRun.review.verdicts.filter((verdict) => verdict.status === 'blocker')
  const reviewNotes = {
    ...input.reviewNotes,
    semantic_verdicts: gateRun.review.verdicts,
    semantic_review_warnings: dedupeTextList([
      ...(input.reviewNotes.semantic_review_warnings || []),
      ...gateRun.review.warnings,
    ]),
    ...(blockers.length > 0 ? {
      critical_fixes: dedupeTextList([
        ...blockers.map(formatSemanticGateBlockerFix),
        ...input.reviewNotes.critical_fixes,
      ]),
      severity: mergeSeverity(input.reviewNotes.severity, 'high'),
      rewrite_required: true,
    } : {}),
  }
  return {
    reviewNotes,
    reviewNotesChanged: true,
    fallbackToHeuristic: false,
    blockerSummary: blockers
      .map((verdict) => `${SEMANTIC_GATE_DIMENSION_SPECS[verdict.dimension]?.label || verdict.dimension}：${verdict.summary}`)
      .slice(0, 3)
      .join('；'),
  }
}

function toRiskList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))]
    : []
}

export async function runRewriteRiskRecheck(input: {
  reviewNotes: ChapterReviewNotes
  content: string
  novelId: number
  chapterId: number
  chapterNum: number
  chapterTitle: string
  scenePlanText: string
  modelConfigId?: number
}): Promise<ChapterReviewNotes> {
  const { reviewNotes } = input
  const staleRiskCount = reviewNotes.step_memory_risks.length
    + reviewNotes.opening_hook_risks.length
    + reviewNotes.hallucination_risks.length
    + reviewNotes.title_alignment_risks.length
  if (staleRiskCount === 0 || !input.content.trim()) return reviewNotes
  try {
    const recheckRaw = await runChatTask({
      type: 'chapter_critic',
      novelId: input.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapterId,
      messages: [{
        role: 'user',
        content: [
          '你是小说审校复核员。下列风险是此前针对"重写前初稿"提出的；正文已经重写。请逐条核对每个风险在"当前正文"里是否仍然成立。',
          '仍成立的条目保留（可改写成针对当前正文的准确表述），已被重写修复的移入 resolved_risks。不要新增清单之外的问题，不要输出解释。',
          '只输出一个 JSON 对象：{"step_memory_risks":[],"opening_hook_risks":[],"hallucination_risks":[],"title_alignment_risks":[],"resolved_risks":[]}',
          `【章节】第${input.chapterNum}章 ${input.chapterTitle}`,
          input.scenePlanText ? `【场景计划】\n${input.scenePlanText}` : '',
          reviewNotes.step_memory_risks.length > 0 ? `【原接力断链风险】\n${reviewNotes.step_memory_risks.join('\n')}` : '',
          reviewNotes.opening_hook_risks.length > 0 ? `【原开篇追读风险】\n${reviewNotes.opening_hook_risks.join('\n')}` : '',
          reviewNotes.hallucination_risks.length > 0 ? `【原无来源新增风险】\n${reviewNotes.hallucination_risks.join('\n')}` : '',
          reviewNotes.title_alignment_risks.length > 0 ? `【原标题贴合风险】\n${reviewNotes.title_alignment_risks.join('\n')}` : '',
          '',
          '【当前正文】',
          input.content,
        ].filter(Boolean).join('\n'),
      }],
      modelConfigId: input.modelConfigId,
      retryable: true,
    })
    const parsed = parseAiJsonResult<Record<string, unknown>>(recheckRaw, 'object', {
      channel: 'chapter',
      message: '重写稿复检 JSON 解析失败，保留初稿审校证据并沿用流水线降级兜底。',
      consoleSummary: `[chapter:warn] rewrite-recheck-json-fallback chapter=${input.chapterId}`,
      context: { chapterId: input.chapterId, novelId: input.novelId, stage: 'rewrite_recheck' },
    })
    if (!parsed.success) return reviewNotes
    const payload = parsed.data as Record<string, unknown>
    const nextReviewNotes = {
      ...reviewNotes,
      step_memory_risks: toRiskList(payload.step_memory_risks),
      opening_hook_risks: toRiskList(payload.opening_hook_risks),
      hallucination_risks: toRiskList(payload.hallucination_risks),
      title_alignment_risks: toRiskList(payload.title_alignment_risks),
      rewrite_recheck: {
        performed: true,
        checkedAt: new Date().toISOString(),
        resolved: toRiskList(payload.resolved_risks),
      },
    }
    console.log(
      `[chapter:pipeline] 重写稿轻量复检完成 chapter=${input.chapterId}：`
      + `接力${nextReviewNotes.step_memory_risks.length}条 `
      + `开篇${nextReviewNotes.opening_hook_risks.length}条 `
      + `幻觉${nextReviewNotes.hallucination_risks.length}条 `
      + `标题${nextReviewNotes.title_alignment_risks.length}条仍成立，`
      + `已修复${nextReviewNotes.rewrite_recheck.resolved.length}条`,
    )
    return nextReviewNotes
  } catch (error) {
    console.warn(`[chapter:pipeline] 重写稿复检失败，保留初稿审校证据 chapter=${input.chapterId}:`, error instanceof Error ? error.message : error)
    return reviewNotes
  }
}

export type RewriterChatOptions = Partial<ChatOptions>
