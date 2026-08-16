import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./model.service', () => ({
  getAdapterById: vi.fn(),
  getDefaultModelConfigRecord: vi.fn(() => ({ id: 7 })),
}))

import { getDb } from '../database/db'
import { chapterEmbeddings, chapters } from '../database/schema'
import { getAdapterById } from './model.service'
import {
  areUsableEmbeddings,
  extractEmbeddingKeywords,
  fallbackKeywordSearch,
  generateChapterEmbeddings,
  hashEmbeddingSource,
  resolveEmbeddingConfigCacheKey,
  searchSimilarFragments,
} from './embedding.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createDbMock(rowsByTable: TableRows) {
  const requestedLimits: number[] = []
  const makeQuery = (table: unknown) => {
    let limitValue: number | undefined
    const query = {
      where: () => query,
      orderBy: () => query,
      limit: (value: number) => {
        limitValue = value
        requestedLimits.push(value)
        return query
      },
      all: () => {
        const rows = rowsByTable.get(table) || []
        return typeof limitValue === 'number' ? rows.slice(0, limitValue) : rows
      },
    }
    return query
  }
  return {
    requestedLimits,
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => makeQuery(table)),
    })),
  }
}

describe('embedding fallback retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses bounded chapter content when finalized summary or embeddings are absent', async () => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapterEmbeddings, []],
      [chapters, [{
        id: 101,
        novelId: 1,
        chapterNum: 4,
        title: '井下回声',
        summary: '',
        nextChapterSeed: '',
        continuityStateJson: '',
        outline: '事故后重新确认安全责任。',
        content: '矿灯在巷道里晃了一下。\n\n事故留下的裂缝还在，叶振按住木楔，要求班组停工复查。',
      }]],
    ])
    const db = createDbMock(rows)
    vi.mocked(getDb).mockReturnValue(db as never)

    const direct = fallbackKeywordSearch(1, '矿灯 事故 安全责任', 5)
    expect(direct.some((hit) => hit.fragmentType === 'content_excerpt')).toBe(true)
    expect(direct.find((hit) => hit.fragmentType === 'content_excerpt')?.fragmentText).toContain('矿灯')
    expect(db.requestedLimits).toContain(160)

    const result = await searchSimilarFragments(1, '矿灯 事故 安全责任', 5)
    expect(result.fallbackReason).toBe('disabled_by_config')
    expect(result.hits.some((hit) => hit.fragmentType === 'content_excerpt')).toBe(true)
    expect(db.requestedLimits).toContain(1)
  })

  it('keeps query chunks separate and bounds keyword expansion', () => {
    const keywords = extractEmbeddingKeywords('矿灯 事故 安全责任 OpenAI', 12)

    expect(keywords).toContain('矿灯')
    expect(keywords).toContain('事故')
    expect(keywords).toContain('安全责任')
    expect(keywords).toContain('openai')
    expect(keywords).not.toContain('灯事')
    expect(keywords.length).toBeLessThanOrEqual(12)
  })

  it('rejects malformed or mixed-dimension embedding batches', () => {
    expect(areUsableEmbeddings([[0.1, 0.2], [0.3, 0.4]], 2)).toBe(true)
    expect(areUsableEmbeddings([[0.1], [0.2, 0.3]], 2)).toBe(false)
    expect(areUsableEmbeddings([[Number.NaN]], 1)).toBe(false)
    expect(areUsableEmbeddings([], 0)).toBe(false)
  })

  it('keeps source hashes stable across unrelated context version changes', () => {
    const fragments = [{ type: 'summary', text: '同一章内容' }]
    expect(hashEmbeddingSource(3, 7, fragments)).toBe(hashEmbeddingSource(3, 8, fragments))
    expect(hashEmbeddingSource(3, 8, fragments, 'config:7:a')).not.toBe(
      hashEmbeddingSource(3, 8, fragments, 'config:7:b'),
    )
    expect(hashEmbeddingSource(3, 8, fragments)).not.toBe(hashEmbeddingSource(3, 8, [{
      type: 'summary',
      text: '内容已变化',
    }]))
  })

  it('rejects a chapter that belongs to another novel before replacing its index', async () => {
    const db = createDbMock(new Map<unknown, Array<Record<string, unknown>>>([
      [chapters, [{
        id: 101,
        novelId: 2,
        chapterNum: 4,
        summary: '错误项目章节',
      }]],
    ]))
    vi.mocked(getDb).mockReturnValue(db as never)

    await expect(generateChapterEmbeddings(1, 101, 7)).rejects.toThrow('不属于小说 1')
    expect(getAdapterById).not.toHaveBeenCalled()
  })

  it('reuses unchanged chapter vectors without calling the embedding adapter', async () => {
    const fragments = [{ type: 'summary', text: '同一章摘要' }]
    const insertedRows: Array<Record<string, unknown>> = []
    const rowsByTable = new Map<unknown, Array<Record<string, unknown>>>([
      [chapters, [{
        id: 101,
        novelId: 1,
        chapterNum: 4,
        summary: fragments[0].text,
        contextVersion: 9,
      }]],
      [chapterEmbeddings, [{
        id: 1,
        novelId: 1,
        chapterId: 101,
        fragmentType: 'summary',
        embeddingJson: '[0.1,0.2]',
        modelId: 'local:Xenova/bge-small-zh-v1.5:q8',
        dimensions: 2,
        embeddingProfile: 'local:Xenova/bge-small-zh-v1.5:q8:2',
        sourceHash: hashEmbeddingSource(101, 9, fragments, resolveEmbeddingConfigCacheKey()),
      }]],
    ])
    const db = createDbMock(rowsByTable)
    vi.mocked(getDb).mockReturnValue({
      ...db,
      transaction: (callback: (tx: unknown) => unknown) => callback({
        delete: () => ({ where: () => ({ run: () => undefined }) }),
        insert: () => ({
          values: (row: Record<string, unknown>) => ({
            run: () => insertedRows.push(row),
          }),
        }),
      }),
    } as never)

    await generateChapterEmbeddings(1, 101)

    expect(getAdapterById).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].embeddingJson).toBe('[0.1,0.2]')
  })
})
