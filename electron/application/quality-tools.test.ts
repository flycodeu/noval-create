import { describe, expect, it, vi } from 'vitest'
import type { AgentArtifact } from '../../src/shared/agent-artifacts'
import type {
  AgentQualityRepairDraftContent,
  AgentQualityRepairReviewContent,
  AgentQualityReportContent,
  AgentQualityRunComparison,
  AgentRepairPlanContent,
} from '../../src/shared/quality-agent-workflow'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import { QualityWorkflowError } from './quality-workflow-error'
import { registerQualityTools } from './quality-tools'
import { AgentToolRegistry } from './tool-registry'

const hash = `sha256:${'a'.repeat(64)}`
const profile = {
  profile: 'longform_health_v1' as const,
  minimumHealthScore: 75,
  minimumAverageScore: 75,
  minimumCoverageRate: 70,
  maximumAverageAiLikeRate: 45,
  requireProductionReady: false,
  blockCriticalRisks: true,
  blockRiskyChapterGates: false,
  blockHighRiskAiRecurrence: false,
  blockFeedbackPauseSignals: false,
}
const report: AgentQualityReportContent = {
  schemaVersion: 'agent-quality-report-v1',
  requestFingerprint: hash,
  profile,
  scope: { type: 'novel', label: '整书', chapterNums: [1] },
  status: 'needs_revision',
  score: 80,
  confidenceLowerBound: 76,
  coverageRate: 100,
  summary: '需要修订。',
  blockers: [],
  warnings: [],
  findings: [],
  metrics: {
    healthScore: 80,
    averageOverallScore: 80,
    averageAiLikeRate: 20,
    coverageRate: 100,
    totalChapterCount: 1,
    analyzedChapterCount: 1,
    criticalRiskCount: 0,
    warningRiskCount: 1,
    riskyChapterGateCount: 0,
    productionReadinessStatus: 'warning',
    highRiskAiRecurrenceCount: 0,
    feedbackPauseSuggestedCount: 0,
  },
  repairMetrics: [],
  contextVersion: 3,
  baselineReportArtifactId: null,
  createdAt: '2026-07-11T00:00:00.000Z',
}
const plan: AgentRepairPlanContent = {
  schemaVersion: 'agent-repair-plan-v1',
  requestFingerprint: hash,
  sourceReportArtifactId: 'quality-report-1',
  sourceReportContentHash: hash,
  sourceContextVersion: 3,
  status: 'ready',
  summary: '生成 1 项修复。',
  goals: ['修复节奏'],
  hardBlockers: [],
  warnings: [],
  items: [],
  requiresFreshEvaluationAfterDraft: true,
  canonicalWriteAllowed: false,
  createdAt: '2026-07-11T00:01:00.000Z',
}
const repairDraft: AgentQualityRepairDraftContent = {
  schemaVersion: 'agent-quality-repair-draft-v1',
  requestFingerprint: hash,
  repairPlanArtifactId: 'repair-plan-1',
  repairPlanContentHash: hash,
  sourceReportArtifactId: 'quality-report-1',
  sourceContextVersion: 3,
  selectedRepairItemIds: [],
  status: 'ready_for_review',
  summary: '候选稿已生成。',
  hardBlockers: [],
  warnings: ['需要人工查看 Diff。'],
  chapters: [],
  readyForHumanReview: true,
  canonicalWriteAllowed: false,
  requiresFreshEvaluationAfterApply: true,
  createdAt: '2026-07-11T00:02:00.000Z',
}
const repairReview: AgentQualityRepairReviewContent = {
  schemaVersion: 'agent-quality-repair-review-v1',
  requestFingerprint: hash,
  repairDraftArtifactId: 'repair-draft-1',
  repairDraftContentHash: hash,
  repairPlanArtifactId: 'repair-plan-1',
  repairPlanContentHash: hash,
  sourceContextVersion: 3,
  status: 'passed',
  score: 93,
  summary: '独立语义审校通过。',
  blockers: [],
  warnings: ['仍需人工查看 Diff。'],
  chapters: [{
    chapterId: 11,
    chapterNum: 1,
    title: '第一章',
    originalContentHash: hash,
    optimizedContentHash: hash,
    draftTaskId: 21,
    reviewTaskId: 22,
    separateReviewTask: true,
    status: 'passed',
    score: 93,
    evidenceCoverageRate: 100,
    summary: '通过。',
    blockers: [],
    warnings: [],
    checks: [],
    regressionRisks: [],
    strengths: ['保留既有事实。'],
  }],
  independentModelReview: true,
  readyForHumanDecision: true,
  canonicalWriteAllowed: false,
  requiresHumanDiff: true,
  createdAt: '2026-07-11T00:03:00.000Z',
}

function artifact<T>(id: string, kind: string, content: T): AgentArtifact<T> {
  return {
    id,
    novelId: 5,
    kind,
    status: kind === 'repair_plan' ? 'draft' : 'reviewed',
    version: 1,
    parentArtifactId: null,
    content,
    contentHash: hash,
    contextVersion: 3,
    producerType: 'system',
    producerId: 'test',
    producerClient: 'vitest',
    modelConfigId: null,
    taskId: null,
    reviewArtifactId: null,
    committedEntityIds: [],
    idempotencyKey: 'quality-test-key',
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
  }
}

