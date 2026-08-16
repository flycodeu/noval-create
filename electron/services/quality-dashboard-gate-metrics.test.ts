import { describe, expect, it } from 'vitest'
import { normalizeChapterGateScoreBreakdown } from './chapter-gate-utils'
import { deriveChapterGateMetrics } from './quality-dashboard-gate-metrics'

describe('quality dashboard gate metrics', () => {
  it('keeps the newest gate snapshot per chapter and exposes drift history', () => {
    const score = normalizeChapterGateScoreBreakdown()
    const result = deriveChapterGateMetrics([
      {
        id: 1, novelId: 7, chapterId: 101, chapterNum: 1, gateLevel: 'warning', ready: 0,
        summary: '旧', rewriteCount: 0, blockerCount: 0, warningCount: 1, generatedTaskCount: 0,
        topIssueKeysJson: '[]', scoreBreakdownJson: JSON.stringify(score), createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 2, novelId: 7, chapterId: 101, chapterNum: 1, gateLevel: 'pass', ready: 1,
        summary: '新', rewriteCount: 0, blockerCount: 0, warningCount: 0, generatedTaskCount: 0,
        topIssueKeysJson: '[]', scoreBreakdownJson: JSON.stringify(score), createdAt: '2026-01-02T00:00:00Z',
      },
    ])

    expect(result.latestChapterGateEntries).toHaveLength(1)
    expect(result.latestChapterGateEntries[0]).toMatchObject({ id: 2, gateLevel: 'pass' })
    expect(result.chapterGateHistoryByChapterId.get(101)).toHaveLength(2)
    expect(result.chapterGateDriftAlerts).toHaveLength(1)
    expect(result.chapterGateSummary.coveredChapterCount).toBe(1)
  })
})
