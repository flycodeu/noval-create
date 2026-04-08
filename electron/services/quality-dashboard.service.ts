import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters } from '../database/schema'

export interface QualityDimensionScore {
  name: string
  score: number
  feedback: string
  suggestion: string
}

export interface LanguageDriftMetrics {
  abstractTokenDensity: number
  sentencePatternRepeatRate: number
  endingSummaryRate: number
  ornamentOverloadRate: number
  nonHumanCollocationRate: number
}

export interface QualityChapterEntry {
  chapterId: number
  chapterNum: number
  title: string
  overallScore: number
  aiLikeRate: number
  weakDimensions: string[]
  dimensions: QualityDimensionScore[]
  languageDriftMetrics?: LanguageDriftMetrics
}

export interface QualityHeatmapPoint {
  chapterNum: number
  dimension: string
  score: number
}

export interface QualityDashboardData {
  heatmapData: QualityHeatmapPoint[]
  overallScoreTrend: Array<{ chapterNum: number; score: number }>
  aiLikeRateTrend: Array<{ chapterNum: number; rate: number }>
  languageDriftTrends: {
    abstractTokenDensity: Array<{ chapterNum: number; value: number }>
    sentencePatternRepeatRate: Array<{ chapterNum: number; value: number }>
    endingSummaryRate: Array<{ chapterNum: number; value: number }>
    ornamentOverloadRate: Array<{ chapterNum: number; value: number }>
    nonHumanCollocationRate: Array<{ chapterNum: number; value: number }>
  }
  averageLanguageDrift: LanguageDriftMetrics
  weakDimensionFrequency: Array<{ dimension: string; count: number }>
  chapterDetails: QualityChapterEntry[]
  totalChaptersScored: number
  averageOverallScore: number
  averageAiLikeRate: number
}

const DIMENSION_NAMES = [
  '文笔质量', '逻辑连贯', '节奏控制', '情感深度',
  '人物塑造', '世界一致', '创新性', '追读欲',
]

function safeParseScores(json: string | null | undefined): {
  dimensions: QualityDimensionScore[]
  ai_like_rate: number
  overall_score: number
  weak_dimensions: string[]
  language_drift_metrics?: LanguageDriftMetrics
} | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    if (!parsed || !Array.isArray(parsed.dimensions)) return null
    return parsed
  } catch {
    return null
  }
}

function emptyLanguageDrift(): LanguageDriftMetrics {
  return {
    abstractTokenDensity: 0,
    sentencePatternRepeatRate: 0,
    endingSummaryRate: 0,
    ornamentOverloadRate: 0,
    nonHumanCollocationRate: 0,
  }
}

function normalizeLanguageDrift(value: unknown): LanguageDriftMetrics | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const read = (key: keyof LanguageDriftMetrics) =>
    typeof record[key] === 'number' && Number.isFinite(record[key]) ? Number(record[key]) : 0
  return {
    abstractTokenDensity: read('abstractTokenDensity'),
    sentencePatternRepeatRate: read('sentencePatternRepeatRate'),
    endingSummaryRate: read('endingSummaryRate'),
    ornamentOverloadRate: read('ornamentOverloadRate'),
    nonHumanCollocationRate: read('nonHumanCollocationRate'),
  }
}

