import type {
  StyleComplianceMetricSnapshot,
  StyleComplianceResult,
  StyleFingerprint,
} from '../../src/types'
import { getLatestStyleFingerprintForNovel } from './style-analysis.service'

const ABSTRACT_TOKENS = [
  '命运',
  '意义',
  '信念',
  '尊严',
  '灵魂',
  '宿命',
  '执念',
  '希望',
  '绝望',
  '真相',
  '代价',
  '成长',
  '觉悟',
  '世界',
  '未来',
  '过去',
  '情绪',
  '情感',
  '本能',
  '意志',
]

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitSentences(content: string): string[] {
  return content
    .replace(/\r/g, '')
    .split(/[。！？!?]+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim()
  if (!trimmed) return false
  return /^[“"「『]/.test(trimmed) || /^[^，。！？!?]{1,18}[：:]/.test(trimmed)
}

function countOccurrences(content: string, token: string): number {
  if (!token) return 0
  let count = 0
  let index = content.indexOf(token)
  while (index !== -1) {
    count += 1
    index = content.indexOf(token, index + token.length)
  }
  return count
}

function normalizeForbiddenPattern(pattern: string): string {
  const trimmed = pattern.trim()
  if (!trimmed) return ''
  const quoted = trimmed.match(/[“"'《「『](.+?)[”"'》」』]/)
  if (quoted?.[1]) return quoted[1].trim()
  return trimmed
    .replace(/^(不要|避免|禁用|少用|别用|不用|不写)\s*/u, '')
    .replace(/[，。；：:].*$/u, '')
    .trim()
}

function buildContentMetrics(content: string): StyleComplianceMetricSnapshot {
  const paragraphs = splitParagraphs(content)
  const sentences = splitSentences(content)
  const totalChars = content.replace(/\s+/g, '').length || 1
  const abstractHitCount = ABSTRACT_TOKENS.reduce((sum, token) => sum + countOccurrences(content, token), 0)
  const dialogueParagraphCount = paragraphs.filter(isDialogueParagraph).length

  return {
    avgSentenceLength: roundMetric(
      sentences.length > 0
        ? sentences.reduce((sum, item) => sum + item.replace(/\s+/g, '').length, 0) / sentences.length
        : 0,
    ),
    avgParagraphLength: roundMetric(
      paragraphs.length > 0
        ? paragraphs.reduce((sum, item) => sum + item.replace(/\s+/g, '').length, 0) / paragraphs.length
        : 0,
    ),
    dialogueLineRate: roundMetric(paragraphs.length > 0 ? (dialogueParagraphCount / paragraphs.length) * 100 : 0),
    abstractTokenDensity: roundMetric((abstractHitCount / totalChars) * 100),
  }
}

function buildReferenceMetrics(fingerprint: StyleFingerprint): StyleComplianceMetricSnapshot {
  return {
    avgSentenceLength: roundMetric(fingerprint.avgSentenceLength || 20),
    avgParagraphLength: roundMetric(fingerprint.avgParagraphLength || 85),
    dialogueLineRate: roundMetric(fingerprint.dialogueLineRate || 25),
    abstractTokenDensity: roundMetric(fingerprint.abstractTokenDensity || 8),
  }
}

export function analyzeStyleCompliance(
  content: string,
  fingerprint: StyleFingerprint,
): StyleComplianceResult {
  const referenceMetrics = buildReferenceMetrics(fingerprint)
  const actualMetrics = buildContentMetrics(content)
  const deviations: string[] = []
  const rewriteHints: string[] = []
  const matchedForbiddenPatterns = fingerprint.forbiddenPatterns
    .map(normalizeForbiddenPattern)
    .filter((item) => item.length >= 2 && content.includes(item))

  let penalty = 0
  let severeDeviationCount = 0

  const sentenceGap = Math.abs(actualMetrics.avgSentenceLength - referenceMetrics.avgSentenceLength)
  const sentenceRatio = referenceMetrics.avgSentenceLength > 0 ? sentenceGap / referenceMetrics.avgSentenceLength : 0
  if (sentenceRatio >= 0.45) {
    severeDeviationCount += 1
    penalty += 18
    deviations.push(`平均句长偏离明显，当前 ${actualMetrics.avgSentenceLength} 字，参考 ${referenceMetrics.avgSentenceLength} 字。`)
    rewriteHints.push('把句长拉回参考区间，减少连续解释句或无效碎句。')
  } else if (sentenceRatio >= 0.25) {
    penalty += 8
    deviations.push(`平均句长开始漂移，当前 ${actualMetrics.avgSentenceLength} 字，参考 ${referenceMetrics.avgSentenceLength} 字。`)
  }

  const paragraphGap = Math.abs(actualMetrics.avgParagraphLength - referenceMetrics.avgParagraphLength)
  const paragraphRatio = referenceMetrics.avgParagraphLength > 0 ? paragraphGap / referenceMetrics.avgParagraphLength : 0
  if (paragraphRatio >= 0.5) {
    severeDeviationCount += 1
    penalty += 18
    deviations.push(`段落长度偏离明显，当前 ${actualMetrics.avgParagraphLength} 字，参考 ${referenceMetrics.avgParagraphLength} 字。`)
    rewriteHints.push('拆掉大段说明或合并碎段，让段落密度回到参考文本区间。')
  } else if (paragraphRatio >= 0.28) {
    penalty += 8
    deviations.push(`段落长度开始漂移，当前 ${actualMetrics.avgParagraphLength} 字，参考 ${referenceMetrics.avgParagraphLength} 字。`)
  }

  const dialogueGap = Math.abs(actualMetrics.dialogueLineRate - referenceMetrics.dialogueLineRate)
  if (dialogueGap >= 18) {
    severeDeviationCount += 1
    penalty += 16
    deviations.push(`对话段占比偏离过大，当前 ${actualMetrics.dialogueLineRate}% ，参考 ${referenceMetrics.dialogueLineRate}%。`)
    rewriteHints.push('补对白或压缩对白，让场景中的口播密度回到参考节奏。')
  } else if (dialogueGap >= 10) {
    penalty += 8
    deviations.push(`对话段占比偏高/偏低，当前 ${actualMetrics.dialogueLineRate}% ，参考 ${referenceMetrics.dialogueLineRate}%。`)
  }

  const abstractExcess = actualMetrics.abstractTokenDensity - referenceMetrics.abstractTokenDensity
  if (abstractExcess >= 6) {
    severeDeviationCount += 1
    penalty += 16
    deviations.push(`抽象词密度偏高，当前 ${actualMetrics.abstractTokenDensity}% ，参考 ${referenceMetrics.abstractTokenDensity}%。`)
    rewriteHints.push('删掉抽象概念词，改写成动作、感官和物理后果。')
  } else if (abstractExcess >= 3) {
    penalty += 8
    deviations.push(`抽象词密度高于参考，当前 ${actualMetrics.abstractTokenDensity}% ，参考 ${referenceMetrics.abstractTokenDensity}%。`)
  }

  if (matchedForbiddenPatterns.length > 0) {
    penalty += Math.min(32, matchedForbiddenPatterns.length * 12)
    severeDeviationCount += matchedForbiddenPatterns.length >= 2 ? 1 : 0
    deviations.push(`命中禁用模式：${matchedForbiddenPatterns.join('、')}。`)
    rewriteHints.push('逐条删除命中的禁用表达，替换为角色动作、对白或具体结果。')
  }

  const forbiddenPatternHitCount = matchedForbiddenPatterns.length
  const score = clampScore(100 - penalty)
  const status: StyleComplianceResult['status'] = forbiddenPatternHitCount >= 2
    || severeDeviationCount >= 2
    || score < 55
    ? 'rewrite'
    : forbiddenPatternHitCount > 0 || severeDeviationCount > 0 || deviations.length >= 2 || score < 80
      ? 'warning'
      : 'pass'

  const summary = status === 'pass'
    ? `风格合规通过，当前得分 ${score}。`
    : status === 'rewrite'
      ? `风格偏离已达到重写阈值，当前得分 ${score}。`
      : `风格出现可修复偏移，当前得分 ${score}。`

  return {
    status,
    score,
    summary,
    deviations,
    rewriteHints: [...new Set(rewriteHints.filter(Boolean))],
    matchedForbiddenPatterns,
    forbiddenPatternHitCount,
    referenceMetrics,
    actualMetrics,
  }
}

export function analyzeNovelStyleCompliance(
  novelId: number,
  content: string,
): StyleComplianceResult | null {
  const payload = getLatestStyleFingerprintForNovel(novelId)
  if (!payload) return null
  return analyzeStyleCompliance(content, payload.fingerprint)
}
