import { describe, expect, it } from 'vitest'
import type { AssetQualityLoopResult } from './asset-quality.service'
import { assessGenericAssetDraftQuality } from './generic-asset-workflow.service'

const hash = `sha256:${'d'.repeat(64)}`

function quality(overrides: Partial<AssetQualityLoopResult> = {}): AssetQualityLoopResult {
  return {
    stage: 'accepted',
    finalOutput: '有效正文',
    review: {
      summary: '与项目上下文一致。',
      severity: 'low',
      rewriteRequired: false,
      rejectRequired: false,
      genreDriftRisks: [],
      themeDriftRisks: [],
      backgroundDriftRisks: [],
      languageRisks: [],
      humanLanguageRepairs: [],
      conflictRisks: [],
      topFixes: [],
    },
    warnings: [],
    ...overrides,
  }
}

function assess(overrides: Partial<Parameters<typeof assessGenericAssetDraftQuality>[0]> = {}) {
  return assessGenericAssetDraftQuality({
    draftArtifactId: 'art_source',
    draftContentHash: hash,
    effectiveArtifactId: 'art_effective',
    effectiveContentHash: hash,
    output: '有效正文',
    outputFormat: 'text',
    quality: quality(),
    artifactContextVersion: 4,
    currentContextVersion: 4,
    ...overrides,
  })
}

describe('generic asset quality gate', () => {
  it('never turns an unavailable model review into an implicit pass', () => {
    const result = assess({
      quality: quality({
        review: {
          ...quality().review,
          summary: '资产审校失败，已保留原始输出。 network unavailable',
          severity: 'medium',
          languageRisks: ['network unavailable'],
        },
        warnings: ['network unavailable'],
      }),
    })
    expect(result.status).toBe('blocked')
    expect(result.readyForHumanApply).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'model_review', status: 'fail' }))
  })

  it('blocks malformed JSON even when the model review says accepted', () => {
    const result = assess({ output: '{not-json', outputFormat: 'json' })
    expect(result.status).toBe('blocked')
    expect(result.readyForHumanApply).toBe(false)
    expect(result.hardBlockers).toContain('JSON 输出无法解析为对象或数组。')
  })
  it('honors rejection even when an inconsistent caller labels the stage accepted', () => {
    expect(assess({ quality: quality({ review: { ...quality().review, rejectRequired: true } }) }).status).toBe('blocked')
  })
  it('reports the real map pilot rewrite transport failure without calling it a model rejection', () => {
    const result = assess({ quality: quality({ stage: 'rejected', failureStage: 'rewrite', warnings: ['terminated'], review: {
      ...quality().review, summary: '总体可用。两处地点严格满足数量与层级要求，主要是设定稿语气。', rewriteRequired: true, rejectRequired: false,
    } }) })
    expect(result).toMatchObject({ status: 'blocked', readyForHumanApply: false })
    expect(result.summary).toContain('修订请求未完成：terminated')
    expect(result.summary).not.toContain('模型审校拒收')
  })
  it('uses the final review summary when a completed recheck rejects content', () => {
    const result = assess({ quality: quality({ stage: 'rejected', rewrittenReview: { ...quality().review, rejectRequired: true, summary: '修订后路线端点不存在' } }) })
    expect(result.hardBlockers).toContain('模型审校拒收：修订后路线端点不存在')
  })

  it('blocks machine contract errors even when a model reports an accepted candidate', () => {
    const result = assess({ quality: quality({ contractValidation: { initialIssues: [], finalIssues: ['chapters[0].scenes[0].limitedResult：不支持的字段'] } }) })
    expect(result).toMatchObject({ status: 'blocked', readyForHumanApply: false })
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'output_contract', status: 'fail' }))
    expect(result.hardBlockers).toContain('结构契约未通过：chapters[0].scenes[0].limitedResult：不支持的字段')
  })

  it('records initial machine failure separately and accepts only the valid repaired output with a real recheck', () => {
    const repaired = quality({ stage: 'rewritten', initialModelReviewSkipped: true, contractValidation: { initialIssues: ['unsupported action'], finalIssues: [] }, rewrittenReview: quality().review })
    expect(assess({ quality: repaired })).toMatchObject({ status: 'passed', readyForHumanApply: true, modelReview: { initialModelReviewSkipped: true, contractValidation: repaired.contractValidation } })
    expect(assess({ quality: { ...repaired, rewrittenReview: undefined } })).toMatchObject({ status: 'blocked', readyForHumanApply: false })
  })

  it('distinguishes the real failing operation from the initial machine contract finding', () => {
    const result = assess({ quality: quality({ stage: 'rejected', failureStage: 'rewrite', initialModelReviewSkipped: true, contractValidation: { initialIssues: ['unsupported action'], finalIssues: ['unsupported action'] }, warnings: ['provider timeout'] }) })
    expect(result.hardBlockers).toContain('修订请求未完成：provider timeout。候选已保留，未应用。')
    expect(result.modelReview.failureStage).toBe('rewrite')
  })

  it('marks a clean current-context asset ready for author application', () => {
    const result = assess({ output: '{"rule":"能力必有代价"}', outputFormat: 'json' })
    expect(result).toMatchObject({ status: 'passed', score: 100, readyForHumanApply: true })
    expect(result.modelReview).not.toHaveProperty('finalOutput')
    expect(result.summary).toContain('流程检查分 100/100')
    expect(result.summary).toContain('不代表文学质量评分或 AI 检测结果')
  })

  it('keeps an asset in human review when the project context advanced during generation', () => {
    const result = assess({ artifactContextVersion: 4, currentContextVersion: 5 })

    expect(result.status).toBe('needs_revision')
    expect(result.readyForHumanApply).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: 'context_freshness',
      status: 'warn',
    }))
  })
})
