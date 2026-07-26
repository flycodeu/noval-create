import { create } from 'zustand'
import { Task } from '../types'

export type TaskStreamStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface TaskProgressState {
  current: number
  total: number
  percent: number | null
}

export interface TaskErrorState {
  code: string | null
  message: string
}

export interface TaskMetaState {
  novelId?: number
  chapterId?: number
  taskType?: string
  title?: string
}

export interface TaskStream {
  taskId: number
  content: string
  /** True when the head of the stream was dropped to respect MAX_STREAM_CONTENT_LENGTH. */
  truncatedHead: boolean
  status: TaskStreamStatus
  updatedAt: number
  progress: TaskProgressState | null
  stage: string | null
  stageLabel: string | null
  error: TaskErrorState | null
  meta: TaskMetaState
}

interface TaskStore {
  tasks: Task[]
  streams: Record<number, TaskStream>
  runningCount: number

  setTasks: (tasks: Task[]) => void
  addStream: (taskId: number, meta?: TaskMetaState) => void
  appendStreamChunk: (taskId: number, chunk: string) => void
  updateTaskProgress: (taskId: number, progress: { current: number; total: number; percent?: number | null }) => void
  updateTaskStage: (taskId: number, stage: string | null, stageLabel?: string | null) => void
  setTaskError: (taskId: number, error: TaskErrorState | null) => void
  upsertTaskMeta: (taskId: number, meta: TaskMetaState) => void
  completeStream: (taskId: number, status: 'completed' | 'failed' | 'cancelled') => void
  clearStream: (taskId: number) => void
}

const MAX_RETAINED_COMPLETED_STREAMS = 10
/**
 * Hard cap for a single stream's retained text. Long chapter generations keep
 * only the newest window; the head is dropped and flagged via truncatedHead.
 */
export const MAX_STREAM_CONTENT_LENGTH = 200_000

function buildStream(taskId: number, current?: TaskStream): TaskStream {
  return current || {
    taskId,
    content: '',
    truncatedHead: false,
    status: 'running',
    updatedAt: Date.now(),
    progress: null,
    stage: null,
    stageLabel: null,
    error: null,
    meta: {},
  }
}

function appendWithCap(content: string, chunk: string): { content: string; truncated: boolean } {
  const next = `${content}${chunk}`
  if (next.length <= MAX_STREAM_CONTENT_LENGTH) return { content: next, truncated: false }
  return { content: next.slice(next.length - MAX_STREAM_CONTENT_LENGTH), truncated: true }
}

function countRunning(streams: Record<number, TaskStream>): number {
  return Object.values(streams).filter((stream) => stream.status === 'running').length
}

function pruneStreams(streams: Record<number, TaskStream>): Record<number, TaskStream> {
  const completedStreams = Object.values(streams)
    .filter((stream) => stream.status !== 'running')
    .sort((left, right) => right.updatedAt - left.updatedAt)

  if (completedStreams.length <= MAX_RETAINED_COMPLETED_STREAMS) {
    return streams
  }

  const keepCompletedIds = new Set(
    completedStreams
      .slice(0, MAX_RETAINED_COMPLETED_STREAMS)
      .map((stream) => stream.taskId),
  )
  const nextStreams: Record<number, TaskStream> = {}

  Object.values(streams).forEach((stream) => {
    if (stream.status === 'running' || keepCompletedIds.has(stream.taskId)) {
      nextStreams[stream.taskId] = stream
    }
  })

  return nextStreams
}

function withStream(
  state: Pick<TaskStore, 'streams'>,
  taskId: number,
  mutate: (stream: TaskStream) => TaskStream,
): Pick<TaskStore, 'streams' | 'runningCount'> {
  const streams = {
    ...state.streams,
    [taskId]: mutate(buildStream(taskId, state.streams[taskId])),
  }
  return { streams, runningCount: countRunning(streams) }
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  streams: {},
  runningCount: 0,

  setTasks: (tasks) => set({ tasks }),
  addStream: (taskId, meta) => set((state) => withStream(state, taskId, (stream) => ({
    ...stream,
    status: 'running',
    error: null,
    meta: meta ? { ...stream.meta, ...meta } : stream.meta,
    updatedAt: Date.now(),
  }))),
  appendStreamChunk: (taskId, chunk) => set((state) => withStream(state, taskId, (stream) => {
    const appended = appendWithCap(stream.content, chunk)
    return {
      ...stream,
      content: appended.content,
      truncatedHead: stream.truncatedHead || appended.truncated,
      updatedAt: Date.now(),
    }
  })),
  updateTaskProgress: (taskId, progress) => set((state) => withStream(state, taskId, (stream) => ({
    ...stream,
    progress: {
      current: progress.current,
      total: progress.total,
      percent: progress.percent ?? (progress.total > 0
        ? Math.min(100, Math.round((progress.current / progress.total) * 100))
        : null),
    },
    updatedAt: Date.now(),
  }))),
  updateTaskStage: (taskId, stage, stageLabel) => set((state) => withStream(state, taskId, (stream) => ({
    ...stream,
    stage,
    stageLabel: stageLabel ?? stream.stageLabel,
    updatedAt: Date.now(),
  }))),
  setTaskError: (taskId, error) => set((state) => withStream(state, taskId, (stream) => ({
    ...stream,
    error,
    updatedAt: Date.now(),
  }))),
  upsertTaskMeta: (taskId, meta) => set((state) => withStream(state, taskId, (stream) => ({
    ...stream,
    meta: { ...stream.meta, ...meta },
  }))),
  completeStream: (taskId, status) => set((state) => {
    const { streams } = withStream(state, taskId, (stream) => ({
      ...stream,
      status,
      updatedAt: Date.now(),
    }))
    const pruned = pruneStreams(streams)
    return { streams: pruned, runningCount: countRunning(pruned) }
  }),
  clearStream: (taskId) => set((state) => {
    const newStreams = { ...state.streams }
    delete newStreams[taskId]
    return { streams: newStreams, runningCount: countRunning(newStreams) }
  }),
}))
