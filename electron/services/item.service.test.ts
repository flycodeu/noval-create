import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(() => ({
    transaction: (callback: () => void) => () => callback(),
  })),
}))

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
}))

vi.mock('./world-state.service', () => ({
  refreshWorldStateVersionsForNovel: vi.fn(),
}))

vi.mock('./asset-impact.service', () => ({
  recordAssetChangeEvent: vi.fn(),
}))

vi.mock('./link-sync.service', () => ({
  syncStoryItemTimelineLinks: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  chapterSegments,
  chapters,
  characters,
  storyArcs,
  storyItems,
  timelineEvents,
  worldMap,
} from '../database/schema'
import {
  applyStoryItemLinkRecommendations,
  getStoryItemLinkRecommendations,
} from './item.service'

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
            const target = rowsByTable.get(table)?.[0]
            if (target) Object.assign(target, patch)
          }),
        })),
      })),
    })),
  }
}

function createBaseRows() {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [storyItems, [{
      id: 7,
      novelId: 1,
      itemKind: 'instance',
      itemName: '铜钥',
      category: '钥匙',
      subType: '旧仓钥匙',
      ownerCharacterId: 2,
      locationMapId: 3,
      status: 'available',
      summary: '打开旧仓暗门的铜钥。',
      plotFunction: '开启密库并触发追查升级',
      linkedCharacterIdsJson: JSON.stringify([2]),
      linkedTimelineEventIdsJson: JSON.stringify([]),
      tagsJson: JSON.stringify(['旧仓', '暗门']),
      sortOrder: 1,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
    [characters, [{
      id: 2,
      novelId: 1,
      fullName: '林远',
      roleType: 'protagonist',
      sortOrder: 1,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
    [worldMap, [{
      id: 3,
      novelId: 1,
      level: 1,
      name: '旧仓',
      sortOrder: 1,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
    [storyArcs, []],
    [timelineEvents, [
      {
        id: 101,
        novelId: 1,
        sortOrder: 1,
        eventTitle: '林远在旧仓找到铜钥',
        eventSummary: '旧仓暗门前，林远摸出一把旧铜钥。',
        timeMode: 'custom-era',
        timeLabel: '第5章',
        timeSortValue: 5,
        presentCharacterIdsJson: JSON.stringify([2]),
        affectedCharacterIdsJson: JSON.stringify([]),
        protagonistPresent: 1,
        linkedItemIdsJson: JSON.stringify([]),
        directConsequencesJson: JSON.stringify([]),
        openThreadsJson: JSON.stringify([]),
        locationMapId: 3,
        status: 'planned',
        createdAt: '2026-04-26T00:00:00.000Z',
        updatedAt: '2026-04-26T00:00:00.000Z',
      },
      {
        id: 102,
        novelId: 1,
        sortOrder: 2,
        eventTitle: '南城口盘查',
        eventSummary: '守卫盘查来往行人。',
        timeMode: 'custom-era',
        timeLabel: '第6章',
        timeSortValue: 6,
        presentCharacterIdsJson: JSON.stringify([]),
        affectedCharacterIdsJson: JSON.stringify([]),
        protagonistPresent: 0,
        linkedItemIdsJson: JSON.stringify([]),
        directConsequencesJson: JSON.stringify([]),
        openThreadsJson: JSON.stringify([]),
        status: 'planned',
        createdAt: '2026-04-26T00:00:00.000Z',
        updatedAt: '2026-04-26T00:00:00.000Z',
      },
    ]],
    [chapters, [{
      id: 11,
      novelId: 1,
      chapterNum: 5,
      title: '旧仓暗门',
      volumeId: 1,
      partId: 1,
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
    [chapterSegments, [{
      id: 201,
      novelId: 1,
      chapterId: 11,
      volumeId: 1,
      partId: 1,
      segmentOrder: 1,
      title: '旧仓搜寻',
      purpose: '林远在旧仓摸到铜钥，准备打开暗门。',
      summary: '他在旧仓墙角摸到一把铜钥。',
      locationName: '旧仓',
      presentCharacterIdsJson: JSON.stringify([2]),
      linkedItemIdsJson: JSON.stringify([]),
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: '2026-04-26T00:00:00.000Z',
    }]],
  ])
}

describe('story item link recommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recommends related events and segments from direct name and context overlap', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = getStoryItemLinkRecommendations(7)

    expect(result.events[0]?.eventId).toBe(101)
    expect(result.events[0]?.reason).toContain('物品名命中')
    expect(result.segments[0]?.segmentId).toBe(201)
    expect(result.segments[0]?.reason).toContain('地点共现')
  })

  it('writes accepted event and segment links back to item and scene data', () => {
    const rows = createBaseRows()
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = applyStoryItemLinkRecommendations(7, {
      eventIds: [101],
      segmentIds: [201],
    })

    expect(result.linkedEventCount).toBe(1)
    expect(result.linkedSegmentCount).toBe(1)
    expect((rows.get(storyItems) || [])[0].linkedTimelineEventIdsJson).toBe(JSON.stringify([101]))
    expect((rows.get(chapterSegments) || [])[0].linkedItemIdsJson).toBe(JSON.stringify([7]))
  })
})
