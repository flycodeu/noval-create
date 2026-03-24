import { create } from 'zustand'
import { Task } from '../types'

interface TaskStream {
  taskId: number
  content: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
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

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  streams: {},

  setTasks: (tasks) => set({ tasks }),
  addStream: (taskId) => set((state) => ({
    streams: { ...state.streams, [taskId]: { taskId, content: '', status: 'running' } },
  })),
  appendStreamChunk: (taskId, chunk) => set((state) => ({
    streams: {
      ...state.streams,
      [taskId]: {
        ...state.streams[taskId],
        content: (state.streams[taskId]?.content || '') + chunk,
      },
    },
  })),
  completeStream: (taskId, status) => set((state) => ({
    streams: {
      ...state.streams,
      [taskId]: { ...state.streams[taskId], status },
    },
  })),
  clearStream: (taskId) => set((state) => {
    const newStreams = { ...state.streams }
    delete newStreams[taskId]
    return { streams: newStreams }
  }),
}))
