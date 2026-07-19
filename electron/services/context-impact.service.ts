import { asc, desc, eq } from 'drizzle-orm'
import type {
  ChapterContractValidationResult,
  ChapterRewriteScope,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallSnapshot,
  RewritePlan,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import {
  chapterGateRuns,
  chapterContracts,
  chapterSegments,
  chapters,
  characters,
  characterArcBeats,
  characterArcs,
  factions,
  foreshadowLedger,
  novels,
  revisionTasks,
  relationshipArcs,
  resistanceBeats,
  resistanceTracks,
  sceneContracts,
  storyItems,
  storyMemoryCheckpoints,
  storyThreads,
  storyVolumes,
  timelineEvents,
  volumeDesigns,
} from '../database/schema'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import {
  deriveChapterContractValidationStatus,
  isContractValidationBlockerVerdict as isContractValidationBlockerVerdictValue,
  isContractValidationWarningVerdict as isContractValidationWarningVerdictValue,
  isHardContractValidationItem,
} from '../../src/shared/contract-validation'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  buildChapterGateDriftSummary,
  compareChapterGateSnapshots,
  normalizeChapterGateScoreBreakdown,
  safeParseChapterGateScoreBreakdown,
  safeParseStringArray,
} from './chapter-gate-utils'
import { buildNovelConsistencyReport, type ConsistencyIssue } from './consistency.service'
import { listChapterRecallRuntimeMap } from './chapter-recall-runtime.service'
import { buildHeuristicRecallDiagnostics, getQualityDashboardData } from './quality-dashboard.service'
import { getStoryArcProgressSnapshot, getStoryArcWarningsForChapter } from './story-arc-progress.service'
import {
  getContractValidationScore,
  validateChapterContractDelivery,
} from './chapter-contract-validator.service'
import { analyzeNarrativeControls } from './narrative-control.service'
import { getNovelAssetImpactSummary } from './asset-impact.service'
import { analyzeChapterDialogueAgainstNovel } from './dialogue-fingerprint.service'

type AssetFreshnessKey = 'faction' | 'character' | 'item' | 'thread' | 'timeline'

const ASSET_FRESHNESS_GRACE_MS = 60 * 1000
const ASSET_FRESHNESS_LABELS: Record<AssetFreshnessKey, string> = {
  faction: '势力',
  character: '人物',
  item: '物品',
  thread: '故事线程',
  timeline: '时间轴',
}

function parseStringArray(raw?: string | null): string[] {
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

function stringifyStringArray(values: string[]): string {
  return JSON.stringify([...new Set(values.map((item) => item.trim()).filter(Boolean))])
}

function formatRecallFallbackReason(reason?: RecallFallbackReason): string {
  switch (reason) {
    case 'embedding_service_failed':
      return '嵌入服务失败'
    case 'query_embedding_failed':
      return '查询向量失败'
    case 'disabled_by_config':
      return '向量能力未启用'
    case 'budget_trimmed':
      return '召回被预算裁剪'
    case 'only_stale_hits':
      return '仅命中过期片段'
    case 'no_hits':
      return '没有命中历史片段'
    default:
      return '未记录原因'
  }
}

function buildLatestRecallRuntimeMap(novelId: number): Map<number, {
  recallSnapshot?: RecallSnapshot
  recallDiagnostics?: RecallDiagnostics
}> {
  return Array.from(listChapterRecallRuntimeMap(novelId).entries()).reduce<Map<number, {
    recallSnapshot?: RecallSnapshot
    recallDiagnostics?: RecallDiagnostics
  }>>((result, [chapterId, runtime]) => {
    result.set(chapterId, {
      recallSnapshot: runtime.recallSnapshot,
      recallDiagnostics: runtime.recallDiagnostics,
    })
    return result
  }, new Map())
}

function getRecallFallbackStreak(
  novelId: number,
  currentChapterNum: number,
  runtimeByChapterId: Map<number, { recallSnapshot?: RecallSnapshot }>,
): number {
  const db = getDb()
  const orderedChapters = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
  }).from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(desc(chapters.chapterNum))
    .all()
    .filter((row) => row.chapterNum <= currentChapterNum)

  let streak = 0
  for (const row of orderedChapters) {
    if (!runtimeByChapterId.get(row.id)?.recallSnapshot?.degraded) break
    streak += 1
  }
  return streak
}

function parseNumberArray(raw?: string | null): number[] {
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

function parseAiScore(raw?: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const preferred = typeof parsed.overall_score === 'number'
      ? parsed.overall_score
      : typeof parsed.score === 'number'
        ? parsed.score
        : null
    return typeof preferred === 'number' && Number.isFinite(preferred) ? preferred : null
  } catch {
    return null
  }
}

function parseUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

// 审校模型偶尔把“无问题”结论写进风险数组（如“无擅自新增设定…不构成幻觉风险”“标题未提供，无法评估”），
// 这类非风险陈述不应参与 blocker 判定
function dropNonRiskStatements(items: string[]): string[] {
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

interface ReviewStateSnapshot {
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
}

function parseReviewState(raw?: string | null): {
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
} {
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
    }
  } catch {
    return fallback
  }
}

function mergeReasons(raw: string | null | undefined, reasons: string[]): string {
  return stringifyStringArray([...parseStringArray(raw), ...reasons])
}

type ContractAuditStatus = 'pass' | 'warning' | 'blocker'
type ChapterGateLevel = 'pass' | 'warning' | 'blocker' | 'rewrite'
type ChapterGateScoreBand = 'stable' | 'attention' | 'risky' | 'unstable'
type ChapterPublishCheckSource = 'chapter' | 'scene' | 'contract' | 'review' | 'thread' | 'volume'
type ChapterPublishRelatedPage = 'writing' | 'structure' | 'contracts' | 'revision' | 'volume-design' | 'threads'

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

