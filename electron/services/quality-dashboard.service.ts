import { asc, eq } from 'drizzle-orm'
import type {
  AIScoreDimension,
  ChapterGateHistoryEntry,
  ChapterDialogueReviewData,
  ChapterFunctionAlert,
  ChapterFunctionRun,
  ChapterFunctionSummary,
  ChapterFunctionTag,
  ChapterPacingMarker,
  ChapterStoryDynamics,
  CostDurationEntry,
  CostPersistenceSummary,
  CostResolutionState,
  LanguageDriftMetrics,
  LanguageDriftMetricSnapshot,
  LanguageDriftTrendStatus,
  LanguageDriftTrendSummary,
  NovelLanguageDriftSummary,
  NovelQualityMetrics,
  ProtagonistSetbackLevel,
  ProtagonistSetbackSummary,
  QualityDashboardData,
  QualityDashboardRiskItem,
  QualityDashboardRiskKind,
  QualityDashboardRiskSeverity,
  RecallDiagnostics,
  ReversalDistributionSummary,
  ReversalSupportState,
  RewardState,
  StoryDynamicsAlert,
  StoryDynamicsTrendPoint,
  VolumeLanguageDriftEntry,
  VolumeChapterFunctionEntry,
  VolumeQualityMetrics,
  VolumeStoryDynamicsEntry,
  WorldStateAlert,
} from '../../src/types'
import { getDb } from '../database/db'
import { chapterGateRuns, chapters, characterStateVersions, characters, storyVolumes, timelineEvents, worldStateVersions } from '../database/schema'
import { buildPreviousChapterContextFeed } from './context.service'
import {
  buildChapterGateDriftAlert,
  buildChapterGateDriftSummary,
  getChapterGatePrimaryDimensions,
  getChapterGateScoreBand,
  normalizeChapterGateScoreBreakdown,
  safeParseChapterGateScoreBreakdown,
  safeParseStringArray,
} from './chapter-gate-utils'
import { getDialogueAnalyticsSnapshot, scheduleDialogueFingerprintRefresh } from './dialogue-fingerprint.service'
import { fallbackKeywordSearch } from './embedding.service'
import { getEndgameDebtSnapshot } from './endgame-asset.service'
import { getStoryArcProgressSnapshot } from './story-arc-progress.service'
import { getForeshadowSnapshot } from './story-thread.service'
import { getWorldStateLedgerSnapshot } from './world-state.service'

interface QualityDimensionScore extends AIScoreDimension {}

interface TimelineStoryHint {
  hasConflict: boolean
  hasReversal: boolean
  hasClimax: boolean
  hasPayoff: boolean
  hasBreather: boolean
  protagonistPresent: boolean
}

interface StoryDynamicsParseResult {
  dynamics: ChapterStoryDynamics
  explicit: boolean
}

interface StoryDynamicsChapterRecord {
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  dynamics: ChapterStoryDynamics
}

interface ChapterFunctionParseResult {
  primaryTag?: ChapterFunctionTag
  tags: ChapterFunctionTag[]
  explicit: boolean
}

interface ChapterFunctionChapterRecord {
  chapterId: number
  chapterNum: number
  title: string
  volumeId?: number
  primaryTag?: ChapterFunctionTag
  tags: ChapterFunctionTag[]
  paceMarker?: ChapterPacingMarker
  reversalMarker: boolean
}

interface MutableCostRecord {
  startChapterNum: number
  summary: string
  seenContinuation: boolean
}

type LanguageDriftMetricKey = keyof LanguageDriftMetrics
type LanguageDriftSeries = QualityDashboardData['languageDriftTrends']
type VolumeAccumulator = {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterNums: number[]
  metricsList: LanguageDriftMetrics[]
  trends: LanguageDriftSeries
}
type VolumeStoryAccumulator = {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapters: StoryDynamicsChapterRecord[]
}
type VolumeChapterFunctionAccumulator = {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapters: ChapterFunctionChapterRecord[]
}
type VolumeChapterRange = {
  volumeId: number
  volumeNumber: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  chapterCount: number
}
type ForeshadowCounts = {
  pending: number
  dueSoon: number
  overdue: number
  resolved: number
}
type ChapterGateRunRow = typeof chapterGateRuns.$inferSelect

interface QualityDashboardOptions {
  includeDialogueInsights?: boolean
}

const DIMENSION_NAMES = ['文笔质量', '逻辑连贯', '节奏控制', '情感深度', '人物塑造', '世界一致', '创新性', '追读欲']
const LANGUAGE_DRIFT_METRICS: Array<{ key: LanguageDriftMetricKey; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
]
const CHAPTER_FUNCTION_TAGS: ChapterFunctionTag[] = ['setup', 'progression', 'reversal', 'payoff', 'breather', 'climax', 'exposition', 'closure']
const CHAPTER_FUNCTION_WEAK_TAGS: ChapterFunctionTag[] = ['setup', 'exposition', 'breather']
const QUALITY_RISK_LABELS: Record<QualityDashboardRiskKind, string> = {
  language_drift: 'AI味退化',
  story_dynamics: '主角与节奏',
  chapter_function: '章节功能',
  story_arc: '故事弧推进',
  foreshadow_debt: '伏笔债务',
  endgame_debt: '终局债务',
  recall: '召回可靠性',
  world_state: '状态稳定性',
}
const STORY_DYNAMICS_KEYS = ['protagonist_setback', 'setback_summary', 'cost_present', 'cost_summary', 'cost_resolution_state', 'reversal_marker', 'reversal_summary', 'reversal_support_state', 'pace_marker', 'reward_state', 'protagonist_pressure'] as const
const RECENT_LANGUAGE_DRIFT_WINDOW = 20
const LANGUAGE_DRIFT_DELTA_THRESHOLD = 5
const STORY_ALERT_WINDOW = 20
const SMOOTH_RUN_THRESHOLD = 4
const PRESSURE_RUN_THRESHOLD = 4
const CLIMAX_GAP_THRESHOLD = 12
const REPEATED_FUNCTION_RUN_THRESHOLD = 3
const FUNCTION_DOMINANCE_WARNING_SHARE = 55
const FUNCTION_DOMINANCE_BLOCKER_SHARE = 70

type RecallFreshnessState = {
  entityUpdateMap: Map<string, number[]>
  candidateNames: string[]
}

