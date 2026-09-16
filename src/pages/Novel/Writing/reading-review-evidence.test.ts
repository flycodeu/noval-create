import { describe, expect, it } from 'vitest'
import { createQualityIssue, qualityIssueArtifactHash } from '../../../shared/quality-issue'
import { readCurrentReviewIssues, isCurrentReviewEvidence } from './reading-review-evidence'
import { applyRevisionPatch } from '../../../shared/revision-patch'

describe('RF-14 current draft evidence', () => {
  const content = '她把信折好，又把信折好，收进抽屉。'
  const evidence = { artifactHash: qualityIssueArtifactHash(content), start: 6, end: 12, quote: content.slice(6, 12) }
  it('keeps advice and current exact evidence separate from stale drafts', () => {
    const issue = createQualityIssue({ ruleId: 'exposition_density', detector: 'heuristic', message: '重复动作', content, excerpt: evidence.quote })
    const raw = JSON.stringify({ issues: [issue] })
    expect(readCurrentReviewIssues(raw, content)[0].current).toBe(true)
    expect(readCurrentReviewIssues(raw, content + '新句。')[0].current).toBe(false)
    expect(isCurrentReviewEvidence({ ...evidence, start: -1 }, content)).toBe(false)
    expect(readCurrentReviewIssues('{', content)).toEqual([])
  })
  it('candidate application preserves neighbors and rejects edits and locked passages', () => {
    const patch = { baseArtifactHash: evidence.artifactHash, patches: [{ start: 6, end: 12, expectedText: evidence.quote, replacement: '', issueIds: ['author-selection'] }] }
    expect(applyRevisionPatch(content, patch)).toBe(content.slice(0, 6) + content.slice(12))
    expect(() => applyRevisionPatch(content + '新句。', patch)).toThrow()
    expect(() => applyRevisionPatch(content, patch, [{ start: 6, end: 12 }])).toThrow()
  })
})
