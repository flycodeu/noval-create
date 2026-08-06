import type {
  LanguageDriftMetrics,
  QualityDashboardData,
  QualityRepairAction,
  QualityRepairActionResult,
  TaskPipelineStats,
} from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'

export type QualityChapterEntry = QualityDashboardData['chapterDetails'][number]
export type QualityHeatmapPoint = QualityDashboardData['heatmapData'][number]
export type QualityRiskEntry = QualityDashboardData['novelQualityMetrics']['topRisks'][number]
export type VolumeQualityEntry = QualityDashboardData['volumeQualityMetrics'][number]

export const DIMENSION_NAMES = [
  '文笔质量', '逻辑连贯', '节奏控制', '情感深度',
  '人物塑造', '世界一致', '创新性', '追读欲',
]

export const CHAPTER_FUNCTION_ORDER: Array<Exclude<QualityDashboardData['chapterFunctionSummary']['dominantTag'], undefined>> = [
  'setup',
  'progression',
  'reversal',
  'payoff',
  'breather',
  'climax',
  'exposition',
  'closure',
]

export function scoreColor(score: number): string {
  if (score >= 8) return '#52c41a'
  if (score >= 6) return '#faad14'
  if (score >= 4) return '#fa8c16'
  return '#f5222d'
}

export function heatmapCellColor(score: number): string {
  if (score >= 9) return '#135200'
  if (score >= 8) return '#237804'
  if (score >= 7) return '#389e0d'
  if (score >= 6) return '#52c41a'
  if (score >= 5) return '#fadb14'
  if (score >= 4) return '#faad14'
  if (score >= 3) return '#fa8c16'
  return '#f5222d'
}

export function languageDriftRiskColor(value: number): string {
  if (value >= 70) return '#f5222d'
  if (value >= 50) return '#fa8c16'
  if (value >= 30) return '#faad14'
  return '#52c41a'
}

export function languageDriftStatusLabel(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return '恶化中'
  if (status === 'improving') return '改善中'
  return '稳定'
}

