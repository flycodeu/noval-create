import { describe, expect, it } from 'vitest'
import { renderPromptOverrideTemplate } from './prompt-override.service'

describe('renderPromptOverrideTemplate', () => {
  it('marks unknown placeholders instead of silently deleting context', () => {
    const rendered = renderPromptOverrideTemplate(
      '目标：{chapterGoal}\n错误字段：{chapterGoals}',
      { chapterGoal: '守住渡口' },
    )

    expect(rendered).toContain('目标：守住渡口')
    expect(rendered).toContain('[MISSING_PARAM:chapterGoals]')
  })
})
