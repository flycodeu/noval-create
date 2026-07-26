import { WebContents } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapterContracts, chapterSegments, chapterVersions, chapters, characters, glossary, genres, novels, revisionTasks, sceneContracts, storyArcs, storyItems, storyMemoryCheckpoints, storyParts, storyThreads, storyVolumes, tasks, timelineEvents, worldMap } from '../database/schema'
import { parseAiJsonResult } from '../utils/json'
import { cleanAiFieldText } from '../../src/utils/text'
import { generateChapterEmbeddings } from './embedding.service'
import { aiCheckPrompt, chapterSummaryPrompt } from './prompts'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { assessHistoricalGrounding } from '../../src/shared/genre-system'
import { countUnresolvedTypedRefs, hasTypedRefOverlay } from '../../src/shared/typed-ref'
import { getOperatingModeRuntimePolicy, getRecommendedChapterWordsForOperatingMode } from '../../src/shared/operating-mode'
import type { HumanizationSignal } from '../../src/types'
import {
  allocateChapterContext,
  buildChapterContext,
  buildWritingContextUsageSnapshot,
  ChapterContext,
  ContextOverflowError,
  buildStoryProfile,
  collectChapterContextRawData,
  ContinuityState,
  HardConstraintOverflowError,
  resolveMentionedEntityLimits,
  type HardConstraintSourceLabel,
} from './context.service'
import {
  buildChapterDraftPrompt,
  buildChapterWritingPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildContinuityStatePrompt,
  buildScenePlanPrompt,
} from './story-prompts'
import { getQualityDashboardData } from './quality-dashboard.service'
import { syncNovelLifecycleStatus } from './novel-lifecycle.service'
import { buildChapterGenerationRequestKey, isRetryableChapterGenerationStatus } from './chapter-generation-idempotency'
import {
  createTask,
  executeChatTask,
  executeStreamTask,
  getTaskRecord,
  isTransientModelNetworkError,
  parseTaskControl,
  runChatTask,
  TaskRecoveryHint,
  updateTask,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import type { Message } from '../adapters/base.adapter'
import { buildConsistencyPromptSummary, buildNovelConsistencyReport } from './consistency.service'
import { syncChapterTimelineStatuses } from './link-sync.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  collectQualityGuardrailFindings,
  formatQualityGuardrailSummary,
  hasBlockingGuardrailFindings,
  shouldForceRepair,
} from '../../src/shared/content-guardrails'
import {
  buildChapterOptimizationQualityGate,
  buildChapterStructuralRepairGate,
  escapeRegExp,
} from '../../src/shared/chapter-optimization-quality'
import {
  markChapterContextCurrent,
  markNovelContextChanged,
  markSubsequentChaptersStale,
  getChapterContractBlockers,
  runChapterPublishCheck,
  validateChapterContractsForGeneration,
} from './context-impact.service'
import {
  normalizeChapterContractValidationResult,
  validateChapterContractDelivery,
} from './chapter-contract-validator.service'
import {
  isContractValidationBlockerVerdict,
  isHardContractValidationItem,
} from '../../src/shared/contract-validation'
import { refreshStoryMemoryCheckpoints } from './story-memory.service'
import {
  ensureStoryStructure,
  resolveDefaultStructure,
  syncChapterToSegments,
} from './story-structure.service'
import { syncTimelineStructureAnchors } from './timeline.service'
import { discoverEntitiesFromContent } from './entity-discovery.service'
import { prepareChapterWritebackRun, prepareChapterWritebackRunWithRetry } from './chapter-writeback.service'
import { buildBatchKey, captureTimelineAnchorsForChapterIds, createOperationLog } from './history.service'
import { listActiveImpactsForChapter } from './asset-impact.service'
import { enhanceAiScoreResult, toChapterAiCheckResult } from './ai-score.service'
import {
  analyzeChapterDialogueAgainstNovel,
  scheduleDialogueFingerprintRefresh,
} from './dialogue-fingerprint.service'
import {
  buildChapterBridgePlan,
  buildHookContinuitySnapshot,
  buildPovRotationPlan,
  buildStoryPacingCurve,
  buildVoiceEvolutionProfiles,
  formatChapterBridgePlan,
} from './generation-integrity.service'
import {
  analyzeExpressionDedupForChapter,
  analyzeExpressionDedupForGeneration,
  formatExpressionDedupGuidance,
} from './expression-dedup.service'
import { analyzeSummaryHealthForChapter, refreshSummaryHealthSemantic } from './summary-decay.service'
import { analyzeNovelStyleCompliance } from './style-compliance.service'
import {
  analyzeNarrativeControls,
  type NarrativeControlSceneSnapshot,
} from './narrative-control.service'
import { analyzeWorkspaceAiFlavor } from './workspace-quality.service'
import {
  buildAiExplainabilityReport,
  buildAiModelRouteReport,
  buildAiStageExecutionReport,
  buildAuthorStyleLockSummary,
  buildChatOptionsFromRoute,
  resolveAiExecutionMode,
} from './ai-engine.service'
import { refreshCharacterStateVersionsForChapter } from './character-state.service'
import { syncCharacterArcsFromChapterState } from './character-arc.service'
import {
  refreshWorldStateVersionsForChapter,
  refreshWorldStateVersionsForNovel,
  refreshWorldStateVersionsFromChapter,
} from './world-state.service'
import {
  remapChapterNumberReferences,
  deleteChapterSegmentsCascade,
} from './data-cascade.service'
import {
  formatStoryArcCheckpointReminder,
  formatStoryArcProgressStatus,
  getStoryArcProgressSnapshot,
  getStoryArcStatusContext,
  getStoryArcWarningsForChapter,
} from './story-arc-progress.service'
import { persistChapterRecallRuntimeSnapshot } from './chapter-recall-runtime.service'
import { persistAntiAiRuleHits } from './anti-ai-rule.service'
import { syncFeedbackRecurrenceState } from './feedback-recurrence.service'
import {
  reconcileScenePlanForContracts,
  type SceneContractSeed,
} from './scene-plan-reconciliation'
import {
  analyzeChapterReadingExperience,
  buildAdaptiveRewritePolicy,
  buildDialogueRepairDirective,
  buildReviewPriorityPrompt,
  buildReviewPrioritySummary,
  buildRewriteMiniReviewVerdict,
  buildStructuralRepairDirective,
  type ChapterReadingExperienceScore,
  type RewriteDeltaChainScore,
  type RewriteMiniReviewVerdict,
  type RewriteNarrativeDeltaReport,
} from './chapter-pipeline-policy.service'
import { listPromptOverrides } from './prompt-override.service'
import {
  buildVariationDigest,
  isCandidateTooSimilar,
} from './variation-control.service'
import { resolveWriterOrchestratedContext } from './writer-context-orchestrator.service'
import { enrichSourceGroundingFromWeb } from './source-grounding-search.service'
import type {
  AiContextAssemblyReport,
  AiExecutionMode,
  AiExplainabilityReport,
  AiStageExecutionReport,
  AuthorStyleLockSummary,
  ChapterBridgePlan,
  ChapterOptimizeResult,
  ChapterRewriteScope,
  ChapterContractValidationResult,
  ExpressionDedupReport,
  HookContinuitySnapshot,
  PovRotationPlan,
  StoryPacingCurve,
  StyleComplianceMetricSnapshot,
  StyleComplianceResult,
  SummaryHealthReport,
  StageRenderSchema,
  UpstreamRuntimeArtifacts,
  VoiceEvolutionProfile,
  WriterContextOrchestratorRuntimeOptions,
  WriterContextOrchestratorResolution,
} from '../../src/types'
import {
  appendRevisionBrief,
  applyContractValidationToReviewNotes,
  applyDialogueAnalysisToReviewNotes,
  applyHistoricalGroundingToReviewNotes,
  applyHumanizationAnalysisToReviewNotes,
  applyLongWindowQualitySignalsToReviewNotes,
  applyProvenanceAndOperatingModeToReviewNotes,
  applyReadingExperienceToReviewNotes,
  applyRewriteDeltaToReviewNotes,
  applyStyleComplianceToReviewNotes,
  applyWordShapeObservation,
  asText,
  buildFallbackReviewNotes,
  buildGuardrailCriticalFixes,
  buildStructuralAlertsSummary,
  buildTitleMismatchRisk,
  buildTypedRefRiskSummary,
  countNarrativeWords,
  dedupeTextList,
  enhanceReviewNotesWithGuardrails,
  findingSeverityToReviewSeverity,
  formatReviewNotes,
  hasReviewNotes,
  HUMANIZATION_REVIEW_SIGNAL_TYPES,
  HUMANIZATION_SIGNAL_TYPES,
  loadNarrativeContractSignals,
  loadNarrativeControlSceneSnapshots,
  mergeSeverity,
  normalizeBoolean,
  normalizeBoundedMetric,
  normalizeBoundedNumber,
  normalizeChapterFunctionTag,
  normalizeChapterFunctionTags,
  normalizeCostResolutionState,
  normalizePaceMarker,
  normalizeProtagonistSetback,
  normalizeReadingExperience,
  normalizeReversalSupportState,
  normalizeReviewNotes,
  normalizeReviewSeverity,
  normalizeRewardState,
  normalizeRewriteDelta,
  normalizeRewriteDeltaChain,
  normalizeStyleComplianceMetrics,
  normalizeStyleComplianceResult,
  normalizeStyleComplianceStatus,
  parseStoredReviewNotes,
  replacePrefixedNotes,
  STYLE_COMPLIANCE_FIX_PREFIX,
  STYLE_COMPLIANCE_RISK_PREFIX,
  applyCriticSemanticGateOutcomeToReviewNotes,
  collectSemanticGateHeuristicHints,
  formatSemanticGateBlockerFix,
  stripChapterHeadingNoise,
  toNumberArray,
  toStringArray,
} from './chapter-review-notes'
import {
  SEMANTIC_GATE_DIMENSION_SPECS,
  collectBlockerDimensions,
  type SemanticGateReview,
} from '../../src/shared/semantic-gate'
import {
  CORE_SEMANTIC_GATE_DIMENSIONS,
  resolveSemanticGatePolicy,
} from '../../src/shared/semantic-gate-policy'
import { runChapterSemanticGate } from './semantic-gate/semantic-gate-runner.service'
import {
  buildFallbackScenePlan,
  extractChapterGoal,
  formatScenePlan,
  getDefaultChapterTitle,
  loadScenePlanContractSeeds,
  normalizeScenePlan,
  type ScenePlanStep,
} from './chapter-scene-plan'
import {
  chooseBetterGuardrailCandidate,
  chooseBetterRepairCandidate,
  guardrailRepairScore,
  judgeRepairOutcome,
  rewriteMiniReviewScore,
  rewriteOutcomeScore,
} from './chapter-repair-loop'
import {
  buildChapterOptimizationFactGuard,
  buildChapterOptimizationPrompt,
  buildNarrativeGuardContext,
  collectNarrativeStateWarnings,
  collectSupportingCastNames,
  collectTrackedEntityNames,
  collectUnsupportedNarrativeFactWarnings,
  extractNarrativeNumbers,
  findTrackedNamesInText,
  MAX_STRUCTURAL_REPAIR_EXPANSION_RATIO,
  normalizeOptimizedChapterContent,
  textOverlapRatio,
  uniqueNonEmpty,
} from './chapter-optimization-guards'
import type {
  ChapterFunctionTag,
  ChapterPacingMarker,
  ChapterReviewNotes,
  CostResolutionState,
  ProtagonistSetbackLevel,
  ReversalSupportState,
  ReviewSeverity,
  RewardState,
} from './chapter-review-notes'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

function resolveChapterReferenceWords(chapterWords?: number | null, novelWords?: number | null): number {
  const explicit = typeof chapterWords === 'number' && Number.isFinite(chapterWords) && chapterWords > 0
    ? Math.round(chapterWords)
    : 0
  return explicit || getRecommendedChapterWordsForOperatingMode({ targetWords: novelWords })
}

type ChapterPipelineRole = 'planner' | 'writer' | 'critic' | 'rewriter' | 'canonizer' | 'finalize'
type ChapterPipelineRoleStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked'
type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'canonizing' | 'completed' | 'failed'
type ChapterPipelineFailureCode =
  | 'contract_blocked'
  | 'context_overflow'
  | 'empty_output'
  | 'anti_ai_failed'
  | 'gate_rewrite_required'
  | 'canon_pending'
  | 'canon_failed'
  | 'human_review_required'

interface ChapterPipelineRoleState {
  role: ChapterPipelineRole
  label: string
  summary: string
  status: ChapterPipelineRoleStatus
  detail?: string
  taskId?: number
  upstreamTaskId?: number
  contractVersion?: string
  canonRunId?: number
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  tokensUsed?: number
  recoveryHint?: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
}

interface StepMemoryRuntimeState {
  summary: string
  runtimeAssertions: string[]
}

interface ChapterPipelineSnapshot {
  kind: 'chapter_pipeline'
  chapterId: number
  workflowTaskId: number
  currentRole: ChapterPipelineRole | null
  currentStage: ChapterGenerationStage | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  message?: string
  streamTaskId?: number
  executionMode?: AiExecutionMode
  contractVersion?: string
  canonRunId?: number
  totalTokensUsed: number
  totalDurationMs: number
  recallSnapshot?: ChapterContext['recallSnapshot']
  recallDiagnostics?: ChapterContext['recallDiagnostics']
  contextAssemblyReport?: AiContextAssemblyReport
  authorStyleLock?: AuthorStyleLockSummary
  generationExplainability?: AiExplainabilityReport
  writerContextResolution?: WriterContextOrchestratorResolution
  stepMemory?: StepMemoryRuntimeState
  recoveryHint?: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  lastFailureRole?: ChapterPipelineRole
  partialContent?: string
  resumeReason?: 'failed' | 'cancelled' | 'timeout' | 'network' | 'unknown'
  resumeSourceTaskId?: number
  roles: Record<ChapterPipelineRole, ChapterPipelineRoleState>
}

interface ChapterGenerationProgressEvent {
  chapterId: number
  taskId?: number
  streamTaskId?: number
  role?: ChapterPipelineRole
  stage: ChapterGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed' | 'cancelled'
  pipeline?: ChapterPipelineSnapshot
}

class ChapterPipelineStageError extends Error {
  code: ChapterPipelineFailureCode
  blocked: boolean
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  outputText?: string

  constructor(
    code: ChapterPipelineFailureCode,
    message: string,
    options: {
      blocked?: boolean
      rewriteScope?: ChapterRewriteScope
      targetSegmentId?: number | null
      outputText?: string
      cause?: unknown
    } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.name = 'ChapterPipelineStageError'
    this.code = code
    this.blocked = Boolean(options.blocked)
    this.rewriteScope = options.rewriteScope
    this.targetSegmentId = options.targetSegmentId
    this.outputText = options.outputText
  }
}

interface LockedParagraphContext {
  lockedParagraphs: string[]
  promptDraftContent: string
  initialFallbackContent: string
}

export type ChapterVersionSource =
  | 'manual-save'
  | 'ai-rewrite'
  | 'pipeline-generate'
  | 'version-restore'

const EMPTY_CONTINUITY_STATE: ContinuityState = {
  plotProgress: [],
  characterStateChanges: [],
  worldStateChanges: [],
  openLoops: [],
  continuityNotes: [],
  arcProgress: '',
}

const MAX_CHAPTER_VERSION_COUNT = 20

function countChineseWords(text: string): number {
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const english = (text.match(/\b[a-zA-Z]+\b/g) || []).length
  const numbers = (text.match(/\d+/g) || []).length
  return chinese + english + numbers
}

function normalizeChapterVersionSource(
  value?: ChapterVersionSource | false,
): ChapterVersionSource | null {
  if (value === false) return null
  if (value === 'ai-rewrite' || value === 'pipeline-generate' || value === 'version-restore') {
    return value
  }
  return 'manual-save'
}

function createChapterVersionSnapshot(chapterId: number, source: ChapterVersionSource) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null

  const content = typeof chapter.content === 'string' ? chapter.content : ''
  if (!content.trim()) return null

  const latest = db.select().from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()[0]
  if (latest?.content === content) {
    return latest
  }

  const result = db.insert(chapterVersions).values({
    novelId: chapter.novelId,
    chapterId,
    versionSource: source,
    content,
    wordCount: chapter.wordCount || countChineseWords(content),
  }).run()

  const versionIds = db.select({ id: chapterVersions.id }).from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()
    .map((row) => row.id)
  const staleIds = versionIds.slice(MAX_CHAPTER_VERSION_COUNT)
  if (staleIds.length > 0) {
    db.delete(chapterVersions).where(inArray(chapterVersions.id, staleIds)).run()
  }

  return Number(result.lastInsertRowid)
}

function contentReportLine(summary: string): string {
  return summary ? `当前检测：${summary}` : ''
}

function serializeContinuityState(state: ContinuityState): string {
  return JSON.stringify({
    plot_progress: state.plotProgress,
    character_state_changes: state.characterStateChanges,
    world_state_changes: state.worldStateChanges,
    open_loops: state.openLoops,
    continuity_notes: state.continuityNotes,
    arc_progress: state.arcProgress,
  })
}

function sendGenerationProgress(
  sender: WebContents | undefined,
  payload: ChapterGenerationProgressEvent,
) {
  if (sender && !sender.isDestroyed()) {
    sender.send('chapter:generation-progress', payload)
  }
}

function buildChapterWorkspacePath(novelId: number, page: string, chapterId: number, extra?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams({ chapterId: String(chapterId) })
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    params.set(key, String(value))
  })
  return `/novels/${novelId}/${page}?${params.toString()}`
}

function buildChapterPipelineRecoveryHint(
  novelId: number,
  chapterId: number,
  role: ChapterPipelineRole,
  failureCode?: ChapterPipelineFailureCode,
): TaskRecoveryHint {
  if (
    failureCode === 'context_overflow'
    || failureCode === 'empty_output'
    || failureCode === 'anti_ai_failed'
    || failureCode === 'gate_rewrite_required'
    || failureCode === 'human_review_required'
  ) {
    return {
      kind: 'resume',
      label: '继续章节流水线',
      description: '从当前失败阶段重新拉起整条章节流水线，并重新读取最新合同、上下文版本和锁定段落。',
    }
  }

  if (failureCode === 'contract_blocked') {
    return {
      kind: 'open_page',
      label: '重跑章节合同',
      description: '打开章节合同页，先修正合同或场景约束，再重新启动正文流水线。',
      path: buildChapterWorkspacePath(novelId, 'contracts', chapterId),
    }
  }

  if (failureCode === 'canon_failed' || failureCode === 'canon_pending') {
    return {
      kind: 'open_page',
      label: '重做 Canon 回写',
      description: '打开章后状态回写中心，检查 Canon 候选并重新生成或处理失败项。',
      path: buildChapterWorkspacePath(novelId, 'writeback', chapterId),
    }
  }

  switch (role) {
    case 'planner':
      return {
        kind: 'open_page',
        label: '重跑章节合同',
        description: '打开章节合同页，先修正合同或场景约束，再重新启动正文流水线。',
        path: buildChapterWorkspacePath(novelId, 'contracts', chapterId),
      }
    case 'canonizer':
      return {
        kind: 'open_page',
        label: '重做 Canon 回写',
        description: '打开章后状态回写中心，检查 Canon 候选并重新生成或处理失败项。',
        path: buildChapterWorkspacePath(novelId, 'writeback', chapterId),
      }
    case 'critic':
      return {
        kind: 'open_page',
        label: '回到审校视图',
        description: '返回正文写作页，重点检查审校建议、验收门和当前章节风险。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId, { insight: 'review' }),
      }
    case 'finalize':
      return {
        kind: 'open_page',
        label: '回到写作页复核',
        description: '返回正文写作页，重新检查章节内容、摘要与连续性状态，再重新运行流水线。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId),
      }
    case 'writer':
    case 'rewriter':
    default:
      return {
        kind: 'open_page',
        label: '重写正文',
        description: '返回正文写作页，调整当前章节内容或提示后重新启动流水线。',
        path: buildChapterWorkspacePath(novelId, 'writing', chapterId),
      }
  }
}

function serializeTaskRecoveryHint(hint?: TaskRecoveryHint): string | undefined {
  return hint ? JSON.stringify(hint) : undefined
}

function inferResumeReason(error: unknown): ChapterPipelineSnapshot['resumeReason'] {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('cancel')) return 'cancelled'
  if (message.includes('timeout') || message.includes('time out')) return 'timeout'
  if (
    message.includes('network')
    || message.includes('socket')
    || message.includes('econn')
    || message.includes('fetch failed')
  ) {
    return 'network'
  }
  return 'failed'
}

function buildContinuationPrompt(basePrompt: string, partialContent: string): string {
  const normalized = partialContent.trim()
  if (!normalized) return basePrompt
  return [
    basePrompt,
    '【续写要求】',
    '下面这段正文是当前章节已经生成并保留的部分。你必须把它视为已确认内容，只能从末尾继续向后写，不要重写、改写、总结或重复前文。',
    '如果前文已经完成了某个场景，就直接承接最后一个有效动作、情绪或冲突点继续推进。',
    '继续写到本章自然收束，仍然要满足本章目标、合同约束、人物状态、世界规则和时间线要求。',
    '【已保留正文】',
    normalized,
  ].join('\n\n')
}

function buildPipelineFailureOutput(
  code: ChapterPipelineFailureCode,
  detail: string,
  options: {
    rewriteScope?: ChapterRewriteScope
    targetSegmentId?: number | null
  } = {},
) {
  const scopeText = options.rewriteScope ? `rewrite_scope: ${options.rewriteScope}` : ''
  const segmentText = typeof options.targetSegmentId === 'number' ? `target_segment_id: ${options.targetSegmentId}` : ''
  return [
    `exit_code: ${code}`,
    `detail: ${detail}`,
    scopeText,
    segmentText,
  ].filter(Boolean).join('\n')
}

