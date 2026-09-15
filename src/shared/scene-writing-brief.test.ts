import { describe, expect, it } from 'vitest'
import { buildSceneWritingBrief, formatAuthorStyleReference, formatSceneWritingBrief } from './scene-writing-brief'

describe('scene writing brief', () => {
  it('RF-09 carries independent wants and calm aftermath as one scene material', () => {
    const brief = buildSceneWritingBrief({ purpose: '照护安排后的相处', story_design: {
      choices: [{ character: '周宁', wants: '陪母亲又不耽误交班', options: ['吃饭后回店'], stake: '同事也要回家' }],
      result: '安静吃完饭', aftermath: '母亲送她出门',
    } }, { targetWorkSampleGuide: '', humanStyleSampleLock: '' })
    const text = formatSceneWritingBrief(brief)
    expect(text.split('同事也要回家')).toHaveLength(2)
    expect(text).toContain('后续余波：母亲送她出门')
    expect(brief.diagnostics).toEqual([])
  })
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
    expect(formatSceneWritingBrief(brief)).toContain('作者样稿控制表达方式')
    expect(formatSceneWritingBrief(brief)).toContain('不得改写事实')
  })

  it('keeps empty scene inputs empty instead of filling a template motive', () => {
    const brief = buildSceneWritingBrief(null, { targetWorkSampleGuide: '', humanStyleSampleLock: '' })
    expect(brief.scene.purpose).toBe('')
    expect(brief.scene.hiddenAgendas).toEqual([])
    expect(brief.diagnostics.join('\n')).toContain('不补造冲突')
  })

  it('selects at most two complete sample paragraphs within 600 estimated tokens', () => {
    const brief = buildSceneWritingBrief(null, {
      targetWorkSampleGuide: '作者说明：句子克制，现场细节优先。',
      humanStyleSampleLock: '',
      approvedSample: { source: 'style_fingerprints:1', digest: 'fixture', text: '第一段样稿，保留完整。\n\n第二段样稿，也保留完整。\n\n第三段样稿，不应进入。' },
    })
    expect(brief.authorStyle.samples).toHaveLength(2)
    expect(brief.authorStyle.samples[0]).toBe('第一段样稿，保留完整。')
    expect(brief.authorStyle.samples[1]).toBe('第二段样稿，也保留完整。')
    expect(brief.authorStyle.estimatedTokens).toBeLessThanOrEqual(600)
    expect(brief.authorStyle.sampleSources).toEqual([
      'style_fingerprints:1#1',
      'style_fingerprints:1#2',
    ])
    expect(brief.authorStyle.samples.join('')).not.toContain('第三段')
  })

  it('omits an overlong paragraph rather than truncating a condition', () => {
    const longSample = '长'.repeat(1200)
    const brief = buildSceneWritingBrief(null, { targetWorkSampleGuide: '', humanStyleSampleLock: '', approvedSample: { source: 'fixture', digest: 'fixture', text: longSample } })
    expect(brief.authorStyle.samples).toEqual([])
    expect(brief.authorStyle.omittedSamples).toBe(1)
    expect(brief.diagnostics.join('\n')).toContain('未截断片段')
  })

  it('renders selected author feedback even when no style sample is active', () => {
    const brief = buildSceneWritingBrief(null, {
      targetWorkSampleGuide: '',
      humanStyleSampleLock: '',
      readerFeedback: {
        settingsRevision: 3,
        selected: [{
          id: 'feedback-1', novelId: 1,
          source: { chapterId: 2, contentHash: 'hash', start: 0, end: 2, excerptHash: 'excerpt' },
          note: '让她先停顿，再回答。', topic: '对白节奏', sentiment: 'reduce',
          scope: { type: 'character', characterName: '沈宁' }, status: 'approved', version: 1,
          createdAt: '2026-09-15T00:00:00.000Z', updatedAt: '2026-09-15T00:00:00.000Z',
        }],
        states: [{ id: 'feedback-1', state: 'selected' }], conflicts: [], omittedCount: 0, diagnostics: [],
      },
    })
    expect(formatAuthorStyleReference(brief)).toContain('角色 沈宁')
    expect(brief.sourceKeys).toContain('ReaderFeedback.feedback-1')
  })
})
