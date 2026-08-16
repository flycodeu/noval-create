import type {
  QualityDashboardData,
  QualityDashboardRiskItem,
  QualityDashboardRiskKind,
  QualityDashboardRiskSeverity,
  StoryArcProgressAlert,
  VolumeChapterFunctionEntry,
  VolumeLanguageDriftEntry,
  VolumeStoryDynamicsEntry,
} from '../../src/types'

interface VolumeRange {
  volumeId: number
  volumeName: string
  chapterStart: number
  chapterEnd: number
}

interface ForeshadowCounts {
  dueSoon: number
  overdue: number
}

interface EndgameCounts {
  overdue: number
  unbound: number
}

type RecallEntry = QualityDashboardData['volumeRecallDiagnostics'][number]
type WorldStateEntry = QualityDashboardData['volumeWorldStateStability'][number]
type FeedbackEntry = QualityDashboardData['feedbackRecurrence']['volumeEntries'][number]

type RiskFactory = (
  kind: QualityDashboardRiskKind,
  severity: QualityDashboardRiskSeverity,
  title: string,
  detail: string,
  chapterNums: number[],
  volumeId?: number,
) => QualityDashboardRiskItem

export interface VolumeTopRiskInput {
  volumeRange: VolumeRange
  languageEntry?: VolumeLanguageDriftEntry
  storyEntry?: VolumeStoryDynamicsEntry
  functionEntry?: VolumeChapterFunctionEntry
  arcAlerts: StoryArcProgressAlert[]
  foreshadowCounts: ForeshadowCounts
  endgameCounts: EndgameCounts
  recallEntry?: RecallEntry
  worldEntry?: WorldStateEntry
  feedbackEntry?: FeedbackEntry
  styleComplianceAlerts: Array<{
    chapterNum: number
    styleCompliance: { status: 'pass' | 'warning' | 'rewrite' }
  }>
  createRisk: RiskFactory
}

function severityRank(severity: QualityDashboardRiskSeverity): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function sortRisks(left: QualityDashboardRiskItem, right: QualityDashboardRiskItem): number {
  const leftMax = left.chapterNums.at(-1) || 0
  const rightMax = right.chapterNums.at(-1) || 0
  return severityRank(right.severity) - severityRank(left.severity)
    || rightMax - leftMax
    || left.title.localeCompare(right.title)
}

function rangeChapters(range: VolumeRange): number[] {
  return [range.chapterStart, range.chapterEnd]
}

