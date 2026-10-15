import { describe, expect, it } from 'vitest'
import { parseStrictJsonEnvelope } from './strict-json-envelope'

describe('strict JSON envelope', () => {
  it('preserves prose and evidence exactly inside a complete fence', () => {
    const data = { content: '“别动。”\n\n灯还没点。', factReveals: [{ evidenceQuote: '“别动。”' }] }
    expect(parseStrictJsonEnvelope('```json\n' + JSON.stringify(data) + '\n```')).toEqual(data)
    expect(parseStrictJsonEnvelope(JSON.stringify(data))).toEqual(data)
  })
  it.each([
    '解释\n```json\n{}\n```',
    '```json\n{}\n```\n解释',
    '```json\n{}',
    '```json\n{"content":"unfinished}\n```',
    '```json\n{}\n```\n```json\n{}\n```',
  ])('rejects incomplete or mixed responses: %s', raw => {
    expect(() => parseStrictJsonEnvelope(raw)).toThrow()
  })
})
