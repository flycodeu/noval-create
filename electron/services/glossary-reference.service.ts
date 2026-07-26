/**
 * lore 词条引用检测服务。
 *
 * 1. scanChapterForGlossaryTerms：把词条（term+aliases 多词 indexOf 匹配）在单章正文
 *    中的命中写入 glossary_term_references，按章先删后插保持幂等；
 * 2. scanNovelGlossaryReferences：全书全量扫（IPC glossary:scanReferences）；
 * 3. getGlossaryUsageReport：每词条 totalHits / lastChapterNum / chaptersSinceLastHit / unused；
 * 4. suggestMissingTerms：本地高频专名提取（CJK n-gram 频次），过滤已入词典/已建档实体，
 *    给出未入词典候选 top8——不走 AI、无副作用，可离线复跑。
 *
 * 挂载点：chapter.service finalizeGeneratedChapterContent 尾部 fire-and-forget 调用单章扫描。
 */
import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, characters, glossaryTermReferences, storyItems } from '../database/schema'
import { parseGlossaryAliases } from '../../src/shared/glossary'
import { listGlossary } from './glossary.service'

export interface GlossaryScanEntry {
  id: number
  term: string
  aliasesJson?: string | null
}

export interface GlossaryTermMatch {
  glossaryId: number
  hitCount: number
}

export interface GlossaryScanResult {
  scannedChapters: number
  termCount: number
  matchedTermCount: number
  totalHits: number
}

export interface GlossaryUsageReportItem {
  glossaryId: number
  term: string
  category?: string
  totalHits: number
  chapterCount: number
  lastChapterNum: number | null
  chaptersSinceLastHit: number | null
  unused: boolean
}

export interface GlossaryUsageReport {
  novelId: number
  latestChapterNum: number
  items: GlossaryUsageReportItem[]
}

export interface MissingTermSuggestion {
  term: string
  count: number
}

/** 词条的全部检索词（term + 别名），去重、去空、至少 2 字。 */
export function collectTermNeedles(entry: GlossaryScanEntry): string[] {
  const needles = [entry.term, ...parseGlossaryAliases(entry.aliasesJson)]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length >= 2)
  return [...new Set(needles)]
}

function countNeedleHits(content: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = content.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = content.indexOf(needle, index + needle.length)
  }
  return count
}

/** 纯函数：多词 indexOf 匹配，返回每个词条在正文中的总命中数（0 命中不返回）。 */
export function matchGlossaryTermsInContent(entries: GlossaryScanEntry[], content: string): GlossaryTermMatch[] {
  if (!content.trim()) return []
  const matches: GlossaryTermMatch[] = []
  for (const entry of entries) {
    const hitCount = collectTermNeedles(entry)
      .reduce((sum, needle) => sum + countNeedleHits(content, needle), 0)
    if (hitCount > 0) matches.push({ glossaryId: entry.id, hitCount })
  }
  return matches
}

function replaceChapterReferences(
  db: ReturnType<typeof getDb>,
  input: { novelId: number; chapterId: number; chapterNum: number },
  matches: GlossaryTermMatch[],
): void {
  db.delete(glossaryTermReferences).where(eq(glossaryTermReferences.chapterId, input.chapterId)).run()
  for (const match of matches) {
    db.insert(glossaryTermReferences).values({
      novelId: input.novelId,
      glossaryId: match.glossaryId,
      chapterId: input.chapterId,
      chapterNum: input.chapterNum,
      hitCount: match.hitCount,
    }).run()
  }
}

/** 单章扫描：按章删插，重复调用结果一致（幂等）。 */
export function scanChapterForGlossaryTerms(novelId: number, chapterId: number): GlossaryScanResult {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || chapter.novelId !== novelId) {
    return { scannedChapters: 0, termCount: 0, matchedTermCount: 0, totalHits: 0 }
  }

  const entries = listGlossary(novelId)
  const matches = matchGlossaryTermsInContent(entries, chapter.content || '')
  replaceChapterReferences(db, { novelId, chapterId, chapterNum: chapter.chapterNum }, matches)

  return {
    scannedChapters: 1,
    termCount: entries.length,
    matchedTermCount: matches.length,
    totalHits: matches.reduce((sum, match) => sum + match.hitCount, 0),
  }
}

/** 全书全量扫描（IPC glossary:scanReferences）。 */
export function scanNovelGlossaryReferences(novelId: number): GlossaryScanResult {
  const db = getDb()
  const entries = listGlossary(novelId)
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()

  let scannedChapters = 0
  let totalHits = 0
  const matchedTermIds = new Set<number>()
  for (const chapter of chapterRows) {
    const matches = matchGlossaryTermsInContent(entries, chapter.content || '')
    replaceChapterReferences(db, { novelId, chapterId: chapter.id, chapterNum: chapter.chapterNum }, matches)
    scannedChapters += 1
    for (const match of matches) {
      matchedTermIds.add(match.glossaryId)
      totalHits += match.hitCount
    }
  }

  return {
    scannedChapters,
    termCount: entries.length,
    matchedTermCount: matchedTermIds.size,
    totalHits,
  }
}

