import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./embedding.service', () => ({
  findSimilarFragments: vi.fn(async () => []),
}))

vi.mock('./style-analysis.service', () => ({
  buildStyleFingerprintPromptSection: vi.fn(() => ''),
  listStyleFingerprints: vi.fn(() => []),
}))

vi.mock('./story-memory.service', () => ({
  buildStoryMemoryPromptSummary: vi.fn(() => ''),
}))

vi.mock('./story-structure.service', () => ({
  ensureStoryStructure: vi.fn(),
}))

vi.mock('./model.service', () => ({
  resolveModelRuntimeBudget: vi.fn(() => ({
    maxContextTokens: 32000,
    maxTokens: 4096,
  })),
}))

vi.mock('../utils/user-facing-error', () => ({
  throwUserFacingError: vi.fn((key: string) => {
    throw new Error(key)
  }),
}))

vi.mock('./context-cards', () => ({
  buildCharacterContextCards: vi.fn(() => []),
  buildFactionContextCards: vi.fn(() => []),
  buildRelationContextCards: vi.fn(() => []),
  buildItemContextCards: vi.fn(() => []),
  buildTimelineContextCards: vi.fn(() => []),
  buildChapterThreadContextCards: vi.fn(() => []),
  buildGenericThreadCardsFromTexts: vi.fn(() => []),
  renderCharacterCards: vi.fn(() => ''),
  renderFactionCards: vi.fn(() => ''),
  renderRelationCards: vi.fn(() => ''),
  renderItemCards: vi.fn(() => ''),
  renderTimelineCards: vi.fn(() => ''),
  renderThreadCards: vi.fn(() => ''),
}))

vi.mock('./faction-reference.service', () => ({
  buildFactionCatalog: vi.fn(() => ({ rows: [], byId: new Map() })),
  resolveFactionRowsByReferences: vi.fn(() => []),
}))

vi.mock('./dialogue-fingerprint.service', () => ({
  getCharacterDialogueHintMap: vi.fn(() => new Map()),
}))

vi.mock('./character-state.service', () => ({
  getCharacterStateContextHintMap: vi.fn(() => new Map()),
  listLatestCharacterStates: vi.fn(() => []),
}))

vi.mock('./world-state.service', () => ({
  getWorldStateContextSnapshot: vi.fn(() => ({
    worldStatesText: '',
    currentStates: [],
  })),
}))

import type {
  ChapterContextParts,
  ChapterContextRawData,
  RecallDiagnostics,
} from './context.service'
import {
  allocateChapterContext,
  ContextOverflowError,
  HardConstraintOverflowError,
} from './context.service'
import { resolveModelRuntimeBudget } from './model.service'

function createRecallDiagnostics(): RecallDiagnostics {
  return {
    searchedBucketCount: 0,
    selectedBucketCount: 0,
    totalHitCount: 0,
    selectedHitCount: 0,
    staleRecallCount: 0,
    staleRecallRate: 0,
    recallDependencyRate: 0,
    overriddenHitCount: 0,
    fallbackHitCount: 0,
    summaryLines: [],
  }
}

function createBaseContextParts(): ChapterContextParts {
  return {
    storyCore: '故事主线：主角被迫接手失控局面。',
    currentArc: '当前故事弧：围绕接管后的第一次反扑。',
    worldRules: '世界规则：资源有限，所有后果都必须兑现。',
    characterStates: '人物状态：主角轻伤，副手不信任他。',
    worldStates: '世界状态：补给点在封锁边缘。',
    itemSummary: '关键物品去向：药箱在副手手里。',
    previousSummaries: '此前摘要：上一章刚刚撤离。',
    lastChapterEnding: '上一章结尾：敌人追到了出口。',
    styleTemplate: '风格模板：短句推进，压缩空话。',
    chapterGoal: '本章目标：守住补给点并稳定队内关系。',
    continuitySummary: '承接摘要：撤离造成了一名伤员掉队。',
    openLoops: '未回收事项：掉队者生死未明。',
    dueForeshadows: '待回收伏笔：失灵的通信器仍可能暴露位置。',
    continuityNotes: '必须承接：主角不能忘记前一章的伤口与承诺。',
    timelineSummary: '时间线摘要：天亮前必须完成转移。',
    timelineOpenThreads: '时间线待处理：封锁线将在两小时后收紧。',
    longTermMemory: '长期记忆：团队曾因误判失去补给车。',
    activeThreads: '活跃线程：副手随时可能倒向对方。',
    writingContractSummary: '写作契约：动作先行，情绪落在反应里。',
    relationSummary: '关系约束：主角与副手处于临界失信状态。',
    recalledMemory: '召回片段：过去的误判仍在影响当前决策。',
  }
}

