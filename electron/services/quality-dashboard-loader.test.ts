import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  chapterGateRuns,
  chapters,
  genres,
  glossary,
  novels,
  storyFacts,
  storyItems,
  storyThreads,
  storyVolumes,
  timelineEvents,
} from '../database/schema'
import {
  loadQualityDashboardCatalogSnapshot,
  loadQualityDashboardDerivedDatabaseSnapshot,
} from './quality-dashboard-loader'

function createTableAwareDbMock(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: vi.fn(() => ({
      from(table: unknown) {
        const rows = rowsByTable.get(table) || []
        const query = {
          leftJoin: () => query,
          where: () => query,
          orderBy: () => query,
          all: () => rows,
        }
        return query
      },
    })),
  }
}

describe('quality dashboard loader', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('loads gate, glossary, story, timeline and typed-ref inputs in one database snapshot', () => {
    const gateRun = { id: 11, novelId: 7, chapterId: 101, chapterNum: 1 }
    const timelineRow = {
      eventType: 'plot',
      eventTitle: '抵达港口',
      eventSummary: '主角进入新区域',
      eventResult: '取得线索',
      chapterStartId: 101,
      chapterEndId: 101,
      protagonistPresent: 1,
      protagonistAction: '调查',
      typedRefsJson: '[{"type":"character","id":1}]',
    }
    const storyFactRow = { id: 21, title: '港口密令', volumeId: 3 }
    const db = createTableAwareDbMock(new Map<unknown, unknown[]>([
      [glossary, [{ term: '潮汐钟' }, { term: '' }]],
      [chapterGateRuns, [gateRun]],
      [timelineEvents, [timelineRow]],
      [storyFacts, [storyFactRow]],
      [storyThreads, [{ typedRefsJson: '[{"type":"chapter","id":101}]' }]],
      [storyItems, [{ typedRefsJson: null }]],
    ]))
    vi.mocked(getDb).mockReturnValue(db as never)

    const snapshot = loadQualityDashboardDerivedDatabaseSnapshot(7)

    expect(getDb).toHaveBeenCalledOnce()
    expect(snapshot.glossaryTerms).toEqual(['潮汐钟'])
    expect(snapshot.gateRuns).toEqual([gateRun])
    expect(snapshot.timelineRows).toEqual([timelineRow])
    expect(snapshot.storyFactRows).toEqual([storyFactRow])
    expect(snapshot.typedRefRows.thread).toHaveLength(1)
    expect(snapshot.typedRefRows.timeline).toHaveLength(1)
    expect(snapshot.typedRefRows.item).toEqual([{ typedRefsJson: null }])
  })

  it('loads novel, volume and chapter catalog rows without exposing the database to derive stages', () => {
    const novelMeta = { launchMode: 'standard', targetWords: 120000, genreName: '悬疑' }
    const volumeRow = { id: 3, volumeNumber: 1, title: '潮汐卷' }
    const chapterRows = [
      { id: 101, chapterNum: 1, title: '雾港' },
      { id: 102, chapterNum: 2, title: '回声' },
    ]
    const db = createTableAwareDbMock(new Map<unknown, unknown[]>([
      [novels, [novelMeta]],
      [genres, []],
      [storyVolumes, [volumeRow]],
      [chapters, chapterRows],
    ]))
    vi.mocked(getDb).mockReturnValue(db as never)

    const snapshot = loadQualityDashboardCatalogSnapshot(7)

    expect(getDb).toHaveBeenCalledOnce()
    expect(snapshot.novelMeta).toEqual(novelMeta)
    expect(snapshot.volumeRows).toEqual([volumeRow])
    expect(snapshot.rows).toEqual(chapterRows)
  })
})
