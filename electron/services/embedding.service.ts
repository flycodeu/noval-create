import { createHash } from 'node:crypto'
import { and, desc, eq, isNotNull, like, lt, or } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, chapterEmbeddings } from '../database/schema'
import { getAdapterById, getDefaultModelConfigRecord, getModelConfigRecord } from './model.service'
import { isCompatiblePreparedQuery, type PreparedQueryEmbedding } from './query-embedding'
import { throwUserFacingError } from '../utils/user-facing-error'

const LOCAL_EMBEDDING_MODEL_ID = 'local:Xenova/bge-small-zh-v1.5:q8'
const REMOTE_EMBEDDING_MODEL_ID = 'text-embedding-3-small'
const MAX_KEYWORDS = 24
const MAX_LOOKUP_KEYWORDS = 8
const MIN_RETRIEVAL_CANDIDATES = 64
const MAX_RETRIEVAL_CANDIDATES = 512
const MAX_VECTOR_CANDIDATES = 4096
const RECENT_VECTOR_CANDIDATES = 768

let embeddingPipeline: any = null

async function getLocalEmbeddingPipeline() {
  if (!embeddingPipeline) {
    const { pipeline, env } = await import('@xenova/transformers')
    env.allowLocalModels = true
    env.useBrowserCache = false
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
      quantized: true,
    })
  }
  return embeddingPipeline
}

async function getLocalEmbeddings(texts: string[]): Promise<number[][]> {
  const extractor = await getLocalEmbeddingPipeline()
  const results = await extractor(texts, { pooling: 'mean', normalize: true })
  return results.tolist()
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

export interface SimilarFragmentSearchOptions {
  beforeChapterNum?: number
  preparedQuery?: PreparedQueryEmbedding | null
}

const embeddingCandidateSelection = {
  id: chapterEmbeddings.id,
  novelId: chapterEmbeddings.novelId,
  chapterId: chapterEmbeddings.chapterId,
  fragmentType: chapterEmbeddings.fragmentType,
  fragmentText: chapterEmbeddings.fragmentText,
  embeddingJson: chapterEmbeddings.embeddingJson,
  modelId: chapterEmbeddings.modelId,
  dimensions: chapterEmbeddings.dimensions,
  embeddingProfile: chapterEmbeddings.embeddingProfile,
  chapterNum: chapters.chapterNum,
}

function resolveBeforeChapterNum(options?: SimilarFragmentSearchOptions): number | undefined {
  if (options === undefined) return undefined
  if (options === null || typeof options !== 'object') {
    throwUserFacingError('common.invalidParameter', { parameter: 'beforeChapterNum 必须是正整数' })
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'beforeChapterNum')) return undefined

  const value = options.beforeChapterNum
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throwUserFacingError('common.invalidParameter', { parameter: 'beforeChapterNum 必须是正整数' })
  }
  return value
}