function createRawData(
  options: {
    contextParts?: Partial<ChapterContextParts>
    novel?: Record<string, unknown>
    profile?: Record<string, unknown>
    chapterRows?: Array<Record<string, unknown>>
  } = {},
): ChapterContextRawData {
  const contextParts = {
    ...createBaseContextParts(),
    ...options.contextParts,
  }

  return {
    novel: {
      id: 1,
      targetWords: 180000,
      modelConfigId: 9,
      ...options.novel,
    } as ChapterContextRawData['novel'],
    profile: {
      writingContractSummary: contextParts.writingContractSummary,
      ...options.profile,
    } as ChapterContextRawData['profile'],
    chapterRows: (options.chapterRows || [
      { id: 1, chapterNum: 1 },
      { id: 2, chapterNum: 2 },
      { id: 3, chapterNum: 3 },
    ]) as ChapterContextRawData['chapterRows'],
    currentChapter: { id: 4, chapterNum: 4 } as ChapterContextRawData['currentChapter'],
    currentArc: null,
    outlineMentionedCharacterCount: 0,
    activeThreadPressureCount: 0,
    contextParts,
    recallDiagnostics: createRecallDiagnostics(),
    recalledMemorySources: [],
  }
}

describe('allocateChapterContext', () => {
  beforeEach(() => {
    vi.mocked(resolveModelRuntimeBudget).mockReturnValue({
      maxContextTokens: 32000,
      maxTokens: 4096,
    } as ReturnType<typeof resolveModelRuntimeBudget>)
  })

  it('returns context when the budget is sufficient', () => {
    const context = allocateChapterContext(createRawData(), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.contextBudgetReport.overflowLevel).toBe('none')
    expect(context.chapterGoal).toContain('本章目标')
    expect(context.hardConstraintEntries.length).toBeGreaterThan(0)
    expect(context.constraintInjectionStatus.injectedLabels).toContain('chapterGoal')
  })

  it('compresses the effective budget to the model context limit', () => {
    vi.mocked(resolveModelRuntimeBudget).mockReturnValue({
      maxContextTokens: 9000,
      maxTokens: 1200,
    } as ReturnType<typeof resolveModelRuntimeBudget>)

    const context = allocateChapterContext(createRawData(), {
      totalBudget: 12000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.contextBudgetReport.requestedBudget).toBe(12000)
    expect(context.contextBudgetReport.modelContextLimit).toBe(9000)
    expect(context.contextBudgetReport.effectiveBudget).toBe(9000)
    expect(context.contextBudgetReport.reservedForOutput).toBeLessThanOrEqual(7800)
  })

  it('throws ContextOverflowError when only soft context must be trimmed', () => {
    const rawData = createRawData({
      contextParts: {
        continuitySummary: '承接'.repeat(2400),
        timelineSummary: '时间'.repeat(2200),
        previousSummaries: '摘要'.repeat(2000),
        styleTemplate: '风格'.repeat(1600),
        activeThreads: '线程'.repeat(1800),
        recalledMemory: '回忆'.repeat(1800),
      },
    })

    try {
      allocateChapterContext(rawData, {
        totalBudget: 10000,
        promptProfile: 'draft',
        chapterComplexity: 'standard',
      })
      throw new Error('expected ContextOverflowError')
    } catch (error) {
      expect(error).toBeInstanceOf(ContextOverflowError)
      expect(error).not.toBeInstanceOf(HardConstraintOverflowError)
      const overflow = error as ContextOverflowError
      expect(overflow.contextBudgetReport.overflowLevel).toBe('soft_trimmed')
      expect(overflow.context.softContextBudgetUsage.warningCount).toBeGreaterThan(0)
      expect(overflow.context.contextBudgetReport.truncatedLabels.length + overflow.context.contextBudgetReport.droppedLabels.length)
        .toBeGreaterThan(0)
      expect(overflow.context.continuitySummary.length).toBeGreaterThan(0)
    }
  })

  it('throws HardConstraintOverflowError when hard constraints cannot fit', () => {
    vi.mocked(resolveModelRuntimeBudget).mockReturnValue({
      maxContextTokens: 2500,
      maxTokens: 600,
    } as ReturnType<typeof resolveModelRuntimeBudget>)

    try {
      allocateChapterContext(createRawData(), {
        totalBudget: 10000,
        promptProfile: 'draft',
        chapterComplexity: 'standard',
      })
      throw new Error('expected HardConstraintOverflowError')
    } catch (error) {
      expect(error).toBeInstanceOf(HardConstraintOverflowError)
      const overflow = error as HardConstraintOverflowError
      expect(overflow.contextBudgetReport.overflowLevel).toBe('hard_failed')
      expect(overflow.contextBudgetReport.modelContextLimit).toBe(2500)
      expect(overflow.context.constraintInjectionStatus.droppedConstraintCount).toBeGreaterThan(0)
    }
  })
})
