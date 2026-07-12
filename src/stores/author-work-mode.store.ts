import { create } from 'zustand'
import type { AuthorWorkMode } from '../pages/Novel/author-workflow'
import { readBrowserStorage, writeBrowserStorage } from '../utils/browser-storage'

type AuthorWorkModeSource = 'auto' | 'manual'

interface AuthorWorkModeStore {
  mode: AuthorWorkMode | null
  source: AuthorWorkModeSource
  setManualMode: (mode: AuthorWorkMode) => void
  syncSuggestedMode: (mode: AuthorWorkMode) => void
  resetToAuto: (mode: AuthorWorkMode) => void
}

const STORAGE_KEY = 'novelforge-author-work-mode'

function isAuthorWorkMode(value: unknown): value is AuthorWorkMode {
  return value === 'quick_start'
    || value === 'asset_building'
    || value === 'daily_push'
    || value === 'revision_closure'
}

function loadStoredState(): { mode: AuthorWorkMode | null; source: AuthorWorkModeSource } {
  const raw = readBrowserStorage(STORAGE_KEY)
  if (!raw) return { mode: null, source: 'auto' }
  try {
    const parsed = JSON.parse(raw) as { mode?: AuthorWorkMode | null; source?: AuthorWorkModeSource }
    const mode = isAuthorWorkMode(parsed.mode) ? parsed.mode : null
    return {
      mode,
      source: mode && parsed.source === 'manual' ? 'manual' : 'auto',
    }
  } catch {
    return { mode: null, source: 'auto' }
  }
}

function persistState(mode: AuthorWorkMode | null, source: AuthorWorkModeSource) {
  writeBrowserStorage(STORAGE_KEY, JSON.stringify({ mode, source }))
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
