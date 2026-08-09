import { describe, expect, it } from 'vitest'
import { estimateTokens } from './context-token-budget'
import {
  buildRecallQueryBuckets,
  enrichRecallHits,
  enrichSemanticRecallHits,
  resolveRecallValidationTerms,
  resolveSemanticSourceTypesForBucket,
  type RecallQueryBuildInput,
} from './context-recall-planner'

function buildInput(overrides: Partial<RecallQueryBuildInput> = {}): RecallQueryBuildInput {
  return {
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

describe('context recall planning', () => {
  it('builds bounded, bucket-specific queries with stable top-k limits', () => {
    const buckets = buildRecallQueryBuckets(buildInput({
      chapterGoal: '守住补给线'.repeat(100),
      worldRules: '夜间不得点火',
      activeThreads: '找回失踪药箱',
      mentionedCharacters: ['沈砚'],
      mentionedItems: ['药箱'],
      mentionedLocations: ['旧仓库'],
    }))

    expect(buckets.map(({ bucket, topK }) => ({ bucket, topK }))).toEqual([
      { bucket: 'character', topK: 4 },
      { bucket: 'rule', topK: 3 },
      { bucket: 'thread', topK: 4 },
    ])
    expect(buckets.every((bucket) => estimateTokens(bucket.query) <= 450)).toBe(true)
    expect(buckets[0]?.query).toContain('人物=沈砚')
    expect(buckets[1]?.query).toContain('夜间不得点火')
    expect(buckets[2]?.query).toContain('找回失踪药箱')
  })

  it('skips recall when no query bucket has usable content', () => {
    expect(buildRecallQueryBuckets(buildInput())).toEqual([])
  })

  it('orders and bounds validation terms by bucket', () => {
    const input = buildInput({
      mentionedCharacters: ['沈砚'],
      mentionedItems: ['药箱'],
      mentionedLocations: ['旧仓库'],
      mentionedFactions: ['巡防队'],
      mentionValidationCharacters: ['砚哥'],
      mentionValidationItems: ['急救箱'],
    })

    expect(resolveRecallValidationTerms('character', input)).toEqual(['沈砚', '砚哥', '巡防队'])
    expect(resolveRecallValidationTerms('rule', input)).toEqual([
      '旧仓库',
      '药箱',
      '急救箱',
      '沈砚',
      '砚哥',
      '巡防队',
    ])
    expect(resolveRecallValidationTerms('thread', input)).toEqual([
      '沈砚',
      '砚哥',
      '药箱',
      '急救箱',
      '旧仓库',
      '巡防队',
    ])
  })

  it('marks stale chapter facts and validates only matchable entity terms', () => {
    const [hit] = enrichRecallHits([{
      chapterId: 4,
      chapterNum: 4,
      fragmentType: 'summary',
      fragmentText: '沈砚把剑留在旧仓库。',
      similarity: 0.8,
      searchMode: 'vector',
    }], 'character', 6, new Map([['沈砚', 5]]), '沈砚当前已离开旧仓库', ['剑'])

    expect(hit).toMatchObject({
      stale: true,
      overriddenByConstraint: true,
      entityMatches: [],
      entityValidationRequired: false,
      entityValidated: true,
    })
    expect(hit?.staleReasons[0]).toContain('第5章后更新')
  })

  it('still rejects hits that miss a matchable validation term', () => {
    const [chapterHit] = enrichRecallHits([{
      chapterId: 2,
      chapterNum: 2,
      fragmentType: 'summary',
      fragmentText: '旧案仍未处理。',
      similarity: 0.7,
      searchMode: 'vector',
    }], 'thread', 6, new Map(), '', ['药箱'])
    const [semanticHit] = enrichSemanticRecallHits([{
      sourceType: 'item',
      sourceId: 9,
      fragmentKey: 'state',
      content: '物品仍在仓库。',
      entityRefs: [],
      similarity: 0.7,
      searchMode: 'vector',
    }], 'rule', ['药箱'])

    expect(chapterHit).toMatchObject({
      entityValidationRequired: true,
      entityValidated: false,
    })
    expect(semanticHit).toMatchObject({
      entityMatches: [],
      entityValidated: false,
    })
  })

  it('maps each query bucket to its structured semantic source types', () => {
    expect(resolveSemanticSourceTypesForBucket('character')).toEqual(['character'])
    expect(resolveSemanticSourceTypesForBucket('rule')).toEqual(['map', 'item'])
    expect(resolveSemanticSourceTypesForBucket('thread')).toEqual(['story_thread', 'timeline_event'])
  })
})
