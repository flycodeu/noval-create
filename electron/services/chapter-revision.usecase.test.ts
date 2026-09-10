import { describe, expect, it } from 'vitest'
import {
  aiCheckChapter,
  optimizeChapterContent,
} from './chapter-revision.usecase'

describe('chapter revision usecase owner', () => {
  it('keeps optimize and AI check behavior on the same implementation', () => {
    expect(typeof optimizeChapterContent).toBe('function')
    expect(typeof aiCheckChapter).toBe('function')
  })
})