function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function sortChapterGateHistoryEntries(left: ChapterGateHistoryEntry, right: ChapterGateHistoryEntry): number {
  const leftTime = Date.parse(left.createdAt || '')
  const rightTime = Date.parse(right.createdAt || '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return right.id - left.id
}

function mapChapterGateRunRow(row: ChapterGateRunRow): ChapterGateHistoryEntry {
  return {
    id: row.id,
    novelId: row.novelId,
    chapterId: row.chapterId,
    chapterNum: row.chapterNum || 0,
    gateLevel: (row.gateLevel || 'warning') as ChapterGateHistoryEntry['gateLevel'],
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

function buildRecallFreshnessState(novelId: number): RecallFreshnessState {
  const db = getDb()
  const entityUpdateMap = new Map<string, number[]>()
  const characterNameById = new Map(
    db.select({
      id: characters.id,
      fullName: characters.fullName,
    }).from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, asText(row.fullName)] as const),
  )

  db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .all()
    .forEach((row) => {
      const name = characterNameById.get(row.characterId)
      if (!name) return
      entityUpdateMap.set(name, [...(entityUpdateMap.get(name) || []), row.chapterNum])
    })

  db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .all()
    .forEach((row) => {
      const name = asText(row.entityName)
      if (!name) return
      entityUpdateMap.set(name, [...(entityUpdateMap.get(name) || []), row.chapterNum])
    })

  entityUpdateMap.forEach((chapterNums, name) => {
    entityUpdateMap.set(name, dedupeNumbers(chapterNums))
  })

  return {
    entityUpdateMap,
    candidateNames: [...entityUpdateMap.keys()].sort((left, right) => right.length - left.length),
  }
}

function buildRecallQueryTextForDiagnostics(chapter: {
  title?: string | null
  summary?: string | null
  outline?: string | null
}): string {
  return [asText(chapter.title), asText(chapter.summary), asText(chapter.outline)]
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function buildHeuristicRecallDiagnostics(
  novelId: number,
  chapter: {
    chapterNum: number
    title?: string | null
    summary?: string | null
    outline?: string | null
  },
  freshnessState?: RecallFreshnessState,
): RecallDiagnostics {
  const state = freshnessState || buildRecallFreshnessState(novelId)
  const queryText = buildRecallQueryTextForDiagnostics(chapter)
  if (!queryText) {
    return {
      searchedBucketCount: 0,
      selectedBucketCount: 0,
      totalHitCount: 0,
      selectedHitCount: 0,
      staleRecallCount: 0,
      staleRecallRate: 0,
      recallDependencyRate: 0,
      overriddenHitCount: 0,
      fallbackHitCount: 0,
      summaryLines: ['当前章节缺少可用于召回的标题、摘要或大纲信号。'],
    }
  }

  const hits = fallbackKeywordSearch(novelId, queryText, 4)
    .filter((hit) => hit.chapterNum > 0 && hit.chapterNum < chapter.chapterNum)
  const sources = hits.map((hit) => {
    const staleReasons: string[] = []
    state.candidateNames
      .filter((name) => hit.fragmentText.includes(name))
      .slice(0, 4)
      .forEach((name) => {
        const chapterNums = state.entityUpdateMap.get(name) || []
        const hasIntermediateUpdate = chapterNums.some((num) => num > hit.chapterNum && num < chapter.chapterNum)
        if (hasIntermediateUpdate) {
          const latestBeforeChapter = chapterNums.filter((num) => num < chapter.chapterNum).at(-1) || 0
          staleReasons.push(`${name} 在第${latestBeforeChapter}章前已有更新，旧片段疑似过期`)
        }
      })
    return {
      stale: staleReasons.length > 0,
      summary: `${hit.fragmentType} · 第${hit.chapterNum}章`,
      staleReasons,
    }
  })
  const selectedHitCount = sources.filter((source) => !source.stale).slice(0, 2).length
  const staleRecallCount = sources.filter((source) => source.stale).length
  const totalHitCount = sources.length
  const staleRecallRate = totalHitCount > 0 ? Math.round((staleRecallCount / totalHitCount) * 100) : 0
  const recallDependencyRate = totalHitCount > 0 ? Math.round((selectedHitCount / totalHitCount) * 100) : 0

  return {
    searchedBucketCount: queryText ? 1 : 0,
    selectedBucketCount: selectedHitCount > 0 ? 1 : 0,
    totalHitCount,
    selectedHitCount,
    staleRecallCount,
    staleRecallRate,
    recallDependencyRate,
    overriddenHitCount: 0,
    fallbackHitCount: totalHitCount,
    summaryLines: [
      '诊断页中的召回可靠性使用本地关键词回查估算，不改变生成链路里的硬约束优先级。',
      totalHitCount > 0
        ? `命中历史片段 ${totalHitCount} 条，可继续作为背景补充 ${selectedHitCount} 条。`
        : '当前没有命中可用的历史片段。',
      staleRecallCount > 0
        ? `识别到 ${staleRecallCount} 条疑似过期片段，过期率 ${staleRecallRate}%。`
        : '当前未识别到疑似过期的历史片段。',
    ],
  }
}

function safeParseScores(json: string | null | undefined): {
  dimensions: QualityDimensionScore[]
  ai_like_rate: number
  overall_score: number
  weak_dimensions: string[]
  language_drift_metrics?: LanguageDriftMetrics
} | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.dimensions)) return null
    return parsed
  } catch {
    return null
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
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

function normalizeProtagonistSetback(value: unknown): ProtagonistSetbackLevel {
  return value === 'minor' || value === 'major' || value === 'none' ? value : 'none'
}

function normalizeCostResolutionState(value: unknown): CostResolutionState | undefined {
  return value === 'new' || value === 'ongoing' || value === 'resolved' || value === 'evaporated' ? value : undefined
}

function normalizeReversalSupportState(value: unknown): ReversalSupportState | undefined {
  return value === 'supported' || value === 'weak' || value === 'forced' ? value : undefined
}

function normalizePaceMarker(value: unknown): ChapterPacingMarker | undefined {
  return value === 'setup' || value === 'conflict' || value === 'reversal' || value === 'climax' || value === 'payoff' || value === 'breather'
    ? value
    : undefined
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

function normalizeRewardState(value: unknown): RewardState {
  return value === 'partial' || value === 'major' || value === 'none' ? value : 'none'
}

function emptyLanguageDrift(): LanguageDriftMetrics {
  return {
    abstractTokenDensity: 0,
    sentencePatternRepeatRate: 0,
    endingSummaryRate: 0,
    ornamentOverloadRate: 0,
    nonHumanCollocationRate: 0,
  }
}

function emptyLanguageDriftSeries(): LanguageDriftSeries {
  return {
    abstractTokenDensity: [],
    sentencePatternRepeatRate: [],
    endingSummaryRate: [],
    ornamentOverloadRate: [],
    nonHumanCollocationRate: [],
  }
}

function emptyPaceMarkerCounts(): Record<ChapterPacingMarker, number> {
  return { setup: 0, conflict: 0, reversal: 0, climax: 0, payoff: 0, breather: 0 }
}

function emptyChapterFunctionTagCounts(): Record<ChapterFunctionTag, number> {
  return {
    setup: 0,
    progression: 0,
    reversal: 0,
    payoff: 0,
    breather: 0,
    climax: 0,
    exposition: 0,
    closure: 0,
  }
}

function chapterFunctionLabel(tag?: ChapterFunctionTag): string {
  if (tag === 'setup') return '铺垫'
  if (tag === 'progression') return '推进'
  if (tag === 'reversal') return '反转'
  if (tag === 'payoff') return '回收'
  if (tag === 'breather') return '喘息'
  if (tag === 'climax') return '爆发'
  if (tag === 'exposition') return '解释'
  if (tag === 'closure') return '收束'
  return '未标注'
}

function qualityRiskLabel(kind: QualityDashboardRiskKind): string {
  return QUALITY_RISK_LABELS[kind]
}

function dashboardRiskSeverityRank(severity: QualityDashboardRiskSeverity): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function sortDashboardRisks(left: QualityDashboardRiskItem, right: QualityDashboardRiskItem): number {
  const leftMax = left.chapterNums[left.chapterNums.length - 1] || 0
  const rightMax = right.chapterNums[right.chapterNums.length - 1] || 0
  return dashboardRiskSeverityRank(right.severity) - dashboardRiskSeverityRank(left.severity)
    || rightMax - leftMax
    || left.title.localeCompare(right.title)
}

function toDashboardSeverityFromStoryAlert(severity: StoryDynamicsAlert['severity']): QualityDashboardRiskSeverity {
  return severity === 'blocker' ? 'critical' : 'warning'
}

function toDashboardSeverityFromChapterFunctionAlert(severity: ChapterFunctionAlert['severity']): QualityDashboardRiskSeverity {
  return severity === 'blocker' ? 'critical' : 'warning'
}

function toDashboardSeverityFromArcAlert(severity: QualityDashboardData['storyArcProgressAlerts'][number]['severity']): QualityDashboardRiskSeverity {
  if (severity === 'critical') return 'critical'
  if (severity === 'warning') return 'warning'
  return 'info'
}

function averageNumbers(values: number[]): number {
  if (values.length === 0) return 0
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function buildVolumeChapterRanges(
  volumeRows: Array<{ id: number; volumeNumber: number | null; title: string | null }>,
  rows: Array<{ chapterNum: number; volumeId: number | null }>,
): VolumeChapterRange[] {
  return volumeRows
    .map((volume) => {
      const chapterNums = rows
        .filter((row) => row.volumeId === volume.id)
        .map((row) => row.chapterNum)
      if (chapterNums.length === 0) return null
      return {
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: Math.min(...chapterNums),
        chapterEnd: Math.max(...chapterNums),
        chapterCount: chapterNums.length,
      }
    })
    .filter((item): item is VolumeChapterRange => Boolean(item))
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
}

function createDashboardRiskItem(
  kind: QualityDashboardRiskKind,
  severity: QualityDashboardRiskSeverity,
  title: string,
  detail: string,
  chapterNums: number[],
  volumeId?: number,
): QualityDashboardRiskItem {
  return {
    kind,
    severity,
    title,
    detail,
    chapterNums: dedupeChapterNums(chapterNums),
    volumeId,
  }
}

function emptyForeshadowCounts(): ForeshadowCounts {
  return { pending: 0, dueSoon: 0, overdue: 0, resolved: 0 }
}

function pickForeshadowChapterNum(card: {
  targetPayoffChapter?: number
  plantedChapter?: number
  startChapter?: number
}): number | undefined {
  return typeof card.targetPayoffChapter === 'number'
    ? card.targetPayoffChapter
    : typeof card.plantedChapter === 'number'
      ? card.plantedChapter
      : typeof card.startChapter === 'number'
        ? card.startChapter
        : undefined
}

function buildForeshadowCountsByVolume(
  snapshot: ReturnType<typeof getForeshadowSnapshot>,
  volumeRanges: VolumeChapterRange[],
): Map<number, ForeshadowCounts> {
  const countsByVolume = new Map<number, ForeshadowCounts>()
  const addToVolume = (volumeId: number, key: keyof ForeshadowCounts) => {
    const current = countsByVolume.get(volumeId) || emptyForeshadowCounts()
    current[key] += 1
    countsByVolume.set(volumeId, current)
  }

  const assignCards = (
    cards: Array<{ targetPayoffChapter?: number; plantedChapter?: number; startChapter?: number }>,
    key: keyof ForeshadowCounts,
  ) => {
    cards.forEach((card) => {
      const chapterNum = pickForeshadowChapterNum(card)
      if (typeof chapterNum !== 'number') return
      const range = volumeRanges.find((item) => chapterNum >= item.chapterStart && chapterNum <= item.chapterEnd)
      if (!range) return
      addToVolume(range.volumeId, key)
    })
  }

  assignCards(snapshot.pending, 'pending')
  assignCards(snapshot.dueSoon, 'dueSoon')
  assignCards(snapshot.overdue, 'overdue')
  assignCards(snapshot.resolved, 'resolved')
  return countsByVolume
}

function clampHealthScore(value: number): number {
  return clampNumber(value, 0, 100, 0)
}

function computeVolumeHealthScore(input: {
  averageAiLikeRate: number
  worseningMetricCount: number
  stalledArcCount: number
  criticalArcAlertCount: number
  rhythmBalanceScore: number
  repeatedFunctionRunCount: number
  storyAlertCount: number
  foreshadowDueSoonCount: number
  foreshadowOverdueCount: number
  endgameOverdueCount: number
  endgameUnboundCount: number
  staleRecallRate: number
  worldWarningCount: number
  worldConflictAlertCount: number
}): number {
  const aiPenalty = Math.min(24, input.averageAiLikeRate * 0.22 + input.worseningMetricCount * 4)
  const arcPenalty = Math.min(20, input.stalledArcCount * 6 + input.criticalArcAlertCount * 8)
  const rhythmPenalty = Math.min(20, Math.max(0, 75 - input.rhythmBalanceScore) * 0.25 + input.repeatedFunctionRunCount * 4 + input.storyAlertCount * 2)
  const foreshadowPenalty = Math.min(18, input.foreshadowOverdueCount * 7 + input.foreshadowDueSoonCount * 2)
  const endgamePenalty = Math.min(18, input.endgameOverdueCount * 8 + input.endgameUnboundCount * 3)
  const recallPenalty = Math.min(8, input.staleRecallRate * 0.12)
  const worldPenalty = Math.min(10, input.worldConflictAlertCount * 2 + input.worldWarningCount * 0.35)
  return clampHealthScore(100 - aiPenalty - arcPenalty - rhythmPenalty - foreshadowPenalty - endgamePenalty - recallPenalty - worldPenalty)
}

function computeNovelHealthScore(volumeEntries: VolumeQualityMetrics[], criticalRiskCount: number, warningRiskCount: number): number {
  if (volumeEntries.length === 0) return 0
  const volumeAverage = averageNumbers(volumeEntries.map((entry) => entry.healthScore))
  return clampHealthScore(volumeAverage - criticalRiskCount * 2 - warningRiskCount * 0.4)
}

function emptyStoryDynamics(): ChapterStoryDynamics {
  return {
    protagonistSetback: 'none',
    setbackSummary: '',
    costPresent: false,
    costSummary: '',
    costResolutionState: undefined,
    reversalMarker: false,
    reversalSummary: '',
    reversalSupportState: undefined,
    paceMarker: undefined,
    rewardState: 'none',
    protagonistPressure: 0,
  }
}

function emptyTimelineStoryHint(): TimelineStoryHint {
  return {
    hasConflict: false,
    hasReversal: false,
    hasClimax: false,
    hasPayoff: false,
    hasBreather: false,
    protagonistPresent: false,
  }
}

function emptyProtagonistSetbackSummary(): ProtagonistSetbackSummary {
  return {
    chapterCount: 0,
    protagonistSetbackRate: 0,
    majorSetbackRate: 0,
    averagePressure: 0,
    longestSmoothRun: 0,
    longestPressureRun: 0,
  }
}

function emptyCostPersistenceSummary(): CostPersistenceSummary {
  return {
    averageCostDuration: 0,
    evaporatedCostCount: 0,
    unresolvedCostCount: 0,
    activeCosts: [],
  }
}

function emptyReversalDistributionSummary(): ReversalDistributionSummary {
  return {
    reversalChapterNums: [],
    climaxChapterNums: [],
    breatherChapterNums: [],
    payoffChapterNums: [],
    forcedReversalCount: 0,
    weakReversalCount: 0,
    climaxSpacing: [],
    paceMarkerCounts: emptyPaceMarkerCounts(),
  }
}

function parseDialogueReview(raw?: string | null): ChapterDialogueReviewData | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const fingerprintSummary = asText(parsed.dialogue_fingerprint_summary)
    const risks = Array.isArray(parsed.dialogue_homogenization_risks)
      ? parsed.dialogue_homogenization_risks.map(asText).filter(Boolean)
      : []
    const similarities = Array.isArray(parsed.cross_character_similarity)
      ? parsed.cross_character_similarity
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterAId: typeof current.characterAId === 'number' ? current.characterAId : 0,
            characterAName: asText(current.characterAName),
            characterBId: typeof current.characterBId === 'number' ? current.characterBId : 0,
            characterBName: asText(current.characterBName),
            similarity: typeof current.similarity === 'number' ? current.similarity : 0,
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterAId > 0 && item.characterBId > 0 && item.characterAName && item.characterBName)
      : []
    const drifts = Array.isArray(parsed.dialogue_drift_alerts)
      ? parsed.dialogue_drift_alerts
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => {
          const current = item as Record<string, unknown>
          return {
            characterId: typeof current.characterId === 'number' ? current.characterId : 0,
            characterName: asText(current.characterName),
            driftRate: typeof current.driftRate === 'number' ? current.driftRate : 0,
            reason: asText(current.reason),
          }
        })
        .filter((item) => item.characterId > 0 && item.characterName)
      : []
    if (!fingerprintSummary && risks.length === 0 && similarities.length === 0 && drifts.length === 0) {
      return null
    }
    return {
      fingerprintSummary,
      risks,
      similarities,
      drifts,
    }
  } catch {
    return null
  }
}

function normalizeLanguageDrift(value: unknown): LanguageDriftMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const read = (key: LanguageDriftMetricKey) => typeof record[key] === 'number' && Number.isFinite(record[key]) ? Number(record[key]) : 0
  return {
    abstractTokenDensity: read('abstractTokenDensity'),
    sentencePatternRepeatRate: read('sentencePatternRepeatRate'),
    endingSummaryRate: read('endingSummaryRate'),
    ornamentOverloadRate: read('ornamentOverloadRate'),
    nonHumanCollocationRate: read('nonHumanCollocationRate'),
  }
}

function pushLanguageDriftMetrics(series: LanguageDriftSeries, chapterNum: number, metrics: LanguageDriftMetrics) {
  for (const { key } of LANGUAGE_DRIFT_METRICS) {
    series[key].push({ chapterNum, value: metrics[key] })
  }
}

function averageLanguageDrift(metricsList: LanguageDriftMetrics[]): LanguageDriftMetrics {
  if (metricsList.length === 0) return emptyLanguageDrift()
  const totals = emptyLanguageDrift()
  for (const metrics of metricsList) {
    totals.abstractTokenDensity += metrics.abstractTokenDensity
    totals.sentencePatternRepeatRate += metrics.sentencePatternRepeatRate
    totals.endingSummaryRate += metrics.endingSummaryRate
    totals.ornamentOverloadRate += metrics.ornamentOverloadRate
    totals.nonHumanCollocationRate += metrics.nonHumanCollocationRate
  }
  return {
    abstractTokenDensity: roundMetric(totals.abstractTokenDensity / metricsList.length),
    sentencePatternRepeatRate: roundMetric(totals.sentencePatternRepeatRate / metricsList.length),
    endingSummaryRate: roundMetric(totals.endingSummaryRate / metricsList.length),
    ornamentOverloadRate: roundMetric(totals.ornamentOverloadRate / metricsList.length),
    nonHumanCollocationRate: roundMetric(totals.nonHumanCollocationRate / metricsList.length),
  }
}

function averageTrendPoints(points: Array<{ chapterNum: number; value: number }>): number {
  if (points.length === 0) return 0
  return roundMetric(points.reduce((sum, point) => sum + point.value, 0) / points.length)
}

function toTrendStatus(delta: number): LanguageDriftTrendStatus {
  if (delta >= LANGUAGE_DRIFT_DELTA_THRESHOLD) return 'worsening'
  if (delta <= -LANGUAGE_DRIFT_DELTA_THRESHOLD) return 'improving'
  return 'stable'
}

