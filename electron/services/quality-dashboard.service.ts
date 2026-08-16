import type {
  ChapterBatchAutoGenerateStatus,
  ChapterDialogueReviewData,
  ExpressionDedupHit,
  ExpressionDedupMode,
  ChapterFunctionAlert,
  ChapterFunctionRun,
  ChapterFunctionTag,
  LanguageDriftMetrics,
  LanguageDriftTrendStatus,
  NovelLanguageDriftSummary,
  NovelQualityMetrics,
  QualityDashboardData,
  QualityDashboardRiskItem,
  QualityDashboardRiskKind,
  QualityDashboardRiskSeverity,
  QualityRepairAction,
  QualityRepairMetricKey,
  StoryDynamicsAlert,
  StoryDynamicsTrendPoint,
  StyleComplianceResult,
  SummaryHealthReport,
  VolumeLanguageDriftEntry,
  VolumeChapterFunctionEntry,
  VolumeQualityMetrics,
  VolumeStoryDynamicsEntry,
  WorldStateAlert,
} from '../../src/types'
import type { QualityAgentDashboardSnapshot } from '../../src/shared/quality-agent-dashboard'
import {
  getOperatingModePolicy,
  getOperatingModeRuntimePolicy,
  isHistoricalGenreUsingGenericFallback,
  resolveOperatingMode,
} from '../../src/shared/operating-mode'
import {
  countUnresolvedTypedRefs,
  hasTypedRefOverlay,
} from '../../src/shared/typed-ref'
import { assessHistoricalGrounding, getBuiltinGenreRules } from '../../src/shared/genre-system'
import { tasks } from '../database/schema'
import { buildPreviousChapterContextFeed } from './context.service'
import { getStoryMemoryCheckpointRefreshStatus } from './story-memory.service'
import {
  buildChapterGateDriftSummary,
  safeParseStringArray,
} from './chapter-gate-utils'
import { getDialogueAnalyticsSnapshot, scheduleDialogueFingerprintRefresh } from './dialogue-fingerprint.service'
import { buildVoiceEvolutionProfiles } from './generation-integrity.service'
import { getEndgameDebtSnapshot } from './endgame-asset.service'
import { listChapterRecallRuntimeMap } from './chapter-recall-runtime.service'
import { getStoryArcProgressSnapshot } from './story-arc-progress.service'
import { getForeshadowSnapshot } from './story-thread.service'
import { getWorldStateLedgerSnapshot } from './world-state.service'
import { buildStoryMemoryPromptPackage } from './story-memory.service'
import { getAntiAiDashboardSummary } from './anti-ai-rule.service'
import { getFeedbackRecurrenceDashboardSummary } from './feedback-recurrence.service'
import { parseChapterContractValidationFromReviewNotes } from './chapter-contract-validator.service'
import {
  loadQualityDashboardBatchSnapshot,
  loadQualityDashboardCatalogSnapshot,
  loadQualityDashboardDerivedDatabaseSnapshot,
} from './quality-dashboard-loader'
import { deriveChapterGateMetrics } from './quality-dashboard-gate-metrics'
import { deriveChapterScoreMetrics } from './quality-dashboard-chapter-metrics'
import { assembleQualityDashboardData } from './quality-dashboard-assembler'
import { buildRuntimeObservability } from './quality-dashboard-runtime-metrics'
import { buildVolumeTopRisks } from './quality-dashboard-volume-metrics'
import {
  buildRepairActionSummary,
  buildRepairMetricSummary as createRepairMetricSummary,
} from './quality-dashboard-repair-metrics'
import {
  LANGUAGE_DRIFT_METRICS,
  RECENT_LANGUAGE_DRIFT_WINDOW,
  averageLanguageDrift,
  emptyLanguageDriftSeries,
  pushLanguageDriftMetrics,
  rankLanguageDriftMetrics,
  sortTrendSummaries,
  summarizeTrend,
  type LanguageDriftSeries,
} from './quality-dashboard-language-metrics'
import { listArtifacts } from './artifact.service'
import {
  getHardContractValidationItems,
  isContractValidationBlockerVerdict,
  isContractValidationWarningVerdict,
} from '../../src/shared/contract-validation'
import {
  buildHeuristicRecallDiagnostics,
  buildRecallBucketCoverageRate,
  buildRecallFreshnessState,
  formatRecallFallbackReason,
  getConsecutiveRecallFallbackCount,
  pickLatestRecallFallbackReason,
  resolveRecallDiagnosticThreshold,
  sumRecallDiagnosticMetric,
} from './quality-dashboard-recall-diagnostics'
import {
  buildBookFunctionSkewAlert,
  buildChapterFunctionDiagnostics,
  buildRepeatedFunctionAlerts,
  buildVolumeFunctionSkewAlert,
  parseChapterFunction,
  sortChapterFunctionAlerts,
  type ChapterFunctionChapterRecord,
} from './quality-dashboard-chapter-functions'
import {
  PRESSURE_RUN_THRESHOLD,
  SMOOTH_RUN_THRESHOLD,
  buildStoryPacingAlerts,
  computeCostPersistence,
  computeProtagonistSetbackSummary,
  computeReversalDistribution,
  toRewardLevel,
  toSetbackLevel,
  type StoryDynamicsChapterRecord,
} from './quality-dashboard-story-dynamics'
import { buildStoryDynamicsReadModel } from './story-dynamics-read-model'

export { buildHeuristicRecallDiagnostics } from './quality-dashboard-recall-diagnostics'

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
interface QualityDashboardOptions {
  includeDialogueInsights?: boolean
}