export function cosineSimilarity(a: number[], b: number[]): number {
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

function buildEmbeddingConfigFingerprint(config: {
  id: number
  provider?: string | null
  modelId?: string | null
  baseUrl?: string | null
}): string {
  return createHash('sha256').update(JSON.stringify({
    id: config.id,
    provider: config.provider,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    embeddingModel: REMOTE_EMBEDDING_MODEL_ID,
  })).digest('hex').slice(0, 16)
}

export function resolveEmbeddingConfigCacheKey(modelConfigId?: number): string {
  try {
    const config = modelConfigId
      ? getModelConfigRecord(modelConfigId)
      : getDefaultModelConfigRecord()
    return `config:${config.id}:${buildEmbeddingConfigFingerprint(config)}`
  } catch {
    return 'local:default'
  }
}

export function hashEmbeddingSource(
  chapterId: number,
  _contextVersion: number,
  fragments: Array<{ type: string; text: string }>,
  embeddingConfigKey: string | number = 'local:default',
): string {
  const payload = JSON.stringify({
    chapterId,
    embeddingConfigKey,
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

export function extractEmbeddingKeywords(text: string, limit = MAX_KEYWORDS): string[] {
  const chunks = text.match(/[\u3400-\u9fff]+|[a-zA-Z0-9]+/g) || []
  const keywords: string[] = []
  const seen = new Set<string>()
  const add = (value: string) => {
    const normalized = value.trim().toLowerCase()
    if (normalized.length < 2 || seen.has(normalized)) return
    seen.add(normalized)
    keywords.push(normalized)
  }

  chunks.forEach((chunk) => {
    if (/^[a-zA-Z0-9]+$/.test(chunk)) {
      add(chunk)
      return
    }

    if (chunk.length <= 12) add(chunk)
    for (let size = Math.min(4, chunk.length); size >= 2; size -= 1) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        add(chunk.slice(index, index + size))
        if (keywords.length >= limit) return
      }
    }
  })

  return keywords.slice(0, Math.max(1, limit))
}

function keywordScore(text: string, keywords: string[]): number {
  let score = 0
  for (const kw of keywords) {
    if (text.toLowerCase().includes(kw)) score += Math.min(kw.length, 4)
  }
  return score
}

function keywordScoreRatio(text: string, keywords: string[]): number {
  const maxScore = keywords.reduce((sum, keyword) => sum + Math.min(keyword.length, 4), 0)
  return maxScore > 0 ? keywordScore(text, keywords) / maxScore : 0
}

function getCandidateLimit(topK: number): number {
  return Math.max(
    MIN_RETRIEVAL_CANDIDATES,
    Math.min(MAX_RETRIEVAL_CANDIDATES, Math.max(1, Math.floor(topK)) * 32),
  )
}

function buildTextMatch(column: typeof chapterEmbeddings.fragmentText, keywords: string[]) {
  const matches = keywords.map((keyword) => like(column, `%${keyword}%`))
  return matches.length === 1 ? matches[0] : or(...matches)
}

export function isUsableEmbedding(embedding: unknown): embedding is number[] {
  return Array.isArray(embedding)
    && embedding.length > 0
    && embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
}

export function areUsableEmbeddings(embeddings: unknown, expectedCount: number): embeddings is number[][] {
  if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) return false
  if (!embeddings.every(isUsableEmbedding)) return false
  const dimensions = embeddings[0]?.length || 0
  return dimensions > 0 && embeddings.every((embedding) => embedding.length === dimensions)
}

async function resolveRemoteEmbeddingRuntime(modelConfigId?: number): Promise<{
  adapter: Awaited<ReturnType<typeof getAdapterById>>
  modelId: string
}> {
  const config = modelConfigId
    ? getModelConfigRecord(modelConfigId)
    : getDefaultModelConfigRecord()
  const resolvedConfigId = config.id
  const adapter = await getAdapterById(resolvedConfigId)
  const configFingerprint = buildEmbeddingConfigFingerprint(config)
  return {
    adapter,
    modelId: `${adapter.id}:config:${resolvedConfigId}:${configFingerprint}:${REMOTE_EMBEDDING_MODEL_ID}`,
  }
}

export interface EmbeddingBatchResult {
  embeddings?: number[][]
  modelId?: string
  dimensions?: number
  profile?: string
  source: 'remote' | 'local' | 'unavailable'
}

export interface EmbeddingRequestOptions {
  allowRemote?: boolean
}

export async function embedSemanticTexts(
  texts: string[],
  modelConfigId?: number,
  options: EmbeddingRequestOptions = {},
): Promise<EmbeddingBatchResult> {
  if (texts.length === 0) return { source: 'unavailable' }

  if (options.allowRemote !== false) {
    try {
      const { adapter, modelId } = await resolveRemoteEmbeddingRuntime(modelConfigId)
      if (adapter.embed) {
        const embeddings = await adapter.embed(texts, { model: REMOTE_EMBEDDING_MODEL_ID })
        if (areUsableEmbeddings(embeddings, texts.length)) {
          const dimensions = embeddings[0].length
          return {
            embeddings,
            modelId,
            dimensions,
            profile: buildEmbeddingProfile(modelId, dimensions),
            source: 'remote',
          }
        }
      }
    } catch {
      // Remote embeddings are optional; local embeddings remain the deterministic fallback.
    }
  }

  try {
    const embeddings = await getLocalEmbeddings(texts)
    if (areUsableEmbeddings(embeddings, texts.length)) {
      const dimensions = embeddings[0].length
      return {
        embeddings,
        modelId: LOCAL_EMBEDDING_MODEL_ID,
        dimensions,
        profile: buildEmbeddingProfile(LOCAL_EMBEDDING_MODEL_ID, dimensions),
        source: 'local',
      }
    }
  } catch (error) {
    console.error('Local embedding failed:', error)
  }

  return { source: 'unavailable' }
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
  if (chapter.novelId !== novelId) {
    throw new Error(`章节 ${chapterId} 不属于小说 ${novelId}，拒绝写入跨小说向量索引。`)
  }

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
  const embeddingConfigKey = resolveEmbeddingConfigCacheKey(modelConfigId)
  const sourceHash = hashEmbeddingSource(chapterId, contextVersion, fragments, embeddingConfigKey)
  const existingRows = db.select().from(chapterEmbeddings)
    .where(eq(chapterEmbeddings.chapterId, chapterId))
    .all()
  const existingByFragmentType = new Map(existingRows.map((row) => [row.fragmentType, row]))
  const reusableByFragmentType = new Map<string, {
    embedding: number[]
    modelId?: string
    dimensions?: number
    profile?: string
  }>()
  fragments.forEach((fragment) => {
    const existing = existingByFragmentType.get(fragment.type)
    if (existing?.sourceHash !== sourceHash) return
    try {
      const embedding = JSON.parse(existing.embeddingJson || '')
      if (!isUsableEmbedding(embedding)) return
      reusableByFragmentType.set(fragment.type, {
        embedding,
        modelId: existing.modelId || undefined,
        dimensions: existing.dimensions || undefined,
        profile: existing.embeddingProfile || undefined,
      })
    } catch {
      // Corrupt cached vectors are regenerated below.
    }
  })
  const missingFragments = fragments.filter((fragment) => !reusableByFragmentType.has(fragment.type))
  const embeddingBatch = missingFragments.length > 0
    ? await embedSemanticTexts(missingFragments.map((fragment) => fragment.text), modelConfigId)
    : { source: 'unavailable' as const }
  const generatedByFragmentType = new Map(missingFragments.map((fragment, index) => [
    fragment.type,
    embeddingBatch.embeddings?.[index],
  ]))

  db.transaction((tx) => {
    tx.delete(chapterEmbeddings).where(eq(chapterEmbeddings.chapterId, chapterId)).run()
    fragments.forEach((fragment) => {
      const reusable = reusableByFragmentType.get(fragment.type)
      const embedding = reusable?.embedding || generatedByFragmentType.get(fragment.type)
      const modelId = reusable?.modelId || (embedding ? embeddingBatch.modelId : undefined)
      const dimensions = reusable?.dimensions || (embedding ? embeddingBatch.dimensions : undefined)
      const profile = reusable?.profile || (embedding ? embeddingBatch.profile : undefined)
      tx.insert(chapterEmbeddings).values({
        novelId,
        chapterId,
        fragmentType: fragment.type,
        fragmentText: fragment.text,
        embeddingJson: embedding ? JSON.stringify(embedding) : null,
        modelId: embedding ? modelId : null,
        dimensions: embedding ? dimensions || embedding.length : null,
        embeddingProfile: embedding ? profile : null,
        sourceHash,
        contextVersion,
        stageId: null,
        entityIdsJson: null,
        visibility: 'canon',
      }).run()
    })
  })
}

export async function searchSimilarFragments(
  novelId: number,
  queryText: string,
  topK = 5,
  modelConfigId?: number,
  options?: SimilarFragmentSearchOptions,
): Promise<SimilarFragmentSearchResult> {
  const beforeChapterNum = resolveBeforeChapterNum(options)
  const db = getDb()
  const vectorRows = db.select({ id: chapterEmbeddings.id })
    .from(chapterEmbeddings)
    .innerJoin(chapters, eq(chapterEmbeddings.chapterId, chapters.id))
    .where(and(
      eq(chapterEmbeddings.novelId, novelId),
      eq(chapters.novelId, novelId),
      ...(beforeChapterNum === undefined ? [] : [lt(chapters.chapterNum, beforeChapterNum)]),
      isNotNull(chapterEmbeddings.embeddingJson),
    ))
    .limit(1)
    .all()

  if (vectorRows.length === 0) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK, options)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'disabled_by_config' : 'no_hits',
    }
  }

  const preparedQuery = options?.preparedQuery
  const usePreparedQuery = preparedQuery !== undefined
    && preparedQuery !== null
    && isCompatiblePreparedQuery(queryText, preparedQuery)
  const preparedQueryRejected = preparedQuery !== undefined && !usePreparedQuery
  let queryEmbedding: number[] | undefined
  let queryProfile: string | undefined
  let queryDimensions: number | undefined

  if (usePreparedQuery) {
    queryEmbedding = preparedQuery!.embedding
    queryProfile = preparedQuery!.profile
    queryDimensions = preparedQuery!.dimensions
  } else if (!preparedQueryRejected) {
    const queryBatch = await embedSemanticTexts([queryText], modelConfigId)
    queryEmbedding = queryBatch.embeddings?.[0]
    queryProfile = queryBatch.profile
    queryDimensions = queryBatch.dimensions
  }

  if (!queryEmbedding || !queryProfile || !queryDimensions) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK, options)
    return {
      hits,
      fallbackReason: preparedQueryRejected ? 'query_embedding_failed' : 'embedding_service_failed',
    }
  }

  const compatibilityFilters = [
    eq(chapterEmbeddings.novelId, novelId),
    eq(chapterEmbeddings.embeddingProfile, queryProfile),
    eq(chapterEmbeddings.dimensions, queryDimensions),
    isNotNull(chapterEmbeddings.embeddingJson),
  ] as const
  const lookupKeywords = extractEmbeddingKeywords(queryText, MAX_LOOKUP_KEYWORDS)
  const lexicalRows = lookupKeywords.length > 0
    ? db.select(embeddingCandidateSelection).from(chapterEmbeddings)
      .innerJoin(chapters, eq(chapterEmbeddings.chapterId, chapters.id))
      .where(and(
        ...compatibilityFilters,
        eq(chapters.novelId, novelId),
        ...(beforeChapterNum === undefined ? [] : [lt(chapters.chapterNum, beforeChapterNum)]),
        buildTextMatch(chapterEmbeddings.fragmentText, lookupKeywords),
      ))
      .orderBy(desc(chapters.chapterNum), desc(chapterEmbeddings.id))
      .limit(MAX_VECTOR_CANDIDATES - RECENT_VECTOR_CANDIDATES)
      .all()
    : []
  const recentRows = db.select(embeddingCandidateSelection).from(chapterEmbeddings)
    .innerJoin(chapters, eq(chapterEmbeddings.chapterId, chapters.id))
    .where(and(
      ...compatibilityFilters,
      eq(chapters.novelId, novelId),
      ...(beforeChapterNum === undefined ? [] : [lt(chapters.chapterNum, beforeChapterNum)]),
    ))
    .orderBy(desc(chapters.chapterNum), desc(chapterEmbeddings.id))
    .limit(RECENT_VECTOR_CANDIDATES)
    .all()
  const compatibleRows = [...new Map(
    [...lexicalRows, ...recentRows]
      .filter((row) => isCompatibleEmbeddingRow(row, queryProfile!, queryDimensions!))
      .map((row) => [row.id, row] as const),
  ).values()].slice(0, MAX_VECTOR_CANDIDATES)

  if (compatibleRows.length === 0) {
    const hits = fallbackKeywordSearch(novelId, queryText, topK, options)
    return {
      hits,
      fallbackReason: hits.length > 0 ? 'embedding_profile_mismatch' : 'no_hits',
    }
  }

  const scored = compatibleRows.flatMap((e) => {
      try {
        const embedding = JSON.parse(e.embeddingJson!) as number[]
        if (!isCompatibleEmbeddingRow(e, queryProfile!, queryDimensions!)) return []
        return [{
          chapterId: e.chapterId,
          chapterNum: e.chapterNum ?? 0,
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
  options?: SimilarFragmentSearchOptions,
): Promise<SimilarFragmentHit[]> {
  return (await searchSimilarFragments(novelId, queryText, topK, modelConfigId, options)).hits
}

export function fallbackKeywordSearch(
  novelId: number,
  queryText: string,
  topK = 5,
  options?: SimilarFragmentSearchOptions,
): SimilarFragmentHit[] {
  const beforeChapterNum = resolveBeforeChapterNum(options)
  const db = getDb()
  const keywords = extractEmbeddingKeywords(queryText)
  const lookupKeywords = keywords.slice(0, MAX_LOOKUP_KEYWORDS)
  const candidateLimit = getCandidateLimit(topK)
  const candidateEmbeddings = db.select(embeddingCandidateSelection).from(chapterEmbeddings)
    .innerJoin(chapters, eq(chapterEmbeddings.chapterId, chapters.id))
    .where(and(
      eq(chapterEmbeddings.novelId, novelId),
      eq(chapters.novelId, novelId),
      ...(beforeChapterNum === undefined ? [] : [lt(chapters.chapterNum, beforeChapterNum)]),
      ...(lookupKeywords.length > 0 ? [buildTextMatch(chapterEmbeddings.fragmentText, lookupKeywords)] : []),
    ))
    .orderBy(desc(chapters.chapterNum), desc(chapterEmbeddings.id))
    .limit(candidateLimit)
    .all()

  const candidates: SimilarFragmentHit[] = candidateEmbeddings.map((e) => ({
      chapterId: e.chapterId,
      chapterNum: e.chapterNum ?? 0,
      fragmentType: e.fragmentType,
      fragmentText: e.fragmentText,
      similarity: keywordScoreRatio(e.fragmentText, keywords),
      searchMode: 'keyword' as const,
    }))

  // Embedding rows are normally created after chapter finalization. During
  // resume/import/repair flows a chapter can already have usable正文 but no
  // summary or embedding row yet. Keep keyword recall useful in that window by
  // deriving bounded fragments from the chapter itself; this is background
  // evidence only and does not replace hard constraints or structured state.
  const chapterMatches = lookupKeywords.flatMap((keyword) => [
    like(chapters.summary, `%${keyword}%`),
    like(chapters.nextChapterSeed, `%${keyword}%`),
    like(chapters.continuityStateJson, `%${keyword}%`),
    like(chapters.outline, `%${keyword}%`),
    like(chapters.content, `%${keyword}%`),
  ])
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
    .where(and(
      eq(chapters.novelId, novelId),
      ...(beforeChapterNum === undefined ? [] : [lt(chapters.chapterNum, beforeChapterNum)]),
      ...(lookupKeywords.length > 0 ? [or(...chapterMatches)] : []),
    ))
    .orderBy(desc(chapters.chapterNum), desc(chapters.id))
    .limit(candidateLimit)
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
        similarity: keywordScoreRatio(fragment.text, keywords),
        searchMode: 'keyword',
      })
    })
  })

  return candidates
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
}
