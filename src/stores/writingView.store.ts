import { create } from 'zustand'

export type WritingGenerationStatus = 'idle' | 'running' | 'success' | 'failed' | 'cancelled'
export type WritingGenerationStage = 'planning' | 'drafting' | 'reviewing' | 'rewriting' | 'canonizing' | 'completed' | 'failed'

export interface WritingGenerationSnapshot {
  chapterId: number | null
  taskId: number | null
  streamTaskId: number | null
  stage: WritingGenerationStage | null
  status: WritingGenerationStatus
  error: string | null
  label: string | null
  detail: string | null
  startedAt: number | null
  finishedAt: number | null
}

interface StartGenerationInput {
  chapterId: number
  taskId?: number | null
}

interface UpdateGenerationStageInput {
  taskId?: number | null
  streamTaskId?: number | null
  chapterId?: number | null
  stage: WritingGenerationStage
  status?: 'running' | 'failed'
  label?: string | null
  detail?: string | null
}

interface CompleteGenerationInput {
  taskId?: number | null
  chapterId: number
  status: Exclude<WritingGenerationStatus, 'idle' | 'running'>
  stage?: WritingGenerationStage | null
  error?: string | null
  label?: string | null
  detail?: string | null
}

interface WritingViewStore {
  activeGeneration: WritingGenerationSnapshot
  lastGenerationByChapter: Record<number, WritingGenerationSnapshot>
  startGeneration: (input: StartGenerationInput) => void
  updateGenerationTask: (input: { chapterId: number; taskId: number }) => void
  updateGenerationStage: (input: UpdateGenerationStageInput) => void
  completeGeneration: (input: CompleteGenerationInput) => void
  clearChapterGenerationNotice: (chapterId: number) => void
  resetActiveGeneration: () => void
}

const idleGeneration: WritingGenerationSnapshot = {
  chapterId: null,
  taskId: null,
  streamTaskId: null,
  stage: null,
  status: 'idle',
  error: null,
  label: null,
  detail: null,
  startedAt: null,
  finishedAt: null,
}

function buildRunningSnapshot(
  previous: WritingGenerationSnapshot,
  input: StartGenerationInput,
): WritingGenerationSnapshot {
  const canReusePrevious = previous.status === 'running' && previous.chapterId === input.chapterId
  return {
    chapterId: input.chapterId,
    taskId: input.taskId ?? (canReusePrevious ? previous.taskId : null),
    streamTaskId: canReusePrevious ? previous.streamTaskId : null,
    stage: canReusePrevious ? previous.stage : null,
    status: 'running',
    error: null,
    label: canReusePrevious ? previous.label : null,
    detail: canReusePrevious ? previous.detail : null,
    startedAt: Date.now(),
    finishedAt: null,
  }
}

function buildFinishedSnapshot(
  previous: WritingGenerationSnapshot,
  input: CompleteGenerationInput,
): WritingGenerationSnapshot {
  return {
    chapterId: input.chapterId,
    taskId: input.taskId ?? previous.taskId ?? null,
    streamTaskId: previous.streamTaskId ?? null,
    stage: input.stage ?? previous.stage ?? null,
    status: input.status,
    error: input.error ?? null,
    label: input.label ?? previous.label ?? null,
    detail: input.detail ?? previous.detail ?? null,
    startedAt: previous.startedAt ?? Date.now(),
    finishedAt: Date.now(),
  }
}

export const useWritingViewStore = create<WritingViewStore>((set) => ({
  activeGeneration: idleGeneration,
  lastGenerationByChapter: {},

  startGeneration: (input) => set((state) => ({
    activeGeneration: buildRunningSnapshot(state.activeGeneration, input),
    lastGenerationByChapter: {
      ...state.lastGenerationByChapter,
      [input.chapterId]: buildRunningSnapshot(state.lastGenerationByChapter[input.chapterId] ?? idleGeneration, input),
    },
  })),

  updateGenerationTask: ({ chapterId, taskId }) => set((state) => {
    const activeGeneration = state.activeGeneration.chapterId === chapterId
      ? { ...state.activeGeneration, taskId }
      : state.activeGeneration
    const previousChapterSnapshot = state.lastGenerationByChapter[chapterId] ?? idleGeneration
    return {
      activeGeneration,
      lastGenerationByChapter: {
        ...state.lastGenerationByChapter,
        [chapterId]: {
          ...previousChapterSnapshot,
          chapterId,
          taskId,
        },
      },
    }
  }),

  updateGenerationStage: (input) => set((state) => {
    const resolvedChapterId = input.chapterId ?? state.activeGeneration.chapterId
    if (!resolvedChapterId) return {}
    const activeGeneration: WritingGenerationSnapshot = state.activeGeneration.chapterId === resolvedChapterId
      ? {
        ...state.activeGeneration,
        taskId: input.taskId ?? state.activeGeneration.taskId,
        streamTaskId: input.streamTaskId ?? state.activeGeneration.streamTaskId,
        stage: input.stage,
        status: input.status === 'failed' ? 'failed' : 'running',
        label: input.label ?? state.activeGeneration.label,
        detail: input.detail ?? state.activeGeneration.detail,
        error: input.status === 'failed'
          ? (input.detail ?? input.label ?? state.activeGeneration.error)
          : null,
      }
      : state.activeGeneration
    const previousChapterSnapshot = state.lastGenerationByChapter[resolvedChapterId] ?? idleGeneration
    const nextChapterSnapshot: WritingGenerationSnapshot = {
      ...previousChapterSnapshot,
      chapterId: resolvedChapterId,
      taskId: input.taskId ?? previousChapterSnapshot.taskId,
      streamTaskId: input.streamTaskId ?? previousChapterSnapshot.streamTaskId,
      stage: input.stage,
      status: input.status === 'failed' ? 'failed' : 'running',
      label: input.label ?? previousChapterSnapshot.label,
      detail: input.detail ?? previousChapterSnapshot.detail,
      error: input.status === 'failed'
        ? (input.detail ?? input.label ?? previousChapterSnapshot.error)
        : null,
    }
    return {
      activeGeneration,
      lastGenerationByChapter: {
        ...state.lastGenerationByChapter,
        [resolvedChapterId]: nextChapterSnapshot,
      },
    }
  }),

  completeGeneration: (input) => set((state) => {
    const previousActive = state.activeGeneration.chapterId === input.chapterId
      ? state.activeGeneration
      : idleGeneration
    const nextSnapshot = buildFinishedSnapshot(
      state.lastGenerationByChapter[input.chapterId] ?? previousActive,
      input,
    )
    return {
      activeGeneration: previousActive.chapterId === input.chapterId ? nextSnapshot : state.activeGeneration,
      lastGenerationByChapter: {
        ...state.lastGenerationByChapter,
        [input.chapterId]: nextSnapshot,
      },
    }
  }),

  clearChapterGenerationNotice: (chapterId) => set((state) => {
    const nextChapterHistory = { ...state.lastGenerationByChapter }
    delete nextChapterHistory[chapterId]
    return {
      activeGeneration: state.activeGeneration.chapterId === chapterId
        ? idleGeneration
        : state.activeGeneration,
      lastGenerationByChapter: nextChapterHistory,
    }
  }),

  resetActiveGeneration: () => set({ activeGeneration: idleGeneration }),
}))