const DIMENSION_NAMES = ['文笔质量', '逻辑连贯', '节奏控制', '情感深度', '人物塑造', '世界一致', '创新性', '追读欲']
const QUALITY_RISK_LABELS: Record<QualityDashboardRiskKind, string> = {
  commitment_delivery: '承诺兑现率',
  typed_ref_coverage: 'Typed Ref 覆盖',
  source_grounding: '来源 Grounding',
  operating_mode_policy: 'OperatingMode 策略',
  genre_register_drift: '题材语域漂移',
  exposition_density: '解释密度 / 说明文',
  long_window_homogenization: '累积同质化',
  dialogue_separability: '对白可分离度',
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
  typed_ref_coverage: 'Typed Ref 覆盖',
  source_grounding: '来源 Grounding',
  operating_mode_policy: 'OperatingMode 策略',
  genre_register_drift: '题材语域漂移',
  exposition_density: '解释密度 / 说明文',
  long_window_homogenization: '累积同质化',
  dialogue_separability: '对白可分离度',
  language_drift: 'AI味退化',
  feedback_recurrence: '审校复现',
  style_compliance: '风格硬约束',
  recall: '召回可靠性',
  chapter_function: '章节功能',
  story_arc: '故事弧推进',
  voice_distinction: '角色声音区分度',
  growth_cost_balance: '成长-代价平衡',
  foreshadow_debt: '伏笔债务压力',
  world_state_drift: '世界状态漂移',
  info_reveal_pacing: '信息揭示节奏',
}
const DEFAULT_RISK_CAUSES: Partial<Record<QualityDashboardRiskKind, string>> = {
  commitment_delivery: '承诺没有稳定进入卷级设计、章节合同和实际正文执行链，导致兑现节点开始漂移。',
  endgame_debt: '承诺没有稳定进入卷级设计、章节合同和实际正文执行链，导致兑现节点开始漂移。',
  voice_distinction: '对白指纹、角色声音锁和近期审校信号出现重叠，角色说话方式开始同质化。',
  growth_cost_balance: '成长收益、主角受挫和代价持续性没有保持同步，导致剧情推进出现“只拿收益”或“只压不收”的失衡。',
  story_dynamics: '成长收益、主角受挫和代价持续性没有保持同步，导致剧情推进出现“只拿收益”或“只压不收”的失衡。',
  foreshadow_debt: '伏笔已进入应回收窗口，但合同推进、桥段铺设或延期说明没有及时跟上。',
  world_state: '正文状态变更、章后回写和状态总账之间没有保持一致，出现漂移或冲突。',
  info_reveal_pacing: '事实的读者知情、主角知情与计划揭示节奏发生错位，导致揭示过早或过晚。',
  recall: '章节生成依赖的历史片段出现降级、缺失或过期，当前上下文稳定性不足。',
  language_drift: '破折号、括号解释、模板短段、排比和低价值身体细节正在跨章节累积。',
  feedback_recurrence: '相同审校问题在近期多章复现，说明单章修补没有进入后续硬约束。',
  style_compliance: '章节与样章风格锁、禁用表达或句段比例约束发生偏移。',
  chapter_function: '章节功能没有形成清晰推进、反转、回收或喘息节奏，导致连续阅读目标模糊。',
  story_arc: '故事弧阶段推进和正文落点脱节，出现长段空转或阶段未兑现。',
}
const DEFAULT_RISK_FIXES: Partial<Record<QualityDashboardRiskKind, string>> = {
  commitment_delivery: '先补齐卷承诺与章节合同绑定，再把兑现或推进动作落到具体章节任务。',
  endgame_debt: '先补齐卷承诺与章节合同绑定，再把兑现或推进动作落到具体章节任务。',
  voice_distinction: '优先回查相关章节的对白，把角色目标、词汇偏好和语气差异重新写实。',
  growth_cost_balance: '补出代价留痕、收益交换或反转支撑，让主角成长与付出重新对应。',
  story_dynamics: '补出代价留痕、收益交换或反转支撑，让主角成长与付出重新对应。',
  foreshadow_debt: '决定是补写回收桥段、显式延期说明，还是把伏笔转移到新的兑现节点。',
  world_state: '核对正文、时间轴和状态版本，优先同步冲突状态，再明确哪些偏移是作者允许的。',
  info_reveal_pacing: '把信息揭示重新绑定到目标章节，必要时补桥段或后移暴露点。',
  recall: '先恢复召回链路或缩窄上下文依赖，再继续基于旧片段推进后续章节。',
  language_drift: '把风险落到最近章节的语言修订任务，优先删减模板句、解释腔和低价值细节。',
  feedback_recurrence: '将复现审校项升级为修订任务和后续硬约束，先处理最近命中的章节。',
  style_compliance: '对照风格锁回调句长、段长、对白密度和禁用表达，必要时重写问题段落。',
  chapter_function: '回到章节合同确认本章功能位，并补足推进、反转、回收或喘息的可见动作。',
  story_arc: '把停滞故事弧重新绑定到章节合同和正文行动，补阶段兑现或延期说明。',
}
function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function dedupeChapterNums(chapterNums: number[]): number[] {
  return [...new Set(chapterNums)].sort((left, right) => left - right)
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

function averageNumbers(values: number[]): number {
  if (values.length === 0) return 0
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function parseReviewFindingArrays(raw?: string | null): {
  typedRefRisks: string[]
  sourceGroundingRisks: string[]
  operatingModeRisks: string[]
} {
  if (!raw) {
    return {
      typedRefRisks: [],
      sourceGroundingRisks: [],
      operatingModeRisks: [],
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      typedRefRisks: safeParseStringArray(JSON.stringify(parsed.typed_ref_risks || [])),
      sourceGroundingRisks: safeParseStringArray(JSON.stringify(parsed.source_grounding_risks || [])),
      operatingModeRisks: safeParseStringArray(JSON.stringify(parsed.operating_mode_risks || [])),
    }
  } catch {
    return {
      typedRefRisks: [],
      sourceGroundingRisks: [],
      operatingModeRisks: [],
    }
  }
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
    case 'style_compliance':
      return 'style_compliance'
    case 'language_drift':
      return 'language_drift'
    case 'feedback_recurrence':
      return 'feedback_recurrence'
    case 'recall':
      return 'recall'
    case 'chapter_function':
      return 'chapter_function'
    case 'story_arc':
      return 'story_arc'
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
    case 'recall':
      return 'writing'
    case 'style_compliance':
    case 'language_drift':
    case 'feedback_recurrence':
      return 'revision'
    case 'chapter_function':
    case 'story_arc':
      return 'contracts'
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
  return detail
    || DEFAULT_RISK_CAUSES[kind]
    || '当前指标已经跨过预警阈值，需要把问题定位到具体章节和修复链路。'
}

function buildDefaultRiskHowToFix(kind: QualityDashboardRiskKind): string {
  return DEFAULT_RISK_FIXES[kind]
    || '把风险落成修订任务，先处理受影响最大的章节或资产，再回看指标是否恢复。'
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

type ParsedChapterContractValidation = NonNullable<ReturnType<typeof parseChapterContractValidationFromReviewNotes>>

function getDashboardContractHardStatus(
  validation: ParsedChapterContractValidation,
): ParsedChapterContractValidation['status'] {
  if (validation.itemResults.length === 0) return validation.status
  const hardItems = getHardContractValidationItems(validation.itemResults)
  if (hardItems.some((item) => isContractValidationBlockerVerdict(item.verdict))) return 'blocker'
  if (hardItems.some((item) => isContractValidationWarningVerdict(item.verdict))) return 'warning'
  return 'pass'
}

function hasDashboardContractHardBlocker(validation: ParsedChapterContractValidation): boolean {
  return getDashboardContractHardStatus(validation) === 'blocker'
}

function summarizeBatchRange(chapterNums: number[]): string {
  const normalized = dedupeNumbers(chapterNums)
  if (normalized.length === 0) return '未记录章节范围'
  if (normalized.length === 1) return `第${normalized[0]}章`
  return `第${normalized[0]}-${normalized[normalized.length - 1]}章`
}

function classifyWritebackStatus(status?: string | null): 'pending' | 'failed' | 'applied' {
  if (status === 'failed' || status === 'partially_failed') return 'failed'
  if (status === 'applied') return 'applied'
  return 'pending'
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

function buildTypedRefObservability(typedRefRows: ReturnType<typeof loadQualityDashboardDerivedDatabaseSnapshot>['typedRefRows']): NonNullable<QualityDashboardData['typedRefObservability']> {
  const buckets = [
    {
      assetType: 'thread' as const,
      rows: typedRefRows.thread,
    },
    {
      assetType: 'timeline' as const,
      rows: typedRefRows.timeline,
    },
    {
      assetType: 'item' as const,
      rows: typedRefRows.item,
    },
  ].map((bucket) => {
    const totalCount = bucket.rows.length
    const typedRefCount = bucket.rows.filter((row) => hasTypedRefOverlay(row.typedRefsJson)).length
    const unresolvedCount = bucket.rows.reduce((sum, row) => sum + countUnresolvedTypedRefs(row.typedRefsJson), 0)
    const coverageRate = totalCount > 0 ? roundMetric((typedRefCount / totalCount) * 100) : 100
    return {
      assetType: bucket.assetType,
      totalCount,
      typedRefCount,
      unresolvedCount,
      coverageRate,
    }
  })

  const totalCount = buckets.reduce((sum, bucket) => sum + bucket.totalCount, 0)
  const totalTypedRefCount = buckets.reduce((sum, bucket) => sum + bucket.typedRefCount, 0)
  const unresolvedRefCount = buckets.reduce((sum, bucket) => sum + bucket.unresolvedCount, 0)
  const overallCoverageRate = totalCount > 0 ? roundMetric((totalTypedRefCount / totalCount) * 100) : 100

  return {
    overallCoverageRate,
    unresolvedRefCount,
    buckets,
    summary: totalCount === 0
      ? '当前还没有可统计的线程、时间线或物品资产。'
      : `typed ref 已覆盖 ${totalTypedRefCount}/${totalCount} 个资产，覆盖率 ${overallCoverageRate}%，未解析引用 ${unresolvedRefCount} 条。`,
  }
}

const QUALITY_AGENT_ARTIFACT_KINDS = new Set([
  'quality_report',
  'repair_plan',
  'quality_repair_draft',
  'quality_repair_review',
  'quality_comparison',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function asNumberList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0)
    : []
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : []
}

function qualityAgentStatus(value: unknown): 'passed' | 'needs_revision' | 'blocked' {
  return value === 'passed' || value === 'needs_revision' ? value : 'blocked'
}

function qualityAgentComparisonStatus(value: unknown): 'improved' | 'mixed' | 'regressed' | 'unchanged' {
  return value === 'improved' || value === 'mixed' || value === 'regressed' ? value : 'unchanged'
}

function buildEmptyQualityAgentDashboardSnapshot(): QualityAgentDashboardSnapshot {
  return {
    artifactHistory: [],
    repairPlans: [],
    candidateDiffs: [],
    independentReviews: [],
    comparisons: [],
    summary: {
      artifactCount: 0,
      reportCount: 0,
      repairPlanCount: 0,
      candidateDiffCount: 0,
      independentReviewCount: 0,
      comparisonCount: 0,
    },
  }
}

function buildQualityAgentDashboardSnapshot(novelId: number): QualityAgentDashboardSnapshot {
  try {
    const artifacts = listArtifacts({ novelId, limit: 200 })
      .filter((artifact) => QUALITY_AGENT_ARTIFACT_KINDS.has(artifact.kind))
    const artifactHistory = artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      status: artifact.status,
      version: artifact.version,
      parentArtifactId: artifact.parentArtifactId,
      reviewArtifactId: artifact.reviewArtifactId,
      contentHash: artifact.contentHash,
      contextVersion: artifact.contextVersion,
      taskId: artifact.taskId,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
    }))
    const reportArtifacts = artifacts.filter((artifact) => {
      const content = asRecord(artifact.content)
      return artifact.kind === 'quality_report' && content?.schemaVersion === 'agent-quality-report-v1'
    })
    const latestReportArtifact = reportArtifacts[0]
    const latestReport = latestReportArtifact
      ? (() => {
        const content = asRecord(latestReportArtifact.content) || {}
        const profile = asRecord(content.profile)
        const scope = asRecord(content.scope)
        const findings = asRecordList(content.findings)
        const semantic = asRecord(content.semanticReview)
        return {
          artifactId: latestReportArtifact.id,
          status: qualityAgentStatus(content.status),
          profile: asString(profile?.profile, '未标注'),
          scopeLabel: asString(scope?.label, '未标注范围'),
          score: asNumber(content.score),
          confidenceLowerBound: asNumber(content.confidenceLowerBound),
          coverageRate: asNumber(content.coverageRate),
          contextVersion: asNumber(content.contextVersion, latestReportArtifact.contextVersion),
          findingsCount: findings.length,
          blockingFindingCount: findings.filter((finding) => asBoolean(finding.blocking)).length,
          summary: asString(content.summary),
          ...(semantic ? {
            semanticReview: {
              coveredChapterCount: asNumber(semantic.coveredChapterCount),
              totalScopeChapterCount: asNumber(semantic.totalScopeChapterCount),
              semanticCoverageRate: asNumber(semantic.semanticCoverageRate),
              validEvidenceCount: asNumber(semantic.validEvidenceCount),
              rejectedEvidenceCount: asNumber(semantic.rejectedEvidenceCount),
              independentModelReview: asBoolean(semantic.independentModelReview),
            },
          } : {}),
        }
      })()
      : undefined

    const repairPlans = artifacts
      .filter((artifact) => artifact.kind === 'repair_plan')
      .map((artifact) => {
        const content = asRecord(artifact.content) || {}
        return {
          artifactId: artifact.id,
          status: content.status === 'ready' ? 'ready' as const : 'blocked' as const,
          sourceReportArtifactId: asString(content.sourceReportArtifactId),
          sourceContextVersion: asNumber(content.sourceContextVersion, artifact.contextVersion),
          summary: asString(content.summary),
          items: asRecordList(content.items).map((item) => ({
            id: asString(item.id),
            priority: asNumber(item.priority),
            severity: asString(item.severity, 'warning'),
            blocking: asBoolean(item.blocking),
            objective: asString(item.objective),
            targetChapterNums: asNumberList(item.targetChapterNums),
            dependencies: asStringList(item.dependencies),
            acceptanceCriteriaCount: asStringList(item.acceptanceCriteria).length,
            regressionGuardsCount: asStringList(item.regressionGuards).length,
            requiresHumanApproval: asBoolean(item.requiresHumanApproval),
          })),
        }
      })
      .slice(0, 8)

    const candidateDiffs = artifacts
      .filter((artifact) => artifact.kind === 'quality_repair_draft')
      .map((artifact) => {
        const content = asRecord(artifact.content) || {}
        return {
          artifactId: artifact.id,
          status: artifact.status,
          reviewArtifactId: artifact.reviewArtifactId,
          sourceReportArtifactId: asString(content.sourceReportArtifactId),
          sourceContextVersion: asNumber(content.sourceContextVersion, artifact.contextVersion),
          summary: asString(content.summary),
          readyForHumanReview: asBoolean(content.readyForHumanReview),
          chapters: asRecordList(content.chapters).map((chapter) => {
            const factGuard = asRecord(chapter.factGuard)
            const qualityGate = asRecord(chapter.qualityGate)
            return {
              chapterId: asNumber(chapter.chapterId),
              chapterNum: asNumber(chapter.chapterNum),
              title: asString(chapter.title),
              originalContentHash: asString(chapter.originalContentHash),
              optimizedContentHash: asString(chapter.optimizedContentHash),
              changed: asBoolean(chapter.changed),
              issueSummary: asStringList(chapter.issueSummary),
              warnings: asStringList(chapter.warnings),
              factGuardStatus: asBoolean(factGuard?.safeToApply) ? '通过' : '阻塞',
              qualityGateStatus: asBoolean(qualityGate?.safeToApply) ? '通过' : '阻塞',
              taskId: asNullableNumber(chapter.taskId),
            }
          }),
        }
      })
      .slice(0, 8)

    const independentReviews = artifacts
      .filter((artifact) => artifact.kind === 'quality_repair_review')
      .map((artifact) => {
        const content = asRecord(artifact.content) || {}
        return {
          artifactId: artifact.id,
          status: artifact.status,
          score: asNumber(content.score),
          readyForHumanDecision: asBoolean(content.readyForHumanDecision),
          independentModelReview: asBoolean(content.independentModelReview),
          summary: asString(content.summary),
          chapters: asRecordList(content.chapters).map((chapter) => {
            const checks = asRecordList(chapter.checks)
            return {
              chapterId: asNumber(chapter.chapterId),
              chapterNum: asNumber(chapter.chapterNum),
              title: asString(chapter.title),
              reviewTaskId: asNumber(chapter.reviewTaskId),
              separateReviewTask: asBoolean(chapter.separateReviewTask),
              status: asString(chapter.status, 'blocked'),
              score: asNumber(chapter.score),
              evidenceCoverageRate: asNumber(chapter.evidenceCoverageRate),
              checkCount: checks.length,
              evidencedCheckCount: checks.filter((check) => asStringList(check.evidence).length > 0).length,
              regressionRiskCount: asRecordList(chapter.regressionRisks).length,
            }
          }),
        }
      })
      .slice(0, 8)

    const comparisons = artifacts
      .filter((artifact) => artifact.kind === 'quality_comparison')
      .map((artifact) => {
        const content = asRecord(artifact.content) || {}
        return {
          artifactId: artifact.id,
          createdAt: artifact.createdAt,
          baselineReportArtifactId: asString(content.baselineReportArtifactId),
          candidateReportArtifactId: asString(content.candidateReportArtifactId),
          status: qualityAgentComparisonStatus(content.status),
          scoreDelta: asNumber(content.scoreDelta),
          coverageRateDelta: asNumber(content.coverageRateDelta),
          confidenceLowerBoundDelta: asNumber(content.confidenceLowerBoundDelta),
          introducedBlockerCount: asNumber(content.introducedBlockerCount),
          candidateStatus: qualityAgentStatus(content.candidateStatus),
          readyForHumanReview: asBoolean(content.readyForHumanReview),
          summary: asString(content.summary),
          warnings: asStringList(content.warnings),
        }
      })
      .slice(0, 8)

    return {
      artifactHistory,
      latestReport,
      repairPlans,
      candidateDiffs,
      independentReviews,
      comparisons,
      summary: {
        artifactCount: artifactHistory.length,
        reportCount: reportArtifacts.length,
        repairPlanCount: repairPlans.length,
        candidateDiffCount: candidateDiffs.length,
        independentReviewCount: independentReviews.length,
        comparisonCount: comparisons.length,
        ...(latestReport ? { latestContextVersion: latestReport.contextVersion } : {}),
      },
    }
  } catch (error) {
    console.warn('[quality-dashboard] failed to load agent quality artifacts', error)
    return buildEmptyQualityAgentDashboardSnapshot()
  }
}

function loadQualityDashboardCatalogContext(novelId: number, options: QualityDashboardOptions = {}) {
  const { novelMeta, rows, volumeRows } = loadQualityDashboardCatalogSnapshot(novelId)
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
  const storyArcProgressSnapshot = getStoryArcProgressSnapshot(novelId)
  const chapterArcProgressMap = storyArcProgressSnapshot.chapterPoints.reduce<Map<number, QualityDashboardData['chapterDetails'][number]['storyArcProgress']>>((result, point) => {
    const current = result.get(point.chapterId) || []
    current.push(point)
    result.set(point.chapterId, current)
    return result
  }, new Map())

  const volumeById = new Map(volumeRows.map((row) => [row.id, row] as const))
  const derivedDatabaseSnapshot = loadQualityDashboardDerivedDatabaseSnapshot(novelId)
  const batchSnapshot = loadQualityDashboardBatchSnapshot(novelId, rows)
  return {
    novelId,
    options,
    novelMeta,
    includeDialogueInsights,
    dialogueSnapshot,
    volumeRows,
    storyArcProgressSnapshot,
    chapterArcProgressMap,
    volumeById,
    rows,
    derivedDatabaseSnapshot,
    batchSnapshot,
    ...derivedDatabaseSnapshot,
  }
}

function deriveQualityDashboardPolicyInputContext(
  context: ReturnType<typeof loadQualityDashboardCatalogContext>,
) {
  const { novelId, novelMeta, rows, derivedDatabaseSnapshot } = context
  const currentOperatingMode = resolveOperatingMode({
    launchMode: novelMeta?.launchMode,
    targetWords: novelMeta?.targetWords,
    settingsJson: novelMeta?.settingsJson,
    chapterCount: rows.length,
  })
  const currentOperatingModePolicy = getOperatingModePolicy({
    launchMode: novelMeta?.launchMode,
    targetWords: novelMeta?.targetWords,
    settingsJson: novelMeta?.settingsJson,
    chapterCount: rows.length,
  })
  const currentRuntimePolicy = getOperatingModeRuntimePolicy({
    launchMode: novelMeta?.launchMode,
    targetWords: novelMeta?.targetWords,
    settingsJson: novelMeta?.settingsJson,
    chapterCount: rows.length,
  })
  const resolvedGenreKey = getBuiltinGenreRules(novelMeta?.genreName).genreProfile.key
  const historicalGenericFallback = isHistoricalGenreUsingGenericFallback(novelMeta?.genreName, resolvedGenreKey)
  const groundingAssessment = assessHistoricalGrounding({
    genreName: novelMeta?.genreName,
    worldRulesJson: novelMeta?.worldRulesJson,
    backgroundText: [novelMeta?.expandedBackground, novelMeta?.synopsis, novelMeta?.userBackground].filter(Boolean).join('\n'),
    glossaryTerms: derivedDatabaseSnapshot.glossaryTerms,
    historicalProfileJson: novelMeta?.historicalProfileJson,
    projectCanonProfileJson: novelMeta?.projectCanonProfileJson,
    canonConstraintSetJson: novelMeta?.canonConstraintSetJson,
    sourceLedgerJson: novelMeta?.sourceLedgerJson,
    canonSourceLedgerJson: novelMeta?.canonSourceLedgerJson,
    canonFactCardsJson: novelMeta?.canonFactCardsJson,
  })
  const structuredMemoryObservability = buildStoryMemoryPromptPackage(novelId, {
    chapterId: rows.at(-1)?.id,
    refreshMode: currentRuntimePolicy.backgroundPrecomputeEnabled ? 'schedule_only' : 'sync',
  }).observability
  const storyMemoryPrecomputeStatus = getStoryMemoryCheckpointRefreshStatus(novelId)
  const typedRefObservability = buildTypedRefObservability(context.typedRefRows)
  return {
    ...context,
    currentOperatingMode,
    currentOperatingModePolicy,
    currentRuntimePolicy,
    resolvedGenreKey,
    historicalGenericFallback,
    groundingAssessment,
    structuredMemoryObservability,
    storyMemoryPrecomputeStatus,
    typedRefObservability,
  }
}

function deriveQualityDashboardBatchInputContext(
  context: ReturnType<typeof deriveQualityDashboardPolicyInputContext>,
) {
  const { batchSnapshot, rows } = context
  const {
    batchChapterIdSet,
    batchChapterIds,
    batchChapterNums,
    checkpointRows,
    latestBatchInspections,
    latestBatchProgress,
    latestBatchSnapshot,
    latestBatchTask,
    latestWritebackRunMap,
    revisionRows: batchRevisionRows,
  } = batchSnapshot
  const latestWritebackRuns = [...latestWritebackRunMap.values()]
  const writebackPendingCount = latestWritebackRuns.filter((row) => classifyWritebackStatus(row.status) === 'pending').length
  const writebackFailedCount = latestWritebackRuns.filter((row) => classifyWritebackStatus(row.status) === 'failed').length
  const latestBatchPauseReason = typeof latestBatchProgress.pauseReason === 'string' && latestBatchProgress.pauseReason.trim()
    ? latestBatchProgress.pauseReason
    : (latestBatchTask?.errorMessage || undefined)
  const latestBatchGuardrailReason = typeof latestBatchProgress.activeGuardrailReason === 'string' && latestBatchProgress.activeGuardrailReason.trim()
    ? latestBatchProgress.activeGuardrailReason
    : undefined
  const latestBatchSnapshotId = latestBatchSnapshot?.id
  const latestBatchTaskId = latestBatchTask?.id
  const pendingRevisionCount = batchRevisionRows.filter((row) => (row.status || 'open') !== 'resolved' && (row.status || 'open') !== 'closed').length
  const rewriteTaskCount = batchRevisionRows.filter((row) => (row.taskType || '') === 'rewrite' || (row.severity || '') === 'critical').length
  const batchPendingWritebackCount = latestWritebackRuns.filter((row) =>
    batchChapterIdSet.size > 0
    && batchChapterIdSet.has(row.chapterId)
    && classifyWritebackStatus(row.status) === 'pending').length
  const staleCheckpointCount = checkpointRows.filter((row) => row.stale === 1).length
  const latestNovelCheckpoint = checkpointRows.find((row) => row.scopeType === 'novel' && (row.scopeId ?? null) === null) || null
  const latestChapterNum = rows.at(-1)?.chapterNum || 0
  const latestCheckpointChapterGap = latestChapterNum > 0
    ? Math.max(0, latestChapterNum - (latestNovelCheckpoint?.lastRefreshedChapterNum || 0))
    : 0
  return {
    ...context,
    latestWritebackRunMap,
    latestWritebackRuns,
    writebackPendingCount,
    writebackFailedCount,
    latestBatchTask,
    latestBatchProgress,
    latestBatchPauseReason,
    latestBatchGuardrailReason,
    latestBatchSnapshot,
    latestBatchSnapshotId,
    latestBatchTaskId,
    latestBatchInspections,
    batchChapterIds,
    batchChapterNums,
    batchChapterIdSet,
    batchRevisionRows,
    pendingRevisionCount,
    rewriteTaskCount,
    batchPendingWritebackCount,
    checkpointRows,
    staleCheckpointCount,
    latestNovelCheckpoint,
    latestChapterNum,
    latestCheckpointChapterGap,
  }
}

function loadQualityDashboardCoreContext(novelId: number, options: QualityDashboardOptions = {}) {
  const catalog = loadQualityDashboardCatalogContext(novelId, options)
  const policy = deriveQualityDashboardPolicyInputContext(catalog)
  return deriveQualityDashboardBatchInputContext(policy)
}

function deriveQualityDashboardContinuityContext(
  context: ReturnType<typeof loadQualityDashboardCoreContext>,
) {
  const { novelId, rows, volumeRows, derivedDatabaseSnapshot } = context
  const gateMetrics = deriveChapterGateMetrics(derivedDatabaseSnapshot.gateRuns)
  const {
    chapterGateHistoryByChapterId,
    latestChapterGateEntries,
    chapterGateTrend,
    chapterGateHeatmap,
    chapterGateDriftAlerts,
    chapterGateSummary,
  } = gateMetrics
  const volumeChapterRanges = buildVolumeChapterRanges(volumeRows, rows)
  const foreshadowSnapshot = getForeshadowSnapshot(novelId)
  const foreshadowCountsByVolume = buildForeshadowCountsByVolume(foreshadowSnapshot, volumeChapterRanges)
  const endgameDebtSnapshot = getEndgameDebtSnapshot(novelId)
  const endgameCountsByVolume = new Map(
    [...endgameDebtSnapshot.countsByVolume.entries()].map(([volumeId, counts]) => [volumeId, counts] as const),
  )

  const volumeIdByChapterNum = new Map(rows.flatMap((row) => (
    typeof row.volumeId === 'number'
      ? [[row.chapterNum, row.volumeId] as const]
      : []
  )))
  const { timelineRows } = derivedDatabaseSnapshot
  const storyDynamicsReadModel = buildStoryDynamicsReadModel(rows, timelineRows)
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

  return {
    ...context,
    chapterGateHistoryByChapterId,
    latestChapterGateEntries,
    chapterGateTrend,
    chapterGateHeatmap,
    chapterGateDriftAlerts,
    chapterGateSummary,
    volumeChapterRanges,
    foreshadowSnapshot,
    foreshadowCountsByVolume,
    endgameDebtSnapshot,
    endgameCountsByVolume,
    volumeIdByChapterNum,
    storyDynamicsReadModel,
    worldStateLedger,
    recallFreshnessState,
    recallRuntimeByChapterId,
    recallSnapshotByChapterId,
    recallSnapshotSourceByChapterId,
    recallDiagnosticsByChapterId,
    recentWorldStateAlerts,
    antiAiSummary,
    antiAiSignalByChapterId,
    feedbackSummary,
    feedbackSignalByChapterId,
    worldStateAlertMap,
  }
}

function deriveQualityDashboardChapterNarrativeContext(
  context: ReturnType<typeof deriveQualityDashboardContinuityContext>,
) {
  const { rows, storyDynamicsReadModel, volumeById } = context

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
  const storyDynamicsDetailsByChapterId = new Map<number, StoryDynamicsChapterRecord['dynamics']>()

  for (const row of rows) {
    const storyDynamics = storyDynamicsReadModel.dynamicsByChapterId.get(row.id)
    const trackedStoryChapter = storyDynamicsReadModel.chapterById.get(row.id)
    if (!storyDynamics) continue
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

    if (trackedStoryChapter) {
      storyDynamicsDetailsByChapterId.set(row.id, storyDynamics)
      trackedStoryChapters.push(trackedStoryChapter)
      if (typeof row.volumeId === 'number') {
        const volumeMeta = volumeById.get(row.volumeId)
        const volumeNumber = volumeMeta?.volumeNumber ?? row.volumeId
        const volumeName = formatVolumeName(row.volumeId, volumeMeta?.volumeNumber, volumeMeta?.title)
        const accumulator = volumeStoryAccumulators.get(row.volumeId) || createVolumeStoryAccumulator(row.volumeId, volumeNumber, volumeName)
        accumulator.chapters.push(trackedStoryChapter)
        volumeStoryAccumulators.set(row.volumeId, accumulator)
      }
    }

  }
  return {
    ...context,
    heatmapData,
    overallScoreTrend,
    aiLikeRateTrend,
    languageDriftTrends,
    weakDimFreq,
    chapterDetails,
    languageMetricsList,
    volumeAccumulators,
    trackedStoryChapters,
    volumeStoryAccumulators,
    chapterFunctionChapters,
    volumeChapterFunctionAccumulators,
    chapterFunctionDetailsByChapterId,
    storyDynamicsDetailsByChapterId,
  }
}

function deriveQualityDashboardChapterContext(
  context: ReturnType<typeof deriveQualityDashboardChapterNarrativeContext>,
) {
  const { rows, volumeById, chapterGateHistoryByChapterId } = context
  const { antiAiSignalByChapterId, feedbackSignalByChapterId, chapterArcProgressMap } = context
  const { worldStateAlertMap, recallSnapshotByChapterId, recallSnapshotSourceByChapterId } = context
  const { recallDiagnosticsByChapterId, chapterFunctionDetailsByChapterId } = context
  const { heatmapData, overallScoreTrend, aiLikeRateTrend, languageDriftTrends } = context
  const { weakDimFreq, chapterDetails, languageMetricsList, volumeAccumulators } = context
  const { storyDynamicsDetailsByChapterId } = context
  let totalOverall = 0
  let totalAiLike = 0
  let scoredCount = 0

  for (const row of rows) {
    const storyDynamics = storyDynamicsDetailsByChapterId.get(row.id)
    const hasStoryDynamics = Boolean(storyDynamics)

    const scoreMetrics = deriveChapterScoreMetrics(row.aiScoreJson)
    const dialogueReview = parseDialogueReview(row.reviewNotesJson) || undefined
    const styleCompliance = parseStyleCompliance(row.reviewNotesJson) || undefined
    const { overallScore, aiLikeRate, weakDimensions, dimensions, languageDriftMetrics } = scoreMetrics

    if (scoreMetrics.scored) {
      scoredCount += 1
      totalOverall += overallScore
      totalAiLike += aiLikeRate
      overallScoreTrend.push({ chapterNum: row.chapterNum, score: overallScore })
      aiLikeRateTrend.push({ chapterNum: row.chapterNum, rate: aiLikeRate })

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

      dimensions.forEach((dim) => heatmapData.push({ chapterNum: row.chapterNum, dimension: dim.name, score: dim.score }))
      weakDimensions.forEach((dimension) => weakDimFreq.set(dimension, (weakDimFreq.get(dimension) || 0) + 1))
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
  return {
    ...context,
    totalOverall,
    totalAiLike,
    scoredCount,
  }
}

function deriveQualityDashboardEditorialContext(
  context: ReturnType<typeof deriveQualityDashboardChapterContext>,
) {
  const { rows, chapterDetails, weakDimFreq, languageMetricsList, languageDriftTrends } = context
  const { volumeAccumulators, trackedStoryChapters, volumeStoryAccumulators } = context
  const { chapterFunctionChapters, volumeChapterFunctionAccumulators } = context
  const reviewFindingEntries = rows.map((row) => ({
    chapterNum: row.chapterNum,
    findings: parseReviewFindingArrays(row.reviewNotesJson),
  }))
  const historicalViolationCount = reviewFindingEntries.filter((entry) => entry.findings.sourceGroundingRisks.length > 0).length
  const modePolicyViolationCount = reviewFindingEntries.filter((entry) => entry.findings.operatingModeRisks.length > 0).length

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
  const contractBlockerCount = contractValidationStatuses.filter(hasDashboardContractHardBlocker).length
  const contractWarningCount = contractValidationStatuses.filter((item) => getDashboardContractHardStatus(item) === 'warning').length
  const contractReadyRate = contractValidationStatuses.length > 0
    ? Math.round((contractValidationStatuses.filter((item) => getDashboardContractHardStatus(item) === 'pass').length / contractValidationStatuses.length) * 100)
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
  const chapterFunctionDiagnostics = buildChapterFunctionDiagnostics(chapterFunctionChapters, rows.length)
  const chapterFunctionSummary = chapterFunctionDiagnostics.summary
  const repeatedFunctionRuns = chapterFunctionDiagnostics.repeatedRuns
  const repeatedFunctionRunMap = repeatedFunctionRuns.reduce<Map<number, ChapterFunctionRun>>((result, run) => {
    run.chapterNums.forEach((chapterNum) => result.set(chapterNum, run))
    return result
  }, new Map())
  const weakKeyFunctionAlerts = chapterFunctionDiagnostics.weakKeyAlerts
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
    const diagnostics = buildChapterFunctionDiagnostics(volume.chapters, volume.chapters.length)
    const summary = diagnostics.summary
    const repeatedRuns = diagnostics.repeatedRuns
    const alerts = [
      ...buildRepeatedFunctionAlerts(repeatedRuns),
      ...diagnostics.weakKeyAlerts,
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
    ...buildBookFunctionSkewAlert(chapterFunctionSummary, rows.map((row) => row.chapterNum)),
    ...volumeChapterFunctions.flatMap((entry) => entry.alerts.filter((alert) => alert.code === 'volume_function_skew')),
  ].sort(sortChapterFunctionAlerts)
  return {
    ...context,
    reviewFindingEntries,
    historicalViolationCount,
    modePolicyViolationCount,
    weakDimensionFrequency,
    styleComplianceEntries,
    styleComplianceAlerts,
    styleComplianceSummary,
    contractValidationStatuses,
    contractBlockerCount,
    contractWarningCount,
    contractReadyRate,
    contractProgressMetrics,
    contractStatusEntries,
    averageLanguageDriftMetrics,
    languageDriftTrendSummaries,
    recentLanguageDriftAlerts,
    volumeLanguageDrift,
    novelLanguageDriftSummary,
    storyChapters,
    protagonistSetbackSummary,
    costPersistenceState,
    reversalDistributionSummary,
    storyPacingAlerts,
    storyDynamicsTrend,
    volumeStoryDynamics,
    chapterFunctionDiagnostics,
    chapterFunctionSummary,
    repeatedFunctionRuns,
    weakKeyFunctionAlerts,
    volumeChapterFunctions,
    chapterFunctionAlerts,
  }
}

function deriveQualityDashboardContinuityMetricsContext(
  context: ReturnType<typeof deriveQualityDashboardEditorialContext>,
) {
  const { novelId, rows, chapterArcProgressMap, storyArcProgressSnapshot } = context
  const { worldStateLedger, volumeRows, recallDiagnosticsByChapterId } = context
  const { recallFreshnessState, recallSnapshotByChapterId, recallSnapshotSourceByChapterId } = context
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
    validatedHitCount: sumRecallDiagnosticMetric(analyzedRecallEntries, 'validatedHitCount'),
    lowSimilarityRejectedCount: sumRecallDiagnosticMetric(analyzedRecallEntries, 'lowSimilarityRejectedCount'),
    entityValidationRejectedCount: sumRecallDiagnosticMetric(analyzedRecallEntries, 'entityValidationRejectedCount'),
    chapterSourceHitCount: analyzedRecallEntries.reduce((sum, entry) =>
      sum + (entry.diagnostics.chapterSourceHitCount || 0), 0),
    semanticAssetHitCount: analyzedRecallEntries.reduce((sum, entry) =>
      sum + (entry.diagnostics.semanticAssetHitCount || 0), 0),
    selectedChapterSourceCount: analyzedRecallEntries.reduce((sum, entry) =>
      sum + (entry.diagnostics.selectedChapterSourceCount || 0), 0),
    selectedSemanticAssetCount: analyzedRecallEntries.reduce((sum, entry) =>
      sum + (entry.diagnostics.selectedSemanticAssetCount || 0), 0),
    minVectorSimilarity: resolveRecallDiagnosticThreshold(analyzedRecallEntries, 'minVectorSimilarity'),
    minKeywordSimilarity: resolveRecallDiagnosticThreshold(analyzedRecallEntries, 'minKeywordSimilarity'),
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
        validatedHitCount: sumRecallDiagnosticMetric(entries, 'validatedHitCount'),
        lowSimilarityRejectedCount: sumRecallDiagnosticMetric(entries, 'lowSimilarityRejectedCount'),
        entityValidationRejectedCount: sumRecallDiagnosticMetric(entries, 'entityValidationRejectedCount'),
        chapterSourceHitCount: entries.reduce((sum, entry) =>
          sum + (entry.diagnostics.chapterSourceHitCount || 0), 0),
        semanticAssetHitCount: entries.reduce((sum, entry) =>
          sum + (entry.diagnostics.semanticAssetHitCount || 0), 0),
        selectedChapterSourceCount: entries.reduce((sum, entry) =>
          sum + (entry.diagnostics.selectedChapterSourceCount || 0), 0),
        selectedSemanticAssetCount: entries.reduce((sum, entry) =>
          sum + (entry.diagnostics.selectedSemanticAssetCount || 0), 0),
        minVectorSimilarity: resolveRecallDiagnosticThreshold(entries, 'minVectorSimilarity'),
        minKeywordSimilarity: resolveRecallDiagnosticThreshold(entries, 'minKeywordSimilarity'),
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
  return {
    ...context,
    storyArcProgressTrend,
    storyArcProgressSummary,
    volumeWorldStateStability,
    worldStateSummary,
    recallEntries,
    recallSummary,
    recentRecallAlerts,
    volumeRecallDiagnostics,
  }
}

function deriveQualityDashboardVolumeSignalContext(
  context: ReturnType<typeof deriveQualityDashboardContinuityMetricsContext>,
) {
  const { rows, volumeRows, feedbackSummary, antiAiSummary } = context
  const { volumeLanguageDrift, volumeStoryDynamics, volumeChapterFunctions } = context
  const { storyArcProgressSnapshot, volumeRecallDiagnostics, volumeWorldStateStability } = context
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
  return {
    ...context,
    volumeLanguageDriftById,
    volumeStoryDynamicsById,
    volumeChapterFunctionById,
    volumeArcProgressById,
    volumeRecallById,
    volumeWorldStateById,
    feedbackVolumeEntries,
    feedbackVolumeById,
    antiAiVolumeEntries,
  }
}

function deriveQualityDashboardVolumeMetricsContext(
  context: ReturnType<typeof deriveQualityDashboardVolumeSignalContext>,
) {
  const { volumeChapterRanges, chapterDetails, foreshadowCountsByVolume, endgameCountsByVolume } = context
  const { storyArcProgressSnapshot, feedbackVolumeById } = context
  const { volumeLanguageDriftById, volumeStoryDynamicsById, volumeChapterFunctionById } = context
  const { volumeArcProgressById, volumeRecallById, volumeWorldStateById } = context
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
    const topRisks = buildVolumeTopRisks({
      volumeRange,
      languageEntry,
      storyEntry,
      functionEntry,
      arcAlerts,
      foreshadowCounts,
      endgameCounts,
      recallEntry,
      worldEntry,
      feedbackEntry: feedbackVolumeById.get(volumeRange.volumeId),
      styleComplianceAlerts: volumeStyleComplianceAlerts,
      createRisk: createDashboardRiskItem,
    })
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
  return { ...context, volumeQualityMetrics }
}

function deriveQualityDashboardRepairFoundationContext(
  context: ReturnType<typeof deriveQualityDashboardVolumeMetricsContext>,
) {
  const { chapterDetails, volumeRows, latestChapterGateEntries, derivedDatabaseSnapshot } = context
  const chapterDetailById = new Map(chapterDetails.map((entry) => [entry.chapterId, entry] as const))
  const chapterDetailByNum = new Map(chapterDetails.map((entry) => [entry.chapterNum, entry] as const))
  const volumeNumberById = new Map(volumeRows.map((row) => [row.id, row.volumeNumber || row.id] as const))
  const { storyFactRows } = derivedDatabaseSnapshot
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

  const publishBlockedByProvenance = latestChapterGateEntries.filter((entry) =>
    entry.topIssueKeys.some((key) =>
      key === 'typed_ref_coverage'
      || key === 'source_grounding'
      || key === 'operating_mode_policy'))
    .length

  return {
    ...context,
    chapterDetailById,
    chapterDetailByNum,
    volumeNumberById,
    storyFactRows,
    repairRiskItems,
    addRepairRisk,
    createChapterNavigationQuery,
    publishBlockedByProvenance,
  }
}

function deriveQualityDashboardPolicyRepairContext(
  context: ReturnType<typeof deriveQualityDashboardRepairFoundationContext>,
) {
  const { typedRefObservability, historicalViolationCount, historicalGenericFallback } = context
  const { groundingAssessment, reviewFindingEntries, publishBlockedByProvenance, addRepairRisk } = context

  if (typedRefObservability.unresolvedRefCount > 0 || typedRefObservability.overallCoverageRate < 90) {
    addRepairRisk(createDashboardRiskItem(
      'typed_ref_coverage',
      typedRefObservability.unresolvedRefCount >= 8 || typedRefObservability.overallCoverageRate < 60 ? 'critical' : 'warning',
      'Typed Ref 覆盖存在缺口',
      `typed ref 覆盖率 ${typedRefObservability.overallCoverageRate}%，未解析引用 ${typedRefObservability.unresolvedRefCount} 条。`,
      reviewFindingEntries.filter((entry) => entry.findings.typedRefRisks.length > 0).slice(0, 4).map((entry) => entry.chapterNum),
      undefined,
      {
        metricKey: 'typed_ref_coverage',
        whyItHappened: '线程、时间线和物品的 typed ref 绑定没有跟上资产演化，导致连续性判断依赖了不完整引用。',
        howToFix: '优先补齐 unresolved typed ref 和低覆盖资产，再继续依赖这些资产做章节审校和上下文回收。',
        suggestedActions: [],
      },
    ))
  }

  if (historicalViolationCount > 0 || historicalGenericFallback || groundingAssessment.conservativeFallbackActive) {
    addRepairRisk(createDashboardRiskItem(
      'source_grounding',
      groundingAssessment.mode === 'historical_realist' || groundingAssessment.conservativeFallbackActive ? 'critical' : 'warning',
      '历史 grounding 未闭环',
      `来源覆盖 ${groundingAssessment.coverage}，历史违规章节 ${historicalViolationCount}，publish provenance 阻断 ${publishBlockedByProvenance}。`,
      reviewFindingEntries.filter((entry) => entry.findings.sourceGroundingRisks.length > 0).slice(0, 4).map((entry) => entry.chapterNum),
      undefined,
      {
        metricKey: 'source_grounding',
        whyItHappened: '历史题材仍有来源不足或 conservative fallback 场景，但这些缺口已经进入正文审校与发布门。',
        howToFix: '先补来源依据或改写为保守表述，再继续历史细节写作与发布。',
        suggestedActions: [],
      },
    ))
  }

  return context
}

function deriveQualityDashboardMemoryRepairContext(
  context: ReturnType<typeof deriveQualityDashboardPolicyRepairContext>,
) {
  const { modePolicyViolationCount, recentLanguageDriftAlerts, groundingAssessment } = context
  const { currentRuntimePolicy, publishBlockedByProvenance, reviewFindingEntries } = context
  const { feedbackSummary, volumeIdByChapterNum, addRepairRisk } = context
  if (modePolicyViolationCount > 0) {
    addRepairRisk(createDashboardRiskItem(
      'operating_mode_policy',
      modePolicyViolationCount > 0 && currentRuntimePolicy.operatingMode === 'million_longform' ? 'critical' : 'warning',
      'OperatingMode 策略出现违规',
      `mode 违规章节 ${modePolicyViolationCount}，publish provenance 阻断 ${publishBlockedByProvenance}。`,
      reviewFindingEntries.filter((entry) => entry.findings.operatingModeRisks.length > 0).slice(0, 4).map((entry) => entry.chapterNum),
      undefined,
      {
        metricKey: 'operating_mode_policy',
        whyItHappened: '项目复杂度、checkpoint 新鲜度或阶段结构已经偏离当前 operatingMode 允许的运行策略。',
        howToFix: '先清掉 checkpoint lag 或结构复杂度违规，再决定是继续当前模式还是切换 operatingMode。',
        suggestedActions: [],
      },
    ))
  }

  if (
    recentLanguageDriftAlerts.some((alert) => alert.metric === 'abstractTokenDensity' || alert.metric === 'ornamentOverloadRate' || alert.metric === 'endingSummaryRate')
    || groundingAssessment.conservativeFallbackActive
  ) {
    const topRegisterAlert = recentLanguageDriftAlerts.find((alert) =>
      alert.metric === 'abstractTokenDensity' || alert.metric === 'ornamentOverloadRate' || alert.metric === 'endingSummaryRate')
    addRepairRisk(createDashboardRiskItem(
      'genre_register_drift',
      groundingAssessment.conservativeFallbackActive || (topRegisterAlert?.latestValue || 0) >= 60 ? 'critical' : 'warning',
      '题材语域开始漂移',
      topRegisterAlert
        ? `${topRegisterAlert.label} 最近变化 ${topRegisterAlert.delta > 0 ? `+${topRegisterAlert.delta}` : topRegisterAlert.delta}，当前值 ${topRegisterAlert.latestValue}。`
        : '题材语感正在被抽象升华、说明腔或辞藻堆积稀释。',
      [],
      undefined,
      {
        metricKey: 'genre_register_drift',
        whyItHappened: '长窗口内抽象词、段尾升华和华饰化表达累积过高，题材语感没有持续落在人物行动和世界规则上。',
        howToFix: '收回抽象升华和说明句，把题材语域重新压回动作、身份、制度、生态和冲突现场。',
        suggestedActions: [],
      },
    ))
  }

  if (
    feedbackSummary.humanizationSummary.highRiskIssueCount > 0
    || feedbackSummary.humanizationSummary.topRepeatedIssues.some((item) => item.title.includes('说明') || item.title.includes('解释') || item.title.includes('过渡'))
  ) {
    const expositionIssue = feedbackSummary.humanizationSummary.topRepeatedIssues.find((item) =>
      item.title.includes('说明') || item.title.includes('解释') || item.title.includes('过渡'))
    addRepairRisk(createDashboardRiskItem(
      'exposition_density',
      feedbackSummary.humanizationSummary.highRiskIssueCount > 0 ? 'critical' : 'warning',
      '解释密度与说明文偏高',
      expositionIssue
        ? `${expositionIssue.title}，近窗命中 ${expositionIssue.hitCount} 次。`
        : `人类化高风险问题 ${feedbackSummary.humanizationSummary.highRiskIssueCount} 类，解释腔与说明文正在累积。`,
      expositionIssue?.chapterNums || [],
      volumeIdByChapterNum.get((expositionIssue?.chapterNums || [])[0] || 0),
      {
        metricKey: 'exposition_density',
        whyItHappened: '章节越来越依赖解释腔、过渡句和世界观说明文来代替场景推进。',
        howToFix: '优先删减说明段，把设定与转场信息改成事件、动作和结果状态。',
        suggestedActions: [],
      },
    ))
  }

  return context
}

function deriveQualityDashboardDialogueRepairContext(
  context: ReturnType<typeof deriveQualityDashboardMemoryRepairContext>,
) {
  const { antiAiSummary, dialogueSnapshot, volumeIdByChapterNum, addRepairRisk } = context
  if (antiAiSummary.overview.highRiskRuleCount > 0 || antiAiSummary.topRepeatedRules.some((item) => item.hitCount >= 3)) {
    const repeatedRule = antiAiSummary.topRepeatedRules.find((item) => item.hitCount >= 3) || antiAiSummary.topRepeatedRules[0]
    addRepairRisk(createDashboardRiskItem(
      'long_window_homogenization',
      antiAiSummary.overview.highRiskRuleCount > 0 ? 'critical' : 'warning',
      repeatedRule ? `${repeatedRule.ruleTitle} 正在累积复现` : '模板化重复正在累积',
      repeatedRule
        ? `${repeatedRule.ruleTitle} 近窗命中 ${repeatedRule.hitCount} 次，已形成长窗口模板化压力。`
        : `反 AI 高风险复现规则 ${antiAiSummary.overview.highRiskRuleCount} 类。`,
      repeatedRule?.chapterNums || [],
      volumeIdByChapterNum.get((repeatedRule?.chapterNums || [])[0] || 0),
      {
        metricKey: 'long_window_homogenization',
        whyItHappened: '模板连接、模板情绪和高频重复句式在多章窗口里反复出现，开始挤压文本差异度。',
        howToFix: '优先替换最近命中最多的模板和重复句式，再回查对应章节的结构与语气差异。',
        suggestedActions: [],
      },
    ))
  }

  if (dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount > 0 || dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount > 0 || dialogueSnapshot.requiredDialogueVoiceLocks.length > 0) {
    addRepairRisk(createDashboardRiskItem(
      'dialogue_separability',
      dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount >= 2 || dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount >= 2 ? 'critical' : 'warning',
      '角色对白可分离度下降',
      `高相似角色对 ${dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount}，漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount}，待补 voice lock ${dialogueSnapshot.requiredDialogueVoiceLocks.length}。`,
      [],
      undefined,
      {
        metricKey: 'dialogue_separability',
        whyItHappened: '角色对白在长窗口里开始同腔化，voice profile 漂移和相似对白对越来越多。',
        howToFix: '优先处理高相似角色对和漂移角色，补 voice lock 并重写关键对白。',
        suggestedActions: [],
      },
    ))
  }

  return context
}

function deriveQualityDashboardContractRepairContext(
  context: ReturnType<typeof deriveQualityDashboardDialogueRepairContext>,
) {
  const { contractStatusEntries, contractBlockerCount, contractReadyRate, endgameDebtSnapshot } = context
  const { volumeIdByChapterNum } = context
  const { contractProgressMetrics, addRepairRisk, createChapterNavigationQuery } = context
  const contractBlockerChapters = contractStatusEntries.filter((entry) => hasDashboardContractHardBlocker(entry.validation))
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

  return context
}

function deriveQualityDashboardStoryRepairContext(
  context: ReturnType<typeof deriveQualityDashboardContractRepairContext>,
) {
  const { chapterDetails, dialogueSnapshot, addRepairRisk, createChapterNavigationQuery } = context

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

  return context
}

function deriveQualityDashboardGrowthRepairContext(
  context: ReturnType<typeof deriveQualityDashboardStoryRepairContext>,
) {
  const { storyPacingAlerts, protagonistSetbackSummary, costPersistenceState } = context
  const { chapterDetailByNum, addRepairRisk, createChapterNavigationQuery } = context
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

  return context
}

function buildChapterRepairTarget(
  chapter: QualityDashboardData['chapterDetails'][number] | undefined,
  createNavigationQuery: (chapterId?: number, chapterNum?: number) => Record<string, string> | undefined,
) {
  const chapterId = chapter?.chapterId
  const chapterNum = chapter?.chapterNum
  return {
    chapterId,
    chapterNum,
    volumeId: chapter?.volumeId,
    issueSuffix: chapterNum || 'global',
    navigationQuery: createNavigationQuery(chapterId, chapterNum),
  }
}

function deriveQualityDashboardForeshadowRepairContext(
  context: ReturnType<typeof deriveQualityDashboardGrowthRepairContext>,
) {
  const { foreshadowSnapshot, contractProgressMetrics, chapterDetailByNum } = context
  const { addRepairRisk, createChapterNavigationQuery } = context
  const overdueForeshadowChapterNums = dedupeChapterNums(foreshadowSnapshot.overdue.slice(0, 4).flatMap((card) => {
    const values = [card.targetPayoffChapter, card.plantedChapter, card.startChapter]
    return values.filter((chapterNum): chapterNum is number => typeof chapterNum === 'number')
  }))
  const firstForeshadowChapter = chapterDetailByNum.get(overdueForeshadowChapterNums[0] || 0)
  const repairTarget = buildChapterRepairTarget(firstForeshadowChapter, createChapterNavigationQuery)
  const repairSeverity = foreshadowSnapshot.overdue.length > 0 ? 'critical' : 'warning'
  if (foreshadowSnapshot.overdue.length > 0 || contractProgressMetrics.foreshadowBlockedCount > 0 || contractProgressMetrics.foreshadowStaleCount > 0) {
    addRepairRisk(createDashboardRiskItem(
      'foreshadow_debt',
      repairSeverity,
      foreshadowSnapshot.overdue.length > 0 ? '伏笔已进入超期区' : '伏笔债务开始堆积',
      `待回收 ${foreshadowSnapshot.pending.length}，即将到期 ${foreshadowSnapshot.dueSoon.length}，已超期 ${foreshadowSnapshot.overdue.length}，合同阻塞 ${contractProgressMetrics.foreshadowBlockedCount}，失管 ${contractProgressMetrics.foreshadowStaleCount}。`,
      overdueForeshadowChapterNums,
      repairTarget.volumeId,
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
            severity: repairSeverity,
            safeToExecute: true,
            issueKey: `foreshadow-debt-${repairTarget.issueSuffix}`,
            taskType: 'continuity',
            taskTitle: '清理伏笔债务',
            taskDescription: '处理超期伏笔、合同阻塞和延期说明缺失。',
            fixBrief: '优先回收超期伏笔，再处理 due soon 和阻塞项。',
            chapterId: repairTarget.chapterId,
            chapterNum: repairTarget.chapterNum,
            navigationQuery: repairTarget.navigationQuery,
          }),
          createRepairAction({
            metricKey: 'foreshadow_debt',
            actionType: 'open_bridge_patch',
            label: firstForeshadowChapter ? `补写第${firstForeshadowChapter.chapterNum}章桥段` : '补写伏笔过桥',
            description: '为超期伏笔补过桥段或兑现动作。',
            targetPage: 'writing',
            severity: 'warning',
            issueKey: `foreshadow-bridge-${repairTarget.issueSuffix}`,
            taskType: 'bridge_patch',
            taskTitle: firstForeshadowChapter ? `补写第${firstForeshadowChapter.chapterNum}章伏笔过桥` : '补写伏笔过桥',
            taskDescription: '补一段能承接伏笔回收或显式延期的桥接场景。',
            fixBrief: '不要只口头提及，必须让读者能感知推进。',
            chapterId: repairTarget.chapterId,
            chapterNum: repairTarget.chapterNum,
            navigationQuery: repairTarget.navigationQuery,
          }),
          createRepairAction({
            metricKey: 'foreshadow_debt',
            actionType: 'allow_deviation',
            label: '标记允许偏移',
            description: '如果伏笔延后是作者有意决策，显式记录为允许偏移。',
            targetPage: 'revision',
            severity: 'info',
            issueKey: `foreshadow-deviation-${repairTarget.issueSuffix}`,
            taskType: 'continuity',
            taskTitle: '确认伏笔延期为允许偏移',
            taskDescription: '记录该伏笔延期的作者意图与新的回收节点。',
            fixBrief: '只有明确记录过的新节点，系统才不再继续提示为失管。',
            chapterId: repairTarget.chapterId,
            chapterNum: repairTarget.chapterNum,
            navigationQuery: repairTarget.navigationQuery,
          }),
        ],
      },
    ))
  }

  return context
}

