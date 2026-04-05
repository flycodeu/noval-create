import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters } from '../database/schema'

export interface QualityDimensionScore {
  name: string
  score: number
  feedback: string
  suggestion: string
}

export interface QualityChapterEntry {
  chapterId: number
  chapterNum: number
  title: string
  overallScore: number
  aiLikeRate: number
  weakDimensions: string[]
  dimensions: QualityDimensionScore[]
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
  const weakDimFreq = new Map<string, number>()
  const chapterDetails: QualityChapterEntry[] = []

  let totalOverall = 0
  let totalAiLike = 0
  let scoredCount = 0

  for (const row of rows) {
    const scores = safeParseScores(row.aiScoreJson)
    if (!scores) continue

    scoredCount += 1
    const overallScore = scores.overall_score ?? 0
    const aiLikeRate = scores.ai_like_rate ?? 0

    totalOverall += overallScore
    totalAiLike += aiLikeRate

    overallScoreTrend.push({ chapterNum: row.chapterNum, score: overallScore })
    aiLikeRateTrend.push({ chapterNum: row.chapterNum, rate: aiLikeRate })

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
    weakDimensionFrequency,
    chapterDetails,
    totalChaptersScored: scoredCount,
    averageOverallScore: scoredCount > 0 ? Math.round((totalOverall / scoredCount) * 10) / 10 : 0,
    averageAiLikeRate: scoredCount > 0 ? Math.round((totalAiLike / scoredCount) * 10) / 10 : 0,
  }
}
