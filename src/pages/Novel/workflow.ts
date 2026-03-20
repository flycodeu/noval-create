import type { Novel } from '../../types'

export type WorkflowRecommendationKey =
  | 'guide'
  | 'overview'
  | 'core-settings'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'outline'
  | 'timeline'
  | 'writing'

export type GuidedWorkflowStepKey =
  | 'basics'
  | 'story-core'
  | 'story-plot'
  | 'world-foundation'
  | 'map-structure'
  | 'character-roster'
  | 'items-equipment'
  | 'write-start'

export interface WorkflowStats {
  mapCount: number
  characterCount: number
  itemCount: number
  outlineCount: number
  timelineCount: number
  chapterCount: number
  completedChapterCount: number
  totalWords: number
  hasProtagonist: boolean
}

export interface StorySettingsSnapshot {
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  subPlotCount: number
}

export interface GuidedStepProgress {
  completedCount: number
  totalCount: number
  isComplete: boolean
}

export const GUIDED_STEP_ORDER: GuidedWorkflowStepKey[] = [
  'basics',
  'story-core',
  'story-plot',
  'world-foundation',
  'map-structure',
  'character-roster',
  'items-equipment',
  'write-start',
]

export const EMPTY_WORKFLOW_STATS: WorkflowStats = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  hasProtagonist: false,
}

export function countMapNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce((total, node) => (
    total + 1 + countMapNodes(Array.isArray(node.children) ? node.children as Array<{ children?: unknown[] }> : [])
  ), 0)
}

function parseJsonObject(raw?: string): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseStorySettings(raw?: string): StorySettingsSnapshot {
  const parsed = parseJsonObject(raw)
  const subPlots = Array.isArray(parsed.sub_plots_list) ? parsed.sub_plots_list : []

  return {
    storyGoal: readString(parsed.story_goal),
    coreConflict: readString(parsed.core_conflict),
    mainPlot: readString(parsed.main_plot),
    ending: readString(parsed.ending),
    subPlotCount: subPlots.length,
  }
}

export function isBasicsReady(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground'> | null | undefined,
): boolean {
  if (!novel) return false

  return [novel.title, novel.synopsis, novel.userBackground, novel.expandedBackground]
    .every((value) => typeof value === 'string' && value.trim().length > 0)
}

export function isStoryCoreReady(novel: Pick<Novel, 'settingsJson'> | null | undefined): boolean {
  const settings = parseStorySettings(novel?.settingsJson)
  return Boolean(settings.storyGoal && settings.coreConflict)
}

export function isStoryPlotReady(novel: Pick<Novel, 'settingsJson'> | null | undefined): boolean {
  const settings = parseStorySettings(novel?.settingsJson)
  return Boolean(settings.mainPlot && settings.ending)
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

export function isWritingStepReady(
  stats: Pick<WorkflowStats, 'outlineCount' | 'timelineCount' | 'chapterCount' | 'totalWords'>,
): boolean {
  return stats.outlineCount > 0 && stats.timelineCount > 0 && (stats.chapterCount > 0 || stats.totalWords > 0)
}

export function getGuidedStepProgressMap(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'settingsJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): Record<GuidedWorkflowStepKey, GuidedStepProgress> {
  const settings = parseStorySettings(novel?.settingsJson)
  const basicsProgress = [novel?.title, novel?.synopsis, novel?.userBackground, novel?.expandedBackground]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .length
  const storyCoreProgress = [settings.storyGoal, settings.coreConflict].filter(Boolean).length
  const storyPlotProgress = [settings.mainPlot, settings.ending].filter(Boolean).length
  const characterProgress = [stats.hasProtagonist, stats.characterCount > 0].filter(Boolean).length
  const writingProgress = [
    stats.outlineCount > 0,
    stats.timelineCount > 0,
    stats.chapterCount > 0,
    stats.totalWords > 0,
  ].filter(Boolean).length

  return {
    basics: {
      completedCount: basicsProgress,
      totalCount: 4,
      isComplete: basicsProgress >= 4,
    },
    'story-core': {
      completedCount: storyCoreProgress,
      totalCount: 2,
      isComplete: storyCoreProgress >= 2,
    },
    'story-plot': {
      completedCount: storyPlotProgress,
      totalCount: 2,
      isComplete: storyPlotProgress >= 2,
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
    'write-start': {
      completedCount: writingProgress,
      totalCount: 4,
      isComplete: isWritingStepReady(stats),
    },
  }
}

export function getRecommendedGuidedWorkflowStep(
  novel: Pick<Novel, 'title' | 'synopsis' | 'userBackground' | 'expandedBackground' | 'settingsJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): GuidedWorkflowStepKey {
  if (!isBasicsReady(novel)) return 'basics'
  if (!isStoryCoreReady(novel)) return 'story-core'
  if (!isStoryPlotReady(novel)) return 'story-plot'
  if (!isWorldFoundationReady(novel)) return 'world-foundation'
  if (!isMapStructureReady(stats)) return 'map-structure'
  if (!isCharacterRosterReady(stats)) return 'character-roster'
  if (!isItemsEquipmentReady(stats)) return 'items-equipment'
  return 'write-start'
}

export function getRecommendedWorkflowStep(
  novel: Pick<Novel, 'settingsJson' | 'worldRulesJson'> | null | undefined,
  stats: WorkflowStats,
): WorkflowRecommendationKey | null {
  if (!novel) return null
  if (!novel.settingsJson) return 'core-settings'
  if (!novel.worldRulesJson) return 'world-rules'
  if (stats.mapCount <= 0) return 'map'
  if (stats.characterCount <= 0) return 'characters'
  if (stats.itemCount <= 0) return 'items'
  if (stats.outlineCount <= 0) return 'outline'
  if (stats.timelineCount <= 0) return 'timeline'
  if (stats.chapterCount <= 0) return 'writing'
  return 'guide'
}