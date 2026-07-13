import { describe, expect, it } from 'vitest'
import { getResponsivePanelHeight } from './use-responsive-panel-height'

describe('getResponsivePanelHeight', () => {
  it('keeps panel height within the configured viewport bounds', () => {
    expect(getResponsivePanelHeight(300, { minHeight: 320, maxHeight: 720, ratio: 0.56, fallback: 480 })).toBe(320)
    expect(getResponsivePanelHeight(900, { minHeight: 320, maxHeight: 720, ratio: 0.56, fallback: 480 })).toBe(504)
    expect(getResponsivePanelHeight(1600, { minHeight: 320, maxHeight: 720, ratio: 0.56, fallback: 480 })).toBe(720)
  })

  it('uses the fallback when viewport size is unavailable', () => {
    expect(getResponsivePanelHeight(undefined, { fallback: 460 })).toBe(460)
  })
})
