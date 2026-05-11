import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTypedRefOverlay } from '../../src/shared/typed-ref'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(() => ({
    transaction: (callback: () => void) => () => callback(),
  })),
}))

vi.mock('./context.service', () => ({
  buildStoryProfile: vi.fn(),
}))

vi.mock('./story-prompts', () => ({
  buildTimelineEventsPrompt: vi.fn(),
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

vi.mock('./link-sync.service', () => ({
  removeTimelineEventFromItems: vi.fn(),
  syncTimelineEventItemLinks: vi.fn(),
}))

vi.mock('./asset-impact.service', () => ({
  recordAssetChangeEvent: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
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

vi.mock('./history.service', () => ({
  buildBatchKey: vi.fn(),
  createOperationLog: vi.fn(),
}))

import { getDb } from '../database/db'
import { chapters, storyItems, timelineEvents } from '../database/schema'
import { createTimelineEvent, updateTimelineEvent } from './timeline.service'

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
    [timelineEvents, [{
      id: 8,
      novelId: 1,
      sortOrder: 0,
      eventTitle: '前哨误报',
      timeLabel: '第5章',
      timeMode: 'custom-era',
      timeSortValue: 5,
      presentCharacterIdsJson: JSON.stringify([9]),
      affectedCharacterIdsJson: JSON.stringify([]),
      linkedItemIdsJson: JSON.stringify([]),
      typedRefsJson: JSON.stringify({
        version: 1,
        pointers: [
          { assetType: 'character', id: 9, confidence: 1 },
        ],
      }),
      openThreadsJson: JSON.stringify([]),
      directConsequencesJson: JSON.stringify([]),
      protagonistPresent: 0,
      isMajorEvent: 0,
      status: 'planned',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }, {
      id: 9,
      novelId: 1,
      sortOrder: 1,
      eventTitle: '旧仓交锋',
      timeLabel: '第6章',
      timeMode: 'custom-era',
      timeSortValue: 6,
      presentCharacterIdsJson: JSON.stringify([2]),
      affectedCharacterIdsJson: JSON.stringify([]),
      linkedItemIdsJson: JSON.stringify([]),
      typedRefsJson: JSON.stringify({
        version: 1,
        pointers: [
          { assetType: 'character', id: 2, confidence: 1 },
        ],
      }),
      openThreadsJson: JSON.stringify([]),
      directConsequencesJson: JSON.stringify([]),
      protagonistPresent: 1,
      isMajorEvent: 1,
      status: 'planned',
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
    [storyItems, [{
      id: 5,
      novelId: 1,
      itemName: '铜钥',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    }]],
  ])
}

describe('timeline typed ref overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('writes non-empty typed ref overlay when creating an event with linked characters, items and threads', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const createdId = createTimelineEvent(1, {
      eventTitle: '旧仓追查升级',
      timeLabel: '第7章',
      presentCharacterIdsJson: JSON.stringify([2]),
      affectedCharacterIdsJson: JSON.stringify([3]),
      linkedItemIdsJson: JSON.stringify([5]),
      openThreadsJson: JSON.stringify(['旧仓支线']),
    }, { skipContextTracking: true })

    const created = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === createdId)
    const overlay = parseTypedRefOverlay(String(created?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'character', id: 3, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
      {
        assetType: 'story_thread',
        name: '旧仓支线',
        alias: ['旧仓支线'],
        confidence: 0.45,
        unresolved: true,
      },
    ])
  })

  it('rebuilds typed ref overlay when updating event links', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateTimelineEvent(9, {
      affectedCharacterIdsJson: JSON.stringify([3]),
      linkedItemIdsJson: JSON.stringify([5]),
      openThreadsJson: JSON.stringify(['旧仓支线']),
    }, { skipContextTracking: true })

    const updated = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === 9)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'character', id: 3, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
      {
        assetType: 'story_thread',
        name: '旧仓支线',
        alias: ['旧仓支线'],
        confidence: 0.45,
        unresolved: true,
      },
    ])
  })

  it('clears stale typed ref pointers when linked assets are explicitly reset', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateTimelineEvent(9, {
      presentCharacterIdsJson: JSON.stringify([]),
      affectedCharacterIdsJson: JSON.stringify([]),
      linkedItemIdsJson: JSON.stringify([]),
      openThreadsJson: JSON.stringify([]),
    }, { skipContextTracking: true })

    const updated = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === 9)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(updated?.typedRefsJson ?? null).toBeNull()
    expect(overlay).toBeNull()
  })

  it('keeps the current overlay when updating unrelated fields', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateTimelineEvent(9, {
      notes: '补充后果链说明',
    }, { skipContextTracking: true })

    const updated = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === 9)
    const overlay = parseTypedRefOverlay(String(updated?.typedRefsJson || ''))

    expect(overlay?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
    ])
  })

  it('updates only the targeted event row when multiple rows exist', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    updateTimelineEvent(9, {
      linkedItemIdsJson: JSON.stringify([5]),
      openThreadsJson: JSON.stringify(['旧仓支线']),
      notes: '目标事件追加线索',
    }, { skipContextTracking: true })

    const untouched = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === 8)
    const updated = (rows.get(timelineEvents) || []).find((row) => Number(row.id) === 9)

    expect(parseTypedRefOverlay(String(untouched?.typedRefsJson || ''))?.pointers).toEqual([
      { assetType: 'character', id: 9, confidence: 1 },
    ])
    expect(untouched?.notes).toBeUndefined()
    expect(parseTypedRefOverlay(String(updated?.typedRefsJson || ''))?.pointers).toEqual([
      { assetType: 'character', id: 2, confidence: 1 },
      { assetType: 'item', id: 5, confidence: 1 },
      {
        assetType: 'story_thread',
        name: '旧仓支线',
        alias: ['旧仓支线'],
        confidence: 0.45,
        unresolved: true,
      },
    ])
    expect(updated?.notes).toBe('目标事件追加线索')
  })
})
