import { create } from 'zustand'

interface UIStore {
  sidebarCollapsed: boolean
  novelSidebarPage: string
  setSidebarCollapsed: (collapsed: boolean) => void
  setNovelSidebarPage: (page: string) => void
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarCollapsed: false,
  novelSidebarPage: 'overview',
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setNovelSidebarPage: (page) => set({ novelSidebarPage: page }),
}))
