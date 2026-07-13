import { describe, expect, it } from 'vitest'
import { deriveNovelLifecycleStatus } from './novel-lifecycle.service'

describe('novel lifecycle derivation', () => {
  it('keeps an explicitly archived project archived', () => {
    expect(deriveNovelLifecycleStatus('archived', [{ status: 'writing', wordCount: 3000 }])).toBe('archived')
  })

  it('moves a structured project into writing after content production starts', () => {
    expect(deriveNovelLifecycleStatus('draft', [
      { status: 'outline', wordCount: 0 },
      { status: 'draft', wordCount: 2800 },
    ])).toBe('writing')
  })

  it('marks a project completed only when every chapter is final', () => {
    expect(deriveNovelLifecycleStatus('writing', [
      { status: 'final', wordCount: 3000 },
      { status: 'final', wordCount: 3200 },
    ])).toBe('completed')
    expect(deriveNovelLifecycleStatus('writing', [
      { status: 'final', wordCount: 3000 },
      { status: 'outline', wordCount: 0 },
    ])).toBe('writing')
  })
})
