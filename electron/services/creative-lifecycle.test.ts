import { describe, expect, it } from 'vitest'
import { assertCreativeCandidateApplicable, dispositionAfterCreativeFailure, resolveCreativeResumeAction } from './creative-lifecycle'

const candidate = { status: 'paused', cancelRequested: false, draftStatus: 'reviewed', reviewStatus: 'reviewed' }
const resume = { status: 'paused', active: false, committed: false, explicitApply: false, reviewPassed: true, reviewOnly: false, cancelRequested: false }

describe('creative candidate lifecycle', () => {
  it('continues a recovered checkpoint without treating a normal paused candidate as a restart', () => {
    expect(resolveCreativeResumeAction({ ...resume, recoverable: true })).toBe('resume_checkpoint')
    expect(resolveCreativeResumeAction({ ...resume, recoverable: true, active: true })).toBe('noop')
    expect(resolveCreativeResumeAction({ ...resume, recoverable: true, status: 'cancelled' })).toBe('retry')
    expect(resolveCreativeResumeAction({ ...resume, recoverable: true, cancelRequested: true })).toBe('noop')
  })
  it('preserves a paused candidate on Resume and requires an explicit Apply', () => {
    expect(resolveCreativeResumeAction(resume)).toBe('noop')
    expect(resolveCreativeResumeAction({ ...resume, explicitApply: true })).toBe('apply')
    expect(() => assertCreativeCandidateApplicable(candidate)).not.toThrow()
  })
  it('never applies a cancelled run, even when its old model review passed', () => {
    for (const status of ['cancelled', 'cancel_requested']) {
      expect(() => resolveCreativeResumeAction({ ...resume, status, explicitApply: true })).toThrow('已取消')
      expect(() => assertCreativeCandidateApplicable({ ...candidate, status })).toThrow('已取消')
    }
    expect(() => assertCreativeCandidateApplicable({ ...candidate, cancelRequested: true })).toThrow('已取消')
    expect(resolveCreativeResumeAction({ ...resume, status: 'cancelled' })).toBe('retry')
  })
  it('blocks direct service application of failed, blocked and unstarted tasks', () => {
    for (const status of ['failed', 'blocked', 'pending', 'success']) expect(() => assertCreativeCandidateApplicable({ ...candidate, status })).toThrow('当前任务状态')
    expect(() => assertCreativeCandidateApplicable({ ...candidate, status: 'running' })).not.toThrow()
  })
  it('blocks inactive candidate or report lifecycles regardless of model PASS', () => {
    for (const status of ['draft', 'rejected', 'superseded', 'committed']) {
      expect(() => assertCreativeCandidateApplicable({ ...candidate, draftStatus: status })).toThrow('已停用')
      expect(() => assertCreativeCandidateApplicable({ ...candidate, reviewStatus: status })).toThrow('已停用')
    }
  })
  it('restores an already persisted commit before considering cancellation or replay', () => {
    expect(resolveCreativeResumeAction({ ...resume, committed: true, status: 'cancelled', explicitApply: true, cancelRequested: true })).toBe('restore_commit')
  })
  it('requires a fresh generation attempt for failed tasks and never retries an in-flight cancellation', () => {
    expect(resolveCreativeResumeAction({ ...resume, status: 'failed' })).toBe('retry')
    expect(resolveCreativeResumeAction({ ...resume, status: 'blocked' })).toBe('retry')
    expect(resolveCreativeResumeAction({ ...resume, status: 'cancel_requested', active: true })).toBe('noop')
    expect(() => resolveCreativeResumeAction({ ...resume, status: 'cancel_requested' })).toThrow('正在取消')
  })
  it('pauses a passed candidate when a later step fails so it can be applied again', () => {
    expect(dispositionAfterCreativeFailure({ cancelled: false, reviewStatus: 'passed' })).toEqual({ taskStatus: 'paused', reviewStatus: 'passed', step: 'needs_attention' })
    const paused = dispositionAfterCreativeFailure({ cancelled: false, reviewStatus: 'passed' })
    expect(resolveCreativeResumeAction({ ...resume, status: paused.taskStatus, explicitApply: true, reviewPassed: paused.reviewStatus === 'passed' })).toBe('apply')
  })
  it('fails a run whose review is still validating or has not been recorded', () => {
    expect(dispositionAfterCreativeFailure({ cancelled: false, reviewStatus: 'validating' })).toEqual({ taskStatus: 'failed', reviewStatus: 'needs_revision', step: 'needs_attention' })
    expect(dispositionAfterCreativeFailure({ cancelled: false }).taskStatus).toBe('failed')
    expect(dispositionAfterCreativeFailure({ cancelled: false, reviewStatus: undefined }).taskStatus).toBe('failed')
  })
  it('keeps a cancelled run cancelled even after the review passed', () => {
    expect(dispositionAfterCreativeFailure({ cancelled: true, reviewStatus: 'passed' }).taskStatus).toBe('cancelled')
    expect(dispositionAfterCreativeFailure({ cancelled: true, reviewStatus: 'validating' }).taskStatus).toBe('cancelled')
    expect(dispositionAfterCreativeFailure({ cancelled: true }).taskStatus).toBe('cancelled')
  })
})