interface ChapterContractAuditSceneSnapshot {
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

interface ChapterContractAuditContext {
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

function normalizeText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeContractStatus(value?: string | null): string {
  return normalizeText(value) || 'draft'
}

function isExecutableContractStatus(value?: string | null): boolean {
  const status = normalizeContractStatus(value)
  return status === 'ready' || status === 'locked'
}

function getContractStatusLabel(value?: string | null): string {
  const status = normalizeContractStatus(value)
  if (status === 'ready') return '可执行'
  if (status === 'locked') return '锁定'
  if (status === 'draft') return '草稿'
  return status
}

function getSceneSnapshotLabel(scene: ChapterContractAuditSceneSnapshot): string {
  if (scene.segmentTitle) return scene.segmentTitle
  if (typeof scene.segmentOrder === 'number') return `场景 ${scene.segmentOrder}`
  if (typeof scene.segmentId === 'number') return `场景 #${scene.segmentId}`
  return '未命名场景'
}

function makeContractAuditItem(
  item: Omit<ContractAuditItem, 'source'> & { source?: 'chapter' | 'scene' },
): ContractAuditItem {
  return {
    source: item.source || 'chapter',
    ...item,
  }
}

function buildContractAuditSummary(items: ContractAuditItem[]): Pick<ChapterContractAudit, 'summary' | 'blockerCount' | 'warningCount' | 'passCount'> {
  const blockerCount = items.filter((item) => item.status === 'blocker').length
  const warningCount = items.filter((item) => item.status === 'warning').length
  const passCount = items.filter((item) => item.status === 'pass').length
  const summary = blockerCount > 0
    ? `合同对账命中 ${blockerCount} 项阻塞，${warningCount} 项预警。`
    : warningCount > 0
      ? `合同对账已通过，但仍有 ${warningCount} 项预警。`
      : `合同对账已通过，共核对 ${items.length} 项。`
  return {
    summary,
    blockerCount,
    warningCount,
    passCount,
  }
}

function loadChapterContractAuditContext(chapterId: number): ChapterContractAuditContext {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const chapterContractRow = db.select().from(chapterContracts).where(eq(chapterContracts.chapterId, chapterId)).all()[0] || null
  const segmentRows = db.select().from(chapterSegments)
    .where(eq(chapterSegments.chapterId, chapterId))
    .orderBy(asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
    .all()
  const sceneRows = db.select().from(sceneContracts)
    .where(eq(sceneContracts.chapterId, chapterId))
    .orderBy(asc(sceneContracts.segmentId), asc(sceneContracts.id))
    .all()
  const sceneContractBySegmentId = new Map<number, typeof sceneContracts.$inferSelect>()
  sceneRows.forEach((row) => {
    if (typeof row.segmentId === 'number' && !sceneContractBySegmentId.has(row.segmentId)) {
      sceneContractBySegmentId.set(row.segmentId, row)
    }
  })

  const sceneSnapshots: ChapterContractAuditSceneSnapshot[] = [
    ...segmentRows.map((segment) => {
      const contract = sceneContractBySegmentId.get(segment.id) || null
      return {
        segmentId: segment.id,
        segmentOrder: segment.segmentOrder,
        segmentTitle: normalizeText(segment.title) || `场景 ${segment.segmentOrder}`,
        status: normalizeContractStatus(contract?.status),
        pov: normalizeText(contract?.pov),
        emotionShift: normalizeText(contract?.emotionShift),
        timeLocation: normalizeText(contract?.timeLocation),
        sceneGoal: normalizeText(contract?.sceneGoal) || normalizeText(segment.purpose),
        obstacle: normalizeText(contract?.obstacle),
        resultState: normalizeText(contract?.resultState) || normalizeText(segment.outputState),
        segmentPurpose: normalizeText(segment.purpose),
        segmentTimeAnchor: normalizeText(segment.timeAnchor),
        segmentLocationName: normalizeText(segment.locationName),
        segmentInputState: normalizeText(segment.inputState),
        segmentOutputState: normalizeText(segment.outputState),
        hasSegmentBinding: true,
      }
    }),
    ...sceneRows
      .filter((row) => row.segmentId == null || !segmentRows.some((segment) => segment.id === row.segmentId))
      .map((row) => ({
        segmentId: row.segmentId ?? undefined,
        segmentOrder: undefined,
        segmentTitle: `场景合同 ${row.id}`,
        status: normalizeContractStatus(row.status),
        pov: normalizeText(row.pov),
        emotionShift: normalizeText(row.emotionShift),
        timeLocation: normalizeText(row.timeLocation),
        sceneGoal: normalizeText(row.sceneGoal),
        obstacle: normalizeText(row.obstacle),
        resultState: normalizeText(row.resultState),
        segmentPurpose: '',
        segmentTimeAnchor: '',
        segmentLocationName: '',
        segmentInputState: '',
        segmentOutputState: '',
        hasSegmentBinding: false,
      })),
  ]

  const requiredCharacterArcIds = parseNumberArray(chapterContractRow?.requiredCharacterArcIdsJson)
  const requiredRelationshipArcIds = parseNumberArray(chapterContractRow?.requiredRelationshipArcIdsJson)
  const requiredResistanceTrackIds = parseNumberArray(chapterContractRow?.requiredResistanceTrackIdsJson)
  const servedThreadIds = parseNumberArray(chapterContractRow?.servedThreadIdsJson)
  const requiredArcProgress = parseStringArray(chapterContractRow?.requiredArcProgressJson)
  const requiredEndgameCommitmentIds = parseNumberArray(chapterContractRow?.requiredEndgameCommitmentIdsJson)
  const requiredForeshadowIds = parseNumberArray(chapterContractRow?.requiredForeshadowIdsJson)

  const characterArcRows = requiredCharacterArcIds.length > 0
    ? db.select().from(characterArcs).where(eq(characterArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredCharacterArcIds.includes(row.id))
    : []
  const characterBeatRows = requiredCharacterArcIds.length > 0
    ? db.select().from(characterArcBeats).where(eq(characterArcBeats.chapterId, chapterId)).all()
      .filter((row) => requiredCharacterArcIds.includes(row.arcId))
    : []
  const relationshipArcRows = requiredRelationshipArcIds.length > 0
    ? db.select().from(relationshipArcs).where(eq(relationshipArcs.novelId, chapter.novelId)).all()
      .filter((row) => requiredRelationshipArcIds.includes(row.id))
    : []
  const needsCharacterRows = characterArcRows.length > 0 || relationshipArcRows.length > 0
  const characterRows = needsCharacterRows
    ? db.select().from(characters).where(eq(characters.novelId, chapter.novelId)).all()
    : []
  const resistanceTrackRows = requiredResistanceTrackIds.length > 0
    ? db.select().from(resistanceTracks).where(eq(resistanceTracks.novelId, chapter.novelId)).all()
      .filter((row) => requiredResistanceTrackIds.includes(row.id))
    : []
  const resistanceBeatRows = requiredResistanceTrackIds.length > 0
    ? db.select().from(resistanceBeats).where(eq(resistanceBeats.chapterId, chapterId)).all()
      .filter((row) => requiredResistanceTrackIds.includes(row.trackId))
    : []
  const foreshadowRows = requiredForeshadowIds.length > 0
    ? db.select().from(foreshadowLedger).where(eq(foreshadowLedger.novelId, chapter.novelId)).all()
      .filter((row) => requiredForeshadowIds.includes(row.id))
    : []

  return {
    chapter,
    chapterContractRow,
    chapterContract: {
      chapterGoal: normalizeText(chapterContractRow?.chapterGoal),
      openingStyle: normalizeText(chapterContractRow?.openingStyle),
      endingStyle: normalizeText(chapterContractRow?.endingStyle),
      expositionMode: normalizeText(chapterContractRow?.expositionMode),
      emotionFocus: normalizeText(chapterContractRow?.emotionFocus),
      servedThreadIds,
      requiredArcProgress,
      requiredCharacterArcIds,
      requiredRelationshipArcIds,
      requiredResistanceTrackIds,
      requiredEndgameCommitmentIds,
      requiredForeshadowIds,
      hookType: normalizeText(chapterContractRow?.hookType),
      acceptanceNotes: parseStringArray(chapterContractRow?.acceptanceNotesJson),
      status: normalizeContractStatus(chapterContractRow?.status),
    },
    sceneSnapshots,
    characterRows,
    characterArcRows,
    characterBeatRows,
    relationshipArcRows,
    resistanceTrackRows,
    resistanceBeatRows,
    foreshadowRows,
  }
}

export function validateChapterContractsForGeneration(chapterId: number): void {
  const context = loadChapterContractAuditContext(chapterId)
  const blockers: string[] = []

  if (!context.chapterContractRow) {
    blockers.push('当前章节还没有章节合同。')
  } else {
    if (!isExecutableContractStatus(context.chapterContract.status)) {
      blockers.push(`章节合同状态仍是${getContractStatusLabel(context.chapterContract.status)}。`)
    }
    if (!context.chapterContract.chapterGoal) {
      blockers.push('章节合同缺少“本章目标”。')
    }
  }

  context.sceneSnapshots.forEach((scene) => {
    if (!isExecutableContractStatus(scene.status)) {
      blockers.push(`${getSceneSnapshotLabel(scene)} 的场景合同状态仍是${getContractStatusLabel(scene.status)}。`)
    }
    const missingFields = [
      !scene.pov ? 'POV' : '',
      !scene.sceneGoal ? '场景目标' : '',
      !scene.obstacle ? '障碍' : '',
      !scene.resultState ? '结果状态' : '',
    ].filter(Boolean)
    if (missingFields.length > 0) {
      blockers.push(`${getSceneSnapshotLabel(scene)} 缺少${missingFields.join('、')}。`)
    }
  })

  if (blockers.length > 0) {
    throw new Error(`章节流水线启动前合同校验未通过：${blockers.join('；')}`)
  }
}

function buildChapterContractAudit(chapterId: number): ChapterContractAudit {
  const context = loadChapterContractAuditContext(chapterId)
  const items: ContractAuditItem[] = []
  const checkedAt = new Date().toISOString()

  if (!context.chapterContractRow) {
    items.push(makeContractAuditItem({
      key: 'chapter_contract_exists',
      label: '章节合同',
      status: 'blocker',
      detail: '当前章节还没有独立章节合同。',
    }))
  } else {
    items.push(makeContractAuditItem({
      key: 'chapter_contract_status',
      label: '章节合同状态',
      status: isExecutableContractStatus(context.chapterContract.status) ? 'pass' : 'blocker',
      detail: isExecutableContractStatus(context.chapterContract.status)
        ? `章节合同已进入${getContractStatusLabel(context.chapterContract.status)}状态。`
        : `章节合同当前仍是${getContractStatusLabel(context.chapterContract.status)}，发布前应切到“可执行”或“锁定”。`,
    }))
  }

  items.push(makeContractAuditItem({
    key: 'chapter_contract_goal',
    label: '本章目标',
    status: context.chapterContract.chapterGoal ? 'pass' : 'blocker',
    detail: context.chapterContract.chapterGoal
      ? `已写明本章目标：${context.chapterContract.chapterGoal}`
      : '章节合同缺少“本章目标”，当前无法核对本章是否完成核心承诺。',
  }))

  items.push(makeContractAuditItem({
    key: 'chapter_contract_hook',
    label: '结尾钩子',
    status: context.chapterContract.hookType ? 'pass' : 'warning',
    detail: context.chapterContract.hookType
      ? `已定义结尾钩子：${context.chapterContract.hookType}`
      : '章节合同还没有填写结尾钩子类型，写后难以核对本章留钩是否兑现。',
  }))

  items.push(makeContractAuditItem({
    key: 'chapter_contract_acceptance',
    label: '章节验收要求',
    status: context.chapterContract.acceptanceNotes.length > 0 ? 'pass' : 'warning',
    detail: context.chapterContract.acceptanceNotes.length > 0
      ? `已登记 ${context.chapterContract.acceptanceNotes.length} 条章节验收要求。`
      : '章节合同还没有填写验收要求，当前只能核对结构化推进，无法核对人工验收口径。',
  }))

  const characterNameById = new Map(context.characterRows.map((row) => [row.id, normalizeText(row.fullName) || `角色#${row.id}`]))
  const characterArcById = new Map(context.characterArcRows.map((row) => [row.id, row]))
  const characterBeatArcIds = new Set(context.characterBeatRows.map((row) => row.arcId))
  context.chapterContract.requiredCharacterArcIds.forEach((arcId) => {
    const arc = characterArcById.get(arcId)
    const arcLabel = arc ? (characterNameById.get(arc.characterId) || `角色#${arc.characterId}`) : `#${arcId}`
    items.push(makeContractAuditItem({
      key: `character_arc_${arcId}`,
      label: `人物弧推进 · ${arcLabel}`,
      status: !arc
        ? 'blocker'
        : arc.lastProgressChapterId === context.chapter.id || characterBeatArcIds.has(arcId)
          ? 'pass'
          : 'blocker',
      detail: !arc
        ? '合同绑定的人物弧已不存在，需要回到人物弧线中心或章节合同重新绑定。'
        : arc.lastProgressChapterId === context.chapter.id || characterBeatArcIds.has(arcId)
          ? `本章已登记“${arcLabel}”的人物弧推进。`
          : `合同要求本章推进“${arcLabel}”的人物弧，但还没有本章推进记录。`,
    }))
  })

  const relationshipArcById = new Map(context.relationshipArcRows.map((row) => [row.id, row]))
  context.chapterContract.requiredRelationshipArcIds.forEach((arcId) => {
    const arc = relationshipArcById.get(arcId)
    const label = arc
      ? `${characterNameById.get(arc.charAId) || `角色#${arc.charAId}`} × ${characterNameById.get(arc.charBId) || `角色#${arc.charBId}`}`
      : `#${arcId}`
    items.push(makeContractAuditItem({
      key: `relationship_arc_${arcId}`,
      label: `关系弧推进 · ${label}`,
      status: !arc
        ? 'blocker'
        : arc.lastProgressChapterId === context.chapter.id
          ? 'pass'
          : 'blocker',
      detail: !arc
        ? '合同绑定的关系弧已不存在，需要回到人物弧线中心或章节合同重新绑定。'
        : arc.lastProgressChapterId === context.chapter.id
          ? `本章已登记关系弧“${label}”的推进。`
          : `合同要求本章推进关系弧“${label}”，但还没有本章推进记录。`,
    }))
  })

  const resistanceTrackById = new Map(context.resistanceTrackRows.map((row) => [row.id, row]))
  const resistanceBeatTrackIds = new Set(context.resistanceBeatRows.map((row) => row.trackId))
  context.chapterContract.requiredResistanceTrackIds.forEach((trackId) => {
    const track = resistanceTrackById.get(trackId)
    items.push(makeContractAuditItem({
      key: `resistance_track_${trackId}`,
      label: `阻力线出手 · ${normalizeText(track?.title) || `#${trackId}`}`,
      status: !track
        ? 'blocker'
        : track.lastActionChapterId === context.chapter.id || resistanceBeatTrackIds.has(trackId)
          ? 'pass'
          : 'blocker',
      detail: !track
        ? '合同绑定的阻力线已不存在，需要回到阻力系统或章节合同重新绑定。'
        : track.lastActionChapterId === context.chapter.id || resistanceBeatTrackIds.has(trackId)
          ? `本章已登记阻力线“${normalizeText(track.title) || '未命名阻力线'}”的出手记录。`
          : `合同要求本章让阻力线“${normalizeText(track.title) || '未命名阻力线'}”出手，但还没有本章出手记录。`,
    }))
  })

  const foreshadowById = new Map(context.foreshadowRows.map((row) => [row.id, row]))
  context.chapterContract.requiredForeshadowIds.forEach((entryId) => {
    const entry = foreshadowById.get(entryId)
    const normalizedStatus = normalizeContractStatus(entry?.status)
    const plantedHere = entry?.sourceChapterId === context.chapter.id
    const resolved = normalizedStatus === 'resolved' || normalizedStatus === 'archived'
    items.push(makeContractAuditItem({
      key: `foreshadow_${entryId}`,
      label: `伏笔账本 · ${normalizeText(entry?.title) || `#${entryId}`}`,
      status: !entry
        ? 'blocker'
        : plantedHere || resolved
          ? 'pass'
          : 'blocker',
      detail: !entry
        ? '合同绑定的伏笔账本条目已不存在，需要回到伏笔账本或章节合同重新绑定。'
        : plantedHere
          ? '该伏笔已登记为本章埋设。'
          : resolved
            ? `该伏笔当前状态为“${normalizedStatus === 'resolved' ? '已回收' : '已归档'}”，已形成处理痕迹。`
            : '合同要求本章处理该伏笔，但当前账本里还没有识别到“本章埋设”或“已回收/已归档”痕迹。',
    }))
  })

  if (context.sceneSnapshots.length === 0) {
    items.push(makeContractAuditItem({
      key: 'scene_contracts_not_applicable',
      label: '场景合同对账',
      status: 'pass',
      detail: '当前章节未拆场景，本次不适用场景合同对账。',
    }))
  } else {
    context.sceneSnapshots.forEach((scene, index) => {
      const sceneLabel = getSceneSnapshotLabel(scene)
      const sceneKey = scene.segmentId ?? index
      const missingFields = [
        !scene.pov ? 'POV' : '',
        !scene.sceneGoal ? '场景目标' : '',
        !scene.obstacle ? '障碍' : '',
        !scene.resultState ? '结果状态' : '',
      ].filter(Boolean)
      const mappingGaps = [
        !(scene.timeLocation || scene.segmentTimeAnchor || scene.segmentLocationName) ? '时间地点映射' : '',
        !(scene.sceneGoal || scene.segmentPurpose) ? '目标映射' : '',
        !(scene.resultState || scene.segmentOutputState) ? '结果状态映射' : '',
      ].filter(Boolean)

      items.push(makeContractAuditItem({
        key: `scene_status_${sceneKey}`,
        label: `场景合同状态 · ${sceneLabel}`,
        status: isExecutableContractStatus(scene.status) ? 'pass' : 'blocker',
        detail: isExecutableContractStatus(scene.status)
          ? `场景合同已进入${getContractStatusLabel(scene.status)}状态。`
          : `当前场景合同仍是${getContractStatusLabel(scene.status)}，发布前应切到“可执行”或“锁定”。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))

      items.push(makeContractAuditItem({
        key: `scene_fields_${sceneKey}`,
        label: `场景字段完整性 · ${sceneLabel}`,
        status: missingFields.length === 0 ? 'pass' : 'blocker',
        detail: missingFields.length === 0
          ? 'POV、场景目标、障碍和结果状态都已齐备。'
          : `当前场景还缺少：${missingFields.join('、')}。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))

      items.push(makeContractAuditItem({
        key: `scene_mapping_${sceneKey}`,
        label: `结构映射 · ${sceneLabel}`,
        status: !scene.hasSegmentBinding
          ? 'warning'
          : mappingGaps.length === 0
            ? 'pass'
            : 'warning',
        detail: !scene.hasSegmentBinding
          ? '该场景合同还没有绑定结构场景，后续很难从结构页追溯到正文场景。'
          : mappingGaps.length === 0
            ? '场景合同与结构字段已形成可追溯映射。'
            : `结构字段仍缺少：${mappingGaps.join('、')}。`,
        source: 'scene',
        segmentId: scene.segmentId,
        segmentTitle: sceneLabel,
      }))
    })
  }

  const summary = buildContractAuditSummary(items)
  return {
    checkedAt,
    summary: summary.summary,
    blockerCount: summary.blockerCount,
    warningCount: summary.warningCount,
    passCount: summary.passCount,
    items,
  }
}

interface ScenePlanSnapshot {
  sceneTitle: string
  exitHook: string
}

interface ChapterGateTaskDraft {
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

const CHAPTER_GATE_NON_REWRITEABLE_KEYS = new Set([
  'content',
  'summary',
  'continuity',
  'context',
  'scene_plan',
  'outline',
  'medium_issues',
  'hook_strength',
  'story_dynamics',
  'recall',
])

function makePublishCheckItem(
  item: Omit<ChapterPublishCheckItem, 'source'> & { source?: ChapterPublishCheckSource },
): ChapterPublishCheckItem {
  return {
    source: item.source || 'chapter',
    ...item,
  }
}

function parseScenePlanSnapshots(raw?: string | null): ScenePlanSnapshot[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        sceneTitle: normalizeText((item.scene_title ?? item.sceneTitle) as string | undefined),
        exitHook: normalizeText((item.exit_hook ?? item.exitHook) as string | undefined),
      }))
      .filter((item) => item.sceneTitle || item.exitHook)
  } catch {
    return []
  }
}

function normalizeTaskStatus(value: unknown): 'open' | 'in_progress' | 'resolved' | 'ignored' {
  const status = normalizeText(typeof value === 'string' ? value : '')
  if (status === 'in_progress' || status === 'resolved' || status === 'ignored') return status
  return 'open'
}

function parseOriginMetaJson(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function serializeOriginMetaJson(meta: Record<string, unknown>): string {
  return JSON.stringify(meta)
}

function gateScoreForStatus(status: ChapterGateLevel | ContractAuditStatus): number {
  if (status === 'pass') return 100
  if (status === 'warning') return 70
  if (status === 'blocker') return 30
  return 0
}

function getChecklistCount(items: ChapterPublishCheckItem[], status: ChapterGateLevel): number {
  return items.filter((item) => item.status === status).length
}

type ContractValidationItemSnapshot = ChapterContractValidationResult['itemResults'][number]

function isContractValidationBlockingVerdict(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationBlockerVerdictValue(item.verdict)
}

function isContractValidationWarningVerdict(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationWarningVerdictValue(item.verdict)
}

function isContractValidationIssue(item: ContractValidationItemSnapshot): boolean {
  return isContractValidationBlockingVerdict(item) || isContractValidationWarningVerdict(item)
}

function isSoftContractValidationItem(item: ContractValidationItemSnapshot): boolean {
  return !isHardContractValidationItem(item)
}

function contractValidationItemIssueLine(item: ContractValidationItemSnapshot): string {
  return normalizeText(item.rewriteHint)
    || normalizeText(item.semanticReason)
    || normalizeText(item.evidenceExcerpt)
    || normalizeText(item.expected)
}

function getContractValidationIssuesByType(
  contractValidation: ChapterContractValidationResult | null | undefined,
  contractItemType: string,
): string[] {
  return dedupeTextList((contractValidation?.itemResults || [])
    .filter((item) => item.contractItemType === contractItemType && isContractValidationIssue(item))
    .map(contractValidationItemIssueLine))
}

function buildHardContractValidationResult(
  result: ChapterContractValidationResult | null,
): ChapterContractValidationResult | null {
  if (!result) return null
  const hardItems = result.itemResults.filter((item) => !isSoftContractValidationItem(item))
  const hardBlockerCount = hardItems.filter(isContractValidationBlockingVerdict).length
  const hardWarningCount = hardItems.filter(isContractValidationWarningVerdict).length
  const status = deriveChapterContractValidationStatus(hardItems)
  const softIssueCount = result.itemResults
    .filter((item) => isSoftContractValidationItem(item) && isContractValidationIssue(item))
    .length
  const summary = status === 'blocker'
    ? `正文合同硬性验证命中 ${hardBlockerCount} 项阻塞，${hardWarningCount} 项预警。`
    : status === 'warning'
      ? `正文合同硬性验证仍有 ${hardWarningCount} 项预警。`
      : softIssueCount > 0
        ? `正文合同硬性验证已通过；标题贴合与黄金三章开篇由专项门禁处理。`
        : result.summary

  return {
    ...result,
    status,
    summary,
    itemResults: hardItems,
    rewriteHints: hardItems
      .filter(isContractValidationIssue)
      .map((item) => item.rewriteHint)
      .filter(Boolean),
  }
}

function getPublishContractValidationScore(
  result: ChapterContractValidationResult | null | undefined,
): number | null {
  if (!result) return null
  const hardItems = result.itemResults.filter((item) => !isSoftContractValidationItem(item))
  if (hardItems.length === 0) return null
  return getContractValidationScore({
    ...result,
    itemResults: hardItems,
  })
}

function buildChapterGateSummary(
  gateLevel: ChapterGateLevel,
  rewriteCount: number,
  blockerCount: number,
  warningCount: number,
): string {
  if (gateLevel === 'rewrite') {
    return `章节验收要求退回重写，命中 ${rewriteCount} 项重写、${blockerCount} 项阻塞、${warningCount} 项预警。`
  }
  if (gateLevel === 'blocker') {
    return `章节验收未通过，命中 ${blockerCount} 项阻塞、${warningCount} 项预警。`
  }
  if (gateLevel === 'warning') {
    return `章节验收可进入人工复核，但仍有 ${warningCount} 项预警。`
  }
  return '章节验收通过。'
}

interface PublishCheckScoreContext {
  contractAudit: ChapterContractAudit
  contractValidation?: ChapterContractValidationResult | null
  checklist: ChapterPublishCheckItem[]
  reviewState: ReturnType<typeof parseReviewState>
  aiScore: number | null
  highIssues: ConsistencyIssue[]
  mediumIssues: ConsistencyIssue[]
  staleReasons: string[]
  recallStaleCount: number
  sceneHookCount: number
  weakFunction: boolean
  blockerCount: number
  warningCount: number
  rewriteCount: number
}

function averageScores(values: number[], fallback = 70): number {
  if (values.length === 0) return fallback
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function scoreChecklistItem(
  checklist: ChapterPublishCheckItem[],
  key: string,
  fallback: ChapterGateLevel | ContractAuditStatus = 'warning',
): number {
  return gateScoreForStatus(checklist.find((item) => item.key === key)?.status || fallback)
}

function clampGateScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function reduceGateScore(base: number, penalties: number[]): number {
  return clampGateScore(base - penalties.reduce((sum, penalty) => sum + penalty, 0))
}

function calculateContractAuditScore(contractAudit: ChapterContractAudit): number {
  const contractTotal = Math.max(contractAudit.items.length, 1)
  let contractScore = Math.round(contractAudit.items.reduce((sum, item) => sum + gateScoreForStatus(item.status), 0) / contractTotal)
  if (contractAudit.blockerCount > 0) {
    contractScore = Math.min(contractScore, 59)
  } else if (contractAudit.warningCount > 0) {
    contractScore = Math.min(contractScore, 79)
  }
  return contractScore
}

function buildPublishCheckScoreBreakdown(
  context: PublishCheckScoreContext,
): ChapterPublishCheckScoreBreakdown {
  const {
    contractAudit,
    contractValidation,
    checklist,
    reviewState,
    aiScore,
    highIssues,
    mediumIssues,
    staleReasons,
    recallStaleCount,
    sceneHookCount,
    weakFunction,
    blockerCount,
    warningCount,
    rewriteCount,
  } = context
  const auditContractScore = calculateContractAuditScore(contractAudit)
  const validationContractScore = getPublishContractValidationScore(contractValidation)
  let contractScore = validationContractScore == null
    ? auditContractScore
    : Math.round((auditContractScore + validationContractScore) / 2)
  if (contractValidation?.status === 'blocker') {
    contractScore = Math.min(contractScore, 49)
  } else if (contractAudit.blockerCount > 0) {
    contractScore = Math.min(contractScore, 59)
  } else if (contractValidation?.status === 'warning') {
    contractScore = Math.min(contractScore, 79)
  } else if (contractAudit.warningCount > 0) {
    contractScore = Math.min(contractScore, 79)
  }
  const hookScore = scoreChecklistItem(checklist, 'hook_strength')
  const povPurityScore = scoreChecklistItem(checklist, 'pov_purity')
  const povBoundaryScore = scoreChecklistItem(checklist, 'pov_boundary')
  const sensoryCoverageScore = scoreChecklistItem(checklist, 'sensory_coverage')
  const narrativeRatioScore = scoreChecklistItem(checklist, 'narrative_ratio')
  const threadStatuses = checklist
    .filter((item) => item.key === 'thread_progress' || item.key === 'line_progress')
    .map((item) => gateScoreForStatus(item.status))
  const threadProgressScore = threadStatuses.length > 0
    ? Math.round(threadStatuses.reduce((sum, item) => sum + item, 0) / threadStatuses.length)
    : 70
  const volumeAlignmentScore = scoreChecklistItem(checklist, 'volume_alignment')

  const continuityScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'context'),
      scoreChecklistItem(checklist, 'continuity'),
      scoreChecklistItem(checklist, 'consistency'),
      contractScore,
      threadProgressScore,
    ]),
    [
      Math.min(staleReasons.length, 2) * 12,
      Math.min(reviewState.continuityRisks.length, 3) * 9,
      Math.min(reviewState.contextDriftRisks.length, 2) * 10,
      Math.min(recallStaleCount, 3) * 6,
      Math.min(highIssues.length, 2) * 8,
      Math.min(mediumIssues.length, 3) * 4,
    ],
  )