function deriveQualityDashboardContinuityRepairContext(
  context: ReturnType<typeof deriveQualityDashboardForeshadowRepairContext>,
) {
  const { recentWorldStateAlerts, writebackPendingCount, writebackFailedCount } = context
  const { volumeIdByChapterNum, addRepairRisk, createChapterNavigationQuery } = context
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

  return context
}

function deriveQualityDashboardRevealRepairContext(
  context: ReturnType<typeof deriveQualityDashboardContinuityRepairContext>,
) {
  const { storyFactRows, chapterDetailById, volumeNumberById, latestChapterNum } = context
  const { addRepairRisk, createChapterNavigationQuery } = context
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
  const revealSeverity = revealFactSignals.forbidden.length > 0 || revealFactSignals.early.length > 0
    ? 'critical'
    : 'warning'
  if (firstRevealRisk) {
    addRepairRisk(createDashboardRiskItem(
      'info_reveal_pacing',
      revealSeverity,
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
            label: `补写第${firstRevealRisk.chapterNum}章桥段`,
            description: '补一段承接信息揭示节奏的桥接场景。',
            targetPage: 'writing',
            severity: revealSeverity,
            issueKey: `info-reveal-bridge-${firstRevealRisk.factId}`,
            taskType: 'bridge_patch',
            taskTitle: `修补第${firstRevealRisk.chapterNum}章信息揭示节奏`,
            taskDescription: `围绕「${firstRevealRisk.title || '关键信息'}」补桥，调整读者和主角的知情节奏。`,
            fixBrief: '让揭示回到目标章节附近，并保留必要信息差。',
            chapterId: firstRevealRisk.chapterId,
            chapterNum: firstRevealRisk.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstRevealRisk.chapterId, firstRevealRisk.chapterNum),
          }),
          createRepairAction({
            metricKey: 'info_reveal_pacing',
            actionType: 'create_revision_task',
            label: '生成揭示节奏修订',
            description: '把揭示过早/过晚问题落入修订中心。',
            targetPage: 'revision',
            severity: revealSeverity,
            safeToExecute: true,
            issueKey: `info-reveal-task-${firstRevealRisk.factId}`,
            taskType: 'continuity',
            taskTitle: '修复信息揭示节奏',
            taskDescription: '调整信息差谜题板中的揭示时机，避免过早暴露或过度拖延。',
            fixBrief: '必要时同时更新目标揭示章节和读者可知范围。',
            chapterId: firstRevealRisk.chapterId,
            chapterNum: firstRevealRisk.chapterNum,
            navigationQuery: createChapterNavigationQuery(firstRevealRisk.chapterId, firstRevealRisk.chapterNum),
          }),
        ],
      },
    ))
  }

  return { ...context, revealFactSignals }
}

