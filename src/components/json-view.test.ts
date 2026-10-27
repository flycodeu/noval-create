import { describe, expect, it } from 'vitest'
import { prepareJsonView } from './json-view'

describe('structured JSON presentation', () => {
  it('formats nested JSON and masks credential fields without hiding token budgets', () => {
    const view = prepareJsonView('{"items":[{"apiKey":"private","maxTokens":4096,"authorization":"Bearer private"}],"enabled":true,"value":null}')
    expect(view.structured).toBe(true)
    expect(view.text).not.toContain('private')
    expect(view.text).toContain('4096')
    expect(view.text).toContain('\n  "items"')
  })
  it('preserves prose, malformed JSON, empty values and scalar results', () => {
    for (const text of ['正文\n第二段', '{invalid', '', 'null', '42', '"正文"']) {
      expect(prepareJsonView(text)).toEqual({ structured: false, text })
    }
  })
  it('does not parse or reveal oversized output that bypasses structured masking', () => {
    const raw = JSON.stringify({ apiKey: 'oversized-secret', text: 'a'.repeat(1_000_000) })
    const view = prepareJsonView(raw)
    expect(view.structured).toBe(false)
    expect(view.text).toContain('超过 1 MB')
    expect(view.text).not.toContain('oversized-secret')
  })
})
