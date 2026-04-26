import { asc, eq } from 'drizzle-orm'
import type { ExpressionDedupHit, ExpressionDedupMode, ExpressionDedupReport } from '../../src/types'
import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'

type ChapterRow = typeof chapters.$inferSelect

type ExpressionDedupWindowStrategy = Pick<
  ExpressionDedupReport,
  'mode' | 'recentWindowSize' | 'volumeWindowSize' | 'globalSampleWindowSize'
>

type ExpressionDedupReportBase = Omit<ExpressionDedupReport, 'guidance' | 'summary' | 'updatedAt'>

const LOW_SIGNAL_FRAGMENTS = [
  '什么', '怎么', '不是', '可以', '知道', '自己', '然后', '于是', '就是', '但是',
]

const OPENING_ROTATION_SUGGESTIONS = ['动作直入', '对话直入', '物件特写', '时间跳切']
const CLOSING_ROTATION_SUGGESTIONS = ['行动中断', '第三人入场', '画面定格', '环境归静']
const CLIMAX_ROTATION_SUGGESTIONS = ['平静揭露', '旁观者切入', '感官先行', '对话推进后动作爆发']

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeStrings(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  values.forEach((value) => {
    const normalized = asText(value)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return typeof limit === 'number' ? result.slice(0, limit) : result
}

function dedupeChapterNums(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))].sort((left, right) => left - right)
}

function dedupeRows(rows: ChapterRow[]): ChapterRow[] {
  const seen = new Set<number>()
  return rows.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })
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

function resolveMode(targetWords: number, chapterCount: number): ExpressionDedupMode {
  return targetWords >= 350000 || chapterCount >= 80 ? 'longform' : 'short'
}

