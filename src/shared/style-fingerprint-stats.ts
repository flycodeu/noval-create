import { analyzeLanguageDrift, type LanguageDriftMetrics } from './language-drift'

/**
 * Canonical prose segmentation + deterministic style statistics.
 *
 * Both the style fingerprint (what we ask the writer to imitate) and the
 * style compliance check (how we verify the output) MUST use these splitters —
 * two diverging tokenizers made fingerprints and compliance scores disagree
 * with each other. language-drift keeps its internal splitter because its 11
 * drift metrics are threshold-calibrated against it.
 */

export function splitProseParagraphs(content: string): string[] {
  return content
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function splitProseSentences(content: string): string[] {
  return content
    .replace(/\r/g, '')
    .split(/[。！？!?]+|\n+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

export function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim()
  if (!trimmed) return false
  return /^[“"「『]/.test(trimmed) || /^[^，。！？!?]{1,18}[：:]/.test(trimmed)
}

export interface SentenceLengthHistogram {
  /** Percentages by length bucket, summing to ~100. */
  short: number
  medium: number
  long: number
  xlong: number
}

export interface StyleStats {
  totalChars: number
  sentenceCount: number
  paragraphCount: number
  avgSentenceLength: number
  sentenceLengthStdev: number
  avgParagraphLength: number
  /** Percent of paragraphs that are dialogue lines. */
  dialogueLineRate: number
  sentenceLengthHistogram: SentenceLengthHistogram
  drift: LanguageDriftMetrics
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function charLength(value: string): number {
  return value.replace(/\s+/g, '').length
}

export function computeStyleStats(text: string): StyleStats {
  const content = String(text || '')
  const sentences = splitProseSentences(content)
  const paragraphs = splitProseParagraphs(content)
  const totalChars = charLength(content)

  const sentenceLengths = sentences.map(charLength)
  const avgSentenceLength = sentenceLengths.length > 0
    ? sentenceLengths.reduce((sum, item) => sum + item, 0) / sentenceLengths.length
    : 0
  const sentenceVariance = sentenceLengths.length > 0
    ? sentenceLengths.reduce((sum, item) => sum + (item - avgSentenceLength) ** 2, 0) / sentenceLengths.length
    : 0

  const buckets = { short: 0, medium: 0, long: 0, xlong: 0 }
  sentenceLengths.forEach((length) => {
    if (length <= 12) buckets.short += 1
    else if (length <= 24) buckets.medium += 1
    else if (length <= 40) buckets.long += 1
    else buckets.xlong += 1
  })
  const bucketBase = Math.max(sentenceLengths.length, 1)

  const dialogueParagraphCount = paragraphs.filter(isDialogueParagraph).length

  return {
    totalChars,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    avgSentenceLength: round1(avgSentenceLength),
    sentenceLengthStdev: round1(Math.sqrt(sentenceVariance)),
    avgParagraphLength: round1(
      paragraphs.length > 0
        ? paragraphs.reduce((sum, item) => sum + charLength(item), 0) / paragraphs.length
        : 0,
    ),
    dialogueLineRate: round1(paragraphs.length > 0 ? (dialogueParagraphCount / paragraphs.length) * 100 : 0),
    sentenceLengthHistogram: {
      short: round1((buckets.short / bucketBase) * 100),
      medium: round1((buckets.medium / bucketBase) * 100),
      long: round1((buckets.long / bucketBase) * 100),
      xlong: round1((buckets.xlong / bucketBase) * 100),
    },
    drift: analyzeLanguageDrift(content),
  }
}

/** Render stats as a compact prompt section describing target ranges. */
export function formatStyleStatsForPrompt(stats: StyleStats, label = '风格参考样本'): string {
  return [
    `【${label} · 程序统计（生成时向这些区间靠拢）】`,
    `- 平均句长约 ${stats.avgSentenceLength} 字（波动 ±${stats.sentenceLengthStdev}），句长分布：短句 ${stats.sentenceLengthHistogram.short}% / 中句 ${stats.sentenceLengthHistogram.medium}% / 长句 ${stats.sentenceLengthHistogram.long}% / 超长句 ${stats.sentenceLengthHistogram.xlong}%`,
    `- 平均段长约 ${stats.avgParagraphLength} 字，对白段占比约 ${stats.dialogueLineRate}%`,
  ].join('\n')
}
