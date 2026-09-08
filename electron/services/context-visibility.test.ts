import { describe, expect, it, vi } from 'vitest'

vi.mock('./prompt-override.service', () => ({
  applyPromptOverride: (_key: string, fallback: string) => fallback,
}))
import { compileContextPack } from '../../src/shared/context-pack'
import { buildChapterWriterMessages } from './chapter-pipeline-writer'
import type { ChapterContext } from './context.service'
import {
  buildContextVisibilityPolicy,
  filterChapterContextByVisibility,
  type ContextVisibilityFact,
  type ContextVisibilityPolicyInput,
} from './context-visibility'

function fact(
  id: number,
  title: string,
  projection: ContextVisibilityFact['projection'],
  novelId = 1,
): ContextVisibilityFact {
  return {
    fact: {
      id, novelId, title, summary: `${title}的完整内容`, kind: 'clue',
      readerKnownChapterId: null, protagonistKnownChapterId: null,
      characterKnowledgeJson: null, forbiddenBeforeVolume: null, targetRevealChapterId: null,
    },
    projection,
  }
}

const emptyProjection = { readerKnownChapterNum: null, protagonistKnownChapterNum: null, characterKnowledge: [] }

function input(overrides: Partial<ContextVisibilityPolicyInput> = {}): ContextVisibilityPolicyInput {
  return {
    novelId: 1,
    chapterNum: 20,
    purpose: 'writer',
    characters: [{ id: 7, fullName: '沈砚青', isProtagonist: true }],
    scenes: [{ id: 201, order: 1, pov: '沈砚青', status: 'locked', revealPayload: [] }],
    facts: [],
    ...overrides,
  }
}

function context(overrides: Partial<ChapterContext> = {}): ChapterContext {
  return {
    storyCore: '', currentArc: '', worldRules: '', characterStates: '', worldStates: '', mapSummary: '', itemSummary: '',
    previousSummaries: '', previousChapterContext: '', lastChapterEnding: '', chapterBridgePlan: '', styleTemplate: '',
    chapterGoal: '继续查账', continuitySummary: '', openLoops: '', dueForeshadows: '', continuityNotes: '',
    timelineSummary: '', timelineOpenThreads: '', longTermMemory: '', activeThreads: '',
    writingContractSummary: '按场景合同执行', relationSummary: '', dialogueVoiceLocks: '', recalledMemory: '',
    scenePlanSummary: '', draftTextSummary: '', contractVersionSummary: 'c1', reviewRiskSummary: '', reviewProofSummary: '',
    rewriteDeltaSummary: '', publishGateRiskSummary: '', stepMemorySummary: '', antiAiRules: '', styleHardGuard: '',
    antiAiRulesSoft: '', styleHardGuardSoft: '', hardConstraintContext: '', hardConstraintSummary: '', hardConstraintEntries: [],
    constraintInjectionStatus: {} as never, softContextBudgetUsage: {} as never,
    contextBudgetReport: { availableContextBudget: 1000, reservedForOutput: 100 } as never,
    droppedConstraintCount: 0, previousChapterSampleReport: {} as never, softContextDecisions: [],
    recallSnapshot: {} as never, recallDiagnostics: {} as never, recalledMemorySources: [],
    ...overrides,
  }
}

function writerMessage(filtered: ChapterContext): string {
  return buildChapterWriterMessages({
    novelTitle: '测试小说', genre: '悬疑', chapterNum: 20, chapterTitle: '账房', emotionTone: '紧张', targetWords: 2000,
    storyCore: '', context: filtered, themeChapterTest: '', consistencyNotes: '', structuralAlertsSummary: '',
    scenePlanText: '场景1：查账', runtimeAssertions: [], narrativeFields: {} as never, guidance: {} as never,
    protagonistReference: '沈砚青', protagonistRule: '', promptTier: 'standard',
  })[0].content
}