function summarizeTrend(metric: LanguageDriftMetricKey, label: string, points: Array<{ chapterNum: number; value: number }>): LanguageDriftTrendSummary {
  if (points.length === 0) return { metric, label, latestValue: 0, previousValue: 0, delta: 0, status: 'stable' }
  if (points.length === 1) {
    const value = roundMetric(points[0].value)
    return { metric, label, latestValue: value, previousValue: value, delta: 0, status: 'stable' }
  }
  const windowPoints = points.slice(-RECENT_LANGUAGE_DRIFT_WINDOW)
  const splitIndex = Math.max(1, Math.floor(windowPoints.length / 2))
  const previousWindow = windowPoints.slice(0, splitIndex)
  const latestWindow = windowPoints.slice(splitIndex)
  const previousValue = averageTrendPoints(previousWindow)
  const latestValue = averageTrendPoints(latestWindow.length > 0 ? latestWindow : previousWindow)
  const delta = roundMetric(latestValue - previousValue)
  return { metric, label, latestValue, previousValue, delta, status: toTrendStatus(delta) }
}

function sortTrendSummaries(left: LanguageDriftTrendSummary, right: LanguageDriftTrendSummary): number {
  return right.delta - left.delta || right.latestValue - left.latestValue || left.label.localeCompare(right.label)
}

function rankLanguageDriftMetrics(metrics: LanguageDriftMetrics, limit = 3): LanguageDriftMetricSnapshot[] {
  return LANGUAGE_DRIFT_METRICS
    .map(({ key, label }) => ({ metric: key, label, value: roundMetric(metrics[key]) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}

function formatVolumeName(volumeId: number, volumeNumber: number | null | undefined, title: string | null | undefined): string {
  const safeTitle = typeof title === 'string' ? title.trim() : ''
  if (safeTitle) return safeTitle
  if (typeof volumeNumber === 'number' && Number.isFinite(volumeNumber)) return `第${volumeNumber}卷`
  return `卷 ${volumeId}`
}

function createVolumeAccumulator(volumeId: number, volumeNumber: number, volumeName: string): VolumeAccumulator {
  return { volumeId, volumeNumber, volumeName, chapterNums: [], metricsList: [], trends: emptyLanguageDriftSeries() }
}

function createVolumeStoryAccumulator(volumeId: number, volumeNumber: number, volumeName: string): VolumeStoryAccumulator {
  return { volumeId, volumeNumber, volumeName, chapters: [] }
}

function createVolumeChapterFunctionAccumulator(volumeId: number, volumeNumber: number, volumeName: string): VolumeChapterFunctionAccumulator {
  return { volumeId, volumeNumber, volumeName, chapters: [] }
}

function parseStoryDynamics(raw?: string | null): StoryDynamicsParseResult {
  if (!raw?.trim()) return { dynamics: emptyStoryDynamics(), explicit: false }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { dynamics: emptyStoryDynamics(), explicit: false }
    const record = parsed as Record<string, unknown>
    const explicit = STORY_DYNAMICS_KEYS.some((key) => Object.prototype.hasOwnProperty.call(record, key))
    const costPresent = normalizeBoolean(record.cost_present)
    const reversalMarker = normalizeBoolean(record.reversal_marker)
    return {
      explicit,
      dynamics: {
        protagonistSetback: normalizeProtagonistSetback(record.protagonist_setback),
        setbackSummary: asText(record.setback_summary),
        costPresent,
        costSummary: asText(record.cost_summary),
        costResolutionState: costPresent ? normalizeCostResolutionState(record.cost_resolution_state) : undefined,
        reversalMarker,
        reversalSummary: asText(record.reversal_summary),
        reversalSupportState: reversalMarker ? normalizeReversalSupportState(record.reversal_support_state) : undefined,
        paceMarker: normalizePaceMarker(record.pace_marker),
        rewardState: normalizeRewardState(record.reward_state),
        protagonistPressure: clampNumber(record.protagonist_pressure, 0, 100, 0),
      },
    }
  } catch {
    return { dynamics: emptyStoryDynamics(), explicit: false }
  }
}

function parseChapterFunction(raw?: string | null): ChapterFunctionParseResult {
  if (!raw?.trim()) return { primaryTag: undefined, tags: [], explicit: false }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { primaryTag: undefined, tags: [], explicit: false }
    const record = parsed as Record<string, unknown>
    const explicit = Object.prototype.hasOwnProperty.call(record, 'chapter_function_primary')
      || Object.prototype.hasOwnProperty.call(record, 'chapter_function_tags')
    const normalizedPrimaryTag = normalizeChapterFunctionTag(record.chapter_function_primary)
    const tags = normalizeChapterFunctionTags(record.chapter_function_tags)
    const primaryTag = normalizedPrimaryTag || tags[0]
    if (primaryTag && !tags.includes(primaryTag)) tags.unshift(primaryTag)
    return {
      primaryTag,
      tags,
      explicit,
    }
  } catch {
    return { primaryTag: undefined, tags: [], explicit: false }
  }
}

function hasTimelineHint(hint?: TimelineStoryHint | null): boolean {
  return Boolean(hint && (hint.hasConflict || hint.hasReversal || hint.hasClimax || hint.hasPayoff || hint.hasBreather || hint.protagonistPresent))
}

function mergeTimelineHint(current: TimelineStoryHint, incoming: TimelineStoryHint): TimelineStoryHint {
  return {
    hasConflict: current.hasConflict || incoming.hasConflict,
    hasReversal: current.hasReversal || incoming.hasReversal,
    hasClimax: current.hasClimax || incoming.hasClimax,
    hasPayoff: current.hasPayoff || incoming.hasPayoff,
    hasBreather: current.hasBreather || incoming.hasBreather,
    protagonistPresent: current.protagonistPresent || incoming.protagonistPresent,
  }
}

function enhanceStoryDynamics(base: ChapterStoryDynamics, hint?: TimelineStoryHint | null): ChapterStoryDynamics {
  if (!hint) return base
  const next: ChapterStoryDynamics = { ...base, setbackSummary: base.setbackSummary || '', costSummary: base.costSummary || '', reversalSummary: base.reversalSummary || '' }
  if (!next.paceMarker) {
    if (hint.hasClimax) next.paceMarker = 'climax'
    else if (hint.hasReversal) next.paceMarker = 'reversal'
    else if (hint.hasPayoff) next.paceMarker = 'payoff'
    else if (hint.hasBreather) next.paceMarker = 'breather'
    else if (hint.hasConflict) next.paceMarker = 'conflict'
  }
  if (!next.reversalMarker && hint.hasReversal) {
    next.reversalMarker = true
    next.reversalSummary = next.reversalSummary || '时间轴标记存在反转事件。'
  }
  if (next.rewardState === 'none' && hint.hasPayoff) next.rewardState = 'partial'
  if (next.protagonistSetback === 'none' && hint.protagonistPresent && (hint.hasConflict || hint.hasClimax || hint.hasReversal)) {
    next.protagonistSetback = hint.hasClimax ? 'major' : 'minor'
    next.setbackSummary = next.setbackSummary || '时间轴显示主角在本章承受了明显冲突压力。'
  }
  if (next.protagonistPressure === 0 && hint.protagonistPresent) {
    next.protagonistPressure = hint.hasClimax ? 85 : hint.hasReversal ? 75 : hint.hasConflict ? 60 : hint.hasPayoff ? 35 : 20
  }
  return next
}

function buildTimelineStoryHints(
  rows: Array<{
    eventType: string | null
    eventTitle: string
    eventSummary: string | null
    eventResult: string | null
    chapterStartId: number | null
    chapterEndId: number | null
    protagonistPresent: number | null
    protagonistAction: string | null
  }>,
  chapterNumById: Map<number, number>,
): Map<number, TimelineStoryHint> {
  const map = new Map<number, TimelineStoryHint>()
  for (const row of rows) {
    const startNum = row.chapterStartId ? chapterNumById.get(row.chapterStartId) : undefined
    const endNum = row.chapterEndId ? chapterNumById.get(row.chapterEndId) : undefined
    const chapterNums: number[] = []
    if (typeof startNum === 'number' && typeof endNum === 'number') {
      const minNum = Math.min(startNum, endNum)
      const maxNum = Math.max(startNum, endNum)
      for (let num = minNum; num <= maxNum; num += 1) chapterNums.push(num)
    } else if (typeof startNum === 'number') {
      chapterNums.push(startNum)
    } else if (typeof endNum === 'number') {
      chapterNums.push(endNum)
    }
    if (chapterNums.length === 0) continue
    const haystack = [row.eventType || '', row.eventTitle || '', row.eventSummary || '', row.eventResult || '', row.protagonistAction || ''].join(' ')
    const incoming: TimelineStoryHint = {
      hasConflict: /冲突|对抗|危机|追击|受挫|围攻/.test(haystack),
      hasReversal: /反转|逆转|翻盘/.test(haystack),
      hasClimax: /高潮|决战|爆发|终局|决胜/.test(haystack),
      hasPayoff: /回收|兑现|回报|收获/.test(haystack),
      hasBreather: /喘息|缓冲|休整|整备|平复/.test(haystack),
      protagonistPresent: row.protagonistPresent === 1 || Boolean(asText(row.protagonistAction)),
    }
    for (const chapterNum of chapterNums) {
      map.set(chapterNum, mergeTimelineHint(map.get(chapterNum) || emptyTimelineStoryHint(), incoming))
    }
  }
  return map
}

function toSetbackLevel(value: ProtagonistSetbackLevel): 0 | 1 | 2 {
  return value === 'major' ? 2 : value === 'minor' ? 1 : 0
}

function toRewardLevel(value: RewardState): 0 | 1 | 2 {
  return value === 'major' ? 2 : value === 'partial' ? 1 : 0
}

function isSmoothChapter(chapter: StoryDynamicsChapterRecord): boolean {
  return chapter.dynamics.protagonistSetback === 'none'
    && (chapter.dynamics.rewardState === 'partial' || chapter.dynamics.rewardState === 'major')
    && !chapter.dynamics.costPresent
}

function isPressureChapter(chapter: StoryDynamicsChapterRecord): boolean {
  return (chapter.dynamics.protagonistSetback !== 'none' || chapter.dynamics.protagonistPressure >= 60)
    && chapter.dynamics.rewardState === 'none'
}

function collectRunChapterNums(chaptersList: StoryDynamicsChapterRecord[], predicate: (chapter: StoryDynamicsChapterRecord) => boolean, minLength: number): number[][] {
  const runs: number[][] = []
  let current: number[] = []
  let lastChapterNum: number | null = null
  for (const chapter of chaptersList) {
    const matches = predicate(chapter)
    const contiguous = lastChapterNum !== null && chapter.chapterNum === lastChapterNum + 1
    if (!matches) {
      if (current.length >= minLength) runs.push(current)
      current = []
      lastChapterNum = chapter.chapterNum
      continue
    }
    if (current.length === 0 || contiguous) current.push(chapter.chapterNum)
    else {
      if (current.length >= minLength) runs.push(current)
      current = [chapter.chapterNum]
    }
    lastChapterNum = chapter.chapterNum
  }
  if (current.length >= minLength) runs.push(current)
  return runs
}

function longestRunLength(chaptersList: StoryDynamicsChapterRecord[], predicate: (chapter: StoryDynamicsChapterRecord) => boolean): number {
  return collectRunChapterNums(chaptersList, predicate, 1).reduce((max, run) => Math.max(max, run.length), 0)
}

function dedupeChapterNums(chapterNums: number[]): number[] {
  return [...new Set(chapterNums)].sort((left, right) => left - right)
}

function computeProtagonistSetbackSummary(chaptersList: StoryDynamicsChapterRecord[]): ProtagonistSetbackSummary {
  if (chaptersList.length === 0) return emptyProtagonistSetbackSummary()
  const setbackCount = chaptersList.filter((chapter) => chapter.dynamics.protagonistSetback !== 'none').length
  const majorSetbackCount = chaptersList.filter((chapter) => chapter.dynamics.protagonistSetback === 'major').length
  const totalPressure = chaptersList.reduce((sum, chapter) => sum + chapter.dynamics.protagonistPressure, 0)
  return {
    chapterCount: chaptersList.length,
    protagonistSetbackRate: roundMetric((setbackCount / chaptersList.length) * 100),
    majorSetbackRate: roundMetric((majorSetbackCount / chaptersList.length) * 100),
    averagePressure: roundMetric(totalPressure / chaptersList.length),
    longestSmoothRun: longestRunLength(chaptersList, isSmoothChapter),
    longestPressureRun: longestRunLength(chaptersList, isPressureChapter),
  }
}

function computeCostPersistence(chaptersList: StoryDynamicsChapterRecord[]): CostPersistenceSummary & { allEntries: CostDurationEntry[] } {
  if (chaptersList.length === 0) return { ...emptyCostPersistenceSummary(), allEntries: [] }
  const completed: CostDurationEntry[] = []
  const activeQueue: MutableCostRecord[] = []
  for (const chapter of chaptersList) {
    if (!chapter.dynamics.costPresent) continue
    const state = chapter.dynamics.costResolutionState || 'new'
    const summary = chapter.dynamics.costSummary || `第${chapter.chapterNum}章代价`
    if (state === 'new') {
      activeQueue.push({ startChapterNum: chapter.chapterNum, summary, seenContinuation: false })
      continue
    }
    if (state === 'ongoing') {
      if (activeQueue.length === 0) activeQueue.push({ startChapterNum: chapter.chapterNum, summary, seenContinuation: false })
      else {
        activeQueue[0].seenContinuation = activeQueue[0].seenContinuation || chapter.chapterNum > activeQueue[0].startChapterNum
        if (!activeQueue[0].summary) activeQueue[0].summary = summary
      }
      continue
    }
    const target = activeQueue.length > 0 ? activeQueue.shift()! : { startChapterNum: chapter.chapterNum, summary, seenContinuation: false }
    const duration = Math.max(1, chapter.chapterNum - target.startChapterNum + 1)
    const status: CostDurationEntry['status'] = state === 'evaporated' ? 'evaporated' : duration <= 2 && !target.seenContinuation ? 'evaporated' : 'resolved'
    completed.push({ startChapterNum: target.startChapterNum, endChapterNum: chapter.chapterNum, duration, status, summary: target.summary || summary })
  }
  const lastChapterNum = chaptersList[chaptersList.length - 1]?.chapterNum || 0
  const activeCosts = activeQueue
    .map((entry) => ({
      startChapterNum: entry.startChapterNum,
      duration: Math.max(1, lastChapterNum - entry.startChapterNum + 1),
      status: 'ongoing' as const,
      summary: entry.summary || `第${entry.startChapterNum}章代价`,
    }))
    .sort((left, right) => right.duration - left.duration || left.startChapterNum - right.startChapterNum)
  const allEntries = [...completed, ...activeCosts]
  return {
    averageCostDuration: allEntries.length > 0 ? roundMetric(allEntries.reduce((sum, entry) => sum + entry.duration, 0) / allEntries.length) : 0,
    evaporatedCostCount: completed.filter((entry) => entry.status === 'evaporated').length,
    unresolvedCostCount: activeCosts.length,
    activeCosts: activeCosts.slice(0, 3),
    allEntries,
  }
}

function computeReversalDistribution(chaptersList: StoryDynamicsChapterRecord[]): ReversalDistributionSummary {
  if (chaptersList.length === 0) return emptyReversalDistributionSummary()
  const paceMarkerCounts = emptyPaceMarkerCounts()
  const reversalChapterNums: number[] = []
  const climaxChapterNums: number[] = []
  const breatherChapterNums: number[] = []
  const payoffChapterNums: number[] = []
  let forcedReversalCount = 0
  let weakReversalCount = 0
  for (const chapter of chaptersList) {
    const { dynamics } = chapter
    if (dynamics.paceMarker) {
      paceMarkerCounts[dynamics.paceMarker] += 1
      if (dynamics.paceMarker === 'climax') climaxChapterNums.push(chapter.chapterNum)
      if (dynamics.paceMarker === 'breather') breatherChapterNums.push(chapter.chapterNum)
      if (dynamics.paceMarker === 'payoff') payoffChapterNums.push(chapter.chapterNum)
    }
    if (dynamics.reversalMarker || dynamics.paceMarker === 'reversal') {
      reversalChapterNums.push(chapter.chapterNum)
      if (dynamics.reversalSupportState === 'forced') forcedReversalCount += 1
      if (dynamics.reversalSupportState === 'weak') weakReversalCount += 1
    }
  }
  return {
    reversalChapterNums,
    climaxChapterNums,
    breatherChapterNums,
    payoffChapterNums,
    forcedReversalCount,
    weakReversalCount,
    climaxSpacing: climaxChapterNums.slice(1).map((chapterNum, index) => chapterNum - climaxChapterNums[index]),
    paceMarkerCounts,
  }
}

function sortStoryAlerts(left: StoryDynamicsAlert, right: StoryDynamicsAlert): number {
  const rank = (value: StoryDynamicsAlert['severity']) => (value === 'blocker' ? 2 : 1)
  const leftMax = left.chapterNums[left.chapterNums.length - 1] || 0
  const rightMax = right.chapterNums[right.chapterNums.length - 1] || 0
  return rank(right.severity) - rank(left.severity) || rightMax - leftMax || left.title.localeCompare(right.title)
}

function buildStoryPacingAlerts(chaptersList: StoryDynamicsChapterRecord[], costSummary?: CostPersistenceSummary & { allEntries: CostDurationEntry[] }): StoryDynamicsAlert[] {
  if (chaptersList.length === 0) return []
  const recentChapters = chaptersList.slice(-STORY_ALERT_WINDOW)
  const recentChapterNums = recentChapters.map((chapter) => chapter.chapterNum)
  const costState = costSummary || computeCostPersistence(chaptersList)
  const alerts: StoryDynamicsAlert[] = []
  collectRunChapterNums(recentChapters, isSmoothChapter, SMOOTH_RUN_THRESHOLD).forEach((run) => alerts.push({
    code: 'too_smooth',
    severity: 'warning',
    title: '主角近期顺推过多',
    detail: `最近连续 ${run.length} 章几乎没有真正受挫或代价，建议补出失败、损失或现实阻力。`,
    chapterNums: run,
  }))
  collectRunChapterNums(recentChapters, isPressureChapter, PRESSURE_RUN_THRESHOLD).forEach((run) => alerts.push({
    code: 'long_oppression_without_reward',
    severity: 'blocker',
    title: '长期压抑无回报',
    detail: `最近连续 ${run.length} 章主角都在承压却没有阶段性回报，建议插入喘息、收获或反击兑现。`,
    chapterNums: run,
  }))
  const forcedReversalNums = recentChapters.filter((chapter) => chapter.dynamics.reversalMarker && chapter.dynamics.reversalSupportState === 'forced').map((chapter) => chapter.chapterNum)
  if (forcedReversalNums.length > 0) alerts.push({
    code: 'forced_reversal',
    severity: 'warning',
    title: '近期存在强行反转',
    detail: '这些章节出现了支撑不足的反转，建议补齐触发原因、铺垫回收和角色选择链。',
    chapterNums: forcedReversalNums,
  })
  const evaporatedCosts = costState.allEntries.filter((entry) => entry.status === 'evaporated' && recentChapterNums.includes(entry.endChapterNum || entry.startChapterNum))
  if (evaporatedCosts.length > 0) alerts.push({
    code: 'cost_evaporation',
    severity: 'warning',
    title: '代价疑似蒸发',
    detail: `最近有 ${evaporatedCosts.length} 处重大代价在 1-2 章内被快速抹平，建议延续伤势、资源损耗或关系后果。`,
    chapterNums: dedupeChapterNums(evaporatedCosts.flatMap((entry) => [entry.startChapterNum, entry.endChapterNum || entry.startChapterNum])),
  })
  const recentClimaxNums = recentChapters.filter((chapter) => chapter.dynamics.paceMarker === 'climax').map((chapter) => chapter.chapterNum)
  const overcrowdedChapterNums = new Set<number>()
  for (let index = 1; index < recentClimaxNums.length; index += 1) {
    if (recentClimaxNums[index] - recentClimaxNums[index - 1] <= 2) {
      overcrowdedChapterNums.add(recentClimaxNums[index - 1])
      overcrowdedChapterNums.add(recentClimaxNums[index])
    }
  }
  if (overcrowdedChapterNums.size >= 2) alerts.push({
    code: 'climax_overcrowded',
    severity: 'warning',
    title: '高潮分布过密',
    detail: '最近 3 章内重复堆叠高潮，容易让后续失去爬升空间，建议留出缓冲或收尾段。',
    chapterNums: Array.from(overcrowdedChapterNums).sort((left, right) => left - right),
  })
  const allClimaxNums = chaptersList.filter((chapter) => chapter.dynamics.paceMarker === 'climax').map((chapter) => chapter.chapterNum)
  const latestChapterNum = chaptersList[chaptersList.length - 1]?.chapterNum || 0
  const latestClimaxNum = allClimaxNums[allClimaxNums.length - 1] || 0
  if (latestChapterNum > 0 && latestChapterNum - latestClimaxNum > CLIMAX_GAP_THRESHOLD) alerts.push({
    code: 'climax_gap_too_long',
    severity: 'warning',
    title: '高潮间隔过长',
    detail: `已经连续 ${latestChapterNum - latestClimaxNum} 章没有高潮节点，建议尽快安排冲突兑现或阶段性爆发。`,
    chapterNums: latestClimaxNum > 0 ? [latestClimaxNum, latestChapterNum] : [latestChapterNum],
  })
  return alerts.sort(sortStoryAlerts)
}

function sortChapterFunctionAlerts(left: ChapterFunctionAlert, right: ChapterFunctionAlert): number {
  const rank = (value: ChapterFunctionAlert['severity']) => (value === 'blocker' ? 2 : 1)
  const leftMax = left.chapterNums[left.chapterNums.length - 1] || 0
  const rightMax = right.chapterNums[right.chapterNums.length - 1] || 0
  return rank(right.severity) - rank(left.severity) || rightMax - leftMax || left.title.localeCompare(right.title)
}

function isKeyFunctionChapter(chapter: ChapterFunctionChapterRecord): boolean {
  return chapter.paceMarker === 'climax'
    || chapter.paceMarker === 'reversal'
    || chapter.paceMarker === 'payoff'
    || chapter.reversalMarker
}

function chapterFunctionRunLengthPenalty(run: ChapterFunctionRun): number {
  return Math.max(0, run.length - REPEATED_FUNCTION_RUN_THRESHOLD + 1) * 10
}

function dominantTagPenalty(share: number): number {
  return Math.max(0, share - 40) * 0.9
}

function coveragePenalty(coverage: number): number {
  return Math.max(0, 100 - coverage) * 0.35
}

function buildChapterFunctionTagCounts(chaptersList: ChapterFunctionChapterRecord[]): Record<ChapterFunctionTag, number> {
  const counts = emptyChapterFunctionTagCounts()
  for (const chapter of chaptersList) {
    const tags = chapter.tags.length > 0
      ? chapter.tags
      : chapter.primaryTag
        ? [chapter.primaryTag]
        : []
    for (const tag of tags) counts[tag] += 1
  }
  return counts
}

function buildPrimaryChapterFunctionCounts(chaptersList: ChapterFunctionChapterRecord[]): Record<ChapterFunctionTag, number> {
  const counts = emptyChapterFunctionTagCounts()
  for (const chapter of chaptersList) {
    if (chapter.primaryTag) counts[chapter.primaryTag] += 1
  }
  return counts
}

function getDominantPrimaryTag(
  counts: Record<ChapterFunctionTag, number>,
  trackedChapterCount: number,
): { dominantTag?: ChapterFunctionTag; dominantTagShare: number } {
  if (trackedChapterCount === 0) return { dominantTag: undefined, dominantTagShare: 0 }
  const dominantEntry = CHAPTER_FUNCTION_TAGS
    .map((tag) => ({ tag, count: counts[tag] }))
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))[0]
  if (!dominantEntry || dominantEntry.count === 0) return { dominantTag: undefined, dominantTagShare: 0 }
  return {
    dominantTag: dominantEntry.tag,
    dominantTagShare: roundMetric((dominantEntry.count / trackedChapterCount) * 100),
  }
}

