import { describe, expect, it, vi } from 'vitest'

vi.mock('./context-impact.service', () => ({
  markNovelContextChanged: vi.fn(),
}))

vi.mock('./prompt-override.service', () => ({
  listPromptOverrides: vi.fn(() => []),
}))

import {
  applyUpstreamArtifactsToRawContext,
  buildContractVersionArtifactSummary,
  buildStepMemorySummary,
  classifyChapterComplexity,
  createChapterStagePrepareInput,
  prepareChapterPipelineStageContexts,
  resolveChapterReferenceWords,
  resolveContextBudgetForStage,
  summarizeStageArtifactLines,
  summarizeStageArtifactText,
  type ChapterRawContext,
} from './chapter-pipeline-context'
import type { ChapterContext } from './context.service'
import { HardConstraintOverflowError } from './context.service'

function chapterFixture(chapterNum: number, emotionTone: string, outline = '推进调查') {
  return {
    id: chapterNum,
    novelId: 7,
    chapterNum,
    emotionTone,
    outline,
    targetWords: 3000,
  } as never
}

function overflowRawContext(): ChapterRawContext {
  const required = '必须完整保留的确定性事实与合同。'.repeat(120)
  const contextParts = Object.fromEntries([
    'storyCore', 'currentArc', 'worldRules', 'characterStates', 'worldStates', 'mapSummary', 'itemSummary',
    'previousSummaries', 'previousChapterContext', 'lastChapterEnding', 'chapterBridgePlan', 'styleTemplate',
    'chapterGoal', 'continuitySummary', 'openLoops', 'dueForeshadows', 'continuityNotes', 'timelineSummary',
    'timelineOpenThreads', 'longTermMemory', 'activeThreads', 'writingContractSummary', 'relationSummary',
    'dialogueVoiceLocks', 'recalledMemory', 'scenePlanSummary', 'draftTextSummary', 'contractVersionSummary',
    'reviewRiskSummary', 'reviewProofSummary', 'rewriteDeltaSummary', 'publishGateRiskSummary', 'stepMemorySummary',
  ].map((field) => [field, required]))
  return {
    novel: { id: 7, targetWords: 180000, contextVersion: 1 },
    profile: { writingContractSummary: required },
    chapterRows: [], currentChapter: chapterFixture(2, '紧张'), currentArc: null,
    outlineMentionedCharacterCount: 0, activeThreadPressureCount: 0,
    mentionedCharacters: [], mentionedItems: [], mentionedLocations: [], mentionedFactions: [],
    contextParts,
    previousChapterSampleReport: {
      sourceChapterId: null, sourceChapterNum: null, sourceChapterChars: 0, sampledChars: 0,
      coverageRate: 0, segmentCount: 0, fullyInjected: false, segments: [],
    },
    recallSnapshot: {
      retrievalUsed: false, degraded: false, hitCount: 0, selectedHitCount: 0,
      staleRecallCount: 0, fallbackHitCount: 0,
      bucketStats: {
        character: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
        rule: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
        thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
      },
    },
    recallDiagnostics: { summaryLines: [] },
    recalledMemorySources: [],
  } as unknown as ChapterRawContext
}

