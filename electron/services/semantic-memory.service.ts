import { createHash } from 'node:crypto'
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import {
  buildCharacterSemanticDocuments,
  buildItemSemanticDocuments,
  buildMapSemanticDocuments,
  buildStoryThreadSemanticDocuments,
  buildTimelineEventSemanticDocuments,
  type SemanticMemoryDocument,
  type SemanticMemorySourceType,
} from '../../src/shared/semantic-memory'
import { getDb, getSqlite } from '../database/db'
import {
  characters,
  chapters,
  novels,
  semanticMemoryEntries,
  semanticMemoryOutbox,
  storyItems,
  storyThreads,
  timelineEvents,
  worldMap,
} from '../database/schema'
import {
  cosineSimilarity,
  embedSemanticTexts,
  extractEmbeddingKeywords,
  isCompatibleEmbeddingRow,
  isUsableEmbedding,
} from './embedding.service'

const EMBEDDING_BATCH_SIZE = 24
const MAX_SEARCH_CANDIDATES = 3072
const RECENT_SEARCH_CANDIDATES = 512
const MAX_SHORT_KEYWORD_CANDIDATES = 512
const MAX_LOOKUP_KEYWORDS = 8
const MIN_FTS_TERM_LENGTH = 3
const DEFAULT_OUTBOX_BATCH_SIZE = 24
const OUTBOX_LOCK_TIMEOUT_MINUTES = 5
const INDEXED_SOURCE_TYPES: SemanticMemorySourceType[] = [
  'character',
  'map',
  'item',
  'story_thread',
  'timeline_event',
]

interface PreparedSemanticDocument {
  document: SemanticMemoryDocument
  sourceHash: string
  embedding?: number[]
  modelId?: string
  dimensions?: number
  profile?: string
}

interface SemanticMemoryOutboxClaim {
  id: number
  novelId: number
  sourceType: SemanticMemorySourceType
  sourceId: number
  operation: 'upsert' | 'delete'
  revision: number
  attempts: number
}

interface IncrementalProjectionOptions {
  modelConfigId?: number
  outboxClaim?: Pick<SemanticMemoryOutboxClaim, 'id' | 'revision'>
}

export interface SemanticMemoryReindexResult {
  documentCount: number
  vectorizedCount: number
  keywordOnlyCount: number
  profiles: string[]
}

export interface SemanticMemorySourceReindexResult extends SemanticMemoryReindexResult {
  novelId: number
  sourceType: SemanticMemorySourceType
  sourceId: number
  applied: boolean
}

export interface SemanticMemoryOutboxProcessResult {
  claimedCount: number
  processedCount: number
  supersededCount: number
  failedCount: number
}

export interface SemanticMemorySearchHit {
  sourceType: SemanticMemorySourceType
  sourceId: number
  fragmentKey: string
  content: string
  entityRefs: string[]
  similarity: number
  searchMode: 'vector' | 'keyword'
}

export interface SemanticMemorySearchOptions {
  topK?: number
  modelConfigId?: number
  chapterNum?: number
  sourceTypes?: SemanticMemorySourceType[]
  visibility?: 'canon' | 'draft' | 'private'
  refreshOutbox?: boolean
}

function isIndexedSourceType(value: string): value is SemanticMemorySourceType {
  return INDEXED_SOURCE_TYPES.includes(value as SemanticMemorySourceType)
}

