import { describe, expect, it, vi } from 'vitest'
import type { CharacterNeedsAnalysisInput } from '../../src/shared/character-cast-planning'
import {
  analyzeCharacterNeeds,
  type CharacterCastModelRequest,
  type CharacterCastPlanningContext,
  type CharacterCastPlannerDependencies,
} from './character-cast-planner'
import { characterNeedsOutputSchema } from './character-tools'
import { validateJsonSchema } from '../../src/shared/tool-contracts'

const context: CharacterCastPlanningContext = {
  novelId: 7,
  novelTitle: '雾港来信',
  genre: '悬疑',
  operatingMode: 'standard_longform',
  targetWords: 200000,
  contextVersion: 12,
  modelConfigId: 3,
  scopeSummary: '全书，前瞻 20 章',
  profile: {
    premise: '失踪记者留下七封互相矛盾的信。',
    storyDesign: '主角追查旧港改造案。',
    endgame: '终局必须揭示谁修改了第五封信。',
    worldRules: '现实主义城市，无超自然力量。',
    storyThreads: '旧港账本、第五封信、失踪案。',
    writingRules: '证据先于结论。',
  },
  existingCharacters: [
    {
      id: 1,
      name: '沈砚',
      roleType: 'protagonist',
      recordStatus: 'confirmed',
      species: '人类',
      occupation: '调查记者',
      goals: '找到失踪的前同事',
      dramaticEngine: '公开真相会伤害被保护的人',
      characterArc: '从单独行动转向接受协作',
      relationshipTension: '不信任警方联系人',
      appearChapter: 1,
    },
    {
      id: 2,
      name: '周岐',
      roleType: 'antagonist',
      recordStatus: 'confirmed',
      species: '人类',
      occupation: '旧港开发公司法务',
      goals: '阻止旧案重启',
      dramaticEngine: '每次遮掩都会暴露新的资金链',
      characterArc: '逐步失去对同盟的控制',
      relationshipTension: '与主角争夺证人信任',
      appearChapter: 3,
    },
  ],
  existingCount: 2,
  priorRange: {
    min: 2,
    suggested: 5,
    max: 8,
    rationale: '篇幅先验，不是人数配额。',
  },
  coveragePrior: [],
  evidence: [
    { ref: 'novel:7', kind: 'novel', title: '雾港来信', summary: '旧港失踪案' },
    { ref: 'thread:9', kind: 'thread', title: '旧港账本', summary: '账本保管人尚未确定' },
  ],
}

const coreFunctionKeys = [
  'pov_anchor',
  'desire_driver',
  'primary_resistance',
  'value_mirror',
  'information_gatekeeper',
  'resource_interface',
  'emotional_pivot',
  'foreshadow_payoff',
  'world_rule_expositor',
  'endgame_witness',
]

function planOutput(createCount = 1) {
  const createIndexes = new Set(coreFunctionKeys.slice(0, createCount).map((_, index) => index + 7))
  return JSON.stringify({
    scopeSummary: '全书，前瞻 20 章',
    existingActions: [
      { characterId: 1, action: 'keep', rationale: '承担 POV 与调查行动。', targetedChanges: [] },
      { characterId: 2, action: 'keep', rationale: '承担主要组织阻力。', targetedChanges: [] },
    ],
    mergeGroups: [],
    roleSlots: coreFunctionKeys.map((functionKey, index) => {
      const shouldCreate = createIndexes.has(index)
      return {
        slotId: `${functionKey}-1`,
        functionKey,
        function: `功能 ${functionKey}`,
        coverage: shouldCreate ? 'missing' : 'covered',
        coveredByCharacterIds: shouldCreate ? [] : [index === 2 ? 2 : 1],
        mustBeIndependent: shouldCreate,
        independenceReason: shouldCreate ? '账本保管职责与主角调查立场冲突，兼任会提前泄露谜底。' : '',
        evidenceRefs: shouldCreate ? ['thread:9'] : ['novel:7'],
        proposedAction: shouldCreate ? 'create' : 'keep',
        proposedRoleType: shouldCreate ? 'supporting' : index === 0 ? 'protagonist' : 'major',
        firstAppearanceWindow: shouldCreate ? '第 6-8 章' : '已出场',
        priority: 90 - index,
      }
    }),
    confidence: 0.84,
    risks: ['新增守门人可能增加前八章认知负担。'],
    assumptions: ['第五封信仍属于未揭示真相。'],
  })
}

