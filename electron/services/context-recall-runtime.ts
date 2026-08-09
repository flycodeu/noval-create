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

  if (recallBuckets.length === 0) {
    return {
      assemblyStage: 'recall',
      recalledMemory: '',
      recallSnapshot: createEmptyRecallSnapshot('no_hits'),
      recallDiagnostics: buildEmptyRecallDiagnostics([
        '当前章节没有形成可执行的召回查询桶，召回已跳过。',
      ]),
      recalledMemorySources: [],
    }
  }

  try {
    try {
      await processSemanticMemoryOutbox({ novelId: input.novelId, limit: 24 })
    } catch {
      // Dirty projections remain excluded until a later refresh succeeds.
    }

    const combinedResults = await Promise.all(recallBuckets.map(async (bucket) => {
      const validationTerms = resolveRecallValidationTerms(bucket.bucket, input)
      const [searchResult, semanticHits] = await Promise.all([
        searchSimilarFragments(
          input.novelId,
          bucket.query,
          bucket.topK,
          input.modelConfigId || undefined,
        ).catch(() => ({
          hits: [],
          fallbackReason: 'embedding_service_failed' as RecallFallbackReason,
        })),
        searchSemanticMemory(input.novelId, bucket.query, {
          topK: bucket.topK,
          modelConfigId: input.modelConfigId || undefined,
          chapterNum: input.chapterNum,
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
    const recallSnapshot = buildRecallSnapshot(
      combinedResults.map((result) => result.chapter),
      combinedResults.map((result) => result.semantic),
    )
    return {
      assemblyStage: 'recall',
      recalledMemory: recallSnapshot.recalledMemory,
      recallSnapshot: recallSnapshot.recallSnapshot,
      recallDiagnostics: recallSnapshot.recallDiagnostics,
      recalledMemorySources: recallSnapshot.recalledMemorySources,
    }
  } catch {
    return {
      assemblyStage: 'recall',
      recalledMemory: '',
      recallSnapshot: createEmptyRecallSnapshot('embedding_service_failed'),
      recallDiagnostics: buildEmptyRecallDiagnostics([
        '向量召回当前不可用，已自动降级，不影响硬约束与结构化状态注入。',
      ]),
      recalledMemorySources: [],
    }
  }
}
