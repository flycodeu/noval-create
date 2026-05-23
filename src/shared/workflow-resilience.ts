export const RESUMABLE_WORKFLOW_TYPES = [
  'map_auto_generate',
  'world_rules_auto_generate',
  'faction_auto_generate',
  'character_auto_generate',
  'item_auto_generate',
  'timeline_auto_generate',
  'story_thread_auto_generate',
  'subplot_auto_generate',
  'chapter_batch_generate',
  'chapter_quality_analysis',
] as const

export type ResumableWorkflowType = typeof RESUMABLE_WORKFLOW_TYPES[number]

const RESUMABLE_WORKFLOW_TYPE_SET = new Set<string>(RESUMABLE_WORKFLOW_TYPES)

interface WorkflowResumeTaskLike {
  runnerType?: string | null
  type?: string | null
  progressJson?: string | null
}

function parseProgressRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function hasNumericCheckpoint(progress: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => typeof progress[key] === 'number')
}

function hasArrayCheckpoint(progress: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => Array.isArray(progress[key]))
}

function hasObjectCheckpoint(progress: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => {
    const value = progress[key]
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  })
}

export function isResumableWorkflowType(type?: string | null): type is ResumableWorkflowType {
  return RESUMABLE_WORKFLOW_TYPE_SET.has(type || '')
}

export function hasResumableWorkflowCheckpoint(task: WorkflowResumeTaskLike): boolean {
  if (task.runnerType !== 'workflow' || !isResumableWorkflowType(task.type)) {
    return false
  }

  const progress = parseProgressRecord(task.progressJson)
  if (progress.completed === true) {
    return false
  }

  if (task.type === 'world_rules_auto_generate') {
    return hasArrayCheckpoint(progress, 'pendingSections', 'completedSections', 'failedSections')
      || hasNumericCheckpoint(progress, 'totalSections', 'pendingSectionCount', 'completedSectionCount')
      || hasObjectCheckpoint(progress, 'workingRules')
  }

  if (task.type === 'map_auto_generate') {
    return typeof progress.currentStage === 'string'
      || typeof progress.currentBatchKey === 'string'
      || hasNumericCheckpoint(progress, 'generatedNodeCount', 'processedParentCount', 'pendingParentCount', 'targetDepth')
  }

  if (task.type === 'subplot_auto_generate') {
    return hasNumericCheckpoint(progress, 'resumeCursor', 'totalBatches', 'requestedCount', 'generatedCount')
      || hasArrayCheckpoint(progress, 'subplots', 'warnings')
  }

  if (task.type === 'chapter_batch_generate') {
    return hasNumericCheckpoint(progress, 'resumeCursor', 'totalBatches', 'requestedCount', 'generatedCount')
      || hasArrayCheckpoint(progress, 'chapterIds', 'completedChapterIds', 'failedChapterIds', 'warnings')
  }

  if (task.type === 'chapter_quality_analysis') {
    return hasNumericCheckpoint(progress, 'resumeCursor', 'totalBatches', 'requestedCount', 'generatedCount')
      || hasArrayCheckpoint(progress, 'chapterIds', 'completedChapterIds', 'failedChapterIds', 'warnings')
  }

  return hasNumericCheckpoint(progress, 'resumeCursor', 'totalBatches', 'requestedCount', 'generatedCount')
    || hasArrayCheckpoint(progress, 'acceptedIds', 'warnings')
}
