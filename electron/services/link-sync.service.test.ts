import { describe, expect, it } from 'vitest'
import { nextTimelineStatus } from './link-sync.service'

describe('nextTimelineStatus', () => {
  it('keeps a planned event planned when the chapter reaches its start', () => {
    expect(nextTimelineStatus('planned', 4, 4, 8)).toBe('planned')
  })

  it('resolves a written event when the chapter reaches its end', () => {
    expect(nextTimelineStatus('written', 8, 4, 8)).toBe('resolved')
  })

  it('keeps a written event written when it has no end chapter', () => {
    expect(nextTimelineStatus('written', 8, 4, null)).toBe('written')
  })
})
