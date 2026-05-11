import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

vi.mock('./asset-impact.service', () => ({
  resolveChapterAssetImpacts: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  chapterFactExtracts,
  chapterWritebackDiffs,
  chapterWritebackRuns,
  chapters,
  novels,
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
    [novels, [
      {
        id: 1,
        title: '来源回写测试',
        status: 'draft',
        totalWords: 0,
        targetWords: 120000,
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

  it('syncs chapter source/canon usage back into novel-level ledger fields after a successful apply', async () => {
    const rows = createRows()
    const run = rows.get(chapterWritebackRuns)?.[0]
    const diff = rows.get(chapterWritebackDiffs)?.[0]
    const novel = rows.get(novels)?.[0]

    if (!run || !diff || !novel) {
      throw new Error('test fixture missing run, diff, or novel row')
    }

    Object.assign(run, {
      sourceChapterVersion: 4,
    })
    Object.assign(diff, {
      assetType: 'character',
      entityType: 'character-state',
      entityId: 9,
      afterStateJson: '{"fullName":"林远","summary":"确认旧仓暗格的位置"}',
      diffReason: '章节明确确认了角色掌握的旧仓线索',
      verificationStatus: 'auto_ready',
      canonDecision: 'accepted',
      writebackStatus: 'pending',
    })
    rows.set(chapterFactExtracts, [
      {
        id: 41,
        runId: 21,
        assetType: 'character',
        sourceText: '林远记得旧仓暗格的位置。',
        factJson: '{"fullName":"林远","summary":"记得旧仓暗格的位置"}',
        confidence: 0.91,
        verificationStatus: 'auto_ready',
        sortOrder: 0,
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
    ])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = await applyChapterWritebackRun(21)
    const chapterUsage = JSON.parse(String(novel.chapterSourceUsageJson || '[]'))
    const sourceLedger = JSON.parse(String(novel.sourceLedgerJson || '[]'))
    const factProvenance = JSON.parse(String(novel.factProvenanceJson || '[]'))
    const canonCards = JSON.parse(String(novel.canonFactCardsJson || '[]'))

    expect(result.activeRun?.status).toBe('applied')
    expect(diff.writebackStatus).toBe('applied')
    expect(chapterUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        usageKey: 'chapter:11',
        runId: 21,
        extractedCount: 1,
        appliedDiffCount: 1,
      }),
    ]))
    expect(sourceLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chapterId: 11,
        runId: 21,
        assetType: 'character',
        sourceText: '林远记得旧仓暗格的位置。',
      }),
    ]))
    expect(factProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provenanceKey: 'run:21:diff:31',
        chapterId: 11,
        entityId: 9,
        assetType: 'character',
      }),
    ]))
    expect(canonCards).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardKey: 'character:9',
        title: '林远',
        sourceChapterId: 11,
      }),
    ]))
    expect(String(novel.canonSourceLedgerJson || '[]')).toContain('林远记得旧仓暗格的位置。')
  })

  it('syncs extract-only source usage back into novel-level ledger fields even when no diff is applied', async () => {
    const rows = createRows()
    const run = rows.get(chapterWritebackRuns)?.[0]
    const diff = rows.get(chapterWritebackDiffs)?.[0]
    const novel = rows.get(novels)?.[0]

    if (!run || !diff || !novel) {
      throw new Error('test fixture missing run, diff, or novel row')
    }

    Object.assign(run, {
      sourceChapterVersion: 4,
    })
    Object.assign(diff, {
      canonDecision: 'pending',
      writebackStatus: 'pending',
    })
    rows.set(chapterFactExtracts, [
      {
        id: 42,
        runId: 21,
        assetType: 'thread',
        sourceText: '旧仓库药箱线再次被提起。',
        factJson: '{"title":"旧仓库药箱线","summary":"本章再次提起"}',
        confidence: 0.84,
        verificationStatus: 'auto_ready',
        sortOrder: 0,
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
      },
    ])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = await applyChapterWritebackRun(21)
    const chapterUsage = JSON.parse(String(novel.chapterSourceUsageJson || '[]'))
    const sourceLedger = JSON.parse(String(novel.sourceLedgerJson || '[]'))
    const factProvenance = JSON.parse(String(novel.factProvenanceJson || '[]'))
    const canonCards = JSON.parse(String(novel.canonFactCardsJson || '[]'))

    expect(result.activeRun?.status).toBe('applied')
    expect(diff.writebackStatus).toBe('skipped')
    expect(chapterUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({
        usageKey: 'chapter:11',
        runId: 21,
        extractedCount: 1,
        appliedDiffCount: 0,
      }),
    ]))
    expect(sourceLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        chapterId: 11,
        runId: 21,
        assetType: 'thread',
        sourceText: '旧仓库药箱线再次被提起。',
      }),
    ]))
    expect(factProvenance).toEqual([])
    expect(canonCards).toEqual([])
    expect(String(novel.canonSourceLedgerJson || '[]')).toContain('旧仓库药箱线再次被提起。')
  })
})
