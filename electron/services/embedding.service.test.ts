import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import { chapterEmbeddings, chapters } from '../database/schema'
import { fallbackKeywordSearch, searchSimilarFragments } from './embedding.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          all: vi.fn(() => rowsByTable.get(table) || []),
        })),
      })),
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
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const direct = fallbackKeywordSearch(1, '矿灯 事故 安全责任', 5)
    expect(direct.some((hit) => hit.fragmentType === 'content_excerpt')).toBe(true)
    expect(direct.find((hit) => hit.fragmentType === 'content_excerpt')?.fragmentText).toContain('矿灯')

    const result = await searchSimilarFragments(1, '矿灯 事故 安全责任', 5)
    expect(result.fallbackReason).toBe('disabled_by_config')
    expect(result.hits.some((hit) => hit.fragmentType === 'content_excerpt')).toBe(true)
  })
})
