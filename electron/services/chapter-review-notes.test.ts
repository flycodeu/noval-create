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
  analyzeWorkspaceAiFlavor: vi.fn(() => ({
    summary: '',
    humanizationSignals: [],
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
  SEMANTIC_GATE_FIX_PREFIX,
  UNVERIFIED_EVIDENCE_PREFIX,
  annotateRiskEvidence,
  applyContractValidationToReviewNotes,
  applyCriticSemanticGateOutcomeToReviewNotes,
  collectSemanticGateHeuristicHints,
  normalizeReviewNotes,
} from './chapter-review-notes'
import {
  normalizeForEvidence,
  type SemanticGateReview,
  type SemanticGateVerdict,
} from '../../src/shared/semantic-gate'
import { DEFAULT_SEMANTIC_GATE_POLICY, type SemanticGatePolicy } from '../../src/shared/semantic-gate-policy'

const CHAPTER_CONTENT = [
  '陈默把铜牌按进泥里，指节因为用力而发白。他知道这一步没有回头路。',
  '「你要是现在走，货栈的账就烂在我手里。」老周把烟按灭，声音压得很低。',
  '巷口的灯忽明忽暗，雨水顺着瓦檐往下淌，打湿了半页没写完的欠条。',
].join('\n')

describe('annotateRiskEvidence', () => {
  const corpus = normalizeForEvidence(CHAPTER_CONTENT)

  it('保留证据能逐字回指的条目', () => {
    const item = '主角决定缺少铺垫。【证据】陈默把铜牌按进泥里，指节因为用力而发白'
    expect(annotateRiskEvidence([item], corpus)).toEqual([item])
  })

  it('证据回指失败时打上未核实前缀且不删除条目', () => {
    const item = '主角决定缺少铺垫。【证据】陈默烧掉了铜牌并扬长而去'
    const [annotated] = annotateRiskEvidence([item], corpus)
    expect(annotated).toBe(`${UNVERIFIED_EVIDENCE_PREFIX}${item}`)
  })

  it('没有证据段的条目保持原样', () => {
    const item = '主角决定缺少铺垫，建议补一段独白。'
    expect(annotateRiskEvidence([item], corpus)).toEqual([item])
  })

  it('已标注未核实的条目不重复加前缀', () => {
    const item = `${UNVERIFIED_EVIDENCE_PREFIX}主角决定缺少铺垫。【证据】不存在的句子啊啊啊`
    expect(annotateRiskEvidence([item], corpus)).toEqual([item])
  })

  it('证据过短时按回指失败处理', () => {
    const item = '节奏问题。【证据】泥里'
    const [annotated] = annotateRiskEvidence([item], corpus)
    expect(annotated.startsWith(UNVERIFIED_EVIDENCE_PREFIX)).toBe(true)
  })
})

describe('normalizeReviewNotes 证据核实', () => {
  it('不传 chapterContent 时行为与旧版一致（不做证据标注、不挂 semantic_verdicts）', () => {
    const notes = normalizeReviewNotes({
      critical_fixes: ['问题A。【证据】完全不存在的句子完全不存在'],
      verdicts: [{ dimension: 'contract_delivery', status: 'blocker', summary: 'x', evidence: [] }],
    })
    expect(notes.critical_fixes).toEqual(['问题A。【证据】完全不存在的句子完全不存在'])
    expect(notes.semantic_verdicts).toBeUndefined()
  })

  it('传 chapterContent 时对风险条目做证据回指标注', () => {
    const notes = normalizeReviewNotes({
      critical_fixes: [
        '代价没有落地。【证据】陈默把铜牌按进泥里，指节因为用力而发白',
        '反转缺乏铺垫。【证据】主角挥剑斩断了锁链',
      ],
      language_risks: ['翻译腔明显，建议改写。'],
    }, { chapterContent: CHAPTER_CONTENT })
    expect(notes.critical_fixes[0].startsWith(UNVERIFIED_EVIDENCE_PREFIX)).toBe(false)
    expect(notes.critical_fixes[1].startsWith(UNVERIFIED_EVIDENCE_PREFIX)).toBe(true)
    expect(notes.language_risks).toEqual(['翻译腔明显，建议改写。'])
  })

  it('payload.verdicts 经 normalizeSemanticGateReview 归一后挂到 semantic_verdicts', () => {
    const notes = normalizeReviewNotes({
      verdicts: [
        {
          dimension: 'cost_and_choice',
          status: 'blocker',
          summary: '代价只停留在口头。',
          suggestion: '把损失写成不可逆后果。',
          evidence: [{ excerpt: '他知道这一步没有回头路', explanation: '仅有心理断言，没有实际损失。' }],
        },
        {
          dimension: 'dialogue_voice',
          status: 'blocker',
          summary: '对白同质化。',
          suggestion: '拉开语气差异。',
          evidence: [{ excerpt: '这句台词并不在正文里出现过呀', explanation: '伪造证据' }],
        },
      ],
    }, { chapterContent: CHAPTER_CONTENT })

    expect(notes.semantic_verdicts).toBeDefined()
    const byDimension = new Map(notes.semantic_verdicts!.map((verdict) => [verdict.dimension, verdict]))
    expect(byDimension.get('cost_and_choice')?.status).toBe('blocker')
    // 证据回指失败的 blocker 必须降级为 warning（blocker 降级纪律）
    expect(byDimension.get('dialogue_voice')?.status).toBe('warning')
    expect(byDimension.get('dialogue_voice')?.downgradedFrom).toBe('blocker')
    // 未返回的核心维度按 uncertain 兜底
    expect(byDimension.get('contract_delivery')?.status).toBe('uncertain')
    expect(notes.semantic_review_warnings?.some((item) => item.includes('对白声纹'))).toBe(true)
  })

  it('semantic_verdicts 经 JSON round-trip 后仍可恢复', () => {
    const first = normalizeReviewNotes({
      verdicts: [{
        dimension: 'structural_beat',
        status: 'blocker',
        summary: '本章没有可见状态变化。',
        suggestion: '补一处归属或关系变化。',
        evidence: [{ excerpt: '巷口的灯忽明忽暗，雨水顺着瓦檐往下淌', explanation: '仅环境描写。' }],
      }],
    }, { chapterContent: CHAPTER_CONTENT })
    expect(first.semantic_verdicts?.length).toBeGreaterThan(0)

    const restored = normalizeReviewNotes(JSON.parse(JSON.stringify(first)))
    expect(restored.semantic_verdicts).toEqual(first.semantic_verdicts)
    expect(restored.semantic_review_warnings).toEqual(first.semantic_review_warnings)
  })

  it('design_field_gaps 经 JSON round-trip 后保留', () => {
    const first = normalizeReviewNotes({
      design_field_gaps: ['场景1《炉前对峙》声明了冲突但 hidden_agendas 为空：各方真实诉求未设计。'],
    })
    expect(first.design_field_gaps).toHaveLength(1)

    const restored = normalizeReviewNotes(JSON.parse(JSON.stringify(first)))
    expect(restored.design_field_gaps).toEqual(first.design_field_gaps)
  })
})

function buildVerdict(overrides: Partial<SemanticGateVerdict> & Pick<SemanticGateVerdict, 'dimension' | 'status'>): SemanticGateVerdict {
  return {
    confidence: 1,
    summary: `${overrides.dimension} 判定说明`,
    suggestion: '',
    evidence: [{ excerpt: '逐字证据句', explanation: '说明' }],
    rejectedEvidenceCount: 0,
    ...overrides,
  }
}

function buildReview(verdicts: SemanticGateVerdict[], warnings: string[] = []): SemanticGateReview {
  return {
    failed: false,
    verdicts,
    warnings,
    evidenceAccepted: verdicts.reduce((sum, verdict) => sum + verdict.evidence.length, 0),
    evidenceRejected: 0,
  }
}

const ENFORCE_POLICY: SemanticGatePolicy = {
  ...DEFAULT_SEMANTIC_GATE_POLICY,
  mode: 'enforce',
  fallbackMode: 'heuristic',
}

describe('applyContractValidationToReviewNotes advisoryOnly 聚合', () => {
  const blockerValidation = {
    status: 'blocker' as const,
    summary: '章节目标未兑现',
    itemResults: [{
      contractItemType: 'chapter_goal',
      expected: '让主线再向前推进一步',
      verdict: 'missing' as const,
      evidenceExcerpt: '',
      rewriteHint: '把章节目标写成可核验的动作与结果。',
    }],
    rewriteHints: ['把章节目标写成可核验的动作与结果。'],
  }

  it('默认（非 advisory）hard blocker 判 high 且强制重写', () => {
    const notes = applyContractValidationToReviewNotes(normalizeReviewNotes({}), blockerValidation)
    expect(notes.severity).toBe('high')
    expect(notes.rewrite_required).toBe(true)
  })

  it('advisoryOnly 时 hard blocker 按 warning 处理：不强制重写、严重度 medium', () => {
    const notes = applyContractValidationToReviewNotes(normalizeReviewNotes({}), {
      ...blockerValidation,
      itemResults: blockerValidation.itemResults.map((item) => ({ ...item, advisoryOnly: true })),
      advisoryOnly: true,
    } as never)
    expect(notes.severity).toBe('medium')
    expect(notes.rewrite_required).toBe(false)
    // verdict 与提示文本保留
    expect(notes.contract_validation?.itemResults[0]?.verdict).toBe('missing')
    expect(notes.critical_fixes).toContain('把章节目标写成可核验的动作与结果。')
  })
})

describe('applyCriticSemanticGateOutcomeToReviewNotes（enforce 降级链）', () => {
  it('shadow：只挂载 verdicts，不注入 critical_fixes、不改判定', () => {
    const review = buildReview([buildVerdict({ dimension: 'contract_delivery', status: 'blocker' })])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review, degraded: false },
      { ...DEFAULT_SEMANTIC_GATE_POLICY, mode: 'shadow' },
    )
    expect(outcome.effectiveMode).toBe('shadow')
    expect(outcome.restoreHeuristicContractBlockers).toBe(false)
    expect(outcome.reviewNotes.semantic_verdicts).toEqual(review.verdicts)
    expect(outcome.reviewNotes.critical_fixes).toHaveLength(0)
    expect(outcome.reviewNotes.rewrite_required).toBe(false)
  })

  it('enforce + blocker：blocker 维度带[语义门]前缀注入 critical_fixes 并强制重写', () => {
    const review = buildReview([
      buildVerdict({ dimension: 'cost_and_choice', status: 'blocker', summary: '代价没有落地', suggestion: '补一处不可逆损失' }),
      buildVerdict({ dimension: 'dialogue_voice', status: 'pass' }),
    ])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review, degraded: false },
      ENFORCE_POLICY,
    )
    expect(outcome.effectiveMode).toBe('enforce')
    expect(outcome.reviewNotes.critical_fixes.some((item) => (
      item.startsWith(SEMANTIC_GATE_FIX_PREFIX) && item.includes('代价没有落地') && item.includes('补一处不可逆损失')
    ))).toBe(true)
    expect(outcome.reviewNotes.rewrite_required).toBe(true)
    expect(outcome.reviewNotes.severity).toBe('high')
  })

  it('enforce + 全 pass：不注入修复项也不强制重写', () => {
    const review = buildReview([buildVerdict({ dimension: 'contract_delivery', status: 'pass' })])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review, degraded: false },
      ENFORCE_POLICY,
    )
    expect(outcome.reviewNotes.critical_fixes).toHaveLength(0)
    expect(outcome.reviewNotes.rewrite_required).toBe(false)
  })

  it('enforce + degraded + fallback=heuristic：本轮当作 off 并要求恢复关键词门 blocker', () => {
    const failedReview: SemanticGateReview = {
      failed: true,
      verdicts: [],
      warnings: ['语义门输出无法解析'],
      evidenceAccepted: 0,
      evidenceRejected: 0,
    }
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review: failedReview, degraded: true },
      ENFORCE_POLICY,
    )
    expect(outcome.effectiveMode).toBe('off')
    expect(outcome.restoreHeuristicContractBlockers).toBe(true)
    expect(outcome.reviewNotes.semantic_verdicts).toBeUndefined()
  })

  it('enforce + degraded + fallback=warn-pass：放行并记录语义评审缺席警告', () => {
    const failedReview: SemanticGateReview = {
      failed: true,
      verdicts: [],
      warnings: [],
      evidenceAccepted: 0,
      evidenceRejected: 0,
    }
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review: failedReview, degraded: true },
      { ...ENFORCE_POLICY, fallbackMode: 'warn-pass' },
    )
    expect(outcome.effectiveMode).toBe('enforce')
    expect(outcome.restoreHeuristicContractBlockers).toBe(false)
    expect(outcome.reviewNotes.semantic_review_warnings?.some((item) => item.includes('语义评审缺席'))).toBe(true)
  })
})

