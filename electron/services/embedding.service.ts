import { createHash } from 'node:crypto'
import { eq, and, isNotNull } from 'drizzle-orm'
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
  | 'embedding_profile_mismatch'
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

export function buildEmbeddingProfile(modelId: string | null | undefined, dimensions: number): string {
  return `${modelId?.trim() || 'unknown'}:${Math.max(0, Math.floor(dimensions))}`
}

export function hashEmbeddingSource(chapterId: number, contextVersion: number, fragments: Array<{ type: string; text: string }>): string {
  const payload = JSON.stringify({
    chapterId,
    contextVersion,
    fragments: fragments.map((fragment) => ({ type: fragment.type, text: fragment.text.trim() })),
  })
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

export function isCompatibleEmbeddingRow(
  row: { embeddingJson?: string | null; embeddingProfile?: string | null; dimensions?: number | null },
  profile: string,
  dimensions: number,
): boolean {
  return Boolean(row.embeddingJson)
    && row.embeddingProfile === profile
    && row.dimensions === dimensions
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

function buildContentEmbeddingExcerpt(content: string): string {
  const paragraphs = content
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return ''
  const selected = paragraphs.length <= 5
    ? paragraphs
    : [...paragraphs.slice(0, 3), ...paragraphs.slice(-2)]
  const text = selected.join('\n')
  return text.length <= 1800 ? text : `${text.slice(0, 1799)}…`
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

  if (chapter.outline) {
    fragments.push({ type: 'outline', text: chapter.outline })
  }

  const contentExcerpt = buildContentEmbeddingExcerpt(chapter.content || '')
  if (contentExcerpt) {
    fragments.push({ type: 'content_excerpt', text: contentExcerpt })
  }

  if (fragments.length === 0) {
    db.delete(chapterEmbeddings).where(eq(chapterEmbeddings.chapterId, chapterId)).run()
    return
  }

  const contextVersion = chapter.contextVersion || 1
  const sourceHash = hashEmbeddingSource(chapterId, contextVersion, fragments)

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

  db.delete(chapterEmbeddings).where(eq(chapterEmbeddings.chapterId, chapterId)).run()

  if (!embeddings || embeddings.length !== fragments.length) {
    if (embeddings && embeddings.length !== fragments.length) {
      console.warn(`[embedding] 章节 ${chapterId} 的向量数量与片段数量不一致，降级为关键词索引。`)
    }
    for (const frag of fragments) {
      db.insert(chapterEmbeddings).values({
        novelId,
        chapterId,
        fragmentType: frag.type,
        fragmentText: frag.text,
        embeddingJson: null,
        modelId: null,
        dimensions: null,
        embeddingProfile: null,
        sourceHash,
        contextVersion,
        stageId: null,
        entityIdsJson: null,
        visibility: 'canon',
      }).run()
    }
    return
  }

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]
    const embedding = embeddings[i]

    db.insert(chapterEmbeddings).values({
      novelId,
      chapterId,
      fragmentType: frag.type,
      fragmentText: frag.text,
      embeddingJson: JSON.stringify(embedding),
      modelId: usedModelId,
      dimensions: embedding.length,
      embeddingProfile: buildEmbeddingProfile(usedModelId, embedding.length),
      sourceHash,
      contextVersion,
      stageId: null,
      entityIdsJson: null,
      visibility: 'canon',
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
  const vectorRows = db.select({ id: chapterEmbeddings.id })
    .from(chapterEmbeddings)
    .where(and(
      eq(chapterEmbeddings.novelId, novelId),
      isNotNull(chapterEmbeddings.embeddingJson),
    ))
    .all()

  if (vectorRows.length === 0) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'disabled_by_config' : 'no_hits',
    }
  }

  let queryEmbedding: number[] | undefined = undefined;
  let queryModelId: string | null = null

  try {
    const adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
    if (adapter && adapter.embed) {
      const result = await adapter.embed([queryText])
      queryEmbedding = result[0]
      queryModelId = adapter.id
    }
  } catch {
    // Ignore remote adapter failure
  }

  if (!queryEmbedding) {
    try {
      const result = await getLocalEmbeddings([queryText])
      queryEmbedding = result[0]
      queryModelId = 'local_bge_small_zh'
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

  const queryProfile = buildEmbeddingProfile(queryModelId, queryEmbedding.length)
  const compatibleRows = db.select().from(chapterEmbeddings)
    .where(and(
      eq(chapterEmbeddings.novelId, novelId),
      eq(chapterEmbeddings.embeddingProfile, queryProfile),
      eq(chapterEmbeddings.dimensions, queryEmbedding.length),
      isNotNull(chapterEmbeddings.embeddingJson),
    ))
    .all()
    .filter((row) => isCompatibleEmbeddingRow(row, queryProfile, queryEmbedding.length))

  if (compatibleRows.length === 0) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'embedding_profile_mismatch' : 'no_hits',
    }
  }

  const chapterNumById = new Map(
    db.select({
      id: chapters.id,
      chapterNum: chapters.chapterNum,
    }).from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .map((row) => [row.id, row.chapterNum] as const),
  )

  const scored = compatibleRows.flatMap((e) => {
      try {
        const embedding = JSON.parse(e.embeddingJson!) as number[]
        if (!isCompatibleEmbeddingRow(e, queryProfile, queryEmbedding.length)) return []
        return [{
          chapterId: e.chapterId,
          chapterNum: chapterNumById.get(e.chapterId) || 0,
          fragmentType: e.fragmentType,
          fragmentText: e.fragmentText,
          similarity: cosineSimilarity(queryEmbedding, embedding),
          searchMode: 'vector' as const,
        }]
      } catch {
        return []
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
