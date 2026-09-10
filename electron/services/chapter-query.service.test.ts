import { describe, expect, it } from 'vitest'
import { getChapterContextPreview } from './chapter-query.service'

describe('chapter query owner', () => {
  it('keeps context preview as the legacy read-only entrypoint', () => {
    expect(typeof getChapterContextPreview).toBe('function')
  })
})
