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
      chapterNum: 1,
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
    expect(model.items.some((item) => item.key === 'previous-chapter' || item.key === 'chapter-bridge')).toBe(false)
    expect(model.totalCount).toBe(writability.checks.length + 1)
  })

  it('does not count missing previous chapter context before the first preview loads', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      chapterNum: 1,
      writability,
      contextPreview: null,
    })

    expect(model.items.some((item) => item.key === 'previous-chapter' || item.key === 'chapter-bridge')).toBe(false)
    expect(model.readyCount).toBe(1)
    expect(model.totalCount).toBe(2)
  })

  it('does not show a stale preview from another chapter as ready', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      chapterNum: 2,
      writability,
      contextPreview: {
        chapterId: 1,
        chapterNum: 1,
        previousChapterContext: '',
        chapterBridgePlan: '旧章的衔接桥',
        stages: [],
      } as never,
    })

    expect(model.items.find((item) => item.key === 'context-preview')?.ready).toBe(false)
    expect(model.items.find((item) => item.key === 'chapter-bridge')?.ready).toBe(false)
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

  it('shows advisory writability gaps as attention when the generation preflight passes', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      chapterNum: 1,
      writability: { ...writability, ready: false, checks: [{ ...writability.checks[0], ready: false }] },
      preflight: { ready: true, messages: [] },
      contextPreview: null,
    })

    expect(model.status).toBe('attention')
    expect(model.summary).toContain('生成前检查')
  })

  it('shows a writeback preflight block instead of claiming handoff is ready', () => {
    const model = buildGenerationHandoffViewModel({
      hasChapter: true,
      writability,
      preflight: { ready: false, messages: ['先完成上一章回写确认。'] },
      contextPreview: {
        chapterId: 2,
        chapterNum: 2,
        previousChapterContext: '上一章已发生的事实。',
        chapterBridgePlan: '紧接上一章。',
        authorStyleLock: { enabled: true, sourceLabel: '作者样章', toneKeywords: [], preferredLexicon: [], forbiddenPatterns: [], hardRules: [] },
        stages: [],
      } as never,
    })

    expect(model.status).toBe('blocked')
    expect(model.items.find((item) => item.key === 'generation-preflight')?.detail).toBe('先完成上一章回写确认。')
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
