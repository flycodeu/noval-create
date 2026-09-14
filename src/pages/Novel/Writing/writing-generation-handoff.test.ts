import { describe, expect, it } from 'vitest'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import { buildGenerationHandoffViewModel } from './writing-generation-handoff'

const writability = {
  ready: true,
  score: 100,
  label: '高',
  summary: '可写',
  risks: [],
  suggestions: [],
  checks: [
    { key: 'chapter-contract', label: '章节合同', ready: true, detail: '已就绪', required: true },
  ],
} satisfies ChapterWritabilitySummary

describe('generation handoff presentation', () => {
  it('shows author style as useful evidence without making it a hard generation gate', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      writability,
      contextPreview: {
        chapterId: 1,
        chapterNum: 1,
        previousChapterContext: '',
        chapterBridgePlan: '从雨夜车站承接到清晨审讯室。',
        authorStyleLock: { enabled: false, sourceLabel: '主题与文风护栏', toneKeywords: [], preferredLexicon: [], forbiddenPatterns: [], hardRules: [] },
        stages: [],
      } as never,
    })

    expect(model.status).toBe('attention')
    expect(model.styleReady).toBe(false)
    expect(model.summary).toContain('不是生成硬门槛')
    expect(model.items.find((item) => item.key === 'previous-chapter')?.ready).toBe(true)
  })

  it('blocks when required chapter inputs are not ready', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      writability: { ...writability, ready: false, checks: [{ ...writability.checks[0], ready: false }] },
      contextPreview: null,
      contextPreviewError: '预览失败',
    })

    expect(model.status).toBe('blocked')
    expect(model.items.some((item) => item.detail === '上下文预览未完成。请到上下文视图查看原因并重试。')).toBe(true)
  })

  it('hides internal context identifiers from the author-facing summary', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      writability,
      contextPreview: null,
      contextPreviewError: 'NF_CONTEXT_REQUIRED_OVERFLOW: legacy:chapterGoal:abc123',
    })

    const contextItem = model.items.find((item) => item.key === 'context-preview')
    expect(contextItem?.detail).toContain('关键上下文超出模型预算')
    expect(contextItem?.detail).not.toContain('NF_CONTEXT_REQUIRED_OVERFLOW')
    expect(contextItem?.detail).not.toContain('legacy:chapterGoal')
  })
})
