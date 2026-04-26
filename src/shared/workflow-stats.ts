import type { TaskPipelineStats } from '../types'

export type AssetBloatRiskLevel = 'none' | 'warning' | 'high'

export interface WorkflowStats {
  mapCount: number
  factionCount: number
  characterCount: number
  characterArcCount: number
  relationshipArcCount: number
  resistanceTrackCount: number
  itemCount: number
  glossaryCount: number
  threadCount: number
  sceneTemplateCount: number
  outlineCount: number
  timelineCount: number
  revisionTaskCount: number
  revisionBlockerCount: number
  revisionOpenCount: number
  chapterCount: number
  completedChapterCount: number
  totalWords: number
  staleChapterCount: number
  contextVersion: number
  staleCheckpointCount: number
  staleAssetCount: number
  staleAssetLabels: string[]
  hasProtagonist: boolean
  volumeCount: number
  writingPipelineStats?: TaskPipelineStats
}

export interface AssetBloatSignal {
  totalAssetCount: number
  risk: AssetBloatRiskLevel
  reason: string
}

export const EMPTY_WORKFLOW_STATS: WorkflowStats = {
  mapCount: 0,
  factionCount: 0,
  characterCount: 0,
  characterArcCount: 0,
  relationshipArcCount: 0,
  resistanceTrackCount: 0,
  itemCount: 0,
  glossaryCount: 0,
  threadCount: 0,
  sceneTemplateCount: 0,
  outlineCount: 0,
  timelineCount: 0,
  revisionTaskCount: 0,
  revisionBlockerCount: 0,
  revisionOpenCount: 0,
  chapterCount: 0,
  completedChapterCount: 0,
  totalWords: 0,
  staleChapterCount: 0,
  contextVersion: 1,
  staleCheckpointCount: 0,
  staleAssetCount: 0,
  staleAssetLabels: [],
  hasProtagonist: false,
  volumeCount: 0,
}

function getWorkflowAssetCount(
  stats: Pick<
    WorkflowStats,
    | 'mapCount'
    | 'factionCount'
    | 'characterCount'
    | 'characterArcCount'
    | 'relationshipArcCount'
    | 'resistanceTrackCount'
    | 'itemCount'
    | 'glossaryCount'
    | 'threadCount'
    | 'sceneTemplateCount'
    | 'outlineCount'
    | 'timelineCount'
    | 'volumeCount'
  >,
): number {
  return stats.mapCount
    + stats.factionCount
    + stats.characterCount
    + stats.characterArcCount
    + stats.relationshipArcCount
    + stats.resistanceTrackCount
    + stats.itemCount
    + stats.glossaryCount
    + stats.threadCount
    + stats.sceneTemplateCount
    + stats.outlineCount
    + stats.timelineCount
    + stats.volumeCount
}

export function getAssetBloatSignal(
  stats: Pick<
    WorkflowStats,
    | 'mapCount'
    | 'factionCount'
    | 'characterCount'
    | 'characterArcCount'
    | 'relationshipArcCount'
    | 'resistanceTrackCount'
    | 'itemCount'
    | 'glossaryCount'
    | 'threadCount'
    | 'sceneTemplateCount'
    | 'outlineCount'
    | 'timelineCount'
    | 'volumeCount'
    | 'chapterCount'
    | 'totalWords'
  >,
): AssetBloatSignal {
  const totalAssetCount = getWorkflowAssetCount(stats)
  const hasStartedWriting = stats.chapterCount > 0 || stats.totalWords > 0
  const structuralCoverage = [stats.threadCount > 0, stats.outlineCount > 0, stats.timelineCount > 0, stats.volumeCount > 0]
    .filter(Boolean)
    .length

  if (hasStartedWriting || totalAssetCount < 12) {
    return {
      totalAssetCount,
      risk: 'none',
      reason: '当前资产规模仍在首章前可控范围内。',
    }
  }

  if (totalAssetCount >= 24 && structuralCoverage <= 2) {
    return {
      totalAssetCount,
      risk: 'high',
      reason: `首章前已经堆积 ${totalAssetCount} 项资产，但结构承接位仍不足，继续补资产的边际价值很低。`,
    }
  }

  if (totalAssetCount >= 16) {
    return {
      totalAssetCount,
      risk: 'warning',
      reason: `首章前资产已达到 ${totalAssetCount} 项，建议优先把现有资产压到卷级设计、大纲或正文。`,
    }
  }

  return {
    totalAssetCount,
    risk: 'none',
    reason: '当前资产规模仍在首章前可控范围内。',
  }
}
