'use strict'

const assert = require('node:assert/strict')

function fact(id, title, projection, novelId = 101) {
  return {
    fact: {
      id, novelId, title, summary: `${title}的完整内容`, kind: 'truth',
      readerKnownChapterId: null, protagonistKnownChapterId: null, characterKnowledgeJson: null,
      forbiddenBeforeVolume: null, targetRevealChapterId: null,
    },
    projection,
  }
}

function context(overrides = {}) {
  const fields = [
    'storyCore', 'currentArc', 'worldRules', 'characterStates', 'worldStates', 'mapSummary', 'itemSummary',
    'previousSummaries', 'previousChapterContext', 'lastChapterEnding', 'chapterBridgePlan', 'styleTemplate',
    'chapterGoal', 'continuitySummary', 'openLoops', 'dueForeshadows', 'continuityNotes', 'timelineSummary',
    'timelineOpenThreads', 'longTermMemory', 'activeThreads', 'writingContractSummary', 'relationSummary',
    'dialogueVoiceLocks', 'recalledMemory', 'scenePlanSummary', 'draftTextSummary', 'contractVersionSummary',
    'reviewRiskSummary', 'reviewProofSummary', 'rewriteDeltaSummary', 'publishGateRiskSummary', 'stepMemorySummary',
    'antiAiRules', 'styleHardGuard', 'antiAiRulesSoft', 'styleHardGuardSoft',
  ]
  return {
    ...Object.fromEntries(fields.map((field) => [field, ''])),
    chapterGoal: '继续调查', writingContractSummary: '按合同执行',
    hardConstraintContext: '', hardConstraintSummary: '', hardConstraintEntries: [],
    constraintInjectionStatus: {}, softContextBudgetUsage: {},
    contextBudgetReport: { availableContextBudget: 1000, reservedForOutput: 100 },
    droppedConstraintCount: 0, previousChapterSampleReport: {}, softContextDecisions: [],
    recallSnapshot: {}, recallDiagnostics: {}, recalledMemorySources: [],
    ...overrides,
  }
}

