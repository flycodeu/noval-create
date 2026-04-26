import { WebContents } from 'electron'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { chapterContracts, chapterSegments, chapterVersions, chapters, characters, novels, revisionTasks, sceneContracts, storyArcs, tasks } from '../database/schema'
import { parseAiJsonResult } from '../utils/json'
import { generateChapterEmbeddings } from './embedding.service'
import { aiCheckPrompt, chapterSummaryPrompt } from './prompts'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
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
} from './context.service'
import {
  buildChapterDraftPrompt,
  buildChapterReviewPrompt,
  buildChapterRewritePrompt,
  buildContinuityStatePrompt,
  buildScenePlanPrompt,
} from './story-prompts'
import { getQualityDashboardData } from './quality-dashboard.service'
import {
  createTask,
  executeChatTask,
  executeStreamTask,
  getTaskRecord,
  parseTaskControl,
  runChatTask,
  TaskRecoveryHint,
  updateTask,
  updateTaskProgress,
  updateTaskStatus,
} from './task.service'
import { buildConsistencyPromptSummary, buildNovelConsistencyReport } from './consistency.service'
import { syncChapterTimelineStatuses } from './link-sync.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  collectQualityGuardrailFindings,
  formatQualityGuardrailSummary,
  shouldForceRepair,
} from '../../src/shared/content-guardrails'
import {
  markChapterContextCurrent,
  markSubsequentChaptersStale,
  runChapterPublishCheck,
  validateChapterContractsForGeneration,
} from './context-impact.service'
import {
  normalizeChapterContractValidationResult,
  validateChapterContractDelivery,
} from './chapter-contract-validator.service'
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
import { enhanceAiScoreResult } from './ai-score.service'
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
import { analyzeSummaryHealthForChapter, refreshSummaryHealth } from './summary-decay.service'
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
import type {
  AiContextAssemblyReport,
  AiExecutionMode,
  AiExplainabilityReport,
  AiStageExecutionReport,
  AuthorStyleLockSummary,
  ChapterBridgePlan,
  ChapterRewriteScope,
  ChapterContractValidationResult,
  ExpressionDedupReport,
  HookContinuitySnapshot,
  PovRotationPlan,
  StoryPacingCurve,
  StyleComplianceMetricSnapshot,
  StyleComplianceResult,
  SummaryHealthReport,
  VoiceEvolutionProfile,
} from '../../src/types'

interface ChapterSummaryData {
  summary: string
  nextChapterSeed: string
}

interface ScenePlanStep {
  scene_order: number
  scene_title: string
  purpose: string
  location: string
  time_anchor: string
  present_characters: string[]
  key_items: string[]
  conflict: string
  beat: string
  must_cover: string[]
  exit_hook: string
}

type ReviewSeverity = 'low' | 'medium' | 'high'
type ProtagonistSetbackLevel = 'none' | 'minor' | 'major'
type CostResolutionState = 'new' | 'ongoing' | 'resolved' | 'evaporated'
type ReversalSupportState = 'supported' | 'weak' | 'forced'
type ChapterPacingMarker = 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'
type RewardState = 'none' | 'partial' | 'major'
type ChapterFunctionTag = 'setup' | 'progression' | 'reversal' | 'payoff' | 'breather' | 'climax' | 'exposition' | 'closure'

interface ChapterReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks: string[]
  context_drift_risks: string[]
  realism_risks: string[]
  coherence_risks: string[]
  reader_hook_risks: string[]
  language_risks: string[]
  human_language_repairs: string[]
  genre_hollowing_risks: string[]
  missing_payoffs: string[]
  strengths: string[]
  severity: ReviewSeverity
  rewrite_required: boolean
  revision_brief: string
  protagonist_setback: ProtagonistSetbackLevel
  setback_summary: string
  cost_present: boolean
  cost_summary: string
  cost_resolution_state?: CostResolutionState
  reversal_marker: boolean
  reversal_summary: string
  reversal_support_state?: ReversalSupportState
  pace_marker?: ChapterPacingMarker
  reward_state: RewardState
  protagonist_pressure: number
  chapter_function_primary?: ChapterFunctionTag
  chapter_function_tags: ChapterFunctionTag[]
  dialogue_homogenization_risks: string[]
  dialogue_fingerprint_summary: string
  dialogue_voice_lock_summary: string
  dialogue_filler_risks: string[]
  dialogue_info_density_risks: string[]
  required_voice_lock_character_ids: number[]
  cross_character_similarity: Array<{
    characterAId: number
    characterAName: string
    characterBId: number
    characterBName: string
    similarity: number
    reason: string
  }>
  dialogue_drift_alerts: Array<{
    characterId: number
    characterName: string
    driftRate: number
    reason: string
  }>
  humanization_signals: HumanizationSignal[]
  style_compliance?: StyleComplianceResult
  contract_validation?: ChapterContractValidationResult
}

type ChapterPipelineRole = 'planner' | 'writer' | 'critic' | 'rewriter' | 'canonizer' | 'finalize'
type ChapterPipelineRoleStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked'
type ChapterGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'canonizing' | 'completed' | 'failed'

const STYLE_COMPLIANCE_RISK_PREFIX = '风格硬约束：'
const STYLE_COMPLIANCE_FIX_PREFIX = '风格修正：'
const HUMANIZATION_SIGNAL_TYPES = new Set<HumanizationSignal['issueType']>([
  'ai_slogan',
  'template_emotion',
  'template_connector',
  'explanatory_narration',
  'ornament_overload',
  'sensory_anchor_missing',
  'weak_stance',
])
const HUMANIZATION_REVIEW_SIGNAL_TYPES = new Set<HumanizationSignal['issueType']>([
  'template_connector',
  'explanatory_narration',
  'ornament_overload',
  'sensory_anchor_missing',
  'weak_stance',
])
type ChapterPipelineFailureCode =
  | 'contract_blocked'
  | 'context_overflow'
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
  recoveryHint?: TaskRecoveryHint
  failureCode?: ChapterPipelineFailureCode
  rewriteScope?: ChapterRewriteScope
  targetSegmentId?: number | null
  lastFailureRole?: ChapterPipelineRole
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

function getDefaultChapterTitle(chapterNum: number): string {
  return `第${chapterNum}章`
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

function loadNarrativeControlSceneSnapshots(chapterId: number): NarrativeControlSceneSnapshot[] {
  const db = getDb()
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const sceneBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  sceneRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !sceneBySegmentId.has(row.segmentId)) {
      sceneBySegmentId.set(row.segmentId, row)
    }
  })

  return [
    ...segmentRows.map((segment) => {
      const scene = sceneBySegmentId.get(segment.id)
      return {
        segmentId: segment.id,
        segmentOrder: segment.segmentOrder,
        segmentTitle: segment.title || `场景 ${segment.segmentOrder}`,
        pov: scene?.pov || '',
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((scene) => ({
        segmentId: scene.segmentId ?? undefined,
        segmentTitle: `场景合同 ${scene.id}`,
        pov: scene.pov || '',
      })),
  ]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0))]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function contentReportLine(summary: string): string {
  return summary ? `当前检测：${summary}` : ''
}

function normalizeReviewSeverity(value: unknown): ReviewSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

function normalizeBoundedNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeProtagonistSetback(value: unknown): ProtagonistSetbackLevel {
  return value === 'major' || value === 'minor' || value === 'none' ? value : 'none'
}

function normalizeCostResolutionState(value: unknown): CostResolutionState | undefined {
  return value === 'new' || value === 'ongoing' || value === 'resolved' || value === 'evaporated'
    ? value
    : undefined
}

function normalizeReversalSupportState(value: unknown): ReversalSupportState | undefined {
  return value === 'supported' || value === 'weak' || value === 'forced' ? value : undefined
}

function normalizePaceMarker(value: unknown): ChapterPacingMarker | undefined {
  return value === 'setup'
    || value === 'conflict'
    || value === 'reversal'
    || value === 'climax'
    || value === 'payoff'
    || value === 'breather'
    ? value
    : undefined
}

function normalizeRewardState(value: unknown): RewardState {
  return value === 'partial' || value === 'major' || value === 'none' ? value : 'none'
}

