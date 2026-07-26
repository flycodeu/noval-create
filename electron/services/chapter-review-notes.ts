import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  sceneContracts,
  storyItems,
  storyMemoryCheckpoints,
  storyParts,
  storyThreads,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { assessHistoricalGrounding } from '../../src/shared/genre-system'
import { countUnresolvedTypedRefs, hasTypedRefOverlay } from '../../src/shared/typed-ref'
import { getOperatingModeRuntimePolicy } from '../../src/shared/operating-mode'
import {
  collectQualityGuardrailFindings,
  formatQualityGuardrailSummary,
  shouldForceRepair,
} from '../../src/shared/content-guardrails'
import {
  isContractValidationBlockerVerdict,
  isHardContractValidationItem,
} from '../../src/shared/contract-validation'
import {
  SEMANTIC_GATE_DIMENSION_SPECS,
  normalizeForEvidence,
  normalizeSemanticGateReview,
  type SemanticGateDimension,
  type SemanticGateStatus,
  type SemanticGateVerdict,
} from '../../src/shared/semantic-gate'
import { CORE_SEMANTIC_GATE_DIMENSIONS } from '../../src/shared/semantic-gate-policy'
import { normalizeChapterContractValidationResult } from './chapter-contract-validator.service'
import { getQualityDashboardData } from './quality-dashboard.service'
import { analyzeChapterDialogueAgainstNovel } from './dialogue-fingerprint.service'
import { analyzeNovelStyleCompliance } from './style-compliance.service'
import type { NarrativeControlSceneSnapshot } from './narrative-control.service'
import { analyzeWorkspaceAiFlavor } from './workspace-quality.service'
import {
  analyzeChapterReadingExperience,
  type ChapterReadingExperienceScore,
  type RewriteDeltaChainScore,
  type RewriteNarrativeDeltaReport,
} from './chapter-pipeline-policy.service'
import type {
  ChapterContractValidationResult,
  HumanizationSignal,
  StyleComplianceMetricSnapshot,
  StyleComplianceResult,
} from '../../src/types'

export type ReviewSeverity = 'low' | 'medium' | 'high'

export type ProtagonistSetbackLevel = 'none' | 'minor' | 'major'

export type CostResolutionState = 'new' | 'ongoing' | 'resolved' | 'evaporated'

export type ReversalSupportState = 'supported' | 'weak' | 'forced'

export type ChapterPacingMarker = 'setup' | 'conflict' | 'reversal' | 'climax' | 'payoff' | 'breather'

export type RewardState = 'none' | 'partial' | 'major'

export type ChapterFunctionTag = 'setup' | 'progression' | 'reversal' | 'payoff' | 'breather' | 'climax' | 'exposition' | 'closure'

export interface ChapterReviewNotes {
  summary: string
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks: string[]
  context_drift_risks: string[]
  realism_risks: string[]
  coherence_risks: string[]
  reader_hook_risks: string[]
  step_memory_risks: string[]
  opening_hook_risks: string[]
  title_alignment_risks: string[]
  hallucination_risks: string[]
  language_risks: string[]
  human_language_repairs: string[]
  genre_hollowing_risks: string[]
  // P3 设计感专项（warning 级，仅提示不阻塞）：本章是否只是把事件/史实写顺，缺戏剧设计。
  design_flatness_risks?: string[]
  typed_ref_risks: string[]
  source_grounding_risks: string[]
  operating_mode_risks: string[]
  long_window_humanization_risks: string[]
  genre_register_risks: string[]
  dialogue_separability_risks: string[]
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
  reading_experience?: ChapterReadingExperienceScore
  rewrite_delta?: RewriteNarrativeDeltaReport
  contract_validation?: ChapterContractValidationResult
  /** 重写稿轻量复检结果：LLM 审校证据已在最终稿上核对过（发布门据此不再降级初稿证据类项） */
  rewrite_recheck?: {
    performed: boolean
    checkedAt: string
    resolved: string[]
  }
  /** Critic 输出的语义门格式判定（经 normalizeSemanticGateReview 证据回指校验后挂载） */
  semantic_verdicts?: SemanticGateVerdict[]
  /** 语义判定归一过程中产生的纪律性警告（证据缺失降级、维度缺失等） */
  semantic_review_warnings?: string[]
  /** shadow 模式下语义门与关键词门的分歧记录（仅观察，不阻断） */
  semantic_divergence_notes?: string[]
}

export const STYLE_COMPLIANCE_RISK_PREFIX = '风格硬约束：'

export const STYLE_COMPLIANCE_FIX_PREFIX = '风格修正：'

export const HUMANIZATION_SIGNAL_TYPES = new Set<HumanizationSignal['issueType']>([
  'ai_slogan',
  'template_emotion',
  'template_connector',
  'explanatory_narration',
  'ornament_overload',
  'sensory_anchor_missing',
  'weak_stance',
  'transition_density',
  'emotion_monotony',
  'world_exposition_dump',
])

export const HUMANIZATION_REVIEW_SIGNAL_TYPES = new Set<HumanizationSignal['issueType']>([
  'template_connector',
  'explanatory_narration',
  'ornament_overload',
  'sensory_anchor_missing',
  'weak_stance',
  'transition_density',
  'emotion_monotony',
  'world_exposition_dump',
])

export function loadNarrativeControlSceneSnapshots(chapterId: number): NarrativeControlSceneSnapshot[] {
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
        emotionShift: scene?.emotionShift || '',
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((scene) => ({
        segmentId: scene.segmentId ?? undefined,
        segmentTitle: `场景合同 ${scene.id}`,
        pov: scene.pov || '',
        emotionShift: scene.emotionShift || '',
      })),
  ]
}

export function loadNarrativeContractSignals(chapterId: number): {
  emotionFocus: string
  expositionMode: string
} {
  const db = getDb()
  const contract = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  return {
    emotionFocus: asText(contract?.emotionFocus),
    expositionMode: asText(contract?.expositionMode),
  }
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
    .filter((item) => Number.isFinite(item) && item > 0))]
}

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function dedupeTextList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function normalizeReviewSeverity(value: unknown): ReviewSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

export function normalizeBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes'
  }
  return false
}

export function normalizeBoundedNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function normalizeBoundedMetric(value: unknown, min: number, max: number, fallback = min): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(min, Math.min(max, Math.round(numeric * 10) / 10))
}

export function normalizeProtagonistSetback(value: unknown): ProtagonistSetbackLevel {
  return value === 'major' || value === 'minor' || value === 'none' ? value : 'none'
}

export function normalizeCostResolutionState(value: unknown): CostResolutionState | undefined {
  return value === 'new' || value === 'ongoing' || value === 'resolved' || value === 'evaporated'
    ? value
    : undefined
}

export function normalizeReversalSupportState(value: unknown): ReversalSupportState | undefined {
  return value === 'supported' || value === 'weak' || value === 'forced' ? value : undefined
}

export function normalizePaceMarker(value: unknown): ChapterPacingMarker | undefined {
  return value === 'setup'
    || value === 'conflict'
    || value === 'reversal'
    || value === 'climax'
    || value === 'payoff'
    || value === 'breather'
    ? value
    : undefined
}

export function normalizeRewardState(value: unknown): RewardState {
  return value === 'partial' || value === 'major' || value === 'none' ? value : 'none'
}

export function normalizeChapterFunctionTag(value: unknown): ChapterFunctionTag | undefined {
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

export function normalizeChapterFunctionTags(value: unknown): ChapterFunctionTag[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => normalizeChapterFunctionTag(item)).filter(Boolean))] as ChapterFunctionTag[]
}

export function mergeSeverity(current: ReviewSeverity, incoming: ReviewSeverity): ReviewSeverity {
  const rank: Record<ReviewSeverity, number> = { low: 1, medium: 2, high: 3 }
  return rank[incoming] > rank[current] ? incoming : current
}

