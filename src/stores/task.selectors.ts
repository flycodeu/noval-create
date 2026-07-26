import { useShallow } from 'zustand/react/shallow'
import { useTaskStore, TaskStream, TaskProgressState } from './task.store'

/**
 * Fine-grained task store selectors. Components must use these (or plain
 * action getters) instead of destructuring the whole store, so a stream chunk
 * for one task does not re-render every consumer.
 */

export function useTaskStream(taskId: number | null | undefined): TaskStream | null {
  return useTaskStore((state) => (taskId ? state.streams[taskId] || null : null))
}

export function useTaskStreamContent(taskId: number | null | undefined): string {
  return useTaskStore((state) => (taskId ? state.streams[taskId]?.content || '' : ''))
}

export function useTaskProgressState(taskId: number | null | undefined): TaskProgressState | null {
  return useTaskStore((state) => (taskId ? state.streams[taskId]?.progress || null : null))
}

export function useRunningTaskCount(): number {
  return useTaskStore((state) => state.runningCount)
}

export function useRunningTasks(): TaskStream[] {
  return useTaskStore(useShallow((state) => {
    return Object.values(state.streams)
      .filter((stream) => stream.status === 'running')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }))
}

export function useRecentTaskStreams(limit = 20): TaskStream[] {
  return useTaskStore(useShallow((state) => {
    return Object.values(state.streams)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
  }))
}
