import type {
  QualityDashboardData,
  QualityDashboardRiskItem,
  QualityRepairMetricKey,
} from '../../src/types'

function clampHealthScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function buildRepairMetricSummary(input: {
  metricKey: QualityRepairMetricKey
  label: string
  score: number
  summary: string
  repairRiskItems: QualityDashboardRiskItem[]
}): QualityDashboardData['repairMetrics'][number] {
  const metricRisks = input.repairRiskItems.filter((item) => item.metricKey === input.metricKey)
  return {
    key: input.metricKey,
    label: input.label,
    score: clampHealthScore(input.score),
    summary: input.summary,
    riskCount: metricRisks.length,
    focusLabels: metricRisks.slice(0, 3).map((item) => item.title),
  }
}

export function buildRepairActionSummary(
  repairRiskItems: QualityDashboardRiskItem[],
): QualityDashboardData['repairActionSummary'] {
  const actions = repairRiskItems.flatMap((item) => item.suggestedActions)
  return {
    actionableRiskCount: repairRiskItems.filter((item) => item.suggestedActions.length > 0).length,
    taskActionCount: actions.filter((action) => Boolean(action.taskDraft)).length,
    directExecutableActionCount: actions.filter((action) => action.safeToExecute).length,
    allowDeviationCount: actions.filter((action) => action.actionType === 'allow_deviation').length,
    topPriorityActions: repairRiskItems
      .flatMap((item) => item.suggestedActions.slice(0, 1).map((action) => action.label))
      .slice(0, 4),
  }
}
