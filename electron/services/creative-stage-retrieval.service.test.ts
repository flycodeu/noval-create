import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

import { getDb } from '../database/db'
import { characters, novels, worldMap } from '../database/schema'
import { resolveCreativeStageAssetBriefs, selectCreativeStageAssetBindings } from './creative-stage-retrieval.service'

describe('creative stage retrieval', () => {
  beforeEach(() => {
    const rows = new Map<unknown, Array<Record<string, unknown>>>([
      [novels, [{ id: 200, worldRulesJson: '{"禁则":"未经许可不得越过炉区"}' }]],
      [characters, [{
        id: 301,
        novelId: 200,
        fullName: '叶振',
        roleType: 'protagonist',
        occupation: '夜班检修工',
        background: '从事故中幸存',
        goals: '查清炉区异常',
        characterArc: '从被动求生到主动承担',
        speechPattern: '短句，少解释',
        hiddenSecret: '不应进入当前阶段提示词',
      }]],
      [worldMap, [{
        id: 401,
        novelId: 200,
        name: '三号炉区',
        nodeType: 'industrial_zone',
        description: '高温、封闭、夜间照明不稳定',
        plotRelevance: '事故调查的现场',
        atmosphere: '压迫',
        dangerLevel: 'high',
      }]],
    ])
    const db = {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            all: vi.fn(() => rows.get(table) || []),
          })),
        })),
      })),
    }
    vi.mocked(getDb).mockReturnValue(db as never)
  })

  it('retrieves only bound assets and excludes sensitive character fields', () => {
    const briefs = resolveCreativeStageAssetBriefs(200, [
      {
        id: 1,
        novelId: 200,
        stageId: 2,
        assetType: 'character',
        assetId: 301,
        placeholderName: '主角占位',
        role: 'core',
        detailLevel: 'canonical',
        status: 'active',
        notes: '本阶段只关注调查动机',
        createdAt: '',
        updatedAt: '',
      },
      {
        id: 2,
        novelId: 200,
        stageId: 2,
        assetType: 'map',
        assetId: 401,
        role: 'supporting',
        detailLevel: 'working',
        status: 'active',
        createdAt: '',
        updatedAt: '',
      },
    ])

    expect(briefs).toHaveLength(2)
    expect(briefs[0]).toMatchObject({ assetId: 301, name: '叶振' })
    expect(briefs[0].detail).toContain('当前目标：查清炉区异常')
    expect(briefs[0].detail).not.toContain('不应进入当前阶段提示词')
    expect(briefs[1]).toMatchObject({ assetId: 401, name: '三号炉区' })
    expect(briefs[1].detail).toContain('剧情作用：事故调查的现场')
  })

  it('keeps core assets and ranks chapter-mentioned support assets first', () => {
    const assets = [
      { id: 1, novelId: 200, stageId: 2, assetType: 'character' as const, assetId: 301, role: 'core' as const, detailLevel: 'canonical' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
      { id: 2, novelId: 200, stageId: 2, assetType: 'character' as const, assetId: 302, placeholderName: '未出场人物', role: 'supporting' as const, detailLevel: 'working' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
      { id: 3, novelId: 200, stageId: 2, assetType: 'map' as const, assetId: 401, placeholderName: '三号炉区', role: 'supporting' as const, detailLevel: 'working' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
    ]
    const briefs = [
      { assetType: 'character' as const, assetId: 301, name: '叶振', detail: '主角' },
      { assetType: 'character' as const, assetId: 302, name: '未出场人物', detail: '暂不使用' },
      { assetType: 'map' as const, assetId: 401, name: '三号炉区', detail: '事故现场' },
    ]

    expect(selectCreativeStageAssetBindings(assets, briefs, '本章叶振进入三号炉区', 2).map((asset) => asset.assetId))
      .toEqual([301, 401])
  })

  it('keeps no-signal generation bounded and excludes retired or deferred assets', () => {
    const assets = [
      { id: 1, novelId: 200, stageId: 2, assetType: 'character' as const, assetId: 301, role: 'core' as const, detailLevel: 'canonical' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
      { id: 2, novelId: 200, stageId: 2, assetType: 'map' as const, assetId: 401, role: 'supporting' as const, detailLevel: 'working' as const, status: 'retired' as const, createdAt: '', updatedAt: '' },
      { id: 3, novelId: 200, stageId: 2, assetType: 'character' as const, assetId: 302, role: 'supporting' as const, detailLevel: 'working' as const, status: 'deferred' as const, createdAt: '', updatedAt: '' },
      { id: 4, novelId: 200, stageId: 2, assetType: 'thread' as const, assetId: 501, role: 'handoff' as const, detailLevel: 'outline' as const, status: 'planned' as const, createdAt: '', updatedAt: '' },
      { id: 5, novelId: 200, stageId: 2, assetType: 'item' as const, assetId: 601, role: 'supporting' as const, detailLevel: 'outline' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
    ]

    expect(selectCreativeStageAssetBindings(assets, [], undefined, 2).map((asset) => asset.id))
      .toEqual([1, 4])
  })

  it('does not let historical handoff assets crowd out a chapter-mentioned support asset', () => {
    const assets = [
      { id: 1, novelId: 200, stageId: 2, assetType: 'character' as const, assetId: 301, placeholderName: '叶振', role: 'core' as const, detailLevel: 'canonical' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
      ...Array.from({ length: 20 }, (_, index) => ({
        id: index + 2,
        novelId: 200,
        stageId: 2,
        assetType: 'outline' as const,
        assetId: index + 500,
        placeholderName: `历史第${index + 1}章`,
        role: 'handoff' as const,
        detailLevel: 'canonical' as const,
        status: 'active' as const,
        createdAt: '',
        updatedAt: '',
      })),
      { id: 30, novelId: 200, stageId: 2, assetType: 'map' as const, assetId: 401, placeholderName: '三号炉区', role: 'supporting' as const, detailLevel: 'working' as const, status: 'active' as const, createdAt: '', updatedAt: '' },
    ]

    expect(selectCreativeStageAssetBindings(assets, [], '本章叶振进入三号炉区', 2).map((asset) => asset.id))
      .toEqual([1, 30])
  })

  it('does not leak canonical character arc through a working-level binding', () => {
    const [brief] = resolveCreativeStageAssetBriefs(200, [{
      id: 3,
      novelId: 200,
      stageId: 2,
      assetType: 'character',
      assetId: 301,
      role: 'supporting',
      detailLevel: 'working',
      status: 'active',
      createdAt: '',
      updatedAt: '',
    }])

    expect(brief.detail).toContain('当前目标：查清炉区异常')
    expect(brief.detail).not.toContain('人物弧：从被动求生到主动承担')
  })
})
