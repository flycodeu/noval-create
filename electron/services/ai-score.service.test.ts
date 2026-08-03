import { describe, expect, it } from 'vitest'
import { enhanceAiScoreResult, toChapterAiCheckResult } from './ai-score.service'

describe('ai-score.service', () => {
  it('normalizes rich scoring output when overall_score is omitted', () => {
    const enhanced = enhanceAiScoreResult({
      ai_like_rate: 30,
      repetition_risk: '中',
      overall_feedback: '文本整体自然。',
      top_fixes: ['减少解释性句子。'],
    }, '方大炉把检修钳夹上法兰。')

    expect(enhanced.overall_score).toBe(70)
    expect(enhanced.dimensions).toEqual([{
      name: '综合质量',
      score: 70,
      feedback: '文本整体自然。',
      suggestion: '减少解释性句子。',
    }])
    const chapterResult = toChapterAiCheckResult({
      ai_like_rate: 30,
      overall_feedback: '文本整体自然。',
      top_fixes: ['减少解释性句子。'],
    }, enhanced)
    expect(chapterResult.score).toBe(70)
    expect(chapterResult.issues).toEqual([
      { type: '重点修复', location: '', suggestion: '减少解释性句子。' },
    ])
  })

  it('keeps the legacy score/issues contract for chapter AI check consumers', () => {
    const raw = {
      score: 82,
      ai_like_rate: 18,
      overall_feedback: '有两处需要收紧。',
      issues: [{ type: '模板句', location: '他顿了顿', suggestion: '改成具体反应。', severity: 'medium' }],
    }
    const enhanced = enhanceAiScoreResult(raw, '他顿了顿。')
    const result = toChapterAiCheckResult(raw, enhanced)

    expect(enhanced.overall_score).toBe(82)
    expect(result.score).toBe(82)
    expect(result.issues[0]).toEqual({
      type: '模板句',
      location: '他顿了顿',
      suggestion: '改成具体反应。',
      severity: 'medium',
    })
  })

  it('converts model outputs that use 0-1 and 0-10 scales into the UI 0-100 contract', () => {
    const enhanced = enhanceAiScoreResult({
      ai_like_rate: 0.15,
      overall_score: 7,
      overall_feedback: '存在一处对象概念错配。',
    }, '气压骤降。')

    expect(enhanced.ai_like_rate).toBe(15)
    expect(enhanced.overall_score).toBe(70)
  })
})
