import type { ProjectBriefDocument } from './project-brief'

export type ProjectBriefGenerationMode = 'replace' | 'fill_blanks'
export type ProjectBriefGenerationStepKey = 'project_brief'

export interface ProjectBriefGenerationRequest {
  novelId: number
  mode?: ProjectBriefGenerationMode
  requirements?: string
}

export interface ProjectBriefGenerationStepResult {
  key: ProjectBriefGenerationStepKey
  label: string
  status: 'success' | 'warning' | 'failed' | 'skipped'
  warning?: string
  error?: string
}

export interface ProjectBriefGenerationResult extends ProjectBriefDocument {
  steps: ProjectBriefGenerationStepResult[]
  warnings: string[]
  hasPartialResult: boolean
}
