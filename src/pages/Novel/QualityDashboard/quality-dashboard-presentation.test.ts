import { describe, expect, it } from 'vitest'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../types'
import {
  buildChapterGateHeatmapModel,
  buildMiniTrendGeometry,
  buildQualityHeatmapModel,
  buildRepairActionTargetPath,
  buildSoakExportCommand,
  buildSoakValidateCommand,
  buildTrendPath,
  buildWeakDimensionBars,
  buildWorkspacePath,
  chapterGateScoreBand,
  filterDashboardByVolume,
  findChapterByNum,
  formatSignedValue,
  getTopLanguageDriftMetrics,
  getVisibleGateAlerts,
  quotePowerShellArg,
  scoreColor,
  summarizeChapterGateTrend,
  type VolumeQualityEntry,
} from './quality-dashboard-presentation'

type GateTrendEntry = QualityDashboardData['chapterGateTrend'][number]
type GateAlertEntry = QualityDashboardData['chapterGateDriftAlerts'][number]

function gateTrendEntry(partial: Partial<GateTrendEntry>): GateTrendEntry {
  return {
    chapterId: 1,
    chapterNum: 1,
    totalScore: 80,
    gateLevel: 'pass',
    scoreBand: 'stable',
    createdAt: new Date().toISOString(),
    ...partial,
  } as GateTrendEntry
}

describe('formatSignedValue', () => {
  it('给正数加 + 前缀', () => {
    expect(formatSignedValue(3)).toBe('+3')
  })

  it('负数与零保持原样', () => {
    expect(formatSignedValue(-2)).toBe('-2')
    expect(formatSignedValue(0)).toBe('0')
  })
})

describe('scoreColor', () => {
  it('按阈值分档', () => {
    expect(scoreColor(9)).toBe('#52c41a')
    expect(scoreColor(7)).toBe('#faad14')
    expect(scoreColor(5)).toBe('#fa8c16')
    expect(scoreColor(2)).toBe('#f5222d')
  })
})

describe('chapterGateScoreBand', () => {
  it('80+ 稳定，60-79 关注，40-59 风险，其余失稳', () => {
    expect(chapterGateScoreBand(80)).toBe('stable')
    expect(chapterGateScoreBand(60)).toBe('attention')
    expect(chapterGateScoreBand(40)).toBe('risky')
    expect(chapterGateScoreBand(39)).toBe('unstable')
  })
})

describe('buildWorkspacePath', () => {
  it('拼接查询参数并走统一路由映射', () => {
    expect(buildWorkspacePath(7, 'writing', { chapterId: '42' })).toBe('/novels/7/writing/editor?chapterId=42')
  })

  it('忽略空值参数', () => {
    expect(buildWorkspacePath(7, 'revision', { taskId: '' })).toBe('/novels/7/revision')
  })

  it('无页面时修复动作路径为 null', () => {
    expect(buildRepairActionTargetPath(7, undefined)).toBeNull()
  })
})

describe('soak 命令构建', () => {
  it('单引号会转义成 PowerShell 双单引号', () => {
    expect(quotePowerShellArg("it's")).toBe("'it''s'")
  })

  it('导出与校验命令包含 novelId 与报告路径', () => {
    expect(buildSoakExportCommand(3)).toContain('--novelId 3')
    expect(buildSoakExportCommand(3)).toContain('.tmp-tests/real-chapter-soak-report-3.json')
    expect(buildSoakValidateCommand(3)).toContain('.tmp-tests/real-chapter-soak-report-3.json')
  })
})

