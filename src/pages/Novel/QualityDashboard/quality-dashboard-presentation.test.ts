import { describe, expect, it } from 'vitest'
import type { LanguageDriftMetrics, QualityDashboardData } from '../../../types'
import {
  DEFAULT_QUALITY_FILTERS,
  applyQualityDashboardFilters,
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
  chapterNumsOverlapRange,
  filterDashboardByVolume,
  filterQualityRisks,
  filterSeverityAlerts,
  findChapterByNum,
  formatSignedValue,
  getTopLanguageDriftMetrics,
  getVisibleGateAlerts,
  hasActiveQualityFilters,
  isChapterInRange,
  matchesSeverityFilter,
  normalizeSeverityRank,
  qualityRiskCategory,
  quotePowerShellArg,
  scoreColor,
  summarizeChapterGateTrend,
  type QualityDashboardFilters,
  type QualityRiskEntry,
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

// ---------------------------------------------------------------------------
// 顶部筛选条
// ---------------------------------------------------------------------------

function makeFilters(partial: Partial<QualityDashboardFilters>): QualityDashboardFilters {
  return { ...DEFAULT_QUALITY_FILTERS, ...partial }
}

describe('hasActiveQualityFilters', () => {
  it('默认筛选视为未激活', () => {
    expect(hasActiveQualityFilters(DEFAULT_QUALITY_FILTERS)).toBe(false)
  })

  it('任一条件激活即返回 true', () => {
    expect(hasActiveQualityFilters(makeFilters({ chapterStart: 3 }))).toBe(true)
    expect(hasActiveQualityFilters(makeFilters({ chapterEnd: 9 }))).toBe(true)
    expect(hasActiveQualityFilters(makeFilters({ severity: 'high' }))).toBe(true)
    expect(hasActiveQualityFilters(makeFilters({ category: 'language' }))).toBe(true)
  })
})

describe('normalizeSeverityRank / matchesSeverityFilter', () => {
  it('把各处口径归一到高/中/低', () => {
    expect(normalizeSeverityRank('critical')).toBe('high')
    expect(normalizeSeverityRank('blocker')).toBe('high')
    expect(normalizeSeverityRank('warning')).toBe('medium')
    expect(normalizeSeverityRank('info')).toBe('low')
    expect(normalizeSeverityRank('unknown-word')).toBeNull()
    expect(normalizeSeverityRank(undefined)).toBeNull()
  })

  it('未知口径的条目保守保留', () => {
    expect(matchesSeverityFilter('unknown-word', 'high')).toBe(true)
    expect(matchesSeverityFilter('critical', 'high')).toBe(true)
    expect(matchesSeverityFilter('warning', 'high')).toBe(false)
    expect(matchesSeverityFilter('warning', 'all')).toBe(true)
  })
})

describe('isChapterInRange / chapterNumsOverlapRange', () => {
  it('按起止章号裁剪，无章号条目保留', () => {
    const filters = makeFilters({ chapterStart: 3, chapterEnd: 5 })
    expect(isChapterInRange(2, filters)).toBe(false)
    expect(isChapterInRange(3, filters)).toBe(true)
    expect(isChapterInRange(5, filters)).toBe(true)
    expect(isChapterInRange(6, filters)).toBe(false)
    expect(isChapterInRange(undefined, filters)).toBe(true)
  })

  it('只填起点或终点时按单边裁剪', () => {
    expect(isChapterInRange(9, makeFilters({ chapterStart: 10 }))).toBe(false)
    expect(isChapterInRange(9, makeFilters({ chapterEnd: 8 }))).toBe(false)
  })

  it('章号集合按交集判断，空集合保留', () => {
    const filters = makeFilters({ chapterStart: 3, chapterEnd: 5 })
    expect(chapterNumsOverlapRange([1, 4], filters)).toBe(true)
    expect(chapterNumsOverlapRange([1, 2], filters)).toBe(false)
    expect(chapterNumsOverlapRange([], filters)).toBe(true)
    expect(chapterNumsOverlapRange(undefined, filters)).toBe(true)
  })
})

describe('qualityRiskCategory', () => {
  it('把风险类型映射到 Tab 维度', () => {
    expect(qualityRiskCategory('language_drift')).toBe('language')
    expect(qualityRiskCategory('dialogue_separability')).toBe('language')
    expect(qualityRiskCategory('story_arc')).toBe('structure')
    expect(qualityRiskCategory('endgame_debt')).toBe('structure')
    expect(qualityRiskCategory('recall')).toBe('stability')
    expect(qualityRiskCategory('world_state')).toBe('stability')
    expect(qualityRiskCategory('typed_ref_coverage')).toBe('overview')
  })
})

describe('filterQualityRisks', () => {
  const risks = [
    { kind: 'language_drift', severity: 'high', chapterNums: [3] },
    { kind: 'story_arc', severity: 'medium', chapterNums: [12] },
    { kind: 'recall', severity: 'high', chapterNums: [] },
  ] as unknown as QualityRiskEntry[]

  it('按严重度过滤', () => {
    const result = filterQualityRisks(risks, makeFilters({ severity: 'high' }))
    expect(result.map((risk) => risk.kind)).toEqual(['language_drift', 'recall'])
  })

  it('按指标类别过滤', () => {
    const result = filterQualityRisks(risks, makeFilters({ category: 'structure' }))
    expect(result.map((risk) => risk.kind)).toEqual(['story_arc'])
  })

  it('按章节范围过滤，未绑定章节的风险保留', () => {
    const result = filterQualityRisks(risks, makeFilters({ chapterStart: 1, chapterEnd: 10 }))
    expect(result.map((risk) => risk.kind)).toEqual(['language_drift', 'recall'])
  })
})

describe('filterSeverityAlerts', () => {
  it('全部严重度时原样返回', () => {
    const alerts = [{ severity: 'warning' }, { severity: 'critical' }]
    expect(filterSeverityAlerts(alerts, DEFAULT_QUALITY_FILTERS)).toBe(alerts)
  })

  it('按归一后的严重度过滤', () => {
    const alerts = [{ severity: 'warning' }, { severity: 'critical' }, {}]
    expect(filterSeverityAlerts(alerts, makeFilters({ severity: 'high' }))).toEqual([{ severity: 'critical' }, {}])
  })
})

describe('applyQualityDashboardFilters', () => {
  it('未激活筛选时原样返回同一引用', () => {
    const view = filterDashboardByVolume(makeVolumeFilterSource(), null)
    expect(applyQualityDashboardFilters(view, DEFAULT_QUALITY_FILTERS)).toBe(view)
  })

  it('按章节范围收窄各切片', () => {
    const view = filterDashboardByVolume(makeVolumeFilterSource(), null)
    const filters = makeFilters({ chapterStart: 1, chapterEnd: 10 })
    const result = applyQualityDashboardFilters(view, filters)
    expect(result.chapterDetails.map((entry) => entry.chapterNum)).toEqual([1, 2])
    expect(result.heatmapData.map((entry) => entry.chapterNum)).toEqual([1])
    expect(result.chapterGateTrend.map((entry) => entry.chapterNum)).toEqual([2])
    expect(result.chapterGateAlerts.map((entry) => entry.chapterNum)).toEqual([2])
    expect(result.overallTrend.map((entry) => entry.chapterNum)).toEqual([1])
    expect(result.chapterFunctionRuns.map((entry) => entry.startChapterNum)).toEqual([1])
    expect(result.recallAlerts.map((entry) => entry.chapterNum)).toEqual([1])
    expect(result.worldAlerts.map((entry) => entry.chapterNum)).toEqual([2])
    expect(result.antiAiRecurrence.recentAlerts.map((entry) => entry.ruleCode)).toEqual(['a'])
    expect(result.feedbackRecurrence.humanization.topRepeatedIssues.map((entry) => entry.issueType)).toEqual(['h1'])
    // 卷级聚合切片不受章节范围影响
    expect(result.languageVolumes).toBe(view.languageVolumes)
  })

  it('按严重度收窄带 severity 字段的告警', () => {
    const source = makeVolumeFilterSource()
    source.recentWorldStateAlerts = [
      { chapterNum: 2, entityType: 'character', severity: 'critical' },
      { chapterNum: 3, entityType: 'character', severity: 'warning' },
    ] as QualityDashboardData['recentWorldStateAlerts']
    const view = filterDashboardByVolume(source, null)
    const result = applyQualityDashboardFilters(view, makeFilters({ severity: 'high' }))
    expect(result.worldAlerts.map((entry) => entry.chapterNum)).toEqual([2])
  })
})
