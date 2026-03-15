import { create } from 'zustand'

export type Theme = 'dark' | 'light' | 'soft'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

// 默认浅色，读取 localStorage
const savedTheme = (localStorage.getItem('novelforge-theme') as Theme) || 'light'
document.documentElement.setAttribute('data-theme', savedTheme)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: savedTheme,
  setTheme: (theme) => {
    localStorage.setItem('novelforge-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
}))
