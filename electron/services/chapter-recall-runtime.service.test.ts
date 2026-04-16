import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./context.service', () => ({
  allocateChapterContext: vi.fn(),
  collectChapterContextRawData: vi.fn(),
  ContextOverflowError: class ContextOverflowError extends Error {
    context: Record<string, unknown>

    constructor(context: Record<string, unknown>) {
      super('Context overflow')
      this.context = context
    }
  },
  HardConstraintOverflowError: class HardConstraintOverflowError extends Error {
    context: Record<string, unknown>

    constructor(context: Record<string, unknown>) {
      super('Hard constraint overflow')
      this.context = context
    }
  },
}))

import { getDb } from '../database/db'
import { chapterRecallRuntimeSnapshots, chapters, tasks } from '../database/schema'
import {
  backfillMissingChapterRecallRuntimeSnapshots,
  listChapterRecallRuntimeMap,
  persistChapterRecallRuntimeFromTask,
} from './chapter-recall-runtime.service'
import { allocateChapterContext, collectChapterContextRawData } from './context.service'

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
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((payload: Record<string, unknown>) => ({
        run: vi.fn(() => {
          const rows = rowsByTable.get(table) || []
          const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
          rows.push({ id: nextId, ...payload })
          rowsByTable.set(table, rows)
          return { lastInsertRowid: nextId }
        }),
      })),
    })),
  }
}

function createRecallSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    retrievalUsed: true,
    degraded: false,
    hitCount: 3,
    selectedHitCount: 2,
    staleRecallCount: 0,
    fallbackHitCount: 0,
    bucketStats: {
      character: { hitCount: 2, selectedHitCount: 1, staleCount: 0, fallbackHitCount: 0 },
      rule: { hitCount: 1, selectedHitCount: 1, staleCount: 0, fallbackHitCount: 0 },
      thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
    },
    ...overrides,
  }
}

function createRecallDiagnostics(overrides: Record<string, unknown> = {}) {
  return {
    searchedBucketCount: 3,
    selectedBucketCount: 2,
    totalHitCount: 3,
    selectedHitCount: 2,
    staleRecallCount: 0,
    staleRecallRate: 0,
    recallDependencyRate: 67,
    overriddenHitCount: 0,
    fallbackHitCount: 0,
    summaryLines: ['结构化召回快照'],
    ...overrides,
  }
}

function createBaseRows(): TableRows {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [chapters, [
      {
        id: 10,
        novelId: 1,
        chapterNum: 10,
        title: '第十章',
        targetWords: 3000,
        contextVersion: 3,
      },
      {
        id: 11,
        novelId: 1,
        chapterNum: 11,
        title: '第十一章',
        targetWords: 3200,
        contextVersion: 4,
      },
      {
        id: 12,
        novelId: 1,
        chapterNum: 12,
        title: '第十二章',
        targetWords: 3400,
        contextVersion: 5,
      },
    ]],
    [tasks, []],
    [chapterRecallRuntimeSnapshots, []],
  ])
}

