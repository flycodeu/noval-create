import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import { chapterSegments, sceneContracts } from '../database/schema'
import {
  collectSceneDesignFieldGaps,
  computeSceneDesignFieldWrites,
  hasSceneDesignDeclarations,
  loadScenePlanContractSeeds,
  writeBackSceneDesignFields,
  type ScenePlanStep,
} from './chapter-scene-plan'

function buildStep(overrides: Partial<ScenePlanStep> = {}): ScenePlanStep {
  return {
    scene_order: 1,
    scene_title: '炉前对峙',
    purpose: '把事故责任摊到桌面上',
    location: '锅炉场',
    time_anchor: '午后',
    present_characters: ['沈砚青', '韩铁根'],
    key_items: [],
    conflict: '沈砚青要查工册，韩铁根拦着不放',
    beat: '翻查记录',
    must_cover: ['事故经过'],
    climax_variant: '',
    exit_hook: '工册缺了一页',
    hidden_agendas: ['沈砚青想借查册立威', '韩铁根在护着侄子'],
    irony_gap: '读者知道缺页是韩铁根撕的',
    audience: '',
    ...overrides,
  }
}

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
  const updateCalls: Array<{ table: unknown; set: Record<string, unknown> }> = []
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => createQuery(rowsByTable, table)),
    })),
    update: vi.fn((table: unknown) => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({
          run: vi.fn(() => {
            updateCalls.push({ table, set: values })
          }),
        })),
      })),
    })),
  }
  return { db, updateCalls }
}

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('computeSceneDesignFieldWrites', () => {
  const segments = [
    { id: 11, segmentOrder: 1 },
    { id: 12, segmentOrder: 2 },
  ]
  const contracts = [
    { id: 101, segmentId: 11 },
    { id: 102, segmentId: 12 },
  ]

  it('按 sceneOrder → segment → contract 对位生成写回', () => {
    const writes = computeSceneDesignFieldWrites([buildStep()], segments, contracts)
    expect(writes).toHaveLength(1)
    expect(writes[0].contractId).toBe(101)
    expect(JSON.parse(writes[0].hiddenAgendasJson || '[]')).toEqual(['沈砚青想借查册立威', '韩铁根在护着侄子'])
    expect(writes[0].ironyGap).toBe('读者知道缺页是韩铁根撕的')
  })

  it('sceneOrder 错位（无对应 segment）时不写', () => {
    const writes = computeSceneDesignFieldWrites([buildStep({ scene_order: 7 })], segments, contracts)
    expect(writes).toHaveLength(0)
  })

  it('segment 存在但合同行缺失时不写（不新建行）', () => {
    const writes = computeSceneDesignFieldWrites(
      [buildStep({ scene_order: 2 })],
      segments,
      [{ id: 101, segmentId: 11 }],
    )
    expect(writes).toHaveLength(0)
  })

  it('两个设计字段都为空时不写，避免空输出覆盖已固化设计', () => {
    const writes = computeSceneDesignFieldWrites(
      [buildStep({ hidden_agendas: [], irony_gap: '  ' })],
      segments,
      contracts,
    )
    expect(writes).toHaveLength(0)
  })

  it('只有一个字段有值时另一列标记为 null（保留旧值）', () => {
    const writes = computeSceneDesignFieldWrites(
      [buildStep({ hidden_agendas: [], irony_gap: '无' })],
      segments,
      contracts,
    )
    expect(writes).toHaveLength(1)
    expect(writes[0].hiddenAgendasJson).toBeNull()
    expect(writes[0].ironyGap).toBe('无')
  })
})