describe('chapter pipeline context', () => {
  it('06-02: aborts the upstream generation chain before an adapter can be invoked', async () => {
    const adapterCall = vi.fn()
    await expect((async () => {
      const prepared = await prepareChapterPipelineStageContexts(
        chapterFixture(2, '紧张'),
        overflowRawContext(),
        { executionMode: 'balanced', totalBudget: 100 },
      )
      return adapterCall(prepared.draftContext)
    })()).rejects.toBeInstanceOf(HardConstraintOverflowError)
    expect(adapterCall).not.toHaveBeenCalled()
  })

  it('07-04: recompiles one over-budget request by removing only optional stage context', () => {
    const context = {
      hardConstraintContext: '必须保留的硬约束',
      writingContractSummary: '必须保留的写作合同',
      relationSummary: '必须保留的关系事实',
      characterStates: '必须保留的角色状态',
      recalledMemory: '可裁剪的召回记忆'.repeat(20),
      activeThreads: '可裁剪的活跃线程'.repeat(20),
      mapSummary: '',
      chapterBridgePlan: '',
      stepMemorySummary: '',
      scenePlanSummary: '',
    } as ChapterContext
    const prepareInput = createChapterStagePrepareInput(context, 'draft')
    const original = `${context.hardConstraintContext}\n${context.writingContractSummary}\n${context.recalledMemory}\n${context.activeThreads}`
    const prepared = prepareInput({
      messages: [{ role: 'user', content: original }],
      budgetReport: {
        source: 'estimated', status: 'rejected', allowed: false,
        reason: 'input_and_output_exceed_stage_budget',
        estimatedInputTokens: 400, inputTokens: 400, outputReserveTokens: 100,
        outputTokens: 100, estimatedTotalTokens: 500, modelContextTokens: 1000,
        safeModelContextTokens: 950, tokenSafetyMarginPct: 5, stageBudget: 350,
        effectiveBudget: 350,
      },
    })

    expect(prepared.messages[0].content).toContain(context.hardConstraintContext)
    expect(prepared.messages[0].content).toContain(context.writingContractSummary)
    expect(prepared.messages[0].content.length).toBeLessThan(original.length)
    expect(prepared.diagnostics?.optionalContextRecompiled).toBe(true)
    expect(prepared.diagnostics?.optionalContextDroppedFields).not.toContain('hardConstraintContext')
  })

  it('classifies chapter 1 as key and keeps its reference words deterministic', () => {
    const chapter = chapterFixture(1, '平稳')
    expect(classifyChapterComplexity({
      chapter,
      currentArc: null,
      chapterRows: [chapter, chapterFixture(2, '过渡')],
      outlineMentionedCharacterCount: 1,
      activeThreadPressureCount: 1,
    })).toBe('key')
    expect(resolveChapterReferenceWords(3200.4, {})).toBe(3200)
    expect(resolveContextBudgetForStage('draft', 'key', 3200, 500000)).toBe(13800)
    expect(resolveContextBudgetForStage('draft', 'key', 3200, 1500000)).toBe(13800)
  })

  it('keeps chapter 2 upstream artifacts isolated and builds its handoff assertions', () => {
    const chapter = chapterFixture(2, '过渡', '承接第一章线索')
    expect(classifyChapterComplexity({
      chapter,
      currentArc: null,
      chapterRows: [chapterFixture(1, '平稳'), chapter, chapterFixture(3, '平稳')],
      outlineMentionedCharacterCount: 2,
      activeThreadPressureCount: 2,
    })).toBe('simple')

    const rawContext = {
      contextParts: {
        scenePlanSummary: '旧场景摘要',
        draftTextSummary: '',
        contractVersionSummary: '',
        reviewRiskSummary: '',
        reviewProofSummary: '',
        rewriteDeltaSummary: '',
        publishGateRiskSummary: '',
        stepMemorySummary: '',
      },
    } as ChapterRawContext
    const updated = applyUpstreamArtifactsToRawContext(rawContext, {
      scenePlanSummary: '第二章新场景摘要',
      contractVersionSummary: 'contract-v2',
      stepMemorySummary: '承接第一章结尾压力',
    })

    expect(updated).not.toBe(rawContext)
    expect(rawContext.contextParts.scenePlanSummary).toBe('旧场景摘要')
    expect(updated.contextParts).toMatchObject({
      scenePlanSummary: '第二章新场景摘要',
      contractVersionSummary: 'contract-v2',
      stepMemorySummary: '承接第一章结尾压力',
    })
    const memory = buildStepMemorySummary({
      chapterBridgePlan: '第一章结尾：追兵逼近。',
      scenePlanText: '场景一：立刻转移。',
      draftText: '他听见楼梯上的脚步声。',
      previousSummary: '第 2 章接力',
    })
    expect(memory.runtimeAssertions).toEqual([
      '正文开篇必须优先兑现章节衔接桥，不得跳过上章结尾压力。',
      'Writer 必须逐场执行 Planner 的场景计划，不得漏掉 must_cover 和 exit_hook。',
      'Critic/Rewriter 必须以 Writer 初稿为事实底稿，修复问题时不得新增无来源设定。',
    ])
    expect(memory.summary).toContain('第 2 章接力')
  })

  it('deduplicates and bounds artifact summaries without changing contract text', () => {
    expect(buildContractVersionArtifactSummary('contract-v3')).toBe('当前章节合同版本：contract-v3')
    expect(buildContractVersionArtifactSummary()).toBe('')
    expect(summarizeStageArtifactText('  a\n b  ', 10)).toBe('a b')
    expect(summarizeStageArtifactLines(['风险 A', '风险 A', '', '风险 B'], 4, 20)).toBe('风险 A 风险 B')
    expect(summarizeStageArtifactText('1234567890', 8)).toBe('12345...')
  })
})
