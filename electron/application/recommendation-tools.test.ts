import { describe, expect, it, vi } from 'vitest'
import {
  RECOMMENDATION_POLICY,
  type RecommendationAttemptState,
  type RecommendationCandidate,
  type RecommendationPreflightResult,
} from '../../src/shared/recommendation-governance'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { RecommendationGovernanceError } from './recommendation-governance-error'
import { registerRecommendationTools } from './recommendation-tools'
import { AgentToolRegistry } from './tool-registry'

const hash = `sha256:${'a'.repeat(64)}`
const state: RecommendationAttemptState = {
  novelId: 7,
  novelStatus: 'serializing',
  workState: 'serializing',
  policy: RECOMMENDATION_POLICY,
  totalEvaluationCount: 0,
  failedEvaluationCount: 0,
  passedEvaluationCount: 0,
  remainingEvaluationCount: 3,
  failureLockThreshold: 3,
  status: 'eligible',
  locked: false,
  canRecordExternalEvaluation: true,
  canRunInternalPreflight: true,
  attempts: [],
}
const preflight: RecommendationPreflightResult = {
  runId: 11,
  novelId: 7,
  profileVersion: 'novelforge-recommendation-v1',
  status: 'ready',
  score: 90,
  confidenceLowerBound: 85,
  coverageRate: 100,
  blockers: [],
  warnings: [],
  evidence: [],
  contextVersion: 4,
  contentHash: hash,
  countedExternalAttempt: false,
  createdAt: '2026-07-11T00:00:00.000Z',
}
const candidate: RecommendationCandidate = {
  id: 21,
  novelId: 7,
  preflightRunId: 11,
  status: 'locked',
  contextVersion: 4,
  contentHash: hash,
  snapshot: { version: 'v1' },
  actorType: 'api_client',
  actorId: 'api-test',
  clientId: 'vitest',
  approvalId: 'approved-1',
  lockedAt: '2026-07-11T00:01:00.000Z',
  createdAt: '2026-07-11T00:01:00.000Z',
}

const allScopes = Object.values(AGENT_TOOL_SCOPES)
const actor = { type: 'api_client' as const, actorId: 'api-test', clientId: 'vitest' }

function dependencies() {
  return {
    getAttemptState: vi.fn(() => state),
    getWorkspace: vi.fn(() => ({ state, latestPreflight: preflight, latestCandidate: candidate })),
    runPreflight: vi.fn(() => preflight),
    lockCandidate: vi.fn(() => candidate),
    recordEvaluation: vi.fn(() => ({
      attempt: {
        id: 31,
        novelId: 7,
        candidateId: 21,
        source: 'author_requested' as const,
        outcome: 'failed' as const,
        workStateAtEvaluation: 'serializing' as const,
        failureReason: '开篇留存不足',
        evidenceCompleteness: 'complete' as const,
        evidence: {},
        policy: RECOMMENDATION_POLICY,
        actorType: 'api_client',
        actorId: 'api-test',
        clientId: 'vitest',
        approvalId: 'approved-1',
        confirmedBy: 'editor-1',
        occurredAt: '2026-07-11T00:02:00.000Z',
        createdAt: '2026-07-11T00:02:00.000Z',
      },
      state: { ...state, totalEvaluationCount: 1, failedEvaluationCount: 1, remainingEvaluationCount: 2 },
      idempotentReplay: false,
    })),
  }
}

describe('recommendation tool adapter', () => {
  it('publishes four policy-aware tools and exposes state/preflight to read scopes', async () => {
    const deps = dependencies()
    const registry = registerRecommendationTools(new AgentToolRegistry(), deps)
    expect(registry.list({ domain: 'recommendation' }).map((tool) => tool.id)).toEqual([
      'novelforge.recommendation.get_attempt_state',
      'novelforge.recommendation.get_workspace',
      'novelforge.recommendation.lock_candidate',
      'novelforge.recommendation.record_result',
      'novelforge.recommendation.run_preflight',
    ])

    const stateCall = await registry.invoke({
      toolId: 'novelforge.recommendation.get_attempt_state',
      input: { novelId: 7 },
    }, { actor, scopes: allScopes })
    const preflightCall = await registry.invoke({
      toolId: 'novelforge.recommendation.run_preflight',
      input: { novelId: 7 },
    }, { actor, scopes: allScopes })
    expect(stateCall).toMatchObject({ ok: true, data: state })
    expect(preflightCall).toMatchObject({ ok: true, data: preflight })
  })

  it('does not trust a request-supplied approval id, but accepts a matching trusted context approval', async () => {
    const deps = dependencies()
    const registry = registerRecommendationTools(new AgentToolRegistry(), deps)
    const request = {
      toolId: 'novelforge.recommendation.lock_candidate',
      input: { novelId: 7, preflightRunId: 11, expectedContextVersion: 4, expectedContentHash: hash },
      approvalId: 'approved-1',
    }
    const forged = await registry.invoke(request, { actor, scopes: allScopes })
    const trusted = await registry.invoke(request, { actor, scopes: allScopes, approvalId: 'approved-1' })

    expect(forged).toMatchObject({ ok: false, error: { code: 'APPROVAL_REQUIRED' } })
    expect(trusted).toMatchObject({ ok: true, data: candidate })
    expect(deps.lockCandidate).toHaveBeenCalledTimes(1)
  })

  it('maps governance failures to stable tool errors', async () => {
    const deps = dependencies()
    deps.getAttemptState.mockImplementation(() => {
      throw new RecommendationGovernanceError('PROJECT_NOT_FOUND', '项目不存在。')
    })
    const registry = registerRecommendationTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.recommendation.get_attempt_state',
      input: { novelId: 99 },
    }, { actor, scopes: allScopes })
    expect(result).toMatchObject({ ok: false, error: { code: 'PROJECT_NOT_FOUND' } })
  })
})
