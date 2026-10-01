import { describe, expect, it } from 'vitest'
import { buildAdjacentChapterPlanningEvidence } from './outline-generation.service'
import { buildChapterOutlinePlanningPrompt } from '../../src/shared/prompts/planning-prompts'

describe('chapter outline adjacent evidence', () => {
  it('uses only the exact previous chapter and separates prose from plans', () => {
    const chapters = [
      { chapterNum: 1, title: '开端', content: '更早的一章正文。', outline: '旧规划' },
      { chapterNum: 2, title: '渡河', content: '他把唯一钥匙交给姐姐。', outline: '计划过河' },
    ]
    const evidence = buildAdjacentChapterPlanningEvidence(3, chapters)
    expect(evidence).toContain('已保存正文结尾')
    expect(evidence).toContain('他把唯一钥匙交给姐姐')
    expect(evidence).toContain('仅为计划')
    expect(evidence).not.toContain('更早的一章正文')
  })

  it('does not promote a previous outline to something that happened', () => {
    const planned = buildAdjacentChapterPlanningEvidence(3, [
      { chapterNum: 2, content: '', outline: '计划在河边找到线索' },
    ])
    expect(planned).toContain('尚无正文')
    expect(planned).toContain('不能声称其中事件已经发生')
    expect(buildAdjacentChapterPlanningEvidence(3, [])).toContain('不能假定前章发生')
    expect(buildAdjacentChapterPlanningEvidence(1, [])).toBe('')
  })

  it('places the evidence in a named outline prompt section', () => {
    const prompt = buildChapterOutlinePlanningPrompt({
      novelTitle: '测试小说', genre: '悬疑', storyGoal: '找钥匙', coreConflict: '被追捕', mainPlot: '逃脱',
      arcName: '渡河', arcGoal: '过河', arcSummary: '追逃', chapterStart: 3, chapterEnd: 4,
      previousSummary: '', characterStates: '', continuitySummary: '', openLoops: '', worldRulesSummary: '',
      protagonistReference: '主角', protagonistRule: '主角叫阿河', adjacentChapterEvidence: '第2章已保存正文结尾：钥匙交给姐姐。',
    })
    expect(prompt).toContain('紧邻前章证据')
    expect(prompt).toContain('钥匙交给姐姐')
  })
})
