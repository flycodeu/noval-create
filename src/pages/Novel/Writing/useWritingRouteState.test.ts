import { describe, expect, it } from 'vitest'
import { parseWritingRouteId, resolveWritingRouteKey } from './useWritingRouteState'

describe('Writing route state helpers', () => {
  it('accepts only positive query ids', () => {
    expect(parseWritingRouteId('12')).toBe(12)
    expect(parseWritingRouteId('0')).toBeNull()
    expect(parseWritingRouteId('invalid')).toBeNull()
  })

  it('keeps unknown writing paths on the editor route', () => {
    expect(resolveWritingRouteKey('/novels/8/writing/review')).toBe('review')
    expect(resolveWritingRouteKey('/novels/8/writing/unknown')).toBe('editor')
  })
})
