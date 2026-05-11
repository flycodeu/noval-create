import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./embedding.service', () => ({
  findSimilarFragments: vi.fn(async () => []),
  searchSimilarFragments: vi.fn(async () => ({
    hits: [],
  })),
}))

vi.mock('./style-analysis.service', () => ({
  buildStyleFingerprintPromptSection: vi.fn(() => ''),
  buildStyleHardGuardPromptSection: vi.fn(() => ''),
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
  getChapterDialogueVoiceLocks: vi.fn(() => []),
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
  RecallSnapshot,
} from './context.service'
import {
  allocateChapterContext,
  buildStoryProfile,
  buildRecallSnapshot,
  buildPreviousChapterContextFeed,
  ContextOverflowError,
  HardConstraintOverflowError,
  selectRecentContextRows,
} from './context.service'
import { getDb } from '../database/db'
import { antiAiRuleHits, chapterGateRuns, chapters, characters, genres, glossary, novels } from '../database/schema'
import { resolveModelRuntimeBudget } from './model.service'
import {
  buildStyleHardGuardPromptSection,
  listStyleFingerprints,
} from './style-analysis.service'

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
    validatedHitCount: 0,
    lowSimilarityRejectedCount: 0,
    entityValidationRejectedCount: 0,
    minVectorSimilarity: 0.6,
    minKeywordSimilarity: 0.5,
    summaryLines: [],
  }
}

function createRecallSnapshot(): RecallSnapshot {
  return {
    retrievalUsed: false,
    degraded: false,
    hitCount: 0,
    selectedHitCount: 0,
    staleRecallCount: 0,
    fallbackHitCount: 0,
    bucketStats: {
      character: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
      rule: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
      thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
    },
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
    previousChapterContext: '上一章关键先验：队伍从失守点撤离，出口外仍有追兵。',
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
    dialogueVoiceLocks: '副手：- 必保留：短句反问；- 必避免：长段解释。',
    recalledMemory: '召回片段：过去的误判仍在影响当前决策。',
  }
}

function createRawData(
  options: {
    contextParts?: Partial<ChapterContextParts>
    novel?: Record<string, unknown>
    profile?: Record<string, unknown>
    chapterRows?: Array<Record<string, unknown>>
    recallSnapshot?: Partial<RecallSnapshot>
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
    mentionedCharacters: [],
    mentionedItems: [],
    mentionedLocations: [],
    contextParts,
    previousChapterSampleReport: {
      sourceChapterId: 3,
      sourceChapterNum: 3,
      sourceChapterChars: 1200,
      sampledChars: 640,
      coverageRate: 53.3,
      segmentCount: 4,
      fullyInjected: false,
      segments: [],
    },
    recallSnapshot: {
      ...createRecallSnapshot(),
      ...options.recallSnapshot,
    },
    recallDiagnostics: createRecallDiagnostics(),
    recalledMemorySources: [],
  }
}

function createMockSelectDb<T>(responses: T[][]) {
  let callIndex = 0
  const next = () => responses[Math.min(callIndex++, Math.max(responses.length - 1, 0))] || []
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          all: () => next(),
        }),
      }),
    }),
  }
}

function createTableAwareDbMock(rowsByTable: Map<unknown, unknown[]>) {
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          orderBy: () => ({
            all: () => rowsByTable.get(table) || [],
          }),
          all: () => rowsByTable.get(table) || [],
        }),
        orderBy: () => ({
          all: () => rowsByTable.get(table) || [],
        }),
        all: () => rowsByTable.get(table) || [],
      }),
    }),
  }
}

