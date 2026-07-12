export type RecommendationEvaluationSource = 'author_requested' | 'platform_auto'
export type RecommendationEvaluationOutcome = 'passed' | 'failed'
export type RecommendationWorkState = 'serializing' | 'completed'
export type RecommendationGateStatus =
  | 'eligible'
  | 'passed'
  | 'recommendation_locked'
  | 'attempts_exhausted'
export type RecommendationPreflightStatus = 'ready' | 'blocked'

export interface RecommendationPolicySnapshot {
  policyId: string
  effectiveFrom: string
  maximumExternalEvaluations: number
  serializingFailureLockThreshold: number
  completedFailureLockThreshold: number
  countedSources: RecommendationEvaluationSource[]
  internalPreflightCountsAsEvaluation: false
  sourceAuthority: 'user_provided_rule'
  sourceNote: string
}

export interface RecommendationEvaluationAttempt {
  id: number
  novelId: number
  candidateId: number
  source: RecommendationEvaluationSource
  outcome: RecommendationEvaluationOutcome
  workStateAtEvaluation: RecommendationWorkState
  failureReason?: string
  evidenceCompleteness: 'complete' | 'partial'
  evidence: Record<string, unknown>
  policy: RecommendationPolicySnapshot
  actorType: string
  actorId: string
  clientId: string
  approvalId: string
  confirmedBy: string
  occurredAt: string
  createdAt: string
}

export interface RecommendationAttemptState {
  novelId: number
  novelStatus: string
  workState: RecommendationWorkState
  policy: RecommendationPolicySnapshot
  totalEvaluationCount: number
  failedEvaluationCount: number
  passedEvaluationCount: number
  remainingEvaluationCount: number
  failureLockThreshold: number
  status: RecommendationGateStatus
  locked: boolean
  lockReason?: string
  canRecordExternalEvaluation: boolean
  canRunInternalPreflight: true
  attempts: RecommendationEvaluationAttempt[]
}

export type RecommendationPreflightCheckStatus = 'pass' | 'warn' | 'fail'

export interface RecommendationPreflightEvidence {
  code: string
  label: string
  status: RecommendationPreflightCheckStatus
  value: string | number | boolean
  threshold?: string | number
  detail: string
}

export interface RecommendationPreflightResult {
  runId: number
  novelId: number
  profileVersion: string
  status: RecommendationPreflightStatus
  score: number
  confidenceLowerBound: number
  coverageRate: number
  blockers: string[]
  warnings: string[]
  evidence: RecommendationPreflightEvidence[]
  contextVersion: number
  contentHash: string
  countedExternalAttempt: false
  createdAt: string
}

export interface RunRecommendationPreflightInput {
  novelId: number
  profileVersion?: string
}

export interface LockRecommendationCandidateInput {
  novelId: number
  preflightRunId: number
  expectedContextVersion: number
  expectedContentHash: string
}

export interface RecommendationCandidate {
  id: number
  novelId: number
  preflightRunId: number
  status: 'locked'
  contextVersion: number
  contentHash: string
  snapshot: Record<string, unknown>
  actorType: string
  actorId: string
  clientId: string
  approvalId: string
  lockedAt: string
  createdAt: string
}

export interface RecordRecommendationEvaluationInput {
  novelId: number
  candidateId: number
  source: RecommendationEvaluationSource
  outcome: RecommendationEvaluationOutcome
  confirmedBy: string
  idempotencyKey: string
  occurredAt?: string
  failureReason?: string
  evidenceCompleteness?: 'complete' | 'partial'
  evidence?: Record<string, unknown>
}

export interface RecordRecommendationEvaluationResult {
  attempt: RecommendationEvaluationAttempt
  state: RecommendationAttemptState
  idempotentReplay: boolean
}

export interface RecommendationWorkspaceSnapshot {
  state: RecommendationAttemptState
  latestPreflight: RecommendationPreflightResult | null
  latestCandidate: RecommendationCandidate | null
}

export const RECOMMENDATION_POLICY: RecommendationPolicySnapshot = Object.freeze({
  policyId: 'platform-recommendation-2026-07',
  effectiveFrom: '2026-07-01',
  maximumExternalEvaluations: 3,
  serializingFailureLockThreshold: 3,
  completedFailureLockThreshold: 1,
  countedSources: ['author_requested', 'platform_auto'] as RecommendationEvaluationSource[],
  internalPreflightCountsAsEvaluation: false,
  sourceAuthority: 'user_provided_rule',
  sourceNote: '规则由项目负责人提供；取得平台官方政策链接后应更新本说明与政策快照。',
})

export const RECOMMENDATION_PREFLIGHT_PROFILE = 'novelforge-recommendation-v1'

export function resolveRecommendationWorkState(novelStatus: string | null | undefined): RecommendationWorkState {
  return (novelStatus || '').trim().toLowerCase() === 'completed' ? 'completed' : 'serializing'
}

export function resolveRecommendationGateStatus(input: {
  workState: RecommendationWorkState
  totalEvaluationCount: number
  failedEvaluationCount: number
  passedEvaluationCount: number
  completedFailureCount?: number
  policy?: RecommendationPolicySnapshot
}): Pick<RecommendationAttemptState, 'status' | 'locked' | 'lockReason' | 'remainingEvaluationCount' | 'failureLockThreshold' | 'canRecordExternalEvaluation'> {
  const policy = input.policy || RECOMMENDATION_POLICY
  const remainingEvaluationCount = Math.max(0, policy.maximumExternalEvaluations - input.totalEvaluationCount)
  const hasHistoricalCompletedFailure = (input.completedFailureCount || 0) > 0
  const failureLockThreshold = input.workState === 'completed' || hasHistoricalCompletedFailure
    ? policy.completedFailureLockThreshold
    : policy.serializingFailureLockThreshold

  if (input.passedEvaluationCount > 0) {
    return {
      status: 'passed',
      locked: true,
      lockReason: '已有一次真实外部评估通过；不可继续追加推荐评估。',
      remainingEvaluationCount,
      failureLockThreshold,
      canRecordExternalEvaluation: false,
    }
  }
  if (input.failedEvaluationCount >= failureLockThreshold) {
    return {
      status: 'recommendation_locked',
      locked: true,
      lockReason: input.workState === 'completed' || hasHistoricalCompletedFailure
        ? '完结作品在第一次真实外部评估失败后锁定。'
        : '连载作品在三次真实外部评估均失败后锁定。',
      remainingEvaluationCount,
      failureLockThreshold,
      canRecordExternalEvaluation: false,
    }
  }
  if (remainingEvaluationCount === 0) {
    return {
      status: 'attempts_exhausted',
      locked: true,
      lockReason: '真实外部评估已达到最多三次。',
      remainingEvaluationCount,
      failureLockThreshold,
      canRecordExternalEvaluation: false,
    }
  }
  return {
    status: 'eligible',
    locked: false,
    remainingEvaluationCount,
    failureLockThreshold,
    canRecordExternalEvaluation: true,
  }
}
