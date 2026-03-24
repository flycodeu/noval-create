import type { ThemeVoiceDocument } from './theme-voice'

export type ThemeVoiceGenerationMode = 'replace' | 'fill_blanks'
export type ThemeVoiceGenerationStepKey = 'theme_voice'

export interface ThemeVoiceGenerationRequest {
  novelId: number
  mode?: ThemeVoiceGenerationMode
  requirements?: string
}

export interface ThemeVoiceGenerationStepResult {
  key: ThemeVoiceGenerationStepKey
  label: string
  status: 'success' | 'warning' | 'failed' | 'skipped'
  warning?: string
  error?: string
}

export interface ThemeVoiceGenerationResult extends ThemeVoiceDocument {
  steps: ThemeVoiceGenerationStepResult[]
  warnings: string[]
  hasPartialResult: boolean
}