describe('allocateChapterContext', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
    vi.mocked(listStyleFingerprints).mockReturnValue([])
    vi.mocked(buildStyleHardGuardPromptSection).mockReturnValue('')
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
    expect(context.softContextDecisions.some((entry) => entry.reason === 'covered_by_hard_constraint')).toBe(true)
  })

  it('tracks explicit preserved hard-constraint labels in allocation metadata', () => {
    const context = allocateChapterContext(createRawData(), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
      preserveConstraintLabels: ['itemSummary'],
    })

    expect(context.hardConstraintEntries.some((entry) => entry.label === 'itemSummary')).toBe(true)
    expect(context.constraintInjectionStatus.preservedLabels).toContain('itemSummary')
    expect(context.contextBudgetReport.preservedConstraintLabels).toContain('itemSummary')
  })

  it('injects anti-ai hard constraints from settings and consecutive recurrence hits', () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              all: () => ([
                {
                  id: 1,
                  chapterId: 2,
                  chapterNum: 2,
                  ruleCode: 'ai_ending_summary',
                  ruleTitle: '总结式章尾',
                  scope: 'structure',
                  severity: 'medium',
                  excerpt: '而这一切才刚刚开始',
                  source: 'guardrail',
                  detail: '不要用总结句收尾。',
                  promotedToHardConstraint: 0,
                },
                {
                  id: 2,
                  chapterId: 3,
                  chapterNum: 3,
                  ruleCode: 'ai_ending_summary',
                  ruleTitle: '总结式章尾',
                  scope: 'structure',
                  severity: 'medium',
                  excerpt: '故事远没有结束',
                  source: 'guardrail',
                  detail: '不要用总结句收尾。',
                  promotedToHardConstraint: 1,
                },
              ]),
            }),
          }),
        }),
      }),
    } as never)

    const context = allocateChapterContext(createRawData({
      novel: {
        settingsJson: JSON.stringify({
          writing_rules: {
            anti_ai_flavor: '不要在段尾替角色总结意义。',
            banned_terms: '命运的齿轮，某种无法言说',
          },
        }),
      },
    }), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.hardConstraintContext).toContain('【必须避免-禁用表达】')
    expect(context.hardConstraintContext).toContain('本书禁用：命运的齿轮')
    expect(context.hardConstraintContext).toContain('本书自定义：不要在段尾替角色总结意义。')
    expect(context.hardConstraintContext).toContain('本书近章复现')
    expect(context.constraintInjectionStatus.injectedLabels).toContain('antiAiRules')
  })

  it('injects style hard-guard constraints when the novel has a style fingerprint', () => {
    vi.mocked(listStyleFingerprints).mockReturnValue([
      {
        id: 8,
        novelId: 1,
        name: '冷硬短句',
        sourceText: null,
        fingerprintJson: '{}',
        analysisModelId: null,
        createdAt: '',
        updatedAt: '',
      },
    ] as never)
    vi.mocked(buildStyleHardGuardPromptSection).mockReturnValue(
      '【风格硬约束 · 冷硬短句】\n- 句长尽量维持在 14-24 字。\n- 抽象词密度不高于 12%。',
    )

    const context = allocateChapterContext(createRawData(), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.hardConstraintContext).toContain('【风格硬约束 · 冷硬短句】')
    expect(context.constraintInjectionStatus.injectedLabels).toContain('styleHardGuard')
  })

  it('injects generic feedback recurrence hard constraints from recent review loops', () => {
    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(new Map<unknown, unknown[]>([
      [chapters, [
        {
          id: 2,
          chapterNum: 2,
          reviewNotesJson: JSON.stringify({
            severity: 'high',
            cost_resolution_state: 'evaporated',
            cost_summary: '上一章的伤势和补给损耗被写得太轻。',
          }),
        },
        {
          id: 3,
          chapterNum: 3,
          reviewNotesJson: JSON.stringify({
            severity: 'high',
            cost_resolution_state: 'evaporated',
            cost_summary: '补给损耗在收束时再次被冲淡。',
          }),
        },
      ]],
      [chapterGateRuns, []],
      [antiAiRuleHits, []],
    ])) as never)

    const context = allocateChapterContext(createRawData(), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.hardConstraintContext).toContain('【近章必须避免】')
    expect(context.hardConstraintContext).toContain('代价蒸发')
    expect(context.constraintInjectionStatus.injectedLabels).toContain('feedbackRecurrence')
  })

  it('injects humanization recurrence hard constraints from stored review-note signals', () => {
    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(new Map<unknown, unknown[]>([
      [chapters, [
        {
          id: 2,
          chapterNum: 2,
          reviewNotesJson: JSON.stringify({
            humanization_signals: [{
              issueType: 'template_connector',
              title: '模板衔接',
              severity: 'high',
              detail: '模板连接词占比 52%，承接像自动拼接。',
              avoid: '不要用“然而、与此同时、某种”等模板连接词替代自然承接。',
              prefer: '让承接落在动作、因果和现场反馈上。',
            }],
          }),
        },
        {
          id: 3,
          chapterNum: 3,
          reviewNotesJson: JSON.stringify({
            humanization_signals: [{
              issueType: 'template_connector',
              title: '模板衔接',
              severity: 'high',
              detail: '模板连接词占比 54%，承接依旧发飘。',
              avoid: '不要用“然而、与此同时、某种”等模板连接词替代自然承接。',
              prefer: '让承接落在动作、因果和现场反馈上。',
            }],
          }),
        },
      ]],
      [chapterGateRuns, []],
      [antiAiRuleHits, []],
    ])) as never)

    const context = allocateChapterContext(createRawData(), {
      totalBudget: 10000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.hardConstraintContext).toContain('模板衔接')
    expect(context.hardConstraintContext).toContain('不要用“然而、与此同时、某种”等模板连接词替代自然承接。')
    expect(context.hardConstraintContext).toContain('让承接落在动作、因果和现场反馈上。')
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

  it('applies provider-level token safety margin before allocating context budget', () => {
    vi.mocked(resolveModelRuntimeBudget).mockReturnValue({
      maxContextTokens: 32000,
      maxTokens: 4096,
      provider: 'openai',
      tokenSafetyMarginPct: 10,
    } as ReturnType<typeof resolveModelRuntimeBudget>)

    const context = allocateChapterContext(createRawData(), {
      totalBudget: 40000,
      promptProfile: 'draft',
      chapterComplexity: 'standard',
    })

    expect(context.contextBudgetReport.modelContextLimit).toBe(32000)
    expect(context.contextBudgetReport.safeModelContextLimit).toBe(28800)
    expect(context.contextBudgetReport.tokenSafetyMarginPct).toBe(10)
    expect(context.contextBudgetReport.modelProvider).toBe('openai')
    expect(context.contextBudgetReport.effectiveBudget).toBe(28800)
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

  it('fully injects the previous chapter when the source chapter is short', () => {
    vi.mocked(getDb).mockReturnValue(createMockSelectDb([[], []]) as never)

    const previousChapter = {
      id: 7,
      chapterNum: 7,
      content: '林远踹开铁门，带着剩下的人冲进旧仓库。门外枪声还没停，副手压着伤口，盯着通往地下层的扶梯。',
      nextChapterSeed: '地下层的灯忽然亮了。',
      summary: '主角带队撤入旧仓库，敌人紧追不舍。',
      continuityStateJson: JSON.stringify({
        character_state_changes: ['副手负伤但仍坚持压阵'],
      }),
      scenePlanJson: '',
      reviewNotesJson: '',
    } as never

    const feed = buildPreviousChapterContextFeed(previousChapter)

    expect(feed.previousChapterSampleReport.fullyInjected).toBe(true)
    expect(feed.previousChapterSampleReport.coverageRate).toBe(100)
    expect(feed.previousChapterContext).toContain('上一章全文')
    expect(feed.previousChapterContext).toContain('地下层的灯忽然亮了')
  })

  it('samples a long previous chapter into structured prior segments', () => {
    vi.mocked(getDb).mockReturnValue(createMockSelectDb([
      [{
        id: 3,
        chapterId: 9,
        summaryText: '主角确认补给点已经暴露，必须在天亮前转移。',
      }],
      [{
        id: 11,
        runId: 3,
        sortOrder: 1,
        diffReason: '副手从怀疑转为暂时协同',
      }, {
        id: 12,
        runId: 3,
        sortOrder: 2,
        diffReason: '通信器失灵导致撤离路线暴露',
      }],
    ]) as never)

    const previousChapter = {
      id: 9,
      chapterNum: 9,
      content: '仓库里的灯泡一闪一闪。'.repeat(180),
      nextChapterSeed: '他们必须在天亮前改道。',
      summary: '仓库据点暴露，队伍被迫准备二次转移。',
      continuityStateJson: JSON.stringify({
        plot_progress: ['补给点位置已经暴露'],
        character_state_changes: ['副手暂时接受主角指挥'],
        open_loops: ['备用路线是否安全仍未知'],
      }),
      scenePlanJson: JSON.stringify([{
        scene_title: '仓库争执',
        purpose: '确认据点已暴露并迫使队伍表态',
        conflict: '主角要求立刻转移，副手担心伤员撑不住',
        exit_hook: '地下层传来异常声响',
      }]),
      reviewNotesJson: JSON.stringify({
        critical_fixes: ['必须写清通信器失灵是如何暴露队伍位置的'],
      }),
    } as never

    const feed = buildPreviousChapterContextFeed(previousChapter)
    const segmentTypes = feed.previousChapterSampleReport.segments.map((segment) => segment.type)

    expect(feed.previousChapterSampleReport.fullyInjected).toBe(false)
    expect(feed.previousChapterSampleReport.coverageRate).toBeGreaterThan(0)
    expect(feed.previousChapterSampleReport.coverageRate).toBeLessThan(100)
    expect(segmentTypes).toContain('tail')
    expect(segmentTypes).toContain('continuity')
    expect(feed.previousChapterContext).toContain('Canon / 状态回写')
  })

  it('measures sampled chars and coverage only from source-derived text windows', () => {
    vi.mocked(getDb).mockReturnValue(createMockSelectDb([[], []]) as never)

    const previousChapter = {
      id: 10,
      chapterNum: 10,
      content: `${'A'.repeat(400)}${'B'.repeat(400)}${'C'.repeat(400)}`,
      nextChapterSeed: '',
      summary: '',
      continuityStateJson: '',
      scenePlanJson: '',
      reviewNotesJson: '',
    } as never

    const feed = buildPreviousChapterContextFeed(previousChapter)
    const sourceSegments = feed.previousChapterSampleReport.segments
      .filter((segment) => ['opening', 'middle', 'tail'].includes(segment.type))
    const sourceSampledChars = sourceSegments.reduce((sum, segment) => sum + segment.chars, 0)

    expect(feed.previousChapterSampleReport.segments.map((segment) => segment.type)).toContain('middle')
    expect(feed.previousChapterSampleReport.sampledChars).toBe(sourceSampledChars)
    expect(feed.previousChapterSampleReport.sampledChars).toBe(740)
    expect(feed.previousChapterSampleReport.coverageRate).toBe(61.7)
    expect(feed.previousChapterContext.length).toBeGreaterThan(feed.previousChapterSampleReport.sampledChars)
  })

  it('expands the recent context window and carries forward older key chapters when current signals require them', () => {
    const previousRows = Array.from({ length: 16 }, (_, index) => ({
      id: index + 1,
      novelId: 1,
      chapterNum: index + 1,
      title: index === 1 ? '药箱失踪' : `第${index + 1}章`,
      summary: index === 1 ? '药箱下落未明，副手记住了旧仓库坐标。' : '',
      outline: '',
      nextChapterSeed: '',
      continuityStateJson: index === 1 ? JSON.stringify({
        open_loops: ['药箱下落未明'],
        continuity_notes: ['副手记得旧仓库坐标'],
      }) : '',
    })) as ChapterContextRawData['chapterRows']

    const baselineRows = selectRecentContextRows(previousRows as never, 0, previousRows.length, {
      maxCarryover: 0,
    })
    const signalAwareRows = selectRecentContextRows(previousRows as never, 0, previousRows.length, {
      signalText: '药箱\n副手\n补给点\n回收',
      mentionedCharacters: ['副手', '主角'],
      mentionedItems: ['药箱'],
      mentionedLocations: ['补给点'],
      maxCarryover: 1,
    })

    expect(baselineRows).toHaveLength(8)
    expect(signalAwareRows.length).toBeGreaterThan(baselineRows.length)
    expect(signalAwareRows.some((row) => row.chapterNum === 2)).toBe(true)
  })

  it('keeps previous-chapter prior ahead of summary memory under a tight draft budget', () => {
    const rawData = createRawData({
      contextParts: {
        previousChapterContext: '先验'.repeat(420),
        previousSummaries: '摘要'.repeat(2400),
        longTermMemory: '长期'.repeat(2200),
        recalledMemory: '召回'.repeat(2200),
        continuitySummary: '连续'.repeat(1800),
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
      const overflow = error as ContextOverflowError
      const previousChapterDecision = overflow.context.softContextDecisions.find((entry) => entry.label === 'previousChapterContext')
      const previousSummaryDecision = overflow.context.softContextDecisions.find((entry) => entry.label === 'previousSummaries')
      expect(overflow.context.previousChapterContext.length).toBeGreaterThan(0)
      expect(previousChapterDecision?.status).not.toBe('dropped')
      expect(previousSummaryDecision?.status).not.toBe('kept')
    }
  })

  it('marks recall as budget-trimmed when selected recall is dropped from final context', () => {
    const rawData = createRawData({
      contextParts: {
        recalledMemory: '召回片段'.repeat(2600),
        previousChapterContext: '先验'.repeat(420),
        previousSummaries: '摘要'.repeat(2400),
        longTermMemory: '长期'.repeat(2200),
        continuitySummary: '连续'.repeat(1800),
      },
      recallSnapshot: {
        retrievalUsed: true,
        degraded: false,
        hitCount: 6,
        selectedHitCount: 2,
        staleRecallCount: 0,
        fallbackHitCount: 0,
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
      const overflow = error as ContextOverflowError
      expect(overflow.context.recalledMemory).toBe('')
      expect(overflow.context.recallSnapshot.retrievalUsed).toBe(false)
      expect(overflow.context.recallSnapshot.degraded).toBe(true)
      expect(overflow.context.recallSnapshot.fallbackReason).toBe('budget_trimmed')
    }
  })

  it('rejects low-similarity and entity-mismatched recall hits from prompt recall selection', () => {
    const recallResult = buildRecallSnapshot([{
      bucket: 'thread',
      hits: [
        {
          chapterId: 1,
          chapterNum: 1,
          fragmentType: 'summary',
          fragmentText: '药箱还留在旧仓库。',
          similarity: 0.12,
          searchMode: 'vector',
          bucket: 'thread',
          stale: false,
          staleReasons: [],
          overriddenByConstraint: false,
          entityMatches: ['药箱'],
          entityValidationRequired: true,
          entityValidated: true,
        },
        {
          chapterId: 2,
          chapterNum: 2,
          fragmentType: 'summary',
          fragmentText: '药箱还留在旧仓库，副手还记得坐标。',
          similarity: 0.66,
          searchMode: 'vector',
          bucket: 'thread',
          stale: false,
          staleReasons: [],
          overriddenByConstraint: false,
          entityMatches: ['药箱', '副手'],
          entityValidationRequired: true,
          entityValidated: true,
        },
        {
          chapterId: 3,
          chapterNum: 3,
          fragmentType: 'summary',
          fragmentText: '旧案线索仍未处理。',
          similarity: 0.63,
          searchMode: 'vector',
          bucket: 'thread',
          stale: false,
          staleReasons: [],
          overriddenByConstraint: false,
          entityMatches: [],
          entityValidationRequired: true,
          entityValidated: false,
        },
        {
          chapterId: 4,
          chapterNum: 4,
          fragmentType: 'summary',
          fragmentText: '药箱还留在旧仓库。',
          similarity: 0.02,
          searchMode: 'keyword',
          bucket: 'thread',
          stale: false,
          staleReasons: [],
          overriddenByConstraint: false,
          entityMatches: ['药箱'],
          entityValidationRequired: true,
          entityValidated: true,
        },
      ],
    }])

    expect(recallResult.recallDiagnostics.selectedHitCount).toBe(1)
    expect(recallResult.recallDiagnostics.lowSimilarityRejectedCount).toBe(2)
    expect(recallResult.recallDiagnostics.entityValidationRejectedCount).toBe(1)
    expect(recallResult.recalledMemory).toContain('药箱还留在旧仓库')
    expect(recallResult.recalledMemory).not.toContain('旧案线索仍未处理')
    expect(recallResult.recallSnapshot.retrievalUsed).toBe(true)
  })
})

describe('buildStoryProfile source/canon grounding', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset()
  })

  it('folds project-level source/canon data into world rules summary', async () => {
    const rows = new Map<unknown, unknown[]>([
      [novels, [
        {
          id: 1,
          title: '江南旧案',
          genreId: 11,
          status: 'draft',
          totalWords: 0,
          targetWords: 180000,
          projectBriefJson: '{}',
          settingsJson: '{}',
          themeVoiceJson: '{}',
          worldRulesJson: '{}',
          historicalProfileJson: JSON.stringify({
            mode: 'historical_realist',
            eraPackId: 'ming_qing',
            regionPackId: 'jiangnan',
          }),
          projectCanonProfileJson: JSON.stringify({
            namingSystem: '明代官场命名',
          }),
          canonConstraintSetJson: JSON.stringify({
            travelAndCommunicationRules: ['官道驿递优先，禁止当日跨省'],
          }),
          sourceLedgerJson: JSON.stringify([
            {
              sourceKey: 'source-1',
              factTitle: '驿递制度',
              sourceText: '跨省公文主要依赖驿站传递。',
            },
          ]),
          canonFactCardsJson: JSON.stringify([
            {
              cardKey: 'canon-1',
              title: '驿递制度',
              summary: '跨省传递依赖驿站与官道，不能当日越省。',
            },
          ]),
        },
      ]],
      [genres, [{ id: 11, name: '历史正剧' }]],
      [characters, []],
      [glossary, []],
    ])
    vi.mocked(getDb).mockReturnValue(createTableAwareDbMock(rows as Map<unknown, unknown[]>) as never)

    const profile = await buildStoryProfile(1)

    expect(profile.historicalGroundingSummary).toContain('来源较完整')
    expect(profile.worldRulesSummary).toContain('项目历史 profile')
    expect(profile.worldRulesSummary).toContain('ming_qing')
    expect(profile.worldRulesSummary).toContain('驿递制度')
    expect(profile.worldRulesSummary).toContain('官道驿递优先')
  })
})
