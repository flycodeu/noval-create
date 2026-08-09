import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

import { getDb, getSqlite } from '../database/db'
import {
  chapters,
  worldStateVersions,
} from '../database/schema'
import {
  getWorldStateContextSnapshot,
  getWorldStateLedgerSnapshot,
} from './world-state.service'

describe('world-state query scope', () => {
  const queryLogs: Array<{
    table: unknown
    selection: unknown
  }> = []
  const projectionQueries: string[] = []
  let projectedRows: Array<Record<string, unknown>> = []

  beforeEach(() => {
    queryLogs.length = 0
    projectionQueries.length = 0
    projectedRows = []
    vi.mocked(getDb).mockReset()
    vi.mocked(getSqlite).mockReset()
    vi.mocked(getSqlite).mockReturnValue({
      prepare: (query: string) => {
        projectionQueries.push(query)
        return {
          all: () => projectedRows,
        }
      },
    } as never)
    vi.mocked(getDb).mockReturnValue({
      select: (selection?: unknown) => ({
        from: (table: unknown) => {
          queryLogs.push({ table, selection })
          const query = {
            where: () => query,
            orderBy: () => query,
            all: () => (
              table === worldStateVersions && selection !== undefined
                ? [{ count: 0 }]
                : []
            ),
          }
          return query
        },
      }),
    } as never)
  })

  it('does not load the full chapter table for prompt-context snapshots', () => {
    const snapshot = getWorldStateContextSnapshot(1, {
      upToChapterNum: 2400,
      limit: 12,
    })

    expect(snapshot.currentStates).toEqual([])
    expect(snapshot.trendSummary).toEqual([])
    expect(queryLogs.some((entry) => entry.table === chapters)).toBe(false)
    expect(queryLogs.filter((entry) => entry.table === worldStateVersions)).toHaveLength(0)
    expect(projectionQueries).toHaveLength(1)
    expect(projectionQueries[0]).toContain('DENSE_RANK() OVER')
  })

  it('builds latest state and drift diagnostics from the bounded two-chapter projection', () => {
    projectedRows = [
      {
        id: 13,
        novelId: 1,
        entityType: 'location',
        entityId: 9,
        entityName: '旧仓库',
        chapterId: 103,
        chapterNum: 103,
        stateKey: 'location_control',
        stateValue: '敌方控制',
        normalizedValue: '敌方控制',
        summaryText: '旧仓库：地点=敌方控制',
        eventCause: '',
        changeReason: '',
        sourceKind: 'location_record',
        sourceRef: '9',
        severity: 'warning',
        triggerEventId: null,
        sourceSegmentId: null,
        stateDeltaJson: null,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        totalWarningCount: 7,
      },
      {
        id: 12,
        novelId: 1,
        entityType: 'location',
        entityId: 9,
        entityName: '旧仓库',
        chapterId: 102,
        chapterNum: 102,
        stateKey: 'location_control',
        stateValue: '我方控制',
        normalizedValue: '我方控制',
        summaryText: '旧仓库：地点=我方控制',
        eventCause: '守军撤离',
        changeReason: '防线收缩',
        sourceKind: 'location_record',
        sourceRef: '9',
        severity: 'info',
        triggerEventId: null,
        sourceSegmentId: null,
        stateDeltaJson: null,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        totalWarningCount: 7,
      },
    ]

    const snapshot = getWorldStateContextSnapshot(1, {
      upToChapterNum: 103,
      limit: 12,
    })

    expect(snapshot.currentStates).toMatchObject([{
      entityType: 'location',
      entityId: 9,
      chapterNum: 103,
      stateItems: ['地点=敌方控制'],
    }])
    expect(snapshot.alerts).toMatchObject([{
      alertType: 'drift',
      entityType: 'location',
      entityId: 9,
      chapterNum: 103,
    }])
  })

  it('keeps full trend collection enabled for ledger consumers', () => {
    const snapshot = getWorldStateLedgerSnapshot(1, {
      upToChapterNum: 2400,
    })

    expect(snapshot.trend).toEqual([])
    expect(queryLogs.some((entry) => entry.table === chapters)).toBe(true)
    expect(queryLogs.filter((entry) => entry.table === worldStateVersions)).toHaveLength(1)
    expect(projectionQueries).toHaveLength(0)
  })
})