function getPublishCheckRewriteFailureMeta(publishCheck: ReturnType<typeof runChapterPublishCheck>): {
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

function classifyChapterPipelineFailure(
  role: ChapterPipelineRole,
  error: unknown,
): {
  code?: ChapterPipelineFailureCode
  blocked: boolean
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  outputText?: string
} {
  if (error instanceof ChapterPipelineStageError) {
    return {
      code: error.code,
      blocked: error.blocked,
      rewriteScope: error.rewriteScope,
      targetSegmentId: error.targetSegmentId,
      outputText: error.outputText,
    }
  }

  if (error instanceof HardConstraintOverflowError || error instanceof ContextOverflowError) {
    const detail = error.message || '上下文超预算，无法完整注入本章硬约束。'
    return {
      code: 'context_overflow',
      blocked: true,
      outputText: buildPipelineFailureOutput('context_overflow', detail),
    }
  }

  const detail = error instanceof Error ? error.message : ''
  if (/合同校验未通过|章节合同|场景合同|缺少章节合同摘要|缺少 Planner 产出的场景计划/u.test(detail)) {
    return {
      code: 'contract_blocked',
      blocked: true,
      rewriteScope: 'contract_replan',
      outputText: buildPipelineFailureOutput('contract_blocked', detail, { rewriteScope: 'contract_replan' }),
    }
  }

  if (/Canon/u.test(detail) || role === 'canonizer') {
    return {
      code: 'canon_failed',
      blocked: true,
      outputText: buildPipelineFailureOutput('canon_failed', detail || 'Canon 草案生成失败。'),
    }
  }

  return {
    blocked: false,
  }
}

function getPipelineRoleLabel(role: ChapterPipelineRole): string {
  switch (role) {
    case 'planner':
      return 'Planner'
    case 'writer':
      return 'Writer'
    case 'critic':
      return 'Critic'
    case 'rewriter':
      return 'Rewriter'
    case 'canonizer':
      return 'Canonizer'
    case 'finalize':
      return 'Finalize'
    default:
      return role
  }
}

function getPipelineRoleSummary(role: ChapterPipelineRole): string {
  switch (role) {
    case 'planner':
      return '固化章节合同与场景执行链。'
    case 'writer':
      return '只按合同与场景计划写正文。'
    case 'critic':
      return '检查连续性、节奏、口吻与 AI 味。'
    case 'rewriter':
      return '按审校结论修正文稿。'
    case 'canonizer':
      return '把正文变成可确认的 Canon 差异草案。'
    case 'finalize':
      return '刷新摘要、连续性与记忆写回。'
    default:
      return ''
  }
}

function getPipelineRoleStage(role: ChapterPipelineRole): ChapterGenerationStage {
  switch (role) {
    case 'planner':
      return 'planning'
    case 'writer':
      return 'drafting'
    case 'critic':
      return 'reviewing'
    case 'rewriter':
      return 'rewriting'
    case 'canonizer':
      return 'canonizing'
    case 'finalize':
      return 'canonizing'
    default:
      return 'planning'
  }
}

function createPipelineRoleState(role: ChapterPipelineRole): ChapterPipelineRoleState {
  return {
    role,
    label: getPipelineRoleLabel(role),
    summary: getPipelineRoleSummary(role),
    status: 'pending',
  }
}

function createInitialChapterPipelineSnapshot(
  chapterId: number,
  workflowTaskId: number,
  contractVersion?: string,
): ChapterPipelineSnapshot {
  return {
    kind: 'chapter_pipeline',
    chapterId,
    workflowTaskId,
    currentRole: null,
    currentStage: 'planning',
    status: 'pending',
    contractVersion,
    totalTokensUsed: 0,
    totalDurationMs: 0,
    stepMemory: {
      summary: '',
      runtimeAssertions: [],
    },
    roles: {
      planner: createPipelineRoleState('planner'),
      writer: createPipelineRoleState('writer'),
      critic: createPipelineRoleState('critic'),
      rewriter: createPipelineRoleState('rewriter'),
      canonizer: createPipelineRoleState('canonizer'),
      finalize: createPipelineRoleState('finalize'),
    },
  }
}

function buildChapterContextAssemblyReport(
  context: Pick<ChapterContext, 'recalledMemorySources' | 'recallDiagnostics' | 'recallSnapshot' | 'timelineSummary' | 'timelineOpenThreads' | 'chapterBridgePlan' | 'hardConstraintEntries'>,
  usageSnapshot: import('../../src/types').WritingContextUsageSnapshot,
): AiContextAssemblyReport {
  const graphItems = usageSnapshot.usedAssets.length
  const timelineItems = [
    context.timelineSummary,
    context.timelineOpenThreads,
    ...usageSnapshot.recentStateChanges,
  ].filter(Boolean).length
  const bridgeItems = context.chapterBridgePlan
    ? context.chapterBridgePlan.split('\n').map((line) => line.trim()).filter(Boolean).length
    : 0
  const contractItems = usageSnapshot.usedContracts.length + context.hardConstraintEntries.length

  return {
    assemblyVersion: 'v2-unified',
    summary: `统一上下文组装器已合并资产图谱、时间线索、章节衔接与合同硬约束，本章共装配 ${graphItems + timelineItems + bridgeItems + contractItems} 个有效上下文入口。`,
    layers: [
      {
        key: 'graph_recall',
        label: '图谱召回',
        itemCount: graphItems,
        summary: graphItems > 0
          ? `命中 ${graphItems} 个已使用资产，并补入 ${context.recalledMemorySources.filter((item) =>
            !item.stale
            && !item.overriddenByConstraint
            && item.entityValidated
            && item.similarity >= (
              item.searchMode === 'vector'
                ? context.recallDiagnostics.minVectorSimilarity
                : context.recallDiagnostics.minKeywordSimilarity
            )).length} 条召回片段。`
          : '当前没有命中的资产图谱引用。',
      },
      {
        key: 'timeline_recall',
        label: '时间召回',
        itemCount: timelineItems,
        summary: timelineItems > 0
          ? '已把时间轴、开放线索和近期状态变化共同纳入写作上下文。'
          : '当前章节没有额外时间召回补充。',
      },
      {
        key: 'chapter_bridge',
        label: '章节衔接',
        itemCount: bridgeItems,
        summary: bridgeItems > 0
          ? '已把上章结尾、时间地点、情绪惯性和 POV 边界纳入开篇承接计划。'
          : '当前章节没有可用的章节衔接桥，通常是第一章或前章资料不足。',
      },
      {
        key: 'contract_recall',
        label: '合同召回',
        itemCount: contractItems,
        summary: contractItems > 0
          ? `硬约束 ${context.hardConstraintEntries.length} 项，显式合同引用 ${usageSnapshot.usedContracts.length} 项。`
          : '当前没有识别到显式合同约束。',
      },
    ],
    notes: [
      context.recallSnapshot.assemblyStage === 'unified_recall'
        ? '召回层已进入 unified_recall，并与合同约束联合裁剪。'
        : '召回层仍以基础召回为主，但已统一呈现在 v2 解释报告中。',
      usageSnapshot.ignoredConstraints.length > 0
        ? `存在 ${usageSnapshot.ignoredConstraints.length} 项约束被压缩或忽略，已列入低置信度提示。`
        : '本次没有检测到被忽略的硬约束。',
    ],
  }
}

function buildChapterAiStageReports(
  executionMode: AiExecutionMode,
  resolutionSource: 'request_override' | 'global_default' | 'fallback_default',
  modelConfigId?: number | null,
  options: {
    rewriteTemperatureCap?: number
    rewriteContextStrategy?: 'balanced' | 'max_coverage'
    rewriteReviewDepth?: 'standard' | 'deep'
    rewriteReasons?: string[]
  } = {},
): AiStageExecutionReport[] {
  const plannerRoute = buildAiModelRouteReport({
    taskKind: 'chapter_planning',
    stageLabel: 'Planner',
    executionMode,
    resolutionSource,
    modelConfigId,
  })
  const writerRoute = buildAiModelRouteReport({
    taskKind: 'chapter_generation',
    stageLabel: 'Writer',
    executionMode,
    resolutionSource,
    modelConfigId,
  })
  const criticRoute = buildAiModelRouteReport({
    taskKind: 'chapter_review',
    stageLabel: 'Critic',
    executionMode,
    resolutionSource,
    modelConfigId,
  })
  const rewriterRoute = buildAiModelRouteReport({
    taskKind: 'chapter_rewrite',
    stageLabel: 'Rewriter',
    executionMode,
    resolutionSource,
    modelConfigId,
    temperatureCap: options.rewriteTemperatureCap,
    contextStrategy: options.rewriteContextStrategy,
    reviewDepth: options.rewriteReviewDepth,
    extraReasons: options.rewriteReasons,
  })
  const finalizeRoute = buildAiModelRouteReport({
    taskKind: 'chapter_finalize',
    stageLabel: 'Canon / Finalize',
    executionMode,
    resolutionSource,
    modelConfigId,
  })

  return [
    buildAiStageExecutionReport({
      stageKey: 'planner',
      stageLabel: 'Planner',
      taskKind: 'chapter_planning',
      executionMode,
      outputShape: 'json',
      summary: '先输出场景计划 JSON，再渲染为可读场景链。',
      route: plannerRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'writer',
      stageLabel: 'Writer',
      taskKind: 'chapter_generation',
      executionMode,
      outputShape: 'text',
      summary: '基于章节合同、场景计划与统一上下文生成正文初稿。',
      route: writerRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'critic',
      stageLabel: 'Critic',
      taskKind: 'chapter_review',
      executionMode,
      outputShape: 'json',
      summary: '输出结构化审校意见，再回写为 reviewNotes。',
      route: criticRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'rewriter',
      stageLabel: 'Rewriter',
      taskKind: 'chapter_rewrite',
      executionMode,
      outputShape: 'text',
      summary: '按审校结论修正文稿，并保留人味与合同兑现检查。',
      route: rewriterRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'canon-finalize',
      stageLabel: 'Canon / Finalize',
      taskKind: 'chapter_finalize',
      executionMode,
      outputShape: 'workflow',
      summary: '生成 Canon 差异草案，并刷新摘要、连续性与记忆写回。',
      route: finalizeRoute,
    }),
  ]
}

const CHAPTER_PIPELINE_PROMPT_KEYS = new Set([
  'scenePlan',
  'chapterDraft',
  'chapterWriting',
  'chapterReview',
  'chapterRewrite',
])

function getActiveChapterPromptOverrideKeys(): string[] {
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
    .sort((a, b) => a.key.localeCompare(b.key))
  return createHash('sha1').update(JSON.stringify(activeOverrides)).digest('hex').slice(0, 16)
}

function getCompletedPipelineRoleCount(snapshot: ChapterPipelineSnapshot): number {
  return Object.values(snapshot.roles).filter((role) => role.status === 'success').length
}

function sendPipelineProgress(
  sender: WebContents | undefined,
  snapshot: ChapterPipelineSnapshot,
  payload: Pick<ChapterGenerationProgressEvent, 'stage' | 'label' | 'detail' | 'status'> & { role?: ChapterPipelineRole },
) {
  const totalRoles = Object.keys(snapshot.roles).length
  sendGenerationProgress(sender, {
    chapterId: snapshot.chapterId,
    taskId: snapshot.workflowTaskId,
    streamTaskId: snapshot.streamTaskId,
    role: payload.role ?? snapshot.currentRole ?? undefined,
    stage: payload.stage,
    label: payload.label,
    detail: payload.detail,
    completed: Math.min(getCompletedPipelineRoleCount(snapshot), totalRoles),
    total: totalRoles,
    status: payload.status,
    pipeline: snapshot,
  })
}

function refreshPipelineRoleMetrics(
  snapshot: ChapterPipelineSnapshot,
  role: ChapterPipelineRole,
  taskId: number,
) {
  const task = getTaskRecord(taskId)
  if (!task) return snapshot
  const roleState = snapshot.roles[role]
  const nextDuration = typeof task.durationMs === 'number' && task.durationMs > 0 ? task.durationMs : roleState.durationMs
  const nextTokens = typeof task.tokensUsed === 'number' && task.tokensUsed > 0 ? task.tokensUsed : roleState.tokensUsed
  const nextRoles = {
    ...snapshot.roles,
    [role]: {
      ...roleState,
      taskId,
      durationMs: nextDuration,
      tokensUsed: nextTokens,
    },
  }
  return {
    ...snapshot,
    roles: nextRoles,
    totalDurationMs: Object.values(nextRoles).reduce((sum, item) => sum + (item.durationMs || 0), 0),
    totalTokensUsed: Object.values(nextRoles).reduce((sum, item) => sum + (item.tokensUsed || 0), 0),
  }
}

function isChapterPipelineAbortError(taskId: number, error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return true
  const task = getTaskRecord(taskId)
  return Boolean(task && parseTaskControl(task).cancelRequested)
}

function assertChapterPipelineActive(taskId: number) {
  const task = getTaskRecord(taskId)
  if (!task) throwUserFacingError('task.notFound', { id: taskId })
  if (parseTaskControl(task).cancelRequested) {
    const error = new Error('用户已取消')
    error.name = 'AbortError'
    throw error
  }
}

function getChapterContractPreviewGate(chapterId: number): {
  ready: boolean
  blockers: string[]
} {
  const blockers = getChapterContractBlockers(chapterId)
  return { ready: blockers.length === 0, blockers }
}

function buildChapterContractVersion(chapterId: number, options: { allowMissing?: boolean } = {}): string {
  const db = getDb()
  const chapterContract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.id))
    .all()

  if (!chapterContract) {
    if (options.allowMissing) return `missing:chapter:${chapterId}`
    throwUserFacingError('chapter.contractRequiredForPipeline')
  }

  const sceneVersion = sceneRows
    .map((row) => `${row.id}:${row.status || 'draft'}:${row.updatedAt || row.createdAt || ''}`)
    .join('|')

  return [
    `chapter:${chapterContract.id}`,
    chapterContract.status || 'draft',
    chapterContract.updatedAt || chapterContract.createdAt || '',
    `scenes:${sceneRows.length}`,
    sceneVersion,
  ].join('#')
}

function assertContractDrivenWriterInputs(
  role: Exclude<ChapterPipelineRole, 'planner' | 'canonizer' | 'finalize'>,
  contractVersion: string,
  writingContractSummary: string,
  scenePlanText: string,
) {
  if (!contractVersion.trim()) {
    throwUserFacingError('chapter.pipelineMissingContractVersion', { role: getPipelineRoleLabel(role) })
  }
  if (!writingContractSummary.trim()) {
    throwUserFacingError('chapter.pipelineMissingContractSummary', { role: getPipelineRoleLabel(role) })
  }
  if (!scenePlanText.trim()) {
    throwUserFacingError('chapter.pipelineMissingScenePlan', { role: getPipelineRoleLabel(role) })
  }
}

function buildStoryCore(profile: Awaited<ReturnType<typeof buildStoryProfile>>, fallback?: string): string {
  if (fallback?.trim()) {
    return [profile.projectBriefSummary, fallback].filter(Boolean).join('\n\n')
  }
  return [
    profile.projectBriefSummary,
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
    profile.writingRulesSummary,
  ].filter(Boolean).join('\n\n')
}

function buildFallbackContinuityState(
  chapter: typeof chapters.$inferSelect,
  summaryData: ChapterSummaryData,
): ContinuityState {
  const chapterGoal = extractChapterGoal(chapter.outline)
  const summary = summaryData.summary || chapter.title || `${getDefaultChapterTitle(chapter.chapterNum)}完成当前章节推进`
  const nextSeed = summaryData.nextChapterSeed

  return {
    plotProgress: [summary].filter(Boolean),
    characterStateChanges: [],
    worldStateChanges: [],
    // openLoops 只记录真正未回收的悬挂情节，nextChapterSeed 是衔接提示而非伏笔
    openLoops: [],
    continuityNotes: [nextSeed || chapterGoal].filter(Boolean),
    arcProgress: chapterGoal || '',
  }
}

function normalizeContinuityState(parsed: Record<string, unknown>, fallback: ContinuityState): ContinuityState {
  const state: ContinuityState = {
    plotProgress: toStringArray(parsed.plot_progress),
    characterStateChanges: toStringArray(parsed.character_state_changes),
    worldStateChanges: toStringArray(parsed.world_state_changes),
    openLoops: toStringArray(parsed.open_loops),
    continuityNotes: toStringArray(parsed.continuity_notes),
    arcProgress: typeof parsed.arc_progress === 'string' ? parsed.arc_progress.trim() : '',
  }

  const hasContent = Boolean(
    state.plotProgress.length > 0 ||
    state.characterStateChanges.length > 0 ||
    state.worldStateChanges.length > 0 ||
    state.openLoops.length > 0 ||
    state.continuityNotes.length > 0 ||
    state.arcProgress,
  )

  return hasContent ? state : fallback
}

function parseLockedParagraphsJson(raw?: string | null): string[] {
  if (!raw?.trim()) return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupeTextList(parsed
      .map((item) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
        const record = item as Record<string, unknown>
        return typeof record.content === 'string'
          ? record.content
          : typeof record.paragraph === 'string'
            ? record.paragraph
            : typeof record.text === 'string'
              ? record.text
              : ''
      }))
  } catch {
    return []
  }
}

function normalizeParagraphFingerprint(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
}

function contentContainsLockedParagraph(content: string, lockedParagraph: string): boolean {
  const normalizedContent = normalizeParagraphFingerprint(content)
  const normalizedParagraph = normalizeParagraphFingerprint(lockedParagraph)
  if (!normalizedParagraph) return false
  return normalizedContent.includes(normalizedParagraph)
}

function contentPreservesLockedParagraphs(content: string, lockedParagraphs: string[]): boolean {
  if (lockedParagraphs.length === 0) return true
  if (!content.trim()) return false
  return lockedParagraphs.every((paragraph) => contentContainsLockedParagraph(content, paragraph))
}

function markLockedParagraphsInContent(content: string, lockedParagraphs: string[]): string {
  if (!content.trim() || lockedParagraphs.length === 0) return content

  let next = content
  lockedParagraphs
    .slice()
    .sort((left, right) => right.length - left.length)
    .forEach((paragraph) => {
      if (!paragraph || !next.includes(paragraph)) return
      next = next.split(paragraph).join(`【锁定】\n${paragraph}\n【/锁定】`)
    })

  return next
}

function buildLockedParagraphContext(
  chapter: typeof chapters.$inferSelect,
  draftContent: string,
): LockedParagraphContext {
  const lockedParagraphs = parseLockedParagraphsJson(chapter.lockedParagraphsJson)
  const previousContent = typeof chapter.content === 'string' ? chapter.content.trim() : ''
  const initialFallbackContent = contentPreservesLockedParagraphs(previousContent, lockedParagraphs)
    ? previousContent
    : draftContent.trim()

  return {
    lockedParagraphs,
    promptDraftContent: markLockedParagraphsInContent(draftContent, lockedParagraphs),
    initialFallbackContent,
  }
}

function enforceLockedParagraphProtection(
  content: string,
  lockedParagraphs: string[],
  fallbackContent: string,
  reviewNotes: ChapterReviewNotes,
): { content: string; reviewNotes: ChapterReviewNotes; violated: boolean } {
  const trimmed = content.trim()
  if (lockedParagraphs.length === 0 || contentPreservesLockedParagraphs(trimmed, lockedParagraphs)) {
    return {
      content: trimmed,
      reviewNotes,
      violated: false,
    }
  }

  return {
    content: fallbackContent.trim() || trimmed,
    reviewNotes: {
      ...reviewNotes,
      critical_fixes: dedupeTextList([
        '严格保留作者锁定段落，任何改动只能发生在未锁定内容。',
        ...reviewNotes.critical_fixes,
      ]),
      language_risks: dedupeTextList([
        '本次重写改动了作者锁定段落，已触发保护回退。',
        ...reviewNotes.language_risks,
      ]),
      severity: mergeSeverity(reviewNotes.severity, 'high'),
      rewrite_required: true,
      summary: reviewNotes.summary || '检测到锁定段落被改写，当前结果已回退到安全版本。',
      revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
        '锁定段落必须逐字保留，只能调整周边衔接。',
      ]),
    },
    violated: true,
  }
}

function buildArcProgressStatus(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''
  const snapshot = getStoryArcProgressSnapshot(arc.novelId)
  const { summary, point } = getStoryArcStatusContext(snapshot, arc.id, chapterNum)
  return formatStoryArcProgressStatus(summary, point)
}

function buildArcProgressCheckpoint(
  arc: typeof storyArcs.$inferSelect | null,
  chapterNum: number,
): string {
  if (!arc) return ''
  const snapshot = getStoryArcProgressSnapshot(arc.novelId)
  const { summary, point } = getStoryArcStatusContext(snapshot, arc.id, chapterNum)
  return formatStoryArcCheckpointReminder(summary, point)
}

