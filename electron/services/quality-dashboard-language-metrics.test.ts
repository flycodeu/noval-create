import { describe, expect, it } from 'vitest'
import {
  averageLanguageDrift,
  emptyLanguageDrift,
  emptyLanguageDriftSeries,
  normalizeLanguageDrift,
  pushLanguageDriftMetrics,
  rankLanguageDriftMetrics,
  summarizeTrend,
} from './quality-dashboard-language-metrics'

describe('quality dashboard language metrics', () => {
  it('normalizes partial metrics without leaking invalid values', () => {
    const metrics = normalizeLanguageDrift({
      abstractTokenDensity: 12.5,
      dashDensity: Number.NaN,
      parallelismRate: '9',
    })

    expect(metrics).toEqual({
      ...emptyLanguageDrift(),
      abstractTokenDensity: 12.5,
    })
    expect(normalizeLanguageDrift(null)).toBeNull()
  })

  it('accumulates, averages and ranks every language metric', () => {
    const first = { ...emptyLanguageDrift(), dashDensity: 10, parallelismRate: 30 }
    const second = { ...emptyLanguageDrift(), dashDensity: 20, parallelismRate: 10 }
    const series = emptyLanguageDriftSeries()
    pushLanguageDriftMetrics(series, 1, first)
    pushLanguageDriftMetrics(series, 2, second)

    expect(series.dashDensity).toEqual([
      { chapterNum: 1, value: 10 },
      { chapterNum: 2, value: 20 },
    ])
    expect(averageLanguageDrift([first, second])).toMatchObject({ dashDensity: 15, parallelismRate: 20 })
    expect(rankLanguageDriftMetrics(second, 2).map((entry) => entry.metric)).toEqual([
      'dashDensity',
      'parallelismRate',
    ])
  })

  it('uses the recent window and preserves trend thresholds', () => {
    expect(summarizeTrend('dashDensity', '破折号密度', [])).toMatchObject({ status: 'stable', delta: 0 })
    expect(summarizeTrend('dashDensity', '破折号密度', [
      { chapterNum: 1, value: 10 },
      { chapterNum: 2, value: 20 },
    ])).toMatchObject({ previousValue: 10, latestValue: 20, delta: 10, status: 'worsening' })
    expect(summarizeTrend('dashDensity', '破折号密度', [
      { chapterNum: 1, value: 20 },
      { chapterNum: 2, value: 10 },
    ])).toMatchObject({ status: 'improving' })
  })
})
