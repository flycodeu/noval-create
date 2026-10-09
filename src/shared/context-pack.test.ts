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

  it('11-01/11-04: keeps reproducible order and stage-specific identity', async () => {
    const first = await compileContextPack(input)
    const second = await compileContextPack(input)
    expect(first.pack.id).toBe(second.pack.id)
    expect(first.pack.sources.map((source) => source.key)).toEqual(second.pack.sources.map((source) => source.key))
    const review = await compileContextPack({ ...input, stage: 'review' })
    expect(review.pack.id).not.toBe(first.pack.id)
  })

  it('selects optional sources by priority while rendering them in their original positions', async () => {
    const result = await compileContextPack({
      ...input,
      budget: 5,
      sources: [
        { key: 'z:previous-prose', text: '前章现场', estimatedTokens: 2, selectionPriority: 100 },
        { key: 'a:author-sample', text: '作者样稿', estimatedTokens: 2, selectionPriority: 10 },
        { key: 'rules', text: '不能提前揭示真相', estimatedTokens: 3, required: true },
      ],
    })
    expect(result.diagnostics.droppedOptional).toEqual(['a:author-sample'])
    expect(result.pack.sources.filter(source => source.included).map(source => source.key)).toEqual(['z:previous-prose', 'rules'])
    expect(result.rendered).toBe('[canon] z:previous-prose: 前章现场\n[canon] rules: 不能提前揭示真相')
  })

  it('retains legacy optional budget selection when priorities are omitted or tied', async () => {
    const sources = [
      { key: 'z', text: '先提供的资料', estimatedTokens: 2 },
      { key: 'a', text: '旧策略优先资料', estimatedTokens: 2 },
    ]
    for (const candidates of [sources, sources.map(source => ({ ...source, selectionPriority: 0 }))]) {
      const result = await compileContextPack({ ...input, budget: 2, sources: candidates })
      expect(result.pack.sources.filter(source => source.included).map(source => source.key)).toEqual(['a'])
      expect(result.diagnostics.droppedOptional).toEqual(['z'])
    }
  })

  it('renders chapter prose by numeric offsets even when the ending is required and keys sort differently', async () => {
    const sources = [
      { key: 'chapter:9:100', start: 100, end: 140, text: '发现血迹', selectionPriority: 50 },
      { key: 'chapter:9:200', start: 200, end: 240, text: '决定留下查证', required: true },
      { key: 'chapter:9:20', start: 20, end: 60, text: '客人进门', selectionPriority: 100 },
    ].map(source => ({ ...source, sourceKind: 'chapter_original', sourceId: '9', estimatedTokens: 2 }))
    const result = await compileContextPack({ ...input, budget: 6, sources })
    expect(result.pack.sources.map(source => source.start)).toEqual([20, 100, 200])
    expect(result.rendered.split('\n').map(line => line.slice(line.lastIndexOf(': ') + 2))).toEqual(['客人进门', '发现血迹', '决定留下查证'])
    const reversed = await compileContextPack({ ...input, budget: 6, sources: [...sources].reverse() })
    expect(reversed.pack.inputHash).toBe(result.pack.inputHash)
    expect(reversed.pack.id).toBe(result.pack.id)
    const tight = await compileContextPack({ ...input, budget: 4, sources })
    expect(tight.pack.sources.filter(source => source.included).map(source => source.start)).toEqual([20, 200])
  })

  it('keeps source kinds and IDs separate and does not move untimed author paragraphs', async () => {
    const result = await compileContextPack({
      ...input,
      budget: 100,
      sources: [
        { key: 'z:author', text: '作者先交代一件事' },
        { key: 'a:late', text: '甲后段', sourceKind: 'chapter_original', sourceId: '1', start: 100 },
        { key: 'a:other-kind', text: '历史召回', sourceKind: 'recalled_chapter_original', sourceId: '1', start: 0 },
        { key: 'a:author', text: '作者再补充一件事' },
        { key: 'a:other-id', text: '乙段落', sourceKind: 'chapter_original', sourceId: '2', start: 0 },
        { key: 'z:early', text: '甲前段', sourceKind: 'chapter_original', sourceId: '1', start: 20 },
      ],
    })
    expect(result.pack.sources.map(source => source.text)).toEqual([
      '作者先交代一件事', '甲前段', '历史召回', '作者再补充一件事', '乙段落', '甲后段',
    ])
  })

  it('hashes rendering order and selection priority even when every source fits', async () => {
    const sources = [
      { key: 'z:author', text: '先说原因', estimatedTokens: 1 },
      { key: 'a:author', text: '再说结果', estimatedTokens: 1 },
    ]
    const baseline = await compileContextPack({ ...input, sources })
    const reordered = await compileContextPack({ ...input, sources: [...sources].reverse() })
    const prioritized = await compileContextPack({ ...input, sources: sources.map(source => ({ ...source, selectionPriority: 5 })) })
    expect(baseline.pack.sources.map(source => source.text)).toEqual(['先说原因', '再说结果'])
    expect(reordered.pack.inputHash).not.toBe(baseline.pack.inputHash)
    expect(reordered.pack.id).not.toBe(baseline.pack.id)
    expect(prioritized.pack.inputHash).not.toBe(baseline.pack.inputHash)
    expect(prioritized.pack.id).not.toBe(baseline.pack.id)
    expect(deserializeContextPack(serializeContextPack(prioritized.pack))).toEqual(prioritized.pack)
  })

  it('preserves whole required sources and reports overflow regardless of optional priority', async () => {
    const result = await compileContextPack({
      ...input,
      budget: 2,
      sources: [
        { key: 'optional', text: '额外装饰', estimatedTokens: 1, selectionPriority: 1000 },
        { key: 'required:second', text: '完整的第二条约束', estimatedTokens: 3, required: true },
        { key: 'required:first', text: '完整的第一条约束', estimatedTokens: 3, required: true, selectionPriority: -100 },
      ],
    })
    expect(result.diagnostics.requiredOverflow).toBe(true)
    expect(result.diagnostics.requiredTokens).toBe(6)
    expect(result.pack.sources.filter(source => source.included).map(source => source.text)).toEqual(['完整的第二条约束', '完整的第一条约束'])
    expect(result.diagnostics.droppedOptional).toEqual(['optional'])
  })

  it.each([NaN, Infinity, -Infinity])('rejects invalid selection priority %s instead of unstable selection or hashing', async (selectionPriority) => {
    await expect(compileContextPack({ ...input, sources: [{ text: '资料', selectionPriority }] })).rejects.toMatchObject({ code: 'NF_CONTEXT_PACK_INVALID' })
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