async function run({ loadTypeScriptModule }) {
  const visibility = loadTypeScriptModule('electron/services/context-visibility.ts')
  const packs = loadTypeScriptModule('src/shared/context-pack.ts')
  const empty = { readerKnownChapterNum: null, protagonistKnownChapterNum: null, characterKnowledge: [] }
  const readerOnly = fact(4001, '账册藏在药箱', { ...empty, readerKnownChapterNum: 3 })
  const baseInput = {
    novelId: 101,
    chapterNum: 20,
    purpose: 'writer',
    facts: [readerOnly],
    characters: [{ id: 11, fullName: '沈砚青', isProtagonist: true }],
    scenes: [{ id: 51, order: 1, pov: '沈砚青', status: 'locked', revealPayload: [] }],
  }
  const writerPolicy = visibility.buildContextVisibilityPolicy(baseInput)
  const writerContext = visibility.filterChapterContextByVisibility(context({
    characterStates: '角色不知道账册藏在药箱',
    previousSummaries: '检查点写到账册藏在药箱',
    previousChapterContext: '上一章读者看见账册藏在药箱',
    recalledMemory: '语义记忆命中账册藏在药箱',
  }), writerPolicy)
  assert.equal(JSON.stringify(writerContext).includes('账册藏在药箱'), false)
  assert.ok(writerContext.visibilityReport.decisions.some((item) => item.channel === 'previous_excerpt' && !item.included))
  assert.ok(writerContext.visibilityReport.decisions.some((item) => item.channel === 'semantic_memory' && !item.included))

  const revealFact = fact(4004, '幕后人是赵队长', empty)
  const revealPolicy = visibility.buildContextVisibilityPolicy({
    ...baseInput,
    facts: [revealFact],
    scenes: [
      { id: 51, order: 1, pov: '沈砚青', status: 'locked', revealPayload: [] },
      { id: 52, order: 2, pov: '沈砚青', status: 'locked', revealPayload: ['幕后人是赵队长'] },
    ],
  })
  const revealContext = visibility.filterChapterContextByVisibility(context(), revealPolicy)
  assert.match(revealContext.writingContractSummary, /场景2揭示（fact:4004）/)

  const plannedOnly = { ...revealFact, fact: { ...revealFact.fact, targetRevealChapterId: 3001 } }
  const plannedPolicy = visibility.buildContextVisibilityPolicy({ ...baseInput, facts: [plannedOnly] })
  assert.equal(plannedPolicy.revealDirectives.length, 0)

  const sameChapter = fact(4005, '同章后知秘密', {
    ...empty,
    characterKnowledge: [{ characterId: 11, knownChapterNum: 20 }],
  })
  assert.equal(visibility.buildContextVisibilityPolicy({ ...baseInput, facts: [sameChapter] }).allowedFacts.length, 0)

  const reviewContext = visibility.filterChapterContextByVisibility(
    context(),
    visibility.buildContextVisibilityPolicy({ ...baseInput, purpose: 'review', facts: [readerOnly] }),
  )
  const writerPack = await packs.compileContextPack({
    novelId: 101, chapterId: 3001, chapterNum: 20, stage: 'draft', contextVersion: 1,
    sources: writerContext.visibilityReport.sources, budget: 100,
  })
  const reviewPack = await packs.compileContextPack({
    novelId: 101, chapterId: 3001, chapterNum: 20, stage: 'review', contextVersion: 1,
    sources: reviewContext.visibilityReport.sources, budget: 100,
  })
  assert.equal(writerPack.rendered.includes('账册藏在药箱'), false)
  assert.equal(reviewPack.rendered.includes('账册藏在药箱'), true)
  assert.notEqual(writerPack.pack.id, reviewPack.pack.id)

  const required = visibility.filterChapterContextByVisibility(context({
    chapterGoal: '必须写出幕后人是赵队长',
    hardConstraintEntries: [{
      label: 'chapterGoal', title: '章节目标', content: '必须写出幕后人是赵队长',
      originalTokens: 8, allocatedTokens: 8, truncated: false,
    }],
    hardConstraintContext: '章节目标：必须写出幕后人是赵队长',
  }), visibility.buildContextVisibilityPolicy({ ...baseInput, facts: [revealFact] }))
  assert.deepEqual(required.visibilityReport.requiredMissingFactIds, [4004])
  assert.equal(required.hardConstraintContext.includes('幕后人是赵队长'), false)

  const ambiguous = visibility.buildContextVisibilityPolicy({
    ...baseInput,
    facts: [sameChapter, readerOnly],
    characters: [
      { id: 11, fullName: '掌柜', isProtagonist: true },
      { id: 12, fullName: '掌柜', isProtagonist: false },
    ],
    scenes: [{ id: 51, order: 1, pov: '掌柜', status: 'locked', revealPayload: [] }],
  })
  assert.equal(ambiguous.allowedFacts.length, 0)
  assert.ok(ambiguous.deniedFacts.some((item) => item.fact.id === readerOnly.fact.id))
  assert.ok(ambiguous.unresolvedPovLabels.includes('scene:51:ambiguous_pov'))

  return {
    cases: {
      '12-01': 'PASS', '12-02': 'PASS', '12-03': 'PASS', '12-04': 'PASS',
      '12-05': 'PASS', '12-06': 'PASS', '12-07': 'PASS', '12-08': 'PASS',
    },
    assertions: [
      'writer context omits reader-only secret across duplicated channels',
      'confirmed scene reveal is isolated from chapter-start knowledge',
      'same-chapter and planned-only facts stay unknown',
      'review and writer packs are isolated',
      'required forbidden sources produce ID-only gaps',
      'ambiguous character names never resolve by guess',
    ],
  }
}

module.exports = { run }
