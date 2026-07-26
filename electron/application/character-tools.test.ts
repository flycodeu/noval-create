import { describe, expect, it, vi } from 'vitest'
import type { CharacterNeedsAnalysisResult } from '../../src/shared/character-cast-planning'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { CharacterCastPlanningError } from './character-cast-planner'
import { registerCharacterPlanningTools } from './character-tools'
import { AgentToolRegistry } from './tool-registry'

const result: CharacterNeedsAnalysisResult = {
  planId: 'castplan_test',
  taskId: 11,
  reviewTaskId: null,
  scopeSummary: '全书',
  existingCount: 0,
  priorRange: { min: 0, suggested: 0, max: 0, rationale: '测试' },
  recommended: {
    keep: 0,
    update: 0,
    mergeGroups: 0,
    create: 0,
    archive: 0,
    activeCastAfterCommit: 0,
    confidence: 0.5,
  },
  existingActions: [],
  mergeGroups: [],
  roleSlots: [],
  review: {
    mode: 'deterministic',
    status: 'blocked',
    score: 0,
    summary: '测试',
    hardBlockers: ['缺少上下文'],
    warnings: [],
    revisionSuggestions: [],
    dimensionScores: {
      necessity: 0,
      causality: 0,
      worldFit: 0,
      tension: 0,
      differentiation: 0,
      writability: 0,
      growthSpace: 0,
      entranceFeasibility: 0,
    },
  },
  deterministicChecks: [],
  risks: [],
  assumptions: [],
  contextVersion: 1,
}

const context = {
  actor: {
    type: 'api_client' as const,
    actorId: 'api-test',
    clientId: 'test-client',
  },
  scopes: [
    AGENT_TOOL_SCOPES.novelRead,
    AGENT_TOOL_SCOPES.contextRead,
    AGENT_TOOL_SCOPES.draftCreate,
  ],
}

describe('character planning tool adapter', () => {
  it('publishes a discoverable descriptor and returns schema-valid output', async () => {
    const analyzeNeeds = vi.fn(async () => result)
    const registry = registerCharacterPlanningTools(new AgentToolRegistry(), { analyzeNeeds })

    expect(registry.list({ domain: 'characters' })).toEqual([
      expect.objectContaining({
        id: 'novelforge.characters.analyze_needs',
        effect: 'read',
        taskMode: 'app_async',
      }),
    ])

    const call = await registry.invoke({
      toolId: 'novelforge.characters.analyze_needs',
      input: { novelId: 7, executionMode: 'fast' },
    }, context)
    expect(call).toMatchObject({ ok: true, data: result })
    expect(analyzeNeeds).toHaveBeenCalledWith(expect.objectContaining({ novelId: 7 }))
  })

  it('enforces draft scope before invoking a model-backed read tool', async () => {
    const analyzeNeeds = vi.fn(async () => result)
    const registry = registerCharacterPlanningTools(new AgentToolRegistry(), { analyzeNeeds })
    const call = await registry.invoke({
      toolId: 'novelforge.characters.analyze_needs',
      input: { novelId: 7 },
    }, {
      ...context,
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.contextRead],
    })

    expect(call).toMatchObject({
      ok: false,
      error: {
        code: 'AUTH_SCOPE_REQUIRED',
        missingScopes: [AGENT_TOOL_SCOPES.draftCreate],
      },
    })
    expect(analyzeNeeds).not.toHaveBeenCalled()
  })

  it('maps planner domain failures into stable tool errors', async () => {
    const registry = registerCharacterPlanningTools(new AgentToolRegistry(), {
      analyzeNeeds: async () => {
        throw new CharacterCastPlanningError('PROJECT_NOT_FOUND', '项目不存在。')
      },
    })
    const call = await registry.invoke({
      toolId: 'novelforge.characters.analyze_needs',
      input: { novelId: 99 },
    }, context)

    expect(call).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND', message: '项目不存在。' },
    })
  })
})