describe('collectSemanticGateDivergenceNotes（shadow 分歧记录）', () => {
  it('语义 blocker 但关键词门未命中 → 记录漏报候选分歧', () => {
    const review = buildReview([
      buildVerdict({ dimension: 'cost_and_choice', status: 'blocker', summary: '代价只停留在口头' }),
      buildVerdict({ dimension: 'dialogue_voice', status: 'pass' }),
    ])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review, degraded: false },
      { ...DEFAULT_SEMANTIC_GATE_POLICY, mode: 'shadow' },
    )
    expect(outcome.reviewNotes.semantic_divergence_notes?.some((item) => (
      item.includes('代价与选择') && item.includes('关键词门未命中')
    ))).toBe(true)
    // 不阻断：不注入 critical_fixes、不强制重写
    expect(outcome.reviewNotes.critical_fixes).toHaveLength(0)
    expect(outcome.reviewNotes.rewrite_required).toBe(false)
  })

  it('关键词门 blocker 级信号但语义 pass → 记录误报候选分歧', () => {
    const notes = normalizeReviewNotes({
      dialogue_homogenization_risks: ['对白同声化'],
      dialogue_filler_risks: ['对白空转'],
      dialogue_info_density_risks: ['信息密度不足'],
    })
    const review = buildReview([buildVerdict({ dimension: 'dialogue_voice', status: 'pass' })])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      notes,
      { review, degraded: false },
      { ...DEFAULT_SEMANTIC_GATE_POLICY, mode: 'shadow' },
    )
    expect(outcome.reviewNotes.semantic_divergence_notes?.some((item) => (
      item.includes('对白声纹') && item.includes('语义门判定 pass')
    ))).toBe(true)
  })

  it('语义门与关键词门一致时不产生分歧记录', () => {
    const notes = normalizeReviewNotes({
      cost_present: true,
      cost_resolution_state: 'evaporated',
    })
    const review = buildReview([
      buildVerdict({ dimension: 'cost_and_choice', status: 'blocker', summary: '代价蒸发' }),
      buildVerdict({ dimension: 'supporting_agency', status: 'warning' }),
    ])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      notes,
      { review, degraded: false },
      { ...DEFAULT_SEMANTIC_GATE_POLICY, mode: 'shadow' },
    )
    expect(outcome.reviewNotes.semantic_divergence_notes).toBeUndefined()
  })

  it('分歧记录经 JSON round-trip 后保留', () => {
    const review = buildReview([buildVerdict({ dimension: 'structural_beat', status: 'blocker', summary: '无状态变化' })])
    const outcome = applyCriticSemanticGateOutcomeToReviewNotes(
      normalizeReviewNotes({}),
      { review, degraded: false },
      { ...DEFAULT_SEMANTIC_GATE_POLICY, mode: 'shadow' },
    )
    const restored = normalizeReviewNotes(JSON.parse(JSON.stringify(outcome.reviewNotes)))
    expect(restored.semantic_divergence_notes).toEqual(outcome.reviewNotes.semantic_divergence_notes)
  })
})