export const UNVERIFIED_EVIDENCE_PREFIX = '[证据未核实] '

const RISK_EVIDENCE_MARKER = '【证据】'

const MIN_RISK_EVIDENCE_NEEDLE_LENGTH = 6

/**
 * 对带『【证据】』段的风险条目做逐字回指核验：证据能在正文中找到则原样保留，
 * 回指失败的条目不删除，但打上『[证据未核实] 』前缀，供下游降权处理。
 */
export function annotateRiskEvidence(items: string[], normalizedCorpus: string): string[] {
  return items.map((item) => {
    const markerIndex = item.indexOf(RISK_EVIDENCE_MARKER)
    if (markerIndex < 0 || item.startsWith(UNVERIFIED_EVIDENCE_PREFIX)) return item
    const excerpt = item.slice(markerIndex + RISK_EVIDENCE_MARKER.length).trim()
    const needle = normalizeForEvidence(excerpt)
    if (needle.length >= MIN_RISK_EVIDENCE_NEEDLE_LENGTH && normalizedCorpus.includes(needle)) {
      return item
    }
    return `${UNVERIFIED_EVIDENCE_PREFIX}${item}`
  })
}

function parseSemanticStatus(value: unknown): SemanticGateStatus | null {
  return value === 'pass' || value === 'warning' || value === 'blocker' || value === 'uncertain'
    ? value
    : null
}

/** 已归一过的 semantic_verdicts 在 JSON round-trip 后的轻量校验（不重新做证据回指）。 */
function normalizeStoredSemanticVerdicts(value: unknown): SemanticGateVerdict[] {
  if (!Array.isArray(value)) return []
  const results: SemanticGateVerdict[] = []
  const seen = new Set<SemanticGateDimension>()
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return
    const record = entry as Record<string, unknown>
    const dimension = typeof record.dimension === 'string' ? record.dimension as SemanticGateDimension : null
    if (!dimension || !(dimension in SEMANTIC_GATE_DIMENSION_SPECS) || seen.has(dimension)) return
    const status = parseSemanticStatus(record.status)
    if (!status) return
    seen.add(dimension)
    const downgradedFrom = parseSemanticStatus(record.downgradedFrom)
    results.push({
      dimension,
      status,
      confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence)
        ? Math.max(0, Math.min(1, record.confidence))
        : 0,
      summary: asText(record.summary),
      suggestion: asText(record.suggestion),
      evidence: Array.isArray(record.evidence)
        ? record.evidence
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map((item) => ({ excerpt: asText(item.excerpt), explanation: asText(item.explanation) }))
          .filter((item) => item.excerpt)
        : [],
      rejectedEvidenceCount: typeof record.rejectedEvidenceCount === 'number' && Number.isFinite(record.rejectedEvidenceCount)
        ? Math.max(0, Math.round(record.rejectedEvidenceCount))
        : 0,
      ...(downgradedFrom ? { downgradedFrom } : {}),
    })
  })
  return results
}

export interface NormalizeReviewNotesOptions {
  /** 提供正文时：对 payload.verdicts 做语义门证据归一，并对风险条目的【证据】段做逐字回指核验。 */
  chapterContent?: string
}

const EVIDENCE_ANNOTATED_RISK_KEYS = [
  'critical_fixes',
  'continuity_risks',
  'arc_progress_risks',
  'context_drift_risks',
  'realism_risks',
  'coherence_risks',
  'reader_hook_risks',
  'step_memory_risks',
  'opening_hook_risks',
  'title_alignment_risks',
  'hallucination_risks',
  'language_risks',
  'genre_hollowing_risks',
  'design_flatness_risks',
  'typed_ref_risks',
  'source_grounding_risks',
  'operating_mode_risks',
  'long_window_humanization_risks',
  'genre_register_risks',
  'dialogue_separability_risks',
  'dialogue_homogenization_risks',
  'dialogue_filler_risks',
  'dialogue_info_density_risks',
  'missing_payoffs',
] as const satisfies ReadonlyArray<keyof ChapterReviewNotes>

export function normalizeReviewNotes(raw: unknown, options: NormalizeReviewNotesOptions = {}): ChapterReviewNotes {
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
  const rewriteRecheckRecord = record.rewrite_recheck && typeof record.rewrite_recheck === 'object' && !Array.isArray(record.rewrite_recheck)
    ? record.rewrite_recheck as Record<string, unknown>
    : null
  const rewriteRecheck = rewriteRecheckRecord?.performed === true
    ? {
        performed: true,
        checkedAt: asText(rewriteRecheckRecord.checkedAt) || new Date(0).toISOString(),
        resolved: toStringArray(rewriteRecheckRecord.resolved),
      }
    : undefined

  const notes: ChapterReviewNotes = {
    summary: asText(record.summary),
    critical_fixes: toStringArray(record.critical_fixes),
    continuity_risks: toStringArray(record.continuity_risks),
    arc_progress_risks: toStringArray(record.arc_progress_risks),
    context_drift_risks: toStringArray(record.context_drift_risks),
    realism_risks: toStringArray(record.realism_risks),
    coherence_risks: toStringArray(record.coherence_risks),
    reader_hook_risks: toStringArray(record.reader_hook_risks),
    step_memory_risks: toStringArray(record.step_memory_risks),
    opening_hook_risks: toStringArray(record.opening_hook_risks),
    title_alignment_risks: toStringArray(record.title_alignment_risks),
    hallucination_risks: toStringArray(record.hallucination_risks),
    language_risks: toStringArray(record.language_risks),
    human_language_repairs: toStringArray(record.human_language_repairs),
    genre_hollowing_risks: toStringArray(record.genre_hollowing_risks),
    design_flatness_risks: toStringArray(record.design_flatness_risks),
    typed_ref_risks: toStringArray(record.typed_ref_risks),
    source_grounding_risks: toStringArray(record.source_grounding_risks),
    operating_mode_risks: toStringArray(record.operating_mode_risks),
    long_window_humanization_risks: toStringArray(record.long_window_humanization_risks),
    genre_register_risks: toStringArray(record.genre_register_risks),
    dialogue_separability_risks: toStringArray(record.dialogue_separability_risks),
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
    reading_experience: normalizeReadingExperience(record.reading_experience),
    rewrite_delta: normalizeRewriteDelta(record.rewrite_delta),
    rewrite_recheck: rewriteRecheck,
    contract_validation: normalizeChapterContractValidationResult(record.contract_validation) || undefined,
  }

  // JSON round-trip 保留：已归一的语义判定与警告字段不因重新 normalize 丢失。
  const storedSemanticVerdicts = normalizeStoredSemanticVerdicts(record.semantic_verdicts)
  if (storedSemanticVerdicts.length > 0) notes.semantic_verdicts = storedSemanticVerdicts
  const storedSemanticWarnings = toStringArray(record.semantic_review_warnings)
  if (storedSemanticWarnings.length > 0) notes.semantic_review_warnings = dedupeTextList(storedSemanticWarnings)
  const storedDivergenceNotes = toStringArray(record.semantic_divergence_notes)
  if (storedDivergenceNotes.length > 0) notes.semantic_divergence_notes = dedupeTextList(storedDivergenceNotes)

  const chapterContent = options.chapterContent || ''
  if (chapterContent.trim()) {
    const normalizedCorpus = normalizeForEvidence(chapterContent)
    EVIDENCE_ANNOTATED_RISK_KEYS.forEach((key) => {
      const list = notes[key]
      if (Array.isArray(list) && list.length > 0) {
        ;(notes as unknown as Record<string, unknown>)[key] = annotateRiskEvidence(list, normalizedCorpus)
      }
    })
    if (Array.isArray(record.verdicts) && record.verdicts.length > 0) {
      const semanticReview = normalizeSemanticGateReview({
        chapterContent,
        dimensions: CORE_SEMANTIC_GATE_DIMENSIONS,
        parsedPayload: { verdicts: record.verdicts },
      })
      if (!semanticReview.failed) {
        notes.semantic_verdicts = semanticReview.verdicts
        if (semanticReview.warnings.length > 0) {
          notes.semantic_review_warnings = dedupeTextList([
            ...(notes.semantic_review_warnings || []),
            ...semanticReview.warnings,
          ])
        }
      }
    }
  }

  return notes
}

