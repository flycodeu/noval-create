export type QualityWorkflowErrorCode =
  | 'PROJECT_NOT_FOUND'
  | 'QUALITY_SCOPE_INVALID'
  | 'QUALITY_REPORT_INVALID'
  | 'QUALITY_REPORT_STALE'
  | 'QUALITY_REPORT_INCOMPATIBLE'
  | 'REPAIR_PLAN_INVALID'
  | 'REPAIR_PLAN_STALE'
  | 'REPAIR_PLAN_NO_CHAPTER_TARGETS'
  | 'REPAIR_DRAFT_INVALID'
  | 'REPAIR_DRAFT_STALE'
  | 'MODEL_REVIEW_FAILED'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'VALIDATION_FAILED'

export class QualityWorkflowError extends Error {
  constructor(public readonly code: QualityWorkflowErrorCode, message: string) {
    super(message)
    this.name = 'QualityWorkflowError'
  }
}
