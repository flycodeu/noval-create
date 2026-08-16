import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

vi.mock('./quality-dashboard.service', () => ({
  getQualityDashboardData: vi.fn(() => ({
    storyPacingAlerts: [],
    antiAiRecurrence: { topRepeatedRules: [], highRiskRuleCount: 0 },
    dialogueFingerprintStats: { highSimilarityPairCount: 0 },
    voiceEvolutionSummary: { driftingCharacterCount: 0 },
    requiredDialogueVoiceLocks: [],
  })),
}))

vi.mock('./dialogue-fingerprint.service', () => ({
  analyzeChapterDialogueAgainstNovel: vi.fn(() => ({
    risks: [],
    similarities: [],
    drifts: [],
    fillerRisks: [],
    infoDensityRisks: [],
    requiredVoiceLockCharacterIds: [],
    fingerprintSummary: '',
    voiceLockSummary: '',
  })),
}))

vi.mock('./style-compliance.service', () => ({
  analyzeNovelStyleCompliance: vi.fn(() => null),
}))

vi.mock('./workspace-quality.service', () => ({
  analyzeWorkspaceAiFlavor: vi.fn((content: string) => ({
    score: content.includes('然而') ? 10 : 90,
    summary: '',
    humanizationSignals: content.includes('然而')
      ? [{ severity: 'high' }]
      : [],
    humanizationDirections: [],
    sampleFindings: [],
  })),
}))

vi.mock('./chapter-pipeline-policy.service', () => ({
  analyzeChapterReadingExperience: vi.fn(() => ({
    score: 90,
    status: 'pass',
    summary: '',
    risks: [],
    recommendations: [],
    metrics: {
      avgSentenceLength: 0,
      avgParagraphLength: 0,
      dialogueParagraphRate: 0,
      paragraphCount: 0,
      sentenceCount: 0,
    },
  })),
}))

import {
  chooseBetterRepairCandidate,
  deterministicHumanizationRiskScore,
  judgeRepairOutcome,
} from './chapter-repair-loop'
import { normalizeReviewNotes } from './chapter-review-notes'
import type {
  SemanticGateReview,
  SemanticGateStatus,
  SemanticGateVerdict,
} from '../../src/shared/semantic-gate'
import type { ChapterSemanticGateRun } from './semantic-gate/semantic-gate-runner.service'

function buildVerdict(dimension: SemanticGateVerdict['dimension'], status: SemanticGateStatus): SemanticGateVerdict {
  return {
    dimension,
    status,
    confidence: 1,
    summary: `${dimension} 判定`,
    suggestion: '',
    evidence: status === 'pass' || status === 'uncertain' ? [] : [{ excerpt: '证据句', explanation: '说明' }],
    rejectedEvidenceCount: 0,
  }
}

function buildReview(verdicts: SemanticGateVerdict[]): SemanticGateReview {
  return {
    failed: false,
    verdicts,
    warnings: [],
    evidenceAccepted: 0,
    evidenceRejected: 0,
  }
}

function buildRun(review: SemanticGateReview, degraded = false): ChapterSemanticGateRun {
  return { review, degraded, promptFingerprint: 'test' }
}

const LONG_CONTENT = '他把铜牌按进泥里又抬头看向巷口的灯。'.repeat(10)

