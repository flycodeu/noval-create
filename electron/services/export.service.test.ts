import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
}))

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

import { getDb } from '../database/db'
import { chapters, novels } from '../database/schema'
import { formatNovelForPlatform } from './export.service'

function createQuery(rows: Array<Record<string, unknown>>) {
  const query: {
    where: () => typeof query
    orderBy: () => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: () => query,
    orderBy: () => query,
    all: () => rows,
  }
  return query
}

function createDbMock() {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table === novels) {
          return createQuery([{ id: 1, title: '测试小说', synopsis: '', totalWords: 0, status: 'draft' }])
        }
        if (table === chapters) {
          return createQuery([
            { id: 101, novelId: 1, chapterNum: 1, title: '旧仓', content: '林远打开微信，看见旧仓库的灯。', wordCount: 0 },
            { id: 102, novelId: 1, chapterNum: 2, title: '撤离', content: '以下是优化后的正文：\n他们撤离旧仓库。', wordCount: 0 },
            { id: 103, novelId: 1, chapterNum: 3, title: '转移', content: '补给在夜里转移。', wordCount: 0 },
          ])
        }
        return createQuery([])
      }),
    })),
  }
}

describe('export.service platform formatting', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
    vi.mocked(getDb).mockReturnValue(createDbMock() as never)
  })

  it('returns cleaned platform content with risk word hits and batches', () => {
    const result = formatNovelForPlatform(1, {
      platform: 'fanqie',
      scope: 'all',
      batchSize: 2,
      sensitiveWords: ['旧仓库'],
    })

    expect(result.content).toContain('第1章 旧仓')
    expect(result.content).not.toContain('以下是优化后的正文')
    expect(result.removedLineCount).toBe(1)
    expect(result.sensitiveWordHits.some((hit) => hit.word === '微信')).toBe(true)
    expect(result.sensitiveWordHits.some((hit) => hit.word === '旧仓库')).toBe(true)
    expect(result.batches).toHaveLength(2)
    expect(result.batches[0]).toMatchObject({ chapterCount: 2, chapterStart: 1, chapterEnd: 2 })
  })
})