  const coherenceScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'summary'),
      scoreChecklistItem(checklist, 'scene_plan'),
      scoreChecklistItem(checklist, 'outline'),
      scoreChecklistItem(checklist, 'consistency'),
      contractScore,
      povPurityScore,
      povBoundaryScore,
      sensoryCoverageScore,
    ]),
    [
      Math.min(reviewState.coherenceRisks.length, 3) * 8,
      Math.min(reviewState.realismRisks.length, 2) * 7,
      Math.min(reviewState.criticalFixes.length, 3) * 5,
      Math.min(mediumIssues.length, 3) * 3,
    ],
  )

  const dialogueVoiceScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'dialogue_voice'),
      scoreChecklistItem(checklist, 'review'),
      typeof aiScore === 'number' ? clampGateScore(aiScore) : 72,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.dialogueHomogenizationRisks.length, 3) * 9,
      Math.min(reviewState.dialogueDriftAlerts.length, 2) * 11,
      Math.min(reviewState.crossCharacterSimilarity.length, 2) * 10,
      Math.min(reviewState.humanLanguageRepairs.length, 2) * 4,
    ],
  )

  const hookStrengthScore = reduceGateScore(
    averageScores([
      hookScore,
      scoreChecklistItem(checklist, 'line_progress'),
      scoreChecklistItem(checklist, 'story_dynamics'),
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.readerHookRisks.length, 3) * 10,
      sceneHookCount === 0 ? 8 : 0,
      weakFunction ? 6 : 0,
    ],
  )

  const storyDynamicsScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'story_dynamics'),
      scoreChecklistItem(checklist, 'line_progress'),
      threadProgressScore,
      volumeAlignmentScore,
      contractScore,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.arcProgressRisks.length, 3) * 9,
      Math.min(reviewState.missingPayoffs.length, 2) * 12,
      reviewState.costEvaporation ? 14 : 0,
      reviewState.forcedReversal ? 14 : 0,
      reviewState.tooSmooth ? 10 : 0,
      reviewState.highPressureNoReward ? 10 : 0,
    ],
  )

  const languageNaturalnessScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'review'),
      scoreChecklistItem(checklist, 'ai_score'),
      typeof aiScore === 'number' ? clampGateScore(aiScore) : 72,
      dialogueVoiceScore,
      povBoundaryScore,
      sensoryCoverageScore,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.languageRisks.length, 3) * 9,
      Math.min(reviewState.humanLanguageRepairs.length, 3) * 7,
      Math.min(reviewState.genreHollowingRisks.length, 2) * 8,
      Math.min(reviewState.coherenceRisks.length, 2) * 4,
    ],
  )

  const styleComplianceBaseScore = reviewState.styleComplianceChecked
    ? scoreChecklistItem(checklist, 'style_compliance')
    : 72
  let styleComplianceScore = reviewState.styleComplianceChecked
    ? reduceGateScore(
      averageScores([
        styleComplianceBaseScore,
        languageNaturalnessScore,
        dialogueVoiceScore,
        povBoundaryScore,
        narrativeRatioScore,
      ]),
      [
        Math.min(reviewState.styleComplianceDeviations.length, 3) * 8,
        Math.min(reviewState.styleComplianceForbiddenPatterns.length, 2) * 12,
      ],
    )
    : averageScores([languageNaturalnessScore, dialogueVoiceScore, povBoundaryScore], 72)
  if (reviewState.styleComplianceStatus === 'rewrite') {
    styleComplianceScore = Math.min(styleComplianceScore, 49)
  } else if (reviewState.styleComplianceStatus === 'warning') {
    styleComplianceScore = Math.min(styleComplianceScore, 79)
  }

  let totalScore = clampGateScore(
    continuityScore * 0.18
    + coherenceScore * 0.14
    + dialogueVoiceScore * 0.11
    + hookStrengthScore * 0.09
    + storyDynamicsScore * 0.14
    + languageNaturalnessScore * 0.11
    + styleComplianceScore * 0.10
    + povBoundaryScore * 0.06
    + sensoryCoverageScore * 0.04
    + narrativeRatioScore * 0.03,
  )

  if (rewriteCount > 0) {
    totalScore = Math.min(totalScore, 39)
  } else if (blockerCount > 0) {
    totalScore = Math.min(totalScore, 59)
  } else if (warningCount > 0) {
    totalScore = Math.min(totalScore, 79)
  }

  return normalizeChapterGateScoreBreakdown({
    totalScore,
    continuityScore,
    coherenceScore,
    dialogueVoiceScore,
    hookStrengthScore,
    storyDynamicsScore,
    languageNaturalnessScore,
    styleComplianceScore,
    povBoundaryScore,
    sensoryCoverageScore,
    narrativeRatioScore,
    contractScore,
    hookScore,
    povPurityScore,
    threadProgressScore,
    volumeAlignmentScore,
  })
}