describe('context visibility', () => {
  it('12-01/12-02: removes a reader-only secret from state, checkpoint, excerpt, semantic memory and final Writer message', () => {
    const secret = fact(1, '账册藏在药箱', {
      ...emptyProjection,
      readerKnownChapterNum: 3,
    })
    const policy = buildContextVisibilityPolicy(input({ facts: [secret] }))
    const filtered = filterChapterContextByVisibility(context({
      characterStates: '沈砚青不知道账册藏在药箱',
      previousSummaries: '检查点：账册藏在药箱',
      previousChapterContext: '读者看见账册藏在药箱',
      recalledMemory: '相似片段：账册藏在药箱',
      scenePlanSummary: '旧覆盖：账册藏在药箱',
    }), policy)
    const message = writerMessage(filtered)
    expect(message).not.toContain('账册藏在药箱')
    expect(filtered.visibilityReport?.decisions.filter((item) => !item.included).map((item) => item.channel)).toEqual(
      expect.arrayContaining(['entity_world', 'checkpoint', 'previous_excerpt', 'semantic_memory', 'writer_override']),
    )
  })

  it('12-03/12-04: emits only a confirmed scene-bound reveal and ignores planned chapter metadata alone', () => {
    const future = fact(4, '药箱里是真账册', emptyProjection)
    future.fact.targetRevealChapterId = 999
    const withoutContract = buildContextVisibilityPolicy(input({ facts: [future] }))
    expect(withoutContract.revealDirectives).toEqual([])

    const withContract = buildContextVisibilityPolicy(input({
      facts: [future],
      scenes: [
        { id: 201, order: 1, pov: '沈砚青', status: 'locked', revealPayload: [] },
        { id: 202, order: 2, pov: '沈砚青', status: 'locked', revealPayload: ['药箱里是真账册'] },
      ],
    }))
    const filtered = filterChapterContextByVisibility(context(), withContract)
    expect(filtered.writingContractSummary).toContain('场景2揭示（fact:4）')
    expect(filtered.writingContractSummary).toContain('不得提前到章首')
  })

  it('12-05: keeps same-chapter knowledge and ambiguous multi-POV names out of the Writer set', () => {
    const sameChapter = fact(5, '同章后知秘密', {
      ...emptyProjection,
      characterKnowledge: [{ characterId: 7, knownChapterNum: 20 }],
    })
    const policy = buildContextVisibilityPolicy(input({
      facts: [sameChapter],
      characters: [
        { id: 7, fullName: '掌柜', isProtagonist: true },
        { id: 8, fullName: '掌柜', isProtagonist: false },
      ],
      scenes: [{ id: 201, order: 1, pov: '掌柜', status: 'locked', revealPayload: [] }],
    }))
    expect(policy.allowedFacts).toEqual([])
    expect(policy.unresolvedPovLabels).toContain('scene:201:ambiguous_pov')
  })

  it('12-06: isolates reviewer truth from Writer sources and stage identity', async () => {
    const secret = fact(6, '幕后人是赵队长', emptyProjection)
    const writer = filterChapterContextByVisibility(context(), buildContextVisibilityPolicy(input({ facts: [secret] })))
    const review = filterChapterContextByVisibility(context(), buildContextVisibilityPolicy(input({ facts: [secret], purpose: 'review' })))
    expect(writer.visibilityReport?.sources[0].text).toBe('[redacted fact:6]')
    expect(review.visibilityReport?.sources[0].text).toContain('幕后人是赵队长')
    const base = { novelId: 1, chapterId: 20, chapterNum: 20, contextVersion: 1, contractVersion: 'c1', modelProfile: 'test', budget: 100 }
    const writerPack = await compileContextPack({ ...base, stage: 'draft', sources: writer.visibilityReport?.sources || [] })
    const reviewPack = await compileContextPack({ ...base, stage: 'review', sources: review.visibilityReport?.sources || [] })
    expect(writerPack.pack.id).not.toBe(reviewPack.pack.id)
    expect(writerPack.rendered).not.toContain('幕后人是赵队长')
    expect(reviewPack.rendered).toContain('幕后人是赵队长')
  })

  it('12-07: reports a required source gap instead of restoring forbidden text', () => {
    const secret = fact(7, '未来凶手身份', emptyProjection)
    const filtered = filterChapterContextByVisibility(context({
      chapterGoal: '必须写出未来凶手身份',
      hardConstraintEntries: [{ label: 'chapterGoal', title: '章节目标', content: '必须写出未来凶手身份', originalTokens: 8, allocatedTokens: 8, truncated: false }],
      hardConstraintContext: '章节目标：必须写出未来凶手身份',
    }), buildContextVisibilityPolicy(input({ facts: [secret] })))
    expect(filtered.chapterGoal).toBe('')
    expect(filtered.hardConstraintContext).not.toContain('未来凶手身份')
    expect(filtered.visibilityReport?.requiredMissingSourceKeys).toEqual(expect.arrayContaining(['part:chapterGoal', 'hard:chapterGoal']))
    expect(filtered.visibilityReport?.requiredMissingFactIds).toEqual([7])
  })

  it('12-08: never resolves a POV through duplicate or cross-novel character identity', () => {
    const readerOnly = fact(8, '读者已知但角色未知', { ...emptyProjection, readerKnownChapterNum: 3 })
    const crossNovelFact = fact(9, '另一部小说秘密', emptyProjection, 2)
    const policy = buildContextVisibilityPolicy(input({
      facts: [readerOnly, crossNovelFact].filter((item) => item.fact.novelId === 1),
      characters: [{ id: 70, fullName: '沈砚青', isProtagonist: false }],
      scenes: [{ id: 201, order: 1, pov: '不存在的同名角色', status: 'locked', revealPayload: [] }],
    }))
    expect(policy.allowedFacts).toEqual([])
    expect(policy.deniedFacts.map((item) => item.fact.id)).toContain(8)
    expect(policy.unresolvedPovLabels).toContain('scene:201:ambiguous_pov')
  })
})
