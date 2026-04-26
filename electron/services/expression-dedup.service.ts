import { asc, eq, lte, lt } from 'drizzle-orm'
import type { ExpressionDedupHit, ExpressionDedupReport } from '../../src/types'
import { getDb } from '../database/db'
import { chapters } from '../database/schema'

type ChapterRow = typeof chapters.$inferSelect

const LOW_SIGNAL_FRAGMENTS = [
  '什么', '怎么', '不是', '可以', '知道', '自己', '然后', '于是', '就是', '但是',
]

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeClause(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[“”"'`]/g, '')
    .trim()
}

function splitClauses(content: string): string[] {
  return content
    .split(/[。！？；\n]/)
    .map((item) => normalizeClause(item))
    .filter((item) => item.length >= 4 && item.length <= 18)
}

function isLowSignal(fragment: string): boolean {
  if (!fragment) return true
  if (LOW_SIGNAL_FRAGMENTS.some((token) => fragment.includes(token) && fragment.length <= token.length + 3)) return true
  const uniqueChars = new Set(fragment.split(''))
  return uniqueChars.size <= 2
}

function collectPhraseHits(rows: ChapterRow[]): ExpressionDedupHit[] {
  const phraseMap = new Map<string, { count: number; chapterNums: Set<number> }>()
  rows.forEach((row) => {
    const chapterNum = row.chapterNum || 0
    splitClauses(asText(row.content))
      .filter((fragment) => !isLowSignal(fragment))
      .slice(0, 120)
      .forEach((fragment) => {
        const entry = phraseMap.get(fragment) || { count: 0, chapterNums: new Set<number>() }
        entry.count += 1
        entry.chapterNums.add(chapterNum)
        phraseMap.set(fragment, entry)
      })
  })
  return [...phraseMap.entries()]
    .map(([phrase, entry]) => ({
      phrase,
      count: entry.count,
      chapterNums: [...entry.chapterNums].sort((left, right) => left - right),
    }))
    .filter((entry) => entry.chapterNums.length >= 2 && entry.count >= 2)
    .sort((left, right) => right.count - left.count || right.chapterNums.length - left.chapterNums.length || left.phrase.localeCompare(right.phrase, 'zh-Hans-CN'))
    .slice(0, 8)
}

function buildOpeningSignature(content: string): string {
  const firstClause = splitClauses(content)[0] || ''
  return firstClause.slice(0, 12)
}

function buildClosingSignature(content: string): string {
  const clauses = splitClauses(content)
  const lastClause = clauses[clauses.length - 1] || ''
  return lastClause.slice(0, 12)
}

function deriveStructurePattern(content: string): string[] {
  const normalized = asText(content)
  if (!normalized) return []
  const sentences = normalized.split(/[。！？]/).map((item) => item.trim()).filter(Boolean)
  const opening = buildOpeningSignature(normalized)
  const closing = buildClosingSignature(normalized)
  const earlyAvg = (() => {
    const early = sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 3)))
    if (early.length === 0) return 0
    return early.reduce((sum, item) => sum + item.length, 0) / early.length
  })()
  const late = sentences.slice(-Math.max(1, Math.ceil(sentences.length / 3)))
  const lateShortRate = late.length > 0
    ? late.filter((item) => item.length <= 12).length / late.length
    : 0
  const quoteCount = (normalized.match(/[“”]/g) || []).length
  const environmentOpening = /风|雨|雪|雾|夜|光|阳光|月光|空气/u.test(opening)
  const suspenseClosing = /脚步|门外|忽然|骤然|问号|\?|？|血|来人/u.test(closing)
  return [
    earlyAvg >= 18 && lateShortRate >= 0.5 ? '长句蓄力后短句爆发' : '',
    quoteCount >= Math.max(4, sentences.length / 2) ? '对话推进' : '',
    environmentOpening ? '环境起手' : '',
    suspenseClosing ? '悬念收尾' : '',
  ].filter(Boolean)
}

function collectRepeatedSignatures(rows: ChapterRow[], pick: (content: string) => string): string[] {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    const signature = pick(asText(row.content))
    if (!signature || signature.length < 4 || isLowSignal(signature)) return
    counts.set(signature, (counts.get(signature) || 0) + 1)
  })
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .slice(0, 4)
    .map(([value]) => value)
}

