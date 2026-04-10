import type { ConsistencyIssue, QualityDashboardData, RevisionTask, StoryArcProgressAlert } from '../../../types'

export function getRevisionSeverityColor(severity: RevisionTask['severity']) {
  if (severity === 'high') return 'error'
  if (severity === 'low') return 'default'
  return 'gold'
}

export function getRevisionSeverityLabel(severity: RevisionTask['severity']) {
  if (severity === 'high') return '高优先'
  if (severity === 'low') return '低优先'
  return '中优先'
}

export function getConsistencySeverityColor(severity: ConsistencyIssue['severity']) {
  return getRevisionSeverityColor(severity)
}

export function getConsistencySeverityLabel(severity: ConsistencyIssue['severity']) {
  return getRevisionSeverityLabel(severity)
}

export function getStoryPacingSeverityColor(
  severity: QualityDashboardData['storyPacingAlerts'][number]['severity'],
) {
  return severity === 'blocker' ? 'error' : 'warning'
}

export function getStoryPacingSeverityLabel(
  severity: QualityDashboardData['storyPacingAlerts'][number]['severity'],
) {
  return severity === 'blocker' ? '阻塞' : '中优先'
}

export function getStoryArcSeverityColor(severity: StoryArcProgressAlert['severity']) {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function getStoryArcSeverityLabel(severity: StoryArcProgressAlert['severity']) {
  if (severity === 'critical') return '高优先'
  if (severity === 'warning') return '中优先'
  return '低优先'
}

export function getQualityRiskSeverityColor(
  severity: QualityDashboardData['novelQualityMetrics']['topRisks'][number]['severity'],
) {
  if (severity === 'critical') return 'error'
  if (severity === 'warning') return 'warning'
  return 'default'
}

export function getQualityRiskSeverityLabel(
  severity: QualityDashboardData['novelQualityMetrics']['topRisks'][number]['severity'],
) {
  if (severity === 'critical') return '高优先'
  if (severity === 'warning') return '中优先'
  return '低优先'
}
