import type { Novel } from '../../types'
import { parseProjectBriefSnapshot } from '../../shared/project-brief'
import { parseStorySettingsSnapshot } from '../../shared/story-settings'
import type { StorySettingsSnapshot } from '../../shared/story-settings'
import { parseThemeVoiceSnapshot } from '../../shared/theme-voice'
import { EMPTY_WORKFLOW_STATS, getAssetBloatSignal } from '../../shared/workflow-stats'
import type { AssetBloatSignal, AssetBloatRiskLevel, WorkflowStats } from '../../shared/workflow-stats'

export type WorkflowRecommendationKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'endgame'
  | 'story-design'
  | 'world-rules'
  | 'map'
  | 'factions'
  | 'characters'
  | 'arc-center'
  | 'resistance'
  | 'items'
  | 'glossary'
  | 'threads'
  | 'scene-templates'
  | 'outline'
  | 'structure'
  | 'timeline'
  | 'writing'
  | 'revision'

export type GuidedWorkflowStepKey =
  | 'basics'
  | 'project-brief'
  | 'story-core'
  | 'theme-voice'
  | 'world-foundation'
  | 'endgame-design'
  | 'map-structure'
  | 'character-roster'
  | 'items-equipment'
  | 'story-threads'
  | 'story-plot'
  | 'volume-planning'
  | 'write-start'

export type WorkflowRunnableStepKey =
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'threads'
  | 'story-design'
  | 'outline'
  | 'timeline'
  | 'writing'

export interface NextChapterReadiness {
  ready: boolean
  label: string
  reason: string
}

export interface GuidedStepProgress {
  completedCount: number
  totalCount: number
  isComplete: boolean
}

type WorkflowNovelContext = Pick<
Novel,
| 'title'
| 'synopsis'
| 'userBackground'
| 'expandedBackground'
| 'projectBriefJson'
| 'settingsJson'
| 'themeVoiceJson'
| 'worldRulesJson'
> | null | undefined

export type { AssetBloatSignal, AssetBloatRiskLevel, StorySettingsSnapshot, WorkflowStats }
export { EMPTY_WORKFLOW_STATS, getAssetBloatSignal }

export const GUIDED_STEP_ORDER: GuidedWorkflowStepKey[] = [
  'basics',
  'project-brief',
  'story-core',
  'theme-voice',
  'world-foundation',
  'endgame-design',
  'map-structure',
  'items-equipment',
  'character-roster',
  'story-threads',
  'story-plot',
  'volume-planning',
  'write-start',
]

export async function loadWorkflowStats(novelId: number): Promise<WorkflowStats> {
  const [baseStats, characterStats, itemStats, mapStats, factionStats, glossaryStats, threadStats, sceneTemplateStats, revisionStats, arcs, timelineStats, volumes, contextStatus, arcDashboard, resistanceDashboard, writingPipelineStats] = await Promise.all([
    window.electron.novel.stats(novelId),
    window.electron.character.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.item.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.map.getStats(novelId),
    window.electron.faction.getStats({ novelId }),
    window.electron.glossary.getStats({ novelId }),
    window.electron.thread.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.sceneTemplate.getStats({ novelId }),
    window.electron.revision.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.outline.getArcs(novelId),
    window.electron.timeline.getStats({ novelId }),
    window.electron.structure.listVolumes(novelId),
    window.electron.novel.getContextStatus(novelId),
    window.electron.characterArc.getArcDashboard(novelId),
    window.electron.resistance.getDashboard(novelId),
    window.electron.task.getPipelineStats(novelId),
  ])

  return {
    mapCount: mapStats.total,
    factionCount: factionStats.total,
    characterCount: characterStats.total,
    characterArcCount: arcDashboard.characterArcs.length,
    relationshipArcCount: arcDashboard.relationshipArcs.length,
    resistanceTrackCount: resistanceDashboard.tracks.length,
    itemCount: itemStats.total,
    glossaryCount: glossaryStats.total,
    threadCount: threadStats.total,
    sceneTemplateCount: sceneTemplateStats.total,
    outlineCount: arcs.length,
    timelineCount: timelineStats.total,
    revisionTaskCount: revisionStats.openCount + revisionStats.inProgressCount,
    revisionBlockerCount: revisionStats.blockerCount,
    revisionOpenCount: revisionStats.openCount,
    chapterCount: baseStats.totalChapters,
    completedChapterCount: baseStats.completedChapters,
    totalWords: baseStats.totalWords,
    staleChapterCount: contextStatus.staleChapterCount,
    contextVersion: contextStatus.contextVersion,
    staleCheckpointCount: contextStatus.staleCheckpointCount,
    staleAssetCount: contextStatus.staleAssetCount,
    staleAssetLabels: contextStatus.staleAssetLabels,
    hasProtagonist: characterStats.protagonistCount > 0,
    volumeCount: Array.isArray(volumes) ? volumes.length : 0,
    writingPipelineStats,
  }
}

