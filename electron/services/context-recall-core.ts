import type {
  RecallBucketKey,
  RecallBucketStats,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallMemorySource,
  RecallSearchMode,
  RecallSnapshot,
} from '../../src/types'
import type { SemanticMemorySourceType } from '../../src/shared/semantic-memory'
import type { SimilarFragmentHit } from './embedding.service'
import type { SemanticMemorySearchHit } from './semantic-memory.service'

export type {
  RecallBucketKey,
  RecallBucketStats,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallMemorySource,
  RecallSearchMode,
  RecallSnapshot,
} from '../../src/types'

export const MIN_VECTOR_RECALL_SIMILARITY = 0.6
export const PREFERRED_VECTOR_RECALL_SIMILARITY = 0.72
export const MIN_KEYWORD_RECALL_SIMILARITY = 0.08
export const PREFERRED_KEYWORD_RECALL_SIMILARITY = 0.16

export interface RecallHit extends SimilarFragmentHit {
  bucket: RecallBucketKey
  stale: boolean
  staleReasons: string[]
  overriddenByConstraint: boolean
  entityMatches: string[]
  entityValidationRequired: boolean
  entityValidated: boolean
}

export interface SemanticRecallHit extends SemanticMemorySearchHit {
  bucket: RecallBucketKey
  stale: boolean
  staleReasons: string[]
  overriddenByConstraint: boolean
  entityMatches: string[]
  entityValidated: boolean
}

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

function resolveRecallMinimumSimilarity(searchMode: RecallSearchMode): number {
  return searchMode === 'vector' ? MIN_VECTOR_RECALL_SIMILARITY : MIN_KEYWORD_RECALL_SIMILARITY
}

function resolveRecallPreferredSimilarity(searchMode: RecallSearchMode): number {
  return searchMode === 'vector' ? PREFERRED_VECTOR_RECALL_SIMILARITY : PREFERRED_KEYWORD_RECALL_SIMILARITY
}

function summarizeRecallHit(hit: RecallHit): string {
  const lines = hit.fragmentText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => compactRecallLine(line, 96))
    .filter(Boolean)

  if (lines.length === 0) return ''
  if (hit.fragmentType !== 'continuity') {
    return compactRecallLine(lines.slice(0, 2).join('；'), 110)
  }

  const preferredPrefixes = hit.bucket === 'character'
    ? ['人物变化：', '剧情推进：', '承接提醒：']
    : hit.bucket === 'rule'
      ? ['世界变化：', '承接提醒：', '剧情推进：', '故事弧推进：']
      : ['未回收事项：', '承接提醒：', '故事弧推进：', '剧情推进：']

  const preferred = lines.filter((line) => preferredPrefixes.some((prefix) => line.startsWith(prefix)))
  return compactRecallLine((preferred.length > 0 ? preferred : lines).slice(0, 2).join('；'), 110)
}

function formatRecalledMemory(sources: RecallMemorySource[]): string {
  const labels: Record<RecallBucketKey, string> = {
    character: '角色/关系召回',
    rule: '规则/主题召回',
    thread: '线程/伏笔召回',
  }
  const selectedSources = sources
    .filter((source) => isAcceptedRecallSource(source))
    .slice(0, 6)
  if (selectedSources.length === 0) return ''

  const lines = ['以下内容仅作背景补充，不定义当前事实。']
  selectedSources.forEach((source) => {
    const origin = source.sourceKind === 'chapter'
      ? `第${source.chapterNum}章`
      : source.sourceLabel
    lines.push(`[${labels[source.bucket]}·${origin}·${source.fragmentType}] ${source.summary}`)
  })
  return lines.join('\n')
}

function buildRecallMemorySource(
  bucket: RecallBucketKey,
  hit: RecallHit,
  summary: string,
): RecallMemorySource {
  return {
    sourceKind: 'chapter',
    bucket,
    chapterId: hit.chapterId,
    chapterNum: hit.chapterNum,
    fragmentType: hit.fragmentType,
    similarity: hit.similarity,
    searchMode: hit.searchMode,
    sourceLabel: `第${hit.chapterNum}章 · ${hit.fragmentType}`,
    summary,
    stale: hit.stale,
    staleReasons: hit.staleReasons,
    overriddenByConstraint: hit.overriddenByConstraint,
    entityMatches: hit.entityMatches,
    entityValidated: hit.entityValidated,
  }
}

