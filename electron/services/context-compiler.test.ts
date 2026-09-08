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

  it('11-05/11-06: defaults to legacy and restores a saved pack without rebuilding changed source text', async () => {
    const { rawContext, context } = compilerFixture()
    expect(resolveContextCompilerMode(undefined)).toBe('legacy')
    const first = await compileChapterContextPack({ rawContext, context, stage: 'draft', modelProfile: 'balanced' })
    const changedContext = { ...context, characterStates: '当前数据库已变化' }
    const restored = await compileChapterContextPack({
      rawContext,
      context: changedContext,
      stage: 'draft',
      modelProfile: 'balanced',
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
})
