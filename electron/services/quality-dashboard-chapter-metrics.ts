import type { AIScoreDimension, LanguageDriftMetrics } from '../../src/types'
import { normalizeLanguageDrift } from './quality-dashboard-language-metrics'

export interface ChapterScoreMetrics {
  scored: boolean
  overallScore: number
  aiLikeRate: number
  weakDimensions: string[]
  dimensions: AIScoreDimension[]
  languageDriftMetrics?: LanguageDriftMetrics
}

function emptyChapterScore(): ChapterScoreMetrics {
  return {
    scored: false,
    overallScore: 0,
    aiLikeRate: 0,
    weakDimensions: [],
    dimensions: [],
  }
}

export function deriveChapterScoreMetrics(json: string | null | undefined): ChapterScoreMetrics {
  if (!json) return emptyChapterScore()
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.dimensions)) return emptyChapterScore()
    const languageDriftMetrics = normalizeLanguageDrift(parsed.language_drift_metrics) || undefined
    return {
      scored: true,
      overallScore: (parsed.overall_score as number | null | undefined) ?? 0,
      aiLikeRate: (parsed.ai_like_rate as number | null | undefined) ?? 0,
      weakDimensions: (parsed.weak_dimensions as string[] | null | undefined) ?? [],
      dimensions: parsed.dimensions as AIScoreDimension[],
      languageDriftMetrics,
    }
  } catch {
    return emptyChapterScore()
  }
}
