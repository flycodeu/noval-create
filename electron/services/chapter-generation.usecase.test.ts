import { describe, expect, it } from 'vitest'
import {
  __testing,
  generateChapterContent,
  generateChapterSummary,
  refreshChapterDerivedState,
  resumeChapterPipeline,
  retryChapterPipelineNode,
} from './chapter-generation.usecase'

describe('chapter generation usecase owner', () => {
  it('exposes the existing pipeline entrypoints without a second implementation', () => {
    expect(typeof generateChapterContent).toBe('function')
    expect(typeof generateChapterSummary).toBe('function')
    expect(typeof refreshChapterDerivedState).toBe('function')
    expect(typeof resumeChapterPipeline).toBe('function')
    expect(typeof retryChapterPipelineNode).toBe('function')
  })

  it('requires the immediately preceding chapter body before generation', () => {
    const check = __testing.assertPreviousChapterContentReady
    expect(() => check(1, [])).not.toThrow()
    expect(() => check(3, [{ chapterNum: 1, content: '第一章正文' }])).toThrow('第2章')
    expect(() => check(3, [
      { chapterNum: 1, content: '第一章正文' },
      { chapterNum: 2, content: '  ' },
    ])).toThrow('只有大纲或摘要不能作为跨章续写依据')
    expect(() => check(3, [
      { chapterNum: 2, content: '尚未定稿但已有真实正文的草稿' },
    ])).not.toThrow()
  })
})
