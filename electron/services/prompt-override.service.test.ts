import { describe, expect, it } from 'vitest'
import { buildProtectedFooter, renderPromptOverrideTemplate } from './prompt-override.service'

describe('renderPromptOverrideTemplate', () => {
  it('marks unknown placeholders instead of silently deleting context', () => {
    const rendered = renderPromptOverrideTemplate(
      '目标：{chapterGoal}\n错误字段：{chapterGoals}',
      { chapterGoal: '守住渡口' },
    )

    expect(rendered).toContain('目标：守住渡口')
    expect(rendered).toContain('[MISSING_PARAM:chapterGoals]')
  })

  it('forces runtime handoff context into protected chapter prompt footers', () => {
    const footer = buildProtectedFooter('chapterDraft', {
      chapterBridgePlan: '承接来源：第1章门外脚步声。',
      stepMemorySummary: 'Writer 不得重启到白天。',
      runtimeAssertions: ['前 200 字必须接住门外压力。'],
    })

    expect(footer).toContain('【系统强制接力上下文】')
    expect(footer).toContain('【章节衔接桥】')
    expect(footer).toContain('承接来源：第1章门外脚步声。')
    expect(footer).toContain('【步骤接力记忆】')
    expect(footer).toContain('Writer 不得重启到白天。')
    expect(footer).toContain('【运行时接力断言】')
    expect(footer).toContain('前 200 字必须接住门外压力。')
  })
})
