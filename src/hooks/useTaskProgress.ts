import { useCallback } from 'react'
import { useTaskStream } from '../stores/task.selectors'
import type { TaskErrorState, TaskMetaState, TaskProgressState, TaskStreamStatus } from '../stores/task.store'

export interface TaskProgressView {
  status: TaskStreamStatus | null
  progress: TaskProgressState | null
  stage: string | null
  stageLabel: string | null
  streamText: string
  truncatedHead: boolean
  error: TaskErrorState | null
  meta: TaskMetaState
  running: boolean
  cancel: () => Promise<boolean>
}

/**
 * Unified consumption hook for any backend task that flows through the task
 * store (fed by the global task event bridge). Pass null while no task is
 * active; every field degrades to an inert value.
 */
export function useTaskProgress(taskId: number | null | undefined): TaskProgressView {
  const stream = useTaskStream(taskId)

  const cancel = useCallback(async () => {
    if (!taskId || typeof window.electron?.task?.cancel !== 'function') return false
    try {
      await window.electron.task.cancel(taskId)
      return true
    } catch (error) {
      console.warn('[useTaskProgress] cancel failed', error)
      return false
    }
  }, [taskId])

  return {
    status: stream?.status || null,
    progress: stream?.progress || null,
    stage: stream?.stage || null,
    stageLabel: stream?.stageLabel || null,
    streamText: stream?.content || '',
    truncatedHead: stream?.truncatedHead || false,
    error: stream?.error || null,
    meta: stream?.meta || {},
    running: stream?.status === 'running',
    cancel,
  }
}