export function countMapNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce((total, node) => (
    total + 1 + countMapNodes(Array.isArray(node.children) ? node.children as Array<{ children?: unknown[] }> : [])
  ), 0)
}

export function parseStorySettings(raw?: string): StorySettingsSnapshot {
  return parseStorySettingsSnapshot(raw)
}

export function isBasicsReady(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground'> | null | undefined,
): boolean {
  if (!novel) return false

  return [novel.title, novel.synopsis, novel.userBackground, novel.expandedBackground]
    .every((value) => typeof value === 'string' && value.trim().length > 0)
}

export function isProjectBriefReady(
  novel: Pick<Novel, 'projectBriefJson'> | null | undefined,
): boolean {
  return parseProjectBriefSnapshot(novel?.projectBriefJson).readyCount >= 4
}

export function isStoryCoreReady(novel: Pick<Novel, 'settingsJson'> | null | undefined): boolean {
  const settings = parseStorySettings(novel?.settingsJson)
  return Boolean(
    settings.premise.positioning
    && settings.premise.coreHook
    && settings.premise.protagonistStart
    && settings.premise.constraints
  )
}

export function isThemeVoiceReady(
  novel: Pick<Novel, 'themeVoiceJson'> | null | undefined,
): boolean {
  const themeVoice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  return Boolean(
    themeVoice.writingContractTags.length > 0
    && themeVoice.theme
    && themeVoice.emotionalCore
    && themeVoice.pov
    && themeVoice.tense
    && themeVoice.styleRules
    && themeVoice.dialogueRules
  )
}

export function isStoryPlotReady(novel: Pick<Novel, 'settingsJson'> | null | undefined): boolean {
  const settings = parseStorySettings(novel?.settingsJson)
  return Boolean(
    settings.storyGoal
    && settings.coreConflict
    && settings.mainPlot
    && settings.ending
  )
}

export function getEndgameDesignProgress(
  novel: Pick<Novel, 'settingsJson'> | null | undefined,
): GuidedStepProgress {
  const settings = parseStorySettings(novel?.settingsJson)
  const completedCount = [
    settings.endgameDesign.endingMode,
    settings.endgameDesign.finalConflict,
    settings.endgameDesign.themeAnswer,
    settings.endgameDesign.mustDeliverPromises,
    settings.endgameDesign.payoffChecklist,
    settings.endgameDesign.deliberateUnknowns,
    settings.endgameDesign.finalImage,
    settings.endgameDesign.lastScene,
  ].filter(Boolean).length

  return {
    completedCount,
    totalCount: 8,
    isComplete: Boolean(
      settings.endgameDesign.endingMode
      && settings.endgameDesign.finalConflict
      && settings.endgameDesign.themeAnswer
      && settings.endgameDesign.mustDeliverPromises
      && settings.endgameDesign.lastScene
    ),
  }
}

export function isEndgameDesignReady(
  novel: Pick<Novel, 'settingsJson'> | null | undefined,
): boolean {
  return getEndgameDesignProgress(novel).isComplete
}

export function isWorldFoundationReady(
  novel: Pick<Novel, 'worldRulesJson'> | null | undefined,
): boolean {
  return Boolean(novel?.worldRulesJson)
}

export function isMapStructureReady(stats: Pick<WorkflowStats, 'mapCount'>): boolean {
  return stats.mapCount > 0
}

