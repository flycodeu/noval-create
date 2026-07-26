import type {
  StyleComplianceMetricSnapshot,
  StyleComplianceResult,
  StyleFingerprint,
} from '../../src/types'
import { resolveActiveStyleFingerprint } from './style-analysis.service'
import { parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { isDialogueParagraph, splitProseParagraphs, splitProseSentences } from '../../src/shared/style-fingerprint-stats'
import { getDb } from '../database/db'
import { novels } from '../database/schema'
import { eq } from 'drizzle-orm'

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

const splitParagraphs = splitProseParagraphs
const splitSentences = splitProseSentences

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

function mergeStatus(left: StyleComplianceResult['status'], right: StyleComplianceResult['status']): StyleComplianceResult['status'] {
  if (left === 'rewrite' || right === 'rewrite') return 'rewrite'
  if (left === 'warning' || right === 'warning') return 'warning'
  return 'pass'
}

function splitStyleLockLines(value?: string | null): string[] {
  return (value || '')
    .split(/\r?\n+|[；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => text.includes(token))
}

function buildManualReferenceMetrics(guideText: string): StyleComplianceMetricSnapshot {
  return {
    avgSentenceLength: hasAnyToken(guideText, ['短句', '短促', '冷硬', '利落']) ? 18 : 22,
    avgParagraphLength: hasAnyToken(guideText, ['快节奏', '压迫', '紧凑', '短段']) ? 78 : 95,
    dialogueLineRate: hasAnyToken(guideText, ['对白比例', '对白占比', '对白密度']) ? 32 : 24,
    abstractTokenDensity: hasAnyToken(guideText, ['现场质感', '动作密度', '信息密度', '实感']) ? 6 : 8,
  }
}

function extractManualForbiddenPatterns(lines: string[]): string[] {
  const result: string[] = []
  for (const line of lines) {
    const matches = line.matchAll(/(?:禁止|禁用|避免|不要)\s*([^，。；;、\n]+)/gu)
    for (const match of matches) {
      const normalized = normalizeForbiddenPattern(match[1] || '')
      if (normalized.length >= 2) result.push(normalized)
    }
    if (/禁止|禁用|避免|不要|退回/u.test(line)) {
      const normalized = normalizeForbiddenPattern(line)
      if (normalized.length >= 2) result.push(normalized)
    }
  }
  return [...new Set(result)]
}

export function analyzeManualStyleLockCompliance(
  content: string,
  themeVoiceJson?: string | null,
): StyleComplianceResult | null {
  const themeVoice = parseThemeVoiceDocument(themeVoiceJson)
  const guideLines = [
    ...splitStyleLockLines(themeVoice.targetWorkSampleGuide),
    ...splitStyleLockLines(themeVoice.humanStyleSampleLock),
  ]
  if (guideLines.length === 0) return null

  const guideText = guideLines.join('\n')
  const actualMetrics = buildContentMetrics(content)
  const referenceMetrics = buildManualReferenceMetrics(guideText)
  const deviations: string[] = []
  const rewriteHints: string[] = []
  const forbiddenPatterns = extractManualForbiddenPatterns(guideLines)
  const matchedForbiddenPatterns = forbiddenPatterns.filter((pattern) => content.includes(pattern))

  let penalty = 0
  if (hasAnyToken(guideText, ['短句', '短促', '冷硬', '利落']) && actualMetrics.avgSentenceLength > 28) {
    penalty += 18
    deviations.push(`人工风格锁要求短句/利落节奏，当前平均句长 ${actualMetrics.avgSentenceLength} 字。`)
    rewriteHints.push('压缩连续解释句，把判断拆回动作、对白和短反应。')
  }
  if (hasAnyToken(guideText, ['快节奏', '压迫', '紧凑', '短段']) && actualMetrics.avgParagraphLength > 180) {
    penalty += 16
    deviations.push(`目标样章口径要求紧凑段落，当前平均段长 ${actualMetrics.avgParagraphLength} 字。`)
    rewriteHints.push('拆开大段说明，用更短的场景节拍推进。')
  }
  if (hasAnyToken(guideText, ['对白比例', '对白占比', '对白密度']) && (actualMetrics.dialogueLineRate < 8 || actualMetrics.dialogueLineRate > 68)) {
    penalty += 14
    deviations.push(`目标样章要求校准对白比例，当前对白段占比 ${actualMetrics.dialogueLineRate}%。`)
    rewriteHints.push('按样章口径补足或压缩对白，让对白承担信息和关系变化。')
  }
  if (hasAnyToken(guideText, ['现场质感', '动作密度', '信息密度', '实感', '总结腔', 'AI 化']) && actualMetrics.abstractTokenDensity > 10) {
    penalty += 18
    deviations.push(`人工样本锁要求现场质感/信息密度，当前抽象词密度 ${actualMetrics.abstractTokenDensity}% 偏高。`)
    rewriteHints.push('删掉总结腔和抽象判断，替换为可见动作、证据、筹码和物理后果。')
  }
  if (matchedForbiddenPatterns.length > 0) {
    penalty += Math.min(30, matchedForbiddenPatterns.length * 12)
    deviations.push(`命中人工风格锁禁用表达：${matchedForbiddenPatterns.join('、')}。`)
    rewriteHints.push('删除命中的人工禁用表达，改成目标样章允许的叙述方式。')
  }

  const score = clampScore(100 - penalty)
  const status: StyleComplianceResult['status'] = penalty >= 30 || matchedForbiddenPatterns.length >= 2
    ? 'rewrite'
    : penalty > 0
      ? 'warning'
      : 'pass'

  return {
    status,
    score,
    summary: status === 'pass'
      ? `真实样章/人工风格锁通过，当前得分 ${score}。`
      : status === 'rewrite'
        ? `真实样章/人工风格锁偏离达到重写阈值，当前得分 ${score}。`
        : `真实样章/人工风格锁出现可修复偏移，当前得分 ${score}。`,
    deviations,
    rewriteHints: [...new Set(rewriteHints)],
    matchedForbiddenPatterns,
    forbiddenPatternHitCount: matchedForbiddenPatterns.length,
    referenceMetrics,
    actualMetrics,
  }
}

function mergeStyleComplianceResults(
  base: StyleComplianceResult | null,
  manual: StyleComplianceResult | null,
): StyleComplianceResult | null {
  if (!base) return manual
  if (!manual) return base
  const status = mergeStatus(base.status, manual.status)
  const score = Math.min(base.score, manual.score)
  return {
    status,
    score,
    summary: status === 'pass'
      ? `风格合规通过，当前得分 ${score}。`
      : status === 'rewrite'
        ? `风格偏离已达到重写阈值，当前得分 ${score}。`
        : `风格出现可修复偏移，当前得分 ${score}。`,
    deviations: [...new Set([...base.deviations, ...manual.deviations])],
    rewriteHints: [...new Set([...base.rewriteHints, ...manual.rewriteHints])],
    matchedForbiddenPatterns: [...new Set([...base.matchedForbiddenPatterns, ...manual.matchedForbiddenPatterns])],
    forbiddenPatternHitCount: base.forbiddenPatternHitCount + manual.forbiddenPatternHitCount,
    referenceMetrics: base.referenceMetrics,
    actualMetrics: base.actualMetrics,
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
  const payload = resolveActiveStyleFingerprint(novelId)
  const baseResult = payload ? analyzeStyleCompliance(content, payload.fingerprint) : null
  let themeVoiceJson = ''
  try {
    const novel = getDb().select({ themeVoiceJson: novels.themeVoiceJson }).from(novels).where(eq(novels.id, novelId)).all()[0]
    themeVoiceJson = novel?.themeVoiceJson || ''
  } catch {
    themeVoiceJson = ''
  }
  const manualResult = analyzeManualStyleLockCompliance(content, themeVoiceJson)
  return mergeStyleComplianceResults(baseResult, manualResult)
}
