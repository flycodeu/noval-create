import { create } from 'zustand'
import type { PremiseGenerationResult } from '../shared/premise-generation'

export type AiResultTaskType = 'premise_generate'

export type PremiseGenerationResultWithMeta = PremiseGenerationResult & {
  missingFields?: string[]
  draftTaskId?: number
}

interface PendingAiResultBase {
  key: string
  novelId: number
  status: 'pending' | 'applied'
  warnings: string[]
  sourcePage?: string
  mode?: string
  appliedMode?: string
  createdAt: string
  completedAt: string
  appliedAt?: string
}

export type PendingAiResult = PendingAiResultBase & {
  taskType: 'premise_generate'
  result: PremiseGenerationResultWithMeta
}

interface AiResultStore {
  results: Record<string, PendingAiResult>
  setPendingResult: (payload: PendingAiResult) => void
  markApplied: (key: string, appliedMode?: string) => void
  clearPendingResult: (key: string) => void
}

export function buildAiResultKey(taskType: AiResultTaskType, novelId: number) {
  return `${taskType}:${novelId}`
}

export const useAiResultStore = create<AiResultStore>((set) => ({
  results: {},

  setPendingResult: (payload) => set((state) => ({
    results: {
      ...state.results,
      [payload.key]: payload,
    },
  })),

  markApplied: (key, appliedMode) => set((state) => {
    const current = state.results[key]
    if (!current) return state

    return {
      results: {
        ...state.results,
        [key]: {
          ...current,
          status: 'applied',
          appliedAt: new Date().toISOString(),
          appliedMode: appliedMode || current.mode,
        },
      },
    }
  }),

  clearPendingResult: (key) => set((state) => {
    if (!state.results[key]) return state

    const nextResults = { ...state.results }
    delete nextResults[key]
    return { results: nextResults }
  }),
}))