export function isCharacterRosterReady(
  stats: Pick<WorkflowStats, 'characterCount' | 'hasProtagonist'> & Partial<Pick<WorkflowStats, 'characterArcCount' | 'relationshipArcCount'>>,
): boolean {
  const hasCoreCast = stats.hasProtagonist && stats.characterCount > 0
  if (!hasCoreCast) return false

  const hasCharacterArc = (stats.characterArcCount || 0) > 0
  const hasRelationshipLayer = stats.characterCount <= 1 || (stats.relationshipArcCount || 0) > 0
  return hasCharacterArc && hasRelationshipLayer
}

export function isResistanceSystemReady(
  stats: Pick<WorkflowStats, 'resistanceTrackCount'>,
): boolean {
  return stats.resistanceTrackCount > 0
}

export function isItemsEquipmentReady(stats: Pick<WorkflowStats, 'itemCount'>): boolean {
  return stats.itemCount > 0
}

export function isStoryThreadsReady(stats: Pick<WorkflowStats, 'threadCount'>): boolean {
  return stats.threadCount > 0
}

export function isVolumePlanningReady(stats: Pick<WorkflowStats, 'volumeCount'>): boolean {
  return stats.volumeCount > 0
}

export function isWritingStepReady(
  stats: Pick<
    WorkflowStats,
    | 'outlineCount'
    | 'timelineCount'
    | 'threadCount'
    | 'chapterCount'
    | 'totalWords'
    | 'characterCount'
    | 'hasProtagonist'
    | 'characterArcCount'
    | 'relationshipArcCount'
    | 'resistanceTrackCount'
    | 'volumeCount'
  >,
): boolean {
  return isCharacterRosterReady(stats)
    && isResistanceSystemReady(stats)
    && stats.volumeCount > 0
    && stats.outlineCount > 0
    && stats.timelineCount > 0
    && stats.threadCount > 0
    && (stats.chapterCount > 0 || stats.totalWords > 0)
}

export function getNextChapterReadiness(
  stats: Pick<
  WorkflowStats,
  | 'outlineCount'
  | 'timelineCount'
  | 'threadCount'
  | 'chapterCount'
  | 'totalWords'
  | 'characterCount'
  | 'hasProtagonist'
  | 'characterArcCount'
  | 'relationshipArcCount'
  | 'resistanceTrackCount'
  | 'volumeCount'
  | 'revisionBlockerCount'
  | 'staleChapterCount'
  | 'staleAssetCount'
  | 'staleCheckpointCount'
  >,
): NextChapterReadiness {
  if (stats.revisionBlockerCount > 0) {
    return {
      ready: false,
      label: '先清 blocker',
      reason: `当前有 ${stats.revisionBlockerCount} 个高优先修订问题，继续写会放大返工。`,
    }
  }

  if (stats.staleChapterCount > 0 || stats.staleAssetCount > 0 || stats.staleCheckpointCount > 0) {
    return {
      ready: false,
      label: '待同步',
      reason: '上下文、章节或长期记忆仍未对齐，建议先回写和同步。',
    }
  }

  if (!isCharacterRosterReady(stats)) {
    return {
      ready: false,
      label: '缺人物网',
      reason: '主角、人物弧或关系弧还没形成可承接网络，直接开写会让人物关系变成平铺说明。',
    }
  }

  if (!isResistanceSystemReady(stats)) {
    return {
      ready: false,
      label: '缺阻力线',
      reason: '外部阻力、关系阻力或制度阻力还没入账，章节容易只推进事件而没有持续压力。',
    }
  }

  if (stats.volumeCount <= 0) {
    return {
      ready: false,
      label: '缺卷级闭环',
      reason: '第一卷目标、卷末爆点和阶段代价还没固定，首章很容易开得热闹但后续失焦。',
    }
  }

  if (stats.outlineCount <= 0) {
    return {
      ready: false,
      label: '缺大纲',
      reason: '至少先有可承接的故事大纲，再开始写下一章。',
    }
  }

  if (stats.threadCount <= 0) {
    return {
      ready: false,
      label: '缺线程',
      reason: '主线和支线还没挂成线程，正文很容易只剩局部段落推进。',
    }
  }

  if (stats.timelineCount <= 0) {
    return {
      ready: false,
      label: '缺时间轴',
      reason: '关键事件顺序还没钉住，继续写会增加后续对齐成本。',
    }
  }

  return {
    ready: true,
    label: stats.chapterCount > 0 || stats.totalWords > 0 ? '可写下一章' : '可写第一章',
    reason: '当前结构、线程和时间锚点已具备最小可写条件，可以直接进入正文。',
  }
}

