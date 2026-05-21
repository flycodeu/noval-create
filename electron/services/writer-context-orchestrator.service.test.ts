import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./character.service', () => ({
  listCharacters: vi.fn(() => []),
  getCharacterDetailContext: vi.fn(() => ({
    relatedItems: [],
    relatedCharacters: [],
    relatedRelations: [],
  })),
}))

vi.mock('./embedding.service', () => ({
  searchSimilarFragments: vi.fn(async () => ({
    hits: [],
  })),
}))

vi.mock('./item.service', () => ({
  listStoryItems: vi.fn(() => []),
  getStoryItemDetailContext: vi.fn(() => ({
    item: null,
    parentTemplate: null,
    ownerCharacter: null,
    location: null,
    relatedCharacters: [],
    relatedEvents: [],
    relatedArcs: [],
    relatedLocations: [],
    relatedSegments: [],
    derivedInstances: [],
    siblingInstances: [],
    sourceContexts: [],
  })),
}))

vi.mock('./story-memory.service', () => ({
  buildStoryMemorySnapshot: vi.fn(() => ({
    generatedAt: '2026-05-17T00:00:00.000Z',
    chapterCount: 12,
    lastChapterNum: 12,
    memoryMode: 'standard',
    coverageSummary: '覆盖到最近主线节点。',
    phaseDigest: ['阶段一推进', '阶段二承压'],
    plotMilestones: ['Ch.11 撤离完成', 'Ch.12 补给线中断'],
    arcSignals: [],
    characterLedger: [],
    characterCurrentStates: [],
    characterStateAlerts: [],
    worldCurrentStates: [],
    worldStateAlerts: [],
    worldStateOverview: {
      trackedEntityCount: 0,
      alertEntityCount: 0,
      conflictEntityCount: 0,
      latestChapterNum: 12,
      severityBreakdown: { info: 0, warning: 0, critical: 0 },
    },
    worldConflictEntities: [],
    characterStateTrendSummary: [],
    worldStateTrendSummary: [],
    worldLedger: [],
    activeThreads: ['副手忠诚摇摆'],
    continuityDirectives: ['不能遗忘伤势代价'],
    timelineAnchors: ['夜里 | 封锁线收紧 | 两小时后'],
    itemLedger: ['药箱 | available | 救命物资'],
  })),
}))

vi.mock('./story-thread.service', () => ({
  listStoryThreads: vi.fn(() => []),
  getForeshadowSnapshot: vi.fn(() => ({
    currentChapterNum: 13,
    pending: [],
    dueSoon: [],
    resolved: [],
    overdue: [],
  })),
}))

vi.mock('./timeline.service', () => ({
  listTimelineEvents: vi.fn(() => []),
}))

vi.mock('./world-state.service', () => ({
  getWorldStateContextSnapshot: vi.fn(() => ({
    currentStates: [],
    alerts: [],
    worldStatesText: '',
    trendSummary: [],
  })),
}))

import {
  __writerOrchestratorTestUtils,
  clearWriterOrchestratorMemoryCache,
  resolveWriterOrchestratedContext,
} from './writer-context-orchestrator.service'
import { buildStoryMemorySnapshot } from './story-memory.service'

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    novelId: 1,
    chapterId: 101,
    chapterNum: 13,
    signals: {
      chapterTitle: '补给点对峙',
      chapterOutline: '主角必须守住补给点，并处理副手的动摇。',
      chapterGoal: '守住补给点并稳住副手',
      arcGoal: '完成第一次反扑',
      mentionedCharacters: ['林策', '沈砚'],
      mentionedItems: [],
      mentionedLocations: [],
    },
    runtime: {
      useMemoryCache: false,
    },
    ...overrides,
  }
}

