import { describe, expect, it, vi } from 'vitest'
import {
  compileContextPack,
  deserializeContextPack,
  renderContextPack,
  serializeContextPack,
} from './context-pack'

describe('context pack', () => {
  const input = {
    novelId: 7,
    chapterId: 3,
    chapterNum: 3,
    stage: 'draft' as const,
    contextVersion: 2,
    contractVersion: 'c1',
    modelProfile: 'balanced',
    budget: 20,
    sources: [
      { key: 'part:characterStates', sourceKind: 'state', sourceId: 'characterStates', sourceVersion: '2', visibility: 'canon' as const, text: '角色状态', required: true },
      { key: 'part:memory', sourceKind: 'memory', sourceId: 'memory', sourceVersion: '2', visibility: 'draft' as const, text: '记忆片段', required: false },
      { key: 'part:memory', sourceKind: 'memory', sourceId: 'memory', sourceVersion: '2', visibility: 'draft' as const, text: '重复记忆', required: false },
    ],
  }

  it('11-01/11-04: keeps stable order and stage-specific identity', async () => {
    const first = await compileContextPack(input)
    const second = await compileContextPack({ ...input, sources: [...input.sources].reverse() })
    expect(first.pack.id).toBe(second.pack.id)
    expect(first.pack.sources.map((source) => source.key)).toEqual(second.pack.sources.map((source) => source.key))
    const review = await compileContextPack({ ...input, stage: 'review' })
    expect(review.pack.id).not.toBe(first.pack.id)
  })

  it('11-02: changes identity when source content or contract changes', async () => {
    const baseline = await compileContextPack(input)
    expect((await compileContextPack({ ...input, contractVersion: 'c2' })).pack.id).not.toBe(baseline.pack.id)
    expect((await compileContextPack({ ...input, templateVersion: 'prompt-v2' })).pack.id).not.toBe(baseline.pack.id)
    expect((await compileContextPack({ ...input, sources: [{ ...input.sources[0], text: '新状态' }, ...input.sources.slice(1)] })).pack.id).not.toBe(baseline.pack.id)
  })

  it('rejects invalid chapter identity instead of inventing chapter zero or one', async () => {
    await expect(compileContextPack({ ...input, chapterId: null })).rejects.toMatchObject({
      code: 'NF_CONTEXT_PACK_INVALID',
    })
    await expect(compileContextPack({ ...input, stage: 'planning', chapterId: null, chapterNum: null })).resolves.toBeTruthy()
    await expect(compileContextPack({ ...input, stage: 'planning', chapterId: 3, chapterNum: 3 })).rejects.toMatchObject({
      code: 'NF_CONTEXT_PACK_INVALID',
    })
  })

  it('11-03/11-08: records dedupe and preserves required overflow', async () => {
    const result = await compileContextPack({ ...input, budget: 1 })
    expect(result.diagnostics.deduped).toContain('part:memory')
    expect(result.diagnostics.requiredOverflow).toBe(true)
    expect(result.pack.sources.filter((source) => source.included)).toHaveLength(1)
  })

  it('keeps a visibility-rejected source redacted and excluded', async () => {
    const result = await compileContextPack({
      ...input,
      sources: [{
        key: 'storyFact:9', sourceKind: 'story_fact', sourceId: '9', sourceVersion: '1',
        visibility: 'canon', text: '[redacted fact:9]', required: false, included: false,
        reason: 'knowledge_boundary_denied', estimatedTokens: 2,
      }],
    })
    expect(result.rendered).toBe('')
    expect(result.pack.sources[0]).toMatchObject({ included: false, reason: 'knowledge_boundary_denied' })
  })

  it('11-05: loader is the only optional dependency and rendering is deterministic', async () => {
    const loader = vi.fn(() => input.sources)
    const result = await compileContextPack({ ...input, sources: [] }, { loadSources: loader })
    expect(loader).toHaveBeenCalledTimes(1)
    expect(renderContextPack(result.pack)).toContain('角色状态')
  })

  it('11-06: serializes and restores without recomputing', async () => {
    const pack = (await compileContextPack(input)).pack
    expect(deserializeContextPack(serializeContextPack(pack))).toEqual(pack)
  })
})