function normalizeChapterFunctionTag(value: unknown): ChapterFunctionTag | undefined {
  return value === 'setup'
    || value === 'progression'
    || value === 'reversal'
    || value === 'payoff'
    || value === 'breather'
    || value === 'climax'
    || value === 'exposition'
    || value === 'closure'
    ? value
    : undefined
}

function normalizeChapterFunctionTags(value: unknown): ChapterFunctionTag[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeChapterFunctionTag(item)).filter(Boolean))] as ChapterFunctionTag[]
}

function mergeSeverity(current: ReviewSeverity, incoming: ReviewSeverity): ReviewSeverity {
  const rank: Record<ReviewSeverity, number> = { low: 1, medium: 2, high: 3 }
  return rank[incoming] > rank[current] ? incoming : current
}

function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]?\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
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
  context: Pick<ChapterContext, 'recalledMemorySources' | 'recallSnapshot' | 'timelineSummary' | 'timelineOpenThreads' | 'hardConstraintEntries'>,
  usageSnapshot: import('../../src/types').WritingContextUsageSnapshot,
): AiContextAssemblyReport {
  const graphItems = usageSnapshot.usedAssets.length
  const timelineItems = [
    context.timelineSummary,
    context.timelineOpenThreads,
    ...usageSnapshot.recentStateChanges,
  ].filter(Boolean).length
  const contractItems = usageSnapshot.usedContracts.length + context.hardConstraintEntries.length

  return {
    assemblyVersion: 'v2-unified',
    summary: `统一上下文组装器已合并资产图谱、时间线索与合同硬约束，本章共装配 ${graphItems + timelineItems + contractItems} 个有效上下文入口。`,
    layers: [
      {
        key: 'graph_recall',
        label: '图谱召回',
        itemCount: graphItems,
        summary: graphItems > 0
          ? `命中 ${graphItems} 个已使用资产，并补入 ${context.recalledMemorySources.filter((item) => !item.stale).length} 条召回片段。`
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

function getCompletedPipelineRoleCount(snapshot: ChapterPipelineSnapshot): number {
  return Object.values(snapshot.roles).filter((role) => role.status === 'success').length
}

function sendPipelineProgress(
  sender: WebContents | undefined,
  snapshot: ChapterPipelineSnapshot,
  payload: Pick<ChapterGenerationProgressEvent, 'stage' | 'label' | 'detail' | 'status'> & { role?: ChapterPipelineRole },
) {
  sendGenerationProgress(sender, {
    chapterId: snapshot.chapterId,
    taskId: snapshot.workflowTaskId,
    streamTaskId: snapshot.streamTaskId,
    role: payload.role ?? snapshot.currentRole ?? undefined,
    stage: payload.stage,
    label: payload.label,
    detail: payload.detail,
    completed: Math.min(getCompletedPipelineRoleCount(snapshot), 5),
    total: 5,
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

function buildChapterContractVersion(chapterId: number): string {
  const db = getDb()
  const chapterContract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.id))
    .all()

  if (!chapterContract) {
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
  if (fallback?.trim()) return fallback
  return [
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

function normalizeScenePlan(raw: unknown, fallback: ScenePlanStep[]): ScenePlanStep[] {
  if (!Array.isArray(raw)) return fallback

  const normalized = raw
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const record = item as Record<string, unknown>
      const purpose = asText(record.purpose)
      const beat = asText(record.beat)
      const title = asText(record.scene_title)
      if (!purpose && !beat && !title) return null

      return {
        scene_order: typeof record.scene_order === 'number' ? Math.round(record.scene_order) : index + 1,
        scene_title: title || `场景 ${index + 1}`,
        purpose,
        location: asText(record.location),
        time_anchor: asText(record.time_anchor),
        present_characters: toStringArray(record.present_characters),
        key_items: toStringArray(record.key_items),
        conflict: asText(record.conflict),
        beat,
        must_cover: toStringArray(record.must_cover),
        exit_hook: asText(record.exit_hook),
      }
    })
    .filter((item): item is ScenePlanStep => Boolean(item))

  return normalized.length > 0 ? normalized : fallback
}

function buildFallbackScenePlan(chapter: typeof chapters.$inferSelect): ScenePlanStep[] {
  const outlineLines = (chapter.outline || '')
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5)

  const seeds = outlineLines.length > 0
    ? outlineLines
    : [extractChapterGoal(chapter.outline) || `完成${getDefaultChapterTitle(chapter.chapterNum)}的核心推进`]

  return seeds.map((line, index) => ({
    scene_order: index + 1,
    scene_title: `场景 ${index + 1}`,
    purpose: line,
    location: '',
    time_anchor: '',
    present_characters: [],
    key_items: [],
    conflict: '',
    beat: line,
    must_cover: [line],
    exit_hook: index === seeds.length - 1 ? '把本章推进到自然收束点。' : '把当前冲突继续推向下一段。',
  }))
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

function formatScenePlan(scenePlan: ScenePlanStep[]): string {
  return scenePlan
    .map((step) => {
      const parts = [
        `目标=${step.purpose}`,
        step.location ? `地点=${step.location}` : '',
        step.time_anchor ? `时间=${step.time_anchor}` : '',
        step.present_characters.length > 0 ? `人物=${step.present_characters.join('、')}` : '',
        step.key_items.length > 0 ? `物品=${step.key_items.join('、')}` : '',
        step.conflict ? `冲突=${step.conflict}` : '',
        step.beat ? `动作=${step.beat}` : '',
        step.must_cover.length > 0 ? `必须交代=${step.must_cover.join('；')}` : '',
        step.exit_hook ? `收尾=${step.exit_hook}` : '',
      ].filter(Boolean)
      return `${step.scene_order}. ${step.scene_title}\n${parts.join('\n')}`
    })
    .join('\n\n')
}

function normalizeReviewNotes(raw: unknown): ChapterReviewNotes {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  const costPresent = normalizeBoolean(record.cost_present)
  const reversalMarker = normalizeBoolean(record.reversal_marker)
  const chapterFunctionPrimary = normalizeChapterFunctionTag(record.chapter_function_primary)
  const chapterFunctionTags = normalizeChapterFunctionTags(record.chapter_function_tags)
  if (chapterFunctionPrimary && !chapterFunctionTags.includes(chapterFunctionPrimary)) {
    chapterFunctionTags.unshift(chapterFunctionPrimary)
  }
  const normalizeHumanizationSignalSeverity = (value: unknown): HumanizationSignal['severity'] => (
    value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
  )
  const humanizationSignals: HumanizationSignal[] = Array.isArray(record.humanization_signals)
    ? record.humanization_signals
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .reduce<HumanizationSignal[]>((result, item) => {
        const current = item as Record<string, unknown>
        const issueType = asText(current.issueType) as HumanizationSignal['issueType']
        if (!HUMANIZATION_SIGNAL_TYPES.has(issueType)) return result
        result.push({
          issueType,
          title: asText(current.title) || issueType,
          severity: normalizeHumanizationSignalSeverity(current.severity),
          detail: asText(current.detail),
          avoid: asText(current.avoid),
          prefer: asText(current.prefer) || undefined,
          metricKey: asText(current.metricKey) || undefined,
          metricValue: typeof current.metricValue === 'number'
            ? normalizeBoundedNumber(current.metricValue, 0, 1000, 0)
            : undefined,
        })
        return result
      }, [])
    : []

  return {
    summary: asText(record.summary),
    critical_fixes: toStringArray(record.critical_fixes),
    continuity_risks: toStringArray(record.continuity_risks),
    arc_progress_risks: toStringArray(record.arc_progress_risks),
    context_drift_risks: toStringArray(record.context_drift_risks),
    realism_risks: toStringArray(record.realism_risks),
    coherence_risks: toStringArray(record.coherence_risks),
    reader_hook_risks: toStringArray(record.reader_hook_risks),
    language_risks: toStringArray(record.language_risks),
    human_language_repairs: toStringArray(record.human_language_repairs),
    genre_hollowing_risks: toStringArray(record.genre_hollowing_risks),
    missing_payoffs: toStringArray(record.missing_payoffs),
    strengths: toStringArray(record.strengths),
    severity: normalizeReviewSeverity(record.severity),
    rewrite_required: record.rewrite_required === true,
    revision_brief: asText(record.revision_brief),
    protagonist_setback: normalizeProtagonistSetback(record.protagonist_setback),
    setback_summary: asText(record.setback_summary),
    cost_present: costPresent,
    cost_summary: asText(record.cost_summary),
    cost_resolution_state: costPresent ? normalizeCostResolutionState(record.cost_resolution_state) : undefined,
    reversal_marker: reversalMarker,
    reversal_summary: asText(record.reversal_summary),
    reversal_support_state: reversalMarker ? normalizeReversalSupportState(record.reversal_support_state) : undefined,
    pace_marker: normalizePaceMarker(record.pace_marker),
    reward_state: normalizeRewardState(record.reward_state),
    protagonist_pressure: normalizeBoundedNumber(record.protagonist_pressure, 0, 100, 0),
    chapter_function_primary: chapterFunctionPrimary,
    chapter_function_tags: chapterFunctionTags,
    dialogue_homogenization_risks: toStringArray(record.dialogue_homogenization_risks),
    dialogue_fingerprint_summary: asText(record.dialogue_fingerprint_summary),
    dialogue_voice_lock_summary: asText(record.dialogue_voice_lock_summary),
    dialogue_filler_risks: toStringArray(record.dialogue_filler_risks),
    dialogue_info_density_risks: toStringArray(record.dialogue_info_density_risks),
    required_voice_lock_character_ids: toNumberArray(record.required_voice_lock_character_ids),
    cross_character_similarity: Array.isArray(record.cross_character_similarity)
      ? record.cross_character_similarity
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterAId: normalizeBoundedNumber(current.characterAId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterAName: asText(current.characterAName),
            characterBId: normalizeBoundedNumber(current.characterBId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterBName: asText(current.characterBName),
            similarity: normalizeBoundedNumber(current.similarity, 0, 100, 0),
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterAId > 0 && item.characterBId > 0 && item.characterAName && item.characterBName)
      : [],
    dialogue_drift_alerts: Array.isArray(record.dialogue_drift_alerts)
      ? record.dialogue_drift_alerts
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterId: normalizeBoundedNumber(current.characterId, 0, Number.MAX_SAFE_INTEGER, 0),
            characterName: asText(current.characterName),
            driftRate: normalizeBoundedNumber(current.driftRate, 0, 100, 0),
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterId > 0 && item.characterName)
      : [],
    humanization_signals: humanizationSignals,
    style_compliance: normalizeStyleComplianceResult(record.style_compliance),
    contract_validation: normalizeChapterContractValidationResult(record.contract_validation) || undefined,
  }
}

function hasReviewNotes(notes: ChapterReviewNotes): boolean {
  return Boolean(
    notes.summary ||
    notes.critical_fixes.length > 0 ||
    notes.continuity_risks.length > 0 ||
    notes.arc_progress_risks.length > 0 ||
    notes.context_drift_risks.length > 0 ||
    notes.realism_risks.length > 0 ||
    notes.coherence_risks.length > 0 ||
    notes.reader_hook_risks.length > 0 ||
    notes.language_risks.length > 0 ||
    notes.human_language_repairs.length > 0 ||
    notes.genre_hollowing_risks.length > 0 ||
    notes.missing_payoffs.length > 0 ||
    notes.strengths.length > 0 ||
    notes.rewrite_required ||
    notes.revision_brief ||
    notes.protagonist_setback !== 'none' ||
    notes.setback_summary ||
    notes.cost_present ||
    notes.cost_summary ||
    Boolean(notes.cost_resolution_state) ||
    notes.reversal_marker ||
    notes.reversal_summary ||
    Boolean(notes.reversal_support_state) ||
    Boolean(notes.pace_marker) ||
    notes.reward_state !== 'none' ||
    notes.protagonist_pressure > 0 ||
    Boolean(notes.chapter_function_primary) ||
    notes.chapter_function_tags.length > 0 ||
    notes.dialogue_homogenization_risks.length > 0 ||
    Boolean(notes.dialogue_fingerprint_summary) ||
    Boolean(notes.dialogue_voice_lock_summary) ||
    notes.dialogue_filler_risks.length > 0 ||
    notes.dialogue_info_density_risks.length > 0 ||
    notes.required_voice_lock_character_ids.length > 0 ||
    notes.cross_character_similarity.length > 0 ||
    notes.dialogue_drift_alerts.length > 0 ||
    notes.humanization_signals.length > 0 ||
    Boolean(notes.style_compliance) ||
    Boolean(notes.contract_validation && notes.contract_validation.itemResults.length > 0),
  )
}

function buildFallbackReviewNotes(consistencyNotes: string): ChapterReviewNotes {
  const consistencyLines = consistencyNotes
    .split('\n')
    .map((line) => line.replace(/^-+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)

  return {
    summary: '先按场景计划把事件链写顺，再统一修正承接、常识和语言问题。',
    critical_fixes: ['逐段核对场景计划里的 must_cover 是否全部落地。'],
    continuity_risks: consistencyLines,
    arc_progress_risks: [],
    context_drift_risks: [],
    realism_risks: [],
    coherence_risks: [],
    reader_hook_risks: [],
    language_risks: ['删除抽象口号、概念化抒情和不自然搭配。'],
    human_language_repairs: [],
    genre_hollowing_risks: [],
    missing_payoffs: [],
    strengths: [],
    severity: 'medium',
    rewrite_required: true,
    revision_brief: '保持当前剧情方向，重点修承接、人物状态、物品去向、代价落点和语言自然度。',
    protagonist_setback: 'none',
    setback_summary: '',
    cost_present: false,
    cost_summary: '',
    cost_resolution_state: undefined,
    reversal_marker: false,
    reversal_summary: '',
    reversal_support_state: undefined,
    pace_marker: undefined,
    reward_state: 'none',
    protagonist_pressure: 0,
    chapter_function_primary: undefined,
    chapter_function_tags: [],
    dialogue_homogenization_risks: [],
    dialogue_fingerprint_summary: '',
    dialogue_voice_lock_summary: '',
    dialogue_filler_risks: [],
    dialogue_info_density_risks: [],
    required_voice_lock_character_ids: [],
    cross_character_similarity: [],
    dialogue_drift_alerts: [],
    humanization_signals: [],
    style_compliance: undefined,
    contract_validation: undefined,
  }
}

function formatReviewNotes(notes: ChapterReviewNotes): string {
  return [
    notes.summary ? `整体判断：${notes.summary}` : '',
    notes.critical_fixes.length > 0 ? `必须修改：\n- ${notes.critical_fixes.join('\n- ')}` : '',
    notes.continuity_risks.length > 0 ? `连续性风险：\n- ${notes.continuity_risks.join('\n- ')}` : '',
    notes.arc_progress_risks.length > 0 ? `故事弧推进风险：\n- ${notes.arc_progress_risks.join('\n- ')}` : '',
    notes.context_drift_risks.length > 0 ? `上下文漂移风险：\n- ${notes.context_drift_risks.join('\n- ')}` : '',
    notes.realism_risks.length > 0 ? `常识/规则风险：\n- ${notes.realism_risks.join('\n- ')}` : '',
    notes.coherence_risks.length > 0 ? `连贯性风险：\n- ${notes.coherence_risks.join('\n- ')}` : '',
    notes.reader_hook_risks.length > 0 ? `追读风险：\n- ${notes.reader_hook_risks.join('\n- ')}` : '',
    notes.language_risks.length > 0 ? `语言风险：\n- ${notes.language_risks.join('\n- ')}` : '',
    notes.human_language_repairs.length > 0 ? `语言替换建议：\n- ${notes.human_language_repairs.join('\n- ')}` : '',
    notes.genre_hollowing_risks.length > 0 ? `体裁空心化：\n- ${notes.genre_hollowing_risks.join('\n- ')}` : '',
    notes.missing_payoffs.length > 0 ? `缺失回收：\n- ${notes.missing_payoffs.join('\n- ')}` : '',
    notes.strengths.length > 0 ? `可保留优点：\n- ${notes.strengths.join('\n- ')}` : '',
    notes.protagonist_setback !== 'none' || notes.setback_summary
      ? `主角受挫：${notes.protagonist_setback}${notes.setback_summary ? ` · ${notes.setback_summary}` : ''}`
      : '',
    notes.cost_present
      ? `代价状态：${notes.cost_resolution_state || 'new'}${notes.cost_summary ? ` · ${notes.cost_summary}` : ''}`
      : '',
    notes.reversal_marker
      ? `反转判断：${notes.reversal_support_state || 'weak'}${notes.reversal_summary ? ` · ${notes.reversal_summary}` : ''}`
      : '',
    notes.pace_marker ? `章节节奏标签：${notes.pace_marker}` : '',
    notes.reward_state !== 'none' ? `阶段回报：${notes.reward_state}` : '',
    notes.protagonist_pressure > 0 ? `主角压力值：${notes.protagonist_pressure}` : '',
    notes.chapter_function_primary ? `章节主功能：${notes.chapter_function_primary}` : '',
    notes.chapter_function_tags.length > 0 ? `章节功能标签：${notes.chapter_function_tags.join(' / ')}` : '',
    notes.dialogue_fingerprint_summary ? `角色对白辨识度：${notes.dialogue_fingerprint_summary}` : '',
    notes.dialogue_voice_lock_summary ? `本章 Voice Lock：${notes.dialogue_voice_lock_summary}` : '',
    notes.dialogue_homogenization_risks.length > 0 ? `对白同质化风险：\n- ${notes.dialogue_homogenization_risks.join('\n- ')}` : '',
    notes.dialogue_filler_risks.length > 0 ? `对白空转风险：\n- ${notes.dialogue_filler_risks.join('\n- ')}` : '',
    notes.dialogue_info_density_risks.length > 0 ? `对白信息推进风险：\n- ${notes.dialogue_info_density_risks.join('\n- ')}` : '',
    notes.required_voice_lock_character_ids.length > 0 ? `需强制 Voice Lock 角色：${notes.required_voice_lock_character_ids.join('、')}` : '',
    notes.cross_character_similarity.length > 0
      ? `高相似角色组合：\n- ${notes.cross_character_similarity.map((item) => `${item.characterAName}/${item.characterBName} (${item.similarity})：${item.reason}`).join('\n- ')}`
      : '',
    notes.dialogue_drift_alerts.length > 0
      ? `角色语音漂移：\n- ${notes.dialogue_drift_alerts.map((item) => `${item.characterName} (${item.driftRate})：${item.reason}`).join('\n- ')}`
      : '',
    notes.humanization_signals.length > 0
      ? `去 AI 味风险：\n- ${notes.humanization_signals.map((item) => `${item.title}：${item.detail}`).join('\n- ')}`
      : '',
    notes.style_compliance
      ? `风格合规：${notes.style_compliance.status} · ${notes.style_compliance.score} 分${notes.style_compliance.summary ? ` · ${notes.style_compliance.summary}` : ''}`
      : '',
    notes.style_compliance && notes.style_compliance.deviations.length > 0
      ? `风格偏移：\n- ${notes.style_compliance.deviations.join('\n- ')}`
      : '',
    notes.style_compliance && notes.style_compliance.matchedForbiddenPatterns.length > 0
      ? `命中文风禁用：\n- ${notes.style_compliance.matchedForbiddenPatterns.join('\n- ')}`
      : '',
    notes.style_compliance && notes.style_compliance.rewriteHints.length > 0
      ? `风格修正提示：\n- ${notes.style_compliance.rewriteHints.join('\n- ')}`
      : '',
    notes.contract_validation?.summary ? `合同兑现验证：${notes.contract_validation.summary}` : '',
    notes.contract_validation && notes.contract_validation.itemResults.some((item) => item.verdict !== 'pass')
      ? `合同失败项：\n- ${notes.contract_validation.itemResults
        .filter((item) => item.verdict !== 'pass')
        .slice(0, 6)
        .map((item) => `${item.segmentTitle ? `${item.segmentTitle} · ` : ''}${item.expected} [${item.verdict}]${item.evidenceExcerpt ? `：${item.evidenceExcerpt}` : ''}`)
        .join('\n- ')}`
      : '',
    notes.contract_validation?.rewriteHints.length
      ? `合同重写提示：\n- ${notes.contract_validation.rewriteHints.join('\n- ')}`
      : '',
    `严重等级：${notes.severity}`,
    `是否需要重写：${notes.rewrite_required ? '是' : '否'}`,
    notes.revision_brief ? `修订摘要：${notes.revision_brief}` : '',
  ].filter(Boolean).join('\n\n')
}

function applyContractValidationToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  contractValidation: ChapterContractValidationResult,
): ChapterReviewNotes {
  const failedItems = contractValidation.itemResults.filter((item) => item.verdict !== 'pass')
  const criticalFixes = failedItems
    .filter((item) => item.verdict === 'missing' || item.verdict === 'contradicted')
    .map((item) => item.rewriteHint)
  const arcRisks = failedItems
    .filter((item) => item.contractItemType === 'chapter_goal' || item.contractItemType === 'story_thread_progress')
    .map((item) => `${item.expected}：${item.verdict === 'weak' ? '正文只有提及，没有形成明确推进。' : '正文还没有形成可验证的兑现证据。'}`)
  const hookRisks = failedItems
    .filter((item) => item.contractItemType === 'chapter_hook')
    .map((item) => '章尾钩子偏弱或缺失，收束过平，追读驱动力不足。')
  const missingPayoffs = failedItems
    .filter((item) => item.contractItemType === 'foreshadow_delivery')
    .map((item) => `${item.expected}：${item.verdict === 'weak' ? '目前只有提及，没有埋设/推进/回收或延期说明。' : '正文未处理该伏笔。'}`)
  const coherenceRisks = failedItems
    .filter((item) => item.contractItemType === 'scene_result_state')
    .map((item) => `${item.segmentTitle || '场景'} 缺少清晰结果状态，场景结尾没有把变化落地。`)
  const realismRisks = failedItems
    .filter((item) => item.contractItemType === 'scene_conflict')
    .map((item) => `${item.segmentTitle || '场景'} 冲突不够可见，阻力更像说明而不是事件。`)

  return {
    ...reviewNotes,
    critical_fixes: dedupeTextList([...criticalFixes, ...reviewNotes.critical_fixes]),
    arc_progress_risks: dedupeTextList([...reviewNotes.arc_progress_risks, ...arcRisks]),
    reader_hook_risks: dedupeTextList([...reviewNotes.reader_hook_risks, ...hookRisks]),
    missing_payoffs: dedupeTextList([...reviewNotes.missing_payoffs, ...missingPayoffs]),
    coherence_risks: dedupeTextList([...reviewNotes.coherence_risks, ...coherenceRisks]),
    realism_risks: dedupeTextList([...reviewNotes.realism_risks, ...realismRisks]),
    summary: reviewNotes.summary || contractValidation.summary,
    severity: contractValidation.status === 'blocker'
      ? mergeSeverity(reviewNotes.severity, 'high')
      : contractValidation.status === 'warning'
        ? mergeSeverity(reviewNotes.severity, 'medium')
        : reviewNotes.severity,
    rewrite_required: reviewNotes.rewrite_required || contractValidation.status === 'blocker',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, contractValidation.rewriteHints),
    contract_validation: contractValidation,
  }
}

function findingSeverityToReviewSeverity(severity: 'low' | 'medium' | 'high'): ReviewSeverity {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

function buildGuardrailCriticalFixes(findings: ReturnType<typeof collectQualityGuardrailFindings>): string[] {
  const fixes: string[] = []

  if (findings.some((finding) => finding.code === 'object_category_mismatch')) {
    fixes.push('把物体、系统或设施写成人的句子全部改成准确说法，例如把“电网死亡”改成“电网瘫痪”或“电网中断”。')
  }

  if (findings.some((finding) => finding.code === 'zero_cost_resolution')) {
    fixes.push('把伤亡、物资、秩序或战斗结果的代价写进场景里，不能一句话零成本解决。')
  }

  if (findings.some((finding) => finding.code === 'ai_slogan' || finding.code === 'template_emotion')) {
    fixes.push('删掉口号句、模板情绪和假深刻抒情，改回动作、反应、对话与细节。')
  }

  if (findings.some((finding) => finding.code === 'genre_hollowing')) {
    fixes.push('把体裁生态写回场景，补齐修行秩序、生存链或江湖规矩，不要只剩抽象口号和单一动作。')
  }

  if (findings.some((finding) => finding.code === 'ai_opener' || finding.code === 'ai_action_cliche' || finding.code === 'ai_emotional_cliche')) {
    fixes.push('替换所有AI高频开头（"突然""这一刻"）、套路动作（"深吸一口气""瞳孔骤然收缩"）和模板情绪（"心中涌起""百感交集"），改用角色特有的反应方式。')
  }

  if (findings.some((finding) => finding.code === 'ai_pseudo_philosophy' || finding.code === 'ai_ending_summary')) {
    fixes.push('删掉段落结尾的伪哲学总结句（"或许这就是""这一刻他终于明白"），让事件和动作自己说话。')
  }

  if (findings.some((finding) => finding.code === 'high_frequency_repetition')) {
    const repetitionFinding = findings.find((f) => f.code === 'high_frequency_repetition')
    if (repetitionFinding) {
      fixes.push(`高频重复词组需替换：${repetitionFinding.excerpt}——用同义表达或删减来避免阅读疲劳。`)
    }
  }

  return fixes
}

function appendRevisionBrief(base: string, additions: string[]): string {
  const merged = dedupeTextList([base, ...additions])
  if (merged.length === 0) return ''
  return merged.join('；').slice(0, 140)
}

function applyHumanizationAnalysisToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  content: string,
  genre?: string,
): ChapterReviewNotes {
  const aiFlavor = analyzeWorkspaceAiFlavor(content, genre)
  const signals = aiFlavor.humanizationSignals.filter((item) => HUMANIZATION_REVIEW_SIGNAL_TYPES.has(item.issueType))
  if (signals.length === 0 && aiFlavor.humanizationDirections.length === 0) {
    return reviewNotes
  }

  const signalDetails = signals.map((item) => `${item.title}：${item.detail}`)
  const criticalSignals = signals
    .filter((item) => item.severity === 'high')
    .map((item) => `${item.title}：${item.prefer || item.avoid}`)
  const languageRisks = signals
    .filter((item) => item.issueType === 'template_connector' || item.issueType === 'explanatory_narration' || item.issueType === 'ornament_overload')
    .map((item) => item.detail)
  const coherenceRisks = signals
    .filter((item) => item.issueType === 'sensory_anchor_missing' || item.issueType === 'weak_stance')
    .map((item) => item.detail)
  const reviewSignalMap = new Map(reviewNotes.humanization_signals.map((item) => [item.issueType, item] as const))
  signals.forEach((item) => {
    const existing = reviewSignalMap.get(item.issueType)
    if (!existing || (existing.severity !== 'high' && item.severity === 'high')) {
      reviewSignalMap.set(item.issueType, item)
    }
  })

  return {
    ...reviewNotes,
    critical_fixes: dedupeTextList([...reviewNotes.critical_fixes, ...criticalSignals]),
    language_risks: dedupeTextList([...reviewNotes.language_risks, ...languageRisks]),
    coherence_risks: dedupeTextList([...reviewNotes.coherence_risks, ...coherenceRisks]),
    human_language_repairs: dedupeTextList([...reviewNotes.human_language_repairs, ...aiFlavor.humanizationDirections]),
    summary: reviewNotes.summary || aiFlavor.summary,
    severity: signals.reduce(
      (current, item) => mergeSeverity(current, item.severity === 'high' ? 'high' : item.severity === 'medium' ? 'medium' : 'low'),
      reviewNotes.severity,
    ),
    rewrite_required: reviewNotes.rewrite_required || signals.some((item) => item.severity === 'high'),
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      ...signalDetails,
      ...aiFlavor.humanizationDirections.slice(0, 3),
    ]),
    humanization_signals: [...reviewSignalMap.values()],
  }
}

function applyDialogueAnalysisToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  novelId: number,
  chapterNum: number,
  content: string,
): ChapterReviewNotes {
  const analysis = analyzeChapterDialogueAgainstNovel(novelId, chapterNum, content)
  if (
    !analysis.fingerprintSummary
    && !analysis.voiceLockSummary
    && analysis.risks.length === 0
    && analysis.similarities.length === 0
    && analysis.drifts.length === 0
    && analysis.fillerRisks.length === 0
    && analysis.infoDensityRisks.length === 0
    && analysis.requiredVoiceLockCharacterIds.length === 0
  ) {
    return reviewNotes
  }

  return {
    ...reviewNotes,
    dialogue_homogenization_risks: dedupeTextList([
      ...reviewNotes.dialogue_homogenization_risks,
      ...analysis.risks,
    ]),
    dialogue_fingerprint_summary: analysis.fingerprintSummary || reviewNotes.dialogue_fingerprint_summary,
    dialogue_voice_lock_summary: analysis.voiceLockSummary || reviewNotes.dialogue_voice_lock_summary,
    dialogue_filler_risks: dedupeTextList([
      ...reviewNotes.dialogue_filler_risks,
      ...analysis.fillerRisks,
    ]),
    dialogue_info_density_risks: dedupeTextList([
      ...reviewNotes.dialogue_info_density_risks,
      ...analysis.infoDensityRisks,
    ]),
    required_voice_lock_character_ids: [...new Set([
      ...reviewNotes.required_voice_lock_character_ids,
      ...analysis.requiredVoiceLockCharacterIds,
    ])],
    cross_character_similarity: analysis.similarities,
    dialogue_drift_alerts: analysis.drifts,
    language_risks: dedupeTextList([
      ...reviewNotes.language_risks,
      ...analysis.risks.filter((item) => item.includes('对白') || item.includes('语音画像')),
      ...analysis.fillerRisks,
      ...analysis.infoDensityRisks,
    ]),
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      analysis.similarities.length > 0 ? '拉开同场角色的句长、停顿和语气差异，避免多人同腔。' : '',
      analysis.drifts.length > 0 ? '把漂移角色拉回既有称呼、停顿和重复短语习惯。' : '',
      analysis.fillerRisks.length > 0 ? '删掉对白里的空转接话，让角色回应带立场、动作或筹码。' : '',
      analysis.infoDensityRisks.length > 0 ? '让关键对白明确交代地点、目标、证据、筹码或下一步动作。' : '',
    ]),
  }
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

function normalizeStyleComplianceMetrics(raw: unknown): StyleComplianceMetricSnapshot {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  return {
    avgSentenceLength: normalizeBoundedNumber(record.avgSentenceLength, 0, 9999, 0),
    avgParagraphLength: normalizeBoundedNumber(record.avgParagraphLength, 0, 9999, 0),
    dialogueLineRate: normalizeBoundedNumber(record.dialogueLineRate, 0, 100, 0),
    abstractTokenDensity: normalizeBoundedNumber(record.abstractTokenDensity, 0, 100, 0),
  }
}

function normalizeStyleComplianceStatus(raw: unknown): StyleComplianceResult['status'] {
  if (raw === 'rewrite') return 'rewrite'
  if (raw === 'warning') return 'warning'
  return 'pass'
}

function normalizeStyleComplianceResult(raw: unknown): StyleComplianceResult | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const deviations = toStringArray(record.deviations)
  const rewriteHints = toStringArray(record.rewriteHints)
  const matchedForbiddenPatterns = toStringArray(record.matchedForbiddenPatterns)
  const score = normalizeBoundedNumber(record.score, 0, 100, 0)
  const summary = asText(record.summary)
  if (!summary && deviations.length === 0 && rewriteHints.length === 0 && matchedForbiddenPatterns.length === 0 && score <= 0) {
    return undefined
  }
  return {
    status: normalizeStyleComplianceStatus(record.status),
    score,
    summary,
    deviations,
    rewriteHints,
    matchedForbiddenPatterns,
    forbiddenPatternHitCount: normalizeBoundedNumber(
      record.forbiddenPatternHitCount,
      0,
      999,
      matchedForbiddenPatterns.length,
    ),
    referenceMetrics: normalizeStyleComplianceMetrics(record.referenceMetrics),
    actualMetrics: normalizeStyleComplianceMetrics(record.actualMetrics),
  }
}

