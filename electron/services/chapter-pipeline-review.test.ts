import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFallbackReviewNotes } from './chapter-review-notes'
import type { ChapterContext } from './context.service'

const mocks = vi.hoisted(() => ({
  persistAntiAiRuleHits: vi.fn(),
  analyzeChapterDialogueAgainstNovel: vi.fn(),
}))

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, fallback: string) => fallback,
}))

vi.mock('./anti-ai-rule.service', () => ({
  persistAntiAiRuleHits: mocks.persistAntiAiRuleHits,
}))

vi.mock('./dialogue-fingerprint.service', () => ({
  analyzeChapterDialogueAgainstNovel: mocks.analyzeChapterDialogueAgainstNovel,
}))

import {
  applyCriticSemanticReview,
  applyReviewEnforcer,
  buildChapterCriticMessages,
  parseCriticReviewOutput,
  runChapterCriticStage,
  runChapterEnforcerStage,
} from './chapter-pipeline-review'
import { ChapterPipelineStageError } from './chapter-pipeline-errors'

function contextFixture(chapterNum: number): ChapterContext {
  const prefix = `chapter-${chapterNum}`
  return {
    chapterGoal: `${prefix}-goal`,
    hardConstraintContext: `${prefix}-hard-contract`,
    dialogueVoiceLocks: `${prefix}-voice-lock`,
    writingContractSummary: `${prefix}-contract`,
    relationSummary: `${prefix}-relations`,
    currentArc: `${prefix}-arc`,
    worldRules: `${prefix}-world-rules`,
    characterStates: `${prefix}-character-states`,
    worldStates: `${prefix}-world-states`,
    mapSummary: `${prefix}-map`,
    itemSummary: `${prefix}-items`,
    previousChapterContext: `${prefix}-previous-context`,
    chapterBridgePlan: `${prefix}-bridge`,
    stepMemorySummary: `${prefix}-step-memory`,
    continuitySummary: `${prefix}-continuity`,
    openLoops: `${prefix}-open-loops`,
    dueForeshadows: `${prefix}-foreshadows`,
    timelineSummary: `${prefix}-timeline`,
    longTermMemory: `${prefix}-long-memory`,
    recalledMemory: `${prefix}-recalled-memory`,
    scenePlanSummary: `${prefix}-scene-summary`,
    draftTextSummary: `${prefix}-draft-summary`,
    contractVersionSummary: `${prefix}-contract-version`,
    reviewRiskSummary: `${prefix}-risk-summary`,
    reviewProofSummary: `${prefix}-proof-summary`,
    publishGateRiskSummary: `${prefix}-gate-summary`,
  } as ChapterContext
}

const guidance = {
  povRotationGuidance: '固定单一视角',
  storyPacingGuidance: '前紧后缓',
  hookContinuityGuidance: '承接脚步声',
  expressionDedupGuidance: '避免重复冷笑',
  summaryHealthGuidance: '保留因果',
  voiceEvolutionGuidance: '说话更克制',
}

beforeEach(() => {
  mocks.persistAntiAiRuleHits.mockReset()
  mocks.analyzeChapterDialogueAgainstNovel.mockReset()
  mocks.persistAntiAiRuleHits.mockReturnValue({ hits: [] })
  mocks.analyzeChapterDialogueAgainstNovel.mockReturnValue({
    risks: [],
    drifts: [],
    similarities: [],
    fillerRisks: [],
    infoDensityRisks: [],
  })
})

