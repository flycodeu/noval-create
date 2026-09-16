import { describe, expect, it } from 'vitest'
import { parseAssetReviewResult } from './asset-quality.service'
import { createQualityIssue } from '../../src/shared/quality-issue'

describe('RF-13 external chapter review action policy', () => {
  const content = '她已经把信烧掉，随后又拿出了同一封信。'
  it('does not use model booleans or style severity as compulsory rewrite', () => {
    const raw = JSON.stringify({ severity: 'high', rewrite_required: true, reject_required: true, language_risks: ['文风不喜欢'] })
    expect(parseAssetReviewResult(raw, content, 'reader-first-v1')).toMatchObject({ rewriteRequired: false, rejectRequired: false })
    expect(parseAssetReviewResult(raw)).toMatchObject({ rewriteRequired: true, rejectRequired: true })
  })
  it('preserves grounded repair and invalidates old evidence', () => {
    const issue = createQualityIssue({ ruleId: 'continuity_break', detector: 'model', content, excerpt: content, message: '物品状态矛盾' })
    const raw = JSON.stringify({ issues: [issue], rewrite_required: false })
    expect(parseAssetReviewResult(raw, content, 'reader-first-v1').rewriteRequired).toBe(true)
    expect(parseAssetReviewResult(raw, content + '新稿', 'reader-first-v1').rewriteRequired).toBe(false)
  })
})
