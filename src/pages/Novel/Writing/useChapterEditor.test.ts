import { describe, expect, it } from 'vitest'
import {
  countChapterWords,
  createChapterEditorHistory,
  normalizeEditorText,
} from './useChapterEditor'

describe('chapter editor controller', () => {
  it('normalizes line endings and counts Chinese and English words', () => {
    expect(normalizeEditorText('第一行\r\nsecond line')).toBe('第一行\nsecond line')
    expect(countChapterWords('第一章 hello world')).toBe(5)
  })

  it('keeps undo and redo transitions isolated after a chapter reset', () => {
    const history = createChapterEditorHistory()
    history.reset('chapter one', 100)
    history.record('chapter one revised', 900)

    expect(history.undo('chapter one revised')).toBe('chapter one')
    expect(history.redo('chapter one')).toBe('chapter one revised')

    history.reset('chapter two', 2_000)
    expect(history.undo('chapter two')).toBeNull()
    expect(history.redo('chapter two')).toBeNull()
  })

  it('invalidates redo history after a new edit branch', () => {
    const history = createChapterEditorHistory()
    history.reset('draft', 100)
    history.record('draft v2', 900)
    expect(history.undo('draft v2')).toBe('draft')

    history.record('alternate v2', 1_800)
    expect(history.redo('alternate v2')).toBeNull()
  })
})