export function hasReviewNotes(notes: ChapterReviewNotes): boolean {
  return Boolean(
    notes.summary ||
    notes.critical_fixes.length > 0 ||
    notes.continuity_risks.length > 0 ||
    notes.arc_progress_risks.length > 0 ||
    notes.context_drift_risks.length > 0 ||
    notes.realism_risks.length > 0 ||
    notes.coherence_risks.length > 0 ||
    notes.reader_hook_risks.length > 0 ||
    notes.step_memory_risks.length > 0 ||
    notes.opening_hook_risks.length > 0 ||
    notes.title_alignment_risks.length > 0 ||
    notes.hallucination_risks.length > 0 ||
    notes.language_risks.length > 0 ||
    notes.human_language_repairs.length > 0 ||
    notes.genre_hollowing_risks.length > 0 ||
    notes.typed_ref_risks.length > 0 ||
    notes.source_grounding_risks.length > 0 ||
    notes.operating_mode_risks.length > 0 ||
    notes.long_window_humanization_risks.length > 0 ||
    notes.genre_register_risks.length > 0 ||
    notes.dialogue_separability_risks.length > 0 ||
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
    Boolean(notes.reading_experience) ||
    Boolean(notes.rewrite_delta) ||
    Boolean(notes.contract_validation && notes.contract_validation.itemResults.length > 0),
  )
}

export function buildFallbackReviewNotes(consistencyNotes: string): ChapterReviewNotes {
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
    step_memory_risks: [],
    opening_hook_risks: [],
    title_alignment_risks: [],
    hallucination_risks: [],
    language_risks: ['删除抽象口号、概念化抒情和不自然搭配。'],
    human_language_repairs: [],
    genre_hollowing_risks: [],
    typed_ref_risks: [],
    source_grounding_risks: [],
    operating_mode_risks: [],
    long_window_humanization_risks: [],
    genre_register_risks: [],
    dialogue_separability_risks: [],
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
    reading_experience: undefined,
    rewrite_delta: undefined,
    contract_validation: undefined,
  }
}

export function formatReviewNotes(notes: ChapterReviewNotes): string {
  return [
    notes.summary ? `整体判断：${notes.summary}` : '',
    notes.critical_fixes.length > 0 ? `必须修改：\n- ${notes.critical_fixes.join('\n- ')}` : '',
    notes.continuity_risks.length > 0 ? `连续性风险：\n- ${notes.continuity_risks.join('\n- ')}` : '',
    notes.arc_progress_risks.length > 0 ? `故事弧推进风险：\n- ${notes.arc_progress_risks.join('\n- ')}` : '',
    notes.context_drift_risks.length > 0 ? `上下文漂移风险：\n- ${notes.context_drift_risks.join('\n- ')}` : '',
    notes.realism_risks.length > 0 ? `常识/规则风险：\n- ${notes.realism_risks.join('\n- ')}` : '',
    notes.coherence_risks.length > 0 ? `连贯性风险：\n- ${notes.coherence_risks.join('\n- ')}` : '',
    notes.reader_hook_risks.length > 0 ? `追读风险：\n- ${notes.reader_hook_risks.join('\n- ')}` : '',
    notes.step_memory_risks.length > 0 ? `步骤接力风险：\n- ${notes.step_memory_risks.join('\n- ')}` : '',
    notes.opening_hook_risks.length > 0 ? `开篇吸引力风险：\n- ${notes.opening_hook_risks.join('\n- ')}` : '',
    notes.title_alignment_risks.length > 0 ? `标题贴合风险：\n- ${notes.title_alignment_risks.join('\n- ')}` : '',
    notes.hallucination_risks.length > 0 ? `无来源新增/推断升级风险：\n- ${notes.hallucination_risks.join('\n- ')}` : '',
    notes.language_risks.length > 0 ? `语言风险：\n- ${notes.language_risks.join('\n- ')}` : '',
    notes.human_language_repairs.length > 0 ? `语言替换建议：\n- ${notes.human_language_repairs.join('\n- ')}` : '',
    notes.genre_hollowing_risks.length > 0 ? `体裁空心化：\n- ${notes.genre_hollowing_risks.join('\n- ')}` : '',
    notes.design_flatness_risks && notes.design_flatness_risks.length > 0 ? `设计扁平（仅提示，不阻塞）：\n- ${notes.design_flatness_risks.join('\n- ')}` : '',
    notes.typed_ref_risks.length > 0 ? `Typed Ref 缺口：\n- ${notes.typed_ref_risks.join('\n- ')}` : '',
    notes.source_grounding_risks.length > 0 ? `来源/grounding 风险：\n- ${notes.source_grounding_risks.join('\n- ')}` : '',
    notes.operating_mode_risks.length > 0 ? `OperatingMode 违规：\n- ${notes.operating_mode_risks.join('\n- ')}` : '',
    notes.genre_register_risks.length > 0 ? `题材语域漂移：\n- ${notes.genre_register_risks.join('\n- ')}` : '',
    notes.long_window_humanization_risks.length > 0 ? `长窗人类化风险：\n- ${notes.long_window_humanization_risks.join('\n- ')}` : '',
    notes.dialogue_separability_risks.length > 0 ? `对白可分离度风险：\n- ${notes.dialogue_separability_risks.join('\n- ')}` : '',
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
    notes.reading_experience
      ? `章节读感：${notes.reading_experience.status} · ${notes.reading_experience.score} 分${notes.reading_experience.summary ? ` · ${notes.reading_experience.summary}` : ''}`
      : '',
    notes.reading_experience && notes.reading_experience.risks.length > 0
      ? `读感风险：\n- ${notes.reading_experience.risks.join('\n- ')}`
      : '',
    notes.reading_experience && notes.reading_experience.recommendations.length > 0
      ? `读感修正提示：\n- ${notes.reading_experience.recommendations.join('\n- ')}`
      : '',
    notes.rewrite_delta
      ? `重写差异验证：${notes.rewrite_delta.status} · 相似度 ${notes.rewrite_delta.similarityToOriginal} · 改动句 ${notes.rewrite_delta.changedSentenceRate}% · 叙事锚点增量 ${notes.rewrite_delta.narrativeAnchorChangeRate}%`
      : '',
    notes.rewrite_delta
      ? `剧情链修复：冲突链 ${notes.rewrite_delta.conflictChain.status}/${notes.rewrite_delta.conflictChain.score} · 代价链 ${notes.rewrite_delta.costChain.status}/${notes.rewrite_delta.costChain.score} · 目标链 ${notes.rewrite_delta.goalChain.status}/${notes.rewrite_delta.goalChain.score}`
      : '',
    notes.rewrite_delta && notes.rewrite_delta.findings.length > 0
      ? `重写差异风险：\n- ${notes.rewrite_delta.findings.join('\n- ')}`
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

export function applyContractValidationToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  contractValidation: ChapterContractValidationResult,
): ChapterReviewNotes {
  const failedItems = contractValidation.itemResults.filter((item) => item.verdict !== 'pass')
  const hardFailedItems = failedItems.filter(isHardContractValidationItem)
  const hardBlockerItems = hardFailedItems.filter((item) => isContractValidationBlockerVerdict(item.verdict))
  const hardRewriteHints = hardFailedItems
    .map((item) => item.rewriteHint)
    .filter(Boolean)
  const criticalFixes = hardBlockerItems
    .map((item) => item.rewriteHint)
  const titleAlignmentRisks = failedItems
    .filter((item) => item.contractItemType === 'chapter_title_alignment')
    .map((item) => item.rewriteHint || `${item.expected}：标题与本章核心事件或压力点不够贴合。`)
  const openingHookRisks = failedItems
    .filter((item) => item.contractItemType === 'golden_three_opening')
    .map((item) => item.rewriteHint || `${item.expected}：黄金三章章首吸引力不足。`)
  const arcRisks = failedItems
    .filter((item) => (
      item.contractItemType === 'chapter_goal'
      || item.contractItemType === 'story_thread_progress'
      || item.contractItemType === 'theme_chapter_response'
      || item.contractItemType === 'character_scene_payoff'
      || item.contractItemType === 'relationship_arc_gate'
    ))
    .map((item) => `${item.expected}：${item.verdict === 'weak' ? '正文只有提及，没有形成明确推进。' : '正文还没有形成可验证的兑现证据。'}`)
  const hookRisks = failedItems
    .filter((item) => item.contractItemType === 'chapter_hook')
    .map((item) => '章尾钩子偏弱或缺失，收束过平，追读驱动力不足。')
  const missingPayoffs = failedItems
    .filter((item) => item.contractItemType === 'foreshadow_delivery')
    .map((item) => `${item.expected}：${item.verdict === 'weak' ? '目前只有提及，没有埋设/推进/回收或延期说明。' : '正文未处理该伏笔。'}`)
  const coherenceRisks = failedItems
    .filter((item) => item.contractItemType === 'scene_result_state' || item.contractItemType === 'relationship_arc_gate')
    .map((item) => item.contractItemType === 'relationship_arc_gate'
      ? `${item.expected}：关系弧缺少同一场景内的触发、互动和后果链。`
      : `${item.segmentTitle || '场景'} 缺少清晰结果状态，场景结尾没有把变化落地。`)
  const realismRisks = failedItems
    .filter((item) => item.contractItemType === 'scene_conflict')
    .map((item) => `${item.segmentTitle || '场景'} 冲突不够可见，阻力更像说明而不是事件。`)
  const stepMemoryRisks = failedItems
    .filter((item) => item.contractItemType === 'scene_result_state' || item.contractItemType === 'scene_conflict')
    .map((item) => `${item.segmentTitle || '场景'} 没有把场景计划里的冲突、结果或退出压力落到正文，Planner 到 Writer 的接力偏弱。`)

  return {
    ...reviewNotes,
    critical_fixes: dedupeTextList([...criticalFixes, ...reviewNotes.critical_fixes]),
    arc_progress_risks: dedupeTextList([...reviewNotes.arc_progress_risks, ...arcRisks]),
    reader_hook_risks: dedupeTextList([...reviewNotes.reader_hook_risks, ...hookRisks]),
    step_memory_risks: dedupeTextList([...reviewNotes.step_memory_risks, ...stepMemoryRisks]),
    opening_hook_risks: dedupeTextList([
      ...reviewNotes.opening_hook_risks,
      ...openingHookRisks,
      ...(hookRisks.length > 0 ? ['章节钩子兑现偏弱，需同时检查章首承接和章尾递进。'] : []),
    ]),
    title_alignment_risks: dedupeTextList([...reviewNotes.title_alignment_risks, ...titleAlignmentRisks]),
    missing_payoffs: dedupeTextList([...reviewNotes.missing_payoffs, ...missingPayoffs]),
    coherence_risks: dedupeTextList([...reviewNotes.coherence_risks, ...coherenceRisks]),
    realism_risks: dedupeTextList([...reviewNotes.realism_risks, ...realismRisks]),
    summary: reviewNotes.summary || contractValidation.summary,
    severity: hardBlockerItems.length > 0
      ? mergeSeverity(reviewNotes.severity, 'high')
      : contractValidation.status === 'warning'
        ? mergeSeverity(reviewNotes.severity, 'medium')
        : reviewNotes.severity,
    rewrite_required: reviewNotes.rewrite_required || hardBlockerItems.length > 0,
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, hardRewriteHints),
    contract_validation: contractValidation,
  }
}