function replacePrefixedNotes(existing: string[], prefix: string, additions: string[]): string[] {
  const normalizedAdditions = additions
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `${prefix}${item}`)
  return dedupeTextList([
    ...existing.filter((item) => !item.startsWith(prefix)),
    ...normalizedAdditions,
  ])
}

function applyStyleComplianceToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  novelId: number,
  content: string,
): ChapterReviewNotes {
  const compliance = analyzeNovelStyleCompliance(novelId, content)
  if (!compliance) {
    return {
      ...reviewNotes,
      style_compliance: undefined,
    }
  }

  const prefixedDeviations = compliance.status === 'pass' ? [] : compliance.deviations
  const prefixedHints = compliance.status === 'pass' ? [] : compliance.rewriteHints

  return {
    ...reviewNotes,
    style_compliance: compliance,
    language_risks: replacePrefixedNotes(reviewNotes.language_risks, STYLE_COMPLIANCE_RISK_PREFIX, prefixedDeviations),
    human_language_repairs: replacePrefixedNotes(reviewNotes.human_language_repairs, STYLE_COMPLIANCE_FIX_PREFIX, prefixedHints),
    critical_fixes: replacePrefixedNotes(
      reviewNotes.critical_fixes,
      STYLE_COMPLIANCE_FIX_PREFIX,
      compliance.status === 'rewrite' ? compliance.rewriteHints : [],
    ),
    summary: reviewNotes.summary || (compliance.status !== 'pass' ? compliance.summary : ''),
    severity: compliance.status === 'rewrite'
      ? mergeSeverity(reviewNotes.severity, 'high')
      : compliance.status === 'warning'
        ? mergeSeverity(reviewNotes.severity, 'medium')
        : reviewNotes.severity,
    rewrite_required: reviewNotes.rewrite_required || compliance.status === 'rewrite',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, compliance.rewriteHints),
  }
}