function deriveQualityDashboardRepairMetricsContext(
  context: ReturnType<typeof deriveQualityDashboardRevealRepairContext>,
) {
  const { repairRiskItems, contractBlockerCount, contractWarningCount, contractReadyRate } = context
  const { endgameDebtSnapshot, contractProgressMetrics, typedRefObservability } = context
  const { historicalViolationCount, historicalGenericFallback, groundingAssessment } = context
  const { modePolicyViolationCount, publishBlockedByProvenance, recentLanguageDriftAlerts } = context
  const { feedbackSummary, antiAiSummary, dialogueSnapshot, styleComplianceSummary } = context
  const { chapterFunctionAlerts, storyArcProgressSummary, protagonistSetbackSummary } = context
  const { costPersistenceState, foreshadowSnapshot, recentWorldStateAlerts } = context
  const { writebackPendingCount, writebackFailedCount, recentRecallAlerts, recallSummary } = context
  const { revealFactSignals, volumeQualityMetrics } = context

  const buildRepairMetricSummary = (metricKey: QualityRepairMetricKey, score: number, summary: string): QualityDashboardData['repairMetrics'][number] => {
    return createRepairMetricSummary({
      metricKey,
      label: qualityRepairMetricLabel(metricKey),
      score,
      summary,
      repairRiskItems,
    })
  }
  const repairMetrics: QualityDashboardData['repairMetrics'] = [
    buildRepairMetricSummary(
      'commitment_delivery',
      100 - contractBlockerCount * 18 - contractWarningCount * 6 - endgameDebtSnapshot.overview.overdueCount * 10 - endgameDebtSnapshot.overview.unboundCount * 8 - Math.min(contractProgressMetrics.storyThreadMentionOnlyCount, 6) * 3,
      `合同通过率 ${contractReadyRate}%，终局过期 ${endgameDebtSnapshot.overview.overdueCount}，线程只提及未推进 ${contractProgressMetrics.storyThreadMentionOnlyCount}。`,
    ),
    buildRepairMetricSummary(
      'typed_ref_coverage',
      100 - Math.min(typedRefObservability.unresolvedRefCount, 12) * 6 - Math.max(0, 90 - typedRefObservability.overallCoverageRate),
      `typed ref 覆盖率 ${typedRefObservability.overallCoverageRate}%，未解析引用 ${typedRefObservability.unresolvedRefCount}。`,
    ),
    buildRepairMetricSummary(
      'source_grounding',
      100 - historicalViolationCount * 15 - (historicalGenericFallback ? 18 : 0) - (groundingAssessment.conservativeFallbackActive ? 12 : 0),
      `来源覆盖 ${groundingAssessment.coverage}，历史违规章节 ${historicalViolationCount}。`,
    ),
    buildRepairMetricSummary(
      'operating_mode_policy',
      100 - modePolicyViolationCount * 14 - publishBlockedByProvenance * 6,
      `mode 违规章节 ${modePolicyViolationCount}，publish provenance 阻断 ${publishBlockedByProvenance}。`,
    ),
    buildRepairMetricSummary(
      'genre_register_drift',
      100 - recentLanguageDriftAlerts.filter((alert) => alert.metric === 'abstractTokenDensity' || alert.metric === 'ornamentOverloadRate' || alert.metric === 'endingSummaryRate').length * 10 - (groundingAssessment.conservativeFallbackActive ? 12 : 0),
      `语域漂移预警 ${recentLanguageDriftAlerts.filter((alert) => alert.metric === 'abstractTokenDensity' || alert.metric === 'ornamentOverloadRate' || alert.metric === 'endingSummaryRate').length} 条。`,
    ),
    buildRepairMetricSummary(
      'exposition_density',
      100 - feedbackSummary.humanizationSummary.highRiskIssueCount * 10 - feedbackSummary.humanizationSummary.pauseSuggestedIssueCount * 6,
      `人类化高风险 ${feedbackSummary.humanizationSummary.highRiskIssueCount}，建议暂停 ${feedbackSummary.humanizationSummary.pauseSuggestedIssueCount}。`,
    ),
    buildRepairMetricSummary(
      'long_window_homogenization',
      100 - antiAiSummary.overview.highRiskRuleCount * 12 - antiAiSummary.overview.recurringRuleCount * 5,
      `高风险复现规则 ${antiAiSummary.overview.highRiskRuleCount}，重复规则 ${antiAiSummary.overview.recurringRuleCount}。`,
    ),
    buildRepairMetricSummary(
      'language_drift',
      100 - recentLanguageDriftAlerts.length * 9 - Math.max(0, Math.max(...recentLanguageDriftAlerts.map((alert) => alert.latestValue), 0) - 55),
      `近期语言退化预警 ${recentLanguageDriftAlerts.length} 条。`,
    ),
    buildRepairMetricSummary(
      'feedback_recurrence',
      100 - feedbackSummary.overview.highRiskIssueCount * 12 - feedbackSummary.overview.pauseSuggestedIssueCount * 8 - feedbackSummary.overview.recurringIssueCount * 4,
      `审校复现 ${feedbackSummary.overview.recurringIssueCount} 类，高风险 ${feedbackSummary.overview.highRiskIssueCount}。`,
    ),
    buildRepairMetricSummary(
      'dialogue_separability',
      100 - dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount * 10 - dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount * 8 - dialogueSnapshot.requiredDialogueVoiceLocks.length * 4,
      `高相似角色对 ${dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount}，漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount}。`,
    ),
    buildRepairMetricSummary(
      'style_compliance',
      100 - styleComplianceSummary.rewriteCount * 16 - styleComplianceSummary.warningCount * 6 - Math.max(0, 88 - styleComplianceSummary.averageScore),
      `风格偏移 ${styleComplianceSummary.warningCount} 章，重写阈值 ${styleComplianceSummary.rewriteCount} 章。`,
    ),
    buildRepairMetricSummary(
      'voice_distinction',
      100 - Math.round(dialogueSnapshot.dialogueFingerprintStats.averageCrossCharacterSimilarity * 0.6) - dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount * 8 - dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount * 6 - dialogueSnapshot.requiredDialogueVoiceLocks.length * 4,
      `高相似角色对 ${dialogueSnapshot.dialogueFingerprintStats.highSimilarityPairCount}，漂移角色 ${dialogueSnapshot.dialogueFingerprintStats.driftingCharacterCount}。`,
    ),
    buildRepairMetricSummary(
      'chapter_function',
      100 - chapterFunctionAlerts.length * 8 - chapterFunctionAlerts.filter((alert) => alert.severity === 'blocker').length * 8,
      `章节功能告警 ${chapterFunctionAlerts.length} 条。`,
    ),
    buildRepairMetricSummary(
      'story_arc',
      100 - storyArcProgressSummary.criticalAlertCount * 14 - storyArcProgressSummary.stalledArcCount * 8,
      `停滞故事弧 ${storyArcProgressSummary.stalledArcCount} 条，严重告警 ${storyArcProgressSummary.criticalAlertCount}。`,
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
      'recall',
      100 - recentRecallAlerts.length * 10 - Math.min(recallSummary.consecutiveFallbackChapters, 5) * 8,
      `召回风险 ${recentRecallAlerts.length} 章，连续降级 ${recallSummary.consecutiveFallbackChapters} 章。`,
    ),
    buildRepairMetricSummary(
      'info_reveal_pacing',
      100 - revealFactSignals.early.length * 12 - revealFactSignals.forbidden.length * 15 - revealFactSignals.late.length * 8,
      `过早揭示 ${revealFactSignals.early.length}，禁区前暴露 ${revealFactSignals.forbidden.length}，超计划未揭示 ${revealFactSignals.late.length}。`,
    ),
  ]
  const repairActionSummary = buildRepairActionSummary(repairRiskItems)
  const volumeQualityMetricsWithRepairs: VolumeQualityMetrics[] = volumeQualityMetrics.map((volume) => ({
    ...volume,
    topRisks: dedupeDashboardRiskItems([
      ...volume.topRisks,
      ...repairRiskItems.filter((item) => item.volumeId === volume.volumeId),
    ]).sort(sortDashboardRisks).slice(0, 6),
  }))
  return { ...context, repairMetrics, repairActionSummary, volumeQualityMetricsWithRepairs }
}

