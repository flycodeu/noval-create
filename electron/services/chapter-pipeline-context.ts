import { asc, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { getOperatingModeRuntimePolicy, getRecommendedChapterWordsForOperatingMode } from '../../src/shared/operating-mode'
import type {
  AiExecutionMode,
  ChapterRewriteScope,
  StageRenderSchema,
  UpstreamRuntimeArtifacts,
  WriterContextOrchestratorResolution,
  WriterContextOrchestratorRuntimeOptions,
} from '../../src/types'
import type { ThemeVoiceDocument } from '../../src/shared/theme-voice'
import { getDb, getSqlite } from '../database/db'
import { chapters, glossary, novels, storyArcs } from '../database/schema'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  allocateChapterContext,
  collectChapterContextRawData,
  ContextOverflowError,
  HardConstraintOverflowError,
  resolveMentionedEntityLimits,
  type ChapterContext,
  type HardConstraintSourceLabel,
} from './context.service'
import { markNovelContextChanged } from './context-impact.service'
import { dedupeTextList, type ChapterReviewNotes } from './chapter-review-notes'
import type { StepMemoryRuntimeState } from './chapter-pipeline-state'
import { listPromptOverrides } from './prompt-override.service'
import {
  enrichSourceGroundingFromWeb,
  mergeSourceGroundingEnrichmentIntoCurrent,
} from './source-grounding-search.service'
import {
  formatStoryArcCheckpointReminder,
  getStoryArcProgressSnapshot,
  getStoryArcStatusContext,
} from './story-arc-progress.service'
import { resolveWriterOrchestratedContext } from './writer-context-orchestrator.service'
import {
  buildChapterBridgePlan,
  buildHookContinuitySnapshot,
  buildPovRotationPlan,
  buildStoryPacingCurve,
  buildVoiceEvolutionProfiles,
  formatChapterBridgePlan,
} from './generation-integrity.service'
import {
  analyzeExpressionDedupForGeneration,
  formatExpressionDedupGuidance,
} from './expression-dedup.service'
import { analyzeSummaryHealthForChapter } from './summary-decay.service'
import { analyzeNarrativeControls } from './narrative-control.service'
import type { ChapterPromptGuidance, ChapterPromptNarrativeFields } from './chapter-pipeline-planner'

export type ChapterComplexity = 'simple' | 'standard' | 'key'
export type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export type ChapterRawContext = Awaited<ReturnType<typeof collectChapterContextRawData>>

interface ChapterComplexityInput {
  chapter: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  chapterRows: Array<typeof chapters.$inferSelect>
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
}

export interface StageContextResolverPayload {
  stage: ChapterContextStage
  context: ChapterContext
  effectiveRawContext: ChapterRawContext
  upstreamArtifacts: UpstreamRuntimeArtifacts
  renderSchema: StageRenderSchema
  writerContextResolution?: WriterContextOrchestratorResolution
}

const CHAPTER_PIPELINE_PROMPT_KEYS = new Set([
  'scenePlan',
  'chapterDraft',
  'chapterWriting',
  'chapterReview',
  'chapterRewrite',
])

export function getActiveChapterPromptOverrideKeys(): string[] {
  return listPromptOverrides()
    .map((record) => record.key)
    .filter((key) => CHAPTER_PIPELINE_PROMPT_KEYS.has(key))
}