describe('getTopLanguageDriftMetrics', () => {
  const metrics = {
    abstractTokenDensity: 10,
    sentencePatternRepeatRate: 90,
    endingSummaryRate: 50,
    ornamentOverloadRate: 50,
    nonHumanCollocationRate: 5,
    dashDensity: 1,
    parentheticalExplanationDensity: 2,
    metaphorStackRate: 3,
    parallelismRate: 4,
    bodyDetailClicheRate: 6,
    isolatedTemplateParagraphRate: 7,
  } as LanguageDriftMetrics

  it('按数值降序取前 N 项', () => {
    const top = getTopLanguageDriftMetrics(metrics, 2)
    expect(top.map((item) => item.key)).toEqual(['sentencePatternRepeatRate', 'endingSummaryRate'])
  })

  it('同值时按标签排序保证稳定', () => {
    const top = getTopLanguageDriftMetrics(metrics, 3)
    expect(top[1].value).toBe(50)
    expect(top[2].value).toBe(50)
    expect(top[1].label.localeCompare(top[2].label)).toBeLessThan(0)
  })
})

describe('summarizeChapterGateTrend', () => {
  it('空趋势返回零值统计', () => {
    const summary = summarizeChapterGateTrend([])
    expect(summary.averageVisibleScore).toBe(0)
    expect(summary.bandCounts).toEqual({ stable: 0, attention: 0, risky: 0, unstable: 0 })
    expect(summary.levelCounts).toEqual({ pass: 0, warning: 0, blocker: 0, rewrite: 0 })
  })

  it('计算均值（保留一位小数）与分档计数', () => {
    const trend = [
      gateTrendEntry({ chapterNum: 1, totalScore: 81, gateLevel: 'pass', scoreBand: 'stable' }),
      gateTrendEntry({ chapterNum: 2, totalScore: 62, gateLevel: 'warning', scoreBand: 'attention' }),
      gateTrendEntry({ chapterNum: 3, totalScore: 30, gateLevel: 'rewrite', scoreBand: 'unstable' }),
    ]
    const summary = summarizeChapterGateTrend(trend)
    expect(summary.averageVisibleScore).toBe(57.7)
    expect(summary.bandCounts.stable).toBe(1)
    expect(summary.bandCounts.attention).toBe(1)
    expect(summary.bandCounts.unstable).toBe(1)
    expect(summary.levelCounts.pass).toBe(1)
    expect(summary.levelCounts.warning).toBe(1)
    expect(summary.levelCounts.rewrite).toBe(1)
  })
})

describe('getVisibleGateAlerts', () => {
  it('过滤稳定项并截断', () => {
    const alerts = [
      { status: 'stable' },
      { status: 'worsening' },
      { status: 'improving' },
      { status: 'worsening' },
    ] as GateAlertEntry[]
    expect(getVisibleGateAlerts(alerts).map((a) => a.status)).toEqual(['worsening', 'improving', 'worsening'])
    expect(getVisibleGateAlerts(alerts, 2)).toHaveLength(2)
  })
})

describe('buildChapterGateHeatmapModel', () => {
  it('维度去重、章号取自趋势、valueMap 可按键取值', () => {
    const heatmap = [
      { chapterNum: 1, dimension: '连续性', score: 80 },
      { chapterNum: 2, dimension: '连续性', score: 70 },
      { chapterNum: 1, dimension: '结构连贯', score: 60 },
    ] as QualityDashboardData['chapterGateHeatmap']
    const trend = [
      gateTrendEntry({ chapterNum: 1 }),
      gateTrendEntry({ chapterNum: 2 }),
    ]
    const model = buildChapterGateHeatmapModel(heatmap, trend)
    expect(model.dimensions).toEqual(['连续性', '结构连贯'])
    expect(model.chapterNums).toEqual([1, 2])
    expect(model.valueMap.get('2:连续性')?.score).toBe(70)
    expect(model.valueMap.get('2:结构连贯')).toBeUndefined()
  })
})

