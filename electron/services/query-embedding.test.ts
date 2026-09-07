import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./embedding.service', () => ({
  embedSemanticTexts: vi.fn(),
  areUsableEmbeddings: (embeddings: unknown, expectedCount: number) => {
    if (!Array.isArray(embeddings) || embeddings.length !== expectedCount) return false
    if (!embeddings.every((embedding) => Array.isArray(embedding)
      && embedding.length > 0
      && embedding.every((value) => typeof value === 'number' && Number.isFinite(value)))) return false
    const dimensions = (embeddings[0] as unknown[]).length
    return embeddings.every((embedding) => (embedding as unknown[]).length === dimensions)
  },
}))

import { embedSemanticTexts } from './embedding.service'
import {
  hashQueryText,
  normalizeQueryText,
  prepareQueryEmbeddings,
} from './query-embedding'

describe('query embedding preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('trims only the query and hashes the exact embedding input', () => {
    expect(normalizeQueryText('  角色关系  ')).toBe('角色关系')
    expect(normalizeQueryText('角色关系  ')).toBe('角色关系')
    expect(hashQueryText('  角色关系  ')).toBe(hashQueryText('角色关系'))
    expect(hashQueryText('OpenAI')).not.toBe(hashQueryText('openai'))
  })

  it('deduplicates normalized queries before one batch embedding call', async () => {
    vi.mocked(embedSemanticTexts).mockResolvedValue({
      source: 'remote',
      embeddings: [[0.1, 0.2], [0.3, 0.4]],
      modelId: 'stub-model',
      dimensions: 2,
      profile: 'stub-model:2',
    })

    const prepared = await prepareQueryEmbeddings(['  角色关系  ', '规则冲突', '角色关系'], 7)

    expect(embedSemanticTexts).toHaveBeenCalledTimes(1)
    expect(embedSemanticTexts).toHaveBeenCalledWith(['角色关系', '规则冲突'], 7)
    expect([...prepared.keys()]).toEqual([hashQueryText('角色关系'), hashQueryText('规则冲突')])
    expect(prepared.get(hashQueryText('角色关系'))).toEqual({
      queryHash: hashQueryText('角色关系'),
      profile: 'stub-model:2',
      dimensions: 2,
      embedding: [0.1, 0.2],
    })
  })

  it('skips empty queries without making an embedding request', async () => {
    const prepared = await prepareQueryEmbeddings([' ', '\t\n'], 7)
    expect(prepared.size).toBe(0)
    expect(embedSemanticTexts).not.toHaveBeenCalled()
  })

  it('returns an empty map for a failed or unusable whole batch', async () => {
    vi.mocked(embedSemanticTexts).mockRejectedValueOnce(new Error('offline'))
    await expect(prepareQueryEmbeddings(['角色关系'], 7)).resolves.toEqual(new Map())

    vi.mocked(embedSemanticTexts).mockResolvedValueOnce({
      source: 'remote',
      embeddings: [[Number.NaN, 0.2]],
      modelId: 'stub-model',
      dimensions: 2,
      profile: 'stub-model:2',
    })
    await expect(prepareQueryEmbeddings(['角色关系'], 7)).resolves.toEqual(new Map())
  })

  it('does not accept missing profile, dimensions, or mismatched batch size', async () => {
    vi.mocked(embedSemanticTexts).mockResolvedValueOnce({
      source: 'remote',
      embeddings: [[0.1, 0.2]],
      modelId: 'stub-model',
      dimensions: 2,
    })
    await expect(prepareQueryEmbeddings(['角色关系'], 7)).resolves.toEqual(new Map())

    vi.mocked(embedSemanticTexts).mockResolvedValueOnce({
      source: 'remote',
      embeddings: [[0.1, 0.2]],
      modelId: 'stub-model',
      dimensions: 2,
      profile: 'stub-model:2',
    })
    await expect(prepareQueryEmbeddings(['角色关系', '规则冲突'], 7)).resolves.toEqual(new Map())
  })
})