function getSemanticMemorySourceLabel(sourceType: SemanticMemorySourceType, sourceId: number): string {
  const labels: Partial<Record<SemanticMemorySourceType, string>> = {
    character: '人物',
    map: '地图',
    item: '物品',
    story_thread: '故事线程',
    timeline_event: '时间轴事件',
  }
  return `${labels[sourceType] || sourceType}#${sourceId}`
}

function buildSemanticRecallMemorySource(hit: SemanticRecallHit): RecallMemorySource {
  return {
    sourceKind: 'semantic_asset',
    bucket: hit.bucket,
    semanticSourceType: hit.sourceType,
    semanticSourceId: hit.sourceId,
    fragmentType: hit.fragmentKey,
    similarity: hit.similarity,
    searchMode: hit.searchMode,
    sourceLabel: getSemanticMemorySourceLabel(hit.sourceType, hit.sourceId),
    summary: compactRecallLine(hit.content, 110),
    stale: hit.stale,
    staleReasons: hit.staleReasons,
    overriddenByConstraint: hit.overriddenByConstraint,
    entityMatches: hit.entityMatches,
    entityValidated: hit.entityValidated,
  }
}

function getRecallSourceKey(source: RecallMemorySource): string {
  return source.sourceKind === 'chapter'
    ? `chapter:${source.bucket}:${source.chapterId}:${source.fragmentType}:${source.summary}`
    : `semantic:${source.bucket}:${source.semanticSourceType}:${source.semanticSourceId}:${source.fragmentType}:${source.summary}`
}

export function compactRecallLine(text: string, maxLength = 96): string {
  const safeMaxLength = Math.max(0, Math.floor(maxLength))
  if (safeMaxLength === 0) return ''
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\s*\n+\s*/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  if (normalized.length <= safeMaxLength) return normalized
  if (safeMaxLength === 1) return '…'
  return `${normalized.slice(0, safeMaxLength - 1).trim()}…`
}

export function splitRecallLines(text: string, maxLines = 4, maxLength = 96): string[] {
  if (!text) return []
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => compactRecallLine(line, maxLength))
    .filter(Boolean)
  if (lines.length > 0) return dedupe(lines, maxLines)
  return dedupe([compactRecallLine(text, maxLength)].filter(Boolean), maxLines)
}

export function containsAny(text: string, keywords: string[]): boolean {
  const normalized = typeof text === 'string' ? text.trim() : ''
  return normalized ? keywords.some((keyword) => normalized.includes(keyword)) : false
}

export function isAcceptedRecallSource(
  source: Pick<RecallMemorySource, 'stale' | 'overriddenByConstraint' | 'entityValidated' | 'similarity' | 'searchMode'>,
): boolean {
  return !source.stale
    && !source.overriddenByConstraint
    && source.entityValidated
    && source.similarity >= resolveRecallMinimumSimilarity(source.searchMode)
}

export function buildEmptyRecallDiagnostics(summaryLines: string[] = []): RecallDiagnostics {
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
    minVectorSimilarity: MIN_VECTOR_RECALL_SIMILARITY,
    minKeywordSimilarity: MIN_KEYWORD_RECALL_SIMILARITY,
    summaryLines,
  }
}

export function createEmptyRecallBucketStats(): Record<RecallBucketKey, RecallBucketStats> {
  return {
    character: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
    rule: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
    thread: { hitCount: 0, selectedHitCount: 0, staleCount: 0, fallbackHitCount: 0 },
  }
}

export function createEmptyRecallSnapshot(fallbackReason?: RecallFallbackReason): RecallSnapshot {
  return {
    retrievalUsed: false,
    degraded: Boolean(fallbackReason),
    hitCount: 0,
    selectedHitCount: 0,
    staleRecallCount: 0,
    fallbackHitCount: 0,
    fallbackReason,
    assemblyStage: 'base_recall',
    bucketStats: createEmptyRecallBucketStats(),
    sourceStats: {
      chapter: { hitCount: 0, selectedHitCount: 0, fallbackHitCount: 0 },
      semantic_asset: { hitCount: 0, selectedHitCount: 0, fallbackHitCount: 0 },
    },
  }
}

