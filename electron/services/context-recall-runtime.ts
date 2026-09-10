import { searchSimilarFragments } from './embedding.service'
import {
  processSemanticMemoryOutbox,
  searchSemanticMemory,
} from './semantic-memory.service'
import {
  buildEmptyRecallDiagnostics,
  buildRecallSnapshot,
  createEmptyRecallSnapshot,
  type RecallDiagnostics,
  type RecallFallbackReason,
  type RecallMemorySource,
  type RecallSnapshot,
} from './context-recall-core'
import {
  buildRecallQueryBuckets,
  enrichRecallHits,
  enrichSemanticRecallHits,
  resolveRecallValidationTerms,
  resolveSemanticSourceTypesForBucket,
  type RecallQueryBuildInput,
} from './context-recall-planner'
import { hashQueryText, prepareQueryEmbeddings } from './query-embedding'
import { getSqlite } from '../database/db'
import {
  loadRelationRecallSources,
  resolveRelationRecallInput,
  type DeterministicRecallSource,
  type RelationRecallDiagnostic,
} from './relation-recall'

export interface RecallAugmentationResult {
  assemblyStage: 'recall'
  recalledMemory: string
  recallSnapshot: RecallSnapshot
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
}

export interface RunRecallAugmentationInput extends RecallQueryBuildInput {
  novelId: number
  chapterNum: number
  modelConfigId?: number | null
  entityFreshnessMap: Map<string, number>
  constraintText: string
}