function deriveQualityDashboardRiskOverviewContext(
  context: ReturnType<typeof deriveQualityDashboardRepairMetricsContext>,
) {
  const { recentLanguageDriftAlerts, storyPacingAlerts, chapterFunctionAlerts, styleComplianceAlerts } = context
  const { volumeIdByChapterNum, endgameDebtSnapshot, recentRecallAlerts } = context
  const { recentWorldStateAlerts, feedbackSummary, repairRiskItems } = context
  const { volumeQualityMetricsWithRepairs, foreshadowSnapshot } = context
  const { scoredCount, rows } = context
  const { contractProgressMetrics } = context
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
  return {
    ...context,
    globalRisks,
    allRiskItems,
    criticalRiskCount,
    warningRiskCount,
    foreshadowPendingCount,
    foreshadowDueSoonCount,
    foreshadowOverdueCount,
    recentEndgameDebtAlerts,
    riskOverview,
    novelQualityMetrics,
  }
}

function deriveQualityDashboardBatchRuntimeContext(
  context: ReturnType<typeof deriveQualityDashboardRiskOverviewContext>,
) {
  const { batchChapterNums, latestChapterGateEntries } = context
  const { rows, latestBatchProgress } = context
  const { latestCheckpointChapterGap, writebackPendingCount, writebackFailedCount } = context
  const { latestBatchTask } = context
  const { pendingRevisionCount, rewriteTaskCount, batchPendingWritebackCount } = context
  const { staleCheckpointCount } = context
  const { recallRuntimeByChapterId, chapterDetails, latestBatchInspections } = context
  const { latestBatchTaskId, latestBatchSnapshotId, batchChapterIds, worldStateLedger } = context
  const { contractReadyRate, contractBlockerCount, contractWarningCount, contractProgressMetrics } = context
  const { recentRecallAlerts, antiAiSummary, feedbackSummary } = context
  const batchChapterNumById = new Map(rows.map((row) => [row.id, row.chapterNum] as const))
  const batchChapterNumSet = new Set(batchChapterNums)
  const batchGateEntries = latestChapterGateEntries.filter((entry) =>
    batchChapterNumSet.size > 0 && batchChapterNumSet.has(entry.chapterNum))
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
  const batchGateBlockingEntries = batchGateEntries.filter((entry) => entry.gateLevel === 'blocker' || entry.gateLevel === 'rewrite')
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
    batchGateBlockedCount: batchGateBlockingEntries.length,
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
  return {
    ...context,
    inspectionBlockedCount,
    inspectionWarningCount,
    recallDegradedChapterCount,
    latestBatchConsecutiveRecallFallbackChapters,
    batchGateBlockingEntries,
    millionWordDashboard,
  }
}

