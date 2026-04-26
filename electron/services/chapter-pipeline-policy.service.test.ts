import { describe, expect, it } from 'vitest'
import {
  buildAdaptiveRewritePolicy,
  buildReviewPrioritySummary,
  buildRewriteMiniReviewVerdict,
} from './chapter-pipeline-policy.service'

function createReviewNotes(overrides: Partial<Parameters<typeof buildReviewPrioritySummary>[0]> = {}) {
  return {
    critical_fixes: [],
    continuity_risks: [],
    arc_progress_risks: [],
    context_drift_risks: [],
    realism_risks: [],
    coherence_risks: [],
    reader_hook_risks: [],
    language_risks: [],
    human_language_repairs: [],
    genre_hollowing_risks: [],
    missing_payoffs: [],
    dialogue_homogenization_risks: [],
    dialogue_filler_risks: [],
    dialogue_info_density_risks: [],
    severity: 'medium' as const,
    rewrite_required: false,
    contract_validation: { status: 'pass' as const, rewriteHints: [] },
    ...overrides,
  }
}

describe('chapter pipeline policy', () => {
  it('prioritizes critical structural issues ahead of low-value language fixes', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['补上主角失败后的代价兑现。'],
      continuity_risks: ['上一章的伤势在本章开头消失了。'],
      language_risks: ['“某种无法言说的感觉”过于模板。'],
      human_language_repairs: ['“气氛变得凝重” -> “屋里一下安静下来”。'],
      dialogue_filler_risks: ['两轮对白都在重复确认同一件事。'],
    }))
    const continuityIndex = summary.topIssues.findIndex((issue) => issue.source === 'continuity_risks')
    const fillerIndex = summary.topIssues.findIndex((issue) => issue.source === 'dialogue_filler_risks')

    expect(summary.topIssues[0]?.source).toBe('critical_fixes')
    expect(summary.topIssues.some((issue) => issue.source === 'continuity_risks')).toBe(true)
    expect(fillerIndex).toBeGreaterThan(continuityIndex)
  })

  it('forces full rewrite and max coverage for dense high-risk review results', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      continuity_risks: ['连续性断裂'],
      arc_progress_risks: ['故事弧空转'],
      severity: 'high',
      rewrite_required: true,
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.requiresFullRewrite).toBe(true)
    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.temperatureCap).toBe(0.7)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(policy.reviewDepth).toBe('deep')
  })

  it('marks highly similar full rewrites for human review', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      severity: 'high',
      rewrite_required: true,
    }))
    const verdict = buildRewriteMiniReviewVerdict({
      originalContent: '林远推门进去，看到副手正压着伤口。他没有说话，只先看了一眼灯。',
      rewrittenContent: '林远推门进去，看到副手正压着伤口。他没有说话，只先看了一眼灯。',
      reviewPrioritySummary: summary,
      reviewNotes: createReviewNotes({
        critical_fixes: ['修 1', '修 2', '修 3'],
        severity: 'high',
        rewrite_required: true,
      }),
    })

    expect(verdict.needsHumanReview).toBe(true)
    expect(verdict.similarityToOriginal).toBe(1)
  })
})
