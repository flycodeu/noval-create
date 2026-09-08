'use strict'

const assert = require('node:assert/strict')

async function run({ loadTypeScriptModule }) {
  const pack = loadTypeScriptModule('src/shared/context-pack.ts')
  const compiler = loadTypeScriptModule('electron/services/context-compiler.ts')
  const planning = loadTypeScriptModule('src/pages/Novel/shared/planning-context.ts')
  const base = {
    novelId: 11, chapterId: 4, chapterNum: 4, stage: 'draft', contextVersion: 3,
    contractVersion: 'contract-1', modelProfile: 'balanced', budget: 30,
    sources: [
      { key: 'hard:goal', sourceKind: 'hard_constraint', sourceId: 'goal', sourceVersion: '3', visibility: 'canon', text: '必须查账', required: true },
      { key: 'part:memory', sourceKind: 'memory', sourceId: 'memory', sourceVersion: '3', visibility: 'draft', text: '门口有脚印', required: false },
      { key: 'part:memory', sourceKind: 'memory', sourceId: 'memory', sourceVersion: '3', visibility: 'draft', text: '重复脚印', required: false },
    ],
  }
  const first = await pack.compileContextPack(base)
  const second = await pack.compileContextPack({ ...base, sources: [...base.sources].reverse() })
  assert.equal(first.pack.id, second.pack.id)
  assert.equal(first.diagnostics.deduped.length, 1)
  assert.equal((await pack.compileContextPack({ ...base, stage: 'review' })).pack.id === first.pack.id, false)
  assert.equal((await pack.compileContextPack({ ...base, contractVersion: 'contract-2' })).pack.id === first.pack.id, false)
  const restored = pack.deserializeContextPack(pack.serializeContextPack(first.pack))
  assert.deepEqual(restored, first.pack)
  let loaderCalls = 0
  await pack.compileContextPack({ ...base, sources: [] }, { loadSources: () => {
    loaderCalls += 1
    return base.sources
  } })
  assert.equal(loaderCalls, 1)
  const overflow = await pack.compileContextPack({ ...base, budget: 1 })
  assert.equal(overflow.diagnostics.requiredOverflow, true)
  await assert.rejects(
    () => pack.compileContextPack({ ...base, chapterId: null }),
    (error) => error && error.code === 'NF_CONTEXT_PACK_INVALID',
  )
  const rawContext = {
    novel: { id: 11, contextVersion: 3 },
    currentChapter: { id: 4, chapterNum: 4 },
  }
  const allocatedContext = {
    contractVersionSummary: 'contract-1',
    hardConstraintEntries: [{ label: 'chapterGoal', content: '必须查账', allocatedTokens: 4 }],
    softContextDecisions: [],
    contextBudgetReport: { availableContextBudget: 30, reservedForOutput: 10 },
  }
  const compiled = await compiler.compileChapterContextPack({
    rawContext, context: allocatedContext, stage: 'draft', modelProfile: 'balanced',
  })
  allocatedContext.hardConstraintEntries[0].content = '当前来源已变化'
  const restoredCompile = await compiler.compileChapterContextPack({
    rawContext, context: allocatedContext, stage: 'draft', modelProfile: 'balanced', restoredPack: compiled.pack,
  })
  assert.equal(restoredCompile.pack.id, compiled.pack.id)
  assert.match(restoredCompile.rendered, /必须查账/)
  await assert.rejects(
    () => compiler.compileChapterContextPack({
      rawContext: { ...rawContext, novel: { id: 11, contextVersion: 4 } },
      context: allocatedContext,
      stage: 'draft',
      modelProfile: 'balanced',
      mode: 'active',
      restoredPack: compiled.pack,
    }),
    (error) => error && error.code === 'NF_CONTEXT_STALE',
  )
  const planningResult = await planning.buildPlanningContextPack({ id: 11, title: '规划样本', genreName: '悬疑', synopsis: '查明真相', contextVersion: 3 })
  assert.equal(planningResult.pack.stage, 'planning')
  assert.equal(planningResult.pack.chapterId, null)
  return {
    cases: {
      '11-01': 'PASS', '11-02': 'PASS', '11-03': 'PASS', '11-04': 'PASS',
      '11-05': 'PASS', '11-06': 'PASS', '11-07': 'PASS', '11-08': 'PASS',
    },
    assertions: ['stable id and order', 'version and stage invalidation', 'duplicate source diagnostics', 'single loader call', 'saved pack restore without rebuilding', 'active stale rejection', 'planning projection uses shared schema'],
  }
}

module.exports = { run }
