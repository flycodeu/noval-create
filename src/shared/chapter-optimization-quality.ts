import type { ChapterOptimizationQualityGate, LanguageDriftMetrics } from '../types'
import { collectQualityGuardrailFindings } from './content-guardrails'
import { analyzeLanguageDrift } from './language-drift'

const STRONG_AI_FLAVOR_CODES = new Set([
  'ai_process_leak',
  'prompt_leak',
  'dash_abuse',
  'parenthetical_explanation_abuse',
  'not_but_definition_pattern',
  'double_metaphor_or_simile_stack',
  'parallelism_overuse',
  'low_value_body_detail',
  'eye_open_close_standalone_paragraph',
  'soft_voice_cliche',
])

const DRIFT_GATE_KEYS: Array<keyof LanguageDriftMetrics> = [
  'dashDensity',
  'parentheticalExplanationDensity',
  'metaphorStackRate',
  'parallelismRate',
  'bodyDetailClicheRate',
  'isolatedTemplateParagraphRate',
]

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

function scoreAiFlavorDrift(metrics: LanguageDriftMetrics): number {
  return roundScore(
    DRIFT_GATE_KEYS.reduce((sum, key) => sum + (Number(metrics[key]) || 0), 0) / DRIFT_GATE_KEYS.length,
  )
}

function countStrongAiFlavor(codes: string[]): number {
  return codes.filter((code) => STRONG_AI_FLAVOR_CODES.has(code)).length
}

export function buildChapterOptimizationQualityGate(
  originalContent: string,
  optimizedContent: string,
): ChapterOptimizationQualityGate {
  const originalFindings = collectQualityGuardrailFindings(originalContent)
  const optimizedFindings = collectQualityGuardrailFindings(optimizedContent)
  const originalGuardrailHits = originalFindings.map((finding) => finding.code)
  const optimizedGuardrailHits = optimizedFindings.map((finding) => finding.code)
  const originalHighSeverityCount = originalFindings.filter((finding) => finding.severity === 'high').length
  const optimizedHighSeverityCount = optimizedFindings.filter((finding) => finding.severity === 'high').length
  const originalStrongAiFlavorCount = countStrongAiFlavor(originalGuardrailHits)
  const optimizedStrongAiFlavorCount = countStrongAiFlavor(optimizedGuardrailHits)
  const languageDriftBefore = analyzeLanguageDrift(originalContent)
  const languageDriftAfter = analyzeLanguageDrift(optimizedContent)
  const originalDriftScore = scoreAiFlavorDrift(languageDriftBefore)
  const optimizedDriftScore = scoreAiFlavorDrift(languageDriftAfter)
  const optimizedStrongSamples = optimizedFindings
    .filter((finding) => STRONG_AI_FLAVOR_CODES.has(finding.code))
    .map((finding) => finding.code)
    .slice(0, 6)

  const warnings = [
    optimizedHighSeverityCount > 0 && optimizedHighSeverityCount >= originalHighSeverityCount
      ? `优化稿仍有 ${optimizedHighSeverityCount} 处高危质量问题，未低于原文。`
      : '',
    optimizedStrongAiFlavorCount > 0 && optimizedStrongAiFlavorCount >= originalStrongAiFlavorCount
      ? `优化稿强 AI 味命中未下降：${optimizedStrongSamples.join('、') || '仍有规则命中'}。`
      : '',
    optimizedDriftScore > originalDriftScore + 8
      ? `优化稿语言漂移分升高：${originalDriftScore} -> ${optimizedDriftScore}。`
      : '',
  ].filter(Boolean)

  return {
    safeToApply: warnings.length === 0,
    warnings,
    originalGuardrailHits,
    optimizedGuardrailHits,
    originalStrongAiFlavorCount,
    optimizedStrongAiFlavorCount,
    originalHighSeverityCount,
    optimizedHighSeverityCount,
    originalDriftScore,
    optimizedDriftScore,
    languageDriftBefore,
    languageDriftAfter,
  }
}