describe('chapter recall runtime service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers persisted chapter recall runtime snapshots over task compatibility data', () => {
    const rows = createBaseRows()
    rows.set(chapterRecallRuntimeSnapshots, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      snapshotJson: JSON.stringify(createRecallSnapshot({ hitCount: 7, retrievalUsed: false })),
      diagnosticsJson: JSON.stringify(createRecallDiagnostics({ totalHitCount: 7 })),
      source: 'backfilled',
      sourceTaskId: null,
      contextVersion: 3,
      computedAt: '2026-04-16T08:00:00.000Z',
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    }])
    rows.set(tasks, [{
      id: 101,
      novelId: 1,
      type: 'chapter_write',
      runnerType: 'workflow',
      relatedEntityType: 'chapter',
      relatedEntityId: 10,
      updatedAt: '2026-04-16T09:00:00.000Z',
      createdAt: '2026-04-16T09:00:00.000Z',
      progressJson: JSON.stringify({
        kind: 'chapter_pipeline',
        recallSnapshot: createRecallSnapshot({ hitCount: 2 }),
        recallDiagnostics: createRecallDiagnostics({ totalHitCount: 2 }),
      }),
    }])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const runtimeMap = listChapterRecallRuntimeMap(1)
    const runtime = runtimeMap.get(10)

    expect(runtime?.recallSnapshot?.hitCount).toBe(7)
    expect(runtime?.recallSnapshotSource).toBe('backfilled')
  })

  it('falls back to latest task recall runtime data when no persisted chapter snapshot exists', () => {
    const rows = createBaseRows()
    rows.set(tasks, [{
      id: 102,
      novelId: 1,
      type: 'chapter_write',
      runnerType: 'workflow',
      relatedEntityType: 'chapter',
      relatedEntityId: 10,
      updatedAt: '2026-04-16T09:00:00.000Z',
      createdAt: '2026-04-16T09:00:00.000Z',
      progressJson: JSON.stringify({
        kind: 'chapter_pipeline',
        recallSnapshot: createRecallSnapshot({ degraded: true, fallbackReason: 'query_embedding_failed' }),
        recallDiagnostics: createRecallDiagnostics({ fallbackHitCount: 3 }),
      }),
    }])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const runtimeMap = listChapterRecallRuntimeMap(1)
    const runtime = runtimeMap.get(10)

    expect(runtime?.recallSnapshot?.degraded).toBe(true)
    expect(runtime?.recallSnapshotSource).toBe('runtime')
  })

  it('persists runtime snapshots from chapter pipeline tasks into the chapter table', () => {
    const rows = createBaseRows()
    rows.set(tasks, [{
      id: 103,
      novelId: 1,
      type: 'chapter_write',
      runnerType: 'workflow',
      relatedEntityType: 'chapter',
      relatedEntityId: 10,
      updatedAt: '2026-04-16T09:00:00.000Z',
      createdAt: '2026-04-16T09:00:00.000Z',
      progressJson: JSON.stringify({
        kind: 'chapter_pipeline',
        recallSnapshot: createRecallSnapshot(),
        recallDiagnostics: createRecallDiagnostics(),
      }),
    }])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const persisted = persistChapterRecallRuntimeFromTask(103)
    const persistedRows = rows.get(chapterRecallRuntimeSnapshots) || []

    expect(persisted?.recallSnapshotSource).toBe('runtime')
    expect(persisted?.sourceTaskId).toBe(103)
    expect(persistedRows).toHaveLength(1)
    expect(persistedRows[0]?.source).toBe('runtime')
    expect(persistedRows[0]?.contextVersion).toBe(3)
  })

  it('backfills missing chapter snapshots with task imports first and current-state runtime reconstruction second', async () => {
    const rows = createBaseRows()
    rows.set(tasks, [{
      id: 104,
      novelId: 1,
      type: 'chapter_write',
      runnerType: 'workflow',
      relatedEntityType: 'chapter',
      relatedEntityId: 10,
      updatedAt: '2026-04-16T09:00:00.000Z',
      createdAt: '2026-04-16T09:00:00.000Z',
      progressJson: JSON.stringify({
        kind: 'chapter_pipeline',
        recallSnapshot: createRecallSnapshot({ hitCount: 5 }),
        recallDiagnostics: createRecallDiagnostics({ totalHitCount: 5 }),
      }),
    }])
    rows.set(chapterRecallRuntimeSnapshots, [{
      id: 1,
      novelId: 1,
      chapterId: 12,
      snapshotJson: JSON.stringify(createRecallSnapshot({ hitCount: 1 })),
      diagnosticsJson: JSON.stringify(createRecallDiagnostics({ totalHitCount: 1 })),
      source: 'runtime',
      sourceTaskId: 99,
      contextVersion: 5,
      computedAt: '2026-04-16T07:00:00.000Z',
      createdAt: '2026-04-16T07:00:00.000Z',
      updatedAt: '2026-04-16T07:00:00.000Z',
    }])

    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)
    vi.mocked(collectChapterContextRawData).mockResolvedValue({
      novel: { targetWords: 120000, contextVersion: 4 },
      currentChapter: { chapterNum: 11, outline: '推进冲突', emotionTone: '转折' },
      currentArc: null,
      chapterRows: [
        { chapterNum: 10 },
        { chapterNum: 11 },
        { chapterNum: 12 },
      ],
      outlineMentionedCharacterCount: 1,
      activeThreadPressureCount: 1,
    } as never)
    vi.mocked(allocateChapterContext).mockReturnValue({
      recallSnapshot: createRecallSnapshot({ hitCount: 6, retrievalUsed: false }),
      recallDiagnostics: createRecallDiagnostics({ totalHitCount: 6, recallDependencyRate: 0 }),
    } as never)

    const result = await backfillMissingChapterRecallRuntimeSnapshots(1)
    expect(result).toEqual({
      novelId: 1,
      totalChapterCount: 3,
      persistedTaskRuntimeCount: 1,
      backfilledCount: 1,
      skippedCount: 1,
      failedChapterIds: [],
    })
    expect(collectChapterContextRawData).toHaveBeenCalledTimes(1)
  })
})
