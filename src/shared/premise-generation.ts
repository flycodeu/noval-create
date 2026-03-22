export type PremiseGenerationMode = 'replace' | 'fill_blanks'

export type PremiseGenerationStepKey = 'premise_core' | 'writing_rules'

export interface PremiseGenerationRequest {
  novelId: number
  mode?: PremiseGenerationMode
  requirements?: string
}

export interface PremiseGenerationStepResult {
  key: PremiseGenerationStepKey
  label: string
  status: 'success' | 'warning' | 'failed' | 'skipped'
  warning?: string
  error?: string
}

export interface PremiseGenerationResult {
  positioning: string
  coreHook: string
  protagonistStart: string
  constraints: string
  languageGuardrails: string
  antiAiFlavor: string
  commonSenseRules: string
  bannedTerms: string
  steps: PremiseGenerationStepResult[]
  warnings: string[]
  hasPartialResult: boolean
}

export interface PremiseGenerationProgressEvent {
  novelId: number
  step: PremiseGenerationStepKey
  label: string
  status: 'running' | 'success' | 'failed'
  completed: number
  total: number
  detail?: string
  warning?: string
}

export const PREMISE_GENERATION_STEPS: Array<{
  key: PremiseGenerationStepKey
  label: string
}> = [
  { key: 'premise_core', label: '基础定位与约束' },
  { key: 'writing_rules', label: '语言与去 AI 边界' },
]