const reviewOutput = JSON.stringify({
  score: 88,
  summary: '功能位有具体证据，新增角色具备独立必要性。',
  hardBlockers: [],
  warnings: [],
  revisionSuggestions: [],
  dimensionScores: {
    necessity: 91,
    causality: 86,
    worldFit: 92,
    tension: 87,
    differentiation: 84,
    writability: 90,
    growthSpace: 80,
    entranceFeasibility: 85,
  },
})

function dependencies(outputs: string[]) {
  const loadContext = vi.fn(async () => context)
  const runModel = vi.fn(async (_request: CharacterCastModelRequest) => ({
    taskId: outputs.length === 2 ? 101 : 102,
    output: outputs.shift() || '{}',
  }))
  return {
    deps: {
      loadContext,
      runModel,
      createPlanId: () => 'castplan_test',
    } satisfies CharacterCastPlannerDependencies,
    loadContext,
    runModel,
  }
}

describe('character cast planner', () => {
  it('derives a dynamic cast plan, records both task ids, and runs independent review', async () => {
    const fixture = dependencies([planOutput(), reviewOutput])
    const result = await analyzeCharacterNeeds({
      novelId: 7,
      scope: { type: 'novel', lookaheadChapters: 20 },
      goals: ['补足线索守门人'],
      constraints: { maxNewCharacters: 3 },
      executionMode: 'review_first',
    }, fixture.deps)

    expect(result).toMatchObject({
      planId: 'castplan_test',
      taskId: 101,
      reviewTaskId: 102,
      existingCount: 2,
      contextVersion: 12,
      recommended: { create: 1, activeCastAfterCommit: 3 },
      review: { mode: 'model', status: 'passed', score: 88 },
    })
    expect(result.roleSlots).toHaveLength(10)
    expect(fixture.runModel).toHaveBeenCalledTimes(2)
    expect(fixture.runModel.mock.calls[0][0]).toMatchObject({ phase: 'plan', modelConfigId: 3 })
    expect(fixture.runModel.mock.calls[1][0]).toMatchObject({ phase: 'review' })
    expect(validateJsonSchema(result, characterNeedsOutputSchema)).toEqual({ valid: true, issues: [] })
  })

  it('uses deterministic review in fast mode', async () => {
    const fixture = dependencies([planOutput()])
    const result = await analyzeCharacterNeeds({ novelId: 7, executionMode: 'fast' }, fixture.deps)

    expect(result.reviewTaskId).toBeNull()
    expect(result.review.mode).toBe('deterministic')
    expect(fixture.runModel).toHaveBeenCalledTimes(1)
  })

  it('blocks a plan that exceeds the caller new-character cap', async () => {
    const fixture = dependencies([planOutput(2)])
    const result = await analyzeCharacterNeeds({
      novelId: 7,
      constraints: { maxNewCharacters: 1 },
      executionMode: 'fast',
    }, fixture.deps)

    expect(result.recommended.create).toBe(2)
    expect(result.review.status).toBe('blocked')
    expect(result.deterministicChecks).toContainEqual(expect.objectContaining({
      code: 'new_character_cap',
      status: 'fail',
    }))
  })

  it('rejects volume scope without a volume id before invoking dependencies', async () => {
    const fixture = dependencies([])
    await expect(analyzeCharacterNeeds({
      novelId: 7,
      scope: { type: 'volume' },
    }, fixture.deps)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(fixture.loadContext).not.toHaveBeenCalled()
  })

  it('surfaces malformed planner output as a stable domain error', async () => {
    const fixture = dependencies(['not-json'])
    await expect(analyzeCharacterNeeds({ novelId: 7 }, fixture.deps)).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
    })
  })
})
