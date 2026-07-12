import { create } from 'zustand'
import { readBrowserStorage, writeBrowserStorage } from '../utils/browser-storage'

export type WorkspaceMode = 'guided' | 'pro'

interface WorkspaceStore {
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
}

const STORAGE_KEY = 'novelforge-workspace-mode'

function normalizeWorkspaceMode(value: string | null): WorkspaceMode {
  return value === 'guided' || value === 'pro' ? value : 'pro'
}

const savedMode = normalizeWorkspaceMode(readBrowserStorage(STORAGE_KEY))

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  mode: savedMode,
  setMode: (mode) => {
    writeBrowserStorage(STORAGE_KEY, mode)
    set({ mode })
  },
}))
