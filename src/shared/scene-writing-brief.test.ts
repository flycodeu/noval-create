import { describe, expect, it } from 'vitest'
import { buildSceneWritingBrief, formatSceneWritingBrief } from './scene-writing-brief'

describe('scene writing brief', () => {
  it('projects explicit scene design fields without inventing facts', () => {
    const brief = buildSceneWritingBrief({
      scene_order: 2,
      scene_title: '账房对质',
      purpose: '拿到账册缺页的去向',
      conflict: '沈砚青要求查账，赵队长拒绝',
      hidden_agendas: ['沈砚青想确认内鬼', '赵队长想保住侄子'],
      irony_gap: '读者知道缺页已被藏进药箱，赵队长不知道',
      theme_question: '守规矩是否值得付出代价',
      theme_choice: '沈砚青公开点名查账',
      theme_cost: '失去队内信任',
      theme_consequence: '搜查权限被收回',
    }, { targetWorkSampleGuide: '', humanStyleSampleLock: '' }, { knownFacts: ['只确认账册缺页'] })

    expect(brief.scene.purpose).toContain('拿到账册')
    expect(brief.scene.hiddenAgendas).toHaveLength(2)
    expect(brief.sourceKeys).toContain('ScenePlanStep.theme_cost')
    expect(brief.knownState.knownFacts).toEqual(['只确认账册缺页'])
    expect(formatSceneWritingBrief(brief)).toContain('不补造人物动机、经历、物件或关系')
  })

  it('keeps empty scene inputs empty instead of filling a template motive', () => {
    const brief = buildSceneWritingBrief(null, { targetWorkSampleGuide: '', humanStyleSampleLock: '' })
    expect(brief.scene.purpose).toBe('')
    expect(brief.scene.hiddenAgendas).toEqual([])
    expect(brief.diagnostics.join('\n')).toContain('保持空白')
  })

  it('selects at most two complete sample paragraphs within 600 estimated tokens', () => {
    const brief = buildSceneWritingBrief(null, {
      targetWorkSampleGuide: '作者说明：句子克制，现场细节优先。',
      humanStyleSampleLock: '第一段样稿，保留完整。\n\n第二段样稿，也保留完整。\n\n第三段样稿，不应进入。',
    })
    expect(brief.authorStyle.samples).toHaveLength(2)
    expect(brief.authorStyle.samples[0]).toBe('第一段样稿，保留完整。')
    expect(brief.authorStyle.samples[1]).toBe('第二段样稿，也保留完整。')
    expect(brief.authorStyle.estimatedTokens).toBeLessThanOrEqual(600)
    expect(brief.authorStyle.sampleSources).toEqual([
      'ThemeVoice.humanStyleSampleLock#1',
      'ThemeVoice.humanStyleSampleLock#2',
    ])
    expect(brief.authorStyle.samples.join('')).not.toContain('第三段')
  })

  it('omits an overlong paragraph rather than truncating a condition', () => {
    const longSample = '长'.repeat(1200)
    const brief = buildSceneWritingBrief(null, { targetWorkSampleGuide: '', humanStyleSampleLock: longSample })
    expect(brief.authorStyle.samples).toEqual([])
    expect(brief.authorStyle.omittedSamples).toBe(1)
    expect(brief.diagnostics.join('\n')).toContain('未截断片段')
  })
})
