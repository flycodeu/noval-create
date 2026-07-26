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
  UNVERIFIED_EVIDENCE_PREFIX,
  annotateRiskEvidence,
  normalizeReviewNotes,
} from './chapter-review-notes'
import { normalizeForEvidence } from '../../src/shared/semantic-gate'

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
})