export function getGuidedStepProgressMap(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): Record<GuidedWorkflowStepKey, GuidedStepProgress> {
  const settings = parseStorySettings(novel?.settingsJson)
  const projectBrief = parseProjectBriefSnapshot(novel?.projectBriefJson)
  const themeVoice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  const basicsProgress = [novel?.title, novel?.synopsis, novel?.userBackground, novel?.expandedBackground]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .length
  const storyCoreProgress = [
    settings.premise.positioning,
    settings.premise.coreHook,
    settings.premise.protagonistStart,
    settings.premise.constraints,
  ].filter(Boolean).length
  const storyPlotProgress = [
    settings.storyGoal,
    settings.coreConflict,
    settings.mainPlot,
    settings.ending,
  ].filter(Boolean).length
  const endgameProgress = getEndgameDesignProgress(novel)
  const themeVoiceProgress = [
    themeVoice.theme,
    themeVoice.emotionalCore,
    themeVoice.pov,
    themeVoice.tense,
    themeVoice.styleRules,
    themeVoice.dialogueRules,
  ].filter(Boolean).length
  const characterNetworkProgress = [
    stats.hasProtagonist,
    stats.characterCount > 0,
    stats.characterArcCount > 0,
    stats.characterCount > 1 && stats.relationshipArcCount > 0,
  ].filter(Boolean).length
  const writingProgress = [
    isCharacterRosterReady(stats),
    isResistanceSystemReady(stats),
    stats.volumeCount > 0,
    stats.outlineCount > 0,
    stats.timelineCount > 0,
    stats.threadCount > 0,
    stats.chapterCount > 0,
    stats.totalWords > 0,
  ].filter(Boolean).length

  return {
    basics: {
      completedCount: basicsProgress,
      totalCount: 4,
      isComplete: basicsProgress >= 4,
    },
    'project-brief': {
      completedCount: projectBrief.readyCount,
      totalCount: 6,
      isComplete: projectBrief.readyCount >= 4,
    },
    'story-core': {
      completedCount: storyCoreProgress,
      totalCount: 4,
      isComplete: Boolean(settings.premise.positioning && settings.premise.coreHook && settings.premise.constraints),
    },
    'theme-voice': {
      completedCount: themeVoiceProgress,
      totalCount: 6,
      isComplete: Boolean(themeVoice.theme && themeVoice.emotionalCore && themeVoice.styleRules && themeVoice.dialogueRules),
    },
    'world-foundation': {
      completedCount: novel?.worldRulesJson ? 1 : 0,
      totalCount: 1,
      isComplete: Boolean(novel?.worldRulesJson),
    },
    'endgame-design': endgameProgress,
    'map-structure': {
      completedCount: stats.mapCount > 0 ? 1 : 0,
      totalCount: 1,
      isComplete: stats.mapCount > 0,
    },
    'character-roster': {
      completedCount: characterNetworkProgress,
      totalCount: 4,
      isComplete: isCharacterRosterReady(stats),
    },
    'items-equipment': {
      completedCount: stats.itemCount > 0 ? 1 : 0,
      totalCount: 1,
      isComplete: stats.itemCount > 0,
    },
    'story-threads': {
      completedCount: stats.threadCount > 0 ? 1 : 0,
      totalCount: 1,
      isComplete: stats.threadCount > 0,
    },
    'story-plot': {
      completedCount: storyPlotProgress,
      totalCount: 4,
      isComplete: storyPlotProgress >= 4,
    },
    'volume-planning': {
      completedCount: stats.volumeCount > 0 ? 1 : 0,
      totalCount: 1,
      isComplete: stats.volumeCount > 0,
    },
    'write-start': {
      completedCount: writingProgress,
      totalCount: 8,
      isComplete: isWritingStepReady(stats),
    },
  }
}

