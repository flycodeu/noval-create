import type {
  ChapterContractValidationResult,
  RewritePlan,
} from '../../src/types'
import {
  chapters,
  chapterContracts,
  characters,
  characterArcs,
  characterArcBeats,
  foreshadowLedger,
  relationshipArcs,
  resistanceBeats,
  resistanceTracks,
} from '../database/schema'

export type ContractAuditStatus = 'pass' | 'warning' | 'blocker'
export type ChapterGateLevel = 'pass' | 'warning' | 'blocker' | 'rewrite'
export type ChapterGateScoreBand = 'stable' | 'attention' | 'risky' | 'unstable'
export type ChapterPublishCheckSource = 'chapter' | 'scene' | 'contract' | 'review' | 'thread' | 'volume'
export type ChapterPublishRelatedPage = 'writing' | 'structure' | 'contracts' | 'revision' | 'volume-design' | 'threads'

export interface ChapterRewriteTarget {
  kind: 'chapter' | 'segment' | 'selection'
  chapterId: number
  segmentId?: number
  segmentTitle?: string
  reason: string
  relatedPage: ChapterPublishRelatedPage
}

export interface ChapterPublishCheckScoreBreakdown {
  totalScore: number
  continuityScore: number
  coherenceScore: number
  dialogueVoiceScore: number
  hookStrengthScore: number
  storyDynamicsScore: number
  languageNaturalnessScore: number
  styleComplianceScore: number
  povBoundaryScore: number
  sensoryCoverageScore: number
  narrativeRatioScore: number
  contractScore: number
  hookScore: number
  povPurityScore: number
  threadProgressScore: number
  volumeAlignmentScore: number
}

export interface ChapterGateDimensionDelta {
  key: string
  label: string
  score: number
  previousScore: number
  delta: number
}

export interface ChapterGateHistoryEntry {
  id: number
  novelId: number
  chapterId: number
  chapterNum: number
  gateLevel: ChapterGateLevel
  ready: boolean
  summary: string
  rewriteCount: number
  blockerCount: number
  warningCount: number
  generatedTaskCount: number
  topIssueKeys: string[]
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  createdAt: string
}

export interface ChapterGateDriftSummary {
  status: 'worsening' | 'improving' | 'stable'
  scoreBand: ChapterGateScoreBand
  currentScore: number
  previousScore?: number
  scoreDelta: number
  currentGateLevel: ChapterGateLevel
  previousGateLevel?: ChapterGateLevel
  topDimensions: ChapterGateDimensionDelta[]
  summary: string
  createdAt: string
}

export interface ChapterPublishCheckItem {
  key: string
  label: string
  status: ChapterGateLevel
  detail: string
  source: ChapterPublishCheckSource
  segmentId?: number
  segmentTitle?: string
  relatedPage?: ChapterPublishRelatedPage
  fixHint?: string
  taskId?: number
}

export interface ContractAuditItem {
  key: string
  label: string
  status: ContractAuditStatus
  detail: string
  source: 'chapter' | 'scene'
  segmentId?: number
  segmentTitle?: string
}

export interface ChapterContractAudit {
  checkedAt: string
  summary: string
  blockerCount: number
  warningCount: number
  passCount: number
  items: ContractAuditItem[]
}

export interface ChapterPublishCheck {
  chapterId: number
  chapterNum: number
  gateLevel: ChapterGateLevel
  ready: boolean
  summary: string
  blockerCount: number
  warningCount: number
  rewriteCount: number
  staleReasons: string[]
  chapterContextVersion: number
  novelContextVersion: number
  rewriteRecommended: boolean
  rewriteTarget?: ChapterRewriteTarget
  rewritePlan?: RewritePlan
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  history: ChapterGateHistoryEntry[]
  drift?: ChapterGateDriftSummary
  generatedTaskCount: number
  checklist: ChapterPublishCheckItem[]
  contractAudit: ChapterContractAudit
  contractValidation?: ChapterContractValidationResult
}

export interface ChapterContractAuditSceneSnapshot {
  segmentId?: number
  segmentOrder?: number
  segmentTitle: string
  status: string
  pov: string
  emotionShift: string
  timeLocation: string
  sceneGoal: string
  obstacle: string
  resultState: string
  segmentPurpose: string
  segmentTimeAnchor: string
  segmentLocationName: string
  segmentInputState: string
  segmentOutputState: string
  hasSegmentBinding: boolean
}

