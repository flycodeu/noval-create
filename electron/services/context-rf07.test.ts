import { describe, expect, it, vi } from 'vitest'
vi.mock('./prompt-override.service', () => ({ applyPromptOverride: (_key: string, fallback: string) => fallback, listPromptOverrides: () => [], getNarrativePromptSource: () => ({ source: 'built-in' }) }))
vi.mock('./chapter-narrative-policy', () => ({ assertChapterNarrativeInputCurrent: () => {} }))
import { buildContextVisibilityPolicy, projectPreviousChapterSources, type ContextVisibilityFact } from './context-visibility'
import { selectOriginalSources, renderOriginalSources } from './context-token-budget'
import { estimateTokens } from '../../src/shared/token-budget'
import { estimateRequestBudget } from './request-budget'
import { createChapterStagePrepareInput } from './chapter-pipeline-context'
import { buildChapterWriterMessages } from './chapter-pipeline-writer'
import { compileChapterContextPack } from './context-compiler'
import { reconcilePreviousChapterSampleReport, type ChapterContext, type ChapterContextRawData } from './context.service'
import { buildNarrativeInputIdentity, resolveNarrativePolicy } from '../../src/shared/narrative-policy'

const key = '她把铜钥匙交给沈宁，说：“明天从北门走，锁芯只能转半圈。”'
const ending = '沈宁攥住钥匙，站在门边。'
const original = ['院里的雨水涨过台阶。'.repeat(60), key, '远处的狗吠声慢慢低下去。'.repeat(60), ending].join('\n\n')
const chapter = { id: 81, chapterNum: 1, content: original }
function fixture(selected = selectOriginalSources(projectPreviousChapterSources(chapter, undefined, '锁芯只能转半圈'), 10000, original)) {
  return {
    previousChapterContext: selected.text, lastChapterEnding: '', chapterGoal: '沈宁去开北门', hardConstraintContext: '硬合同：钥匙没有复制品。',
    hardConstraintEntries: [], softContextDecisions: [], recalledMemorySources: [], writingContractSummary: '',
    contextBudgetReport: { availableContextBudget: 12000, reservedForOutput: 400 },
    previousChapterSampleReport: reconcilePreviousChapterSampleReport({ sourceChapterId: 81, sourceChapterNum: 1,
      sourceChapterChars: original.length, sources: selected.sources, sampledChars: 0, coverageRate: 0, segmentCount: 0, fullyInjected: false, segments: [] }, selected.text),
  } as unknown as ChapterContext
}
function messages(context: ChapterContext) {
  return buildChapterWriterMessages({ novelTitle: '原创夹具', genre: '悬疑', chapterNum: 2, chapterTitle: '北门', emotionTone: '', targetWords: 1000,
    storyCore: '', context, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '', scenePlanText: '沈宁去开北门。', runtimeAssertions: [],
    narrativeFields: {} as never, guidance: {} as never, protagonistReference: '沈宁', protagonistRule: '', promptTier: 'standard' })
}

