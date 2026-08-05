import { eq, and } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, chapterEmbeddings } from '../database/schema'
import { getDefaultAdapter, getAdapterById } from './model.service'
let embeddingPipeline: any = null;

async function getLocalEmbeddingPipeline() {
  if (!embeddingPipeline) {
    const { pipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = true;
    env.useBrowserCache = false;
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
      quantized: true,
    });
  }
  return embeddingPipeline;
}

async function getLocalEmbeddings(texts: string[]): Promise<number[][]> {
  const extractor = await getLocalEmbeddingPipeline();
  const results = await extractor(texts, { pooling: 'mean', normalize: true });
  return results.tolist();
}

export interface SimilarFragmentHit {
  chapterId: number
  chapterNum: number
  fragmentType: string
  fragmentText: string
  similarity: number
  searchMode: 'vector' | 'keyword'
}

export type SimilarFragmentFallbackReason =
  | 'embedding_service_failed'
  | 'query_embedding_failed'
  | 'no_hits'
  | 'disabled_by_config'

export interface SimilarFragmentSearchResult {
  hits: SimilarFragmentHit[]
  fallbackReason?: SimilarFragmentFallbackReason
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

function extractKeywords(text: string): string[] {
  // Simple Chinese keyword extraction: extract unique 2-4 char segments
  const chars = text.replace(/[^\u4e00-\u9fff]/g, '')
  const keywords = new Set<string>()
  for (let len = 2; len <= 4; len++) {
    for (let i = 0; i <= chars.length - len; i++) {
      keywords.add(chars.slice(i, i + len))
    }
  }
  return Array.from(keywords)
}

function keywordScore(text: string, keywords: string[]): number {
  let score = 0
  for (const kw of keywords) {
    if (text.includes(kw)) score += 1
  }
  return score
}

function clipFallbackText(text: string, maxLength = 900): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildContentFallbackExcerpt(content: string, keywords: string[]): string {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return ''

  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: keywordScore(paragraph, keywords),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)

  return clipFallbackText((ranked.length > 0 ? ranked.map((item) => item.paragraph) : paragraphs.slice(0, 2)).join('\n'))
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function dedupe(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function buildContinuityFragmentText(raw?: string | null): string {
  if (!raw) return ''

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const lines = [
      ...toStringArray(parsed.plot_progress).slice(0, 3).map((item) => `剧情推进：${item}`),
      ...toStringArray(parsed.character_state_changes).slice(0, 4).map((item) => `人物变化：${item}`),
      ...toStringArray(parsed.world_state_changes).slice(0, 3).map((item) => `世界变化：${item}`),
      ...toStringArray(parsed.open_loops).slice(0, 4).map((item) => `未回收事项：${item}`),
      ...toStringArray(parsed.continuity_notes).slice(0, 3).map((item) => `承接提醒：${item}`),
      asText(parsed.arc_progress) ? `故事弧推进：${asText(parsed.arc_progress)}` : '',
    ]
    return dedupe(lines, 12).join('\n')
  } catch {
    return ''
  }
}

export async function generateChapterEmbeddings(
  novelId: number,
  chapterId: number,
  modelConfigId?: number,
): Promise<void> {
  const db = getDb()
  const chapter = db.select().from(chapters)
    .where(eq(chapters.id, chapterId))
    .all()[0]
  if (!chapter) return

  const fragments: Array<{ type: string; text: string }> = []

  if (chapter.summary) {
    fragments.push({ type: 'summary', text: chapter.summary })
  }

  if (chapter.continuityStateJson) {
    const continuityText = buildContinuityFragmentText(chapter.continuityStateJson)
    if (continuityText) {
      fragments.push({ type: 'continuity', text: continuityText })
    }
  }

  if (chapter.nextChapterSeed) {
    fragments.push({ type: 'seed', text: chapter.nextChapterSeed })
  }

  if (fragments.length === 0) return

  const texts = fragments.map((f) => f.text)
  let embeddings: number[][] | undefined = undefined;
  let usedModelId: string | null = null;

  try {
    const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
    if (adapter && adapter.embed) {
      embeddings = await adapter.embed(texts)
      usedModelId = adapter.id
    }
  } catch {
    // Ignore remote adapter failure
  }

  if (!embeddings) {
    try {
      embeddings = await getLocalEmbeddings(texts)
      usedModelId = 'local_bge_small_zh'
    } catch (e) {
      console.error('Local embedding failed:', e)
    }
  }

  if (!embeddings) {
    // Fallback: store fragments without embeddings for keyword search
    for (const frag of fragments) {
      db.delete(chapterEmbeddings)
        .where(and(
          eq(chapterEmbeddings.chapterId, chapterId),
          eq(chapterEmbeddings.fragmentType, frag.type),
        ))
        .run()

      db.insert(chapterEmbeddings).values({
        novelId,
        chapterId,
        fragmentType: frag.type,
        fragmentText: frag.text,
        embeddingJson: null,
        modelId: null,
        dimensions: null,
      }).run()
    }
    return
  }

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]
    const embedding = embeddings[i]

    db.delete(chapterEmbeddings)
      .where(and(
        eq(chapterEmbeddings.chapterId, chapterId),
        eq(chapterEmbeddings.fragmentType, frag.type),
      ))
      .run()