function collectChapterFunctionRuns(chaptersList: ChapterFunctionChapterRecord[], minLength = REPEATED_FUNCTION_RUN_THRESHOLD): ChapterFunctionRun[] {
  const sorted = [...chaptersList].sort((left, right) => left.chapterNum - right.chapterNum)
  const runs: ChapterFunctionRun[] = []
  let currentTag: ChapterFunctionTag | undefined
  let currentChapterNums: number[] = []
  let lastChapterNum: number | null = null

  const flush = () => {
    if (currentTag && currentChapterNums.length >= minLength) {
      runs.push({
        primaryTag: currentTag,
        startChapterNum: currentChapterNums[0],
        endChapterNum: currentChapterNums[currentChapterNums.length - 1],
        length: currentChapterNums.length,
        chapterNums: [...currentChapterNums],
      })
    }
  }

  for (const chapter of sorted) {
    const primaryTag = chapter.primaryTag
    const contiguous = lastChapterNum !== null && chapter.chapterNum === lastChapterNum + 1
    if (!primaryTag) {
      flush()
      currentTag = undefined
      currentChapterNums = []
      lastChapterNum = chapter.chapterNum
      continue
    }
    if (currentTag === primaryTag && (currentChapterNums.length === 0 || contiguous)) {
      currentChapterNums.push(chapter.chapterNum)
    } else {
      flush()
      currentTag = primaryTag
      currentChapterNums = [chapter.chapterNum]
    }
    lastChapterNum = chapter.chapterNum
  }
  flush()
  return runs
}

function buildChapterFunctionRhythmBalanceScore(params: {
  totalChapterCount: number
  trackedChapterCount: number
  repeatedRuns: ChapterFunctionRun[]
  dominantTagShare: number
  weakKeyChapterCount: number
}): number {
  if (params.totalChapterCount === 0 || params.trackedChapterCount === 0) return 0
  const coverage = roundMetric((params.trackedChapterCount / params.totalChapterCount) * 100)
  const repeatedPenalty = params.repeatedRuns.reduce((sum, run) => sum + chapterFunctionRunLengthPenalty(run), 0)
  const score = 100
    - coveragePenalty(coverage)
    - repeatedPenalty
    - dominantTagPenalty(params.dominantTagShare)
    - (params.weakKeyChapterCount * 12)
  return clampNumber(score, 0, 100, 0)
}