function buildStructuralAlertsSummary(
  novelId: number,
  chapterNum: number,
  volumeId?: number | null,
): string {
  try {
    const dashboard = getQualityDashboardData(novelId, { includeDialogueInsights: false })
    const relevantAlerts = dashboard.storyPacingAlerts
      .filter((alert) => alert.chapterNums.length === 0
        || alert.chapterNums.includes(chapterNum)
        || alert.chapterNums.some((num) => num >= chapterNum - 3 && num <= chapterNum))
      .slice(0, 3)
    const fallbackAlerts = relevantAlerts.length > 0
      ? relevantAlerts
      : dashboard.storyPacingAlerts.slice(0, 3)
    const currentVolume = typeof volumeId === 'number'
      ? dashboard.volumeStoryDynamics.find((entry) => entry.volumeId === volumeId) || null
      : null

    const lines = [
      ...fallbackAlerts.map((alert) => `- ${alert.title}：${alert.detail}`),
      dashboard.protagonistSetbackSummary.chapterCount > 0
        ? `- 全书主角受挫率 ${dashboard.protagonistSetbackSummary.protagonistSetbackRate}% ，重大受挫 ${dashboard.protagonistSetbackSummary.majorSetbackRate}% ，最长顺推跨度 ${dashboard.protagonistSetbackSummary.longestSmoothRun} 章。`
        : '',
      dashboard.costPersistenceSummary.evaporatedCostCount > 0
        ? `- 全书已检测到 ${dashboard.costPersistenceSummary.evaporatedCostCount} 次代价蒸发，重写时不要自动抹平重大损失。`
        : '',
      dashboard.reversalDistributionSummary.forcedReversalCount > 0
        ? `- 已检测到 ${dashboard.reversalDistributionSummary.forcedReversalCount} 次强行反转，新增反转前先补齐铺垫与触发链。`
        : '',
      currentVolume
        ? `- 当前卷 ${currentVolume.volumeName}：受挫率 ${currentVolume.protagonistSetbackRate}% ，高潮章节 ${currentVolume.climaxChapterNums.length > 0 ? currentVolume.climaxChapterNums.join('、') : '暂无'} ，代价蒸发 ${currentVolume.evaporatedCostCount} 次。`
        : '',
    ].filter(Boolean)

    return lines.join('\n')
  } catch {
    return ''
  }
}

