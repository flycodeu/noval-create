import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

vi.mock('./embedding.service', () => ({
  cosineSimilarity: vi.fn(),
  embedSemanticTexts: vi.fn(),
  extractEmbeddingKeywords: vi.fn(),
  isCompatibleEmbeddingRow: vi.fn(),
  isUsableEmbedding: vi.fn(),
  resolveEmbeddingConfigCacheKey: vi.fn(() => 'config:7:test'),
}))

import { getDb, getSqlite } from '../database/db'
import { characters, novels, semanticMemoryEntries } from '../database/schema'
import { buildCharacterSemanticDocuments } from '../../src/shared/semantic-memory'
import { embedSemanticTexts, isUsableEmbedding } from './embedding.service'
import {
  buildSemanticMemoryFtsQuery,
  getSemanticMemoryOutboxStatus,
  hashSemanticDocument,
  querySemanticMemoryFtsCandidateIds,
  reindexSemanticMemorySource,
} from './semantic-memory.service'

describe('semantic memory FTS candidate retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses trigram only for terms with at least three characters', () => {
    expect(buildSemanticMemoryFtsQuery([
      '沈砚',
      '补给线',
      '旧仓库',
      '仓库',
      '补给线',
    ])).toBe('"补给线" OR "旧仓库"')
    expect(buildSemanticMemoryFtsQuery(['沈砚', '仓库', '药箱'])).toBeNull()
  })

  it('filters candidates by novel, scope, validity, profile, and clean projection', () => {
    let preparedSql = ''
    let boundParameters: unknown[] = []
    vi.mocked(getSqlite).mockReturnValue({
      prepare: vi.fn((statement: string) => {
        preparedSql = statement
        return {
          all: (...parameters: unknown[]) => {
            boundParameters = parameters
            return [{ id: 17 }, { id: 19 }, { id: 'invalid' }]
          },
        }
      }),
    } as never)

    const ids = querySemanticMemoryFtsCandidateIds({
      novelId: 8,
      keywords: ['沈砚', '旧仓库'],
      sourceTypes: ['character', 'map'],
      visibility: 'canon',
      chapterNum: 36,
      embeddingProfile: 'local:384',
      dimensions: 384,
      limit: 120,
    })

    expect(ids).toEqual([17, 19])
    expect(preparedSql).toContain('INNER JOIN semantic_memory_entries AS entry')
    expect(preparedSql).toContain('entry.novel_id = ?')
    expect(preparedSql).toContain('entry.source_type IN (?, ?)')
    expect(preparedSql).toContain('entry.valid_from_chapter IS NULL')
    expect(preparedSql).toContain('entry.embedding_profile = ?')
    expect(preparedSql).toContain('FROM semantic_memory_outbox AS dirty')
    expect(boundParameters).toEqual([
      '"旧仓库"',
      8,
      'character',
      'map',
      'canon',
      36,
      36,
      'local:384',
      384,
      120,
    ])
  })

  it('returns a fallback signal when FTS is unavailable or malformed', () => {
    vi.mocked(getSqlite).mockReturnValue({
      prepare: vi.fn(() => ({
        all: () => {
          throw new Error('no such table: semantic_memory_fts')
        },
      })),
    } as never)

    expect(querySemanticMemoryFtsCandidateIds({
      novelId: 8,
      keywords: ['补给线'],
      sourceTypes: ['character'],
      visibility: 'canon',
      limit: 64,
    })).toBeNull()
  })

  it('skips SQLite when the query only contains short terms', () => {
    expect(querySemanticMemoryFtsCandidateIds({
      novelId: 8,
      keywords: ['沈砚', '仓库'],
      sourceTypes: ['character', 'map'],
      visibility: 'canon',
      limit: 64,
    })).toEqual([])
    expect(getSqlite).not.toHaveBeenCalled()
  })

  it('reports retry and dead-letter backlog for maintenance observability', () => {
    vi.mocked(getSqlite).mockReturnValue({
      prepare: vi.fn(() => ({
        get: () => ({
          pendingCount: 3,
          retryingCount: 2,
          processingCount: 1,
          deadLetterCount: 4,
          oldestQueuedAt: '2026-08-16 10:00:00',
        }),
      })),
    } as never)

    expect(getSemanticMemoryOutboxStatus()).toEqual({
      pendingCount: 3,
      retryingCount: 2,
      processingCount: 1,
      deadLetterCount: 4,
      oldestQueuedAt: '2026-08-16 10:00:00',
    })
  })

  it('reuses unchanged source embeddings before calling the embedding service', async () => {
    const character = {
      id: 11,
      novelId: 8,
      fullName: '沈砚',
      roleType: 'protagonist',
      occupation: '调查员',
    }
    const documents = buildCharacterSemanticDocuments(character as never)
    const existingRows = documents.map((document, index) => ({
      id: index + 1,
      novelId: 8,
      sourceType: document.sourceType,
      sourceId: document.sourceId,
      fragmentKey: document.fragmentKey,
      sourceHash: hashSemanticDocument(8, document, 'config:7:test'),
      embeddingJson: '[0.1,0.2]',
      modelId: 'local:test',
      dimensions: 2,
      embeddingProfile: 'local:test:2',
    }))
    const insertedRows: Array<Record<string, unknown>> = []
    vi.mocked(isUsableEmbedding).mockReturnValue(true)
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: (table: unknown) => {
          const rows = table === novels
            ? [{ id: 8, contextVersion: 3, modelConfigId: 7 }]
            : table === characters
              ? [character]
              : table === semanticMemoryEntries
                ? existingRows
                : []
          const query = {
            where: () => query,
            all: () => rows,
          }
          return query
        },
      }),
      transaction: (callback: (tx: unknown) => unknown) => callback({
        delete: () => ({ where: () => ({ run: () => undefined }) }),
        insert: () => ({
          values: (row: Record<string, unknown>) => ({
            run: () => insertedRows.push(row),
          }),
        }),
      }),
    } as never)

    const result = await reindexSemanticMemorySource(8, 'character', 11)

    expect(embedSemanticTexts).not.toHaveBeenCalled()
    expect(result.vectorizedCount).toBe(documents.length)
    expect(insertedRows).toHaveLength(documents.length)
  })
})
