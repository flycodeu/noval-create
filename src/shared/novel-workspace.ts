import type { Chapter, ChapterPublishCheck, Novel, QualityDashboardData } from '../types'
import type { WorkflowStats } from './workflow-stats'
import { getAssetBloatSignal } from './workflow-stats'
import { parseProjectBriefSnapshot } from './project-brief'
import { parseStorySettingsSnapshot } from './story-settings'
import { parseThemeVoiceSnapshot } from './theme-voice'
import { parseWorldRulesJson } from './genre-system'
import { getWorkspaceViewModeForNovel } from './operating-mode'
import {
  formatProgress,
  getModuleStatus,
  type ModuleProgress,
  type ModuleStatus,
  type NextStep,
  type ProjectBlocker,
  type WorkspaceNavGroup,
  type WorkspaceNavItem,
} from './workspace-types'

export type WorkspaceViewMode = 'quick' | 'professional'

export type WorkspaceRouteKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'world-rules'
  | 'endgame'
  | 'map'
  | 'factions'
  | 'characters'
  | 'arc-center'
  | 'resistance'
  | 'items'
  | 'glossary'
  | 'scene-templates'
  | 'threads'
  | 'story-design'
  | 'outline'
  | 'volume-design'
  | 'structure'
  | 'timeline'
  | 'info-gap-board'
  | 'foreshadow-ledger'
  | 'growth-system'
  | 'contracts'
  | 'writing'
  | 'writeback'
  | 'revision'
  | 'quality'
  | 'batch-workbench'

export type WorkspaceGroupKey =
  | 'project-status'
  | 'foundation'
  | 'world-building'
  | 'cast-factions'
  | 'plot-architecture'
  | 'volume-outline'
  | 'chapter-production'
  | 'quality-control'

export interface WorkspaceModuleDefinition {
  key: Exclude<WorkspaceRouteKey, 'guide'>
  label: string
  description: string
  groupKey: Exclude<WorkspaceGroupKey, 'project-status'>
  groupTitle: string
  quickMode: boolean
}

export interface WorkspaceModuleSnapshot extends ModuleProgress {
  key: Exclude<WorkspaceRouteKey, 'guide'>
  label: string
  description: string
  groupKey: Exclude<WorkspaceGroupKey, 'project-status'>
  groupTitle: string
  route: string
  progressText: string
  blockerCount: number
}

export interface WorkspaceGroupSnapshot {
  key: WorkspaceGroupKey
  title: string
  route: string
  modules: WorkspaceModuleSnapshot[]
  completedCount: number
  totalCount: number
  blockerCount: number
  status: ModuleStatus
}

export interface WorkspaceReadinessMetric {
  key: string
  label: string
  score: number
  summary: string
}

export interface WorkspaceReadinessSummary {
  score: number
  label: string
  metrics: WorkspaceReadinessMetric[]
}

export interface WorkspaceStageSummary {
  key: WorkspaceGroupKey
  label: string
  description: string
  route: string
}

export interface WorkspaceSnapshot {
  viewMode: WorkspaceViewMode
  modules: WorkspaceModuleSnapshot[]
  moduleMap: Record<WorkspaceModuleSnapshot['key'], WorkspaceModuleSnapshot>
  groups: WorkspaceGroupSnapshot[]
  blockers: ProjectBlocker[]
  nextStep: NextStep
  readiness: WorkspaceReadinessSummary
  stage: WorkspaceStageSummary
  moduleDoneCount: number
  moduleTotalCount: number
  navGroups: WorkspaceNavGroup[]
}

export interface ChapterWritabilityCheck {
  key: string
  label: string
  ready: boolean
  detail: string
  required: boolean
}

export interface ChapterWritabilitySummary {
  ready: boolean
  score: number
  label: '高' | '中' | '低' | '阻塞'
  summary: string
  risks: string[]
  suggestions: string[]
  checks: ChapterWritabilityCheck[]
}

export type QualitySummary = Pick<QualityDashboardData, 'productionReadiness' | 'batchHealth' | 'continuityHealth'> | null | undefined

