import type {
  LockRecommendationCandidateInput,
  RecommendationAttemptState,
  RecommendationCandidate,
  RecommendationPreflightResult,
  RecommendationWorkspaceSnapshot,
  RecordRecommendationEvaluationInput,
  RecordRecommendationEvaluationResult,
  RunRecommendationPreflightInput,
} from '../../src/shared/recommendation-governance'
import type { AgentToolJsonSchema } from '../../src/shared/tool-contracts'
import { AGENT_TOOL_SCOPES } from '../../src/shared/tool-contracts'
import {
  RecommendationGovernanceError,
  type RecommendationAuditContext,
} from './recommendation-governance-error'
import { AgentToolInvocationError, AgentToolRegistry } from './tool-registry'

export interface RecommendationToolDependencies {
  getAttemptState: (novelId: number) => RecommendationAttemptState
  getWorkspace: (novelId: number) => RecommendationWorkspaceSnapshot
  runPreflight: (input: RunRecommendationPreflightInput) => RecommendationPreflightResult
  lockCandidate: (input: LockRecommendationCandidateInput, context: RecommendationAuditContext) => RecommendationCandidate
  recordEvaluation: (input: RecordRecommendationEvaluationInput, context: RecommendationAuditContext) => RecordRecommendationEvaluationResult
}

type StateInput = Record<string, unknown> & { novelId: number }
type PreflightInput = Record<string, unknown> & RunRecommendationPreflightInput
type CandidateInput = Record<string, unknown> & LockRecommendationCandidateInput
type RecordEvaluationInput = Record<string, unknown> & RecordRecommendationEvaluationInput

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[],
  additionalProperties = false,
): AgentToolJsonSchema {
  return { type: 'object', properties, required, additionalProperties }
}

const positiveId: AgentToolJsonSchema = { type: 'integer', minimum: 1 }
const stringArray: AgentToolJsonSchema = { type: 'array', items: { type: 'string' } }
const auditObject: AgentToolJsonSchema = { type: 'object', additionalProperties: true }

const policySchema = objectSchema({
  policyId: { type: 'string', minLength: 1 },
  effectiveFrom: { type: 'string', minLength: 1 },
  maximumExternalEvaluations: { type: 'integer', minimum: 1 },
  serializingFailureLockThreshold: { type: 'integer', minimum: 1 },
  completedFailureLockThreshold: { type: 'integer', minimum: 1 },
  countedSources: { type: 'array', items: { enum: ['author_requested', 'platform_auto'] }, minItems: 2, maxItems: 2 },
  internalPreflightCountsAsEvaluation: { const: false },
  sourceAuthority: { const: 'user_provided_rule' },
  sourceNote: { type: 'string' },
}, [
  'policyId', 'effectiveFrom', 'maximumExternalEvaluations',
  'serializingFailureLockThreshold', 'completedFailureLockThreshold',
  'countedSources', 'internalPreflightCountsAsEvaluation', 'sourceAuthority', 'sourceNote',
])

const attemptSchema = objectSchema({
  id: positiveId,
  novelId: positiveId,
  candidateId: positiveId,
  source: { enum: ['author_requested', 'platform_auto'] },
  outcome: { enum: ['passed', 'failed'] },
  workStateAtEvaluation: { enum: ['serializing', 'completed'] },
  failureReason: { type: 'string' },
  evidenceCompleteness: { enum: ['complete', 'partial'] },
  evidence: auditObject,
  policy: policySchema,
  actorType: { type: 'string' },
  actorId: { type: 'string' },
  clientId: { type: 'string' },
  approvalId: { type: 'string' },
  confirmedBy: { type: 'string' },
  occurredAt: { type: 'string' },
  createdAt: { type: 'string' },
}, [
  'id', 'novelId', 'candidateId', 'source', 'outcome', 'workStateAtEvaluation', 'evidenceCompleteness',
  'evidence', 'policy', 'actorType', 'actorId', 'clientId', 'approvalId',
  'confirmedBy', 'occurredAt', 'createdAt',
])

export const recommendationAttemptStateSchema = objectSchema({
  novelId: positiveId,
  novelStatus: { type: 'string' },
  workState: { enum: ['serializing', 'completed'] },
  policy: policySchema,
  totalEvaluationCount: { type: 'integer', minimum: 0, maximum: 3 },
  failedEvaluationCount: { type: 'integer', minimum: 0, maximum: 3 },
  passedEvaluationCount: { type: 'integer', minimum: 0, maximum: 1 },
  remainingEvaluationCount: { type: 'integer', minimum: 0, maximum: 3 },
  failureLockThreshold: { type: 'integer', minimum: 1, maximum: 3 },
  status: { enum: ['eligible', 'passed', 'recommendation_locked', 'attempts_exhausted'] },
  locked: { type: 'boolean' },
  lockReason: { type: 'string' },
  canRecordExternalEvaluation: { type: 'boolean' },
  canRunInternalPreflight: { const: true },
  attempts: { type: 'array', items: attemptSchema, maxItems: 3 },
}, [
  'novelId', 'novelStatus', 'workState', 'policy', 'totalEvaluationCount',
  'failedEvaluationCount', 'passedEvaluationCount', 'remainingEvaluationCount',
  'failureLockThreshold', 'status', 'locked', 'canRecordExternalEvaluation',
  'canRunInternalPreflight', 'attempts',
])

