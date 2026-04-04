import { create } from 'zustand'
import { Novel, Chapter, Character } from '../types'

interface NovelStore {
  novels: Novel[]
  currentNovelId: number | null
  currentNovel: Novel | null
  chapters: Chapter[]
  currentChapterId: number | null
  characters: Character[]

  setNovels: (novels: Novel[]) => void
  setCurrentNovel: (novel: Novel | null) => void
  setCurrentNovelId: (id: number | null) => void
  setChapters: (chapters: Chapter[]) => void
  setCurrentChapterId: (id: number | null) => void
  setCharacters: (characters: Character[]) => void
  updateChapter: (id: number, data: Partial<Chapter>) => void
  resetWorkspace: () => void
}

const EMPTY_WORKSPACE_STATE = {
  currentNovelId: null,
  currentNovel: null,
  chapters: [] as Chapter[],
  currentChapterId: null,
  characters: [] as Character[],
}

export const useNovelStore = create<NovelStore>((set) => ({
  novels: [],
  ...EMPTY_WORKSPACE_STATE,

  setNovels: (novels) => set({ novels }),
  setCurrentNovel: (novel) => set((state) => {
    const nextNovelId = novel?.id || null
    const shouldReset = state.currentNovelId !== null && state.currentNovelId !== nextNovelId
    return shouldReset
      ? { ...EMPTY_WORKSPACE_STATE, currentNovel: novel, currentNovelId: nextNovelId }
      : { currentNovel: novel, currentNovelId: nextNovelId }
  }),
  setCurrentNovelId: (id) => set((state) => {
    if (state.currentNovelId === id) {
      return { currentNovelId: id }
    }
    return {
      ...EMPTY_WORKSPACE_STATE,
      currentNovelId: id,
    }
  }),
  setChapters: (chapters) => set({ chapters }),
  setCurrentChapterId: (id) => set({ currentChapterId: id }),
  setCharacters: (characters) => set({ characters }),
  updateChapter: (id, data) => set((state) => ({
    chapters: state.chapters.map(c => c.id === id ? { ...c, ...data } : c),
  })),
  resetWorkspace: () => set(EMPTY_WORKSPACE_STATE),
}))