export function applyHistoricalGroundingToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  input: {
    genreName?: string | null
    worldRulesJson?: string | null
    backgroundText?: string | null
    glossaryTerms?: string[]
    historicalProfileJson?: string | null
    projectCanonProfileJson?: string | null
    canonConstraintSetJson?: string | null
    sourceLedgerJson?: string | null
    canonSourceLedgerJson?: string | null
    canonFactCardsJson?: string | null
  },
): ChapterReviewNotes {
  const assessment = assessHistoricalGrounding(input)
  if (assessment.mode === 'none') return reviewNotes

  if (assessment.coverage === 'grounded') {
    return {
      ...reviewNotes,
      realism_risks: dedupeTextList(reviewNotes.realism_risks),
      genre_hollowing_risks: dedupeTextList(reviewNotes.genre_hollowing_risks),
    }
  }

  const realismRisk = assessment.mode === 'historical_realist'
    ? '历史正剧当前来源覆盖不足：未确认官制、礼制、器物、地理与纪年时，不得编造具体细节，应回退为保守表达。'
    : assessment.mode === 'alternate_history'
      ? '架空历史当前缺少明确分歧点/制度依据：允许偏离真实历史，但不能伪装成具体史实细节。'
      : '类历史奇幻当前历史 grounding 不足：允许超自然元素，但制度、器物、身份秩序与措辞仍需保持历史框架。'
  const fixHint = assessment.mode === 'historical_realist'
    ? '将缺乏来源支撑的具体历史细节改写为低承诺、可验证的保守表述。'
    : assessment.mode === 'alternate_history'
      ? '补充架空分歧点/制度依据，或把具体史实断言改写为项目内设定。'
      : '保留奇幻元素，但把制度、器物和措辞收回到历史框架内。'
  const severity = assessment.mode === 'historical_realist' ? 'high' : assessment.mode === 'alternate_history' ? 'medium' : 'medium'

  return {
    ...reviewNotes,
    realism_risks: dedupeTextList([realismRisk, ...reviewNotes.realism_risks]),
    source_grounding_risks: dedupeTextList([realismRisk, ...reviewNotes.source_grounding_risks]),
    critical_fixes: dedupeTextList([fixHint, ...reviewNotes.critical_fixes]),
    genre_hollowing_risks: dedupeTextList([
      assessment.conservativeFallbackActive ? '当前历史题材已启用保守 fallback，禁止 generic 历史细节脑补。' : '',
      ...reviewNotes.genre_hollowing_risks,
    ]),
    summary: reviewNotes.summary || assessment.summary,
    severity: mergeSeverity(reviewNotes.severity, severity),
    rewrite_required: true,
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [fixHint]),
  }
}

