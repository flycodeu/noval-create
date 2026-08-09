import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./embedding.service', () => ({
  fallbackKeywordSearch: vi.fn(),
}))

import { getDb } from '../database/db'
import {
  characters,
  characterStateVersions,
  worldStateVersions,
} from '../database/schema'
import { fallbackKeywordSearch } from './embedding.service'
import {
  buildHeuristicRecallDiagnostics,
  buildRecallBucketCoverageRate,
  buildRecallFreshnessState,
  formatRecallFallbackReason,
  getConsecutiveRecallFallbackCount,
  pickLatestRecallFallbackReason,
  resolveRecallDiagnosticThreshold,
  sumRecallDiagnosticMetric,
} from './quality-dashboard-recall-diagnostics'

type TableRows = Map<unknown, Array<Record<string, unknown>>>

function createDbMock(rowsByTable: TableRows) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const query = {
          where: () => query,
          all: () => rowsByTable.get(table) || [],
        }
        return query
      }),
    })),
  }
}

function createDiagnostics(overrides: Record<string, number> = {}) {
  return {
    searchedBucketCount: 1,
    selectedBucketCount: 1,
    totalHitCount: 1,
    selectedHitCount: 1,
    staleRecallCount: 0,
    staleRecallRate: 0,
    recallDependencyRate: 100,
    overriddenHitCount: 0,
    fallbackHitCount: 1,
    validatedHitCount: overrides.validatedHitCount || 0,
    lowSimilarityRejectedCount: overrides.lowSimilarityRejectedCount || 0,
    entityValidationRejectedCount: overrides.entityValidationRejectedCount || 0,
    chapterSourceHitCount: 1,
    semanticAssetHitCount: 0,
    selectedChapterSourceCount: 1,
    selectedSemanticAssetCount: 0,
    minVectorSimilarity: overrides.minVectorSimilarity ?? 0.18,
    minKeywordSimilarity: overrides.minKeywordSimilarity ?? 0.04,
    summaryLines: [],
  }
}

describe('quality dashboard recall diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks an old hit stale when its referenced entity changed in an intermediate chapter', () => {
    vi.mocked(getDb).mockReturnValue(createDbMock(new Map<unknown, Array<Record<string, unknown>>>([
      [characters, [{ id: 1, fullName: '沈砚' }]],
      [characterStateVersions, [
        { characterId: 1, chapterNum: 7 },
        { characterId: 1, chapterNum: 7 },
      ]],
      [worldStateVersions, [{ entityName: '旧仓库', chapterNum: 8 }]],
    ])) as never)
    vi.mocked(fallbackKeywordSearch).mockReturnValue([
      {
        chapterId: 3,
        chapterNum: 3,
        fragmentType: 'summary',
        fragmentText: '沈砚仍驻守北线。',
        similarity: 0.6,
        searchMode: 'keyword',
      },
      {
        chapterId: 9,
        chapterNum: 9,
        fragmentType: 'summary',
        fragmentText: '补给线已经转移。',
        similarity: 0.5,
        searchMode: 'keyword',
      },
    ])

    const freshness = buildRecallFreshnessState(4)
    expect(freshness.entityUpdateMap.get('沈砚')).toEqual([7])
    const diagnostics = buildHeuristicRecallDiagnostics(4, {
      chapterNum: 10,
      title: '北线转移',
    }, freshness)

    expect(diagnostics.totalHitCount).toBe(2)
    expect(diagnostics.staleRecallCount).toBe(1)
    expect(diagnostics.selectedHitCount).toBe(1)
    expect(diagnostics.staleRecallRate).toBe(50)
    expect(diagnostics.summaryLines.at(-1)).toContain('过期率 50%')
  })

  it('does not query fallback memory when the chapter has no recall signal', () => {
    const diagnostics = buildHeuristicRecallDiagnostics(4, {
      chapterNum: 10,
      title: ' ',
      summary: null,
      outline: '',
    }, {
      entityUpdateMap: new Map(),
      candidateNames: [],
    })

    expect(diagnostics.searchedBucketCount).toBe(0)
    expect(diagnostics.summaryLines).toEqual(['当前章节缺少可用于召回的标题、摘要或大纲信号。'])
    expect(fallbackKeywordSearch).not.toHaveBeenCalled()
  })

  it('aggregates persisted recall diagnostics without changing thresholds', () => {
    const entries = [
      { diagnostics: createDiagnostics({ validatedHitCount: 2, minVectorSimilarity: 0.2 }) },
      {
        diagnostics: createDiagnostics({
          validatedHitCount: 3,
          lowSimilarityRejectedCount: 4,
          entityValidationRejectedCount: 1,
          minVectorSimilarity: 0.15,
        }),
      },
    ]

    expect(sumRecallDiagnosticMetric(entries, 'validatedHitCount')).toBe(5)
    expect(sumRecallDiagnosticMetric(entries, 'lowSimilarityRejectedCount')).toBe(4)
    expect(resolveRecallDiagnosticThreshold(entries, 'minVectorSimilarity')).toBe(0.2)
    expect(buildRecallBucketCoverageRate({
      bucketStats: {
        plot: { hitCount: 2 },
        character: { hitCount: 0 },
      },
    } as never)).toBe(50)
  })

  it('keeps fallback ordering and consecutive degradation semantics stable', () => {
    const entries = [
      { snapshot: { degraded: true, fallbackReason: 'embedding_service_failed' } },
      { snapshot: { degraded: true, fallbackReason: 'no_hits' } },
      { snapshot: { degraded: false } },
    ]
    const snapshots = entries.map((entry) => entry.snapshot)

    expect(getConsecutiveRecallFallbackCount(entries as never)).toBe(2)
    expect(pickLatestRecallFallbackReason(snapshots as never)).toBe('embedding_service_failed')
    expect(formatRecallFallbackReason('embedding_profile_mismatch')).toBe('向量模型空间不匹配')
    expect(formatRecallFallbackReason()).toBe('未记录')
  })
})
