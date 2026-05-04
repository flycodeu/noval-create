import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import { chapters, characters } from '../database/schema'
import {
  analyzeSummaryHealthForChapter,
  refreshSummaryHealth,
} from './summary-decay.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createQuery(rowsByTable: TableRows, table: unknown) {
  const query: {
    where: () => typeof query
    orderBy: () => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: () => query,
    orderBy: () => query,
    all: () => rowsByTable.get(table) || [],
  }
  return query
}

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          run: vi.fn(() => {
            const rows = rowsByTable.get(table) || []
            if (rows.length > 0) Object.assign(rows[0], patch)
            return { changes: rows.length > 0 ? 1 : 0 }
          }),
        })),
      })),
    })),
  }
}

function createRows(summary = '他们去了。'): TableRows {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [chapters, [
      {
        id: 8,
        novelId: 1,
        chapterNum: 8,
        content: '林远冲进旧仓库救出副手。随后他带着药箱撤离，并决定连夜转移补给。',
        summary,
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
      { id: 1, novelId: 1, chapterNum: 4, content: '', summary: '前情摘要一。', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 2, novelId: 1, chapterNum: 5, content: '', summary: '前情摘要二。', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 3, novelId: 1, chapterNum: 6, content: '', summary: '前情摘要三。', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 4, novelId: 1, chapterNum: 7, content: '', summary: '前情摘要四。', updatedAt: '2026-05-01T00:00:00.000Z' },
    ]],
    [characters, [
      { fullName: '林远' },
      { fullName: '副手' },
      { fullName: '路人甲' },
    ]],
  ])
}

describe('summary-decay.service', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('marks thin summaries as degraded when key entities and events are missing', () => {
    vi.mocked(getDb).mockReturnValue(createDbMock(createRows()) as never)

    const report = analyzeSummaryHealthForChapter(8)

    expect(report).not.toBeNull()
    expect(report?.status).toBe('degraded')
    expect(report?.focusEntities).toEqual(['林远', '副手'])
    expect(report?.entityCoverageScore).toBeLessThan(45)
    expect(report?.eventCoverageScore).toBeLessThan(45)
  })

  it('recompresses degraded summaries from chapter content and persists the health report', () => {
    const rows = createRows('')
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const report = refreshSummaryHealth(8)

    const chapter = rows.get(chapters)?.[0]
    const persistedHealth = JSON.parse(String(chapter?.summaryHealthJson))

    expect(report).not.toBeNull()
    expect(report?.triggeredRecompression).toBe(true)
    expect(report?.status).toBe('warning')
    expect(report?.summaryPreview).toContain('林远冲进旧仓库救出副手')
    expect(chapter?.summary).toContain('林远冲进旧仓库救出副手')
    expect(persistedHealth.triggeredRecompression).toBe(true)
    expect(persistedHealth.summaryPreview).toContain('林远冲进旧仓库救出副手')
  })
})
