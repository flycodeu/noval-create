import { describe, expect, it } from 'vitest'
import { isWebDemoPreviewEnabled } from './web-preview-mode'

describe('web preview runtime mode', () => {
  it('requires an explicit demo flag before enabling fabricated preview data', () => {
    expect(isWebDemoPreviewEnabled('', null)).toBe(false)
    expect(isWebDemoPreviewEnabled('?demo=1', null)).toBe(true)
    expect(isWebDemoPreviewEnabled('', '1')).toBe(true)
    expect(isWebDemoPreviewEnabled('?demo=0', '0')).toBe(false)
  })
})