function deriveQualityDashboardRuntimeContext(
  context: ReturnType<typeof deriveQualityDashboardBatchRuntimeContext>,
) {
  const { writebackPendingCount, writebackFailedCount, staleCheckpointCount } = context
  const { latestCheckpointChapterGap, recallDegradedChapterCount } = context
  const { latestBatchConsecutiveRecallFallbackChapters, inspectionBlockedCount } = context
  const { batchGateBlockingEntries, currentRuntimePolicy, latestBatchGuardrailReason } = context
  const { latestBatchPauseReason, storyMemoryPrecomputeStatus, millionWordDashboard } = context
  const millionRuntimeObservability = buildRuntimeObservability({
    writebackPendingCount,
    writebackFailedCount,
    staleCheckpointCount,
    latestCheckpointChapterGap,
    recallDegradedChapterCount,
    consecutiveRecallFallbackChapters: latestBatchConsecutiveRecallFallbackChapters,
    inspectionBlockedCount,
    batchGateBlockedCount: batchGateBlockingEntries.length,
    runtimePolicy: currentRuntimePolicy,
    latestBatchGuardrailReason,
    latestBatchPauseReason,
    precomputeStatus: storyMemoryPrecomputeStatus,
  })
  return { ...context, millionWordDashboard, millionRuntimeObservability }
}

