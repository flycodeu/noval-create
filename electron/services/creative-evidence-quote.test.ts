import { describe, expect, it } from 'vitest'
import { matchesCreativeEvidenceQuote } from './creative-evidence-quote'

describe('continuous evidence quotation', () => {
  const prose = '陆闻解开笼扣。\r\n\r\n  阿烛移到干处。\n顾堂收起家书。'
  it('accepts exact, flattened and deleted paragraph whitespace without changing the quote', () => {
    for (const quote of ['陆闻解开笼扣。\r\n\r\n  阿烛移到干处。', '陆闻解开笼扣。 阿烛移到干处。', '陆闻解开笼扣。阿烛移到干处。']) {
      expect(matchesCreativeEvidenceQuote(prose, quote)).toBe(true)
    }
  })
  it('rejects paraphrases, altered punctuation, omissions and reordered evidence', () => {
    for (const quote of ['陆闻打开笼扣。阿烛移到干处。', '陆闻解开笼扣，阿烛移到干处。', '陆闻解开笼扣。顾堂收起家书。', '阿烛移到干处。陆闻解开笼扣。', '陆闻解开笼扣。……顾堂收起家书。']) {
      expect(matchesCreativeEvidenceQuote(prose, quote)).toBe(false)
    }
  })
  it('requires at least four non-whitespace characters', () => {
    expect(matchesCreativeEvidenceQuote(prose, '陆闻   ')).toBe(false)
    expect(matchesCreativeEvidenceQuote(prose, ' \n\t ')).toBe(false)
  })
})