export function buildVolumeTopRisks(input: VolumeTopRiskInput): QualityDashboardRiskItem[] {
  const { volumeRange, createRisk } = input
  const chapters = rangeChapters(volumeRange)
  const risks: QualityDashboardRiskItem[] = []
  input.languageEntry?.topWorseningMetrics.slice(0, 2).forEach((metric) => {
    risks.push(createRisk(
      'language_drift',
      metric.delta >= 10 || metric.latestValue >= 60 ? 'critical' : 'warning',
      `${volumeRange.volumeName} 语言退化`,
      `${metric.label} 最近恶化 ${metric.delta > 0 ? `+${metric.delta}` : metric.delta}，当前值 ${metric.latestValue}。`,
      chapters,
      volumeRange.volumeId,
    ))
  })
  input.storyEntry?.alerts.forEach((alert) => risks.push(createRisk(
    'story_dynamics',
    alert.severity === 'blocker' ? 'critical' : 'warning',
    alert.title,
    alert.detail,
    alert.chapterNums,
    volumeRange.volumeId,
  )))
  input.functionEntry?.alerts.forEach((alert) => risks.push(createRisk(
    'chapter_function',
    alert.severity === 'blocker' ? 'critical' : 'warning',
    alert.title,
    alert.detail,
    alert.chapterNums,
    volumeRange.volumeId,
  )))
  input.arcAlerts.forEach((alert) => risks.push(createRisk(
    'story_arc',
    alert.severity,
    alert.title,
    alert.detail,
    alert.chapterNum ? [alert.chapterNum] : chapters,
    volumeRange.volumeId,
  )))

  if (input.foreshadowCounts.overdue > 0) {
    risks.push(createRisk(
      'foreshadow_debt',
      'critical',
      `${volumeRange.volumeName} 有超期伏笔`,
      `本卷有 ${input.foreshadowCounts.overdue} 条伏笔已超过目标回收章位，建议优先兑现或回收。`,
      chapters,
      volumeRange.volumeId,
    ))
  } else if (input.foreshadowCounts.dueSoon > 0) {
    risks.push(createRisk(
      'foreshadow_debt',
      'warning',
      `${volumeRange.volumeName} 伏笔接近到期`,
      `本卷有 ${input.foreshadowCounts.dueSoon} 条伏笔接近目标回收章位，建议尽快安排兑现。`,
      chapters,
      volumeRange.volumeId,
    ))
  }

  if (input.endgameCounts.overdue > 0) {
    risks.push(createRisk(
      'endgame_debt',
      'critical',
      `${volumeRange.volumeName} 终局承诺失管`,
      `本卷关联的终局承诺中有 ${input.endgameCounts.overdue} 条已过期，另有 ${input.endgameCounts.unbound} 条仍未进入执行链。`,
      chapters,
      volumeRange.volumeId,
    ))
  } else if (input.endgameCounts.unbound > 0) {
    risks.push(createRisk(
      'endgame_debt',
      'warning',
      `${volumeRange.volumeName} 存在未绑定终局承诺`,
      `本卷有 ${input.endgameCounts.unbound} 条终局承诺尚未被卷级设计、章节合同、场景合同或伏笔账本服务。`,
      chapters,
      volumeRange.volumeId,
    ))
  }

  if ((input.recallEntry?.staleRecallCount || 0) > 0) {
    risks.push(createRisk(
      'recall',
      (input.recallEntry?.staleRecallRate || 0) >= 35 ? 'critical' : 'warning',
      `${volumeRange.volumeName} 存在过期召回`,
      `本卷识别到 ${input.recallEntry?.staleRecallCount || 0} 条过期召回，平均过期率 ${input.recallEntry?.staleRecallRate || 0}%。`,
      chapters,
      volumeRange.volumeId,
    ))
  }
  if (input.worldEntry && (input.worldEntry.conflictAlertCount > 0 || input.worldEntry.warningCount > 0)) {
    risks.push(createRisk(
      'world_state',
      input.worldEntry.conflictAlertCount > 0 ? 'critical' : 'warning',
      `${volumeRange.volumeName} 状态稳定性波动`,
      `本卷状态冲突 ${input.worldEntry.conflictAlertCount} 次，预警 ${input.worldEntry.warningCount} 次。`,
      chapters,
      volumeRange.volumeId,
    ))
  }
  if ((input.feedbackEntry?.highRiskIssueCount || 0) > 0) {
    risks.push(createRisk(
      'feedback_recurrence',
      (input.feedbackEntry?.pauseSuggestedIssueCount || 0) > 0 ? 'critical' : 'warning',
      `${volumeRange.volumeName} 审校复现升温`,
      `本卷已有 ${input.feedbackEntry?.highRiskIssueCount || 0} 类问题在 5 章窗口内高风险复现。`,
      chapters,
      volumeRange.volumeId,
    ))
  }
  if (input.styleComplianceAlerts.length > 0) {
    const rewriteCount = input.styleComplianceAlerts.filter((entry) => entry.styleCompliance.status === 'rewrite').length
    const warningCount = input.styleComplianceAlerts.filter((entry) => entry.styleCompliance.status === 'warning').length
    risks.push(createRisk(
      'style_compliance',
      rewriteCount > 0 ? 'critical' : 'warning',
      `${volumeRange.volumeName} 文风硬约束漂移`,
      `本卷有 ${rewriteCount} 章达到重写阈值，${warningCount} 章出现预警。`,
      input.styleComplianceAlerts.map((entry) => entry.chapterNum),
      volumeRange.volumeId,
    ))
  }
  return risks.sort(sortRisks).slice(0, 6)
}