describe('RF-07 original evidence and final request', () => {
  it('RF-07-01 keeps full prose beyond 1000 characters, including middle dialogue, in real Writer messages', () => {
    const context = fixture()
    expect(original.length).toBeGreaterThan(1000)
    expect(messages(context)[0].content).toContain(original)
    expect(context.previousChapterSampleReport.fullyInjected).toBe(true)
    expect(context.previousChapterSampleReport.sources?.every((source) => source.start !== undefined && source.artifactHash)).toBe(true)
  })
  it('RF-07-02 selects complete required action and ending, reports omissions, and fails an impossible budget', () => {
    const sources = projectPreviousChapterSources(chapter, undefined, '锁芯只能转半圈')
    const budget = estimateTokens(key + '\n\n' + ending)
    const selected = selectOriginalSources(sources, budget, original)
    expect(selected.overflow).toBe(false)
    expect(selected.text).toBe(key + '\n\n' + ending)
    expect(selected.sources.filter((source) => !source.included).every((source) => source.reason === 'budget_insufficient')).toBe(true)
    expect(selectOriginalSources(sources, budget - 1, original).overflow).toBe(true)
    expect(messages(fixture(selected))[0].content).toContain(key)
    const itemDependency = projectPreviousChapterSources(chapter, undefined, '', ['铜钥匙'])
    expect(itemDependency.find((source) => source.text === key)?.required).toBe(true)
  })
  it('refuses a final prompt that silently omits required original evidence', () => {
    const input = [{ role: 'user' as const, content: '覆盖模板漏掉了所有上章原文。' }]
    expect(() => createChapterStagePrepareInput(fixture(), 'draft')({ messages: input,
      budgetReport: estimateRequestBudget({ messages: input, maxTokens: 400, modelContextTokens: 10000 }),
    })).toThrow('最终请求缺少上章关键依据')
  })
  it('RF-07-03 separates reader truth, POV experience, literal suspicion and future chapters', () => {
    const known = { fact: { id: 1, title: '铜钥匙', summary: '' }, projection: { readerKnownChapterNum: 1, protagonistKnownChapterNum: 1, characterKnowledge: [] } } as unknown as ContextVisibilityFact
    const secret = { fact: { id: 2, title: '真正凶手是管家', summary: '' }, projection: { readerKnownChapterNum: 1, protagonistKnownChapterNum: null, characterKnowledge: [] } } as unknown as ContextVisibilityFact
    const policyInput = { novelId: 1, chapterNum: 2, purpose: 'writer' as const, facts: [known, secret],
      characters: [{ id: 3, fullName: '沈宁', isProtagonist: true }], scenes: [{ id: 4, order: 1, pov: '沈宁', status: 'locked', revealPayload: [] }] }
    const past = { ...chapter, content: '沈宁怀疑铜钥匙被换过，他还不能肯定。\n\n另一处，读者看见真正凶手是管家。\n\n未分类的别处密谈。' }
    const writer = projectPreviousChapterSources(past, buildContextVisibilityPolicy(policyInput), '')
    expect(renderOriginalSources(writer)).toContain('怀疑铜钥匙被换过，他还不能肯定')
    expect(renderOriginalSources(writer)).not.toContain('真正凶手是管家')
    expect(JSON.stringify(writer)).not.toContain('真正凶手是管家')
    expect(writer.find((source) => source.reason === 'unclassified_visibility')?.included).toBe(false)
    const review = projectPreviousChapterSources(past, buildContextVisibilityPolicy({ ...policyInput, purpose: 'review' }), '')
    expect(renderOriginalSources(review)).toContain('真正凶手是管家')
    expect(review.every((source) => source.knowledgeLayer === 'reader_known')).toBe(true)
    const future = projectPreviousChapterSources({ ...past, chapterNum: 3 }, buildContextVisibilityPolicy(policyInput), '')
    expect(renderOriginalSources(future)).toBe('')
  })
  it.each(['legacy', 'shadow', 'active'] as const)('RF-07-04 %s reports actual mode and final sample/source omissions after appended rules', async (mode) => {
    const context = fixture()
    context.narrativeIdentity = buildNarrativeInputIdentity({ policy: resolveNarrativePolicy('{"readerFirst":{"schemaVersion":1,"policyVersion":"reader-first-v1","revision":1}}', true), styleSource: 'fixture', inputSource: 'fixture', models: 'fixture', overrides: [], compilerMode: mode })
    context.authorStyleMaterials = { targetWorkSampleGuide: '', humanStyleSampleLock: '', approvedSample: { text: '她把碗放回桌上。'.repeat(20), source: 'fixture-style', digest: 'fixture' } }
    const rawContext = { novel: { id: 1, contextVersion: 1 }, currentChapter: { id: 2, chapterNum: 2 }, recalledMemorySources: [] } as unknown as ChapterContextRawData
    context.contextPack = (await compileChapterContextPack({ context, rawContext, stage: 'draft', mode })).pack
    const input = messages(context)
    input[0].content += '\n最终追加规则：请保持人物视角。'.repeat(10)
    const before = estimateRequestBudget({ messages: input, systemPrompt: '系统包装', maxTokens: 400, modelContextTokens: 10000 })
    const stageBudget = before.estimatedTotalTokens - 250
    const prepared = createChapterStagePrepareInput(context, 'draft')({ messages: input, systemPrompt: '系统包装', budgetReport: estimateRequestBudget({ messages: input, systemPrompt: '系统包装', maxTokens: 400, modelContextTokens: 10000, stageBudget }) })
    const after = estimateRequestBudget({ messages: prepared.messages, systemPrompt: '系统包装', maxTokens: 400, modelContextTokens: 10000, stageBudget })
    expect(after.allowed).toBe(true)
    expect(prepared.diagnostics?.contextCompilerMode).toBe(mode)
    expect(prepared.diagnostics?.finalBudget).toEqual(after)
    expect(prepared.diagnostics?.authorStyleSamples).toEqual([expect.objectContaining({ included: false })])
    expect(prepared.diagnostics?.previousChapterSampleReport).toMatchObject({ fullyInjected: false })
    expect(prepared.messages[0].content).toContain(key)
    expect(prepared.messages[0].content).toContain('硬合同：钥匙没有复制品')
    expect(prepared.messages[0].content).toContain('最终追加规则')
    expect(context.previousChapterSampleReport.fullyInjected).toBe(true) // immutable allocation snapshot
  })
})
