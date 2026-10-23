import { describe, expect, it } from 'vitest'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { USER_FACING_SERVICE_MESSAGES } from '../../src/shared/user-facing-messages.services'
import { UserFacingError } from '../utils/user-facing-error'
import { assertCreativeCandidateApplicable, resolveCreativeResumeAction } from './creative-lifecycle'
import { SourceSearchError } from './source-search-provider.service'

describe('centralized service messages', () => {
  it.each(Object.entries(USER_FACING_SERVICE_MESSAGES))('resolves %s using only its declared parameters', (key, text) => {
    const params: Record<string, string> = { unusedDetail: 'private-provider-response', unusedPath: 'private-path', unusedKey: 'private-key' }
    for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) params[name] = `fixture-${name}`
    const expected = text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => params[name])
    expect(formatUserFacingMessage(key as keyof typeof USER_FACING_SERVICE_MESSAGES, params)).toBe(expected)
  })

  it.each([null, undefined, 0, false, '', '{{other}} $& 中文', [], {}])('preserves template interpolation for %j', (value) => {
    const id = `${value}`
    expect(formatUserFacingMessage('services.artifact.notFound', { id })).toBe(`找不到工件 ${value}。`)
  })

  it('keeps source-search error classification and safe HTTP status', () => {
    const failure = new SourceSearchError('HTTP_ERROR', 503)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toBeInstanceOf(SourceSearchError)
    expect(failure).not.toBeInstanceOf(UserFacingError)
    expect(failure.message).toBe('搜索服务请求失败（HTTP 503），请检查 API Key、额度和服务状态后重试。')
    expect(failure.code).toBe('HTTP_ERROR')
    expect(failure.status).toBe(503)
    expect(failure).not.toHaveProperty('messageKey')
    expect(failure).not.toHaveProperty('params')

    const invalidStatus = new SourceSearchError('HTTP_ERROR', 999)
    expect(invalidStatus.message).toBe(USER_FACING_SERVICE_MESSAGES['services.sourceSearch.requestFailed'])
    expect(invalidStatus.status).toBeUndefined()
  })

  it('keeps cancelled-candidate validation as an ordinary Error', () => {
    let failure: unknown
    try {
      assertCreativeCandidateApplicable({ status: 'cancelled', cancelRequested: true, draftStatus: 'reviewed', reviewStatus: 'reviewed' })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(UserFacingError)
    expect((failure as Error).constructor).toBe(Error)
    expect((failure as Error).message).toBe(USER_FACING_SERVICE_MESSAGES['services.lifecycle.cancelledCandidateBlocked'])
    expect(failure).not.toHaveProperty('messageKey')
    expect(failure).not.toHaveProperty('params')
  })

  it('does not promote internal resume-state errors to public IPC errors', () => {
    let failure: unknown
    try {
      resolveCreativeResumeAction({ status: 'unknown', active: false, committed: false, explicitApply: false, reviewPassed: false, reviewOnly: false, cancelRequested: false })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(UserFacingError)
    expect((failure as Error).constructor).toBe(Error)
    expect((failure as Error).message).toBe(USER_FACING_SERVICE_MESSAGES['services.lifecycle.resumeStateInvalid'])
    expect(failure).not.toHaveProperty('messageKey')
    expect(failure).not.toHaveProperty('params')
  })
})