describe('writeBackSceneDesignFields', () => {
  it('只对成功对位的合同行执行 UPDATE，且只写设计两列', () => {
    const rowsByTable: TableRows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapterSegments, [
        { id: 11, chapterId: 10, segmentOrder: 1 },
        { id: 12, chapterId: 10, segmentOrder: 2 },
      ]],
      [sceneContracts, [
        { id: 101, chapterId: 10, segmentId: 11 },
        // 场景 2 没有合同行 → 不得新建、不得写。
      ]],
    ])
    const { db, updateCalls } = createDbMock(rowsByTable)
    vi.mocked(getDb).mockReturnValue(db as never)

    const count = writeBackSceneDesignFields(10, [
      buildStep(),
      buildStep({ scene_order: 2, scene_title: '工册股问询', hidden_agendas: ['股长只想不担责'], irony_gap: '无' }),
    ])

    expect(count).toBe(1)
    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].table).toBe(sceneContracts)
    expect(Object.keys(updateCalls[0].set).sort()).toEqual(['hiddenAgendasJson', 'ironyGap'])
  })

  it('数据库异常时只告警不抛错', () => {
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error('db unavailable')
    })
    expect(writeBackSceneDesignFields(10, [buildStep()])).toBe(0)
  })
})

describe('loadScenePlanContractSeeds 设计字段读回', () => {
  it('把合同上的 hidden_agendas_json / irony_gap 读回 seed，使重生成延续设计', () => {
    const rowsByTable: TableRows = new Map<unknown, Array<Record<string, unknown>>>([
      [chapterSegments, [
        { id: 11, chapterId: 10, segmentOrder: 1, title: '炉前对峙', purpose: '摊开事故责任', outputState: '' },
      ]],
      [sceneContracts, [
        {
          id: 101,
          chapterId: 10,
          segmentId: 11,
          sceneGoal: '摊开事故责任',
          timeLocation: '锅炉场',
          obstacle: '韩铁根拦查',
          conflictType: '权责冲突',
          resultState: '工册缺页曝光',
          hiddenAgendasJson: JSON.stringify(['韩铁根在护着侄子']),
          ironyGap: '读者知道缺页是韩铁根撕的',
        },
        // 无 segment 对应的孤儿合同也要读回设计字段。
        {
          id: 102,
          chapterId: 10,
          segmentId: null,
          sceneGoal: '收尾',
          hiddenAgendasJson: '不是JSON',
          ironyGap: '',
        },
      ]],
    ])
    const { db } = createDbMock(rowsByTable)
    vi.mocked(getDb).mockReturnValue(db as never)

    const seeds = loadScenePlanContractSeeds(10)
    expect(seeds).toHaveLength(2)
    expect(seeds[0].hiddenAgendas).toEqual(['韩铁根在护着侄子'])
    expect(seeds[0].ironyGap).toBe('读者知道缺页是韩铁根撕的')
    // 损坏的 JSON 安全降级为空数组。
    expect(seeds[1].hiddenAgendas).toEqual([])
    expect(seeds[1].ironyGap).toBe('')
  })
})

describe('collectSceneDesignFieldGaps', () => {
  it('声明了冲突但设计字段为空的场景逐条计数', () => {
    const gaps = collectSceneDesignFieldGaps([
      buildStep({ hidden_agendas: [], irony_gap: '' }),
      buildStep({ scene_order: 2, scene_title: '工册股问询' }),
    ])
    expect(gaps).toHaveLength(2)
    expect(gaps[0]).toContain('hidden_agendas 为空')
    expect(gaps[1]).toContain('irony_gap 为空')
  })

  it('无冲突的过场景不计数；显式“无”的 irony_gap 不算缺口', () => {
    const gaps = collectSceneDesignFieldGaps([
      buildStep({ conflict: '', hidden_agendas: [], irony_gap: '' }),
      buildStep({ scene_order: 2, irony_gap: '无' }),
    ])
    expect(gaps).toHaveLength(0)
  })
})

describe('hasSceneDesignDeclarations', () => {
  it('hidden_agendas 或有效 irony_gap 都算设计声明', () => {
    expect(hasSceneDesignDeclarations([buildStep({ irony_gap: '' })])).toBe(true)
    expect(hasSceneDesignDeclarations([buildStep({ hidden_agendas: [] })])).toBe(true)
  })

  it('空字段或显式“无”不触发 design_subtext 维度', () => {
    expect(hasSceneDesignDeclarations([
      buildStep({ hidden_agendas: [], irony_gap: '' }),
      buildStep({ scene_order: 2, hidden_agendas: ['  '], irony_gap: '无' }),
    ])).toBe(false)
  })
})
