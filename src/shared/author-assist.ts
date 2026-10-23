export type AuthorAssistKind = 'reference_extraction' | 'selection_revision'

export interface AuthorAssistRun {
  taskId: number
  kind: AuthorAssistKind
  status: string
  artifactId?: string
  error?: string
  createdAt?: string | null
}

export const isAssistActive = (run: AuthorAssistRun | null) => Boolean(run && ['pending', 'running', 'cancel_requested'].includes(run.status))
