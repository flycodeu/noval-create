import { describe, expect, it, vi } from 'vitest'

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, prompt: string) => prompt,
}))

import { contentScoringPrompt } from './prompts'

describe('prompts content scoring', () => {
  it('uses one valid JSON output schema without smart-quote duplicates', () => {
    const prompt = contentScoringPrompt({
      contentType: '正文片段',
      content: '林远把钥匙放回抽屉。',
      genreContext: '现代悬疑',
      novelBackground: '县城旧案重查。',
    })

    const outputRules = prompt.match(/只输出 JSON：/g) || []
    expect(outputRules).toHaveLength(1)
    expect(prompt).not.toContain('“dimensions”')
    expect(prompt).toContain('"weak_dimensions"')
    expect(prompt).toContain('"准确度"')
  })
})