export function getRecommendedGuidedWorkflowStep(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): GuidedWorkflowStepKey {
  if (!isBasicsReady(novel)) return 'basics'
  if (!isProjectBriefReady(novel)) return 'project-brief'
  if (!isStoryCoreReady(novel)) return 'story-core'
  if (!isThemeVoiceReady(novel)) return 'theme-voice'
  if (!isWorldFoundationReady(novel)) return 'world-foundation'
  if (!isEndgameDesignReady(novel)) return 'endgame-design'
  if (!isMapStructureReady(stats)) return 'map-structure'
  if (!isItemsEquipmentReady(stats)) return 'items-equipment'
  if (!isCharacterRosterReady(stats)) return 'character-roster'
  if (!isStoryThreadsReady(stats)) return 'story-threads'
  if (!isStoryPlotReady(novel)) return 'story-plot'
  if (!isVolumePlanningReady(stats)) return 'volume-planning'
  return 'write-start'
}

export function getRecommendedWorkflowStep(
  novel: Pick<Novel, 'projectBriefJson' | 'settingsJson' | 'themeVoiceJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): WorkflowRecommendationKey | null {
  if (!novel) return null
  if (!isProjectBriefReady(novel)) return 'project-brief'
  if (!isStoryCoreReady(novel)) return 'core-settings'
  if (!isThemeVoiceReady(novel)) return 'theme-voice'
  if (!novel.worldRulesJson) return 'world-rules'
  if (!isEndgameDesignReady(novel)) return 'endgame'
  if (stats.mapCount <= 0) return 'map'
  if (stats.itemCount <= 0) return 'items'
  if (stats.characterCount <= 0) return 'characters'
  if (stats.resistanceTrackCount <= 0) return 'resistance'
  if (stats.threadCount <= 0) return 'threads'
  if (!isStoryPlotReady(novel)) return 'story-design'
  if (stats.outlineCount <= 0) return 'outline'
  if (stats.timelineCount <= 0) return 'timeline'
  if (stats.chapterCount <= 0 && stats.totalWords <= 0) return 'writing'
  if (stats.revisionTaskCount > 0) return 'revision'
  return 'overview'
}

