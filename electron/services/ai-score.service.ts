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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
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

export function enhanceAiScoreResult(raw: unknown, content: string): EnhancedAIScoreResult {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}

  return {
    dimensions: normalizeDimensions(record.dimensions),
    ai_like_rate: asNumber(record.ai_like_rate),
    repetition_risk: normalizeRepetitionRisk(record.repetition_risk),
    overall_score: asNumber(record.overall_score),
    overall_feedback: asText(record.overall_feedback),
    top_fixes: toStringArray(record.top_fixes),
    weak_dimensions: toStringArray(record.weak_dimensions),
    language_drift_metrics: analyzeLanguageDrift(content),
  }
}