function collectRepeatedStructures(rows: ChapterRow[]): string[] {
  const counts = new Map<string, number>()
  rows.forEach((row) => {
    deriveStructurePattern(asText(row.content)).forEach((pattern) => {
      counts.set(pattern, (counts.get(pattern) || 0) + 1)
    })
  })
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-Hans-CN'))
    .slice(0, 4)
    .map(([pattern]) => pattern)
}

function buildRiskLevel(
  repeatedPhrases: ExpressionDedupHit[],
  repeatedStructures: string[],
): ExpressionDedupReport['riskLevel'] {
  if (repeatedPhrases.filter((item) => item.count >= 3).length >= 2 || repeatedStructures.length >= 2) return 'high'
  if (repeatedPhrases.length > 0 || repeatedStructures.length > 0) return 'medium'
  return 'low'
}

function toSummary(report: Omit<ExpressionDedupReport, 'summary' | 'updatedAt'>): string {
  if (report.riskLevel === 'low') return '最近章节没有明显的跨章表达复用。'
  const topPhrase = report.repeatedPhrases[0]
  if (topPhrase) {
    return `最近章节出现跨章表达复用，最高频短句“${topPhrase.phrase}”已覆盖 ${topPhrase.chapterNums.length} 章。`
  }
  return '最近章节出现结构层复用，建议轮换章首/章尾和高潮写法。'
}

function listRowsForWindow(novelId: number, chapterNum: number, includeCurrent: boolean): ChapterRow[] {
  const db = getDb()
  const rows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((row) => includeCurrent ? row.chapterNum <= chapterNum : row.chapterNum < chapterNum)
    .filter((row) => asText(row.content))
  return rows.slice(-10)
}

export function analyzeExpressionDedupForGeneration(
  novelId: number,
  chapterNum: number,
): ExpressionDedupReport {
  const rows = listRowsForWindow(novelId, chapterNum, false)
  const repeatedPhrases = collectPhraseHits(rows)
  const repeatedOpenings = collectRepeatedSignatures(rows, buildOpeningSignature)
  const repeatedClosings = collectRepeatedSignatures(rows, buildClosingSignature)
  const repeatedStructuralPatterns = collectRepeatedStructures(rows)
  const riskLevel = buildRiskLevel(repeatedPhrases, repeatedStructuralPatterns)
  const bannedExpressions = repeatedPhrases.filter((item) => item.count >= 3).slice(0, 5).map((item) => item.phrase)
  const guidance = [
    bannedExpressions.length > 0 ? `本章避免复用这些已高频出现的表达：${bannedExpressions.join('、')}` : '',
    repeatedStructuralPatterns.length > 0 ? `最近结构复用偏高：${repeatedStructuralPatterns.join('、')}，本章请主动换开场/收尾节拍。` : '',
    repeatedOpenings.length > 0 ? `最近章首起手偏同质：${repeatedOpenings.join('、')}。` : '',
    repeatedClosings.length > 0 ? `最近章尾收束偏同质：${repeatedClosings.join('、')}。` : '',
  ].filter(Boolean)
  const reportBase = {
    riskLevel,
    repeatedPhrases,
    repeatedOpenings,
    repeatedClosings,
    repeatedStructuralPatterns,
    bannedExpressions,
    guidance,
  }
  return {
    ...reportBase,
    summary: toSummary(reportBase),
    updatedAt: new Date().toISOString(),
  }
}

export function analyzeExpressionDedupForChapter(chapterId: number): ExpressionDedupReport | null {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null
  return analyzeExpressionDedupForGeneration(chapter.novelId, chapter.chapterNum + 1)
}

export function formatExpressionDedupGuidance(report: ExpressionDedupReport | null | undefined): string {
  if (!report) return ''
  return [
    `跨章表达风险：${report.riskLevel}`,
    report.summary,
    report.bannedExpressions.length > 0 ? `禁复用表达：${report.bannedExpressions.join('、')}` : '',
    report.repeatedStructuralPatterns.length > 0 ? `高频结构：${report.repeatedStructuralPatterns.join('、')}` : '',
    ...report.guidance,
  ].filter(Boolean).join('\n')
}
