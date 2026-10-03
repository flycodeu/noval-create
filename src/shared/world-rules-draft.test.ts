import { describe, expect, it } from 'vitest'
import { normalizeWorldRulesDraft, parseWorldRulesDraftJson, stringifyWorldRulesDraft } from './world-rules-draft'

describe('world rules draft story clock persistence', () => {
  it('keeps the explicit story clock through the same double normalization used by novel.update', () => {
    const timelineConfig = { dynastyName: '景朝', storyStartLabel: '陆闻到白茅镇之日', currentTimeLabel: '到店当日白天，登记册对质后', currentTimeChapterNum: 3, currentTimeEvidence: '第三章结尾仍有廊外日光。', eraName: '年号未定' }
    const serialized = stringifyWorldRulesDraft(normalizeWorldRulesDraft({ timelineConfig }, '架空历史'))
    const restored = parseWorldRulesDraftJson(serialized, '架空历史')
    expect(restored.timelineConfig).toMatchObject(timelineConfig)
    expect(JSON.parse(stringifyWorldRulesDraft(restored)).timelineConfig).toMatchObject(timelineConfig)
  })
  it('does not fill missing story-clock values from a genre or promote an epoch into a dynasty', () => {
    const timeline = parseWorldRulesDraftJson('{"timelineConfig":{"epochLabel":"景朝"}}', '架空历史').timelineConfig
    expect(timeline.epochLabel).toBe('景朝')
    expect(timeline.dynastyName).toBeUndefined()
    expect(timeline.currentTimeLabel).toBeUndefined()
    expect(timeline.currentTimeChapterNum).toBeUndefined()
    expect(timeline.currentTimeEvidence).toBeUndefined()
  })
  it('preserves an explicit opening anchor while rejecting invalid chapter values and allowing clearing', () => {
    expect(normalizeWorldRulesDraft({ timelineConfig: { currentTimeChapterNum: 0 } }).timelineConfig.currentTimeChapterNum).toBe(0)
    for (const chapter of [-1, 1.5, '3', Number.POSITIVE_INFINITY]) expect(normalizeWorldRulesDraft({ timelineConfig: { currentTimeChapterNum: chapter } }).timelineConfig.currentTimeChapterNum).toBeUndefined()
    const initial = normalizeWorldRulesDraft({ timelineConfig: { dynastyName: '景朝', currentTimeLabel: '开篇当日', currentTimeChapterNum: 1, currentTimeEvidence: '日光' } })
    const cleared = stringifyWorldRulesDraft({ ...initial, timelineConfig: { ...initial.timelineConfig, currentTimeLabel: '', currentTimeChapterNum: undefined, currentTimeEvidence: '  ' } })
    expect(JSON.parse(cleared).timelineConfig).not.toHaveProperty('currentTimeLabel')
    expect(JSON.parse(cleared).timelineConfig).not.toHaveProperty('currentTimeChapterNum')
    expect(JSON.parse(cleared).timelineConfig).not.toHaveProperty('currentTimeEvidence')
    expect(JSON.parse(cleared).timelineConfig.dynastyName).toBe('景朝')
  })
})
