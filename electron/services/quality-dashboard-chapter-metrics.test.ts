import { describe, expect, it } from 'vitest'
import { deriveChapterScoreMetrics } from './quality-dashboard-chapter-metrics'

describe('quality dashboard chapter metrics', () => {
  it('returns an unscored snapshot for absent or malformed score data', () => {
    expect(deriveChapterScoreMetrics(null)).toEqual({
      scored: false,
      overallScore: 0,
      aiLikeRate: 0,
      weakDimensions: [],
      dimensions: [],
    })
    expect(deriveChapterScoreMetrics('{')).toMatchObject({ scored: false })
    expect(deriveChapterScoreMetrics('{"dimensions":null}')).toMatchObject({ scored: false })
  })

  it('preserves score fields and normalizes language drift metrics', () => {
    expect(deriveChapterScoreMetrics(JSON.stringify({
      overall_score: 82,
      ai_like_rate: 13,
      weak_dimensions: ['节奏控制'],
      dimensions: [{ name: '节奏控制', score: 70 }],
      language_drift_metrics: { dashDensity: 18 },
    }))).toMatchObject({
      scored: true,
      overallScore: 82,
      aiLikeRate: 13,
      weakDimensions: ['节奏控制'],
      dimensions: [{ name: '节奏控制', score: 70 }],
      languageDriftMetrics: { dashDensity: 18 },
    })
  })

  it('keeps legacy zero fallbacks for missing numeric fields', () => {
    expect(deriveChapterScoreMetrics('{"dimensions":[]}')).toMatchObject({
      scored: true,
      overallScore: 0,
      aiLikeRate: 0,
      weakDimensions: [],
    })
  })
})