describe('collectSemanticGateHeuristicHints', () => {
  it('把合同/结构/对白启发式命中映射为对应维度的疑点线索', () => {
    const notes = normalizeReviewNotes({
      cost_present: true,
      cost_resolution_state: 'evaporated',
      cost_summary: '重伤一段后凭空痊愈',
      reversal_marker: true,
      reversal_support_state: 'forced',
      dialogue_filler_risks: ['对白空转互相接话'],
      contract_validation: {
        status: 'blocker',
        summary: '',
        itemResults: [
          {
            contractItemType: 'chapter_goal',
            expected: '让主线再向前推进一步',
            verdict: 'missing',
            evidenceExcerpt: '',
            rewriteHint: '',
          },
          {
            contractItemType: 'scene_result_state',
            expected: '线索升级',
            verdict: 'weak',
            evidenceExcerpt: '',
            segmentTitle: '场景一',
            rewriteHint: '',
          },
        ],
        rewriteHints: [],
      },
    })
    const hints = collectSemanticGateHeuristicHints(notes)
    const dimensions = hints.map((hint) => hint.dimension)
    expect(dimensions).toContain('contract_delivery')
    expect(dimensions).toContain('structural_beat')
    expect(dimensions).toContain('cost_and_choice')
    expect(dimensions).toContain('dialogue_voice')
    expect(hints.find((hint) => hint.dimension === 'contract_delivery')?.detail).toContain('让主线再向前推进一步')
    expect(hints.find((hint) => hint.dimension === 'structural_beat')?.detail).toContain('场景一')
  })

  it('无命中时返回空数组', () => {
    expect(collectSemanticGateHeuristicHints(normalizeReviewNotes({}))).toEqual([])
  })
})
