import { collectQualityGuardrailFindings } from './content-guardrails'

export interface LanguageDriftMetrics {
  abstractTokenDensity: number
  sentencePatternRepeatRate: number
  endingSummaryRate: number
  ornamentOverloadRate: number
  nonHumanCollocationRate: number
}

const ABSTRACT_TOKENS = [
  '命运',
  '宿命',
  '真谛',
  '成长',
  '力量',
  '意义',
  '情绪价值',
  '复杂情绪',
  '某种情绪',
  '压迫感',
  '安全感',
  '失落感',
  '宿命感',
  '情绪在心底蔓延',
  '说不清',
  '道不明',
  '难以言喻',
  '无以言表',
  '灵魂深处',
  '内心深处',
]

const ORNAMENT_TOKENS = [
  '古老而神秘',
  '氤氲',
  '晨光熹微',
  '星光点点',
  '余晖',
  '光影交错',
  '浓浓的',
  '淡淡的',
  '说不清的',
  '道不明的',
  '仿佛',
  '似乎',
  '冥冥之中',
  '不可名状',
  '深邃',
  '悠远',
  '苍茫',
]

const ENDING_SUMMARY_PATTERNS = [
  /而这一切.{0,10}才刚刚开始/u,
  /故事.{0,6}远没有结束/u,
  /一切.{0,6}才刚刚开始/u,
  /新的篇章.{0,6}即将/u,
  /或许，这就是/u,
  /也许，这便是/u,
  /而这，正是/u,
  /这，便是/u,
]

const NON_HUMAN_PATTERNS = [
  /(电网|系统|组织|城市|铁门|基地|设施|防线|通讯|建筑|围墙|铁丝网|大门|机器|车辆|道路).{0,4}(死亡|呼吸|哭泣|思考|愤怒|悲鸣|叹息|挣扎|绝望|恐惧)/u,
  /(角色|地点|物品|事件|章节|场景|线程|故事弧)#\d+/u,
]

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/[。！？!?；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
}

function countTokenHits(text: string, tokens: string[]): number {
  return tokens.reduce((total, token) => total + (text.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu')) || []).length, 0)
}

function detectSentencePattern(sentence: string): string {
  const trimmed = sentence.trim()
  const len = trimmed.length
  const lengthBucket = len <= 12 ? 'short' : len <= 24 ? 'medium' : len <= 40 ? 'long' : 'xlong'
  const opener = /^(他|她|他们|她们|我|我们|此刻|这一刻|就在这时|突然|与此同时|然而|于是)/u.exec(trimmed)?.[0] || 'other'
  const hasDialogue = /[“”"'「」『』]/u.test(trimmed) ? 'dialogue' : 'plain'
  const ending = /((?:了(?:。)?)|着|吗|呢|吧|啊)$/u.exec(trimmed)?.[0] || 'plain'
  return `${lengthBucket}:${opener}:${hasDialogue}:${ending}`
}

function analyzeSentencePatternRepeatRate(sentences: string[]): number {
  if (sentences.length < 4) return 0
  let repeated = 0
  for (let index = 1; index < sentences.length; index += 1) {
    if (detectSentencePattern(sentences[index]) === detectSentencePattern(sentences[index - 1])) {
      repeated += 1
    }
  }
  return clampPercent((repeated / Math.max(sentences.length - 1, 1)) * 100)
}

function analyzeAbstractTokenDensity(text: string, sentences: string[]): number {
  if (sentences.length === 0) return 0
  const hits = countTokenHits(text, ABSTRACT_TOKENS)
  return clampPercent((hits / sentences.length) * 22)
}

function analyzeEndingSummaryRate(sentences: string[]): number {
  if (sentences.length === 0) return 0
  const paragraphEnds = normalizeText(sentences.join('\n'))
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => splitSentences(paragraph).at(-1) || paragraph)
  if (paragraphEnds.length === 0) return 0
  const hits = paragraphEnds.filter((sentence) => ENDING_SUMMARY_PATTERNS.some((pattern) => pattern.test(sentence))).length
  return clampPercent((hits / paragraphEnds.length) * 100)
}

function analyzeOrnamentOverloadRate(text: string, sentences: string[]): number {
  if (sentences.length === 0) return 0
  const tokenHits = countTokenHits(text, ORNAMENT_TOKENS)
  const overloadedSentences = sentences.filter((sentence) => {
    const localHits = countTokenHits(sentence, ORNAMENT_TOKENS)
    return localHits >= 2 || /(?:仿佛|似乎).{0,10}(?:仿佛|似乎)/u.test(sentence)
  }).length
  return clampPercent(((tokenHits + overloadedSentences) / sentences.length) * 12)
}

function analyzeNonHumanCollocationRate(text: string, sentences: string[]): number {
  if (sentences.length === 0) return 0
  const patternHits = NON_HUMAN_PATTERNS.reduce((total, pattern) => total + (text.match(pattern) || []).length, 0)
  const guardrailHits = collectQualityGuardrailFindings(text)
    .filter((finding) => finding.code === 'object_category_mismatch' || finding.code === 'id_pollution')
    .length
  return clampPercent(((patternHits + guardrailHits) / sentences.length) * 40)
}

export function analyzeLanguageDrift(text: string): LanguageDriftMetrics {
  const normalized = normalizeText(text)
  const sentences = splitSentences(normalized)
  if (!normalized || sentences.length === 0) {
    return {
      abstractTokenDensity: 0,
      sentencePatternRepeatRate: 0,
      endingSummaryRate: 0,
      ornamentOverloadRate: 0,
      nonHumanCollocationRate: 0,
    }
  }

  return {
    abstractTokenDensity: analyzeAbstractTokenDensity(normalized, sentences),
    sentencePatternRepeatRate: analyzeSentencePatternRepeatRate(sentences),
    endingSummaryRate: analyzeEndingSummaryRate(sentences),
    ornamentOverloadRate: analyzeOrnamentOverloadRate(normalized, sentences),
    nonHumanCollocationRate: analyzeNonHumanCollocationRate(normalized, sentences),
  }
}
