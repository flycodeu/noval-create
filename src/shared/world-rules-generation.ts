import type { GenreWorldRules } from './genre-system'

export type WorldRuleSectionKey =
  | 'overview'
  | 'power'
  | 'species'
  | 'ecology'
  | 'map'
  | 'timeline'
  | 'language'

export type WorldRulesGenerationAction = 'generate' | 'expand'

export interface WorldRulesGenerationRequest {
  novelId: number
  mode: 'all' | 'section'
  action: WorldRulesGenerationAction
  section?: WorldRuleSectionKey
  currentRules: GenreWorldRules
  requirements?: string
}

export interface WorldRulesGenerationStepResult {
  key: WorldRuleSectionKey
  label: string
  status: 'success' | 'warning' | 'failed'
  warning?: string
  error?: string
}

export interface WorldRulesGenerationProgressEvent {
  novelId: number
  section: WorldRuleSectionKey
  label: string
  status: 'running' | 'success' | 'failed'
  completed: number
  total: number
  detail?: string
  warning?: string
}

export interface WorldRulesGenerationResult {
  rules: GenreWorldRules
  requestedSections: WorldRuleSectionKey[]
  steps: WorldRulesGenerationStepResult[]
  warnings: string[]
  completedSteps: number
  failedSteps: number
  hasPartialResult: boolean
}

export const WORLD_RULE_SECTION_DEFINITIONS: Array<{
  key: WorldRuleSectionKey
  label: string
}> = [
  { key: 'overview', label: '世界概览' },
  { key: 'power', label: '力量体系' },
  { key: 'species', label: '种族势力' },
  { key: 'ecology', label: '人物生态' },
  { key: 'map', label: '地图蓝图' },
  { key: 'timeline', label: '时间规则' },
  { key: 'language', label: '文风约束' },
]

export const WORLD_RULE_SECTION_ORDER = WORLD_RULE_SECTION_DEFINITIONS.map((item) => item.key)
