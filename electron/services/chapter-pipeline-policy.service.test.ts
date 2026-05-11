import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeCandidateSimilarity } from './variation-control.service'
vi.mock('./variation-control.service', () => ({
  computeCandidateSimilarity: vi.fn(() => 0.5),
}))

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
    typed_ref_risks: [],
    source_grounding_risks: [],
    operating_mode_risks: [],
    long_window_humanization_risks: [],
    dialogue_separability_risks: [],
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
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(computeCandidateSimilarity).mockReturnValue(0.5)
  })

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

  it('routes new provenance and long-window findings into rewrite priority and max coverage', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      typed_ref_risks: ['线程引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['历史正剧当前来源覆盖不足。'],
      operating_mode_risks: ['百万字模式下 checkpoint 已落后 9 章。'],
      long_window_humanization_risks: ['长窗模板复现：近期命中 4 次。'],
      dialogue_separability_risks: ['高相似角色对 2 组。'],
      language_risks: ['个别句子仍偏模板。'],
      rewrite_required: true,
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.topIssues.map((issue) => issue.source)).toEqual(expect.arrayContaining([
      'typed_ref_risks',
      'source_grounding_risks',
      'operating_mode_risks',
      'long_window_humanization_risks',
      'dialogue_separability_risks',
    ]))
    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'typed_ref_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
  })

  it('keeps batch 7 provenance and mode findings ahead of generic polish without rewrite_required', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      typed_ref_risks: ['线程引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['历史正剧当前来源覆盖不足。'],
      operating_mode_risks: ['百万字模式下 checkpoint 已落后 9 章。'],
      language_risks: ['个别句子仍偏模板。'],
      human_language_repairs: ['把“心里一沉”换成更具体动作。'],
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'typed_ref_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'source_grounding_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'human_language_repairs'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'operating_mode_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
  })

  it('keeps long-window rewrite findings ahead of generic language polish without needing rewrite_required', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      long_window_humanization_risks: ['最近 60 章开场模板反复复现。'],
      dialogue_separability_risks: ['核心角色对白分离度跌到 0.64。'],
      language_risks: ['个别句子还是有些泛。'],
      human_language_repairs: ['把“气氛凝住”换成更具体动作。'],
    }))
    const policy = buildAdaptiveRewritePolicy(summary)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(policy.contextStrategy).toBe('max_coverage')
    expect(summary.topIssues.findIndex((issue) => issue.source === 'long_window_humanization_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'language_risks'))
    expect(summary.topIssues.findIndex((issue) => issue.source === 'dialogue_separability_risks'))
      .toBeLessThan(summary.topIssues.findIndex((issue) => issue.source === 'human_language_repairs'))
  })

  it('keeps batch 7 and 8 findings ordered ahead of generic polish in crowded issue sets', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      continuity_risks: ['主角伤势延续断裂。'],
      reader_hook_risks: ['章尾悬念力度不足。'],
      missing_payoffs: ['旧仓伏笔尚未兑现。'],
      typed_ref_risks: ['人物引用仍有 unresolved typed ref。'],
      source_grounding_risks: ['史料来源覆盖仍不足。'],
      operating_mode_risks: ['百万字模式 checkpoint 落后。'],
      dialogue_separability_risks: ['角色对白分离度继续走低。'],
      long_window_humanization_risks: ['长窗模板复现累计过高。'],
      language_risks: ['仍有泛化句式。'],
      human_language_repairs: ['把“心里一沉”换成更具体动作。'],
    }))
    const orderedSources = [...summary.topIssues, ...summary.deferredIssues].map((issue) => issue.source)

    expect(summary.forceMaxCoverage).toBe(true)
    expect(summary.topIssues).toHaveLength(6)
    expect(orderedSources.indexOf('typed_ref_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('source_grounding_risks')).toBeLessThan(orderedSources.indexOf('human_language_repairs'))
    expect(orderedSources.indexOf('operating_mode_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('dialogue_separability_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
    expect(orderedSources.indexOf('long_window_humanization_risks')).toBeLessThan(orderedSources.indexOf('language_risks'))
  })

  it('marks highly similar full rewrites for human review', () => {
    vi.mocked(computeCandidateSimilarity).mockReturnValue(1)
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

  it('uses the 0.86 full rewrite similarity threshold as an inclusive boundary', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      rewrite_required: true,
    }))
    const reviewNotes = createReviewNotes({
      critical_fixes: ['修 1', '修 2', '修 3'],
      rewrite_required: true,
      severity: 'medium',
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.859)
    const belowThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 A',
      rewrittenContent: '改写 A',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.86)
    const atThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 B',
      rewrittenContent: '改写 B',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(belowThreshold.needsHumanReview).toBe(false)
    expect(belowThreshold.improved).toBe(false)
    expect(atThreshold.needsHumanReview).toBe(true)
    expect(atThreshold.reason).toContain('整章重写后与初稿仍高度相似')
  })

  it('uses the 0.80 high severity threshold as an inclusive boundary', () => {
    const summary = buildReviewPrioritySummary(createReviewNotes({
      continuity_risks: ['连续性需要复核。'],
      severity: 'high',
      rewrite_required: false,
    }))
    const reviewNotes = createReviewNotes({
      continuity_risks: ['连续性需要复核。'],
      severity: 'high',
      rewrite_required: false,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.799)
    const belowThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 C',
      rewrittenContent: '改写 C',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    vi.mocked(computeCandidateSimilarity).mockReturnValueOnce(0.8)
    const atThreshold = buildRewriteMiniReviewVerdict({
      originalContent: '原文 D',
      rewrittenContent: '改写 D',
      reviewPrioritySummary: summary,
      reviewNotes,
    })

    expect(belowThreshold.needsHumanReview).toBe(false)
    expect(belowThreshold.improved).toBe(true)
    expect(atThreshold.needsHumanReview).toBe(true)
    expect(atThreshold.reason).toContain('高风险章节重写幅度不足')
  })
})