export function buildTypedRefRiskSummary(novelId: number): {
  risks: string[]
  fixes: string[]
  severity?: ReviewSeverity
  rewriteRequired: boolean
} {
  const db = getDb()
  const buckets = [
    {
      label: '故事线程',
      rows: db.select({ typedRefsJson: storyThreads.typedRefsJson }).from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
    },
    {
      label: '时间线事件',
      rows: db.select({ typedRefsJson: timelineEvents.typedRefsJson }).from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
    },
    {
      label: '故事物品',
      rows: db.select({ typedRefsJson: storyItems.typedRefsJson }).from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
    },
  ].map((bucket) => {
    const totalCount = bucket.rows.length
    const typedRefCount = bucket.rows.filter((row) => hasTypedRefOverlay(row.typedRefsJson)).length
    const unresolvedCount = bucket.rows.reduce((sum, row) => sum + countUnresolvedTypedRefs(row.typedRefsJson), 0)
    return {
      ...bucket,
      totalCount,
      typedRefCount,
      unresolvedCount,
    }
  })
  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)
  const typedRefCount = buckets.reduce((sum, bucket) => sum + bucket.typedRefCount, 0)
  const unresolvedCount = buckets.reduce((sum, bucket) => sum + bucket.unresolvedCount, 0)
  if (totalCount === 0 || (unresolvedCount === 0 && typedRefCount >= totalCount)) {
    return { risks: [], fixes: [], rewriteRequired: false }
  }
  const severe = unresolvedCount >= 8 || (totalCount > 0 && typedRefCount / totalCount < 0.45)
  return {
    risks: [
      `当前 thread/timeline/item 的 typed ref 覆盖不足：已覆盖 ${typedRefCount}/${totalCount}，未解析引用 ${unresolvedCount} 条。`,
      ...buckets
        .filter((bucket) => bucket.unresolvedCount > 0)
        .map((bucket) => `${bucket.label} 仍有 ${bucket.unresolvedCount} 条 unresolved typed ref。`),
    ],
    fixes: ['先补齐线程、时间线和物品的 typed ref 绑定，再继续依赖这些资产做连续性判断。'],
    severity: severe ? 'high' : 'medium',
    rewriteRequired: severe,
  }
}

export function applyProvenanceAndOperatingModeToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  input: {
    novelId: number
    chapterNum: number
    genreName?: string | null
    worldRulesJson?: string | null
    backgroundText?: string | null
    glossaryTerms?: string[]
    historicalProfileJson?: string | null
    projectCanonProfileJson?: string | null
    canonConstraintSetJson?: string | null
    sourceLedgerJson?: string | null
    canonSourceLedgerJson?: string | null
    canonFactCardsJson?: string | null
    launchMode?: string | null
    targetWords?: number | null
    settingsJson?: string | null
    scenePlanJson?: string | null
  },
): ChapterReviewNotes {
  const db = getDb()
  const typedRefSummary = buildTypedRefRiskSummary(input.novelId)
  const groundingAssessment = assessHistoricalGrounding({
    genreName: input.genreName,
    worldRulesJson: input.worldRulesJson,
    backgroundText: input.backgroundText,
    glossaryTerms: input.glossaryTerms,
    historicalProfileJson: input.historicalProfileJson,
    projectCanonProfileJson: input.projectCanonProfileJson,
    canonConstraintSetJson: input.canonConstraintSetJson,
    sourceLedgerJson: input.sourceLedgerJson,
    canonSourceLedgerJson: input.canonSourceLedgerJson,
    canonFactCardsJson: input.canonFactCardsJson,
  })
  const chapterCount = db.select({ id: chapters.id }).from(chapters).where(eq(chapters.novelId, input.novelId)).all().length
  const runtimePolicy = getOperatingModeRuntimePolicy({
    launchMode: input.launchMode,
    targetWords: input.targetWords,
    settingsJson: input.settingsJson,
    chapterCount,
  })
  const checkpointRows = db.select().from(storyMemoryCheckpoints).where(eq(storyMemoryCheckpoints.novelId, input.novelId)).all()
  const latestNovelCheckpoint = checkpointRows.find((row) => row.scopeType === 'novel' && (row.scopeId ?? null) === null) || null
  const checkpointLag = Math.max(0, input.chapterNum - (latestNovelCheckpoint?.lastRefreshedChapterNum || 0))
  const volumeCount = db.select().from(storyVolumes).where(eq(storyVolumes.novelId, input.novelId)).all().length
  const partCount = db.select().from(storyParts).where(eq(storyParts.novelId, input.novelId)).all().length
  const scenePlanCount = (() => {
    if (!input.scenePlanJson?.trim()) return 0
    try {
      const parsed = JSON.parse(input.scenePlanJson) as unknown
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  })()
  const sourceGroundingRisks = groundingAssessment.mode !== 'none' && groundingAssessment.coverage !== 'grounded'
    ? [
        groundingAssessment.mode === 'historical_realist'
          ? '历史正剧当前来源覆盖不足，具体制度/器物/纪年细节仍缺 grounding。'
          : groundingAssessment.mode === 'alternate_history'
            ? '架空历史当前分歧点或制度依据不足，具体设定仍像 generic 历史脑补。'
            : '类历史奇幻当前历史 grounding 不足，历史框架与奇幻边界仍不清晰。',
        groundingAssessment.conservativeFallbackActive ? '当前题材已触发 conservative fallback，不能继续 generic 历史细节脑补。': '',
      ].filter(Boolean)
    : []
  const operatingModeRisks = [
    runtimePolicy.operatingMode === 'million_longform' && checkpointLag > runtimePolicy.checkpointGapWarningThreshold
      ? `百万字模式下 story-memory checkpoint 已落后 ${checkpointLag} 章，超过阈值 ${runtimePolicy.checkpointGapWarningThreshold}。`
      : '',
    runtimePolicy.operatingMode === 'shortform' && (volumeCount > 1 || partCount > 0 || scenePlanCount >= 6)
      ? `短篇模式当前结构深度过高：卷 ${volumeCount} / 部 ${partCount} / 场景 ${scenePlanCount}，已偏离 shortform operatingMode。`
      : '',
  ].filter(Boolean)

  return {
    ...reviewNotes,
    typed_ref_risks: dedupeTextList([...reviewNotes.typed_ref_risks, ...typedRefSummary.risks]),
    source_grounding_risks: dedupeTextList([...reviewNotes.source_grounding_risks, ...sourceGroundingRisks]),
    operating_mode_risks: dedupeTextList([...reviewNotes.operating_mode_risks, ...operatingModeRisks]),
    critical_fixes: dedupeTextList([
      ...typedRefSummary.fixes,
      sourceGroundingRisks.length > 0 ? '补充来源/grounding 依据，或把高承诺细节改写为保守表达后再发布。' : '',
      runtimePolicy.operatingMode === 'million_longform' && checkpointLag > runtimePolicy.checkpointGapWarningThreshold
        ? '先刷新 story-memory checkpoint，再继续按百万字模式推进。'
        : '',
      runtimePolicy.operatingMode === 'shortform' && (volumeCount > 1 || partCount > 0 || scenePlanCount >= 6)
        ? '收缩卷/部/场景复杂度，或把项目切换到更匹配的 operatingMode。'
        : '',
      ...reviewNotes.critical_fixes,
    ]),
    severity: [
      typedRefSummary.severity,
      sourceGroundingRisks.length > 0 ? (groundingAssessment.mode === 'historical_realist' ? 'high' : 'medium') : undefined,
      operatingModeRisks.some((item) => item.includes('百万字模式')) ? 'high' : operatingModeRisks.length > 0 ? 'medium' : undefined,
    ].filter(Boolean).reduce<ReviewSeverity>((current, next) => mergeSeverity(current, next as ReviewSeverity), reviewNotes.severity),
    rewrite_required: reviewNotes.rewrite_required
      || typedRefSummary.rewriteRequired
      || sourceGroundingRisks.length > 0
      || operatingModeRisks.some((item) => item.includes('百万字模式')),
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      typedRefSummary.risks[0] || '',
      sourceGroundingRisks[0] || '',
      operatingModeRisks[0] || '',
    ]),
  }
}

export function applyLongWindowQualitySignalsToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  content: string,
  input: {
    novelId: number
    chapterNum: number
    genre?: string
    chapterId?: number
    chapterFunction?: string
    emotionTone?: string
  },
): ChapterReviewNotes {
  const aiFlavor = analyzeWorkspaceAiFlavor(content, input.genre, {
    chapterFunction: input.chapterFunction,
    emotionTone: input.emotionTone,
  })
  const dashboard = getQualityDashboardData(input.novelId, { includeDialogueInsights: true })
  const topRepeatedRules = dashboard.antiAiRecurrence.topRepeatedRules
  const recurringTemplateSignals = topRepeatedRules
    .filter((item) =>
      item.ruleTitle.includes('重复')
      || item.ruleTitle.includes('模板')
      || item.ruleTitle.includes('连接')
      || item.ruleTitle.includes('情绪'))
    .slice(0, 3)
  const genreRegisterRisks = [
    aiFlavor.humanizationSignals.some((item) => item.issueType === 'world_exposition_dump')
      ? '题材语域开始滑向说明文/设定讲解，场景承载的题材语感被解释腔稀释。'
      : '',
    aiFlavor.humanizationSignals.some((item) => item.issueType === 'ornament_overload')
      ? '题材语域出现华饰化漂移，辞藻和抽象升华正在覆盖题材固有的动作/制度/生态质感。'
      : '',
    aiFlavor.sampleFindings.some((item) => item.includes('解释腔') || item.includes('抽象'))
      ? '当前章节语域偏抽象或偏说明，题材特定话语体系没有稳定落在人物、动作和环境上。'
      : '',
  ].filter(Boolean)
  const expositionRisks = [
    aiFlavor.humanizationSignals.some((item) => item.issueType === 'explanatory_narration')
      ? `解释密度偏高：${aiFlavor.summary}`
      : '',
    aiFlavor.humanizationSignals.some((item) => item.issueType === 'world_exposition_dump')
      ? '世界观说明文占比偏高，正文在替设定做摘要，而不是让场景自己显影。'
      : '',
    aiFlavor.humanizationSignals.some((item) => item.issueType === 'transition_density')
      ? '过渡句/承接句密度偏高，阅读体验开始像模板化串联。'
      : '',
  ].filter(Boolean)
  const longWindowHomogenizationRisks = [
    ...recurringTemplateSignals.map((item) => `长窗模板复现：${item.ruleTitle}，近期命中 ${item.hitCount} 次。`),
    dashboard.antiAiRecurrence.highRiskRuleCount > 0
      ? `反 AI 高风险复现规则 ${dashboard.antiAiRecurrence.highRiskRuleCount} 类，近期已经形成累积同质化压力。`
      : '',
  ].filter(Boolean)
  const dialogueSeparabilityRisks = [
    dashboard.dialogueFingerprintStats.highSimilarityPairCount >= 2
      ? `长窗对白可分离度下降：高相似角色对 ${dashboard.dialogueFingerprintStats.highSimilarityPairCount} 组。`
      : '',
    dashboard.voiceEvolutionSummary.driftingCharacterCount > 0
      ? `角色对白漂移 ${dashboard.voiceEvolutionSummary.driftingCharacterCount} 名，近期 voice profile 正在失稳。`
      : '',
    dashboard.requiredDialogueVoiceLocks.length > 0
      ? `仍有 ${dashboard.requiredDialogueVoiceLocks.length} 名角色需要补 voice lock 才能维持长窗口吻分离。`
      : '',
  ].filter(Boolean)

  return {
    ...reviewNotes,
    genre_register_risks: dedupeTextList([...reviewNotes.genre_register_risks, ...genreRegisterRisks]),
    long_window_humanization_risks: dedupeTextList([...reviewNotes.long_window_humanization_risks, ...expositionRisks, ...longWindowHomogenizationRisks]),
    dialogue_separability_risks: dedupeTextList([...reviewNotes.dialogue_separability_risks, ...dialogueSeparabilityRisks]),
    critical_fixes: dedupeTextList([
      expositionRisks.length > 0 ? '删减解释腔和世界观说明文，把设定信息改写为场景动作、对白和结果状态。': '',
      longWindowHomogenizationRisks.length > 0 ? '优先替换复现频率最高的模板连接、模板情绪和高频重复句式。': '',
      dialogueSeparabilityRisks.length > 0 ? '为高相似/漂移角色补 voice lock，并重写关键对白段落。': '',
      ...reviewNotes.critical_fixes,
    ]),
    severity: [
      genreRegisterRisks.length > 0 ? 'medium' : undefined,
      expositionRisks.length >= 2 ? 'high' : expositionRisks.length > 0 ? 'medium' : undefined,
      longWindowHomogenizationRisks.length >= 2 ? 'medium' : undefined,
      dialogueSeparabilityRisks.length >= 2 ? 'high' : dialogueSeparabilityRisks.length > 0 ? 'medium' : undefined,
    ].filter(Boolean).reduce<ReviewSeverity>((current, next) => mergeSeverity(current, next as ReviewSeverity), reviewNotes.severity),
    rewrite_required: reviewNotes.rewrite_required
      || expositionRisks.length >= 2
      || dialogueSeparabilityRisks.length >= 2,
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      genreRegisterRisks[0] || '',
      expositionRisks[0] || '',
      longWindowHomogenizationRisks[0] || '',
      dialogueSeparabilityRisks[0] || '',
    ]),
  }
}

export function findingSeverityToReviewSeverity(severity: 'low' | 'medium' | 'high'): ReviewSeverity {
  if (severity === 'high') return 'high'
  if (severity === 'medium') return 'medium'
  return 'low'
}

export function buildGuardrailCriticalFixes(findings: ReturnType<typeof collectQualityGuardrailFindings>): string[] {
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

  if (findings.some((finding) => finding.code === 'not_but_definition_pattern')) {
    fixes.push('禁止使用“不是……而是……”或“不是……是……”式定义句；把判断拆成直接的动作、事实和结果，不要用对照句替代现场。')
  }

  if (findings.some((finding) => finding.code === 'dash_abuse')) {
    const dashFinding = findings.find((finding) => finding.code === 'dash_abuse')
    fixes.push(`删除解释型破折号${dashFinding?.excerpt ? `（${dashFinding.excerpt}）` : ''}，把补充信息改成动作、事实或独立短句；只有真实打断或抢话才保留。`)
  }

  if (findings.some((finding) => finding.code === 'high_frequency_repetition')) {
    const repetitionFinding = findings.find((f) => f.code === 'high_frequency_repetition')
    if (repetitionFinding) {
      fixes.push(`高频重复词组需替换：${repetitionFinding.excerpt}——重复的人名改用代词、称呼变化或动作主语省略，重复的描写词组换成不同观察角度，只在容易混淆时保留原名。`)
    }
  }

  if (findings.some((finding) => finding.code === 'low_value_body_detail')) {
    const bodyDetailFinding = findings.find((finding) => finding.code === 'low_value_body_detail')
    fixes.push(`低价值身体/声音细节需删减${bodyDetailFinding?.excerpt ? `（${bodyDetailFinding.excerpt}）` : ''}：删除不改变事件、阻力或关系的手指、指尖、眼睛、喉咙和嗓音微动作；保留的细节必须立刻带来可见行动、判断依据或后果。`)
  }

  if (findings.some((finding) => finding.code === 'paragraph_simile_stacking' || finding.code === 'double_metaphor_or_simile_stack')) {
    const simileFinding = findings.find((f) => f.code === 'paragraph_simile_stacking' || f.code === 'double_metaphor_or_simile_stack')
    fixes.push(`比喻连用过密${simileFinding?.excerpt ? `（${simileFinding.excerpt}）` : ''}：每段最多保留一处最有信息量的比喻，其余改成直接的动作、感官事实或后果。`)
  }

  if (findings.some((finding) => finding.code === 'ending_lonely_imagery')) {
    const endingFinding = findings.find((f) => f.code === 'ending_lonely_imagery')
    fixes.push(`章尾出现意象化孤独收尾模板${endingFinding?.excerpt ? `（"${endingFinding.excerpt}"）` : ''}：改成未完成的动作、新的风险或一句改变局势的对白，不要用画面抒情收章。`)
  }

  return fixes
}

export function appendRevisionBrief(base: string, additions: string[]): string {
  const merged = dedupeTextList([base, ...additions])
  if (merged.length === 0) return ''
  return merged.join('；').slice(0, 140)
}

export function applyHumanizationAnalysisToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  content: string,
  options: {
    chapterId?: number
    genre?: string
    chapterFunction?: string
    emotionTone?: string
  } = {},
): ChapterReviewNotes {
  const narrativeContractSignals = options.chapterId ? loadNarrativeContractSignals(options.chapterId) : {
    emotionFocus: '',
    expositionMode: '',
  }
  const sceneSnapshots = options.chapterId ? loadNarrativeControlSceneSnapshots(options.chapterId) : []
  const aiFlavor = analyzeWorkspaceAiFlavor(content, options.genre, {
    chapterFunction: options.chapterFunction,
    emotionTone: options.emotionTone,
    emotionFocus: narrativeContractSignals.emotionFocus,
    expositionMode: narrativeContractSignals.expositionMode,
    sceneSnapshots,
  })
  const signals = aiFlavor.humanizationSignals.filter((item) => HUMANIZATION_REVIEW_SIGNAL_TYPES.has(item.issueType))
  if (signals.length === 0 && aiFlavor.humanizationDirections.length === 0) {
    return reviewNotes
  }

  const signalDetails = signals.map((item) => `${item.title}：${item.detail}`)
  const criticalSignals = signals
    .filter((item) => item.severity === 'high')
    .map((item) => `${item.title}：${item.prefer || item.avoid}`)
  const languageRisks = signals
    .filter((item) => item.issueType === 'template_connector' || item.issueType === 'explanatory_narration' || item.issueType === 'ornament_overload' || item.issueType === 'world_exposition_dump')
    .map((item) => item.detail)
  const coherenceRisks = signals
    .filter((item) => item.issueType === 'sensory_anchor_missing' || item.issueType === 'weak_stance' || item.issueType === 'transition_density')
    .map((item) => item.detail)
  const readerHookRisks = signals
    .filter((item) => item.issueType === 'emotion_monotony' || item.issueType === 'transition_density')
    .map((item) => item.detail)
  const genreHollowingRisks = signals
    .filter((item) => item.issueType === 'world_exposition_dump')
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
    reader_hook_risks: dedupeTextList([...reviewNotes.reader_hook_risks, ...readerHookRisks]),
    genre_hollowing_risks: dedupeTextList([...reviewNotes.genre_hollowing_risks, ...genreHollowingRisks]),
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

export function applyDialogueAnalysisToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  novelId: number,
  chapterNum: number,
  content: string,
  analysis = analyzeChapterDialogueAgainstNovel(novelId, chapterNum, content),
  options: { replaceExistingSignals?: boolean } = {},
): ChapterReviewNotes {
  const replaceExistingSignals = options.replaceExistingSignals === true
  if (
    !replaceExistingSignals
    &&
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
    dialogue_homogenization_risks: replaceExistingSignals
      ? dedupeTextList(analysis.risks)
      : dedupeTextList([
          ...reviewNotes.dialogue_homogenization_risks,
          ...analysis.risks,
        ]),
    dialogue_fingerprint_summary: replaceExistingSignals
      ? analysis.fingerprintSummary || ''
      : analysis.fingerprintSummary || reviewNotes.dialogue_fingerprint_summary,
    dialogue_voice_lock_summary: replaceExistingSignals
      ? analysis.voiceLockSummary || ''
      : analysis.voiceLockSummary || reviewNotes.dialogue_voice_lock_summary,
    dialogue_filler_risks: replaceExistingSignals
      ? dedupeTextList(analysis.fillerRisks)
      : dedupeTextList([
          ...reviewNotes.dialogue_filler_risks,
          ...analysis.fillerRisks,
        ]),
    dialogue_info_density_risks: replaceExistingSignals
      ? dedupeTextList(analysis.infoDensityRisks)
      : dedupeTextList([
          ...reviewNotes.dialogue_info_density_risks,
          ...analysis.infoDensityRisks,
        ]),
    required_voice_lock_character_ids: replaceExistingSignals
      ? [...new Set(analysis.requiredVoiceLockCharacterIds)]
      : [...new Set([
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

export function normalizeStyleComplianceMetrics(raw: unknown): StyleComplianceMetricSnapshot {
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

export function normalizeStyleComplianceStatus(raw: unknown): StyleComplianceResult['status'] {
  if (raw === 'rewrite') return 'rewrite'
  if (raw === 'warning') return 'warning'
  return 'pass'
}

export function normalizeStyleComplianceResult(raw: unknown): StyleComplianceResult | undefined {
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

export function normalizeReadingExperience(raw: unknown): ChapterReadingExperienceScore | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const metrics = record.metrics && typeof record.metrics === 'object' && !Array.isArray(record.metrics)
    ? record.metrics as Record<string, unknown>
    : {}
  const risks = toStringArray(record.risks)
  const recommendations = toStringArray(record.recommendations)
  const summary = asText(record.summary)
  const score = normalizeBoundedNumber(record.score, 0, 100, 0)
  if (!summary && risks.length === 0 && recommendations.length === 0 && score <= 0) return undefined
  return {
    score,
    status: record.status === 'rewrite' ? 'rewrite' : record.status === 'warning' ? 'warning' : 'pass',
    summary,
    risks,
    recommendations,
    metrics: {
      avgSentenceLength: normalizeBoundedMetric(metrics.avgSentenceLength, 0, 9999, 0),
      avgParagraphLength: normalizeBoundedMetric(metrics.avgParagraphLength, 0, 99999, 0),
      dialogueParagraphRate: normalizeBoundedMetric(metrics.dialogueParagraphRate, 0, 100, 0),
      paragraphCount: normalizeBoundedNumber(metrics.paragraphCount, 0, 99999, 0),
      sentenceCount: normalizeBoundedNumber(metrics.sentenceCount, 0, 99999, 0),
    },
  }
}

export function normalizeRewriteDelta(raw: unknown): RewriteNarrativeDeltaReport | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const findings = toStringArray(record.findings)
  const recommendation = asText(record.recommendation)
  if (findings.length === 0 && !recommendation && !record.status) return undefined
  return {
    status: record.status === 'fail' ? 'fail' : record.status === 'weak' ? 'weak' : 'pass',
    structuralIssueCount: normalizeBoundedNumber(record.structuralIssueCount, 0, 999, 0),
    similarityToOriginal: normalizeBoundedMetric(record.similarityToOriginal, 0, 100, 0),
    changedSentenceRate: normalizeBoundedMetric(record.changedSentenceRate, 0, 100, 0),
    narrativeAnchorChangeRate: normalizeBoundedMetric(record.narrativeAnchorChangeRate, -100, 100, 0),
    actionVerbDeltaRate: normalizeBoundedMetric(record.actionVerbDeltaRate, -100, 100, 0),
    conflictChain: normalizeRewriteDeltaChain(record.conflictChain),
    costChain: normalizeRewriteDeltaChain(record.costChain),
    goalChain: normalizeRewriteDeltaChain(record.goalChain),
    findings,
    recommendation,
  }
}

export function normalizeRewriteDeltaChain(raw: unknown): RewriteDeltaChainScore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      score: 100,
      status: 'pass',
      originalHitRate: 0,
      rewrittenHitRate: 0,
      deltaRate: 0,
      findings: [],
    }
  }
  const record = raw as Record<string, unknown>
  return {
    score: normalizeBoundedNumber(record.score, 0, 100, 100),
    status: record.status === 'fail' ? 'fail' : record.status === 'weak' ? 'weak' : 'pass',
    originalHitRate: normalizeBoundedMetric(record.originalHitRate, 0, 100, 0),
    rewrittenHitRate: normalizeBoundedMetric(record.rewrittenHitRate, 0, 100, 0),
    deltaRate: normalizeBoundedMetric(record.deltaRate, -100, 100, 0),
    findings: toStringArray(record.findings),
  }
}

export function replacePrefixedNotes(existing: string[], prefix: string, additions: string[]): string[] {
  const normalizedAdditions = additions
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `${prefix}${item}`)
  return dedupeTextList([
    ...existing.filter((item) => !item.startsWith(prefix)),
    ...normalizedAdditions,
  ])
}

export function applyStyleComplianceToReviewNotes(
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

export function applyReadingExperienceToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  content: string,
): ChapterReviewNotes {
  const readingExperience = analyzeChapterReadingExperience(content)
  if (readingExperience.status === 'pass') {
    return {
      ...reviewNotes,
      reading_experience: readingExperience,
    }
  }

  return {
    ...reviewNotes,
    reading_experience: readingExperience,
    reader_hook_risks: dedupeTextList([
      ...reviewNotes.reader_hook_risks,
      ...readingExperience.risks.filter((item) =>
        item.includes('剧情落点')
        || item.includes('人物互动')
        || item.includes('场景推进')),
    ]),
    coherence_risks: dedupeTextList([
      ...reviewNotes.coherence_risks,
      ...readingExperience.risks.filter((item) =>
        item.includes('阅读阻力')
        || item.includes('信息拥堵')
        || item.includes('段落过厚')),
    ]),
    language_risks: dedupeTextList([
      ...reviewNotes.language_risks,
      ...readingExperience.risks.filter((item) =>
        item.includes('长句')
        || item.includes('节奏')),
    ]),
    human_language_repairs: dedupeTextList([
      ...reviewNotes.human_language_repairs,
      ...readingExperience.recommendations,
    ]),
    critical_fixes: dedupeTextList([
      readingExperience.status === 'rewrite'
        ? '章节读感未达长篇连载门槛：必须同时修句长、段落密度、动作锚点和剧情结果，不允许只做词句润色。'
        : '',
      ...reviewNotes.critical_fixes,
    ]),
    summary: reviewNotes.summary || readingExperience.summary,
    severity: readingExperience.status === 'rewrite'
      ? mergeSeverity(reviewNotes.severity, 'high')
      : mergeSeverity(reviewNotes.severity, 'medium'),
    rewrite_required: reviewNotes.rewrite_required || readingExperience.status === 'rewrite',
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      readingExperience.summary,
      ...readingExperience.recommendations.slice(0, 3),
    ]),
  }
}

