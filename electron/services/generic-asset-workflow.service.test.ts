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
    expect(result.status).toBe('needs_revision')
    expect(result.readyForHumanApply).toBe(false)
    expect(result.checks).toContainEqual(expect.objectContaining({ code: 'model_review', status: 'warn' }))
  })

  it('blocks malformed JSON even when the model review says accepted', () => {
    const result = assess({ output: '{not-json', outputFormat: 'json' })
    expect(result.status).toBe('blocked')
    expect(result.readyForHumanApply).toBe(false)
    expect(result.hardBlockers).toContain('JSON 输出无法解析为对象或数组。')
  })

  it('marks a clean current-context asset ready for author application', () => {
    const result = assess({ output: '{"rule":"能力必有代价"}', outputFormat: 'json' })
    expect(result).toMatchObject({ status: 'passed', score: 100, readyForHumanApply: true })
    expect(result.modelReview).not.toHaveProperty('finalOutput')
  })
})
