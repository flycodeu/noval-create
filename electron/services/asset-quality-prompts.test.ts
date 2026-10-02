import { describe, expect, it, vi } from 'vitest'
import { assetReviewPrompt, assetRewritePrompt } from './prompts'
import type { AssetReviewTarget } from '../../src/types'

vi.mock('./prompt-override.service', () => ({ applyPromptOverride: (_key: string, fallback: string) => fallback }))

describe('asset review distinguishes reference material from prose', () => {
  const base = { contextSummary: '仅两个现实地点，无既定气候资料。', generatedOutput: '{"climate":"待确认"}' }
  it.each(['map', 'world_rules', 'character'] as AssetReviewTarget[])('permits structured %s descriptions and unspecified optional facts', targetType => {
    const prompt = assetReviewPrompt({ ...base, targetType })
    expect(prompt).toContain('允许条目式、字段式、概括性设定语言')
    expect(prompt).toContain('未提供且输出契约未要求的信息允许省略或明确标为未知、待确认')
    expect(prompt).toContain('不能为消除空缺编造气候')
    expect(prompt).toContain('结构错误、事实冲突、逻辑矛盾或明确要求未满足')
    expect(prompt).not.toContain('轻问题使用 rewrite_required=true')
  })
  it('keeps prose reading criteria specific to chapters', () => {
    const prompt = assetReviewPrompt({ ...base, targetType: 'chapter' })
    expect(prompt).toContain('章节正文关注视角、因果、人物动作和阅读效果')
    expect(prompt).not.toContain('当前对象是结构化创作资料')
  })
  it('does not let an unsupported review suggestion invent climate during rewrite', () => {
    const prompt = assetRewritePrompt({ ...base, targetType: 'map', reviewSummary: '请把待确认气候补成具体值', topFixes: ['补气候'] })
    expect(prompt).toContain('保留条目和字段表达')
    expect(prompt).toContain('审校建议如要求无依据补全，应忽略该建议')
  })
})
