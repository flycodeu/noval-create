import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

vi.mock('./character-state.service', () => ({
  listLatestCharacterStates: vi.fn(() => []),
  listNovelCharacterStateAlerts: vi.fn(() => []),
}))

vi.mock('./world-state.service', () => ({
  getWorldStateLedgerSnapshot: vi.fn(() => ({
    entities: [],
    alerts: [],
    conflictEntities: [],
    trend: [],
    trendSummary: [],
    overview: {
      trackedEntityCount: 0,
      trackedByType: {
        character: 0,
        faction: 0,
        item: 0,
        relation: 0,
        location: 0,
      },
      driftAlertCount: 0,
      conflictAlertCount: 0,
      warningCount: 0,
      criticalCount: 0,
      conflictEntityCount: 0,
      recentConflictEntities: [],
    },
    worldStatesText: '',
  })),
}))

vi.mock('./story-structure.service', () => ({
  ensureStoryStructure: vi.fn(),
}))

import { getDb, getSqlite } from '../database/db'
import {
  characterRelations,
  characters,
  chapters,
  novels,
  storyArcs,
  storyItems,
  storyMemoryCheckpoints,
  storyParts,
  storyThreads,
  storyVolumes,
  timelineEvents,
  worldMap,
} from '../database/schema'
import { ensureStoryStructure } from './story-structure.service'
import { getWorldStateLedgerSnapshot } from './world-state.service'
import {
  buildStoryMemoryPromptPackage,
  buildStoryMemorySnapshot,
  getStoryMemoryCheckpointRefreshStatus,
  refreshStoryMemoryCheckpoints,
  refreshStoryMemoryCheckpointsIfNeeded,
} from './story-memory.service'

