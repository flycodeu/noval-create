import { asc, desc, eq } from 'drizzle-orm'
import type {
  AIScoreDimension,
  ChapterBatchAutoGenerateStatus,
  ChapterGateHistoryEntry,
  ChapterDialogueReviewData,
  ExpressionDedupHit,
  ExpressionDedupMode,
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
  QualityRepairAction,
  QualityRepairMetricKey,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallSnapshot,
  ReversalDistributionSummary,
  ReversalSupportState,
  RewardState,
  StoryDynamicsAlert,
  StoryDynamicsTrendPoint,
  StyleComplianceResult,
  SummaryHealthReport,
  VolumeLanguageDriftEntry,
  VolumeChapterFunctionEntry,
  VolumeQualityMetrics,
  VolumeStoryDynamicsEntry,
  VoiceEvolutionProfile,
  WorldStateAlert,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  chapterBatchInspections,
  chapterBatchSnapshots,
  chapterGateRuns,
  chapterWritebackRuns,
  chapters,
  characterStateVersions,
  characters,
  revisionTasks,
  storyFacts,
  storyMemoryCheckpoints,
  storyVolumes,
  tasks,
  timelineEvents,
  worldStateVersions,
} from '../database/schema'
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
import { buildVoiceEvolutionProfiles } from './generation-integrity.service'
import { fallbackKeywordSearch } from './embedding.service'
import { getEndgameDebtSnapshot } from './endgame-asset.service'
import { listChapterRecallRuntimeMap } from './chapter-recall-runtime.service'
import { getStoryArcProgressSnapshot } from './story-arc-progress.service'
import { getForeshadowSnapshot } from './story-thread.service'
import { getWorldStateLedgerSnapshot } from './world-state.service'
import { getAntiAiDashboardSummary } from './anti-ai-rule.service'
import { getFeedbackRecurrenceDashboardSummary } from './feedback-recurrence.service'
import { parseChapterContractValidationFromReviewNotes } from './chapter-contract-validator.service'
import { parseTaskProgress } from './task.service'

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
  commitment_delivery: '承诺兑现率',
  language_drift: 'AI味退化',
  feedback_recurrence: '审校复现',
  style_compliance: '风格硬约束',
  voice_distinction: '角色声音区分度',
  growth_cost_balance: '成长-代价平衡',
  story_dynamics: '主角与节奏',
  chapter_function: '章节功能',
  story_arc: '故事弧推进',
  foreshadow_debt: '伏笔债务',
  endgame_debt: '终局债务',
  recall: '召回可靠性',
  world_state: '状态稳定性',
  info_reveal_pacing: '信息揭示节奏',
}
const QUALITY_REPAIR_METRIC_LABELS: Record<QualityRepairMetricKey, string> = {
  commitment_delivery: '承诺兑现率',
  voice_distinction: '角色声音区分度',
  growth_cost_balance: '成长-代价平衡',
  foreshadow_debt: '伏笔债务压力',
  world_state_drift: '世界状态漂移',
  info_reveal_pacing: '信息揭示节奏',
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

function dedupeStrings(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = asText(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return typeof limit === 'number' ? result.slice(0, limit) : result
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

function buildRecallBucketCoverageRate(snapshot?: RecallSnapshot): number {
  if (!snapshot) return 0
  const buckets = Object.values(snapshot.bucketStats || {})
  if (buckets.length === 0) return 0
  const covered = buckets.filter((bucket) => bucket.hitCount > 0).length
  return roundMetric((covered / buckets.length) * 100)
}

function pickLatestRecallFallbackReason(
  snapshots: Array<RecallSnapshot | undefined>,
): RecallFallbackReason | undefined {
  return snapshots
    .map((snapshot) => snapshot?.fallbackReason)
    .find((reason): reason is RecallFallbackReason => Boolean(reason))
}

function getConsecutiveRecallFallbackCount(entries: Array<{ snapshot?: RecallSnapshot }>): number {
  let count = 0
  for (const entry of entries) {
    if (!entry.snapshot?.degraded) break
    count += 1
  }
  return count
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
      return '未记录'
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

function parseJsonObject<T extends Record<string, unknown>>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : null
  } catch {
    return null
  }
}

function parseSummaryHealthReport(raw: string | null | undefined): SummaryHealthReport | null {
  const parsed = parseJsonObject<Record<string, unknown>>(raw)
  if (!parsed) return null
  const status = parsed.status === 'healthy' || parsed.status === 'warning' || parsed.status === 'degraded'
    ? parsed.status
    : 'warning'
  return {
    status,
    densityScore: clampNumber(parsed.densityScore, 0, 100, 0),
    entityCoverageScore: clampNumber(parsed.entityCoverageScore, 0, 100, 0),
    eventCoverageScore: clampNumber(parsed.eventCoverageScore, 0, 100, 0),
    recentWindowSize: clampNumber(parsed.recentWindowSize, 0, 100, 0),
    warnings: safeParseStringArray(JSON.stringify(parsed.warnings ?? [])),
    triggeredRecompression: normalizeBoolean(parsed.triggeredRecompression),
    recompressionReason: asText(parsed.recompressionReason),
    focusEntities: safeParseStringArray(JSON.stringify(parsed.focusEntities ?? [])),
    summaryPreview: asText(parsed.summaryPreview),
    updatedAt: asText(parsed.updatedAt),
  }
}

function parseExpressionDedupJson(raw: string | null | undefined): {
  mode: ExpressionDedupMode
  recentWindowSize: number
  volumeWindowSize: number
  globalSampleWindowSize: number
  riskLevel: 'low' | 'medium' | 'high'
  repeatedPhrases: ExpressionDedupHit[]
  repeatedOpenings: string[]
  repeatedClosings: string[]
  repeatedStructuralPatterns: string[]
  repeatedClimaxPatterns: string[]
  volumeRepeatedPatterns: string[]
  globalRepeatedPatterns: string[]
  summary: string
} | null {
  const parsed = parseJsonObject<Record<string, unknown>>(raw)
  if (!parsed) return null
  const repeatedPhrases = Array.isArray(parsed.repeatedPhrases)
    ? parsed.repeatedPhrases
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const record = entry as Record<string, unknown>
          return {
            phrase: asText(record.phrase),
            count: clampNumber(record.count, 0, 999, 0),
            chapterNums: Array.isArray(record.chapterNums)
              ? record.chapterNums.map((item) => clampNumber(item, 0, 99999, 0)).filter((item) => item > 0)
              : [],
          }
        })
        .filter((entry): entry is ExpressionDedupHit => Boolean(entry?.phrase))
    : []
  const riskLevel = parsed.riskLevel === 'high' || parsed.riskLevel === 'medium' || parsed.riskLevel === 'low'
    ? parsed.riskLevel
    : 'low'
  return {
    mode: parsed.mode === 'longform' ? 'longform' : 'short',
    recentWindowSize: clampNumber(parsed.recentWindowSize, 0, 999, 0),
    volumeWindowSize: clampNumber(parsed.volumeWindowSize, 0, 999, 0),
    globalSampleWindowSize: clampNumber(parsed.globalSampleWindowSize, 0, 999, 0),
    riskLevel,
    repeatedPhrases,
    repeatedOpenings: safeParseStringArray(JSON.stringify(parsed.repeatedOpenings ?? [])),
    repeatedClosings: safeParseStringArray(JSON.stringify(parsed.repeatedClosings ?? [])),
    repeatedStructuralPatterns: safeParseStringArray(JSON.stringify(parsed.repeatedStructuralPatterns ?? [])),
    repeatedClimaxPatterns: safeParseStringArray(JSON.stringify(parsed.repeatedClimaxPatterns ?? [])),
    volumeRepeatedPatterns: safeParseStringArray(JSON.stringify(parsed.volumeRepeatedPatterns ?? [])),
    globalRepeatedPatterns: safeParseStringArray(JSON.stringify(parsed.globalRepeatedPatterns ?? [])),
    summary: asText(parsed.summary),
  }
}

