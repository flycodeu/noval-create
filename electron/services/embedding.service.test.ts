import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(() => { throw new Error('Native vector extension is unavailable in this unit fixture') }),
}))

vi.mock('./model.service', () => ({
  getAdapterById: vi.fn(),
  getDefaultModelConfigRecord: vi.fn(() => ({ id: 7 })),
  getModelConfigRecord: vi.fn(() => ({ id: 7 })),
}))

vi.mock('./embedding-settings.service', async () => {
  const { getAdapterById } = await import('./model.service')
  const { LOCAL_EMBEDDING_MODEL_ID } = await import('../../src/shared/embedding-settings')
  return {
    embeddingRuntimeIdentity: vi.fn(() => ({ settings: { mode: 'local', modelConfigId: null, modelId: '' }, modelId: LOCAL_EMBEDDING_MODEL_ID, key: LOCAL_EMBEDDING_MODEL_ID })),
    embeddingRemoteAdapter: vi.fn(async () => ({ settings: { mode: 'remote', modelId: 'fixture-vector' }, modelId: 'fixture-vector', adapter: await getAdapterById(7) })),
  }
})
import { embeddingRemoteAdapter, embeddingRuntimeIdentity } from './embedding-settings.service'
import { getDb } from '../database/db'
import { chapterEmbeddings, chapters } from '../database/schema'
import { getAdapterById } from './model.service'
import { LOCAL_EMBEDDING_MODEL_ID } from '../../src/shared/embedding-settings'
import {
  areUsableEmbeddings,
  buildEmbeddingProfile,
  extractEmbeddingKeywords,
  fallbackKeywordSearch,
  generateChapterEmbeddings,
  indexChapterForKeywordRecall,
  hashEmbeddingSource,
  resolveEmbeddingConfigCacheKey,
  searchSimilarFragments,
  savedProseEmbeddingFragments,
  isProseEmbeddingFragment,
  isCompatibleEmbeddingRow,
} from './embedding.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>
// Historical rows intentionally retain the pre-upgrade runtime identity.
const LEGACY_LOCAL_EMBEDDING_MODEL_ID = 'local:Xenova/bge-small-zh-v1.5:q8'

function queryHash(query: string): string {
  return `sha256:${createHash('sha256').update(query.trim(), 'utf8').digest('hex')}`
}

