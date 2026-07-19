import { describe, expect, it } from 'vitest'
import {
  buildChapterGenerationRequestKey,
  isRetryableChapterGenerationStatus,
} from './chapter-generation-idempotency'

describe('chapter generation idempotency', () => {
  it('reuses the deterministic key for new, running, and successful tasks', () => {
    expect(buildChapterGenerationRequestKey('chapter-write:1:abc')).toBe('chapter-write:1:abc')
    expect(buildChapterGenerationRequestKey('chapter-write:1:abc', { existingStatus: 'running' })).toBe('chapter-write:1:abc')
    expect(buildChapterGenerationRequestKey('chapter-write:1:abc', { existingStatus: 'success' })).toBe('chapter-write:1:abc')
  })

  it('creates a fresh key for failed and cancelled tasks', () => {
    expect(isRetryableChapterGenerationStatus('failed')).toBe(true)
    expect(isRetryableChapterGenerationStatus('cancelled')).toBe(true)
    expect(buildChapterGenerationRequestKey('chapter-write:1:abc', {
      existingStatus: 'failed',
      retryToken: 'retry-1',
    })).toBe('chapter-write:1:abc:retry:retry-1')
    expect(buildChapterGenerationRequestKey('chapter-write:1:abc', {
      existingStatus: 'cancelled',
      retryToken: 'retry-2',
    })).toBe('chapter-write:1:abc:retry:retry-2')
  })

  it('requires a retry token when replacing a failed task', () => {
    expect(() => buildChapterGenerationRequestKey('chapter-write:1:abc', { existingStatus: 'failed' }))
      .toThrow('retryToken is required')
  })
})
