import { describe, expect, it } from 'vitest'

import type { Novel } from '../../../types'
import { buildPlanningContextSections, PLANNING_CONTEXT_MAX_CHARS } from './planning-context'

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
})
