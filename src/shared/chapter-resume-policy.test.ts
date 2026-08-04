import { describe, expect, it } from 'vitest'
import { resolveChapterPipelineResumeMode } from './chapter-resume-policy'

describe('chapter pipeline resume policy', () => {
  it('continues only an interrupted Writer stream', () => {
    expect(resolveChapterPipelineResumeMode({
      hasPartialContent: true,
      lastFailureRole: 'writer',
    })).toBe('continue_writer')
  })

  it.each(['critic', 'rewriter', 'canonizer', 'finalize', undefined])(
    'sends a complete preserved draft from %s back through the review pipeline',
    (lastFailureRole) => {
      expect(resolveChapterPipelineResumeMode({
        hasPartialContent: true,
        lastFailureRole,
      })).toBe('review_preserved_draft')
    },
  )

  it('restarts normally when no partial draft exists', () => {
    expect(resolveChapterPipelineResumeMode({
      hasPartialContent: false,
      lastFailureRole: 'writer',
    })).toBe('restart')
  })
})
