import { create } from 'zustand'
import type { AuthorWorkMode } from '../pages/Novel/author-workflow'

type AuthorWorkModeSource = 'auto' | 'manual'

interface AuthorWorkModeStore {
  mode: AuthorWorkMode | null
  source: AuthorWorkModeSource
  setManualMode: (mode: AuthorWorkMode) => void
  syncSuggestedMode: (mode: AuthorWorkMode) => void
  resetToAuto: (mode: AuthorWorkMode) => void
}

const STORAGE_KEY = 'novelforge-author-work-mode'

const memoryStorage = new Map<string, string>()

function readStorage(key: string): string | null {
  if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
  return memoryStorage.get(key) ?? null
}

function writeStorage(key: string, value: string) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, value)
    return
  }
  memoryStorage.set(key, value)
}

function loadStoredState(): { mode: AuthorWorkMode | null; source: AuthorWorkModeSource } {
  const raw = readStorage(STORAGE_KEY)
  if (!raw) return { mode: null, source: 'auto' }
  try {
    const parsed = JSON.parse(raw) as { mode?: AuthorWorkMode | null; source?: AuthorWorkModeSource }
    return {
      mode: parsed.mode || null,
      source: parsed.source === 'manual' ? 'manual' : 'auto',
    }
  } catch {
    return { mode: null, source: 'auto' }
  }
}

function persistState(mode: AuthorWorkMode | null, source: AuthorWorkModeSource) {
  writeStorage(STORAGE_KEY, JSON.stringify({ mode, source }))
}

const stored = loadStoredState()

export const useAuthorWorkModeStore = create<AuthorWorkModeStore>((set) => ({
  mode: stored.mode,
  source: stored.source,
  setManualMode: (mode) => {
    persistState(mode, 'manual')
    set({ mode, source: 'manual' })
  },
  syncSuggestedMode: (mode) => {
    set((current) => {
      if (current.source === 'manual' && current.mode) return current
      persistState(mode, 'auto')
      return { mode, source: 'auto' }
    })
  },
  resetToAuto: (mode) => {
    persistState(mode, 'auto')
    set({ mode, source: 'auto' })
  },
}))
