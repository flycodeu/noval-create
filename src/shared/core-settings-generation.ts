import type { SubPlotDraft } from './subplot-framework'

export type CoreSettingsGenerationStepKey =
  | 'story_goal'
  | 'core_conflict'
  | 'main_plot'
  | 'sub_plots_list'
  | 'rhythm'
  | 'ending'

export type CoreSettingsEndingType = 'HE' | 'BE' | 'open' | 'multi' | 'HE_BE'

export interface CoreSettingsGenerationRequest {
  novelId: number
  subplotCount: number
  requirements?: string
}

export interface CoreSettingsGenerationStepResult {
  key: CoreSettingsGenerationStepKey
  label: string
  status: 'success' | 'warning' | 'failed' | 'skipped'
  warning?: string
  error?: string
}

export interface CoreSettingsGenerationResult {
  story_goal: string
  core_conflict: string
  main_plot: string
  sub_plots_list: SubPlotDraft[]
  rhythm_setup: number
  rhythm_conflict: number
  rhythm_ending: number
  ending_type: CoreSettingsEndingType
  ending: string
  steps: CoreSettingsGenerationStepResult[]
  warnings: string[]
  completedSteps: number
  failedSteps: number
  hasPartialResult: boolean
}

export interface CoreSettingsGenerationProgressEvent {
  novelId: number
  step: CoreSettingsGenerationStepKey
  label: string
  status: 'running' | 'success' | 'failed'
  completed: number
  total: number
  detail?: string
  warning?: string
}

export const CORE_SETTINGS_GENERATION_STEPS: Array<{
  key: CoreSettingsGenerationStepKey
  label: string
}> = [
  { key: 'story_goal', label: '故事核心目标' },
  { key: 'core_conflict', label: '核心冲突' },
  { key: 'main_plot', label: '主线剧情' },
  { key: 'sub_plots_list', label: '支线剧情' },
  { key: 'rhythm', label: '叙事节奏' },
  { key: 'ending', label: '结局设定' },
]