export function getQualityDashboardData(novelId: number): QualityDashboardData {
  const db = getDb()
  const rows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    title: chapters.title,
    aiScoreJson: chapters.aiScoreJson,
  })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()

  const heatmapData: QualityHeatmapPoint[] = []
  const overallScoreTrend: Array<{ chapterNum: number; score: number }> = []
  const aiLikeRateTrend: Array<{ chapterNum: number; rate: number }> = []
  const languageDriftTrends = {
    abstractTokenDensity: [] as Array<{ chapterNum: number; value: number }>,
    sentencePatternRepeatRate: [] as Array<{ chapterNum: number; value: number }>,
    endingSummaryRate: [] as Array<{ chapterNum: number; value: number }>,
    ornamentOverloadRate: [] as Array<{ chapterNum: number; value: number }>,
    nonHumanCollocationRate: [] as Array<{ chapterNum: number; value: number }>,
  }
  const weakDimFreq = new Map<string, number>()
  const chapterDetails: QualityChapterEntry[] = []

  let totalOverall = 0
  let totalAiLike = 0
  let languageMetricsCount = 0
  let totalAbstract = 0
  let totalSentencePattern = 0
  let totalEndingSummary = 0
  let totalOrnament = 0
  let totalNonHuman = 0
  let scoredCount = 0

  for (const row of rows) {
    const scores = safeParseScores(row.aiScoreJson)
    if (!scores) continue

    scoredCount += 1
    const overallScore = scores.overall_score ?? 0
    const aiLikeRate = scores.ai_like_rate ?? 0
    const languageDriftMetrics = normalizeLanguageDrift(scores.language_drift_metrics)

    totalOverall += overallScore
    totalAiLike += aiLikeRate

    overallScoreTrend.push({ chapterNum: row.chapterNum, score: overallScore })
    aiLikeRateTrend.push({ chapterNum: row.chapterNum, rate: aiLikeRate })
    if (languageDriftMetrics) {
      languageMetricsCount += 1
      totalAbstract += languageDriftMetrics.abstractTokenDensity
      totalSentencePattern += languageDriftMetrics.sentencePatternRepeatRate
      totalEndingSummary += languageDriftMetrics.endingSummaryRate
      totalOrnament += languageDriftMetrics.ornamentOverloadRate
      totalNonHuman += languageDriftMetrics.nonHumanCollocationRate
      languageDriftTrends.abstractTokenDensity.push({ chapterNum: row.chapterNum, value: languageDriftMetrics.abstractTokenDensity })
      languageDriftTrends.sentencePatternRepeatRate.push({ chapterNum: row.chapterNum, value: languageDriftMetrics.sentencePatternRepeatRate })
      languageDriftTrends.endingSummaryRate.push({ chapterNum: row.chapterNum, value: languageDriftMetrics.endingSummaryRate })
      languageDriftTrends.ornamentOverloadRate.push({ chapterNum: row.chapterNum, value: languageDriftMetrics.ornamentOverloadRate })
      languageDriftTrends.nonHumanCollocationRate.push({ chapterNum: row.chapterNum, value: languageDriftMetrics.nonHumanCollocationRate })
    }

    for (const dim of scores.dimensions) {
      heatmapData.push({
        chapterNum: row.chapterNum,
        dimension: dim.name,
        score: dim.score,
      })
    }

    const weakDims = scores.weak_dimensions ?? []
    for (const wd of weakDims) {
      weakDimFreq.set(wd, (weakDimFreq.get(wd) || 0) + 1)
    }

    chapterDetails.push({
      chapterId: row.id,
      chapterNum: row.chapterNum,
      title: row.title || `第 ${row.chapterNum} 章`,
      overallScore,
      aiLikeRate,
      weakDimensions: weakDims,
      dimensions: scores.dimensions,
      languageDriftMetrics: languageDriftMetrics || undefined,
    })
  }

  const weakDimensionFrequency = Array.from(weakDimFreq.entries())
    .map(([dimension, count]) => ({ dimension, count }))
    .sort((a, b) => b.count - a.count)

  // Fill missing dimension names in frequency if none appeared
  for (const name of DIMENSION_NAMES) {
    if (!weakDimFreq.has(name)) {
      weakDimensionFrequency.push({ dimension: name, count: 0 })
    }
  }

  return {
    heatmapData,
    overallScoreTrend,
    aiLikeRateTrend,
    languageDriftTrends,
    averageLanguageDrift: languageMetricsCount > 0 ? {
      abstractTokenDensity: Math.round((totalAbstract / languageMetricsCount) * 10) / 10,
      sentencePatternRepeatRate: Math.round((totalSentencePattern / languageMetricsCount) * 10) / 10,
      endingSummaryRate: Math.round((totalEndingSummary / languageMetricsCount) * 10) / 10,
      ornamentOverloadRate: Math.round((totalOrnament / languageMetricsCount) * 10) / 10,
      nonHumanCollocationRate: Math.round((totalNonHuman / languageMetricsCount) * 10) / 10,
    } : emptyLanguageDrift(),
    weakDimensionFrequency,
    chapterDetails,
    totalChaptersScored: scoredCount,
    averageOverallScore: scoredCount > 0 ? Math.round((totalOverall / scoredCount) * 10) / 10 : 0,
    averageAiLikeRate: scoredCount > 0 ? Math.round((totalAiLike / scoredCount) * 10) / 10 : 0,
  }
}
