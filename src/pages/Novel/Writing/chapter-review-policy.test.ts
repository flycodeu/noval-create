import { describe, expect, it } from 'vitest'
import type { ChapterPublishCheck } from '../../../types'
import {
  canApplyChapterOptimization,
  resolvePublishFinalizationDecision,
} from './chapter-review-policy'

function createPublishCheck(
  gateLevel: ChapterPublishCheck['gateLevel'],
  ready = gateLevel === 'pass' || gateLevel === 'warning',
): ChapterPublishCheck {
  const issueStatus = gateLevel === 'pass' ? 'pass' : gateLevel
  return {
    chapterId: 2,
    chapterNum: 2,
    gateLevel,
    ready,
    summary: '确定性发布门结果',
    blockerCount: gateLevel === 'blocker' ? 1 : 0,
    warningCount: gateLevel === 'warning' ? 1 : 0,
    rewriteCount: gateLevel === 'rewrite' ? 1 : 0,
    staleReasons: [],
    chapterContextVersion: 3,
    novelContextVersion: 3,
    rewriteRecommended: gateLevel === 'rewrite',
    scoreBreakdown: {
      totalScore: 80,
      continuityScore: 80,
      coherenceScore: 80,
      dialogueVoiceScore: 80,
      hookStrengthScore: 80,
      storyDynamicsScore: 80,
      languageNaturalnessScore: 80,
      styleComplianceScore: 80,
      povBoundaryScore: 80,
      sensoryCoverageScore: 80,
      narrativeRatioScore: 80,
      contractScore: 80,
      hookScore: 80,
      povPurityScore: 80,
      threadProgressScore: 80,
      volumeAlignmentScore: 80,
    },
    history: [],
    generatedTaskCount: 0,
    checklist: [{
      key: 'chapter-gate',
      label: '章节门禁',
      status: issueStatus,
      detail: '结果保持稳定',
      source: 'chapter',
      relatedPage: 'writing',
    }],
    contractAudit: {
      checkedAt: '2026-08-16T00:00:00.000Z',
      summary: '合同检查',
      blockerCount: 0,
      warningCount: 0,
      passCount: 1,
      items: [],
    },
  }
}

describe('chapter review policy', () => {
  it('allows pass, confirms warnings, and blocks blocker or rewrite gates', () => {
    expect(resolvePublishFinalizationDecision(createPublishCheck('pass')).kind).toBe('allow')
    expect(resolvePublishFinalizationDecision(createPublishCheck('warning')).kind).toBe('confirm-warning')
    expect(resolvePublishFinalizationDecision(createPublishCheck('blocker', false))).toMatchObject({
      kind: 'block',
      title: '章节验收未通过',
    })
    expect(resolvePublishFinalizationDecision(createPublishCheck('rewrite', false))).toMatchObject({
      kind: 'block',
      title: '章节必须退回重写',
    })
  })

  it('keeps both optimization guards mandatory before applying a candidate', () => {
    expect(canApplyChapterOptimization(null)).toBe(false)
    expect(canApplyChapterOptimization({ factGuard: { safeToApply: true }, qualityGate: { safeToApply: true } })).toBe(true)
    expect(canApplyChapterOptimization({ factGuard: { safeToApply: false }, qualityGate: { safeToApply: true } })).toBe(false)
    expect(canApplyChapterOptimization({ factGuard: { safeToApply: true }, qualityGate: { safeToApply: false } })).toBe(false)
  })
})