function enhanceReviewNotesWithGuardrails(
  reviewNotes: ChapterReviewNotes,
  content: string,
  genre?: string,
  existingFindings?: ReturnType<typeof collectQualityGuardrailFindings>,
): ChapterReviewNotes {
  const findings = existingFindings ?? collectQualityGuardrailFindings(content, genre)
  if (findings.length === 0) return reviewNotes

  const realismFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'object_category_mismatch' || finding.code === 'zero_cost_resolution'),
  )
  const languageFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'ai_slogan' || finding.code === 'template_emotion'),
  )
  const genreHollowFindings = formatQualityGuardrailSummary(
    findings.filter((finding) => finding.code === 'genre_hollowing'),
  )

  const next: ChapterReviewNotes = {
    ...reviewNotes,
    critical_fixes: dedupeTextList([...buildGuardrailCriticalFixes(findings), ...reviewNotes.critical_fixes]),
    continuity_risks: dedupeTextList(reviewNotes.continuity_risks),
    arc_progress_risks: dedupeTextList(reviewNotes.arc_progress_risks),
    context_drift_risks: dedupeTextList(reviewNotes.context_drift_risks),
    realism_risks: dedupeTextList([...reviewNotes.realism_risks, ...realismFindings]),
    coherence_risks: dedupeTextList(reviewNotes.coherence_risks),
    reader_hook_risks: dedupeTextList([
      ...reviewNotes.reader_hook_risks,
      ...(findings.some((finding) => finding.code === 'zero_cost_resolution')
        ? ['本章关键冲突的结果代价不足，读者会感觉主角几乎无成本顺推。']
        : []),
    ]),
    language_risks: dedupeTextList([...reviewNotes.language_risks, ...languageFindings]),
    human_language_repairs: dedupeTextList(reviewNotes.human_language_repairs),
    genre_hollowing_risks: dedupeTextList([...reviewNotes.genre_hollowing_risks, ...genreHollowFindings]),
    missing_payoffs: dedupeTextList(reviewNotes.missing_payoffs),
    strengths: dedupeTextList(reviewNotes.strengths),
    severity: findings.reduce(
      (current, finding) => mergeSeverity(current, findingSeverityToReviewSeverity(finding.severity)),
      reviewNotes.severity,
    ),
    rewrite_required: reviewNotes.rewrite_required || shouldForceRepair(findings),
    summary: reviewNotes.summary || '当前稿件仍有需要落地修正的体裁、常识或语言问题。',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      realismFindings.length > 0 ? '把伤害、资源、秩序、移动成本和世界规则的代价写实写满。' : '',
      languageFindings.length > 0 ? '删掉口号句、模板情绪和对象类别错配，改回自然中文。' : '',
      genreHollowFindings.length > 0 ? '把题材生态写回具体场景，补齐生存链、修行秩序或江湖规矩。' : '',
    ]),
    cost_present: reviewNotes.cost_present || findings.some((finding) => finding.code === 'zero_cost_resolution'),
    cost_summary: reviewNotes.cost_summary || (findings.some((finding) => finding.code === 'zero_cost_resolution')
      ? '当前重大问题被写成了近乎无代价解决，需要补齐损失、伤势、资源消耗或秩序后果。'
      : ''),
    cost_resolution_state: findings.some((finding) => finding.code === 'zero_cost_resolution')
      ? 'evaporated'
      : reviewNotes.cost_resolution_state,
  }

  return next
}