export const WORKSPACE_MODULE_DEFINITIONS: WorkspaceModuleDefinition[] = [
  { key: 'overview', label: '项目总览', description: '书名、简介、背景和目标字数。', groupKey: 'foundation', groupTitle: '项目底盘', quickMode: true },
  { key: 'project-brief', label: '项目 Brief', description: '读者承诺、赛道、卖点和禁区。', groupKey: 'foundation', groupTitle: '项目底盘', quickMode: true },
  { key: 'core-settings', label: '故事底盘', description: '主角起点、核心钩子与底层约束。', groupKey: 'foundation', groupTitle: '项目底盘', quickMode: true },
  { key: 'theme-voice', label: '主题文风', description: '主题、情绪核心、视角和对白边界。', groupKey: 'foundation', groupTitle: '项目底盘', quickMode: true },
  { key: 'world-rules', label: '世界规则', description: '时间制度、力量边界与世界口径。', groupKey: 'world-building', groupTitle: '世界与地点', quickMode: true },
  { key: 'map', label: '地点场景', description: '地点层级、活动半径与事件发生地。', groupKey: 'world-building', groupTitle: '世界与地点', quickMode: true },
  { key: 'items', label: '物品线索', description: '资源流通、道具证据和争夺物。', groupKey: 'world-building', groupTitle: '世界与地点', quickMode: true },
  { key: 'glossary', label: '设定词典', description: '名词、术语和标准口径。', groupKey: 'world-building', groupTitle: '世界与地点', quickMode: false },
  { key: 'scene-templates', label: '场景模板', description: '可复用场景结构与检查项。', groupKey: 'world-building', groupTitle: '世界与地点', quickMode: false },
  { key: 'characters', label: '人物档案', description: '主角、功能位、人物弧和关系网。', groupKey: 'cast-factions', groupTitle: '人物与阵营', quickMode: true },
  { key: 'arc-center', label: '人物弧线', description: '角色变化、关系位移和代价。', groupKey: 'cast-factions', groupTitle: '人物与阵营', quickMode: false },
  { key: 'resistance', label: '阻力系统', description: '对手、环境、制度和关系压力。', groupKey: 'cast-factions', groupTitle: '人物与阵营', quickMode: true },
  { key: 'factions', label: '阵营组织', description: '组织、阵营与对立结构。', groupKey: 'cast-factions', groupTitle: '人物与阵营', quickMode: false },
  { key: 'story-design', label: '主线骨架', description: '主线目标、核心冲突与结局方向。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: true },
  { key: 'threads', label: '剧情线程', description: '主线、支线、伏笔与关系推进。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: true },
  { key: 'endgame', label: '终局承诺', description: '最终冲突、兑现清单与最后一幕。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: false },
  { key: 'info-gap-board', label: '信息差', description: '真相揭示、读者信息差与谜题控制。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: false },
  { key: 'foreshadow-ledger', label: '伏笔账本', description: '伏笔埋设、到期与回收。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: false },
  { key: 'growth-system', label: '成长/代价', description: '能力成长与资源消耗曲线。', groupKey: 'plot-architecture', groupTitle: '剧情与伏笔', quickMode: false },
  { key: 'volume-design', label: '卷级设计', description: '每卷目标、卷末爆点和阶段代价。', groupKey: 'volume-outline', groupTitle: '卷章大纲', quickMode: true },
  { key: 'outline', label: '故事大纲', description: '故事弧、章节承接和推进骨架。', groupKey: 'volume-outline', groupTitle: '卷章大纲', quickMode: true },
  { key: 'structure', label: '卷章结构', description: '卷、部、章与场景节奏拆分。', groupKey: 'volume-outline', groupTitle: '卷章大纲', quickMode: false },
  { key: 'timeline', label: '事件时间轴', description: '事件先后、因果锚点与状态变化。', groupKey: 'volume-outline', groupTitle: '卷章大纲', quickMode: true },
  { key: 'contracts', label: '章节合同', description: '章节目标、场景合同与验收标准。', groupKey: 'chapter-production', groupTitle: '正文生产', quickMode: true },
  { key: 'writing', label: '正文写作', description: '章节生产台、流水线与正文编辑。', groupKey: 'chapter-production', groupTitle: '正文生产', quickMode: true },
  { key: 'writeback', label: '章后回写', description: '事实抽取、状态回写与 Canon 确认。', groupKey: 'chapter-production', groupTitle: '正文生产', quickMode: true },
  { key: 'batch-workbench', label: '批次回滚', description: '流水线失败恢复与重放。', groupKey: 'chapter-production', groupTitle: '正文生产', quickMode: false },
  { key: 'revision', label: '修订中心', description: '质量问题、修订任务与修复入口。', groupKey: 'quality-control', groupTitle: '回写质检', quickMode: true },
  { key: 'quality', label: '质量监控', description: '生产总灯、连续性与风险趋势。', groupKey: 'quality-control', groupTitle: '回写质检', quickMode: true },
]

const GROUP_ROUTE_MAP: Record<WorkspaceGroupKey, string> = {
  'project-status': 'guide',
  foundation: 'overview',
  'world-building': 'world-rules',
  'cast-factions': 'characters',
  'plot-architecture': 'story-design',
  'volume-outline': 'volume-design',
  'chapter-production': 'writing/editor',
  'quality-control': 'revision',
}

const MODE_VISIBLE_KEYS: Record<WorkspaceViewMode, Set<WorkspaceModuleDefinition['key']>> = {
  professional: new Set(WORKSPACE_MODULE_DEFINITIONS.map((item) => item.key)),
  quick: new Set(WORKSPACE_MODULE_DEFINITIONS.filter((item) => item.quickMode).map((item) => item.key)),
}

export const ALL_WORKSPACE_ROUTE_KEYS: WorkspaceRouteKey[] = [
  'guide',
  ...WORKSPACE_MODULE_DEFINITIONS.map((item) => item.key),
]

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value))
}

function countTruthy(values: unknown[]) {
  return values.filter(Boolean).length
}

function completionFromProgress(progress: ModuleProgress) {
  return progress.status === 'ready' || progress.status === 'done'
}

function buildRoute(targetPage: string) {
  if (targetPage === 'writing') return 'writing/editor'
  return targetPage
}

function finalizeProgress(progress: ModuleProgress): ModuleProgress {
  return {
    ...progress,
    requiredDone: Math.min(progress.requiredDone, progress.requiredTotal),
    optionalDone: Math.min(progress.optionalDone, progress.optionalTotal),
    status: getModuleStatus(progress),
  }
}

function buildProgress(
  moduleKey: string,
  input: Omit<ModuleProgress, 'moduleKey'>,
): ModuleProgress {
  return finalizeProgress({
    moduleKey,
    requiredTotal: input.requiredTotal,
    requiredDone: input.requiredDone,
    optionalTotal: input.optionalTotal,
    optionalDone: input.optionalDone,
    status: input.status,
    blockers: input.blockers,
  })
}

function createBlocker(
  id: string,
  level: ProjectBlocker['level'],
  title: string,
  reason: string,
  affectedModules: string[],
  targetPage: string,
  label: string,
  actionType: ProjectBlocker['suggestedAction']['actionType'] = 'open_page',
  canIgnoreOnce = false,
): ProjectBlocker {
  return {
    id,
    level,
    title,
    reason,
    affectedModules,
    suggestedAction: {
      label,
      targetPage,
      actionType,
    },
    canIgnoreOnce,
    createdAt: new Date().toISOString(),
  }
}

function storySettingsSignals(novel: Novel | null | undefined) {
  const projectBrief = parseProjectBriefSnapshot(novel?.projectBriefJson)
  const storySettings = parseStorySettingsSnapshot(novel?.settingsJson)
  const themeVoice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  const worldRules = parseWorldRulesJson(novel?.worldRulesJson, novel?.genreName)

  return {
    projectBrief,
    storySettings,
    themeVoice,
    worldRules,
  }
}

function buildBaseProgressMap(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  qualitySummary?: QualitySummary,
): Record<WorkspaceModuleDefinition['key'], ModuleProgress> {
  const basicsRequired = countTruthy([
    novel?.title?.trim(),
    novel?.synopsis?.trim(),
    novel?.userBackground?.trim(),
    novel?.expandedBackground?.trim(),
  ])
  const basicsOptional = countTruthy([
    typeof novel?.targetWords === 'number' && novel.targetWords > 0,
    novel?.blurbJson?.trim(),
  ])
  const { projectBrief, storySettings, themeVoice, worldRules } = storySettingsSignals(novel)
  const endgameRequired = countTruthy([
    storySettings.endgameDesign.endingMode,
    storySettings.endgameDesign.finalConflict,
    storySettings.endgameDesign.themeAnswer,
    storySettings.endgameDesign.mustDeliverPromises,
    storySettings.endgameDesign.lastScene,
  ])
  const endgameOptional = countTruthy([
    storySettings.endgameDesign.payoffChecklist,
    storySettings.endgameDesign.deliberateUnknowns,
    storySettings.endgameDesign.finalImage,
  ])
  const storyDesignRequired = countTruthy([
    storySettings.storyGoal,
    storySettings.coreConflict,
    storySettings.mainPlot,
    storySettings.ending,
  ])
  const storyDesignOptional = countTruthy([
    storySettings.storyDesign.subPlotsList?.length,
    storySettings.storyDesign.rhythmSetup,
    storySettings.storyDesign.rhythmConflict,
    storySettings.storyDesign.rhythmEnding,
  ])
  const worldOptional = countTruthy([
    worldRules.mapBlueprint.overview,
    worldRules.factionSystem.length > 0,
    worldRules.speciesSystem.length > 0,
    (worldRules as { powerSystem?: { name?: string } }).powerSystem?.name,
  ])
  const hasArcCoverage = stats.characterArcCount > 0 || stats.relationshipArcCount > 0
  const chapterConstraintRequired = countTruthy([
    stats.outlineCount > 0,
    stats.volumeCount > 0,
    stats.threadCount > 0,
    stats.timelineCount > 0,
    hasArcCoverage,
    stats.resistanceTrackCount > 0,
  ])
  const chapterConstraintOptional = countTruthy([
    stats.chapterCount > 0,
    stats.sceneTemplateCount > 0,
  ])
  const chapterConstraintBlockerMessages = [
    stats.outlineCount <= 0 ? '缺少故事大纲，章节合同没有可执行骨架。' : '',
    stats.volumeCount <= 0 ? '缺少卷级/结构规划，章节目标无法归入长篇节奏。' : '',
    stats.threadCount <= 0 ? '缺少故事线程，章节合同无法确认必须推进的线。' : '',
    stats.timelineCount <= 0 ? '缺少时间轴锚点，章节合同无法确认时间地点。' : '',
    !hasArcCoverage ? '缺少人物弧线或关系弧，章节合同无法确认人物变化。' : '',
    stats.resistanceTrackCount <= 0 ? '缺少反派与阻力轨道，章节合同无法确认外部压力。' : '',
  ].filter(Boolean)
  const chapterConstraintBlockers = chapterConstraintBlockerMessages.map((reason, index) => createBlocker(
    `contract-closure-${index}`,
    'medium',
    '章节合同未闭环',
    reason,
    ['章节合同', '正文写作'],
    'contracts',
    '补章节合同',
  ))
  const writingRequired = countTruthy([
    stats.chapterCount > 0,
    stats.outlineCount > 0,
    stats.volumeCount > 0,
    stats.threadCount > 0,
    stats.timelineCount > 0,
    hasArcCoverage,
    stats.resistanceTrackCount > 0,
    stats.revisionBlockerCount <= 0,
    stats.staleChapterCount <= 0,
    stats.staleAssetCount <= 0 && stats.staleCheckpointCount <= 0,
  ])
  const writingBlockerMessages = [
    stats.chapterCount <= 0 ? '缺少可写章节，请先完成结构拆分。' : '',
    stats.outlineCount <= 0 ? '缺少故事大纲，正文生成没有章节承接。' : '',
    stats.volumeCount <= 0 ? '缺少卷级规划，正文生成没有长篇节奏约束。' : '',
    stats.threadCount <= 0 ? '缺少故事线程，正文生成无法稳定推进主线/支线。' : '',
    stats.timelineCount <= 0 ? '缺少时间轴，正文生成无法锁定时间地点与因果。' : '',
    !hasArcCoverage ? '缺少人物弧线或关系弧，正文生成容易变成人物平铺。' : '',
    stats.resistanceTrackCount <= 0 ? '缺少反派与阻力轨道，正文生成缺少有效对抗。' : '',
    stats.revisionBlockerCount > 0 ? `仍有 ${stats.revisionBlockerCount} 个高优先修订问题未处理。` : '',
    stats.staleChapterCount > 0 ? `仍有 ${stats.staleChapterCount} 章引用旧上下文。` : '',
    stats.staleAssetCount > 0 || stats.staleCheckpointCount > 0 ? '仍有资产或长期记忆检查点待同步。' : '',
  ].filter(Boolean)
  const writingBlockers = writingBlockerMessages.map((reason, index) => createBlocker(
    `writing-closure-${index}`,
    index <= 6 ? 'high' : 'medium',
    '正文生成前置条件不足',
    reason,
    ['正文写作', '章节合同'],
    'writing/editor',
    '查看写作缺口',
  ))
  const writingOptional = countTruthy([
    stats.chapterCount > 0,
    stats.totalWords > 0,
  ])
  const writebackOptional = countTruthy([
    (qualitySummary?.productionReadiness.writebackPendingCount || 0) <= 0,
    (qualitySummary?.productionReadiness.writebackFailedCount || 0) <= 0,
  ])

  return {
    overview: buildProgress('overview', {
      requiredTotal: 4,
      requiredDone: basicsRequired,
      optionalTotal: 2,
      optionalDone: basicsOptional,
      status: basicsRequired >= 4 ? (basicsOptional >= 2 ? 'done' : 'ready') : basicsRequired > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    'project-brief': buildProgress('project-brief', {
      requiredTotal: 4,
      requiredDone: Math.min(projectBrief.readyCount, 4),
      optionalTotal: 2,
      optionalDone: Math.max(0, Math.min(projectBrief.readyCount - 4, 2)),
      status: projectBrief.readyCount >= 4 ? (projectBrief.readyCount >= 6 ? 'done' : 'ready') : projectBrief.readyCount > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    'core-settings': buildProgress('core-settings', {
      requiredTotal: 4,
      requiredDone: Math.min(storySettings.premiseReadyCount, 4),
      optionalTotal: 1,
      optionalDone: Math.max(0, Math.min(storySettings.premiseReadyCount - 4, 1)),
      status: storySettings.premiseReadyCount >= 4 ? (storySettings.premiseReadyCount >= 5 ? 'done' : 'ready') : storySettings.premiseReadyCount > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    'theme-voice': buildProgress('theme-voice', {
      requiredTotal: 4,
      requiredDone: Math.min(themeVoice.readyCount, 4),
      optionalTotal: 2,
      optionalDone: Math.max(0, Math.min(themeVoice.readyCount - 4, 2)),
      status: themeVoice.readyCount >= 4 ? (themeVoice.readyCount >= 6 ? 'done' : 'ready') : themeVoice.readyCount > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    'world-rules': buildProgress('world-rules', {
      requiredTotal: 1,
      requiredDone: novel?.worldRulesJson ? 1 : 0,
      optionalTotal: 4,
      optionalDone: worldOptional,
      status: novel?.worldRulesJson ? (worldOptional >= 3 ? 'ready' : 'draft') : 'not_started',
      blockers: [],
    }),
    endgame: buildProgress('endgame', {
      requiredTotal: 5,
      requiredDone: endgameRequired,
      optionalTotal: 3,
      optionalDone: endgameOptional,
      status: endgameRequired >= 5 ? (endgameOptional >= 3 ? 'done' : 'ready') : endgameRequired > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    map: buildProgress('map', {
      requiredTotal: 1,
      requiredDone: stats.mapCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(stats.mapCount, 4),
      status: stats.mapCount > 0 ? (stats.mapCount >= 4 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    factions: buildProgress('factions', {
      requiredTotal: 1,
      requiredDone: stats.factionCount > 0 ? 1 : 0,
      optionalTotal: 3,
      optionalDone: Math.min(stats.factionCount, 3),
      status: stats.factionCount > 0 ? (stats.factionCount >= 3 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    characters: buildProgress('characters', {
      requiredTotal: 2,
      requiredDone: countTruthy([stats.hasProtagonist, stats.characterCount > 0]),
      optionalTotal: 4,
      optionalDone: Math.min(Math.ceil(stats.characterCount / 3), 4),
      status: stats.characterCount <= 0 && !stats.hasProtagonist
        ? 'not_started'
        : stats.characterCount > 0 && stats.hasProtagonist
          ? (stats.characterCount >= 8 ? 'done' : 'ready')
          : 'draft',
      blockers: [],
    }),
    items: buildProgress('items', {
      requiredTotal: 1,
      requiredDone: stats.itemCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(stats.itemCount, 4),
      status: stats.itemCount > 0 ? (stats.itemCount >= 4 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    glossary: buildProgress('glossary', {
      requiredTotal: 1,
      requiredDone: stats.glossaryCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(stats.glossaryCount, 4),
      status: stats.glossaryCount > 0 ? (stats.glossaryCount >= 4 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    'scene-templates': buildProgress('scene-templates', {
      requiredTotal: 1,
      requiredDone: stats.sceneTemplateCount > 0 ? 1 : 0,
      optionalTotal: 3,
      optionalDone: Math.min(stats.sceneTemplateCount, 3),
      status: stats.sceneTemplateCount > 0 ? (stats.sceneTemplateCount >= 3 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    threads: buildProgress('threads', {
      requiredTotal: 1,
      requiredDone: stats.threadCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(Math.ceil(stats.threadCount / 2), 4),
      status: stats.threadCount > 0 ? (stats.threadCount >= 6 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    'story-design': buildProgress('story-design', {
      requiredTotal: 4,
      requiredDone: storyDesignRequired,
      optionalTotal: 4,
      optionalDone: storyDesignOptional,
      status: storyDesignRequired >= 4 ? (storyDesignOptional >= 3 ? 'done' : 'ready') : storyDesignRequired > 0 ? 'draft' : 'not_started',
      blockers: [],
    }),
    outline: buildProgress('outline', {
      requiredTotal: 1,
      requiredDone: stats.outlineCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(stats.outlineCount, 4),
      status: stats.outlineCount > 0 ? (stats.outlineCount >= 4 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    'volume-design': buildProgress('volume-design', {
      requiredTotal: 1,
      requiredDone: stats.volumeCount > 0 ? 1 : 0,
      optionalTotal: 3,
      optionalDone: Math.min(stats.volumeCount, 3),
      status: stats.volumeCount > 0 ? (stats.volumeCount >= 3 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    structure: buildProgress('structure', {
      requiredTotal: 1,
      requiredDone: stats.volumeCount > 0 ? 1 : 0,
      optionalTotal: 3,
      optionalDone: Math.min(stats.outlineCount + stats.volumeCount, 3),
      status: stats.volumeCount > 0 ? (stats.outlineCount > 0 ? 'ready' : 'draft') : 'not_started',
      blockers: [],
    }),
    timeline: buildProgress('timeline', {
      requiredTotal: 1,
      requiredDone: stats.timelineCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(Math.ceil(stats.timelineCount / 3), 4),
      status: stats.timelineCount > 0 ? (stats.timelineCount >= 12 ? 'done' : 'ready') : 'not_started',
      blockers: [],
    }),
    'info-gap-board': buildProgress('info-gap-board', {
      requiredTotal: 1,
      requiredDone: stats.volumeCount > 0 ? 1 : 0,
      optionalTotal: 2,
      optionalDone: stats.chapterCount > 0 ? 1 : 0,
      status: stats.volumeCount > 0 ? (stats.chapterCount > 0 ? 'ready' : 'draft') : 'not_started',
      blockers: [],
    }),
    'foreshadow-ledger': buildProgress('foreshadow-ledger', {
      requiredTotal: 1,
      requiredDone: stats.chapterCount > 0 ? 1 : 0,
      optionalTotal: 2,
      optionalDone: stats.threadCount > 0 ? 1 : 0,
      status: stats.chapterCount > 0 ? (stats.threadCount > 0 ? 'ready' : 'draft') : 'not_started',
      blockers: [],
    }),
    'growth-system': buildProgress('growth-system', {
      requiredTotal: 1,
      requiredDone: stats.chapterCount > 0 ? 1 : 0,
      optionalTotal: 2,
      optionalDone: stats.timelineCount > 0 ? 1 : 0,
      status: stats.chapterCount > 0 ? (stats.timelineCount > 0 ? 'ready' : 'draft') : 'not_started',
      blockers: [],
    }),
    'arc-center': buildProgress('arc-center', {
      requiredTotal: 1,
      requiredDone: stats.characterArcCount > 0 || stats.relationshipArcCount > 0 ? 1 : 0,
      optionalTotal: 4,
      optionalDone: Math.min(stats.characterArcCount + stats.relationshipArcCount, 4),
      status: stats.characterArcCount > 0 || stats.relationshipArcCount > 0 ? 'ready' : 'not_started',
      blockers: [],
    }),
    resistance: buildProgress('resistance', {
      requiredTotal: 1,
      requiredDone: stats.resistanceTrackCount > 0 ? 1 : 0,
      optionalTotal: 3,
      optionalDone: Math.min(stats.resistanceTrackCount, 3),
      status: stats.resistanceTrackCount > 0 ? 'ready' : 'not_started',
      blockers: [],
    }),
    contracts: buildProgress('contracts', {
      requiredTotal: 6,
      requiredDone: chapterConstraintRequired,
      optionalTotal: 2,
      optionalDone: chapterConstraintOptional,
      status: chapterConstraintRequired >= 6 ? (chapterConstraintOptional >= 1 ? 'ready' : 'draft') : chapterConstraintRequired > 0 ? 'draft' : 'not_started',
      blockers: chapterConstraintBlockers,
    }),
    writing: buildProgress('writing', {
      requiredTotal: 10,
      requiredDone: writingRequired,
      optionalTotal: 2,
      optionalDone: writingOptional,
      status: writingRequired >= 10
        ? (stats.chapterCount > 0 || stats.totalWords > 0 ? 'done' : 'ready')
        : writingRequired >= 5
          ? 'draft'
          : 'not_started',
      blockers: writingBlockers,
    }),
    writeback: buildProgress('writeback', {
      requiredTotal: 1,
      requiredDone: stats.chapterCount > 0 ? 1 : 0,
      optionalTotal: 2,
      optionalDone: writebackOptional,
      status: stats.chapterCount > 0 ? (writebackOptional >= 2 ? 'ready' : 'warning') : 'not_started',
      blockers: [],
    }),
    'batch-workbench': buildProgress('batch-workbench', {
      requiredTotal: 1,
      requiredDone: stats.chapterCount > 0 ? 1 : 0,
      optionalTotal: 1,
      optionalDone: stats.totalWords > 0 ? 1 : 0,
      status: stats.chapterCount > 0 ? 'ready' : 'not_started',
      blockers: [],
    }),
    revision: buildProgress('revision', {
      requiredTotal: 1,
      requiredDone: stats.revisionTaskCount <= 0 && stats.revisionBlockerCount <= 0 ? 1 : 0,
      optionalTotal: 1,
      optionalDone: stats.revisionBlockerCount <= 0 ? 1 : 0,
      status: stats.revisionBlockerCount > 0 ? 'blocked' : stats.revisionTaskCount > 0 ? 'warning' : 'done',
      blockers: [],
    }),
    quality: buildProgress('quality', {
      requiredTotal: 1,
      requiredDone: 1,
      optionalTotal: 2,
      optionalDone: countTruthy([
        qualitySummary?.productionReadiness.status === 'ready',
        qualitySummary?.continuityHealth.staleCheckpointCount === 0,
      ]),
      status: qualitySummary?.productionReadiness.status === 'blocked' ? 'warning' : 'ready',
      blockers: [],
    }),
  }
}

export function resolveWorkspaceMode(
  novel: Pick<Novel, 'launchMode' | 'operatingMode' | 'targetWords' | 'settingsJson'> | null | undefined,
  preferredMode?: WorkspaceViewMode,
): WorkspaceViewMode {
  if (preferredMode) return preferredMode
  return getWorkspaceViewModeForNovel(novel)
}

export function getProjectBlockers(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  qualitySummary?: QualitySummary,
): ProjectBlocker[] {
  const blockers: ProjectBlocker[] = []
  const assetBloat = getAssetBloatSignal(stats)

  if (stats.revisionBlockerCount > 0) {
    blockers.push(createBlocker(
      'revision-blockers',
      'fatal',
      '高优先级修订问题未清理',
      `当前仍有 ${stats.revisionBlockerCount} 个 blocker 级修订问题，继续推进会扩大返工范围。`,
      ['修订中心', '正文写作', '章后回写'],
      'revision',
      '处理 blocker',
    ))
  }

  if (stats.staleChapterCount > 0) {
    blockers.push(createBlocker(
      'stale-chapters',
      'high',
      '已有章节仍引用旧上下文',
      `当前有 ${stats.staleChapterCount} 章待同步，章节合同、正文写作和章后回写都会继续引用旧事实。`,
      ['章节合同', '正文写作', '章后回写'],
      'writeback',
      '查看影响章节',
    ))
  }

  if (stats.staleAssetCount > 0) {
    blockers.push(createBlocker(
      'stale-assets',
      'high',
      '世界资产仍挂着旧设定',
      stats.staleAssetLabels.length > 0
        ? `这些资产待校准：${stats.staleAssetLabels.join('、')}。不处理会继续污染正文与回写。`
        : `当前有 ${stats.staleAssetCount} 类资产待校准，继续生成会污染后续上下文。`,
      ['世界规则', '故事结构', '正文写作'],
      'revision',
      '处理资产同步',
      'auto_fix',
    ))
  }

  if (stats.staleCheckpointCount > 0) {
    blockers.push(createBlocker(
      'stale-checkpoints',
      'medium',
      '长期记忆检查点待刷新',
      `当前有 ${stats.staleCheckpointCount} 份检查点未刷新，AI 召回仍可能读取旧长程记忆。`,
      ['正文写作', '质量监控'],
      'quality',
      '查看连续性风险',
      'open_page',
      true,
    ))
  }

  if ((qualitySummary?.productionReadiness.writebackFailedCount || 0) > 0) {
    blockers.push(createBlocker(
      'writeback-failed',
      'high',
      '章后回写存在失败记录',
      `当前有 ${qualitySummary?.productionReadiness.writebackFailedCount || 0} 章回写失败，资产总账没有闭环。`,
      ['章后回写', '质量监控'],
      'writeback',
      '修复回写失败',
    ))
  }

  if ((qualitySummary?.productionReadiness.writebackPendingCount || 0) > 0) {
    blockers.push(createBlocker(
      'writeback-pending',
      'medium',
      '章后回写仍未闭环',
      `当前有 ${qualitySummary?.productionReadiness.writebackPendingCount || 0} 章还未确认写回，角色、伏笔与时间轴状态可能滞后。`,
      ['章后回写', '正文写作'],
      'writeback',
      '处理回写积压',
      'open_page',
      true,
    ))
  }

  if ((qualitySummary?.productionReadiness.aiRecurrenceHighRiskCount || 0) > 0) {
    blockers.push(createBlocker(
      'quality-recurrence-risk',
      'high',
      '质量监控发现高复发风险',
      `当前有 ${qualitySummary?.productionReadiness.aiRecurrenceHighRiskCount || 0} 项高复发问题，继续推进新章节会放大修订成本。`,
      ['修订中心', '质量监控', '正文写作'],
      'revision',
      '处理修订任务',
      'open_page',
    ))
  }

  if (!novel?.worldRulesJson && (stats.chapterCount > 0 || stats.totalWords > 0)) {
    blockers.push(createBlocker(
      'world-rules-missing',
      'high',
      '写作已开始，但世界规则未统一',
      '当前缺少世界规则基线，正文与回写会不断产生口径漂移。',
      ['世界规则', '正文写作', '质量监控'],
      'world-rules',
      '补齐世界规则',
      'generate_draft',
    ))
  }

  if (!stats.hasProtagonist && (stats.chapterCount > 0 || stats.totalWords > 0)) {
    blockers.push(createBlocker(
      'protagonist-missing',
      'high',
      '主角状态未建立',
      '当前项目已经进入章节生产，但主角资产还未稳定建立，人物状态回写无法可靠落账。',
      ['角色系统', '正文写作', '章后回写'],
      'characters',
      '补主角状态',
      'generate_draft',
    ))
  }

  if (stats.outlineCount <= 0 && (stats.chapterCount > 0 || stats.totalWords > 0 || assetBloat.risk === 'high')) {
    blockers.push(createBlocker(
      'outline-missing',
      'medium',
      '现有资产还未压入大纲',
      '没有稳定的大纲承接，章节合同和正文流水线会反复漂移。',
      ['故事大纲', '章节合同', '正文写作'],
      'outline',
      '生成故事大纲',
      'generate_draft',
    ))
  }

  if (stats.timelineCount <= 0 && (stats.chapterCount > 0 || stats.totalWords > 0)) {
    blockers.push(createBlocker(
      'timeline-missing',
      'medium',
      '时间轴未建立',
      '当前章节推进已经开始，但关键事件没有统一时间锚点，连续性风险会持续累积。',
      ['时间轴', '正文写作', '质量监控'],
      'timeline',
      '补齐时间轴',
      'generate_draft',
      true,
    ))
  }

  if (assetBloat.risk === 'high') {
    blockers.push(createBlocker(
      'asset-bloat',
      'medium',
      '首章前资产开始膨胀',
      assetBloat.reason,
      ['故事大纲', '正文写作'],
      stats.outlineCount > 0 ? 'writing' : 'outline',
      stats.outlineCount > 0 ? '直接进入正文' : '先压到大纲',
      'open_page',
      true,
    ))
  }

  return blockers.slice(0, 6)
}

export function getNextStep(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  viewMode: WorkspaceViewMode,
  qualitySummary?: QualitySummary,
): NextStep {
  const basicsDone = countTruthy([
    novel?.title?.trim(),
    novel?.synopsis?.trim(),
    novel?.userBackground?.trim(),
    novel?.expandedBackground?.trim(),
  ]) >= 4
  const { projectBrief, storySettings, themeVoice } = storySettingsSignals(novel)
  const endgameReady = countTruthy([
    storySettings.endgameDesign.endingMode,
    storySettings.endgameDesign.finalConflict,
    storySettings.endgameDesign.themeAnswer,
    storySettings.endgameDesign.mustDeliverPromises,
    storySettings.endgameDesign.lastScene,
  ]) >= 5
  const charactersReady = stats.hasProtagonist && stats.characterCount > 0
  const chapterInfrastructureReady = stats.outlineCount > 0 && stats.threadCount > 0 && stats.timelineCount > 0
  const writebackPending = (qualitySummary?.productionReadiness.writebackPendingCount || 0) > 0
    || (qualitySummary?.productionReadiness.writebackFailedCount || 0) > 0
  const qualityRepairPriority = (qualitySummary?.productionReadiness.aiRecurrenceHighRiskCount || 0) > 0
    || (qualitySummary?.productionReadiness.feedbackPauseSuggestedCount || 0) > 0

  if (!basicsDone) {
    return {
      title: '补基础信息',
      reason: '书名、简介、背景和目标字数还没钉住，后续所有 AI 输出都会不稳。',
      targetPage: 'overview',
      priority: 'high',
      estimatedMinutes: 5,
      actionLabel: '打开基础信息',
    }
  }

  if (projectBrief.readyCount < 4) {
    return {
      title: '补项目立项',
      reason: '读者承诺、卖点和禁区还没锁定，系统无法稳定判断接下来该往哪里推进。',
      targetPage: 'project-brief',
      priority: 'high',
      estimatedMinutes: 8,
      actionLabel: '打开项目立项',
    }
  }

  if (storySettings.premiseReadyCount < 4) {
    return {
      title: '补基础设定',
      reason: '主角起点、核心钩子和底层约束还没收紧，结构和正文都会发散。',
      targetPage: 'core-settings',
      priority: 'high',
      estimatedMinutes: 8,
      actionLabel: '打开基础设定',
    }
  }

  if (themeVoice.readyCount < 4) {
    return {
      title: '补主题与文风',
      reason: '当前缺少稳定的文风护栏，后续章节容易口径不一。',
      targetPage: 'theme-voice',
      priority: 'high',
      estimatedMinutes: 8,
      actionLabel: '打开主题与文风',
    }
  }

  if (!novel?.worldRulesJson) {
    return {
      title: '补世界规则',
      reason: '世界规则还没统一，人物、线程和正文的事实边界都不稳定。',
      targetPage: 'world-rules',
      priority: 'high',
      estimatedMinutes: 10,
      actionLabel: '打开世界规则',
    }
  }

  if (stats.mapCount <= 0) {
    return {
      title: '建立地图落点',
      reason: '地点层级和活动半径还没落地，人物、物品和事件没有可靠发生位置。',
      targetPage: 'map',
      priority: viewMode === 'professional' ? 'high' : 'medium',
      estimatedMinutes: 8,
      actionLabel: '打开地图落点',
    }
  }

  if (stats.itemCount <= 0) {
    return {
      title: '建立资源道具链',
      reason: '关键资源、道具和证据链还没铺出来，后续人物动机与冲突抓手会偏空。',
      targetPage: 'items',
      priority: 'medium',
      estimatedMinutes: 8,
      actionLabel: '打开资源道具',
    }
  }

  if (!charactersReady) {
    return {
      title: '建立角色网络',
      reason: '当前缺少主角与关键人物状态，后续章节合同和回写都不可靠。',
      targetPage: 'characters',
      priority: 'high',
      estimatedMinutes: 10,
      actionLabel: '打开角色网络',
    }
  }

  if (stats.resistanceTrackCount <= 0) {
    return {
      title: '建立阻力系统',
      reason: '人物网络已经有基础，但外部压力、关系压力或制度压力还没入账，后续大纲容易变成事件流水。',
      targetPage: 'resistance',
      priority: 'high',
      estimatedMinutes: 10,
      actionLabel: '打开阻力系统',
    }
  }

  if (stats.threadCount <= 0) {
    return {
      title: '补故事线程',
      reason: '主线、支线与伏笔还没挂成可追踪线程，正文会只有局部推进。',
      targetPage: 'threads',
      priority: 'medium',
      estimatedMinutes: 8,
      actionLabel: '打开故事线程',
    }
  }

  if (storySettings.storyDesignReadyCount < 4) {
    return {
      title: '压出主线骨架',
      reason: '线程和资产已经有了基础，下一步要统一主线目标、核心冲突和结局方向。',
      targetPage: 'story-design',
      priority: 'high',
      estimatedMinutes: 10,
      actionLabel: '打开故事设计',
    }
  }

  if (viewMode === 'professional' && !endgameReady) {
    return {
      title: '补终局设计',
      reason: '主线骨架已经成形，下一步要锁定最终冲突、兑现清单和最后一幕。',
      targetPage: 'endgame',
      priority: 'medium',
      estimatedMinutes: 10,
      actionLabel: '打开终局设计',
    }
  }

  if (stats.volumeCount <= 0) {
    return {
      title: '设计第一卷闭环',
      reason: '缺少卷级目标、卷末爆点和阶段代价，章节会有开头但缺少长篇承接。',
      targetPage: 'volume-design',
      priority: 'high',
      estimatedMinutes: 12,
      actionLabel: '打开卷级闭环',
    }
  }

  if (stats.outlineCount <= 0) {
    return {
      title: '拆出故事大纲',
      reason: '现有设定还没有被压成稳定的大纲骨架。',
      targetPage: 'outline',
      priority: 'high',
      estimatedMinutes: 12,
      actionLabel: '打开故事大纲',
    }
  }

  if (stats.timelineCount <= 0) {
    return {
      title: '校准事件时间轴',
      reason: '大纲已经有骨架，但事件先后、在场人物和状态变化还没形成统一时间锚点。',
      targetPage: 'timeline',
      priority: 'medium',
      estimatedMinutes: 10,
      actionLabel: '打开事件时间轴',
    }
  }

  if (stats.chapterCount <= 0) {
    return {
      title: '生成当前章节合同',
      reason: '已经具备进入章节生产的基础条件，下一步该把第一章合同补出来。',
      targetPage: 'contracts',
      priority: 'high',
      estimatedMinutes: 8,
      actionLabel: '打开章节合同',
    }
  }

  if (!chapterInfrastructureReady || stats.revisionBlockerCount > 0 || stats.staleChapterCount > 0 || stats.staleAssetCount > 0 || stats.staleCheckpointCount > 0) {
    return {
      title: '修复章节可写性缺口',
      reason: '当前章节生产链还存在缺失项或上下文风险，建议先修可写性再继续生成正文。',
      targetPage: 'writing',
      priority: 'high',
      estimatedMinutes: 10,
      actionLabel: '检查可写性',
    }
  }

  if (stats.totalWords <= 0) {
    return {
      title: '进入正文写作',
      reason: '合同和基础结构已经具备，最有价值的下一步是产出第一章正文。',
      targetPage: 'writing',
      priority: 'high',
      estimatedMinutes: 20,
      actionLabel: '进入正文写作',
    }
  }

  if (stats.revisionTaskCount > 0 || stats.revisionBlockerCount > 0) {
    return {
      title: '处理章节审校与修订',
      reason: `当前仍有 ${stats.revisionTaskCount} 项修订任务待处理，先清理再继续推进更稳。`,
      targetPage: 'revision',
      priority: 'medium',
      estimatedMinutes: 12,
      actionLabel: '打开修订中心',
    }
  }

  if (qualityRepairPriority) {
    return {
      title: '先处理高优先质量问题',
      reason: '质量监控已经检测到高复发或建议暂停推进的问题，先回修订中心比继续写更划算。',
      targetPage: 'revision',
      priority: 'high',
      estimatedMinutes: 15,
      actionLabel: '打开修订中心',
    }
  }

  if (writebackPending) {
    return {
      title: '执行章后回写',
      reason: '正文已生成，但状态总账还没有完全确认写回。',
      targetPage: 'writeback',
      priority: 'medium',
      estimatedMinutes: 10,
      actionLabel: '打开章后回写',
    }
  }

  return {
    title: '进入质量监控',
    reason: '当前主链路已经闭合，下一步适合统一检查生产健康和风险趋势。',
    targetPage: 'quality',
    priority: 'low',
    estimatedMinutes: 8,
    actionLabel: '打开质量监控',
  }
}

function buildModuleSnapshots(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  viewMode: WorkspaceViewMode,
  qualitySummary?: QualitySummary,
): WorkspaceModuleSnapshot[] {
  const visibleKeys = MODE_VISIBLE_KEYS[viewMode]
  const baseProgressMap = buildBaseProgressMap(novel, stats, qualitySummary)
  const blockers = getProjectBlockers(novel, stats, qualitySummary)

  return WORKSPACE_MODULE_DEFINITIONS
    .filter((definition) => visibleKeys.has(definition.key))
    .map((definition) => {
      const relatedBlockers = blockers.filter((blocker) => (
        blocker.affectedModules.includes(definition.key)
        || blocker.affectedModules.includes(definition.label)
      ))
      const mergedProgress = finalizeProgress({
        ...baseProgressMap[definition.key],
        blockers: [...baseProgressMap[definition.key].blockers, ...relatedBlockers],
      })

      return {
        ...mergedProgress,
        key: definition.key,
        label: definition.label,
        description: definition.description,
        groupKey: definition.groupKey,
        groupTitle: definition.groupTitle,
        route: buildRoute(definition.key),
        progressText: formatProgress(mergedProgress),
        blockerCount: relatedBlockers.length,
      }
    })
}

function buildReadinessSummary(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  qualitySummary?: QualitySummary,
): WorkspaceReadinessSummary {
  const modules = buildModuleSnapshots(novel, stats, 'professional', qualitySummary)
  const findScore = (...keys: WorkspaceModuleSnapshot['key'][]) => {
    const targets = modules.filter((item) => keys.includes(item.key))
    if (targets.length === 0) return 0
    const total = targets.reduce((sum, item) => sum + (item.requiredTotal > 0 ? Math.round(item.requiredDone / item.requiredTotal * 100) : 0), 0)
    return Math.round(total / targets.length)
  }

  const contextScore = clamp(
    100
      - stats.revisionBlockerCount * 18
      - stats.staleChapterCount * 12
      - stats.staleAssetCount * 10
      - stats.staleCheckpointCount * 8
      - (qualitySummary?.productionReadiness.writebackFailedCount || 0) * 14
      - (qualitySummary?.productionReadiness.writebackPendingCount || 0) * 6,
  )

  const metrics: WorkspaceReadinessMetric[] = [
    {
      key: 'foundation',
      label: '项目定标完整度',
      score: findScore('overview', 'project-brief', 'core-settings', 'theme-voice'),
      summary: '项目总览、Brief、故事底盘和主题文风。',
    },
    {
      key: 'world-building',
      label: '世界地点完整度',
      score: findScore('world-rules', 'map', 'items', 'glossary', 'scene-templates'),
      summary: '世界规则、地点场景、物品线索、术语和场景模板。',
    },
    {
      key: 'cast-factions',
      label: '人物阵营完整度',
      score: findScore('characters', 'arc-center', 'resistance', 'factions'),
      summary: '人物档案、人物弧线、阻力系统和阵营组织。',
    },
    {
      key: 'plot-architecture',
      label: '剧情伏笔完整度',
      score: findScore('story-design', 'threads', 'endgame', 'info-gap-board', 'foreshadow-ledger', 'growth-system'),
      summary: '主线骨架、剧情线程、终局承诺、信息差、伏笔和成长代价。',
    },
    {
      key: 'volume-outline',
      label: '卷章大纲完整度',
      score: findScore('volume-design', 'outline', 'structure', 'timeline'),
      summary: '卷级设计、故事大纲、卷章结构和事件时间轴。',
    },
    {
      key: 'chapter-constraints',
      label: '卷章生产完整度',
      score: findScore('contracts', 'writing', 'writeback'),
      summary: '章节合同、正文生产与章后回写闭环。',
    },
    {
      key: 'context-stability',
      label: '上下文稳定性',
      score: contextScore,
      summary: '上下文、检查点、回写和修订风险。',
    },
  ]

  const score = Math.round(metrics.reduce((sum, item) => sum + item.score, 0) / metrics.length)

  return {
    score,
    label: score >= 85 ? '稳定' : score >= 65 ? '可推进' : '待补齐',
    metrics,
  }
}

function buildGroupSnapshots(
  modules: WorkspaceModuleSnapshot[],
  nextStep: NextStep,
  blockers: ProjectBlocker[],
): WorkspaceGroupSnapshot[] {
  const grouped = new Map<WorkspaceGroupKey, WorkspaceModuleSnapshot[]>()
  modules.forEach((module) => {
    const existing = grouped.get(module.groupKey) || []
    grouped.set(module.groupKey, [...existing, module])
  })

  const projectStatusModules = [
    {
      key: 'overview',
      label: '创作向导',
      description: '查看当前阶段、阻塞和推荐动作。',
      groupKey: 'foundation',
      groupTitle: '项目状态',
      route: 'guide',
      progressText: '',
      blockerCount: 0,
      moduleKey: 'guide-overview',
      requiredTotal: 1,
      requiredDone: 1,
      optionalTotal: 0,
      optionalDone: 0,
      blockers: [],
      status: 'done' as ModuleStatus,
    },
    {
      key: 'overview',
      label: '当前阻塞',
      description: '查看阻塞原因和直接处理入口。',
      groupKey: 'foundation',
      groupTitle: '项目状态',
      route: 'guide?panel=blockers',
      progressText: '',
      blockerCount: blockers.length,
      moduleKey: 'guide-blockers',
      requiredTotal: 1,
      requiredDone: blockers.length > 0 ? 0 : 1,
      optionalTotal: 0,
      optionalDone: 0,
      blockers: [],
      status: blockers.length > 0 ? 'blocked' as ModuleStatus : 'done' as ModuleStatus,
    },
    {
      key: 'overview',
      label: '推荐下一步',
      description: '执行当前最有价值的推进动作。',
      groupKey: 'foundation',
      groupTitle: '项目状态',
      route: 'guide?panel=next-step',
      progressText: '',
      blockerCount: 0,
      moduleKey: 'guide-next-step',
      requiredTotal: 1,
      requiredDone: nextStep.priority === 'low' ? 1 : 0,
      optionalTotal: 0,
      optionalDone: 0,
      blockers: [],
      status: nextStep.priority === 'high' ? 'ready' as ModuleStatus : nextStep.priority === 'medium' ? 'warning' as ModuleStatus : 'done' as ModuleStatus,
    },
  ]

  const result: WorkspaceGroupSnapshot[] = [
    {
      key: 'project-status',
      title: '项目状态',
      route: 'guide',
      modules: projectStatusModules as unknown as WorkspaceModuleSnapshot[],
      completedCount: projectStatusModules.filter((item) => item.status === 'done').length,
      totalCount: projectStatusModules.length,
      blockerCount: blockers.length,
      status: blockers.length > 0 ? 'blocked' : nextStep.priority === 'high' ? 'ready' : 'done',
    },
  ]

  ;(['foundation', 'world-building', 'cast-factions', 'plot-architecture', 'volume-outline', 'chapter-production', 'quality-control'] as const).forEach((groupKey) => {
    const items = grouped.get(groupKey) || []
    if (items.length === 0) return
    const completedCount = items.filter((item) => completionFromProgress(item)).length
    const blockerCount = items.reduce((sum, item) => sum + item.blockerCount, 0)
    const status = blockerCount > 0
      ? 'blocked'
      : completedCount >= items.length
        ? 'done'
        : completedCount > 0
          ? 'draft'
          : 'not_started'
    result.push({
      key: groupKey,
      title: items[0].groupTitle,
      route: GROUP_ROUTE_MAP[groupKey],
      modules: items,
      completedCount,
      totalCount: items.length,
      blockerCount,
      status,
    })
  })

  return result
}

function buildStageSummary(
  groups: WorkspaceGroupSnapshot[],
  blockers: ProjectBlocker[],
): WorkspaceStageSummary {
  if (blockers.some((item) => item.level === 'fatal' || item.level === 'high')) {
    return {
      key: 'quality-control',
      label: '修订质检',
      description: '当前存在高优先风险，先清 blocker 再继续推进。',
      route: 'guide?panel=blockers',
    }
  }

  const stageGroups = groups.filter((group) => group.key !== 'project-status')
  const active = stageGroups.find((group) => group.completedCount < group.totalCount) || stageGroups[stageGroups.length - 1]

  if (!active) {
    return {
      key: 'project-status',
      label: '项目状态',
      description: '当前所有核心阶段都已完成。',
      route: 'guide',
    }
  }

  return {
    key: active.key,
    label: active.title,
    description: active.blockerCount > 0 ? '当前阶段仍有 blocker 待清理。' : `当前阶段仍有 ${active.totalCount - active.completedCount} 个模块待补齐。`,
    route: active.route,
  }
}

function buildNavGroups(
  groups: WorkspaceGroupSnapshot[],
  nextStep: NextStep,
  blockers: ProjectBlocker[],
): WorkspaceNavGroup[] {
  const formatNavMeta = (item: WorkspaceModuleSnapshot) => {
    if (item.blockerCount > 0) return `${item.blockerCount} 个风险`
    if (item.status === 'not_started') return undefined
    if (item.requiredTotal > 0 && item.requiredDone < item.requiredTotal) {
      return `${item.requiredDone}/${item.requiredTotal}`
    }
    if (item.optionalTotal > 0 && item.optionalDone < item.optionalTotal) {
      return `扩展 ${item.optionalDone}/${item.optionalTotal}`
    }
    return undefined
  }

  return groups.map((group) => {
    if (group.key === 'project-status') {
      return {
        key: group.key,
        title: group.title,
        route: group.route,
        progress: { done: group.completedCount, total: group.totalCount },
        items: [
          {
            key: 'guide:overview',
            label: '创作向导',
            route: 'guide',
            status: 'done',
            meta: '阶段路线与推荐动作',
          },
          {
            key: 'guide:blockers',
            label: '当前阻塞',
            route: 'guide?panel=blockers',
            status: blockers.length > 0 ? 'blocked' : 'done',
            meta: blockers.length > 0 ? `${blockers.length} 个 blocker` : '已清空',
            hasBlocker: blockers.length > 0,
          },
          {
            key: 'guide:next-step',
            label: '推荐下一步',
            route: 'guide?panel=next-step',
            status: nextStep.priority === 'high' ? 'ready' : nextStep.priority === 'medium' ? 'warning' : 'done',
            meta: nextStep.title,
          },
        ],
      }
    }

    return {
      key: group.key,
      title: group.title,
      route: group.route,
      progress: { done: group.completedCount, total: group.totalCount },
      items: group.modules.map<WorkspaceNavItem>((item) => ({
        key: item.key,
        label: item.label,
        route: item.route,
        status: item.status,
        progress: { done: item.requiredDone, total: item.requiredTotal },
        meta: formatNavMeta(item),
        hasBlocker: item.blockerCount > 0,
      })),
    }
  })
}

export function getWorkspaceSnapshot(
  novel: Novel | null | undefined,
  stats: WorkflowStats,
  options?: {
    viewMode?: WorkspaceViewMode
    qualitySummary?: QualitySummary
  },
): WorkspaceSnapshot {
  const viewMode = resolveWorkspaceMode(novel, options?.viewMode)
  const blockers = getProjectBlockers(novel, stats, options?.qualitySummary)
  const nextStep = getNextStep(novel, stats, viewMode, options?.qualitySummary)
  const modules = buildModuleSnapshots(novel, stats, viewMode, options?.qualitySummary)
  const groups = buildGroupSnapshots(modules, nextStep, blockers)
  const readiness = buildReadinessSummary(novel, stats, options?.qualitySummary)
  const stage = buildStageSummary(groups, blockers)
  const moduleDoneCount = modules.filter((item) => completionFromProgress(item)).length
  const moduleTotalCount = modules.length

  return {
    viewMode,
    modules,
    moduleMap: Object.fromEntries(modules.map((item) => [item.key, item])) as Record<WorkspaceModuleSnapshot['key'], WorkspaceModuleSnapshot>,
    groups,
    blockers,
    nextStep,
    readiness,
    stage,
    moduleDoneCount,
    moduleTotalCount,
    navGroups: buildNavGroups(groups, nextStep, blockers),
  }
}

export function getWorkspaceNavKey(currentPage: string, search: string) {
  if (currentPage !== 'guide') return currentPage
  const panel = new URLSearchParams(search).get('panel')
  if (panel === 'blockers') return 'guide:blockers'
  if (panel === 'next-step') return 'guide:next-step'
  return 'guide:overview'
}

export function getWorkspaceModeOptions() {
  return [
    {
      value: 'quick' as WorkspaceViewMode,
      label: '快速',
      description: '只显示关键链路，优先尽快开写。',
    },
    {
      value: 'professional' as WorkspaceViewMode,
      label: '完整',
      description: '显示完整长篇生产链路与全部模块。',
    },
  ]
}

export function getChapterWritabilitySummary(input: {
  chapter: Chapter | null
  publishCheck?: ChapterPublishCheck | null
  scenePlanCount: number
  chapterSegmentCount: number
  threadCount: number
  chapterCharactersCount: number
  relatedEventCount: number
  staleReasonCount: number
  dueForeshadowCount: number
  revisionBlockerCount: number
  staleAssetCount: number
  staleCheckpointCount: number
}): ChapterWritabilitySummary {
  const checks: ChapterWritabilityCheck[] = [
    {
      key: 'chapter-contract',
      label: '章节合同',
      ready: Boolean(input.chapter?.summary || input.chapter?.outline || ((input.chapter?.targetWords || 0) > 0)),
      detail: input.chapter?.summary || input.chapter?.outline || '当前章节还没有稳定的章节合同摘要。',
      required: true,
    },
    {
      key: 'scene-contract',
      label: '场景合同',
      ready: input.scenePlanCount > 0 || input.chapterSegmentCount > 0,
      detail: input.scenePlanCount > 0 || input.chapterSegmentCount > 0
        ? `已挂 ${Math.max(input.scenePlanCount, input.chapterSegmentCount)} 个场景约束。`
        : '当前还没有场景计划或结构片段。',
      required: true,
    },
    {
      key: 'threads',
      label: '故事线程',
      ready: input.threadCount > 0,
      detail: input.threadCount > 0 ? `当前项目已维护 ${input.threadCount} 条线程。` : '主线与支线还没挂成可追踪线程。',
      required: true,
    },
    {
      key: 'character-state',
      label: '人物状态',
      ready: input.chapterCharactersCount > 0,
      detail: input.chapterCharactersCount > 0 ? `已加载 ${input.chapterCharactersCount} 位相关角色状态。` : '当前章节尚未绑定足够的人物状态。',
      required: true,
    },
    {
      key: 'time-place',
      label: '地点与时间',
      ready: input.relatedEventCount > 0,
      detail: input.relatedEventCount > 0 ? `已命中 ${input.relatedEventCount} 个时间轴锚点。` : '当前章节还没有明确的时间或地点锚点。',
      required: true,
    },
    {
      key: 'blockers',
      label: '未处理 blocker',
      ready: input.revisionBlockerCount <= 0 && input.staleReasonCount <= 0 && input.staleAssetCount <= 0 && input.staleCheckpointCount <= 0,
      detail: input.revisionBlockerCount > 0
        ? `当前仍有 ${input.revisionBlockerCount} 个 blocker 级问题。`
        : input.staleReasonCount > 0
          ? `本章存在 ${input.staleReasonCount} 条待同步原因。`
          : input.staleAssetCount > 0 || input.staleCheckpointCount > 0
            ? `资产待同步 ${input.staleAssetCount} 类，检查点待刷新 ${input.staleCheckpointCount} 份。`
            : '当前没有直接阻断写作的风险。',
      required: true,
    },
    {
      key: 'timeline-conflict',
      label: '伏笔与时间轴冲突',
      ready: (input.publishCheck?.rewriteCount || 0) <= 0 && (input.publishCheck?.blockerCount || 0) <= 0,
      detail: (input.publishCheck?.rewriteCount || 0) > 0 || (input.publishCheck?.blockerCount || 0) > 0
        ? `验收发现重写 ${input.publishCheck?.rewriteCount || 0} 项、阻塞 ${input.publishCheck?.blockerCount || 0} 项。`
        : input.dueForeshadowCount > 0
          ? `当前附近有 ${input.dueForeshadowCount} 个伏笔到期，建议写作时显式服务。`
          : '当前没有明显的伏笔或时序冲突。',
      required: true,
    },
  ]

  const readyCount = checks.filter((item) => item.ready).length
  const score = clamp(Math.round(readyCount / checks.length * 100))
  const risks = checks.filter((item) => !item.ready).map((item) => `${item.label}：${item.detail}`)
  const suggestions = [
    !checks[0].ready ? '先补章节合同，再生成正文。' : '',
    !checks[1].ready ? '先补场景合同或结构片段。' : '',
    !checks[4].ready ? '先把时间轴或地点锚点挂上。' : '',
    !checks[5].ready ? '先清当前 blocker 或同步本章上下文。' : '',
  ].filter(Boolean)

  if (checks[5] && !checks[5].ready) {
    return {
      ready: false,
      score,
      label: '阻塞',
      summary: '当前章节存在 blocker，建议先处理同步或修订问题。',
      risks,
      suggestions,
      checks,
    }
  }

  if (score >= 85) {
    return {
      ready: true,
      score,
      label: '高',
      summary: '当前章节具备稳定可写条件，可以直接进入正文生产。',
      risks,
      suggestions,
      checks,
    }
  }

  if (score >= 60) {
    return {
      ready: false,
      score,
      label: '中',
      summary: '当前章节可写性一般，建议先补齐关键缺口再生成。',
      risks,
      suggestions,
      checks,
    }
  }

  return {
    ready: false,
    score,
    label: '低',
    summary: '当前章节关键约束不足，直接写会显著增加返工。',
    risks,
    suggestions,
    checks,
  }
}
