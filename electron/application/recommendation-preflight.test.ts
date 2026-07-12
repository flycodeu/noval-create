import { describe, expect, it } from 'vitest'
import type { QualityDashboardData } from '../../src/types'
import { assessRecommendationPreflight } from './recommendation-preflight'

function dashboard(overrides: Record<string, unknown> = {}): QualityDashboardData {
  const base = {
    totalChaptersScored: 2,
    averageOverallScore: 90,
    novelQualityMetrics: {
      healthScore: 90,
      criticalRiskCount: 0,
      warningRiskCount: 0,
      endgameOverdueCount: 0,
      endgameUnboundCount: 0,
    },
    productionReadiness: {
      status: 'ready',
      summary: '生产门禁已通过。',
      blockers: [],
      warnings: [],
    },
    chapterGateSummary: { riskyCount: 0, unstableCount: 0 },
    antiAiRecurrence: { highRiskRuleCount: 0 },
    feedbackRecurrence: { pauseSuggestedIssueCount: 0 },
  }
  return {
    ...base,
    ...overrides,
    novelQualityMetrics: { ...base.novelQualityMetrics, ...(overrides.novelQualityMetrics as object || {}) },
    productionReadiness: { ...base.productionReadiness, ...(overrides.productionReadiness as object || {}) },
    chapterGateSummary: { ...base.chapterGateSummary, ...(overrides.chapterGateSummary as object || {}) },
    antiAiRecurrence: { ...base.antiAiRecurrence, ...(overrides.antiAiRecurrence as object || {}) },
    feedbackRecurrence: { ...base.feedbackRecurrence, ...(overrides.feedbackRecurrence as object || {}) },
  } as unknown as QualityDashboardData
}

const cleanSnapshot = {
  novel: { status: 'serializing' },
  chapters: [
    { content: '潮声越过旧港，沈砚在账本夹页里发现了第二种墨迹。' },
    { content: '证人没有给出结论，只把第五封信推回桌面中央。' },
  ],
}

describe('recommendation preflight', () => {
  it('returns ready only when quality, confidence, coverage, and hard gates all pass', () => {
    const result = assessRecommendationPreflight(cleanSnapshot, dashboard())
    expect(result).toMatchObject({
      status: 'ready',
      score: 90,
      confidenceLowerBound: 85,
      coverageRate: 100,
      blockers: [],
    })
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'quality_coverage', status: 'pass' }),
      expect.objectContaining({ code: 'production_readiness', status: 'pass' }),
    ]))
  })

  it('blocks incomplete coverage and explicit generation residue', () => {
    const result = assessRecommendationPreflight({
      novel: { status: 'serializing' },
      chapters: [{ content: 'TODO' }, { content: '作为AI语言模型，以下是为您生成的章节。' }],
    }, dashboard({ totalChaptersScored: 1 }))

    expect(result.status).toBe('blocked')
    expect(result.coverageRate).toBe(50)
    expect(result.blockers.join('\n')).toMatch(/占位/u)
    expect(result.blockers.join('\n')).toMatch(/模型过程话术/u)
  })

  it('applies endgame debt as a blocker only after the work is completed', () => {
    const riskyDashboard = dashboard({
      novelQualityMetrics: { endgameOverdueCount: 1, endgameUnboundCount: 1 },
    })
    expect(assessRecommendationPreflight(cleanSnapshot, riskyDashboard).blockers.join('\n'))
      .not.toMatch(/终局债务/u)
    expect(assessRecommendationPreflight({ ...cleanSnapshot, novel: { status: 'completed' } }, riskyDashboard).blockers.join('\n'))
      .toMatch(/终局债务/u)
  })
})