export function languageDriftStatusColor(status: QualityDashboardData['recentLanguageDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

export function dialogueSimilarityColor(value: number): string {
  if (value >= 85) return '#f5222d'
  if (value >= 75) return '#fa8c16'
  if (value >= 60) return '#faad14'
  return '#52c41a'
}

export function dialogueTrendLabel(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return '漂移加剧'
  if (status === 'improving') return '回稳中'
  return '稳定'
}

export function dialogueTrendColor(status: QualityDashboardData['dialogueDriftTrend'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

export function formatSignedValue(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

export function pressureColor(value: number): string {
  if (value >= 80) return '#f5222d'
  if (value >= 60) return '#fa8c16'
  if (value >= 40) return '#faad14'
  return '#52c41a'
}

export function arcProgressRateColor(value: number): string {
  if (value >= 45) return '#52c41a'
  if (value >= 30) return '#faad14'
  if (value >= 15) return '#fa8c16'
  return '#f5222d'
}

export function paceMarkerLabel(marker?: QualityDashboardData['storyDynamicsTrend'][number]['paceMarker']): string {
  if (marker === 'setup') return '铺垫'
  if (marker === 'conflict') return '冲突'
  if (marker === 'reversal') return '反转'
  if (marker === 'climax') return '高潮'
  if (marker === 'payoff') return '回收'
  if (marker === 'breather') return '喘息'
  return '未标注'
}

export function chapterFunctionLabel(tag?: QualityDashboardData['chapterFunctionSummary']['dominantTag']): string {
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

export function chapterFunctionColor(tag?: QualityDashboardData['chapterFunctionSummary']['dominantTag']): string {
  if (tag === 'setup') return '#6c8ebf'
  if (tag === 'progression') return '#52c41a'
  if (tag === 'reversal') return '#fa8c16'
  if (tag === 'payoff') return '#13c2c2'
  if (tag === 'breather') return '#8c8c8c'
  if (tag === 'climax') return '#f5222d'
  if (tag === 'exposition') return '#722ed1'
  if (tag === 'closure') return '#2f54eb'
  return '#8c8c8c'
}

export function chapterFunctionAlertColor(severity: QualityDashboardData['chapterFunctionAlerts'][number]['severity']): string {
  return severity === 'blocker' ? 'error' : 'warning'
}

export function healthScoreColor(value: number): string {
  if (value >= 85) return '#52c41a'
  if (value >= 70) return '#13c2c2'
  if (value >= 55) return '#faad14'
  if (value >= 40) return '#fa8c16'
  return '#f5222d'
}

export function chapterGateLevelLabel(level: QualityDashboardData['chapterGateTrend'][number]['gateLevel']): string {
  if (level === 'rewrite') return '退回重写'
  if (level === 'blocker') return '阻塞'
  if (level === 'warning') return '预警'
  return '通过'
}

export function chapterGateLevelColor(level: QualityDashboardData['chapterGateTrend'][number]['gateLevel']): string {
  if (level === 'rewrite') return 'red'
  if (level === 'blocker') return 'error'
  if (level === 'warning') return 'warning'
  return 'success'
}

export function chapterGateBandLabel(band: QualityDashboardData['chapterGateTrend'][number]['scoreBand']): string {
  if (band === 'stable') return '稳定'
  if (band === 'attention') return '关注'
  if (band === 'risky') return '风险'
  return '失稳'
}

export function chapterGateScoreBand(score: number): QualityDashboardData['chapterGateTrend'][number]['scoreBand'] {
  if (score >= 80) return 'stable'
  if (score >= 60) return 'attention'
  if (score >= 40) return 'risky'
  return 'unstable'
}

export function chapterGateBandColor(band: QualityDashboardData['chapterGateTrend'][number]['scoreBand']): string {
  if (band === 'stable') return 'success'
  if (band === 'attention') return 'processing'
  if (band === 'risky') return 'warning'
  return 'error'
}

export function chapterGateAlertColor(status: QualityDashboardData['chapterGateDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return 'error'
  if (status === 'improving') return 'success'
  return 'default'
}

export function chapterGateAlertLabel(status: QualityDashboardData['chapterGateDriftAlerts'][number]['status']): string {
  if (status === 'worsening') return '恶化'
  if (status === 'improving') return '改善'
  return '稳定'
}

export function chapterGateHeatmapColor(score: number): string {
  if (score >= 85) return '#237804'
  if (score >= 70) return '#52c41a'
  if (score >= 60) return '#13c2c2'
  if (score >= 45) return '#faad14'
  if (score >= 30) return '#fa8c16'
  return '#f5222d'
}

export function qualityRiskKindLabel(kind: QualityDashboardData['novelQualityMetrics']['riskOverview'][number]['kind']): string {
  if (kind === 'commitment_delivery') return '承诺兑现率'
  if (kind === 'typed_ref_coverage') return '引用覆盖'
  if (kind === 'source_grounding') return '来源支撑'
  if (kind === 'operating_mode_policy') return '运行模式策略'
  if (kind === 'genre_register_drift') return '题材语域漂移'
  if (kind === 'exposition_density') return '解释密度 / 说明文'
  if (kind === 'long_window_homogenization') return '累积同质化'
  if (kind === 'dialogue_separability') return '对白可分离度'
  if (kind === 'language_drift') return 'AI 味退化'
  if (kind === 'feedback_recurrence') return '审校复现'
  if (kind === 'style_compliance') return '风格硬约束'
  if (kind === 'voice_distinction') return '角色声音区分度'
  if (kind === 'growth_cost_balance') return '成长-代价平衡'
  if (kind === 'story_dynamics') return '主角与节奏'
  if (kind === 'chapter_function') return '章节功能'
  if (kind === 'story_arc') return '故事弧推进'
  if (kind === 'foreshadow_debt') return '伏笔债务'
  if (kind === 'endgame_debt') return '终局债务'
  if (kind === 'recall') return '召回风险'
  if (kind === 'info_reveal_pacing') return '信息揭示节奏'
  return '状态稳定性'
}

export function qualityRepairMetricLabel(key: QualityRepairAction['metricKey']): string {
  if (key === 'commitment_delivery') return '承诺兑现率'
  if (key === 'typed_ref_coverage') return '引用覆盖'
  if (key === 'source_grounding') return '来源支撑'
  if (key === 'operating_mode_policy') return '运行模式策略'
  if (key === 'genre_register_drift') return '题材语域漂移'
  if (key === 'exposition_density') return '解释密度 / 说明文'
  if (key === 'long_window_homogenization') return '累积同质化'
  if (key === 'dialogue_separability') return '对白可分离度'
  if (key === 'voice_distinction') return '角色声音区分度'
  if (key === 'growth_cost_balance') return '成长-代价平衡'
  if (key === 'foreshadow_debt') return '伏笔债务压力'
  if (key === 'world_state_drift') return '世界状态漂移'
  return '信息揭示节奏'
}

export function buildWorkspacePath(novelId: number, page: string, query?: Record<string, string>): string {
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  const queryString = params.toString()
  return buildWorkspaceRoute(novelId, `${page}${queryString ? `?${queryString}` : ''}`)
}

export function buildRepairActionTargetPath(novelId: number, page?: string, query?: Record<string, string>): string | null {
  if (!page) return null
  return buildWorkspacePath(novelId, page, query)
}

export function buildRepairResultTargetPath(novelId: number, result: QualityRepairActionResult): string | null {
  if (!result.relatedPage) return null
  return buildWorkspacePath(novelId, result.relatedPage, result.navigationQuery)
}

export function readinessStatusColor(status: QualityDashboardData['productionReadiness']['status']): string {
  if (status === 'ready') return 'success'
  if (status === 'warning') return 'warning'
  return 'error'
}

export function batchStatusColor(status: QualityDashboardData['batchHealth']['status']): string {
  if (status === 'success' || status === 'idle') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'failed' || status === 'cancelled') return 'error'
  return 'processing'
}

export function batchStatusLabel(status: QualityDashboardData['batchHealth']['status']): string {
  if (status === 'idle') return '空闲'
  if (status === 'pending') return '待启动'
  if (status === 'running') return '运行中'
  if (status === 'paused') return '已暂停'
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  return '已取消'
}

export function pipelineRoleLabel(role: TaskPipelineStats['roleStats'][number]['role']): string {
  if (role === 'planner') return '规划'
  if (role === 'writer') return '写作'
  if (role === 'critic') return '审校'
  if (role === 'rewriter') return '重写'
  if (role === 'canonizer') return '回写'
  return '定稿'
}

export function runtimePressureLevelLabel(level: NonNullable<QualityDashboardData['millionRuntimeObservability']>['runtimePressureLevel']): string {
  if (level === 'high') return '高'
  if (level === 'medium') return '中'
  return '低'
}

export function precomputeQueueStatusLabel(status: NonNullable<QualityDashboardData['millionRuntimeObservability']>['precomputeQueueStatus']): string {
  if (status === 'queued') return '排队'
  if (status === 'running') return '运行中'
  if (status === 'failed') return '失败'
  return '空闲'
}

export function chapterGenerationModeLabel(mode: NonNullable<QualityDashboardData['millionRuntimeObservability']>['chapterGenerationMode']): string {
  if (mode === 'serial_only') return '正文串行'
  return mode
}

export function mainThreadPressureStrategyLabel(strategy: NonNullable<QualityDashboardData['millionRuntimeObservability']>['mainThreadPressureStrategy']): string {
  if (strategy === 'latency_first') return '优先速度'
  if (strategy === 'balanced') return '均衡'
  return '优先稳定'
}

export function sourceCoverageLabel(coverage?: NonNullable<QualityDashboardData['genreGroundingObservability']>['sourceCoverage']): string {
  if (coverage === 'grounded') return '已支撑'
  if (coverage === 'partial') return '部分支撑'
  return '无来源'
}

export function historicalModeLabel(mode?: NonNullable<QualityDashboardData['genreGroundingObservability']>['historicalMode']): string {
  if (mode === 'historical_realist') return '历史写实'
  if (mode === 'alternate_history') return '架空历史'
  if (mode === 'pseudo_historical_fantasy') return '类史幻想'
  return '非历史'
}

export function promptSummaryModeLabel(mode: NonNullable<QualityDashboardData['structuredMemoryObservability']>['promptSummaryMode']): string {
  if (mode === 'structured_first') return '结构化优先'
  return mode
}

export function memoryScopeLabel(scope: NonNullable<QualityDashboardData['structuredMemoryObservability']>['buckets'][number]['scopeType']): string {
  if (scope === 'novel') return '全书'
  if (scope === 'volume') return '分卷'
  return '分部'
}

export function characterRoleTypeLabel(roleType: string): string {
  if (roleType === 'protagonist') return '主角'
  if (roleType === 'major') return '主要角色'
  if (roleType === 'minor') return '次要角色'
  if (roleType === 'antagonist') return '对手'
  if (roleType === 'supporting') return '配角'
  return roleType
}

export function costResolutionStateLabel(state?: NonNullable<QualityChapterEntry['storyDynamics']>['costResolutionState'] | null): string {
  if (state === 'ongoing') return '持续中'
  if (state === 'resolved') return '已解决'
  if (state === 'evaporated') return '已蒸发'
  return '新代价'
}

export function reversalSupportStateLabel(state?: NonNullable<QualityChapterEntry['storyDynamics']>['reversalSupportState'] | null): string {
  if (state === 'supported') return '有支撑'
  if (state === 'forced') return '生硬'
  return '偏弱'
}

export function rewardStateLabel(state: NonNullable<QualityChapterEntry['storyDynamics']>['rewardState']): string {
  if (state === 'major') return '明确回报'
  if (state === 'partial') return '部分回报'
  return '无回报'
}

export function buildSoakReportPath(novelId: number): string {
  return `.tmp-tests/real-chapter-soak-report-${novelId}.json`
}

export function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildSoakExportCommand(novelId: number): string {
  return `npm run soak:export-chapter-report -- --db ${quotePowerShellArg('path/to/novelforge.db')} --novelId ${novelId} --out ${quotePowerShellArg(buildSoakReportPath(novelId))}`
}

export function buildSoakValidateCommand(novelId: number): string {
  return `npm run test:chapter-soak -- --report ${quotePowerShellArg(buildSoakReportPath(novelId))}`
}

export function recallSnapshotSourceLabel(source?: QualityChapterEntry['recallSnapshotSource']): string | null {
  if (source === 'runtime') return '真实运行快照'
  if (source === 'backfilled') return '历史回填快照'
  return null
}

export function recallSnapshotSourceColor(source?: QualityChapterEntry['recallSnapshotSource']): string {
  return source === 'backfilled' ? 'gold' : 'cyan'
}

export function recallFallbackReasonLabel(reason?: string): string {
  if (!reason) return ''
  if (reason === 'embedding_service_failed') return '向量服务失败'
  if (reason === 'query_embedding_failed') return '查询向量失败'
  if (reason === 'embedding_profile_mismatch') return '向量空间不匹配'
  if (reason === 'no_hits') return '无命中'
  if (reason === 'only_stale_hits') return '仅命中过期片段'
  if (reason === 'budget_trimmed') return '预算裁剪'
  if (reason === 'disabled_by_config') return '配置关闭'
  if (reason === 'service_failed') return '服务失败'
  if (reason === 'empty_result') return '结果为空'
  if (reason === 'render_empty') return '渲染为空'
  return reason
}

export function agentArtifactKindLabel(kind: string): string {
  if (kind === 'quality_report') return '质量报告'
  if (kind === 'repair_plan') return '修复计划'
  if (kind === 'quality_repair_draft') return '候选 Diff'
  if (kind === 'quality_repair_review') return '独立审校'
  if (kind === 'quality_comparison') return '比较结果'
  return kind
}

export function agentArtifactStatusLabel(status: string): string {
  if (status === 'draft') return '草稿'
  if (status === 'reviewed') return '已审校'
  if (status === 'approved') return '已批准'
  if (status === 'committed') return '已提交'
  if (status === 'rejected') return '已拒绝'
  if (status === 'superseded') return '已被替代'
  return status
}

export function agentArtifactStatusColor(status: string): string {
  if (status === 'approved' || status === 'committed' || status === 'reviewed') return 'success'
  if (status === 'rejected') return 'error'
  if (status === 'superseded') return 'default'
  return 'processing'
}

export function artifactHashTail(hash: string): string {
  return hash ? `…${hash.slice(-12)}` : '-'
}

export function signedDashboardDelta(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

export function worldStateSeverityColor(severity: QualityDashboardData['recentWorldStateAlerts'][number]['severity']): string {
  if (severity === 'critical') return 'red'
  if (severity === 'warning') return 'orange'
  return 'default'
}

export function worldStateEntityLabel(entityType: QualityDashboardData['recentWorldStateAlerts'][number]['entityType']): string {
  if (entityType === 'character') return '人物'
  if (entityType === 'faction') return '势力'
  if (entityType === 'item') return '物品'
  if (entityType === 'relation') return '关系'
  return '地点'
}

export const LANGUAGE_DRIFT_LABELS: Array<{ key: keyof LanguageDriftMetrics; label: string }> = [
  { key: 'abstractTokenDensity', label: '抽象词密度' },
  { key: 'sentencePatternRepeatRate', label: '句式重复率' },
  { key: 'endingSummaryRate', label: '段尾升华率' },
  { key: 'ornamentOverloadRate', label: '华丽词堆砌率' },
  { key: 'nonHumanCollocationRate', label: '非人类搭配率' },
  { key: 'dashDensity', label: '破折号密度' },
  { key: 'parentheticalExplanationDensity', label: '括号说明密度' },
  { key: 'metaphorStackRate', label: '比喻堆叠率' },
  { key: 'parallelismRate', label: '排比句率' },
  { key: 'bodyDetailClicheRate', label: '手眼声音细节密度' },
  { key: 'isolatedTemplateParagraphRate', label: '孤立模板短段率' },
]

export function getTopLanguageDriftMetrics(metrics: LanguageDriftMetrics, limit = 3) {
  return [...LANGUAGE_DRIFT_LABELS]
    .map(({ key, label }) => ({ key, label, value: metrics[key] }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// 数据聚合 / 变换（纯函数）
// ---------------------------------------------------------------------------

export interface TrendPoint {
  chapterNum: number
  value: number
}

/** 卷筛选后各区块共用的数据切片。 */
export interface VolumeFilteredDashboard {
  chapterDetails: QualityDashboardData['chapterDetails']
  heatmapData: QualityDashboardData['heatmapData']
  chapterGateTrend: QualityDashboardData['chapterGateTrend']
  chapterGateHeatmap: QualityDashboardData['chapterGateHeatmap']
  chapterGateAlerts: QualityDashboardData['chapterGateDriftAlerts']
  overallTrend: QualityDashboardData['overallScoreTrend']
  aiLikeTrend: QualityDashboardData['aiLikeRateTrend']
  languageVolumes: QualityDashboardData['volumeLanguageDrift']
  storyVolumes: QualityDashboardData['volumeStoryDynamics']
  chapterFunctionRuns: QualityDashboardData['repeatedFunctionRuns']
  chapterFunctionAlerts: QualityDashboardData['chapterFunctionAlerts']
  chapterFunctionVolumes: QualityDashboardData['volumeChapterFunctions']
  arcVolumes: QualityDashboardData['storyArcProgressVolumes']
  recallAlerts: QualityDashboardData['recentRecallAlerts']
  recallVolumes: QualityDashboardData['volumeRecallDiagnostics']
  worldAlerts: QualityDashboardData['recentWorldStateAlerts']
  worldVolumes: QualityDashboardData['volumeWorldStateStability']
  antiAiRecurrence: QualityDashboardData['antiAiRecurrence']
  feedbackRecurrence: QualityDashboardData['feedbackRecurrence']
}

type VolumeFilterSource = Pick<QualityDashboardData,
  | 'chapterDetails'
  | 'heatmapData'
  | 'chapterGateTrend'
  | 'chapterGateHeatmap'
  | 'chapterGateDriftAlerts'
  | 'overallScoreTrend'
  | 'aiLikeRateTrend'
  | 'volumeLanguageDrift'
  | 'volumeStoryDynamics'
  | 'repeatedFunctionRuns'
  | 'chapterFunctionAlerts'
  | 'volumeChapterFunctions'
  | 'storyArcProgressVolumes'
  | 'recentRecallAlerts'
  | 'volumeRecallDiagnostics'
  | 'recentWorldStateAlerts'
  | 'volumeWorldStateStability'
  | 'antiAiRecurrence'
  | 'feedbackRecurrence'
>

/** 按选中的卷收窄各区块数据；不选卷时原样返回。 */
export function filterDashboardByVolume(
  data: VolumeFilterSource,
  selectedVolume: VolumeQualityEntry | null,
): VolumeFilteredDashboard {
  if (!selectedVolume) {
    return {
      chapterDetails: data.chapterDetails,
      heatmapData: data.heatmapData,
      chapterGateTrend: data.chapterGateTrend,
      chapterGateHeatmap: data.chapterGateHeatmap,
      chapterGateAlerts: data.chapterGateDriftAlerts,
      overallTrend: data.overallScoreTrend,
      aiLikeTrend: data.aiLikeRateTrend,
      languageVolumes: data.volumeLanguageDrift,
      storyVolumes: data.volumeStoryDynamics,
      chapterFunctionRuns: data.repeatedFunctionRuns,
      chapterFunctionAlerts: data.chapterFunctionAlerts,
      chapterFunctionVolumes: data.volumeChapterFunctions,
      arcVolumes: data.storyArcProgressVolumes,
      recallAlerts: data.recentRecallAlerts,
      recallVolumes: data.volumeRecallDiagnostics,
      worldAlerts: data.recentWorldStateAlerts,
      worldVolumes: data.volumeWorldStateStability,
      antiAiRecurrence: data.antiAiRecurrence,
      feedbackRecurrence: data.feedbackRecurrence,
    }
  }

  const inVolumeRange = (chapterNum: number) => chapterNum >= selectedVolume.chapterStart && chapterNum <= selectedVolume.chapterEnd
  const volumeChapterNums = new Set(
    data.chapterDetails
      .filter((entry) => entry.volumeId === selectedVolume.volumeId)
      .map((entry) => entry.chapterNum),
  )

  return {
    chapterDetails: data.chapterDetails.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    heatmapData: data.heatmapData.filter((entry) => volumeChapterNums.has(entry.chapterNum)),
    chapterGateTrend: data.chapterGateTrend.filter((entry) => volumeChapterNums.has(entry.chapterNum)),
    chapterGateHeatmap: data.chapterGateHeatmap.filter((entry) => volumeChapterNums.has(entry.chapterNum)),
    chapterGateAlerts: data.chapterGateDriftAlerts.filter((entry) => inVolumeRange(entry.chapterNum)),
    overallTrend: data.overallScoreTrend.filter((entry) => volumeChapterNums.has(entry.chapterNum)),
    aiLikeTrend: data.aiLikeRateTrend.filter((entry) => volumeChapterNums.has(entry.chapterNum)),
    languageVolumes: data.volumeLanguageDrift.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    storyVolumes: data.volumeStoryDynamics.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    chapterFunctionRuns: data.repeatedFunctionRuns.filter((entry) => entry.chapterNums.some(inVolumeRange)),
    chapterFunctionAlerts: data.chapterFunctionAlerts.filter((entry) => (
      entry.volumeId === selectedVolume.volumeId || entry.chapterNums.some(inVolumeRange)
    )),
    chapterFunctionVolumes: data.volumeChapterFunctions.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    arcVolumes: data.storyArcProgressVolumes.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    recallAlerts: data.recentRecallAlerts.filter((entry) => inVolumeRange(entry.chapterNum)),
    recallVolumes: data.volumeRecallDiagnostics.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    worldAlerts: data.recentWorldStateAlerts.filter((entry) => inVolumeRange(entry.chapterNum)),
    worldVolumes: data.volumeWorldStateStability.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    antiAiRecurrence: {
      ...data.antiAiRecurrence,
      recentAlerts: data.antiAiRecurrence.recentAlerts.filter((entry) => entry.chapterNums.some(inVolumeRange)),
      volumeEntries: data.antiAiRecurrence.volumeEntries.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    },
    feedbackRecurrence: {
      ...data.feedbackRecurrence,
      recentAlerts: data.feedbackRecurrence.recentAlerts.filter((entry) => entry.chapterNums.some(inVolumeRange)),
      humanization: {
        ...data.feedbackRecurrence.humanization,
        topRepeatedIssues: data.feedbackRecurrence.humanization.topRepeatedIssues.filter((entry) => entry.chapterNums.some(inVolumeRange)),
        promotedIssues: data.feedbackRecurrence.humanization.promotedIssues.filter((entry) => entry.chapterNums.some(inVolumeRange)),
        recentAlerts: data.feedbackRecurrence.humanization.recentAlerts.filter((entry) => entry.chapterNums.some(inVolumeRange)),
      },
      volumeEntries: data.feedbackRecurrence.volumeEntries.filter((entry) => entry.volumeId === selectedVolume.volumeId),
    },
  }
}

export interface ChapterGateTrendSummary {
  averageVisibleScore: number
  bandCounts: Record<QualityDashboardData['chapterGateTrend'][number]['scoreBand'], number>
  levelCounts: Record<QualityDashboardData['chapterGateTrend'][number]['gateLevel'], number>
}

/** 章节验收门趋势的均值与分档统计。 */
export function summarizeChapterGateTrend(trend: QualityDashboardData['chapterGateTrend']): ChapterGateTrendSummary {
  const averageVisibleScore = trend.length > 0
    ? Math.round((trend.reduce((sum, entry) => sum + entry.totalScore, 0) / trend.length) * 10) / 10
    : 0
  const bandCounts = trend.reduce<ChapterGateTrendSummary['bandCounts']>((result, entry) => {
    result[entry.scoreBand] += 1
    return result
  }, { stable: 0, attention: 0, risky: 0, unstable: 0 })
  const levelCounts = trend.reduce<ChapterGateTrendSummary['levelCounts']>((result, entry) => {
    result[entry.gateLevel] += 1
    return result
  }, { pass: 0, warning: 0, blocker: 0, rewrite: 0 })
  return { averageVisibleScore, bandCounts, levelCounts }
}

/** 非稳定状态的门级漂移告警（保序）。 */
export function getVisibleGateAlerts(
  alerts: QualityDashboardData['chapterGateDriftAlerts'],
  limit = 6,
): QualityDashboardData['chapterGateDriftAlerts'] {
  return alerts.filter((alert) => alert.status !== 'stable').slice(0, limit)
}

export interface ChapterGateHeatmapModel {
  dimensions: string[]
  chapterNums: number[]
  valueMap: Map<string, QualityDashboardData['chapterGateHeatmap'][number]>
}

/** 章节验收门维度热力图的行列与取值索引。 */
export function buildChapterGateHeatmapModel(
  heatmap: QualityDashboardData['chapterGateHeatmap'],
  trend: QualityDashboardData['chapterGateTrend'],
): ChapterGateHeatmapModel {
  return {
    dimensions: Array.from(new Set(heatmap.map((entry) => entry.dimension))),
    chapterNums: trend.map((entry) => entry.chapterNum),
    valueMap: new Map(heatmap.map((entry) => [`${entry.chapterNum}:${entry.dimension}`, entry] as const)),
  }
}

export interface QualityHeatmapModel {
  byDim: Map<string, Map<number, number>>
  dimensions: string[]
  displayNums: number[]
}

/** 评分热力图模型：按维度分桶 + 超过 50 章时等距采样。 */
export function buildQualityHeatmapModel(data: QualityHeatmapPoint[], chapterNums: number[]): QualityHeatmapModel {
  const byDim = new Map<string, Map<number, number>>()
  const seen = new Set<string>()
  for (const p of data) {
    if (!byDim.has(p.dimension)) byDim.set(p.dimension, new Map())
    byDim.get(p.dimension)!.set(p.chapterNum, p.score)
    seen.add(p.dimension)
  }
  const dimensions = DIMENSION_NAMES.filter((d) => seen.has(d))
  const displayNums = chapterNums.length > 50
    ? chapterNums.filter((_, i) => i % Math.ceil(chapterNums.length / 50) === 0)
    : chapterNums
  return { byDim, dimensions, displayNums }
}

/** 把 (chapterNum, value) 序列转成 SVG path；value 按 maxValue 归一化到 height。 */
export function buildTrendPath(
  points: TrendPoint[],
  width: number,
  height: number,
  maxValue: number,
): string {
  if (points.length === 0) return ''
  const stepX = width / Math.max(points.length - 1, 1)
  return points.map((point, index) => {
    const x = index * stepX
    const y = height - (point.value / maxValue) * height
    return `${index === 0 ? 'M' : 'L'}${x},${y}`
  }).join(' ')
}

export interface MiniTrendGeometry {
  width: number
  height: number
  path: string
  latest: number
}

/** 迷你趋势行的几何：值裁剪到 0-100 后归一化。 */
export function buildMiniTrendGeometry(points: TrendPoint[]): MiniTrendGeometry {
  const width = Math.max(200, points.length * 12)
  const height = 36
  const clamped = points.map((point) => ({
    chapterNum: point.chapterNum,
    value: Math.max(0, Math.min(100, point.value)),
  }))
  return {
    width,
    height,
    path: buildTrendPath(clamped, width, height, 100),
    latest: points[points.length - 1]?.value ?? 0,
  }
}

export interface WeakDimensionBarModel {
  items: Array<{ dimension: string; count: number }>
  maxCount: number
}

/** 薄弱维度条形图：过滤空项并求最大值。 */
export function buildWeakDimensionBars(data: Array<{ dimension: string; count: number }>): WeakDimensionBarModel {
  const items = data.filter((d) => d.count > 0)
  return { items, maxCount: Math.max(...items.map((d) => d.count), 1) }
}

/** 按章号找到章节详情（用于风险定位与下钻）。 */
export function findChapterByNum(
  chapterDetails: QualityDashboardData['chapterDetails'],
  chapterNum: number,
): QualityChapterEntry | null {
  return chapterDetails.find((entry) => entry.chapterNum === chapterNum) || null
}

// ---------------------------------------------------------------------------
// 顶部筛选条：章节范围 / 严重度 / 指标类别
// ---------------------------------------------------------------------------

export type QualitySeverityFilter = 'all' | 'high' | 'medium' | 'low'
export type QualityCategoryFilter = 'all' | 'overview' | 'language' | 'structure' | 'stability'

export interface QualityDashboardFilters {
  chapterStart: number | null
  chapterEnd: number | null
  severity: QualitySeverityFilter
  category: QualityCategoryFilter
}

export const DEFAULT_QUALITY_FILTERS: QualityDashboardFilters = {
  chapterStart: null,
  chapterEnd: null,
  severity: 'all',
  category: 'all',
}

export function hasActiveQualityFilters(filters: QualityDashboardFilters): boolean {
  return filters.chapterStart != null
    || filters.chapterEnd != null
    || filters.severity !== 'all'
    || filters.category !== 'all'
}

/** 把各处不一致的严重度口径归一到 高/中/低；未知口径返回 null。 */
export function normalizeSeverityRank(severity?: string | null): Exclude<QualitySeverityFilter, 'all'> | null {
  if (!severity) return null
  if (severity === 'high' || severity === 'critical' || severity === 'blocker' || severity === 'rewrite' || severity === 'fatal') return 'high'
  if (severity === 'medium' || severity === 'warning' || severity === 'warn') return 'medium'
  if (severity === 'low' || severity === 'info' || severity === 'minor') return 'low'
  return null
}

/** 严重度筛选；无法识别的严重度保守保留。 */
export function matchesSeverityFilter(severity: string | null | undefined, filter: QualitySeverityFilter): boolean {
  if (filter === 'all') return true
  const rank = normalizeSeverityRank(severity)
  if (rank == null) return true
  return rank === filter
}

/** 单章号是否落在筛选范围；无章号的条目保守保留。 */
export function isChapterInRange(chapterNum: number | null | undefined, filters: QualityDashboardFilters): boolean {
  if (typeof chapterNum !== 'number') return true
  if (filters.chapterStart != null && chapterNum < filters.chapterStart) return false
  if (filters.chapterEnd != null && chapterNum > filters.chapterEnd) return false
  return true
}

/** 章号集合与筛选范围是否有交集；空集合保守保留。 */
export function chapterNumsOverlapRange(chapterNums: number[] | undefined, filters: QualityDashboardFilters): boolean {
  if (filters.chapterStart == null && filters.chapterEnd == null) return true
  if (!chapterNums || chapterNums.length === 0) return true
  return chapterNums.some((chapterNum) => isChapterInRange(chapterNum, filters))
}

/** 风险类型映射到 Tab 维度的指标类别。 */
export function qualityRiskCategory(
  kind: QualityDashboardData['novelQualityMetrics']['riskOverview'][number]['kind'],
): Exclude<QualityCategoryFilter, 'all'> {
  if (
    kind === 'language_drift'
    || kind === 'feedback_recurrence'
    || kind === 'style_compliance'
    || kind === 'voice_distinction'
    || kind === 'dialogue_separability'
    || kind === 'genre_register_drift'
    || kind === 'exposition_density'
    || kind === 'long_window_homogenization'
  ) return 'language'
  if (
    kind === 'story_dynamics'
    || kind === 'chapter_function'
    || kind === 'story_arc'
    || kind === 'foreshadow_debt'
    || kind === 'endgame_debt'
    || kind === 'growth_cost_balance'
    || kind === 'commitment_delivery'
    || kind === 'info_reveal_pacing'
  ) return 'structure'
  if (kind === 'recall' || kind === 'world_state') return 'stability'
  return 'overview'
}

/** 风险列表筛选：严重度 + 指标类别 + 章节范围（无绑定章节保守保留）。 */
export function filterQualityRisks<T extends Pick<QualityRiskEntry, 'kind' | 'severity' | 'chapterNums'>>(
  risks: T[],
  filters: QualityDashboardFilters,
): T[] {
  return risks.filter((risk) => (
    matchesSeverityFilter(risk.severity, filters.severity)
    && (filters.category === 'all' || qualityRiskCategory(risk.kind) === filters.category)
    && chapterNumsOverlapRange(risk.chapterNums, filters)
  ))
}

/** 只按严重度筛选带 severity 字段的告警列表。 */
export function filterSeverityAlerts<T extends { severity?: string }>(
  alerts: T[],
  filters: QualityDashboardFilters,
): T[] {
  if (filters.severity === 'all') return alerts
  return alerts.filter((alert) => matchesSeverityFilter(alert.severity, filters.severity))
}

/** 在卷筛选之后再叠加章节范围与严重度筛选。 */
export function applyQualityDashboardFilters(
  view: VolumeFilteredDashboard,
  filters: QualityDashboardFilters,
): VolumeFilteredDashboard {
  if (!hasActiveQualityFilters(filters)) return view

  const inRange = (chapterNum: number | null | undefined) => isChapterInRange(chapterNum, filters)
  const overlap = (chapterNums: number[] | undefined) => chapterNumsOverlapRange(chapterNums, filters)
  const severityOk = (severity: string | null | undefined) => matchesSeverityFilter(severity, filters.severity)

  return {
    ...view,
    chapterDetails: view.chapterDetails.filter((entry) => inRange(entry.chapterNum)),
    heatmapData: view.heatmapData.filter((entry) => inRange(entry.chapterNum)),
    chapterGateTrend: view.chapterGateTrend.filter((entry) => inRange(entry.chapterNum)),
    chapterGateHeatmap: view.chapterGateHeatmap.filter((entry) => inRange(entry.chapterNum)),
    chapterGateAlerts: view.chapterGateAlerts.filter((entry) => inRange(entry.chapterNum)),
    overallTrend: view.overallTrend.filter((entry) => inRange(entry.chapterNum)),
    aiLikeTrend: view.aiLikeTrend.filter((entry) => inRange(entry.chapterNum)),
    chapterFunctionRuns: view.chapterFunctionRuns.filter((entry) => overlap(entry.chapterNums)),
    chapterFunctionAlerts: view.chapterFunctionAlerts.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
    recallAlerts: view.recallAlerts.filter((entry) => inRange(entry.chapterNum)),
    worldAlerts: view.worldAlerts.filter((entry) => inRange(entry.chapterNum) && severityOk(entry.severity)),
    antiAiRecurrence: {
      ...view.antiAiRecurrence,
      topRepeatedRules: view.antiAiRecurrence.topRepeatedRules.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
      promotedRules: view.antiAiRecurrence.promotedRules.filter((entry) => overlap(entry.chapterNums)),
      recentAlerts: view.antiAiRecurrence.recentAlerts.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
    },
    feedbackRecurrence: {
      ...view.feedbackRecurrence,
      topRepeatedIssues: view.feedbackRecurrence.topRepeatedIssues.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
      promotedIssues: view.feedbackRecurrence.promotedIssues.filter((entry) => overlap(entry.chapterNums)),
      recentAlerts: view.feedbackRecurrence.recentAlerts.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
      humanization: {
        ...view.feedbackRecurrence.humanization,
        topRepeatedIssues: view.feedbackRecurrence.humanization.topRepeatedIssues.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
        promotedIssues: view.feedbackRecurrence.humanization.promotedIssues.filter((entry) => overlap(entry.chapterNums)),
        recentAlerts: view.feedbackRecurrence.humanization.recentAlerts.filter((entry) => overlap(entry.chapterNums) && severityOk(entry.severity)),
      },
    },
  }
}
