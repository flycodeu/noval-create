import { analyzeLanguageDrift, type LanguageDriftMetrics } from '../../src/shared/language-drift'

export interface EnhancedAIScoreResult {
  dimensions: Array<{
    name: string
    score: number
    feedback: string
    suggestion: string
  }>
  ai_like_rate: number
  repetition_risk: '低' | '中' | '高'
  overall_score: number
  overall_feedback: string
  top_fixes: string[]
  weak_dimensions?: string[]
  language_drift_metrics: LanguageDriftMetrics
}

export interface ChapterAiCheckIssue {
  type: string
  location: string
  suggestion: string
  severity?: 'high' | 'medium' | 'low'
}

export interface ChapterAiCheckResult {
  score: number
  issues: ChapterAiCheckIssue[]
  overall_feedback: string
  ai_like_rate: number
  repetition_risk: '低' | '中' | '高'
  language_drift_metrics: LanguageDriftMetrics
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeRepetitionRisk(value: unknown): '低' | '中' | '高' {
  return value === '高' || value === '中' || value === '低' ? value : '中'
}

function normalizeDimensions(value: unknown): EnhancedAIScoreResult['dimensions'] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      return {
        name: asText(record.name) || '未命名维度',
        score: asNumber(record.score),
        feedback: asText(record.feedback),
        suggestion: asText(record.suggestion),
      }
    })
}

function normalizeIssues(value: unknown): ChapterAiCheckIssue[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>
      const severity: ChapterAiCheckIssue['severity'] = record.severity === 'high' || record.severity === 'medium' || record.severity === 'low'
        ? record.severity
        : undefined
      return {
        type: asText(record.type) || '未分类问题',
        location: asText(record.location),
        suggestion: asText(record.suggestion) || asText(record.feedback),
        ...(severity ? { severity } : {}),
      }
    })
    .filter((item) => item.suggestion || item.location)
}

export function enhanceAiScoreResult(raw: unknown, content: string): EnhancedAIScoreResult {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  const dimensions = normalizeDimensions(record.dimensions)
  const rawAiLikeRate = asOptionalNumber(record.ai_like_rate)
  const aiLikeRate = rawAiLikeRate !== null && rawAiLikeRate > 0 && rawAiLikeRate <= 1
    ? rawAiLikeRate * 100
    : Math.max(0, Math.min(100, rawAiLikeRate ?? 0))
  const explicitOverallScore = asOptionalNumber(record.overall_score)
  const legacyScore = asOptionalNumber(record.score)
  const rawOverallScore = explicitOverallScore
    ?? legacyScore
    ?? (rawAiLikeRate !== null ? Math.max(0, Math.min(100, 100 - aiLikeRate)) : 0)
  const overallScore = rawOverallScore > 0 && rawOverallScore <= 10
    ? rawOverallScore * 10
    : Math.max(0, Math.min(100, rawOverallScore))

  return {
    dimensions,
    ai_like_rate: aiLikeRate,
    repetition_risk: normalizeRepetitionRisk(record.repetition_risk),
    overall_score: overallScore,
    overall_feedback: asText(record.overall_feedback),
    top_fixes: toStringArray(record.top_fixes),
    weak_dimensions: toStringArray(record.weak_dimensions),
    language_drift_metrics: analyzeLanguageDrift(content),
  }
}

export function toChapterAiCheckResult(raw: unknown, enhanced: EnhancedAIScoreResult): ChapterAiCheckResult {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const directIssues = normalizeIssues(record.issues)
  const issues = directIssues.length > 0
    ? directIssues
    : enhanced.top_fixes.map((suggestion) => ({
      type: '重点修复',
      location: '',
      suggestion,
    }))

  return {
    score: enhanced.overall_score,
    issues,
    overall_feedback: enhanced.overall_feedback || '当前没有返回可执行的 AI 体检结论。',
    ai_like_rate: enhanced.ai_like_rate,
    repetition_risk: enhanced.repetition_risk,
    language_drift_metrics: enhanced.language_drift_metrics,
  }
}
