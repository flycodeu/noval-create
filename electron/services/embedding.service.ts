import { eq, and } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, chapterEmbeddings } from '../database/schema'
import { getDefaultAdapter, getAdapterById } from './model.service'

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

  // Try to use adapter's embed method
  let adapter
  try {
    adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
  } catch {
    return // No adapter available
  }

  if (!adapter.embed) {
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

  const texts = fragments.map((f) => f.text)
  let embeddings: number[][]
  try {
    embeddings = await adapter.embed(texts)
  } catch {
    // Embedding failed, still store text for keyword fallback
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
        modelId: adapter.id,
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
      modelId: adapter.id,
      dimensions: embedding.length,
    }).run()
  }
}

export async function findSimilarFragments(
  novelId: number,
  queryText: string,
  topK = 5,
  modelConfigId?: number,
): Promise<Array<{ chapterId: number; fragmentType: string; fragmentText: string; similarity: number }>> {
  const db = getDb()
  const allEmbeddings = db.select().from(chapterEmbeddings)
    .where(eq(chapterEmbeddings.novelId, novelId))
    .all()

  if (allEmbeddings.length === 0) return []

  // Check if we have vector embeddings
  const hasVectors = allEmbeddings.some((e) => e.embeddingJson)

  if (!hasVectors) {
    return fallbackKeywordSearch(novelId, queryText, topK)
  }

  // Get query embedding
  let adapter
  try {
    adapter = modelConfigId ? await getAdapterById(modelConfigId) : await getDefaultAdapter()
  } catch {
    return fallbackKeywordSearch(novelId, queryText, topK)
  }

  if (!adapter.embed) {
    return fallbackKeywordSearch(novelId, queryText, topK)
  }

  let queryEmbedding: number[]
  try {
    const result = await adapter.embed([queryText])
    queryEmbedding = result[0]
  } catch {
    return fallbackKeywordSearch(novelId, queryText, topK)
  }

  const scored = allEmbeddings
    .filter((e) => e.embeddingJson)
    .map((e) => {
      const embedding = JSON.parse(e.embeddingJson!) as number[]
      return {
        chapterId: e.chapterId,
        fragmentType: e.fragmentType,
        fragmentText: e.fragmentText,
        similarity: cosineSimilarity(queryEmbedding, embedding),
      }
    })
    .sort((a, b) => b.similarity - a.similarity)

  return scored.slice(0, topK)
}

export function fallbackKeywordSearch(
  novelId: number,
  queryText: string,
  topK = 5,
): Array<{ chapterId: number; fragmentType: string; fragmentText: string; similarity: number }> {
  const db = getDb()
  const allEmbeddings = db.select().from(chapterEmbeddings)
    .where(eq(chapterEmbeddings.novelId, novelId))
    .all()

  if (allEmbeddings.length === 0) {
    // Fallback to chapter summaries
    const chapterRows = db.select({
      id: chapters.id,
      summary: chapters.summary,
    })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .all()
      .filter((c) => c.summary)

    const keywords = extractKeywords(queryText)
    return chapterRows
      .map((c) => ({
        chapterId: c.id,
        fragmentType: 'summary' as const,
        fragmentText: c.summary!,
        similarity: keywordScore(c.summary!, keywords) / Math.max(keywords.length, 1),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
  }

  const keywords = extractKeywords(queryText)
  return allEmbeddings
    .map((e) => ({
      chapterId: e.chapterId,
      fragmentType: e.fragmentType,
      fragmentText: e.fragmentText,
      similarity: keywordScore(e.fragmentText, keywords) / Math.max(keywords.length, 1),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}