function syncDialogueDriftRevisionTasks(novelId: number): number {
  const db = getDb()
  const now = new Date().toISOString()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    reviewNotesJson: chapters.reviewNotesJson,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const characterNameById = new Map(
    db.select({
      id: characters.id,
      fullName: characters.fullName,
    }).from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.fullName || `角色#${row.id}`] as const),
  )
  const activeDriftMap = new Map<number, { chapterNums: number[]; severity: 'medium' | 'high'; detail: string }>()

  for (let index = 1; index < chapterRows.length; index += 1) {
    const previous = chapterRows[index - 1]
    const current = chapterRows[index]
    if (current.chapterNum - previous.chapterNum !== 1) continue
    const previousNotes = parseStoredReviewNotes(previous.reviewNotesJson)
    const currentNotes = parseStoredReviewNotes(current.reviewNotesJson)
    const previousByCharacter = new Map(previousNotes.dialogue_drift_alerts.map((item) => [item.characterId, item] as const))
    currentNotes.dialogue_drift_alerts.forEach((item) => {
      const prior = previousByCharacter.get(item.characterId)
      if (!prior) return
      activeDriftMap.set(item.characterId, {
        chapterNums: [previous.chapterNum, current.chapterNum],
        severity: item.driftRate >= 60 || prior.driftRate >= 60 ? 'high' : 'medium',
        detail: `第${previous.chapterNum}章与第${current.chapterNum}章连续检测到${item.characterName}口吻漂移：${item.reason || prior.reason || '需要回看称呼、句长、停顿和口头禅。'}`,
      })
    })
  }

  const existingRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => asText(row.taskSource) === 'system')
    .filter((row) => asText(row.issueKey).startsWith('dialogue_drift:'))
  const existingByKey = new Map(existingRows.map((row) => [asText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()

  activeDriftMap.forEach((entry, characterId) => {
    const characterName = characterNameById.get(characterId) || `角色#${characterId}`
    const issueKey = `dialogue_drift:${characterId}`
    const title = `[对白漂移] ${characterName} 连续两章口吻偏移`
    const fixBrief = `回查 ${entry.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}，补人物卡 speechPattern / catchphrases / dialectFeatures，并把 ${characterName} 的 voice lock 升级到下一章硬约束。`
    const originMetaJson = JSON.stringify({
      issueCategory: 'dialogue_drift',
      characterId,
      characterName,
      chapterNums: entry.chapterNums,
      suggestion: fixBrief,
    })
    const existing = existingByKey.get(issueKey)
    activeKeys.add(issueKey)

    if (!existing) {
      db.insert(revisionTasks).values({
        novelId,
        taskSource: 'system',
        issueKey,
        taskType: 'continuity',
        status: 'open',
        severity: entry.severity,
        title,
        description: entry.detail,
        fixBrief,
        relatedPage: 'writing',
        entityType: 'character',
        entityId: characterId,
        chapterId: null,
        originMetaJson,
        lastDetectedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      return
    }

    const nextStatus = asText(existing.status) === 'ignored'
      ? 'ignored'
      : asText(existing.status) === 'resolved'
        ? 'open'
        : asText(existing.status) || 'open'
    db.update(revisionTasks).set({
      status: nextStatus,
      severity: entry.severity,
      title,
      description: entry.detail,
      fixBrief,
      relatedPage: 'writing',
      entityType: 'character',
      entityId: characterId,
      chapterId: null,
      originMetaJson,
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
  })

  existingRows
    .filter((row) => {
      const issueKey = asText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const currentStatus = asText(row.status)
      if (currentStatus === 'ignored' || currentStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return activeKeys.size
}

function parseStoredContinuityState(raw?: string | null): ContinuityState | null {
  if (!raw?.trim()) return null

  try {
    return normalizeContinuityState(JSON.parse(raw) as Record<string, unknown>, EMPTY_CONTINUITY_STATE)
  } catch {
    return null
  }
}

function getLatestArcProgressNote(
  novelId: number,
  arc: typeof storyArcs.$inferSelect | null,
  beforeChapterNum: number,
): string {
  if (!arc) return ''

  const db = getDb()
  const arcChapters = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    .filter((chapter) => {
      if (chapter.chapterNum >= beforeChapterNum) return false
      if (chapter.arcId === arc.id) return true
      if (typeof arc.chapterStart !== 'number' || typeof arc.chapterEnd !== 'number') return false
      return chapter.chapterNum >= arc.chapterStart && chapter.chapterNum <= arc.chapterEnd
    })
    .sort((left, right) => right.chapterNum - left.chapterNum)

  for (const chapter of arcChapters) {
    const continuity = parseStoredContinuityState(chapter.continuityStateJson)
    if (continuity?.arcProgress?.trim()) return continuity.arcProgress.trim()
  }

  return ''
}

function computeStoryArcProgressState(
  arc: typeof storyArcs.$inferSelect,
  currentChapter: typeof chapters.$inferSelect,
  _currentContinuity: ContinuityState,
): { progressPercent: number; stalledChapterCount: number; lastProgressChapterNum: number | null; warnings: string[] } {
  const snapshot = getStoryArcProgressSnapshot(currentChapter.novelId)
  const { summary } = getStoryArcStatusContext(snapshot, arc.id, currentChapter.chapterNum)
  return {
    progressPercent: summary?.progressPercent || 0,
    stalledChapterCount: summary?.stalledChapterCount || 0,
    lastProgressChapterNum: summary?.lastProgressChapterNum ?? null,
    warnings: getStoryArcWarningsForChapter(snapshot, arc.id, currentChapter.chapterNum),
  }
}

function persistArcProgressWarnings(chapterId: number, warnings: string[]): void {
  if (warnings.length === 0) return

  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return

  const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const nextNotes: ChapterReviewNotes = {
    ...reviewNotes,
    arc_progress_risks: dedupeTextList([...reviewNotes.arc_progress_risks, ...warnings]),
    critical_fixes: dedupeTextList([
      '让本章明确推进当前故事弧目标，避免继续空转。',
      ...reviewNotes.critical_fixes,
    ]),
    severity: mergeSeverity(reviewNotes.severity, 'medium'),
    rewrite_required: true,
    summary: reviewNotes.summary || '当前章节存在需要修正的故事弧推进问题。',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      '让本章明确服务当前故事弧目标，并补上阶段性推进。',
    ]),
  }

  db.update(chapters).set({
    reviewNotesJson: JSON.stringify(nextNotes),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

interface ChapterRepairInput {
  chapter: typeof chapters.$inferSelect
  novel: typeof novels.$inferSelect
  context: Awaited<ReturnType<typeof buildChapterContext>>
  storyCore: string
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  scenePlanText: string
  consistencyNotes: string
  structuralAlertsSummary: string
  reviewNotes: ChapterReviewNotes
  content: string
  lockedParagraphs: string[]
  promptTier: ChapterComplexity
  knownTerms: string[]
  attemptNumber?: number
  rejectedDigests?: string[]
}

const STYLE_REPAIRABLE_GUARDRAIL_CODES = new Set([
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

async function repairChapterOutputIfNeeded(input: ChapterRepairInput): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
}> {
  const originalContent = input.content.trim()
  const findings = collectQualityGuardrailFindings(originalContent, input.profile.genre, { knownTerms: input.knownTerms })
  if (findings.length === 0 || !shouldForceRepair(findings)) {
    return {
      content: originalContent,
      reviewNotes: input.reviewNotes,
    }
  }

  const repairNotes = applyHumanizationAnalysisToReviewNotes(
    enhanceReviewNotesWithGuardrails(input.reviewNotes, originalContent, input.profile.genre, findings),
    originalContent,
    {
      chapterId: input.chapter.id,
      genre: input.profile.genre,
      chapterFunction: input.reviewNotes.chapter_function_primary || input.reviewNotes.pace_marker,
      emotionTone: input.chapter.emotionTone || '',
    },
  )

  try {
    const repairPromptDraftContent = markLockedParagraphsInContent(originalContent, input.lockedParagraphs)
    const repairedContent = (await runChatTask({
      type: 'chapter_write',
      novelId: input.chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: input.chapter.id,
      messages: [{
        role: 'user',
        content: buildChapterRewritePrompt({
          novelTitle: input.novel.title,
          genre: input.profile.genre,
          chapterNum: input.chapter.chapterNum,
          chapterTitle: input.chapter.title || getDefaultChapterTitle(input.chapter.chapterNum),
          chapterGoal: input.context.chapterGoal,
          hardConstraintContext: input.context.hardConstraintContext,
          dialogueVoiceLocks: input.context.dialogueVoiceLocks,
          emotionTone: input.chapter.emotionTone || '平稳',
          targetWords: resolveChapterReferenceWords(input.chapter.targetWords, input.novel.targetWords),
          storyCore: input.storyCore,
          writingContractSummary: input.context.writingContractSummary,
          relationSummary: input.context.relationSummary,
          currentArc: input.context.currentArc,
          worldRules: input.context.worldRules,
          characterStates: input.context.characterStates,
          worldStates: input.context.worldStates,
          mapSummary: input.context.mapSummary,
          itemSummary: input.context.itemSummary,
          previousSummaries: input.context.previousSummaries,
          previousChapterContext: input.context.previousChapterContext,
          lastChapterEnding: input.context.lastChapterEnding,
          continuitySummary: input.context.continuitySummary,
          openLoops: input.context.openLoops,
          dueForeshadows: input.context.dueForeshadows,
          continuityNotes: input.context.continuityNotes,
          timelineSummary: input.context.timelineSummary,
          timelineOpenThreads: input.context.timelineOpenThreads,
          longTermMemory: input.context.longTermMemory,
          recalledMemory: input.context.recalledMemory,
          consistencyNotes: input.consistencyNotes,
          structuralAlertsSummary: input.structuralAlertsSummary,
          scenePlan: input.scenePlanText,
          draftContent: repairPromptDraftContent,
          reviewNotes: formatReviewNotes(repairNotes),
          lockedParagraphs: input.lockedParagraphs,
          activeThreads: input.context.activeThreads,
          protagonistReference: input.profile.protagonistReference,
          protagonistRule: input.profile.protagonistRule,
          promptTier: input.promptTier,
          attemptNumber: input.attemptNumber,
          rejectedDigests: input.rejectedDigests,
        }),
      }],
      modelConfigId: input.novel.modelConfigId || undefined,
    })).trim()

    if (!repairedContent) {
      return {
        content: originalContent,
        reviewNotes: repairNotes,
      }
    }

    const protectedRepaired = enforceLockedParagraphProtection(
      repairedContent,
      input.lockedParagraphs,
      originalContent,
      repairNotes,
    )
    if (protectedRepaired.violated) {
      return {
        content: protectedRepaired.content,
        reviewNotes: protectedRepaired.reviewNotes,
      }
    }

    const finalFindings = collectQualityGuardrailFindings(protectedRepaired.content, input.profile.genre, { knownTerms: input.knownTerms })
    if (finalFindings.length > 0 && shouldForceRepair(finalFindings)) {
      // 第二轮修复：首轮修复后仍有强制修复触发，再做一次
      const secondRepairNotes = applyHumanizationAnalysisToReviewNotes(
        enhanceReviewNotesWithGuardrails(
          protectedRepaired.reviewNotes,
          protectedRepaired.content,
          input.profile.genre,
          finalFindings,
        ),
        protectedRepaired.content,
        {
          chapterId: input.chapter.id,
          genre: input.profile.genre,
          chapterFunction: protectedRepaired.reviewNotes.chapter_function_primary || protectedRepaired.reviewNotes.pace_marker,
          emotionTone: input.chapter.emotionTone || '',
        },
      )
      try {
        const secondPromptDraftContent = markLockedParagraphsInContent(protectedRepaired.content, input.lockedParagraphs)
        const secondContent = (await runChatTask({
          type: 'chapter_write',
          novelId: input.chapter.novelId,
          relatedEntityType: 'chapter',
          relatedEntityId: input.chapter.id,
          messages: [{
            role: 'user',
            content: buildChapterRewritePrompt({
              novelTitle: input.novel.title,
              genre: input.profile.genre,
              chapterNum: input.chapter.chapterNum,
              chapterTitle: input.chapter.title || getDefaultChapterTitle(input.chapter.chapterNum),
              chapterGoal: input.context.chapterGoal,
              hardConstraintContext: input.context.hardConstraintContext,
              dialogueVoiceLocks: input.context.dialogueVoiceLocks,
              emotionTone: input.chapter.emotionTone || '平稳',
              targetWords: resolveChapterReferenceWords(input.chapter.targetWords, input.novel.targetWords),
              storyCore: input.storyCore,
              writingContractSummary: input.context.writingContractSummary,
              relationSummary: input.context.relationSummary,
              currentArc: input.context.currentArc,
              worldRules: input.context.worldRules,
              characterStates: input.context.characterStates,
              worldStates: input.context.worldStates,
              mapSummary: input.context.mapSummary,
              itemSummary: input.context.itemSummary,
              previousSummaries: input.context.previousSummaries,
              previousChapterContext: input.context.previousChapterContext,
              lastChapterEnding: input.context.lastChapterEnding,
              continuitySummary: input.context.continuitySummary,
              openLoops: input.context.openLoops,
              dueForeshadows: input.context.dueForeshadows,
              continuityNotes: input.context.continuityNotes,
              timelineSummary: input.context.timelineSummary,
              timelineOpenThreads: input.context.timelineOpenThreads,
              longTermMemory: input.context.longTermMemory,
              recalledMemory: input.context.recalledMemory,
              consistencyNotes: input.consistencyNotes,
              structuralAlertsSummary: input.structuralAlertsSummary,
              scenePlan: input.scenePlanText,
              draftContent: secondPromptDraftContent,
              reviewNotes: formatReviewNotes(secondRepairNotes),
              lockedParagraphs: input.lockedParagraphs,
              activeThreads: input.context.activeThreads,
              protagonistReference: input.profile.protagonistReference,
              protagonistRule: input.profile.protagonistRule,
              promptTier: input.promptTier,
              attemptNumber: (input.attemptNumber || 1) + 1,
              rejectedDigests: [
                ...(input.rejectedDigests || []),
                buildVariationDigest(protectedRepaired.content),
              ],
            }),
          }],
          modelConfigId: input.novel.modelConfigId || undefined,
        })).trim()
        if (secondContent) {
          const protectedSecond = enforceLockedParagraphProtection(
            secondContent,
            input.lockedParagraphs,
            protectedRepaired.content,
            secondRepairNotes,
          )
          return chooseBetterGuardrailCandidate(
            {
              content: protectedRepaired.content,
              reviewNotes: protectedRepaired.reviewNotes,
            },
            {
              content: protectedSecond.content,
              reviewNotes: protectedSecond.reviewNotes,
            },
            input.profile.genre,
            input.knownTerms,
          )
        }
      } catch {
        // 第二轮失败时返回第一轮结果
      }
      return { content: protectedRepaired.content, reviewNotes: secondRepairNotes }
    }

    return {
      content: protectedRepaired.content,
      reviewNotes: finalFindings.length > 0
        ? applyHumanizationAnalysisToReviewNotes(
          enhanceReviewNotesWithGuardrails(protectedRepaired.reviewNotes, protectedRepaired.content, input.profile.genre, finalFindings),
          protectedRepaired.content,
          {
            chapterId: input.chapter.id,
            genre: input.profile.genre,
            chapterFunction: protectedRepaired.reviewNotes.chapter_function_primary || protectedRepaired.reviewNotes.pace_marker,
            emotionTone: input.chapter.emotionTone || '',
          },
        )
        : applyHumanizationAnalysisToReviewNotes(protectedRepaired.reviewNotes, protectedRepaired.content, {
          chapterId: input.chapter.id,
          genre: input.profile.genre,
          chapterFunction: protectedRepaired.reviewNotes.chapter_function_primary || protectedRepaired.reviewNotes.pace_marker,
          emotionTone: input.chapter.emotionTone || '',
        }),
    }
  } catch {
    return {
      content: originalContent,
      reviewNotes: repairNotes,
    }
  }
}

async function updateChapterContinuityState(
  chapterId: number,
  summaryData: ChapterSummaryData,
): Promise<ContinuityState> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) {
    throwUserFacingError('chapter.contentEmptyForContinuity')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const arc = chapter.arcId
    ? db.select().from(storyArcs).where(eq(storyArcs.id, chapter.arcId)).all()[0]
    : null

  const fallback = buildFallbackContinuityState(chapter, summaryData)
  let nextState = fallback
  let inboundContext: Awaited<ReturnType<typeof collectChapterContextRawData>> | null = null
  try {
    inboundContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  } catch {
    inboundContext = null
  }

  try {
    const result = await runChatTask({
      type: 'continuity',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{
        role: 'user',
        content: buildContinuityStatePrompt({
          novelTitle: novel.title,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          arcName: arc?.arcName || '',
          chapterGoal: extractChapterGoal(chapter.outline),
          summary: summaryData.summary,
          chapterContent: chapter.content,
          inboundOpenLoops: inboundContext?.contextParts.openLoops,
          inboundDueForeshadows: inboundContext?.contextParts.dueForeshadows,
          inboundContinuityNotes: inboundContext?.contextParts.continuityNotes,
          chapterBridgePlan: inboundContext?.contextParts.chapterBridgePlan,
        }),
      }],
      modelConfigId: novel.modelConfigId || undefined,
    })

    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节连续性状态 JSON 解析失败，已回退到保底连续性摘要。',
      consoleSummary: `[chapter:warn] continuity-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'continuity',
      },
    })
    if (parsedResult.success && parsedResult.data) {
      nextState = normalizeContinuityState(parsedResult.data, fallback)
    }
  } catch {
    nextState = fallback
  }

  db.update(chapters).set({
    continuityStateJson: serializeContinuityState(nextState),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  if (arc) {
    const progressState = computeStoryArcProgressState(arc, chapter, nextState)
    db.update(storyArcs).set({
      progressPercent: progressState.progressPercent,
      stalledChapterCount: progressState.stalledChapterCount,
      lastProgressChapterNum: progressState.lastProgressChapterNum,
    }).where(eq(storyArcs.id, arc.id)).run()
    persistArcProgressWarnings(chapterId, progressState.warnings)
  }

  return nextState
}

async function updateChapterSummaryData(chapterId: number): Promise<ChapterSummaryData> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throwUserFacingError('chapter.contentEmptyForSummary')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  let summaryData: ChapterSummaryData
  try {
    const result = await runChatTask({
      type: 'summary',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      messages: [{ role: 'user', content: chapterSummaryPrompt(chapter.content) }],
      modelConfigId: novel?.modelConfigId || undefined,
    })

    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节摘要 JSON 解析失败，已降级使用原始摘要文本。',
      consoleSummary: `[chapter:warn] summary-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'summary',
      },
    })
    if (parsedResult.success && parsedResult.data) {
      summaryData = {
        summary: typeof parsedResult.data.summary === 'string' ? parsedResult.data.summary.trim() : '',
        nextChapterSeed: typeof parsedResult.data.next_chapter_seed === 'string' ? parsedResult.data.next_chapter_seed.trim() : '',
      }
    } else {
      summaryData = {
        summary: result.trim(),
        nextChapterSeed: '',
      }
    }
  } catch {
    summaryData = {
      summary: chapter.content.slice(0, 180),
      nextChapterSeed: extractChapterGoal(chapter.outline),
    }
  }

  if (!summaryData.summary) {
    summaryData.summary = chapter.content.slice(0, 180)
  }

  db.update(chapters).set({
    summary: summaryData.summary,
    nextChapterSeed: summaryData.nextChapterSeed,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()

  return summaryData
}

async function refreshChapterMemory(chapterId: number): Promise<{
  summary: ChapterSummaryData
  continuity: ContinuityState
  summaryHealth: SummaryHealthReport | null
}> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFound')
  const summary = await updateChapterSummaryData(chapterId)
  const continuity = await updateChapterContinuityState(chapterId, summary)
  const summaryHealth = await refreshSummaryHealthSemantic(chapterId)
  refreshCharacterStateVersionsForChapter(chapterId)
  syncCharacterArcsFromChapterState(chapterId)
  refreshWorldStateVersionsForChapter(chapterId)
  refreshStoryMemoryCheckpoints(chapter.novelId)
  markChapterContextCurrent(chapterId)
  return { summary, continuity, summaryHealth }
}

async function finalizeGeneratedChapterContent(chapterId: number, content: string) {
  updateChapter(chapterId, {
    content,
    status: 'draft',
  }, {
    skipStaleTracking: true,
    versionSource: 'pipeline-generate',
  })

  const { summary } = await refreshChapterMemory(chapterId)
  const chapter = getChapter(chapterId)
  if (chapter && content.trim()) {
    await discoverEntitiesFromContent({
      novelId: chapter.novelId,
      sourcePage: 'writing',
      sourceLabel: `第${chapter.chapterNum}章 ${chapter.title || ''}`.trim(),
      sourceEntityId: chapter.id,
      content,
    })
    // Entity discovery increments the novel context version after the first
    // memory refresh. The chapter was generated from the current context, so
    // mark this committed chapter current again before the final gate; later
    // chapters remain stale through markSubsequentChaptersStale below.
    markChapterContextCurrent(chapter.id)
  }
  if (chapter) {
    markSubsequentChaptersStale(
      chapter.novelId,
      chapter.chapterNum,
      `第${chapter.chapterNum}章内容已更新`,
    )
    syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)
  }

  return {
    chapterId,
    summary: summary.summary,
    nextChapterSeed: summary.nextChapterSeed,
    wordCount: chapter?.wordCount || 0,
    status: chapter?.status || 'draft',
  }
}

export function listChapters(novelId: number) {
  const db = getDb()
  ensureStoryStructure(novelId)
  return db.select().from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
}

export function getChapter(id: number) {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0] || null
  if (!chapter) return null
  ensureStoryStructure(chapter.novelId)
  return chapter
}

export function createChapter(novelId: number, data: Partial<{
  chapterNum: number
  title: string
  outline: string
  targetWords: number
  emotionTone: string
  arcId: number
  volumeId: number
  partId: number
  allowedFactIdsJson: string
  revealedFactIdsJson: string
}>) {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  const defaults = resolveDefaultStructure(novelId)
  const chapterNum = data.chapterNum ?? (db.select().from(chapters).where(eq(chapters.novelId, novelId)).all().length + 1)
  const result = db.insert(chapters).values({
    novelId,
    ...data,
    volumeId: data.volumeId ?? defaults.volumeId,
    partId: data.partId ?? defaults.partId,
    chapterNum,
    compiledFromSegments: 0,
    segmentCount: 0,
    allowedFactIdsJson: data.allowedFactIdsJson || '[]',
    revealedFactIdsJson: data.revealedFactIdsJson || '[]',
    contextVersion: novel?.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
    writebackStatusJson: JSON.stringify({
      phase: 'idle',
      retryCount: 0,
      candidateReady: false,
      canonApplied: true,
      blockedGeneration: false,
      readyForNextChapter: true,
      contextVersion: novel?.contextVersion || 1,
      updatedAt: new Date().toISOString(),
    }),
  }).run()
  ensureStoryStructure(novelId)
  syncNovelLifecycleStatus(novelId)
  return Number(result.lastInsertRowid)
}

export function updateChapter(id: number, data: Partial<{
  title: string
  outline: string
  scenePlanJson: string
  content: string
  wordCount: number
  summary: string
  nextChapterSeed: string
  bridgePlanJson: string
  continuityStateJson: string
  reviewNotesJson: string
  status: string
  aiScoreJson: string
  targetWords: number
  emotionTone: string
  chapterNum: number
  arcId: number | null
  volumeId: number | null
  partId: number | null
  compiledFromSegments: number
  segmentCount: number
  contextVersion: number
  staleReasonJson: string
  allowedFactIdsJson: string
  revealedFactIdsJson: string
  contractAuditJson: string
  summaryHealthJson: string
  expressionDedupJson: string
  hookContinuityJson: string
  writebackStatusJson: string
}>, options: { skipStaleTracking?: boolean; versionSource?: ChapterVersionSource | false } = {}) {
  const db = getDb()
  const previous = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  const versionSource = data.content !== undefined
    ? normalizeChapterVersionSource(options.versionSource)
    : null

  if (data.content !== undefined) {
    data.wordCount = countChineseWords(data.content)
  }

  db.update(chapters).set({
    ...data,
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, id)).run()

  const chapter = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (chapter) {
    const allChapters = db.select().from(chapters).where(eq(chapters.novelId, chapter.novelId)).all()
    const totalWords = allChapters.reduce((sum, item) => sum + (item.wordCount || 0), 0)
    db.update(novels).set({
      totalWords,
      updatedAt: new Date().toISOString(),
    }).where(eq(novels.id, chapter.novelId)).run()
    syncNovelLifecycleStatus(chapter.novelId)
  }

  if (data.content !== undefined && chapter) {
    syncChapterToSegments(id, data.content, { createIfMissing: true })
  }

  if (chapter && versionSource) {
    createChapterVersionSnapshot(id, versionSource)
  }

  if (!options.skipStaleTracking && previous && data.content !== undefined) {
    markSubsequentChaptersStale(
      previous.novelId,
      previous.chapterNum,
      `第${previous.chapterNum}章内容已更新`,
    )
  }
}

export function deleteChapter(id: number) {
  const db = getDb()
  const current = db.select().from(chapters).where(eq(chapters.id, id)).all()[0]
  if (current) {
    let affectedStartChapterId: number | null = null
    let affectedStartChapterNum: number | null = null
    let remainingChapterCount = 0

    getSqlite().transaction(() => {
      const beforeRows = db.select().from(chapters)
        .where(eq(chapters.novelId, current.novelId))
        .orderBy(asc(chapters.chapterNum), asc(chapters.id))
        .all()
      deleteChapterSegmentsCascade(id)
      db.delete(chapters).where(eq(chapters.id, id)).run()
      ensureStoryStructure(current.novelId)
      const afterRows = db.select().from(chapters)
        .where(eq(chapters.novelId, current.novelId))
        .orderBy(asc(chapters.chapterNum), asc(chapters.id))
        .all()
      remainingChapterCount = afterRows.length

      const nextChapterNumById = new Map(afterRows.map((row) => [row.id, row.chapterNum] as const))
      const chapterNumberRemap = new Map<number, number | null>()
      beforeRows.forEach((row) => {
        chapterNumberRemap.set(row.chapterNum, row.id === id ? null : (nextChapterNumById.get(row.id) ?? null))
      })
      remapChapterNumberReferences(current.novelId, chapterNumberRemap)

      const changedChapterNums = beforeRows
        .filter((row) => row.id !== id)
        .flatMap((row) => {
          const nextChapterNum = nextChapterNumById.get(row.id)
          return typeof nextChapterNum === 'number' && nextChapterNum !== row.chapterNum
            ? [nextChapterNum]
            : []
        })

      if (changedChapterNums.length > 0) {
        affectedStartChapterNum = Math.min(...changedChapterNums)
        affectedStartChapterId = afterRows.find((row) => row.chapterNum === affectedStartChapterNum)?.id ?? null
      }
      syncTimelineStructureAnchors(current.novelId)
    })()
    markSubsequentChaptersStale(
      current.novelId,
      Math.max(0, (affectedStartChapterNum ?? current.chapterNum) - 1),
      `第${current.chapterNum}章已删除，后续章节顺序已变更`,
    )
    if (remainingChapterCount === 0) {
      refreshWorldStateVersionsForNovel(current.novelId)
    } else if (typeof affectedStartChapterId === 'number' && typeof affectedStartChapterNum === 'number') {
      refreshCharacterStateVersionsForChapter(affectedStartChapterId)
      syncCharacterArcsFromChapterState(affectedStartChapterId)
      refreshWorldStateVersionsFromChapter(current.novelId, affectedStartChapterNum)
    } else {
      refreshWorldStateVersionsForNovel(current.novelId)
    }
    refreshStoryMemoryCheckpoints(current.novelId)
    scheduleDialogueFingerprintRefresh(current.novelId)
    syncNovelLifecycleStatus(current.novelId)
    return
  }
  db.delete(chapters).where(eq(chapters.id, id)).run()
}

export function listChapterVersions(chapterId: number) {
  const db = getDb()
  return db.select().from(chapterVersions)
    .where(eq(chapterVersions.chapterId, chapterId))
    .orderBy(desc(chapterVersions.createdAt), desc(chapterVersions.id))
    .all()
}

export async function restoreChapterVersion(versionId: number) {
  const db = getDb()
  const version = db.select().from(chapterVersions).where(eq(chapterVersions.id, versionId)).all()[0]
  if (!version) throwUserFacingError('chapter.versionNotFound')

  const chapter = getChapter(version.chapterId)
  if (!chapter) throwUserFacingError('chapter.correspondingNotFound')
  if ((chapter.content || '') === version.content) {
    return chapter
  }

  updateChapter(chapter.id, {
    content: version.content,
  }, {
    versionSource: 'version-restore',
  })

  await refreshChapterMemory(chapter.id)
  syncChapterTimelineStatuses(chapter.novelId, chapter.chapterNum)

  return getChapter(chapter.id)
}

export function batchUpdateChapters(
  ids: number[],
  data: {
    status?: typeof chapters.$inferSelect['status']
    arcId?: number | null
  },
) {
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row) => {
    const nextStatus = typeof data.status === 'string' ? data.status : undefined
    updateChapter(row.id, {
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      ...(data.arcId !== undefined ? { arcId: data.arcId ?? null } : {}),
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_update',
    summary: `批量更新 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-update'),
    before: rows,
    after: data,
    undoPayload: {
      kind: 'chapter.batch_update',
      novelId: rows[0].novelId,
      chapters: rows,
      reason: '已撤销章节批量更新',
    },
  })

  return rows.length
}

export function batchDeleteChapters(ids: number[]) {
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  const segments = db.select().from(chapterSegments)
    .where(inArray(chapterSegments.chapterId, rows.map((row) => row.id)))
    .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder))
    .all()
  const timelineAnchors = captureTimelineAnchorsForChapterIds(rows.map((row) => row.id))

  rows.forEach((row) => {
    deleteChapter(row.id)
  })

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_delete',
    summary: `批量删除 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-delete'),
    before: rows,
    after: [],
    undoPayload: {
      kind: 'chapter.batch_delete',
      novelId: rows[0].novelId,
      chapters: rows,
      segments,
      timelineAnchors,
      reason: '已撤销章节批量删除',
    },
  })

  return rows.length
}

export function batchRenumberChapters(ids: number[], startChapterNum: number) {
  const normalizedStart = Math.max(1, Math.round(startChapterNum || 1))
  const chapterIds = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (chapterIds.length === 0) return 0

  const db = getDb()
  const rows = db.select().from(chapters)
    .where(inArray(chapters.id, chapterIds))
    .orderBy(asc(chapters.chapterNum))
    .all()
  if (rows.length === 0) return 0

  rows.forEach((row, index) => {
    updateChapter(row.id, {
      chapterNum: normalizedStart + index,
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
  })

  markSubsequentChaptersStale(
    rows[0].novelId,
    Math.max(0, normalizedStart - 1),
    '章节顺序已批量调整',
  )

  createOperationLog({
    novelId: rows[0].novelId,
    entityType: 'chapter',
    entityIds: rows.map((row) => row.id),
    operationType: 'batch_reindex',
    summary: `批量顺延重排 ${rows.length} 章`,
    batchKey: buildBatchKey('chapter-batch-reindex'),
    before: rows,
    after: { startChapterNum: normalizedStart },
    undoPayload: {
      kind: 'chapter.batch_reindex',
      novelId: rows[0].novelId,
      chapters: rows,
      reason: '已撤销章节顺序调整',
    },
  })

  return rows.length
}

type ChapterComplexity = 'simple' | 'standard' | 'key'
type ChapterContextStage = 'scenePlan' | 'draft' | 'review' | 'rewrite'

function logConstraintInjectionStatus(stage: ChapterContextStage, context: ChapterContext) {
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

interface ChapterComplexityInput {
  chapter: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  chapterRows: Array<typeof chapters.$inferSelect>
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
}

function classifyChapterComplexity(input: ChapterComplexityInput): ChapterComplexity {
  const { chapter, currentArc, chapterRows, outlineMentionedCharacterCount, activeThreadPressureCount } = input
  const outline = chapter.outline || ''
  const emotionTone = (chapter.emotionTone || '').toLowerCase()
  const maxChapterNum = chapterRows.reduce((max, row) => Math.max(max, row.chapterNum), 0)
  const isArcCheckpoint = Boolean(buildArcProgressCheckpoint(currentArc, chapter.chapterNum))
  const isArcEnding = Boolean(currentArc && typeof currentArc.chapterEnd === 'number' && currentArc.chapterEnd === chapter.chapterNum)
  const isFirstChapter = chapter.chapterNum === 1
  const isLastChapter = maxChapterNum > 0 && chapter.chapterNum === maxChapterNum

  if (
    emotionTone.includes('高潮') ||
    emotionTone.includes('climax') ||
    emotionTone.includes('爆发') ||
    emotionTone.includes('转折') ||
    emotionTone.includes('结局') ||
    emotionTone.includes('决战') ||
    isFirstChapter ||
    isLastChapter ||
    isArcCheckpoint ||
    isArcEnding ||
    outlineMentionedCharacterCount > 3 ||
    activeThreadPressureCount >= 4
  ) {
    return 'key'
  }

  if (
    (emotionTone.includes('过渡') || emotionTone.includes('日常') || emotionTone.includes('平缓') || emotionTone.includes('铺垫')) &&
    outline.length > 0 &&
    outline.length < 200 &&
    outlineMentionedCharacterCount <= 2 &&
    activeThreadPressureCount <= 2 &&
    !isFirstChapter &&
    !isLastChapter &&
    !isArcCheckpoint &&
    !isArcEnding
  ) {
    return 'simple'
  }

  return 'standard'
}

function resolveContextBudgetForStage(
  stage: ChapterContextStage,
  complexity: ChapterComplexity,
  targetWords: number,
  novelTargetWords?: number,
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
  const largeChapterOffset = targetWords >= 5000
    ? 1200
    : targetWords >= 3500
      ? 400
      : 0

  // 长篇小说需要更多上下文预算来维持连贯性
  const novelScaleOffset = !novelTargetWords ? 0
    : novelTargetWords >= 1500000 ? 4000
    : novelTargetWords >= 800000 ? 2800
    : novelTargetWords >= 500000 ? 1600
    : novelTargetWords >= 300000 ? 800
    : 0

  return Math.max(7000, baseByStage[stage] + complexityOffset[complexity] + largeChapterOffset + novelScaleOffset)
}

interface StageContextResolverPayload {
  stage: ChapterContextStage
  context: ChapterContext
  effectiveRawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>
  upstreamArtifacts: UpstreamRuntimeArtifacts
  renderSchema: StageRenderSchema
  writerContextResolution?: WriterContextOrchestratorResolution
}

function summarizeStageArtifactText(value: string, maxChars = 480): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(maxChars - 3, 1)).trim()}...`
}

function summarizeStageArtifactLines(lines: Array<string | null | undefined>, maxLines = 4, maxChars = 480): string {
  const normalized = [...new Set(lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean))]
  if (normalized.length === 0) return ''
  return summarizeStageArtifactText(normalized.slice(0, maxLines).join('\n'), maxChars)
}

function buildContractVersionArtifactSummary(contractVersion?: string): string {
  return contractVersion ? `当前章节合同版本：${contractVersion}` : ''
}

function buildPersistedScenePlanText(scenePlanJson?: string | null): string {
  if (!scenePlanJson?.trim()) return ''
  try {
    return formatScenePlan(normalizeScenePlan(JSON.parse(scenePlanJson) as unknown, []))
  } catch {
    return ''
  }
}

function buildReviewRiskArtifactSummary(reviewNotes: ChapterReviewNotes): string {
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

function buildReviewProofArtifactSummary(reviewNotes: ChapterReviewNotes): string {
  return summarizeStageArtifactLines([
    ...reviewNotes.continuity_risks.slice(0, 2).map((item) => `连续性证据：${item}`),
    ...reviewNotes.arc_progress_risks.slice(0, 2).map((item) => `弧线推进证据：${item}`),
    ...reviewNotes.missing_payoffs.slice(0, 2).map((item) => `伏笔兑现证据：${item}`),
    ...reviewNotes.human_language_repairs.slice(0, 2).map((item) => `语言替换证据：${item}`),
  ], 6, 640)
}

function buildRewriteDeltaArtifactSummary(
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

function buildStepMemorySummary(params: {
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
  const summary = summarizeStageArtifactLines([
    params.previousSummary,
    params.chapterBridgePlan ? `章节衔接桥：${summarizeStageArtifactText(params.chapterBridgePlan, 220)}` : '',
    params.scenePlanText ? `Planner 接力：${summarizeStageArtifactText(params.scenePlanText, 260)}` : '',
    params.draftText ? `Writer 底稿：${summarizeStageArtifactText(params.draftText, 260)}` : '',
    ...riskLines,
  ], 8, 900)

  return {
    summary,
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

function applyUpstreamArtifactsToRawContext(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  upstreamArtifacts: UpstreamRuntimeArtifacts,
): Awaited<ReturnType<typeof collectChapterContextRawData>> {
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

async function resolveStageContextForPipeline(
  stage: ChapterContextStage,
  chapter: typeof chapters.$inferSelect,
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
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
    const writerContextResolutionPayload = await resolveWriterContextForStage(
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
      writerContextResolutionPayload.effectiveRawContext,
      complexity,
      writerContextResolutionPayload.writerContextResolution,
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

function allocateStageContextForPipeline(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  chapter: typeof chapters.$inferSelect,
  complexity: ChapterComplexity,
  promptProfile: ChapterContextStage,
  totalBudget?: number,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
): ChapterContext {
  const novelTargetWords = rawContext.novel.targetWords || 0
  try {
    return allocateChapterContext(rawContext, {
      promptProfile,
      chapterComplexity: complexity,
      totalBudget: totalBudget || resolveContextBudgetForStage(
        promptProfile,
        complexity,
        resolveChapterReferenceWords(chapter.targetWords, rawContext.novel.targetWords),
        novelTargetWords,
      ),
      preserveConstraintLabels,
    })
  } catch (error) {
    if (error instanceof HardConstraintOverflowError) {
      // review/rewrite 阶段发生在初稿已生成之后；此时上下文放不下应降级续跑，
      // 中断只会丢掉已经花钱生成的正文。draft/scenePlan 阶段仍然中断，让用户拆章。
      if (promptProfile === 'review' || promptProfile === 'rewrite') {
        console.warn(
          `[chapter:context] stage=${promptProfile} 硬约束超预算，已降级为截断注入继续执行：${error.message}`,
        )
        return error.context
      }
      throw error
    }
    if (error instanceof ContextOverflowError) {
      return error.context
    }
    throw error
  }
}

function applyWriterContextOverridesToRawContext(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  overrides?: Partial<ChapterContext>,
): Awaited<ReturnType<typeof collectChapterContextRawData>> {
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
  writerContextResolution: WriterContextOrchestratorResolution,
  detail: string,
): WriterContextOrchestratorResolution {
  return {
    ...writerContextResolution,
    toolCalls: [
      ...writerContextResolution.toolCalls,
      {
        target: 'orchestrator',
        toolName: 'writer_context.legacy_fallback',
        status: 'failed',
        durationMs: 0,
        errorMessage: detail,
      },
    ],
    fallbackEvents: [
      ...writerContextResolution.fallbackEvents,
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
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
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

function allocateDraftContextWithWriterFallback(
  chapter: typeof chapters.$inferSelect,
  baseRawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  writerRawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  complexity: ChapterComplexity,
  writerContextResolution: WriterContextOrchestratorResolution,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
): {
  effectiveRawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>
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

function resolveWriterRuntimeOptions(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
): WriterContextOrchestratorRuntimeOptions {
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

async function resolveWriterContextForStage(
  chapter: typeof chapters.$inferSelect,
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  executionMode: AiExecutionMode | undefined,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
  contractVersion?: string,
  activePromptOverrideKeys?: string[],
): Promise<{
  effectiveRawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>
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
      db.update(novels).set({
        sourceLedgerJson: sourceGrounding.sourceLedgerJson,
        canonSourceLedgerJson: sourceGrounding.canonSourceLedgerJson,
        canonFactCardsJson: sourceGrounding.canonFactCardsJson,
        updatedAt: recordedAt,
      }).where(eq(novels.id, chapter.novelId)).run()
      const nextContextVersion = markNovelContextChanged(chapter.novelId, 'External source grounding updated')
      writerRawContext = {
        ...rawContext,
        novel: {
          ...rawContext.novel,
          sourceLedgerJson: sourceGrounding.sourceLedgerJson,
          canonSourceLedgerJson: sourceGrounding.canonSourceLedgerJson,
          canonFactCardsJson: sourceGrounding.canonFactCardsJson,
          contextVersion: nextContextVersion,
          updatedAt: recordedAt,
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

function buildStageContextMap(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  chapter: typeof chapters.$inferSelect,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
  draftRawContext?: Awaited<ReturnType<typeof collectChapterContextRawData>>,
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

function buildPreviewStageContextMap(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  chapter: typeof chapters.$inferSelect,
  preserveConstraintLabels?: HardConstraintSourceLabel[],
  draftRawContext?: Awaited<ReturnType<typeof collectChapterContextRawData>>,
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
  const buildStageContext = (promptProfile: ChapterContextStage) => {
    try {
      return allocateStageContextForPipeline(rawContext, chapter, complexity, promptProfile, undefined, preserveConstraintLabels)
    } catch (error) {
      if (error instanceof ContextOverflowError || error instanceof HardConstraintOverflowError) {
        return error.context
      }
      throw error
    }
  }

  return {
    complexity,
    contexts: {
      scenePlan: buildStageContext('scenePlan'),
      draft: (() => {
        try {
          return allocateStageContextForPipeline(draftRawContext || rawContext, chapter, complexity, 'draft', undefined, preserveConstraintLabels)
        } catch (error) {
          if (error instanceof ContextOverflowError || error instanceof HardConstraintOverflowError) {
            return error.context
          }
          throw error
        }
      })(),
      review: buildStageContext('review'),
      rewrite: buildStageContext('rewrite'),
    },
  }
}

async function continueChapterContent(
  chapterId: number,
  partialContent: string,
  sender?: WebContents,
  options: { executionMode?: AiExecutionMode; sourceTaskId?: number } = {},
): Promise<number> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })
  // Resume follows the same writing gate as a fresh generation. A partial
  // draft must not bypass missing chapter/scene contracts.
  validateChapterContractsForGeneration(chapterId)
  const normalizedPartial = partialContent.trim()
  if (!normalizedPartial) {
    throwUserFacingError('workflow.resumeUnsupported')
  }

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
  const writerContextResolutionPayload = await resolveWriterContextForStage(
    chapter,
    rawContext,
    options.executionMode,
    undefined,
    buildChapterContractVersion(chapterId),
    activePromptOverrideKeys,
  )
  const { complexity } = buildStageContextMap(rawContext, chapter)
  const draftResolution = allocateDraftContextWithWriterFallback(
    chapter,
    rawContext,
    writerContextResolutionPayload.effectiveRawContext,
    complexity,
    writerContextResolutionPayload.writerContextResolution,
  )
  let draftContext = draftResolution.draftContext
  const consistencyNotes = buildConsistencyPromptSummary(buildNovelConsistencyReport(chapter.novelId))
  const storyCore = buildStoryCore(profile, draftContext.storyCore)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel.settingsJson,
  })
  const stageReports = buildChapterAiStageReports(
    executionModeResolution.mode,
    executionModeResolution.source,
    novel.modelConfigId || undefined,
  )
  const writerChatOpts = buildChatOptionsFromRoute(stageReports[1].route)
  const continuationStepMemory = buildStepMemorySummary({
    chapterBridgePlan: draftContext.chapterBridgePlan,
    draftText: normalizedPartial,
    previousSummary: '这是断点续写任务：必须承接已保留正文，不得重启章节或改写已完成事实。',
  })
  draftContext = allocateStageContextForPipeline(
    applyUpstreamArtifactsToRawContext(draftResolution.effectiveRawContext, {
      stepMemorySummary: continuationStepMemory.summary,
    }),
    chapter,
    complexity,
    'draft',
  )
  const workflowTaskId = await createTask({
    type: 'chapter_write',
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    runnerType: 'workflow',
    pipelineRole: 'writer',
    pipelineStage: 'pending',
    progressJson: '{}',
    retryable: false,
    status: 'pending',
  })
  let snapshot = createInitialChapterPipelineSnapshot(chapterId, workflowTaskId, buildChapterContractVersion(chapterId))
  snapshot = {
    ...snapshot,
    executionMode: executionModeResolution.mode,
    writerContextResolution: draftResolution.writerContextResolution,
    stepMemory: continuationStepMemory,
    partialContent: normalizedPartial,
    resumeReason: undefined,
    resumeSourceTaskId: options.sourceTaskId,
  }

  const syncWorkflowTask = (extra: Partial<typeof tasks.$inferInsert> = {}) => {
    updateTaskProgress(workflowTaskId, snapshot, sender)
    updateTask(workflowTaskId, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: snapshot.status === 'success' ? 'success' : snapshot.status === 'cancelled' ? 'failed' : 'running',
      contractVersion: snapshot.contractVersion,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const setWorkflowTaskStatus = (
    status: 'running' | 'success' | 'failed' | 'cancelled',
    extra: Partial<typeof tasks.$inferInsert> = {},
  ) => {
    updateTaskStatus(workflowTaskId, status, sender, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: status === 'success' ? 'success' : status === 'cancelled' ? 'failed' : 'running',
      contractVersion: snapshot.contractVersion,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const continuationPrompt = buildContinuationPrompt(buildChapterWritingPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    chapterNum: chapter.chapterNum,
    chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
    chapterGoal: draftContext.chapterGoal,
    hardConstraintContext: draftContext.hardConstraintContext,
    dialogueVoiceLocks: draftContext.dialogueVoiceLocks,
    plotPoints: chapter.outline || '',
    emotionTone: chapter.emotionTone || '平稳',
    targetWords: resolveChapterReferenceWords(chapter.targetWords, novel.targetWords),
    storyCore,
    writingContractSummary: draftContext.writingContractSummary,
    relationSummary: draftContext.relationSummary,
    currentArc: draftContext.currentArc,
    worldRules: draftContext.worldRules,
    characterStates: draftContext.characterStates,
    worldStates: draftContext.worldStates,
    mapSummary: draftContext.mapSummary,
    itemSummary: draftContext.itemSummary,
    previousSummaries: draftContext.previousSummaries,
    previousChapterContext: draftContext.previousChapterContext,
    lastChapterEnding: draftContext.lastChapterEnding,
    styleTemplate: draftContext.styleTemplate,
    continuitySummary: draftContext.continuitySummary,
    openLoops: draftContext.openLoops,
    dueForeshadows: draftContext.dueForeshadows,
    continuityNotes: draftContext.continuityNotes,
    timelineSummary: draftContext.timelineSummary,
    timelineOpenThreads: draftContext.timelineOpenThreads,
    activeThreads: draftContext.activeThreads,
    recalledMemory: draftContext.recalledMemory,
    chapterBridgePlan: draftContext.chapterBridgePlan,
    stepMemorySummary: draftContext.stepMemorySummary,
    runtimeAssertions: continuationStepMemory.runtimeAssertions,
    protagonistReference: profile.protagonistReference,
    protagonistRule: profile.protagonistRule,
    promptTier: complexity,
  }), normalizedPartial)

  const messages = [{ role: 'user' as const, content: continuationPrompt }]
  const writerTaskId = await createTask({
    type: 'chapter_writer',
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    inputJson: JSON.stringify(messages),
    runnerType: 'stream',
    retryable: false,
    parentTaskId: workflowTaskId,
    pipelineRole: 'writer',
    pipelineStage: 'pending',
    upstreamTaskId: options.sourceTaskId,
    contractVersion: snapshot.contractVersion,
    recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer')),
    status: 'pending',
  })

  snapshot = {
    ...snapshot,
    currentRole: 'writer',
    currentStage: 'drafting',
    status: 'running',
    message: '正在基于已保留正文继续续写当前章节。',
    streamTaskId: writerTaskId,
    roles: {
      ...snapshot.roles,
      writer: {
        ...snapshot.roles.writer,
        status: 'running',
        detail: '正在基于已保留正文继续续写当前章节。',
        taskId: writerTaskId,
        upstreamTaskId: options.sourceTaskId,
        contractVersion: snapshot.contractVersion,
        startedAt: new Date().toISOString(),
      },
    },
  }
  syncWorkflowTask({ currentChildTaskId: writerTaskId, errorMessage: null })
  updateTask(writerTaskId, { pipelineStage: 'running' })
  sendPipelineProgress(sender, snapshot, {
    stage: 'drafting',
    label: '继续正文',
    detail: '系统正在基于已保留正文继续生成后续内容。',
    status: 'running',
    role: 'writer',
  })

  try {
    const continuationResult = await executeStreamTask(writerTaskId, {
      type: 'chapter_writer',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(messages),
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: writerChatOpts,
      sender,
      onChunk: async (_chunk, fullOutput) => {
        snapshot = {
          ...snapshot,
          partialContent: `${normalizedPartial}\n\n${fullOutput}`.trim(),
          resumeSourceTaskId: writerTaskId,
        }
        syncWorkflowTask()
      },
    })
    const combinedContent = `${normalizedPartial}\n\n${continuationResult.output}`.trim()
    updateChapter(chapterId, {
      content: combinedContent,
      status: 'draft',
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
    const finalizeResult = await finalizeGeneratedChapterContent(chapterId, combinedContent)
    snapshot = {
      ...snapshot,
      status: 'success',
      currentRole: 'finalize',
      currentStage: 'completed',
      message: '断点续写已完成并重新入稿。',
      partialContent: combinedContent,
      streamTaskId: undefined,
      roles: {
        ...snapshot.roles,
        writer: {
          ...snapshot.roles.writer,
          status: 'success',
          detail: '断点续写完成，正文已补齐。',
          finishedAt: new Date().toISOString(),
        },
        finalize: {
          ...snapshot.roles.finalize,
          status: 'success',
          detail: finalizeResult.nextChapterSeed
            ? `已完成断点续写，并刷新摘要与下一章接力：${finalizeResult.nextChapterSeed}`
            : '已完成断点续写，并刷新摘要与连续性状态。',
          taskId: workflowTaskId,
          startedAt: snapshot.roles.finalize.startedAt || new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        },
      },
    }
    setWorkflowTaskStatus('success', {
      currentChildTaskId: null,
      outputText: `断点续写已完成，第${chapter.chapterNum}章已重新入稿。`,
      errorMessage: null,
    })
    sendPipelineProgress(sender, snapshot, {
      stage: 'completed',
      label: '断点续写完成',
      detail: '系统已基于保留正文补齐后续内容，并刷新摘要与连续性状态。',
      status: 'success',
      role: 'finalize',
    })
    return workflowTaskId
  } catch (error) {
    snapshot = {
      ...snapshot,
      status: error instanceof Error && error.message.toLowerCase().includes('cancel')
        ? 'cancelled'
        : 'failed',
      message: error instanceof Error ? error.message : '断点续写失败',
      resumeReason: inferResumeReason(error),
      resumeSourceTaskId: writerTaskId,
      recoveryHint: buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer'),
      roles: {
        ...snapshot.roles,
        writer: {
          ...snapshot.roles.writer,
          status: 'failed',
          detail: error instanceof Error ? error.message : '断点续写失败',
          finishedAt: new Date().toISOString(),
          recoveryHint: buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer'),
        },
      },
    }
    setWorkflowTaskStatus(snapshot.status === 'cancelled' ? 'cancelled' : 'failed', {
      currentChildTaskId: null,
      outputText: snapshot.partialContent || normalizedPartial,
      errorMessage: error instanceof Error ? error.message : '断点续写失败',
    })
    sendPipelineProgress(sender, snapshot, {
      stage: 'drafting',
      label: snapshot.status === 'cancelled' ? '断点续写已取消' : '断点续写失败',
      detail: error instanceof Error ? error.message : '断点续写失败',
      status: snapshot.status === 'cancelled' ? 'cancelled' : 'failed',
      role: 'writer',
    })
    throw error
  }
}

const chapterGenerationLocks = new Map<number, Promise<number>>()

function buildChapterGenerationIdempotencyKey(chapter: typeof chapters.$inferSelect): string {
  const source = [
    chapter.id,
    chapter.contextVersion || 1,
    chapter.updatedAt || '',
    chapter.status || 'outline',
  ].join('|')
  return `chapter-write:${chapter.id}:${createHash('sha256').update(source).digest('hex').slice(0, 24)}`
}

function findExistingChapterGenerationTask(chapterId: number, idempotencyKey: string) {
  const db = getDb()
  return db.select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(
      eq(tasks.type, 'chapter_write'),
      eq(tasks.runnerType, 'workflow'),
      eq(tasks.relatedEntityType, 'chapter'),
      eq(tasks.relatedEntityId, chapterId),
      eq(tasks.idempotencyKey, idempotencyKey),
    ))
    .all()[0] || null
}

/**
 * Single-flight plus a durable idempotency key for one chapter generation
 * request. The in-memory promise handles same-process double clicks; the task
 * unique index and key make the request replay-safe across backend calls.
 */
export async function generateChapterContent(
  chapterId: number,
  sender?: WebContents,
  options: { executionMode?: AiExecutionMode; preserveConstraintLabels?: HardConstraintSourceLabel[] } = {},
): Promise<number> {
  const inFlight = chapterGenerationLocks.get(chapterId)
  if (inFlight) return inFlight

  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })
  const idempotencyKey = buildChapterGenerationIdempotencyKey(chapter)
  const existing = findExistingChapterGenerationTask(chapterId, idempotencyKey)
  if (existing && !isRetryableChapterGenerationStatus(existing.status)) return Number(existing.id)

  // A failed/cancelled run must not permanently consume the deterministic key.
  // Keep active/successful calls idempotent, while allowing the visible retry
  // action to create a fresh durable workflow task.
  const nextIdempotencyKey = buildChapterGenerationRequestKey(idempotencyKey, {
    existingStatus: existing?.status,
    retryToken: randomUUID(),
  })

  const run = generateChapterContentInternal(chapterId, sender, options, nextIdempotencyKey)
  chapterGenerationLocks.set(chapterId, run)
  try {
    return await run
  } finally {
    if (chapterGenerationLocks.get(chapterId) === run) chapterGenerationLocks.delete(chapterId)
  }
}

async function generateChapterContentInternal(
  chapterId: number,
  sender?: WebContents,
  options: { executionMode?: AiExecutionMode; preserveConstraintLabels?: HardConstraintSourceLabel[] } = {},
  idempotencyKey?: string,
): Promise<number> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const narrativeSceneSnapshots = loadNarrativeControlSceneSnapshots(chapterId)
  const narrativeControlCharacterNames = db.select({ name: characters.fullName })
    .from(characters)
    .where(eq(characters.novelId, chapter.novelId))
    .all()
    .map((row) => row.name || '')
    .filter(Boolean)
  const narrativeContractSignals = loadNarrativeContractSignals(chapterId)
  const consistencyNotes = buildConsistencyPromptSummary(buildNovelConsistencyReport(chapter.novelId))
  const previousStatus = chapter.status || 'outline'
  const fallbackScenePlan = buildFallbackScenePlan(chapter)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel.settingsJson,
  })
  let contractVersion = ''
  const workflowTaskId = await createTask({
    type: 'chapter_write',
    novelId: chapter.novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    idempotencyKey,
    runnerType: 'workflow',
    pipelineRole: 'planner',
    pipelineStage: 'pending',
    contractVersion: undefined,
    controlJson: JSON.stringify({ cancelRequested: false }),
    progressJson: '{}',
    retryable: false,
    status: 'pending',
  })
  let snapshot = createInitialChapterPipelineSnapshot(chapterId, workflowTaskId, contractVersion)
  snapshot = {
    ...snapshot,
    executionMode: executionModeResolution.mode,
  }
  let previousRoleTaskId: number | undefined
  let hasCommittedContent = false
  let latestUsableDraft = ''
  let latestReviewNotesJson = chapter.reviewNotesJson || ''

  const buildPipelineHoldReviewNotesJson = (
    role: ChapterPipelineRole,
    detail: string,
    failureCode?: ChapterPipelineFailureCode,
  ) => {
    const notes = parseStoredReviewNotes(latestReviewNotesJson || chapter.reviewNotesJson)
    const holdLine = `${getPipelineRoleLabel(role)} 未完成：${detail}。当前可用稿已保存为待人工审核/可重试状态。`
    const codeLine = failureCode ? `失败代码：${failureCode}` : ''
    const nextNotes: ChapterReviewNotes = {
      ...notes,
      summary: notes.summary || holdLine,
      critical_fixes: dedupeTextList([holdLine, codeLine, ...notes.critical_fixes]),
      revision_brief: appendRevisionBrief(notes.revision_brief, [
        '先人工确认当前保留稿，再按失败原因选择续跑或重新生成。',
      ]),
      rewrite_required: true,
      severity: mergeSeverity(notes.severity, 'medium'),
    }
    return JSON.stringify(nextNotes)
  }

  const preserveUsableDraftForReview = (
    role: ChapterPipelineRole,
    detail: string,
    failureCode?: ChapterPipelineFailureCode,
  ): boolean => {
    const usableDraft = latestUsableDraft.trim()
    if (!usableDraft) return false
    const resumableContent = snapshot.partialContent?.trim() || usableDraft
    updateChapter(chapterId, {
      content: usableDraft,
      reviewNotesJson: buildPipelineHoldReviewNotesJson(role, detail, failureCode),
      status: 'reviewing',
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
    hasCommittedContent = true
    snapshot = {
      ...snapshot,
      partialContent: resumableContent,
      resumeSourceTaskId: snapshot.resumeSourceTaskId,
    }
    return true
  }

  const getWorkflowPipelineStage = () => {
    if (snapshot.currentRole) {
      const currentRoleState = snapshot.roles[snapshot.currentRole]
      if (currentRoleState.status === 'blocked') return 'blocked'
      if (currentRoleState.status === 'failed') return 'failed'
      if (currentRoleState.status === 'success') return 'success'
      return currentRoleState.status === 'pending' ? 'pending' : 'running'
    }
    if (snapshot.status === 'success') return 'success'
    if (snapshot.status === 'failed' || snapshot.status === 'cancelled') return 'failed'
    return snapshot.status === 'pending' ? 'pending' : 'running'
  }

  const syncWorkflowTask = (extra: Partial<typeof tasks.$inferInsert> = {}) => {
    updateTaskProgress(workflowTaskId, snapshot, sender)
    updateTask(workflowTaskId, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: getWorkflowPipelineStage(),
      contractVersion: snapshot.contractVersion,
      canonRunId: snapshot.canonRunId,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const setWorkflowTaskStatus = (
    status: 'running' | 'success' | 'failed' | 'cancelled',
    extra: Partial<typeof tasks.$inferInsert> = {},
  ) => {
    updateTaskStatus(workflowTaskId, status, sender, {
      pipelineRole: snapshot.currentRole || undefined,
      pipelineStage: getWorkflowPipelineStage(),
      contractVersion: snapshot.contractVersion,
      canonRunId: snapshot.canonRunId,
      recoveryHintJson: serializeTaskRecoveryHint(snapshot.recoveryHint),
      progressJson: JSON.stringify(snapshot),
      ...extra,
    })
  }

  const startRoleTask = async (
    role: ChapterPipelineRole,
    type: 'chapter_planner' | 'chapter_writer' | 'chapter_critic' | 'chapter_rewriter' | 'chapter_canonizer' | 'chapter_finalize',
    detail: string,
    options: {
      inputJson?: string
      runnerType?: 'chat' | 'stream' | 'workflow'
      canonRunId?: number
    } = {},
  ) => {
    assertChapterPipelineActive(workflowTaskId)
    const childTaskId = await createTask({
      type,
      novelId: chapter.novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: options.inputJson,
      runnerType: options.runnerType || 'chat',
      retryable: false,
      parentTaskId: workflowTaskId,
      pipelineRole: role,
      pipelineStage: 'pending',
      upstreamTaskId: previousRoleTaskId,
      contractVersion,
      canonRunId: options.canonRunId,
      recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, role)),
      status: 'pending',
    })
    const now = new Date().toISOString()
    snapshot = {
      ...snapshot,
      currentRole: role,
      currentStage: getPipelineRoleStage(role),
      status: 'running',
      message: detail,
      streamTaskId: role === 'rewriter' ? childTaskId : undefined,
      recoveryHint: undefined,
      roles: {
        ...snapshot.roles,
        [role]: {
          ...snapshot.roles[role],
          status: 'running',
          detail,
          taskId: childTaskId,
          upstreamTaskId: previousRoleTaskId,
          contractVersion,
          canonRunId: options.canonRunId,
          startedAt: now,
          finishedAt: undefined,
          durationMs: undefined,
          tokensUsed: undefined,
          recoveryHint: undefined,
        },
      },
    }
    syncWorkflowTask({
      currentChildTaskId: childTaskId,
      errorMessage: null,
    })
    updateTask(childTaskId, { pipelineStage: 'running' })
    sendPipelineProgress(sender, snapshot, {
      stage: getPipelineRoleStage(role),
      label: snapshot.roles[role].label,
      detail,
      status: 'running',
      role,
    })
    return childTaskId
  }

  const finishRoleTask = (
    role: ChapterPipelineRole,
    taskId: number,
    detail: string,
    extra: Partial<ChapterPipelineRoleState> = {},
  ) => {
    snapshot = refreshPipelineRoleMetrics(snapshot, role, taskId)
    snapshot = {
      ...snapshot,
      message: detail,
      streamTaskId: role === 'rewriter' ? undefined : snapshot.streamTaskId,
      canonRunId: extra.canonRunId ?? snapshot.canonRunId,
      recoveryHint: undefined,
      roles: {
        ...snapshot.roles,
        [role]: {
          ...snapshot.roles[role],
          status: 'success',
          detail,
          finishedAt: new Date().toISOString(),
          recoveryHint: undefined,
          failureCode: undefined,
          rewriteScope: undefined,
          targetSegmentId: undefined,
          ...extra,
        },
      },
      failureCode: undefined,
      rewriteScope: undefined,
      targetSegmentId: undefined,
      lastFailureRole: undefined,
    }
    updateTask(taskId, {
      pipelineStage: 'success',
      canonRunId: snapshot.canonRunId,
      recoveryHintJson: null,
      contractVersion: snapshot.contractVersion,
    })
    syncWorkflowTask({
      currentChildTaskId: null,
      errorMessage: null,
      recoveryHintJson: null,
    })
    previousRoleTaskId = taskId
  }

  const failRoleTask = (
    role: ChapterPipelineRole,
    taskId: number | undefined,
    error: unknown,
    options: { blocked?: boolean } = {},
  ): never => {
    const aborted = isChapterPipelineAbortError(workflowTaskId, error) || (typeof taskId === 'number' && isChapterPipelineAbortError(taskId, error))
    const detail = error instanceof Error ? error.message : `${getPipelineRoleLabel(role)} 执行失败`
    const failure = classifyChapterPipelineFailure(role, error)
    const blocked = options.blocked || failure.blocked
    const recoveryHint = buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, role, failure.code)
    const outputText = failure.outputText || (failure.code
      ? buildPipelineFailureOutput(failure.code, detail, {
        rewriteScope: failure.rewriteScope,
        targetSegmentId: failure.targetSegmentId,
      })
      : undefined)

    if (typeof taskId === 'number') {
      updateTask(taskId, {
        pipelineStage: blocked ? 'blocked' : 'failed',
        recoveryHintJson: serializeTaskRecoveryHint(recoveryHint),
        contractVersion: snapshot.contractVersion,
        canonRunId: snapshot.canonRunId,
        outputText,
      })
      snapshot = refreshPipelineRoleMetrics(snapshot, role, taskId)
    }

    snapshot = {
      ...snapshot,
      currentRole: role,
      currentStage: getPipelineRoleStage(role),
      status: aborted ? 'cancelled' : 'failed',
      message: detail,
      streamTaskId: undefined,
      recoveryHint,
      failureCode: failure.code,
      rewriteScope: failure.rewriteScope,
      targetSegmentId: failure.targetSegmentId,
      lastFailureRole: role,
      resumeReason: aborted ? 'cancelled' : inferResumeReason(error),
      resumeSourceTaskId: taskId ?? snapshot.resumeSourceTaskId,
      roles: {
        ...snapshot.roles,
        [role]: {
          ...snapshot.roles[role],
          status: blocked ? 'blocked' : 'failed',
          detail,
          taskId: taskId ?? snapshot.roles[role].taskId,
          finishedAt: new Date().toISOString(),
          recoveryHint,
          failureCode: failure.code,
          rewriteScope: failure.rewriteScope,
          targetSegmentId: failure.targetSegmentId,
        },
      },
    }

    const preservedDraft = !aborted && preserveUsableDraftForReview(role, detail, failure.code)
    if (!preservedDraft && !hasCommittedContent) {
      updateChapter(chapterId, { status: previousStatus }, { versionSource: false })
    } else if (!preservedDraft) {
      updateChapter(chapterId, { status: blocked ? 'reviewing' : 'draft' }, { skipStaleTracking: true, versionSource: false })
    }

    setWorkflowTaskStatus(aborted ? 'cancelled' : 'failed', {
      currentChildTaskId: null,
      errorMessage: aborted ? '用户已取消' : detail,
      pipelineStage: blocked ? 'blocked' : 'failed',
      outputText,
    })
    sendPipelineProgress(sender, snapshot, {
      stage: getPipelineRoleStage(role),
      label: aborted ? '章节流水线已取消' : `${snapshot.roles[role].label} 失败`,
      detail,
      status: aborted ? 'cancelled' : 'failed',
      role,
    })
    throw error instanceof Error ? error : new Error(detail)
  }

  try {
    const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
    const complexity = classifyChapterComplexity({
      chapter,
      currentArc: rawContext.currentArc,
      chapterRows: rawContext.chapterRows,
      outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
      activeThreadPressureCount: rawContext.activeThreadPressureCount,
    })
    const scenePlanResolution = await resolveStageContextForPipeline(
      'scenePlan',
      chapter,
      rawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
        upstreamArtifacts: {
          contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        },
      },
    )
    const draftResolution = await resolveStageContextForPipeline(
      'draft',
      chapter,
      rawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
      },
    )
    let scenePlanContext = scenePlanResolution.context
    let draftContext = draftResolution.context
    let reviewContext = (await resolveStageContextForPipeline(
      'review',
      chapter,
      draftResolution.effectiveRawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
        upstreamArtifacts: {
          contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        },
      },
    )).context
    let rewriteContext = (await resolveStageContextForPipeline(
      'rewrite',
      chapter,
      draftResolution.effectiveRawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
        upstreamArtifacts: {
          contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        },
      },
    )).context
    const linkedImpacts = listActiveImpactsForChapter(chapter.novelId, chapter.id)
    const usageSnapshot = buildWritingContextUsageSnapshot(draftResolution.effectiveRawContext, draftContext, linkedImpacts)
    const contextAssemblyReport = buildChapterContextAssemblyReport(draftContext, usageSnapshot)
    const authorStyleLock = buildAuthorStyleLockSummary(chapter.novelId, novel.themeVoiceJson)
    let stageReports = buildChapterAiStageReports(
      executionModeResolution.mode,
      executionModeResolution.source,
      novel.modelConfigId || undefined,
    )
    const plannerChatOpts = buildChatOptionsFromRoute(stageReports[0].route)
    const writerChatOpts = buildChatOptionsFromRoute(stageReports[1].route)
    const criticChatOpts = buildChatOptionsFromRoute(stageReports[2].route)
    let generationExplainability = buildAiExplainabilityReport({
      taskKind: 'chapter_generation',
      executionMode: executionModeResolution.mode,
      usageSnapshot,
      stageReports,
      contextAssemblyReport,
      authorStyleLock,
      structuredOutputs: [
        '场景计划 JSON',
        '审校意见 JSON',
        'Canon 差异草案',
      ],
      activePromptOverrideKeys,
    })
    logConstraintInjectionStatus('scenePlan', scenePlanContext)
    logConstraintInjectionStatus('draft', draftContext)
    logConstraintInjectionStatus('review', reviewContext)
    logConstraintInjectionStatus('rewrite', rewriteContext)
    const buildWritingGuidance = (styleTemplate: string) => [
      styleTemplate ? `Writing style guide:\n${styleTemplate}` : '',
      consistencyNotes,
    ].filter(Boolean).join('\n\n')
    const draftWritingGuidance = buildWritingGuidance(draftContext.styleTemplate)
    let rewriteWritingGuidance = buildWritingGuidance(rewriteContext.styleTemplate)
    const storyCore = buildStoryCore(profile, rewriteContext.storyCore || draftContext.storyCore || scenePlanContext.storyCore)
    const currentArcRow = rawContext.currentArc
    const latestArcProgressNote = getLatestArcProgressNote(chapter.novelId, currentArcRow, chapter.chapterNum)
    const structuralAlertsSummary = buildStructuralAlertsSummary(chapter.novelId, chapter.chapterNum, chapter.volumeId)
    const chapterBridgePlan = buildChapterBridgePlan(chapterId, {
      themeVoice,
      chapterGoal: scenePlanContext.chapterGoal,
    })
    const chapterBridgePlanText = formatChapterBridgePlan(chapterBridgePlan)
    const povRotationPlan = buildPovRotationPlan(chapterId, themeVoice)
    const formatPovRotationGuidance = (plan: PovRotationPlan) => [
      plan.recommendedPov ? `推荐 POV：${plan.recommendedPov}` : '',
      plan.previousPov ? `上一章 POV：${plan.previousPov}` : '',
      plan.reason,
      `信息差边界：${plan.infoGapGuard}`,
      plan.warnings.length > 0 ? `风险：${plan.warnings.join('；')}` : '',
    ].filter(Boolean).join('\n')
    const basePacingCurve = buildStoryPacingCurve(
      chapter.novelId,
      chapter.chapterNum,
      chapter.emotionTone || '平稳',
    )
    const formatPacingGuidance = (curve: StoryPacingCurve) => [
      `目标节奏位：${curve.targetMarker}`,
      curve.actualMarker ? `当前节奏线索：${curve.actualMarker}` : '',
      curve.guidance,
      curve.recentClimaxSpacing.length > 0 ? `近期高潮间距：${curve.recentClimaxSpacing.join(' / ')}` : '',
      curve.warning || '',
    ].filter(Boolean).join('\n')
    const baseHookContinuity = buildHookContinuitySnapshot(chapterId)
    const formatHookContinuityGuidance = (snapshotValue: HookContinuitySnapshot) => [
      snapshotValue.hookType ? `合同钩子：${snapshotValue.hookType}` : '当前章节合同尚未定义钩子类型。',
      snapshotValue.unresolvedHookChain.length > 0 ? `承接链：${snapshotValue.unresolvedHookChain.join('；')}` : '',
      snapshotValue.weakHookStreak > 0 ? `连续弱钩子：${snapshotValue.weakHookStreak} 章` : '',
      snapshotValue.warning || '',
    ].filter(Boolean).join('\n')
    const generationExpressionDedup = analyzeExpressionDedupForGeneration(chapter.novelId, chapter.chapterNum, {
      currentVolumeId: chapter.volumeId ?? null,
    })
    const previousSummaryHealth = chapterBridgePlan?.sourceChapterId
      ? analyzeSummaryHealthForChapter(chapterBridgePlan.sourceChapterId)
      : null
    const formatSummaryHealthGuidance = (report: SummaryHealthReport | null | undefined) => report
      ? [
          `摘要健康：${report.status}`,
          `密度 ${report.densityScore} / 实体覆盖 ${report.entityCoverageScore} / 事件覆盖 ${report.eventCoverageScore}`,
          report.warnings.join('；'),
        ].filter(Boolean).join('\n')
      : ''
    const voiceEvolutionProfiles = buildVoiceEvolutionProfiles(chapter.novelId)
    const formatVoiceEvolutionGuidance = (profiles: VoiceEvolutionProfile[]) => profiles.length > 0
      ? profiles
        .slice(0, 3)
        .map((profileItem) => [
          `${profileItem.characterName}：${profileItem.summary}`,
          profileItem.stableAnchors.length > 0 ? `稳定锚点：${profileItem.stableAnchors.join('；')}` : '',
          profileItem.allowedChanges.length > 0 ? `允许变化：${profileItem.allowedChanges.join('；')}` : '',
        ].filter(Boolean).join('\n'))
        .join('\n\n')
      : ''
    const buildNarrativeControlReport = (
      chapterGoal: string,
      content?: string,
      chapterFunction?: string,
    ) => analyzeNarrativeControls({
      themeVoice,
      sceneSnapshots: narrativeSceneSnapshots,
      characterNames: narrativeControlCharacterNames,
      content,
      chapterGoal,
      emotionTone: chapter.emotionTone || '平稳',
      emotionFocus: narrativeContractSignals.emotionFocus,
      expositionMode: narrativeContractSignals.expositionMode,
      chapterFunction,
      genre: profile.genre,
    })
    const formatNarrativePromptFields = (report: ReturnType<typeof buildNarrativeControlReport>) => ({
      povGuidance: [
        report.promptGuidance.povGuidance,
        contentReportLine(report.pov.summary),
        report.pov.status !== 'pass' ? `修正方向：${report.pov.fixHint}` : '',
      ].filter(Boolean).join('\n'),
      sensoryGuidance: [
        report.promptGuidance.sensoryGuidance,
        contentReportLine(report.sensory.summary),
        report.sensory.status !== 'pass' ? `修正方向：${report.sensory.fixHint}` : '',
      ].filter(Boolean).join('\n'),
      narrativeRatioGuidance: [
        report.promptGuidance.narrativeRatioGuidance,
        contentReportLine(report.narrativeRatio.summary),
        report.narrativeRatio.deviationReasons.length > 0
          ? `当前偏移：${report.narrativeRatio.deviationReasons.slice(0, 3).join('；')}`
          : '',
        report.narrativeRatio.status !== 'pass' ? `修正方向：${report.narrativeRatio.fixHint}` : '',
        contentReportLine(report.transitionDensity.summary),
        report.transitionDensity.status !== 'pass' ? `过渡修正：${report.transitionDensity.fixHint}` : '',
        contentReportLine(report.emotionFocus.summary),
        report.emotionFocus.status !== 'pass' ? `情绪修正：${report.emotionFocus.fixHint}` : '',
        contentReportLine(report.exposition.summary),
        report.exposition.status !== 'pass' ? `说明修正：${report.exposition.fixHint}` : '',
      ].filter(Boolean).join('\n'),
    })
    const plannerNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(scenePlanContext.chapterGoal))
    const draftNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(draftContext.chapterGoal))
    const initialStepMemory = buildStepMemorySummary({
      chapterBridgePlan: chapterBridgePlanText,
      previousSummary: buildContractVersionArtifactSummary(contractVersion),
    })
    scenePlanContext = allocateStageContextForPipeline(
      applyUpstreamArtifactsToRawContext(scenePlanResolution.effectiveRawContext, {
        stepMemorySummary: initialStepMemory.summary,
      }),
      chapter,
      complexity,
      'scenePlan',
      undefined,
      options.preserveConstraintLabels,
    )
    snapshot = {
      ...snapshot,
      recallSnapshot: draftContext.recallSnapshot,
      recallDiagnostics: draftContext.recallDiagnostics,
      contextAssemblyReport,
      authorStyleLock,
      generationExplainability,
      writerContextResolution: draftResolution.writerContextResolution,
      stepMemory: initialStepMemory,
    }
    try {
      persistChapterRecallRuntimeSnapshot({
        novelId: chapter.novelId,
        chapterId,
        recallSnapshot: draftContext.recallSnapshot,
        recallDiagnostics: draftContext.recallDiagnostics,
        source: 'runtime',
        sourceTaskId: workflowTaskId,
        contextVersion: chapter.contextVersion || novel.contextVersion || 1,
      })
    } catch (error) {
      console.warn(`[chapter] failed to persist recall runtime snapshot for chapter ${chapterId}:`, error)
    }

    updateChapter(chapterId, {
      status: 'writing',
      scenePlanJson: '',
      reviewNotesJson: '',
      bridgePlanJson: chapterBridgePlan ? JSON.stringify(chapterBridgePlan) : '',
    }, { versionSource: false })
    updateTaskProgress(workflowTaskId, snapshot, sender)
    setWorkflowTaskStatus('running', {
      currentChildTaskId: null,
      errorMessage: null,
    })

    const plannerMessages = [{
      role: 'user' as const,
      content: buildScenePlanPrompt({
        novelTitle: novel.title,
        genre: profile.genre,
        chapterNum: chapter.chapterNum,
        chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
        chapterGoal: scenePlanContext.chapterGoal,
        hardConstraintContext: scenePlanContext.hardConstraintContext,
        dialogueVoiceLocks: scenePlanContext.dialogueVoiceLocks,
        plotPoints: chapter.outline || '',
        emotionTone: chapter.emotionTone || '平稳',
        targetWords: resolveChapterReferenceWords(chapter.targetWords, novel.targetWords),
        storyCore,
        writingContractSummary: scenePlanContext.writingContractSummary,
        relationSummary: scenePlanContext.relationSummary,
        currentArc: scenePlanContext.currentArc,
        worldRules: scenePlanContext.worldRules,
        characterStates: scenePlanContext.characterStates,
        worldStates: scenePlanContext.worldStates,
        mapSummary: scenePlanContext.mapSummary,
        itemSummary: scenePlanContext.itemSummary,
        previousSummaries: scenePlanContext.previousSummaries,
        previousChapterContext: scenePlanContext.previousChapterContext,
        lastChapterEnding: scenePlanContext.lastChapterEnding,
        chapterBridgePlan: scenePlanContext.chapterBridgePlan,
        stepMemorySummary: scenePlanContext.stepMemorySummary,
        runtimeAssertions: initialStepMemory.runtimeAssertions,
        continuitySummary: scenePlanContext.continuitySummary,
        openLoops: scenePlanContext.openLoops,
        dueForeshadows: scenePlanContext.dueForeshadows,
        continuityNotes: scenePlanContext.continuityNotes,
        timelineSummary: scenePlanContext.timelineSummary,
        timelineOpenThreads: scenePlanContext.timelineOpenThreads,
        longTermMemory: scenePlanContext.longTermMemory,
        recalledMemory: scenePlanContext.recalledMemory,
        consistencyNotes,
        activeThreads: scenePlanContext.activeThreads,
        ...plannerNarrativeFields,
        povRotationGuidance: formatPovRotationGuidance(povRotationPlan),
        storyPacingGuidance: formatPacingGuidance(basePacingCurve),
        hookContinuityGuidance: formatHookContinuityGuidance(baseHookContinuity),
        expressionDedupGuidance: formatExpressionDedupGuidance(generationExpressionDedup),
        summaryHealthGuidance: formatSummaryHealthGuidance(previousSummaryHealth),
        voiceEvolutionGuidance: formatVoiceEvolutionGuidance(voiceEvolutionProfiles),
        protagonistReference: profile.protagonistReference,
        protagonistRule: profile.protagonistRule,
        promptTier: complexity,
      }),
    }]
    const plannerTaskId = await startRoleTask('planner', 'chapter_planner', '先把章节合同落成可执行的场景链。', {
      inputJson: JSON.stringify(plannerMessages),
      runnerType: 'chat',
    })
    try {
      validateChapterContractsForGeneration(chapterId)
      contractVersion = buildChapterContractVersion(chapterId)
      snapshot = {
        ...snapshot,
        contractVersion,
        roles: {
          ...snapshot.roles,
          planner: {
            ...snapshot.roles.planner,
            contractVersion,
          },
        },
      }
      syncWorkflowTask()
      updateTask(plannerTaskId, { contractVersion })
    } catch (error) {
      failRoleTask('planner', plannerTaskId, new ChapterPipelineStageError(
        'contract_blocked',
        error instanceof Error ? error.message : '章节流水线启动前合同校验未通过。',
        {
          blocked: true,
          rewriteScope: 'contract_replan',
          outputText: buildPipelineFailureOutput(
            'contract_blocked',
            error instanceof Error ? error.message : '章节流水线启动前合同校验未通过。',
            { rewriteScope: 'contract_replan' },
          ),
          cause: error,
        },
      ), { blocked: true })
    }
    const scenePlanResult = await executeChatTask(plannerTaskId, {
      type: 'chapter_planner',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(plannerMessages),
      messages: plannerMessages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: plannerChatOpts,
      // Keep the child task workflow-owned (retryable=false at creation), but
      // allow one bounded retry for a transient provider failure before the
      // whole chapter is held for review.
      retryable: true,
      sender,
    })
    const scenePlanParse = parseAiJsonResult<unknown>(scenePlanResult, 'array', {
      channel: 'chapter',
      message: '章节场景规划 JSON 解析失败，已回退到后备场景计划继续生成。',
      consoleSummary: `[chapter:warn] scene-plan-json-fallback chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'scene-plan',
      },
    })
    const rawScenePlan = scenePlanParse.success
      ? normalizeScenePlan(scenePlanParse.data, fallbackScenePlan)
      : fallbackScenePlan
    const scenePlanReconciliation = reconcileScenePlanForContracts(
      rawScenePlan,
      loadScenePlanContractSeeds(chapterId),
    )
    const scenePlan = scenePlanReconciliation.plan
    if (scenePlanReconciliation.corrections.length > 0) {
      console.warn(
        `[chapter:plan] 已按章节合同收口场景计划 chapter=${chapterId}：${scenePlanReconciliation.corrections.join('；')}`,
      )
    }

    updateChapter(chapterId, { scenePlanJson: JSON.stringify(scenePlan) })
    const scenePlanText = formatScenePlan(scenePlan)
    const writerStepMemory = buildStepMemorySummary({
      chapterBridgePlan: chapterBridgePlanText,
      scenePlanText,
      previousSummary: 'Planner 已固化场景计划，下一步 Writer 必须逐场落正文。',
    })
    draftContext = allocateStageContextForPipeline(
      applyUpstreamArtifactsToRawContext(draftResolution.effectiveRawContext, {
        scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        stepMemorySummary: writerStepMemory.summary,
      }),
      chapter,
      complexity,
      'draft',
      undefined,
      options.preserveConstraintLabels,
    )
    snapshot = {
      ...snapshot,
      stepMemory: writerStepMemory,
    }
    syncWorkflowTask()
    finishRoleTask('planner', plannerTaskId, `场景计划已固化 ${scenePlan.length} 段。`)

    const writerMessages = [{
      role: 'user' as const,
      content: buildChapterDraftPrompt({
        novelTitle: novel.title,
        genre: profile.genre,
        chapterNum: chapter.chapterNum,
        chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
        chapterGoal: draftContext.chapterGoal,
        hardConstraintContext: draftContext.hardConstraintContext,
        dialogueVoiceLocks: draftContext.dialogueVoiceLocks,
        emotionTone: chapter.emotionTone || '平稳',
        targetWords: resolveChapterReferenceWords(chapter.targetWords, novel.targetWords),
        storyCore,
        writingContractSummary: draftContext.writingContractSummary,
        relationSummary: draftContext.relationSummary,
        currentArc: draftContext.currentArc,
        worldRules: draftContext.worldRules,
        characterStates: draftContext.characterStates,
        worldStates: draftContext.worldStates,
        mapSummary: draftContext.mapSummary,
        itemSummary: draftContext.itemSummary,
        previousSummaries: draftContext.previousSummaries,
        previousChapterContext: draftContext.previousChapterContext,
        lastChapterEnding: draftContext.lastChapterEnding,
        chapterBridgePlan: draftContext.chapterBridgePlan,
        stepMemorySummary: draftContext.stepMemorySummary,
        runtimeAssertions: writerStepMemory.runtimeAssertions,
        continuitySummary: draftContext.continuitySummary,
        openLoops: draftContext.openLoops,
        dueForeshadows: draftContext.dueForeshadows,
        continuityNotes: draftContext.continuityNotes,
        timelineSummary: draftContext.timelineSummary,
        timelineOpenThreads: draftContext.timelineOpenThreads,
        longTermMemory: draftContext.longTermMemory,
        recalledMemory: draftContext.recalledMemory,
        consistencyNotes: draftWritingGuidance,
        structuralAlertsSummary,
        scenePlan: scenePlanText,
        draftContent: '',
        reviewNotes: '',
        activeThreads: draftContext.activeThreads,
        ...draftNarrativeFields,
        povRotationGuidance: formatPovRotationGuidance(povRotationPlan),
        storyPacingGuidance: formatPacingGuidance(basePacingCurve),
        hookContinuityGuidance: formatHookContinuityGuidance(baseHookContinuity),
        expressionDedupGuidance: formatExpressionDedupGuidance(generationExpressionDedup),
        summaryHealthGuidance: formatSummaryHealthGuidance(previousSummaryHealth),
        voiceEvolutionGuidance: formatVoiceEvolutionGuidance(voiceEvolutionProfiles),
        protagonistReference: profile.protagonistReference,
        protagonistRule: profile.protagonistRule,
        promptTier: complexity,
      }),
    }]
    const writerTaskId = await startRoleTask('writer', 'chapter_writer', 'Writer 正在按章节合同与场景计划生成正文初稿。', {
      inputJson: JSON.stringify(writerMessages),
      runnerType: 'chat',
    })
    try {
      assertContractDrivenWriterInputs('writer', contractVersion, draftContext.writingContractSummary, scenePlanText)
    } catch (error) {
      updateTaskStatus(writerTaskId, 'failed', sender, {
        pipelineStage: 'blocked',
        errorMessage: error instanceof Error ? error.message : 'Writer 缺少合同输入',
        recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'writer')),
      })
      failRoleTask('writer', writerTaskId, error, { blocked: true })
    }
    const draftContentRaw = await executeChatTask(writerTaskId, {
      type: 'chapter_writer',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(writerMessages),
      messages: writerMessages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: writerChatOpts,
      retryable: true,
      sender,
    })
    const chapterTitleForCheck = chapter.title || getDefaultChapterTitle(chapter.chapterNum)
    const draftHeading = stripChapterHeadingNoise(draftContentRaw, chapter.chapterNum, chapterTitleForCheck)
    const draftContent = draftHeading.content
    const draftTitleMismatchRisk = buildTitleMismatchRisk(draftHeading.detectedTitle, chapterTitleForCheck, chapter.chapterNum)
    const chapterWordTarget = resolveChapterReferenceWords(chapter.targetWords, novel.targetWords)
    latestUsableDraft = draftContent.trim()
    if (!latestUsableDraft) {
      failRoleTask('writer', writerTaskId, new ChapterPipelineStageError(
        'empty_output',
        'Writer 未返回可用正文，已阻断后续审校与回写；请重试或检查模型输出。',
        {
          outputText: buildPipelineFailureOutput(
            'empty_output',
            'Writer 未返回可用正文，已阻断后续审校与回写。',
          ),
        },
      ))
    }
    if (latestUsableDraft) {
      updateChapter(chapterId, {
        content: latestUsableDraft,
        status: 'reviewing',
      }, {
        skipStaleTracking: true,
        versionSource: false,
      })
      hasCommittedContent = true
      snapshot = {
        ...snapshot,
        partialContent: latestUsableDraft,
        resumeSourceTaskId: writerTaskId,
      }
      syncWorkflowTask({
        outputText: 'Writer 初稿已保存为待人工审核/可重试草稿。',
      })
    }
    finishRoleTask('writer', writerTaskId, '正文初稿已生成，等待 Critic 审校。')
    const lockedParagraphContext = buildLockedParagraphContext(chapter, draftContent)
    const criticStepMemory = buildStepMemorySummary({
      chapterBridgePlan: chapterBridgePlanText,
      scenePlanText,
      draftText: lockedParagraphContext.promptDraftContent,
      previousSummary: 'Writer 已交付初稿，Critic 必须核对场景计划、接力断言、开篇追读和无来源新增。',
    })
    snapshot = {
      ...snapshot,
      stepMemory: criticStepMemory,
    }
    const reviewUpstreamArtifacts: UpstreamRuntimeArtifacts = {
      scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
      draftTextSummary: summarizeStageArtifactText(lockedParagraphContext.promptDraftContent, 680),
      contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
      stepMemorySummary: criticStepMemory.summary,
      runtimeAssertions: criticStepMemory.runtimeAssertions,
      publishGateRiskSummary: summarizeStageArtifactLines([
        structuralAlertsSummary,
        consistencyNotes,
      ], 4, 520),
    }
    reviewContext = (await resolveStageContextForPipeline(
      'review',
      chapter,
      draftResolution.effectiveRawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
        upstreamArtifacts: reviewUpstreamArtifacts,
      },
    )).context
    logConstraintInjectionStatus('review', reviewContext)
    const reviewNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(reviewContext.chapterGoal, draftContent))

    let reviewNotes = buildFallbackReviewNotes(consistencyNotes)

    // 语义评审门策略：off 保持关键词门原始行为；shadow 只落库观察；enforce 由语义
    // verdict 接管阻断，关键词门降级为提示。critic 阶段的语义门调用不计入
    // maxSemanticCallsPerChapter 预算（预算只约束修复复评与 golden_final 加验）。
    const semanticGatePolicy = resolveSemanticGatePolicy(novel.settingsJson)
    let effectiveSemanticGateMode = semanticGatePolicy.mode
    let semanticGateCallsUsed = 0
    let criticSemanticReview: SemanticGateReview | null = null

    const criticMessages = [{
      role: 'user' as const,
      content: buildChapterReviewPrompt({
        novelTitle: novel.title,
        genre: profile.genre,
        chapterNum: chapter.chapterNum,
        chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
        chapterGoal: reviewContext.chapterGoal,
        hardConstraintContext: reviewContext.hardConstraintContext,
        dialogueVoiceLocks: reviewContext.dialogueVoiceLocks,
        storyCore,
        writingContractSummary: reviewContext.writingContractSummary,
        relationSummary: reviewContext.relationSummary,
        currentArc: reviewContext.currentArc,
        worldRules: reviewContext.worldRules,
        characterStates: reviewContext.characterStates,
        worldStates: reviewContext.worldStates,
        mapSummary: reviewContext.mapSummary,
        itemSummary: reviewContext.itemSummary,
        previousChapterContext: reviewContext.previousChapterContext,
        chapterBridgePlan: reviewContext.chapterBridgePlan,
        stepMemorySummary: reviewContext.stepMemorySummary,
        runtimeAssertions: reviewUpstreamArtifacts.runtimeAssertions,
        continuitySummary: reviewContext.continuitySummary,
        openLoops: reviewContext.openLoops,
        dueForeshadows: reviewContext.dueForeshadows,
        timelineSummary: reviewContext.timelineSummary,
        longTermMemory: reviewContext.longTermMemory,
        recalledMemory: reviewContext.recalledMemory,
        consistencyNotes,
        structuralAlertsSummary,
        arcProgress: latestArcProgressNote,
        arcProgressStatus: buildArcProgressStatus(currentArcRow, chapter.chapterNum),
        arcProgressCheckpoint: buildArcProgressCheckpoint(currentArcRow, chapter.chapterNum),
        scenePlan: scenePlanText,
        draftContent,
        ...reviewNarrativeFields,
        povRotationGuidance: formatPovRotationGuidance(povRotationPlan),
        storyPacingGuidance: formatPacingGuidance(basePacingCurve),
        hookContinuityGuidance: formatHookContinuityGuidance(baseHookContinuity),
        expressionDedupGuidance: formatExpressionDedupGuidance(generationExpressionDedup),
        summaryHealthGuidance: formatSummaryHealthGuidance(previousSummaryHealth),
        voiceEvolutionGuidance: formatVoiceEvolutionGuidance(voiceEvolutionProfiles),
        scenePlanSummary: reviewContext.scenePlanSummary,
        draftTextSummary: reviewContext.draftTextSummary,
        contractVersionSummary: reviewContext.contractVersionSummary,
        reviewRiskSummary: reviewContext.reviewRiskSummary,
        reviewProofSummary: reviewContext.reviewProofSummary,
        publishGateRiskSummary: reviewContext.publishGateRiskSummary,
        protagonistReference: profile.protagonistReference,
        protagonistRule: profile.protagonistRule,
        promptTier: complexity,
      }),
    }]
    const criticTaskId = await startRoleTask('critic', 'chapter_critic', 'Critic 正在检查连续性、节奏、角色口吻与语言问题。', {
      inputJson: JSON.stringify(criticMessages),
      runnerType: 'chat',
    })
    try {
      assertContractDrivenWriterInputs('critic', contractVersion, reviewContext.writingContractSummary, scenePlanText)
    } catch (error) {
      updateTaskStatus(criticTaskId, 'failed', sender, {
        pipelineStage: 'blocked',
        errorMessage: error instanceof Error ? error.message : 'Critic 缺少合同输入',
        recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'critic')),
      })
      failRoleTask('critic', criticTaskId, error, { blocked: true })
    }
    const reviewResult = await executeChatTask(criticTaskId, {
      type: 'chapter_critic',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(criticMessages),
      messages: criticMessages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: criticChatOpts,
      retryable: true,
      sender,
    })
    const reviewParse = parseAiJsonResult<unknown>(reviewResult, 'object', {
      channel: 'chapter',
      message: '章节审校 JSON 解析失败，已回退到后备审校意见继续生成。',
      consoleSummary: `[chapter:warn] review-json-fallback chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'review',
      },
    })
    if (reviewParse.success) {
      const normalizedNotes = normalizeReviewNotes(reviewParse.data, { chapterContent: draftContent })
      reviewNotes = hasReviewNotes(normalizedNotes) ? normalizedNotes : reviewNotes
    }

    reviewNotes = enhanceReviewNotesWithGuardrails(reviewNotes, draftContent, profile.genre)
    reviewNotes = applyHumanizationAnalysisToReviewNotes(reviewNotes, draftContent, {
      chapterId,
      genre: profile.genre,
      chapterFunction: reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
      emotionTone: chapter.emotionTone || '',
    })
    reviewNotes = applyDialogueAnalysisToReviewNotes(reviewNotes, chapter.novelId, chapter.chapterNum, draftContent)
    reviewNotes = applyStyleComplianceToReviewNotes(reviewNotes, chapter.novelId, draftContent)
    reviewNotes = applyReadingExperienceToReviewNotes(reviewNotes, draftContent)
    reviewNotes = applyWordShapeObservation(reviewNotes, draftContent, chapterWordTarget)
    if (draftTitleMismatchRisk) {
      reviewNotes = {
        ...reviewNotes,
        title_alignment_risks: dedupeTextList([...reviewNotes.title_alignment_risks, draftTitleMismatchRisk]),
      }
    }
    reviewNotes = applyContractValidationToReviewNotes(reviewNotes, validateChapterContractDelivery({
      chapterId,
      content: draftContent,
      reviewNotes,
    }, { advisoryOnly: effectiveSemanticGateMode === 'enforce' }))
    const glossaryTerms = db.select({ term: glossary.term }).from(glossary)
      .where(eq(glossary.novelId, chapter.novelId))
      .all()
      .map((row) => row.term || '')
      .filter(Boolean)
    // Repetition repair must know which names, items, locations and glossary
    // terms are canonical. Otherwise a legitimate term such as “锅炉” or a
    // three-character character name can be mistaken for AI-style prose.
    const guardrailKnownTerms = collectTrackedEntityNames(chapter.novelId)
    reviewNotes = applyHistoricalGroundingToReviewNotes(reviewNotes, {
      genreName: profile.genre,
      worldRulesJson: novel.worldRulesJson,
      backgroundText: [novel.expandedBackground, novel.synopsis, novel.userBackground].filter(Boolean).join('\n'),
      glossaryTerms,
      historicalProfileJson: novel.historicalProfileJson,
      projectCanonProfileJson: novel.projectCanonProfileJson,
      canonConstraintSetJson: novel.canonConstraintSetJson,
      sourceLedgerJson: novel.sourceLedgerJson,
      canonSourceLedgerJson: novel.canonSourceLedgerJson,
      canonFactCardsJson: novel.canonFactCardsJson,
    })
    reviewNotes = applyProvenanceAndOperatingModeToReviewNotes(reviewNotes, {
      novelId: chapter.novelId,
      chapterNum: chapter.chapterNum,
      genreName: profile.genre,
      worldRulesJson: novel.worldRulesJson,
      backgroundText: [novel.expandedBackground, novel.synopsis, novel.userBackground].filter(Boolean).join('\n'),
      glossaryTerms,
      historicalProfileJson: novel.historicalProfileJson,
      projectCanonProfileJson: novel.projectCanonProfileJson,
      canonConstraintSetJson: novel.canonConstraintSetJson,
      sourceLedgerJson: novel.sourceLedgerJson,
      canonSourceLedgerJson: novel.canonSourceLedgerJson,
      canonFactCardsJson: novel.canonFactCardsJson,
      launchMode: novel.launchMode,
      targetWords: novel.targetWords,
      settingsJson: novel.settingsJson,
      scenePlanJson: chapter.scenePlanJson,
    })
    reviewNotes = applyLongWindowQualitySignalsToReviewNotes(reviewNotes, draftContent, {
      novelId: chapter.novelId,
      chapterNum: chapter.chapterNum,
      chapterId,
      genre: profile.genre,
      chapterFunction: reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
      emotionTone: chapter.emotionTone || '',
    })
    // 语义评审门（critic 阶段）：把启发式命中转为疑点线索交给语义门核实。
    // runChapterSemanticGate 永不抛错并自动落库；degraded 时按 fallbackMode 处理。
    if (semanticGatePolicy.mode !== 'off' && draftContent.trim()) {
      const criticGateRun = await runChapterSemanticGate({
        novelId: chapter.novelId,
        chapterId,
        chapterNum: chapter.chapterNum,
        chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
        chapterContent: draftContent,
        dimensions: CORE_SEMANTIC_GATE_DIMENSIONS,
        stage: 'critic',
        mode: semanticGatePolicy.mode,
        modelConfigId: novel.modelConfigId || undefined,
        contractSummary: reviewContext.writingContractSummary,
        scenePlanSummary: reviewContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
        protagonistBrief: profile.protagonistReference,
        heuristicHints: collectSemanticGateHeuristicHints(reviewNotes),
      })
      criticSemanticReview = criticGateRun.degraded ? null : criticGateRun.review
      const appliedOutcome = applyCriticSemanticGateOutcomeToReviewNotes(reviewNotes, {
        review: criticGateRun.review,
        degraded: criticGateRun.degraded,
      }, semanticGatePolicy)
      reviewNotes = appliedOutcome.reviewNotes
      effectiveSemanticGateMode = appliedOutcome.effectiveMode
      if (appliedOutcome.restoreHeuristicContractBlockers) {
        // 语义评审失败（fallback=heuristic）：本轮当作 off，合同关键词验证恢复 blocker 语义。
        reviewNotes = applyContractValidationToReviewNotes(reviewNotes, validateChapterContractDelivery({
          chapterId,
          content: draftContent,
          reviewNotes,
        }))
        console.warn(`[semantic-gate] critic 语义评审失败，本章回退启发式门 chapter=${chapterId}`)
      }
    }
    latestReviewNotesJson = JSON.stringify(reviewNotes)
    updateChapter(chapterId, { reviewNotesJson: latestReviewNotesJson })
    finishRoleTask('critic', criticTaskId, 'Critic 审校完成，已生成本章修订意见。')
    const reviewPrioritySummary = buildReviewPrioritySummary(reviewNotes)
    const rewritePolicy = buildAdaptiveRewritePolicy(reviewPrioritySummary)
    const reviewPriorityPrompt = buildReviewPriorityPrompt(reviewPrioritySummary)
    const rewriterStepMemory = buildStepMemorySummary({
      chapterBridgePlan: chapterBridgePlanText,
      scenePlanText,
      draftText: lockedParagraphContext.promptDraftContent,
      reviewNotes,
      previousSummary: 'Critic 已完成审校，Rewriter 必须按优先级修复，不得绕开上游计划。',
    })
    snapshot = {
      ...snapshot,
      stepMemory: rewriterStepMemory,
    }
    const rewriteUpstreamArtifacts: UpstreamRuntimeArtifacts = {
      scenePlanSummary: summarizeStageArtifactText(scenePlanText, 520),
      draftTextSummary: summarizeStageArtifactText(lockedParagraphContext.promptDraftContent, 680),
      contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
      stepMemorySummary: rewriterStepMemory.summary,
      runtimeAssertions: rewriterStepMemory.runtimeAssertions,
      reviewRiskSummary: buildReviewRiskArtifactSummary(reviewNotes),
      reviewProofSummary: buildReviewProofArtifactSummary(reviewNotes),
      rewriteDeltaSummary: buildRewriteDeltaArtifactSummary(
        reviewNotes,
        rewritePolicy.rewriteScope,
        reviewPriorityPrompt,
      ),
      publishGateRiskSummary: summarizeStageArtifactLines([
        structuralAlertsSummary,
        ...reviewPrioritySummary.reasons,
      ], 5, 640),
    }
    rewriteContext = (await resolveStageContextForPipeline(
      'rewrite',
      chapter,
      draftResolution.effectiveRawContext,
      complexity,
      {
        executionMode: executionModeResolution.mode,
        preserveConstraintLabels: options.preserveConstraintLabels,
        contractVersion,
        activePromptOverrideKeys,
        totalBudget: rewritePolicy.contextBudgetMultiplier > 1
          ? Math.round(resolveContextBudgetForStage(
            'rewrite',
            complexity,
            resolveChapterReferenceWords(chapter.targetWords, rawContext.novel.targetWords),
            rawContext.novel.targetWords || 0,
          ) * rewritePolicy.contextBudgetMultiplier)
          : undefined,
        upstreamArtifacts: rewriteUpstreamArtifacts,
      },
    )).context
    rewriteWritingGuidance = buildWritingGuidance(rewriteContext.styleTemplate)
    logConstraintInjectionStatus('rewrite', rewriteContext)
    stageReports = buildChapterAiStageReports(
      executionModeResolution.mode,
      executionModeResolution.source,
      novel.modelConfigId || undefined,
      {
        rewriteTemperatureCap: rewritePolicy.temperatureCap,
        rewriteContextStrategy: rewritePolicy.contextStrategy,
        rewriteReviewDepth: rewritePolicy.reviewDepth,
        rewriteReasons: rewritePolicy.reasons,
      },
    )
    generationExplainability = buildAiExplainabilityReport({
      taskKind: 'chapter_generation',
      executionMode: executionModeResolution.mode,
      usageSnapshot,
      stageReports,
      contextAssemblyReport,
      authorStyleLock,
      structuredOutputs: [
        '场景计划 JSON',
        '审校意见 JSON',
        'Canon 差异草案',
      ],
      activePromptOverrideKeys,
    })
    snapshot = {
      ...snapshot,
      generationExplainability,
    }
    syncWorkflowTask()
    const rewritePacingCurve = buildStoryPacingCurve(
      chapter.novelId,
      chapter.chapterNum,
      chapter.emotionTone || '平稳',
      reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
    )
    const rewriteNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(
      rewriteContext.chapterGoal,
      lockedParagraphContext.promptDraftContent,
      reviewNotes.chapter_function_primary || reviewNotes.pace_marker,
    ))
    const rewriterChatOpts = buildChatOptionsFromRoute(stageReports[3].route)
    const initialDialogueRepairDirective = buildDialogueRepairDirective({
      similarities: reviewNotes.cross_character_similarity,
      drifts: reviewNotes.dialogue_drift_alerts,
      fillerRisks: reviewNotes.dialogue_filler_risks,
      infoDensityRisks: reviewNotes.dialogue_info_density_risks,
    })
    const prioritizedReviewNotesText = [
      reviewPriorityPrompt,
      initialDialogueRepairDirective,
      formatReviewNotes(reviewNotes),
    ].filter(Boolean).join('\n\n')
    // 差异门失败后回灌的结构性修复指令；非空时随下一轮重写提示词下发
    let structuralRepairDirective = ''
    const buildRewriteMessages = (
      attemptNumber = 1,
      rejectedDigests: string[] = [],
      draftContentOverride?: string,
    ) => ([{
      role: 'user' as const,
      content: buildChapterRewritePrompt({
        novelTitle: novel.title,
        genre: profile.genre,
        chapterNum: chapter.chapterNum,
        chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
        chapterGoal: rewriteContext.chapterGoal,
        hardConstraintContext: rewriteContext.hardConstraintContext,
        dialogueVoiceLocks: rewriteContext.dialogueVoiceLocks,
        emotionTone: chapter.emotionTone || '平稳',
        targetWords: resolveChapterReferenceWords(chapter.targetWords, novel.targetWords),
        storyCore,
        writingContractSummary: rewriteContext.writingContractSummary,
        relationSummary: rewriteContext.relationSummary,
        currentArc: rewriteContext.currentArc,
        worldRules: rewriteContext.worldRules,
        characterStates: rewriteContext.characterStates,
        worldStates: rewriteContext.worldStates,
        mapSummary: rewriteContext.mapSummary,
        itemSummary: rewriteContext.itemSummary,
        previousSummaries: rewriteContext.previousSummaries,
        previousChapterContext: rewriteContext.previousChapterContext,
        lastChapterEnding: rewriteContext.lastChapterEnding,
        chapterBridgePlan: rewriteContext.chapterBridgePlan,
        stepMemorySummary: rewriteContext.stepMemorySummary,
        runtimeAssertions: rewriteUpstreamArtifacts.runtimeAssertions,
        continuitySummary: rewriteContext.continuitySummary,
        openLoops: rewriteContext.openLoops,
        dueForeshadows: rewriteContext.dueForeshadows,
        continuityNotes: rewriteContext.continuityNotes,
        timelineSummary: rewriteContext.timelineSummary,
        timelineOpenThreads: rewriteContext.timelineOpenThreads,
        longTermMemory: rewriteContext.longTermMemory,
        recalledMemory: rewriteContext.recalledMemory,
        consistencyNotes: rewriteWritingGuidance,
        structuralAlertsSummary,
        scenePlan: scenePlanText,
        draftContent: draftContentOverride || lockedParagraphContext.promptDraftContent,
        reviewNotes: [prioritizedReviewNotesText, structuralRepairDirective].filter(Boolean).join('\n\n'),
        lockedParagraphs: lockedParagraphContext.lockedParagraphs,
        activeThreads: rewriteContext.activeThreads,
        ...rewriteNarrativeFields,
        povRotationGuidance: formatPovRotationGuidance(povRotationPlan),
        storyPacingGuidance: formatPacingGuidance(rewritePacingCurve),
        hookContinuityGuidance: formatHookContinuityGuidance(baseHookContinuity),
        expressionDedupGuidance: formatExpressionDedupGuidance(generationExpressionDedup),
        summaryHealthGuidance: formatSummaryHealthGuidance(previousSummaryHealth),
        voiceEvolutionGuidance: formatVoiceEvolutionGuidance(voiceEvolutionProfiles),
        protagonistReference: profile.protagonistReference,
        protagonistRule: profile.protagonistRule,
        promptTier: complexity,
        attemptNumber,
        rejectedDigests,
      }),
    }])

    const startRewriterTaskWithAssert = async (messages: Message[], detail: string) => {
      const taskId = await startRoleTask('rewriter', 'chapter_rewriter', detail, {
        inputJson: JSON.stringify(messages),
        runnerType: 'stream',
      })
      try {
        assertContractDrivenWriterInputs('rewriter', contractVersion, rewriteContext.writingContractSummary, scenePlanText)
      } catch (error) {
        updateTaskStatus(taskId, 'failed', sender, {
          pipelineStage: 'blocked',
          errorMessage: error instanceof Error ? error.message : 'Rewriter 缺少合同输入',
          recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'rewriter')),
        })
        failRoleTask('rewriter', taskId, error, { blocked: true })
      }
      return taskId
    }
    const runRewriterStreamAttempt = async (
      attemptNumber: number,
      rejectedDigests: string[],
      detail: string,
      chatOptsOverride?: typeof rewriterChatOpts,
      draftContentOverride?: string,
    ) => {
      const attemptMessages = buildRewriteMessages(attemptNumber, rejectedDigests, draftContentOverride)
      let currentTaskId = await startRewriterTaskWithAssert(attemptMessages, detail)
      let networkRetryCount = 0

      while (true) {
        let receivedOutput = ''
        try {
          const result = await executeStreamTask(currentTaskId, {
            type: 'chapter_rewriter',
            novelId: chapter.novelId,
            relatedEntityType: 'chapter',
            relatedEntityId: chapterId,
            inputJson: JSON.stringify(attemptMessages),
            messages: attemptMessages,
            modelConfigId: novel.modelConfigId || undefined,
            chatOpts: chatOptsOverride || rewriterChatOpts,
            sender,
            onChunk: async (_chunk, fullOutput) => {
              receivedOutput = fullOutput
              snapshot = {
                ...snapshot,
                partialContent: fullOutput,
                resumeReason: undefined,
                resumeSourceTaskId: currentTaskId,
              }
              syncWorkflowTask()
            },
          })
          return { taskId: currentTaskId, result }
        } catch (error) {
          if (
            isTransientModelNetworkError(error)
            && receivedOutput.trim().length < 120
            && networkRetryCount < 1
          ) {
            networkRetryCount += 1
            updateTask(currentTaskId, {
              outputText: '流式连接在返回可用正文前中断，已自动新建 Rewriter 任务重试一次。',
            })
            currentTaskId = await startRewriterTaskWithAssert(
              attemptMessages,
              `${detail}（网络中断自动重试 ${networkRetryCount}/1）`,
            )
            continue
          }
          throw error
        }
      }
    }

    let rewriteAttemptNumber = 1
    let rewriteRejectedDigests: string[] = []
    let rewriteRun = await runRewriterStreamAttempt(
      rewriteAttemptNumber,
      rewriteRejectedDigests,
      'Rewriter 正在按 Critic 结论修正文稿。',
    )
    let rewriterTaskId = rewriteRun.taskId
    let rewriteResult = rewriteRun.result
    if (
      isCandidateTooSimilar(rewriteResult.output, [draftContent])
      && (rewritePolicy.requiresFullRewrite || reviewPrioritySummary.counts.high > 0)
    ) {
      rewriteRejectedDigests = [buildVariationDigest(rewriteResult.output)]
      updateTask(rewriterTaskId, {
        pipelineStage: 'success',
        outputText: '首轮重写与初稿过近，已切换变体重试。',
        contractVersion,
      })
      updateTaskStatus(rewriterTaskId, 'success', sender, {
        pipelineStage: 'success',
        outputText: '首轮重写与初稿过近，已切换变体重试。',
        errorMessage: null,
      })
      previousRoleTaskId = rewriterTaskId
      rewriteAttemptNumber = 2
      rewriteRun = await runRewriterStreamAttempt(
        rewriteAttemptNumber,
        rewriteRejectedDigests,
        'Rewriter 首轮改写幅度不足，正在切到变体重试。',
      )
      rewriterTaskId = rewriteRun.taskId
      rewriteResult = rewriteRun.result
    }

    const processRewriteOutcome = async (rewriteOutput: string): Promise<{
      content: string
      reviewNotes: ChapterReviewNotes
      miniReview: RewriteMiniReviewVerdict
      dialogueAnalysis: ReturnType<typeof analyzeChapterDialogueAgainstNovel>
    }> => {
    const protectedOutput = enforceLockedParagraphProtection(
      rewriteOutput,
      lockedParagraphContext.lockedParagraphs,
      lockedParagraphContext.initialFallbackContent,
      reviewNotes,
    )
    const repaired = await repairChapterOutputIfNeeded({
      chapter,
      novel,
      context: rewriteContext,
      storyCore,
      profile,
      scenePlanText,
      consistencyNotes: rewriteWritingGuidance,
      structuralAlertsSummary,
      reviewNotes: protectedOutput.reviewNotes,
      content: protectedOutput.content,
      lockedParagraphs: lockedParagraphContext.lockedParagraphs,
      promptTier: complexity,
      knownTerms: guardrailKnownTerms,
      attemptNumber: rewriteAttemptNumber,
      rejectedDigests: rewriteRejectedDigests,
    })
    const repairedContent = stripChapterHeadingNoise(repaired.content, chapter.chapterNum, chapterTitleForCheck).content
    const repairedHumanizedReviewNotes = applyHumanizationAnalysisToReviewNotes(
      repaired.reviewNotes,
      repairedContent,
      {
        chapterId,
        genre: profile.genre,
        chapterFunction: repaired.reviewNotes.chapter_function_primary || repaired.reviewNotes.pace_marker,
        emotionTone: chapter.emotionTone || '',
      },
    )
    const dialogueAnalysis = analyzeChapterDialogueAgainstNovel(
      chapter.novelId,
      chapter.chapterNum,
      repairedContent,
    )
    const repairedReviewNotes = applyDialogueAnalysisToReviewNotes(
      repairedHumanizedReviewNotes,
      chapter.novelId,
      chapter.chapterNum,
      repairedContent,
      dialogueAnalysis,
      { replaceExistingSignals: true },
    )
    const repairedStyleReviewNotes = applyStyleComplianceToReviewNotes(
      repairedReviewNotes,
      chapter.novelId,
      repairedContent,
    )
    const repairedReadableReviewNotesBase = applyReadingExperienceToReviewNotes(
      repairedStyleReviewNotes,
      repairedContent,
    )
    const repairedReadableReviewNotes = applyWordShapeObservation(
      repairedReadableReviewNotesBase,
      repairedContent,
      chapterWordTarget,
    )
    const repairedContractReviewNotes = applyContractValidationToReviewNotes(repairedReadableReviewNotes, validateChapterContractDelivery({
      chapterId,
      content: repairedContent,
      reviewNotes: repairedReadableReviewNotes,
    }, { advisoryOnly: effectiveSemanticGateMode === 'enforce' }))
    const repairedGroundedReviewNotes = applyHistoricalGroundingToReviewNotes(repairedContractReviewNotes, {
      genreName: profile.genre,
      worldRulesJson: novel.worldRulesJson,
      backgroundText: [novel.expandedBackground, novel.synopsis, novel.userBackground].filter(Boolean).join('\n'),
      glossaryTerms,
      historicalProfileJson: novel.historicalProfileJson,
      projectCanonProfileJson: novel.projectCanonProfileJson,
      canonConstraintSetJson: novel.canonConstraintSetJson,
      sourceLedgerJson: novel.sourceLedgerJson,
      canonSourceLedgerJson: novel.canonSourceLedgerJson,
      canonFactCardsJson: novel.canonFactCardsJson,
    })
    const repairedProvenanceReviewNotes = applyProvenanceAndOperatingModeToReviewNotes(repairedGroundedReviewNotes, {
      novelId: chapter.novelId,
      chapterNum: chapter.chapterNum,
      genreName: profile.genre,
      worldRulesJson: novel.worldRulesJson,
      backgroundText: [novel.expandedBackground, novel.synopsis, novel.userBackground].filter(Boolean).join('\n'),
      glossaryTerms,
      historicalProfileJson: novel.historicalProfileJson,
      projectCanonProfileJson: novel.projectCanonProfileJson,
      canonConstraintSetJson: novel.canonConstraintSetJson,
      sourceLedgerJson: novel.sourceLedgerJson,
      canonSourceLedgerJson: novel.canonSourceLedgerJson,
      canonFactCardsJson: novel.canonFactCardsJson,
      launchMode: novel.launchMode,
      targetWords: novel.targetWords,
      settingsJson: novel.settingsJson,
      scenePlanJson: chapter.scenePlanJson,
    })
    const finalReviewNotes = applyLongWindowQualitySignalsToReviewNotes(repairedProvenanceReviewNotes, repairedContent, {
      novelId: chapter.novelId,
      chapterNum: chapter.chapterNum,
      chapterId,
      genre: profile.genre,
      chapterFunction: repairedProvenanceReviewNotes.chapter_function_primary || repairedProvenanceReviewNotes.pace_marker,
      emotionTone: chapter.emotionTone || '',
    })
    const finalReviewPrioritySummary = buildReviewPrioritySummary(finalReviewNotes)
    const rewriteMiniReview = buildRewriteMiniReviewVerdict({
      originalContent: draftContent,
      rewrittenContent: repairedContent,
      reviewPrioritySummary: finalReviewPrioritySummary,
      reviewNotes: finalReviewNotes,
    })
    const finalReviewNotesWithRewriteDelta = applyRewriteDeltaToReviewNotes(
      finalReviewNotes,
      rewriteMiniReview.narrativeDelta,
    )
    return {
      content: repairedContent,
      reviewNotes: finalReviewNotesWithRewriteDelta,
      miniReview: rewriteMiniReview,
      dialogueAnalysis,
    }
    }

    // enforce 模式的修复复评：对候选稿只复评 critic 语义门标记的 blocker/warning 维度，
    // 计入 maxSemanticCallsPerChapter 预算；预算耗尽或复评失败时返回 null（回退原判据）。
    const evaluateRepairCandidateSemantics = async (candidateContent: string): Promise<SemanticGateReview | null> => {
      if (effectiveSemanticGateMode !== 'enforce' || !criticSemanticReview) return null
      const previousRelevant = criticSemanticReview.verdicts
        .filter((verdict) => verdict.status === 'blocker' || verdict.status === 'warning')
      if (previousRelevant.length === 0 || !candidateContent.trim()) return null
      if (semanticGateCallsUsed >= semanticGatePolicy.maxSemanticCallsPerChapter) {
        console.warn(`[semantic-gate] 修复复评超出预算（${semanticGatePolicy.maxSemanticCallsPerChapter} 次/章），跳过 chapter=${chapterId}`)
        return null
      }
      semanticGateCallsUsed += 1
      const judgement = await judgeRepairOutcome({
        previousBlockerVerdicts: criticSemanticReview.verdicts,
        repairedContent: candidateContent,
        runGate: (dimensions, hints) => runChapterSemanticGate({
          novelId: chapter.novelId,
          chapterId,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          chapterContent: candidateContent,
          dimensions,
          stage: 'repair_review',
          mode: effectiveSemanticGateMode,
          modelConfigId: novel.modelConfigId || undefined,
          contractSummary: rewriteContext.writingContractSummary,
          scenePlanSummary: rewriteContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
          protagonistBrief: profile.protagonistReference,
          heuristicHints: hints,
        }),
      })
      return judgement.degraded ? null : judgement.review
    }
    const draftNarrativeWords = countNarrativeWords(draftContent)

    let rewriteOutcome = await processRewriteOutcome(rewriteResult.output)
    // 差异门闭环：轻量复检拦截（差异门失败或相似度过高）时，把结论回灌给 Rewriter 自动做一轮结构性重写，而不是直接卡人工
    const dialogueRepairScore = (analysis: ReturnType<typeof analyzeChapterDialogueAgainstNovel>): number => (
      analysis.similarities.length * 3
      + analysis.drifts.length * 2
      + analysis.fillerRisks.length
      + analysis.infoDensityRisks.length
    )
    const rewriteDialogueRepairDirective = buildDialogueRepairDirective({
      similarities: rewriteOutcome.dialogueAnalysis.similarities,
      drifts: rewriteOutcome.dialogueAnalysis.drifts,
      fillerRisks: rewriteOutcome.dialogueAnalysis.fillerRisks,
      infoDensityRisks: rewriteOutcome.dialogueAnalysis.infoDensityRisks,
    })
    const shouldRetryDialogueRepair = rewriteDialogueRepairDirective.length > 0
    if ((rewriteOutcome.miniReview.needsHumanReview || shouldRetryDialogueRepair) && rewriteOutcome.content.trim() && rewriteAttemptNumber < 3) {
      const structuralDirective = buildStructuralRepairDirective(
        rewriteOutcome.miniReview.narrativeDelta,
        [
          ...rewriteOutcome.reviewNotes.critical_fixes,
          ...rewriteOutcome.reviewNotes.reader_hook_risks,
          ...rewriteOutcome.reviewNotes.arc_progress_risks,
          ...rewriteOutcome.reviewNotes.continuity_risks,
        ],
      )
      structuralRepairDirective = [
        structuralDirective,
        rewriteDialogueRepairDirective,
      ].filter(Boolean).join('\n\n') || [
          '【结构性修复指令（上一轮重写与初稿过于接近）】',
          '本轮必须在保持事实连续性的前提下拉开与初稿的差异：重排至少一个场景的切入点，改变冲突交锋的走向或结果，补入可见代价或新增风险。',
          '不允许仅替换措辞、调整语序或润色修辞。',
        ].join('\n')
      rewriteRejectedDigests = [...rewriteRejectedDigests, buildVariationDigest(rewriteResult.output)]
      updateTask(rewriterTaskId, {
        pipelineStage: 'success',
        outputText: shouldRetryDialogueRepair
          ? '对白质量复检仍有风险，已带具体证据自动发起定向重写。'
          : '重写差异门未通过，已带差异门结论自动发起结构性重写。',
        contractVersion,
      })
      updateTaskStatus(rewriterTaskId, 'success', sender, {
        pipelineStage: 'success',
        outputText: shouldRetryDialogueRepair
          ? '对白质量复检仍有风险，已带具体证据自动发起定向重写。'
          : '重写差异门未通过，已带差异门结论自动发起结构性重写。',
        errorMessage: null,
      })
      previousRoleTaskId = rewriterTaskId
      rewriteAttemptNumber = 3
      // cost_saver/fast 模式下模型常拒绝改结构：第三轮升级到 premium 档路由重试
      let escalatedChatOpts: typeof rewriterChatOpts | undefined
      if (!shouldRetryDialogueRepair && (executionModeResolution.mode === 'cost_saver' || executionModeResolution.mode === 'fast')) {
        try {
          const escalatedStageReports = buildChapterAiStageReports(
            'premium',
            executionModeResolution.source,
            novel.modelConfigId || undefined,
            {
              rewriteTemperatureCap: Math.max(rewritePolicy.temperatureCap, 0.7),
              rewriteContextStrategy: rewritePolicy.contextStrategy,
              rewriteReviewDepth: 'deep',
              rewriteReasons: [...rewritePolicy.reasons, '差异门重试：升级 premium 路由执行结构性重写。'],
            },
          )
          escalatedChatOpts = buildChatOptionsFromRoute(escalatedStageReports[3].route)
          console.warn(`[chapter:pipeline] 差异门重试升级 premium 路由 chapter=${chapterId}（原模式 ${executionModeResolution.mode}）`)
        } catch (error) {
          console.warn(`[chapter:pipeline] premium 路由升级失败，沿用原路由重试 chapter=${chapterId}:`, error instanceof Error ? error.message : error)
        }
      }
      rewriteRun = await runRewriterStreamAttempt(
        rewriteAttemptNumber,
        rewriteRejectedDigests,
        shouldRetryDialogueRepair
          ? 'Rewriter 正在按对白质量证据进行定向重写。'
          : escalatedChatOpts
            ? 'Rewriter 正在按差异门结论以 premium 路由进行结构性重写。'
            : 'Rewriter 正在按差异门结论进行结构性重写。',
        escalatedChatOpts,
      )
      rewriterTaskId = rewriteRun.taskId
      rewriteResult = rewriteRun.result
      const retriedOutcome = await processRewriteOutcome(rewriteResult.output)
      const currentDialogueRepairScore = dialogueRepairScore(rewriteOutcome.dialogueAnalysis)
      const retriedDialogueRepairScore = dialogueRepairScore(retriedOutcome.dialogueAnalysis)
      // enforce 模式：候选稿先过语义复评（预算内），有语义退步或删戏过门直接判负；
      // 非 enforce（或复评缺席）沿用原有分数判据。
      const retriedCandidateSemantic = await evaluateRepairCandidateSemantics(retriedOutcome.content)
      const retriedBetter = retriedCandidateSemantic
        ? chooseBetterRepairCandidate(
          { content: rewriteOutcome.content, reviewNotes: rewriteOutcome.reviewNotes },
          { content: retriedOutcome.content, reviewNotes: retriedOutcome.reviewNotes },
          {
            currentSemantic: criticSemanticReview || undefined,
            candidateSemantic: retriedCandidateSemantic,
            originalLength: draftNarrativeWords,
            genre: profile.genre,
            knownTerms: guardrailKnownTerms,
          },
        ).content === retriedOutcome.content
        : rewriteOutcomeScore(retriedOutcome, profile.genre, guardrailKnownTerms) < rewriteOutcomeScore(rewriteOutcome, profile.genre, guardrailKnownTerms)
          || (rewriteOutcomeScore(retriedOutcome, profile.genre, guardrailKnownTerms) === rewriteOutcomeScore(rewriteOutcome, profile.genre, guardrailKnownTerms)
            && retriedDialogueRepairScore < currentDialogueRepairScore)
      if (retriedBetter) {
        rewriteOutcome = retriedOutcome
      }

      // A single premium retry can still return a polished near-copy. Give the
      // structural gate one final bounded attempt, carrying the newest delta
      // evidence forward instead of immediately blocking a usable workflow.
      if (rewriteOutcome.miniReview.needsHumanReview && rewriteOutcome.content.trim()) {
        structuralRepairDirective = [
          buildStructuralRepairDirective(
            rewriteOutcome.miniReview.narrativeDelta,
            [
              ...rewriteOutcome.reviewNotes.critical_fixes,
              ...rewriteOutcome.reviewNotes.reader_hook_risks,
              ...rewriteOutcome.reviewNotes.arc_progress_risks,
              ...rewriteOutcome.reviewNotes.continuity_risks,
            ],
          ),
          rewriteDialogueRepairDirective,
        ].filter(Boolean).join('\n\n')
        rewriteRejectedDigests = [...rewriteRejectedDigests, buildVariationDigest(rewriteResult.output)]
        updateTask(rewriterTaskId, {
          pipelineStage: 'success',
          outputText: '上一轮结构修复仍未达标，已带最新差异证据发起最后一次有界重写。',
          contractVersion,
        })
        previousRoleTaskId = rewriterTaskId
        rewriteAttemptNumber = 4
        rewriteRun = await runRewriterStreamAttempt(
          rewriteAttemptNumber,
          rewriteRejectedDigests,
          'Rewriter 正在按最新结构差异证据执行最后一次有界重写。',
          escalatedChatOpts,
        )
        rewriterTaskId = rewriteRun.taskId
        rewriteResult = rewriteRun.result
        const finalRetriedOutcome = await processRewriteOutcome(rewriteResult.output)
        const finalCandidateSemantic = await evaluateRepairCandidateSemantics(finalRetriedOutcome.content)
        const finalRetriedBetter = finalCandidateSemantic
          ? chooseBetterRepairCandidate(
            { content: rewriteOutcome.content, reviewNotes: rewriteOutcome.reviewNotes },
            { content: finalRetriedOutcome.content, reviewNotes: finalRetriedOutcome.reviewNotes },
            {
              currentSemantic: criticSemanticReview || undefined,
              candidateSemantic: finalCandidateSemantic,
              originalLength: draftNarrativeWords,
              genre: profile.genre,
              knownTerms: guardrailKnownTerms,
            },
          ).content === finalRetriedOutcome.content
          : rewriteOutcomeScore(finalRetriedOutcome, profile.genre, guardrailKnownTerms) < rewriteOutcomeScore(rewriteOutcome, profile.genre, guardrailKnownTerms)
        if (finalRetriedBetter) {
          rewriteOutcome = finalRetriedOutcome
        }
      }
      structuralRepairDirective = ''
    }
    let repairedContent = rewriteOutcome.content
    let finalReviewNotesWithRewriteDelta = rewriteOutcome.reviewNotes
    let rewriteMiniReview = rewriteOutcome.miniReview
    // 参考字数只用于读感观察，不自动压缩。章节应在场景自然完成后收束，
    // 关键转折、高潮或回收章可以明显长于参考值，短过渡章也可以明显短于参考值。
    // 重写稿轻量复检：初稿时代的 LLM 审校证据（接力/开篇/幻觉/标题）在最终稿上逐条核对，
    // 发布门据新证据判定，不再依赖 pipeline 阶段降级兜底。最终验收门若再次改稿，
    // 必须对新正文再次复检，避免把上一版正文的 rewrite_recheck 误当成当前稿证据。
    const runRewriteRiskRecheck = async (
      reviewNotes: ChapterReviewNotes,
      content: string,
    ): Promise<ChapterReviewNotes> => {
      const staleLlmRiskCount = reviewNotes.step_memory_risks.length
        + reviewNotes.opening_hook_risks.length
        + reviewNotes.hallucination_risks.length
        + reviewNotes.title_alignment_risks.length
      if (staleLlmRiskCount === 0 || !content.trim()) return reviewNotes

      try {
        const recheckRaw = await runChatTask({
          type: 'chapter_critic',
          novelId: chapter.novelId,
          relatedEntityType: 'chapter',
          relatedEntityId: chapterId,
          messages: [{
            role: 'user',
            content: [
              '你是小说审校复核员。下列风险是此前针对"重写前初稿"提出的；正文已经重写。请逐条核对每个风险在"当前正文"里是否仍然成立。',
              '仍成立的条目保留（可改写成针对当前正文的准确表述），已被重写修复的移入 resolved_risks。不要新增清单之外的问题，不要输出解释。',
              '只输出一个 JSON 对象：{"step_memory_risks":[],"opening_hook_risks":[],"hallucination_risks":[],"title_alignment_risks":[],"resolved_risks":[]}',
              `【章节】第${chapter.chapterNum}章 ${chapterTitleForCheck}`,
              scenePlanText ? `【场景计划】\n${scenePlanText}` : '',
              reviewNotes.step_memory_risks.length > 0
                ? `【原接力断链风险】\n${reviewNotes.step_memory_risks.join('\n')}`
                : '',
              reviewNotes.opening_hook_risks.length > 0
                ? `【原开篇追读风险】\n${reviewNotes.opening_hook_risks.join('\n')}`
                : '',
              reviewNotes.hallucination_risks.length > 0
                ? `【原无来源新增风险】\n${reviewNotes.hallucination_risks.join('\n')}`
                : '',
              reviewNotes.title_alignment_risks.length > 0
                ? `【原标题贴合风险】\n${reviewNotes.title_alignment_risks.join('\n')}`
                : '',
              '',
              '【当前正文】',
              content,
            ].filter(Boolean).join('\n'),
          }],
          modelConfigId: novel.modelConfigId || undefined,
          retryable: true,
        })
        const recheckParse = parseAiJsonResult<Record<string, unknown>>(recheckRaw, 'object', {
          channel: 'chapter',
          message: '重写稿复检 JSON 解析失败，保留初稿审校证据并沿用流水线降级兜底。',
          consoleSummary: `[chapter:warn] rewrite-recheck-json-fallback chapter=${chapterId}`,
          context: { chapterId, novelId: chapter.novelId, stage: 'rewrite_recheck' },
        })
        if (!recheckParse.success) return reviewNotes

        const parsedRecheck = recheckParse.data as Record<string, unknown>
        const toRiskList = (value: unknown): string[] => Array.isArray(value)
          ? [...new Set(value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean))]
          : []
        const nextReviewNotes = {
          ...reviewNotes,
          step_memory_risks: toRiskList(parsedRecheck.step_memory_risks),
          opening_hook_risks: toRiskList(parsedRecheck.opening_hook_risks),
          hallucination_risks: toRiskList(parsedRecheck.hallucination_risks),
          title_alignment_risks: toRiskList(parsedRecheck.title_alignment_risks),
          rewrite_recheck: {
            performed: true,
            checkedAt: new Date().toISOString(),
            resolved: toRiskList(parsedRecheck.resolved_risks),
          },
        }
        console.log(
          `[chapter:pipeline] 重写稿轻量复检完成 chapter=${chapterId}：`
          + `接力${nextReviewNotes.step_memory_risks.length}条 `
          + `开篇${nextReviewNotes.opening_hook_risks.length}条 `
          + `幻觉${nextReviewNotes.hallucination_risks.length}条 `
          + `标题${nextReviewNotes.title_alignment_risks.length}条仍成立，`
          + `已修复${nextReviewNotes.rewrite_recheck?.resolved.length ?? 0}条`,
        )
        return nextReviewNotes
      } catch (error) {
        console.warn(`[chapter:pipeline] 重写稿复检失败，保留初稿审校证据 chapter=${chapterId}:`, error instanceof Error ? error.message : error)
        return reviewNotes
      }
    }

    finalReviewNotesWithRewriteDelta = await runRewriteRiskRecheck(
      finalReviewNotesWithRewriteDelta,
      repairedContent,
    )
    latestUsableDraft = repairedContent.trim()
    latestReviewNotesJson = JSON.stringify(finalReviewNotesWithRewriteDelta)
    if (latestUsableDraft) {
      snapshot = {
        ...snapshot,
        partialContent: latestUsableDraft,
        resumeSourceTaskId: rewriterTaskId,
      }
    }
    persistAntiAiRuleHits({
      novelId: chapter.novelId,
      chapterId,
      chapterNum: chapter.chapterNum,
      content: repairedContent,
      genre: profile.genre,
      knownTerms: guardrailKnownTerms,
    })
    let remainingGuardrailFindings = collectQualityGuardrailFindings(repairedContent, profile.genre, { knownTerms: guardrailKnownTerms })
    // Rewriter 已经完成两轮时，风格密度类命中仍可能只剩中风险组合。
    // 这类问题适合再做一次局部质检修复，但必须以后验分数严格下降为准，
    // 避免为了“过门”而牺牲事件、事实或篇幅。
    const styleOnlyGuardrailFindings = remainingGuardrailFindings.length > 0
      && remainingGuardrailFindings.every((finding) => STYLE_REPAIRABLE_GUARDRAIL_CODES.has(finding.code))
    if (hasBlockingGuardrailFindings(remainingGuardrailFindings) && styleOnlyGuardrailFindings && repairedContent.trim()) {
      try {
        const styleRepairOutput = (await runChatTask({
          type: 'chapter_write',
          novelId: chapter.novelId,
          relatedEntityType: 'chapter',
          relatedEntityId: chapterId,
          messages: [{
            role: 'user',
            content: [
              '你是最终语言质检编辑，只做局部风格修复，不重排事件，不新增情节，不改变人物立场、事实、数字和对白结果。',
              '必须修复下面列出的全部风格命中，并输出完整正文，不要解释、不要标题。',
              ...remainingGuardrailFindings.map((finding) => `- ${finding.code}：${finding.excerpt || finding.message}`),
              '高频姓名/称谓：在不造成指代歧义时，用动作主语、代词、职业或关系称呼替换部分机械重复；不要把主角姓名连续放进相邻句。',
              '低价值身体/声音细节：删除不改变行动、判断、阻力或后果的手指、眼睛、喉咙、嗓音微动作；只保留能改变现场的信息。',
              '破折号和括号：删除解释型、假停顿型用法，只有真实抢话、打断或语气断裂才保留。',
              '保持原文至少 75% 的篇幅，保留全部事件顺序、冲突结果、伏笔和代价。',
              '',
              '正文：',
              repairedContent,
            ].join('\n'),
          }],
          modelConfigId: novel.modelConfigId || undefined,
        })).trim()
        const strippedStyleRepair = stripChapterHeadingNoise(styleRepairOutput, chapter.chapterNum, chapterTitleForCheck).content
        const styleRepairWords = countNarrativeWords(strippedStyleRepair)
        const currentStyleScore = guardrailRepairScore(remainingGuardrailFindings)
        const styleRepairFindings = collectQualityGuardrailFindings(strippedStyleRepair, profile.genre, { knownTerms: guardrailKnownTerms })
        const styleRepairScore = guardrailRepairScore(styleRepairFindings)
        // enforce 模式：风格修复候选也不得让语义门维度出现新增 blocker（预算内复评，缺席时跳过否决）。
        const styleCandidateSemantic = strippedStyleRepair
          ? await evaluateRepairCandidateSemantics(strippedStyleRepair)
          : null
        const criticBlockerDims = new Set(criticSemanticReview ? collectBlockerDimensions(criticSemanticReview) : [])
        const styleSemanticRegressed = styleCandidateSemantic
          ? collectBlockerDimensions(styleCandidateSemantic).some((dimension) => !criticBlockerDims.has(dimension))
          : false
        if (
          strippedStyleRepair
          && !styleSemanticRegressed
          && styleRepairWords >= Math.round(countNarrativeWords(repairedContent) * 0.75)
          && styleRepairScore < currentStyleScore
        ) {
          repairedContent = strippedStyleRepair
          remainingGuardrailFindings = styleRepairFindings
          console.warn(`[chapter:pipeline] 后验风格质检修复采纳 chapter=${chapterId}：${currentStyleScore}→${styleRepairScore}`)
        } else {
          console.warn(`[chapter:pipeline] 后验风格质检候选未改善，保留原稿 chapter=${chapterId}`)
        }
      } catch (error) {
        console.warn(`[chapter:pipeline] 后验风格质检失败，保留原稿 chapter=${chapterId}:`, error instanceof Error ? error.message : error)
      }
    }
    latestUsableDraft = repairedContent.trim()
    latestReviewNotesJson = JSON.stringify(
      applyHumanizationAnalysisToReviewNotes(
        enhanceReviewNotesWithGuardrails(finalReviewNotesWithRewriteDelta, repairedContent, profile.genre, remainingGuardrailFindings),
        repairedContent,
        {
          chapterId,
          genre: profile.genre,
          chapterFunction: finalReviewNotesWithRewriteDelta.chapter_function_primary || finalReviewNotesWithRewriteDelta.pace_marker,
          emotionTone: chapter.emotionTone || '',
        },
      ),
    )
      persistAntiAiRuleHits({
        novelId: chapter.novelId,
        chapterId,
        chapterNum: chapter.chapterNum,
        content: repairedContent,
        genre: profile.genre,
        knownTerms: guardrailKnownTerms,
    })
    const blockingGuardrailSummary = remainingGuardrailFindings
      .filter((finding) => finding.severity === 'high')
      .map((finding) => `${finding.code}${finding.excerpt ? `：${finding.excerpt}` : ''}`)
      .slice(0, 6)
      .join('；')
    if (remainingGuardrailFindings.length > 0 && hasBlockingGuardrailFindings(remainingGuardrailFindings)) {
      const antiAiFailureMessage = [
        'Rewriter 二次修复后仍存在高风险 AI 味或模板化表达，需人工介入复核。',
        blockingGuardrailSummary ? `具体命中：${blockingGuardrailSummary}` : '',
      ].filter(Boolean).join(' ')
      failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
        'anti_ai_failed',
        antiAiFailureMessage,
        {
          rewriteScope: 'chapter_rewrite',
          outputText: buildPipelineFailureOutput(
            'anti_ai_failed',
            antiAiFailureMessage,
            { rewriteScope: 'chapter_rewrite' },
          ),
        },
      ))
    }

    updateChapter(chapterId, {
      content: repairedContent,
      reviewNotesJson: latestReviewNotesJson,
      status: 'draft',
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
    hasCommittedContent = true
    let publishCheck = runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: effectiveSemanticGateMode })
    const finalGateRepairItems = publishCheck.checklist.filter((item) => (
      (item.status === 'blocker' || item.status === 'rewrite')
      && !['summary', 'continuity', 'context'].includes(item.key)
    ))
    if (finalGateRepairItems.length > 0 && repairedContent.trim() && rewriteAttemptNumber < 5) {
      const contractIssues = (publishCheck.contractValidation?.itemResults || [])
        .filter((item) => item.verdict && item.verdict !== 'pass')
        .slice(0, 8)
        .map((item) => {
          const record = item as unknown as Record<string, unknown>
          return `- 合同 ${String(record.contractItemType || record.key || 'item')}：${String(record.expected || record.rewriteHint || record.actual || '')}`
        })
      structuralRepairDirective = [
        '【章节验收门定向修复（必须先修硬缺口）】',
        ...finalGateRepairItems.slice(0, 8).map((item) => `- ${item.key}：${item.detail}`),
        ...contractIssues,
        ...[
          ...finalReviewNotesWithRewriteDelta.critical_fixes,
          ...finalReviewNotesWithRewriteDelta.reader_hook_risks,
          ...finalReviewNotesWithRewriteDelta.arc_progress_risks,
        ].slice(0, 6).map((item) => `- 审校指定问题：${item}`),
        '差异门变化验收：至少新增一处“主动选择 -> 他人反应 -> 可见后果”，以及一处物件、资格、时间、责任或关系状态的改变；不能只替换同义词、调整顺序或重复原有结果。',
        '如果本章目标只被提及，必须把它改成一次具体决定、拒绝、退回、补录、交接或承担，并让角色因此面对新的下一步压力。',
        '合同硬缺口必须在正文中写成可核验的动作、地点、时间、结果状态或下一步责任，不得只靠审校备注补足。',
        '对白硬缺口必须删除空转接话；每个回合都要带立场、事实、动作、责任或关系变化，并保留人物各自声线。',
        '只修复上述验收缺口，保留已确认事件、数字、人物设定和章节主线；输出完整正文，不要解释。',
      ].join('\n')
      rewriteRejectedDigests = [...rewriteRejectedDigests, buildVariationDigest(repairedContent)]
      try {
        updateTask(rewriterTaskId, {
          pipelineStage: 'success',
          outputText: '章节验收门发现硬缺口，已回灌具体证据执行最后一次定向重写。',
          contractVersion,
        })
        previousRoleTaskId = rewriterTaskId
        rewriteAttemptNumber = 5
        const gateRepairRun = await runRewriterStreamAttempt(
          rewriteAttemptNumber,
          rewriteRejectedDigests,
          'Rewriter 正在按章节验收门证据修复合同、对白与开篇硬缺口。',
          undefined,
          repairedContent,
        )
        rewriterTaskId = gateRepairRun.taskId
        rewriteResult = gateRepairRun.result
        const gateRepairOutcome = await processRewriteOutcome(rewriteResult.output)
        const currentGateOutcome = { content: repairedContent, miniReview: rewriteMiniReview }
        const gateRepairAccepted = !gateRepairOutcome.miniReview.needsHumanReview
          || rewriteOutcomeScore(gateRepairOutcome, profile.genre, guardrailKnownTerms) < rewriteOutcomeScore(currentGateOutcome, profile.genre, guardrailKnownTerms)
        if (gateRepairAccepted && gateRepairOutcome.content.trim()) {
          repairedContent = gateRepairOutcome.content
          finalReviewNotesWithRewriteDelta = gateRepairOutcome.reviewNotes
          rewriteMiniReview = gateRepairOutcome.miniReview
          finalReviewNotesWithRewriteDelta = await runRewriteRiskRecheck(
            finalReviewNotesWithRewriteDelta,
            repairedContent,
          )
          latestUsableDraft = repairedContent.trim()
          latestReviewNotesJson = JSON.stringify(finalReviewNotesWithRewriteDelta)
          persistAntiAiRuleHits({
            novelId: chapter.novelId,
            chapterId,
            chapterNum: chapter.chapterNum,
            content: repairedContent,
            genre: profile.genre,
            knownTerms: guardrailKnownTerms,
          })
          updateChapter(chapterId, {
            content: repairedContent,
            reviewNotesJson: latestReviewNotesJson,
            status: 'draft',
          }, {
            skipStaleTracking: true,
            versionSource: false,
          })
          publishCheck = runChapterPublishCheck(chapterId, { phase: 'pipeline', semanticGateMode: effectiveSemanticGateMode })
          console.warn(`[chapter:pipeline] 章节验收门定向重写${publishCheck.ready ? '通过' : '仍有阻塞'} chapter=${chapterId}`)
        } else {
          console.warn(`[chapter:pipeline] 章节验收门候选未改善，保留原稿 chapter=${chapterId}`)
        }
      } catch (error) {
        console.warn(`[chapter:pipeline] 章节验收门定向重写失败，保留原稿 chapter=${chapterId}:`, error instanceof Error ? error.message : error)
      }
      structuralRepairDirective = ''
    }
    const chapterExpressionDedup = analyzeExpressionDedupForChapter(chapterId)
    const chapterHookContinuity = buildHookContinuitySnapshot(
      chapterId,
      publishCheck.scoreBreakdown.hookStrengthScore,
    )
    updateChapter(chapterId, {
      expressionDedupJson: chapterExpressionDedup ? JSON.stringify(chapterExpressionDedup) : '',
      hookContinuityJson: JSON.stringify(chapterHookContinuity),
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
    // 黄金章节终验：enforce 模式且命中 goldenChapterNums 时，finalize 前追加一次
    // stage=golden_final 的语义评审（计入 maxSemanticCallsPerChapter 预算，超预算跳过并记警告）。
    if (
      effectiveSemanticGateMode === 'enforce'
      && semanticGatePolicy.goldenChapterNums.includes(chapter.chapterNum)
      && repairedContent.trim()
    ) {
      if (semanticGateCallsUsed >= semanticGatePolicy.maxSemanticCallsPerChapter) {
        finalReviewNotesWithRewriteDelta = {
          ...finalReviewNotesWithRewriteDelta,
          semantic_review_warnings: dedupeTextList([
            ...(finalReviewNotesWithRewriteDelta.semantic_review_warnings || []),
            `黄金章节 golden_final 语义复核因超出本章语义调用预算（${semanticGatePolicy.maxSemanticCallsPerChapter} 次）被跳过。`,
          ]),
        }
        latestReviewNotesJson = JSON.stringify(finalReviewNotesWithRewriteDelta)
        updateChapter(chapterId, { reviewNotesJson: latestReviewNotesJson }, {
          skipStaleTracking: true,
          versionSource: false,
        })
      } else {
        semanticGateCallsUsed += 1
        const goldenGateRun = await runChapterSemanticGate({
          novelId: chapter.novelId,
          chapterId,
          chapterNum: chapter.chapterNum,
          chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
          chapterContent: repairedContent,
          dimensions: CORE_SEMANTIC_GATE_DIMENSIONS,
          stage: 'golden_final',
          mode: effectiveSemanticGateMode,
          modelConfigId: novel.modelConfigId || undefined,
          contractSummary: rewriteContext.writingContractSummary,
          scenePlanSummary: rewriteContext.scenePlanSummary || summarizeStageArtifactText(scenePlanText, 520),
          protagonistBrief: profile.protagonistReference,
          heuristicHints: collectSemanticGateHeuristicHints(finalReviewNotesWithRewriteDelta),
        })
        if (goldenGateRun.degraded) {
          if (semanticGatePolicy.fallbackMode === 'heuristic') {
            // 语义终验缺席：恢复关键词门原始 blocker 行为重新验收，交由下方既有阻断逻辑处理。
            publishCheck = runChapterPublishCheck(chapterId, { phase: 'pipeline' })
            console.warn(`[semantic-gate] golden_final 语义评审失败，已回退启发式验收 chapter=${chapterId}`)
          } else {
            finalReviewNotesWithRewriteDelta = {
              ...finalReviewNotesWithRewriteDelta,
              semantic_review_warnings: dedupeTextList([
                ...(finalReviewNotesWithRewriteDelta.semantic_review_warnings || []),
                '语义评审缺席：golden_final 语义门调用失败，按 warn-pass 策略放行本章。',
              ]),
            }
            latestReviewNotesJson = JSON.stringify(finalReviewNotesWithRewriteDelta)
            updateChapter(chapterId, { reviewNotesJson: latestReviewNotesJson }, {
              skipStaleTracking: true,
              versionSource: false,
            })
          }
        } else {
          const goldenBlockerVerdicts = goldenGateRun.review.verdicts.filter((verdict) => verdict.status === 'blocker')
          finalReviewNotesWithRewriteDelta = {
            ...finalReviewNotesWithRewriteDelta,
            semantic_verdicts: goldenGateRun.review.verdicts,
            semantic_review_warnings: dedupeTextList([
              ...(finalReviewNotesWithRewriteDelta.semantic_review_warnings || []),
              ...goldenGateRun.review.warnings,
            ]),
            ...(goldenBlockerVerdicts.length > 0
              ? {
                  critical_fixes: dedupeTextList([
                    ...goldenBlockerVerdicts.map(formatSemanticGateBlockerFix),
                    ...finalReviewNotesWithRewriteDelta.critical_fixes,
                  ]),
                  severity: mergeSeverity(finalReviewNotesWithRewriteDelta.severity, 'high'),
                  rewrite_required: true,
                }
              : {}),
          }
          latestReviewNotesJson = JSON.stringify(finalReviewNotesWithRewriteDelta)
          updateChapter(chapterId, { reviewNotesJson: latestReviewNotesJson }, {
            skipStaleTracking: true,
            versionSource: false,
          })
          if (goldenBlockerVerdicts.length > 0) {
            const goldenSummary = goldenBlockerVerdicts
              .map((verdict) => `${SEMANTIC_GATE_DIMENSION_SPECS[verdict.dimension]?.label || verdict.dimension}：${verdict.summary}`)
              .slice(0, 3)
              .join('；')
            failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
              'human_review_required',
              `黄金章节语义终验未通过：${goldenSummary}`,
              {
                blocked: true,
                rewriteScope: 'chapter_rewrite',
                outputText: buildPipelineFailureOutput(
                  'human_review_required',
                  `黄金章节语义终验未通过：${goldenSummary}`,
                  { rewriteScope: 'chapter_rewrite' },
                ),
              },
            ), { blocked: true })
          }
        }
      }
    }
    const publishCheckFailureMeta = getPublishCheckRewriteFailureMeta(publishCheck)
    syncFeedbackRecurrenceState(chapter.novelId)
    syncDialogueDriftRevisionTasks(chapter.novelId)
    if (rewriteMiniReview.needsHumanReview) {
      // 差异门是“是否真正修复结构”的安全门。即使发布门的其它维度没有
      // blocker，也不能把结构差异不足降成 warning 后继续 Canonizer/Finalize。
      // 否则“可进入人工复核”会被错误地当成“可以自动写回”。
      failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
        'human_review_required',
        `重写轻量复检未通过：${rewriteMiniReview.reason}`,
        {
          blocked: true,
          rewriteScope: rewritePolicy.rewriteScope,
          outputText: buildPipelineFailureOutput(
            'human_review_required',
            `重写轻量复检未通过：${rewriteMiniReview.reason}`,
            { rewriteScope: rewritePolicy.rewriteScope },
          ),
        },
      ), { blocked: true })
    }
    if (publishCheck.gateLevel === 'rewrite') {
      failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
        'gate_rewrite_required',
        `章节门要求重写：${publishCheck.summary}`,
        {
          blocked: true,
          rewriteScope: publishCheckFailureMeta.rewriteScope,
          targetSegmentId: publishCheckFailureMeta.targetSegmentId,
          outputText: buildPipelineFailureOutput(
            'gate_rewrite_required',
            `章节门要求重写：${publishCheck.summary}`,
            {
              rewriteScope: publishCheckFailureMeta.rewriteScope,
              targetSegmentId: publishCheckFailureMeta.targetSegmentId,
            },
          ),
        },
      ), { blocked: true })
    }
    if (!publishCheck.ready) {
      failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
        'human_review_required',
        `章节门未通过：${publishCheck.summary}`,
        {
          blocked: true,
          rewriteScope: publishCheckFailureMeta.rewriteScope,
          targetSegmentId: publishCheckFailureMeta.targetSegmentId,
          outputText: buildPipelineFailureOutput(
            'human_review_required',
            `章节门未通过：${publishCheck.summary}`,
            {
              rewriteScope: publishCheckFailureMeta.rewriteScope,
              targetSegmentId: publishCheckFailureMeta.targetSegmentId,
            },
          ),
        },
      ), { blocked: true })
    }
    finishRoleTask('rewriter', rewriterTaskId, '正文已完成重写，准备生成 Canon 差异草案。')
    snapshot = {
      ...snapshot,
      partialContent: repairedContent,
      resumeReason: undefined,
      resumeSourceTaskId: rewriterTaskId,
    }
    syncWorkflowTask()

    const canonizerTaskId = await startRoleTask('canonizer', 'chapter_canonizer', 'Canonizer 正在为本章准备可确认的状态差异草案。', {
      runnerType: 'workflow',
    })
    updateTaskStatus(canonizerTaskId, 'running', sender, {
      pipelineStage: 'running',
      contractVersion,
    })
    const canonRun = await prepareChapterWritebackRunWithRetry(chapterId, 'pipeline-canonizer', 3)
    if (canonRun.status === 'failed') {
      updateTaskStatus(canonizerTaskId, 'failed', sender, {
        pipelineStage: 'failed',
        contractVersion,
        canonRunId: canonRun.id,
        errorMessage: canonRun.errorMessage || 'Canon 草案生成失败',
        recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'canonizer')),
      })
      failRoleTask('canonizer', canonizerTaskId, new Error(canonRun.errorMessage || 'Canon 草案生成失败'))
    }
    const canonDetail = canonRun.summaryText?.trim() || 'Canon 差异草案已生成，可进入章后状态回写中心确认。'
    updateTaskStatus(canonizerTaskId, 'success', sender, {
      pipelineStage: 'success',
      contractVersion,
      canonRunId: canonRun.id,
      outputText: canonDetail,
      errorMessage: null,
      recoveryHintJson: null,
    })
    finishRoleTask('canonizer', canonizerTaskId, canonDetail, { canonRunId: canonRun.id })

    const finalizeTaskId = await startRoleTask('finalize', 'chapter_finalize', '正在刷新摘要、连续性与故事记忆。', {
      runnerType: 'workflow',
      canonRunId: canonRun.id,
    })
    updateTaskStatus(finalizeTaskId, 'running', sender, {
      pipelineStage: 'running',
      contractVersion,
      canonRunId: canonRun.id,
    })
    const result = await finalizeGeneratedChapterContent(chapterId, repairedContent)
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)

    const chapterRecord = getChapter(chapterId)
    if (chapterRecord) {
      generateChapterEmbeddings(chapterRecord.novelId, chapterId, novel?.modelConfigId || undefined)
        .catch((err) => console.warn('[embedding] 向量生成失败（不影响主流程）:', err))
    }

    const finalizeDetail = [
      '章节已入稿，并刷新摘要、连续性与长期记忆。',
      publishCheck.summary ? `一致性快检：${publishCheck.summary}` : '',
      result.nextChapterSeed ? `下一章开场建议：${result.nextChapterSeed}` : '',
    ].filter(Boolean).join(' ')
    updateTaskStatus(finalizeTaskId, 'success', sender, {
      pipelineStage: 'success',
      contractVersion,
      canonRunId: canonRun.id,
      outputText: finalizeDetail,
      errorMessage: null,
      recoveryHintJson: null,
    })
    finishRoleTask('finalize', finalizeTaskId, finalizeDetail, { canonRunId: canonRun.id })

    snapshot = {
      ...snapshot,
      currentRole: 'finalize',
      currentStage: 'completed',
      status: 'success',
      message: '章节已完成角色化流水线，并落成 Canon 草案。',
      recoveryHint: undefined,
    }
    setWorkflowTaskStatus('success', {
      currentChildTaskId: null,
      outputText: [
        `第${chapter.chapterNum}章流水线完成。`,
        result.summary ? `摘要：${result.summary}` : '',
        result.nextChapterSeed ? `下一章开场建议：${result.nextChapterSeed}` : '',
      ].filter(Boolean).join(' '),
      errorMessage: null,
      recoveryHintJson: null,
    })
    sendPipelineProgress(sender, snapshot, {
      stage: 'completed',
      label: '完成入稿',
      detail: '章节已完成角色化流水线，并写入摘要、连续性与 Canon 草案。',
      status: 'success',
      role: 'finalize',
    })
    return workflowTaskId
  } catch (error) {
    const workflowTask = getTaskRecord(workflowTaskId)
    if (workflowTask?.status === 'failed' || workflowTask?.status === 'cancelled') {
      throw error
    }
    failRoleTask(snapshot.currentRole || 'planner', snapshot.currentRole ? snapshot.roles[snapshot.currentRole].taskId : undefined, error)
    throw error instanceof Error ? error : new Error('章节生成中断')
  }
}

export async function generateChapterSummary(chapterId: number): Promise<void> {
  await refreshChapterMemory(chapterId)
  void prepareChapterWritebackRun(chapterId, 'summary-refresh').catch((error) => {
    console.warn(`[chapter:warn] writeback-draft chapter=${chapterId}`, error)
  })
}

export async function resumeChapterPipeline(taskId: number, sender?: WebContents): Promise<number> {
  const task = getTaskRecord(taskId)
  if (!task) throwUserFacingError('task.notFound', { id: taskId })

  const rootTask = task.type === 'chapter_write'
    ? task
    : task.parentTaskId
      ? getTaskRecord(task.parentTaskId)
      : null

  if (!rootTask || rootTask.type !== 'chapter_write' || rootTask.relatedEntityType !== 'chapter' || !rootTask.relatedEntityId) {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  if (rootTask.status === 'success') {
    throwUserFacingError('workflow.resumeUnsupported')
  }
  if (['pending', 'running', 'cancel_requested'].includes(rootTask.status || '')) {
    throwUserFacingError('workflow.taskRunningCannotResume', { taskId: rootTask.id })
  }
  const snapshot = rootTask.progressJson ? JSON.parse(rootTask.progressJson) as Partial<ChapterPipelineSnapshot> : null
  const partialContent = typeof snapshot?.partialContent === 'string' ? snapshot.partialContent.trim() : ''
  if (partialContent) {
    return continueChapterContent(rootTask.relatedEntityId, partialContent, sender, {
      sourceTaskId: rootTask.id,
    })
  }
  return generateChapterContent(rootTask.relatedEntityId, sender)
}

export async function getChapterContextPreview(
  chapterId: number,
  options: { executionMode?: AiExecutionMode; preserveConstraintLabels?: HardConstraintSourceLabel[] } = {},
): Promise<import('../../src/types').ChapterContextPreview> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const contractVersion = buildChapterContractVersion(chapterId, { allowMissing: true })
  const contractGate = getChapterContractPreviewGate(chapterId)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: rawContext.novel.settingsJson,
  })
  const complexity = classifyChapterComplexity({
    chapter,
    currentArc: rawContext.currentArc,
    chapterRows: rawContext.chapterRows,
    outlineMentionedCharacterCount: rawContext.outlineMentionedCharacterCount,
    activeThreadPressureCount: rawContext.activeThreadPressureCount,
  })
  const activePromptOverrideKeys = getActiveChapterPromptOverrideKeys()
  const persistedScenePlanText = buildPersistedScenePlanText(chapter.scenePlanJson)
  const persistedReviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const persistedReviewPrioritySummary = buildReviewPrioritySummary(persistedReviewNotes)
  const previewStepMemory = buildStepMemorySummary({
    chapterBridgePlan: rawContext.contextParts.chapterBridgePlan,
    scenePlanText: persistedScenePlanText,
    draftText: chapter.content || '',
    reviewNotes: persistedReviewNotes,
    previousSummary: buildContractVersionArtifactSummary(contractVersion),
  })
  const previewStepMemoryArtifacts = {
    stepMemorySummary: previewStepMemory.summary,
    runtimeAssertions: previewStepMemory.runtimeAssertions,
  }

  const scenePlanResolution = await resolveStageContextForPipeline(
    'scenePlan',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const draftResolution = await resolveStageContextForPipeline(
    'draft',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: previewStepMemoryArtifacts,
    },
  )
  const reviewResolution = await resolveStageContextForPipeline(
    'review',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        scenePlanSummary: summarizeStageArtifactText(persistedScenePlanText, 520),
        draftTextSummary: summarizeStageArtifactText(chapter.content || '', 680),
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        reviewRiskSummary: buildReviewRiskArtifactSummary(persistedReviewNotes),
        reviewProofSummary: buildReviewProofArtifactSummary(persistedReviewNotes),
        publishGateRiskSummary: summarizeStageArtifactLines(persistedReviewPrioritySummary.reasons, 4, 520),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const rewriteResolution = await resolveStageContextForPipeline(
    'rewrite',
    chapter,
    rawContext,
    complexity,
    {
      executionMode: executionModeResolution.mode,
      preserveConstraintLabels: options.preserveConstraintLabels,
      contractVersion,
      activePromptOverrideKeys,
      upstreamArtifacts: {
        scenePlanSummary: summarizeStageArtifactText(persistedScenePlanText, 520),
        draftTextSummary: summarizeStageArtifactText(chapter.content || '', 680),
        contractVersionSummary: buildContractVersionArtifactSummary(contractVersion),
        reviewRiskSummary: buildReviewRiskArtifactSummary(persistedReviewNotes),
        reviewProofSummary: buildReviewProofArtifactSummary(persistedReviewNotes),
        rewriteDeltaSummary: buildRewriteDeltaArtifactSummary(
          persistedReviewNotes,
          persistedReviewPrioritySummary.rewriteScope,
          buildReviewPriorityPrompt(persistedReviewPrioritySummary),
        ),
        publishGateRiskSummary: summarizeStageArtifactLines(persistedReviewPrioritySummary.reasons, 4, 520),
        ...previewStepMemoryArtifacts,
      },
    },
  )
  const contexts: Record<ChapterContextStage, ChapterContext> = {
    scenePlan: scenePlanResolution.context,
    draft: draftResolution.context,
    review: reviewResolution.context,
    rewrite: rewriteResolution.context,
  }
  const orderedStages: ChapterContextStage[] = ['scenePlan', 'draft', 'review', 'rewrite']
  const linkedImpacts = listActiveImpactsForChapter(chapter.novelId, chapter.id)
  const usageSnapshot = buildWritingContextUsageSnapshot(draftResolution.effectiveRawContext, contexts.draft, linkedImpacts)
  const contextAssemblyReport = buildChapterContextAssemblyReport(contexts.draft, usageSnapshot)
  const authorStyleLock = buildAuthorStyleLockSummary(chapter.novelId, rawContext.novel.themeVoiceJson)
  const stageReports = buildChapterAiStageReports(
    executionModeResolution.mode,
    executionModeResolution.source,
    rawContext.novel.modelConfigId || undefined,
  )
  const generationExplainability = buildAiExplainabilityReport({
    taskKind: 'chapter_generation',
    executionMode: executionModeResolution.mode,
    usageSnapshot,
    stageReports,
    contextAssemblyReport,
    authorStyleLock,
    structuredOutputs: [
      '场景计划 JSON',
      '审校意见 JSON',
      'Canon 差异草案',
    ],
    activePromptOverrideKeys,
  })

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    contractVersion,
    contractReady: contractGate.ready,
    contractBlockers: contractGate.blockers,
    complexity,
    assemblyVersion: 'v2-unified',
    assemblyNotes: [
      '统一上下文组装器：图谱召回、时间召回与合同召回已合并调度。',
      '解释报告会同步展示执行模式、结构化输出与低置信度事实。',
    ],
    contextAssemblyReport,
    authorStyleLock,
    generationExplainability,
    previousChapterContext: rawContext.contextParts.previousChapterContext,
    chapterBridgePlan: contexts.draft.chapterBridgePlan,
    stepMemorySummary: contexts.draft.stepMemorySummary,
    previousChapterSampleReport: rawContext.previousChapterSampleReport,
    recalledMemory: contexts.draft.recalledMemory,
    recallSnapshot: contexts.draft.recallSnapshot,
    recallDiagnostics: contexts.draft.recallDiagnostics,
    recalledMemorySources: contexts.draft.recalledMemorySources,
    usageSnapshot,
    writerContextResolution: draftResolution.writerContextResolution,
    stages: orderedStages.map((stage) => {
      const context = contexts[stage]
      const resolution = stage === 'scenePlan'
        ? scenePlanResolution
        : stage === 'draft'
          ? draftResolution
          : stage === 'review'
            ? reviewResolution
            : rewriteResolution
      return {
        stage,
        hardConstraintContext: context.hardConstraintContext,
        hardConstraintSummary: context.hardConstraintSummary,
        hardConstraintEntries: context.hardConstraintEntries,
        constraintInjectionStatus: context.constraintInjectionStatus,
        softContextBudgetUsage: context.softContextBudgetUsage,
        contextBudgetReport: context.contextBudgetReport,
        softContextDecisions: context.softContextDecisions,
        droppedConstraintCount: context.droppedConstraintCount,
        upstreamArtifacts: resolution.upstreamArtifacts,
        renderSchema: resolution.renderSchema,
      }
    }),
  }
}

// 整章优化属于高风险候选生成：只要后验事实/质量门未通过，就允许严格保真重试，
// 但把总调用数封顶，避免线上请求在模型不稳定时失控。
const MAX_CHAPTER_OPTIMIZATION_PASSES = 4

export async function optimizeChapterContent(
  chapterId: number,
  options: { executionMode?: AiExecutionMode; extraRequirements?: string; repairMode?: 'language' | 'structural' } = {},
): Promise<ChapterOptimizeResult> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content?.trim()) throwUserFacingError('chapter.contentEmpty')
  const originalContent = chapter.content

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const genreName = novel?.genreId
    ? db.select({ name: genres.name }).from(genres).where(eq(genres.id, novel.genreId)).all()[0]?.name
    : undefined
  const trackedEntityNames = collectTrackedEntityNames(chapter.novelId)
  const guardrailFindings = collectQualityGuardrailFindings(originalContent, genreName, { knownTerms: trackedEntityNames })
  const reviewNotes = parseStoredReviewNotes(chapter.reviewNotesJson)
  const issueSummary = dedupeTextList([
    ...formatQualityGuardrailSummary(guardrailFindings),
    ...reviewNotes.critical_fixes,
    ...reviewNotes.language_risks,
    ...reviewNotes.human_language_repairs,
    ...reviewNotes.coherence_risks,
    ...reviewNotes.context_drift_risks,
  ]).slice(0, 12)
  const executionMode = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: novel?.settingsJson,
  })
  const repairMode = options.repairMode || 'language'
  const route = buildAiModelRouteReport({
    taskKind: 'chapter_rewrite',
    stageLabel: 'Chapter Optimize',
    executionMode: executionMode.mode,
    resolutionSource: executionMode.source,
    modelConfigId: novel?.modelConfigId || undefined,
    // 优化是审校型任务，降低采样波动，避免候选稿重新引入已拦截的 AI 句式。
    temperatureCap: 0.35,
    maxTokensFactor: 1.12,
    extraReasons: [
      repairMode === 'structural' ? '结构性质量修订允许重写事件链，但必须通过事实、合同和结构门。' : '整章优化只生成候选稿，不直接覆盖正文。',
    ],
  })

  const supportingCastNames = collectSupportingCastNames(chapter.novelId)
  const structuralGateOptions = { supportingRoleNames: supportingCastNames }

  let optimizationTaskId: number | undefined
  let optimizationPasses = 1
  const runOptimization = (extraRequirements?: string) => runChatTask({
    type: 'review',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    retryable: true,
    messages: [{
      role: 'user',
      content: buildChapterOptimizationPrompt({
        chapter,
        novelTitle: novel?.title || '未命名小说',
        genreName,
        content: originalContent,
        issueSummary,
        extraRequirements: extraRequirements?.trim(),
        repairMode,
        supportingCastNames,
      }),
    }],
    modelConfigId: route.modelConfigId,
    chatOpts: buildChatOptionsFromRoute(route),
    onSuccess: (_output, taskId) => { optimizationTaskId = taskId },
  })

  const raw = await runOptimization(options.extraRequirements)
  let optimizedContent = normalizeOptimizedChapterContent(raw)
  if (!optimizedContent) throwUserFacingError('writing.rewriteNoResult')
  let factGuard = buildChapterOptimizationFactGuard(chapter.novelId, originalContent, optimizedContent, {
    allowEndingHookChange: repairMode === 'structural',
    structuralRepair: repairMode === 'structural',
  })
  let qualityGate = buildChapterOptimizationQualityGate(originalContent, optimizedContent, genreName, trackedEntityNames)
  let structuralGate = buildChapterStructuralRepairGate(originalContent, optimizedContent, chapter.chapterNum, structuralGateOptions)

  // A rejected candidate is still useful feedback, but bounded constrained passes
  // let the online flow repair the exact fact/quality failure before surfacing a
  // result. The UI still blocks applying every unsafe result.
  const originalNumbers = extractNarrativeNumbers(originalContent).slice(0, 80)
  while ((!factGuard.safeToApply || !qualityGate.safeToApply || !structuralGate.safeToApply) && optimizationPasses < MAX_CHAPTER_OPTIMIZATION_PASSES) {
    const gateFeedback = dedupeTextList([...factGuard.warnings, ...qualityGate.warnings, ...structuralGate.warnings])
    const targetedQualityFixes = [
      qualityGate.optimizedGuardrailHits.includes('not_but_definition_pattern')
        ? '禁止使用“不是……而是……”或“并非……实际是……”句式；需要转折时拆成两个完整的直接陈述句。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('dash_abuse')
        ? '删除解释型破折号，把解释改成动作、事实或独立短句。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('low_value_body_detail')
        ? '删除低价值身体部位和模板化感官描写，换成能推动事件的具体动作。'
        : '',
      qualityGate.optimizedGuardrailHits.includes('paragraph_simile_stacking')
        ? '拆开段内密集比喻：每个段落最多保留一处必要比喻，其余改成具体动作、物件变化或可验证后果。'
        : '',
      structuralGate.warnings.some((warning) => warning.includes('扩写比例过高'))
        ? '上一版扩写超过结构修订上限；删除新增背景、支线、道具和解释，只用原章已有的人物、地点、物件和动作完成冲突结果。'
        : '',
      factGuard.warnings.some((warning) => warning.includes('叙事事实'))
        ? '上一版凭空新增了物证、记录、证据可读性或交易事实；本轮必须全部删除这些新增事实，恢复原文物件状态，只用原文已有动作、对白和人物选择完成结构修复。'
        : '',
    ].filter(Boolean)
    const retryRequirements = [
      options.extraRequirements?.trim(),
      `上一版候选未通过事实或质量门；本轮必须优先保真。具体失败项：${gateFeedback.join('；') || '未通过后验检查'}`,
      targetedQualityFixes.length > 0 ? `针对性语言修复：${targetedQualityFixes.join('；')}` : '',
      originalNumbers.length > 0
        ? `原文数字/日期/数量/编号清单（必须逐字保留）：${originalNumbers.join('、')}`
        : '',
      '不要为了改写句子而增删或换算任何数字；无法确认时直接保留原句。输出前逐项核对事实和质量门失败项。',
      repairMode === 'structural'
        ? '本轮是结构性修订：必须实际改变冲突链、人物判断或场景结果，不能仅替换同义词。'
        : '',
    ].filter(Boolean).join('\n')
    try {
      optimizationPasses += 1
      const retryRaw = await runOptimization(retryRequirements)
      const retryContent = normalizeOptimizedChapterContent(retryRaw)
      if (!retryContent) continue

      const retryFactGuard = buildChapterOptimizationFactGuard(chapter.novelId, originalContent, retryContent, {
        allowEndingHookChange: repairMode === 'structural',
        structuralRepair: repairMode === 'structural',
      })
      const retryQualityGate = buildChapterOptimizationQualityGate(originalContent, retryContent, genreName, trackedEntityNames)
      const retryStructuralGate = buildChapterStructuralRepairGate(originalContent, retryContent, chapter.chapterNum, structuralGateOptions)
      const currentWarningCount = factGuard.warnings.length + qualityGate.warnings.length + structuralGate.warnings.length
      const retryWarningCount = retryFactGuard.warnings.length + retryQualityGate.warnings.length + retryStructuralGate.warnings.length
      if (
        (retryFactGuard.safeToApply && retryQualityGate.safeToApply && retryStructuralGate.safeToApply)
        // A retry may improve language or structure, but it must never replace
        // a candidate with another fact-unsafe rewrite merely because it has
        // fewer total warnings. Facts are the fail-closed boundary.
        || (retryFactGuard.safeToApply && retryWarningCount < currentWarningCount)
      ) {
        optimizedContent = retryContent
        factGuard = retryFactGuard
        qualityGate = retryQualityGate
        structuralGate = retryStructuralGate
      }
    } catch (retryError) {
      console.warn(`[chapter:optimize] 严格保真重试失败，沿用最近候选 chapter=${chapterId}`, retryError)
    }
  }

  return {
    originalContent,
    optimizedContent,
    issueSummary,
    guardrailHits: qualityGate.originalGuardrailHits,
    changed: optimizedContent.trim() !== originalContent.trim(),
    warnings: dedupeTextList([...factGuard.warnings, ...qualityGate.warnings, ...structuralGate.warnings]),
    factGuard,
    qualityGate,
    structuralGate,
    optimizationPasses,
    ...(optimizationTaskId ? { taskId: optimizationTaskId } : {}),
  }
}

export async function aiCheckChapter(chapterId: number): Promise<unknown> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || !chapter.content) throwUserFacingError('chapter.contentEmpty')

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  const content = chapter.content
  const isTruncated = content.length > 6000
  const textToCheck = isTruncated
    ? `${content.slice(0, 3200)}\n\n……\n\n${content.slice(-2400)}`
    : content

  const result = await runChatTask({
    type: 'ai_check',
    novelId: chapter.novelId,
    relatedEntityType: 'chapter',
    relatedEntityId: chapterId,
    messages: [{ role: 'user', content: aiCheckPrompt(textToCheck, isTruncated) }],
    modelConfigId: novel?.modelConfigId || undefined,
  })

  try {
    const parsedResult = parseAiJsonResult<Record<string, unknown>>(result, 'object', {
      channel: 'chapter',
      message: '章节 AI 体检 JSON 解析失败，已降级返回原始文本。',
      consoleSummary: `[chapter:warn] ai-check-json chapter=${chapterId}`,
      context: {
        chapterId,
        novelId: chapter.novelId,
        stage: 'ai-check',
      },
    })
    const enhancedScore = enhanceAiScoreResult(parsedResult.success ? parsedResult.data : {}, content)
    const chapterResult = toChapterAiCheckResult(parsedResult.success ? parsedResult.data : {}, enhancedScore)
    db.update(chapters).set({
      // 持久化页面兼容字段，确保刷新章节后仍能恢复评分与具体问题。
      aiScoreJson: JSON.stringify({
        ...enhancedScore,
        score: chapterResult.score,
        issues: chapterResult.issues,
      }),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return chapterResult
  } catch {
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    const enhancedScore = enhanceAiScoreResult({}, content)
    return toChapterAiCheckResult({}, enhancedScore)
  }
}

export const __testing = {
  buildChapterOptimizationFactGuard,
  collectNarrativeStateWarnings,
  collectUnsupportedNarrativeFactWarnings,
  extractNarrativeNumbers,
  applyDialogueAnalysisToReviewNotes,
  parseStoredReviewNotes,
}

export { runChapterPublishCheck }
