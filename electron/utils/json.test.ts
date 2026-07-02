import { describe, expect, it } from 'vitest'
import {
  extractBalancedJson,
  parseAiJsonResult,
  safeParseAiJson,
  safeParseJson,
} from './json'

describe('json utils', () => {
  it('extracts balanced JSON from wrapper text', () => {
    expect(extractBalancedJson('分析如下：{"name":"阿澈","score":91} 收工。', 'object'))
      .toBe('{"name":"阿澈","score":91}')
  })

  it('parses raw JSON without repair', () => {
    const result = parseAiJsonResult<{ score: number }>('{"score": 42}', 'object')

    expect(result.success).toBe(true)
    expect(result.strategy).toBe('raw')
    expect(result.repaired).toBe(false)
    expect(result.data).toEqual({ score: 42 })
  })

  it('normalizes fenced JSON with comments, CJK quotes, and trailing commas', () => {
    const result = parseAiJsonResult<{
      name: string
      items: number[]
    }>(`
\`\`\`json
{
  “name”: “临风”, // 主角名
  "items": [1, 2,],
}
\`\`\`
`, 'object')

    expect(result.success).toBe(true)
    expect(result.strategy).toBe('normalized')
    expect(result.repaired).toBe(false)
    expect(result.data).toEqual({
      name: '临风',
      items: [1, 2],
    })
  })

  it('preserves CJK quotes inside valid JSON string values', () => {
    const result = parseAiJsonResult<Array<{ summary: string }>>(
      '```json\n[{"summary":"朱赫来说“这玩意儿能用”，保尔记住了。"}]\n```',
      'array',
    )

    expect(result.success).toBe(true)
    expect(result.strategy).toBe('raw')
    expect(result.data).toEqual([{ summary: '朱赫来说“这玩意儿能用”，保尔记住了。' }])
  })

  it('repairs common missing-comma AI JSON mistakes', () => {
    const result = parseAiJsonResult<{ a: number; b: string }>('{"a":1 "b":"ok"}', 'object')

    expect(result.success).toBe(true)
    expect(result.strategy).toBe('repaired')
    expect(result.repaired).toBe(true)
    expect(result.data).toEqual({ a: 1, b: 'ok' })
  })

  it('reports root mismatch with payload preview', () => {
    const result = parseAiJsonResult('[1, 2, 3]', 'object')

    expect(result.success).toBe(false)
    expect(result.payloadPreview).toContain('[1, 2, 3]')
    expect(result.error?.message).toContain('AI JSON 根节点必须是对象')
  })

  it('keeps safeParse helpers aligned', () => {
    expect(safeParseAiJson<{ id: number }>('前文说明：{"id":7}。', 'object')).toEqual({ id: 7 })
    expect(safeParseJson<{ ok: boolean }>('{ "ok": true }')).toEqual({ ok: true })
  })
})
