import { create } from 'zustand'

interface AIDraft {
  content: string
  fieldLabel: string
  timestamp: number
}

interface AIDraftStore {
  drafts: Record<string, AIDraft>
  saveDraft: (key: string, content: string, label: string) => void
  getDraft: (key: string) => AIDraft | undefined
  clearDraft: (key: string) => void
  clearByPrefix: (prefix: string) => void
  getDraftCount: (prefix?: string) => number
}

export const useAIDraftStore = create<AIDraftStore>((set, get) => ({
  drafts: {},

  saveDraft: (key, content, label) =>
    set(state => ({
      drafts: {
        ...state.drafts,
        [key]: { content, fieldLabel: label, timestamp: Date.now() },
      },
    })),

  getDraft: (key) => get().drafts[key],

  clearDraft: (key) =>
    set(state => {
      const next = { ...state.drafts }
      delete next[key]
      return { drafts: next }
    }),

  clearByPrefix: (prefix) =>
    set(state => {
      const next = Object.fromEntries(
        Object.entries(state.drafts).filter(([k]) => !k.startsWith(prefix))
      )
      return { drafts: next }
    }),

  getDraftCount: (prefix) => {
    const drafts = get().drafts
    if (!prefix) return Object.keys(drafts).length
    return Object.keys(drafts).filter(k => k.startsWith(prefix)).length
  },
}))
