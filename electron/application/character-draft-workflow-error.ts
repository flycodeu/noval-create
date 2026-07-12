export type CharacterDraftWorkflowErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_REJECTED'
  | 'PLAN_HAS_NO_CREATE_ACTIONS'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_KIND_MISMATCH'
  | 'CONTEXT_VERSION_CONFLICT'
  | 'DRAFT_HASH_CONFLICT'
  | 'QUALITY_GATE_BLOCKED'
  | 'MODEL_OUTPUT_INVALID'
  | 'IDEMPOTENCY_KEY_CONFLICT'

export class CharacterDraftWorkflowError extends Error {
  constructor(public readonly code: CharacterDraftWorkflowErrorCode, message: string) {
    super(message)
    this.name = 'CharacterDraftWorkflowError'
  }
}