function parseStoredReviewNotes(raw?: string | null): ChapterReviewNotes {
  if (!raw?.trim()) return normalizeReviewNotes({})

  try {
    return normalizeReviewNotes(JSON.parse(raw) as unknown)
  } catch {
    return normalizeReviewNotes({})
  }
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
}

async function repairChapterOutputIfNeeded(input: ChapterRepairInput): Promise<{
  content: string
  reviewNotes: ChapterReviewNotes
}> {
  const originalContent = input.content.trim()
  const findings = collectQualityGuardrailFindings(originalContent, input.profile.genre)
  if (findings.length === 0 || !shouldForceRepair(findings)) {
    return {
      content: originalContent,
      reviewNotes: input.reviewNotes,
    }
  }

  const repairNotes = applyHumanizationAnalysisToReviewNotes(
    enhanceReviewNotesWithGuardrails(input.reviewNotes, originalContent, input.profile.genre, findings),
    originalContent,
    input.profile.genre,
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
          targetWords: input.chapter.targetWords || 3000,
          storyCore: input.storyCore,
          writingContractSummary: input.context.writingContractSummary,
          relationSummary: input.context.relationSummary,
          currentArc: input.context.currentArc,
          worldRules: input.context.worldRules,
          characterStates: input.context.characterStates,
          worldStates: input.context.worldStates,
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

    const finalFindings = collectQualityGuardrailFindings(protectedRepaired.content, input.profile.genre)
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
        input.profile.genre,
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
              targetWords: input.chapter.targetWords || 3000,
              storyCore: input.storyCore,
              writingContractSummary: input.context.writingContractSummary,
              relationSummary: input.context.relationSummary,
              currentArc: input.context.currentArc,
              worldRules: input.context.worldRules,
              characterStates: input.context.characterStates,
              worldStates: input.context.worldStates,
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
          return { content: protectedSecond.content, reviewNotes: protectedSecond.reviewNotes }
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
          input.profile.genre,
        )
        : applyHumanizationAnalysisToReviewNotes(protectedRepaired.reviewNotes, protectedRepaired.content, input.profile.genre),
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
  const summaryHealth = refreshSummaryHealth(chapterId)
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
      blockedGeneration: false,
      readyForNextChapter: true,
      contextVersion: novel?.contextVersion || 1,
      updatedAt: new Date().toISOString(),
    }),
  }).run()
  ensureStoryStructure(novelId)
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

