import { stableHash, type ContextPackSource } from '../../src/shared/context-pack'
import { estimateTokens } from '../../src/shared/token-budget'
import { projectPreviousChapterSources, type ContextVisibilityPolicy } from './context-visibility'
import { extractEmbeddingKeywords, fallbackKeywordSearch, isProseEmbeddingFragment, searchSimilarFragments, type SimilarFragmentHit } from './embedding.service'

const MAX_SEARCH_HITS = 24
const MAX_RECALLED_PARAGRAPHS = 6
const MAX_PARAGRAPHS_PER_CHAPTER = 2
const MAX_RECALL_TOKENS = 1800

export interface RecallChapter {
  id: number
  chapterNum: number
  content?: string | null
}

/** Separate signals keep a long generic request from exhausting the lexical query. */
export function creativeChapterRecallQuery(signals: string[]): string {
  const terms = signals.filter(Boolean).flatMap(signal => extractEmbeddingKeywords(signal, 6))
  return [...new Set(terms)].slice(0, 24).join(' ')
}

function normalize(text: string): string { return text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase() }

/** Indexed summaries/plans never become evidence: only complete current saved prose paragraphs do. */
export async function recallCreativeChapterSources(input: {
  novelId: number
  chapterNum: number
  previousChapterId?: number
  queryText: string
  chapters: RecallChapter[]
  policy: ContextVisibilityPolicy
  maxInputTokens: number
  modelConfigId?: number
}): Promise<{ sources: ContextPackSource[]; omitted: string[] }> {
  const sources: ContextPackSource[] = []
  const omitted: string[] = []
  const budget = Math.max(0, Math.min(MAX_RECALL_TOKENS, Math.floor(input.maxInputTokens * 0.12)))
  const eligible = new Map(input.chapters.filter(chapter => chapter.chapterNum > 0 && chapter.chapterNum < input.chapterNum
    && chapter.id !== input.previousChapterId && Boolean(chapter.content?.trim())).map(chapter => [chapter.id, chapter]))
  if (!budget || !eligible.size || !input.queryText.trim()) return { sources, omitted }
  const previous = input.chapters.find(chapter => chapter.id === input.previousChapterId)
  const beforeChapterNum = previous?.chapterNum || input.chapterNum
  let hits: SimilarFragmentHit[]
  try {
    const result = await searchSimilarFragments(input.novelId, input.queryText, MAX_SEARCH_HITS, input.modelConfigId, { beforeChapterNum })
    hits = result.hits
    if (result.fallbackReason) omitted.push(`chapter_recall:vector_unavailable:${result.fallbackReason}`)
    // A vector shortlist can be dominated by planning fragments. The existing bounded SQL
    // fallback also reads saved prose when embedding rows have not been generated yet.
    if (!hits.some(hit => isProseEmbeddingFragment(hit.fragmentType) && eligible.has(hit.chapterId))) {
      hits = fallbackKeywordSearch(input.novelId, input.queryText, MAX_SEARCH_HITS, { beforeChapterNum })
    }
  } catch {
    try { hits = fallbackKeywordSearch(input.novelId, input.queryText, MAX_SEARCH_HITS, { beforeChapterNum }) }
    catch { return { sources, omitted: ['chapter_recall:search_unavailable'] } }
  }
  const keywords = extractEmbeddingKeywords(input.queryText)
  const ranked: Array<{ source: ContextPackSource; chapterId: number; score: number }> = []
  const seenSources = new Set<string>()
  for (const hit of hits) {
    const chapter = eligible.get(hit.chapterId)
    if (!chapter || hit.chapterNum !== chapter.chapterNum || hit.chapterNum >= beforeChapterNum || !isProseEmbeddingFragment(hit.fragmentType)
      || hit.similarity <= 0 || hit.searchMode === 'vector' && hit.similarity < 0.25) continue
    const excerpt = normalize(hit.fragmentText)
    for (const projected of projectPreviousChapterSources(chapter, input.policy, input.queryText, keywords)) {
      const key = `chapter:${chapter.id}:recall:${projected.start}`
      if (seenSources.has(key)) continue
      const text = chapter.content!.slice(projected.start!, projected.end!)
      const normalized = normalize(text)
      const lexical = keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? Math.min(4, keyword.length) : 0), 0)
      // Verify a vector hit against current text, so stale index text is never copied back.
      const excerptMatch = normalized.length >= 8 && excerpt.includes(normalized.slice(0, Math.min(24, normalized.length)))
      if (!lexical && !(hit.searchMode === 'vector' && excerptMatch)) continue
      seenSources.add(key)
      if (!projected.included && projected.reason !== 'unclassified_visibility') {
        omitted.push(`${key}:${projected.reason}`); continue
      }
      const source: ContextPackSource = { ...projected, key, sourceKind: 'recalled_chapter_original', sourceId: String(chapter.id),
        sourceVersion: stableHash(chapter.content), text, included: true, required: false,
        reason: `historical_prose_${hit.searchMode}`, estimatedTokens: estimateTokens(`[canon] ${key}: ${text}\n`) }
      ranked.push({ source, chapterId: chapter.id, score: lexical + (excerptMatch ? 2 : 0) + hit.similarity })
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.chapterId - b.chapterId || (a.source.start || 0) - (b.source.start || 0))
  const seenText = new Set<string>()
  const chapterCounts = new Map<number, number>()
  let used = 0
  for (const candidate of ranked) {
    const text = normalize(candidate.source.text)
    if (seenText.has(text)) { omitted.push(`${candidate.source.key}:duplicate_prose`); continue }
    if (sources.length >= MAX_RECALLED_PARAGRAPHS || (chapterCounts.get(candidate.chapterId) || 0) >= MAX_PARAGRAPHS_PER_CHAPTER
      || used + candidate.source.estimatedTokens > budget) { omitted.push(`${candidate.source.key}:recall_budget`); continue }
    sources.push(candidate.source); seenText.add(text)
    chapterCounts.set(candidate.chapterId, (chapterCounts.get(candidate.chapterId) || 0) + 1)
    used += candidate.source.estimatedTokens
  }
  return { sources, omitted }
}