describe('chapter pipeline review', () => {
  it('assembles chapter 1 Critic prompt with review evidence handoff', () => {
    const messages = buildChapterCriticMessages({
      novelTitle: '雾城旧账',
      genre: '悬疑',
      chapterNum: 1,
      chapterTitle: '夜账',
      storyCore: '追查矿难真相',
      context: contextFixture(1),
      themeChapterTest: '真相是否值得代价',
      consistencyNotes: '铜腰牌仍在韩铁根手中',
      structuralAlertsSummary: '近期主角推进过顺',
      arcProgress: '弧线推进 1/5',
      arcProgressStatus: '进度正常',
      arcProgressCheckpoint: '本章应付出代价',
      scenePlanText: '1. 追出后门',
      draftContent: '他翻过院墙，听见追兵逼近。',
      runtimeAssertions: ['逐场核对 Planner 计划'],
      narrativeFields: {
        povGuidance: '固定沈砚青 POV',
        sensoryGuidance: '突出煤灰触感',
        narrativeRatioGuidance: '动作多于说明',
      },
      guidance,
      protagonistReference: '沈砚青',
      protagonistRule: '不凭空知晓幕后信息',
      promptTier: 'key',
    })

    expect(messages[0].content).toContain('chapter-1-hard-contract')
    expect(messages[0].content).toContain('chapter-1-proof-summary')
    expect(messages[0].content).toContain('逐场核对 Planner 计划')
    expect(messages[0].content).toContain('他翻过院墙')
  })

  it('normalizes chapter 1 structured review output and blocks malformed chapter 2 output', () => {
    const notes = parseCriticReviewOutput(JSON.stringify({
      summary: '场景连续，但章尾钩子偏弱。',
      strengths: ['开篇承接明确'],
      critical_fixes: ['强化章尾压力'],
      severity: 'medium',
      rewrite_required: true,
    }), {
      chapterId: 101,
      novelId: 7,
      chapterContent: '他翻过院墙。',
    })
    expect(notes.summary).toBe('场景连续，但章尾钩子偏弱。')
    expect(notes.critical_fixes).toContain('强化章尾压力')

    expect(() => parseCriticReviewOutput('not-json', {
      chapterId: 102,
      novelId: 7,
      chapterContent: '第二章保留稿。',
    })).toThrowError(ChapterPipelineStageError)
  })

  it('keeps semantic mode off deterministic without calling the model gate', async () => {
    const reviewNotes = buildFallbackReviewNotes('连续性正常')
    const output = await applyCriticSemanticReview({
      reviewNotes,
      policy: {
        mode: 'off',
        fallbackMode: 'heuristic',
        goldenChapterNums: [2, 3],
        maxSemanticCallsPerChapter: 2,
      },
      novelId: 7,
      chapterId: 102,
      chapterNum: 2,
      chapterTitle: '缺页',
      chapterContent: '他核对了缺页。',
      contractSummary: '必须核对缺页',
      scenePlanSummary: '场景一：核对缺页',
      protagonistReference: '沈砚青',
      scenePlan: [],
    })

    expect(output.reviewNotes).toBe(reviewNotes)
    expect(output.semanticReview).toBeNull()
    expect(output.effectiveMode).toBe('off')
  })

  it('adds Enforcer evidence without mutating the incoming Critic snapshot', () => {
    mocks.persistAntiAiRuleHits.mockReturnValue({ hits: [{ ruleCode: 'AI-001' }] })
    mocks.analyzeChapterDialogueAgainstNovel.mockReturnValue({
      risks: ['对白空转'],
      drifts: [],
      similarities: [],
      fillerRisks: [],
      infoDensityRisks: [],
    })
    const reviewNotes = buildFallbackReviewNotes('待检查')
    const originalFixes = [...reviewNotes.critical_fixes]
    const output = applyReviewEnforcer({
      reviewNotes,
      novelId: 7,
      chapterId: 102,
      chapterNum: 2,
      content: '“你知道。”他说。',
      genre: '悬疑',
      knownTerms: ['沈砚青'],
    })

    expect(output).not.toBe(reviewNotes)
    expect(reviewNotes.critical_fixes).toEqual(originalFixes)
    expect(output.critical_fixes).toHaveLength(originalFixes.length + 2)
    expect(output.critical_fixes.at(-2)).toContain('AI-001')
    expect(output.critical_fixes.at(-1)).toContain('对话指纹护栏拦截')
  })

  it('runs and persists the chapter 1 Enforcer stage before marking the role complete', async () => {
    mocks.persistAntiAiRuleHits.mockReturnValue({ hits: [{ ruleCode: 'AI-001' }] })
    const persisted: string[] = []
    const events: string[] = []
    const output = await runChapterEnforcerStage({
      shouldRun: true,
      reviewNotes: buildFallbackReviewNotes('第一章待护栏检查'),
      novelId: 7,
      chapterId: 101,
      chapterNum: 1,
      content: '他不由得微微一愣。',
      genre: '悬疑',
      knownTerms: ['沈砚青'],
      startRole: async () => {
        events.push('start')
        return 71
      },
      persistReviewNotes: (reviewNotes) => {
        events.push('persist')
        persisted.push(...reviewNotes.critical_fixes)
      },
      finishRole: () => events.push('finish'),
      failRole: (_taskId, error) => { throw error },
    })

    expect(output).toMatchObject({ reused: false, taskId: 71 })
    expect(persisted.at(-1)).toContain('AI-001')
    expect(events).toEqual(['start', 'persist', 'finish'])
  })

  it('reuses the chapter 2 Enforcer snapshot without rerunning guardrails', async () => {
    const startRole = vi.fn()
    const persistReviewNotes = vi.fn()
    const reviewNotes = buildFallbackReviewNotes('第二章护栏已完成')
    const output = await runChapterEnforcerStage({
      shouldRun: false,
      reviewNotes,
      novelId: 7,
      chapterId: 102,
      chapterNum: 2,
      content: '保留稿。',
      genre: '悬疑',
      knownTerms: [],
      priorTaskId: 72,
      startRole,
      persistReviewNotes,
      finishRole: vi.fn(),
      failRole: vi.fn(() => { throw new Error('unexpected') }),
    })

    expect(output).toEqual({ reviewNotes, taskId: 72, reused: true })
    expect(startRole).not.toHaveBeenCalled()
    expect(persistReviewNotes).not.toHaveBeenCalled()
    expect(mocks.persistAntiAiRuleHits).not.toHaveBeenCalled()
  })

  it('reuses the chapter 2 Critic snapshot without starting a review task', async () => {
    const reviewNotes = buildFallbackReviewNotes('第二章审校已完成')
    const startRole = vi.fn()
    const output = await runChapterCriticStage({
      shouldRun: false,
      chapterId: 102,
      novelId: 7,
      promptInput: {} as never,
      chatOptions: {},
      contractVersion: 'contract-v2',
      initialReviewNotes: reviewNotes,
      priorTaskId: 61,
      enrichInput: {} as never,
      semanticInput: {
        policy: { mode: 'off', fallbackMode: 'heuristic', goldenChapterNums: [], maxSemanticCallsPerChapter: 2 },
        novelId: 7,
        chapterId: 102,
        chapterNum: 2,
        chapterTitle: '缺页',
        chapterContent: '他把缺页压进衣袋。',
        contractSummary: '必须带走缺页',
        scenePlanSummary: '核对缺页',
        protagonistReference: '沈砚青',
        scenePlan: [],
      },
      startRole,
      failRole: vi.fn(() => { throw new Error('unexpected') }),
    })

    expect(output).toMatchObject({ reused: true, taskId: 61, effectiveMode: 'off' })
    expect(output.reviewNotes).toBe(reviewNotes)
    expect(startRole).not.toHaveBeenCalled()
  })
})