describe('buildQualityHeatmapModel', () => {
  it('按固定维度顺序输出且只保留出现过的维度', () => {
    const data = [
      { chapterNum: 1, dimension: '逻辑连贯', score: 8 },
      { chapterNum: 1, dimension: '文笔质量', score: 7 },
    ] as QualityDashboardData['heatmapData']
    const model = buildQualityHeatmapModel(data, [1])
    expect(model.dimensions).toEqual(['文笔质量', '逻辑连贯'])
    expect(model.byDim.get('逻辑连贯')?.get(1)).toBe(8)
  })

  it('超过 50 章时做等距采样', () => {
    const nums = Array.from({ length: 120 }, (_, i) => i + 1)
    const model = buildQualityHeatmapModel([], nums)
    expect(model.displayNums.length).toBeLessThanOrEqual(50)
    expect(model.displayNums[0]).toBe(1)
    // 步长 ceil(120/50)=3
    expect(model.displayNums[1]).toBe(4)
  })

  it('不超过 50 章时原样返回', () => {
    const nums = [1, 2, 3]
    expect(buildQualityHeatmapModel([], nums).displayNums).toEqual(nums)
  })
})

describe('buildTrendPath / buildMiniTrendGeometry', () => {
  it('空序列返回空 path', () => {
    expect(buildTrendPath([], 100, 50, 10)).toBe('')
  })

  it('首点 M 后续 L，并按最大值归一化', () => {
    const path = buildTrendPath([
      { chapterNum: 1, value: 0 },
      { chapterNum: 2, value: 10 },
    ], 100, 50, 10)
    expect(path).toBe('M0,50 L100,0')
  })

  it('迷你趋势裁剪到 0-100 并给出最新值', () => {
    const geometry = buildMiniTrendGeometry([
      { chapterNum: 1, value: 150 },
      { chapterNum: 2, value: -10 },
    ])
    expect(geometry.width).toBe(200)
    expect(geometry.height).toBe(36)
    expect(geometry.latest).toBe(-10)
    // 150 被裁到 100 → y=0；-10 被裁到 0 → y=36
    expect(geometry.path).toBe('M0,0 L200,36')
  })
})

