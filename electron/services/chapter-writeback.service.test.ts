import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  chapterFactExtracts,
  chapterWritebackDiffs,
  chapterWritebackRuns,
  chapters,
} from '../database/schema'
import { applyChapterWritebackRun } from './chapter-writeback.service'

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

function createRows(): TableRows {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [chapters, [
      {
        id: 11,
        novelId: 1,
        chapterNum: 5,
        title: '第五章',
        contextVersion: 4,
        writebackStatusJson: JSON.stringify({
          phase: 'ready',
          runId: 21,
          retryCount: 1,
          blockedGeneration: false,
          readyForNextChapter: true,
          contextVersion: 3,
          updatedAt: '2026-05-04T00:00:00.000Z',
        }),
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
    ]],
    [chapterWritebackRuns, [
      {
        id: 21,
        novelId: 1,
        chapterId: 11,
        status: 'draft',
        triggerSource: 'manual',
        summaryText: '待应用变更',
        retryCount: 1,
        sourceChapterVersion: 3,
        startedAt: '2026-05-04T00:00:00.000Z',
        completedAt: null,
        failedAt: null,
        errorMessage: null,
        lastAttemptAt: null,
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
    ]],
    [chapterWritebackDiffs, [
      {
        id: 31,
        runId: 21,
        assetType: 'thread',
        entityType: 'thread',
        entityId: 9,
        beforeStateJson: '{}',
        afterStateJson: '{"title":"旧仓库药箱线"}',
        diffReason: '更新线索状态',
        confidence: 0.88,
        verificationStatus: 'auto_ready',
        canonDecision: 'accepted',
        writebackStatus: 'pending',
        writebackError: null,
        sortOrder: 0,
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
    ]],
    [chapterFactExtracts, []],
  ])
}

describe('applyChapterWritebackRun', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('blocks apply when the chapter context version changed after the draft run was created', async () => {
    const rows = createRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = await applyChapterWritebackRun(21)

    const run = rows.get(chapterWritebackRuns)?.[0]
    const chapter = rows.get(chapters)?.[0]
    const diff = rows.get(chapterWritebackDiffs)?.[0]
    const syncStatus = JSON.parse(String(chapter?.writebackStatusJson))

    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toContain('上下文版本已从 v3 变为 v4')
    expect(result.activeRun?.status).toBe('failed')
    expect(result.activeRun?.errorMessage).toContain('上下文版本已从 v3 变为 v4')
    expect(syncStatus.blockedGeneration).toBe(true)
    expect(syncStatus.readyForNextChapter).toBe(false)
    expect(syncStatus.contextVersion).toBe(4)
    expect(diff?.writebackStatus).toBe('pending')
  })
})
