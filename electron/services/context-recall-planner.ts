import type { SemanticMemorySourceType } from '../../src/shared/semantic-memory'
import type { SimilarFragmentHit } from './embedding.service'
import type { SemanticMemorySearchHit } from './semantic-memory.service'
import {
  compactRecallLine,
  splitRecallLines,
  type RecallBucketKey,
  type RecallHit,
  type SemanticRecallHit,
} from './context-recall-core'
import { truncateToTokens } from './context-token-budget'

export interface RecallQueryBucket {
  bucket: RecallBucketKey
  query: string
  topK: number
}

export interface RecallQueryBuildInput {
  chapterGoal: string
  outline: string
  arcGoal: string
  arcSummary: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  themeVoiceSummary: string
  worldRules: string
  mapSummary?: string
  relationSummary: string
  characterStates: string
  worldStates?: string
  itemSummary: string
  timelineSummary: string
  timelineOpenThreads: string
  activeThreads: string
  openLoops: string
  dueForeshadows: string
  continuityNotes: string
  chapterBridgePlan: string
  storyThreadsSummary: string
  mentionedCharacters: string[]
  mentionedItems: string[]
  mentionedLocations: string[]
  mentionedFactions?: string[]
  mentionValidationCharacters?: string[]
  mentionValidationItems?: string[]
  mentionValidationLocations?: string[]
  mentionValidationFactions?: string[]
}

type RecallValidationInput = Pick<
  RecallQueryBuildInput,
  | 'mentionedCharacters'
  | 'mentionedItems'
  | 'mentionedLocations'
  | 'mentionedFactions'
  | 'mentionValidationCharacters'
  | 'mentionValidationItems'
  | 'mentionValidationLocations'
  | 'mentionValidationFactions'
>

function dedupe(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function buildRecallQueryText(
  title: string,
  sections: Array<{ title: string; lines: string[] }>,
  maxTokens = 450,
): string {
  const content = sections
    .filter((section) => section.lines.length > 0)
    .flatMap((section) => [
      `${section.title}：`,
      ...section.lines.map((line) => `- ${line}`),
    ])
    .join('\n')
  if (!content) return ''
  return truncateToTokens(`${title}\n${content}`, maxTokens)
}

export function buildRecallQueryBuckets(input: RecallQueryBuildInput): RecallQueryBucket[] {
  const characterQuery = buildRecallQueryText('角色关系召回', [
    {
      title: '本章任务',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        ...splitRecallLines(input.outline, 3, 84),
        compactRecallLine(input.arcGoal, 80),
      ], 4),
    },
    {
      title: '当前涉及实体',
      lines: dedupe([
        input.mentionedCharacters.length > 0 ? `人物=${input.mentionedCharacters.join('、')}` : '',
        input.mentionedItems.length > 0 ? `物品=${input.mentionedItems.join('、')}` : '',
        input.mentionedLocations.length > 0 ? `地点=${input.mentionedLocations.join('、')}` : '',
        input.mentionedFactions && input.mentionedFactions.length > 0 ? `势力=${input.mentionedFactions.join('、')}` : '',
      ], 4),
    },
    {
      title: '关系冲突',
      lines: splitRecallLines(input.relationSummary, 4, 96),
    },
    {
      title: '人物状态',
      lines: splitRecallLines(input.characterStates, 4, 96),
    },
  ])

  const ruleQuery = buildRecallQueryText('规则主题召回', [
    {
      title: '本章任务',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        compactRecallLine(input.arcGoal, 80),
        compactRecallLine(input.arcSummary, 84),
      ], 3),
    },
    {
      title: '主线与主题',
      lines: dedupe([
        compactRecallLine(input.storyGoal, 80),
        compactRecallLine(input.coreConflict, 80),
        compactRecallLine(input.mainPlot, 84),
        ...splitRecallLines(input.themeVoiceSummary, 3, 84),
      ], 5),
    },
    {
      title: '世界规则与边界',
      lines: dedupe([
        ...splitRecallLines(input.worldRules, 5, 96),
        ...splitRecallLines(input.mapSummary || '', 3, 96),
      ], 6),
    },
    {
      title: '时序与物品约束',
      lines: dedupe([
        ...splitRecallLines(input.timelineSummary, 2, 90),
        ...splitRecallLines(input.itemSummary, 2, 90),
      ], 4),
    },
  ])

  const threadQuery = buildRecallQueryText('线程伏笔召回', [
    {
      title: '本章与故事弧',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        compactRecallLine(input.arcGoal, 80),
        compactRecallLine(input.arcSummary, 84),
        ...splitRecallLines(input.chapterBridgePlan, 2, 84),
      ], 5),
    },
    {
      title: '活跃线程',
      lines: dedupe([
        ...splitRecallLines(input.activeThreads, 4, 96),
        ...splitRecallLines(input.storyThreadsSummary, 3, 96),
      ], 6),
    },
    {
      title: '待回收事项',
      lines: dedupe([
        ...splitRecallLines(input.chapterBridgePlan, 2, 90),
        ...splitRecallLines(input.openLoops, 4, 90),
        ...splitRecallLines(input.dueForeshadows, 3, 90),
        ...splitRecallLines(input.timelineOpenThreads, 3, 90),
        ...splitRecallLines(input.continuityNotes, 3, 90),
      ], 6),
    },
  ])

  return [
    characterQuery ? { bucket: 'character' as const, query: characterQuery, topK: 4 } : null,
    ruleQuery ? { bucket: 'rule' as const, query: ruleQuery, topK: 3 } : null,
    threadQuery ? { bucket: 'thread' as const, query: threadQuery, topK: 4 } : null,
  ].filter((bucket): bucket is RecallQueryBucket => Boolean(bucket))
}

