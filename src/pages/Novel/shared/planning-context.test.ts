import { describe, expect, it } from 'vitest'

import type { Novel } from '../../../types'
import { buildPlanningContextSections, PLANNING_CONTEXT_DEFAULT_TOKEN_BUDGET, PLANNING_CONTEXT_MAX_CHARS } from './planning-context'
import { estimateTokens } from '../../../shared/token-budget'

describe('planning context assembly', () => {
  it('deduplicates sections and keeps extra context within a bounded budget', () => {
    const novel = {
      title: '测试小说',
      genreName: '悬疑',
      synopsis: '同一条故事承诺。',
      expandedBackground: '背景'.repeat(3000),
    } as unknown as Novel

    const sections = buildPlanningContextSections(novel, {
      extraSections: [
        { label: '题材', value: '不应覆盖已有题材' },
        { label: '重复上下文', value: '相同上下文'.repeat(20) },
        { label: '重复上下文', value: '第二段不应再次进入提示词' },
      ],
    })
    const labels = sections.map((section) => section.label)
    const totalChars = sections.reduce((total, section) => total + section.label.length + String(section.value || '').length + 4, 0)

    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('题材')
    expect(sections.filter((section) => section.label === '重复上下文')).toHaveLength(1)
    expect(totalChars).toBeLessThanOrEqual(PLANNING_CONTEXT_MAX_CHARS)
  })

  it('applies an explicit token budget without relaxing the character cap', () => {
    const sections = buildPlanningContextSections({
      title: '短篇',
      genreName: '科幻',
      synopsis: '核心冲突',
      expandedBackground: '背景材料 '.repeat(1200),
    } as unknown as Novel, {
      tokenBudget: 120,
      extraSections: [{ label: '补充', value: '额外资料 '.repeat(100) }],
    })
    const estimatedTokens = sections.reduce(
      (total, section) => total + estimateTokens(`${section.label}：${String(section.value || '')}`),
      0,
    )
    const totalChars = sections.reduce((total, section) => total + section.label.length + String(section.value || '').length + 4, 0)

    expect(estimatedTokens).toBeLessThanOrEqual(120)
    expect(totalChars).toBeLessThanOrEqual(PLANNING_CONTEXT_MAX_CHARS)
    expect(PLANNING_CONTEXT_DEFAULT_TOKEN_BUDGET).toBeGreaterThan(120)
  })
})
