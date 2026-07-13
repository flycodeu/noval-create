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
  'paragraph_simile_stacking',
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

/**
 * 把已经被质量规则命中的“不是……，是/而是……”定义句拆成两个直接陈述句。
 * 只移动原句中的字词，不增删实体、数字或事件事实；用于模型候选的最后一道
 * 低风险语言整理，避免同一随机句式在有限重试后仍阻塞安全应用。
 */
export function repairNotButDefinitionPatterns(content: string): string {
  return String(content || '').replace(
    /不是([^，,。！？\n]{2,28})[，,]?(?:而是|只是|是)([^。！？\n]{2,42})/gu,
    (_match, left: string, right: string) => `并非${left.trim()}。实际是${right.trim()}`,
  )
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
