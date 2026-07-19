import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveManagedRequestRetryCount,
  resolveManagedRequestTimeoutMs,
} from './request-support'

const originalTimeout = process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS
const originalRetryCount = process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS
  else process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS = originalTimeout
  if (originalRetryCount === undefined) delete process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT
  else process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT = originalRetryCount
})

describe('managed model request defaults', () => {
  it('prefers explicit request options over audit environment defaults', () => {
    process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS = '12000'
    process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT = '0'

    expect(resolveManagedRequestTimeoutMs(18000)).toBe(18000)
    expect(resolveManagedRequestRetryCount(2)).toBe(2)
  })

  it('uses bounded environment defaults when explicit options are absent', () => {
    process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS = '22000'
    process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT = '0'

    expect(resolveManagedRequestTimeoutMs()).toBe(22000)
    expect(resolveManagedRequestRetryCount()).toBe(0)
  })

  it('clamps unsafe environment defaults to the supported range', () => {
    process.env.NOVELFORGE_MODEL_REQUEST_TIMEOUT_MS = '1'
    process.env.NOVELFORGE_MODEL_REQUEST_RETRY_COUNT = '99'

    expect(resolveManagedRequestTimeoutMs()).toBe(5000)
    expect(resolveManagedRequestRetryCount()).toBe(5)
  })
})
