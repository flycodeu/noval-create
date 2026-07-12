export type ArtifactServiceErrorCode =
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_ID_CONFLICT'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'ARTIFACT_PARENT_INVALID'

export class ArtifactServiceError extends Error {
  constructor(public readonly code: ArtifactServiceErrorCode, message: string) {
    super(message)
    this.name = 'ArtifactServiceError'
  }
}