export interface ChapterContractAuditContext {
  chapter: typeof chapters.$inferSelect
  chapterContractRow: typeof chapterContracts.$inferSelect | null
  chapterContract: {
    chapterGoal: string
    openingStyle: string
    endingStyle: string
    expositionMode: string
    emotionFocus: string
    servedThreadIds: number[]
    requiredArcProgress: string[]
    requiredCharacterArcIds: number[]
    requiredRelationshipArcIds: number[]
    requiredResistanceTrackIds: number[]
    requiredEndgameCommitmentIds: number[]
    requiredForeshadowIds: number[]
    hookType: string
    acceptanceNotes: string[]
    status: string
  }
  sceneSnapshots: ChapterContractAuditSceneSnapshot[]
  characterRows: typeof characters.$inferSelect[]
  characterArcRows: typeof characterArcs.$inferSelect[]
  characterBeatRows: typeof characterArcBeats.$inferSelect[]
  relationshipArcRows: typeof relationshipArcs.$inferSelect[]
  resistanceTrackRows: typeof resistanceTracks.$inferSelect[]
  resistanceBeatRows: typeof resistanceBeats.$inferSelect[]
  foreshadowRows: typeof foreshadowLedger.$inferSelect[]
}

export interface ScenePlanSnapshot {
  sceneTitle: string
  exitHook: string
}

export interface ChapterGateTaskDraft {
  issueKey: string
  severity: 'high' | 'medium' | 'low'
  title: string
  description: string
  fixBrief: string
  relatedPage: ChapterPublishRelatedPage
  chapterId: number
  itemKey: string
  originMeta: Record<string, unknown>
}

export interface ReviewStateSnapshot {
  severity?: string
  rewriteRequired: boolean
  costEvaporation: boolean
  forcedReversal: boolean
  tooSmooth: boolean
  highPressureNoReward: boolean
  criticalFixes: string[]
  continuityRisks: string[]
  contextDriftRisks: string[]
  realismRisks: string[]
  coherenceRisks: string[]
  readerHookRisks: string[]
  stepMemoryRisks: string[]
  openingHookRisks: string[]
  titleAlignmentRisks: string[]
  hallucinationRisks: string[]
  arcProgressRisks: string[]
  languageRisks: string[]
  humanLanguageRepairs: string[]
  genreHollowingRisks: string[]
  typedRefRisks: string[]
  sourceGroundingRisks: string[]
  operatingModeRisks: string[]
  longWindowHumanizationRisks: string[]
  genreRegisterRisks: string[]
  dialogueSeparabilityRisks: string[]
  missingPayoffs: string[]
  dialogueHomogenizationRisks: string[]
  dialogueDriftAlerts: string[]
  crossCharacterSimilarity: string[]
  dialogueFillerRisks: string[]
  dialogueInfoDensityRisks: string[]
  dialogueVoiceLockSummary: string
  chapterFunctionPrimary: string
  chapterFunctionTags: string[]
  revisionBrief: string
  paceMarker: string
  styleComplianceChecked: boolean
  styleComplianceStatus: 'pass' | 'warning' | 'rewrite'
  styleComplianceScore?: number
  styleComplianceSummary: string
  styleComplianceDeviations: string[]
  styleComplianceForbiddenPatterns: string[]
  rewriteRecheckPerformed: boolean
  rewriteDeltaStatus?: 'pass' | 'weak' | 'fail'
  rewriteDeltaFindings: string[]
  semanticVerdicts: Array<{ status: string; summary: string }>
}

export function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean))]
  } catch {
    return []
  }
}

export function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

export function dedupeTextList(values: Array<string | undefined | null | false>): string[] {
  return [...new Set(values
    .map((value) => normalizeText(typeof value === 'string' ? value : ''))
    .filter(Boolean))]
}

export function parseUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

// 审校模型偶尔把“无问题”结论写进风险数组（如“无擅自新增设定…不构成幻觉风险”“标题未提供，无法评估”），
// 这类非风险陈述不应参与 blocker 判定
export function dropNonRiskStatements(items: string[]): string[] {
  return items.filter((item) => {
    const head = item.slice(0, 4)
    if (/^(无|没有|未发现|未识别|不存在)/.test(head)) return false
    if (item.includes('不构成') && item.includes('风险')) return false
    if (item.includes('无法评估')) return false
    // 审校模型也会把肯定性核对结论写进风险数组，且不一定以“无/未发现”开头。
    // 这些句子证明对应项目已核对通过，不能被发布门当成 blocker。
    const affirmativeAuditMarkers = [
      '执行正确',
      '未越界',
      '无需修改',
      '匹配度高',
      '均有来源',
      '来源充分',
      '来源清楚',
      '链条完整',
    ]
    if (affirmativeAuditMarkers.some((marker) => item.includes(marker))) return false
    return true
  })
}

