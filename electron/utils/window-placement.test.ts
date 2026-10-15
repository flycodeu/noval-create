import { describe, expect, it } from 'vitest'
import { restoreWindowBounds } from './window-placement'

describe('window restoration across displays', () => {
  it('keeps a valid left-hand display position with negative coordinates', () => {
    const saved = { x: -1800, y: 30, width: 1400, height: 900 }
    expect(restoreWindowBounds(saved, { x: -1920, y: 0, width: 1920, height: 1040 })).toEqual(saved)
  })
  it('brings a disconnected-display window and its title bar onto the primary display', () => {
    expect(restoreWindowBounds({ x: 4000, y: -1000, width: 1600, height: 1000 }, { x: 0, y: 0, width: 1280, height: 720 }))
      .toEqual({ x: 0, y: 0, width: 1280, height: 720 })
  })
  it('handles invalid saved dimensions on a scaled display', () => {
    expect(restoreWindowBounds({ width: -10, height: NaN }, { x: 0, y: 40, width: 1024, height: 640 }))
      .toEqual({ x: 0, y: 40, width: 1024, height: 640 })
  })
})