function buildStageContextMap(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  chapter: typeof chapters.$inferSelect,
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
  const novelTargetWords = rawContext.novel.targetWords || 0
  const buildStageContext = (promptProfile: ChapterContextStage) => {
    try {
      return allocateChapterContext(rawContext, {
        promptProfile,
        chapterComplexity: complexity,
        totalBudget: resolveContextBudgetForStage(promptProfile, complexity, chapter.targetWords || 3000, novelTargetWords),
      })
    } catch (error) {
      if (error instanceof HardConstraintOverflowError) {
        throw error
      }
      if (error instanceof ContextOverflowError) {
        return error.context
      }
      throw error
    }
  }

  return {
    complexity,
    contexts: {
      scenePlan: buildStageContext('scenePlan'),
      draft: buildStageContext('draft'),
      review: buildStageContext('review'),
      rewrite: buildStageContext('rewrite'),
    },
  }
}

function buildPreviewStageContextMap(
  rawContext: Awaited<ReturnType<typeof collectChapterContextRawData>>,
  chapter: typeof chapters.$inferSelect,
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
  const novelTargetWords = rawContext.novel.targetWords || 0
  const buildStageContext = (promptProfile: ChapterContextStage) => {
    try {
      return allocateChapterContext(rawContext, {
        promptProfile,
        chapterComplexity: complexity,
        totalBudget: resolveContextBudgetForStage(promptProfile, complexity, chapter.targetWords || 3000, novelTargetWords),
      })
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
      draft: buildStageContext('draft'),
      review: buildStageContext('review'),
      rewrite: buildStageContext('rewrite'),
    },
  }
}

