import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
/** A candidate can be saved by the active writer or by an explicit Apply on a paused run. */
export function assertCreativeCandidateApplicable(input: {
  status: string
  cancelRequested: boolean
  draftStatus: string
  reviewStatus: string
}): void {
  if (input.cancelRequested || ['cancelled', 'cancel_requested'].includes(input.status)) throw new Error(formatUserFacingMessage('services.lifecycle.cancelledCandidateBlocked'))
  if (!['running', 'paused'].includes(input.status)) throw new Error(formatUserFacingMessage('services.lifecycle.applyStateInvalid'))
  if (!['reviewed', 'approved'].includes(input.draftStatus) || !['reviewed', 'approved'].includes(input.reviewStatus)) throw new Error(formatUserFacingMessage('services.lifecycle.reviewInactiveOrIncomplete'))
}

export function resolveCreativeResumeAction(input: {
  status: string
  active: boolean
  committed: boolean
  explicitApply: boolean
  reviewPassed: boolean
  reviewOnly: boolean
  cancelRequested: boolean
  recoverable?: boolean
}): 'restore_commit' | 'noop' | 'apply' | 'retry' | 'resume_checkpoint' {
  if (input.committed) return 'restore_commit'
  if (input.explicitApply) {
    if (input.cancelRequested || ['cancelled', 'cancel_requested'].includes(input.status)) throw new Error(formatUserFacingMessage('services.lifecycle.cancelledCandidateBlocked'))
    if (input.active || input.status !== 'paused') throw new Error(formatUserFacingMessage('services.lifecycle.reviewedCandidateRequired'))
    if (input.reviewOnly || !input.reviewPassed) throw new Error(formatUserFacingMessage('services.lifecycle.reviewNotPassed'))
    return 'apply'
  }
  if (input.active || ['pending', 'running', 'success'].includes(input.status)) return 'noop'
  if (!input.cancelRequested && input.recoverable && ['paused', 'failed', 'blocked'].includes(input.status)) return 'resume_checkpoint'
  if (input.status === 'paused') return 'noop'
  if (input.status === 'cancel_requested') throw new Error(formatUserFacingMessage('services.lifecycle.cancellationPending'))
  if (!['failed', 'blocked', 'cancelled'].includes(input.status)) throw new Error(formatUserFacingMessage('services.lifecycle.resumeStateInvalid'))
  return 'retry'
}

/** Keep a passed candidate applicable when apply or a later step fails. Evidence failures happen before passed. */
export function dispositionAfterCreativeFailure(input: {
  cancelled: boolean
  reviewStatus?: string
}): { taskStatus: 'paused' | 'failed' | 'cancelled'; reviewStatus: 'passed' | 'needs_revision'; step: 'needs_attention' | 'cancelled' } {
  if (input.cancelled) return { taskStatus: 'cancelled', reviewStatus: input.reviewStatus === 'passed' ? 'passed' : 'needs_revision', step: 'cancelled' }
  if (input.reviewStatus === 'passed') return { taskStatus: 'paused', reviewStatus: 'passed', step: 'needs_attention' }
  return { taskStatus: 'failed', reviewStatus: 'needs_revision', step: 'needs_attention' }
}
