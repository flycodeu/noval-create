import type { QualityDashboardData } from '../../src/types'
import {
  resolveRecommendationWorkState,
  type RecommendationPreflightEvidence,
} from '../../src/shared/recommendation-governance'

export interface RecommendationPreflightSourceSnapshot {
  novel: { status: string }
  chapters: Array<{ content: string }>
}

export interface RecommendationPreflightAssessment {
  status: 'ready' | 'blocked'
  score: number
  confidenceLowerBound: number
  coverageRate: number
  blockers: string[]
  warnings: string[]
  evidence: RecommendationPreflightEvidence[]
}

export const RECOMMENDATION_PREFLIGHT_THRESHOLDS = Object.freeze({
  score: 82,
  confidenceLowerBound: 78,
  coverageRate: 100,
})

const PLACEHOLDER_PATTERN = /(?:^|\n)\s*(?:TODO|TBD|待补(?:充|写)?|占位符|【待补】|<placeholder>)\s*(?:\n|$)/imu
const PROCESS_LEAK_PATTERN = /(?:作为(?:一个)?AI(?:语言模型)?|根据(?:你的|您的)要求[，,:：]|以下是(?:为您|根据要求)生成的)/u

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)))
}

function dedupeMessages(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function evidence(
  code: string,
  label: string,
  status: RecommendationPreflightEvidence['status'],
  value: RecommendationPreflightEvidence['value'],
  threshold: RecommendationPreflightEvidence['threshold'],
  detail: string,
): RecommendationPreflightEvidence {
  return { code, label, status, value, ...(threshold === undefined ? {} : { threshold }), detail }
}

export function assessRecommendationPreflight(
  snapshot: RecommendationPreflightSourceSnapshot,
  dashboard: QualityDashboardData,
): RecommendationPreflightAssessment {
  const chapterCount = snapshot.chapters.length
  const emptyContentCount = snapshot.chapters.filter((chapter) => !chapter.content.trim()).length
  const placeholderCount = snapshot.chapters.filter((chapter) => PLACEHOLDER_PATTERN.test(chapter.content)).length
  const processLeakCount = snapshot.chapters.filter((chapter) => PROCESS_LEAK_PATTERN.test(chapter.content)).length
  const analyzedCount = Math.min(chapterCount, Math.max(0, dashboard.totalChaptersScored || 0))
  const coverageRate = chapterCount > 0 ? clampScore((analyzedCount / chapterCount) * 100) : 0
  const healthScore = clampScore(dashboard.novelQualityMetrics.healthScore)
  const averageScore = clampScore(dashboard.averageOverallScore)
  const score = analyzedCount > 0
    ? clampScore((healthScore * 0.55) + (averageScore * 0.45))
    : 0
  const warningPenalty = Math.min(8, Math.ceil((dashboard.productionReadiness.warnings.length + dashboard.novelQualityMetrics.warningRiskCount) / 3))
  const confidencePenalty = 5 + warningPenalty + (coverageRate < 100 ? Math.ceil((100 - coverageRate) / 4) : 0)
  const confidenceLowerBound = clampScore(score - confidencePenalty)
  const riskyGateCount = dashboard.chapterGateSummary.riskyCount + dashboard.chapterGateSummary.unstableCount
  const completed = resolveRecommendationWorkState(snapshot.novel.status) === 'completed'
  const endgameDebtCount = dashboard.novelQualityMetrics.endgameOverdueCount + dashboard.novelQualityMetrics.endgameUnboundCount

  const blockers: string[] = []
  const warnings: string[] = [...dashboard.productionReadiness.warnings]
  if (chapterCount === 0) blockers.push('候选作品没有任何章节，不能进入推荐评估。')
  if (emptyContentCount > 0) blockers.push(`有 ${emptyContentCount} 章缺少正文。`)
  if (placeholderCount > 0) blockers.push(`有 ${placeholderCount} 章包含显式占位标记。`)
  if (processLeakCount > 0) blockers.push(`有 ${processLeakCount} 章包含模型过程话术。`)
  if (coverageRate < RECOMMENDATION_PREFLIGHT_THRESHOLDS.coverageRate) blockers.push(`质量评分覆盖率为 ${coverageRate}%，未达到 100%。`)
  if (dashboard.productionReadiness.blockers.length > 0) blockers.push(...dashboard.productionReadiness.blockers)
  if (dashboard.novelQualityMetrics.criticalRiskCount > 0) blockers.push(`质量看板仍有 ${dashboard.novelQualityMetrics.criticalRiskCount} 个严重风险。`)
  if (riskyGateCount > 0) blockers.push(`章节门禁仍有 ${riskyGateCount} 个高风险或不稳定章节。`)
  if (completed && endgameDebtCount > 0) blockers.push(`完结作品仍有 ${endgameDebtCount} 项逾期或未绑定的终局债务。`)
  if (score < RECOMMENDATION_PREFLIGHT_THRESHOLDS.score) blockers.push(`综合质量分 ${score} 低于预检阈值 ${RECOMMENDATION_PREFLIGHT_THRESHOLDS.score}。`)
  if (confidenceLowerBound < RECOMMENDATION_PREFLIGHT_THRESHOLDS.confidenceLowerBound) blockers.push(`置信下界 ${confidenceLowerBound} 低于预检阈值 ${RECOMMENDATION_PREFLIGHT_THRESHOLDS.confidenceLowerBound}。`)
  if (dashboard.novelQualityMetrics.warningRiskCount > 0) warnings.push(`质量看板仍有 ${dashboard.novelQualityMetrics.warningRiskCount} 个警告风险。`)
  if (dashboard.antiAiRecurrence.highRiskRuleCount > 0) warnings.push(`存在 ${dashboard.antiAiRecurrence.highRiskRuleCount} 个高风险 AI 痕迹复现规则。`)
  if (dashboard.feedbackRecurrence.pauseSuggestedIssueCount > 0) warnings.push(`有 ${dashboard.feedbackRecurrence.pauseSuggestedIssueCount} 个反馈复现问题建议暂停生产。`)

  const evidenceList: RecommendationPreflightEvidence[] = [
    evidence('chapter_presence', '章节存在性', chapterCount > 0 ? 'pass' : 'fail', chapterCount, 1, chapterCount > 0 ? '已发现候选章节。' : '缺少候选章节。'),
    evidence('content_completeness', '正文完整性', emptyContentCount === 0 ? 'pass' : 'fail', emptyContentCount, 0, emptyContentCount === 0 ? '所有章节均有正文。' : '存在空正文章节。'),
    evidence('placeholder_scan', '占位标记扫描', placeholderCount === 0 ? 'pass' : 'fail', placeholderCount, 0, placeholderCount === 0 ? '未发现显式占位标记。' : '需要清理占位标记。'),
    evidence('process_leak_scan', '模型过程话术扫描', processLeakCount === 0 ? 'pass' : 'fail', processLeakCount, 0, processLeakCount === 0 ? '未发现模型过程话术。' : '需要清理模型过程话术。'),
    evidence('quality_coverage', '质量评分覆盖率', coverageRate === 100 ? 'pass' : 'fail', coverageRate, 100, `已评分 ${analyzedCount}/${chapterCount} 章。`),
    evidence('quality_score', '综合质量分', score >= RECOMMENDATION_PREFLIGHT_THRESHOLDS.score ? 'pass' : 'fail', score, RECOMMENDATION_PREFLIGHT_THRESHOLDS.score, `健康分 ${healthScore}，章节均分 ${averageScore}。`),
    evidence('confidence_lower_bound', '置信下界', confidenceLowerBound >= RECOMMENDATION_PREFLIGHT_THRESHOLDS.confidenceLowerBound ? 'pass' : 'fail', confidenceLowerBound, RECOMMENDATION_PREFLIGHT_THRESHOLDS.confidenceLowerBound, `基于覆盖缺口和 ${warnings.length} 项警告进行保守折减。`),
    evidence('production_readiness', '生产就绪门禁', dashboard.productionReadiness.blockers.length === 0 ? 'pass' : 'fail', dashboard.productionReadiness.blockers.length, 0, dashboard.productionReadiness.summary),
    evidence('critical_risks', '严重质量风险', dashboard.novelQualityMetrics.criticalRiskCount === 0 ? 'pass' : 'fail', dashboard.novelQualityMetrics.criticalRiskCount, 0, '严重风险必须在外部评估前清零。'),
    evidence('chapter_gate_risk', '章节门禁风险', riskyGateCount === 0 ? 'pass' : 'fail', riskyGateCount, 0, '高风险和不稳定章节必须在外部评估前清零。'),
    evidence('completed_endgame_debt', '完结终局债务', !completed || endgameDebtCount === 0 ? 'pass' : 'fail', endgameDebtCount, 0, completed ? '完结作品不得遗留终局债务。' : '连载作品仅记录该指标，不作为完结门禁。'),
  ]

  const normalizedBlockers = dedupeMessages(blockers)
  return {
    status: normalizedBlockers.length === 0 ? 'ready' : 'blocked',
    score,
    confidenceLowerBound,
    coverageRate,
    blockers: normalizedBlockers,
    warnings: dedupeMessages(warnings),
    evidence: evidenceList,
  }
}