export async function generateChapterContent(
  chapterId: number,
  sender?: WebContents,
  options: { executionMode?: AiExecutionMode } = {},
): Promise<number> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const novel = rawContext.novel
  const profile = rawContext.profile
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const narrativeSceneSnapshots = loadNarrativeControlSceneSnapshots(chapterId)
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

    if (!hasCommittedContent) {
      updateChapter(chapterId, { status: previousStatus }, { versionSource: false })
    } else {
      updateChapter(chapterId, { status: 'draft' }, { skipStaleTracking: true, versionSource: false })
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
    const { complexity, contexts } = buildStageContextMap(rawContext, chapter)
    const scenePlanContext = contexts.scenePlan
    const draftContext = contexts.draft
    const reviewContext = contexts.review
    const rewriteContext = contexts.rewrite
    const linkedImpacts = listActiveImpactsForChapter(chapter.novelId, chapter.id)
    const usageSnapshot = buildWritingContextUsageSnapshot(rawContext, draftContext, linkedImpacts)
    const contextAssemblyReport = buildChapterContextAssemblyReport(draftContext, usageSnapshot)
    const authorStyleLock = buildAuthorStyleLockSummary(chapter.novelId, novel.themeVoiceJson)
    const stageReports = buildChapterAiStageReports(
      executionModeResolution.mode,
      executionModeResolution.source,
      novel.modelConfigId || undefined,
    )
    const plannerChatOpts = buildChatOptionsFromRoute(stageReports[0].route)
    const writerChatOpts = buildChatOptionsFromRoute(stageReports[1].route)
    const criticChatOpts = buildChatOptionsFromRoute(stageReports[2].route)
    const rewriterChatOpts = buildChatOptionsFromRoute(stageReports[3].route)
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
    const rewriteWritingGuidance = buildWritingGuidance(rewriteContext.styleTemplate)
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
    const generationExpressionDedup = analyzeExpressionDedupForGeneration(chapter.novelId, chapter.chapterNum)
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
      content,
      chapterGoal,
      emotionTone: chapter.emotionTone || '平稳',
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
      ].filter(Boolean).join('\n'),
    })
    const plannerNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(scenePlanContext.chapterGoal))
    const draftNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(draftContext.chapterGoal))
    snapshot = {
      ...snapshot,
      recallSnapshot: draftContext.recallSnapshot,
      recallDiagnostics: draftContext.recallDiagnostics,
      contextAssemblyReport,
      authorStyleLock,
      generationExplainability,
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
        targetWords: chapter.targetWords || 3000,
        storyCore,
        writingContractSummary: scenePlanContext.writingContractSummary,
        relationSummary: scenePlanContext.relationSummary,
        currentArc: scenePlanContext.currentArc,
        worldRules: scenePlanContext.worldRules,
        characterStates: scenePlanContext.characterStates,
        worldStates: scenePlanContext.worldStates,
        itemSummary: scenePlanContext.itemSummary,
        previousSummaries: scenePlanContext.previousSummaries,
        previousChapterContext: scenePlanContext.previousChapterContext,
        lastChapterEnding: scenePlanContext.lastChapterEnding,
        chapterBridgePlan: chapterBridgePlanText,
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
    const scenePlan = scenePlanParse.success
      ? normalizeScenePlan(scenePlanParse.data, fallbackScenePlan)
      : fallbackScenePlan

    updateChapter(chapterId, { scenePlanJson: JSON.stringify(scenePlan) })
    const scenePlanText = formatScenePlan(scenePlan)
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
        targetWords: chapter.targetWords || 3000,
        storyCore,
        writingContractSummary: draftContext.writingContractSummary,
        relationSummary: draftContext.relationSummary,
        currentArc: draftContext.currentArc,
        worldRules: draftContext.worldRules,
        characterStates: draftContext.characterStates,
        worldStates: draftContext.worldStates,
        itemSummary: draftContext.itemSummary,
        previousSummaries: draftContext.previousSummaries,
        previousChapterContext: draftContext.previousChapterContext,
        lastChapterEnding: draftContext.lastChapterEnding,
        chapterBridgePlan: chapterBridgePlanText,
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
    const draftContent = await executeChatTask(writerTaskId, {
      type: 'chapter_writer',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(writerMessages),
      messages: writerMessages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: writerChatOpts,
      sender,
    })
    finishRoleTask('writer', writerTaskId, '正文初稿已生成，等待 Critic 审校。')
    const lockedParagraphContext = buildLockedParagraphContext(chapter, draftContent)
    const reviewNarrativeFields = formatNarrativePromptFields(buildNarrativeControlReport(reviewContext.chapterGoal, draftContent))

    let reviewNotes = buildFallbackReviewNotes(consistencyNotes)

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
        itemSummary: reviewContext.itemSummary,
        previousChapterContext: reviewContext.previousChapterContext,
        chapterBridgePlan: chapterBridgePlanText,
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
      const normalizedNotes = normalizeReviewNotes(reviewParse.data)
      reviewNotes = hasReviewNotes(normalizedNotes) ? normalizedNotes : reviewNotes
    }

    reviewNotes = enhanceReviewNotesWithGuardrails(reviewNotes, draftContent, profile.genre)
    reviewNotes = applyHumanizationAnalysisToReviewNotes(reviewNotes, draftContent, profile.genre)
    reviewNotes = applyDialogueAnalysisToReviewNotes(reviewNotes, chapter.novelId, chapter.chapterNum, draftContent)
    reviewNotes = applyStyleComplianceToReviewNotes(reviewNotes, chapter.novelId, draftContent)
    reviewNotes = applyContractValidationToReviewNotes(reviewNotes, validateChapterContractDelivery({
      chapterId,
      content: draftContent,
      reviewNotes,
    }))
    updateChapter(chapterId, { reviewNotesJson: JSON.stringify(reviewNotes) })
    finishRoleTask('critic', criticTaskId, 'Critic 审校完成，已生成本章修订意见。')
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

    const prompt = buildChapterRewritePrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      chapterNum: chapter.chapterNum,
      chapterTitle: chapter.title || getDefaultChapterTitle(chapter.chapterNum),
      chapterGoal: rewriteContext.chapterGoal,
      hardConstraintContext: rewriteContext.hardConstraintContext,
      dialogueVoiceLocks: rewriteContext.dialogueVoiceLocks,
      emotionTone: chapter.emotionTone || '平稳',
      targetWords: chapter.targetWords || 3000,
      storyCore,
      writingContractSummary: rewriteContext.writingContractSummary,
      relationSummary: rewriteContext.relationSummary,
      currentArc: rewriteContext.currentArc,
      worldRules: rewriteContext.worldRules,
      characterStates: rewriteContext.characterStates,
        worldStates: rewriteContext.worldStates,
        itemSummary: rewriteContext.itemSummary,
        previousSummaries: rewriteContext.previousSummaries,
        previousChapterContext: rewriteContext.previousChapterContext,
        lastChapterEnding: rewriteContext.lastChapterEnding,
        chapterBridgePlan: chapterBridgePlanText,
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
      draftContent: lockedParagraphContext.promptDraftContent,
      reviewNotes: formatReviewNotes(reviewNotes),
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
    })

    const messages = [{ role: 'user' as const, content: prompt }]
    const rewriterTaskId = await startRoleTask('rewriter', 'chapter_rewriter', 'Rewriter 正在按 Critic 结论修正文稿。', {
      inputJson: JSON.stringify(messages),
      runnerType: 'stream',
    })
    try {
      assertContractDrivenWriterInputs('rewriter', contractVersion, rewriteContext.writingContractSummary, scenePlanText)
    } catch (error) {
      updateTaskStatus(rewriterTaskId, 'failed', sender, {
        pipelineStage: 'blocked',
        errorMessage: error instanceof Error ? error.message : 'Rewriter 缺少合同输入',
        recoveryHintJson: serializeTaskRecoveryHint(buildChapterPipelineRecoveryHint(chapter.novelId, chapterId, 'rewriter')),
      })
      failRoleTask('rewriter', rewriterTaskId, error, { blocked: true })
    }
    const rewriteResult = await executeStreamTask(rewriterTaskId, {
      type: 'chapter_rewriter',
      novelId: chapter.novelId,
      relatedEntityType: 'chapter',
      relatedEntityId: chapterId,
      inputJson: JSON.stringify(messages),
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      chatOpts: rewriterChatOpts,
      sender,
    })

    const protectedOutput = enforceLockedParagraphProtection(
      rewriteResult.output,
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
    })
    const repairedHumanizedReviewNotes = applyHumanizationAnalysisToReviewNotes(
      repaired.reviewNotes,
      repaired.content,
      profile.genre,
    )
    const repairedReviewNotes = applyDialogueAnalysisToReviewNotes(
      repairedHumanizedReviewNotes,
      chapter.novelId,
      chapter.chapterNum,
      repaired.content,
    )
    const repairedStyleReviewNotes = applyStyleComplianceToReviewNotes(
      repairedReviewNotes,
      chapter.novelId,
      repaired.content,
    )
    const finalReviewNotes = applyContractValidationToReviewNotes(repairedStyleReviewNotes, validateChapterContractDelivery({
      chapterId,
      content: repaired.content,
      reviewNotes: repairedStyleReviewNotes,
    }))
    persistAntiAiRuleHits({
      novelId: chapter.novelId,
      chapterId,
      chapterNum: chapter.chapterNum,
      content: repaired.content,
      genre: profile.genre,
    })
    const remainingGuardrailFindings = collectQualityGuardrailFindings(repaired.content, profile.genre)
    if (remainingGuardrailFindings.length > 0 && shouldForceRepair(remainingGuardrailFindings)) {
      failRoleTask('rewriter', rewriterTaskId, new ChapterPipelineStageError(
        'anti_ai_failed',
        'Rewriter 二次修复后仍存在高风险 AI 味或模板化表达，需人工介入复核。',
        {
          rewriteScope: 'chapter_rewrite',
          outputText: buildPipelineFailureOutput(
            'anti_ai_failed',
            'Rewriter 二次修复后仍存在高风险 AI 味或模板化表达，需人工介入复核。',
            { rewriteScope: 'chapter_rewrite' },
          ),
        },
      ))
    }

    updateChapter(chapterId, {
      content: repaired.content,
      reviewNotesJson: JSON.stringify(finalReviewNotes),
      status: 'draft',
    }, {
      skipStaleTracking: true,
      versionSource: false,
    })
    hasCommittedContent = true
    const publishCheck = runChapterPublishCheck(chapterId)
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
    const publishCheckFailureMeta = getPublishCheckRewriteFailureMeta(publishCheck)
    syncFeedbackRecurrenceState(chapter.novelId)
    syncDialogueDriftRevisionTasks(chapter.novelId)
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
    const result = await finalizeGeneratedChapterContent(chapterId, repaired.content)
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)

    const chapterRecord = getChapter(chapterId)
    if (chapterRecord) {
      generateChapterEmbeddings(chapterRecord.novelId, chapterId, novel?.modelConfigId || undefined)
        .catch((err) => console.warn('[embedding] 向量生成失败（不影响主流程）:', err))
    }

    const finalizeDetail = '章节已入稿，并刷新摘要、连续性与长期记忆。'
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
      outputText: `第${chapter.chapterNum}章流水线完成。${result.summary ? ` 摘要：${result.summary}` : ''}`,
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
  if (['pending', 'running', 'cancel_requested'].includes(rootTask.status || '')) {
    throwUserFacingError('workflow.taskRunningCannotResume', { taskId: rootTask.id })
  }

  return generateChapterContent(rootTask.relatedEntityId, sender)
}

export async function getChapterContextPreview(
  chapterId: number,
  options: { executionMode?: AiExecutionMode } = {},
): Promise<import('../../src/types').ChapterContextPreview> {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) throwUserFacingError('chapter.notFoundWithId', { id: chapterId })

  const rawContext = await collectChapterContextRawData(chapter.novelId, chapter.chapterNum)
  const { complexity, contexts } = buildPreviewStageContextMap(rawContext, chapter)
  const orderedStages: ChapterContextStage[] = ['scenePlan', 'draft', 'review', 'rewrite']
  const linkedImpacts = listActiveImpactsForChapter(chapter.novelId, chapter.id)
  const usageSnapshot = buildWritingContextUsageSnapshot(rawContext, contexts.draft, linkedImpacts)
  const executionModeResolution = resolveAiExecutionMode({
    explicitMode: options.executionMode,
    settingsJson: rawContext.novel.settingsJson,
  })
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
  })

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
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
    previousChapterSampleReport: rawContext.previousChapterSampleReport,
    recalledMemory: contexts.draft.recalledMemory,
    recallSnapshot: contexts.draft.recallSnapshot,
    recallDiagnostics: contexts.draft.recallDiagnostics,
    recalledMemorySources: contexts.draft.recalledMemorySources,
    usageSnapshot,
    stages: orderedStages.map((stage) => {
      const context = contexts[stage]
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
      }
    }),
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
    db.update(chapters).set({
      aiScoreJson: JSON.stringify(enhancedScore),
      updatedAt: new Date().toISOString(),
    }).where(eq(chapters.id, chapterId)).run()
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return enhancedScore
  } catch {
    scheduleDialogueFingerprintRefresh(chapter.novelId, novel?.modelConfigId || undefined)
    return enhanceAiScoreResult({}, content)
  }
}

export { runChapterPublishCheck }