function sortChapterGateHistory(left: ChapterGateHistoryEntry, right: ChapterGateHistoryEntry): number {
  const leftTime = Date.parse(left.createdAt || '')
  const rightTime = Date.parse(right.createdAt || '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return right.id - left.id
}

function buildChapterGateTopIssueKeys(
  checklist: ChapterPublishCheckItem[],
  contractAudit: ChapterContractAudit,
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const issueKeys = [
    ...checklist.filter((item) => item.status === 'rewrite').map((item) => item.key),
    ...checklist.filter((item) => item.status === 'blocker').map((item) => item.key),
    ...contractAudit.items.filter((item) => item.status === 'blocker').map((item) => `contract:${item.key}`),
    ...(contractValidation?.itemResults || [])
      .filter((item) => item.verdict === 'missing' || item.verdict === 'contradicted')
      .map((item) => `contract_delivery:${item.contractItemType}:${item.contractItemId || item.segmentId || item.expected}`),
    ...checklist.filter((item) => item.status === 'warning').map((item) => item.key),
    ...contractAudit.items.filter((item) => item.status === 'warning').map((item) => `contract:${item.key}`),
    ...(contractValidation?.itemResults || [])
      .filter((item) => item.verdict === 'weak' || item.verdict === 'overdelivered')
      .map((item) => `contract_delivery:${item.contractItemType}:${item.contractItemId || item.segmentId || item.expected}`),
  ]
  return [...new Set(issueKeys)].slice(0, 8)
}

function mapChapterGateRunRow(row: typeof chapterGateRuns.$inferSelect): ChapterGateHistoryEntry {
  return {
    id: row.id,
    novelId: row.novelId,
    chapterId: row.chapterId,
    chapterNum: row.chapterNum || 0,
    gateLevel: (normalizeText(row.gateLevel) || 'warning') as ChapterGateLevel,
    ready: row.ready === 1,
    summary: row.summary || '',
    rewriteCount: row.rewriteCount || 0,
    blockerCount: row.blockerCount || 0,
    warningCount: row.warningCount || 0,
    generatedTaskCount: row.generatedTaskCount || 0,
    topIssueKeys: safeParseStringArray(row.topIssueKeysJson),
    scoreBreakdown: safeParseChapterGateScoreBreakdown(row.scoreBreakdownJson) || normalizeChapterGateScoreBreakdown(),
    createdAt: row.createdAt || new Date(0).toISOString(),
  }
}

export function listChapterGateHistory(
  novelId: number,
  options: { chapterId?: number; limit?: number } = {},
): ChapterGateHistoryEntry[] {
  const db = getDb()
  const rows = db.select().from(chapterGateRuns)
    .where(eq(chapterGateRuns.novelId, novelId))
    .all()
    .filter((row) => options.chapterId == null || row.chapterId === options.chapterId)
    .map(mapChapterGateRunRow)
    .sort(sortChapterGateHistory)

  return typeof options.limit === 'number' ? rows.slice(0, options.limit) : rows
}

function persistChapterGateRun(params: {
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
  scoreBreakdown: ChapterPublishCheckScoreBreakdown
  topIssueKeys: string[]
}): { history: ChapterGateHistoryEntry[]; drift?: ChapterGateDriftSummary } {
  const db = getDb()
  const latestHistory = listChapterGateHistory(params.novelId, { chapterId: params.chapterId, limit: 6 })
  const latest = latestHistory[0]
  const snapshot: ChapterGateHistoryEntry = {
    id: 0,
    novelId: params.novelId,
    chapterId: params.chapterId,
    chapterNum: params.chapterNum,
    gateLevel: params.gateLevel,
    ready: params.ready,
    summary: params.summary,
    rewriteCount: params.rewriteCount,
    blockerCount: params.blockerCount,
    warningCount: params.warningCount,
    generatedTaskCount: params.generatedTaskCount,
    topIssueKeys: [...params.topIssueKeys],
    scoreBreakdown: normalizeChapterGateScoreBreakdown(params.scoreBreakdown),
    createdAt: new Date().toISOString(),
  }

  if (latest && compareChapterGateSnapshots(snapshot as ChapterGateHistoryEntry, latest)) {
    return {
      history: latestHistory,
      drift: latestHistory.length > 1 ? buildChapterGateDriftSummary(latestHistory[0], latestHistory[1]) : undefined,
    }
  }

  const createdAt = new Date().toISOString()
  const result = db.insert(chapterGateRuns).values({
    novelId: params.novelId,
    chapterId: params.chapterId,
    chapterNum: params.chapterNum,
    gateLevel: params.gateLevel,
    ready: params.ready ? 1 : 0,
    summary: params.summary,
    rewriteCount: params.rewriteCount,
    blockerCount: params.blockerCount,
    warningCount: params.warningCount,
    scoreBreakdownJson: JSON.stringify(normalizeChapterGateScoreBreakdown(params.scoreBreakdown)),
    topIssueKeysJson: JSON.stringify(params.topIssueKeys),
    generatedTaskCount: params.generatedTaskCount,
    createdAt,
  }).run()

  const currentEntry: ChapterGateHistoryEntry = {
    ...snapshot,
    id: Number(result.lastInsertRowid),
    createdAt,
  }
  const history = [currentEntry, ...latestHistory].sort(sortChapterGateHistory).slice(0, 6)
  return {
    history,
    drift: history.length > 1 ? buildChapterGateDriftSummary(history[0], history[1]) : undefined,
  }
}

function buildRewriteTarget(
  chapterId: number,
  items: ChapterPublishCheckItem[],
  rewritePlan?: RewritePlan,
): ChapterRewriteTarget | undefined {
  if (rewritePlan) {
    if (typeof rewritePlan.targetSegmentId === 'number') {
      const matchedItem = items.find((item) => item.segmentId === rewritePlan.targetSegmentId)
      return {
        kind: 'segment',
        chapterId,
        segmentId: rewritePlan.targetSegmentId,
        segmentTitle: matchedItem?.segmentTitle,
        reason: rewritePlan.goals[0] || rewritePlan.targetExcerpt || matchedItem?.detail || '需要重写对应场景。',
        relatedPage: matchedItem?.relatedPage || 'structure',
      }
    }
    return {
      kind: rewritePlan.scope === 'paragraph_patch' ? 'selection' : 'chapter',
      chapterId,
      reason: rewritePlan.goals[0] || rewritePlan.targetExcerpt || '需要按章节验收计划重写。',
      relatedPage: rewritePlan.scope === 'contract_replan' ? 'contracts' : 'writing',
    }
  }
  const rewriteItem = items.find((item) => item.status === 'rewrite')
  if (!rewriteItem) return undefined
  if (typeof rewriteItem.segmentId === 'number') {
    return {
      kind: 'segment',
      chapterId,
      segmentId: rewriteItem.segmentId,
      segmentTitle: rewriteItem.segmentTitle,
      reason: rewriteItem.detail,
      relatedPage: rewriteItem.relatedPage || 'structure',
    }
  }
  return {
    kind: rewriteItem.relatedPage === 'writing' ? 'selection' : 'chapter',
    chapterId,
    reason: rewriteItem.detail,
    relatedPage: rewriteItem.relatedPage || 'writing',
  }
}

function dedupeTextList(values: Array<string | undefined | null | false>): string[] {
  return [...new Set(values
    .map((value) => normalizeText(typeof value === 'string' ? value : ''))
    .filter(Boolean))]
}

function buildRewriteGoals(
  item: ChapterPublishCheckItem,
  reviewState: ReturnType<typeof parseReviewState>,
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const contractFocus = (contractValidation?.itemResults || [])
    .filter((entry) =>
      entry.verdict === 'missing'
      || entry.verdict === 'contradicted'
      || entry.verdict === 'weak')
    .slice(0, 2)

  return dedupeTextList([
    item.fixHint,
    item.detail,
    reviewState.revisionBrief,
    ...contractFocus.map((entry) => entry.rewriteHint),
    reviewState.criticalFixes[0],
    reviewState.missingPayoffs[0],
  ]).slice(0, 5)
}

function buildRewritePreserve(scope: ChapterRewriteScope, item: ChapterPublishCheckItem): string[] {
  return dedupeTextList([
    '作者锁定段落必须逐字保留。',
    '章节目标、世界规则和已确定关系状态不得被改写成另一条线。',
    '已经成立且无问题的段落只做最小衔接性改动。',
    scope === 'scene_rewrite' && typeof item.segmentId === 'number'
      ? '非目标场景优先保持不动，只修与目标场景衔接的过渡。'
      : '',
    scope === 'contract_replan'
      ? '若合同本身冲突，先重排合同，再决定正文如何改写。'
      : '',
  ])
}

function buildRewriteRecheckItems(
  item: ChapterPublishCheckItem,
  checklist: ChapterPublishCheckItem[],
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const activeRewriteKeys = checklist
    .filter((entry) => (entry.status === 'rewrite' || entry.status === 'blocker') && !CHAPTER_GATE_NON_REWRITEABLE_KEYS.has(entry.key))
    .map((entry) => entry.key)

  if (item.key === 'rewrite_path') {
    return dedupeTextList([
      ...activeRewriteKeys,
      contractValidation?.status === 'blocker' ? 'contract_delivery' : '',
    ])
  }

  switch (item.key) {
    case 'contract_delivery':
      return dedupeTextList([
        'contract_delivery',
        'thread_progress',
        'line_progress',
        'volume_alignment',
      ])
    case 'pov_purity':
    case 'pov_boundary':
      return ['pov_purity', 'pov_boundary']
    case 'dialogue_voice':
      return ['dialogue_voice', 'review']
    case 'style_compliance':
      return ['style_compliance', 'review', 'ai_score']
    case 'ai_score':
    case 'review':
      return ['ai_score', 'review']
    case 'step_memory_handoff':
      return ['step_memory_handoff', 'review', 'contract_delivery']
    case 'opening_hook':
      return ['opening_hook', 'review', 'ai_score']
    case 'title_and_hallucination':
      return ['title_and_hallucination', 'review']
    case 'sensory_coverage':
      return ['sensory_coverage', 'review']
    case 'narrative_ratio':
      return ['narrative_ratio', 'review', 'ai_score']
    case 'thread_progress':
    case 'line_progress':
      return ['thread_progress', 'line_progress', 'contract_delivery']
    case 'volume_alignment':
      return ['volume_alignment', 'contract_delivery', 'line_progress']
    case 'consistency':
      return dedupeTextList([...activeRewriteKeys, 'contract_delivery'])
    default:
      return dedupeTextList(activeRewriteKeys.length > 0 ? activeRewriteKeys : [item.key])
  }
}

function getRewriteScopeForItem(
  item: ChapterPublishCheckItem,
  contractValidation?: ChapterContractValidationResult | null,
): ChapterRewriteScope {
  if (item.key === 'contract_delivery') {
    const blockingItems = (contractValidation?.itemResults || [])
      .filter((entry) => entry.verdict === 'missing' || entry.verdict === 'contradicted')
    if (blockingItems.some((entry) => entry.verdict === 'contradicted')) return 'contract_replan'
    if (blockingItems.some((entry) => typeof entry.segmentId === 'number')) return 'scene_rewrite'
    return 'chapter_rewrite'
  }

  if (
    item.key === 'pov_purity'
    || item.key === 'thread_progress'
    || item.key === 'line_progress'
    || item.key === 'volume_alignment'
    || item.key === 'consistency'
    || item.key === 'rewrite_path'
  ) {
    return typeof item.segmentId === 'number' ? 'scene_rewrite' : 'chapter_rewrite'
  }

  if (item.key === 'pov_boundary') {
    return typeof item.segmentId === 'number' ? 'scene_rewrite' : 'paragraph_patch'
  }

  if (
    item.key === 'dialogue_voice'
    || item.key === 'style_compliance'
    || item.key === 'review'
    || item.key === 'ai_score'
    || item.key === 'step_memory_handoff'
    || item.key === 'opening_hook'
    || item.key === 'title_and_hallucination'
    || item.key === 'sensory_coverage'
    || item.key === 'narrative_ratio'
  ) {
    return 'paragraph_patch'
  }

  return item.status === 'rewrite' && typeof item.segmentId === 'number'
    ? 'scene_rewrite'
    : 'chapter_rewrite'
}

function buildRewriteTargetExcerpt(
  item: ChapterPublishCheckItem,
  reviewState: ReturnType<typeof parseReviewState>,
  contractValidation?: ChapterContractValidationResult | null,
): string | undefined {
  const contractEvidence = (contractValidation?.itemResults || [])
    .find((entry) =>
      (entry.verdict === 'missing' || entry.verdict === 'contradicted' || entry.verdict === 'weak')
      && (item.key === 'contract_delivery' || entry.segmentId === item.segmentId))

  return dedupeTextList([
    contractEvidence?.evidenceExcerpt,
    contractEvidence?.rewriteHint,
    item.segmentTitle ? `${item.segmentTitle}：${item.detail}` : '',
    item.detail,
    reviewState.dialogueDriftAlerts[0],
    reviewState.crossCharacterSimilarity[0],
    reviewState.languageRisks[0],
  ])[0]
}

function buildRewritePlanForItem(params: {
  item: ChapterPublishCheckItem
  checklist: ChapterPublishCheckItem[]
  reviewState: ReturnType<typeof parseReviewState>
  contractValidation?: ChapterContractValidationResult | null
}): RewritePlan | undefined {
  const { item, checklist, reviewState, contractValidation } = params
  if (CHAPTER_GATE_NON_REWRITEABLE_KEYS.has(item.key)) return undefined
  if (item.status !== 'rewrite' && item.status !== 'blocker') return undefined

  const scope = getRewriteScopeForItem(item, contractValidation)
  const recheckItems = buildRewriteRecheckItems(item, checklist, contractValidation)
  if (recheckItems.length === 0) return undefined
  const contractTargetSegmentId = (contractValidation?.itemResults || [])
    .find((entry) =>
      typeof entry.segmentId === 'number'
      && (entry.verdict === 'missing' || entry.verdict === 'contradicted' || entry.verdict === 'weak'))
    ?.segmentId

  return {
    scope,
    targetSegmentId: typeof item.segmentId === 'number'
      ? item.segmentId
      : item.key === 'contract_delivery'
        ? contractTargetSegmentId
        : undefined,
    targetExcerpt: buildRewriteTargetExcerpt(item, reviewState, contractValidation),
    goals: buildRewriteGoals(item, reviewState, contractValidation),
    preserve: buildRewritePreserve(scope, item),
    recheckItems,
  }
}

function getRewritePlanPriority(plan: RewritePlan | undefined, item: ChapterPublishCheckItem): number {
  if (!plan) return 0
  if (item.key === 'rewrite_path') return 20
  if (plan.scope === 'contract_replan') return 400
  if (item.key === 'title_and_hallucination') return 360
  if (item.key === 'step_memory_handoff') return 340
  if (item.key === 'opening_hook') return 320
  if (item.key === 'contract_delivery') return 160
  if (item.key === 'narrative_ratio') return 280
  if (plan.scope === 'scene_rewrite') return 300
  if (plan.scope === 'paragraph_patch') return 240
  if (plan.scope === 'chapter_rewrite') return 180
  return 100
}

function buildChapterRewritePlan(params: {
  checklist: ChapterPublishCheckItem[]
  reviewState: ReturnType<typeof parseReviewState>
  contractValidation?: ChapterContractValidationResult | null
}): RewritePlan | undefined {
  let selected: { item: ChapterPublishCheckItem; plan: RewritePlan } | null = null
  const hasSpecificRewrite = params.checklist.some((item) => item.status === 'rewrite' && item.key !== 'rewrite_path')

  for (const item of params.checklist) {
    if (hasSpecificRewrite && (item.key === 'rewrite_path' || item.key === 'contract_delivery')) continue
    const plan = buildRewritePlanForItem({
      item,
      checklist: params.checklist,
      reviewState: params.reviewState,
      contractValidation: params.contractValidation,
    })
    if (!plan) continue
    if (!selected || getRewritePlanPriority(plan, item) > getRewritePlanPriority(selected.plan, selected.item)) {
      selected = { item, plan }
    }
  }

  return selected ? selected.plan : undefined
}

function syncChapterGateRevisionTasks(
  novelId: number,
  chapterId: number,
  chapterNum: number,
  checklist: ChapterPublishCheckItem[],
  contractAudit: ChapterContractAudit,
  reviewState: ReturnType<typeof parseReviewState>,
  contractValidation?: ChapterContractValidationResult | null,
): { taskIdByItemKey: Map<string, number>; generatedTaskCount: number } {
  const db = getDb()
  const now = new Date().toISOString()
  const chapterLabel = `第 ${chapterNum} 章`
  const drafts: ChapterGateTaskDraft[] = [
    ...checklist
      .filter((item) => item.status === 'blocker' || item.status === 'rewrite')
      .map((item) => ({
        issueKey: `chapter_gate:${chapterId}:check:${item.key}`,
        severity: item.status === 'rewrite' ? 'high' as const : 'medium' as const,
        title: `[章节验收门][${item.status === 'rewrite' ? '退回重写' : '阻塞'}] ${item.label}`,
        description: item.detail,
        fixBrief: item.fixHint || item.detail,
        relatedPage: (item.relatedPage || (item.segmentId ? 'structure' : 'writing')) as ChapterPublishRelatedPage,
        chapterId,
        itemKey: item.key,
        originMeta: {
          issueCategory: 'chapter_gate',
          autoFixable: buildRewritePlanForItem({
            item,
            checklist,
            reviewState,
            contractValidation,
          })?.scope !== 'contract_replan' ? undefined : false,
          gateLevel: item.status,
          checkKey: item.key,
          source: item.source,
          segmentId: item.segmentId ?? null,
          segmentTitle: item.segmentTitle || '',
          rewriteTarget: item.status === 'rewrite'
            ? (item.segmentId ? 'segment' : item.relatedPage === 'writing' ? 'selection' : 'chapter')
            : '',
          entityLabel: chapterLabel,
          suggestion: item.fixHint || item.detail,
          rewritePlan: buildRewritePlanForItem({
            item,
            checklist,
            reviewState,
            contractValidation,
          }),
        },
      })),
    ...contractAudit.items
      .filter((item) => item.status === 'blocker')
      .map((item) => ({
        issueKey: `chapter_gate:${chapterId}:contract:${item.key}`,
        severity: 'medium' as const,
        title: `[章节验收门][合同阻塞] ${item.label}`,
        description: item.detail,
        fixBrief: item.detail,
        relatedPage: (item.source === 'scene' ? 'structure' : 'contracts') as ChapterPublishRelatedPage,
        chapterId,
        itemKey: `contract:${item.key}`,
        originMeta: {
          issueCategory: 'chapter_gate',
          autoFixable: false,
          gateLevel: 'blocker',
          checkKey: item.key,
          source: item.source,
          segmentId: item.segmentId ?? null,
          segmentTitle: item.segmentTitle || '',
          entityLabel: chapterLabel,
          suggestion: item.detail,
          rewritePlan: {
            scope: 'contract_replan' as ChapterRewriteScope,
            targetSegmentId: item.segmentId ?? undefined,
            targetExcerpt: item.segmentTitle ? `${item.segmentTitle}：${item.detail}` : item.detail,
            goals: dedupeTextList([
              item.detail,
              '先回到章节合同/场景合同修正冲突，再决定正文如何改写。',
            ]),
            preserve: ['正文锁定段落和已成立事件先不动，优先修合同定义。'],
            recheckItems: ['contract_delivery'],
          },
        },
      })),
  ]

  const existingRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => normalizeText(row.taskSource) === 'system')
    .filter((row) => normalizeText(row.issueKey).startsWith(`chapter_gate:${chapterId}:`))
  const existingByKey = new Map(existingRows.map((row) => [normalizeText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()
  const taskIdByItemKey = new Map<string, number>()

  drafts.forEach((draft) => {
    activeKeys.add(draft.issueKey)
    const existing = existingByKey.get(draft.issueKey)
    if (!existing) {
      const result = db.insert(revisionTasks).values({
        novelId,
        taskSource: 'system',
        issueKey: draft.issueKey,
        taskType: draft.relatedPage === 'structure' ? 'outline' : 'continuity',
        status: 'open',
        severity: draft.severity,
        title: draft.title,
        description: draft.description,
        fixBrief: draft.fixBrief,
        relatedPage: draft.relatedPage,
        entityType: 'chapter',
        entityId: chapterId,
        chapterId,
        originMetaJson: serializeOriginMetaJson(draft.originMeta),
        lastDetectedAt: now,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
      taskIdByItemKey.set(draft.itemKey, Number(result.lastInsertRowid))
      return
    }

    const previousStatus = normalizeTaskStatus(existing.status)
    const nextStatus = previousStatus === 'ignored'
      ? 'ignored'
      : previousStatus === 'resolved'
        ? 'open'
        : previousStatus
    db.update(revisionTasks).set({
      taskType: draft.relatedPage === 'structure' ? 'outline' : 'continuity',
      status: nextStatus,
      severity: draft.severity,
      title: draft.title,
      description: draft.description,
      fixBrief: draft.fixBrief,
      relatedPage: draft.relatedPage,
      entityType: 'chapter',
      entityId: chapterId,
      chapterId,
      originMetaJson: serializeOriginMetaJson({
        ...parseOriginMetaJson(existing.originMetaJson),
        ...draft.originMeta,
      }),
      lastDetectedAt: now,
      resolvedAt: null,
      updatedAt: now,
    }).where(eq(revisionTasks.id, existing.id)).run()
    taskIdByItemKey.set(draft.itemKey, existing.id)
  })

  existingRows
    .filter((row) => {
      const issueKey = normalizeText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const previousStatus = normalizeTaskStatus(row.status)
      if (previousStatus === 'ignored' || previousStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return {
    taskIdByItemKey,
    generatedTaskCount: drafts.length,
  }
}

export interface NovelContextStatus {
  novelId: number
  contextVersion: number
  totalChapterCount: number
  staleChapterCount: number
  staleChapterIds: number[]
  staleCheckpointCount: number
  staleAssetCount: number
  staleAssetKeys: AssetFreshnessKey[]
  staleAssetLabels: string[]
  pendingImpactCount: number
  pendingManualConfirmationCount: number
  latestImpactEventAt?: string | null
}

function parseIsoTime(raw?: string | null): number | null {
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function collectLatestUpdatedAt(rows: Array<{ updatedAt?: string | null }>): number | null {
  return rows.reduce<number | null>((latest, row) => {
    const next = parseIsoTime(row.updatedAt)
    if (next === null) return latest
    return latest === null ? next : Math.max(latest, next)
  }, null)
}

export function getNovelContextStatus(novelId: number): NovelContextStatus {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const staleChapterIds = chapterRows
    .filter((chapter) => parseStringArray(chapter.staleReasonJson).length > 0)
    .map((chapter) => chapter.id)
  const staleCheckpointCount = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
    .filter((checkpoint) => checkpoint.stale === 1 || (checkpoint.version || 1) < (novel.contextVersion || 1))
    .length
  const novelUpdatedAt = parseIsoTime(novel.updatedAt)
  const assetRows = {
    faction: db.select().from(factions).where(eq(factions.novelId, novelId)).all(),
    character: db.select().from(characters).where(eq(characters.novelId, novelId)).all(),
    item: db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all(),
    thread: db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all(),
    timeline: db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all(),
  }
  const staleAssetKeys = (Object.keys(assetRows) as AssetFreshnessKey[]).filter((key) => {
    if (assetRows[key].length === 0 || novelUpdatedAt === null) return false
    const latestUpdatedAt = collectLatestUpdatedAt(assetRows[key])
    if (latestUpdatedAt === null) return false
    return (novelUpdatedAt - latestUpdatedAt) > ASSET_FRESHNESS_GRACE_MS
  })
  const impactSummary = getNovelAssetImpactSummary(novelId)

  return {
    novelId,
    contextVersion: novel.contextVersion || 1,
    totalChapterCount: chapterRows.length,
    staleChapterCount: staleChapterIds.length,
    staleChapterIds,
    staleCheckpointCount,
    staleAssetCount: staleAssetKeys.length,
    staleAssetKeys,
    staleAssetLabels: staleAssetKeys.map((key) => ASSET_FRESHNESS_LABELS[key]),
    pendingImpactCount: impactSummary.pendingImpactCount,
    pendingManualConfirmationCount: impactSummary.pendingManualConfirmationCount,
    latestImpactEventAt: impactSummary.latestImpactEventAt,
  }
}

export function markNovelContextChanged(novelId: number, reasons: string | string[]): number {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) {
    return novel.contextVersion || 1
  }

  const nextVersion = (novel.contextVersion || 1) + 1
  const now = new Date().toISOString()

  getSqlite().transaction(() => {
    db.update(novels).set({
      contextVersion: nextVersion,
      updatedAt: now,
    }).where(eq(novels.id, novelId)).run()

    const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }

    markStoryMemoryCheckpointsDirty(novelId, now)
  })()

  return nextVersion
}

export function markStoryMemoryCheckpointsDirty(novelId: number, updatedAt = new Date().toISOString()): void {
  const db = getDb()
  db.update(storyMemoryCheckpoints).set({
    stale: 1,
    updatedAt,
  }).where(eq(storyMemoryCheckpoints.novelId, novelId)).run()
}

export function markSubsequentChaptersStale(
  novelId: number,
  chapterNum: number,
  reasons: string | string[],
): void {
  const db = getDb()
  const normalizedReasons = [...new Set((Array.isArray(reasons) ? reasons : [reasons])
    .map((item) => item.trim())
    .filter(Boolean))]
  if (normalizedReasons.length === 0) return

  const now = new Date().toISOString()
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.chapterNum > chapterNum)

  if (chapterRows.length === 0) return

  getSqlite().transaction(() => {
    for (const chapter of chapterRows) {
      db.update(chapters).set({
        staleReasonJson: mergeReasons(chapter.staleReasonJson, normalizedReasons),
        updatedAt: now,
      }).where(eq(chapters.id, chapter.id)).run()
    }
  })()
}

export function markChapterContextCurrent(chapterId: number): void {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  db.update(chapters).set({
    contextVersion: novel.contextVersion || 1,
    staleReasonJson: JSON.stringify([]),
    updatedAt: new Date().toISOString(),
  }).where(eq(chapters.id, chapterId)).run()
}

function collectChapterRelatedIssues(
  novelId: number,
  chapterId: number,
  chapterNum: number,
): ConsistencyIssue[] {
  const db = getDb()
  const report = buildNovelConsistencyReport(novelId)
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const currentChapter = chapterRows.find((item) => item.id === chapterId)
  const chapterIdToNum = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const relatedEvents = eventRows.filter((event) => {
    if (currentChapter?.partId && event.partId === currentChapter.partId) return true
    if (currentChapter?.volumeId && event.volumeId === currentChapter.volumeId) return true
    if (event.chapterStartId === chapterId || event.chapterEndId === chapterId) return true
    const startNum = event.chapterStartId ? chapterIdToNum.get(event.chapterStartId) : undefined
    const endNum = event.chapterEndId ? chapterIdToNum.get(event.chapterEndId) : undefined
    return typeof startNum === 'number' && typeof endNum === 'number'
      ? chapterNum >= startNum && chapterNum <= endNum
      : typeof startNum === 'number'
        ? chapterNum === startNum
        : typeof endNum === 'number'
          ? chapterNum === endNum
          : false
  })
  const relatedEventIds = new Set(relatedEvents.map((event) => event.id))
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const relatedItems = itemRows.filter((item) =>
    parseNumberArray(item.linkedTimelineEventIdsJson).some((id) => relatedEventIds.has(id)))
  const relatedItemIds = new Set(relatedItems.map((item) => item.id))

  return report.issues.filter((issue) =>
    ((issue.entityType === 'chapter' || issue.category === 'continuity') && issue.entityId === chapterId)
    || (issue.entityType === 'timeline' && issue.entityId ? relatedEventIds.has(issue.entityId) : false)
    || (issue.entityType === 'item' && issue.entityId ? relatedItemIds.has(issue.entityId) : false))
}

export function runChapterPublishCheck(
  chapterId: number,
  options: { phase?: 'pipeline' | 'final' } = {},
): ChapterPublishCheck {
  const phase = options.phase || 'final'
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) {
    throwUserFacingError('chapter.notFound')
  }

  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).all()[0]
  if (!novel) {
    throwUserFacingError('novel.notFound')
  }

  const staleReasons = parseStringArray(chapter.staleReasonJson)
  const consistencyIssues = collectChapterRelatedIssues(chapter.novelId, chapter.id, chapter.chapterNum)
  const highIssues = consistencyIssues.filter((issue) => issue.severity === 'high')
  const mediumIssues = consistencyIssues.filter((issue) => issue.severity === 'medium')
  const aiScore = parseAiScore(chapter.aiScoreJson)
  let reviewState = parseReviewState(chapter.reviewNotesJson)
  // Critic findings are useful upstream evidence, but the publish gate must
  // judge dialogue risks against the current committed text. Otherwise a
  // blocker from the pre-rewrite draft can survive a clean revalidation and
  // stop Canonizer/Finalize indefinitely.
  if (chapter.content?.trim()) {
    const currentDialogueAnalysis = analyzeChapterDialogueAgainstNovel(
      chapter.novelId,
      chapter.chapterNum,
      chapter.content,
    )
    reviewState = {
      ...reviewState,
      dialogueHomogenizationRisks: currentDialogueAnalysis.risks || [],
      dialogueDriftAlerts: (currentDialogueAnalysis.drifts || [])
        .map((item) => normalizeText(item.reason) || normalizeText(item.characterName))
        .filter(Boolean),
      crossCharacterSimilarity: (currentDialogueAnalysis.similarities || [])
        .map((item) => normalizeText(item.reason))
        .filter(Boolean),
      dialogueFillerRisks: currentDialogueAnalysis.fillerRisks || [],
      dialogueInfoDensityRisks: currentDialogueAnalysis.infoDensityRisks || [],
      dialogueVoiceLockSummary: currentDialogueAnalysis.voiceLockSummary || '',
    }
  }
  const contractContext = loadChapterContractAuditContext(chapterId)
  const narrativeControlCharacterNames = db.select({ name: characters.fullName })
    .from(characters)
    .where(eq(characters.novelId, chapter.novelId))
    .all()
    .map((row) => row.name || '')
    .filter(Boolean)
  const qualityDashboard = getQualityDashboardData(chapter.novelId, { includeDialogueInsights: false })
  const recallRuntimeByChapterId = buildLatestRecallRuntimeMap(chapter.novelId)
  const recallRuntime = recallRuntimeByChapterId.get(chapterId)
  const recallDiagnostics = recallRuntime?.recallDiagnostics || buildHeuristicRecallDiagnostics(chapter.novelId, {
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    summary: chapter.summary,
    outline: chapter.outline,
  })
  const recallFallbackStreak = getRecallFallbackStreak(chapter.novelId, chapter.chapterNum, recallRuntimeByChapterId)
  const recallSnapshot = recallRuntime?.recallSnapshot
  const contractAudit = buildChapterContractAudit(chapterId)
  const contractValidation = chapter.content?.trim()
    ? validateChapterContractDelivery({
      chapterId,
      content: chapter.content,
      reviewNotes: chapter.reviewNotesJson,
    })
    : null
  const publishContractValidation = buildHardContractValidationResult(contractValidation)
  const openingHookIssues = dedupeTextList([
    ...reviewState.openingHookRisks,
    ...getContractValidationIssuesByType(contractValidation, 'golden_three_opening'),
  ])
  const titleAlignmentIssues = dedupeTextList([
    ...reviewState.titleAlignmentRisks,
    ...getContractValidationIssuesByType(contractValidation, 'chapter_title_alignment'),
  ])
  const contractAuditJson = JSON.stringify(contractAudit)
  if (chapter.contractAuditJson !== contractAuditJson) {
    db.update(chapters).set({
      contractAuditJson,
    }).where(eq(chapters.id, chapterId)).run()
  }
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const storyArcSnapshot = typeof chapter.arcId === 'number'
    ? getStoryArcProgressSnapshot(chapter.novelId)
    : null
  const arcWarnings = storyArcSnapshot && typeof chapter.arcId === 'number'
    ? getStoryArcWarningsForChapter(storyArcSnapshot, chapter.arcId, chapter.chapterNum)
    : []
  const scenePlanSnapshots = parseScenePlanSnapshots(chapter.scenePlanJson)
  const threadRows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, chapter.novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
  const currentVolume = typeof chapter.volumeId === 'number'
    ? db.select().from(storyVolumes).where(eq(storyVolumes.id, chapter.volumeId)).all()[0] || null
    : null
  const currentVolumeDesign = typeof chapter.volumeId === 'number'
    ? db.select().from(volumeDesigns).where(eq(volumeDesigns.volumeId, chapter.volumeId)).all()[0] || null
    : null
  const storyAlerts = qualityDashboard.storyPacingAlerts
    .filter((alert) => alert.chapterNums.includes(chapter.chapterNum))
    .slice(0, 3)

  const chapterContract = contractContext.chapterContract
  const contractBindingCount =
    chapterContract.servedThreadIds.length
    + chapterContract.requiredArcProgress.length
    + chapterContract.requiredCharacterArcIds.length
    + chapterContract.requiredRelationshipArcIds.length
    + chapterContract.requiredResistanceTrackIds.length
    + chapterContract.requiredEndgameCommitmentIds.length
    + chapterContract.requiredForeshadowIds.length
  const weakFunction = ['setup', 'exposition', 'breather'].includes(reviewState.chapterFunctionPrimary)
    || reviewState.chapterFunctionTags.some((tag) => tag === 'setup' || tag === 'exposition' || tag === 'breather')
  const scenePovRows = contractContext.sceneSnapshots.filter((scene) => scene.pov)
  const uniqueScenePovs = [...new Set(scenePovRows.map((scene) => scene.pov))]
  const missingScenePovs = contractContext.sceneSnapshots.filter((scene) => !scene.pov)
  const fixedNovelPov = Boolean(themeVoice.pov && themeVoice.pov !== 'multi_pov')
  const conflictingPovScene = fixedNovelPov && uniqueScenePovs.length > 1
    ? contractContext.sceneSnapshots.find((scene) => scene.pov && scene.pov !== uniqueScenePovs[0])
    : null
  const narrativeControlReport = analyzeNarrativeControls({
    themeVoice,
    sceneSnapshots: contractContext.sceneSnapshots,
    characterNames: narrativeControlCharacterNames,
    content: chapter.content,
    chapterFunction: reviewState.chapterFunctionPrimary || reviewState.paceMarker,
    chapterGoal: chapterContract.chapterGoal || chapter.outline || '',
    emotionTone: chapter.emotionTone || '',
    emotionFocus: chapterContract.emotionFocus,
    expositionMode: chapterContract.expositionMode,
  })
  const sceneHookCount = scenePlanSnapshots.filter((item) => item.exitHook).length
  const requiredThreads = chapterContract.servedThreadIds
    .map((threadId) => threadRows.find((row) => row.id === threadId) || null)
  const missingRequiredThreads = chapterContract.servedThreadIds.filter((threadId) => !requiredThreads.some((row) => row?.id === threadId))
  const untouchedRequiredThreads = requiredThreads
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) =>
      row.lastReferencedChapter !== chapter.chapterNum
      && row.plantedChapter !== chapter.chapterNum
      && row.resolvedChapter !== chapter.chapterNum)
  const overdueThreads = threadRows.filter((row) =>
    normalizeText(row.status) !== 'resolved'
    && normalizeText(row.status) !== 'archived'
    && typeof row.targetPayoffChapter === 'number'
    && row.targetPayoffChapter <= chapter.chapterNum
    && row.resolvedChapter !== chapter.chapterNum
    && row.lastReferencedChapter !== chapter.chapterNum
    && row.plantedChapter !== chapter.chapterNum)
  const volumeSignals = currentVolumeDesign
    ? [
        normalizeText(currentVolumeDesign.volumeTheme),
        normalizeText(currentVolumeDesign.volumePromise),
        normalizeText(currentVolumeDesign.mainConflict),
        normalizeText(currentVolumeDesign.climaxPlan),
        normalizeText(currentVolumeDesign.endStateShift),
        normalizeText(currentVolumeDesign.readerExpectation),
        ...parseStringArray(currentVolumeDesign.mustAddCluesJson),
        ...parseStringArray(currentVolumeDesign.mustResolveCluesJson),
      ].filter(Boolean)
    : []
  const strictVolumeDesign = normalizeText(currentVolumeDesign?.auditStatus) === 'locked'
    || normalizeText(currentVolumeDesign?.auditStatus) === 'ready'

  const contractDeliveryStatus: ChapterGateLevel = publishContractValidation
    ? publishContractValidation.status
    : contractAudit.blockerCount > 0
      ? 'blocker'
      : contractAudit.warningCount > 0
        ? 'warning'
        : 'pass'
  const dialogueSignalCount =
    reviewState.dialogueHomogenizationRisks.length
    + reviewState.dialogueDriftAlerts.length
    + reviewState.crossCharacterSimilarity.length
    + reviewState.dialogueFillerRisks.length
    + reviewState.dialogueInfoDensityRisks.length
    + (reviewState.dialogueVoiceLockSummary ? 1 : 0)
  const dialogueVoiceStatus: ChapterGateLevel = dialogueSignalCount >= 3
    || (reviewState.dialogueDriftAlerts.length > 0 && reviewState.crossCharacterSimilarity.length > 0 && reviewState.severity === 'high')
    ? 'blocker'
    : dialogueSignalCount > 0
      ? 'warning'
      : 'pass'
  const povPurityStatus: ChapterGateLevel = fixedNovelPov && uniqueScenePovs.length > 1
    ? 'rewrite'
    : missingScenePovs.length > 0
      ? (fixedNovelPov ? 'blocker' : 'warning')
      : uniqueScenePovs.length > 1
        ? 'warning'
        : 'pass'
  const povBoundaryStatus: ChapterGateLevel = narrativeControlReport.pov.status
  const sensoryCoverageStatus: ChapterGateLevel = narrativeControlReport.sensory.status
  const narrativeRatioStatus: ChapterGateLevel = narrativeControlReport.narrativeRatio.status
  const transitionDensityStatus: ChapterGateLevel = narrativeControlReport.transitionDensity.status
  const emotionFocusStatus: ChapterGateLevel = narrativeControlReport.emotionFocus.status
  const expositionStatus: ChapterGateLevel = narrativeControlReport.exposition.status
  const hookStrengthStatus: ChapterGateLevel = !chapterContract.hookType && sceneHookCount === 0 && reviewState.readerHookRisks.length > 0 && weakFunction
    ? 'blocker'
    : (!chapterContract.hookType || sceneHookCount === 0 || reviewState.readerHookRisks.length > 0)
      ? 'warning'
      : 'pass'
  const threadProgressStatus: ChapterGateLevel = missingRequiredThreads.length > 0 || untouchedRequiredThreads.length > 0
    ? 'blocker'
    : overdueThreads.length > 0
      ? 'warning'
      : 'pass'
  const volumeAlignmentStatus: ChapterGateLevel = !currentVolume || volumeSignals.length === 0
    ? 'pass'
    : contractBindingCount === 0 && (weakFunction || reviewState.arcProgressRisks.length > 0)
      ? (strictVolumeDesign ? 'blocker' : 'warning')
      : 'pass'
  const lineProgressStatus: ChapterGateLevel = contractBindingCount > 0 && (arcWarnings.length > 0 || reviewState.arcProgressRisks.length > 0)
    ? 'blocker'
    : arcWarnings.length > 0 || reviewState.arcProgressRisks.length > 0 || (contractBindingCount === 0 && weakFunction && reviewState.chapterFunctionPrimary)
      ? 'warning'
      : 'pass'

  const structuralRewriteReasons = [
    povPurityStatus === 'rewrite' ? '当前章节存在多场景 POV 混杂，已经超出固定视角作品可接受范围。' : '',
    povBoundaryStatus === 'rewrite' ? narrativeControlReport.pov.summary : '',
    sensoryCoverageStatus === 'rewrite' ? narrativeControlReport.sensory.summary : '',
    narrativeRatioStatus === 'rewrite' ? narrativeControlReport.narrativeRatio.summary : '',
    transitionDensityStatus === 'rewrite' ? narrativeControlReport.transitionDensity.summary : '',
    emotionFocusStatus === 'rewrite' ? narrativeControlReport.emotionFocus.summary : '',
    expositionStatus === 'rewrite' ? narrativeControlReport.exposition.summary : '',
    reviewState.rewriteRequired && (contractAudit.blockerCount > 0 || highIssues.length > 0 || lineProgressStatus === 'blocker' || threadProgressStatus === 'blocker' || volumeAlignmentStatus === 'blocker')
      ? '审校已经建议重写，且命中了合同/推进/结构类硬问题，单纯润色不足以解决。'
      : '',
    reviewState.rewriteDeltaStatus === 'fail'
      ? `重写差异验证失败：${reviewState.rewriteDeltaFindings.slice(0, 2).join('；') || '当前稿件没有证明已修复剧情、冲突或代价链。'}`
      : reviewState.rewriteDeltaStatus === 'weak' && reviewState.rewriteRequired
        ? `重写差异验证偏弱：${reviewState.rewriteDeltaFindings.slice(0, 2).join('；') || '当前稿件仍缺少足够的结构变化证据。'}`
        : '',
    publishContractValidation?.status === 'blocker'
      ? '正文合同验证仍有关键缺口，当前稿件没有兑现章节目标、场景结果或必要支线/伏笔。'
      : '',
  ].filter(Boolean)
  const rewriteTargetSource = conflictingPovScene || missingScenePovs[0] || null
  const rawChecklist: ChapterPublishCheckItem[] = [
    makePublishCheckItem({
      key: 'content',
      label: '正文已完成',
      status: chapter.content?.trim() ? 'pass' : 'blocker',
      detail: chapter.content?.trim() ? '当前章节已有正文。' : '当前章节还没有正文内容。',
      relatedPage: 'writing',
      fixHint: '先补完正文，再执行章节验收。',
    }),
    makePublishCheckItem({
      key: 'summary',
      label: '摘要已刷新',
      status: chapter.summary?.trim() ? 'pass' : 'blocker',
      detail: chapter.summary?.trim() ? '章节摘要已经生成。' : '需要先刷新摘要和后续承接信息。',
      relatedPage: 'writing',
      fixHint: '先刷新摘要与后续承接，再重新验收。',
    }),
    makePublishCheckItem({
      key: 'continuity',
      label: '连续性记忆已更新',
      status: chapter.continuityStateJson?.trim() ? 'pass' : 'blocker',
      detail: chapter.continuityStateJson?.trim() ? '连续性记忆可用于后文承接。' : '需要先补齐连续性记忆。',
      relatedPage: 'writing',
      fixHint: '先执行摘要/记忆更新，再验收章节。',
    }),
    makePublishCheckItem({
      key: 'context',
      label: '上下文未过期',
      status: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1) ? 'pass' : 'blocker',
      detail: staleReasons.length === 0 && (chapter.contextVersion || 1) === (novel.contextVersion || 1)
        ? '章节上下文与当前全书版本一致。'
        : `需要先处理这些过期原因：${staleReasons.join('；') || '上下文版本落后于当前设定。'}`,
      relatedPage: 'writing',
      fixHint: '回到正文页先刷新摘要、连续性记忆和相关上下文。',
    }),
    makePublishCheckItem({
      key: 'consistency',
      label: '无高优先级结构风险',
      status: highIssues.length === 0 ? 'pass' : 'blocker',
      detail: highIssues.length === 0
        ? '没有命中当前章节的高优先级结构问题。'
        : highIssues.slice(0, 3).map((issue) => issue.title).join('；'),
      relatedPage: 'revision',
      fixHint: '先处理高优先级结构风险，再尝试标记完成。',
    }),
    makePublishCheckItem({
      key: 'ai_score',
      label: 'AI 体检已完成',
      status: typeof aiScore === 'number' ? (aiScore >= 60 ? 'pass' : 'warning') : 'warning',
      detail: typeof aiScore === 'number'
        ? `当前 AI 体检分数为 ${aiScore}。`
        : '还没有执行 AI 体检，建议在发布前跑一次。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '补跑 AI 检测，确认表达与结构风险。',
    }),
    makePublishCheckItem({
      key: 'review',
      label: '审校意见已收敛',
      status: reviewState.rewriteRequired || reviewState.severity === 'high' ? 'warning' : 'pass',
      detail: reviewState.rewriteRequired || reviewState.severity === 'high'
        ? reviewState.revisionBrief || '当前审校结果仍建议重写或存在高风险意见。'
        : '当前没有需要强制处理的审校意见。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '先消化审校结论，再决定是否进入完成态。',
    }),
    makePublishCheckItem({
      key: 'step_memory_handoff',
      label: '步骤接力未断链',
      status: reviewState.stepMemoryRisks.length >= 2
        ? 'blocker'
        : reviewState.stepMemoryRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.stepMemoryRisks.length > 0
        ? reviewState.stepMemoryRisks.slice(0, 3).join('；')
        : '当前没有识别到 Planner、Writer、Critic、Rewriter 之间的接力断链。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '回到正文页按章节衔接桥、场景计划和运行时接力断言重写断链段落。',
    }),
    makePublishCheckItem({
      key: 'opening_hook',
      label: '开篇追读力',
      status: openingHookIssues.length > 0 && chapter.chapterNum <= 3
        ? 'rewrite'
        : openingHookIssues.length > 0
          ? 'warning'
          : 'pass',
      detail: openingHookIssues.length > 0
        ? openingHookIssues.slice(0, 3).join('；')
        : chapter.chapterNum <= 3
          ? '黄金三章当前没有识别到明显的章首吸引力问题。'
          : '当前章节没有识别到明显的章首吸引力问题。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '优先重排章首 800 字：具体现场、主角动作、可感压力、追问点和章尾递进必须落地。',
    }),
    makePublishCheckItem({
      key: 'title_and_hallucination',
      label: '标题贴合 / 无幻觉新增',
      status: reviewState.hallucinationRisks.length > 0
        ? 'blocker'
        : titleAlignmentIssues.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.hallucinationRisks.length > 0 || titleAlignmentIssues.length > 0
        ? [...reviewState.hallucinationRisks, ...titleAlignmentIssues].slice(0, 3).join('；')
        : '当前没有识别到无来源新增设定或标题偏离本章核心事件的问题。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '删除无来源新增，或把标题改回本章核心事件、场景物件、选择压力或反转点。',
    }),
    makePublishCheckItem({
      key: 'style_compliance',
      label: '文风硬约束符合度',
      status: !reviewState.styleComplianceChecked ? 'pass' : reviewState.styleComplianceStatus,
      detail: !reviewState.styleComplianceChecked
        ? '当前小说未配置可用的文风指纹，本章暂不执行风格硬约束校验。'
        : reviewState.styleComplianceStatus === 'pass'
          ? (reviewState.styleComplianceSummary || '当前章节未命中文风硬约束偏离。')
          : [
              reviewState.styleComplianceSummary,
              ...reviewState.styleComplianceDeviations,
              ...(reviewState.styleComplianceForbiddenPatterns.length > 0
                ? [`命中禁用表达：${reviewState.styleComplianceForbiddenPatterns.join('、')}`]
                : []),
            ].filter(Boolean).slice(0, 3).join('；'),
      source: 'review',
      relatedPage: 'revision',
      fixHint: '按文风指纹回调句长、段长、对白密度，并删除禁用表达后再验收。',
    }),
    makePublishCheckItem({
      key: 'typed_ref_coverage',
      label: 'Typed Ref 覆盖',
      status: reviewState.typedRefRisks.length >= 3
        ? 'blocker'
        : reviewState.typedRefRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.typedRefRisks.length > 0
        ? reviewState.typedRefRisks.slice(0, 3).join('；')
        : '当前没有识别到明显的 typed ref 覆盖缺口。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '先补齐 thread / timeline / item 的 typed ref 绑定，再继续依赖这些资产做连续性判断。',
    }),
    makePublishCheckItem({
      key: 'source_grounding',
      label: '来源 / Grounding',
      status: reviewState.sourceGroundingRisks.some((item) => item.includes('历史正剧') || item.includes('conservative fallback'))
        ? 'blocker'
        : reviewState.sourceGroundingRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.sourceGroundingRisks.length > 0
        ? reviewState.sourceGroundingRisks.slice(0, 3).join('；')
        : '当前没有识别到需要阻断的来源/grounding 缺口。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '补充来源/grounding 依据，或把高承诺细节改写为保守表述后再发布。',
    }),
    makePublishCheckItem({
      key: 'operating_mode_policy',
      label: 'OperatingMode 策略',
      status: reviewState.operatingModeRisks.some((item) => item.includes('百万字模式'))
        ? 'blocker'
        : reviewState.operatingModeRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.operatingModeRisks.length > 0
        ? reviewState.operatingModeRisks.slice(0, 3).join('；')
        : '当前没有识别到 operatingMode 策略违规。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '先修正 checkpoint / 结构复杂度与 operatingMode 策略的不匹配，再继续发布。',
    }),
    makePublishCheckItem({
      key: 'genre_register_drift',
      label: '题材语域漂移',
      status: reviewState.genreRegisterRisks.length > 0 && reviewState.sourceGroundingRisks.some((item) => item.includes('历史正剧'))
        ? 'blocker'
        : reviewState.genreRegisterRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.genreRegisterRisks.length > 0
        ? reviewState.genreRegisterRisks.slice(0, 3).join('；')
        : '当前没有识别到明显的题材语域漂移。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '收回抽象升华、说明腔和空泛辞藻，让题材语感重新落回动作、制度、生态和人物立场。',
    }),
    makePublishCheckItem({
      key: 'exposition_density',
      label: '解释密度 / 说明文',
      status: reviewState.longWindowHumanizationRisks.filter((item) => item.includes('解释密度') || item.includes('世界观说明文') || item.includes('过渡句')).length >= 2
        ? 'blocker'
        : reviewState.longWindowHumanizationRisks.some((item) => item.includes('解释密度') || item.includes('世界观说明文') || item.includes('过渡句'))
          ? 'warning'
          : 'pass',
      detail: reviewState.longWindowHumanizationRisks.filter((item) => item.includes('解释密度') || item.includes('世界观说明文') || item.includes('过渡句')).slice(0, 3).join('；') || '当前没有识别到明显的解释密度问题。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '删掉替作者总结的说明句，把世界观与过渡信息改为角色行动、结果状态和场景细节。',
    }),
    makePublishCheckItem({
      key: 'long_window_homogenization',
      label: '累积同质化 / 模板重复',
      status: reviewState.longWindowHumanizationRisks.filter((item) => item.includes('长窗模板复现') || item.includes('反 AI 高风险复现')).length >= 2
        ? 'warning'
        : reviewState.longWindowHumanizationRisks.some((item) => item.includes('长窗模板复现') || item.includes('反 AI 高风险复现'))
          ? 'warning'
          : 'pass',
      detail: reviewState.longWindowHumanizationRisks.filter((item) => item.includes('长窗模板复现') || item.includes('反 AI 高风险复现')).slice(0, 3).join('；') || '当前没有识别到明显的累积模板化重复。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '优先处理最近窗口里复现频率最高的模板连接、模板情绪和高频重复句式。',
    }),
    makePublishCheckItem({
      key: 'dialogue_separability',
      label: '角色对白可分离度',
      status: reviewState.dialogueSeparabilityRisks.length >= 2
        ? 'blocker'
        : reviewState.dialogueSeparabilityRisks.length > 0
          ? 'warning'
          : 'pass',
      detail: reviewState.dialogueSeparabilityRisks.length > 0
        ? reviewState.dialogueSeparabilityRisks.slice(0, 3).join('；')
        : '当前没有识别到明显的长窗对白可分离度风险。',
      source: 'review',
      relatedPage: 'revision',
      fixHint: '为高相似/漂移角色补 voice lock，并重写关键对白段落拉开语气、句长和反应差异。',
    }),
    makePublishCheckItem({
      key: 'story_dynamics',
      label: '主角与节奏风险可控',
      status: reviewState.costEvaporation
        || reviewState.forcedReversal
        || reviewState.tooSmooth
        || reviewState.highPressureNoReward
        || storyAlerts.length > 0
        ? 'warning'
        : 'pass',
      detail: reviewState.costEvaporation
        ? '当前章节存在代价蒸发迹象，建议把损失或后果延续写实。'
        : reviewState.forcedReversal
          ? '当前章节出现支撑不足的反转，建议补齐触发原因和前文铺垫。'
          : reviewState.tooSmooth
            ? '当前章节主角几乎无成本顺推，建议补出真实阻力、失误或损失。'
            : reviewState.highPressureNoReward
              ? '当前章节持续施压却没有阶段回报，建议补入喘息、收获或反击兑现。'
              : storyAlerts.length > 0
                ? storyAlerts.map((alert) => alert.title).join('；')
                : '当前没有命中明显的主角与节奏结构告警。',
      source: 'review',
      relatedPage: 'writing',
      fixHint: '回到正文处理节奏、代价或回报问题。',
    }),
    makePublishCheckItem({
      key: 'scene_plan',
      label: '场景计划可追溯',
      status: chapter.scenePlanJson?.trim() ? 'pass' : 'warning',
      detail: chapter.scenePlanJson?.trim() ? '可以追溯到当前章节的场景拆解。' : '当前缺少场景计划，后续排查承接问题会更难。',
      source: 'scene',
      relatedPage: 'structure',
      fixHint: '先补齐场景计划或结构拆解，再做验收。',
    }),
    makePublishCheckItem({
      key: 'recall',
      label: '召回补充未依赖过期片段',
      status: recallFallbackStreak >= 3
        ? 'blocker'
        : (recallDiagnostics.staleRecallCount > 0 || recallSnapshot?.degraded)
            ? 'warning'
            : 'pass',
      detail: recallFallbackStreak >= 3
        ? `最近已连续 ${recallFallbackStreak} 章发生召回降级，本章继续生成会放大连续性风险。当前原因：${formatRecallFallbackReason(recallSnapshot?.fallbackReason)}。`
        : recallSnapshot?.degraded
          ? `本章召回已降级：${formatRecallFallbackReason(recallSnapshot.fallbackReason)}。${recallSnapshot.retrievalUsed ? '当前仅保留降级后的背景补充。' : '当前 prompt 未实际使用召回补充。'}`
          : recallDiagnostics.staleRecallCount > 0
            ? `识别到 ${recallDiagnostics.staleRecallCount} 条疑似过期召回片段。召回只应作为背景补充，建议优先以硬约束和结构化状态回查。`
            : '当前未识别到疑似过期的召回背景片段。',
      relatedPage: 'writing',
      fixHint: '回查结构化状态和硬约束，避免继续依赖旧召回片段。',
    }),
    makePublishCheckItem({
      key: 'outline',
      label: '章节大纲存在',
      status: chapter.outline?.trim() ? 'pass' : 'warning',
      detail: chapter.outline?.trim() ? '章节大纲已保留。' : '当前章节缺少明确大纲，建议补齐后再标记完成。',
      relatedPage: 'writing',
      fixHint: '补齐本章大纲或明确推进目标。',
    }),
    makePublishCheckItem({
      key: 'medium_issues',
      label: '中优先级风险可控',
      status: mediumIssues.length <= 2 ? 'pass' : 'warning',
      detail: mediumIssues.length <= 2
        ? '没有堆积过多中优先级结构问题。'
        : mediumIssues.slice(0, 3).map((issue) => issue.title).join('；'),
      relatedPage: 'revision',
      fixHint: '优先清掉当前章节堆积的中风险问题。',
    }),
    makePublishCheckItem({
      key: 'contract_delivery',
      label: '合同兑现率',
      status: contractDeliveryStatus,
      detail: contractDeliveryStatus === 'pass'
        ? (publishContractValidation?.summary || '章节合同与场景合同当前已对齐。')
        : (publishContractValidation?.summary || contractAudit.summary),
      source: 'contract',
      relatedPage: publishContractValidation?.itemResults.some((item) => typeof item.segmentId === 'number')
        ? 'structure'
        : 'contracts',
      fixHint: publishContractValidation?.rewriteHints[0] || '回到章节合同与场景合同页补齐绑定、推进记录和结果状态。',
    }),
    makePublishCheckItem({
      key: 'dialogue_voice',
      label: '角色口吻一致性',
      status: dialogueVoiceStatus,
      detail: dialogueVoiceStatus === 'pass'
        ? '当前没有命中明显的对白漂移或角色同声化风险。'
        : [
            ...reviewState.dialogueHomogenizationRisks,
            ...reviewState.dialogueFillerRisks,
            ...reviewState.dialogueInfoDensityRisks,
            ...reviewState.dialogueDriftAlerts,
            ...reviewState.crossCharacterSimilarity,
            reviewState.dialogueVoiceLockSummary,
          ].slice(0, 3).join('；'),
      source: 'review',
      relatedPage: 'revision',
      fixHint: '回看对白指纹、voice lock 与审校提示，分别修句长/停顿差异、空转对白和信息推进密度。',
    }),
    makePublishCheckItem({
      key: 'pov_purity',
      label: 'POV 纯度',
      status: povPurityStatus,
      detail: povPurityStatus === 'rewrite'
        ? `当前作品已固定为 ${themeVoice.pov || '单一视角'}，但本章场景 POV 混用了 ${uniqueScenePovs.join('、')}。`
        : missingScenePovs.length > 0
          ? `仍有 ${missingScenePovs.length} 个场景缺少 POV 标注，当前无法确认视角纯度。`
          : uniqueScenePovs.length > 1
            ? `当前章节涉及 ${uniqueScenePovs.length} 个场景 POV，建议确认是否真的需要多视角切换。`
            : fixedNovelPov && uniqueScenePovs.length === 1
              ? `当前章节已维持固定视角口径：${uniqueScenePovs[0]}。`
              : '当前没有识别到明显的 POV 纯度问题。',
      source: rewriteTargetSource?.segmentId ? 'scene' : 'contract',
      segmentId: rewriteTargetSource?.segmentId,
      segmentTitle: rewriteTargetSource ? getSceneSnapshotLabel(rewriteTargetSource) : undefined,
      relatedPage: rewriteTargetSource?.segmentId ? 'structure' : 'contracts',
      fixHint: povPurityStatus === 'rewrite'
        ? '退回对应场景，统一 POV 后再重新验收。'
        : '补齐场景 POV 标注，并确认章节没有不必要的视角切换。',
    }),
    makePublishCheckItem({
      key: 'pov_boundary',
      label: 'POV 可知边界',
      status: povBoundaryStatus,
      detail: narrativeControlReport.pov.status === 'warning' || narrativeControlReport.pov.status === 'rewrite'
        ? [
            narrativeControlReport.pov.summary,
            narrativeControlReport.pov.directMindReadingHits.length > 0
              ? `越界心理描写：${narrativeControlReport.pov.directMindReadingHits.join('；')}`
              : '',
            narrativeControlReport.pov.impossibleKnowledgeHits.length > 0
              ? `全知泄露信号：${narrativeControlReport.pov.impossibleKnowledgeHits.join('；')}`
              : '',
          ].filter(Boolean).join('；')
        : narrativeControlReport.pov.summary,
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.pov.fixHint,
    }),
    makePublishCheckItem({
      key: 'sensory_coverage',
      label: '五感覆盖',
      status: sensoryCoverageStatus,
      detail: [
        narrativeControlReport.sensory.summary,
        `当前覆盖：${narrativeControlReport.sensory.coveredSenses.map((key) => narrativeControlReport.sensory.breakdown.find((entry) => entry.key === key)?.label || key).join('、') || '无'}`,
        narrativeControlReport.sensory.missingSenses.length > 0
          ? `当前缺口：${narrativeControlReport.sensory.missingSenses.map((key) => narrativeControlReport.sensory.breakdown.find((entry) => entry.key === key)?.label || key).join('、')}`
          : '',
        narrativeControlReport.sensory.focusSummary,
      ].filter(Boolean).join('；'),
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.sensory.fixHint,
    }),
    makePublishCheckItem({
      key: 'narrative_ratio',
      label: '动作 / 对话 / 内心 / 环境 / 解释比例',
      status: narrativeRatioStatus,
      detail: [
        narrativeControlReport.narrativeRatio.summary,
        ...narrativeControlReport.narrativeRatio.deviationReasons.slice(0, 3),
      ].filter(Boolean).join('；'),
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.narrativeRatio.fixHint,
    }),
    makePublishCheckItem({
      key: 'transition_density',
      label: '过渡段疏密',
      status: transitionDensityStatus,
      detail: narrativeControlReport.transitionDensity.summary,
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.transitionDensity.fixHint,
    }),
    makePublishCheckItem({
      key: 'emotion_focus',
      label: '情绪主基调',
      status: emotionFocusStatus,
      detail: narrativeControlReport.emotionFocus.summary,
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.emotionFocus.fixHint,
    }),
    makePublishCheckItem({
      key: 'world_exposition',
      label: '世界观说明文',
      status: expositionStatus,
      detail: narrativeControlReport.exposition.summary,
      source: 'review',
      relatedPage: 'writing',
      fixHint: narrativeControlReport.exposition.fixHint,
    }),
    makePublishCheckItem({
      key: 'hook_strength',
      label: '钩子强度',
      status: hookStrengthStatus,
      detail: hookStrengthStatus === 'pass'
        ? `已配置章节钩子${chapterContract.hookType ? `（${chapterContract.hookType}）` : ''}，且当前没有明显追读流失风险。`
        : !chapterContract.hookType && sceneHookCount === 0
          ? '章节合同没有钩子定义，场景计划也没有明确 exit hook，当前章尾承接力不足。'
          : reviewState.readerHookRisks.slice(0, 2).join('；') || '当前章节的追读钩子仍偏弱，建议补强章尾承接。',
      source: 'review',
      relatedPage: 'contracts',
      fixHint: '补齐章节钩子定义，并回看场景 exit hook 是否真的把读者推进下一章。',
    }),
    makePublishCheckItem({
      key: 'thread_progress',
      label: '线索 / 线程推进度',
      status: threadProgressStatus,
      detail: threadProgressStatus === 'blocker'
        ? missingRequiredThreads.length > 0
          ? `章节合同绑定的故事线程缺失：${missingRequiredThreads.join('、')}。`
          : `章节合同要求服务的线程，本章还没有留下推进痕迹：${untouchedRequiredThreads.slice(0, 3).map((item) => item.title).join('、')}。`
        : threadProgressStatus === 'warning'
          ? `当前存在到期或超期未推进的线程：${overdueThreads.slice(0, 3).map((item) => item.title).join('、')}。`
          : chapterContract.servedThreadIds.length > 0
            ? `本章已触达 ${chapterContract.servedThreadIds.length} 条合同绑定线程。`
            : '当前没有命中明显的线程推进缺口。',
      source: 'thread',
      relatedPage: 'threads',
      fixHint: '回到故事线程或伏笔账本，确认本章真的推进、埋设或回收了对应条目。',
    }),
    makePublishCheckItem({
      key: 'volume_alignment',
      label: '卷目标一致性',
      status: volumeAlignmentStatus,
      detail: volumeAlignmentStatus === 'pass'
        ? currentVolume && volumeSignals.length > 0
          ? `${currentVolume.title || `第${currentVolume.volumeNumber}卷`} 的目标当前已有章节绑定承接。`
          : '当前章节未绑定明确卷目标，或卷设计尚未形成约束。'
        : `${currentVolume?.title || `第${currentVolume?.volumeNumber || '?' }卷`} 已设有卷目标，但本章没有形成有效承接。`,
      source: 'volume',
      relatedPage: 'volume-design',
      fixHint: '回到卷级设计确认本章该服务的承诺、冲突或线索，并把绑定落到章节合同。',
    }),
    makePublishCheckItem({
      key: 'line_progress',
      label: '本章是否真的推进了某条线',
      status: lineProgressStatus,
      detail: lineProgressStatus === 'blocker'
        ? [...arcWarnings, ...reviewState.arcProgressRisks].slice(0, 3).join('；') || '本章合同要求推进，但当前没有足够的推进证据。'
        : lineProgressStatus === 'warning'
          ? [...arcWarnings, ...reviewState.arcProgressRisks].slice(0, 3).join('；') || '当前没有识别到明确的主线推进痕迹。'
          : '当前章节具备可识别的弧线或线程推进。',
      source: 'thread',
      relatedPage: 'contracts',
      fixHint: '先确认本章要推进哪条弧线/线程，再补上清晰的推进记录或正文兑现。',
    }),
    makePublishCheckItem({
      key: 'rewrite_path',
      label: '润色可解 / 必须重写',
      status: structuralRewriteReasons.length > 0
        ? 'rewrite'
        : reviewState.rewriteRequired || reviewState.severity === 'high'
          ? 'warning'
          : 'pass',
      detail: structuralRewriteReasons.length > 0
        ? structuralRewriteReasons.join('；')
        : reviewState.rewriteRequired || reviewState.severity === 'high'
          ? '当前更适合先做定向重写或局部返工，再决定是否标记完成。'
          : '当前问题仍可通过局部修订、润色和补记录解决。',
      source: 'review',
      segmentId: rewriteTargetSource?.segmentId,
      segmentTitle: rewriteTargetSource ? getSceneSnapshotLabel(rewriteTargetSource) : undefined,
      relatedPage: rewriteTargetSource?.segmentId ? 'structure' : 'writing',
      fixHint: structuralRewriteReasons.length > 0
        ? '优先退回对应场景或章节重写，不要只做表层润色。'
        : '先在正文页做局部修订，再复检章节验收门。',
    }),
  ]

  // 流水线阶段（finalize 之前）对时序类与初稿证据类 blocker 降级：
  // - summary/continuity 由随后的 finalize 自动刷新，属于必然未就绪的簿记项
  // - context 过期原因仅为“前文章节内容已更新”时，本章恰是基于最新前文生成的
  // - step_memory/opening_hook/title_and_hallucination 的审校证据来自重写前初稿，未复检重写稿，转修订任务人工复核
  if (phase === 'pipeline') {
    for (let index = 0; index < rawChecklist.length; index += 1) {
      const item = rawChecklist[index]
      if (
        (item.key === 'step_memory_handoff'
          || item.key === 'opening_hook'
          || item.key === 'title_and_hallucination')
        && !reviewState.rewriteRecheckPerformed
        && (item.status === 'blocker' || item.status === 'rewrite')
      ) {
        rawChecklist[index] = {
          ...item,
          status: 'warning',
          detail: `${item.detail}（审校证据来自重写前初稿且未复检，已转修订任务复核）`,
        }
        continue
      }
      if (item.status !== 'blocker') continue
      if (item.key === 'summary' || item.key === 'continuity') {
        rawChecklist[index] = {
          ...item,
          status: 'warning',
          detail: `${item.detail}（流水线入稿阶段将自动刷新，不阻断本次验收）`,
        }
        continue
      }
      if (item.key === 'context') {
        rawChecklist[index] = {
          ...item,
          status: 'warning',
          detail: `${item.detail}（流水线入稿阶段已构建当前上下文，过期标记将由随后 finalize 的记忆刷新解除）`,
        }
        continue
      }
    }
  }

  const rewritePlan = buildChapterRewritePlan({
    checklist: rawChecklist,
    reviewState,
    contractValidation: publishContractValidation,
  })
  const { taskIdByItemKey, generatedTaskCount } = syncChapterGateRevisionTasks(
    chapter.novelId,
    chapter.id,
    chapter.chapterNum,
    rawChecklist,
    contractAudit,
    reviewState,
    publishContractValidation,
  )
  const checklist = rawChecklist.map((item) => {
    const taskId = taskIdByItemKey.get(item.key)
    return typeof taskId === 'number'
      ? { ...item, taskId }
      : item
  })
  const rewriteCount = getChecklistCount(checklist, 'rewrite')
  const checklistBlockerCount = getChecklistCount(checklist, 'blocker')
  const blockerCount = checklistBlockerCount + contractAudit.blockerCount
  const warningCount = getChecklistCount(checklist, 'warning') + contractAudit.warningCount
  const hasSpecificRewrite = checklist.some((item) => item.status === 'rewrite' && item.key !== 'rewrite_path')
  const blockersAreRewriteDependent = contractAudit.blockerCount === 0
    && checklist.every((item) => item.status !== 'blocker' || item.key === 'contract_delivery')
  const gateLevel: ChapterGateLevel = rewriteCount > 0 && (blockerCount === 0 || (hasSpecificRewrite && blockersAreRewriteDependent))
    ? 'rewrite'
    : blockerCount > 0
      ? 'blocker'
      : rewriteCount > 0
      ? 'rewrite'
      : warningCount > 0
        ? 'warning'
        : 'pass'
  const scoreBreakdown = buildPublishCheckScoreBreakdown({
    contractAudit,
    contractValidation: publishContractValidation,
    checklist,
    reviewState,
    aiScore,
    highIssues,
    mediumIssues,
    staleReasons,
    recallStaleCount: recallDiagnostics.staleRecallCount || 0,
    sceneHookCount,
    weakFunction,
    blockerCount,
    warningCount,
    rewriteCount,
  })
  const { history, drift } = persistChapterGateRun({
    novelId: chapter.novelId,
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    gateLevel,
    ready: gateLevel === 'pass' || gateLevel === 'warning',
    summary: buildChapterGateSummary(gateLevel, rewriteCount, blockerCount, warningCount),
    rewriteCount,
    blockerCount,
    warningCount,
    generatedTaskCount,
    scoreBreakdown,
    topIssueKeys: buildChapterGateTopIssueKeys(checklist, contractAudit, publishContractValidation),
  })

  return {
    chapterId: chapter.id,
    chapterNum: chapter.chapterNum,
    gateLevel,
    ready: gateLevel === 'pass' || gateLevel === 'warning',
    summary: buildChapterGateSummary(gateLevel, rewriteCount, blockerCount, warningCount),
    blockerCount,
    warningCount,
    rewriteCount,
    staleReasons,
    chapterContextVersion: chapter.contextVersion || 1,
    novelContextVersion: novel.contextVersion || 1,
    rewriteRecommended: gateLevel === 'rewrite',
    rewriteTarget: buildRewriteTarget(chapter.id, checklist, rewritePlan),
    rewritePlan,
    scoreBreakdown,
    history,
    drift,
    generatedTaskCount,
    checklist,
    contractAudit,
    contractValidation: publishContractValidation || undefined,
  }
}
