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
  resolveChapterReferenceWords,
  resolveContextBudgetForStage,
  summarizeStageArtifactLines,
  summarizeStageArtifactText,
  type ChapterRawContext,
} from './chapter-pipeline-context'

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

describe('chapter pipeline context', () => {
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
    expect(resolveContextBudgetForStage('draft', 'key', 3200, 500000)).toBe(15400)
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
