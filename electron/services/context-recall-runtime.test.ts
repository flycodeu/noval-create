import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./embedding.service', () => ({
  searchSimilarFragments: vi.fn(),
}))

vi.mock('./semantic-memory.service', () => ({
  processSemanticMemoryOutbox: vi.fn(),
  searchSemanticMemory: vi.fn(),
}))

import { searchSimilarFragments } from './embedding.service'
import {
  processSemanticMemoryOutbox,
  searchSemanticMemory,
} from './semantic-memory.service'
import {
  runRecallAugmentation,
  type RunRecallAugmentationInput,
} from './context-recall-runtime'

function buildInput(
  overrides: Partial<RunRecallAugmentationInput> = {},
): RunRecallAugmentationInput {
  return {
    novelId: 7,
    chapterNum: 6,
    entityFreshnessMap: new Map(),
    constraintText: '',
    chapterGoal: '',
    outline: '',
    arcGoal: '',
    arcSummary: '',
    storyGoal: '',
    coreConflict: '',
    mainPlot: '',
    themeVoiceSummary: '',
    worldRules: '',
    relationSummary: '',
    characterStates: '',
    itemSummary: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    activeThreads: '',
    openLoops: '',
    dueForeshadows: '',
    continuityNotes: '',
    chapterBridgePlan: '',
    storyThreadsSummary: '',
    mentionedCharacters: [],
    mentionedItems: [],
    mentionedLocations: [],
    ...overrides,
  }
}

describe('context recall runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(processSemanticMemoryOutbox).mockResolvedValue({
      claimedCount: 0,
      processedCount: 0,
      supersededCount: 0,
      failedCount: 0,
    })
    vi.mocked(searchSimilarFragments).mockResolvedValue({ hits: [] })
    vi.mocked(searchSemanticMemory).mockResolvedValue([])
  })

  it('skips projection refresh and search when planning produces no buckets', async () => {
    const result = await runRecallAugmentation(buildInput())

    expect(result.recallSnapshot).toMatchObject({
      retrievalUsed: false,
      fallbackReason: 'no_hits',
    })
    expect(processSemanticMemoryOutbox).not.toHaveBeenCalled()
    expect(searchSimilarFragments).not.toHaveBeenCalled()
    expect(searchSemanticMemory).not.toHaveBeenCalled()
  })

  it('continues with clean projections when outbox refresh fails', async () => {
    vi.mocked(processSemanticMemoryOutbox).mockRejectedValue(new Error('busy'))

    await runRecallAugmentation(buildInput({
      activeThreads: '找回药箱',
      mentionValidationItems: ['药箱'],
    }))

    expect(searchSimilarFragments).toHaveBeenCalledTimes(1)
    expect(searchSemanticMemory).toHaveBeenCalledWith(
      7,
      expect.stringContaining('找回药箱'),
      expect.objectContaining({
        sourceTypes: ['story_thread', 'timeline_event'],
        visibility: 'canon',
        refreshOutbox: false,
      }),
    )
  })

  it('filters future chapter fragments before snapshot selection', async () => {
    vi.mocked(searchSimilarFragments).mockResolvedValue({
      hits: [
        {
          chapterId: 5,
          chapterNum: 5,
          fragmentType: 'summary',
          fragmentText: '药箱仍在旧仓库。',
          similarity: 0.82,
          searchMode: 'vector',
        },
        {
          chapterId: 8,
          chapterNum: 8,
          fragmentType: 'summary',
          fragmentText: '未来章节中的药箱。',
          similarity: 0.95,
          searchMode: 'vector',
        },
      ],
    })

    const result = await runRecallAugmentation(buildInput({
      activeThreads: '找回药箱',
      mentionValidationItems: ['药箱'],
    }))

    expect(result.recalledMemory).toContain('药箱仍在旧仓库')
    expect(result.recalledMemory).not.toContain('未来章节')
    expect(result.recallDiagnostics.totalHitCount).toBe(1)
  })

  it('degrades individual backend failures without dropping hard context', async () => {
    vi.mocked(searchSimilarFragments).mockRejectedValue(new Error('embedding unavailable'))
    vi.mocked(searchSemanticMemory).mockRejectedValue(new Error('semantic unavailable'))

    const result = await runRecallAugmentation(buildInput({
      chapterGoal: '守住补给线',
    }))

    expect(searchSimilarFragments).toHaveBeenCalledTimes(3)
    expect(searchSemanticMemory).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({
      assemblyStage: 'recall',
      recalledMemory: '',
      recallSnapshot: {
        retrievalUsed: false,
        degraded: true,
        fallbackReason: 'embedding_service_failed',
      },
    })
  })
})
