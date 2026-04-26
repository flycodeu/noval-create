import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(() => ({
    transaction: (callback: () => void) => () => callback(),
  })),
}))

vi.mock('./timeline.service', () => ({
  syncTimelineStructureAnchors: vi.fn(),
}))

vi.mock('./story-structure-batch.service', () => ({
  applyStructureBatchEdit: vi.fn(),
  applyStructureBatchPlan: vi.fn(),
  assignChapterToPartTransactional: vi.fn(),
  deleteChapterSegmentTransactional: vi.fn(),
  deleteStoryPartTransactional: vi.fn(),
  deleteStoryVolumeTransactional: vi.fn(),
  previewStructureBatchEdit: vi.fn(),
  reorderChapterSegmentsTransactional: vi.fn(),
  reorderStoryPartsInVolumeTransactional: vi.fn(),
  reorderStoryPartsTransactional: vi.fn(),
  reorderStoryVolumesTransactional: vi.fn(),
}))

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
  markStoryMemoryCheckpointsDirty: vi.fn(),
}))

vi.mock('./link-sync.service', () => ({
  syncTimelineEventItemLinks: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

import { getDb } from '../database/db'
import {
  chapterContracts,
  chapterSegments,
  chapters,
  novels,
  sceneContracts,
  storyMemoryCheckpoints,
  storyParts,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import { getStructureLinkageSummary } from './story-structure.service'

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
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(() => ({
          lastInsertRowid: 999,
        })),
      })),
    })),
  }
}

function createBaseRows() {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [novels, [{
      id: 1,
      contextVersion: 1,
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
    [storyVolumes, [{
      id: 1,
      novelId: 1,
      volumeNumber: 1,
      title: '第一卷',
    }]],
    [storyParts, [{
      id: 1,
      novelId: 1,
      volumeId: 1,
      partNumber: 1,
      title: '第一部',
    }]],
    [chapters, [
      {
        id: 10,
        novelId: 1,
        volumeId: 1,
        partId: 1,
        chapterNum: 1,
        title: '开场',
        segmentCount: 1,
      },
      {
        id: 11,
        novelId: 1,
        volumeId: 1,
        partId: 1,
        chapterNum: 2,
        title: '断点',
        segmentCount: 1,
      },
    ]],
    [chapterSegments, [
      {
        id: 100,
        novelId: 1,
        chapterId: 10,
        volumeId: 1,
        partId: 1,
        segmentOrder: 1,
        title: '场景一',
      },
      {
        id: 101,
        novelId: 1,
        chapterId: 11,
        volumeId: 1,
        partId: 1,
        segmentOrder: 1,
        title: '场景二',
      },
    ]],
    [timelineEvents, [{
      id: 500,
      novelId: 1,
      eventTitle: '开场事件',
      chapterStartId: 10,
      chapterEndId: 10,
      segmentId: 100,
      anchorInvalid: 0,
      timeSortValue: 1,
      sortOrder: 1,
    }]],
    [chapterContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
    }]],
    [sceneContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      segmentId: 100,
    }]],
    [storyMemoryCheckpoints, []],
  ])
}

describe('structure linkage summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports missing contracts and missing timeline anchors from current structure rows', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const summary = getStructureLinkageSummary(1)

    expect(summary.missingChapterContractCount).toBe(1)
    expect(summary.missingSceneContractCount).toBe(1)
    expect(summary.uncoveredChapterCount).toBe(1)
    expect(summary.uncoveredSegmentCount).toBe(1)
    expect(summary.totalGapCount).toBe(4)
    expect(summary.missingChapterContractLabels[0]).toContain('第2章')
  })
})