function createDbMock(rowsByTable: TableRows) {
  const requestedLimits: number[] = []
  const makeQuery = (table: unknown) => {
    let limitValue: number | undefined
    const query = {
      where: () => query,
      orderBy: () => query,
      innerJoin: () => query,
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
    vi.mocked(embeddingRuntimeIdentity).mockReturnValue({ settings: { mode: 'local', modelConfigId: null, modelId: '' }, modelId: LOCAL_EMBEDDING_MODEL_ID, key: LOCAL_EMBEDDING_MODEL_ID })
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

  it('rejects an explicitly invalid historical boundary', async () => {
    expect(() => fallbackKeywordSearch(1, '历史', 5, { beforeChapterNum: 0 })).toThrow('beforeChapterNum 必须是正整数')
    await expect(
      searchSimilarFragments(1, '历史', 5, undefined, { beforeChapterNum: 1.5 }),
    ).rejects.toThrow('beforeChapterNum 必须是正整数')
    await expect(
      searchSimilarFragments(1, '历史', 5, undefined, { beforeChapterNum: Number.NaN }),
    ).rejects.toThrow('beforeChapterNum 必须是正整数')
  })

  it('consumes a compatible prepared query without embedding again', async () => {
    const db = createDbMock(new Map<unknown, Array<Record<string, unknown>>>([
      [chapterEmbeddings, [{
        id: 1,
        novelId: 1,
        chapterId: 101,
        chapterNum: 3,
        fragmentType: 'summary',
        fragmentText: '历史线索',
        embeddingJson: '[1,0]',
        dimensions: 2,
        embeddingProfile: 'stub-model:2',
      }]],
      [chapters, [{ id: 101, novelId: 1, chapterNum: 3 }]],
    ]))
    vi.mocked(getDb).mockReturnValue(db as never)

    const result = await searchSimilarFragments(1, '  历史  ', 1, 7, {
      beforeChapterNum: 4,
      preparedQuery: {
        queryHash: queryHash('历史'),
        profile: 'stub-model:2',
        dimensions: 2,
        embedding: [1, 0],
      },
    })

    expect(getAdapterById).not.toHaveBeenCalled()
    expect(result.hits[0]).toMatchObject({ chapterId: 101, chapterNum: 3, searchMode: 'vector' })
  })

  it('uses keyword fallback for null or incompatible prepared queries', async () => {
    const db = createDbMock(new Map<unknown, Array<Record<string, unknown>>>([
      [chapterEmbeddings, [{
        id: 1,
        novelId: 1,
        chapterId: 101,
        chapterNum: 3,
        fragmentType: 'summary',
        fragmentText: '历史线索',
        embeddingJson: '[1,0]',
        dimensions: 2,
        embeddingProfile: 'stub-model:2',
      }]],
      [chapters, [{ id: 101, novelId: 1, chapterNum: 3 }]],
    ]))
    vi.mocked(getDb).mockReturnValue(db as never)

    const nullPrepared = await searchSimilarFragments(1, '历史', 1, 7, { preparedQuery: null })
    expect(nullPrepared.fallbackReason).toBe('query_embedding_failed')
    expect(nullPrepared.hits[0].searchMode).toBe('keyword')
    expect(getAdapterById).not.toHaveBeenCalled()

    const invalidPrepared = await searchSimilarFragments(1, '历史', 1, 7, {
      preparedQuery: {
        queryHash: 'sha256:not-this-query',
        profile: 'stub-model:2',
        dimensions: 2,
        embedding: [1, 0],
      },
    })
    expect(invalidPrepared.fallbackReason).toBe('query_embedding_failed')
    expect(invalidPrepared.hits[0].searchMode).toBe('keyword')
    expect(getAdapterById).not.toHaveBeenCalled()
  })

  it('rejects malformed or mixed-dimension embedding batches', () => {
    expect(areUsableEmbeddings([[0.1, 0.2], [0.3, 0.4]], 2)).toBe(true)
    expect(areUsableEmbeddings([[0.1], [0.2, 0.3]], 2)).toBe(false)
    expect(areUsableEmbeddings([[Number.NaN]], 1)).toBe(false)
    expect(areUsableEmbeddings([], 0)).toBe(false)
    expect(areUsableEmbeddings([[0,0]], 1)).toBe(false)
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

  it('indexes every saved prose paragraph including the middle without plans', () => {
    const content = `${'首段'.repeat(810)}\n\n唯一中段线索，铜牌藏在书箱底。\n\n${'尾段'.repeat(810)}`
    const fragments = savedProseEmbeddingFragments(content)
    expect(fragments.every(fragment => fragment.text.length <= 1600)).toBe(true)
    expect(fragments.map(fragment => fragment.text).join('\n\n')).toContain('唯一中段线索')
    expect(fragments.every(fragment => isProseEmbeddingFragment(fragment.type))).toBe(true)
    expect(isProseEmbeddingFragment('seed')).toBe(false)
    const edited = content.replace('铜牌', '玉牌')
    expect(hashEmbeddingSource(3, 7, fragments)).not.toBe(hashEmbeddingSource(3, 7, savedProseEmbeddingFragments(edited)))
    expect(savedProseEmbeddingFragments(' \n\n ')).toEqual([])
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
        modelId: LOCAL_EMBEDDING_MODEL_ID,
        dimensions: 2,
        embeddingProfile: buildEmbeddingProfile(LOCAL_EMBEDDING_MODEL_ID, 2),
        sourceHash: hashEmbeddingSource(101, 9, fragments, resolveEmbeddingConfigCacheKey()),
      }]],
    ])
    const db = createDbMock(rowsByTable)
    vi.mocked(getDb).mockReturnValue({
      ...db,
      transaction: (callback: (tx: unknown) => unknown) => callback({
        select: db.select,
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

  it('indexes saved prose immediately without calling a vector provider', () => {
    const insertedRows: Array<Record<string, unknown>> = []
    const db = createDbMock(new Map<unknown, Array<Record<string, unknown>>>([
      [chapters, [{ id: 101, novelId: 1, chapterNum: 4, content: '陆闻将旧铜灯移到干燥石台。', contextVersion: 9 }]],
      [chapterEmbeddings, []],
    ]))
    vi.mocked(getDb).mockReturnValue({ ...db, transaction: (callback: (tx: unknown) => unknown) => callback({
      delete: () => ({ where: () => ({ run: () => undefined }) }),
      insert: () => ({ values: (row: Record<string, unknown>) => ({ run: () => insertedRows.push(row) }) }),
    }) } as never)
    indexChapterForKeywordRecall(1, 101)
    expect(getAdapterById).not.toHaveBeenCalled()
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({ chapterId: 101, fragmentType: 'content_excerpt', embeddingJson: null, visibility: 'canon' })
    expect(insertedRows[0].fragmentText).toContain('旧铜灯')
  })

  it('does not replace a newer chapter index when vector work finishes after an edit', async () => {
    vi.mocked(embeddingRuntimeIdentity).mockReturnValue({ settings: { mode: 'remote', modelId: 'fixture-vector', modelConfigId: 7 }, modelId: 'fixture-vector', key: 'fixture-vector' })
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapters, [{ id: 101, novelId: 1, chapterNum: 4, summary: '旧稿摘要', contextVersion: 9 }]],
      [chapterEmbeddings, []],
    ])
    const db = createDbMock(rows)
    const remove = vi.fn()
    const insert = vi.fn()
    vi.mocked(getDb).mockReturnValue({ ...db, transaction: (callback: (tx: unknown) => unknown) => callback({
      select: db.select,
      delete: () => ({ where: () => ({ run: remove }) }),
      insert: () => ({ values: () => ({ run: insert }) }),
    }) } as never)
    vi.mocked(getAdapterById).mockReturnValue({ embed: vi.fn(async () => {
      rows.set(chapters, [{ id: 101, novelId: 1, chapterNum: 4, summary: '刚保存的新稿', contextVersion: 10 }])
      return [[0.1, 0.2]]
    }) } as never)
    await generateChapterEmbeddings(1, 101, 7)
    expect(remove).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('rejects historical local vector profiles even when their dimensions still match', () => {
    const currentProfile = buildEmbeddingProfile(LOCAL_EMBEDDING_MODEL_ID, 2)
    const historicalProfile = buildEmbeddingProfile(LEGACY_LOCAL_EMBEDDING_MODEL_ID, 2)
    expect(currentProfile).not.toBe(historicalProfile)
    expect(isCompatibleEmbeddingRow({ embeddingJson: '[0.1,0.2]', dimensions: 2, embeddingProfile: historicalProfile }, currentProfile, 2)).toBe(false)
    expect(isCompatibleEmbeddingRow({ embeddingJson: '[0.1,0.2]', dimensions: 2, embeddingProfile: currentProfile }, currentProfile, 2)).toBe(true)
  })

  it.each(['source hash', 'model', 'source hash and model'] as const)('refreshes unchanged chapter text instead of reusing a legacy %s', async (legacyField) => {
    const fragments = [{ type: 'summary', text: '升级前后正文没有修改，铜灯仍留在书箱底。' }]
    const currentHash = hashEmbeddingSource(101, 9, fragments, LOCAL_EMBEDDING_MODEL_ID)
    const legacyHash = hashEmbeddingSource(101, 9, fragments, LEGACY_LOCAL_EMBEDDING_MODEL_ID)
    const historicalModel = legacyField.includes('model') ? LEGACY_LOCAL_EMBEDDING_MODEL_ID : LOCAL_EMBEDDING_MODEL_ID
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapters, [{ id: 101, novelId: 1, chapterNum: 4, summary: fragments[0].text, contextVersion: 9 }]],
      [chapterEmbeddings, [{ id: 1, novelId: 1, chapterId: 101, fragmentType: 'summary', fragmentText: fragments[0].text,
        embeddingJson: '[0.1,0.2]', modelId: historicalModel, dimensions: 2,
        embeddingProfile: buildEmbeddingProfile(historicalModel, 2), sourceHash: legacyField.includes('source hash') ? legacyHash : currentHash }]],
    ])
    const insertedRows: Array<Record<string, unknown>> = []
    const remove = vi.fn()
    const db = createDbMock(rows)
    vi.mocked(getDb).mockReturnValue({ ...db, transaction: (callback: (tx: unknown) => unknown) => callback({
      select: db.select,
      delete: () => ({ where: () => ({ run: remove }) }),
      insert: () => ({ values: (row: Record<string, unknown>) => ({ run: () => insertedRows.push(row) }) }),
    }) } as never)
    // Reuse the existing adapter fixture as a deterministic stand-in for the new
    // runtime output. No model download, native inference or provider is used.
    const embed = vi.fn(async () => [[0.3, 0.4]])
    vi.mocked(embeddingRuntimeIdentity).mockReturnValue({ settings: { mode: 'remote', modelConfigId: 7, modelId: 'fixture-vector' }, modelId: LOCAL_EMBEDDING_MODEL_ID, key: LOCAL_EMBEDDING_MODEL_ID })
    vi.mocked(embeddingRemoteAdapter).mockResolvedValue({ settings: { mode: 'remote', modelConfigId: 7, modelId: 'fixture-vector' }, modelId: LOCAL_EMBEDDING_MODEL_ID, key: LOCAL_EMBEDDING_MODEL_ID, adapter: { embed } } as never)

    const result = await generateChapterEmbeddings(1, 101)

    expect(currentHash).not.toBe(legacyHash)
    expect(embed).toHaveBeenCalledOnce()
    expect(embed).toHaveBeenCalledWith([fragments[0].text], { model: 'fixture-vector' })
    expect(result).toMatchObject({ applied: true, documentCount: 1, vectorizedCount: 1 })
    expect(remove).toHaveBeenCalledOnce()
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({ embeddingJson: '[0.3,0.4]', modelId: LOCAL_EMBEDDING_MODEL_ID,
      embeddingProfile: buildEmbeddingProfile(LOCAL_EMBEDDING_MODEL_ID, 2), sourceHash: currentHash })
  })

  it('keeps historical rows intact and uses keyword recall when only legacy vectors exist', async () => {
    const historicalRow = { id: 1, novelId: 1, chapterId: 101, chapterNum: 3, fragmentType: 'summary', fragmentText: '铜灯藏在书箱底。',
      embeddingJson: '[1,0]', modelId: LEGACY_LOCAL_EMBEDDING_MODEL_ID, dimensions: 2,
      embeddingProfile: buildEmbeddingProfile(LEGACY_LOCAL_EMBEDDING_MODEL_ID, 2), sourceHash: 'historical-source-hash' }
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapterEmbeddings, [historicalRow]],
      [chapters, [{ id: 101, novelId: 1, chapterNum: 3, summary: historicalRow.fragmentText }]],
    ])
    const before = structuredClone(historicalRow)
    const db = createDbMock(rows)
    const remove = vi.fn()
    const insert = vi.fn()
    const transaction = vi.fn()
    vi.mocked(getDb).mockReturnValue({ ...db, delete: remove, insert, transaction } as never)

    const result = await searchSimilarFragments(1, '铜灯', 5, undefined, { preparedQuery: {
      queryHash: queryHash('铜灯'), profile: buildEmbeddingProfile(LOCAL_EMBEDDING_MODEL_ID, 2), dimensions: 2, embedding: [1, 0],
    } })

    expect(result.fallbackReason).toBe('embedding_profile_mismatch')
    expect(result.hits).toContainEqual(expect.objectContaining({ chapterId: 101, fragmentText: historicalRow.fragmentText, searchMode: 'keyword' }))
    expect(result.hits.every(hit => hit.searchMode === 'keyword')).toBe(true)
    expect(getAdapterById).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
    expect(transaction).not.toHaveBeenCalled()
    expect(rows.get(chapterEmbeddings)).toEqual([before])
  })
})
