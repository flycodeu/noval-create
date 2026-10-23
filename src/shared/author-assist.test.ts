import { describe, expect, it } from 'vitest'
import { parseReferenceCandidates } from './reference-extraction'
import { normalizeContractChecks } from './chapter-review-view'
import { assertSelectionRange, replaceSelection } from './selection-revision'

const draft = { category: 'narrative', title: '抵押与代价', content: '船工以绳索作为抵押。', interpretation: '信用由真实损失担保。', novelConnection: '用修船责任塑造选择。' }

describe('reference evidence', () => {
  it('keeps invalid and ambiguous evidence visible but non-adoptable', () => {
    expect(parseReferenceCandidates({ cards: [{ ...draft, quote: '不存在的原句' }] }, '船工留下绳索。')[0].error).toBeTruthy()
    expect(parseReferenceCandidates({ cards: [{ ...draft, quote: '留下绳索' }] }, '留下绳索，又留下绳索。')[0].error).toBeTruthy()
    expect(parseReferenceCandidates({ cards: [{ ...draft, quote: '留下绳索', start: 7, end: 11 }] }, '留下绳索，又留下绳索。')[0].error).toBeTruthy()
    expect(parseReferenceCandidates({ cards: [{ ...draft, quote: '留下绳索', start: 0, end: 100 }] }, '留下绳索')[0].error).toBeTruthy()
  })
  it('locates an unchanged Unicode source and preserves its literal quote', () => {
    const source = '😀船工留下绳索作为抵押。'
    const card = parseReferenceCandidates({ cards: [{ ...draft, quote: '留下绳索作为抵押' }] }, source)[0]
    expect(card.error).toBeUndefined()
    expect(source.slice(card.start, card.end)).toBe(card.quote)
  })
})

describe('review coverage', () => {
  it('never reports met when the evidence is absent or fabricated', () => {
    const checks = normalizeContractChecks([
      { contractItemId: 'goal', status: 'met', reason: '完成', evidence: [] },
      { contractItemId: 'exit', status: 'met', reason: '完成', evidence: [{ start: 0, end: 4, quote: '原文没有' }] },
      { contractItemId: 'missing', status: 'unmet', reason: '没有写到约定的事件', evidence: [] },
      { contractItemId: 'bad-proof', status: 'unmet', reason: '声称存在问题，但引文无效', evidence: [{ start: 0, end: 4, quote: '不存在的' }] },
    ], '船工收好绳索。')
    expect(checks.map(check => check.status)).toEqual(['uncertain', 'uncertain', 'unmet', 'uncertain'])
    expect(normalizeContractChecks(undefined, '正文')).toEqual([])
  })
})

describe('selection replacement', () => {
  it('replaces only the exact selected occurrence, including after emoji and newline', () => {
    const content = '😀留下绳索。\n又留下绳索。'
    const start = content.lastIndexOf('留下绳索')
    const result = replaceSelection(content, { start, end: start + 4, original: '留下绳索', replacement: '收回旧绳' })
    expect(result).toBe('😀留下绳索。\n又收回旧绳。')
  })
  it('rejects stale ranges and split surrogate pairs', () => {
    expect(() => replaceSelection('原稿已改', { start: 0, end: 2, original: '旧稿', replacement: '新稿' })).toThrow()
    expect(() => assertSelectionRange('😀正文', { start: 1, end: 3, original: '\ude00正' })).toThrow()
  })
})
