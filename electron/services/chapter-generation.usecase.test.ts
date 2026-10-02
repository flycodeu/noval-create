import { describe, expect, it, vi } from 'vitest'
import * as modelService from './model.service'
import { estimateRequestBudget } from './request-budget'
import {
  __testing,
  generateChapterContent,
  generateChapterSummary,
  refreshChapterDerivedState,
  resumeChapterPipeline,
  retryChapterPipelineNode,
} from './chapter-generation.usecase'

describe('chapter generation usecase owner', () => {
  it('uses the model-aware automatic budget at the final request gate and preserves explicit totals', () => {
    const runtime = vi.spyOn(modelService, 'resolveModelRuntimeBudget').mockReturnValue({
      maxContextTokens: 1_000_000, maxTokens: 393216,
      provider: 'deepseek', tokenSafetyMarginPct: 15,
    })
    try {
      const route = { tokenSafetyMarginPct: 15 } as never
      const chapter = { targetWords: 3200 } as never
      const novel = { targetWords: 1_000_000, modelConfigId: 7 } as never
      const auto = __testing.withChapterStageRequestBudget(
        { maxTokens: 393216 }, route, 'scenePlan', 'key', chapter, novel,
      )
      expect(auto.requestBudget?.stageBudget).toBe(458752)
      expect(auto.maxTokens).toBe(393216)
      expect(runtime).toHaveBeenCalledWith(7)
      expect(estimateRequestBudget({
        messages: [{ role: 'user', content: '本章明确的事实与合同。'.repeat(100) }],
        maxTokens: auto.maxTokens!, modelContextTokens: 1_000_000,
        ...auto.requestBudget,
      }).allowed).toBe(true)
      expect(__testing.withChapterStageRequestBudget(
        { maxTokens: 393216 }, route, 'scenePlan', 'key', chapter, novel, 500000,
      ).requestBudget?.stageBudget).toBe(500000)
    } finally {
      runtime.mockRestore()
    }
  })

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
