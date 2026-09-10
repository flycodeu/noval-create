import { describe, expect, it } from 'vitest'
import { parseStoredReviewNotes } from './chapter-review-notes'
import { resolvePublishQualityIssues } from './chapter-publish-quality-gates'
import {
  createQualityAnalysisMemo,
  getQualityAnalysisSnapshot,
} from './quality-analysis-snapshot'

const issue = {
  id: 'nf16-advice',
  ruleId: 'genre_register_drift',
  category: 'style',
  level: 'advice',
  detector: 'heuristic',
  confidence: null,
  evidence: [],
  scope: 'chapter',
  message: '语域轻微漂移',
}

function reviewJson(message = issue.message) {
  return JSON.stringify({
    issues: [{ ...issue, message }],
    contract_validation: {
      status: 'warning',
      summary: '一项承诺仍需兑现',
      itemResults: [{
        contractItemType: 'story_thread_progress',
        expected: '推进港口线索',
        verdict: 'weak',
      }],
      rewriteHints: ['补一次可见推进'],
    },
  })
}

describe('quality analysis snapshot', () => {
  it('reuses one pure analysis for the same artifact inside one request', () => {
    const memo = createQualityAnalysisMemo()
    const input = { content: '港口钟声响起。', reviewNotesJson: reviewJson(), contextVersion: 7 }

    const first = memo.get(input)
    const second = memo.get(input)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(second.issues).not.toBe(first.issues)
    expect(memo.diagnostics()).toEqual({ analysisCount: 1, entryCount: 1 })
  })

  it('invalidates on artifact, context, rules or review artifact changes', () => {
    const memo = createQualityAnalysisMemo()
    const base = { content: '正文 A', reviewNotesJson: reviewJson(), contextVersion: 2 }
    memo.get(base)
    memo.get({ ...base, content: '正文 B' })
    memo.get({ ...base, contextVersion: 3 })
    memo.get({ ...base, rulesVersion: 'rules-v2' })
    memo.get({ ...base, reviewNotesJson: reviewJson('另一条问题') })

    expect(memo.diagnostics()).toEqual({ analysisCount: 5, entryCount: 5 })
  })

  it('keeps old review artifacts compatible and validates explicit snapshots', () => {
    const raw = reviewJson()
    const snapshot = getQualityAnalysisSnapshot({
      content: '旧章节正文',
      reviewNotesJson: raw,
      contextVersion: 4,
    })
    const review = parseStoredReviewNotes(raw, {
      content: '旧章节正文',
      contextVersion: 4,
      snapshot,
    })
    const publishIssues = resolvePublishQualityIssues({
      content: '旧章节正文',
      reviewNotesJson: raw,
      contextVersion: 4,
      snapshot,
    })

    expect(review.issues).toEqual(snapshot.issues)
    expect(review.contract_validation).toEqual(snapshot.metrics.contractValidation)
    expect(publishIssues).toEqual(snapshot.issues)
    expect(getQualityAnalysisSnapshot({
      content: '正文已变化',
      reviewNotesJson: raw,
      contextVersion: 4,
    }, snapshot).artifactHash).not.toBe(snapshot.artifactHash)
    expect(parseStoredReviewNotes(JSON.stringify({ critical_fixes: ['保留旧修订项'] })).critical_fixes)
      .toEqual(['保留旧修订项'])
    expect(parseStoredReviewNotes('{bad json').issues).toEqual([])
  })
})