function hashSemanticDocument(novelId: number, document: SemanticMemoryDocument): string {
  const payload = JSON.stringify({
    novelId,
    sourceType: document.sourceType,
    sourceId: document.sourceId,
    fragmentKey: document.fragmentKey,
    content: document.content,
    entityRefs: document.entityRefs,
    visibility: document.visibility,
    stageId: document.stageId || null,
    sourceChapterStart: document.sourceChapterStart || null,
    sourceChapterEnd: document.sourceChapterEnd || null,
    validFromChapter: document.validFromChapter || null,
    validToChapter: document.validToChapter || null,
  })
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`
}

function parseEntityRefs(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
      : []
  } catch {
    return []
  }
}

function keywordSimilarity(content: string, keywords: string[]): number {
  if (keywords.length === 0) return 0
  const normalized = content.toLowerCase()
  const totalWeight = keywords.reduce((sum, keyword) => sum + Math.min(keyword.length, 4), 0)
  const matchedWeight = keywords.reduce(
    (sum, keyword) => sum + (normalized.includes(keyword) ? Math.min(keyword.length, 4) : 0),
    0,
  )
  return totalWeight > 0 ? matchedWeight / totalWeight : 0
}

function buildValidityFilters(chapterNum?: number) {
  if (typeof chapterNum !== 'number') return []
  return [
    or(isNull(semanticMemoryEntries.validFromChapter), lte(semanticMemoryEntries.validFromChapter, chapterNum)),
    or(isNull(semanticMemoryEntries.validToChapter), gte(semanticMemoryEntries.validToChapter, chapterNum)),
  ]
}

function buildCleanProjectionFilter() {
  return sql`NOT EXISTS (
    SELECT 1
    FROM semantic_memory_outbox AS dirty
    WHERE dirty.novel_id = ${semanticMemoryEntries.novelId}
      AND dirty.source_type = ${semanticMemoryEntries.sourceType}
      AND dirty.source_id = ${semanticMemoryEntries.sourceId}
  )`
}

export function buildSemanticMemoryFtsQuery(keywords: string[]): string | null {
  const terms = [...new Set(
    keywords
      .map((keyword) => keyword.trim().toLowerCase())
      .filter((keyword) => keyword.length >= MIN_FTS_TERM_LENGTH),
  )]
  if (terms.length === 0) return null
  return terms
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' OR ')
}

interface SemanticMemoryFtsCandidateOptions {
  novelId: number
  keywords: string[]
  sourceTypes: SemanticMemorySourceType[]
  visibility: 'canon' | 'draft' | 'private'
  chapterNum?: number
  embeddingProfile?: string
  dimensions?: number
  limit: number
}

export function querySemanticMemoryFtsCandidateIds(
  options: SemanticMemoryFtsCandidateOptions,
): number[] | null {
  const matchQuery = buildSemanticMemoryFtsQuery(options.keywords)
  if (!matchQuery) return []

  const sourcePlaceholders = options.sourceTypes.map(() => '?').join(', ')
  const conditions = [
    'semantic_memory_fts MATCH ?',
    'entry.novel_id = ?',
    `entry.source_type IN (${sourcePlaceholders})`,
    'entry.visibility = ?',
    `NOT EXISTS (
      SELECT 1
      FROM semantic_memory_outbox AS dirty
      WHERE dirty.novel_id = entry.novel_id
        AND dirty.source_type = entry.source_type
        AND dirty.source_id = entry.source_id
    )`,
  ]
  const parameters: Array<string | number> = [
    matchQuery,
    options.novelId,
    ...options.sourceTypes,
    options.visibility,
  ]
  if (typeof options.chapterNum === 'number') {
    conditions.push('(entry.valid_from_chapter IS NULL OR entry.valid_from_chapter <= ?)')
    conditions.push('(entry.valid_to_chapter IS NULL OR entry.valid_to_chapter >= ?)')
    parameters.push(options.chapterNum, options.chapterNum)
  }
  if (options.embeddingProfile && options.dimensions) {
    conditions.push('entry.embedding_json IS NOT NULL')
    conditions.push('entry.embedding_profile = ?')
    conditions.push('entry.dimensions = ?')
    parameters.push(options.embeddingProfile, options.dimensions)
  }
  parameters.push(Math.max(1, Math.floor(options.limit)))

  try {
    const rows = getSqlite().prepare(`
      SELECT semantic_memory_fts.rowid AS id
      FROM semantic_memory_fts
      INNER JOIN semantic_memory_entries AS entry
        ON entry.id = semantic_memory_fts.rowid
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY bm25(semantic_memory_fts), semantic_memory_fts.rowid DESC
      LIMIT ?
    `).all(...parameters) as Array<{ id: number }>
    return rows
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  } catch {
    return null
  }
}

async function attachEmbeddings(
  novelId: number,
  documents: SemanticMemoryDocument[],
  modelConfigId?: number,
): Promise<PreparedSemanticDocument[]> {
  const prepared: PreparedSemanticDocument[] = documents.map((document) => ({
    document,
    sourceHash: hashSemanticDocument(novelId, document),
  }))

  for (let offset = 0; offset < prepared.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = prepared.slice(offset, offset + EMBEDDING_BATCH_SIZE)
    const result = await embedSemanticTexts(batch.map((entry) => entry.document.content), modelConfigId)
    batch.forEach((entry, index) => {
      const embedding = result.embeddings?.[index]
      if (!embedding) return
      entry.embedding = embedding
      entry.modelId = result.modelId
      entry.dimensions = result.dimensions
      entry.profile = result.profile
    })
  }

  return prepared
}

function preserveUnchangedEmbeddings(
  prepared: PreparedSemanticDocument[],
  existingRows: Array<typeof semanticMemoryEntries.$inferSelect>,
): void {
  const existingBySource = new Map(existingRows.map((row) => [
    `${row.sourceType}:${row.sourceId}:${row.fragmentKey}`,
    row,
  ]))
  prepared.forEach((entry) => {
    if (entry.embedding) return
    const existing = existingBySource.get(
      `${entry.document.sourceType}:${entry.document.sourceId}:${entry.document.fragmentKey}`,
    )
    if (!existing || existing.sourceHash !== entry.sourceHash) return
    try {
      const embedding = JSON.parse(existing.embeddingJson || '')
      if (!isUsableEmbedding(embedding)) return
      entry.embedding = embedding
      entry.modelId = existing.modelId || undefined
      entry.dimensions = existing.dimensions || undefined
      entry.profile = existing.embeddingProfile || undefined
    } catch {
      // Corrupt cached vectors are replaced by the keyword-only projection.
    }
  })
}

function buildReindexSummary(prepared: PreparedSemanticDocument[]): SemanticMemoryReindexResult {
  const profiles = [...new Set(
    prepared.map((entry) => entry.profile).filter((entry): entry is string => Boolean(entry)),
  )]
  const vectorizedCount = prepared.filter((entry) => entry.embedding).length
  return {
    documentCount: prepared.length,
    vectorizedCount,
    keywordOnlyCount: prepared.length - vectorizedCount,
    profiles,
  }
}

function insertPreparedDocuments(
  tx: Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0],
  novelId: number,
  contextVersion: number,
  prepared: PreparedSemanticDocument[],
): void {
  prepared.forEach(({ document, sourceHash, embedding, modelId, dimensions, profile }) => {
    tx.insert(semanticMemoryEntries).values({
      novelId,
      sourceType: document.sourceType,
      sourceId: document.sourceId,
      fragmentKey: document.fragmentKey,
      contentText: document.content,
      embeddingJson: embedding ? JSON.stringify(embedding) : null,
      modelId: embedding ? modelId : null,
      dimensions: embedding ? dimensions : null,
      embeddingProfile: embedding ? profile : null,
      sourceHash,
      contextVersion,
      stageId: document.stageId || null,
      entityRefsJson: JSON.stringify(document.entityRefs),
      visibility: document.visibility,
      sourceChapterStart: document.sourceChapterStart || null,
      sourceChapterEnd: document.sourceChapterEnd || null,
      validFromChapter: document.validFromChapter || null,
      validToChapter: document.validToChapter || null,
    }).run()
  })
}

function loadSourceDocuments(
  novelId: number,
  sourceType: SemanticMemorySourceType,
  sourceId: number,
): SemanticMemoryDocument[] {
  const db = getDb()
  if (sourceType === 'character') {
    const row = db.select().from(characters).where(and(
      eq(characters.id, sourceId),
      eq(characters.novelId, novelId),
    )).all()[0]
    return row ? buildCharacterSemanticDocuments(row) : []
  }
  if (sourceType === 'map') {
    const row = db.select().from(worldMap).where(and(
      eq(worldMap.id, sourceId),
      eq(worldMap.novelId, novelId),
    )).all()[0]
    return row ? buildMapSemanticDocuments(row) : []
  }
  if (sourceType === 'item') {
    const row = db.select().from(storyItems).where(and(
      eq(storyItems.id, sourceId),
      eq(storyItems.novelId, novelId),
    )).all()[0]
    if (!row) return []
    const ownerName = row.ownerCharacterId
      ? db.select({ fullName: characters.fullName }).from(characters).where(and(
        eq(characters.id, row.ownerCharacterId),
        eq(characters.novelId, novelId),
      )).all()[0]?.fullName
      : undefined
    const locationName = row.locationMapId
      ? db.select({ name: worldMap.name }).from(worldMap).where(and(
        eq(worldMap.id, row.locationMapId),
        eq(worldMap.novelId, novelId),
      )).all()[0]?.name
      : undefined
    return buildItemSemanticDocuments(row, { ownerName, locationName })
  }
  if (sourceType === 'story_thread') {
    const row = db.select().from(storyThreads).where(and(
      eq(storyThreads.id, sourceId),
      eq(storyThreads.novelId, novelId),
    )).all()[0]
    return row ? buildStoryThreadSemanticDocuments(row) : []
  }
  if (sourceType === 'timeline_event') {
    const row = db.select().from(timelineEvents).where(and(
      eq(timelineEvents.id, sourceId),
      eq(timelineEvents.novelId, novelId),
    )).all()[0]
    if (!row) return []
    const chapterIds = [row.chapterStartId, row.chapterEndId]
      .filter((id): id is number => typeof id === 'number')
    const chapterNumMap = chapterIds.length > 0
      ? new Map(db.select({
        id: chapters.id,
        chapterNum: chapters.chapterNum,
      }).from(chapters).where(and(
        eq(chapters.novelId, novelId),
        inArray(chapters.id, chapterIds),
      )).all().map((chapter) => [chapter.id, chapter.chapterNum] as const))
      : new Map<number, number>()
    const locationName = row.locationMapId
      ? db.select({ name: worldMap.name }).from(worldMap).where(and(
        eq(worldMap.id, row.locationMapId),
        eq(worldMap.novelId, novelId),
      )).all()[0]?.name
      : undefined
    return buildTimelineEventSemanticDocuments(row, {
      sourceChapterStart: row.chapterStartId ? chapterNumMap.get(row.chapterStartId) : undefined,
      sourceChapterEnd: row.chapterEndId ? chapterNumMap.get(row.chapterEndId) : undefined,
      entityRefs: locationName ? [locationName] : [],
    })
  }
  return []
}

export async function reindexSemanticMemorySource(
  novelId: number,
  sourceType: SemanticMemorySourceType,
  sourceId: number,
  options: IncrementalProjectionOptions = {},
): Promise<SemanticMemorySourceReindexResult> {
  if (!isIndexedSourceType(sourceType)) {
    throw new Error(`不支持的语义记忆来源类型：${sourceType}`)
  }
  const db = getDb()
  const novel = db.select({
    id: novels.id,
    contextVersion: novels.contextVersion,
    modelConfigId: novels.modelConfigId,
  }).from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error(`小说 ${novelId} 不存在。`)

  const documents = loadSourceDocuments(novelId, sourceType, sourceId)
  const prepared = await attachEmbeddings(
    novelId,
    documents,
    options.modelConfigId || novel.modelConfigId || undefined,
  )
  const existingRows = db.select().from(semanticMemoryEntries).where(and(
    eq(semanticMemoryEntries.novelId, novelId),
    eq(semanticMemoryEntries.sourceType, sourceType),
    eq(semanticMemoryEntries.sourceId, sourceId),
  )).all()
  preserveUnchangedEmbeddings(prepared, existingRows)
  const contextVersion = Math.max(1, novel.contextVersion || 1)
  let applied = false

  db.transaction((tx) => {
    if (options.outboxClaim) {
      const claimed = tx.select({
        id: semanticMemoryOutbox.id,
        revision: semanticMemoryOutbox.revision,
        status: semanticMemoryOutbox.status,
      }).from(semanticMemoryOutbox).where(and(
        eq(semanticMemoryOutbox.id, options.outboxClaim.id),
        eq(semanticMemoryOutbox.revision, options.outboxClaim.revision),
        eq(semanticMemoryOutbox.status, 'processing'),
      )).all()[0]
      if (!claimed) return
    }

    tx.delete(semanticMemoryEntries).where(and(
      eq(semanticMemoryEntries.novelId, novelId),
      eq(semanticMemoryEntries.sourceType, sourceType),
      eq(semanticMemoryEntries.sourceId, sourceId),
    )).run()
    insertPreparedDocuments(tx, novelId, contextVersion, prepared)
    if (options.outboxClaim) {
      tx.delete(semanticMemoryOutbox).where(and(
        eq(semanticMemoryOutbox.id, options.outboxClaim.id),
        eq(semanticMemoryOutbox.revision, options.outboxClaim.revision),
        eq(semanticMemoryOutbox.status, 'processing'),
      )).run()
    }
    applied = true
  })

  return {
    novelId,
    sourceType,
    sourceId,
    applied,
    ...buildReindexSummary(prepared),
  }
}

export async function reindexCoreSemanticMemory(
  novelId: number,
  modelConfigId?: number,
): Promise<SemanticMemoryReindexResult> {
  const db = getDb()
  const novel = db.select({
    id: novels.id,
    contextVersion: novels.contextVersion,
    modelConfigId: novels.modelConfigId,
  }).from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error(`小说 ${novelId} 不存在。`)

  const queuedRows = db.select({
    id: semanticMemoryOutbox.id,
    revision: semanticMemoryOutbox.revision,
  }).from(semanticMemoryOutbox).where(and(
    eq(semanticMemoryOutbox.novelId, novelId),
    inArray(semanticMemoryOutbox.sourceType, INDEXED_SOURCE_TYPES),
  )).all()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const itemRows = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const threadRows = db.select().from(storyThreads).where(eq(storyThreads.novelId, novelId)).all()
  const timelineRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const chapterRows = db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
  }).from(chapters).where(eq(chapters.novelId, novelId)).all()
  const characterNameMap = new Map(characterRows.map((character) => [character.id, character.fullName]))
  const locationNameMap = new Map(mapRows.map((location) => [location.id, location.name]))
  const chapterNumMap = new Map(chapterRows.map((chapter) => [chapter.id, chapter.chapterNum]))
  const documents = [
    ...characterRows.flatMap(buildCharacterSemanticDocuments),
    ...mapRows.flatMap(buildMapSemanticDocuments),
    ...itemRows.flatMap((item) => buildItemSemanticDocuments(item, {
      ownerName: item.ownerCharacterId ? characterNameMap.get(item.ownerCharacterId) : undefined,
      locationName: item.locationMapId ? locationNameMap.get(item.locationMapId) : undefined,
    })),
    ...threadRows.flatMap(buildStoryThreadSemanticDocuments),
    ...timelineRows.flatMap((event) => buildTimelineEventSemanticDocuments(event, {
      sourceChapterStart: event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined,
      sourceChapterEnd: event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined,
      entityRefs: [
        event.locationMapId ? locationNameMap.get(event.locationMapId) || '' : '',
      ],
    })),
  ]
  const contextVersion = Math.max(1, novel.contextVersion || 1)
  const prepared = await attachEmbeddings(
    novelId,
    documents,
    modelConfigId || novel.modelConfigId || undefined,
  )
  const existingRows = db.select().from(semanticMemoryEntries).where(and(
    eq(semanticMemoryEntries.novelId, novelId),
    inArray(semanticMemoryEntries.sourceType, INDEXED_SOURCE_TYPES),
  )).all()
  preserveUnchangedEmbeddings(prepared, existingRows)

  db.transaction((tx) => {
    tx.delete(semanticMemoryEntries).where(and(
      eq(semanticMemoryEntries.novelId, novelId),
      inArray(semanticMemoryEntries.sourceType, INDEXED_SOURCE_TYPES),
    )).run()
    insertPreparedDocuments(tx, novelId, contextVersion, prepared)
    queuedRows.forEach((row) => {
      tx.delete(semanticMemoryOutbox).where(and(
        eq(semanticMemoryOutbox.id, row.id),
        eq(semanticMemoryOutbox.revision, row.revision),
      )).run()
    })
  })

  return buildReindexSummary(prepared)
}

function claimSemanticMemoryOutbox(options: {
  novelId?: number
  limit?: number
}): SemanticMemoryOutboxClaim[] {
  const sqlite = getSqlite()
  const limit = Math.max(1, Math.min(200, Math.floor(options.limit || DEFAULT_OUTBOX_BATCH_SIZE)))
  const transaction = sqlite.transaction(() => {
    sqlite.prepare(`
      UPDATE semantic_memory_outbox
      SET status = 'pending',
          locked_at = NULL,
          available_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'processing'
        AND datetime(locked_at) <= datetime('now', ?)
    `).run(`-${OUTBOX_LOCK_TIMEOUT_MINUTES} minutes`)

    const rows = sqlite.prepare(`
      SELECT
        id,
        novel_id AS novelId,
        source_type AS sourceType,
        source_id AS sourceId,
        operation,
        revision,
        attempts
      FROM semantic_memory_outbox
      WHERE status IN ('pending', 'failed')
        AND datetime(COALESCE(available_at, CURRENT_TIMESTAMP)) <= datetime('now')
        ${typeof options.novelId === 'number' ? 'AND novel_id = ?' : ''}
      ORDER BY id ASC
      LIMIT ?
    `).all(...(typeof options.novelId === 'number' ? [options.novelId, limit] : [limit])) as Array<{
      id: number
      novelId: number
      sourceType: string
      sourceId: number
      operation: string
      revision: number
      attempts: number
    }>

    const claim = sqlite.prepare(`
      UPDATE semantic_memory_outbox
      SET status = 'processing',
          attempts = attempts + 1,
          locked_at = CURRENT_TIMESTAMP,
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND revision = ?
        AND status IN ('pending', 'failed')
    `)
    return rows.flatMap((row) => {
      if (!isIndexedSourceType(row.sourceType)) {
        sqlite.prepare(`
          DELETE FROM semantic_memory_outbox
          WHERE id = ? AND revision = ?
        `).run(row.id, row.revision)
        return []
      }
      const result = claim.run(row.id, row.revision)
      if (!result.changes) return []
      return [{
        id: row.id,
        novelId: row.novelId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        operation: row.operation === 'delete' ? 'delete' as const : 'upsert' as const,
        revision: row.revision,
        attempts: row.attempts + 1,
      }]
    })
  })

  return sqlite.inTransaction || typeof transaction.immediate !== 'function'
    ? transaction()
    : transaction.immediate()
}

function markOutboxClaimFailed(claim: SemanticMemoryOutboxClaim, error: unknown): void {
  const delaySeconds = Math.min(300, Math.max(5, 2 ** Math.min(claim.attempts, 8)))
  const message = error instanceof Error ? error.message : String(error || 'unknown error')
  getSqlite().prepare(`
    UPDATE semantic_memory_outbox
    SET status = 'failed',
        available_at = datetime('now', ?),
        locked_at = NULL,
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND revision = ?
      AND status = 'processing'
  `).run(`+${delaySeconds} seconds`, message.slice(0, 1200), claim.id, claim.revision)
}

async function processOutboxClaimGroup(
  claims: SemanticMemoryOutboxClaim[],
): Promise<Pick<SemanticMemoryOutboxProcessResult, 'processedCount' | 'supersededCount'>> {
  const db = getDb()
  const novelId = claims[0]?.novelId
  if (!novelId) return { processedCount: 0, supersededCount: 0 }
  const novel = db.select({
    id: novels.id,
    contextVersion: novels.contextVersion,
    modelConfigId: novels.modelConfigId,
  }).from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) {
    db.transaction((tx) => {
      claims.forEach((claim) => {
        tx.delete(semanticMemoryOutbox).where(and(
          eq(semanticMemoryOutbox.id, claim.id),
          eq(semanticMemoryOutbox.revision, claim.revision),
        )).run()
      })
    })
    return { processedCount: 0, supersededCount: claims.length }
  }

  const documentsByClaim = claims.map((claim) => ({
    claim,
    documents: loadSourceDocuments(claim.novelId, claim.sourceType, claim.sourceId),
  }))
  const preparedBatch = await attachEmbeddings(
    novelId,
    documentsByClaim.flatMap((entry) => entry.documents),
    novel.modelConfigId || undefined,
  )
  let offset = 0
  const projections = documentsByClaim.map((entry) => {
    const prepared = preparedBatch.slice(offset, offset + entry.documents.length)
    offset += entry.documents.length
    return { claim: entry.claim, prepared }
  })

  const existingRows: Array<typeof semanticMemoryEntries.$inferSelect> = []
  for (const sourceType of INDEXED_SOURCE_TYPES) {
    const sourceIds = claims
      .filter((claim) => claim.sourceType === sourceType)
      .map((claim) => claim.sourceId)
    if (sourceIds.length === 0) continue
    existingRows.push(...db.select().from(semanticMemoryEntries).where(and(
      eq(semanticMemoryEntries.novelId, novelId),
      eq(semanticMemoryEntries.sourceType, sourceType),
      inArray(semanticMemoryEntries.sourceId, sourceIds),
    )).all())
  }
  projections.forEach((projection) => {
    preserveUnchangedEmbeddings(projection.prepared, existingRows)
  })

  const contextVersion = Math.max(1, novel.contextVersion || 1)
  let processedCount = 0
  let supersededCount = 0
  db.transaction((tx) => {
    projections.forEach(({ claim, prepared }) => {
      const currentClaim = tx.select({
        id: semanticMemoryOutbox.id,
      }).from(semanticMemoryOutbox).where(and(
        eq(semanticMemoryOutbox.id, claim.id),
        eq(semanticMemoryOutbox.revision, claim.revision),
        eq(semanticMemoryOutbox.status, 'processing'),
      )).all()[0]
      if (!currentClaim) {
        supersededCount += 1
        return
      }

      tx.delete(semanticMemoryEntries).where(and(
        eq(semanticMemoryEntries.novelId, claim.novelId),
        eq(semanticMemoryEntries.sourceType, claim.sourceType),
        eq(semanticMemoryEntries.sourceId, claim.sourceId),
      )).run()
      insertPreparedDocuments(tx, claim.novelId, contextVersion, prepared)
      tx.delete(semanticMemoryOutbox).where(and(
        eq(semanticMemoryOutbox.id, claim.id),
        eq(semanticMemoryOutbox.revision, claim.revision),
        eq(semanticMemoryOutbox.status, 'processing'),
      )).run()
      processedCount += 1
    })
  })
  return { processedCount, supersededCount }
}

const outboxDrains = new Map<string, Promise<SemanticMemoryOutboxProcessResult>>()

export async function processSemanticMemoryOutbox(options: {
  novelId?: number
  limit?: number
} = {}): Promise<SemanticMemoryOutboxProcessResult> {
  const key = typeof options.novelId === 'number' ? `novel:${options.novelId}` : 'all'
  const existing = outboxDrains.get(key)
  if (existing) return existing

  const drain = (async () => {
    const claims = claimSemanticMemoryOutbox(options)
    const result: SemanticMemoryOutboxProcessResult = {
      claimedCount: claims.length,
      processedCount: 0,
      supersededCount: 0,
      failedCount: 0,
    }
    const claimsByNovel = new Map<number, SemanticMemoryOutboxClaim[]>()
    claims.forEach((claim) => {
      const group = claimsByNovel.get(claim.novelId) || []
      group.push(claim)
      claimsByNovel.set(claim.novelId, group)
    })
    for (const group of claimsByNovel.values()) {
      try {
        const groupResult = await processOutboxClaimGroup(group)
        result.processedCount += groupResult.processedCount
        result.supersededCount += groupResult.supersededCount
      } catch (error) {
        group.forEach((claim) => markOutboxClaimFailed(claim, error))
        result.failedCount += group.length
      }
    }
    return result
  })()
  outboxDrains.set(key, drain)
  try {
    return await drain
  } finally {
    if (outboxDrains.get(key) === drain) outboxDrains.delete(key)
  }
}

export async function searchSemanticMemory(
  novelId: number,
  queryText: string,
  options: SemanticMemorySearchOptions = {},
): Promise<SemanticMemorySearchHit[]> {
  if (options.refreshOutbox !== false) {
    try {
      await processSemanticMemoryOutbox({ novelId, limit: DEFAULT_OUTBOX_BATCH_SIZE })
    } catch (error) {
      console.warn(`[semantic-memory] 小说 ${novelId} 增量投影刷新失败:`, error)
    }
  }

  const db = getDb()
  const topK = Math.max(1, Math.min(20, Math.floor(options.topK || 6)))
  const sourceTypes = options.sourceTypes?.filter(isIndexedSourceType).length
    ? options.sourceTypes.filter(isIndexedSourceType)
    : INDEXED_SOURCE_TYPES
  const visibility = options.visibility || 'canon'
  const keywords = extractEmbeddingKeywords(queryText)
  const lookupKeywords = keywords.slice(0, MAX_LOOKUP_KEYWORDS)
  const validityFilters = buildValidityFilters(options.chapterNum)
  const cleanProjectionFilter = buildCleanProjectionFilter()
  const queryBatch = await embedSemanticTexts([queryText], options.modelConfigId)
  const queryEmbedding = queryBatch.embeddings?.[0]

  if (queryEmbedding && queryBatch.profile && queryBatch.dimensions) {
    const compatibilityFilters = [
      eq(semanticMemoryEntries.novelId, novelId),
      inArray(semanticMemoryEntries.sourceType, sourceTypes),
      eq(semanticMemoryEntries.visibility, visibility),
      eq(semanticMemoryEntries.embeddingProfile, queryBatch.profile),
      eq(semanticMemoryEntries.dimensions, queryBatch.dimensions),
      isNotNull(semanticMemoryEntries.embeddingJson),
      cleanProjectionFilter,
      ...validityFilters,
    ]
    const lexicalCandidateLimit = MAX_SEARCH_CANDIDATES - RECENT_SEARCH_CANDIDATES
    const ftsCandidateIds = querySemanticMemoryFtsCandidateIds({
      novelId,
      keywords: lookupKeywords,
      sourceTypes,
      visibility,
      chapterNum: options.chapterNum,
      embeddingProfile: queryBatch.profile,
      dimensions: queryBatch.dimensions,
      limit: lexicalCandidateLimit,
    })
    const ftsRows = ftsCandidateIds?.length
      ? db.select().from(semanticMemoryEntries)
        .where(and(
          ...compatibilityFilters,
          inArray(semanticMemoryEntries.id, ftsCandidateIds),
        ))
        .all()
      : []
    const likeKeywords = ftsCandidateIds === null
      ? lookupKeywords
      : lookupKeywords.filter((keyword) => keyword.length < MIN_FTS_TERM_LENGTH)
    const textMatches = likeKeywords.map((keyword) => like(semanticMemoryEntries.contentText, `%${keyword}%`))
    const likeRows = textMatches.length > 0
      ? db.select().from(semanticMemoryEntries)
        .where(and(...compatibilityFilters, or(...textMatches)))
        .orderBy(desc(semanticMemoryEntries.id))
        .limit(ftsCandidateIds === null ? lexicalCandidateLimit : MAX_SHORT_KEYWORD_CANDIDATES)
        .all()
      : []
    const recentRows = db.select().from(semanticMemoryEntries)
      .where(and(...compatibilityFilters))
      .orderBy(desc(semanticMemoryEntries.id))
      .limit(RECENT_SEARCH_CANDIDATES)
      .all()
    const candidates = [...new Map(
      [...likeRows, ...ftsRows, ...recentRows].map((row) => [row.id, row] as const),
    ).values()].slice(0, MAX_SEARCH_CANDIDATES)
    const vectorHits = candidates.flatMap((row) => {
      if (!isCompatibleEmbeddingRow(row, queryBatch.profile!, queryBatch.dimensions!)) return []
      try {
        const embedding = JSON.parse(row.embeddingJson || '')
        if (!Array.isArray(embedding)) return []
        return [{
          sourceType: row.sourceType as SemanticMemorySourceType,
          sourceId: row.sourceId,
          fragmentKey: row.fragmentKey,
          content: row.contentText,
          entityRefs: parseEntityRefs(row.entityRefsJson),
          similarity: cosineSimilarity(queryEmbedding, embedding),
          searchMode: 'vector' as const,
        }]
      } catch {
        return []
      }
    }).sort((left, right) => right.similarity - left.similarity)
    if (vectorHits.length > 0) return vectorHits.slice(0, topK)
  }

  const keywordCandidateLimit = Math.max(64, topK * 24)
  const keywordFilters = [
    eq(semanticMemoryEntries.novelId, novelId),
    inArray(semanticMemoryEntries.sourceType, sourceTypes),
    eq(semanticMemoryEntries.visibility, visibility),
    cleanProjectionFilter,
    ...validityFilters,
  ]
  const ftsCandidateIds = querySemanticMemoryFtsCandidateIds({
    novelId,
    keywords: lookupKeywords,
    sourceTypes,
    visibility,
    chapterNum: options.chapterNum,
    limit: keywordCandidateLimit,
  })
  const ftsRows = ftsCandidateIds?.length
    ? db.select().from(semanticMemoryEntries)
      .where(and(
        ...keywordFilters,
        inArray(semanticMemoryEntries.id, ftsCandidateIds),
      ))
      .all()
    : []
  const likeKeywords = ftsCandidateIds === null
    ? lookupKeywords
    : lookupKeywords.filter((keyword) => keyword.length < MIN_FTS_TERM_LENGTH)
  const textMatches = likeKeywords.map((keyword) => like(semanticMemoryEntries.contentText, `%${keyword}%`))
  const likeRows = textMatches.length > 0 || lookupKeywords.length === 0
    ? db.select().from(semanticMemoryEntries)
      .where(and(
        ...keywordFilters,
        ...(textMatches.length > 0 ? [or(...textMatches)] : []),
      ))
      .orderBy(desc(semanticMemoryEntries.id))
      .limit(ftsCandidateIds === null ? keywordCandidateLimit : Math.min(
        keywordCandidateLimit,
        MAX_SHORT_KEYWORD_CANDIDATES,
      ))
      .all()
    : []
  const keywordRows = [...new Map(
    [...likeRows, ...ftsRows].map((row) => [row.id, row] as const),
  ).values()].slice(0, keywordCandidateLimit)

  return keywordRows.map((row) => ({
    sourceType: row.sourceType as SemanticMemorySourceType,
    sourceId: row.sourceId,
    fragmentKey: row.fragmentKey,
    content: row.contentText,
    entityRefs: parseEntityRefs(row.entityRefsJson),
    similarity: keywordSimilarity(row.contentText, keywords),
    searchMode: 'keyword' as const,
  }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, topK)
}
