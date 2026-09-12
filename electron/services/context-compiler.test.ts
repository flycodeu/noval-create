import { describe, expect, it } from 'vitest'
import {
  buildChapterContextSources,
  compileChapterContextPack,
  resolveContextCompilerMode,
} from './context-compiler'
import type { ChapterContext, ChapterContextRawData } from './context.service'

function compilerFixture(contextVersion = 3) {
  const rawContext = {
    novel: { id: 7, contextVersion },
    currentChapter: { id: 12, chapterNum: 4 },
    authorStyleMaterials: { targetWorkSampleGuide: '短句', humanStyleSampleLock: '现场细节' },
  } as unknown as ChapterContextRawData
  const context = {
    contractVersionSummary: 'c1',
    hardConstraintEntries: [{ label: 'chapterGoal', content: '必须查账', allocatedTokens: 4 }],
    softContextDecisions: [{ label: 'characterStates', sourceKind: 'recent_summary', priority: 1, reason: 'budget_fit', allocatedTokens: 3, originalTokens: 3 }],
    characterStates: '角色在门口',
    contextBudgetReport: { availableContextBudget: 100, reservedForOutput: 20 },
  } as unknown as ChapterContext
  return { rawContext, context }
}

describe('context compiler source mapping', () => {
  it('11-07: maps hard constraints, allocated parts, artifacts, and author materials', () => {
    const { rawContext, context } = compilerFixture()
    const sources = buildChapterContextSources({ rawContext, context, stage: 'draft', upstreamArtifacts: { scenePlanSummary: '计划' } })
    expect(sources.map((source) => source.key)).toEqual(expect.arrayContaining(['hard:chapterGoal', 'part:characterStates', 'artifact:scenePlanSummary', 'authorStyle:guide']))
    expect(sources.find((source) => source.key === 'hard:chapterGoal')?.required).toBe(true)
    expect(sources.find((source) => source.key === 'artifact:scenePlanSummary')?.visibility).toBe('draft')
    expect(sources.every((source) => Number.isFinite(source.estimatedTokens))).toBe(true)
  })

  it('11-05/11-06/NF-20: defaults to legacy while explicit active remains opt-in and legacy restores a saved pack', async () => {
    const { rawContext, context } = compilerFixture()
    expect(resolveContextCompilerMode(undefined)).toBe('legacy')
    expect(resolveContextCompilerMode('active')).toBe('active')
    expect(resolveContextCompilerMode('shadow')).toBe('shadow')
    expect(resolveContextCompilerMode('legacy')).toBe('legacy')
    expect(resolveContextCompilerMode('invalid')).toBe('legacy')
    const first = await compileChapterContextPack({ rawContext, context, stage: 'draft', modelProfile: 'balanced', mode: 'active' })
    const changedContext = { ...context, characterStates: '当前数据库已变化' }
    const restored = await compileChapterContextPack({
      rawContext,
      context: changedContext,
      stage: 'draft',
      modelProfile: 'balanced',
      mode: 'legacy',
      restoredPack: first.pack,
    })
    expect(restored.pack).toEqual(first.pack)
    expect(restored.rendered).toContain('角色在门口')
    expect(restored.rendered).not.toContain('当前数据库已变化')
  })

  it('11-02/11-08: active mode refuses a restored pack from another context version', async () => {
    const original = compilerFixture(3)
    const first = await compileChapterContextPack({ ...original, stage: 'draft', modelProfile: 'balanced' })
    const changed = compilerFixture(4)
    await expect(compileChapterContextPack({
      ...changed,
      stage: 'draft',
      modelProfile: 'balanced',
      mode: 'active',
      restoredPack: first.pack,
    })).rejects.toMatchObject({ code: 'NF_CONTEXT_STALE' })
  })

  it('13-05: maps selected deterministic recall as one versioned ContextPack source', () => {
    const { rawContext, context } = compilerFixture()
    rawContext.recalledMemorySources = [{
      deterministic: true,
      sourceKey: 'asset:item:20',
      sourceVersion: 'v1:abc',
      required: true,
      reason: 'explicit_contract',
      optionalKind: 'item',
      dueChapter: null,
      sourceKind: 'semantic_asset',
      semanticSourceType: 'item',
      semanticSourceId: 20,
      bucket: 'character',
      fragmentType: 'contract_item',
      similarity: 1,
      searchMode: 'keyword',
      sourceLabel: '物品#20',
      summary: '合同物品：旧怀表',
      stale: false,
      staleReasons: [],
      overriddenByConstraint: false,
      entityMatches: [],
      entityValidated: true,
    }] as never
    context.recalledMemory = '以下内容仅作背景补充，不定义当前事实。\n[角色/关系召回·确定性·物品#20·contract_item] 合同物品：旧怀表'
    context.softContextDecisions.push({
      label: 'recalledMemory', sourceKind: 'recall', priority: 2, reason: 'budget_fit', allocatedTokens: 20, originalTokens: 20,
    } as never)

    const sources = buildChapterContextSources({ rawContext, context, stage: 'draft' })
    expect(sources.filter((source) => source.key === 'asset:item:20')).toEqual([expect.objectContaining({
      sourceVersion: 'v1:abc',
      required: true,
      sourceKind: 'relation_recall',
    })])
    expect(sources.some((source) => source.key === 'part:recalledMemory')).toBe(false)
  })

  it('13-06: keeps only per-source allowed recalls when the mixed recalledMemory text is rejected', () => {
    const { rawContext, context } = compilerFixture()
    const rejectedSource = {
      deterministic: true,
      sourceKey: 'contract:foreshadow:91',
      sourceVersion: 'v1:secret',
      required: true,
      reason: 'explicit_contract',
      optionalKind: 'contract',
      dueChapter: 20,
      sourceKind: 'semantic_asset',
      semanticSourceType: 'story_thread',
      semanticSourceId: 91,
      bucket: 'thread',
      fragmentType: 'contract_foreshadow',
      similarity: 1,
      searchMode: 'keyword',
      sourceLabel: '伏笔#91',
      summary: '未公开谜底',
      stale: false,
      staleReasons: [],
      overriddenByConstraint: false,
      entityMatches: [],
      entityValidated: true,
    } as const
    const allowedSource = {
      ...rejectedSource,
      sourceKey: 'asset:item:20',
      sourceVersion: 'v1:allowed',
      optionalKind: 'item',
      semanticSourceType: 'item',
      semanticSourceId: 20,
      fragmentType: 'contract_item',
      sourceLabel: '物品#20',
      summary: '合同物品：旧怀表',
    } as const
    rawContext.recalledMemorySources = [rejectedSource, allowedSource] as never
    context.recalledMemory = ''
    context.recalledMemorySources = [allowedSource] as never
    context.visibilityReport = {
      decisions: [{ sourceKey: 'part:recalledMemory', included: false }],
      sources: [],
    } as never

    const sources = buildChapterContextSources({ rawContext, context, stage: 'draft' })
    expect(sources.some((source) => source.key === 'contract:foreshadow:91')).toBe(false)
    expect(sources.filter((source) => source.key === 'asset:item:20')).toEqual([
      expect.objectContaining({ required: true, sourceVersion: 'v1:allowed' }),
    ])
  })
})