describe('writer context orchestrator', () => {
  beforeEach(() => {
    clearWriterOrchestratorMemoryCache()
  })

  it('prunes query plan based on writer signals', () => {
    const input = createInput({
      signals: {
        chapterGoal: '守住补给点并稳住副手',
        relationSummary: '林策与沈砚互不信任。',
        activeThreads: '副手可能临阵倒向对方。',
        openLoops: '掉队者生死未明。',
        dueForeshadows: '失灵通信器可能暴露位置。',
        mentionedCharacters: ['林策', '沈砚'],
        mentionedItems: [],
        mentionedLocations: [],
      },
    })

    const plan = __writerOrchestratorTestUtils.buildWriterQueryPlan(input)
    const enabled = new Map(plan.map((step) => [step.bucket, step.enabled] as const))

    expect(enabled.get('story_memory')).toBe(true)
    expect(enabled.get('character')).toBe(true)
    expect(enabled.get('thread')).toBe(true)
    expect(enabled.get('recall_character')).toBe(true)
    expect(enabled.get('recall_thread')).toBe(true)
    expect(enabled.get('item')).toBe(false)
    expect(enabled.get('world_state')).toBe(false)
    expect(enabled.get('timeline')).toBe(false)
    expect(enabled.get('recall_rule')).toBe(false)
  })

  it('builds fingerprint from invalidation inputs', () => {
    const inputA = createInput({
      invalidation: {
        chapterContextVersion: 3,
        novelContextVersion: 8,
        assetFingerprint: 'assets:v1',
      },
    })
    const inputB = createInput({
      invalidation: {
        chapterContextVersion: 4,
        novelContextVersion: 8,
        assetFingerprint: 'assets:v1',
      },
    })

    const planA = __writerOrchestratorTestUtils.buildWriterQueryPlan(inputA)
    const planB = __writerOrchestratorTestUtils.buildWriterQueryPlan(inputB)
    const fingerprintA = __writerOrchestratorTestUtils.buildRetrievalFingerprint(inputA, planA)
    const fingerprintB = __writerOrchestratorTestUtils.buildRetrievalFingerprint(inputB, planB)

    expect(fingerprintA.cacheKey).not.toBe(fingerprintB.cacheKey)
    expect(fingerprintA.digest).not.toBe(fingerprintB.digest)
    expect(fingerprintA.inputs.chapterContextVersion).toBe(3)
    expect(fingerprintA.inputs.assetFingerprint).toBe('assets:v1')
    expect(fingerprintA.inputs.enabledBuckets).toContain('character')
  })

  it('records fallback events when retrieval fails or degrades', async () => {
    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterGoal: '守住补给点并稳住副手',
        relationSummary: '林策与沈砚互不信任。',
        mentionedCharacters: ['林策'],
        mentionedItems: [],
        mentionedLocations: [],
      },
    }), {
      listCharacters: () => {
        throw new Error('character service unavailable')
      },
      searchSimilarFragments: async () => ({
        hits: [],
        fallbackReason: 'query_embedding_failed',
      }),
    })

    expect(resolution.fallbackEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'character',
        reason: 'service_failed',
      }),
      expect.objectContaining({
        target: 'recall_character',
        reason: 'query_embedding_failed',
      }),
    ]))
  })

  it('reuses story memory snapshot within a single resolution', async () => {
    const buildStoryMemorySnapshotMock = vi.mocked(buildStoryMemorySnapshot)
    buildStoryMemorySnapshotMock.mockClear()

    await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterGoal: '守住补给点并稳住副手',
        relationSummary: '林策与沈砚互不信任。',
        activeThreads: '副手可能临阵倒向对方。',
        dueForeshadows: '失灵通信器可能暴露位置。',
        mentionedCharacters: ['林策'],
        mentionedItems: [],
        mentionedLocations: [],
      },
    }))

    expect(buildStoryMemorySnapshotMock).toHaveBeenCalledTimes(1)
  })

  it('renders structured context overrides instead of a final prompt', async () => {
    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterTitle: '补给点对峙',
        chapterOutline: '主角要在天亮前守住补给点，药箱和通信器都可能失守。',
        chapterGoal: '守住补给点并稳住副手',
        relationSummary: '林策与沈砚互不信任。',
        worldStates: '封锁线即将收紧。',
        timelineSummary: '天亮前必须完成转移。',
        timelineOpenThreads: '两小时后封锁收紧。',
        activeThreads: '副手可能临阵倒向对方。',
        openLoops: '掉队者生死未明。',
        dueForeshadows: '失灵通信器可能暴露位置。',
        mentionedCharacters: ['林策'],
        mentionedItems: ['药箱'],
        mentionedLocations: ['东门补给点'],
      },
    }), {
      listCharacters: (() => [{
        id: 11,
        novelId: 1,
        roleType: 'protagonist',
        fullName: '林策',
        goals: '守住补给点',
        innerConflict: '不信任副手却必须依赖他',
        relationshipTension: '对沈砚戒备',
        characterArc: '从独断转向协作',
        speechPattern: '短句下命令',
        catchphrases: '先顶住',
        vocabularyLevel: '克制直接',
        dialectFeatures: '',
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      }]) as never,
      getCharacterDetailContext: () => ({
        relatedItems: [{ itemName: '药箱' }],
        relatedCharacters: [],
        relatedRelations: [{
          relationLabel: '互不信任',
          relationType: 'ally',
          description: '合作但互相提防',
        }],
      } as never),
      listStoryItems: (() => [{
        id: 21,
        novelId: 1,
        itemKind: 'instance',
        itemName: '药箱',
        status: 'available',
        plotFunction: '稳定伤员状态',
        summary: '队伍唯一完整药品',
        risk: '丢失后伤员无法撤离',
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      }]) as never,
      getStoryItemDetailContext: () => ({
        ownerCharacter: { fullName: '沈砚' },
        relatedEvents: [{ eventTitle: '补给点交火' }],
      } as never),
      listTimelineEvents: (() => [{
        id: 31,
        novelId: 1,
        sortOrder: 1,
        eventTitle: '补给点交火',
        eventSummary: '天亮前必须守住入口',
        timeMode: 'relative',
        timeLabel: '夜里',
        timeSortValue: 100,
        isMajorEvent: 1,
        status: 'planned',
        openThreadsJson: JSON.stringify(['入口火力尚未压住']),
        createdAt: '',
        updatedAt: '',
      }]) as never,
      getWorldStateContextSnapshot: () => ({
        currentStates: [{
          entityType: 'location',
          entityId: 41,
          entityName: '东门补给点',
          chapterId: 90,
          chapterNum: 12,
          summaryText: '外层封锁正在收紧',
          stateItems: [],
          severity: 'warning',
        }],
        alerts: [{
          alertType: 'drift',
          entityType: 'location',
          entityId: 41,
          entityName: '东门补给点',
          chapterId: 90,
          chapterNum: 12,
          severity: 'warning',
          score: 0.82,
          reasons: ['两小时后封锁升级'],
          summary: '封锁升级将切断撤离路线',
        }],
        worldStatesText: '东门补给点：两小时后封锁升级。',
        trendSummary: [],
      }),
      listStoryThreads: (() => [{
        id: 51,
        novelId: 1,
        threadType: 'payoff',
        title: '副手忠诚摇摆',
        status: 'active',
        priority: 'high',
        currentState: '尚未明确站队',
        payoffCondition: '必须在危机里表态',
        sortOrder: 1,
        createdAt: '',
        updatedAt: '',
      }]) as never,
      getForeshadowSnapshot: (() => ({
        currentChapterNum: 13,
        pending: [],
        dueSoon: [{
          id: 61,
          title: '失灵通信器',
          threadType: 'payoff',
          status: 'active',
          foreshadowStatus: 'due',
          priority: 'high',
          relatedCharacterCount: 1,
          summary: '随时可能暴露位置',
          warningText: '接近目标回收章位，本章需回收或给出延期说明。',
        }],
        resolved: [],
        overdue: [],
      })) as never,
      searchSimilarFragments: async () => ({
        hits: [{
          chapterId: 77,
          chapterNum: 9,
          fragmentType: 'summary',
          fragmentText: '林策曾因误判丢过一次补给车，之后极度排斥把物资交给别人。',
          similarity: 0.84,
          searchMode: 'vector',
        }],
      }),
    })

    expect(resolution.renderedContextOverrides.characterStates).toContain('林策')
    expect(resolution.renderedContextOverrides.itemSummary).toContain('药箱')
    expect(resolution.renderedContextOverrides.timelineSummary).toContain('补给点交火')
    expect(resolution.renderedContextOverrides.worldStates).toContain('东门补给点')
    expect(resolution.renderedContextOverrides.activeThreads).toContain('副手忠诚摇摆')
    expect(resolution.renderedContextOverrides.recalledMemory).toContain('[character] Ch.9')
    expect(resolution.allocatorInputSummary.overrideLabels).toEqual(expect.arrayContaining([
      'characterStates',
      'itemSummary',
      'timelineSummary',
      'worldStates',
      'activeThreads',
      'recalledMemory',
    ]))
  })
})
