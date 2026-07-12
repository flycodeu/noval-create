import { createHash } from 'node:crypto'
import type {
  QualityDashboardData,
  QualityDashboardRiskItem,
  QualityRepairAction,
} from '../../src/types'
import type {
  AgentQualityFinding,
  AgentQualityFindingAction,
  AgentQualityMetricSnapshot,
  AgentQualityProfile,
  AgentQualityProfileSnapshot,
  AgentQualityReportContent,
  AgentQualityScope,
} from '../../src/shared/quality-agent-workflow'

export type AgentQualityDashboardSource = Pick<QualityDashboardData,
  | 'totalChaptersScored'
  | 'averageOverallScore'
  | 'averageAiLikeRate'
  | 'novelQualityMetrics'
  | 'volumeQualityMetrics'
  | 'productionReadiness'
  | 'chapterGateSummary'
  | 'antiAiRecurrence'
  | 'feedbackRecurrence'
  | 'repairMetrics'
  | 'chapterDetails'
>

export const AGENT_QUALITY_PROFILES: Record<AgentQualityProfile, AgentQualityProfileSnapshot> = Object.freeze({
  longform_health_v1: Object.freeze({
    profile: 'longform_health_v1',
    minimumHealthScore: 75,
    minimumAverageScore: 75,
    minimumCoverageRate: 70,
    maximumAverageAiLikeRate: 45,
    requireProductionReady: false,
    blockCriticalRisks: true,
    blockRiskyChapterGates: false,
    blockHighRiskAiRecurrence: false,
    blockFeedbackPauseSignals: false,
  }),
  recommendation_ready_v1: Object.freeze({
    profile: 'recommendation_ready_v1',
    minimumHealthScore: 82,
    minimumAverageScore: 82,
    minimumCoverageRate: 100,
    maximumAverageAiLikeRate: 35,
    requireProductionReady: true,
    blockCriticalRisks: true,
    blockRiskyChapterGates: true,
    blockHighRiskAiRecurrence: true,
    blockFeedbackPauseSignals: true,
  }),
})

const SEVERITY_RANK: Record<AgentQualityFinding['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => (value || '').trim()).filter(Boolean))]
}

