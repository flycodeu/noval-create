import { describe, expect, it } from 'vitest'
import {
  buildEmptyRecallDiagnostics,
  buildRecallSnapshot,
  compactRecallLine,
  createEmptyRecallSnapshot,
  finalizeRecallSnapshot,
  pickRecallFallbackReason,
  splitRecallLines,
} from './context-recall-core'

describe('context recall core', () => {
  it('keeps compacted text inside explicit bounds', () => {
    expect(compactRecallLine(' abc ', 0)).toBe('')
    expect(compactRecallLine('abc', 1)).toBe('…')
    expect(compactRecallLine('a\n b', 2)).toBe('a…')
    expect(compactRecallLine('a\n b', 8)).toBe('a；b')
    expect(splitRecallLines('甲\n甲\n乙', 2, 8)).toEqual(['甲', '乙'])
  })

  it('keeps empty diagnostics and snapshots aligned with runtime thresholds', () => {
    expect(buildEmptyRecallDiagnostics(['未执行'])).toMatchObject({
      minVectorSimilarity: 0.6,
      minKeywordSimilarity: 0.08,
      summaryLines: ['未执行'],
    })
    expect(createEmptyRecallSnapshot('no_hits')).toMatchObject({
      retrievalUsed: false,
      degraded: true,
      fallbackReason: 'no_hits',
      sourceStats: {
        chapter: { hitCount: 0, selectedHitCount: 0, fallbackHitCount: 0 },
        semantic_asset: { hitCount: 0, selectedHitCount: 0, fallbackHitCount: 0 },
      },
    })
  })

  it('uses the strongest fallback reason and marks budget-trimmed selected recall', () => {
    expect(pickRecallFallbackReason([
      'no_hits',
      'budget_trimmed',
      'query_embedding_failed',
      'only_stale_hits',
    ])).toBe('query_embedding_failed')

    const snapshot = finalizeRecallSnapshot({
      ...createEmptyRecallSnapshot(),
      retrievalUsed: true,
      hitCount: 2,
      selectedHitCount: 1,
    }, '')
    expect(snapshot).toMatchObject({
      retrievalUsed: false,
      degraded: true,
      fallbackReason: 'budget_trimmed',
    })
  })

  it('deduplicates identical chapter sources before diagnostics and selection', () => {
    const hit = {
      chapterId: 1,
      chapterNum: 1,
      fragmentType: 'summary',
      fragmentText: '药箱仍在旧仓库。',
      similarity: 0.8,
      searchMode: 'vector' as const,
      bucket: 'thread' as const,
      stale: false,
      staleReasons: [],
      overriddenByConstraint: false,
      entityMatches: ['药箱'],
      entityValidationRequired: true,
      entityValidated: true,
    }
    const result = buildRecallSnapshot([{
      bucket: 'thread',
      hits: [hit, { ...hit }],
    }])

    expect(result.recallDiagnostics.totalHitCount).toBe(1)
    expect(result.recallDiagnostics.selectedHitCount).toBe(1)
    expect(result.recalledMemorySources).toHaveLength(1)
  })
})
