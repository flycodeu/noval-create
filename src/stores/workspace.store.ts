import { create } from 'zustand'

export type WorkspaceMode = 'guided' | 'pro'

interface WorkspaceStore {
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
}

const savedMode = (localStorage.getItem('novelforge-workspace-mode') as WorkspaceMode) || 'guided'

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  mode: savedMode,
  setMode: (mode) => {
    localStorage.setItem('novelforge-workspace-mode', mode)
    set({ mode })
  },
}))
