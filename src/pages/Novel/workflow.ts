import type { Novel } from '../../types'

export type WorkflowRecommendationKey =
  | 'core-settings'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'outline'
  | 'timeline'
  | 'writing'

export interface WorkflowStats {
  mapCount: number
  characterCount: number
  itemCount: number
  outlineCount: number
  timelineCount: number
}

export const EMPTY_WORKFLOW_STATS: WorkflowStats = {
  mapCount: 0,
  characterCount: 0,
  itemCount: 0,
  outlineCount: 0,
  timelineCount: 0,
}

export function countMapNodes(nodes: Array<{ children?: unknown[] }>): number {
  return nodes.reduce((total, node) => (
    total + 1 + countMapNodes(Array.isArray(node.children) ? node.children as Array<{ children?: unknown[] }> : [])
  ), 0)
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
  return 'writing'
}