/** 纯函数：由引用行计算每词条的使用统计与断代。 */
export function computeGlossaryUsageReport(
  entries: Array<GlossaryScanEntry & { category?: string }>,
  references: Array<{ glossaryId: number; chapterNum: number; hitCount: number }>,
  latestChapterNum: number,
): GlossaryUsageReportItem[] {
  const byGlossaryId = new Map<number, Array<{ chapterNum: number; hitCount: number }>>()
  for (const reference of references) {
    const list = byGlossaryId.get(reference.glossaryId) || []
    list.push(reference)
    byGlossaryId.set(reference.glossaryId, list)
  }

  return entries.map((entry) => {
    const rows = byGlossaryId.get(entry.id) || []
    const totalHits = rows.reduce((sum, row) => sum + row.hitCount, 0)
    const lastChapterNum = rows.length > 0 ? Math.max(...rows.map((row) => row.chapterNum)) : null
    return {
      glossaryId: entry.id,
      term: entry.term,
      category: entry.category,
      totalHits,
      chapterCount: new Set(rows.map((row) => row.chapterNum)).size,
      lastChapterNum,
      chaptersSinceLastHit: lastChapterNum === null ? null : Math.max(0, latestChapterNum - lastChapterNum),
      unused: totalHits === 0,
    }
  })
}

export function getGlossaryUsageReport(novelId: number): GlossaryUsageReport {
  const db = getDb()
  const entries = listGlossary(novelId)
  const references = db.select().from(glossaryTermReferences)
    .where(eq(glossaryTermReferences.novelId, novelId))
    .all()
  const chapterRows = db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
  const latestChapterNum = chapterRows
    .filter((chapter) => typeof chapter.content === 'string' && chapter.content.trim())
    .reduce((max, chapter) => Math.max(max, chapter.chapterNum), 0)

  return {
    novelId,
    latestChapterNum,
    items: computeGlossaryUsageReport(entries, references, latestChapterNum),
  }
}

// 高频专名提取：n-gram 边界不允许出现的功能字（虚词/代词/常用副词）。
const CJK_FUNCTION_CHARS = new Set('的了是在有和与就都又被把从向对着么呢吗啊吧也很还没不太更曾并将该这那你我他她它们哪谁个之其却如若及以于为等所可能会要来去过上下里外中前后间时候里面'.split(''))

function isViableCandidate(candidate: string): boolean {
  if (candidate.length < 2) return false
  if (CJK_FUNCTION_CHARS.has(candidate[0]) || CJK_FUNCTION_CHARS.has(candidate[candidate.length - 1])) return false
  // 中段全是功能字的组合（如“的了”）也不可能是专名
  return [...candidate].some((char) => !CJK_FUNCTION_CHARS.has(char))
}

/**
 * 纯函数：从正文提取高频候选专名（2-4 字 CJK n-gram，默认出现 >=3 次），
 * 过滤功能字边界、已知名单（词典词条/别名、角色名、物品名），
 * 相互包含时保留更长且频次相近的候选。
 */
export function extractCandidateProperNouns(
  content: string,
  options: { knownNames?: string[]; limit?: number; minCount?: number } = {},
): MissingTermSuggestion[] {
  const limit = Math.max(1, options.limit ?? 8)
  const minCount = Math.max(2, options.minCount ?? 3)
  const knownNames = (options.knownNames || []).map((name) => name.trim()).filter(Boolean)
  if (!content.trim()) return []

  const runs = content.match(/[㐀-䶿一-鿿]+/g) || []
  const counts = new Map<string, number>()
  for (const run of runs) {
    for (let size = 2; size <= 4; size += 1) {
      for (let start = 0; start + size <= run.length; start += 1) {
        const gram = run.slice(start, start + size)
        if (!isViableCandidate(gram)) continue
        counts.set(gram, (counts.get(gram) || 0) + 1)
      }
    }
  }

  let candidates = [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .map(([term, count]) => ({ term, count }))

  // 过滤已知名单：候选与已知名互相包含都算已覆盖
  candidates = candidates.filter(({ term }) => !knownNames.some(
    (known) => known.includes(term) || term.includes(known),
  ))

  // 子串折叠：存在更长候选包含它、且长候选频次达到其 60% 时，丢弃短候选
  candidates = candidates.filter(({ term, count }) => !candidates.some(
    (other) => other.term.length > term.length
      && other.term.includes(term)
      && other.count >= Math.ceil(count * 0.6),
  ))

  return candidates
    .sort((a, b) => b.count - a.count || b.term.length - a.term.length || a.term.localeCompare(b.term))
    .slice(0, limit)
}

/** 本章未入词典的高频专名候选 top8（角色/物品等已建档实体一并过滤）。 */
export function suggestMissingTerms(novelId: number, chapterId: number): MissingTermSuggestion[] {
  const db = getDb()
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).all()[0]
  if (!chapter || chapter.novelId !== novelId) return []

  const entries = listGlossary(novelId)
  const knownNames = [
    ...entries.flatMap((entry) => collectTermNeedles(entry)),
    ...db.select().from(characters).where(eq(characters.novelId, novelId)).all()
      .map((row) => row.fullName || ''),
    ...db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
      .map((row) => row.itemName || ''),
  ].filter(Boolean)

  return extractCandidateProperNouns(chapter.content || '', { knownNames, limit: 8 })
}