describe('judgeRepairOutcome 判定矩阵', () => {
  it('blocker→pass 与 blocker→warning 判 resolved，blocker→blocker 判 persists', async () => {
    const runGate = vi.fn(async () => buildRun(buildReview([
      buildVerdict('contract_delivery', 'pass'),
      buildVerdict('cost_and_choice', 'warning'),
      buildVerdict('structural_beat', 'blocker'),
    ])))
    const result = await judgeRepairOutcome({
      previousBlockerVerdicts: [
        buildVerdict('contract_delivery', 'blocker'),
        buildVerdict('cost_and_choice', 'blocker'),
        buildVerdict('structural_beat', 'blocker'),
      ],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    const outcomeByDim = new Map(result.judgements.map((item) => [item.dimension, item.outcome]))
    expect(outcomeByDim.get('contract_delivery')).toBe('resolved')
    expect(outcomeByDim.get('cost_and_choice')).toBe('resolved')
    expect(outcomeByDim.get('structural_beat')).toBe('persists')
    expect(result.hasRegression).toBe(false)
    expect(result.resolvedCount).toBe(2)
  })

  it('warning→blocker 判 regressed，warning→warning 判 persists', async () => {
    const runGate = vi.fn(async () => buildRun(buildReview([
      buildVerdict('dialogue_voice', 'blocker'),
      buildVerdict('supporting_agency', 'warning'),
    ])))
    const result = await judgeRepairOutcome({
      previousBlockerVerdicts: [
        buildVerdict('dialogue_voice', 'warning'),
        buildVerdict('supporting_agency', 'warning'),
      ],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    const outcomeByDim = new Map(result.judgements.map((item) => [item.dimension, item.outcome]))
    expect(outcomeByDim.get('dialogue_voice')).toBe('regressed')
    expect(outcomeByDim.get('supporting_agency')).toBe('persists')
    expect(result.hasRegression).toBe(true)
  })

  it('复评只针对上一轮 blocker/warning 维度，pass/uncertain 不复评', async () => {
    const runGate = vi.fn(async (dimensions: SemanticGateVerdict['dimension'][], _hints: unknown) => buildRun(buildReview(
      dimensions.map((dimension) => buildVerdict(dimension, 'pass')),
    )))
    await judgeRepairOutcome({
      previousBlockerVerdicts: [
        buildVerdict('contract_delivery', 'blocker'),
        buildVerdict('dialogue_voice', 'pass'),
        buildVerdict('structural_beat', 'uncertain'),
        buildVerdict('cost_and_choice', 'warning'),
      ],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    expect(runGate).toHaveBeenCalledTimes(1)
    const [dimensions, hints] = runGate.mock.calls[0]
    expect(dimensions).toEqual(['contract_delivery', 'cost_and_choice'])
    expect((hints as Array<{ dimension: string }>).map((hint) => hint.dimension)).toEqual(['contract_delivery', 'cost_and_choice'])
  })

  it('上一轮没有 blocker/warning 维度时不调用 runGate', async () => {
    const runGate = vi.fn()
    const result = await judgeRepairOutcome({
      previousBlockerVerdicts: [buildVerdict('contract_delivery', 'pass')],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    expect(runGate).not.toHaveBeenCalled()
    expect(result.judgements).toEqual([])
    expect(result.degraded).toBe(false)
  })

  it('复评 degraded 时不做裁决', async () => {
    const runGate = vi.fn(async () => buildRun({
      failed: true,
      verdicts: [],
      warnings: ['解析失败'],
      evidenceAccepted: 0,
      evidenceRejected: 0,
    }, true))
    const result = await judgeRepairOutcome({
      previousBlockerVerdicts: [buildVerdict('contract_delivery', 'blocker')],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    expect(result.degraded).toBe(true)
    expect(result.judgements).toEqual([])
    expect(result.hasRegression).toBe(false)
  })

  it('复评缺失某维度时按 uncertain 保守判 persists', async () => {
    const runGate = vi.fn(async () => buildRun(buildReview([
      buildVerdict('contract_delivery', 'pass'),
    ])))
    const result = await judgeRepairOutcome({
      previousBlockerVerdicts: [
        buildVerdict('contract_delivery', 'blocker'),
        buildVerdict('cost_and_choice', 'blocker'),
      ],
      repairedContent: LONG_CONTENT,
      runGate,
    })
    const outcomeByDim = new Map(result.judgements.map((item) => [item.dimension, item.outcome]))
    expect(outcomeByDim.get('cost_and_choice')).toBe('persists')
  })
})

describe('chooseBetterRepairCandidate 否决规则', () => {
  const notes = () => normalizeReviewNotes({})
  const current = { content: LONG_CONTENT, reviewNotes: notes() }

  it('candidate 出现相对 current 的新增语义 blocker 维度 → 判负', () => {
    const candidate = { content: LONG_CONTENT, reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, {
      currentSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      candidateSemantic: buildReview([
        buildVerdict('contract_delivery', 'pass'),
        buildVerdict('dialogue_voice', 'blocker'),
      ]),
      originalLength: 100,
    })
    expect(chosen).toBe(current)
  })

  it('candidate 篇幅不足 85% 且语义仍有 blocker → 判负', () => {
    const candidate = { content: '太短的稿子。', reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, {
      currentSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      candidateSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      originalLength: 200,
    })
    expect(chosen).toBe(current)
  })

  it('candidate 篇幅不足但语义已无 blocker → 不因篇幅判负（走破平）', () => {
    const candidate = { content: '短但干净的稿子。', reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, {
      currentSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      candidateSemantic: buildReview([buildVerdict('contract_delivery', 'pass')]),
      originalLength: 200,
    })
    // blocker 数 0 < 1，直接判胜
    expect(chosen).toBe(candidate)
  })

  it('candidate 语义 blocker 更少 → 判胜', () => {
    const candidate = { content: LONG_CONTENT, reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, {
      currentSemantic: buildReview([
        buildVerdict('contract_delivery', 'blocker'),
        buildVerdict('cost_and_choice', 'blocker'),
      ]),
      candidateSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      originalLength: 100,
    })
    expect(chosen).toBe(candidate)
  })

  it('语义平手时用 guardrailRepairScore 破平（分数不更低则保留 current）', () => {
    const candidate = { content: LONG_CONTENT, reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, {
      currentSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      candidateSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      originalLength: 100,
    })
    expect(chosen).toBe(current)
  })

  it('缺少语义复评数据时回退 guardrail 判据（与 chooseBetterGuardrailCandidate 行为一致）', () => {
    const candidate = { content: LONG_CONTENT, reviewNotes: notes() }
    const chosen = chooseBetterRepairCandidate(current, candidate, { originalLength: 100 })
    expect(chosen).toBe(current)
  })

  it('语义 blocker 减少但确定性人味风险显著恶化时拒绝候选', () => {
    const natural = {
      content: '门轴响了一声。沈砚停在台阶下，把湿透的收据压进袖口。值班员伸手时，他先问了登记簿在哪。'.repeat(12),
      reviewNotes: notes(),
    }
    const mechanical = {
      content: '然而，这意味着某种变化。与此同时，这说明了某种意义。由此可见，似乎一切都在悄然改变。'.repeat(12),
      reviewNotes: notes(),
    }
    expect(deterministicHumanizationRiskScore(mechanical.content)).toBeGreaterThan(
      deterministicHumanizationRiskScore(natural.content) + 12,
    )

    const chosen = chooseBetterRepairCandidate(natural, mechanical, {
      currentSemantic: buildReview([buildVerdict('contract_delivery', 'blocker')]),
      candidateSemantic: buildReview([buildVerdict('contract_delivery', 'pass')]),
      originalLength: 100,
    })
    expect(chosen).toBe(natural)
  })
})
