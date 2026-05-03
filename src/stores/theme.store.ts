import { create } from 'zustand'

export type Theme = 'dark' | 'light'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

function normalizeTheme(value: string | null): Theme {
  return value === 'dark' ? 'dark' : 'light'
}

const savedTheme = normalizeTheme(localStorage.getItem('novelforge-theme'))
document.documentElement.setAttribute('data-theme', savedTheme)
localStorage.setItem('novelforge-theme', savedTheme)

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: savedTheme,
  setTheme: (theme) => {
    localStorage.setItem('novelforge-theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },
}))