function getActiveChapterPromptOverrideFingerprint(): string {
  const activeOverrides = listPromptOverrides()
    .filter((record) => CHAPTER_PIPELINE_PROMPT_KEYS.has(record.key))
    .map((record) => ({
      key: record.key,
      updatedAt: record.updatedAt || '',
      content: record.content || '',
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
  return createHash('sha1').update(JSON.stringify(activeOverrides)).digest('hex').slice(0, 16)
}

export function resolveChapterReferenceWords(
  chapterWords: number | null | undefined,
  novel: { launchMode?: string | null; targetWords?: number | null; settingsJson?: string | null },
): number {
  const explicit = typeof chapterWords === 'number' && Number.isFinite(chapterWords) && chapterWords > 0
    ? Math.round(chapterWords)
    : 0
  return explicit || getRecommendedChapterWordsForOperatingMode({
    launchMode: novel.launchMode,
    targetWords: novel.targetWords,
    settingsJson: novel.settingsJson,
  })
}

export function buildArcProgressCheckpoint(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''
  const snapshot = getStoryArcProgressSnapshot(arc.novelId)
  const { summary, point } = getStoryArcStatusContext(snapshot, arc.id, chapterNum)
  return formatStoryArcCheckpointReminder(summary, point)
}

export function classifyChapterComplexity(input: ChapterComplexityInput): ChapterComplexity {
  const { chapter, currentArc, chapterRows, outlineMentionedCharacterCount, activeThreadPressureCount } = input
  const outline = chapter.outline || ''
  const emotionTone = (chapter.emotionTone || '').toLowerCase()
  const maxChapterNum = chapterRows.reduce((max, row) => Math.max(max, row.chapterNum), 0)
  const isArcCheckpoint = Boolean(buildArcProgressCheckpoint(currentArc, chapter.chapterNum))
  const isArcEnding = Boolean(currentArc?.chapterEnd === chapter.chapterNum)
  const isFirstChapter = chapter.chapterNum === 1
  const isLastChapter = maxChapterNum > 0 && chapter.chapterNum === maxChapterNum

  if (
    emotionTone.includes('高潮')
    || emotionTone.includes('climax')
    || emotionTone.includes('爆发')
    || emotionTone.includes('转折')
    || emotionTone.includes('结局')
    || emotionTone.includes('决战')
    || isFirstChapter
    || isLastChapter
    || isArcCheckpoint
    || isArcEnding
    || outlineMentionedCharacterCount > 3
    || activeThreadPressureCount >= 4
  ) return 'key'

  if (
    (emotionTone.includes('过渡') || emotionTone.includes('日常') || emotionTone.includes('平缓') || emotionTone.includes('铺垫'))
    && outline.length > 0
    && outline.length < 200
    && outlineMentionedCharacterCount <= 2
    && activeThreadPressureCount <= 2
    && !isFirstChapter
    && !isLastChapter
    && !isArcCheckpoint
    && !isArcEnding
  ) return 'simple'

  return 'standard'
}

export function resolveContextBudgetForStage(
  stage: ChapterContextStage,
  complexity: ChapterComplexity,
  targetWords: number,
  novelTargetWords = 0,
): number {
  const baseByStage: Record<ChapterContextStage, number> = {
    scenePlan: 10000,
    draft: 12000,
    review: 10000,
    rewrite: 13500,
  }
  const complexityOffset: Record<ChapterComplexity, number> = {
    simple: -1200,
    standard: 0,
    key: 1800,
  }
  const largeChapterOffset = targetWords >= 5000 ? 1200 : targetWords >= 3500 ? 400 : 0
  const novelScaleOffset = novelTargetWords >= 1500000
    ? 4000
    : novelTargetWords >= 800000
      ? 2800
      : novelTargetWords >= 500000
        ? 1600
        : novelTargetWords >= 300000
          ? 800
          : 0
  return Math.max(7000, baseByStage[stage] + complexityOffset[complexity] + largeChapterOffset + novelScaleOffset)
}

export function logConstraintInjectionStatus(stage: ChapterContextStage, context: ChapterContext): void {
  const status = context.constraintInjectionStatus
  const report = context.contextBudgetReport
  const injectedTitles = context.hardConstraintEntries.map((entry) => entry.title).join('、') || '无'
  const truncatedTitles = context.hardConstraintEntries
    .filter((entry) => entry.truncated)
    .map((entry) => entry.title)
    .join('、') || '无'
  console.info(
    `[chapter:context] stage=${stage} hard=${status.hardConstraintUsed}/${status.hardConstraintBudget} soft=${status.softContextUsed}/${status.softContextBudget} available=${report.availableContextBudget} requested=${report.requestedBudget} overflow=${report.overflowLevel} dropped=${status.droppedConstraintCount} injected=${injectedTitles} truncated=${truncatedTitles}`,
  )
}

export function summarizeStageArtifactText(value: string, maxChars = 480): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(maxChars - 3, 1)).trim()}...`
}

export function summarizeStageArtifactLines(
  lines: Array<string | null | undefined>,
  maxLines = 4,
  maxChars = 480,
): string {
  const normalized = [...new Set(lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean))]
  if (normalized.length === 0) return ''
  return summarizeStageArtifactText(normalized.slice(0, maxLines).join('\n'), maxChars)
}

export function buildContractVersionArtifactSummary(contractVersion?: string): string {
  return contractVersion ? `当前章节合同版本：${contractVersion}` : ''
}

export function buildReviewRiskArtifactSummary(reviewNotes: ChapterReviewNotes): string {
  return summarizeStageArtifactLines([
    reviewNotes.summary,
    ...reviewNotes.critical_fixes.slice(0, 2).map((item) => `关键修订：${item}`),
    ...reviewNotes.coherence_risks.slice(0, 2).map((item) => `连贯性风险：${item}`),
    ...reviewNotes.reader_hook_risks.slice(0, 2).map((item) => `追读风险：${item}`),
    ...reviewNotes.step_memory_risks.slice(0, 2).map((item) => `步骤接力风险：${item}`),
    ...reviewNotes.opening_hook_risks.slice(0, 2).map((item) => `开篇风险：${item}`),
    ...reviewNotes.title_alignment_risks.slice(0, 1).map((item) => `标题风险：${item}`),
    ...reviewNotes.hallucination_risks.slice(0, 2).map((item) => `幻觉风险：${item}`),
    ...reviewNotes.language_risks.slice(0, 2).map((item) => `语言风险：${item}`),
  ], 6, 640)
}

export function buildReviewProofArtifactSummary(reviewNotes: ChapterReviewNotes): string {
  return summarizeStageArtifactLines([
    ...reviewNotes.continuity_risks.slice(0, 2).map((item) => `连续性证据：${item}`),
    ...reviewNotes.arc_progress_risks.slice(0, 2).map((item) => `弧线推进证据：${item}`),
    ...reviewNotes.missing_payoffs.slice(0, 2).map((item) => `伏笔兑现证据：${item}`),
    ...reviewNotes.human_language_repairs.slice(0, 2).map((item) => `语言替换证据：${item}`),
  ], 6, 640)
}

export function buildRewriteDeltaArtifactSummary(
  reviewNotes: ChapterReviewNotes,
  rewriteScope: ChapterRewriteScope,
  prioritySummaryText: string,
): string {
  return summarizeStageArtifactLines([
    reviewNotes.revision_brief,
    `重写范围：${rewriteScope}`,
    prioritySummaryText,
  ], 5, 640)
}

export function buildStepMemorySummary(params: {
  chapterBridgePlan?: string
  scenePlanText?: string
  draftText?: string
  reviewNotes?: ChapterReviewNotes
  previousSummary?: string
}): StepMemoryRuntimeState {
  const reviewNotes = params.reviewNotes
  const riskLines = reviewNotes
    ? [
        ...reviewNotes.step_memory_risks.slice(0, 2).map((item) => `步骤接力风险：${item}`),
        ...reviewNotes.opening_hook_risks.slice(0, 2).map((item) => `开篇风险：${item}`),
        ...reviewNotes.title_alignment_risks.slice(0, 1).map((item) => `标题风险：${item}`),
        ...reviewNotes.hallucination_risks.slice(0, 2).map((item) => `幻觉风险：${item}`),
        ...reviewNotes.critical_fixes.slice(0, 2).map((item) => `必修：${item}`),
      ]
    : []
  const runtimeAssertions = dedupeTextList([
    params.chapterBridgePlan ? '正文开篇必须优先兑现章节衔接桥，不得跳过上章结尾压力。' : '',
    params.scenePlanText ? 'Writer 必须逐场执行 Planner 的场景计划，不得漏掉 must_cover 和 exit_hook。' : '',
    params.draftText ? 'Critic/Rewriter 必须以 Writer 初稿为事实底稿，修复问题时不得新增无来源设定。' : '',
    reviewNotes?.opening_hook_risks.length ? '重写时先修章首 800 字和章尾递进，再处理普通润色。' : '',
    reviewNotes?.step_memory_risks.length ? '重写必须补齐 Planner、章节衔接桥和正文执行之间的断点。' : '',
    reviewNotes?.hallucination_risks.length ? '重写必须删除或改写无来源新增内容，所有新增细节都要能由上下文支撑。' : '',
  ]).slice(0, 8)
  return {
    summary: summarizeStageArtifactLines([
      params.previousSummary,
      params.chapterBridgePlan ? `章节衔接桥：${summarizeStageArtifactText(params.chapterBridgePlan, 220)}` : '',
      params.scenePlanText ? `Planner 接力：${summarizeStageArtifactText(params.scenePlanText, 260)}` : '',
      params.draftText ? `Writer 底稿：${summarizeStageArtifactText(params.draftText, 260)}` : '',
      ...riskLines,
    ], 8, 900),
    runtimeAssertions,
  }
}

function buildStageRenderSchema(stage: ChapterContextStage): StageRenderSchema {
  switch (stage) {
    case 'scenePlan':
      return {
        stage,
        requiredAllocatorFields: ['writingContractSummary', 'relationSummary', 'characterStates'],
        optionalAllocatorFields: ['chapterBridgePlan', 'stepMemorySummary', 'scenePlanSummary', 'contractVersionSummary', 'activeThreads', 'dueForeshadows', 'mapSummary'],
      }
    case 'review':
      return {
        stage,
        requiredAllocatorFields: ['draftTextSummary', 'scenePlanSummary', 'contractVersionSummary', 'reviewRiskSummary', 'publishGateRiskSummary'],
        optionalAllocatorFields: ['chapterBridgePlan', 'stepMemorySummary', 'reviewProofSummary', 'continuityNotes', 'openLoops', 'timelineSummary'],
      }
    case 'rewrite':
      return {
        stage,
        requiredAllocatorFields: ['draftTextSummary', 'scenePlanSummary', 'contractVersionSummary', 'reviewRiskSummary', 'rewriteDeltaSummary'],
        optionalAllocatorFields: ['chapterBridgePlan', 'stepMemorySummary', 'reviewProofSummary', 'publishGateRiskSummary', 'continuityNotes', 'timelineSummary'],
      }
    case 'draft':
    default:
      return {
        stage,
        requiredAllocatorFields: ['writingContractSummary', 'relationSummary', 'characterStates'],
        optionalAllocatorFields: ['chapterBridgePlan', 'stepMemorySummary', 'scenePlanSummary', 'contractVersionSummary', 'activeThreads', 'recalledMemory', 'mapSummary'],
      }
  }
}

export function applyUpstreamArtifactsToRawContext(
  rawContext: ChapterRawContext,
  upstreamArtifacts: UpstreamRuntimeArtifacts,
): ChapterRawContext {
  const hasArtifacts = Object.values(upstreamArtifacts).some((value) => (
    typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) ? value.length > 0 : Boolean(value)
  ))
  if (!hasArtifacts) return rawContext
  return {
    ...rawContext,
    contextParts: {
      ...rawContext.contextParts,
      scenePlanSummary: upstreamArtifacts.scenePlanSummary || rawContext.contextParts.scenePlanSummary,
      draftTextSummary: upstreamArtifacts.draftTextSummary || rawContext.contextParts.draftTextSummary,
      contractVersionSummary: upstreamArtifacts.contractVersionSummary || rawContext.contextParts.contractVersionSummary,
      reviewRiskSummary: upstreamArtifacts.reviewRiskSummary || rawContext.contextParts.reviewRiskSummary,
      reviewProofSummary: upstreamArtifacts.reviewProofSummary || rawContext.contextParts.reviewProofSummary,
      rewriteDeltaSummary: upstreamArtifacts.rewriteDeltaSummary || rawContext.contextParts.rewriteDeltaSummary,
      publishGateRiskSummary: upstreamArtifacts.publishGateRiskSummary || rawContext.contextParts.publishGateRiskSummary,
      stepMemorySummary: upstreamArtifacts.stepMemorySummary || rawContext.contextParts.stepMemorySummary,
    },
  }
}

export function allocateStageContextForPipeline(
  rawContext: ChapterRawContext,
  chapter: typeof chapters.$inferSelect,
  complexity: ChapterComplexity,
  promptProfile: ChapterContextStage,
  totalBudget?: number,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
): ChapterContext {
  try {
    return allocateChapterContext(rawContext, {
      promptProfile,
      chapterComplexity: complexity,
      totalBudget: totalBudget || resolveContextBudgetForStage(
        promptProfile,
        complexity,
        resolveChapterReferenceWords(chapter.targetWords, rawContext.novel),
        rawContext.novel.targetWords || 0,
      ),
      preserveConstraintLabels,
    })
  } catch (error) {
    if (error instanceof HardConstraintOverflowError) throw error
    if (error instanceof ContextOverflowError) return error.context
    throw error
  }
}

function applyWriterContextOverridesToRawContext(
  rawContext: ChapterRawContext,
  overrides?: Partial<ChapterContext>,
): ChapterRawContext {
  if (!overrides || Object.keys(overrides).length === 0) return rawContext
  return {
    ...rawContext,
    contextParts: {
      ...rawContext.contextParts,
      ...Object.fromEntries(
        Object.entries(overrides).filter(([, value]) => typeof value === 'string' && value.trim().length > 0),
      ),
    },
  }
}

function appendWriterContextFallback(
  resolution: WriterContextOrchestratorResolution,
  detail: string,
): WriterContextOrchestratorResolution {
  return {
    ...resolution,
    toolCalls: [
      ...resolution.toolCalls,
      {
        target: 'orchestrator',
        toolName: 'writer_context.legacy_fallback',
        status: 'failed',
        durationMs: 0,
        errorMessage: detail,
      },
    ],
    fallbackEvents: [
      ...resolution.fallbackEvents,
      {
        target: 'orchestrator',
        reason: 'service_failed',
        detail,
        fallbackMode: 'conservative',
      },
    ],
  }
}

function buildLegacyFallbackWriterContextResolution(
  chapter: typeof chapters.$inferSelect,
  rawContext: ChapterRawContext,
  contractVersion: string | undefined,
  activePromptOverrideKeys: string[] | undefined,
  error: unknown,
): WriterContextOrchestratorResolution {
  const detail = error instanceof Error ? error.message : 'unknown error'
  const cacheSalt = [
    [...(activePromptOverrideKeys || [])].sort().join('|'),
    getActiveChapterPromptOverrideFingerprint(),
  ].filter(Boolean).join('|')
  return {
    cacheKey: 'writer-orchestrator:legacy-fallback',
    cacheHit: false,
    queryPlan: [],
    retrievalFingerprint: {
      digest: 'legacy-fallback',
      cacheKey: 'writer-orchestrator:legacy-fallback',
      signalHash: 'legacy-fallback',
      planHash: 'legacy-fallback',
      invalidationHash: 'legacy-fallback',
      inputs: {
        novelId: chapter.novelId,
        chapterId: chapter.id,
        chapterNum: chapter.chapterNum,
        chapterContextVersion: chapter.contextVersion || 1,
        novelContextVersion: rawContext.novel.contextVersion || 1,
        assetFingerprint: contractVersion || '',
        cacheSalt,
        mentionedCharacterCount: rawContext.mentionedCharacters.length,
        mentionedItemCount: rawContext.mentionedItems.length,
        mentionedLocationCount: rawContext.mentionedLocations.length,
        mentionedFactionCount: rawContext.mentionedFactions.length,
        enabledBuckets: [],
      },
    },
    structuredPack: {
      characters: [],
      items: [],
      mapLocations: [],
      timeline: [],
      recall: { hits: [] },
    },
    renderedContextOverrides: {},
    toolCalls: [{
      target: 'orchestrator',
      toolName: 'writer_context.resolve',
      status: 'failed',
      durationMs: 0,
      errorMessage: detail,
    }],
    fallbackEvents: [{
      target: 'orchestrator',
      reason: 'service_failed',
      detail,
      fallbackMode: 'conservative',
    }],
    allocatorInputSummary: {
      overrideLabels: [],
      overrideCharCount: 0,
      overrideLineCount: 0,
      enabledBucketCount: 0,
      signalCharCount: 0,
      buckets: [],
    },
  }
}

export function allocateDraftContextWithWriterFallback(
  chapter: typeof chapters.$inferSelect,
  baseRawContext: ChapterRawContext,
  writerRawContext: ChapterRawContext,
  complexity: ChapterComplexity,
  writerContextResolution: WriterContextOrchestratorResolution,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
): {
  effectiveRawContext: ChapterRawContext
  draftContext: ChapterContext
  writerContextResolution: WriterContextOrchestratorResolution
} {
  try {
    return {
      effectiveRawContext: writerRawContext,
      draftContext: allocateStageContextForPipeline(writerRawContext, chapter, complexity, 'draft', undefined, preserveConstraintLabels),
      writerContextResolution,
    }
  } catch (error) {
    const detail = `writer draft allocator fallback: ${error instanceof Error ? error.message : 'unknown error'}`
    return {
      effectiveRawContext: baseRawContext,
      draftContext: allocateStageContextForPipeline(baseRawContext, chapter, complexity, 'draft', undefined, preserveConstraintLabels),
      writerContextResolution: appendWriterContextFallback(writerContextResolution, detail),
    }
  }
}

function resolveWriterRuntimeOptions(rawContext: ChapterRawContext): WriterContextOrchestratorRuntimeOptions {
  const policy = getOperatingModeRuntimePolicy({
    launchMode: rawContext.novel.launchMode,
    targetWords: rawContext.novel.targetWords,
    settingsJson: rawContext.novel.settingsJson,
  })
  const scaleBoost = policy.operatingMode === 'million_longform'
    ? 4
    : policy.operatingMode === 'epic_longform'
      ? 2
      : policy.operatingMode === 'standard_longform'
        ? 1
        : 0
  const mentionedCharacterCount = rawContext.mentionedCharacters.length
  const mentionedItemCount = rawContext.mentionedItems.length
  const mentionedLocationCount = rawContext.mentionedLocations.length
  const threadPressure = rawContext.activeThreadPressureCount
  const entityLimits = resolveMentionedEntityLimits({
    targetWords: rawContext.novel.targetWords,
    chapterCount: rawContext.chapterRows.length,
    launchMode: rawContext.novel.launchMode,
    settingsJson: rawContext.novel.settingsJson,
  })
  const characterCeiling = policy.operatingMode === 'million_longform'
    ? Math.max(entityLimits.characters, Math.min(72, mentionedCharacterCount + 8))
    : policy.operatingMode === 'epic_longform'
      ? Math.max(entityLimits.characters, Math.min(40, mentionedCharacterCount + 6))
      : Math.max(20, entityLimits.characters)
  const itemCeiling = policy.operatingMode === 'million_longform'
    ? Math.max(entityLimits.items, Math.min(64, mentionedItemCount + 8))
    : policy.operatingMode === 'epic_longform'
      ? Math.max(entityLimits.items, Math.min(34, mentionedItemCount + 6))
      : Math.max(16, entityLimits.items)
  const mapCeiling = policy.operatingMode === 'million_longform'
    ? Math.max(entityLimits.locations, Math.min(64, mentionedLocationCount + 8))
    : policy.operatingMode === 'epic_longform'
      ? Math.max(entityLimits.locations, Math.min(32, mentionedLocationCount + 6))
      : Math.max(16, entityLimits.locations)
  const timelineCeiling = policy.operatingMode === 'million_longform' ? 40 : policy.operatingMode === 'epic_longform' ? 28 : 16
  const threadCeiling = policy.operatingMode === 'million_longform' ? 40 : policy.operatingMode === 'epic_longform' ? 28 : 16
  return {
    useMemoryCache: true,
    forceRefresh: false,
    maxCharacters: Math.min(characterCeiling, Math.max(6 + scaleBoost, mentionedCharacterCount)),
    maxItems: Math.min(itemCeiling, Math.max(4 + Math.ceil(scaleBoost / 2), mentionedItemCount)),
    maxMapLocations: Math.min(mapCeiling, Math.max(4 + scaleBoost, mentionedLocationCount)),
    maxTimelineEvents: Math.min(timelineCeiling, Math.max(4 + scaleBoost, mentionedLocationCount + (threadPressure >= 4 ? 2 : 0))),
    maxThreads: Math.min(threadCeiling, Math.max(4 + scaleBoost, threadPressure)),
    maxRecallHitsPerBucket: policy.operatingMode === 'million_longform'
      ? 5
      : policy.operatingMode === 'epic_longform'
        ? 4
        : 3,
  }
}

export async function resolveWriterContextForStage(
  chapter: typeof chapters.$inferSelect,
  rawContext: ChapterRawContext,
  executionMode: AiExecutionMode | undefined,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
  contractVersion?: string,
  activePromptOverrideKeys?: string[],
): Promise<{
  effectiveRawContext: ChapterRawContext
  writerContextResolution: WriterContextOrchestratorResolution
}> {
  const db = getDb()
  try {
    const glossaryTerms = db.select({ term: glossary.term }).from(glossary)
      .where(eq(glossary.novelId, chapter.novelId))
      .orderBy(asc(glossary.sortOrder), asc(glossary.id))
      .all()
      .map((row: { term: string | null }) => row.term || '')
      .filter(Boolean)
    const backgroundText = [
      rawContext.novel.expandedBackground,
      rawContext.novel.synopsis,
      rawContext.novel.userBackground,
    ].filter(Boolean).join('\n')
    const sourceGrounding = await enrichSourceGroundingFromWeb({
      novelId: chapter.novelId,
      chapterId: chapter.id,
      chapterNum: chapter.chapterNum,
      genre: rawContext.profile.genre,
      novelTitle: rawContext.novel.title,
      chapterTitle: chapter.title || '',
      chapterOutline: chapter.outline || '',
      chapterGoal: rawContext.contextParts.chapterGoal,
      worldRules: rawContext.contextParts.worldRules,
      backgroundText,
      glossaryTerms,
      historicalProfileJson: rawContext.novel.historicalProfileJson,
      projectCanonProfileJson: rawContext.novel.projectCanonProfileJson,
      canonConstraintSetJson: rawContext.novel.canonConstraintSetJson,
      sourceLedgerJson: rawContext.novel.sourceLedgerJson,
      canonSourceLedgerJson: rawContext.novel.canonSourceLedgerJson,
      canonFactCardsJson: rawContext.novel.canonFactCardsJson,
    })
    let writerRawContext = rawContext
    if (sourceGrounding.updated) {
      const recordedAt = sourceGrounding.recordedAt || new Date().toISOString()
      const sqlite = getSqlite()
      const commit = sqlite.transaction(() => {
        const latestNovel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
        if (!latestNovel) throwUserFacingError('novel.notFound')
        const merged = mergeSourceGroundingEnrichmentIntoCurrent(latestNovel, sourceGrounding)
        db.update(novels).set({
          ...merged,
          updatedAt: recordedAt,
        }).where(eq(novels.id, chapter.novelId)).run()
        const nextContextVersion = markNovelContextChanged(chapter.novelId, 'External source grounding updated')
        const committedNovel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
        if (!committedNovel) throwUserFacingError('novel.notFound')
        return { merged, nextContextVersion, updatedAt: committedNovel.updatedAt || recordedAt }
      })
      const committed = sqlite.inTransaction || typeof commit.immediate !== 'function'
        ? commit()
        : commit.immediate()
      writerRawContext = {
        ...rawContext,
        novel: {
          ...rawContext.novel,
          ...committed.merged,
          contextVersion: committed.nextContextVersion,
          updatedAt: committed.updatedAt,
        },
      }
    } else if (sourceGrounding.attempted && sourceGrounding.diagnostics.length > 0) {
      writerRawContext = {
        ...rawContext,
        contextParts: {
          ...rawContext.contextParts,
          worldRules: [
            rawContext.contextParts.worldRules,
            `来源检索状态：${sourceGrounding.diagnostics.join('；')} 生成真实历史、政治、行业或制度细节时必须保守表达，不能把未查证内容写成确定事实。`,
          ].filter(Boolean).join('\n'),
        },
      }
    }

    const writerContextResolution = await resolveWriterOrchestratedContext({
      novelId: chapter.novelId,
      chapterId: chapter.id,
      chapterNum: chapter.chapterNum,
      signals: {
        chapterTitle: chapter.title || '',
        chapterOutline: chapter.outline || '',
        chapterGoal: writerRawContext.contextParts.chapterGoal,
        arcSummary: writerRawContext.currentArc?.arcSummary || '',
        arcGoal: writerRawContext.currentArc?.arcGoal || '',
        previousSummaries: writerRawContext.contextParts.previousSummaries,
        continuityNotes: writerRawContext.contextParts.continuityNotes,
        openLoops: writerRawContext.contextParts.openLoops,
        dueForeshadows: writerRawContext.contextParts.dueForeshadows,
        chapterBridgePlan: writerRawContext.contextParts.chapterBridgePlan,
        stepMemorySummary: writerRawContext.contextParts.stepMemorySummary,
        timelineSummary: writerRawContext.contextParts.timelineSummary,
        timelineOpenThreads: writerRawContext.contextParts.timelineOpenThreads,
        activeThreads: writerRawContext.contextParts.activeThreads,
        worldStates: writerRawContext.contextParts.worldStates,
        relationSummary: writerRawContext.contextParts.relationSummary,
        dialogueVoiceLocks: writerRawContext.contextParts.dialogueVoiceLocks,
        genre: writerRawContext.profile.genre,
        worldRules: writerRawContext.contextParts.worldRules,
        backgroundText,
        glossaryTerms,
        historicalProfileJson: writerRawContext.novel.historicalProfileJson || '',
        projectCanonProfileJson: writerRawContext.novel.projectCanonProfileJson || '',
        canonConstraintSetJson: writerRawContext.novel.canonConstraintSetJson || '',
        sourceLedgerJson: writerRawContext.novel.sourceLedgerJson || '',
        canonSourceLedgerJson: writerRawContext.novel.canonSourceLedgerJson || '',
        canonFactCardsJson: writerRawContext.novel.canonFactCardsJson || '',
        mentionedCharacters: writerRawContext.mentionedCharacters,
        mentionedItems: writerRawContext.mentionedItems,
        mentionedLocations: writerRawContext.mentionedLocations,
        mentionedFactions: writerRawContext.mentionedFactions,
      },
      baseContextParts: {
        characterStates: writerRawContext.contextParts.characterStates,
        worldStates: writerRawContext.contextParts.worldStates,
        mapSummary: writerRawContext.contextParts.mapSummary,
        itemSummary: writerRawContext.contextParts.itemSummary,
        continuityNotes: writerRawContext.contextParts.continuityNotes,
        timelineSummary: writerRawContext.contextParts.timelineSummary,
        timelineOpenThreads: writerRawContext.contextParts.timelineOpenThreads,
        longTermMemory: writerRawContext.contextParts.longTermMemory,
        activeThreads: writerRawContext.contextParts.activeThreads,
        openLoops: writerRawContext.contextParts.openLoops,
        dueForeshadows: writerRawContext.contextParts.dueForeshadows,
        chapterBridgePlan: writerRawContext.contextParts.chapterBridgePlan,
        stepMemorySummary: writerRawContext.contextParts.stepMemorySummary,
        relationSummary: writerRawContext.contextParts.relationSummary,
        dialogueVoiceLocks: writerRawContext.contextParts.dialogueVoiceLocks,
        worldRules: writerRawContext.contextParts.worldRules,
        recalledMemory: writerRawContext.contextParts.recalledMemory,
      },
      frozenRecall: {
        recalledMemory: writerRawContext.contextParts.recalledMemory,
        recallSnapshot: writerRawContext.recallSnapshot,
        recallDiagnostics: writerRawContext.recallDiagnostics,
        recalledMemorySources: writerRawContext.recalledMemorySources,
      },
      invalidation: {
        chapterContextVersion: chapter.contextVersion || 1,
        novelContextVersion: writerRawContext.novel.contextVersion || 1,
        assetFingerprint: contractVersion || '',
        cacheSalt: [
          [...(activePromptOverrideKeys || [])].sort().join('|'),
          getActiveChapterPromptOverrideFingerprint(),
          sourceGrounding.updated ? sourceGrounding.recordedAt || '' : '',
        ].filter(Boolean).join('|'),
        stage: 'draft',
        executionMode: executionMode || 'default',
        preserveConstraintLabels: [...(preserveConstraintLabels || [])].sort(),
      },
      runtime: resolveWriterRuntimeOptions(writerRawContext),
    })
    return {
      writerContextResolution,
      effectiveRawContext: applyWriterContextOverridesToRawContext(
        writerRawContext,
        writerContextResolution.renderedContextOverrides as Partial<ChapterContext>,
      ),
    }
  } catch (error) {
    return {
      effectiveRawContext: rawContext,
      writerContextResolution: buildLegacyFallbackWriterContextResolution(
        chapter,
        rawContext,
        contractVersion,
        activePromptOverrideKeys,
        error,
      ),
    }
  }
}

export async function resolveStageContextForPipeline(
  stage: ChapterContextStage,
  chapter: typeof chapters.$inferSelect,
  rawContext: ChapterRawContext,
  complexity: ChapterComplexity,
  options: {
    executionMode?: AiExecutionMode
    preserveConstraintLabels?: HardConstraintSourceLabel[]
    contractVersion?: string
    activePromptOverrideKeys?: string[]
    totalBudget?: number
    upstreamArtifacts?: UpstreamRuntimeArtifacts
  } = {},
): Promise<StageContextResolverPayload> {
  const renderSchema = buildStageRenderSchema(stage)
  const upstreamArtifacts = options.upstreamArtifacts || {}
  const effectiveRawContext = applyUpstreamArtifactsToRawContext(rawContext, upstreamArtifacts)
  if (stage === 'draft') {
    const writerPayload = await resolveWriterContextForStage(
      chapter,
      effectiveRawContext,
      options.executionMode,
      options.preserveConstraintLabels,
      options.contractVersion,
      options.activePromptOverrideKeys,
    )
    const draftResolution = allocateDraftContextWithWriterFallback(
      chapter,
      effectiveRawContext,
      writerPayload.effectiveRawContext,
      complexity,
      writerPayload.writerContextResolution,
      options.preserveConstraintLabels,
    )
    return {
      stage,
      context: draftResolution.draftContext,
      effectiveRawContext: draftResolution.effectiveRawContext,
      upstreamArtifacts,
      renderSchema,
      writerContextResolution: draftResolution.writerContextResolution,
    }
  }
  return {
    stage,
    context: allocateStageContextForPipeline(
      effectiveRawContext,
      chapter,
      complexity,
      stage,
      options.totalBudget,
      options.preserveConstraintLabels,
    ),
    effectiveRawContext,
    upstreamArtifacts,
    renderSchema,
  }
}

export interface PreparedChapterPipelineStageContexts {
  activePromptOverrideKeys: string[]
  complexity: ChapterComplexity
  scenePlanResolution: StageContextResolverPayload
  draftResolution: StageContextResolverPayload
  scenePlanContext: ChapterContext
  draftContext: ChapterContext
  reviewContext: ChapterContext
  rewriteContext: ChapterContext
  contextVersion: number
}

export interface ChapterPipelinePromptGuidanceBundle {
  draftWritingGuidance: string
  chapterBridgePlan: ReturnType<typeof buildChapterBridgePlan>
  chapterBridgePlanText: string
  plannerNarrativeFields: ChapterPromptNarrativeFields
  draftNarrativeFields: ChapterPromptNarrativeFields
  sharedPromptGuidance: ChapterPromptGuidance
  initialStepMemory: StepMemoryRuntimeState
  buildWritingGuidance(styleTemplate: string): string
  buildNarrativeFields(chapterGoal: string, content?: string, chapterFunction?: string): ChapterPromptNarrativeFields
  formatPacingGuidance(curve: ReturnType<typeof buildStoryPacingCurve>): string
}

function formatNarrativeControlFields(
  report: ReturnType<typeof analyzeNarrativeControls>,
): ChapterPromptNarrativeFields {
  const reportLine = (summary: string) => summary.trim() ? `当前检测：${summary.trim()}` : ''
  return {
    povGuidance: [
      report.promptGuidance.povGuidance,
      reportLine(report.pov.summary),
      report.pov.status !== 'pass' ? `修正方向：${report.pov.fixHint}` : '',
    ].filter(Boolean).join('\n'),
    sensoryGuidance: [
      report.promptGuidance.sensoryGuidance,
      reportLine(report.sensory.summary),
      report.sensory.status !== 'pass' ? `修正方向：${report.sensory.fixHint}` : '',
    ].filter(Boolean).join('\n'),
    narrativeRatioGuidance: [
      report.promptGuidance.narrativeRatioGuidance,
      reportLine(report.narrativeRatio.summary),
      report.narrativeRatio.deviationReasons.length > 0
        ? `当前偏移：${report.narrativeRatio.deviationReasons.slice(0, 3).join('；')}`
        : '',
      report.narrativeRatio.status !== 'pass' ? `修正方向：${report.narrativeRatio.fixHint}` : '',
      reportLine(report.transitionDensity.summary),
      report.transitionDensity.status !== 'pass' ? `过渡修正：${report.transitionDensity.fixHint}` : '',
      reportLine(report.emotionFocus.summary),
      report.emotionFocus.status !== 'pass' ? `情绪修正：${report.emotionFocus.fixHint}` : '',
      reportLine(report.exposition.summary),
      report.exposition.status !== 'pass' ? `说明修正：${report.exposition.fixHint}` : '',
    ].filter(Boolean).join('\n'),
  }
}

export function createChapterPipelinePromptGuidance(input: {
  chapter: typeof chapters.$inferSelect
  themeVoice: ThemeVoiceDocument
  narrativeSceneSnapshots: Parameters<typeof analyzeNarrativeControls>[0]['sceneSnapshots']
  narrativeControlCharacterNames: string[]
  narrativeContractSignals: { emotionFocus: string; expositionMode: string }
  genre: string
  consistencyNotes: string
  storyCore: string
  scenePlanContext: ChapterContext
  draftContext: ChapterContext
  contractVersion: string
}): ChapterPipelinePromptGuidanceBundle {
  const { chapter } = input
  const buildWritingGuidance = (styleTemplate: string) => [
    styleTemplate ? `Writing style guide:\n${styleTemplate}` : '',
    input.consistencyNotes,
  ].filter(Boolean).join('\n\n')
  const buildNarrativeFields = (chapterGoal: string, content?: string, chapterFunction?: string) => (
    formatNarrativeControlFields(analyzeNarrativeControls({
      themeVoice: input.themeVoice,
      sceneSnapshots: input.narrativeSceneSnapshots,
      characterNames: input.narrativeControlCharacterNames,
      content,
      chapterGoal,
      emotionTone: chapter.emotionTone || '平稳',
      emotionFocus: input.narrativeContractSignals.emotionFocus,
      expositionMode: input.narrativeContractSignals.expositionMode,
      chapterFunction,
      genre: input.genre,
    }))
  )
  const formatPacingGuidance = (curve: ReturnType<typeof buildStoryPacingCurve>) => [
    `目标节奏位：${curve.targetMarker}`,
    curve.actualMarker ? `当前节奏线索：${curve.actualMarker}` : '',
    curve.guidance,
    curve.recentClimaxSpacing.length > 0 ? `近期高潮间距：${curve.recentClimaxSpacing.join(' / ')}` : '',
    curve.warning || '',
  ].filter(Boolean).join('\n')
  const chapterBridgePlan = buildChapterBridgePlan(chapter.id, {
    themeVoice: input.themeVoice,
    chapterGoal: input.scenePlanContext.chapterGoal,
  })
  const chapterBridgePlanText = formatChapterBridgePlan(chapterBridgePlan)
  const povRotationPlan = buildPovRotationPlan(chapter.id, input.themeVoice)
  const basePacingCurve = buildStoryPacingCurve(chapter.novelId, chapter.chapterNum, chapter.emotionTone || '平稳')
  const hookContinuity = buildHookContinuitySnapshot(chapter.id)
  const expressionDedup = analyzeExpressionDedupForGeneration(chapter.novelId, chapter.chapterNum, {
    currentVolumeId: chapter.volumeId ?? null,
  })
  const summaryHealth = chapterBridgePlan?.sourceChapterId
    ? analyzeSummaryHealthForChapter(chapterBridgePlan.sourceChapterId)
    : null
  const voiceProfiles = buildVoiceEvolutionProfiles(chapter.novelId)
  const initialStepMemory = buildStepMemorySummary({
    chapterBridgePlan: chapterBridgePlanText,
    previousSummary: buildContractVersionArtifactSummary(input.contractVersion),
  })
  return {
    draftWritingGuidance: buildWritingGuidance(input.draftContext.styleTemplate),
    chapterBridgePlan,
    chapterBridgePlanText,
    plannerNarrativeFields: buildNarrativeFields(input.scenePlanContext.chapterGoal),
    draftNarrativeFields: buildNarrativeFields(input.draftContext.chapterGoal),
    sharedPromptGuidance: {
      povRotationGuidance: [
        povRotationPlan.recommendedPov ? `推荐 POV：${povRotationPlan.recommendedPov}` : '',
        povRotationPlan.previousPov ? `上一章 POV：${povRotationPlan.previousPov}` : '',
        povRotationPlan.reason,
        `信息差边界：${povRotationPlan.infoGapGuard}`,
        povRotationPlan.warnings.length > 0 ? `风险：${povRotationPlan.warnings.join('；')}` : '',
      ].filter(Boolean).join('\n'),
      storyPacingGuidance: formatPacingGuidance(basePacingCurve),
      hookContinuityGuidance: [
        hookContinuity.hookType ? `合同钩子：${hookContinuity.hookType}` : '当前章节合同尚未定义钩子类型。',
        hookContinuity.unresolvedHookChain.length > 0 ? `承接链：${hookContinuity.unresolvedHookChain.join('；')}` : '',
        hookContinuity.weakHookStreak > 0 ? `连续弱钩子：${hookContinuity.weakHookStreak} 章` : '',
        hookContinuity.warning || '',
      ].filter(Boolean).join('\n'),
      expressionDedupGuidance: formatExpressionDedupGuidance(expressionDedup),
      summaryHealthGuidance: summaryHealth
        ? [
            `摘要健康：${summaryHealth.status}`,
            `密度 ${summaryHealth.densityScore} / 实体覆盖 ${summaryHealth.entityCoverageScore} / 事件覆盖 ${summaryHealth.eventCoverageScore}`,
            summaryHealth.warnings.join('；'),
          ].filter(Boolean).join('\n')
        : '',
      voiceEvolutionGuidance: voiceProfiles.length > 0
        ? voiceProfiles.slice(0, 3).map((profile) => [
            `${profile.characterName}：${profile.summary}`,
            profile.stableAnchors.length > 0 ? `稳定锚点：${profile.stableAnchors.join('；')}` : '',
            profile.allowedChanges.length > 0 ? `允许变化：${profile.allowedChanges.join('；')}` : '',
          ].filter(Boolean).join('\n')).join('\n\n')
        : '',
    },
    initialStepMemory,
    buildWritingGuidance,
    buildNarrativeFields,
    formatPacingGuidance,
  }
}

export async function prepareChapterPipelineStageContexts(
  chapter: typeof chapters.$inferSelect,
  rawContext: ChapterRawContext,
  options: {
    executionMode: AiExecutionMode
    preserveConstraintLabels?: HardConstraintSourceLabel[]
    contractVersion?: string
  },
): Promise<PreparedChapterPipelineStageContexts> {
  const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
  const complexity = classifyChapterComplexity({
    chapter,
    currentArc: rawContext.currentArc,
    chapterRows: rawContext.chapterRows,
    outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
    activeThreadPressureCount: rawContext.activeThreadPressureCount,
  })
  const sharedOptions = {
    executionMode: options.executionMode,
    preserveConstraintLabels: options.preserveConstraintLabels,
    contractVersion: options.contractVersion,
    activePromptOverrideKeys,
  }
  const scenePlanResolution = await resolveStageContextForPipeline(
    'scenePlan',
    chapter,
    rawContext,
    complexity,
    {
      ...sharedOptions,
      upstreamArtifacts: {
        contractVersionSummary: buildContractVersionArtifactSummary(options.contractVersion),
      },
    },
  )
  const draftResolution = await resolveStageContextForPipeline(
    'draft',
    chapter,
    rawContext,
    complexity,
    sharedOptions,
  )
  const downstreamRawContext = draftResolution.effectiveRawContext
  const downstreamOptions = {
    ...sharedOptions,
    upstreamArtifacts: {
      contractVersionSummary: buildContractVersionArtifactSummary(options.contractVersion),
    },
  }
  const reviewResolution = await resolveStageContextForPipeline(
    'review',
    chapter,
    downstreamRawContext,
    complexity,
    downstreamOptions,
  )
  const rewriteResolution = await resolveStageContextForPipeline(
    'rewrite',
    chapter,
    downstreamRawContext,
    complexity,
    downstreamOptions,
  )
  return {
    activePromptOverrideKeys,
    complexity,
    scenePlanResolution,
    draftResolution,
    scenePlanContext: scenePlanResolution.context,
    draftContext: draftResolution.context,
    reviewContext: reviewResolution.context,
    rewriteContext: rewriteResolution.context,
    contextVersion: downstreamRawContext.novel.contextVersion || 1,
  }
}

export function buildStageContextMap(
  rawContext: ChapterRawContext,
  chapter: typeof chapters.$inferSelect,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
  draftRawContext?: ChapterRawContext,
): {
  complexity: ChapterComplexity
  contexts: Record<ChapterContextStage, ChapterContext>
} {
  const complexity = classifyChapterComplexity({
    chapter,
    currentArc: rawContext.currentArc,
    chapterRows: rawContext.chapterRows,
    outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
    activeThreadPressureCount: rawContext.activeThreadPressureCount,
  })
  return {
    complexity,
    contexts: {
      scenePlan: allocateStageContextForPipeline(rawContext, chapter, complexity, 'scenePlan', undefined, preserveConstraintLabels),
      draft: allocateStageContextForPipeline(draftRawContext || rawContext, chapter, complexity, 'draft', undefined, preserveConstraintLabels),
      review: allocateStageContextForPipeline(rawContext, chapter, complexity, 'review', undefined, preserveConstraintLabels),
      rewrite: allocateStageContextForPipeline(rawContext, chapter, complexity, 'rewrite', undefined, preserveConstraintLabels),
    },
  }
}
