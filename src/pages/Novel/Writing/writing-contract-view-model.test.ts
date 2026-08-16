import { describe, expect, it } from 'vitest'
import { buildChapterContractSections, buildSceneContractSections } from './writing-contract-view-model'
import type { ScenePlanStep } from './parsers'

describe('writing contract view models', () => {
  it('projects bounded scene details in their original order', () => {
    const scenes = Array.from({ length: 7 }, (_, index) => ({
      scene_order: index + 1,
      scene_title: `场景${index + 1}`,
      purpose: `目标${index + 1}`,
      present_characters: index === 0 ? ['林舟', '陈遥'] : [],
      must_cover: index === 0 ? ['交付线索'] : [],
    })) as ScenePlanStep[]

    const sections = buildSceneContractSections(scenes)

    expect(sections).toHaveLength(6)
    expect(sections[0]).toMatchObject({
      key: '1-场景1',
      title: '场景 01 · 场景1',
      items: ['目的：目标1', '人物：林舟、陈遥', '必须覆盖：交付线索'],
      tone: 'soft',
    })
  })

  it('keeps chapter goals, risks and acceptance evidence in separate sections', () => {
    const sections = buildChapterContractSections({
      chapter: {
        summary: '推进调查',
        outline: '进入旧仓库',
        targetWords: 3000,
        nextChapterSeed: '发现账本',
      } as Parameters<typeof buildChapterContractSections>[0]['chapter'],
      scenePlan: [{ scene_order: 1, scene_title: '潜入', purpose: '取证' }] as ScenePlanStep[],
      activeThreads: ['失踪线'],
      dueForeshadowItems: ['旧钥匙'],
      truthRevealOverLimit: true,
      staleReasons: ['人物状态变化'],
      publishCheck: null,
      contractAudit: null,
    })

    expect(sections.map((section) => section.key)).toEqual([
      'goal', 'scene-list', 'threads', 'foreshadow', 'forbidden', 'acceptance',
    ])
    expect(sections[0].items).toContain('下一章接力：发现账本')
    expect(sections[4].items).toEqual([
      '当前卷真相揭示比例超限，避免提前泄露关键真相。',
      '上下文未同步：人物状态变化',
    ])
  })
})