export function getWorkflowBlockers(
  step: WorkflowRunnableStepKey,
  novel: WorkflowNovelContext,
  stats: WorkflowStats,
): string[] {
  if (!novel) {
    return ['当前小说数据还没加载完成，请刷新后再试。']
  }

  const blockers: string[] = []
  const pushIfMissing = (ready: boolean, message: string) => {
    if (!ready) blockers.push(message)
  }

  const requireBasics = (action: string) => {
    pushIfMissing(
      isBasicsReady(novel),
      `缺少书名、简介、用户背景或扩展背景，无法${action}。`,
    )
  }

  const requireProjectBrief = (action: string) => {
    pushIfMissing(isProjectBriefReady(novel), `缺少项目立项，无法${action}。`)
  }

  const requireStoryCore = (action: string) => {
    pushIfMissing(isStoryCoreReady(novel), `缺少基础设定、核心钩子或底层约束，无法${action}。`)
  }

  const requireThemeVoice = (action: string) => {
    pushIfMissing(isThemeVoiceReady(novel), `缺少主题与文风，无法${action}。`)
  }

  const requireWorldRules = (action: string) => {
    pushIfMissing(isWorldFoundationReady(novel), `缺少世界规则，无法${action}。`)
  }

  const requireMap = (action: string) => {
    pushIfMissing(isMapStructureReady(stats), `请先建立地图骨架，再${action}。`)
  }

  const requireCharacters = (action: string) => {
    pushIfMissing(isCharacterRosterReady(stats), `请先建立主角与人物网络，再${action}。`)
  }

  const requireResistance = (action: string) => {
    pushIfMissing(isResistanceSystemReady(stats), `请先建立阻力线，再${action}。`)
  }

  const requireVolumePlanning = (action: string) => {
    pushIfMissing(isVolumePlanningReady(stats), `请先完成第一卷目标、闭环和卷末爆点，再${action}。`)
  }

  const requireItems = (action: string) => {
    pushIfMissing(isItemsEquipmentReady(stats), `缺少物品资产，无法${action}。`)
  }

  const requireThreads = (action: string) => {
    pushIfMissing(isStoryThreadsReady(stats), `请先建立故事线程，再${action}。`)
  }

  const requireRevisionBlockersCleared = (action: string) => {
    pushIfMissing(
      stats.revisionBlockerCount <= 0,
      `当前还有 ${stats.revisionBlockerCount} 个高优先级修订问题未处理，请先在修订中心完成，再${action}。`,
    )
  }

  const requireFreshChapterContext = (action: string) => {
    pushIfMissing(
      stats.staleChapterCount <= 0,
      `当前有 ${stats.staleChapterCount} 章仍在引用旧上下文，请先同步相关章节的摘要与连续性记忆，再${action}。`,
    )
  }

  const requireFreshAssets = (action: string) => {
    pushIfMissing(
      stats.staleAssetCount <= 0,
      `这些世界资产仍在引用旧设定：${stats.staleAssetLabels.join('、')}。处理后再${action}。`,
    )
  }

  const requireFreshStoryMemory = (action: string) => {
    pushIfMissing(
      stats.staleCheckpointCount <= 0,
      `当前有 ${stats.staleCheckpointCount} 份长期记忆检查点待刷新，请先同步故事记忆，再${action}。`,
    )
  }

  switch (step) {
    case 'world-rules':
      requireBasics('同步世界规则')
      requireProjectBrief('同步世界规则')
      requireStoryCore('同步世界规则')
      requireThemeVoice('同步世界规则')
      break
    case 'map':
      requireWorldRules('生成地图')
      break
    case 'characters':
      requireWorldRules('生成人物')
      requireMap('生成人物')
      requireItems('生成人物')
      break
    case 'items':
      requireWorldRules('生成物品')
      requireMap('生成物品')
      break
    case 'threads':
      if (!isStoryPlotReady(novel)) {
        requireWorldRules('生成故事线程')
        requireMap('生成故事线程')
        requireCharacters('生成故事线程')
        requireItems('生成故事线程')
      }
      break
    case 'story-design':
      requireWorldRules('生成故事设计')
      requireMap('生成故事设计')
      requireCharacters('生成故事设计')
      requireItems('生成故事设计')
      requireThreads('生成故事设计')
      requireResistance('生成故事设计')
      break
    case 'outline':
      pushIfMissing(isStoryPlotReady(novel), '请先完成故事设计，再生成故事大纲。')
      requireCharacters('生成故事大纲')
      requireResistance('生成故事大纲')
      requireVolumePlanning('生成故事大纲')
      requireFreshAssets('生成故事大纲')
      requireRevisionBlockersCleared('生成故事大纲')
      break
    case 'timeline':
      requireWorldRules('生成时间轴')
      requireMap('生成时间轴')
      requireCharacters('生成时间轴')
      requireItems('生成时间轴')
      requireResistance('生成时间轴')
      requireFreshAssets('生成时间轴')
      pushIfMissing(
        isStoryPlotReady(novel) || stats.outlineCount > 0,
        '请先完成故事设计，或先生成故事大纲，再生成时间轴。',
      )
      requireRevisionBlockersCleared('生成时间轴')
      break
    case 'writing':
      requireCharacters('开始正文写作')
      requireResistance('开始正文写作')
      requireVolumePlanning('开始正文写作')
      requireThreads('开始正文写作')
      pushIfMissing(stats.outlineCount > 0, '请先生成故事大纲，再开始正文写作。')
      pushIfMissing(stats.timelineCount > 0, '缺少时间轴，无法开始正文写作。')
      requireFreshAssets('开始正文写作')
      requireFreshStoryMemory('开始正文写作')
      requireFreshChapterContext('开始正文写作')
      requireRevisionBlockersCleared('开始正文写作')
      break
  }

  return blockers
}

export function canRunWorkflowStep(
  step: WorkflowRunnableStepKey,
  novel: WorkflowNovelContext,
  stats: WorkflowStats,
): boolean {
  return getWorkflowBlockers(step, novel, stats).length === 0
}
