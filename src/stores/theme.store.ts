import { create } from 'zustand'
import { readBrowserStorage, writeBrowserStorage } from '../utils/browser-storage'

export type Theme = 'dark' | 'light' | 'soft'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function normalizeTheme(value: string | null): Theme {
  if (value === 'dark' || value === 'soft') return value
  return 'light'
}

const STORAGE_KEY = 'novelforge-theme'
const savedTheme = normalizeTheme(readBrowserStorage(STORAGE_KEY))
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', savedTheme)
}
writeBrowserStorage(STORAGE_KEY, savedTheme)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: savedTheme,
  setTheme: (theme) => {
    writeBrowserStorage(STORAGE_KEY, theme)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme)
    }
    set({ theme })
  },
}))