describe('buildWeakDimensionBars', () => {
  it('过滤零计数并给出最大值', () => {
    const model = buildWeakDimensionBars([
      { dimension: 'A', count: 0 },
      { dimension: 'B', count: 3 },
      { dimension: 'C', count: 5 },
    ])
    expect(model.items.map((item) => item.dimension)).toEqual(['B', 'C'])
    expect(model.maxCount).toBe(5)
  })

  it('全空时 maxCount 保底为 1', () => {
    expect(buildWeakDimensionBars([]).maxCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// filterDashboardByVolume
// ---------------------------------------------------------------------------

function makeVolume(partial: Partial<VolumeQualityEntry>): VolumeQualityEntry {
  return {
    volumeId: 1,
    volumeName: '第一卷',
    chapterStart: 1,
    chapterEnd: 10,
    ...partial,
  } as VolumeQualityEntry
}

function makeVolumeFilterSource() {
  const chapterDetails = [
    { chapterId: 11, chapterNum: 1, volumeId: 1 },
    { chapterId: 12, chapterNum: 2, volumeId: 1 },
    { chapterId: 21, chapterNum: 11, volumeId: 2 },
  ] as QualityDashboardData['chapterDetails']

  const recurrence = {
    hitChapterCount: 3,
    recurringRuleCount: 1,
    promotedRuleCount: 0,
    highRiskRuleCount: 0,
    topRepeatedRules: [],
    promotedRules: [],
    recentAlerts: [
      { ruleCode: 'a', chapterNums: [1, 2] },
      { ruleCode: 'b', chapterNums: [11] },
    ],
    volumeEntries: [
      { volumeId: 1 },
      { volumeId: 2 },
    ],
  } as unknown as QualityDashboardData['antiAiRecurrence']

  const feedback = {
    hitChapterCount: 2,
    recurringIssueCount: 1,
    promotedIssueCount: 0,
    pauseSuggestedIssueCount: 0,
    topRepeatedIssues: [],
    promotedIssues: [],
    recentAlerts: [
      { issueType: 'x', chapterNums: [2] },
      { issueType: 'y', chapterNums: [12] },
    ],
    humanization: {
      hitChapterCount: 0,
      recurringIssueCount: 0,
      promotedIssueCount: 0,
      highRiskIssueCount: 0,
      topRepeatedIssues: [{ issueType: 'h1', chapterNums: [3] }, { issueType: 'h2', chapterNums: [13] }],
      promotedIssues: [{ issueType: 'h3', chapterNums: [11] }],
      recentAlerts: [{ issueType: 'h4', chapterNums: [1] }],
    },
    volumeEntries: [{ volumeId: 1 }, { volumeId: 2 }],
  } as unknown as QualityDashboardData['feedbackRecurrence']

  return {
    chapterDetails,
    heatmapData: [
      { chapterNum: 1, dimension: '文笔质量', score: 8 },
      { chapterNum: 11, dimension: '文笔质量', score: 6 },
    ] as QualityDashboardData['heatmapData'],
    chapterGateTrend: [
      gateTrendEntry({ chapterNum: 2 }),
      gateTrendEntry({ chapterNum: 11 }),
    ],
    chapterGateHeatmap: [
      { chapterNum: 2, dimension: '连续性', score: 70 },
      { chapterNum: 11, dimension: '连续性', score: 60 },
    ] as QualityDashboardData['chapterGateHeatmap'],
    chapterGateDriftAlerts: [
      { chapterId: 12, chapterNum: 2, status: 'worsening' },
      { chapterId: 21, chapterNum: 11, status: 'worsening' },
    ] as QualityDashboardData['chapterGateDriftAlerts'],
    overallScoreTrend: [
      { chapterNum: 1, score: 8 },
      { chapterNum: 11, score: 6 },
    ] as QualityDashboardData['overallScoreTrend'],
    aiLikeRateTrend: [
      { chapterNum: 1, rate: 20 },
      { chapterNum: 11, rate: 50 },
    ] as QualityDashboardData['aiLikeRateTrend'],
    volumeLanguageDrift: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['volumeLanguageDrift'],
    volumeStoryDynamics: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['volumeStoryDynamics'],
    repeatedFunctionRuns: [
      { startChapterNum: 1, endChapterNum: 3, primaryTag: 'setup', length: 3, chapterNums: [1, 2, 3] },
      { startChapterNum: 11, endChapterNum: 12, primaryTag: 'setup', length: 2, chapterNums: [11, 12] },
    ] as QualityDashboardData['repeatedFunctionRuns'],
    chapterFunctionAlerts: [
      { code: 'a', chapterNums: [2], volumeId: undefined },
      { code: 'b', chapterNums: [11], volumeId: 2 },
      { code: 'c', chapterNums: [], volumeId: 1 },
    ] as unknown as QualityDashboardData['chapterFunctionAlerts'],
    volumeChapterFunctions: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['volumeChapterFunctions'],
    storyArcProgressVolumes: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['storyArcProgressVolumes'],
    recentRecallAlerts: [
      { chapterId: 11, chapterNum: 1 },
      { chapterId: 21, chapterNum: 11 },
    ] as QualityDashboardData['recentRecallAlerts'],
    volumeRecallDiagnostics: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['volumeRecallDiagnostics'],
    recentWorldStateAlerts: [
      { chapterNum: 2, entityType: 'character', severity: 'warning' },
      { chapterNum: 11, entityType: 'character', severity: 'warning' },
    ] as QualityDashboardData['recentWorldStateAlerts'],
    volumeWorldStateStability: [{ volumeId: 1 }, { volumeId: 2 }] as QualityDashboardData['volumeWorldStateStability'],
    antiAiRecurrence: recurrence,
    feedbackRecurrence: feedback,
  }
}

describe('filterDashboardByVolume', () => {
  it('不选卷时原样返回所有切片', () => {
    const source = makeVolumeFilterSource()
    const filtered = filterDashboardByVolume(source, null)
    expect(filtered.chapterDetails).toBe(source.chapterDetails)
    expect(filtered.antiAiRecurrence).toBe(source.antiAiRecurrence)
    expect(filtered.feedbackRecurrence).toBe(source.feedbackRecurrence)
    expect(filtered.worldAlerts).toBe(source.recentWorldStateAlerts)
  })

  it('选卷后按 volumeId 与章号范围收窄各切片', () => {
    const source = makeVolumeFilterSource()
    const volume = makeVolume({ volumeId: 1, chapterStart: 1, chapterEnd: 10 })
    const filtered = filterDashboardByVolume(source, volume)

    expect(filtered.chapterDetails.map((entry) => entry.chapterNum)).toEqual([1, 2])
    expect(filtered.heatmapData.map((entry) => entry.chapterNum)).toEqual([1])
    expect(filtered.chapterGateTrend.map((entry) => entry.chapterNum)).toEqual([2])
    expect(filtered.chapterGateHeatmap.map((entry) => entry.chapterNum)).toEqual([2])
    expect(filtered.chapterGateAlerts.map((entry) => entry.chapterNum)).toEqual([2])
    expect(filtered.overallTrend.map((entry) => entry.chapterNum)).toEqual([1])
    expect(filtered.aiLikeTrend.map((entry) => entry.chapterNum)).toEqual([1])
    expect(filtered.languageVolumes.map((entry) => entry.volumeId)).toEqual([1])
    expect(filtered.storyVolumes.map((entry) => entry.volumeId)).toEqual([1])
    expect(filtered.chapterFunctionRuns.map((entry) => entry.startChapterNum)).toEqual([1])
    // 命中范围内章号 或 volumeId 匹配
    expect(filtered.chapterFunctionAlerts.map((entry) => entry.code)).toEqual(['a', 'c'])
    expect(filtered.chapterFunctionVolumes.map((entry) => entry.volumeId)).toEqual([1])
    expect(filtered.arcVolumes.map((entry) => entry.volumeId)).toEqual([1])
    expect(filtered.recallAlerts.map((entry) => entry.chapterNum)).toEqual([1])
    expect(filtered.recallVolumes.map((entry) => entry.volumeId)).toEqual([1])
    expect(filtered.worldAlerts.map((entry) => entry.chapterNum)).toEqual([2])
    expect(filtered.worldVolumes.map((entry) => entry.volumeId)).toEqual([1])
  })

  it('AI 味复现与审校复现按章号窗口和卷号收窄，摘要计数保持不变', () => {
    const source = makeVolumeFilterSource()
    const volume = makeVolume({ volumeId: 1, chapterStart: 1, chapterEnd: 10 })
    const filtered = filterDashboardByVolume(source, volume)

    expect(filtered.antiAiRecurrence.hitChapterCount).toBe(3)
    expect(filtered.antiAiRecurrence.recentAlerts.map((entry) => entry.ruleCode)).toEqual(['a'])
    expect(filtered.antiAiRecurrence.volumeEntries.map((entry) => entry.volumeId)).toEqual([1])

    expect(filtered.feedbackRecurrence.recentAlerts.map((entry) => entry.issueType)).toEqual(['x'])
    expect(filtered.feedbackRecurrence.humanization.topRepeatedIssues.map((entry) => entry.issueType)).toEqual(['h1'])
    expect(filtered.feedbackRecurrence.humanization.promotedIssues).toEqual([])
    expect(filtered.feedbackRecurrence.humanization.recentAlerts.map((entry) => entry.issueType)).toEqual(['h4'])
    expect(filtered.feedbackRecurrence.volumeEntries.map((entry) => entry.volumeId)).toEqual([1])
  })
})

describe('findChapterByNum', () => {
  it('命中返回章节详情，未命中返回 null', () => {
    const details = makeVolumeFilterSource().chapterDetails
    expect(findChapterByNum(details, 2)?.chapterId).toBe(12)
    expect(findChapterByNum(details, 99)).toBeNull()
  })
})