export function parseReviewState(raw?: string | null): ReviewStateSnapshot {
  const fallback: ReviewStateSnapshot = {
    rewriteRequired: false,
    costEvaporation: false,
    forcedReversal: false,
    tooSmooth: false,
    highPressureNoReward: false,
    criticalFixes: [],
    continuityRisks: [],
    contextDriftRisks: [],
    realismRisks: [],
    coherenceRisks: [],
    readerHookRisks: [],
    stepMemoryRisks: [],
    openingHookRisks: [],
    titleAlignmentRisks: [],
    hallucinationRisks: [],
    arcProgressRisks: [],
    languageRisks: [],
    humanLanguageRepairs: [],
    genreHollowingRisks: [],
    typedRefRisks: [],
    sourceGroundingRisks: [],
    operatingModeRisks: [],
    longWindowHumanizationRisks: [],
    genreRegisterRisks: [],
    dialogueSeparabilityRisks: [],
    missingPayoffs: [],
    dialogueHomogenizationRisks: [],
    dialogueDriftAlerts: [],
    crossCharacterSimilarity: [],
    dialogueFillerRisks: [],
    dialogueInfoDensityRisks: [],
    dialogueVoiceLockSummary: '',
    chapterFunctionPrimary: '',
    chapterFunctionTags: [],
    revisionBrief: '',
    paceMarker: '',
    styleComplianceChecked: false,
    styleComplianceStatus: 'pass',
    styleComplianceScore: undefined,
    styleComplianceSummary: '',
    styleComplianceDeviations: [],
    styleComplianceForbiddenPatterns: [],
    rewriteRecheckPerformed: false,
    rewriteDeltaStatus: undefined,
    rewriteDeltaFindings: [],
    semanticVerdicts: [],
  }
  if (!raw) {
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const protagonistSetback = typeof parsed.protagonist_setback === 'string' ? parsed.protagonist_setback : 'none'
    const rewardState = typeof parsed.reward_state === 'string' ? parsed.reward_state : 'none'
    const costPresent = parsed.cost_present === true
    const protagonistPressure = typeof parsed.protagonist_pressure === 'number' ? parsed.protagonist_pressure : 0
    const styleCompliance = parsed.style_compliance && typeof parsed.style_compliance === 'object' && !Array.isArray(parsed.style_compliance)
      ? parsed.style_compliance as Record<string, unknown>
      : null
    return {
      ...fallback,
      severity: typeof parsed.severity === 'string' ? parsed.severity : undefined,
      rewriteRequired: parsed.rewrite_required === true,
      costEvaporation: parsed.cost_resolution_state === 'evaporated',
      forcedReversal: parsed.reversal_marker === true && parsed.reversal_support_state === 'forced',
      tooSmooth: protagonistSetback === 'none' && (rewardState === 'partial' || rewardState === 'major') && !costPresent,
      highPressureNoReward: (protagonistSetback === 'minor' || protagonistSetback === 'major' || protagonistPressure >= 60) && rewardState === 'none',
      criticalFixes: parseUnknownStringArray(parsed.critical_fixes),
      continuityRisks: parseUnknownStringArray(parsed.continuity_risks),
      contextDriftRisks: parseUnknownStringArray(parsed.context_drift_risks),
      realismRisks: parseUnknownStringArray(parsed.realism_risks),
      coherenceRisks: parseUnknownStringArray(parsed.coherence_risks),
      readerHookRisks: parseUnknownStringArray(parsed.reader_hook_risks),
      stepMemoryRisks: parseUnknownStringArray(parsed.step_memory_risks),
      openingHookRisks: parseUnknownStringArray(parsed.opening_hook_risks),
      titleAlignmentRisks: dropNonRiskStatements(parseUnknownStringArray(parsed.title_alignment_risks)),
      hallucinationRisks: dropNonRiskStatements(parseUnknownStringArray(parsed.hallucination_risks)),
      arcProgressRisks: parseUnknownStringArray(parsed.arc_progress_risks),
      languageRisks: parseUnknownStringArray(parsed.language_risks),
      humanLanguageRepairs: parseUnknownStringArray(parsed.human_language_repairs),
      genreHollowingRisks: parseUnknownStringArray(parsed.genre_hollowing_risks),
      typedRefRisks: parseUnknownStringArray(parsed.typed_ref_risks),
      sourceGroundingRisks: parseUnknownStringArray(parsed.source_grounding_risks),
      operatingModeRisks: parseUnknownStringArray(parsed.operating_mode_risks),
      longWindowHumanizationRisks: parseUnknownStringArray(parsed.long_window_humanization_risks),
      genreRegisterRisks: parseUnknownStringArray(parsed.genre_register_risks),
      dialogueSeparabilityRisks: parseUnknownStringArray(parsed.dialogue_separability_risks),
      missingPayoffs: parseUnknownStringArray(parsed.missing_payoffs),
      dialogueHomogenizationRisks: parseUnknownStringArray(parsed.dialogue_homogenization_risks),
      dialogueFillerRisks: parseUnknownStringArray(parsed.dialogue_filler_risks),
      dialogueInfoDensityRisks: parseUnknownStringArray(parsed.dialogue_info_density_risks),
      dialogueVoiceLockSummary: normalizeText(parsed.dialogue_voice_lock_summary as string | undefined),
      dialogueDriftAlerts: Array.isArray(parsed.dialogue_drift_alerts)
        ? parsed.dialogue_drift_alerts
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) =>
            normalizeText(typeof item.reason === 'string' ? item.reason : undefined)
            || normalizeText(typeof item.characterName === 'string' ? item.characterName : undefined))
          .filter(Boolean)
        : [],
      crossCharacterSimilarity: Array.isArray(parsed.cross_character_similarity)
        ? parsed.cross_character_similarity
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map((item) => normalizeText(typeof item.reason === 'string' ? item.reason : undefined))
          .filter(Boolean)
        : [],
      chapterFunctionPrimary: normalizeText(parsed.chapter_function_primary as string | undefined),
      chapterFunctionTags: parseUnknownStringArray(parsed.chapter_function_tags),
      revisionBrief: normalizeText(parsed.revision_brief as string | undefined),
      paceMarker: normalizeText(parsed.pace_marker as string | undefined),
      styleComplianceChecked: Boolean(styleCompliance),
      styleComplianceStatus: styleCompliance?.status === 'rewrite'
        ? 'rewrite'
        : styleCompliance?.status === 'warning'
          ? 'warning'
          : 'pass',
      styleComplianceScore: typeof styleCompliance?.score === 'number' ? Math.max(0, Math.min(100, styleCompliance.score)) : undefined,
      styleComplianceSummary: normalizeText(typeof styleCompliance?.summary === 'string' ? styleCompliance.summary : undefined),
      styleComplianceDeviations: parseUnknownStringArray(styleCompliance?.deviations),
      styleComplianceForbiddenPatterns: parseUnknownStringArray(styleCompliance?.matchedForbiddenPatterns),
      rewriteRecheckPerformed: Boolean(
        parsed.rewrite_recheck
        && typeof parsed.rewrite_recheck === 'object'
        && (parsed.rewrite_recheck as Record<string, unknown>).performed === true,
      ),
      rewriteDeltaStatus: parsed.rewrite_delta
        && typeof parsed.rewrite_delta === 'object'
        && !Array.isArray(parsed.rewrite_delta)
        && ((parsed.rewrite_delta as Record<string, unknown>).status === 'pass'
          || (parsed.rewrite_delta as Record<string, unknown>).status === 'weak'
          || (parsed.rewrite_delta as Record<string, unknown>).status === 'fail')
        ? (parsed.rewrite_delta as Record<string, unknown>).status as 'pass' | 'weak' | 'fail'
        : undefined,
      rewriteDeltaFindings: parsed.rewrite_delta
        && typeof parsed.rewrite_delta === 'object'
        && !Array.isArray(parsed.rewrite_delta)
        ? parseUnknownStringArray((parsed.rewrite_delta as Record<string, unknown>).findings)
        : [],
      semanticVerdicts: Array.isArray(parsed.semantic_verdicts)
        ? parsed.semantic_verdicts
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map((item) => ({
            status: typeof item.status === 'string' ? item.status : 'uncertain',
            summary: typeof item.summary === 'string' ? item.summary : '',
          }))
        : [],
    }
  } catch {
    return fallback
  }
}