function resolveWindowStrategy(targetWords: number, chapterCount: number): ExpressionDedupWindowStrategy {
  if (targetWords >= 1500000 || chapterCount >= 600) {
    return { mode: 'longform', recentWindowSize: 24, volumeWindowSize: 48, globalSampleWindowSize: 96 }
  }
  if (targetWords >= 1000000 || chapterCount >= 400) {
    return { mode: 'longform', recentWindowSize: 22, volumeWindowSize: 40, globalSampleWindowSize: 84 }
  }
  if (targetWords >= 800000 || chapterCount >= 280) {
    return { mode: 'longform', recentWindowSize: 20, volumeWindowSize: 36, globalSampleWindowSize: 72 }
  }
  if (targetWords >= 500000 || chapterCount >= 180) {
    return { mode: 'longform', recentWindowSize: 18, volumeWindowSize: 30, globalSampleWindowSize: 60 }
  }
  if (resolveMode(targetWords, chapterCount) === 'longform') {
    return { mode: 'longform', recentWindowSize: 15, volumeWindowSize: 24, globalSampleWindowSize: 48 }
  }
  return { mode: 'short', recentWindowSize: 10, volumeWindowSize: 12, globalSampleWindowSize: 20 }
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

function mergePhraseHits(...lists: ExpressionDedupHit[][]): ExpressionDedupHit[] {
  const merged = new Map<string, ExpressionDedupHit>()
  lists.flat().forEach((entry) => {
    const current = merged.get(entry.phrase)
    if (!current) {
      merged.set(entry.phrase, {
        phrase: entry.phrase,
        count: entry.count,
        chapterNums: dedupeChapterNums(entry.chapterNums),
      })
      return
    }
    merged.set(entry.phrase, {
      phrase: entry.phrase,
      count: Math.max(current.count, entry.count),
      chapterNums: dedupeChapterNums([...current.chapterNums, ...entry.chapterNums]),
    })
  })
  return [...merged.values()]
    .sort((left, right) => right.count - left.count || right.chapterNums.length - left.chapterNums.length || left.phrase.localeCompare(right.phrase, 'zh-Hans-CN'))
    .slice(0, 8)
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

function isClimaxLikeRow(row: ChapterRow): boolean {
  const haystack = `${asText(row.emotionTone)} ${asText(row.outline)}`
  return /climax|reversal|高潮|决战|爆发|反转|翻盘|揭露/u.test(haystack)
}

function collectRepeatedClimaxPatterns(rows: ChapterRow[]): string[] {
  const climaxRows = rows.filter(isClimaxLikeRow)
  if (climaxRows.length < 2) return []
  return collectRepeatedStructures(climaxRows)
}

function buildWindowPatternSummary(
  repeatedOpenings: string[],
  repeatedClosings: string[],
  repeatedStructures: string[],
  repeatedClimaxPatterns: string[],
): string[] {
  return dedupeStrings([
    ...repeatedStructures,
    ...repeatedClimaxPatterns.map((item) => `高潮：${item}`),
    ...repeatedOpenings.map((item) => `章首：${item}`),
    ...repeatedClosings.map((item) => `章尾：${item}`),
  ], 6)
}

function buildRiskLevel(
  repeatedPhrases: ExpressionDedupHit[],
  repeatedStructures: string[],
  repeatedClimaxPatterns: string[],
): ExpressionDedupReport['riskLevel'] {
  const strongPhraseCount = repeatedPhrases.filter((item) => item.count >= 3 || item.chapterNums.length >= 3).length
  if (strongPhraseCount >= 2 || repeatedStructures.length >= 2 || repeatedClimaxPatterns.length >= 2) return 'high'
  if (repeatedPhrases.length > 0 || repeatedStructures.length > 0 || repeatedClimaxPatterns.length > 0) return 'medium'
  return 'low'
}

function sampleRowsAcrossHistory(rows: ChapterRow[], maxSize: number): ChapterRow[] {
  if (rows.length <= maxSize) return rows
  const tailKeep = Math.max(4, Math.min(10, Math.floor(maxSize / 3)))
  const historyBudget = Math.max(maxSize - tailKeep, 0)
  const headRows = rows.slice(0, Math.max(rows.length - tailKeep, 0))
  const tailRows = rows.slice(-tailKeep)
  if (historyBudget <= 0 || headRows.length === 0) return tailRows

  const sampledHead: ChapterRow[] = []
  if (historyBudget === 1) {
    sampledHead.push(headRows[0])
  } else {
    for (let index = 0; index < historyBudget; index += 1) {
      const sampleIndex = Math.floor((index * Math.max(headRows.length - 1, 0)) / Math.max(historyBudget - 1, 1))
      sampledHead.push(headRows[sampleIndex])
    }
  }
  return dedupeRows([...sampledHead, ...tailRows]).sort((left, right) => left.chapterNum - right.chapterNum)
}

function selectRecentRows(rows: ChapterRow[], strategy: ExpressionDedupWindowStrategy): ChapterRow[] {
  return rows.slice(-strategy.recentWindowSize)
}

function selectVolumeRows(
  rows: ChapterRow[],
  currentVolumeId: number | null,
  strategy: ExpressionDedupWindowStrategy,
): ChapterRow[] {
  const scopedRows = typeof currentVolumeId === 'number'
    ? rows.filter((row) => row.volumeId === currentVolumeId)
    : rows
  return scopedRows.slice(-strategy.volumeWindowSize)
}

function selectGlobalRows(rows: ChapterRow[], strategy: ExpressionDedupWindowStrategy): ChapterRow[] {
  return sampleRowsAcrossHistory(rows, strategy.globalSampleWindowSize)
}

function listRowsForAnalysis(
  novelId: number,
  referenceChapterNum: number,
  options: {
    includeCurrent?: boolean
    currentVolumeId?: number | null
  } = {},
): {
  rows: ChapterRow[]
  currentVolumeId: number | null
  strategy: ExpressionDedupWindowStrategy
} {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0] || null
  const allRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const rows = allRows
    .filter((row) => options.includeCurrent ? row.chapterNum <= referenceChapterNum : row.chapterNum < referenceChapterNum)
    .filter((row) => asText(row.content))
  const currentChapter = allRows.find((row) => row.chapterNum === referenceChapterNum) || null
  const currentVolumeId = typeof options.currentVolumeId === 'number'
    ? options.currentVolumeId
    : currentChapter?.volumeId ?? rows.at(-1)?.volumeId ?? null
  const strategy = resolveWindowStrategy(Number(novel?.targetWords || 0), rows.length)
  return { rows, currentVolumeId, strategy }
}

function selectBannedExpressions(
  mode: ExpressionDedupMode,
  recentPhraseHits: ExpressionDedupHit[],
  volumePhraseHits: ExpressionDedupHit[],
  globalPhraseHits: ExpressionDedupHit[],
): string[] {
  return dedupeStrings([
    ...recentPhraseHits.filter((item) => item.count >= 2).map((item) => item.phrase),
    ...volumePhraseHits.filter((item) => item.count >= 3 || item.chapterNums.length >= 3).map((item) => item.phrase),
    ...(mode === 'longform'
      ? globalPhraseHits.filter((item) => item.chapterNums.length >= 4).map((item) => item.phrase)
      : []),
  ], 6)
}

function toSummary(report: ExpressionDedupReportBase): string {
  const modeSummary = report.mode === 'longform'
    ? `长篇模式已启用（近章 ${report.recentWindowSize} / 当前卷 ${report.volumeWindowSize} / 全书采样 ${report.globalSampleWindowSize}）。`
    : `当前按最近 ${report.recentWindowSize} 章执行短篇去重。`
  if (report.riskLevel === 'low') return `${modeSummary} 最近没有明显的跨章表达复用。`
  const topPhrase = report.repeatedPhrases[0]
  if (topPhrase) {
    return `${modeSummary} 最高频短句“${topPhrase.phrase}”已覆盖 ${topPhrase.chapterNums.length} 章。`
  }
  return `${modeSummary} 最近结构层复用偏高，建议轮换章首、章尾和高潮写法。`
}

function buildGuidance(report: ExpressionDedupReportBase): string[] {
  return [
    report.mode === 'longform'
      ? `当前为长篇去重模式：近章 ${report.recentWindowSize} 章直接禁复用，当前卷 ${report.volumeWindowSize} 章做轮换提醒，全书采样 ${report.globalSampleWindowSize} 章只记长期同质化风险。`
      : `当前为短篇去重模式：重点盯最近 ${report.recentWindowSize} 章，避免临近章节直接复用表达。`,
    report.bannedExpressions.length > 0
      ? `本章必须避免复用这些已高频出现的表达：${report.bannedExpressions.join('、')}`
      : '',
    report.repeatedStructuralPatterns.length > 0
      ? `最近结构复用偏高：${report.repeatedStructuralPatterns.join('、')}，本章请主动换开场、推进和收尾节拍。`
      : '',
    report.repeatedOpenings.length > 0
      ? `最近章首起手偏同质：${report.repeatedOpenings.join('、')}。本章优先改用 ${OPENING_ROTATION_SUGGESTIONS.join('、')}。`
      : '',
    report.repeatedClosings.length > 0
      ? `最近章尾收束偏同质：${report.repeatedClosings.join('、')}。本章优先改用 ${CLOSING_ROTATION_SUGGESTIONS.join('、')}。`
      : '',
    report.repeatedClimaxPatterns.length > 0
      ? `高潮结构近章/卷内复用偏高：${report.repeatedClimaxPatterns.join('、')}。本章高潮优先改用 ${CLIMAX_ROTATION_SUGGESTIONS.join('、')}。`
      : '',
    report.mode === 'longform' && report.volumeRepeatedPatterns.length > 0
      ? `当前卷同质化重点：${report.volumeRepeatedPatterns.join('、')}。卷内优先轮换这些写法。`
      : '',
    report.mode === 'longform' && report.globalRepeatedPatterns.length > 0
      ? `全书级同质化提示：${report.globalRepeatedPatterns.join('、')}。这类写法不要在后续批次继续累积。`
      : '',
  ].filter(Boolean)
}

export function analyzeExpressionDedupForGeneration(
  novelId: number,
  chapterNum: number,
  options: {
    currentVolumeId?: number | null
    includeCurrent?: boolean
  } = {},
): ExpressionDedupReport {
  const analysis = listRowsForAnalysis(novelId, chapterNum, options)
  const recentRows = selectRecentRows(analysis.rows, analysis.strategy)
  const volumeRows = selectVolumeRows(analysis.rows, analysis.currentVolumeId, analysis.strategy)
  const globalRows = selectGlobalRows(analysis.rows, analysis.strategy)

  const recentPhraseHits = collectPhraseHits(recentRows)
  const volumePhraseHits = collectPhraseHits(volumeRows)
  const globalPhraseHits = collectPhraseHits(globalRows)
  const repeatedPhrases = mergePhraseHits(recentPhraseHits, volumePhraseHits, globalPhraseHits)

  const recentOpenings = collectRepeatedSignatures(recentRows, buildOpeningSignature)
  const recentClosings = collectRepeatedSignatures(recentRows, buildClosingSignature)
  const volumeOpenings = collectRepeatedSignatures(volumeRows, buildOpeningSignature)
  const volumeClosings = collectRepeatedSignatures(volumeRows, buildClosingSignature)
  const globalOpenings = collectRepeatedSignatures(globalRows, buildOpeningSignature)
  const globalClosings = collectRepeatedSignatures(globalRows, buildClosingSignature)

  const recentStructuralPatterns = collectRepeatedStructures(recentRows)
  const volumeStructuralPatterns = collectRepeatedStructures(volumeRows)
  const globalStructuralPatterns = collectRepeatedStructures(globalRows)
  const recentClimaxPatterns = collectRepeatedClimaxPatterns(recentRows)
  const volumeClimaxPatterns = collectRepeatedClimaxPatterns(volumeRows)
  const globalClimaxPatterns = collectRepeatedClimaxPatterns(globalRows)

  const repeatedOpenings = dedupeStrings([...recentOpenings, ...volumeOpenings], 4)
  const repeatedClosings = dedupeStrings([...recentClosings, ...volumeClosings], 4)
  const repeatedStructuralPatterns = dedupeStrings([...recentStructuralPatterns, ...volumeStructuralPatterns], 6)
  const repeatedClimaxPatterns = dedupeStrings([...recentClimaxPatterns, ...volumeClimaxPatterns], 4)
  const volumeRepeatedPatterns = buildWindowPatternSummary(volumeOpenings, volumeClosings, volumeStructuralPatterns, volumeClimaxPatterns)
  const globalRepeatedPatterns = buildWindowPatternSummary(globalOpenings, globalClosings, globalStructuralPatterns, globalClimaxPatterns)
  const bannedExpressions = selectBannedExpressions(analysis.strategy.mode, recentPhraseHits, volumePhraseHits, globalPhraseHits)
  const riskLevel = buildRiskLevel(repeatedPhrases, repeatedStructuralPatterns, repeatedClimaxPatterns)
  const reportBase = {
    mode: analysis.strategy.mode,
    recentWindowSize: analysis.strategy.recentWindowSize,
    volumeWindowSize: analysis.strategy.volumeWindowSize,
    globalSampleWindowSize: analysis.strategy.globalSampleWindowSize,
    riskLevel,
    repeatedPhrases,
    repeatedOpenings,
    repeatedClosings,
    repeatedStructuralPatterns,
    repeatedClimaxPatterns,
    volumeRepeatedPatterns,
    globalRepeatedPatterns,
    bannedExpressions,
  }
  return {
    ...reportBase,
    guidance: buildGuidance(reportBase),
    summary: toSummary(reportBase),
    updatedAt: new Date().toISOString(),
  }
}

export function analyzeExpressionDedupForChapter(chapterId: number): ExpressionDedupReport | null {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter) return null
  return analyzeExpressionDedupForGeneration(chapter.novelId, chapter.chapterNum, {
    currentVolumeId: chapter.volumeId ?? null,
    includeCurrent: true,
  })
}

export function formatExpressionDedupGuidance(report: ExpressionDedupReport | null | undefined): string {
  if (!report) return ''
  return [
    `跨章表达风险：${report.riskLevel}`,
    `当前策略：${report.mode === 'longform' ? '长篇' : '短篇'}（近章 ${report.recentWindowSize} / 当前卷 ${report.volumeWindowSize} / 全书采样 ${report.globalSampleWindowSize}）`,
    report.summary,
    report.bannedExpressions.length > 0 ? `禁复用表达：${report.bannedExpressions.join('、')}` : '',
    report.repeatedStructuralPatterns.length > 0 ? `高频结构：${report.repeatedStructuralPatterns.join('、')}` : '',
    report.repeatedClimaxPatterns.length > 0 ? `高潮复用：${report.repeatedClimaxPatterns.join('、')}` : '',
    ...report.guidance,
  ].filter(Boolean).join('\n')
}