const preflightEvidenceSchema = objectSchema({
  code: { type: 'string' },
  label: { type: 'string' },
  status: { enum: ['pass', 'warn', 'fail'] },
  value: { type: ['string', 'number', 'boolean'] },
  threshold: { type: ['string', 'number'] },
  detail: { type: 'string' },
}, ['code', 'label', 'status', 'value', 'detail'])

export const recommendationPreflightSchema = objectSchema({
  runId: positiveId,
  novelId: positiveId,
  profileVersion: { type: 'string' },
  status: { enum: ['ready', 'blocked'] },
  score: { type: 'integer', minimum: 0, maximum: 100 },
  confidenceLowerBound: { type: 'integer', minimum: 0, maximum: 100 },
  coverageRate: { type: 'integer', minimum: 0, maximum: 100 },
  blockers: stringArray,
  warnings: stringArray,
  evidence: { type: 'array', items: preflightEvidenceSchema },
  contextVersion: { type: 'integer', minimum: 1 },
  contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  countedExternalAttempt: { const: false },
  createdAt: { type: 'string' },
}, [
  'runId', 'novelId', 'profileVersion', 'status', 'score', 'confidenceLowerBound',
  'coverageRate', 'blockers', 'warnings', 'evidence', 'contextVersion',
  'contentHash', 'countedExternalAttempt', 'createdAt',
])

export const recommendationCandidateSchema = objectSchema({
  id: positiveId,
  novelId: positiveId,
  preflightRunId: positiveId,
  status: { const: 'locked' },
  contextVersion: { type: 'integer', minimum: 1 },
  contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
  snapshot: auditObject,
  actorType: { type: 'string' },
  actorId: { type: 'string' },
  clientId: { type: 'string' },
  approvalId: { type: 'string' },
  lockedAt: { type: 'string' },
  createdAt: { type: 'string' },
}, [
  'id', 'novelId', 'preflightRunId', 'status', 'contextVersion', 'contentHash',
  'snapshot', 'actorType', 'actorId', 'clientId', 'approvalId', 'lockedAt', 'createdAt',
])

function auditContext(context: { actor: RecommendationAuditContext['actor']; approvalId?: string }): RecommendationAuditContext {
  return { actor: context.actor, approvalId: context.approvalId || '' }
}

function mapGovernanceError(error: unknown): never {
  if (error instanceof RecommendationGovernanceError) {
    throw new AgentToolInvocationError(error.code, error.message, { detail: error.detail })
  }
  throw error
}