export function pickRecallFallbackReason(
  reasons: Array<RecallFallbackReason | undefined>,
): RecallFallbackReason | undefined {
  const rank: Record<RecallFallbackReason, number> = {
    embedding_service_failed: 6,
    query_embedding_failed: 5,
    embedding_profile_mismatch: 5,
    disabled_by_config: 4,
    budget_trimmed: 3,
    only_stale_hits: 2,
    no_hits: 1,
  }
  return reasons
    .filter((reason): reason is RecallFallbackReason => Boolean(reason))
    .sort((left, right) => rank[right] - rank[left])[0]
}

export function buildRecallSnapshot(
  bucketResults: Array<{ bucket: RecallBucketKey; hits: RecallHit[]; fallbackReason?: RecallFallbackReason }>,
  semanticBucketResults: Array<{ bucket: RecallBucketKey; hits: SemanticRecallHit[] }> = [],
): {
  recalledMemory: string
  recalledMemorySources: RecallMemorySource[]
  recallDiagnostics: RecallDiagnostics
  recallSnapshot: RecallSnapshot
} {
  const sources: RecallMemorySource[] = []
  const selectedSources: RecallMemorySource[] = []
  const bucketStats = createEmptyRecallBucketStats()
  let selectedBucketCount = 0
  let lowSimilarityRejectedCount = 0
  let entityValidationRejectedCount = 0

  bucketResults.forEach((result) => {
    result.hits.forEach((hit) => {
      const summary = summarizeRecallHit(hit)
      if (summary) sources.push(buildRecallMemorySource(result.bucket, hit, summary))
    })
  })
  semanticBucketResults.forEach((result) => {
    result.hits.forEach((hit) => {
      const source = buildSemanticRecallMemorySource(hit)
      if (source.summary) sources.push(source)
    })
  })

  const dedupedSources = [...new Map(sources.map((source) => [getRecallSourceKey(source), source] as const)).values()]
  sources.splice(0, sources.length, ...dedupedSources)

  ;(['character', 'rule', 'thread'] as RecallBucketKey[]).forEach((bucket) => {
    const bucketSources = sources
      .filter((source) => source.bucket === bucket)
      .sort((left, right) => right.similarity - left.similarity)
    const eligible = bucketSources.filter((source) => {
      if (source.stale || source.overriddenByConstraint) return false
      if (source.similarity < resolveRecallMinimumSimilarity(source.searchMode)) {
        lowSimilarityRejectedCount += 1
        return false
      }
      if (!source.entityValidated) {
        entityValidationRejectedCount += 1
        return false
      }
      return true
    })
    const significant = eligible.filter((source) =>
      source.similarity >= resolveRecallPreferredSimilarity(source.searchMode))
    const fallback = eligible.filter((source) =>
      source.similarity >= resolveRecallMinimumSimilarity(source.searchMode))
    const selected = significant.length > 0 ? significant.slice(0, 2) : fallback.slice(0, 1)
    const chapterResult = bucketResults.find((result) => result.bucket === bucket)
    bucketStats[bucket] = {
      hitCount: bucketSources.length,
      selectedHitCount: selected.length,
      staleCount: bucketSources.filter((source) => source.stale).length,
      fallbackHitCount: bucketSources.filter((source) => source.searchMode === 'keyword').length,
      fallbackReason: chapterResult?.fallbackReason,
    }
    if (selected.length > 0) selectedBucketCount += 1
    selectedSources.push(...selected)
  })

  const searchedBucketCount = new Set([
    ...bucketResults.map((result) => result.bucket),
    ...semanticBucketResults.map((result) => result.bucket),
  ]).size
  const totalHitCount = sources.length
  const validatedHitCount = sources.filter((source) => source.entityValidated).length
  const selectedHitCount = selectedSources.length
  const staleRecallCount = sources.filter((source) => source.stale).length
  const overriddenHitCount = sources.filter((source) => source.overriddenByConstraint).length
  const fallbackHitCount = sources.filter((source) => source.searchMode === 'keyword').length
  const chapterSourceHitCount = sources.filter((source) => source.sourceKind === 'chapter').length
  const semanticAssetHitCount = sources.filter((source) => source.sourceKind === 'semantic_asset').length
  const selectedChapterSourceCount = selectedSources.filter((source) => source.sourceKind === 'chapter').length
  const selectedSemanticAssetCount = selectedSources.filter((source) => source.sourceKind === 'semantic_asset').length
  const staleRecallRate = totalHitCount > 0 ? Math.round((staleRecallCount / totalHitCount) * 100) : 0
  const recallDependencyRate = totalHitCount > 0 ? Math.round((selectedHitCount / totalHitCount) * 100) : 0
  const recalledMemory = formatRecalledMemory(selectedSources)
  const fallbackReason = pickRecallFallbackReason([
    ...bucketResults.map((result) => result.fallbackReason),
    selectedHitCount === 0 && staleRecallCount > 0 ? 'only_stale_hits' : undefined,
    totalHitCount === 0 ? 'no_hits' : undefined,
  ])
  const recallDiagnostics: RecallDiagnostics = {
    searchedBucketCount,
    selectedBucketCount,
    totalHitCount,
    selectedHitCount,
    staleRecallCount,
    staleRecallRate,
    recallDependencyRate,
    overriddenHitCount,
    fallbackHitCount,
    validatedHitCount,
    lowSimilarityRejectedCount,
    entityValidationRejectedCount,
    chapterSourceHitCount,
    semanticAssetHitCount,
    selectedChapterSourceCount,
    selectedSemanticAssetCount,
    minVectorSimilarity: MIN_VECTOR_RECALL_SIMILARITY,
    minKeywordSimilarity: MIN_KEYWORD_RECALL_SIMILARITY,
    summaryLines: [
      '向量召回只作背景补充，当前事实以硬约束和结构化状态为准。',
      searchedBucketCount > 0
        ? `召回覆盖 ${selectedBucketCount}/${searchedBucketCount} 个查询桶，补充片段 ${selectedHitCount} 条。`
        : '当前章节没有可用的召回查询桶。',
      `来源构成：章节片段 ${chapterSourceHitCount} 条，结构化语义资产 ${semanticAssetHitCount} 条。`,
      `最低相似度门槛：向量 ${MIN_VECTOR_RECALL_SIMILARITY.toFixed(2)} / 关键词 ${MIN_KEYWORD_RECALL_SIMILARITY.toFixed(2)}。`,
      staleRecallCount > 0
        ? `拦截过期召回 ${staleRecallCount} 条，过期召回率 ${staleRecallRate}%。`
        : '最近召回片段未命中过期状态。',
      entityValidationRejectedCount > 0
        ? `有 ${entityValidationRejectedCount} 条命中未覆盖当前章实体信号，已排除出背景补充。`
        : `当前实体校验通过 ${validatedHitCount} 条历史片段。`,
      lowSimilarityRejectedCount > 0
        ? `有 ${lowSimilarityRejectedCount} 条低相似度命中低于门槛，已直接丢弃。`
        : '当前没有低于门槛的低质量命中进入召回结果。',
      overriddenHitCount > 0
        ? `${overriddenHitCount} 条片段已被硬约束覆盖，不再参与当前事实定义。`
        : '当前没有片段被硬约束直接覆盖。',
    ].filter(Boolean),
  }
  const recallSnapshot: RecallSnapshot = {
    retrievalUsed: Boolean(recalledMemory.trim()),
    degraded: Boolean(fallbackReason),
    hitCount: totalHitCount,
    selectedHitCount,
    staleRecallCount,
    fallbackHitCount,
    fallbackReason,
    assemblyStage: 'base_recall',
    bucketStats,
    sourceStats: {
      chapter: {
        hitCount: chapterSourceHitCount,
        selectedHitCount: selectedChapterSourceCount,
        fallbackHitCount: sources.filter((source) =>
          source.sourceKind === 'chapter' && source.searchMode === 'keyword').length,
      },
      semantic_asset: {
        hitCount: semanticAssetHitCount,
        selectedHitCount: selectedSemanticAssetCount,
        fallbackHitCount: sources.filter((source) =>
          source.sourceKind === 'semantic_asset' && source.searchMode === 'keyword').length,
      },
    },
  }
  return {
    recalledMemory,
    recalledMemorySources: sources,
    recallDiagnostics,
    recallSnapshot,
  }
}

export function finalizeRecallSnapshot(snapshot: RecallSnapshot, recalledMemory: string): RecallSnapshot {
  if (!snapshot.retrievalUsed) return snapshot
  if (recalledMemory.trim()) return snapshot
  return {
    ...snapshot,
    retrievalUsed: false,
    degraded: true,
    fallbackReason: 'budget_trimmed',
  }
}
