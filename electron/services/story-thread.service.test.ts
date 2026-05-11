import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTypedRefOverlay } from '../../src/shared/typed-ref'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./asset-impact.service', () => ({
  recordAssetChangeEvent: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
}))

vi.mock('./context.service', () => ({
  buildStoryProfile: vi.fn(),
}))

vi.mock('./history.service', () => ({
  buildBatchKey: vi.fn(),
  createOperationLog: vi.fn(),
}))

vi.mock('./generation-history.service', () => ({
  getAttemptCount: vi.fn(() => 0),
  getRecentRejectedDigests: vi.fn(() => []),
  markRejected: vi.fn(),
  recordGeneration: vi.fn(),
}))

vi.mock('./task.service', () => ({
  createTask: vi.fn(),
  executeChatTask: vi.fn(),
  runChatTask: vi.fn(),
  updateTask: vi.fn(),
}))

vi.mock('./asset-quality.service', () => ({
  runAssetQualityLoop: vi.fn(),
  summarizeAssetQualityWarnings: vi.fn(() => []),
}))

vi.mock('./variation-control.service', () => ({
  appendVariationMessage: vi.fn(),
  buildVariationDigest: vi.fn(),
  isRejectedDigestTooSimilar: vi.fn(() => false),
}))

vi.mock('./endgame-asset.service', () => ({
  listForeshadowLedger: vi.fn(() => []),
}))

import { getDb } from '../database/db'
import { chapters, storyThreads } from '../database/schema'
import { createStoryThread, updateStoryThread } from './story-thread.service'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())
}

function matchesWhereClause(row: Record<string, unknown>, condition: any): boolean {
  const chunks = Array.isArray(condition?.queryChunks) ? condition.queryChunks : []
  const columnName = typeof chunks[1]?.name === 'string' ? chunks[1].name : ''
  const value = chunks[3]?.value
  if (!columnName) return true

  const rowKey = columnName in row ? columnName : toCamelCase(columnName)
  return row[rowKey] === value
}

function createQuery(rowsByTable: TableRows, table: unknown, conditions: any[] = []) {
  const query: {
    where: (condition: any) => typeof query
    orderBy: () => typeof query
    all: () => Array<Record<string, unknown>>
  } = {
    where: (condition: any) => createQuery(rowsByTable, table, [...conditions, condition]),
    orderBy: () => query,
    all: () => (rowsByTable.get(table) || []).filter((row) => conditions.every((condition) => matchesWhereClause(row, condition))),
  }
  return query
}

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
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
    update: vi.fn((table: unknown) => ({
      set: vi.fn((patch: Record<string, unknown>) => ({
        where: vi.fn((condition: any) => ({
          run: vi.fn(() => {
            const rows = rowsByTable.get(table) || []
            rows
              .filter((row) => matchesWhereClause(row, condition))
              .forEach((row) => Object.assign(row, patch))
          }),
        })),
      })),
    })),
  }
}

function createBaseRows() {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [storyThreads, [{
      id: 6,
      novelId: 1,
      threadType: 'subplot',
      title: '旁支烟幕',
      status: 'planned',
      priority: 'low',
      relatedCharacterIdsJson: JSON.stringify([9]),
      relatedItemIdsJson: JSON.stringify([]),
      relatedTimelineEventIdsJson: JSON.stringify([]),
      typedRefsJson: JSON.stringify({
        version: 1,
        pointers: [
          { assetType: 'character', id: 9, confidence: 1 },
        ],
      }),
      sortOrder: 0,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }, {
      id: 7,
      novelId: 1,
      threadType: 'subplot',
      title: '旧仓支线',
      status: 'planned',
      priority: 'medium',
      relatedCharacterIdsJson: JSON.stringify([2]),
      relatedItemIdsJson: JSON.stringify([]),
      relatedTimelineEventIdsJson: JSON.stringify([]),
      typedRefsJson: JSON.stringify({
        version: 1,
        pointers: [
          { assetType: 'character', id: 2, confidence: 1 },
        ],
      }),
      sortOrder: 1,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }]],
    [chapters, [{
      id: 11,
      novelId: 1,
      chapterNum: 6,
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }]],
  ])
}

describe('story thread typed ref overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes non-empty typed ref overlay when creating a thread with linked assets', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const createdId = createStoryThread(1, {
      title: '旧仓追查',
      relatedCharacterIdsJson: JSON.stringify([2]),
      relatedItemIdsJson: JSON.stringify([5]),
      relatedTimelineEventIdsJson: JSON.stringify([101]),
    }, { skipContextTracking: true })

    const created = (rows.get(storyThreads) || []).find((row) => Number(row.id) === createdId)
    const overlay = parseTypedRefOverlay(String(created?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
      { assetType: 'timeline_event', id: 101, confidence: 1 },
    ])
  })

  it('rebuilds typed ref overlay when updating thread links', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateStoryThread(7, {
      relatedItemIdsJson: JSON.stringify([5]),
      relatedTimelineEventIdsJson: JSON.stringify([101]),
    }, { skipContextTracking: true })

    const updated = (rows.get(storyThreads) || []).find((row) => Number(row.id) === 7)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
      { assetType: 'timeline_event', id: 101, confidence: 1 },
    ])
  })

  it('clears stale typed ref pointers when linked ids are explicitly reset', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateStoryThread(7, {
      relatedCharacterIdsJson: JSON.stringify([]),
      relatedItemIdsJson: JSON.stringify([]),
      relatedTimelineEventIdsJson: JSON.stringify([]),
    }, { skipContextTracking: true })

    const updated = (rows.get(storyThreads) || []).find((row) => Number(row.id) === 7)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(updated?.typedRefsJson ?? null).toBeNull()
    expect(overlay).toBeNull()
  })

  it('keeps the current overlay when updating unrelated fields', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateStoryThread(7, {
      notes: '补充回收说明',
    }, { skipContextTracking: true })

    const updated = (rows.get(storyThreads) || []).find((row) => Number(row.id) === 7)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
    ])
  })

  it('updates only the targeted thread row when multiple rows exist', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateStoryThread(7, {
      relatedItemIdsJson: JSON.stringify([5]),
      notes: '目标行追加物品引用',
    }, { skipContextTracking: true })

    const untouched = (rows.get(storyThreads) || []).find((row) => Number(row.id) === 6)
    const updated = (rows.get(storyThreads) || []).find((row) => Number(row.id) === 7)

    expect(parseTypedRefOverlay(String(untouched?.typedRefsJson || ''))?.pointers).toEqual([
      { assetType: 'character', id: 9, confidence: 1 },
    ])
    expect(untouched?.notes).toBeUndefined()
    expect(parseTypedRefOverlay(String(updated?.typedRefsJson || ''))?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
    ])
    expect(updated?.notes).toBe('目标行追加物品引用')
  })
})