const reportArtifact = artifact('quality-report-1', 'quality_report', report)
const planArtifact = artifact('repair-plan-1', 'repair_plan', plan)
const repairDraftArtifact = artifact('repair-draft-1', 'quality_repair_draft', repairDraft)
const repairReviewArtifact = artifact('repair-review-1', 'quality_repair_review', repairReview)
const comparison: AgentQualityRunComparison = {
  schemaVersion: 'agent-quality-comparison-v1',
  baselineReportArtifactId: 'quality-report-1',
  candidateReportArtifactId: 'quality-report-2',
  profileCompatible: true,
  scopeCompatible: true,
  status: 'improved',
  scoreDelta: 5,
  confidenceLowerBoundDelta: 4,
  coverageRateDelta: 0,
  closedFindings: [],
  persistingFindings: [],
  introducedFindings: [],
  introducedBlockerCount: 0,
  candidateStatus: 'passed',
  readyForHumanReview: true,
  summary: '质量改善。',
  warnings: [],
}

function dependencies() {
  return {
    runEvaluation: vi.fn(() => ({ reportArtifact, report, idempotentReplay: false })),
    runSemanticEvaluation: vi.fn(async () => ({
      sourceReportArtifact: reportArtifact,
      reportArtifact,
      report,
      idempotentReplay: false,
    })),
    proposeRepairs: vi.fn(() => ({
      sourceReportArtifact: reportArtifact,
      repairPlanArtifact: planArtifact,
      plan,
      idempotentReplay: false,
    })),
    applyRepairDraft: vi.fn(async () => ({
      repairPlanArtifact: planArtifact,
      repairDraftArtifact,
      draft: repairDraft,
      idempotentReplay: false,
    })),
    reviewRepairDraft: vi.fn(async () => ({
      repairDraftArtifact,
      reviewArtifact: repairReviewArtifact,
      review: repairReview,
      idempotentReplay: false,
    })),
    compareRuns: vi.fn(() => comparison),
  }
}

const actor = { type: 'codex' as const, actorId: 'codex-test', clientId: 'vitest' }
const allScopes = Object.values(AGENT_TOOL_SCOPES)

describe('quality tool adapter', () => {
  it('publishes the evidence, repair-plan and regression-comparison tools', async () => {
    const deps = dependencies()
    const registry = registerQualityTools(new AgentToolRegistry(), deps)
    expect(registry.list({ domain: 'quality' }).map((tool) => tool.id)).toEqual([
      'novelforge.quality.apply_repair_draft',
      'novelforge.quality.compare_runs',
      'novelforge.quality.propose_repairs',
      'novelforge.quality.review_repair_draft',
      'novelforge.quality.run_evaluation',
      'novelforge.quality.run_semantic_evaluation',
    ])

    const evaluation = await registry.invoke({
      toolId: 'novelforge.quality.run_evaluation',
      input: { novelId: 5, profile: 'longform_health_v1', idempotencyKey: 'quality-run-001' },
    }, { actor, scopes: allScopes })
    const semanticEvaluation = await registry.invoke({
      toolId: 'novelforge.quality.run_semantic_evaluation',
      input: { novelId: 5, reportArtifactId: 'quality-report-1', idempotencyKey: 'semantic-quality-run-001' },
    }, { actor, scopes: allScopes })
    const compared = await registry.invoke({
      toolId: 'novelforge.quality.compare_runs',
      input: { novelId: 5, baselineReportArtifactId: 'quality-report-1', candidateReportArtifactId: 'quality-report-2' },
    }, { actor, scopes: allScopes })
    const repairDraftCall = await registry.invoke({
      toolId: 'novelforge.quality.apply_repair_draft',
      input: { novelId: 5, repairPlanArtifactId: 'repair-plan-1', idempotencyKey: 'repair-draft-001' },
    }, { actor, scopes: allScopes })
    const repairReviewCall = await registry.invoke({
      toolId: 'novelforge.quality.review_repair_draft',
      input: { novelId: 5, repairDraftArtifactId: 'repair-draft-1', idempotencyKey: 'repair-review-001' },
    }, { actor, scopes: allScopes })

    expect(evaluation).toMatchObject({ ok: true, data: { report: { status: 'needs_revision' } } })
    expect(semanticEvaluation).toMatchObject({ ok: true, data: { sourceReportArtifact: { id: 'quality-report-1' } } })
    expect(compared).toMatchObject({ ok: true, data: { status: 'improved', readyForHumanReview: true } })
    expect(repairDraftCall).toMatchObject({ ok: true, data: { draft: { canonicalWriteAllowed: false } } })
    expect(repairReviewCall).toMatchObject({
      ok: true,
      data: { review: { independentModelReview: true, readyForHumanDecision: true } },
    })
  })

  it('requires quality:repair before creating a repair-plan artifact', async () => {
    const deps = dependencies()
    const registry = registerQualityTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.quality.propose_repairs',
      input: { novelId: 5, reportArtifactId: 'quality-report-1', idempotencyKey: 'repair-plan-001' },
    }, { actor, scopes: allScopes.filter((scope) => scope !== AGENT_TOOL_SCOPES.qualityRepair) })

    expect(result).toMatchObject({ ok: false, error: { code: 'AUTH_SCOPE_REQUIRED' } })
    expect(deps.proposeRepairs).not.toHaveBeenCalled()
  })

  it('maps stale reports to a stable tool error', async () => {
    const deps = dependencies()
    deps.proposeRepairs.mockImplementation(() => {
      throw new QualityWorkflowError('QUALITY_REPORT_STALE', '报告已过期。')
    })
    const registry = registerQualityTools(new AgentToolRegistry(), deps)
    const result = await registry.invoke({
      toolId: 'novelforge.quality.propose_repairs',
      input: { novelId: 5, reportArtifactId: 'quality-report-1', idempotencyKey: 'repair-plan-002' },
    }, { actor, scopes: allScopes })

    expect(result).toMatchObject({ ok: false, error: { code: 'QUALITY_REPORT_STALE' } })
  })
})