function parseHookContinuityJson(raw: string | null | undefined): {
  hookStrengthScore: number
  weakHookStreak: number
  recentHookTypes: string[]
  warning: string
} | null {
  const parsed = parseJsonObject<Record<string, unknown>>(raw)
  if (!parsed) return null
  return {
    hookStrengthScore: clampNumber(parsed.hookStrengthScore, 0, 100, 0),
    weakHookStreak: clampNumber(parsed.weakHookStreak, 0, 99, 0),
    recentHookTypes: safeParseStringArray(JSON.stringify(parsed.recentHookTypes ?? [])),
    warning: asText(parsed.warning),
  }
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

function buildDashboardRiskIdentity(item: QualityDashboardRiskItem): string {
  return [
    item.metricKey || '',
    item.kind,
    item.severity,
    item.volumeId || '',
    item.title,
    item.detail,
    item.chapterNums.join(','),
  ].join('::')
}

function dedupeDashboardRiskItems(items: QualityDashboardRiskItem[]): QualityDashboardRiskItem[] {
  const seen = new Map<string, QualityDashboardRiskItem>()
  items.forEach((item) => {
    const key = buildDashboardRiskIdentity(item)
    if (!seen.has(key)) seen.set(key, item)
  })
  return [...seen.values()]
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

function hasThreeRuleHitsWithinFiveChapters(chapterNums: number[]): boolean {
  const sorted = [...new Set(chapterNums)].sort((left, right) => left - right)
  for (let index = 0; index <= sorted.length - 3; index += 1) {
    if (sorted[index + 2] - sorted[index] <= 4) return true
  }
  return false
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

function defaultMetricKeyForRisk(kind: QualityDashboardRiskKind): QualityRepairMetricKey | undefined {
  switch (kind) {
    case 'commitment_delivery':
    case 'endgame_debt':
      return 'commitment_delivery'
    case 'voice_distinction':
      return 'voice_distinction'
    case 'growth_cost_balance':
    case 'story_dynamics':
      return 'growth_cost_balance'
    case 'foreshadow_debt':
      return 'foreshadow_debt'
    case 'world_state':
      return 'world_state_drift'
    case 'info_reveal_pacing':
      return 'info_reveal_pacing'
    default:
      return undefined
  }
}

function defaultRelatedPageForRisk(kind: QualityDashboardRiskKind): string {
  switch (kind) {
    case 'world_state':
      return 'timeline'
    case 'foreshadow_debt':
    case 'endgame_debt':
    case 'commitment_delivery':
      return 'outline'
    default:
      return 'writing'
  }
}

function qualityRepairMetricLabel(metricKey: QualityRepairMetricKey): string {
  return QUALITY_REPAIR_METRIC_LABELS[metricKey]
}

function toRepairTaskSeverity(severity: QualityDashboardRiskSeverity): 'high' | 'medium' | 'low' {
  if (severity === 'critical') return 'high'
  if (severity === 'warning') return 'medium'
  return 'low'
}

function buildDefaultRiskWhyItHappened(kind: QualityDashboardRiskKind, detail: string): string {
  switch (kind) {
    case 'commitment_delivery':
    case 'endgame_debt':
      return detail || '承诺没有稳定进入卷级设计、章节合同和实际正文执行链，导致兑现节点开始漂移。'
    case 'voice_distinction':
      return detail || '对白指纹、角色声音锁和近期审校信号出现重叠，角色说话方式开始同质化。'
    case 'growth_cost_balance':
    case 'story_dynamics':
      return detail || '成长收益、主角受挫和代价持续性没有保持同步，导致剧情推进出现“只拿收益”或“只压不收”的失衡。'
    case 'foreshadow_debt':
      return detail || '伏笔已进入应回收窗口，但合同推进、桥段铺设或延期说明没有及时跟上。'
    case 'world_state':
      return detail || '正文状态变更、章后回写和状态总账之间没有保持一致，出现漂移或冲突。'
    case 'info_reveal_pacing':
      return detail || '事实的读者知情、主角知情与计划揭示节奏发生错位，导致揭示过早或过晚。'
    case 'recall':
      return detail || '章节生成依赖的历史片段出现降级、缺失或过期，当前上下文稳定性不足。'
    default:
      return detail || '当前指标已经跨过预警阈值，需要把问题定位到具体章节和修复链路。'
  }
}

function buildDefaultRiskHowToFix(kind: QualityDashboardRiskKind): string {
  switch (kind) {
    case 'commitment_delivery':
    case 'endgame_debt':
      return '先补齐卷承诺与章节合同绑定，再把兑现或推进动作落到具体章节任务。'
    case 'voice_distinction':
      return '优先回查相关章节的对白，把角色目标、词汇偏好和语气差异重新写实。'
    case 'growth_cost_balance':
    case 'story_dynamics':
      return '补出代价留痕、收益交换或反转支撑，让主角成长与付出重新对应。'
    case 'foreshadow_debt':
      return '决定是补写回收桥段、显式延期说明，还是把伏笔转移到新的兑现节点。'
    case 'world_state':
      return '核对正文、时间轴和状态版本，优先同步冲突状态，再明确哪些偏移是作者允许的。'
    case 'info_reveal_pacing':
      return '把信息揭示重新绑定到目标章节，必要时补桥段或后移暴露点。'
    case 'recall':
      return '先恢复召回链路或缩窄上下文依赖，再继续基于旧片段推进后续章节。'
    default:
      return '把风险落成修订任务，先处理受影响最大的章节或资产，再回看指标是否恢复。'
  }
}

function slugifyRiskActionId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function createRepairAction(params: {
  metricKey: QualityRepairMetricKey
  actionType: QualityRepairAction['actionType']
  label: string
  description: string
  targetPage: string
  severity?: QualityDashboardRiskSeverity
  safeToExecute?: boolean
  issueKey?: string
  taskType?: string
  taskTitle?: string
  taskDescription?: string
  fixBrief?: string
  chapterId?: number
  chapterNum?: number
  entityType?: string
  entityId?: number
  navigationQuery?: Record<string, string>
  originMeta?: Record<string, unknown>
}): QualityRepairAction {
  const suffix = slugifyRiskActionId([
    params.metricKey,
    params.actionType,
    params.chapterId || params.chapterNum || '',
    params.entityType || '',
    params.entityId || '',
    params.issueKey || params.label,
  ].join('-'))
  return {
    id: suffix,
    label: params.label,
    description: params.description,
    actionType: params.actionType,
    metricKey: params.metricKey,
    targetPage: params.targetPage,
    safeToExecute: params.safeToExecute === true,
    chapterId: params.chapterId,
    chapterNum: params.chapterNum,
    entityType: params.entityType,
    entityId: params.entityId,
    navigationQuery: params.navigationQuery,
    taskDraft: params.taskType && params.taskTitle && params.taskDescription
      ? {
        issueKey: params.issueKey,
        taskType: params.taskType,
        severity: toRepairTaskSeverity(params.severity || 'warning'),
        title: params.taskTitle,
        description: params.taskDescription,
        fixBrief: params.fixBrief,
        relatedPage: params.targetPage,
        entityType: params.entityType,
        entityId: params.entityId,
        chapterId: params.chapterId,
        originMeta: params.originMeta,
      }
      : undefined,
  }
}

interface DashboardRiskItemExtras {
  metricKey?: QualityRepairMetricKey
  whyItHappened?: string
  howToFix?: string
  suggestedActions?: QualityRepairAction[]
}

function createDashboardRiskItem(
  kind: QualityDashboardRiskKind,
  severity: QualityDashboardRiskSeverity,
  title: string,
  detail: string,
  chapterNums: number[],
  volumeId?: number,
  extras: DashboardRiskItemExtras = {},
): QualityDashboardRiskItem {
  const normalizedChapterNums = dedupeChapterNums(chapterNums)
  const metricKey = extras.metricKey || defaultMetricKeyForRisk(kind)
  const suggestedActions = extras.suggestedActions || (
    metricKey
      ? [createRepairAction({
        metricKey,
        actionType: 'create_revision_task',
        label: '生成修订建议',
        description: '将该风险落为修订任务，进入后续修复链路。',
        targetPage: defaultRelatedPageForRisk(kind),
        severity,
        safeToExecute: true,
        issueKey: `${metricKey}:${title}`,
        taskType: 'continuity',
        taskTitle: title,
        taskDescription: detail,
        fixBrief: buildDefaultRiskHowToFix(kind),
        chapterNum: normalizedChapterNums[0],
      })]
      : []
  )
  return {
    kind,
    severity,
    title,
    detail,
    chapterNums: normalizedChapterNums,
    volumeId,
    metricKey,
    whyItHappened: extras.whyItHappened || buildDefaultRiskWhyItHappened(kind, detail),
    howToFix: extras.howToFix || buildDefaultRiskHowToFix(kind),
    suggestedActions,
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

function collectContractProgressMetrics(rows: Array<{ reviewNotesJson?: string | null }>) {
  let threadItemCount = 0
  let threadAdvanceCount = 0
  let threadMentionOnlyCount = 0
  let foreshadowBlockedCount = 0
  let foreshadowStaleCount = 0

  rows.forEach((row) => {
    const validation = parseChapterContractValidationFromReviewNotes(row.reviewNotesJson)
    if (!validation) return

    validation.itemResults.forEach((item) => {
      if (item.contractItemType === 'story_thread_progress') {
        threadItemCount += 1
        if (item.semanticState === 'advanced' || item.semanticState === 'paid_off' || item.verdict === 'pass') {
          threadAdvanceCount += 1
        } else if (item.semanticState === 'mentioned' || item.verdict === 'weak') {
          threadMentionOnlyCount += 1
        }
      }

      if (item.contractItemType === 'foreshadow_delivery') {
        if (item.semanticState === 'blocked') foreshadowBlockedCount += 1
        if (item.semanticState === 'stale') foreshadowStaleCount += 1
      }
    })
  })

  return {
    storyThreadAdvanceRate: threadItemCount > 0 ? Math.round((threadAdvanceCount / threadItemCount) * 100) : 0,
    storyThreadMentionOnlyCount: threadMentionOnlyCount,
    foreshadowBlockedCount,
    foreshadowStaleCount,
  }
}

function summarizeBatchRange(chapterNums: number[]): string {
  const normalized = dedupeNumbers(chapterNums)
  if (normalized.length === 0) return '未记录章节范围'
  if (normalized.length === 1) return `第${normalized[0]}章`
  return `第${normalized[0]}-${normalized[normalized.length - 1]}章`
}

function parseNumberArrayJson(raw?: string | null): number[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
      .map((item) => Math.trunc(item))
  } catch {
    return []
  }
}

function getLatestWritebackRunMap(novelId: number) {
  return getDb()
    .select()
    .from(chapterWritebackRuns)
    .where(eq(chapterWritebackRuns.novelId, novelId))
    .orderBy(desc(chapterWritebackRuns.updatedAt), desc(chapterWritebackRuns.id))
    .all()
    .reduce<Map<number, typeof chapterWritebackRuns.$inferSelect>>((result, row) => {
      if (!result.has(row.chapterId)) {
        result.set(row.chapterId, row)
      }
      return result
    }, new Map())
}

function classifyWritebackStatus(status?: string | null): 'pending' | 'failed' | 'applied' {
  if (status === 'failed' || status === 'partially_failed') return 'failed'
  if (status === 'applied') return 'applied'
  return 'pending'
}

function getLatestChapterBatchTask(novelId: number): typeof tasks.$inferSelect | null {
  return getDb()
    .select()
    .from(tasks)
    .where(eq(tasks.novelId, novelId))
    .orderBy(desc(tasks.updatedAt), desc(tasks.id))
    .all()
    .find((task) => task.type === 'chapter_batch_generate' && task.runnerType === 'workflow') || null
}

function summarizeReadinessStatus(input: {
  contractBlockerCount: number
  writebackFailedCount: number
  feedbackPauseSuggestedCount: number
  consecutiveRecallFallbackChapters: number
  warningCount: number
  readyRate: number
}): QualityDashboardData['productionReadiness']['status'] {
  if (
    input.contractBlockerCount > 0
    || input.writebackFailedCount > 0
    || input.feedbackPauseSuggestedCount > 0
    || input.consecutiveRecallFallbackChapters >= 3
  ) {
    return 'blocked'
  }
  if (input.warningCount > 0 || input.readyRate < 85) return 'warning'
  return 'ready'
}

function clampHealthScore(value: number): number {
  return clampNumber(value, 0, 100, 0)
}

interface ProductionReadinessInputs {
  latestBatchTask: typeof tasks.$inferSelect | null
  latestBatchSnapshotId?: number
  contractBlockerCount: number
  contractWarningCount: number
  writebackPendingCount: number
  writebackFailedCount: number
  aiRecurrenceHighRiskCount: number
  feedbackPauseSuggestedCount: number
  latestBatchConsecutiveRecallFallbackChapters: number
}

interface BatchHealthBundleInputs {
  latestBatchTask: typeof tasks.$inferSelect | null
  latestBatchTaskId?: number
  latestBatchSnapshotId?: number
  latestBatchProgress: Partial<ChapterBatchAutoGenerateStatus>
  batchChapterIds: number[]
  batchChapterNums: number[]
  rewriteTaskCount: number
  batchPendingWritebackCount: number
  pendingRevisionCount: number
  staleCheckpointCount: number
  latestCheckpointChapterGap: number
  recallDegradedChapterCount: number
  latestBatchConsecutiveRecallFallbackChapters: number
  worldConflictCount: number
  writebackPendingCount: number
  writebackFailedCount: number
  contractReadyRate: number
  contractBlockerCount: number
  contractWarningCount: number
  contractProgressMetrics: {
    storyThreadAdvanceRate: number
    storyThreadMentionOnlyCount: number
    foreshadowBlockedCount: number
    foreshadowStaleCount: number
  }
  inspectionPassedChapterCount: number
  rewrittenChapterCount: number
  inspectionBlockedCount: number
  inspectionWarningCount: number
  batchGateBlockedCount: number
  latestBatchFailedChapterCount: number
  latestBatchInspectionsCount: number
  recentBatchRecallAlerts: string[]
}

interface BatchHealthBundle {
  batchHealth: QualityDashboardData['batchHealth']
  continuityHealth: QualityDashboardData['continuityHealth']
  contractDelivery: QualityDashboardData['contractDelivery']
  batchReview: QualityDashboardData['batchReview']
}

interface MillionWordDashboardSummary extends BatchHealthBundle {
  dashboardVersion: 'v1-health'
  dashboardNotes: string[]
  productionReadiness: QualityDashboardData['productionReadiness']
}

function buildProductionReadinessSummary(input: ProductionReadinessInputs): QualityDashboardData['productionReadiness'] {
  const productionWarnings = [
    input.writebackPendingCount > 0 ? `仍有 ${input.writebackPendingCount} 章章后回写未闭环。` : '',
    input.contractWarningCount > 0 ? `有 ${input.contractWarningCount} 章合同交付处于预警状态。` : '',
    input.latestBatchConsecutiveRecallFallbackChapters > 0 ? `最近连续 ${input.latestBatchConsecutiveRecallFallbackChapters} 章召回降级。` : '',
    input.latestBatchTask?.status === 'paused' && input.latestBatchTask.errorMessage ? input.latestBatchTask.errorMessage : '',
  ].filter(Boolean)
  const productionBlockers = [
    input.contractBlockerCount > 0 ? `有 ${input.contractBlockerCount} 章合同交付被章节门阻断。` : '',
    input.writebackFailedCount > 0 ? `有 ${input.writebackFailedCount} 章章后回写失败。` : '',
    input.feedbackPauseSuggestedCount > 0 ? `审校复现已有 ${input.feedbackPauseSuggestedCount} 项建议暂停继续批量生成。` : '',
    input.latestBatchConsecutiveRecallFallbackChapters >= 3 ? `连续召回降级已达到 ${input.latestBatchConsecutiveRecallFallbackChapters} 章，需先恢复记忆链路。` : '',
  ].filter(Boolean)
  const productionReadyRate = clampHealthScore(
    100
    - input.contractBlockerCount * 18
    - input.writebackFailedCount * 14
    - Math.min(input.writebackPendingCount, 6) * 4
    - input.feedbackPauseSuggestedCount * 12
    - input.aiRecurrenceHighRiskCount * 5
    - Math.min(input.latestBatchConsecutiveRecallFallbackChapters, 5) * 6,
  )
  const productionReadinessStatus = summarizeReadinessStatus({
    contractBlockerCount: input.contractBlockerCount,
    writebackFailedCount: input.writebackFailedCount,
    feedbackPauseSuggestedCount: input.feedbackPauseSuggestedCount,
    consecutiveRecallFallbackChapters: input.latestBatchConsecutiveRecallFallbackChapters,
    warningCount: productionWarnings.length,
    readyRate: productionReadyRate,
  })
  return {
    status: productionReadinessStatus,
    summary: productionReadinessStatus === 'ready'
      ? `当前产线可继续推进，综合就绪度 ${productionReadyRate}%。`
      : productionReadinessStatus === 'warning'
        ? `当前产线可谨慎继续，综合就绪度 ${productionReadyRate}%，建议先清理预警。`
        : `当前产线不宜继续扩批，综合就绪度 ${productionReadyRate}%，请先处理阻断项。`,
    blockers: productionBlockers,
    warnings: productionWarnings,
    suggestedActions: [
      input.contractBlockerCount > 0 ? '先回到章节合同与章节验收门，处理 blocker 章节。' : '',
      input.writebackPendingCount > 0 || input.writebackFailedCount > 0 ? '进入章后状态回写中心，清掉 pending/failed run。' : '',
      input.feedbackPauseSuggestedCount > 0 ? '先在质量仪表盘检查复现问题，再启动下一批。' : '',
      input.latestBatchSnapshotId ? '下一批之前先在回滚工作台登记批次检查结论并补齐作者锁定项。' : '',
    ].filter(Boolean),
    readyRate: productionReadyRate,
    contractBlockerCount: input.contractBlockerCount,
    writebackPendingCount: input.writebackPendingCount,
    writebackFailedCount: input.writebackFailedCount,
    aiRecurrenceHighRiskCount: input.aiRecurrenceHighRiskCount,
    feedbackPauseSuggestedCount: input.feedbackPauseSuggestedCount,
    consecutiveRecallFallbackChapters: input.latestBatchConsecutiveRecallFallbackChapters,
    activeBatchTaskId: input.latestBatchTask?.status === 'running' || input.latestBatchTask?.status === 'pending' ? input.latestBatchTask.id : undefined,
    latestBatchSnapshotId: input.latestBatchSnapshotId,
  }
}

function buildBatchHealthSummaryBundle(input: BatchHealthBundleInputs): BatchHealthBundle {
  const batchStatus = (
    input.latestBatchTask?.status === 'cancel_requested'
      ? 'running'
      : (input.latestBatchTask?.status || 'idle')
  ) as QualityDashboardData['batchHealth']['status']
  const completedChapterCount = Array.isArray(input.latestBatchProgress.completedChapterIds)
    ? input.latestBatchProgress.completedChapterIds.length
    : 0
  const failedChapterCount = Array.isArray(input.latestBatchProgress.failedChapterIds)
    ? input.latestBatchProgress.failedChapterIds.length
    : 0
  const warningCount = Array.isArray(input.latestBatchProgress.warnings)
    ? input.latestBatchProgress.warnings.length
    : 0
  const batchHealth: QualityDashboardData['batchHealth'] = {
    latestBatchTaskId: input.latestBatchTaskId,
    latestBatchSnapshotId: input.latestBatchSnapshotId,
    status: batchStatus,
    chapterIds: input.batchChapterIds,
    chapterStart: input.batchChapterNums[0],
    chapterEnd: input.batchChapterNums[input.batchChapterNums.length - 1],
    completedChapterCount,
    failedChapterCount,
    warningCount,
    rewriteTaskCount: input.rewriteTaskCount,
    pendingWritebackCount: input.batchPendingWritebackCount,
    pendingRevisionCount: input.pendingRevisionCount,
    pausedReason: typeof input.latestBatchProgress.pauseReason === 'string' && input.latestBatchProgress.pauseReason.trim()
      ? input.latestBatchProgress.pauseReason
      : (input.latestBatchTask?.errorMessage || undefined),
    canContinue: batchStatus === 'paused',
    summary: batchStatus === 'idle'
      ? '当前没有运行中的章节批次。'
      : `${summarizeBatchRange(input.batchChapterNums)} 批次状态：${batchStatus}，已完成 ${completedChapterCount}/${input.batchChapterIds.length || input.batchChapterNums.length} 章。`,
  }
  const continuityHealth: QualityDashboardData['continuityHealth'] = {
    staleCheckpointCount: input.staleCheckpointCount,
    latestCheckpointChapterGap: input.latestCheckpointChapterGap,
    recallDegradedChapterCount: input.recallDegradedChapterCount,
    consecutiveRecallFallbackChapters: input.latestBatchConsecutiveRecallFallbackChapters,
    worldConflictCount: input.worldConflictCount,
    writebackPendingCount: input.writebackPendingCount,
    writebackFailedCount: input.writebackFailedCount,
  }
  const contractDelivery: QualityDashboardData['contractDelivery'] = {
    readyRate: input.contractReadyRate,
    blockerCount: input.contractBlockerCount,
    warningCount: input.contractWarningCount,
    storyThreadAdvanceRate: input.contractProgressMetrics.storyThreadAdvanceRate,
    storyThreadMentionOnlyCount: input.contractProgressMetrics.storyThreadMentionOnlyCount,
    foreshadowBlockedCount: input.contractProgressMetrics.foreshadowBlockedCount,
    foreshadowStaleCount: input.contractProgressMetrics.foreshadowStaleCount,
  }
  const batchReview: QualityDashboardData['batchReview'] = {
    latestBatchSnapshotId: input.latestBatchSnapshotId,
    latestBatchTaskId: input.latestBatchTaskId,
    chapterStart: input.batchChapterNums[0],
    chapterEnd: input.batchChapterNums[input.batchChapterNums.length - 1],
    chapterCount: input.batchChapterNums.length,
    passedChapterCount: input.inspectionPassedChapterCount,
    rewrittenChapterCount: input.rewrittenChapterCount,
    failedChapterCount: Math.max(
      input.inspectionBlockedCount,
      input.batchGateBlockedCount,
      input.latestBatchFailedChapterCount,
    ),
    pendingWritebackCount: input.batchPendingWritebackCount,
    recurringIssues: [],
    recallAlerts: input.recentBatchRecallAlerts,
    avoidNextBatch: [
      input.inspectionBlockedCount > 0 ? '先处理本批 blocked 检查记录，再开下一批。' : '',
      input.inspectionWarningCount > 0 ? '先清理批次 warning 项，再推进下一批。' : '',
      input.batchPendingWritebackCount > 0 ? '回写未闭环前不要继续扩批，避免状态漂移叠加。' : '',
      input.latestBatchConsecutiveRecallFallbackChapters > 0 ? '召回降级未恢复前，避免继续拉长批量生成跨度。' : '',
    ].filter(Boolean),
    summary: input.latestBatchSnapshotId
      ? `${summarizeBatchRange(input.batchChapterNums)} 已登记 ${input.latestBatchInspectionsCount} 条批次检查，${input.inspectionBlockedCount} 条阻断，${input.inspectionWarningCount} 条预警。`
      : '当前还没有可回查的章节批次快照。',
  }

  return {
    batchHealth,
    continuityHealth,
    contractDelivery,
    batchReview,
  }
}

function buildMillionWordDashboardSummary(input: ProductionReadinessInputs & BatchHealthBundleInputs & {
  recurringIssues: string[]
}): MillionWordDashboardSummary {
  const productionReadiness = buildProductionReadinessSummary(input)
  const batchBundle = buildBatchHealthSummaryBundle(input)
  batchBundle.batchReview.recurringIssues = input.recurringIssues

  return {
    dashboardVersion: 'v1-health',
    dashboardNotes: [
      '当前版本负责“是否继续下一批”的健康汇总与批次复盘。',
      '解释原因、修法建议和动作入口统一归入质量修复引擎阶段。',
    ],
    productionReadiness,
    ...batchBundle,
  }
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
    const voiceLockSummary = asText(parsed.dialogue_voice_lock_summary)
    const risks = Array.isArray(parsed.dialogue_homogenization_risks)
      ? parsed.dialogue_homogenization_risks.map(asText).filter(Boolean)
      : []
    const fillerRisks = Array.isArray(parsed.dialogue_filler_risks)
      ? parsed.dialogue_filler_risks.map(asText).filter(Boolean)
      : []
    const infoDensityRisks = Array.isArray(parsed.dialogue_info_density_risks)
      ? parsed.dialogue_info_density_risks.map(asText).filter(Boolean)
      : []
    const requiredVoiceLockCharacterIds = Array.isArray(parsed.required_voice_lock_character_ids)
      ? parsed.required_voice_lock_character_ids
        .map((item) => (typeof item === 'number' ? item : Number(item)))
        .filter((item) => Number.isFinite(item) && item > 0)
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
    if (
      !fingerprintSummary
      && !voiceLockSummary
      && risks.length === 0
      && fillerRisks.length === 0
      && infoDensityRisks.length === 0
      && requiredVoiceLockCharacterIds.length === 0
      && similarities.length === 0
      && drifts.length === 0
    ) {
      return null
    }
    return {
      fingerprintSummary,
      voiceLockSummary,
      risks,
      similarities,
      drifts,
      fillerRisks,
      infoDensityRisks,
      requiredVoiceLockCharacterIds,
    }
  } catch {
    return null
  }
}

function parseStyleCompliance(raw?: string | null): StyleComplianceResult | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const current = parsed.style_compliance
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    const record = current as Record<string, unknown>
    const deviations = Array.isArray(record.deviations) ? record.deviations.map(asText).filter(Boolean) : []
    const rewriteHints = Array.isArray(record.rewriteHints) ? record.rewriteHints.map(asText).filter(Boolean) : []
    const matchedForbiddenPatterns = Array.isArray(record.matchedForbiddenPatterns)
      ? record.matchedForbiddenPatterns.map(asText).filter(Boolean)
      : []
    const score = clampNumber(record.score, 0, 100, 0)
    const summary = asText(record.summary)
    if (!summary && deviations.length === 0 && rewriteHints.length === 0 && matchedForbiddenPatterns.length === 0 && score <= 0) {
      return null
    }
    return {
      status: record.status === 'rewrite' ? 'rewrite' : record.status === 'warning' ? 'warning' : 'pass',
      score,
      summary,
      deviations,
      rewriteHints,
      matchedForbiddenPatterns,
      forbiddenPatternHitCount: clampNumber(record.forbiddenPatternHitCount, 0, 999, matchedForbiddenPatterns.length),
      referenceMetrics: {
        avgSentenceLength: clampNumber((record.referenceMetrics as Record<string, unknown> | undefined)?.avgSentenceLength, 0, 9999, 0),
        avgParagraphLength: clampNumber((record.referenceMetrics as Record<string, unknown> | undefined)?.avgParagraphLength, 0, 9999, 0),
        dialogueLineRate: clampNumber((record.referenceMetrics as Record<string, unknown> | undefined)?.dialogueLineRate, 0, 100, 0),
        abstractTokenDensity: clampNumber((record.referenceMetrics as Record<string, unknown> | undefined)?.abstractTokenDensity, 0, 100, 0),
      },
      actualMetrics: {
        avgSentenceLength: clampNumber((record.actualMetrics as Record<string, unknown> | undefined)?.avgSentenceLength, 0, 9999, 0),
        avgParagraphLength: clampNumber((record.actualMetrics as Record<string, unknown> | undefined)?.avgParagraphLength, 0, 9999, 0),
        dialogueLineRate: clampNumber((record.actualMetrics as Record<string, unknown> | undefined)?.dialogueLineRate, 0, 100, 0),
        abstractTokenDensity: clampNumber((record.actualMetrics as Record<string, unknown> | undefined)?.abstractTokenDensity, 0, 100, 0),
      },
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
      voiceLockCandidateCount: 0,
    },
    characterDialogueSignatures: [],
    crossCharacterDialogueSimilarity: [],
    dialogueDriftTrend: [],
    volumeDialogueSimilarity: [],
    recentDialogueAlerts: [],
    requiredDialogueVoiceLocks: [],
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
    summaryHealthJson: chapters.summaryHealthJson,
    expressionDedupJson: chapters.expressionDedupJson,
    hookContinuityJson: chapters.hookContinuityJson,
  }).from(chapters).where(eq(chapters.novelId, novelId)).orderBy(asc(chapters.chapterNum)).all()
  const batchChapterNumById = new Map(rows.map((row) => [row.id, row.chapterNum] as const))
  const latestWritebackRunMap = getLatestWritebackRunMap(novelId)
  const latestWritebackRuns = [...latestWritebackRunMap.values()]
  const writebackPendingCount = latestWritebackRuns.filter((row) => classifyWritebackStatus(row.status) === 'pending').length
  const writebackFailedCount = latestWritebackRuns.filter((row) => classifyWritebackStatus(row.status) === 'failed').length
  const latestBatchTask = getLatestChapterBatchTask(novelId)
  const latestBatchProgress = latestBatchTask
    ? parseTaskProgress<Partial<ChapterBatchAutoGenerateStatus>>(latestBatchTask)
    : {}
  const latestBatchSnapshot = db.select().from(chapterBatchSnapshots)
    .where(eq(chapterBatchSnapshots.novelId, novelId))
    .orderBy(desc(chapterBatchSnapshots.createdAt), desc(chapterBatchSnapshots.id))
    .all()[0] || null
  const latestBatchSnapshotId = latestBatchSnapshot?.id
  const latestBatchTaskId = latestBatchTask?.id
  const batchChapterIds = dedupeNumbers(
    Array.isArray(latestBatchProgress.chapterIds)
      ? latestBatchProgress.chapterIds
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item))
      : parseNumberArrayJson(latestBatchSnapshot?.chapterIdsJson),
  )
  const batchChapterNums = dedupeNumbers(
    batchChapterIds.length > 0
      ? batchChapterIds
          .map((chapterId) => batchChapterNumById.get(chapterId) || 0)
          .filter((chapterNum) => chapterNum > 0)
      : parseNumberArrayJson(latestBatchSnapshot?.chapterNumsJson),
  )
  const batchChapterIdSet = new Set(batchChapterIds)
  const batchRevisionRows = db.select().from(revisionTasks)
    .where(eq(revisionTasks.novelId, novelId))
    .all()
    .filter((row) => batchChapterIdSet.size === 0 || (typeof row.chapterId === 'number' && batchChapterIdSet.has(row.chapterId)))
  const pendingRevisionCount = batchRevisionRows.filter((row) => (row.status || 'open') !== 'resolved' && (row.status || 'open') !== 'closed').length
  const rewriteTaskCount = batchRevisionRows.filter((row) => (row.taskType || '') === 'rewrite' || (row.severity || '') === 'critical').length
  const batchPendingWritebackCount = latestWritebackRuns.filter((row) =>
    batchChapterIdSet.size > 0
    && batchChapterIdSet.has(row.chapterId)
    && classifyWritebackStatus(row.status) === 'pending').length
  const checkpointRows = db.select().from(storyMemoryCheckpoints)
    .where(eq(storyMemoryCheckpoints.novelId, novelId))
    .all()
  const staleCheckpointCount = checkpointRows.filter((row) => row.stale === 1).length
  const latestNovelCheckpoint = checkpointRows.find((row) => row.scopeType === 'novel' && (row.scopeId ?? null) === null) || null
  const latestChapterNum = rows.at(-1)?.chapterNum || 0
  const latestCheckpointChapterGap = latestChapterNum > 0
    ? Math.max(0, latestChapterNum - (latestNovelCheckpoint?.lastRefreshedChapterNum || 0))
    : 0
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
  const recallRuntimeByChapterId = listChapterRecallRuntimeMap(novelId)
  const recallSnapshotByChapterId = new Map(rows.map((row) => [
    row.id,
    recallRuntimeByChapterId.get(row.id)?.recallSnapshot,
  ] as const))
  const recallSnapshotSourceByChapterId = new Map(rows.map((row) => [
    row.id,
    recallRuntimeByChapterId.get(row.id)?.recallSnapshotSource,
  ] as const))
  const recallDiagnosticsByChapterId = new Map(rows.map((row) => {
    const persisted = recallRuntimeByChapterId.get(row.id)
    return [
      row.id,
      persisted?.recallDiagnostics || buildHeuristicRecallDiagnostics(novelId, {
        chapterNum: row.chapterNum,
        title: row.title,
        summary: row.summary,
        outline: row.outline,
      }, recallFreshnessState),
    ] as const
  }))
  const recentWorldStateAlerts = worldStateLedger.alerts.slice(0, 8)
  const antiAiSummary = getAntiAiDashboardSummary(novelId)
  const antiAiSignalByChapterId = new Map(antiAiSummary.chapterSignals.map((entry) => [entry.chapterId, entry] as const))
  const feedbackSummary = getFeedbackRecurrenceDashboardSummary(novelId)
  const feedbackSignalByChapterId = new Map(feedbackSummary.chapterSignals.map((entry) => [entry.chapterId, entry] as const))
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
    const styleCompliance = parseStyleCompliance(row.reviewNotesJson) || undefined
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
      antiAiRuleHits: antiAiSignalByChapterId.get(row.id)?.rules,
      feedbackRecurrenceHits: feedbackSignalByChapterId.get(row.id)?.issues,
      styleCompliance,
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
      recallSnapshot: recallSnapshotByChapterId.get(row.id),
      recallSnapshotSource: recallSnapshotSourceByChapterId.get(row.id),
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
  const styleComplianceEntries = chapterDetails
    .filter((entry): entry is QualityDashboardData['chapterDetails'][number] & { styleCompliance: StyleComplianceResult } => Boolean(entry.styleCompliance))
  const styleComplianceAlerts: QualityDashboardData['styleCompliance']['recentAlerts'] = styleComplianceEntries
    .filter((entry) => entry.styleCompliance.status !== 'pass')
    .map((entry) => ({
      chapterId: entry.chapterId,
      chapterNum: entry.chapterNum,
      title: entry.title,
      status: (entry.styleCompliance.status === 'rewrite' ? 'rewrite' : 'warning') as 'rewrite' | 'warning',
      score: entry.styleCompliance.score,
      summary: entry.styleCompliance.summary || entry.styleCompliance.deviations[0] || '风格硬约束出现偏移。',
    }))
    .sort((left, right) => left.score - right.score || right.chapterNum - left.chapterNum)
  const styleComplianceSummary: QualityDashboardData['styleCompliance'] = {
    analyzedChapterCount: styleComplianceEntries.length,
    passCount: styleComplianceEntries.filter((entry) => entry.styleCompliance.status === 'pass').length,
    warningCount: styleComplianceEntries.filter((entry) => entry.styleCompliance.status === 'warning').length,
    rewriteCount: styleComplianceEntries.filter((entry) => entry.styleCompliance.status === 'rewrite').length,
    averageScore: roundMetric(averageNumbers(styleComplianceEntries.map((entry) => entry.styleCompliance.score))),
    recentAlerts: styleComplianceAlerts.slice(0, 6),
  }
  const contractValidationStatuses = rows.reduce<NonNullable<ReturnType<typeof parseChapterContractValidationFromReviewNotes>>[]>((result, row) => {
    const parsed = parseChapterContractValidationFromReviewNotes(row.reviewNotesJson)
    if (parsed) result.push(parsed)
    return result
  }, [])
  const contractBlockerCount = contractValidationStatuses.filter((item) => item.status === 'blocker').length
  const contractWarningCount = contractValidationStatuses.filter((item) => item.status === 'warning').length
  const contractReadyRate = contractValidationStatuses.length > 0
    ? Math.round((contractValidationStatuses.filter((item) => item.status === 'pass').length / contractValidationStatuses.length) * 100)
    : 0
  const contractProgressMetrics = collectContractProgressMetrics(rows)
  const contractStatusEntries = rows.reduce<Array<{
    chapterId: number
    chapterNum: number
    volumeId: number | null
    validation: NonNullable<ReturnType<typeof parseChapterContractValidationFromReviewNotes>>
  }>>((result, row) => {
    const validation = parseChapterContractValidationFromReviewNotes(row.reviewNotesJson)
    if (!validation) return result
    result.push({
      chapterId: row.id,
      chapterNum: row.chapterNum,
      volumeId: row.volumeId,
      validation,
    })
    return result
  }, [])

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
    snapshot: recallSnapshotByChapterId.get(row.id),
    recallSnapshotSource: recallSnapshotSourceByChapterId.get(row.id),
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
  const analyzedRecallEntries = recallEntries.filter((entry) =>
    Boolean(entry.snapshot) || entry.diagnostics.searchedBucketCount > 0 || entry.diagnostics.totalHitCount > 0)
  const recallAvailabilityCount = analyzedRecallEntries.filter((entry) =>
    entry.snapshot
      ? entry.snapshot.retrievalUsed
      : entry.diagnostics.selectedHitCount > 0).length
  const averageHitCount = analyzedRecallEntries.length > 0
    ? roundMetric(analyzedRecallEntries.reduce((sum, entry) => sum + (entry.snapshot?.hitCount ?? entry.diagnostics.totalHitCount), 0) / analyzedRecallEntries.length)
    : 0
  const bucketCoverageRate = analyzedRecallEntries.length > 0
    ? roundMetric(analyzedRecallEntries.reduce((sum, entry) => sum + (
      entry.snapshot
        ? buildRecallBucketCoverageRate(entry.snapshot)
        : (entry.diagnostics.searchedBucketCount > 0
            ? Math.round((entry.diagnostics.selectedBucketCount / entry.diagnostics.searchedBucketCount) * 100)
            : 0)
    ), 0) / analyzedRecallEntries.length)
    : 0
  const consecutiveFallbackChapters = getConsecutiveRecallFallbackCount(
    [...recallEntries]
      .sort((left, right) => right.chapterNum - left.chapterNum),
  )
  const latestFallbackReason = pickLatestRecallFallbackReason(
    [...recallEntries]
      .sort((left, right) => right.chapterNum - left.chapterNum)
      .map((entry) => entry.snapshot),
  )
  const recallSummary: QualityDashboardData['recallSummary'] = {
    analyzedChapterCount: analyzedRecallEntries.length,
    recallAvailabilityRate: analyzedRecallEntries.length > 0
      ? roundMetric((recallAvailabilityCount / analyzedRecallEntries.length) * 100)
      : 0,
    averageHitCount,
    bucketCoverageRate,
    consecutiveFallbackChapters,
    latestFallbackReason,
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
    .filter((entry) => entry.diagnostics.staleRecallCount > 0 || entry.snapshot?.degraded)
    .sort((left, right) => right.chapterNum - left.chapterNum || right.diagnostics.staleRecallCount - left.diagnostics.staleRecallCount)
    .slice(0, 8)
    .map((entry) => ({
      chapterId: entry.chapterId,
      chapterNum: entry.chapterNum,
      title: entry.title,
      degraded: Boolean(entry.snapshot?.degraded),
      retrievalUsed: Boolean(entry.snapshot?.retrievalUsed),
      recallSnapshotSource: entry.recallSnapshotSource,
      fallbackReason: entry.snapshot?.fallbackReason,
      consecutiveFallbackChapters: entry.snapshot?.degraded
        ? getConsecutiveRecallFallbackCount(
          recallEntries
            .filter((candidate) => candidate.chapterNum <= entry.chapterNum && Boolean(candidate.snapshot))
            .sort((left, right) => right.chapterNum - left.chapterNum),
        )
        : undefined,
      staleRecallCount: entry.diagnostics.staleRecallCount,
      detail: entry.snapshot?.degraded
        ? `召回已降级：${formatRecallFallbackReason(entry.snapshot.fallbackReason)}。${entry.diagnostics.staleRecallCount > 0 ? ` 并识别到 ${entry.diagnostics.staleRecallCount} 条疑似过期片段。` : ''}`
        : (entry.diagnostics.summaryLines.at(-1) || `识别到 ${entry.diagnostics.staleRecallCount} 条疑似过期片段。`),
    }))
  const volumeRecallDiagnostics: QualityDashboardData['volumeRecallDiagnostics'] = volumeRows
    .reduce<QualityDashboardData['volumeRecallDiagnostics']>((result, volume) => {
      const entries = recallEntries.filter((entry) => entry.volumeId === volume.id)
      if (entries.length === 0) return result
      const entrySnapshots = entries.map((entry) => entry.snapshot)
      result.push({
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: entries[0]?.chapterNum || 0,
        chapterEnd: entries[entries.length - 1]?.chapterNum || 0,
        chapterCount: entries.length,
        recallAvailabilityRate: roundMetric((entries.filter((entry) => entry.snapshot?.retrievalUsed).length / entries.length) * 100),
        averageHitCount: roundMetric(entries.reduce((sum, entry) => sum + (entry.snapshot?.hitCount ?? entry.diagnostics.totalHitCount), 0) / entries.length),
        bucketCoverageRate: roundMetric(entries.reduce((sum, entry) => sum + (
          entry.snapshot
            ? buildRecallBucketCoverageRate(entry.snapshot)
            : (entry.diagnostics.searchedBucketCount > 0
                ? Math.round((entry.diagnostics.selectedBucketCount / entry.diagnostics.searchedBucketCount) * 100)
                : 0)
        ), 0) / entries.length),
        degradedChapterCount: entries.filter((entry) => entry.snapshot?.degraded).length,
        latestFallbackReason: pickLatestRecallFallbackReason(
          entrySnapshots
            .filter(Boolean)
            .reverse(),
        ),
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
      })
      return result
    }, [])
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const volumeLanguageDriftById = new Map(volumeLanguageDrift.map((entry) => [entry.volumeId, entry] as const))
  const volumeStoryDynamicsById = new Map(volumeStoryDynamics.map((entry) => [entry.volumeId, entry] as const))
  const volumeChapterFunctionById = new Map(volumeChapterFunctions.map((entry) => [entry.volumeId, entry] as const))
  const volumeArcProgressById = new Map(storyArcProgressSnapshot.volumeEntries.map((entry) => [entry.volumeId, entry] as const))
  const volumeRecallById = new Map(volumeRecallDiagnostics.map((entry) => [entry.volumeId, entry] as const))
  const volumeWorldStateById = new Map(volumeWorldStateStability.map((entry) => [entry.volumeId, entry] as const))
  const feedbackVolumeEntries: QualityDashboardData['feedbackRecurrence']['volumeEntries'] = volumeRows
    .reduce<QualityDashboardData['feedbackRecurrence']['volumeEntries']>((result, volume) => {
      const chapterEntries = rows.filter((row) => row.volumeId === volume.id)
      if (chapterEntries.length === 0) return result
      const chapterIdSet = new Set(chapterEntries.map((row) => row.id))
      const signals = feedbackSummary.chapterSignals.filter((entry) => chapterIdSet.has(entry.chapterId))
      const issueToChapterNums = new Map<string, number[]>()
      const promotedIssueSet = new Set<string>()
      const highRiskIssueSet = new Set<string>()
      const pauseSuggestedIssueSet = new Set<string>()
      signals.forEach((signal) => {
        signal.issues.forEach((issue) => {
          const current = issueToChapterNums.get(issue.issueType) || []
          if (!current.includes(signal.chapterNum)) current.push(signal.chapterNum)
          current.sort((left, right) => left - right)
          issueToChapterNums.set(issue.issueType, current)
          if (issue.promotedToHardConstraint) promotedIssueSet.add(issue.issueType)
          if (issue.pauseSuggested) pauseSuggestedIssueSet.add(issue.issueType)
        })
      })
      feedbackSummary.recentAlerts
        .filter((alert) => alert.severity === 'critical')
        .filter((alert) => alert.chapterNums.some((chapterNum) => chapterNum >= (chapterEntries[0]?.chapterNum || 0) && chapterNum <= (chapterEntries[chapterEntries.length - 1]?.chapterNum || 0)))
        .forEach((alert) => highRiskIssueSet.add(alert.issueType))
      result.push({
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: chapterEntries[0]?.chapterNum || 0,
        chapterEnd: chapterEntries[chapterEntries.length - 1]?.chapterNum || 0,
        chapterCount: chapterEntries.length,
        hitChapterCount: signals.length,
        recurringIssueCount: [...issueToChapterNums.values()].filter((chapterNums) => chapterNums.length >= 2).length,
        promotedIssueCount: promotedIssueSet.size,
        highRiskIssueCount: highRiskIssueSet.size,
        pauseSuggestedIssueCount: pauseSuggestedIssueSet.size,
      })
      return result
    }, [])
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const feedbackVolumeById = new Map(feedbackVolumeEntries.map((entry) => [entry.volumeId, entry] as const))
  const antiAiVolumeEntries: QualityDashboardData['antiAiRecurrence']['volumeEntries'] = volumeRows
    .reduce<QualityDashboardData['antiAiRecurrence']['volumeEntries']>((result, volume) => {
      const chapterEntries = rows.filter((row) => row.volumeId === volume.id)
      if (chapterEntries.length === 0) return result
      const chapterIdSet = new Set(chapterEntries.map((row) => row.id))
      const signals = antiAiSummary.chapterSignals.filter((entry) => chapterIdSet.has(entry.chapterId))
      const ruleToChapterNums = new Map<string, number[]>()
      const promotedRuleSet = new Set<string>()
      signals.forEach((signal) => {
        signal.rules.forEach((rule) => {
          const current = ruleToChapterNums.get(rule.ruleCode) || []
          if (!current.includes(signal.chapterNum)) current.push(signal.chapterNum)
          current.sort((left, right) => left - right)
          ruleToChapterNums.set(rule.ruleCode, current)
          if (rule.promotedToHardConstraint) promotedRuleSet.add(rule.ruleCode)
        })
      })
      const recurringRuleCount = [...ruleToChapterNums.values()].filter((chapterNums) => chapterNums.length >= 2).length
      const highRiskRuleCount = [...ruleToChapterNums.values()].filter((chapterNums) => hasThreeRuleHitsWithinFiveChapters(chapterNums)).length
      result.push({
        volumeId: volume.id,
        volumeNumber: volume.volumeNumber || volume.id,
        volumeName: formatVolumeName(volume.id, volume.volumeNumber, volume.title),
        chapterStart: chapterEntries[0]?.chapterNum || 0,
        chapterEnd: chapterEntries[chapterEntries.length - 1]?.chapterNum || 0,
        chapterCount: chapterEntries.length,
        hitChapterCount: signals.length,
        recurringRuleCount,
        promotedRuleCount: promotedRuleSet.size,
        highRiskRuleCount,
      })
      return result
    }, [])
    .sort((left, right) => left.volumeNumber - right.volumeNumber || left.chapterStart - right.chapterStart)
  const volumeQualityMetrics: VolumeQualityMetrics[] = volumeChapterRanges.map((volumeRange) => {
    const chapterEntries = chapterDetails.filter((entry) => entry.volumeId === volumeRange.volumeId)
    const scoredChapterEntries = chapterEntries.filter((entry) => entry.dimensions.length > 0)
    const volumeStyleComplianceEntries = chapterEntries
      .filter((entry): entry is typeof chapterEntries[number] & { styleCompliance: StyleComplianceResult } => Boolean(entry.styleCompliance))
    const volumeStyleComplianceAlerts = volumeStyleComplianceEntries.filter((entry) => entry.styleCompliance.status !== 'pass')
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
      ...((feedbackVolumeById.get(volumeRange.volumeId)?.highRiskIssueCount || 0) > 0
        ? [createDashboardRiskItem(
          'feedback_recurrence',
          (feedbackVolumeById.get(volumeRange.volumeId)?.pauseSuggestedIssueCount || 0) > 0 ? 'critical' : 'warning',
          `${volumeRange.volumeName} 审校复现升温`,
          `本卷已有 ${feedbackVolumeById.get(volumeRange.volumeId)?.highRiskIssueCount || 0} 类问题在 5 章窗口内高风险复现。`,
          [volumeRange.chapterStart, volumeRange.chapterEnd],
          volumeRange.volumeId,
        )]
        : []),
      ...(volumeStyleComplianceAlerts.length > 0
        ? [createDashboardRiskItem(
          'style_compliance',
          volumeStyleComplianceAlerts.some((entry) => entry.styleCompliance.status === 'rewrite') ? 'critical' : 'warning',
          `${volumeRange.volumeName} 文风硬约束漂移`,
          `本卷有 ${volumeStyleComplianceAlerts.filter((entry) => entry.styleCompliance.status === 'rewrite').length} 章达到重写阈值，${volumeStyleComplianceAlerts.filter((entry) => entry.styleCompliance.status === 'warning').length} 章出现预警。`,
          volumeStyleComplianceAlerts.map((entry) => entry.chapterNum),
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
  const chapterDetailById = new Map(chapterDetails.map((entry) => [entry.chapterId, entry] as const))
  const chapterDetailByNum = new Map(chapterDetails.map((entry) => [entry.chapterNum, entry] as const))
  const volumeNumberById = new Map(volumeRows.map((row) => [row.id, row.volumeNumber || row.id] as const))
  const storyFactRows = db.select({
    id: storyFacts.id,
    title: storyFacts.title,
    volumeId: storyFacts.volumeId,
    readerKnownChapterId: storyFacts.readerKnownChapterId,
    protagonistKnownChapterId: storyFacts.protagonistKnownChapterId,
    targetRevealChapterId: storyFacts.targetRevealChapterId,
    forbiddenBeforeVolume: storyFacts.forbiddenBeforeVolume,
    plannedRevealVolume: storyFacts.plannedRevealVolume,
  }).from(storyFacts).where(eq(storyFacts.novelId, novelId)).all()
  const repairRiskItems: QualityDashboardRiskItem[] = []
  const addRepairRisk = (risk: QualityDashboardRiskItem | null | undefined) => {
    if (!risk) return
    repairRiskItems.push(risk)
  }
  const createChapterNavigationQuery = (chapterId?: number, chapterNum?: number) => {
    const query: Record<string, string> = {}
    if (typeof chapterId === 'number') query.chapterId = String(chapterId)
    if (typeof chapterNum === 'number') query.chapterNum = String(chapterNum)
    return Object.keys(query).length > 0 ? query : undefined
  }

  const contractBlockerChapters = contractStatusEntries.filter((entry) => entry.validation.status === 'blocker')
  const firstContractBlocker = contractBlockerChapters[0]
  if (contractBlockerCount > 0 || endgameDebtSnapshot.overview.overdueCount > 0 || endgameDebtSnapshot.overview.unboundCount > 0 || contractProgressMetrics.storyThreadMentionOnlyCount > 0) {
    const chapterNums = dedupeChapterNums([
      ...contractBlockerChapters.slice(0, 3).map((entry) => entry.chapterNum),
      ...endgameDebtSnapshot.recentAlerts.slice(0, 2)
        .map((alert) => alert.targetResolutionChapter)
        .filter((chapterNum): chapterNum is number => typeof chapterNum === 'number'),
    ])
    addRepairRisk(createDashboardRiskItem(
      'commitment_delivery',
      contractBlockerCount > 0 || endgameDebtSnapshot.overview.overdueCount > 0 ? 'critical' : 'warning',
      contractBlockerCount > 0
        ? '章节承诺兑现被阻断'
        : '承诺兑现链开始失衡',
      `合同通过率 ${contractReadyRate}%，blocker ${contractBlockerCount}，提及未推进 ${contractProgressMetrics.storyThreadMentionOnlyCount}，终局过期 ${endgameDebtSnapshot.overview.overdueCount}，未绑定 ${endgameDebtSnapshot.overview.unboundCount}。`,
      chapterNums,
      volumeIdByChapterNum.get(chapterNums[0] || 0),
      {
        metricKey: 'commitment_delivery',
        whyItHappened: '卷承诺、章节合同与终局资产之间的绑定不够稳定，导致“写到了但没推进”和“承诺存在但无人服务”同时出现。',
        howToFix: '先清掉 blocker 章节，再把未绑定终局承诺和只提及未推进的线程补进合同或桥接场景。',
        suggestedActions: [
          createRepairAction({
            metricKey: 'commitment_delivery',
            actionType: 'create_revision_task',
            label: '生成兑现修订任务',
            description: '把承诺兑现缺口落为修订任务，统一进入修订中心。',
            targetPage: 'revision',
            severity: contractBlockerCount > 0 ? 'critical' : 'warning',
            safeToExecute: true,
            issueKey: `commitment-delivery-${firstContractBlocker?.chapterNum || 'global'}`,
            taskType: 'continuity',
            taskTitle: '补齐承诺兑现链',
            taskDescription: `处理合同 blocker、终局过期/未绑定和线程只提及未推进的问题。${chapterNums.length > 0 ? `重点回查章节：第${chapterNums.join('、')}章。` : ''}`,
            fixBrief: '先修 blocker 章节，再补卷级绑定和桥接推进。',
            chapterId: firstContractBlocker?.chapterId,
            chapterNum: firstContractBlocker?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstContractBlocker?.chapterId, firstContractBlocker?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'commitment_delivery',
            actionType: 'open_chapter_rewrite',
            label: firstContractBlocker ? `重写第${firstContractBlocker.chapterNum}章` : '打开兑现缺口章节',
            description: '定位首个 blocker 章节，直接进入正文修订。',
            targetPage: 'writing',
            severity: 'critical',
            issueKey: `commitment-rewrite-${firstContractBlocker?.chapterNum || 'global'}`,
            taskType: 'rewrite',
            taskTitle: firstContractBlocker ? `重写第${firstContractBlocker.chapterNum}章以兑现章节合同` : '重写章节以兑现章节合同',
            taskDescription: '围绕合同未兑现项补足推进、回收和代价落地。',
            fixBrief: '优先让章节完成既定承诺，不再停留在“提及但未推进”。',
            chapterId: firstContractBlocker?.chapterId,
            chapterNum: firstContractBlocker?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstContractBlocker?.chapterId, firstContractBlocker?.chapterNum),
          }),
        ],
      },
    ))
  }

  const dialogueRiskChapters = chapterDetails.filter((entry) =>
    Boolean(entry.dialogueReview) && (
      (entry.dialogueReview?.similarities.length || 0) > 0
      || (entry.dialogueReview?.drifts.length || 0) > 0
      || (entry.dialogueReview?.risks.length || 0) > 0
    ))
  const firstDialogueRiskChapter = dialogueRiskChapters[0]
  if (dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount > 0 || dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount > 0 || dialogueSnapshot.requiredDialogueVoiceLocks.length > 0) {
    const topPair = dialogueSnapshot.crossCharacterDialogueSimilarity[0]
    addRepairRisk(createDashboardRiskItem(
      'voice_distinction',
      dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount >= 2 ? 'critical' : 'warning',
      topPair
        ? `${topPair.characterAName} / ${topPair.characterBName} 对白趋同`
        : '角色声音区分度下降',
      `高相似角色对 ${dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount} 组，漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount} 名，待加 voice lock ${dialogueSnapshot.requiredDialogueVoiceLocks.length} 名。`,
      dialogueRiskChapters.slice(0, 4).map((entry) => entry.chapterNum),
      firstDialogueRiskChapter?.volumeId,
      {
        metricKey: 'voice_distinction',
        whyItHappened: '对白层面的语气、词汇和关系张力没有持续分化，近期章节开始把多个角色写成同一种发声方式。',
        howToFix: '优先回查最近有对白漂移的章节，补角色声音锁，再重写关键对白段落。',
        suggestedActions: [
          createRepairAction({
            metricKey: 'voice_distinction',
            actionType: 'create_revision_task',
            label: '生成对白修订任务',
            description: '把角色声音同质化问题落到修订中心。',
            targetPage: 'revision',
            severity: dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount >= 2 ? 'critical' : 'warning',
            safeToExecute: true,
            issueKey: `voice-distinction-${topPair?.characterAId || 'global'}-${topPair?.characterBId || ''}`,
            taskType: 'continuity',
            taskTitle: '修复角色对白同质化',
            taskDescription: `处理高相似角色对白、角色声音漂移和 voice lock 缺失。${topPair ? `重点角色：${topPair.characterAName} / ${topPair.characterBName}。` : ''}`,
            fixBrief: '为关键角色补声音锁，并重写受影响对白。',
            chapterId: firstDialogueRiskChapter?.chapterId,
            chapterNum: firstDialogueRiskChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstDialogueRiskChapter?.chapterId, firstDialogueRiskChapter?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'voice_distinction',
            actionType: 'open_chapter_rewrite',
            label: firstDialogueRiskChapter ? `重写第${firstDialogueRiskChapter.chapterNum}章对白` : '打开对白问题章节',
            description: '直接进入最近有对白漂移的章节处理对白段落。',
            targetPage: 'writing',
            severity: 'warning',
            issueKey: `voice-rewrite-${firstDialogueRiskChapter?.chapterNum || 'global'}`,
            taskType: 'rewrite',
            taskTitle: firstDialogueRiskChapter ? `重写第${firstDialogueRiskChapter.chapterNum}章对白层` : '重写对白层',
            taskDescription: '按角色声音锁重写对白，拉开角色语气和表达习惯差异。',
            fixBrief: '减少同质句式，强化角色专属表达和关系张力。',
            chapterId: firstDialogueRiskChapter?.chapterId,
            chapterNum: firstDialogueRiskChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstDialogueRiskChapter?.chapterId, firstDialogueRiskChapter?.chapterNum),
          }),
        ],
      },
    ))
  }

  const growthAlertChapterNums = dedupeChapterNums(storyPacingAlerts.flatMap((alert) => alert.chapterNums).slice(0, 6))
  const firstGrowthChapter = chapterDetailByNum.get(growthAlertChapterNums[0] || 0)
  if (protagonistSetbackSummary.longestSmoothRun >= SMOOTH_RUN_THRESHOLD || costPersistenceState.evaporatedCostCount > 0 || costPersistenceState.unresolvedCostCount > 0) {
    addRepairRisk(createDashboardRiskItem(
      'growth_cost_balance',
      costPersistenceState.evaporatedCostCount > 0 || protagonistSetbackSummary.longestSmoothRun >= SMOOTH_RUN_THRESHOLD + 1 ? 'critical' : 'warning',
      protagonistSetbackSummary.longestSmoothRun >= SMOOTH_RUN_THRESHOLD
        ? '主角成长开始脱离代价'
        : '代价回收链条松动',
      `最长顺滑连跑 ${protagonistSetbackSummary.longestSmoothRun} 章，代价蒸发 ${costPersistenceState.evaporatedCostCount} 条，未收束代价 ${costPersistenceState.unresolvedCostCount} 条。`,
      growthAlertChapterNums,
      firstGrowthChapter?.volumeId,
      {
        metricKey: 'growth_cost_balance',
        whyItHappened: '收益、代价和反转的相互制衡开始失步，近期推进更像单向给奖励或单向施压。',
        howToFix: '补出代价留痕、反转支撑或阶段性回报，避免主角只拿收益或长时间只有压制没有兑现。',
        suggestedActions: [
          createRepairAction({
            metricKey: 'growth_cost_balance',
            actionType: 'create_revision_task',
            label: '生成成长平衡修订',
            description: '把成长收益与代价失衡问题落为修订任务。',
            targetPage: 'revision',
            severity: costPersistenceState.evaporatedCostCount > 0 ? 'critical' : 'warning',
            safeToExecute: true,
            issueKey: `growth-cost-balance-${firstGrowthChapter?.chapterNum || 'global'}`,
            taskType: 'continuity',
            taskTitle: '修复成长-代价失衡',
            taskDescription: '补齐代价持续、阶段回报与反转支撑，让主角成长重新有代价锚点。',
            fixBrief: '先处理最近顺滑连跑和代价蒸发章节。',
            chapterId: firstGrowthChapter?.chapterId,
            chapterNum: firstGrowthChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstGrowthChapter?.chapterId, firstGrowthChapter?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'growth_cost_balance',
            actionType: 'open_bridge_patch',
            label: firstGrowthChapter ? `补写第${firstGrowthChapter.chapterNum}章过桥` : '补写过桥段',
            description: '为最近失衡段落补代价留痕或阶段回报。',
            targetPage: 'writing',
            severity: 'warning',
            issueKey: `growth-bridge-${firstGrowthChapter?.chapterNum || 'global'}`,
            taskType: 'bridge_patch',
            taskTitle: firstGrowthChapter ? `补写第${firstGrowthChapter.chapterNum}章过桥段` : '补写成长过桥段',
            taskDescription: '补出代价延续、反转支撑或收益交换桥段。',
            fixBrief: '在不推翻主线的情况下把代价和奖励重新挂钩。',
            chapterId: firstGrowthChapter?.chapterId,
            chapterNum: firstGrowthChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstGrowthChapter?.chapterId, firstGrowthChapter?.chapterNum),
          }),
        ],
      },
    ))
  }

  const overdueForeshadowChapterNums = dedupeChapterNums(foreshadowSnapshot.overdue.slice(0, 4).flatMap((card) => {
    const values = [card.targetPayoffChapter, card.plantedChapter, card.startChapter]
    return values.filter((chapterNum): chapterNum is number => typeof chapterNum === 'number')
  }))
  const firstForeshadowChapter = chapterDetailByNum.get(overdueForeshadowChapterNums[0] || 0)
  if (foreshadowSnapshot.overdue.length > 0 || contractProgressMetrics.foreshadowBlockedCount > 0 || contractProgressMetrics.foreshadowStaleCount > 0) {
    addRepairRisk(createDashboardRiskItem(
      'foreshadow_debt',
      foreshadowSnapshot.overdue.length > 0 ? 'critical' : 'warning',
      foreshadowSnapshot.overdue.length > 0 ? '伏笔已进入超期区' : '伏笔债务开始堆积',
      `待回收 ${foreshadowSnapshot.pending.length}，即将到期 ${foreshadowSnapshot.dueSoon.length}，已超期 ${foreshadowSnapshot.overdue.length}，合同阻塞 ${contractProgressMetrics.foreshadowBlockedCount}，失管 ${contractProgressMetrics.foreshadowStaleCount}。`,
      overdueForeshadowChapterNums,
      firstForeshadowChapter?.volumeId,
      {
        metricKey: 'foreshadow_debt',
        whyItHappened: '伏笔进入计划兑现窗口后，没有被章节合同、桥段铺设或延期说明及时接住。',
        howToFix: '判断每条伏笔是立即回收、补桥延期，还是显式标记允许偏移，不要继续无声拖延。',
        suggestedActions: [
          createRepairAction({
            metricKey: 'foreshadow_debt',
            actionType: 'create_revision_task',
            label: '生成伏笔修订任务',
            description: '把超期或失管伏笔打包进入修订中心。',
            targetPage: 'revision',
            severity: foreshadowSnapshot.overdue.length > 0 ? 'critical' : 'warning',
            safeToExecute: true,
            issueKey: `foreshadow-debt-${firstForeshadowChapter?.chapterNum || 'global'}`,
            taskType: 'continuity',
            taskTitle: '清理伏笔债务',
            taskDescription: '处理超期伏笔、合同阻塞和延期说明缺失。',
            fixBrief: '优先回收超期伏笔，再处理 due soon 和阻塞项。',
            chapterId: firstForeshadowChapter?.chapterId,
            chapterNum: firstForeshadowChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstForeshadowChapter?.chapterId, firstForeshadowChapter?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'foreshadow_debt',
            actionType: 'open_bridge_patch',
            label: firstForeshadowChapter ? `补写第${firstForeshadowChapter.chapterNum}章桥段` : '补写伏笔过桥',
            description: '为超期伏笔补过桥段或兑现动作。',
            targetPage: 'writing',
            severity: 'warning',
            issueKey: `foreshadow-bridge-${firstForeshadowChapter?.chapterNum || 'global'}`,
            taskType: 'bridge_patch',
            taskTitle: firstForeshadowChapter ? `补写第${firstForeshadowChapter.chapterNum}章伏笔过桥` : '补写伏笔过桥',
            taskDescription: '补一段能承接伏笔回收或显式延期的桥接场景。',
            fixBrief: '不要只口头提及，必须让读者能感知推进。',
            chapterId: firstForeshadowChapter?.chapterId,
            chapterNum: firstForeshadowChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstForeshadowChapter?.chapterId, firstForeshadowChapter?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'foreshadow_debt',
            actionType: 'allow_deviation',
            label: '标记允许偏移',
            description: '如果伏笔延后是作者有意决策，显式记录为允许偏移。',
            targetPage: 'revision',
            severity: 'info',
            issueKey: `foreshadow-deviation-${firstForeshadowChapter?.chapterNum || 'global'}`,
            taskType: 'continuity',
            taskTitle: '确认伏笔延期为允许偏移',
            taskDescription: '记录该伏笔延期的作者意图与新的回收节点。',
            fixBrief: '只有明确记录过的新节点，系统才不再继续提示为失管。',
            chapterId: firstForeshadowChapter?.chapterId,
            chapterNum: firstForeshadowChapter?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstForeshadowChapter?.chapterId, firstForeshadowChapter?.chapterNum),
          }),
        ],
      },
    ))
  }

  const firstWorldAlert = recentWorldStateAlerts[0]
  if (recentWorldStateAlerts.length > 0 || writebackPendingCount > 0 || writebackFailedCount > 0) {
    addRepairRisk(createDashboardRiskItem(
      'world_state',
      recentWorldStateAlerts.some((alert) => alert.severity === 'critical') || writebackFailedCount > 0 ? 'critical' : 'warning',
      firstWorldAlert ? `${firstWorldAlert.entityName} 状态需要同步` : '世界状态漂移加剧',
      `状态告警 ${recentWorldStateAlerts.length} 条，回写待处理 ${writebackPendingCount}，回写失败 ${writebackFailedCount}。`,
      dedupeChapterNums(recentWorldStateAlerts.slice(0, 4).map((alert) => alert.chapterNum)),
      firstWorldAlert ? volumeIdByChapterNum.get(firstWorldAlert.chapterNum) : undefined,
      {
        metricKey: 'world_state_drift',
        whyItHappened: '正文变更已经发生，但章后回写、时间轴或角色状态版本没有及时同步，导致总账与正文脱节。',
        howToFix: '先处理冲突实体和失败回写，再决定是同步状态，还是把该偏移登记为作者允许。',
        suggestedActions: firstWorldAlert
          ? [
            createRepairAction({
              metricKey: 'world_state_drift',
              actionType: firstWorldAlert.entityType === 'character' ? 'sync_character_state' : 'sync_timeline',
              label: firstWorldAlert.entityType === 'character' ? '同步角色状态' : '同步时间轴',
              description: '把世界状态风险落成同步任务。',
              targetPage: firstWorldAlert.entityType === 'character' ? 'characters' : 'timeline',
              severity: firstWorldAlert.severity === 'critical' ? 'critical' : 'warning',
              issueKey: `world-state-${firstWorldAlert.entityType}-${firstWorldAlert.entityId}-${firstWorldAlert.chapterNum}`,
              taskType: firstWorldAlert.entityType === 'character' ? 'character_state_sync' : 'timeline_sync',
              taskTitle: `同步${firstWorldAlert.entityName}状态`,
              taskDescription: firstWorldAlert.summary,
              fixBrief: '统一正文、状态版本与时间轴记录。',
              chapterId: firstWorldAlert.chapterId,
              chapterNum: firstWorldAlert.chapterNum,
              entityType: firstWorldAlert.entityType,
              entityId: firstWorldAlert.entityId,
              navigationQuery: {
                ...(createChapterNavigationQuery(firstWorldAlert.chapterId, firstWorldAlert.chapterNum) || {}),
                ...(firstWorldAlert.entityType === 'character' ? { characterId: String(firstWorldAlert.entityId) } : {}),
              },
            }),
            createRepairAction({
              metricKey: 'world_state_drift',
              actionType: 'allow_deviation',
              label: '标记允许偏移',
              description: '如果这是作者刻意偏移，显式记录为允许状态变更。',
              targetPage: 'revision',
              severity: 'info',
              issueKey: `world-state-deviation-${firstWorldAlert.entityType}-${firstWorldAlert.entityId}-${firstWorldAlert.chapterNum}`,
              taskType: 'continuity',
              taskTitle: `确认${firstWorldAlert.entityName}状态偏移`,
              taskDescription: `确认 ${firstWorldAlert.entityName} 在第${firstWorldAlert.chapterNum}章的状态偏移属于有意设定。`,
              fixBrief: '记录偏移原因和后续一致性约束。',
              chapterId: firstWorldAlert.chapterId,
              chapterNum: firstWorldAlert.chapterNum,
              entityType: firstWorldAlert.entityType,
              entityId: firstWorldAlert.entityId,
              navigationQuery: createChapterNavigationQuery(firstWorldAlert.chapterId, firstWorldAlert.chapterNum),
            }),
          ]
          : [],
      },
    ))
  }

  const revealFactSignals = storyFactRows.reduce<{
    early: Array<{ factId: number; title: string; chapterId: number; chapterNum: number; volumeId?: number }>
    forbidden: Array<{ factId: number; title: string; chapterId: number; chapterNum: number; volumeId?: number }>
    late: Array<{ factId: number; title: string; chapterId: number; chapterNum: number; volumeId?: number }>
  }>((result, fact) => {
    const readerKnownChapter = typeof fact.readerKnownChapterId === 'number' ? chapterDetailById.get(fact.readerKnownChapterId) : undefined
    const targetRevealChapter = typeof fact.targetRevealChapterId === 'number' ? chapterDetailById.get(fact.targetRevealChapterId) : undefined
    const readerKnownVolumeNumber = readerKnownChapter?.volumeId ? volumeNumberById.get(readerKnownChapter.volumeId) : undefined

    if (readerKnownChapter && targetRevealChapter && readerKnownChapter.chapterNum < targetRevealChapter.chapterNum) {
      result.early.push({
        factId: fact.id,
        title: fact.title,
        chapterId: readerKnownChapter.chapterId,
        chapterNum: readerKnownChapter.chapterNum,
        volumeId: readerKnownChapter.volumeId,
      })
    }
    if (readerKnownChapter && typeof fact.forbiddenBeforeVolume === 'number' && typeof readerKnownVolumeNumber === 'number' && readerKnownVolumeNumber < fact.forbiddenBeforeVolume) {
      result.forbidden.push({
        factId: fact.id,
        title: fact.title,
        chapterId: readerKnownChapter.chapterId,
        chapterNum: readerKnownChapter.chapterNum,
        volumeId: readerKnownChapter.volumeId,
      })
    }
    if (!readerKnownChapter && targetRevealChapter && targetRevealChapter.chapterNum < latestChapterNum) {
      result.late.push({
        factId: fact.id,
        title: fact.title,
        chapterId: targetRevealChapter.chapterId,
        chapterNum: targetRevealChapter.chapterNum,
        volumeId: targetRevealChapter.volumeId,
      })
    }
    return result
  }, { early: [], forbidden: [], late: [] })
  const firstRevealRisk = revealFactSignals.forbidden[0] || revealFactSignals.early[0] || revealFactSignals.late[0]
  if (firstRevealRisk) {
    addRepairRisk(createDashboardRiskItem(
      'info_reveal_pacing',
      revealFactSignals.forbidden.length > 0 || revealFactSignals.early.length > 0 ? 'critical' : 'warning',
      revealFactSignals.forbidden.length > 0 ? '关键信息过早暴露' : '信息揭示节奏开始失步',
      `提前揭示 ${revealFactSignals.early.length} 条，禁区前暴露 ${revealFactSignals.forbidden.length} 条，超计划未揭示 ${revealFactSignals.late.length} 条。`,
      dedupeChapterNums([
        ...revealFactSignals.forbidden.slice(0, 2).map((entry) => entry.chapterNum),
        ...revealFactSignals.early.slice(0, 2).map((entry) => entry.chapterNum),
        ...revealFactSignals.late.slice(0, 2).map((entry) => entry.chapterNum),
      ]),
      firstRevealRisk.volumeId,
      {
        metricKey: 'info_reveal_pacing',
        whyItHappened: '事实的计划揭示节点、读者知情节点和主角知情节点没有维持同一节奏，信息差板开始失效。',
        howToFix: '决定是补桥推迟揭示、重写提前暴露场景，还是把目标揭示节点重新登记到正确章节。',
        suggestedActions: [
          createRepairAction({
            metricKey: 'info_reveal_pacing',
            actionType: 'open_bridge_patch',
            label: firstRevealRisk ? `补写第${firstRevealRisk.chapterNum}章桥段` : '补写信息过桥',
            description: '补一段承接信息揭示节奏的桥接场景。',
            targetPage: 'writing',
            severity: revealFactSignals.forbidden.length > 0 || revealFactSignals.early.length > 0 ? 'critical' : 'warning',
            issueKey: `info-reveal-bridge-${firstRevealRisk?.factId || 'global'}`,
            taskType: 'bridge_patch',
            taskTitle: firstRevealRisk ? `修补第${firstRevealRisk.chapterNum}章信息揭示节奏` : '修补信息揭示节奏',
            taskDescription: `围绕「${firstRevealRisk?.title || '关键信息'}」补桥，调整读者和主角的知情节奏。`,
            fixBrief: '让揭示回到目标章节附近，并保留必要信息差。',
            chapterId: firstRevealRisk?.chapterId,
            chapterNum: firstRevealRisk?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstRevealRisk?.chapterId, firstRevealRisk?.chapterNum),
          }),
          createRepairAction({
            metricKey: 'info_reveal_pacing',
            actionType: 'create_revision_task',
            label: '生成揭示节奏修订',
            description: '把揭示过早/过晚问题落入修订中心。',
            targetPage: 'revision',
            severity: revealFactSignals.forbidden.length > 0 || revealFactSignals.early.length > 0 ? 'critical' : 'warning',
            safeToExecute: true,
            issueKey: `info-reveal-task-${firstRevealRisk?.factId || 'global'}`,
            taskType: 'continuity',
            taskTitle: '修复信息揭示节奏',
            taskDescription: '调整信息差谜题板中的揭示时机，避免过早暴露或过度拖延。',
            fixBrief: '必要时同时更新目标揭示章节和读者可知范围。',
            chapterId: firstRevealRisk?.chapterId,
            chapterNum: firstRevealRisk?.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstRevealRisk?.chapterId, firstRevealRisk?.chapterNum),
          }),
        ],
      },
    ))
  }

  const buildRepairMetricSummary = (metricKey: QualityRepairMetricKey, score: number, summary: string): QualityDashboardData['repairMetrics'][number] => {
    const metricRisks = repairRiskItems.filter((item) => item.metricKey === metricKey)
    return {
      key: metricKey,
      label: qualityRepairMetricLabel(metricKey),
      score: clampHealthScore(score),
      summary,
      riskCount: metricRisks.length,
      focusLabels: metricRisks.slice(0, 3).map((item) => item.title),
    }
  }
  const repairMetrics: QualityDashboardData['repairMetrics'] = [
    buildRepairMetricSummary(
      'commitment_delivery',
      100 - contractBlockerCount * 18 - contractWarningCount * 6 - endgameDebtSnapshot.overview.overdueCount * 10 - endgameDebtSnapshot.overview.unboundCount * 8 - Math.min(contractProgressMetrics.storyThreadMentionOnlyCount, 6) * 3,
      `合同通过率 ${contractReadyRate}%，终局过期 ${endgameDebtSnapshot.overview.overdueCount}，线程只提及未推进 ${contractProgressMetrics.storyThreadMentionOnlyCount}。`,
    ),
    buildRepairMetricSummary(
      'voice_distinction',
      100 - Math.round(dialogueSnapshot.dialogueFingerprintStats.averageCrossCharacterSimilarity * 0.6) - dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount * 8 - dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount * 6 - dialogueSnapshot.requiredDialogueVoiceLocks.length * 4,
      `高相似角色对 ${dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount}，漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount}。`,
    ),
    buildRepairMetricSummary(
      'growth_cost_balance',
      100 - protagonistSetbackSummary.longestSmoothRun * 8 - costPersistenceState.evaporatedCostCount * 10 - costPersistenceState.unresolvedCostCount * 5 - Math.max(0, protagonistSetbackSummary.longestPressureRun - PRESSURE_RUN_THRESHOLD) * 4,
      `最长顺滑连跑 ${protagonistSetbackSummary.longestSmoothRun} 章，代价蒸发 ${costPersistenceState.evaporatedCostCount}。`,
    ),
    buildRepairMetricSummary(
      'foreshadow_debt',
      100 - foreshadowSnapshot.overdue.length * 12 - foreshadowSnapshot.dueSoon.length * 5 - contractProgressMetrics.foreshadowBlockedCount * 6 - contractProgressMetrics.foreshadowStaleCount * 8,
      `超期伏笔 ${foreshadowSnapshot.overdue.length}，即将到期 ${foreshadowSnapshot.dueSoon.length}，合同失管 ${contractProgressMetrics.foreshadowStaleCount}。`,
    ),
    buildRepairMetricSummary(
      'world_state_drift',
      100 - recentWorldStateAlerts.filter((alert) => alert.severity === 'critical').length * 12 - recentWorldStateAlerts.filter((alert) => alert.severity === 'warning').length * 5 - writebackPendingCount * 4 - writebackFailedCount * 10,
      `状态告警 ${recentWorldStateAlerts.length}，回写待处理 ${writebackPendingCount}，回写失败 ${writebackFailedCount}。`,
    ),
    buildRepairMetricSummary(
      'info_reveal_pacing',
      100 - revealFactSignals.early.length * 12 - revealFactSignals.forbidden.length * 15 - revealFactSignals.late.length * 8,
      `过早揭示 ${revealFactSignals.early.length}，禁区前暴露 ${revealFactSignals.forbidden.length}，超计划未揭示 ${revealFactSignals.late.length}。`,
    ),
  ]
  const repairActionSummary: QualityDashboardData['repairActionSummary'] = {
    actionableRiskCount: repairRiskItems.filter((item) => item.suggestedActions.length > 0).length,
    taskActionCount: repairRiskItems.flatMap((item) => item.suggestedActions).filter((action) => Boolean(action.taskDraft)).length,
    directExecutableActionCount: repairRiskItems.flatMap((item) => item.suggestedActions).filter((action) => action.safeToExecute).length,
    allowDeviationCount: repairRiskItems.flatMap((item) => item.suggestedActions).filter((action) => action.actionType === 'allow_deviation').length,
    topPriorityActions: repairRiskItems
      .flatMap((item) => item.suggestedActions.slice(0, 1).map((action) => action.label))
      .slice(0, 4),
  }
  const volumeQualityMetricsWithRepairs: VolumeQualityMetrics[] = volumeQualityMetrics.map((volume) => ({
    ...volume,
    topRisks: dedupeDashboardRiskItems([
      ...volume.topRisks,
      ...repairRiskItems.filter((item) => item.volumeId === volume.volumeId),
    ]).sort(sortDashboardRisks).slice(0, 6),
  }))
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
    ...feedbackSummary.recentAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'feedback_recurrence',
      alert.pauseSuggested ? 'critical' : alert.severity === 'critical' ? 'warning' : 'info',
      `${alert.title} 复现预警`,
      alert.detail,
      alert.chapterNums,
      volumeIdByChapterNum.get(alert.chapterNums.at(-1) || 0),
    )),
  ]
  globalRisks.push(
    ...styleComplianceAlerts.slice(0, 3).map((alert) => createDashboardRiskItem(
      'style_compliance',
      alert.status === 'rewrite' ? 'critical' : 'warning',
      `第${alert.chapterNum}章文风偏移`,
      alert.summary,
      [alert.chapterNum],
      volumeIdByChapterNum.get(alert.chapterNum),
    )),
  )
  const allRiskItems = dedupeDashboardRiskItems([
    ...volumeQualityMetricsWithRepairs.flatMap((entry) => entry.topRisks),
    ...globalRisks,
    ...repairRiskItems,
  ]).sort(sortDashboardRisks)
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
    healthScore: computeNovelHealthScore(volumeQualityMetricsWithRepairs, criticalRiskCount, warningRiskCount),
    totalVolumeCount: volumeQualityMetricsWithRepairs.length,
    totalChapterCount: rows.length,
    analyzedChapterCount: scoredCount,
    criticalRiskCount,
    warningRiskCount,
    foreshadowPendingCount,
    foreshadowDueSoonCount,
    foreshadowOverdueCount,
    foreshadowBlockedCount: contractProgressMetrics.foreshadowBlockedCount,
    foreshadowStaleCount: contractProgressMetrics.foreshadowStaleCount,
    storyThreadAdvanceRate: contractProgressMetrics.storyThreadAdvanceRate,
    storyThreadMentionOnlyCount: contractProgressMetrics.storyThreadMentionOnlyCount,
    endgameActiveCount: endgameDebtSnapshot.overview.activeCount,
    endgameServedCount: endgameDebtSnapshot.overview.servedCount,
    endgameOverdueCount: endgameDebtSnapshot.overview.overdueCount,
    endgameUnboundCount: endgameDebtSnapshot.overview.unboundCount,
    riskOverview,
    topRisks: allRiskItems.slice(0, 8),
    recommendedFocusVolumes: volumeQualityMetricsWithRepairs
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
  const batchChapterNumSet = new Set(batchChapterNums)
  const batchGateEntries = latestChapterGateEntries.filter((entry) =>
    batchChapterNumSet.size > 0 && batchChapterNumSet.has(entry.chapterNum))
  const latestBatchInspections = latestBatchSnapshotId
    ? db.select().from(chapterBatchInspections)
      .where(eq(chapterBatchInspections.snapshotId, latestBatchSnapshotId))
      .orderBy(desc(chapterBatchInspections.createdAt), desc(chapterBatchInspections.id))
      .all()
    : []
  const inspectionBlockedCount = latestBatchInspections.filter((row) => row.status === 'blocked').length
  const inspectionWarningCount = latestBatchInspections.filter((row) => row.status === 'warning').length
  const inspectionPassedChapters = new Set(
    latestBatchInspections
      .filter((row) => row.status === 'pass')
      .map((row) => row.chapterNum || batchChapterNumById.get(row.chapterId || 0) || 0)
      .filter((chapterNum) => chapterNum > 0),
  )
  const recallDegradedChapterCount = rows.reduce((count, row) => {
    const snapshot = recallRuntimeByChapterId.get(row.id)?.recallSnapshot
    return count + (snapshot?.degraded ? 1 : 0)
  }, 0)
  const latestCompletedChapterNums = dedupeNumbers(
    Array.isArray(latestBatchProgress.completedChapterIds)
      ? latestBatchProgress.completedChapterIds
          .map((chapterId) => batchChapterNumById.get(chapterId) || 0)
          .filter((chapterNum) => chapterNum > 0)
      : [],
  )
  let trailingRecallFallbackCount = 0
  for (const chapterNum of [...latestCompletedChapterNums].sort((left, right) => right - left)) {
    const entry = chapterDetails.find((item) => item.chapterNum === chapterNum)
    if (!entry?.recallSnapshot?.degraded) break
    trailingRecallFallbackCount += 1
  }
  const latestBatchConsecutiveRecallFallbackChapters = typeof latestBatchProgress.consecutiveRecallFallbackChapters === 'number'
    ? latestBatchProgress.consecutiveRecallFallbackChapters
    : trailingRecallFallbackCount
  const millionWordDashboard = buildMillionWordDashboardSummary({
    latestBatchTask,
    latestBatchTaskId,
    latestBatchSnapshotId,
    latestBatchProgress,
    batchChapterIds,
    batchChapterNums,
    rewriteTaskCount,
    batchPendingWritebackCount,
    pendingRevisionCount,
    staleCheckpointCount,
    latestCheckpointChapterGap,
    recallDegradedChapterCount,
    latestBatchConsecutiveRecallFallbackChapters,
    worldConflictCount: worldStateLedger.conflictEntities.length,
    writebackPendingCount,
    writebackFailedCount,
    contractReadyRate,
    contractBlockerCount,
    contractWarningCount,
    contractProgressMetrics,
    inspectionPassedChapterCount: inspectionPassedChapters.size,
    rewrittenChapterCount: batchGateEntries.filter((entry) => entry.rewriteCount > 0 || entry.gateLevel === 'warning').length,
    inspectionBlockedCount,
    inspectionWarningCount,
    batchGateBlockedCount: batchGateEntries.filter((entry) => entry.gateLevel === 'blocker').length,
    latestBatchFailedChapterCount: Array.isArray(latestBatchProgress.failedChapterIds) ? latestBatchProgress.failedChapterIds.length : 0,
    latestBatchInspectionsCount: latestBatchInspections.length,
    recentBatchRecallAlerts: recentRecallAlerts
      .filter((alert) => batchChapterNumSet.size > 0 && batchChapterNumSet.has(alert.chapterNum))
      .slice(0, 3)
      .map((alert) => `第${alert.chapterNum}章：${alert.detail}`),
    recurringIssues: [
      ...antiAiSummary.topRepeatedRules.slice(0, 2).map((item) => `反 AI 复现：${item.ruleTitle}`),
      ...feedbackSummary.topRepeatedIssues.slice(0, 2).map((item) => `审校复现：${item.title}`),
    ].slice(0, 4),
    aiRecurrenceHighRiskCount: antiAiSummary.overview.highRiskRuleCount,
    feedbackPauseSuggestedCount: feedbackSummary.overview.pauseSuggestedIssueCount,
  })
  const expressionDedupReports = rows
    .map((row) => ({ chapterId: row.id, chapterNum: row.chapterNum, report: parseExpressionDedupJson(row.expressionDedupJson) }))
    .filter((entry): entry is { chapterId: number; chapterNum: number; report: NonNullable<ReturnType<typeof parseExpressionDedupJson>> } => Boolean(entry.report))
  const expressionPhraseMap = expressionDedupReports.reduce<Map<string, ExpressionDedupHit>>((result, entry) => {
    entry.report.repeatedPhrases.forEach((phrase) => {
      const current = result.get(phrase.phrase)
      if (!current) {
        result.set(phrase.phrase, {
          phrase: phrase.phrase,
          count: phrase.count,
          chapterNums: dedupeChapterNums(phrase.chapterNums),
        })
        return
      }
      result.set(phrase.phrase, {
        phrase: phrase.phrase,
        count: Math.max(current.count, phrase.count),
        chapterNums: dedupeChapterNums([...current.chapterNums, ...phrase.chapterNums]),
      })
    })
    return result
  }, new Map())
  const expressionDedupSummary: QualityDashboardData['expressionDedupSummary'] = {
    analyzedChapterCount: expressionDedupReports.length,
    currentMode: expressionDedupReports.at(-1)?.report.mode || 'short',
    recentWindowSize: expressionDedupReports.at(-1)?.report.recentWindowSize || 0,
    volumeWindowSize: expressionDedupReports.at(-1)?.report.volumeWindowSize || 0,
    globalSampleWindowSize: expressionDedupReports.at(-1)?.report.globalSampleWindowSize || 0,
    highRiskChapterCount: expressionDedupReports.filter((entry) => entry.report.riskLevel === 'high').length,
    recentHighRiskChapterNums: dedupeChapterNums(
      expressionDedupReports
        .filter((entry) => entry.report.riskLevel === 'high')
        .slice(-6)
        .map((entry) => entry.chapterNum),
    ),
    topRepeatedPhrases: [...expressionPhraseMap.values()]
      .sort((left, right) => right.count - left.count || right.chapterNums.length - left.chapterNums.length)
      .slice(0, 6),
    repeatedOpeningPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.repeatedOpenings), 6),
    repeatedClosingPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.repeatedClosings), 6),
    repeatedStructuralPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.repeatedStructuralPatterns), 6),
    repeatedClimaxPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.repeatedClimaxPatterns), 6),
    volumeRepeatedPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.volumeRepeatedPatterns), 6),
    globalRepeatedPatterns: dedupeStrings(expressionDedupReports.flatMap((entry) => entry.report.globalRepeatedPatterns), 6),
    summary: expressionDedupReports.length > 0
      ? `${expressionDedupReports.at(-1)?.report.mode === 'longform' ? '当前按长篇策略' : '当前按短篇策略'}分析跨章表达复用；高风险章节 ${expressionDedupReports.filter((entry) => entry.report.riskLevel === 'high').length} 章。`
      : '当前还没有可用的跨章表达复用数据。',
  }
  const summaryHealthReports = rows
    .map((row) => ({ chapterId: row.id, chapterNum: row.chapterNum, report: parseSummaryHealthReport(row.summaryHealthJson) }))
    .filter((entry): entry is { chapterId: number; chapterNum: number; report: SummaryHealthReport } => Boolean(entry.report))
  const summaryHealthSummary: QualityDashboardData['summaryHealthSummary'] = {
    analyzedChapterCount: summaryHealthReports.length,
    degradedChapterCount: summaryHealthReports.filter((entry) => entry.report.status === 'degraded').length,
    averageDensityScore: summaryHealthReports.length > 0
      ? roundMetric(summaryHealthReports.reduce((sum, entry) => sum + entry.report.densityScore, 0) / summaryHealthReports.length)
      : 0,
    averageEntityCoverageScore: summaryHealthReports.length > 0
      ? roundMetric(summaryHealthReports.reduce((sum, entry) => sum + entry.report.entityCoverageScore, 0) / summaryHealthReports.length)
      : 0,
    averageEventCoverageScore: summaryHealthReports.length > 0
      ? roundMetric(summaryHealthReports.reduce((sum, entry) => sum + entry.report.eventCoverageScore, 0) / summaryHealthReports.length)
      : 0,
    recentAlerts: summaryHealthReports
      .filter((entry) => entry.report.status !== 'healthy')
      .slice(-6)
      .map((entry) => ({
        chapterId: entry.chapterId,
        chapterNum: entry.chapterNum,
        status: entry.report.status,
        summary: entry.report.warnings[0] || `摘要健康 ${entry.report.status}`,
      })),
    summary: summaryHealthReports.length > 0
      ? `已分析 ${summaryHealthReports.length} 章摘要；退化章节 ${summaryHealthReports.filter((entry) => entry.report.status === 'degraded').length} 章。`
      : '当前还没有摘要健康报告。',
  }
  const hookContinuityReports = rows
    .map((row) => ({ chapterNum: row.chapterNum, report: parseHookContinuityJson(row.hookContinuityJson) }))
    .filter((entry): entry is { chapterNum: number; report: NonNullable<ReturnType<typeof parseHookContinuityJson>> } => Boolean(entry.report))
  const latestHookContinuity = hookContinuityReports.at(-1)?.report
  const hookContinuitySummary: QualityDashboardData['hookContinuitySummary'] = {
    analyzedChapterCount: hookContinuityReports.length,
    weakHookChapterCount: hookContinuityReports.filter((entry) => entry.report.hookStrengthScore < 70 || Boolean(entry.report.warning)).length,
    weakHookStreak: latestHookContinuity?.weakHookStreak || 0,
    averageHookStrengthScore: hookContinuityReports.length > 0
      ? roundMetric(hookContinuityReports.reduce((sum, entry) => sum + entry.report.hookStrengthScore, 0) / hookContinuityReports.length)
      : 0,
    recentHookTypes: dedupeStrings(hookContinuityReports.flatMap((entry) => entry.report.recentHookTypes), 6),
    summary: hookContinuityReports.length > 0
      ? `已分析 ${hookContinuityReports.length} 章章尾钩子；当前连续弱钩子 ${latestHookContinuity?.weakHookStreak || 0} 章。`
      : '当前还没有钩子连续性数据。',
  }
  const voiceEvolutionProfiles = buildVoiceEvolutionProfiles(novelId)
  const voiceEvolutionSummary: QualityDashboardData['voiceEvolutionSummary'] = {
    trackedCharacterCount: dialogueSnapshot.characterDialogueSignatures.length,
    driftingCharacterCount: dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount,
    profiles: voiceEvolutionProfiles,
    summary: dialogueSnapshot.dialogueFingerprintStats.analyzedCharacterCount > 0
      ? `已追踪 ${dialogueSnapshot.dialogueFingerprintStats.analyzedCharacterCount} 名角色对白；漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount} 名。`
      : '当前还没有足够的对白样本来分析角色声音进化。',
  }

  return {
    dashboardVersion: 'v2-repair',
    dashboardNotes: [
      ...millionWordDashboard.dashboardNotes,
      '当前版本已升级为质量修复引擎：每个高价值风险都会给出原因、修法和直接动作。',
      '安全动作会直接落任务，其他动作会保留定位信息并引导到对应页面处理。',
    ],
    repairActionSummary,
    repairMetrics,
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
    antiAiRecurrence: {
      totalHitCount: antiAiSummary.overview.totalHitCount,
      hitChapterCount: antiAiSummary.overview.hitChapterCount,
      recurringRuleCount: antiAiSummary.overview.recurringRuleCount,
      promotedRuleCount: antiAiSummary.overview.promotedRuleCount,
      highRiskRuleCount: antiAiSummary.overview.highRiskRuleCount,
      topRepeatedRules: antiAiSummary.topRepeatedRules,
      promotedRules: antiAiSummary.promotedRules,
      recentAlerts: antiAiSummary.recentAlerts,
      volumeEntries: antiAiVolumeEntries,
    },
    feedbackRecurrence: {
      totalHitCount: feedbackSummary.overview.totalHitCount,
      hitChapterCount: feedbackSummary.overview.hitChapterCount,
      recurringIssueCount: feedbackSummary.overview.recurringIssueCount,
      promotedIssueCount: feedbackSummary.overview.promotedIssueCount,
      highRiskIssueCount: feedbackSummary.overview.highRiskIssueCount,
      pauseSuggestedIssueCount: feedbackSummary.overview.pauseSuggestedIssueCount,
      topRepeatedIssues: feedbackSummary.topRepeatedIssues,
      promotedIssues: feedbackSummary.promotedIssues,
      recentAlerts: feedbackSummary.recentAlerts,
      humanization: {
        totalHitCount: feedbackSummary.humanizationSummary.totalHitCount,
        hitChapterCount: feedbackSummary.humanizationSummary.hitChapterCount,
        recurringIssueCount: feedbackSummary.humanizationSummary.recurringIssueCount,
        promotedIssueCount: feedbackSummary.humanizationSummary.promotedIssueCount,
        highRiskIssueCount: feedbackSummary.humanizationSummary.highRiskIssueCount,
        pauseSuggestedIssueCount: feedbackSummary.humanizationSummary.pauseSuggestedIssueCount,
        topRepeatedIssues: feedbackSummary.humanizationSummary.topRepeatedIssues,
        promotedIssues: feedbackSummary.humanizationSummary.promotedIssues,
        recentAlerts: feedbackSummary.humanizationSummary.recentAlerts,
      },
      volumeEntries: feedbackVolumeEntries,
    },
    styleCompliance: styleComplianceSummary,
    dialogueFingerprintStats: dialogueSnapshot.dialogueFingerprintStats,
    characterDialogueSignatures: dialogueSnapshot.characterDialogueSignatures,
    crossCharacterDialogueSimilarity: dialogueSnapshot.crossCharacterDialogueSimilarity,
    dialogueDriftTrend: dialogueSnapshot.dialogueDriftTrend,
    volumeDialogueSimilarity: dialogueSnapshot.volumeDialogueSimilarity,
    recentDialogueAlerts: dialogueSnapshot.recentDialogueAlerts,
    requiredDialogueVoiceLocks: dialogueSnapshot.requiredDialogueVoiceLocks,
    storyDynamicsTrend,
    storyPacingAlerts,
    volumeStoryDynamics,
    volumeQualityMetrics: volumeQualityMetricsWithRepairs,
    novelQualityMetrics,
    productionReadiness: millionWordDashboard.productionReadiness,
    batchHealth: millionWordDashboard.batchHealth,
    continuityHealth: millionWordDashboard.continuityHealth,
    contractDelivery: millionWordDashboard.contractDelivery,
    batchReview: millionWordDashboard.batchReview,
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
    expressionDedupSummary,
    summaryHealthSummary,
    hookContinuitySummary,
    voiceEvolutionSummary,
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
