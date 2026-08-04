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

vi.mock('./map.service', () => ({
  searchMapNodes: vi.fn(() => []),
  getMapNode: vi.fn(() => null),
  getMapRelations: vi.fn(() => []),
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
    expect(enabled.get('world_state')).toBe(true)
    expect(enabled.get('timeline')).toBe(false)
    expect(enabled.get('recall_rule')).toBe(false)
    expect(plan.find((step) => step.bucket === 'world_state')?.terms).toEqual(expect.arrayContaining(['林策', '沈砚']))
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

  it('uses chapter bridge and step memory as recall signals even without entity mentions', async () => {
    const input = createInput({
      signals: {
        chapterTitle: '门外脚步',
        chapterOutline: '',
        chapterGoal: '',
        chapterBridgePlan: '承接来源：第1章结尾门外脚步声。\n首场景约束：前 200 字必须接住门外压力。',
        activeThreads: '',
        openLoops: '',
        dueForeshadows: '',
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: [],
      },
      baseContextParts: {
        chapterBridgePlan: '承接来源：第1章结尾门外脚步声。\n首场景约束：前 200 字必须接住门外压力。',
        stepMemorySummary: 'Planner 必须从门外脚步切入，Writer 不得重启到白天。',
      },
      runtime: {
        useMemoryCache: false,
      },
    })
    const plan = __writerOrchestratorTestUtils.buildWriterQueryPlan(input)
    const enabled = new Map(plan.map((step) => [step.bucket, step.enabled] as const))

    expect(enabled.get('story_memory')).toBe(true)
    expect(enabled.get('thread')).toBe(true)
    expect(enabled.get('recall_thread')).toBe(true)
    expect(plan.find((step) => step.bucket === 'thread')?.queryText).toContain('Writer 不得重启到白天')
    expect(plan.find((step) => step.bucket === 'recall_thread')?.queryText).toContain('Writer 不得重启到白天')

    const resolution = await resolveWriterOrchestratedContext(input, {
      searchSimilarFragments: async () => ({
        hits: [],
        fallbackReason: 'query_embedding_failed',
      }),
    })

    expect(resolution.renderedContextOverrides.chapterBridgePlan).toContain('门外脚步声')
    expect(resolution.renderedContextOverrides.stepMemorySummary).toContain('Writer 不得重启到白天')
    expect(resolution.allocatorInputSummary.buckets.some((bucket) =>
      bucket.bucket === 'story_memory' && bucket.renderedLabels.includes('chapterBridgePlan'))).toBe(true)
    expect(resolution.allocatorInputSummary.buckets.some((bucket) =>
      bucket.bucket === 'story_memory' && bucket.renderedLabels.includes('stepMemorySummary'))).toBe(true)
    expect(resolution.allocatorInputSummary.buckets.some((bucket) =>
      bucket.bucket === 'thread' && bucket.renderedLabels.includes('chapterBridgePlan'))).toBe(true)
    expect(resolution.allocatorInputSummary.buckets.some((bucket) =>
      bucket.bucket === 'thread' && bucket.renderedLabels.includes('stepMemorySummary'))).toBe(true)
    expect(resolution.fallbackEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'recall_thread',
        reason: 'query_embedding_failed',
        fallbackMode: 'conservative',
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
        mentionedItems: ['救命包'],
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
        typedRefsJson: JSON.stringify({ version: 1, pointers: [{ assetType: 'item', name: '救命包' }] }),
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

  it('loads source grounding as a dedicated writer context bucket for historical projects', async () => {
    const input = createInput({
      signals: {
        chapterTitle: '驿站夜报',
        chapterOutline: '主角必须判断边镇军报是否可信。',
        chapterGoal: '用驿递延误制造朝堂误判',
        genre: '历史正剧',
        worldRules: '王朝使用州府、郡县、驿站、官道与军镇体系。未确认细节必须保守表达。',
        backgroundText: '故事发生在王朝边镇与京畿之间，军报传递受到驿路与汛期影响。',
        historicalProfileJson: JSON.stringify({
          mode: 'historical_realist',
          eraPackId: 'late_imperial',
          regionPackId: 'northwest_frontier',
        }),
        sourceLedgerJson: JSON.stringify([{
          sourceKey: 'src-1',
          factTitle: '驿递限制',
          sourceText: '跨区域公文传递依赖驿站、官道和地方转呈，不能写成瞬时通信。',
          sourceUrl: 'https://example.test/post-road',
          verificationStatus: 'web_found',
          recordedAt: '2026-06-07T00:00:00.000Z',
        }]),
        canonFactCardsJson: JSON.stringify([{
          cardKey: 'fact-1',
          title: '军报时滞',
          summary: '边镇军报到京畿存在路程与转呈延迟。',
        }]),
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: [],
      },
      baseContextParts: {
        worldRules: '王朝使用州府、郡县、驿站、官道与军镇体系。',
      },
      runtime: {
        useMemoryCache: false,
      },
    })
    const plan = __writerOrchestratorTestUtils.buildWriterQueryPlan(input)

    expect(plan.find((step) => step.bucket === 'source_grounding')).toEqual(expect.objectContaining({
      enabled: true,
      serviceCalls: ['source_grounding.get_pack'],
    }))

    const resolution = await resolveWriterOrchestratedContext(input)

    expect(resolution.structuredPack.sourceGrounding).toEqual(expect.objectContaining({
      mode: 'historical_realist',
      coverage: 'grounded',
    }))
    expect(resolution.renderedContextOverrides.worldRules).toContain('来源摘录')
    expect(resolution.renderedContextOverrides.worldRules).toContain('驿递限制')
    expect(resolution.renderedContextOverrides.worldRules).toContain('https://example.test/post-road')
    expect(resolution.renderedContextOverrides.worldRules).toContain('status=web_found')
    expect(resolution.renderedContextOverrides.worldRules).toContain('军报时滞')
    expect(resolution.allocatorInputSummary.buckets.some((bucket) =>
      bucket.bucket === 'source_grounding' && bucket.renderedLabels.includes('worldRules'))).toBe(true)
  })

  it('keeps an unapproved chapter extract out of the writer source-grounding bucket', () => {
    const input = createInput({
      signals: {
        sourceLedgerJson: JSON.stringify([{
          sourceKey: 'chapter:101:thread:pending',
          chapterId: 101,
          runId: 21,
          assetType: 'thread',
          sourceText: '尚未审批的章节猜测。',
          supportingDiffIds: [],
        }]),
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: [],
      },
    })

    const plan = __writerOrchestratorTestUtils.buildWriterQueryPlan(input)
    expect(plan.find((step) => step.bucket === 'source_grounding')).toEqual(expect.objectContaining({
      enabled: false,
    }))
  })

  it('honors expanded runtime limits for large-cast scenes', async () => {
    const names = Array.from({ length: 10 }, (_, index) => `角色${index + 1}`)

    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterTitle: '群像会盟',
        chapterOutline: `十名关键人物同时出场：${names.join('、')}。`,
        chapterGoal: '让多方阵营在同一场谈判里互相施压',
        mentionedCharacters: names,
        mentionedItems: [],
        mentionedLocations: [],
      },
      runtime: {
        useMemoryCache: false,
        maxCharacters: 10,
      },
    }), {
      listCharacters: (() => names.map((name, index) => ({
        id: index + 1,
        novelId: 1,
        roleType: 'supporting',
        fullName: name,
        goals: `${name}要维护本阵营利益`,
        innerConflict: '',
        relationshipTension: '',
        characterArc: '',
        speechPattern: '',
        catchphrases: '',
        vocabularyLevel: '',
        dialectFeatures: '',
        sortOrder: index + 1,
        createdAt: '',
        updatedAt: '',
      }))) as never,
      getCharacterDetailContext: (() => ({
        relatedItems: [],
        relatedCharacters: [],
        relatedRelations: [],
      })) as never,
    })

    expect(resolution.structuredPack.characters).toHaveLength(10)
    expect(resolution.renderedContextOverrides.characterStates).toContain('角色10')
  })

  it('prioritizes core characters over minor npcs when character pack budget is tight', async () => {
    const names = ['路人甲', '普通配角', '核心反派', '主角', '主要同伴']

    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterTitle: '城门混战',
        chapterOutline: `${names.join('、')}同时出场，但本章必须稳住主线人物。`,
        chapterGoal: '主角与主要同伴在核心反派压迫下突围',
        relationSummary: '主角、主要同伴、核心反派构成本章主要压力三角。',
        mentionedCharacters: names,
        mentionedItems: [],
        mentionedLocations: [],
      },
      runtime: {
        useMemoryCache: false,
        maxCharacters: 3,
      },
    }), {
      listCharacters: (() => [
        { id: 1, novelId: 1, roleType: 'minor', fullName: '路人甲', goals: '制造混乱', innerConflict: '', relationshipTension: '', characterArc: '', speechPattern: '', catchphrases: '', vocabularyLevel: '', dialectFeatures: '', sortOrder: 1, createdAt: '', updatedAt: '' },
        { id: 2, novelId: 1, roleType: 'supporting', fullName: '普通配角', goals: '帮忙守门', innerConflict: '', relationshipTension: '', characterArc: '', speechPattern: '', catchphrases: '', vocabularyLevel: '', dialectFeatures: '', sortOrder: 2, createdAt: '', updatedAt: '' },
        { id: 3, novelId: 1, roleType: 'antagonist', fullName: '核心反派', goals: '逼主角交出路线', innerConflict: '', relationshipTension: '', characterArc: '', speechPattern: '', catchphrases: '', vocabularyLevel: '', dialectFeatures: '', sortOrder: 3, createdAt: '', updatedAt: '' },
        { id: 4, novelId: 1, roleType: 'protagonist', fullName: '主角', goals: '带队突围', innerConflict: '', relationshipTension: '', characterArc: '', speechPattern: '', catchphrases: '', vocabularyLevel: '', dialectFeatures: '', sortOrder: 4, createdAt: '', updatedAt: '' },
        { id: 5, novelId: 1, roleType: 'major', fullName: '主要同伴', goals: '保护伤员', innerConflict: '', relationshipTension: '', characterArc: '', speechPattern: '', catchphrases: '', vocabularyLevel: '', dialectFeatures: '', sortOrder: 5, createdAt: '', updatedAt: '' },
      ]) as never,
      getCharacterDetailContext: (() => ({
        relatedItems: [],
        relatedCharacters: [],
        relatedRelations: [],
      })) as never,
    })

    expect(resolution.structuredPack.characters.map((item) => item.name)).toEqual(['主角', '主要同伴', '核心反派'])
    expect(resolution.renderedContextOverrides.characterStates).toContain('主角')
    expect(resolution.renderedContextOverrides.characterStates).not.toContain('路人甲')
  })

  it('matches story threads before applying the runtime limit', async () => {
    const threadRows = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      novelId: 1,
      threadType: 'subplot',
      title: index === 8 ? '遗失王印归属' : `普通支线${index + 1}`,
      status: 'active',
      priority: index === 8 ? 'high' : 'medium',
      summary: index === 8 ? '王印线索指向东门补给点。' : '日常压力。',
      premise: '',
      payoffCondition: index === 8 ? '必须决定王印由谁保管' : '',
      currentState: index === 8 ? '王印仍在暗线中流转' : '',
      sortOrder: index + 1,
      createdAt: '',
      updatedAt: '',
    }))

    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterGoal: '推进遗失王印归属',
        activeThreads: '遗失王印归属必须在本章压到台前。',
        openLoops: '',
        dueForeshadows: '',
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: [],
      },
      runtime: {
        useMemoryCache: false,
        maxThreads: 1,
      },
    }), {
      listStoryThreads: (() => threadRows) as never,
    })

    expect(resolution.structuredPack.threads?.activeThreadLines.join('\n')).toContain('遗失王印归属')
    expect(resolution.structuredPack.threads?.activeThreadLines).toHaveLength(1)
    expect(resolution.renderedContextOverrides.activeThreads).toContain('遗失王印归属')
  })

  it('retrieves map location packs for mentioned locations', async () => {
    const mapNodes = new Map([
      [1, {
        id: 1,
        novelId: 1,
        level: 1,
        name: '东境',
        sortOrder: 1,
        childCount: 1,
      }],
      [2, {
        id: 2,
        novelId: 1,
        level: 2,
        parentId: 1,
        name: '东门补给点',
        nodeType: '据点',
        locationType: '补给站',
        structureRole: '撤离瓶颈',
        description: '东门外最后一个可补给据点。',
        plotRelevance: '决定队伍能否撑过封锁线',
        dangerLevel: '高',
        sortOrder: 2,
        childCount: 0,
      }],
      [3, {
        id: 3,
        novelId: 1,
        level: 2,
        parentId: 1,
        name: '旧仓库',
        sortOrder: 3,
        childCount: 0,
      }],
    ])

    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterTitle: '补给点对峙',
        chapterOutline: '东门补给点外层封锁即将收紧。',
        chapterGoal: '守住东门补给点',
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: ['东门补给点'],
      },
      runtime: {
        useMemoryCache: false,
        maxMapLocations: 4,
      },
    }), {
      searchMapNodes: (() => [mapNodes.get(2)]) as never,
      getMapNode: ((id: number) => mapNodes.get(id) || null) as never,
      getMapRelations: (() => [{
        id: 1,
        novelId: 1,
        mapAId: 2,
        mapBId: 3,
        relationType: 'route',
        relationLabel: '暗道相连',
        bilateral: 1,
        description: '旧仓库可绕开正门封锁。',
        sortOrder: 1,
      }]) as never,
    })

    expect(resolution.structuredPack.mapLocations).toHaveLength(1)
    expect(resolution.structuredPack.mapLocations[0].path).toBe('东境 -> 东门补给点')
    expect(resolution.renderedContextOverrides.mapSummary).toContain('东门补给点')
    expect(resolution.renderedContextOverrides.mapSummary).toContain('旧仓库')
  })

  it('does not inject arbitrary entity packs when signals do not match stored assets', async () => {
    const getWorldStateContextSnapshot = vi.fn(() => ({
      currentStates: [{
        entityType: 'location' as const,
        entityId: 41,
        entityName: '东门补给点',
        chapterId: 90,
        chapterNum: 12,
        summaryText: '外层封锁正在收紧',
        stateItems: [],
        severity: 'warning' as const,
      }],
      alerts: [],
      worldStatesText: '东门补给点：两小时后封锁升级。',
      trendSummary: [],
    }))
    const resolution = await resolveWriterOrchestratedContext(createInput({
      signals: {
        chapterTitle: '无名夜行',
        chapterOutline: '本章只推进路线选择，没有点名角色和地点。',
        chapterGoal: '让队伍在压力下换路线',
        relationSummary: '关系继续紧张，但本章没有指定出场人物。',
        worldStates: '外部压力继续上升。',
        timelineSummary: '夜色中继续转移。',
        mentionedCharacters: [],
        mentionedItems: [],
        mentionedLocations: [],
      },
      baseContextParts: {
        characterStates: '林策：旧人物状态不应在无命中时进入 writer 上下文。',
        itemSummary: '药箱：旧物品摘要不应在无命中时进入 writer 上下文。',
        timelineSummary: '补给点交火：旧时间线不应在无命中时进入 writer 上下文。',
        worldStates: '东门补给点：旧世界状态不应在无命中时进入 writer 上下文。',
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
      getWorldStateContextSnapshot,
    })

    expect(resolution.renderedContextOverrides.characterStates).toBe('')
    expect(resolution.renderedContextOverrides.itemSummary).toBe('')
    expect(resolution.renderedContextOverrides.timelineSummary).toBe('')
    expect(resolution.renderedContextOverrides.worldStates).toBe('')
    expect(getWorldStateContextSnapshot).toHaveBeenCalledTimes(1)
    expect(resolution.toolCalls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'world_state',
        status: 'success',
        resultCount: 0,
      }),
    ]))
    expect(resolution.fallbackEvents.some((event) => event.target === 'world_state')).toBe(false)
  })
})
