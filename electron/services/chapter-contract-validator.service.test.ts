import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
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
  foreshadowLedger,
  sceneContracts,
  storyThreads,
} from '../database/schema'
import { validateChapterContractDelivery } from './chapter-contract-validator.service'

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
  }
}

function createBaseRows(content: string) {
  return new Map<unknown, Array<Record<string, unknown>>>([
    [chapters, [{
      id: 10,
      novelId: 1,
      chapterNum: 12,
      title: '第十二章',
      content,
      scenePlanJson: JSON.stringify([{ exit_hook: '门外传来急促脚步声' }]),
    }]],
    [chapterContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      chapterGoal: '让主线再向前推进一步',
      servedThreadIdsJson: JSON.stringify([100]),
      requiredForeshadowIdsJson: JSON.stringify([200]),
      hookType: 'suspense',
    }]],
    [chapterSegments, [{
      id: 1001,
      novelId: 1,
      chapterId: 10,
      segmentOrder: 1,
      title: '场景一',
      purpose: '推进主线',
      outputState: '线索升级',
    }]],
    [sceneContracts, [{
      id: 1,
      novelId: 1,
      chapterId: 10,
      segmentId: 1001,
      sceneGoal: '推进主线',
      obstacle: '守卫追查',
      resultState: '线索升级',
    }]],
    [storyThreads, [{
      id: 100,
      novelId: 1,
      title: '失窃药箱',
      currentState: '正在追查去向',
      payoffCondition: '确认药箱被转移',
      summary: '药箱失踪真相',
    }]],
    [foreshadowLedger, [{
      id: 200,
      novelId: 1,
      title: '旧仓暗门',
      detail: '旧仓藏着另一条出路',
      plantMethod: '门缝漏风',
      payoffMethod: '追查时发现',
    }]],
  ])
}

describe('validateChapterContractDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes when chapter content provides direct evidence for goal, scene, thread, foreshadow, and hook', () => {
    const rows = createBaseRows(
      '夜晚的北门外，林远继续追查失窃药箱。守卫追查他的来路，两人险些动手。林远趁乱发现旧仓暗门，还确认药箱被转去旧仓，主线因此向前推进一步，线索也随之升级。\n\n他正要离开，门外忽然传来急促脚步声。',
    )
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: [] },
    })

    expect(result.status).toBe('pass')
    expect(result.itemResults.every((item) => item.verdict === 'pass')).toBe(true)
    expect(result.rewriteHints).toHaveLength(0)
  })

  it('downgrades to warning when thread and foreshadow are only mentioned without actual progress', () => {
    const rows = createBaseRows(
      '夜晚的北门外，守卫追查林远的来路，两人险些动手。林远被迫改走小巷，但至少让主线向前推进一步，也让线索升级到旧仓附近。\n\n他想起失窃药箱和旧仓暗门，暂时没有继续处理。门外忽然一阵风响，他只把这件事压回心里。',
    )
    Object.assign((rows.get(chapters) || [])[0], {
      scenePlanJson: JSON.stringify([]),
    })
    vi.mocked(getDb).mockReturnValue(createDbMock(rows) as never)

    const result = validateChapterContractDelivery({
      chapterId: 10,
      content: String((rows.get(chapters) || [])[0].content),
      reviewNotes: { reader_hook_risks: ['章尾承接偏弱'] },
    })

    expect(result.status).toBe('warning')
    expect(result.itemResults.find((item) => item.contractItemType === 'chapter_hook')?.verdict).toBe('weak')
    expect(result.itemResults.find((item) => item.contractItemType === 'foreshadow_delivery')?.verdict).toBe('pass')
    expect(result.rewriteHints.some((item) => item.includes('章尾'))).toBe(true)
  })
})
