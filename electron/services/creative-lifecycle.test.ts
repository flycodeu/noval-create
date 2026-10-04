import { describe, expect, it } from 'vitest'
import { assertCreativeCandidateApplicable, resolveCreativeResumeAction } from './creative-lifecycle'

const candidate = { status: 'paused', cancelRequested: false, draftStatus: 'reviewed', reviewStatus: 'reviewed' }
const resume = { status: 'paused', active: false, committed: false, explicitApply: false, reviewPassed: true, reviewOnly: false, cancelRequested: false }

describe('creative candidate lifecycle', () => {
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
})
