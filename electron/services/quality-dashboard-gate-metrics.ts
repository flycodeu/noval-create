import type { QualityDashboardData, ChapterGateHistoryEntry } from '../../src/types'
import {
  buildChapterGateDriftAlert,
  getChapterGatePrimaryDimensions,
  getChapterGateScoreBand,
  normalizeChapterGateScoreBreakdown,
  safeParseChapterGateScoreBreakdown,
  safeParseStringArray,
} from './chapter-gate-utils'

type GateRunRow = {
  id: number
  novelId: number
  chapterId: number
  chapterNum: number | null
  gateLevel: string | null
  ready: number
  summary: string | null
  rewriteCount: number | null
  blockerCount: number | null
  warningCount: number | null
  generatedTaskCount: number | null
  topIssueKeysJson: string | null
  scoreBreakdownJson: string | null
  createdAt: string | null
}

function sortHistory(left: ChapterGateHistoryEntry, right: ChapterGateHistoryEntry): number {
  const leftTime = Date.parse(left.createdAt || '')
  const rightTime = Date.parse(right.createdAt || '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return rightTime - leftTime
  return right.id - left.id
}

function mapGateRun(row: GateRunRow): ChapterGateHistoryEntry {
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

export function deriveChapterGateMetrics(gateRuns: readonly GateRunRow[]) {
  const chapterGateHistoryByChapterId = gateRuns
    .map(mapGateRun)
    .reduce<Map<number, ChapterGateHistoryEntry[]>>((result, entry) => {
      const history = result.get(entry.chapterId) || []
      history.push(entry)
      history.sort(sortHistory)
      result.set(entry.chapterId, history)
      return result
    }, new Map())
  const latestChapterGateEntries = [...chapterGateHistoryByChapterId.values()]
    .map((history) => history[0])
    .filter((entry): entry is ChapterGateHistoryEntry => Boolean(entry))
    .sort((left, right) => left.chapterNum - right.chapterNum || sortHistory(left, right))
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
  const chapterGateDriftAlerts: QualityDashboardData['chapterGateDriftAlerts'] = [...chapterGateHistoryByChapterId.values()]
    .filter((history) => history.length > 1)
    .map((history) => buildChapterGateDriftAlert(history[0], history[1]))
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || '') || right.chapterNum - left.chapterNum)
  const chapterGateSummary = latestChapterGateEntries.reduce<QualityDashboardData['chapterGateSummary']>((result, entry) => {
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
    latestLevelCounts: { pass: 0, warning: 0, blocker: 0, rewrite: 0 },
  })
  if (chapterGateSummary.coveredChapterCount > 0) {
    chapterGateSummary.averageTotalScore = Math.round((chapterGateSummary.averageTotalScore / chapterGateSummary.coveredChapterCount) * 100) / 100
  }
  return {
    chapterGateHistoryByChapterId,
    latestChapterGateEntries,
    chapterGateTrend,
    chapterGateHeatmap,
    chapterGateDriftAlerts,
    chapterGateSummary,
  }
}
