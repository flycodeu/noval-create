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
}))

import { getSqlite } from '../database/db'
import {
  buildSemanticMemoryFtsQuery,
  querySemanticMemoryFtsCandidateIds,
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
})
