import { describe, expect, it } from 'vitest'
import { selectedChapterParagraphs } from './chapter-revision-selection'

describe('editor paragraph revision selection', () => {
  const text = '第一段。\r\n \r\n第二段。\r\n\r\n第三段。'
  it('maps a selection to the same one-based paragraphs used by the server', () => {
    const second = text.indexOf('第二段')
    const third = text.indexOf('第三段')
    expect(selectedChapterParagraphs(text, second + 1, second + 3)).toEqual([2])
    expect(selectedChapterParagraphs(text, second, third)).toEqual([2])
    expect(selectedChapterParagraphs(text, 1, third + 1)).toEqual([1, 2, 3])
  })
  it('ignores empty, invalid and separator-only selections', () => {
    expect(selectedChapterParagraphs(text, 4, text.indexOf('第二段'))).toEqual([])
    expect(selectedChapterParagraphs(text, 0, 0)).toEqual([])
    expect(selectedChapterParagraphs(text, -1, 2)).toEqual([])
    expect(selectedChapterParagraphs(text, 0, text.length + 1)).toEqual([])
  })
})