export function registerRecommendationTools(
  registry: AgentToolRegistry,
  dependencies: RecommendationToolDependencies,
): AgentToolRegistry {
  registry.register<StateInput, RecommendationAttemptState>({
    descriptor: {
      id: 'novelforge.recommendation.get_attempt_state',
      version: '1.0.0',
      domain: 'recommendation',
      title: '读取推荐评估计次状态',
      description: '读取作者主动评估与平台自动评估的累计次数、失败次数、剩余次数和锁定原因；内部预检不会出现在计次中。',
      inputSchema: objectSchema({ novelId: positiveId }, ['novelId']),
      outputSchema: recommendationAttemptStateSchema,
      effect: 'read',
      approval: 'never',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.recommendationRead],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['recommendation', 'attempts', 'policy', 'lock-state'],
    },
    handler: (input) => {
      try {
        return dependencies.getAttemptState(input.novelId)
      } catch (error) {
        return mapGovernanceError(error)
      }
    },
  })

  registry.register<StateInput, RecommendationWorkspaceSnapshot>({
    descriptor: {
      id: 'novelforge.recommendation.get_workspace',
      version: '1.0.0',
      domain: 'recommendation',
      title: '读取推荐治理工作区',
      description: '一次读取真实评估计次状态、最新内部预检与最新锁定候选，供质量页和智能体恢复推荐工作流。',
      inputSchema: objectSchema({ novelId: positiveId }, ['novelId']),
      outputSchema: objectSchema({
        state: recommendationAttemptStateSchema,
        latestPreflight: { anyOf: [recommendationPreflightSchema, { type: 'null' }] },
        latestCandidate: { anyOf: [recommendationCandidateSchema, { type: 'null' }] },
      }, ['state', 'latestPreflight', 'latestCandidate']),
      effect: 'read',
      approval: 'never',
      scopes: [AGENT_TOOL_SCOPES.novelRead, AGENT_TOOL_SCOPES.recommendationRead],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['recommendation', 'workspace', 'preflight', 'candidate', 'attempts'],
    },
    handler: (input) => {
      try {
        return dependencies.getWorkspace(input.novelId)
      } catch (error) {
        return mapGovernanceError(error)
      }
    },
  })

  registry.register<PreflightInput, RecommendationPreflightResult>({
    descriptor: {
      id: 'novelforge.recommendation.run_preflight',
      version: '1.0.0',
      domain: 'recommendation',
      title: '运行不计次推荐预检',
      description: '使用本地质量看板、完整性扫描和保守置信阈值生成可审计预检；该运行永远不计入最多三次外部评估。',
      inputSchema: objectSchema({
        novelId: positiveId,
        profileVersion: { type: 'string', minLength: 1, maxLength: 120 },
      }, ['novelId']),
      outputSchema: recommendationPreflightSchema,
      effect: 'draft_write',
      approval: 'policy',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.qualityRun,
        AGENT_TOOL_SCOPES.recommendationRead,
      ],
      idempotent: false,
      taskMode: 'sync',
      timeoutClass: 'workflow',
      tags: ['recommendation', 'preflight', 'quality-gate', 'not-counted'],
    },
    handler: (input) => {
      try {
        return dependencies.runPreflight(input)
      } catch (error) {
        return mapGovernanceError(error)
      }
    },
  })

  registry.register<CandidateInput, RecommendationCandidate>({
    descriptor: {
      id: 'novelforge.recommendation.lock_candidate',
      version: '1.0.0',
      domain: 'recommendation',
      title: '锁定推荐候选稿',
      description: '在预检通过且上下文/内容哈希未变化时锁定不可变候选清单；锁定本身不计入外部评估次数。',
      inputSchema: objectSchema({
        novelId: positiveId,
        preflightRunId: positiveId,
        expectedContextVersion: { type: 'integer', minimum: 1 },
        expectedContentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      }, ['novelId', 'preflightRunId', 'expectedContextVersion', 'expectedContentHash']),
      outputSchema: recommendationCandidateSchema,
      effect: 'canonical_write',
      approval: 'always',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.contextRead,
        AGENT_TOOL_SCOPES.recommendationRead,
        AGENT_TOOL_SCOPES.recommendationRecord,
      ],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['recommendation', 'candidate', 'snapshot', 'approval-required'],
    },
    handler: (input, context) => {
      try {
        return dependencies.lockCandidate(input, auditContext(context))
      } catch (error) {
        return mapGovernanceError(error)
      }
    },
  })

  registry.register<RecordEvaluationInput, RecordRecommendationEvaluationResult>({
    descriptor: {
      id: 'novelforge.recommendation.record_result',
      version: '1.0.0',
      domain: 'recommendation',
      title: '记录外部推荐评估结果',
      description: '经人工确认后追加记录作者主动或平台自动评估结果，并在同一事务中重算次数与失败锁定状态；不会自动发起下一次评估。',
      inputSchema: objectSchema({
        novelId: positiveId,
        candidateId: positiveId,
        source: { enum: ['author_requested', 'platform_auto'] },
        outcome: { enum: ['passed', 'failed'] },
        confirmedBy: { type: 'string', minLength: 1, maxLength: 200 },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
        occurredAt: { type: 'string', maxLength: 80 },
        failureReason: { type: 'string', maxLength: 4000 },
        evidenceCompleteness: { enum: ['complete', 'partial'] },
        evidence: auditObject,
      }, ['novelId', 'candidateId', 'source', 'outcome', 'confirmedBy', 'idempotencyKey']),
      outputSchema: objectSchema({
        attempt: attemptSchema,
        state: recommendationAttemptStateSchema,
        idempotentReplay: { type: 'boolean' },
      }, ['attempt', 'state', 'idempotentReplay']),
      effect: 'canonical_write',
      approval: 'always',
      scopes: [
        AGENT_TOOL_SCOPES.novelRead,
        AGENT_TOOL_SCOPES.recommendationRead,
        AGENT_TOOL_SCOPES.recommendationRecord,
        AGENT_TOOL_SCOPES.auditRead,
      ],
      idempotent: true,
      taskMode: 'sync',
      timeoutClass: 'short',
      tags: ['recommendation', 'external-evaluation', 'audit', 'approval-required', 'idempotent'],
    },
    handler: (input, context) => {
      try {
        return dependencies.recordEvaluation(input, auditContext(context))
      } catch (error) {
        return mapGovernanceError(error)
      }
    },
  })

  return registry
}