function deriveQualityDashboardLanguageArtifactsContext(
  context: ReturnType<typeof deriveQualityDashboardRuntimeContext>,
) {
  const { rows, novelId, dialogueSnapshot } = context
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
  const agentQualityObservability = buildQualityAgentDashboardSnapshot(novelId)

  return {
    ...context,
    expressionDedupSummary,
    summaryHealthSummary,
    hookContinuitySummary,
    voiceEvolutionSummary,
    agentQualityObservability,
  }
}

export type QualityDashboardAssemblyContext = ReturnType<typeof deriveQualityDashboardLanguageArtifactsContext>

export function getQualityDashboardData(
  novelId: number,
  options: QualityDashboardOptions = {},
): QualityDashboardData {
  const core = loadQualityDashboardCoreContext(novelId, options)
  const continuity = deriveQualityDashboardContinuityContext(core)
  const chapterNarrative = deriveQualityDashboardChapterNarrativeContext(continuity)
  const chapters = deriveQualityDashboardChapterContext(chapterNarrative)
  const editorial = deriveQualityDashboardEditorialContext(chapters)
  const continuityMetrics = deriveQualityDashboardContinuityMetricsContext(editorial)
  const volumeSignals = deriveQualityDashboardVolumeSignalContext(continuityMetrics)
  const volumeMetrics = deriveQualityDashboardVolumeMetricsContext(volumeSignals)
  const repairFoundation = deriveQualityDashboardRepairFoundationContext(volumeMetrics)
  const policyRepairs = deriveQualityDashboardPolicyRepairContext(repairFoundation)
  const languageRepairs = deriveQualityDashboardMemoryRepairContext(policyRepairs)
  const dialogueRepairs = deriveQualityDashboardDialogueRepairContext(languageRepairs)
  const contractRepairs = deriveQualityDashboardContractRepairContext(dialogueRepairs)
  const storyRepairs = deriveQualityDashboardStoryRepairContext(contractRepairs)
  const growthRepairs = deriveQualityDashboardGrowthRepairContext(storyRepairs)
  const foreshadowRepairs = deriveQualityDashboardForeshadowRepairContext(growthRepairs)
  const continuityRepairs = deriveQualityDashboardContinuityRepairContext(foreshadowRepairs)
  const revealRepairs = deriveQualityDashboardRevealRepairContext(continuityRepairs)
  const repairMetrics = deriveQualityDashboardRepairMetricsContext(revealRepairs)
  const riskOverview = deriveQualityDashboardRiskOverviewContext(repairMetrics)
  const batchRuntime = deriveQualityDashboardBatchRuntimeContext(riskOverview)
  const runtime = deriveQualityDashboardRuntimeContext(batchRuntime)
  const languageArtifacts = deriveQualityDashboardLanguageArtifactsContext(runtime)
  return assembleQualityDashboardData(languageArtifacts)
}
