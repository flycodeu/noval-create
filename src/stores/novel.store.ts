import { create } from 'zustand'
import { Novel, Chapter } from '../types'

interface NovelStore {
  novels: Novel[]
  currentNovelId: number | null
  currentNovel: Novel | null
  chapters: Chapter[]
  currentChapterId: number | null

  setNovels: (novels: Novel[]) => void
  setCurrentNovel: (novel: Novel | null) => void
  setCurrentNovelId: (id: number | null) => void
  setChapters: (chapters: Chapter[]) => void
  setCurrentChapterId: (id: number | null) => void
  updateChapter: (id: number, data: Partial<Chapter>) => void
  resetWorkspace: () => void
}

function cloneNovel(novel: Novel | null) {
  return novel ? { ...novel } : null
}

function cloneChapters(chapters: Chapter[]) {
  return chapters.map((chapter) => ({ ...chapter }))
}

const EMPTY_WORKSPACE_STATE = {
  currentNovelId: null,
  currentNovel: null,
  chapters: [] as Chapter[],
  currentChapterId: null,
}

export const useNovelStore = create<NovelStore>((set) => ({
  novels: [],
  ...EMPTY_WORKSPACE_STATE,

  setNovels: (novels) => set({
    novels: novels.map((novel) => ({ ...novel })),
  }),
  setCurrentNovel: (novel) => set((state) => {
    const nextNovelId = novel?.id || null
    const shouldReset = state.currentNovelId !== null && state.currentNovelId !== nextNovelId
    return shouldReset
      ? {
          ...EMPTY_WORKSPACE_STATE,
          currentNovel: cloneNovel(novel),
          currentNovelId: nextNovelId,
        }
      : {
          currentNovel: cloneNovel(novel),
          currentNovelId: nextNovelId,
        }
  }),
  setCurrentNovelId: (id) => set((state) => {
    if (state.currentNovelId === id) return state
    return {
      ...EMPTY_WORKSPACE_STATE,
      currentNovelId: id,
    }
  }),
  setChapters: (chapters) => set((state) => {
    const nextChapters = cloneChapters(chapters)
    const currentChapterStillExists = state.currentChapterId === null
      || nextChapters.some((chapter) => chapter.id === state.currentChapterId)
    return {
      chapters: nextChapters,
      currentChapterId: currentChapterStillExists ? state.currentChapterId : null,
    }
  }),
  setCurrentChapterId: (id) => set({ currentChapterId: id }),
  updateChapter: (id, data) => set((state) => {
    const hasTarget = state.chapters.some((chapter) => chapter.id === id)
    if (!hasTarget) return state
    return {
      chapters: state.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...data } : chapter)),
    }
  }),
  resetWorkspace: () => set(EMPTY_WORKSPACE_STATE),
}))
