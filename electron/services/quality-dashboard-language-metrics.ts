import type {
  LanguageDriftMetricSnapshot,
  LanguageDriftMetrics,
  LanguageDriftTrendStatus,
  LanguageDriftTrendSummary,
  QualityDashboardData,
} from '../../src/types'

export type LanguageDriftMetricKey = keyof LanguageDriftMetrics
export type LanguageDriftSeries = QualityDashboardData['languageDriftTrends']

export const LANGUAGE_DRIFT_METRICS: Array<{ key: LanguageDriftMetricKey; label: string }> = [
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

export const RECENT_LANGUAGE_DRIFT_WINDOW = 20
const LANGUAGE_DRIFT_DELTA_THRESHOLD = 5

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

export function emptyLanguageDrift(): LanguageDriftMetrics {
  return Object.fromEntries(LANGUAGE_DRIFT_METRICS.map(({ key }) => [key, 0])) as unknown as LanguageDriftMetrics
}

export function emptyLanguageDriftSeries(): LanguageDriftSeries {
  return Object.fromEntries(LANGUAGE_DRIFT_METRICS.map(({ key }) => [key, []])) as unknown as LanguageDriftSeries
}

export function normalizeLanguageDrift(value: unknown): LanguageDriftMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return Object.fromEntries(LANGUAGE_DRIFT_METRICS.map(({ key }) => {
    const metric = record[key]
    return [key, typeof metric === 'number' && Number.isFinite(metric) ? metric : 0]
  })) as unknown as LanguageDriftMetrics
}

export function pushLanguageDriftMetrics(
  series: LanguageDriftSeries,
  chapterNum: number,
  metrics: LanguageDriftMetrics,
): void {
  for (const { key } of LANGUAGE_DRIFT_METRICS) {
    series[key].push({ chapterNum, value: metrics[key] })
  }
}

export function averageLanguageDrift(metricsList: LanguageDriftMetrics[]): LanguageDriftMetrics {
  if (metricsList.length === 0) return emptyLanguageDrift()
  const totals = emptyLanguageDrift()
  for (const metrics of metricsList) {
    for (const { key } of LANGUAGE_DRIFT_METRICS) totals[key] += metrics[key] || 0
  }
  return Object.fromEntries(LANGUAGE_DRIFT_METRICS.map(({ key }) => [
    key,
    roundMetric(totals[key] / metricsList.length),
  ])) as unknown as LanguageDriftMetrics
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

export function summarizeTrend(
  metric: LanguageDriftMetricKey,
  label: string,
  points: Array<{ chapterNum: number; value: number }>,
): LanguageDriftTrendSummary {
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

export function sortTrendSummaries(left: LanguageDriftTrendSummary, right: LanguageDriftTrendSummary): number {
  return right.delta - left.delta || right.latestValue - left.latestValue || left.label.localeCompare(right.label)
}

export function rankLanguageDriftMetrics(metrics: LanguageDriftMetrics, limit = 3): LanguageDriftMetricSnapshot[] {
  return LANGUAGE_DRIFT_METRICS
    .map(({ key, label }) => ({ metric: key, label, value: roundMetric(metrics[key]) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label))
    .slice(0, limit)
}
