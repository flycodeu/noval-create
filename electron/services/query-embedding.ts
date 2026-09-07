import { createHash } from 'node:crypto'
export interface PreparedQueryEmbedding {
  queryHash: string
  profile: string
  dimensions: number
  embedding: number[]
}

/** 查询规范只去掉首尾空白，不改变大小写、标点或语义内容。 */
export function normalizeQueryText(query: string): string {
  return query.trim()
}

/** hash 的输入必须与实际送入 embedding 的文本完全一致。 */
export function hashQueryText(query: string): string {
  const normalized = normalizeQueryText(query)
  return `sha256:${createHash('sha256').update(normalized, 'utf8').digest('hex')}`
}

export function isCompatiblePreparedQuery(
  queryText: string,
  preparedQuery: PreparedQueryEmbedding,
): boolean {
  return preparedQuery.queryHash === hashQueryText(queryText)
    && typeof preparedQuery.profile === 'string'
    && preparedQuery.profile.length > 0
    && Number.isInteger(preparedQuery.dimensions)
    && preparedQuery.dimensions > 0
    && Array.isArray(preparedQuery.embedding)
    && preparedQuery.embedding.length === preparedQuery.dimensions
    && preparedQuery.embedding.length > 0
    && preparedQuery.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
}

function isValidBatchMetadata(
  profile: string | undefined,
  dimensions: number | undefined,
): profile is string {
  return typeof profile === 'string'
    && profile.length > 0
    && typeof dimensions === 'number'
    && Number.isInteger(dimensions)
    && dimensions > 0
}

/**
 * 为同一轮召回准备一次性的查询向量。返回空 Map 表示该批次不可用，
 * 调用方应把它转换成 preparedQuery=null 并走关键词降级。
 */
export async function prepareQueryEmbeddings(
  queries: string[],
  modelConfigId?: number,
): Promise<Map<string, PreparedQueryEmbedding>> {
  const uniqueQueries = new Map<string, string>()
  for (const query of queries) {
    const normalized = normalizeQueryText(query)
    if (!normalized) continue
    const queryHash = hashQueryText(normalized)
    if (!uniqueQueries.has(queryHash)) uniqueQueries.set(queryHash, normalized)
  }

  if (uniqueQueries.size === 0) return new Map()

  let batch
  let areUsableEmbeddings: typeof import('./embedding.service').areUsableEmbeddings
  try {
    // 延迟加载可避免 embedding.service 复用本文件的校验规则时形成初始化环。
    const embeddingService = await import('./embedding.service')
    areUsableEmbeddings = embeddingService.areUsableEmbeddings
    const { embedSemanticTexts } = embeddingService
    batch = await embedSemanticTexts([...uniqueQueries.values()], modelConfigId)
  } catch {
    return new Map()
  }

  if (!batch.embeddings || !isValidBatchMetadata(batch.profile, batch.dimensions)) return new Map()
  if (!areUsableEmbeddings(batch.embeddings, uniqueQueries.size)) return new Map()
  if (batch.embeddings.some((embedding) => embedding.length !== batch.dimensions)) return new Map()

  const prepared = new Map<string, PreparedQueryEmbedding>()
  const entries = [...uniqueQueries.entries()]
  entries.forEach(([queryHash], index) => {
    prepared.set(queryHash, {
      queryHash,
      profile: batch.profile!,
      dimensions: batch.dimensions!,
      embedding: batch.embeddings![index],
    })
  })
  return prepared
}