export function countNarrativeWords(text: string): number {
  const source = String(text || '')
  return (source.match(/[一-鿿]/g) || []).length + (source.match(/\b[a-zA-Z]+\b/g) || []).length
}

/**
 * 剥离模型输出正文开头自拟的章节标题行（如“第1章 残片”“# 标题”或与章题雷同的独立短行），
 * 并返回检测到的自拟标题用于章题一致性校验。
 */
export function stripChapterHeadingNoise(
  content: string,
  chapterNum: number,
  chapterTitle: string,
): { content: string; detectedTitle: string } {
  const normalized = String(content || '').replace(/\r\n/g, '\n').trimStart()
  const lines = normalized.split('\n')
  let detectedTitle = ''
  let index = 0
  while (index < lines.length && index < 3) {
    const line = lines[index].trim()
    if (!line) {
      index += 1
      continue
    }
    const headingMatch = line.match(/^#{0,3}\s*第\s*[0-9一二三四五六七八九十百千]+\s*章\s*[·：:.\-—\s]*(.{0,30})$/u)
    const markdownHeading = line.match(/^#{1,3}\s+(.{1,30})$/u)
    const bareTitleRepeat = chapterTitle && line.length <= Math.max(chapterTitle.length + 2, 12) && line === chapterTitle
    if (headingMatch) {
      detectedTitle = (headingMatch[1] || '').trim() || detectedTitle
      lines.splice(index, 1)
      continue
    }
    if (markdownHeading || bareTitleRepeat) {
      detectedTitle = detectedTitle || (markdownHeading ? markdownHeading[1].trim() : line)
      lines.splice(index, 1)
      continue
    }
    break
  }
  return {
    content: lines.join('\n').trimStart(),
    detectedTitle,
  }
}

export function buildTitleMismatchRisk(detectedTitle: string, chapterTitle: string, chapterNum: number): string {
  if (!detectedTitle) return ''
  const normalizedDetected = detectedTitle.replace(/\s+/g, '')
  const normalizedTitle = String(chapterTitle || '').replace(/\s+/g, '')
  if (!normalizedDetected || normalizedDetected === normalizedTitle) return ''
  return `正文自拟标题“${detectedTitle}”与第${chapterNum}章章题“${chapterTitle}”不一致，已剥离；请确认章题与本章内容是否需要对齐。`
}

/**
 * 字数只做异常观察，不把章节目标当作硬性配额。
 * 章节可以因场景数量、冲突强度和收束位置自然变长或变短；只有极端偏离参考值时，
 * 才给编辑一个低优先级提示，不能自动补写、压缩或把章节判为重写失败。
 */
export function applyWordShapeObservation(
  reviewNotes: ChapterReviewNotes,
  content: string,
  targetWords: number,
): ChapterReviewNotes {
  const target = Math.max(0, Math.round(targetWords || 0))
  if (target < 300) return reviewNotes
  const words = countNarrativeWords(content)
  if (words === 0) return reviewNotes
  const lowerObservation = Math.round(target * 0.45)
  const upperObservation = Math.round(target * 2.2)
  if (words >= lowerObservation && words <= upperObservation) return reviewNotes
  const direction = words < lowerObservation ? '偏短' : '偏长'
  const directive = `篇幅观察：本章约 ${words} 字，较参考值 ${target} 字${direction}。仅检查场景是否完整、冲突是否自然收束；不要为了达到参考值强行补写或删戏。`
  return {
    ...reviewNotes,
    language_risks: dedupeTextList([...reviewNotes.language_risks, directive]),
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [directive]),
    severity: mergeSeverity(reviewNotes.severity, 'low'),
  }
}

export function applyRewriteDeltaToReviewNotes(
  reviewNotes: ChapterReviewNotes,
  rewriteDelta: RewriteNarrativeDeltaReport,
): ChapterReviewNotes {
  if (rewriteDelta.status === 'pass') {
    return {
      ...reviewNotes,
      rewrite_delta: rewriteDelta,
    }
  }

  return {
    ...reviewNotes,
    rewrite_delta: rewriteDelta,
    critical_fixes: dedupeTextList([
      rewriteDelta.status === 'fail'
        ? '重写差异验证失败：当前结果疑似只润色语言，没有真正修复剧情、冲突或代价。'
        : '重写差异验证偏弱：需要补足事件变化、结果状态和代价落点。',
      ...reviewNotes.critical_fixes,
    ]),
    arc_progress_risks: dedupeTextList([
      ...reviewNotes.arc_progress_risks,
      ...rewriteDelta.findings.filter((item) =>
        item.includes('剧情')
        || item.includes('冲突')
        || item.includes('锚点')
        || item.includes('代价')
        || item.includes('目标')
        || item.includes('链')),
    ]),
    coherence_risks: dedupeTextList([
      ...reviewNotes.coherence_risks,
      ...rewriteDelta.findings,
    ]),
    severity: rewriteDelta.status === 'fail'
      ? mergeSeverity(reviewNotes.severity, 'high')
      : mergeSeverity(reviewNotes.severity, 'medium'),
    rewrite_required: true,
    revision_brief: appendRevisionBrief(reviewNotes.revision_brief, [
      rewriteDelta.recommendation,
    ]),
  }
}

export function buildStructuralAlertsSummary(
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

export function enhanceReviewNotesWithGuardrails(
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

export function parseStoredReviewNotes(raw?: string | null): ChapterReviewNotes {
  if (!raw?.trim()) return normalizeReviewNotes({})

  try {
    return normalizeReviewNotes(JSON.parse(raw) as unknown)
  } catch {
    return normalizeReviewNotes({})
  }
}