export function resolveRecallValidationTerms(
  bucket: RecallBucketKey,
  input: RecallValidationInput,
): string[] {
  const characterTerms = dedupe([
    ...input.mentionedCharacters,
    ...(input.mentionValidationCharacters || []),
  ], 12)
  const itemTerms = dedupe([
    ...input.mentionedItems,
    ...(input.mentionValidationItems || []),
  ], 12)
  const locationTerms = dedupe([
    ...input.mentionedLocations,
    ...(input.mentionValidationLocations || []),
  ], 12)
  const factionTerms = dedupe([
    ...(input.mentionedFactions || []),
    ...(input.mentionValidationFactions || []),
  ], 12)

  switch (bucket) {
    case 'character':
      return dedupe([...characterTerms, ...factionTerms], 12)
    case 'rule':
      return dedupe([...locationTerms, ...itemTerms, ...characterTerms, ...factionTerms], 14)
    case 'thread':
    default:
      return dedupe([...characterTerms, ...itemTerms, ...locationTerms, ...factionTerms], 16)
  }
}

function resolveMatchableValidationTerms(validationTerms: string[]): string[] {
  return dedupe(validationTerms.filter((term) => term.length >= 2))
}

export function enrichRecallHits(
  hits: SimilarFragmentHit[],
  bucket: RecallBucketKey,
  currentChapterNum: number,
  entityFreshnessMap: Map<string, number>,
  constraintText: string,
  validationTerms: string[] = [],
): RecallHit[] {
  const candidateNames = [...entityFreshnessMap.keys()].sort((left, right) => right.length - left.length)
  const matchableValidationTerms = resolveMatchableValidationTerms(validationTerms)

  return hits.map((hit) => {
    const staleReasons: string[] = []
    const matchedNames = candidateNames.filter((name) => hit.fragmentText.includes(name)).slice(0, 4)
    matchedNames.forEach((name) => {
      const freshnessChapterNum = entityFreshnessMap.get(name) || 0
      if (freshnessChapterNum > 0 && freshnessChapterNum > hit.chapterNum) {
        staleReasons.push(`${name} 已在第${freshnessChapterNum}章后更新，旧片段不可直接当作当前事实`)
      }
    })
    if (bucket !== 'thread' && hit.chapterNum >= currentChapterNum) {
      staleReasons.push(`命中片段来自第${hit.chapterNum}章，不应反向作为当前章之前的历史依据`)
    }
    const overriddenByConstraint = matchedNames.length > 0
      && matchedNames.some((name) => constraintText.includes(name))
      && staleReasons.length > 0
    const entityMatches = matchableValidationTerms
      .filter((term) => hit.fragmentText.includes(term))
      .slice(0, 4)
    const entityValidationRequired = matchableValidationTerms.length > 0

    return {
      ...hit,
      bucket,
      stale: staleReasons.length > 0,
      staleReasons: dedupe(staleReasons, 4),
      overriddenByConstraint,
      entityMatches,
      entityValidationRequired,
      entityValidated: !entityValidationRequired || entityMatches.length > 0,
    }
  })
}

export function resolveSemanticSourceTypesForBucket(
  bucket: RecallBucketKey,
): SemanticMemorySourceType[] {
  if (bucket === 'character') return ['character']
  if (bucket === 'rule') return ['map', 'item']
  return ['story_thread', 'timeline_event']
}

export function enrichSemanticRecallHits(
  hits: SemanticMemorySearchHit[],
  bucket: RecallBucketKey,
  validationTerms: string[] = [],
): SemanticRecallHit[] {
  const matchableValidationTerms = resolveMatchableValidationTerms(validationTerms)
  return hits.map((hit) => {
    const searchableText = [hit.content, ...hit.entityRefs].join('\n')
    const entityMatches = matchableValidationTerms
      .filter((term) => searchableText.includes(term))
      .slice(0, 4)
    return {
      ...hit,
      bucket,
      stale: false,
      staleReasons: [],
      overriddenByConstraint: false,
      entityMatches,
      entityValidated: matchableValidationTerms.length === 0 || entityMatches.length > 0,
    }
  })
}