describe('buildStoryMemorySnapshot query scope', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
    vi.mocked(getSqlite).mockReset()
    vi.mocked(getSqlite).mockReturnValue({
      inTransaction: false,
      transaction: (callback: () => unknown) => {
        const run = () => callback()
        return Object.assign(run, { immediate: run })
      },
    } as never)
    vi.mocked(getWorldStateLedgerSnapshot).mockClear()
    vi.mocked(ensureStoryStructure).mockClear()
  })

  it('uses a bounded recent chapter window for mega projects', () => {
    const queryLogs: Array<{
      table: unknown
      limits: number[]
    }> = []
    let chapterReadIndex = 0
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: (table: unknown) => {
          const log = { table, limits: [] as number[] }
          queryLogs.push(log)
          const query = {
            where: () => query,
            orderBy: () => query,
            limit: (value: number) => {
              log.limits.push(value)
              return query
            },
            all: () => {
              if (table === novels) {
                return [{
                  id: 1,
                  title: '百万字记忆窗口',
                  targetWords: 1000000,
                }]
              }
              if (table === chapters) {
                chapterReadIndex += 1
                if (chapterReadIndex === 1) return [{ count: 2500 }]
                if (chapterReadIndex === 2) return [{ chapterNum: 2500 }]
                return [{
                  id: 2499,
                  chapterNum: 2499,
                  summary: '旧线索重新浮现。',
                  continuityStateJson: '{}',
                }, {
                  id: 2500,
                  chapterNum: 2500,
                  summary: '主角抵达终局入口。',
                  continuityStateJson: '{}',
                }]
              }
              if (
                table === timelineEvents
                || table === storyMemoryCheckpoints
                || table === storyItems
              ) {
                return []
              }
              return []
            },
          }
          return query
        },
      }),
    } as never)

    const snapshot = buildStoryMemorySnapshot(1, { ensureCheckpoints: false })
    const chapterQueries = queryLogs.filter((entry) => entry.table === chapters)

    expect(snapshot.chapterCount).toBe(2500)
    expect(snapshot.lastChapterNum).toBe(2500)
    expect(snapshot.memoryMode).toBe('mega')
    expect(chapterQueries).toHaveLength(3)
    expect(chapterQueries[1].limits).toEqual([1])
    expect(chapterQueries[2].limits).toEqual([302])
    expect(getWorldStateLedgerSnapshot).toHaveBeenCalledWith(1, expect.objectContaining({
      includeTrend: false,
    }))
  })

  it('keeps schedule-only checkpoint refresh off the synchronous prompt path', () => {
    vi.useFakeTimers()
    const tableReads: unknown[] = []
    let chapterReadIndex = 0
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: (table: unknown) => {
          tableReads.push(table)
          const query = {
            where: () => query,
            orderBy: () => query,
            limit: () => query,
            all: () => {
              if (table === novels) {
                return [{
                  id: 2,
                  title: '后台检查点调度',
                  targetWords: 1000000,
                  contextVersion: 3,
                }]
              }
              if (table === storyMemoryCheckpoints) return []
              if (table === chapters) {
                chapterReadIndex += 1
                if (chapterReadIndex === 1) return [{ count: 2500 }]
                if (chapterReadIndex === 2) return [{ chapterNum: 2500 }]
                return []
              }
              if (table === timelineEvents || table === storyItems) return []
              return []
            },
          }
          return query
        },
      }),
    } as never)

    try {
      const promptPackage = buildStoryMemoryPromptPackage(2, {
        refreshMode: 'schedule_only',
      })

      expect(promptPackage.observability.fallbackScopeCount).toBeGreaterThan(0)
      expect(getStoryMemoryCheckpointRefreshStatus(2).status).toBe('queued')
      expect(tableReads).not.toContain(storyVolumes)
      expect(tableReads).not.toContain(storyParts)
    } finally {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  it('reuses event and checkpoint catalogs while preserving locked scopes', () => {
    const tableReads: unknown[] = []
    const updatePayloads: Array<Record<string, unknown>> = []
    let insideTransaction = false
    const immediate = vi.fn()
    vi.mocked(getSqlite).mockReturnValue({
      inTransaction: false,
      transaction: (callback: () => unknown) => {
        const run = () => {
          insideTransaction = true
          try {
            return callback()
          } finally {
            insideTransaction = false
          }
        }
        immediate.mockImplementation(run)
        return Object.assign(run, { immediate })
      },
    } as never)
    const chapterRows = [{
      id: 1,
      novelId: 3,
      chapterNum: 1,
      volumeId: 11,
      partId: 101,
      wordCount: 1800,
      status: 'completed',
      summary: '第一卷完成。',
      continuityStateJson: '{}',
    }, {
      id: 2,
      novelId: 3,
      chapterNum: 2,
      volumeId: 11,
      partId: 101,
      wordCount: 1900,
      status: 'completed',
      summary: '第一卷收束。',
      continuityStateJson: '{}',
    }, {
      id: 3,
      novelId: 3,
      chapterNum: 3,
      volumeId: 12,
      partId: 102,
      wordCount: 0,
      status: 'outline',
      summary: '',
      continuityStateJson: '{}',
    }]
    const checkpointRows = [{
      id: 20,
      novelId: 3,
      scopeType: 'novel',
      scopeId: null,
      locked: 0,
    }, {
      id: 21,
      novelId: 3,
      scopeType: 'volume',
      scopeId: 11,
      locked: 1,
    }, {
      id: 22,
      novelId: 3,
      scopeType: 'volume',
      scopeId: 12,
      locked: 0,
    }, {
      id: 23,
      novelId: 3,
      scopeType: 'part',
      scopeId: 101,
      locked: 0,
    }, {
      id: 24,
      novelId: 3,
      scopeType: 'part',
      scopeId: 102,
      locked: 0,
    }]
    const rowsByTable = new Map<unknown, unknown[]>([
      [novels, [{
        id: 3,
        title: '检查点目录复用',
        targetWords: 1600000,
        contextVersion: 4,
      }]],
      [chapters, chapterRows],
      [storyVolumes, [{
        id: 11,
        novelId: 3,
        volumeNumber: 1,
        title: '锁定卷',
      }, {
        id: 12,
        novelId: 3,
        volumeNumber: 2,
        title: '进行卷',
      }]],
      [storyParts, [{
        id: 101,
        novelId: 3,
        volumeId: 11,
        partNumber: 1,
        title: '第一部',
      }, {
        id: 102,
        novelId: 3,
        volumeId: 12,
        partNumber: 2,
        title: '第二部',
      }]],
      [characters, []],
      [characterRelations, []],
      [storyItems, []],
      [storyThreads, []],
      [storyArcs, []],
      [worldMap, []],
      [timelineEvents, []],
      [storyMemoryCheckpoints, checkpointRows],
    ])
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: (table: unknown) => {
          tableReads.push(table)
          const query = {
            where: () => query,
            orderBy: () => query,
            all: () => rowsByTable.get(table) || [],
          }
          return query
        },
      }),
      update: () => ({
        set: (payload: Record<string, unknown>) => {
          expect(insideTransaction).toBe(true)
          updatePayloads.push(payload)
          return {
            where: () => ({
              run: () => undefined,
            }),
          }
        },
      }),
      insert: () => {
        throw new Error('all checkpoint scopes should already exist')
      },
    } as never)

    const result = refreshStoryMemoryCheckpoints(3)

    expect(result).toHaveLength(5)
    expect(ensureStoryStructure).toHaveBeenCalledWith(3)
    expect(immediate).toHaveBeenCalledOnce()
    expect(tableReads.filter((table) => table === timelineEvents)).toHaveLength(1)
    expect(tableReads.filter((table) => table === storyMemoryCheckpoints)).toHaveLength(2)
    expect(updatePayloads.filter((payload) => payload.stale === 1)).toHaveLength(1)
    expect(updatePayloads.some((payload) => payload.label === '锁定卷')).toBe(false)
    expect(updatePayloads.some((payload) => payload.label === '进行卷')).toBe(true)
  })

  it('does not rebuild checkpoints before the configured chapter gap is reached', () => {
    const tableReads: unknown[] = []
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: (table: unknown) => {
          tableReads.push(table)
          const query = {
            where: () => query,
            orderBy: () => query,
            limit: () => query,
            all: () => {
              if (table === novels) {
                return [{
                  id: 4,
                  contextVersion: 7,
                }]
              }
              if (table === storyMemoryCheckpoints) {
                return [
                  {
                    id: 40,
                    novelId: 4,
                    scopeType: 'novel',
                    scopeId: null,
                    version: 7,
                    stale: 0,
                    locked: 0,
                    lastRefreshedChapterNum: 100,
                    characterCardsJson: '[]',
                    relationCardsJson: '[]',
                    itemCardsJson: '[]',
                    timelineCardsJson: '[]',
                    threadCardsJson: '[]',
                    updatedAt: new Date().toISOString(),
                  },
                  {
                    id: 41,
                    novelId: 4,
                    scopeType: 'volume',
                    scopeId: 8,
                    version: 1,
                    stale: 1,
                    locked: 1,
                  },
                ]
              }
              if (table === chapters) return [{ chapterNum: 101 }]
              return []
            },
          }
          return query
        },
      }),
    } as never)

    const scheduled = refreshStoryMemoryCheckpointsIfNeeded(4, {
      refreshMode: 'schedule_only',
      reason: 'chapter 101 derived state refreshed',
      trigger: 'chapter_memory_refresh',
    })

    expect(scheduled).toBe(false)
    expect(getStoryMemoryCheckpointRefreshStatus(4).status).toBe('idle')
    expect(tableReads).not.toContain(storyVolumes)
    expect(tableReads).not.toContain(storyParts)
  })
})