    db.insert(chapterEmbeddings).values({
      novelId,
      chapterId,
      fragmentType: frag.type,
      fragmentText: frag.text,
      embeddingJson: JSON.stringify(embedding),
      modelId: usedModelId,
      dimensions: embedding.length,
    }).run()
  }
}

export async function searchSimilarFragments(
  novelId: number,
  queryText: string,
  topK = 5,
  modelConfigId?: number,
): Promise<SimilarFragmentSearchResult> {
  const db = getDb()
  const allEmbeddings = db.select().from(chapterEmbeddings)
    .where(eq(chapterEmbeddings.novelId, novelId))
    .all()
  const chapterNumById = new Map(
    db.select({
      id: chapters.id,
      chapterNum: chapters.chapterNum,
    }).from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.chapterNum] as const),
  )

  if (allEmbeddings.length === 0) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'disabled_by_config' : 'no_hits',
    }
  }

  // Check if we have vector embeddings
  const hasVectors = allEmbeddings.some((e) => e.embeddingJson)

  if (!hasVectors) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'disabled_by_config' : 'no_hits',
    }
  }

  let queryEmbedding: number[] | undefined = undefined;

  try {
    const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
    if (adapter && adapter.embed) {
      const result = await adapter.embed([queryText])
      queryEmbedding = result[0]
    }
  } catch {
    // Ignore remote adapter failure
  }

  if (!queryEmbedding) {
    try {
      const result = await getLocalEmbeddings([queryText])
      queryEmbedding = result[0]
    } catch (e) {
      // Ignore local embedding failure
      console.error('Local embedding failed during search:', e)
    }
  }

  if (!queryEmbedding) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK)
    return {
      hits,
      fallbackReason: 'embedding_service_failed',
    }
  }

  const scored = allEmbeddings
    .filter((e) => e.embeddingJson)
    .map((e) => {
      const embedding = JSON.parse(e.embeddingJson!) as number[]
      return {
        chapterId: e.chapterId,
        chapterNum: chapterNumById.get(e.chapterId) || 0,
        fragmentType: e.fragmentType,
        fragmentText: e.fragmentText,
        similarity: cosineSimilarity(queryEmbedding, embedding),
        searchMode: 'vector' as const,
      }
    })
    .sort((a, b) => b.similarity - a.similarity)

  const hits = scored.slice(0, topK)
  return {
    hits,
    fallbackReason: hits.length > 0 ? undefined : 'no_hits',
  }
}

export async function findSimilarFragments(
  novelId: number,
  queryText: string,
  topK = 5,
  modelConfigId?: number,
): Promise<SimilarFragmentHit[]> {
  return (await searchSimilarFragments(novelId, queryText, topK, modelConfigId)).hits
}

export function fallbackKeywordSearch(
  novelId: number,
  queryText: string,
  topK = 5,
): SimilarFragmentHit[] {
  const db = getDb()
  const allEmbeddings = db.select().from(chapterEmbeddings)
    .where(eq(chapterEmbeddings.novelId, novelId))
    .all()

  const chapterNumById = new Map(
    db.select({
      id: chapters.id,
      chapterNum: chapters.chapterNum,
    }).from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.chapterNum] as const),
  )
  const keywords = extractKeywords(queryText)

  const candidates: SimilarFragmentHit[] = allEmbeddings.map((e) => ({
      chapterId: e.chapterId,
      chapterNum: chapterNumById.get(e.chapterId) || 0,
      fragmentType: e.fragmentType,
      fragmentText: e.fragmentText,
      similarity: keywordScore(e.fragmentText, keywords) / Math.max(keywords.length, 1),
      searchMode: 'keyword' as const,
    }))

  // Embedding rows are normally created after chapter finalization. During
  // resume/import/repair flows a chapter can already have usable正文 but no
  // summary or embedding row yet. Keep keyword recall useful in that window by
  // deriving bounded fragments from the chapter itself; this is background
  // evidence only and does not replace hard constraints or structured state.
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    summary: chapters.summary,
    nextChapterSeed: chapters.nextChapterSeed,
    continuityStateJson: chapters.continuityStateJson,
    outline: chapters.outline,
    content: chapters.content,
  })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()

  const existingKeys = new Set(candidates.map((item) => `${item.chapterId}:${item.fragmentType}:${item.fragmentText}`))
  chapterRows.forEach((chapter) => {
    const derived: Array<{ type: string; text: string }> = [
      { type: 'summary', text: asText(chapter.summary) },
      { type: 'seed', text: asText(chapter.nextChapterSeed) },
      { type: 'outline', text: asText(chapter.outline) },
      { type: 'continuity', text: buildContinuityFragmentText(chapter.continuityStateJson) },
      {
        type: 'content_excerpt',
        text: buildContentFallbackExcerpt(asText(chapter.content), keywords),
      },
    ]
    derived.forEach((fragment) => {
      if (!fragment.text) return
      const key = `${chapter.id}:${fragment.type}:${fragment.text}`
      if (existingKeys.has(key)) return
      existingKeys.add(key)
      candidates.push({
        chapterId: chapter.id,
        chapterNum: chapter.chapterNum || 0,
        fragmentType: fragment.type,
        fragmentText: fragment.text,
        similarity: keywordScore(fragment.text, keywords) / Math.max(keywords.length, 1),
        searchMode: 'keyword',
      })
    })
  })

  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}