function stableCode(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function compactAction(action: QualityRepairAction): AgentQualityFindingAction {
  return {
    id: action.id,
    label: action.label,
    description: action.description,
    actionType: action.actionType,
    metricKey: action.metricKey,
    targetPage: action.targetPage,
    safeToExecute: action.safeToExecute,
    ...(action.chapterId ? { chapterId: action.chapterId } : {}),
    ...(action.chapterNum ? { chapterNum: action.chapterNum } : {}),
    ...(action.entityType ? { entityType: action.entityType } : {}),
    ...(action.entityId ? { entityId: action.entityId } : {}),
  }
}

function findingSignature(risk: QualityDashboardRiskItem): string {
  return [
    risk.kind,
    risk.volumeId || 0,
    [...risk.chapterNums].sort((left, right) => left - right).join(','),
    risk.title.trim().toLowerCase(),
  ].join(':')
}

function riskToFinding(
  risk: QualityDashboardRiskItem,
  profile: AgentQualityProfileSnapshot,
): AgentQualityFinding {
  const signature = findingSignature(risk)
  const blocking = risk.severity === 'critical' && profile.blockCriticalRisks
  const evidenceRefs = dedupeStrings([
    `quality-dashboard:risk:${risk.kind}`,
    risk.volumeId ? `volume:${risk.volumeId}` : '',
    risk.chapterNums.length > 0 ? `chapters:${risk.chapterNums.join(',')}` : '',
    risk.metricKey ? `repair-metric:${risk.metricKey}` : '',
  ])
  return {
    id: `finding_${stableCode(signature)}`,
    signature,
    code: risk.kind,
    kind: risk.kind,
    severity: risk.severity,
    blocking,
    title: risk.title,
    detail: risk.detail,
    whyItHappened: risk.whyItHappened,
    howToFix: risk.howToFix,
    ...(risk.volumeId ? { volumeId: risk.volumeId } : {}),
    chapterNums: [...risk.chapterNums].sort((left, right) => left - right),
    evidenceRefs,
    suggestedActions: risk.suggestedActions.map(compactAction),
  }
}

function syntheticFinding(input: {
  code: string
  kind: AgentQualityFinding['kind']
  severity: AgentQualityFinding['severity']
  blocking: boolean
  title: string
  detail: string
  howToFix: string
  scope: AgentQualityScope
  evidenceRefs: string[]
}): AgentQualityFinding {
  const signature = `${input.code}:${input.scope.type}:${input.scope.volumeId || 0}:${input.scope.chapterId || 0}`
  return {
    id: `finding_${stableCode(signature)}`,
    signature,
    code: input.code,
    kind: input.kind,
    severity: input.severity,
    blocking: input.blocking,
    title: input.title,
    detail: input.detail,
    whyItHappened: '该项由版本化质量门槛与当前质量看板快照直接比较得出。',
    howToFix: input.howToFix,
    ...(input.scope.volumeId ? { volumeId: input.scope.volumeId } : {}),
    chapterNums: [...input.scope.chapterNums],
    evidenceRefs: dedupeStrings(input.evidenceRefs),
    suggestedActions: [],
  }
}

function appliesToScope(risk: QualityDashboardRiskItem, scope: AgentQualityScope): boolean {
  if (scope.type === 'novel') return true
  if (scope.type === 'volume') {
    return risk.volumeId === scope.volumeId
      || (risk.chapterNums.length > 0 && risk.chapterNums.some((chapterNum) => scope.chapterNums.includes(chapterNum)))
  }
  return risk.chapterNums.includes(scope.chapterNums[0] || -1)
}

function collectScopeRisks(dashboard: AgentQualityDashboardSource, scope: AgentQualityScope): QualityDashboardRiskItem[] {
  const candidates = [
    ...dashboard.novelQualityMetrics.topRisks,
    ...dashboard.volumeQualityMetrics.flatMap((volume) => volume.topRisks),
  ].filter((risk) => appliesToScope(risk, scope))
  const seen = new Set<string>()
  return candidates.filter((risk) => {
    const signature = findingSignature(risk)
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  })
}

function scopeMetrics(
  dashboard: AgentQualityDashboardSource,
  scope: AgentQualityScope,
): AgentQualityMetricSnapshot {
  const selectedChapters = scope.type === 'novel'
    ? dashboard.chapterDetails
    : dashboard.chapterDetails.filter((chapter) => scope.chapterNums.includes(chapter.chapterNum))
  const scoredChapters = selectedChapters.filter((entry) => entry.overallScore > 0)
  const volume = scope.type === 'volume'
    ? dashboard.volumeQualityMetrics.find((entry) => entry.volumeId === scope.volumeId)
    : undefined
  const chapter = scope.type === 'chapter' ? selectedChapters[0] : undefined
  const totalChapterCount = scope.type === 'novel'
    ? dashboard.novelQualityMetrics.totalChapterCount
    : scope.type === 'volume'
      ? volume?.chapterCount || scope.chapterNums.length
      : 1
  const analyzedChapterCount = scope.type === 'novel'
    ? dashboard.novelQualityMetrics.analyzedChapterCount
    : scope.type === 'volume'
      ? volume?.analyzedChapterCount || scoredChapters.length
      : chapter && chapter.overallScore > 0 ? 1 : 0
  const coverageRate = totalChapterCount > 0 ? clampScore((analyzedChapterCount / totalChapterCount) * 100) : 0
  const averageOverallScore = scoredChapters.length > 0
    ? clampScore(scoredChapters.reduce((sum, entry) => sum + entry.overallScore, 0) / scoredChapters.length)
    : scope.type === 'novel' ? clampScore(dashboard.averageOverallScore) : 0
  const averageAiLikeRate = scoredChapters.length > 0
    ? clampScore(scoredChapters.reduce((sum, entry) => sum + entry.aiLikeRate, 0) / scoredChapters.length)
    : scope.type === 'novel' ? clampScore(dashboard.averageAiLikeRate) : 0
  const scopeRisks = collectScopeRisks(dashboard, scope)
  return {
    healthScore: scope.type === 'novel'
      ? clampScore(dashboard.novelQualityMetrics.healthScore)
      : scope.type === 'volume'
        ? clampScore(volume?.healthScore || averageOverallScore)
        : averageOverallScore,
    averageOverallScore,
    averageAiLikeRate,
    coverageRate,
    totalChapterCount,
    analyzedChapterCount,
    criticalRiskCount: scope.type === 'novel'
      ? Math.max(0, dashboard.novelQualityMetrics.criticalRiskCount || 0)
      : scopeRisks.filter((risk) => risk.severity === 'critical').length,
    warningRiskCount: scope.type === 'novel'
      ? Math.max(0, dashboard.novelQualityMetrics.warningRiskCount || 0)
      : scopeRisks.filter((risk) => risk.severity === 'warning').length,
    riskyChapterGateCount: dashboard.chapterGateSummary.riskyCount + dashboard.chapterGateSummary.unstableCount,
    productionReadinessStatus: dashboard.productionReadiness.status,
    highRiskAiRecurrenceCount: dashboard.antiAiRecurrence.highRiskRuleCount,
    feedbackPauseSuggestedCount: dashboard.feedbackRecurrence.pauseSuggestedIssueCount,
  }
}

function sortFindings(left: AgentQualityFinding, right: AgentQualityFinding): number {
  return Number(right.blocking) - Number(left.blocking)
    || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || (left.chapterNums[0] || Number.MAX_SAFE_INTEGER) - (right.chapterNums[0] || Number.MAX_SAFE_INTEGER)
    || left.title.localeCompare(right.title)
}

export function buildAgentQualityReport(input: {
  requestFingerprint: string
  profile: AgentQualityProfile
  scope: AgentQualityScope
  dashboard: AgentQualityDashboardSource
  contextVersion: number
  baselineReportArtifactId?: string | null
  maxFindings: number
  createdAt?: string
}): AgentQualityReportContent {
  const profile = AGENT_QUALITY_PROFILES[input.profile]
  const metrics = scopeMetrics(input.dashboard, input.scope)
  const findings = collectScopeRisks(input.dashboard, input.scope).map((risk) => riskToFinding(risk, profile))
  const representedCriticalRiskCount = findings.filter((finding) => finding.severity === 'critical').length

  if (profile.blockCriticalRisks && metrics.criticalRiskCount > representedCriticalRiskCount) {
    findings.push(syntheticFinding({
      code: 'critical_risk_inventory',
      kind: 'production_readiness',
      severity: 'critical',
      blocking: true,
      title: '仍有未展开的严重质量风险',
      detail: `当前范围共有 ${metrics.criticalRiskCount} 个严重风险，本次紧凑风险清单只展开 ${representedCriticalRiskCount} 个。`,
      howToFix: '读取完整质量看板与报告工件，逐项关闭严重风险后重新评审。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:critical-risk-count'],
    }))
  }

  if (metrics.totalChapterCount === 0) {
    findings.push(syntheticFinding({
      code: 'chapter_presence',
      kind: 'coverage',
      severity: 'critical',
      blocking: true,
      title: '评审范围没有章节',
      detail: '当前范围没有可供质量评审的章节正文。',
      howToFix: '先生成并保存章节，再运行质量评审。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:chapter-count'],
    }))
  } else if (metrics.coverageRate < profile.minimumCoverageRate) {
    findings.push(syntheticFinding({
      code: 'quality_coverage',
      kind: 'coverage',
      severity: 'critical',
      blocking: true,
      title: '质量评分覆盖不足',
      detail: `当前覆盖率 ${metrics.coverageRate}%，低于 ${profile.minimumCoverageRate}% 门槛（${metrics.analyzedChapterCount}/${metrics.totalChapterCount} 章）。`,
      howToFix: '补跑缺失章节的 AI 检查与发布门禁，覆盖完整后重新评审。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:coverage'],
    }))
  }

  if (metrics.healthScore < profile.minimumHealthScore) {
    findings.push(syntheticFinding({
      code: 'health_score_below_profile',
      kind: 'score',
      severity: input.profile === 'recommendation_ready_v1' ? 'critical' : 'warning',
      blocking: input.profile === 'recommendation_ready_v1',
      title: '作品健康分未达到档案门槛',
      detail: `健康分 ${metrics.healthScore}，门槛 ${profile.minimumHealthScore}。`,
      howToFix: '按严重风险和低分修复指标逐项处理，不要只做语言润色。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:health-score'],
    }))
  }
  if (metrics.averageOverallScore < profile.minimumAverageScore) {
    findings.push(syntheticFinding({
      code: 'average_score_below_profile',
      kind: 'score',
      severity: input.profile === 'recommendation_ready_v1' ? 'critical' : 'warning',
      blocking: input.profile === 'recommendation_ready_v1',
      title: '章节均分未达到档案门槛',
      detail: `章节均分 ${metrics.averageOverallScore}，门槛 ${profile.minimumAverageScore}。`,
      howToFix: '优先修复低分章节的因果、承诺兑现、人物行为与节奏问题后复评。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:average-score'],
    }))
  }
  if (metrics.averageAiLikeRate > profile.maximumAverageAiLikeRate) {
    findings.push(syntheticFinding({
      code: 'ai_like_rate_above_profile',
      kind: 'long_window_homogenization',
      severity: input.profile === 'recommendation_ready_v1' ? 'critical' : 'warning',
      blocking: input.profile === 'recommendation_ready_v1',
      title: 'AI 痕迹风险高于档案上限',
      detail: `平均 AI 痕迹风险 ${metrics.averageAiLikeRate}，上限 ${profile.maximumAverageAiLikeRate}。该指标只用于内部风险定位，不代表任何外部检测结论。`,
      howToFix: '根据复现规则、语言漂移和证据章节做定点重写，并用对比评审防止剧情回归。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:ai-like-rate', 'quality-dashboard:anti-ai-recurrence'],
    }))
  }

  if (input.scope.type === 'novel' && input.dashboard.productionReadiness.status === 'blocked') {
    input.dashboard.productionReadiness.blockers.forEach((blocker, index) => {
      findings.push(syntheticFinding({
        code: `production_readiness_blocker_${index + 1}`,
        kind: 'production_readiness',
        severity: 'critical',
        blocking: profile.requireProductionReady,
        title: '生产就绪门禁未通过',
        detail: blocker,
        howToFix: input.dashboard.productionReadiness.suggestedActions[index] || '完成对应门禁修复后重新运行评审。',
        scope: input.scope,
        evidenceRefs: ['quality-dashboard:production-readiness'],
      }))
    })
  }
  if (input.scope.type === 'novel' && profile.blockRiskyChapterGates && metrics.riskyChapterGateCount > 0) {
    findings.push(syntheticFinding({
      code: 'risky_chapter_gates',
      kind: 'chapter_gate',
      severity: 'critical',
      blocking: true,
      title: '仍有高风险章节门禁',
      detail: `高风险或不稳定门禁共 ${metrics.riskyChapterGateCount} 个。`,
      howToFix: '逐章关闭高风险门禁，并确认最新上下文版本已有重新检查。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:chapter-gate-summary'],
    }))
  }
  if (input.scope.type === 'novel' && profile.blockHighRiskAiRecurrence && metrics.highRiskAiRecurrenceCount > 0) {
    findings.push(syntheticFinding({
      code: 'high_risk_ai_recurrence',
      kind: 'long_window_homogenization',
      severity: 'critical',
      blocking: true,
      title: '高风险表达模式持续复现',
      detail: `仍有 ${metrics.highRiskAiRecurrenceCount} 个高风险复现规则。`,
      howToFix: '跨章节定位重复模式，按规则逐项验收，避免只替换同义词。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:anti-ai-recurrence'],
    }))
  }
  if (input.scope.type === 'novel' && profile.blockFeedbackPauseSignals && metrics.feedbackPauseSuggestedCount > 0) {
    findings.push(syntheticFinding({
      code: 'feedback_pause_signals',
      kind: 'feedback_recurrence',
      severity: 'critical',
      blocking: true,
      title: '重复审校问题建议暂停生产',
      detail: `有 ${metrics.feedbackPauseSuggestedCount} 类问题已达到暂停建议阈值。`,
      howToFix: '先关闭重复问题并验证不再复现，再继续批量生成或申请评估。',
      scope: input.scope,
      evidenceRefs: ['quality-dashboard:feedback-recurrence'],
    }))
  }

  const uniqueFindings = [...new Map(findings.map((finding) => [finding.signature, finding])).values()]
    .sort(sortFindings)
  const limitedFindings = uniqueFindings.slice(0, Math.max(1, Math.min(input.maxFindings, 50)))
  const omittedFindingCount = Math.max(0, uniqueFindings.length - limitedFindings.length)
  const blockers = dedupeStrings(limitedFindings.filter((finding) => finding.blocking).map((finding) => finding.title))
  const warnings = dedupeStrings([
    ...(input.scope.type === 'novel' ? input.dashboard.productionReadiness.warnings : []),
    omittedFindingCount > 0 ? `还有 ${omittedFindingCount} 条较低优先级 Finding 未包含在本次返回中；可提高 maxFindings 后使用新幂等键重跑。` : '',
  ])
  const score = clampScore(
    (metrics.healthScore * 0.45)
      + (metrics.averageOverallScore * 0.35)
      + (metrics.coverageRate * 0.2)
      - Math.max(0, metrics.averageAiLikeRate - profile.maximumAverageAiLikeRate) * 0.2,
  )
  const confidencePenalty = Math.ceil((100 - metrics.coverageRate) / 5)
    + Math.min(10, warnings.length + limitedFindings.filter((finding) => finding.severity === 'warning').length)
  const confidenceLowerBound = clampScore(score - confidencePenalty)
  const status = blockers.length > 0
    ? 'blocked'
    : limitedFindings.some((finding) => finding.severity !== 'info') || warnings.length > 0
      ? 'needs_revision'
      : 'passed'

  return {
    schemaVersion: 'agent-quality-report-v1',
    requestFingerprint: input.requestFingerprint,
    profile,
    scope: input.scope,
    status,
    score,
    confidenceLowerBound,
    coverageRate: metrics.coverageRate,
    summary: status === 'passed'
      ? `${input.scope.label}通过 ${profile.profile} 质量档案。`
      : `${input.scope.label}评审为${status === 'blocked' ? '阻塞' : '需修订'}：${blockers.length} 个硬阻塞，${limitedFindings.length} 条证据化 Finding。`,
    blockers,
    warnings,
    findings: limitedFindings,
    metrics,
    repairMetrics: input.dashboard.repairMetrics,
    contextVersion: input.contextVersion,
    baselineReportArtifactId: input.baselineReportArtifactId || null,
    createdAt: input.createdAt || new Date().toISOString(),
  }
}
