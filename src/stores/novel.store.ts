import { create } from 'zustand'
import { Novel, Chapter, Character } from '../types'

interface NovelStore {
  __version: number
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

function cloneNovel(novel: Novel | null) {
  return novel ? { ...novel } : null
}

function cloneChapters(chapters: Chapter[]) {
  return chapters.map((chapter) => ({ ...chapter }))
}

function cloneCharacters(characters: Character[]) {
  return characters.map((character) => ({ ...character }))
}

const EMPTY_WORKSPACE_STATE = {
  currentNovelId: null,
  currentNovel: null,
  chapters: [] as Chapter[],
  currentChapterId: null,
  characters: [] as Character[],
}

export const useNovelStore = create<NovelStore>((set) => ({
  __version: 0,
  novels: [],
  ...EMPTY_WORKSPACE_STATE,

  setNovels: (novels) => set((state) => ({
    novels: novels.map((novel) => ({ ...novel })),
    __version: state.__version + 1,
  })),
  setCurrentNovel: (novel) => set((state) => {
    const nextNovelId = novel?.id || null
    const shouldReset = state.currentNovelId !== null && state.currentNovelId !== nextNovelId
    return shouldReset
      ? {
          ...EMPTY_WORKSPACE_STATE,
          currentNovel: cloneNovel(novel),
          currentNovelId: nextNovelId,
          __version: state.__version + 1,
        }
      : {
          currentNovel: cloneNovel(novel),
          currentNovelId: nextNovelId,
          __version: state.__version + 1,
        }
  }),
  setCurrentNovelId: (id) => set((state) => {
    if (state.currentNovelId === id) {
      return {
        currentNovelId: id,
        __version: state.__version + 1,
      }
    }
    return {
      ...EMPTY_WORKSPACE_STATE,
      currentNovelId: id,
      __version: state.__version + 1,
    }
  }),
  setChapters: (chapters) => set((state) => {
    const nextChapters = cloneChapters(chapters)
    const currentChapterStillExists = state.currentChapterId === null
      || nextChapters.some((chapter) => chapter.id === state.currentChapterId)
    return {
      chapters: nextChapters,
      currentChapterId: currentChapterStillExists ? state.currentChapterId : null,
      __version: state.__version + 1,
    }
  }),
  setCurrentChapterId: (id) => set((state) => ({
    currentChapterId: id,
    __version: state.__version + 1,
  })),
  setCharacters: (characters) => set((state) => ({
    characters: cloneCharacters(characters),
    __version: state.__version + 1,
  })),
  updateChapter: (id, data) => set((state) => {
    const hasTarget = state.chapters.some((chapter) => chapter.id === id)
    if (!hasTarget) return state
    return {
      chapters: state.chapters.map((chapter) => (chapter.id === id ? { ...chapter, ...data } : chapter)),
      __version: state.__version + 1,
    }
  }),
  resetWorkspace: () => set((state) => ({
    ...EMPTY_WORKSPACE_STATE,
    __version: state.__version + 1,
  })),
}))