export async function runRecallAugmentation(
  input: RunRecallAugmentationInput,
): Promise<RecallAugmentationResult> {
  const recallBuckets = buildRecallQueryBuckets(input)
  let deterministicSources: DeterministicRecallSource[] = []
  let relationDiagnostics: RelationRecallDiagnostic[] = []
  try {
    const sqlite = getSqlite()
    const resolved = resolveRelationRecallInput(sqlite, {
      novelId: input.novelId,
      chapterNum: input.chapterNum,
      mentionedCharacters: input.mentionedCharacters,
      mentionedItems: input.mentionedItems,
    })
    const relationRecall = loadRelationRecallSources(sqlite, {
      novelId: input.novelId,
      chapterNum: input.chapterNum,
      seedEntityIds: resolved.seedEntityIds,
      explicitContractRefs: resolved.explicitContractRefs,
    })
    deterministicSources = relationRecall.sources
    relationDiagnostics = [...resolved.diagnostics, ...relationRecall.diagnostics]
  } catch {
    relationDiagnostics = [{ code: 'unresolved_reference', reference: 'relation_recall_unavailable' }]
  }

  const appendRelationDiagnostics = (snapshot: ReturnType<typeof buildRecallSnapshot>) => ({
    ...snapshot,
    recallDiagnostics: {
      ...snapshot.recallDiagnostics,
      summaryLines: [
        ...snapshot.recallDiagnostics.summaryLines,
        deterministicSources.length > 0
          ? `确定性关系召回注入 ${deterministicSources.length} 条版本化来源。`
          : '当前没有可注入的确定性关系来源。',
        relationDiagnostics.length > 0
          ? `确定性关系召回拒绝 ${relationDiagnostics.length} 条越界、歧义或超限候选。`
          : '确定性关系召回未发现越界或歧义候选。',
        ...relationDiagnostics.slice(0, 6).map((diagnostic) => (
          `确定性召回排除 ${diagnostic.code}：${diagnostic.reference}`
        )),
      ],
    },
  })

  if (recallBuckets.length === 0) {
    const deterministicSnapshot = appendRelationDiagnostics(buildRecallSnapshot([], [], deterministicSources))
    return {
      assemblyStage: 'recall',
      recalledMemory: deterministicSnapshot.recalledMemory,
      recallSnapshot: deterministicSources.length > 0
        ? deterministicSnapshot.recallSnapshot
        : createEmptyRecallSnapshot('no_hits'),
      recallDiagnostics: deterministicSources.length > 0
        ? deterministicSnapshot.recallDiagnostics
        : buildEmptyRecallDiagnostics([
            '当前章节没有形成可执行的召回查询桶，召回已跳过。',
            ...deterministicSnapshot.recallDiagnostics.summaryLines.slice(-2),
          ]),
      recalledMemorySources: deterministicSnapshot.recalledMemorySources,
    }
  }

  try {
    const preparedQueries = await prepareQueryEmbeddings(
      recallBuckets.map((bucket) => bucket.query),
      input.modelConfigId || undefined,
    )

    try {
      await processSemanticMemoryOutbox({ novelId: input.novelId, limit: 24 })
    } catch {
      // Dirty projections remain excluded until a later refresh succeeds.
    }

    const combinedResults = await Promise.all(recallBuckets.map(async (bucket) => {
      const validationTerms = resolveRecallValidationTerms(bucket.bucket, input)
      const preparedQuery = preparedQueries.get(hashQueryText(bucket.query)) || null
      const [searchResult, semanticHits] = await Promise.all([
        searchSimilarFragments(
          input.novelId,
          bucket.query,
          bucket.topK,
          input.modelConfigId || undefined,
          { beforeChapterNum: input.chapterNum, preparedQuery },
        ).catch(() => ({
          hits: [],
          fallbackReason: 'embedding_service_failed' as RecallFallbackReason,
        })),
        searchSemanticMemory(input.novelId, bucket.query, {
          topK: bucket.topK,
          modelConfigId: input.modelConfigId || undefined,
          chapterNum: input.chapterNum,
          preparedQuery,
          sourceTypes: resolveSemanticSourceTypesForBucket(bucket.bucket),
          visibility: 'canon',
          refreshOutbox: false,
        }).catch(() => []),
      ])

      return {
        chapter: {
          bucket: bucket.bucket,
          fallbackReason: searchResult.fallbackReason,
          hits: enrichRecallHits(
            searchResult.hits.filter((hit) => hit.chapterNum < input.chapterNum),
            bucket.bucket,
            input.chapterNum,
            input.entityFreshnessMap,
            input.constraintText,
            validationTerms,
          ),
        },
        semantic: {
          bucket: bucket.bucket,
          hits: enrichSemanticRecallHits(semanticHits, bucket.bucket, validationTerms),
        },
      }
    }))
    const recallSnapshot = appendRelationDiagnostics(buildRecallSnapshot(
      combinedResults.map((result) => result.chapter),
      combinedResults.map((result) => result.semantic),
      deterministicSources,
    ))
    return {
      assemblyStage: 'recall',
      recalledMemory: recallSnapshot.recalledMemory,
      recallSnapshot: recallSnapshot.recallSnapshot,
      recallDiagnostics: recallSnapshot.recallDiagnostics,
      recalledMemorySources: recallSnapshot.recalledMemorySources,
    }
  } catch {
    const deterministicSnapshot = appendRelationDiagnostics(buildRecallSnapshot([], [], deterministicSources))
    return {
      assemblyStage: 'recall',
      recalledMemory: deterministicSnapshot.recalledMemory,
      recallSnapshot: {
        ...(deterministicSources.length > 0 ? deterministicSnapshot.recallSnapshot : createEmptyRecallSnapshot()),
        degraded: true,
        fallbackReason: 'embedding_service_failed',
      },
      recallDiagnostics: {
        ...(deterministicSources.length > 0
          ? deterministicSnapshot.recallDiagnostics
          : buildEmptyRecallDiagnostics()),
        summaryLines: [
          '向量召回当前不可用，已自动降级，不影响硬约束、结构化状态与确定性关系来源注入。',
          ...deterministicSnapshot.recallDiagnostics.summaryLines.slice(-2),
        ],
      },
      recalledMemorySources: deterministicSnapshot.recalledMemorySources,
    }
  }
}
