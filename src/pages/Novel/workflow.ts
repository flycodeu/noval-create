import type { Novel } from '../../types'
import { parseProjectBriefSnapshot } from '../../shared/project-brief'
import { parseStorySettingsSnapshot } from '../../shared/story-settings'
import type { StorySettingsSnapshot } from '../../shared/story-settings'
import { parseThemeVoiceSnapshot } from '../../shared/theme-voice'

export type WorkflowRecommendationKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'story-design'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'threads'
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
  | 'map-structure'
  | 'character-roster'
  | 'items-equipment'
  | 'story-threads'
  | 'story-plot'
  | 'write-start'

export interface WorkflowStats {
  mapCount: number
  characterCount: number
  itemCount: number
  threadCount: number
  outlineCount: number
  timelineCount: number
  revisionTaskCount: number
  chapterCount: number
  completedChapterCount: number
  totalWords: number
  hasProtagonist: boolean
}

export interface GuidedStepProgress {
  completedCount: number
  totalCount: number
  isComplete: boolean
}

export type { StorySettingsSnapshot }

export const GUIDED_STEP_ORDER: GuidedWorkflowStepKey[] = [
  'basics',
  'project-brief',
  'story-core',
  'theme-voice',
  'world-foundation',
  'map-structure',
  'character-roster',
  'items-equipment',
  'story-threads',
  'story-plot',
  'write-start',
]

export const EMPTY_WORKFLOW_STATS: WorkflowStats = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  threadCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  revisionTaskCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  hasProtagonist: false,
}

export async function loadWorkflowStats(novelId: number): Promise<WorkflowStats> {
  const [baseStats, characterStats, itemStats, mapStats, threadStats, revisionStats, arcs, timelineStats] = await Promise.all([
    window.electron.novel.stats(novelId),
    window.electron.character.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.item.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.map.getStats(novelId),
    window.electron.thread.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.revision.getStats({ novelId, page: 1, pageSize: 1 }),
    window.electron.outline.getArcs(novelId),
    window.electron.timeline.getStats({ novelId }),
  ])

  return {
    mapCount: mapStats.total,
    characterCount: characterStats.total,
    itemCount: itemStats.total,
    threadCount: threadStats.total,
    outlineCount: arcs.length,
    timelineCount: timelineStats.total,
    revisionTaskCount: revisionStats.openCount + revisionStats.inProgressCount,
    chapterCount: baseStats.totalChapters,
    completedChapterCount: baseStats.completedChapters,
    totalWords: baseStats.totalWords,
    hasProtagonist: characterStats.protagonistCount > 0,
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
    && settings.premise.constraints
  )
}

export function isThemeVoiceReady(
  novel: Pick<Novel, 'themeVoiceJson'> | null | undefined,
): boolean {
  const themeVoice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  return Boolean(
    themeVoice.theme
    && themeVoice.emotionalCore
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

export function isWorldFoundationReady(
  novel: Pick<Novel, 'worldRulesJson'> | null | undefined,
): boolean {
  return Boolean(novel?.worldRulesJson)
}

export function isMapStructureReady(stats: Pick<WorkflowStats, 'mapCount'>): boolean {
  return stats.mapCount > 0
}

export function isCharacterRosterReady(
  stats: Pick<WorkflowStats, 'characterCount' | 'hasProtagonist'>,
): boolean {
  return stats.hasProtagonist && stats.characterCount > 0
}

export function isItemsEquipmentReady(stats: Pick<WorkflowStats, 'itemCount'>): boolean {
  return stats.itemCount > 0
}

export function isStoryThreadsReady(stats: Pick<WorkflowStats, 'threadCount'>): boolean {
  return stats.threadCount > 0
}

export function isWritingStepReady(
  stats: Pick<WorkflowStats, 'outlineCount' | 'timelineCount' | 'threadCount' | 'chapterCount' | 'totalWords'>,
): boolean {
  return stats.outlineCount > 0
    && stats.timelineCount > 0
    && stats.threadCount > 0
    && (stats.chapterCount > 0 || stats.totalWords > 0)
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
  const themeVoiceProgress = [
    themeVoice.theme,
    themeVoice.emotionalCore,
    themeVoice.pov,
    themeVoice.tense,
    themeVoice.styleRules,
    themeVoice.dialogueRules,
  ].filter(Boolean).length
  const characterProgress = [stats.hasProtagonist, stats.characterCount > 0].filter(Boolean).length
  const writingProgress = [
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
    'map-structure': {
      completedCount: stats.mapCount > 0 ? 1 : 0,
      totalCount: 1,
      isComplete: stats.mapCount > 0,
    },
    'character-roster': {
      completedCount: characterProgress,
      totalCount: 2,
      isComplete: characterProgress >= 2,
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
    'write-start': {
      completedCount: writingProgress,
      totalCount: 5,
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
  if (!isMapStructureReady(stats)) return 'map-structure'
  if (!isCharacterRosterReady(stats)) return 'character-roster'
  if (!isItemsEquipmentReady(stats)) return 'items-equipment'
  if (!isStoryThreadsReady(stats)) return 'story-threads'
  if (!isStoryPlotReady(novel)) return 'story-plot'
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
  if (stats.mapCount <= 0) return 'map'
  if (stats.characterCount <= 0) return 'characters'
  if (stats.itemCount <= 0) return 'items'
  if (stats.threadCount <= 0) return 'threads'
  if (!isStoryPlotReady(novel)) return 'story-design'
  if (stats.outlineCount <= 0) return 'structure'
  if (stats.timelineCount <= 0) return 'timeline'
  if (stats.chapterCount <= 0 && stats.totalWords <= 0) return 'writing'
  if (stats.revisionTaskCount > 0) return 'revision'
  return 'overview'
}
