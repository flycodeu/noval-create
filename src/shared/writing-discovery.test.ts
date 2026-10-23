import { describe, expect, it } from 'vitest'
import { clipInlineCompletion, insertInlineCompletion } from './inline-completion'
import { inspirationBasis, parseInspirationResult } from './inspiration'

describe('bounded writing candidates', () => {
  it('stops at sentence and paragraph boundaries and keeps whole Unicode characters', () => {
    expect(clipInlineCompletion('“我会回来。”下一句。', 'sentence')).toEqual({ text: '“我会回来。”', stop: true })
    expect(clipInlineCompletion('这一段\n后一段', 'paragraph')).toEqual({ text: '这一段', stop: true })
    const text = clipInlineCompletion('😀'.repeat(300), 'paragraph').text
    expect(Array.from(text)).toHaveLength(220)
    expect(text).toBe('😀'.repeat(220))
    expect(Array.from(clipInlineCompletion('字'.repeat(100), 'sentence').text)).toHaveLength(60)
  })
  it('inserts at the exact cursor without changing either side or splitting a surrogate pair', () => {
    expect(insertInlineCompletion('😀前文\n后文', 4, '补全')).toBe('😀前文补全\n后文')
    expect(() => insertInlineCompletion('😀前文', 1, '坏')).toThrow()
  })
  it('waits for closing quotes split across stream chunks before stopping at a sentence', () => {
    let raw = '他低声说：“走吧。'
    expect(clipInlineCompletion(raw, 'sentence', { streaming: true }).stop).toBe(false)
    raw += '”'
    expect(clipInlineCompletion(raw, 'sentence', { streaming: true }).stop).toBe(false)
    raw += '下一句。'
    expect(clipInlineCompletion(raw, 'sentence', { streaming: true })).toEqual({ text: '他低声说：“走吧。”', stop: true })
    expect(clipInlineCompletion('「他说：『走吧！』」下一句。', 'sentence', { streaming: true })).toEqual({ text: '「他说：『走吧！』」', stop: true })
  })
  it('finalizes a sentence at end of stream while keeping hard caps and newline cancellation', () => {
    expect(clipInlineCompletion('走吧。', 'sentence', { streaming: true }).stop).toBe(false)
    expect(clipInlineCompletion('走吧。', 'sentence')).toEqual({ text: '走吧。', stop: true })
    expect(clipInlineCompletion('走吧。\n', 'sentence', { streaming: true })).toEqual({ text: '走吧。', stop: true })
    expect(clipInlineCompletion('一段话\n', 'paragraph', { streaming: true })).toEqual({ text: '一段话', stop: true })
    expect(clipInlineCompletion('字'.repeat(60), 'sentence', { streaming: true }).stop).toBe(true)
    expect(clipInlineCompletion('', 'sentence')).toEqual({ text: '', stop: false })
  })
  it('rejects malformed or excessive inspiration results and gives stable local candidate ids', () => {
    const result = parseInspirationResult({ directions: [{ id: 'untrusted', title: '渡口', premise: '船工修船', conflict: '信用与代价' }] }, 'directions')
    expect(result.directions?.[0].id).toBe('direction-1')
    expect(() => parseInspirationResult({ packages: [{ title: '空简介' }] }, 'packaging')).toThrow()
    expect(() => parseInspirationResult({ directions: Array.from({ length: 4 }, () => ({ title: 'a', premise: 'b', conflict: 'c' })) }, 'directions')).toThrow()
    expect(inspirationBasis(' 新起点 ', '限制')).not.toBe(inspirationBasis('旧起点', '限制'))
    expect(inspirationBasis(' 起点 ', ' 限制 ')).toBe(inspirationBasis('起点', '限制'))
  })
})