function buildRepeatedFunctionAlerts(runs: ChapterFunctionRun[]): ChapterFunctionAlert[] {
  return runs.map((run) => ({
    code: 'repeated_function_run',
    severity: run.length >= 5 ? 'blocker' : 'warning',
    title: `连续 ${run.length} 章重复承担${chapterFunctionLabel(run.primaryTag)}`,
    detail: `第 ${run.startChapterNum} 到 ${run.endChapterNum} 章的主功能都偏向${chapterFunctionLabel(run.primaryTag)}，建议插入推进、回收、爆发或结构转向。`,
    chapterNums: run.chapterNums,
    primaryTag: run.primaryTag,
  }))
}

function buildVolumeFunctionSkewAlert(volume: {
  volumeId: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
  dominantTag?: ChapterFunctionTag
  dominantTagShare: number
}): ChapterFunctionAlert[] {
  if (!volume.dominantTag || volume.dominantTagShare < FUNCTION_DOMINANCE_WARNING_SHARE) return []
  return [{
    code: 'volume_function_skew',
    severity: volume.dominantTagShare >= FUNCTION_DOMINANCE_BLOCKER_SHARE ? 'blocker' : 'warning',
    title: `${volume.volumeName} 功能分布偏科`,
    detail: `${volume.volumeName} 的主功能有 ${volume.dominantTagShare}% 都落在${chapterFunctionLabel(volume.dominantTag)}，容易出现同质推进或空转。`,
    chapterNums: [volume.chapterStart, volume.chapterEnd],
    volumeId: volume.volumeId,
    primaryTag: volume.dominantTag,
  }]
}

function buildWeakKeyFunctionAlerts(chaptersList: ChapterFunctionChapterRecord[]): ChapterFunctionAlert[] {
  return chaptersList
    .filter((chapter) => isKeyFunctionChapter(chapter) && (!chapter.primaryTag || CHAPTER_FUNCTION_WEAK_TAGS.includes(chapter.primaryTag)))
    .map((chapter) => ({
      code: 'weak_key_chapter_function' as const,
      severity: 'warning' as const,
      title: `第${chapter.chapterNum}章关键功能偏弱`,
      detail: chapter.primaryTag
        ? `该章已被标记为关键节奏节点，但主功能仍然只是${chapterFunctionLabel(chapter.primaryTag)}，建议补出推进、回收、反转或爆发。`
        : '该章已被标记为关键节奏节点，但没有明确主功能标签，建议补出主功能并校正章节任务。',
      chapterNums: [chapter.chapterNum],
      volumeId: chapter.volumeId,
      primaryTag: chapter.primaryTag,
    }))
}

function buildChapterFunctionSummary(
  chaptersList: ChapterFunctionChapterRecord[],
  totalChapterCount: number,
): ChapterFunctionSummary {
  const trackedChapterCount = chaptersList.filter((chapter) => chapter.primaryTag || chapter.tags.length > 0).length
  const tagCounts = buildChapterFunctionTagCounts(chaptersList)
  const primaryCounts = buildPrimaryChapterFunctionCounts(chaptersList)
  const repeatedRuns = collectChapterFunctionRuns(chaptersList)
  const { dominantTag, dominantTagShare } = getDominantPrimaryTag(primaryCounts, trackedChapterCount)
  const weakKeyChapterCount = buildWeakKeyFunctionAlerts(chaptersList).length
  return {
    trackedChapterCount,
    chapterPurposeCoverage: totalChapterCount > 0 ? roundMetric((trackedChapterCount / totalChapterCount) * 100) : 0,
    rhythmBalanceScore: buildChapterFunctionRhythmBalanceScore({
      totalChapterCount,
      trackedChapterCount,
      repeatedRuns,
      dominantTagShare,
      weakKeyChapterCount,
    }),
    repeatedFunctionRunCount: repeatedRuns.length,
    longestRepeatedFunctionRun: repeatedRuns.reduce((max, run) => Math.max(max, run.length), 0),
    dominantTag,
    dominantTagShare,
    tagCounts,
  }
}

