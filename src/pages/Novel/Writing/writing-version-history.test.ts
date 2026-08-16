import { describe, expect, it } from 'vitest'
import type { ChapterVersion } from '../../../types'
import { createWritingVersionHistoryRequestTracker, resolveSelectedVersionId } from './writing-version-history'

describe('writing version history lifecycle', () => {
  it('rejects superseded, invalidated and route-stale requests', () => {
    const tracker = createWritingVersionHistoryRequestTracker()
    const first = tracker.beginRequest()
    const second = tracker.beginRequest()

    expect(tracker.isCurrent(first)).toBe(false)
    expect(tracker.isCurrent(second)).toBe(true)
    expect(tracker.isCurrent(second, () => false)).toBe(false)

    tracker.invalidate()
    expect(tracker.isCurrent(second)).toBe(false)
  })

  it('keeps a valid selection and otherwise falls back to the newest version', () => {
    const versions = [{ id: 3 }, { id: 2 }] as ChapterVersion[]
    expect(resolveSelectedVersionId(2, versions)).toBe(2)
    expect(resolveSelectedVersionId(9, versions)).toBe(3)
    expect(resolveSelectedVersionId(null, [])).toBeNull()
  })
})
