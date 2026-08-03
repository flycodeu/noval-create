import { describe, expect, it } from 'vitest'
import {
  assessCreativeStageContext,
  assessCreativeStageHandoff,
  buildCreativeStageContextPacket,
  buildCreativeStageQualitySnapshot,
  buildCreativeStagePromptSummary,
  clampChapterRange,
  formatCreativeStageRange,
  formatCreativeStageHandoff,
  getCreativeStageContextGenerationBlockers,
  normalizeCreativeStageHandoffList,
} from './creative-stages'

describe('creative stages', () => {
  it('normalizes reversed chapter windows without losing the author intent', () => {
    expect(clampChapterRange(200, 101)).toEqual({ chapterStart: 101, chapterEnd: 200 })
    expect(clampChapterRange(undefined, 80)).toEqual({ chapterEnd: 80 })
  })

  it('formats open and closed chapter windows', () => {
    expect(formatCreativeStageRange({ chapterStart: 1, chapterEnd: 100 })).toBe('第 1–100 章')
    expect(formatCreativeStageRange({ chapterStart: 101 })).toBe('第 101 章起')
    expect(formatCreativeStageRange({})).toBe('全书范围')
  })

  it('keeps stage context compact and names the minimum asset boundary', () => {
    const summary = buildCreativeStagePromptSummary({
      stage: {
        id: 1,
        novelId: 1,
        sequence: 1,
        name: '第一卷起局',
        kind: 'chapter-window',
        status: 'active',
        chapterStart: 1,
        chapterEnd: 100,
        objective: '让主角第一次主动选择',
        storySummary: '港城追查失踪案',
        handoffSummary: '留下证人线索',
        contextVersion: 1,
        activeAssetCount: 1,
        plannedAssetCount: 1,
        coreAssetCount: 1,
        createdAt: '',
        updatedAt: '',
      },
      assets: [{
        id: 1,
        novelId: 1,
        stageId: 1,
        assetType: 'character',
        placeholderName: '港口税吏',
        role: 'supporting',
        detailLevel: 'outline',
        status: 'planned',
        createdAt: '',
        updatedAt: '',
      }],
    })

    expect(summary).toContain('第一卷起局')
    expect(summary).toContain('港口税吏')
    expect(summary).toContain('交接条件：留下证人线索')
  })

  it('injects bounded canonical asset briefs into both prompt and packet', () => {
    const asset = {
      id: 1,
      novelId: 1,
      stageId: 1,
      assetType: 'character' as const,
      assetId: 101,
      placeholderName: '角色占位名',
      role: 'core' as const,
      detailLevel: 'working' as const,
      status: 'active' as const,
      createdAt: '',
      updatedAt: '',
    }
    const brief = {
      assetType: 'character' as const,
      assetId: 101,
      name: '规范人物名',
      detail: '当前目标：追回账本；人物弧：从旁观到承担',
    }
    const stage = {
      id: 1,
      novelId: 1,
      sequence: 1,
      name: '当前阶段',
      kind: 'chapter-window' as const,
      status: 'active' as const,
      objective: '推进主线',
      storySummary: '只处理当前冲突',
      handoffSummary: '',
      contextVersion: 1,
      activeAssetCount: 1,
      plannedAssetCount: 0,
      coreAssetCount: 1,
      createdAt: '',
      updatedAt: '',
    }

    const summary = buildCreativeStagePromptSummary({ stage, assets: [asset], assetBriefs: [brief] })
    const packet = buildCreativeStageContextPacket(stage, [asset], 1, undefined, undefined, [brief])

    expect(summary).toContain('规范人物名')
    expect(summary).toContain('当前目标：追回账本')
    expect(packet.focusAssets[0]).toMatchObject({
      name: '规范人物名',
      brief: '当前目标：追回账本；人物弧：从旁观到承担',
    })
  })

  it('distinguishes incomplete setup from a stale stage snapshot', () => {
    expect(assessCreativeStageContext({
      kind: 'chapter-window',
      objective: '',
      storySummary: '',
      handoffSummary: '',
      contextVersion: 1,
    }, 0, 1)).toMatchObject({
      status: 'needs_setup',
      hardBlockers: expect.arrayContaining([
        '没有阶段目标，正文无法判断本段必须推进什么。',
        '没有剧情边界，生成器可能提前展开后续阶段。',
      ]),
    })

    expect(assessCreativeStageContext({
      kind: 'chapter-window',
      objective: '让主角第一次主动选择',
      storySummary: '只处理港城失踪案',
      handoffSummary: '留下证人线索',
      contextVersion: 3,
    }, 3, 3).status).toBe('ready')
    expect(assessCreativeStageContext({
      kind: 'chapter-window',
      objective: '让主角第一次主动选择',
      storySummary: '只处理港城失踪案',
      handoffSummary: '留下证人线索',
      contextVersion: 2,
    }, 3, 4).status).toBe('stale')
  })

  it('builds an auditable packet without copying the whole novel bible', () => {
    const packet = buildCreativeStageContextPacket({
      id: 9,
      novelId: 1,
      sequence: 1,
      name: '第一卷起局',
      kind: 'chapter-window',
      status: 'active',
      chapterStart: 1,
      chapterEnd: 100,
      objective: '让主角第一次主动选择',
      storySummary: '港城追查失踪案',
      handoffSummary: '留下证人线索',
      contextVersion: 3,
      activeAssetCount: 1,
      plannedAssetCount: 1,
      coreAssetCount: 1,
      createdAt: '',
      updatedAt: '',
    }, [{
      id: 4,
      novelId: 1,
      stageId: 9,
      assetType: 'character',
      placeholderName: '港口税吏',
      role: 'supporting',
      detailLevel: 'outline',
      status: 'planned',
      createdAt: '',
      updatedAt: '',
    }], 3)

    expect(packet).toEqual(expect.objectContaining({
      stageId: 9,
      projectContextVersion: 3,
      chapterRange: '第 1–100 章',
      handoff: '留下证人线索',
    }))
    expect(packet.focusAssets[0]).toMatchObject({ name: '港口税吏', role: 'supporting' })
  })

  it('blocks explicit generation for stale or incomplete stage context', () => {
    expect(getCreativeStageContextGenerationBlockers({
      status: 'ready',
      hardBlockers: [],
      warnings: ['可选提醒'],
    })).toEqual([])
    expect(getCreativeStageContextGenerationBlockers({
      status: 'stale',
      hardBlockers: ['缺少阶段目标'],
      warnings: ['项目版本已变化'],
    })).toEqual(['缺少阶段目标', '项目版本已变化'])
  })

  it('requires meaningful handoff state before author confirmation', () => {
    expect(assessCreativeStageHandoff({
      changes: [],
      costs: [],
      openQuestions: [],
      nextPressure: '',
    })).toMatchObject({
      hardBlockers: expect.arrayContaining([
        '交接缺少本阶段已发生的状态变化。',
        '交接缺少下一阶段压力，正文无法形成明确承接。',
      ]),
    })
    expect(normalizeCreativeStageHandoffList('主角受伤\n\n主角受伤\n证据链转移')).toEqual(['主角受伤', '证据链转移'])
    expect(formatCreativeStageHandoff({
      schemaVersion: 'creative-stage-handoff-v1',
      stageId: 1,
      stageName: '第一卷',
      chapterRange: '第 1–100 章',
      changes: ['主角主动承担责任'],
      costs: ['失去证人保护'],
      openQuestions: ['谁在篡改账本'],
      nextPressure: '城隍封门倒计时',
      assetContinuity: [],
    })).toContain('下一压力：城隍封门倒计时')
  })

  it('surfaces chapter coverage and missing handoff evidence as stage quality risks', () => {
    const quality = buildCreativeStageQualitySnapshot([
      { chapterNum: 1, hasContent: true, hasSummary: true, hasContinuity: true },
      { chapterNum: 2, hasContent: true, hasSummary: false, hasContinuity: false },
    ], {
      handoffRequired: true,
      handoffStatus: 'draft',
    })

    expect(quality).toMatchObject({
      status: 'needs_attention',
      chapterCount: 2,
      completedChapterCount: 2,
      contentCoverageRate: 100,
      summaryCoverageRate: 50,
      continuityCoverageRate: 50,
      handoffRequired: true,
      handoffStatus: 'draft',
    })
    expect(quality.warnings).toEqual(expect.arrayContaining([
      '部分章节缺少章后摘要，长篇召回会变薄。',
      '部分章节缺少连续性状态，人物和线程交接不完整。',
      '阶段已到交接窗口，但还没有作者确认的 handoff。',
    ]))
  })

  it('marks a fully covered stage healthy after an approved complete handoff', () => {
    const quality = buildCreativeStageQualitySnapshot([
      {
        chapterNum: 1,
        hasContent: true,
        hasSummary: true,
        hasContinuity: true,
        gateLevel: 'pass',
        gateReady: true,
        gateScore: 82,
        gateIssueKeys: ['hook_strength'],
      },
    ], {
      handoffRequired: true,
      handoffStatus: 'approved',
      approvedHandoff: {
        changes: ['主角主动选择'],
        costs: ['失去通行令'],
        openQuestions: ['谁在操纵封门'],
        nextPressure: '封门倒计时',
      },
    })

    expect(quality.status).toBe('healthy')
    expect(quality.handoffCompleteness).toEqual({
      changes: true,
      costs: true,
      openQuestions: true,
      nextPressure: true,
    })
    expect(quality.trend).toMatchObject({
      status: 'insufficient',
      gateCoveredChapterCount: 1,
      averageGateScore: 82,
      readyRate: 100,
      blockerChapterCount: 0,
    })
  })

  it('turns chapter gate snapshots into an actionable stage trend', () => {
    const quality = buildCreativeStageQualitySnapshot([
      {
        chapterNum: 1,
        hasContent: true,
        hasSummary: true,
        hasContinuity: true,
        gateLevel: 'pass',
        gateReady: true,
        gateScore: 84,
        gateIssueKeys: ['dialogue_voice'],
      },
      {
        chapterNum: 2,
        hasContent: true,
        hasSummary: true,
        hasContinuity: true,
        gateLevel: 'blocker',
        gateReady: false,
        gateScore: 51,
        gateBlockerCount: 2,
        gateIssueKeys: ['dialogue_voice', 'contract_delivery'],
      },
    ], {
      handoffRequired: false,
      handoffStatus: 'missing',
    })

    expect(quality.trend).toMatchObject({
      status: 'worsening',
      gateCoveredChapterCount: 2,
      firstGateScore: 84,
      latestGateScore: 51,
      scoreDelta: -33,
      readyRate: 50,
      blockerChapterCount: 1,
    })
    expect(quality.trend.repeatedIssueKeys).toEqual(expect.arrayContaining([
      { key: 'dialogue_voice', count: 2 },
    ]))
    expect(quality.warnings).toEqual(expect.arrayContaining([
      '1 个章节验收门处于阻塞或重写状态，阶段不应直接扩展。',
    ]))
  })
})
