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
}

export const useNovelStore = create<NovelStore>((set) => ({
  novels: [],
  currentNovelId: null,
  currentNovel: null,
  chapters: [],
  currentChapterId: null,
  characters: [],

  setNovels: (novels) => set({ novels }),
  setCurrentNovel: (novel) => set({ currentNovel: novel, currentNovelId: novel?.id || null }),
  setCurrentNovelId: (id) => set({ currentNovelId: id }),
  setChapters: (chapters) => set({ chapters }),
  setCurrentChapterId: (id) => set({ currentChapterId: id }),
  setCharacters: (characters) => set({ characters }),
  updateChapter: (id, data) => set((state) => ({
    chapters: state.chapters.map(c => c.id === id ? { ...c, ...data } : c),
  })),
}))
