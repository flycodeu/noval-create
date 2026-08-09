import { eq } from 'drizzle-orm'
import type {
  RecallDiagnostics,
  RecallFallbackReason,
  RecallSnapshot,
} from '../../src/types'
import { getDb } from '../database/db'
import {
  characters,
  characterStateVersions,
  worldStateVersions,
} from '../database/schema'
import { fallbackKeywordSearch } from './embedding.service'

export interface RecallFreshnessState {
  entityUpdateMap: Map<string, number[]>
  candidateNames: string[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10
}

export function buildRecallFreshnessState(novelId: number): RecallFreshnessState {
  const db = getDb()
  const entityUpdateMap = new Map<string, number[]>()
  const characterNameById = new Map(
    db.select({
      id: characters.id,
      fullName: characters.fullName,
    }).from(characters)
      .where(eq(characters.novelId, novelId))
      .all()
      .map((row) => [row.id, asText(row.fullName)] as const),
  )

  db.select().from(characterStateVersions)
    .where(eq(characterStateVersions.novelId, novelId))
    .all()
    .forEach((row) => {
      const name = characterNameById.get(row.characterId)
      if (!name) return
      entityUpdateMap.set(name, [...(entityUpdateMap.get(name) || []), row.chapterNum])
    })

  db.select().from(worldStateVersions)
    .where(eq(worldStateVersions.novelId, novelId))
    .all()
    .forEach((row) => {
      const name = asText(row.entityName)
      if (!name) return
      entityUpdateMap.set(name, [...(entityUpdateMap.get(name) || []), row.chapterNum])
    })

  entityUpdateMap.forEach((chapterNums, name) => {
    entityUpdateMap.set(name, dedupeNumbers(chapterNums))
  })

  return {
    entityUpdateMap,
    candidateNames: [...entityUpdateMap.keys()].sort((left, right) => right.length - left.length),
  }
}

function buildRecallQueryTextForDiagnostics(chapter: {
  title?: string | null
  summary?: string | null
  outline?: string | null
}): string {
  return [asText(chapter.title), asText(chapter.summary), asText(chapter.outline)]
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function buildHeuristicRecallDiagnostics(
  novelId: number,
  chapter: {
    chapterNum: number
    title?: string | null
    summary?: string | null
    outline?: string | null
  },
  freshnessState?: RecallFreshnessState,
): RecallDiagnostics {
  const state = freshnessState || buildRecallFreshnessState(novelId)
  const queryText = buildRecallQueryTextForDiagnostics(chapter)
  if (!queryText) {
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
      chapterSourceHitCount: 0,
      semanticAssetHitCount: 0,
      selectedChapterSourceCount: 0,
      selectedSemanticAssetCount: 0,
      minVectorSimilarity: 0.18,
      minKeywordSimilarity: 0.04,
      summaryLines: ['当前章节缺少可用于召回的标题、摘要或大纲信号。'],
    }
  }

  const hits = fallbackKeywordSearch(novelId, queryText, 4)
    .filter((hit) => hit.chapterNum > 0 && hit.chapterNum < chapter.chapterNum)
  const sources = hits.map((hit) => {
    const staleReasons: string[] = []
    state.candidateNames
      .filter((name) => hit.fragmentText.includes(name))
      .slice(0, 4)
      .forEach((name) => {
        const chapterNums = state.entityUpdateMap.get(name) || []
        const hasIntermediateUpdate = chapterNums.some((num) => num > hit.chapterNum && num < chapter.chapterNum)
        if (hasIntermediateUpdate) {
          const latestBeforeChapter = chapterNums.filter((num) => num < chapter.chapterNum).at(-1) || 0
          staleReasons.push(`${name} 在第${latestBeforeChapter}章前已有更新，旧片段疑似过期`)
        }
      })
    return {
      stale: staleReasons.length > 0,
      summary: `${hit.fragmentType} · 第${hit.chapterNum}章`,
      staleReasons,
    }
  })
  const selectedHitCount = sources.filter((source) => !source.stale).slice(0, 2).length
  const staleRecallCount = sources.filter((source) => source.stale).length
  const totalHitCount = sources.length
  const staleRecallRate = totalHitCount > 0 ? Math.round((staleRecallCount / totalHitCount) * 100) : 0
  const recallDependencyRate = totalHitCount > 0 ? Math.round((selectedHitCount / totalHitCount) * 100) : 0

  return {
    searchedBucketCount: queryText ? 1 : 0,
    selectedBucketCount: selectedHitCount > 0 ? 1 : 0,
    totalHitCount,
    selectedHitCount,
    staleRecallCount,
    staleRecallRate,
    recallDependencyRate,
    overriddenHitCount: 0,
    fallbackHitCount: totalHitCount,
    validatedHitCount: selectedHitCount,
    lowSimilarityRejectedCount: 0,
    entityValidationRejectedCount: 0,
    chapterSourceHitCount: totalHitCount,
    semanticAssetHitCount: 0,
    selectedChapterSourceCount: selectedHitCount,
    selectedSemanticAssetCount: 0,
    minVectorSimilarity: 0.18,
    minKeywordSimilarity: 0.04,
    summaryLines: [
      '诊断页中的召回可靠性使用本地关键词回查估算，不改变生成链路里的硬约束优先级。',
      totalHitCount > 0
        ? `命中历史片段 ${totalHitCount} 条，可继续作为背景补充 ${selectedHitCount} 条。`
        : '当前没有命中可用的历史片段。',
      staleRecallCount > 0
        ? `识别到 ${staleRecallCount} 条疑似过期片段，过期率 ${staleRecallRate}%。`
        : '当前未识别到疑似过期的历史片段。',
    ],
  }
}

export function buildRecallBucketCoverageRate(snapshot?: RecallSnapshot): number {
  if (!snapshot) return 0
  const buckets = Object.values(snapshot.bucketStats || {})
  if (buckets.length === 0) return 0
  const covered = buckets.filter((bucket) => bucket.hitCount > 0).length
  return roundMetric((covered / buckets.length) * 100)
}

export function sumRecallDiagnosticMetric(
  entries: Array<{ diagnostics: RecallDiagnostics }>,
  key: 'validatedHitCount' | 'lowSimilarityRejectedCount' | 'entityValidationRejectedCount',
): number {
  return entries.reduce((sum, entry) => sum + entry.diagnostics[key], 0)
}

export function resolveRecallDiagnosticThreshold(
  entries: Array<{ diagnostics: RecallDiagnostics }>,
  key: 'minVectorSimilarity' | 'minKeywordSimilarity',
): number {
  if (entries.length === 0) return 0
  return roundMetric(entries.reduce(
    (min, entry) => Math.min(min, entry.diagnostics[key]),
    entries[0].diagnostics[key],
  ))
}

export function pickLatestRecallFallbackReason(
  snapshots: Array<RecallSnapshot | undefined>,
): RecallFallbackReason | undefined {
  return snapshots
    .map((snapshot) => snapshot?.fallbackReason)
    .find((reason): reason is RecallFallbackReason => Boolean(reason))
}

export function getConsecutiveRecallFallbackCount(entries: Array<{ snapshot?: RecallSnapshot }>): number {
  let count = 0
  for (const entry of entries) {
    if (!entry.snapshot?.degraded) break
    count += 1
  }
  return count
}

export function formatRecallFallbackReason(reason?: RecallFallbackReason): string {
  switch (reason) {
    case 'embedding_service_failed':
      return '嵌入服务失败'
    case 'query_embedding_failed':
      return '查询向量失败'
    case 'embedding_profile_mismatch':
      return '向量模型空间不匹配'
    case 'disabled_by_config':
      return '向量能力未启用'
    case 'budget_trimmed':
      return '召回被预算裁剪'
    case 'only_stale_hits':
      return '仅命中过期片段'
    case 'no_hits':
      return '没有命中历史片段'
    default:
      return '未记录'
  }
}
