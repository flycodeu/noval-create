import type { AgentToolActor } from '../../src/shared/tool-contracts'

export type RecommendationGovernanceErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'PREFLIGHT_NOT_FOUND'
  | 'PREFLIGHT_BLOCKED'
  | 'PREFLIGHT_STALE'
  | 'CANDIDATE_NOT_FOUND'
  | 'CANDIDATE_INVALID'
  | 'APPROVAL_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'RECOMMENDATION_LOCKED'
  | 'RECOMMENDATION_ATTEMPTS_EXHAUSTED'
  | 'RECOMMENDATION_ALREADY_PASSED'

export class RecommendationGovernanceError extends Error {
  constructor(
    public readonly code: RecommendationGovernanceErrorCode,
    message: string,
    public readonly detail?: string,
  ) {
    super(message)
    this.name = 'RecommendationGovernanceError'
  }
}

export interface RecommendationAuditContext {
  actor: AgentToolActor
  approvalId: string
}