export function getQualityDashboardData(novelId: number, options: QualityDashboardOptions = {}): QualityDashboardData {
  const db = getDb()
  const includeDialogueInsights = options.includeDialogueInsights !== false
  const dialogueSnapshot = includeDialogueInsights ? getDialogueAnalyticsSnapshot(novelId) : {
    dialogueFingerprintStats: {
      analyzedCharacterCount: 0,
      eligibleCharacterCount: 0,
      chapterCount: 0,
      totalTurnCount: 0,
      attributedTurnCount: 0,
      unattributedTurnCount: 0,
      averageCrossCharacterSimilarity: 0,
      highSimilarityPairCount: 0,
      driftingCharacterCount: 0,
    },
    characterDialogueSignatures: [],
    crossCharacterDialogueSimilarity: [],
    dialogueDriftTrend: [],
    volumeDialogueSimilarity: [],
    recentDialogueAlerts: [],
  }
  if (includeDialogueInsights) {
    scheduleDialogueFingerprintRefresh(novelId)
  }
  const volumeRows = db.select({
    id: storyVolumes.id,
    volumeNumber: storyVolumes.volumeNumber,
    title: storyVolumes.title,
  }).from(storyVolumes).where(eq(storyVolumes.novelId, novelId)).orderBy(asc(storyVolumes.volumeNumber), asc(storyVolumes.id)).all()
  const storyArcProgressSnapshot = getStoryArcProgressSnapshot(novelId)
  const chapterArcProgressMap = storyArcProgressSnapshot.chapterPoints.reduce<Map<number, QualityDashboardData['chapterDetails'][number]['storyArcProgress']>>((result, point) => {
    const current = result.get(point.chapterId) || []
    current.push(point)
    result.set(point.chapterId, current)
    return result
  }, new Map())

  const volumeById = new Map(volumeRows.map((row) => [row.id, row] as const))
  const rows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
    summary: chapters.summary,
    outline: chapters.outline,
    volumeId: chapters.volumeId,
    aiScoreJson: chapters.aiScoreJson,
    reviewNotesJson: chapters.reviewNotesJson,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  const chapterGateHistoryByChapterId = db.select().from(chapterGateRuns)
    .where(eq(chapterGateRuns.novelId, novelId))
    .all()
    .map(mapChapterGateRunRow)
    .reduce<Map<number, ChapterGateHistoryEntry[]>>((result, entry) => {
      const current = result.get(entry.chapterId) || []
      current.push(entry)
      current.sort(sortChapterGateHistoryEntries)
      result.set(entry.chapterId, current)
      return result
    }, new Map())
  const latestChapterGateEntries = Array.from(chapterGateHistoryByChapterId.values())
    .map((history) => history[0])
    .filter((entry): entry is ChapterGateHistoryEntry => Boolean(entry))
    .sort((left, right) => left.chapterNum - right.chapterNum || sortChapterGateHistoryEntries(left, right))
  const chapterGateTrend: QualityDashboardData['chapterGateTrend'] = latestChapterGateEntries.map((entry) => ({
    chapterId: entry.chapterId,
    chapterNum: entry.chapterNum,
    totalScore: entry.scoreBreakdown.totalScore,
    gateLevel: entry.gateLevel,
    scoreBand: getChapterGateScoreBand(entry.scoreBreakdown.totalScore),
    createdAt: entry.createdAt,
  }))
  const chapterGateHeatmap: QualityDashboardData['chapterGateHeatmap'] = latestChapterGateEntries.flatMap((entry) => (
    getChapterGatePrimaryDimensions(entry.scoreBreakdown).map((dimension) => ({
      chapterId: entry.chapterId,
      chapterNum: entry.chapterNum,
      dimension: dimension.label,
      score: dimension.score,
      gateLevel: entry.gateLevel,
      scoreBand: getChapterGateScoreBand(entry.scoreBreakdown.totalScore),
      createdAt: entry.createdAt,
    }))
  ))
  const chapterGateDriftAlerts: QualityDashboardData['chapterGateDriftAlerts'] = Array.from(chapterGateHistoryByChapterId.values())
    .filter((history) => history.length > 1)
    .map((history) => buildChapterGateDriftAlert(history[0], history[1]))
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '') || right.chapterNum - left.chapterNum)
  const chapterGateSummary: QualityDashboardData['chapterGateSummary'] = latestChapterGateEntries.reduce<QualityDashboardData['chapterGateSummary']>((result, entry) => {
    const band = getChapterGateScoreBand(entry.scoreBreakdown.totalScore)
    result.coveredChapterCount += 1
    result.snapshotCount += chapterGateHistoryByChapterId.get(entry.chapterId)?.length || 0
    result.averageTotalScore += entry.scoreBreakdown.totalScore
    result.latestLevelCounts[entry.gateLevel] += 1
    if (band === 'stable') result.stableCount += 1
    if (band === 'attention') result.attentionCount += 1
    if (band === 'risky') result.riskyCount += 1
    if (band === 'unstable') result.unstableCount += 1
    return result
  }, {
    coveredChapterCount: 0,
    snapshotCount: 0,
    averageTotalScore: 0,
    stableCount: 0,
    attentionCount: 0,
    riskyCount: 0,
    unstableCount: 0,
    worseningAlertCount: chapterGateDriftAlerts.filter((alert) => alert.status === 'worsening').length,
    latestLevelCounts: {
      pass: 0,
      warning: 0,
      blocker: 0,
      rewrite: 0,
    },
  })
  if (chapterGateSummary.coveredChapterCount > 0) {
    chapterGateSummary.averageTotalScore = roundMetric(chapterGateSummary.averageTotalScore / chapterGateSummary.coveredChapterCount)
  }
  const volumeChapterRanges = buildVolumeChapterRanges(volumeRows, rows)
  const foreshadowSnapshot = getForeshadowSnapshot(novelId)
  const foreshadowCountsByVolume = buildForeshadowCountsByVolume(foreshadowSnapshot, volumeChapterRanges)
  const endgameDebtSnapshot = getEndgameDebtSnapshot(novelId)
  const endgameCountsByVolume = new Map(
    [...endgameDebtSnapshot.countsByVolume.entries()].map(([volumeId, counts]) => [volumeId, counts] as const),
  )

  const chapterNumById = new Map(rows.map((row) => [row.id, row.chapterNum] as const))
  const volumeIdByChapterNum = new Map(rows.flatMap((row) => (
    typeof row.volumeId === 'number'
      ? [[row.chapterNum, row.volumeId] as const]
      : []
  )))
  const timelineRows = db.select({
    eventType: timelineEvents.eventType,
    eventTitle: timelineEvents.eventTitle,
    eventSummary: timelineEvents.eventSummary,
    eventResult: timelineEvents.eventResult,
    chapterStartId: timelineEvents.chapterStartId,
    chapterEndId: timelineEvents.chapterEndId,
    protagonistPresent: timelineEvents.protagonistPresent,
    protagonistAction: timelineEvents.protagonistAction,
  }).from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const timelineHints = buildTimelineStoryHints(timelineRows, chapterNumById)
  const worldStateLedger = getWorldStateLedgerSnapshot(novelId, {
    entityLimit: 200,
    alertLimit: 256,
    conflictEntityLimit: 12,
  })
  const recallFreshnessState = buildRecallFreshnessState(novelId)
  const recallDiagnosticsByChapterId = new Map(rows.map((row) => [
    row.id,
    buildHeuristicRecallDiagnostics(novelId, {
      chapterNum: row.chapterNum,
      title: row.title,
      summary: row.summary,
      outline: row.outline,
    }, recallFreshnessState),
  ] as const))
  const recentWorldStateAlerts = worldStateLedger.alerts.slice(0, 8)
  const worldStateAlertMap = worldStateLedger.alerts.reduce<Map<number, WorldStateAlert[]>>((result, alert) => {
    const current = result.get(alert.chapterNum) || []
    current.push(alert)
    result.set(alert.chapterNum, current)
    return result
  }, new Map())

  const heatmapData: QualityDashboardData['heatmapData'] = []
  const overallScoreTrend: QualityDashboardData['overallScoreTrend'] = []
  const aiLikeRateTrend: QualityDashboardData['aiLikeRateTrend'] = []
  const languageDriftTrends = emptyLanguageDriftSeries()
  const weakDimFreq = new Map<string, number>()
  const chapterDetails: QualityDashboardData['chapterDetails'] = []
  const languageMetricsList: LanguageDriftMetrics[] = []
  const volumeAccumulators = new Map<number, VolumeAccumulator>()
  const trackedStoryChapters: StoryDynamicsChapterRecord[] = []
  const volumeStoryAccumulators = new Map<number, VolumeStoryAccumulator>()
  const chapterFunctionChapters: ChapterFunctionChapterRecord[] = []
  const volumeChapterFunctionAccumulators = new Map<number, VolumeChapterFunctionAccumulator>()
  const chapterFunctionDetailsByChapterId = new Map<number, { primaryTag?: ChapterFunctionTag; tags: ChapterFunctionTag[] }>()

  let totalOverall = 0
  let totalAiLike = 0
  let scoredCount = 0

  for (const row of rows) {
    const parsedStoryDynamics = parseStoryDynamics(row.reviewNotesJson)
    const storyDynamics = enhanceStoryDynamics(parsedStoryDynamics.dynamics, timelineHints.get(row.chapterNum))
    const hasStoryDynamics = parsedStoryDynamics.explicit || hasTimelineHint(timelineHints.get(row.chapterNum))
    const parsedChapterFunction = parseChapterFunction(row.reviewNotesJson)

    const chapterFunctionRecord: ChapterFunctionChapterRecord = {
      chapterId: row.id,
      chapterNum: row.chapterNum,
      title: row.title || `第 ${row.chapterNum} 章`,
      volumeId: typeof row.volumeId === 'number' ? row.volumeId : undefined,
      primaryTag: parsedChapterFunction.primaryTag,
      tags: parsedChapterFunction.tags,
      paceMarker: storyDynamics.paceMarker,
      reversalMarker: storyDynamics.reversalMarker,
    }
    chapterFunctionChapters.push(chapterFunctionRecord)
    if (parsedChapterFunction.primaryTag || parsedChapterFunction.tags.length > 0) {
      chapterFunctionDetailsByChapterId.set(row.id, {
        primaryTag: parsedChapterFunction.primaryTag,
        tags: parsedChapterFunction.tags,
      })
    }
    if (typeof row.volumeId === 'number') {
      const volumeMeta = volumeById.get(row.volumeId)
      const volumeNumber = volumeMeta?.volumeNumber ?? row.volumeId
      const volumeName = formatVolumeName(row.volumeId, volumeMeta?.volumeNumber, volumeMeta?.title)
      const accumulator = volumeChapterFunctionAccumulators.get(row.volumeId) || createVolumeChapterFunctionAccumulator(row.volumeId, volumeNumber, volumeName)
      accumulator.chapters.push(chapterFunctionRecord)
      volumeChapterFunctionAccumulators.set(row.volumeId, accumulator)
    }

    if (hasStoryDynamics) {
      const trackedChapter: StoryDynamicsChapterRecord = {
        chapterId: row.id,
        chapterNum: row.chapterNum,
        title: row.title || `第 ${row.chapterNum} 章`,
        volumeId: typeof row.volumeId === 'number' ? row.volumeId : undefined,
        dynamics: storyDynamics,
      }
      trackedStoryChapters.push(trackedChapter)
      if (typeof row.volumeId === 'number') {
        const volumeMeta = volumeById.get(row.volumeId)
        const volumeNumber = volumeMeta?.volumeNumber ?? row.volumeId
        const volumeName = formatVolumeName(row.volumeId, volumeMeta?.volumeNumber, volumeMeta?.title)
        const accumulator = volumeStoryAccumulators.get(row.volumeId) || createVolumeStoryAccumulator(row.volumeId, volumeNumber, volumeName)
        accumulator.chapters.push(trackedChapter)
        volumeStoryAccumulators.set(row.volumeId, accumulator)
      }
    }

    const scores = safeParseScores(row.aiScoreJson)
    const dialogueReview = parseDialogueReview(row.reviewNotesJson) || undefined
    let overallScore = 0
    let aiLikeRate = 0
    let weakDimensions: string[] = []
    let dimensions: AIScoreDimension[] = []
    let languageDriftMetrics: LanguageDriftMetrics | undefined

    if (scores) {
      scoredCount += 1
      overallScore = scores.overall_score ?? 0
      aiLikeRate = scores.ai_like_rate ?? 0
      weakDimensions = scores.weak_dimensions ?? []
      dimensions = scores.dimensions
      totalOverall += overallScore
      totalAiLike += aiLikeRate
      overallScoreTrend.push({ chapterNum: row.chapterNum, score: overallScore })
      aiLikeRateTrend.push({ chapterNum: row.chapterNum, rate: aiLikeRate })

      languageDriftMetrics = normalizeLanguageDrift(scores.language_drift_metrics) || undefined
      if (languageDriftMetrics) {
        languageMetricsList.push(languageDriftMetrics)
        pushLanguageDriftMetrics(languageDriftTrends, row.chapterNum, languageDriftMetrics)
        if (typeof row.volumeId === 'number') {
          const volumeMeta = volumeById.get(row.volumeId)
          const volumeNumber = volumeMeta?.volumeNumber ?? row.volumeId
          const volumeName = formatVolumeName(row.volumeId, volumeMeta?.volumeNumber, volumeMeta?.title)
          const accumulator = volumeAccumulators.get(row.volumeId) || createVolumeAccumulator(row.volumeId, volumeNumber, volumeName)
          accumulator.chapterNums.push(row.chapterNum)
          accumulator.metricsList.push(languageDriftMetrics)
          pushLanguageDriftMetrics(accumulator.trends, row.chapterNum, languageDriftMetrics)
          volumeAccumulators.set(row.volumeId, accumulator)
        }
      }

      scores.dimensions.forEach((dim) => heatmapData.push({ chapterNum: row.chapterNum, dimension: dim.name, score: dim.score }))
      ;(scores.weak_dimensions || []).forEach((dimension) => weakDimFreq.set(dimension, (weakDimFreq.get(dimension) || 0) + 1))
    }

    const chapterFunctionDetail = chapterFunctionDetailsByChapterId.get(row.id)
    const chapterGateHistory = chapterGateHistoryByChapterId.get(row.id) || []
    const latestChapterGate = chapterGateHistory[0]
    chapterDetails.push({
      chapterId: row.id,
      chapterNum: row.chapterNum,
      title: row.title || `第 ${row.chapterNum} 章`,
      volumeId: typeof row.volumeId === 'number' ? row.volumeId : undefined,
      overallScore: overallScore || (latestChapterGate ? roundMetric(latestChapterGate.scoreBreakdown.totalScore / 10) : 0),
      aiLikeRate,
      weakDimensions,
      dimensions,
      languageDriftMetrics,
      dialogueReview,
      storyDynamics: hasStoryDynamics ? storyDynamics : undefined,
      chapterFunction: chapterFunctionDetail
        ? {
          primaryTag: chapterFunctionDetail.primaryTag,
          tags: chapterFunctionDetail.tags,
          repeatedFunctionRunLength: 0,
        }
        : undefined,
      storyArcProgress: chapterArcProgressMap.get(row.id),
      worldStateAlerts: (worldStateAlertMap.get(row.chapterNum) || []).slice(0, 4),
      recallDiagnostics: recallDiagnosticsByChapterId.get(row.id),
      chapterGate: latestChapterGate
        ? {
          latest: latestChapterGate,
          history: chapterGateHistory.slice(0, 6),
          drift: chapterGateHistory.length > 1 ? buildChapterGateDriftSummary(chapterGateHistory[0], chapterGateHistory[1]) : undefined,
        }
        : undefined,
    })
  }

  const weakDimensionFrequency = [
    ...DIMENSION_NAMES.map((dimension) => ({ dimension, count: weakDimFreq.get(dimension) || 0 })),
    ...Array.from(weakDimFreq.entries()).filter(([dimension]) => !DIMENSION_NAMES.includes(dimension)).map(([dimension, count]) => ({ dimension, count })),
  ].sort((left, right) => right.count - left.count || left.dimension.localeCompare(right.dimension))

  const averageLanguageDriftMetrics = averageLanguageDrift(languageMetricsList)
  const languageDriftTrendSummaries = LANGUAGE_DRIFT_METRICS.map(({ key, label }) => summarizeTrend(key, label, languageDriftTrends[key]))
  const recentLanguageDriftAlerts = languageDriftTrendSummaries.filter((summary) => summary.status === 'worsening').sort(sortTrendSummaries)
  const volumeLanguageDrift: VolumeLanguageDriftEntry[] = Array.from(volumeAccumulators.values()).map((volume) => ({
    volumeId: volume.volumeId,
    volumeNumber: volume.volumeNumber,
    volumeName: volume.volumeName,
    chapterStart: Math.min(...volume.chapterNums),
    chapterEnd: Math.max(...volume.chapterNums),
    chapterCount: volume.chapterNums.length,
    averageMetrics: averageLanguageDrift(volume.metricsList),
    topWorseningMetrics: LANGUAGE_DRIFT_METRICS.map(({ key, label }) => summarizeTrend(key, label, volume.trends[key])).filter((summary) => summary.status === 'worsening').sort(sortTrendSummaries).slice(0, 2),
  })).sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)

  const novelLanguageDriftSummary: NovelLanguageDriftSummary = {
    chapterCount: languageMetricsList.length,
    recentWindowSize: Math.min(RECENT_LANGUAGE_DRIFT_WINDOW, languageMetricsList.length),
    statusBreakdown: languageDriftTrendSummaries.reduce<Record<LanguageDriftTrendStatus, number>>((result, summary) => {
      result[summary.status] += 1
      return result
    }, { worsening: 0, stable: 0, improving: 0 }),
    topRiskMetrics: rankLanguageDriftMetrics(averageLanguageDriftMetrics, 3),
  }

  const storyChapters = trackedStoryChapters.sort((left, right) => left.chapterNum - right.chapterNum)
  const protagonistSetbackSummary = computeProtagonistSetbackSummary(storyChapters)
  const costPersistenceState = computeCostPersistence(storyChapters)
  const reversalDistributionSummary = computeReversalDistribution(storyChapters)
  const storyPacingAlerts = buildStoryPacingAlerts(storyChapters, costPersistenceState)
  const storyDynamicsTrend: StoryDynamicsTrendPoint[] = storyChapters.map((chapter) => ({
    chapterId: chapter.chapterId,
    chapterNum: chapter.chapterNum,
    title: chapter.title,
    volumeId: chapter.volumeId,
    pressure: chapter.dynamics.protagonistPressure,
    setbackLevel: toSetbackLevel(chapter.dynamics.protagonistSetback),
    rewardLevel: toRewardLevel(chapter.dynamics.rewardState),
    paceMarker: chapter.dynamics.paceMarker,
    reversalMarker: chapter.dynamics.reversalMarker || chapter.dynamics.paceMarker === 'reversal',
    climaxMarker: chapter.dynamics.paceMarker === 'climax',
  }))
  const volumeStoryDynamics: VolumeStoryDynamicsEntry[] = Array.from(volumeStoryAccumulators.values()).map((volume) => {
    const setbackSummary = computeProtagonistSetbackSummary(volume.chapters)
    const volumeCost = computeCostPersistence(volume.chapters)
    const volumeReversal = computeReversalDistribution(volume.chapters)
    return {
      volumeId: volume.volumeId,
      volumeNumber: volume.volumeNumber,
      volumeName: volume.volumeName,
      chapterStart: volume.chapters[0]?.chapterNum || 0,
      chapterEnd: volume.chapters[volume.chapters.length - 1]?.chapterNum || 0,
      chapterCount: volume.chapters.length,
      protagonistSetbackRate: setbackSummary.protagonistSetbackRate,
      majorSetbackRate: setbackSummary.majorSetbackRate,
      averagePressure: setbackSummary.averagePressure,
      averageCostDuration: volumeCost.averageCostDuration,
      evaporatedCostCount: volumeCost.evaporatedCostCount,
      climaxChapterNums: volumeReversal.climaxChapterNums,
      reversalChapterNums: volumeReversal.reversalChapterNums,
      paceMarkerCounts: volumeReversal.paceMarkerCounts,
      alerts: buildStoryPacingAlerts(volume.chapters, volumeCost).slice(0, 3),
    }
  }).sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const chapterFunctionSummary = buildChapterFunctionSummary(chapterFunctionChapters, rows.length)
  const repeatedFunctionRuns = collectChapterFunctionRuns(chapterFunctionChapters)
  const repeatedFunctionRunMap = repeatedFunctionRuns.reduce<Map<number, ChapterFunctionRun>>((result, run) => {
    run.chapterNums.forEach((chapterNum) => result.set(chapterNum, run))
    return result
  }, new Map())
  const weakKeyFunctionAlerts = buildWeakKeyFunctionAlerts(chapterFunctionChapters)
  const weakKeyFunctionAlertMap = weakKeyFunctionAlerts.reduce<Map<number, ChapterFunctionAlert>>((result, alert) => {
    const chapterNum = alert.chapterNums[0]
    if (typeof chapterNum === 'number') result.set(chapterNum, alert)
    return result
  }, new Map())
  chapterDetails.forEach((detail) => {
    const current = detail.chapterFunction || {
      primaryTag: undefined,
      tags: [],
      repeatedFunctionRunLength: 0,
    }
    const repeatedRun = repeatedFunctionRunMap.get(detail.chapterNum)
    const weakKeyAlert = weakKeyFunctionAlertMap.get(detail.chapterNum)
    if (!current.primaryTag && current.tags.length === 0 && !repeatedRun && !weakKeyAlert) return
    detail.chapterFunction = {
      primaryTag: current.primaryTag,
      tags: current.tags,
      repeatedFunctionRunLength: repeatedRun?.length || 0,
      repeatedFunctionRange: repeatedRun,
      keyChapterRisk: weakKeyAlert
        ? (current.primaryTag ? 'weak_primary' : 'missing_primary')
        : undefined,
    }
  })
  const volumeChapterFunctions: VolumeChapterFunctionEntry[] = Array.from(volumeChapterFunctionAccumulators.values()).map((volume) => {
    const summary = buildChapterFunctionSummary(volume.chapters, volume.chapters.length)
    const repeatedRuns = collectChapterFunctionRuns(volume.chapters)
    const alerts = [
      ...buildRepeatedFunctionAlerts(repeatedRuns),
      ...buildWeakKeyFunctionAlerts(volume.chapters),
      ...buildVolumeFunctionSkewAlert({
        volumeId: volume.volumeId,
        volumeName: volume.volumeName,
        chapterStart: volume.chapters[0]?.chapterNum || 0,
        chapterEnd: volume.chapters[volume.chapters.length - 1]?.chapterNum || 0,
        dominantTag: summary.dominantTag,
        dominantTagShare: summary.dominantTagShare,
      }),
    ].sort(sortChapterFunctionAlerts)
    return {
      volumeId: volume.volumeId,
      volumeNumber: volume.volumeNumber,
      volumeName: volume.volumeName,
      chapterStart: volume.chapters[0]?.chapterNum || 0,
      chapterEnd: volume.chapters[volume.chapters.length - 1]?.chapterNum || 0,
      chapterCount: volume.chapters.length,
      trackedChapterCount: summary.trackedChapterCount,
      rhythmBalanceScore: summary.rhythmBalanceScore,
      dominantTag: summary.dominantTag,
      dominantTagShare: summary.dominantTagShare,
      tagCounts: summary.tagCounts,
      repeatedRuns,
      alerts: alerts.slice(0, 4),
    }
  }).sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const chapterFunctionAlerts: ChapterFunctionAlert[] = [
    ...buildRepeatedFunctionAlerts(repeatedFunctionRuns),
    ...weakKeyFunctionAlerts,
    ...(chapterFunctionSummary.dominantTag && chapterFunctionSummary.dominantTagShare >= FUNCTION_DOMINANCE_WARNING_SHARE
      ? [{
        code: 'volume_function_skew' as const,
        severity: chapterFunctionSummary.dominantTagShare >= FUNCTION_DOMINANCE_BLOCKER_SHARE ? 'blocker' as const : 'warning' as const,
        title: '全书功能分布偏科',
        detail: `当前主功能有 ${chapterFunctionSummary.dominantTagShare}% 都落在${chapterFunctionLabel(chapterFunctionSummary.dominantTag)}，建议补出推进层次和章节任务差异。`,
        chapterNums: rows.length > 0 ? [rows[0].chapterNum, rows[rows.length - 1].chapterNum] : [],
        primaryTag: chapterFunctionSummary.dominantTag,
      }]
      : []),
    ...volumeChapterFunctions.flatMap((entry) => entry.alerts.filter((alert) => alert.code === 'volume_function_skew')),
  ].sort(sortChapterFunctionAlerts)
  const storyArcProgressTrend: QualityDashboardData['storyArcProgressTrend'] = rows
    .map((row) => {
      const points = chapterArcProgressMap.get(row.id) || []
      if (points.length === 0) return null
      return {
        chapterNum: row.chapterNum,
        activeArcCount: points.length,
        progressCount: points.filter((point) => point.progressHit).length,
        stalledCount: points.filter((point) => point.stalled).length,
      }
    })
    .filter((item): item is NonNullable<QualityDashboardData['storyArcProgressTrend'][number]> => Boolean(item))
  const storyArcProgressSummary: QualityDashboardData['storyArcProgressSummary'] = {
    trackedArcCount: storyArcProgressSnapshot.arcs.length,
    coveredChapterCount: storyArcProgressSnapshot.chapterPoints.length,
    progressChapterCount: storyArcProgressSnapshot.chapterPoints.filter((point) => point.progressHit).length,
    stalledChapterCount: storyArcProgressSnapshot.chapterPoints.filter((point) => point.stalled).length,
    stalledArcCount: storyArcProgressSnapshot.arcs.filter((arc) => arc.stalledChapterCount >= 5 || arc.missedPhaseCount > 0).length,
    criticalAlertCount: storyArcProgressSnapshot.alerts.filter((alert) => alert.severity === 'critical').length,
  }
  const worldTrendByChapter = new Map(worldStateLedger.trend.map((point) => [point.chapterNum, point] as const))
  const volumeWorldStateStability: QualityDashboardData['volumeWorldStateStability'] = volumeRows
    .map((volume) => {
      const chapterNums = rows.filter((row) => row.volumeId === volume.id).map((row) => row.chapterNum)
      if (chapterNums.length === 0) return null
      const points = chapterNums.map((chapterNum) => worldTrendByChapter.get(chapterNum)).filter(Boolean)
      return {
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: Math.min(...chapterNums),
        chapterEnd: Math.max(...chapterNums),
        chapterCount: chapterNums.length,
        driftAlertCount: points.reduce((sum, point) => sum + (point?.driftCount || 0), 0),
        conflictAlertCount: points.reduce((sum, point) => sum + (point?.conflictCount || 0), 0),
        warningCount: points.reduce((sum, point) => sum + (point?.warningCount || 0), 0),
      }
    })
    .filter((item): item is NonNullable<QualityDashboardData['volumeWorldStateStability'][number]> => Boolean(item))
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const worldStateSummary: QualityDashboardData['worldStateSummary'] = {
    ...worldStateLedger.overview,
  }
  const recallEntries = rows.map((row) => ({
    chapterId: row.id,
    chapterNum: row.chapterNum,
    title: row.title || `第 ${row.chapterNum} 章`,
    volumeId: row.volumeId,
    diagnostics: recallDiagnosticsByChapterId.get(row.id) || buildHeuristicRecallDiagnostics(novelId, {
      chapterNum: row.chapterNum,
      title: row.title,
      summary: row.summary,
      outline: row.outline,
    }, recallFreshnessState),
  }))
  const previousChapterFeedReportsByChapterId = new Map(rows.map((row, index) => [
    row.id,
    buildPreviousChapterContextFeed(index > 0 ? rows[index - 1] : null).previousChapterSampleReport,
  ] as const))
  const previousChapterFeedReports = recallEntries
    .map((entry) => previousChapterFeedReportsByChapterId.get(entry.chapterId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.sourceChapterId))
  const analyzedRecallEntries = recallEntries.filter((entry) => entry.diagnostics.totalHitCount > 0)
  const recallSummary: QualityDashboardData['recallSummary'] = {
    analyzedChapterCount: analyzedRecallEntries.length,
    recallDependencyRate: analyzedRecallEntries.length > 0
      ? roundMetric(analyzedRecallEntries.reduce((sum, entry) => sum + entry.diagnostics.recallDependencyRate, 0) / analyzedRecallEntries.length)
      : 0,
    staleRecallCount: analyzedRecallEntries.reduce((sum, entry) => sum + entry.diagnostics.staleRecallCount, 0),
    staleRecallRate: analyzedRecallEntries.length > 0
      ? roundMetric(analyzedRecallEntries.reduce((sum, entry) => sum + entry.diagnostics.staleRecallRate, 0) / analyzedRecallEntries.length)
      : 0,
    fallbackHitCount: analyzedRecallEntries.reduce((sum, entry) => sum + entry.diagnostics.fallbackHitCount, 0),
    selectedHitCount: analyzedRecallEntries.reduce((sum, entry) => sum + entry.diagnostics.selectedHitCount, 0),
    previousChapterFeedCoverageRate: previousChapterFeedReports.length > 0
      ? roundMetric(previousChapterFeedReports.reduce((sum, entry) => sum + entry.coverageRate, 0) / previousChapterFeedReports.length)
      : 0,
    previousChapterFeedChars: previousChapterFeedReports.length > 0
      ? roundMetric(previousChapterFeedReports.reduce((sum, entry) => sum + entry.sampledChars, 0) / previousChapterFeedReports.length)
      : 0,
  }
  const recentRecallAlerts: QualityDashboardData['recentRecallAlerts'] = recallEntries
    .filter((entry) => entry.diagnostics.staleRecallCount > 0)
    .sort((left, right) => right.chapterNum - left.chapterNum || right.diagnostics.staleRecallCount - left.diagnostics.staleRecallCount)
    .slice(0, 8)
    .map((entry) => ({
      chapterId: entry.chapterId,
      chapterNum: entry.chapterNum,
      title: entry.title,
      staleRecallCount: entry.diagnostics.staleRecallCount,
      detail: entry.diagnostics.summaryLines.at(-1) || `识别到 ${entry.diagnostics.staleRecallCount} 条疑似过期片段。`,
    }))
  const volumeRecallDiagnostics: QualityDashboardData['volumeRecallDiagnostics'] = volumeRows
    .map((volume) => {
      const entries = recallEntries.filter((entry) => entry.volumeId === volume.id)
      if (entries.length === 0) return null
      return {
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: entries[0]?.chapterNum || 0,
        chapterEnd: entries[entries.length - 1]?.chapterNum || 0,
        chapterCount: entries.length,
        recallDependencyRate: roundMetric(entries.reduce((sum, entry) => sum + entry.diagnostics.recallDependencyRate, 0) / entries.length),
        staleRecallCount: entries.reduce((sum, entry) => sum + entry.diagnostics.staleRecallCount, 0),
        staleRecallRate: roundMetric(entries.reduce((sum, entry) => sum + entry.diagnostics.staleRecallRate, 0) / entries.length),
        previousChapterFeedCoverageRate: (() => {
          const feedReports = entries
            .map((entry) => previousChapterFeedReportsByChapterId.get(entry.chapterId))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.sourceChapterId))
          return feedReports.length > 0
            ? roundMetric(feedReports.reduce((sum, entry) => sum + entry.coverageRate, 0) / feedReports.length)
            : 0
        })(),
        previousChapterFeedChars: (() => {
          const feedReports = entries
            .map((entry) => previousChapterFeedReportsByChapterId.get(entry.chapterId))
            .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry && entry.sourceChapterId))
          return feedReports.length > 0
            ? roundMetric(feedReports.reduce((sum, entry) => sum + entry.sampledChars, 0) / feedReports.length)
            : 0
        })(),
      }
    })
    .filter((item): item is NonNullable<QualityDashboardData['volumeRecallDiagnostics'][number]> => Boolean(item))
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const volumeLanguageDriftById = new Map(volumeLanguageDrift.map((entry) => [entry.volumeId, entry] as const))
  const volumeStoryDynamicsById = new Map(volumeStoryDynamics.map((entry) => [entry.volumeId, entry] as const))
  const volumeChapterFunctionById = new Map(volumeChapterFunctions.map((entry) => [entry.volumeId, entry] as const))
  const volumeArcProgressById = new Map(storyArcProgressSnapshot.volumeEntries.map((entry) => [entry.volumeId, entry] as const))
  const volumeRecallById = new Map(volumeRecallDiagnostics.map((entry) => [entry.volumeId, entry] as const))
  const volumeWorldStateById = new Map(volumeWorldStateStability.map((entry) => [entry.volumeId, entry] as const))
  const volumeQualityMetrics: VolumeQualityMetrics[] = volumeChapterRanges.map((volumeRange) => {
    const chapterEntries = chapterDetails.filter((entry) => entry.volumeId === volumeRange.volumeId)
    const scoredChapterEntries = chapterEntries.filter((entry) => entry.dimensions.length > 0)
    const languageEntry = volumeLanguageDriftById.get(volumeRange.volumeId)
    const storyEntry = volumeStoryDynamicsById.get(volumeRange.volumeId)
    const functionEntry = volumeChapterFunctionById.get(volumeRange.volumeId)
    const arcEntry = volumeArcProgressById.get(volumeRange.volumeId)
    const recallEntry = volumeRecallById.get(volumeRange.volumeId)
    const worldEntry = volumeWorldStateById.get(volumeRange.volumeId)
    const foreshadowCounts = foreshadowCountsByVolume.get(volumeRange.volumeId) || emptyForeshadowCounts()
    const endgameCounts = endgameCountsByVolume.get(volumeRange.volumeId) || {
      pending: 0,
      served: 0,
      overdue: 0,
      fulfilled: 0,
      unbound: 0,
    }
    const arcAlerts = storyArcProgressSnapshot.alerts.filter((alert) => alert.volumeId === volumeRange.volumeId)
    const criticalArcAlertCount = arcAlerts.filter((alert) => alert.severity === 'critical').length
    const stalledArcCount = (arcEntry?.arcEntries || []).filter((entry) => entry.stallRate >= 50 || entry.missedPhaseLabels.length > 0).length
    const averageAiLikeRate = averageNumbers(scoredChapterEntries.map((entry) => entry.aiLikeRate))
    const averageOverallScore = averageNumbers(scoredChapterEntries.map((entry) => entry.overallScore))
    const worseningMetricCount = languageEntry?.topWorseningMetrics.length || 0
    const rhythmBalanceScore = functionEntry?.rhythmBalanceScore || 0
    const repeatedFunctionRunCount = functionEntry?.repeatedRuns.length || 0
    const worldWarningCount = worldEntry?.warningCount || 0
    const worldConflictAlertCount = worldEntry?.conflictAlertCount || 0
    const staleRecallCount = recallEntry?.staleRecallCount || 0
    const staleRecallRate = recallEntry?.staleRecallRate || 0
    const topRisks: QualityDashboardRiskItem[] = [
      ...(languageEntry?.topWorseningMetrics.slice(0, 2).map((metric) => createDashboardRiskItem(
        'language_drift',
        metric.delta >= 10 || metric.latestValue >= 60 ? 'critical' : 'warning',
        `${volumeRange.volumeName} 语言退化`,
        `${metric.label} 最近恶化 ${metric.delta > 0 ? `+${metric.delta}` : metric.delta}，当前值 ${metric.latestValue}。`,
        [volumeRange.chapterStart, volumeRange.chapterEnd],
        volumeRange.volumeId,
      )) || []),
      ...((storyEntry?.alerts || []).map((alert) => createDashboardRiskItem(
        'story_dynamics',
        toDashboardSeverityFromStoryAlert(alert.severity),
        alert.title,
        alert.detail,
        alert.chapterNums,
        volumeRange.volumeId,
      ))),
      ...((functionEntry?.alerts || []).map((alert) => createDashboardRiskItem(
        'chapter_function',
        toDashboardSeverityFromChapterFunctionAlert(alert.severity),
        alert.title,
        alert.detail,
        alert.chapterNums,
        volumeRange.volumeId,
      ))),
      ...arcAlerts.map((alert) => createDashboardRiskItem(
        'story_arc',
        toDashboardSeverityFromArcAlert(alert.severity),
        alert.title,
        alert.detail,
        alert.chapterNum ? [alert.chapterNum] : [volumeRange.chapterStart, volumeRange.chapterEnd],
        volumeRange.volumeId,
      )),
      ...(foreshadowCounts.overdue > 0
        ? [createDashboardRiskItem(
          'foreshadow_debt',
          'critical',
          `${volumeRange.volumeName} 有超期伏笔`,
          `本卷有 ${foreshadowCounts.overdue} 条伏笔已超过目标回收章位，建议优先兑现或回收。`,
          [volumeRange.chapterStart, volumeRange.chapterEnd],
          volumeRange.volumeId,
        )]
        : foreshadowCounts.dueSoon > 0
          ? [createDashboardRiskItem(
            'foreshadow_debt',
            'warning',
            `${volumeRange.volumeName} 伏笔接近到期`,
            `本卷有 ${foreshadowCounts.dueSoon} 条伏笔接近目标回收章位，建议尽快安排兑现。`,
            [volumeRange.chapterStart, volumeRange.chapterEnd],
            volumeRange.volumeId,
          )]
          : []),
      ...(endgameCounts.overdue > 0
        ? [createDashboardRiskItem(
          'endgame_debt',
          'critical',
          `${volumeRange.volumeName} 终局承诺失管`,
          `本卷关联的终局承诺中有 ${endgameCounts.overdue} 条已过期，另有 ${endgameCounts.unbound} 条仍未进入执行链。`,
          [volumeRange.chapterStart, volumeRange.chapterEnd],
          volumeRange.volumeId,
        )]
        : endgameCounts.unbound > 0
          ? [createDashboardRiskItem(
            'endgame_debt',
            'warning',
            `${volumeRange.volumeName} 存在未绑定终局承诺`,
            `本卷有 ${endgameCounts.unbound} 条终局承诺尚未被卷级设计、章节合同、场景合同或伏笔账本服务。`,
            [volumeRange.chapterStart, volumeRange.chapterEnd],
            volumeRange.volumeId,
          )]
          : []),
      ...(staleRecallCount > 0
        ? [createDashboardRiskItem(
          'recall',
          staleRecallRate >= 35 ? 'critical' : 'warning',
          `${volumeRange.volumeName} 存在过期召回`,
          `本卷识别到 ${staleRecallCount} 条过期召回，平均过期率 ${staleRecallRate}%。`,
          [volumeRange.chapterStart, volumeRange.chapterEnd],
          volumeRange.volumeId,
        )]
        : []),
      ...((worldEntry && (worldEntry.conflictAlertCount > 0 || worldEntry.warningCount > 0))
        ? [createDashboardRiskItem(
          'world_state',
          worldEntry.conflictAlertCount > 0 ? 'critical' : 'warning',
          `${volumeRange.volumeName} 状态稳定性波动`,
          `本卷状态冲突 ${worldEntry.conflictAlertCount} 次，预警 ${worldEntry.warningCount} 次。`,
          [volumeRange.chapterStart, volumeRange.chapterEnd],
          volumeRange.volumeId,
        )]
        : []),
    ].sort(sortDashboardRisks).slice(0, 6)
    return {
      volumeId: volumeRange.volumeId,
      volumeNumber: volumeRange.volumeNumber,
      volumeName: volumeRange.volumeName,
      chapterStart: volumeRange.chapterStart,
      chapterEnd: volumeRange.chapterEnd,
      chapterCount: volumeRange.chapterCount,
      analyzedChapterCount: scoredChapterEntries.length,
      healthScore: computeVolumeHealthScore({
        averageAiLikeRate,
        worseningMetricCount,
        stalledArcCount,
        criticalArcAlertCount,
        rhythmBalanceScore,
        repeatedFunctionRunCount,
        storyAlertCount: storyEntry?.alerts.length || 0,
        foreshadowDueSoonCount: foreshadowCounts.dueSoon,
        foreshadowOverdueCount: foreshadowCounts.overdue,
        endgameOverdueCount: endgameCounts.overdue,
        endgameUnboundCount: endgameCounts.unbound,
        staleRecallRate,
        worldWarningCount,
        worldConflictAlertCount,
      }),
      averageAiLikeRate,
      averageOverallScore,
      worseningMetricCount,
      stalledArcCount,
      criticalArcAlertCount,
      rhythmBalanceScore,
      repeatedFunctionRunCount,
      foreshadowPendingCount: foreshadowCounts.pending,
      foreshadowDueSoonCount: foreshadowCounts.dueSoon,
      foreshadowOverdueCount: foreshadowCounts.overdue,
      foreshadowResolvedCount: foreshadowCounts.resolved,
      endgamePendingCount: endgameCounts.pending,
      endgameServedCount: endgameCounts.served,
      endgameOverdueCount: endgameCounts.overdue,
      endgameUnboundCount: endgameCounts.unbound,
      staleRecallCount,
      staleRecallRate,
      worldWarningCount,
      worldConflictAlertCount,
      topRisks,
    }
  }).sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const globalRisks: QualityDashboardRiskItem[] = [
    ...recentLanguageDriftAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'language_drift',
      alert.delta >= 10 || alert.latestValue >= 60 ? 'critical' : 'warning',
      `全书${alert.label}恶化`,
      `${alert.label} 最近恶化 ${alert.delta > 0 ? `+${alert.delta}` : alert.delta}，当前值 ${alert.latestValue}。`,
      [],
    )),
    ...storyPacingAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'story_dynamics',
      toDashboardSeverityFromStoryAlert(alert.severity),
      alert.title,
      alert.detail,
      alert.chapterNums,
      volumeIdByChapterNum.get(alert.chapterNums[0] || 0),
    )),
    ...chapterFunctionAlerts
      .filter((alert) => !alert.volumeId)
      .slice(0, 3)
      .map((alert) => createDashboardRiskItem(
        'chapter_function',
        toDashboardSeverityFromChapterFunctionAlert(alert.severity),
        alert.title,
        alert.detail,
        alert.chapterNums,
        volumeIdByChapterNum.get(alert.chapterNums[0] || 0),
      )),
    ...endgameDebtSnapshot.recentAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'endgame_debt',
      alert.severity,
      alert.title,
      alert.detail,
      alert.targetResolutionChapter ? [alert.targetResolutionChapter] : [],
      alert.volumeId,
    )),
    ...recentRecallAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'recall',
      alert.staleRecallCount >= 3 ? 'critical' : 'warning',
      `第${alert.chapterNum}章召回风险`,
      alert.detail,
      [alert.chapterNum],
      volumeIdByChapterNum.get(alert.chapterNum),
    )),
    ...recentWorldStateAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'world_state',
      alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
      `${alert.entityName} 状态异常`,
      alert.summary,
      [alert.chapterNum],
      volumeIdByChapterNum.get(alert.chapterNum),
    )),
  ]
  const allRiskItems = [...volumeQualityMetrics.flatMap((entry) => entry.topRisks), ...globalRisks].sort(sortDashboardRisks)
  const criticalRiskCount = allRiskItems.filter((item) => item.severity === 'critical').length
  const warningRiskCount = allRiskItems.filter((item) => item.severity === 'warning').length
  const foreshadowPendingCount = foreshadowSnapshot.pending.length
  const foreshadowDueSoonCount = foreshadowSnapshot.dueSoon.length
  const foreshadowOverdueCount = foreshadowSnapshot.overdue.length
  const recentEndgameDebtAlerts = endgameDebtSnapshot.recentAlerts.map((alert) => ({
    ...alert,
    severity: alert.severity as 'warning' | 'critical',
  }))
  const riskOverview = (Object.keys(QUALITY_RISK_LABELS) as QualityDashboardRiskKind[]).map((kind) => ({
    kind,
    label: qualityRiskLabel(kind),
    count: allRiskItems.filter((item) => item.kind === kind).length,
  }))
  const novelQualityMetrics: NovelQualityMetrics = {
    healthScore: computeNovelHealthScore(volumeQualityMetrics, criticalRiskCount, warningRiskCount),
    totalVolumeCount: volumeQualityMetrics.length,
    totalChapterCount: rows.length,
    analyzedChapterCount: scoredCount,
    criticalRiskCount,
    warningRiskCount,
    foreshadowPendingCount,
    foreshadowDueSoonCount,
    foreshadowOverdueCount,
    endgameActiveCount: endgameDebtSnapshot.overview.activeCount,
    endgameServedCount: endgameDebtSnapshot.overview.servedCount,
    endgameOverdueCount: endgameDebtSnapshot.overview.overdueCount,
    endgameUnboundCount: endgameDebtSnapshot.overview.unboundCount,
    riskOverview,
    topRisks: allRiskItems.slice(0, 8),
    recommendedFocusVolumes: volumeQualityMetrics
      .filter((entry) => entry.topRisks.length > 0 || entry.healthScore < 80)
      .sort((left, right) => left.healthScore - right.healthScore || right.topRisks.length - left.topRisks.length)
      .slice(0, 4)
      .map((entry) => ({
        volumeId: entry.volumeId,
        volumeNumber: entry.volumeNumber,
        volumeName: entry.volumeName,
        healthScore: entry.healthScore,
        summary: entry.topRisks[0]?.title || `${entry.volumeName} 当前健康分 ${entry.healthScore}，建议优先回查。`,
      })),
  }

  return {
    heatmapData,
    overallScoreTrend,
    aiLikeRateTrend,
    chapterGateTrend,
    chapterGateHeatmap,
    chapterGateSummary,
    chapterGateDriftAlerts,
    languageDriftTrends,
    averageLanguageDrift: averageLanguageDriftMetrics,
    recentLanguageDriftAlerts,
    volumeLanguageDrift,
    novelLanguageDriftSummary,
    dialogueFingerprintStats: dialogueSnapshot.dialogueFingerprintStats,
    characterDialogueSignatures: dialogueSnapshot.characterDialogueSignatures,
    crossCharacterDialogueSimilarity: dialogueSnapshot.crossCharacterDialogueSimilarity,
    dialogueDriftTrend: dialogueSnapshot.dialogueDriftTrend,
    volumeDialogueSimilarity: dialogueSnapshot.volumeDialogueSimilarity,
    recentDialogueAlerts: dialogueSnapshot.recentDialogueAlerts,
    storyDynamicsTrend,
    storyPacingAlerts,
    volumeStoryDynamics,
    volumeQualityMetrics,
    novelQualityMetrics,
    chapterFunctionSummary,
    repeatedFunctionRuns,
    chapterFunctionAlerts,
    volumeChapterFunctions,
    storyArcProgressSummary,
    storyArcProgressTrend,
    storyArcProgressArcs: storyArcProgressSnapshot.arcs,
    storyArcProgressAlerts: storyArcProgressSnapshot.alerts,
    storyArcProgressVolumes: storyArcProgressSnapshot.volumeEntries,
    worldStateTrend: worldStateLedger.trend,
    recentWorldStateAlerts,
    worldConflictEntities: worldStateLedger.conflictEntities,
    recallSummary,
    recentRecallAlerts,
    recentEndgameDebtAlerts,
    volumeRecallDiagnostics,
    volumeWorldStateStability,
    worldStateSummary,
    protagonistSetbackSummary,
    costPersistenceSummary: {
      averageCostDuration: costPersistenceState.averageCostDuration,
      evaporatedCostCount: costPersistenceState.evaporatedCostCount,
      unresolvedCostCount: costPersistenceState.unresolvedCostCount,
      activeCosts: costPersistenceState.activeCosts,
    },
    reversalDistributionSummary,
    weakDimensionFrequency,
    chapterDetails,
    totalChaptersScored: scoredCount,
    averageOverallScore: scoredCount > 0 ? roundMetric(totalOverall / scoredCount) : 0,
    averageAiLikeRate: scoredCount > 0 ? roundMetric(totalAiLike / scoredCount) : 0,
  }
}
