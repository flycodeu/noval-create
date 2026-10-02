import { describe, expect, it } from 'vitest'
import { parseAssetReviewResult } from './asset-quality.service'
import { createQualityIssue } from '../../src/shared/quality-issue'

describe('RF-13 external chapter review action policy', () => {
  const content = '她已经把信烧掉，随后又拿出了同一封信。'
  it('does not use model booleans or style severity as compulsory rewrite', () => {
    const issue = createQualityIssue({ ruleId: 'style_forbidden_pattern', detector: 'model', content, message: '文风偏好' })
    const raw = JSON.stringify({ summary: '文风偏好', issues: [issue], severity: 'high', rewrite_required: true, reject_required: true, language_risks: ['文风不喜欢'] })
    expect(parseAssetReviewResult(raw, content, 'reader-first-v1')).toMatchObject({ rewriteRequired: false, rejectRequired: false })
    expect(parseAssetReviewResult(raw)).toMatchObject({ rewriteRequired: true, rejectRequired: true })
  })
  it('preserves grounded repair and invalidates old evidence', () => {
    const issue = createQualityIssue({ ruleId: 'continuity_break', detector: 'model', content, excerpt: content, message: '物品状态矛盾' })
    const raw = JSON.stringify({ summary: '核查物品连续性', issues: [issue], rewrite_required: false, reject_required: false })
    expect(parseAssetReviewResult(raw, content, 'reader-first-v1').rewriteRequired).toBe(true)
    expect(() => parseAssetReviewResult(raw, content + '新稿', 'reader-first-v1')).toThrow('有效原文证据')
  })
  it('rejects a structurally empty review instead of treating it as approval', () => {
    expect(() => parseAssetReviewResult('{}')).toThrow('审校结果缺少')
  })
  it('does not erase a rejection with missing or empty issues', () => {
    const raw = { summary: '出现事实矛盾', rewrite_required: false, reject_required: true }
    expect(() => parseAssetReviewResult(JSON.stringify(raw), content, 'reader-first-v1')).toThrow('issues')
    expect(() => parseAssetReviewResult(JSON.stringify({ ...raw, issues: [] }), content, 'reader-first-v1')).toThrow('缺少对应问题')
    expect(parseAssetReviewResult(JSON.stringify({ ...raw, reject_required: false, issues: [] }), content, 'reader-first-v1').rejectRequired).toBe(false)
  })
  it('rejects factual claims without quotes and unknown issue rules', () => {
    const review = (ruleId: string) => JSON.stringify({ summary: '待核实', issues: [{ ruleId, message: '矛盾' }], rewrite_required: false, reject_required: false })
    expect(() => parseAssetReviewResult(review('continuity_break'), content, 'reader-first-v1')).toThrow('有效原文证据')
    expect(() => parseAssetReviewResult(review('invented_rule'), content, 'reader-first-v1')).toThrow('有效规则')
  })
})
