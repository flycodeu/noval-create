import { create } from 'zustand'
import { Task } from '../types'

interface TaskStream {
  taskId: number
  content: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt: number
}

interface TaskStore {
  tasks: Task[]
  streams: Record<number, TaskStream>

  setTasks: (tasks: Task[]) => void
  addStream: (taskId: number) => void
  appendStreamChunk: (taskId: number, chunk: string) => void
  completeStream: (taskId: number, status: 'completed' | 'failed' | 'cancelled') => void
  clearStream: (taskId: number) => void
}

const MAX_RETAINED_COMPLETED_STREAMS = 10

function buildStream(taskId: number, current?: TaskStream): TaskStream {
  return current || {
    taskId,
    content: '',
    status: 'running',
    updatedAt: Date.now(),
  }
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

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  streams: {},

  setTasks: (tasks) => set({ tasks }),
  addStream: (taskId) => set((state) => ({
    streams: {
      ...state.streams,
      [taskId]: {
        ...buildStream(taskId, state.streams[taskId]),
        status: 'running',
        updatedAt: Date.now(),
      },
    },
  })),
  appendStreamChunk: (taskId, chunk) => set((state) => ({
    streams: {
      ...state.streams,
      [taskId]: {
        ...buildStream(taskId, state.streams[taskId]),
        content: `${state.streams[taskId]?.content || ''}${chunk}`,
        updatedAt: Date.now(),
      },
    },
  })),
  completeStream: (taskId, status) => set((state) => {
    const nextStreams = pruneStreams({
      ...state.streams,
      [taskId]: {
        ...buildStream(taskId, state.streams[taskId]),
        status,
        updatedAt: Date.now(),
      },
    })
    return {
      streams: nextStreams,
    }
  }),
  clearStream: (taskId) => set((state) => {
    const newStreams = { ...state.streams }
    delete newStreams[taskId]
    return { streams: newStreams }
  }),
}))
