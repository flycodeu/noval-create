import { describe, expect, it } from 'vitest'
import {
  RECOMMENDATION_POLICY,
  resolveRecommendationGateStatus,
  resolveRecommendationWorkState,
} from './recommendation-governance'

describe('recommendation evaluation policy', () => {
  it('keeps a serializing work eligible until its third failed external evaluation', () => {
    expect(resolveRecommendationWorkState('draft')).toBe('serializing')
    expect(resolveRecommendationGateStatus({
      workState: 'serializing',
      totalEvaluationCount: 2,
      failedEvaluationCount: 2,
      passedEvaluationCount: 0,
    })).toMatchObject({
      status: 'eligible',
      locked: false,
      remainingEvaluationCount: 1,
      failureLockThreshold: 3,
      canRecordExternalEvaluation: true,
    })

    expect(resolveRecommendationGateStatus({
      workState: 'serializing',
      totalEvaluationCount: 3,
      failedEvaluationCount: 3,
      passedEvaluationCount: 0,
    })).toMatchObject({
      status: 'recommendation_locked',
      locked: true,
      remainingEvaluationCount: 0,
      canRecordExternalEvaluation: false,
    })
  })

  it('locks a completed work after the first failure', () => {
    expect(resolveRecommendationWorkState('completed')).toBe('completed')
    expect(resolveRecommendationGateStatus({
      workState: 'completed',
      totalEvaluationCount: 1,
      failedEvaluationCount: 1,
      passedEvaluationCount: 0,
    })).toMatchObject({
      status: 'recommendation_locked',
      failureLockThreshold: 1,
      remainingEvaluationCount: 2,
      canRecordExternalEvaluation: false,
    })
  })

  it('keeps a completed-work failure locked after the project is reopened', () => {
    expect(resolveRecommendationGateStatus({
      workState: 'serializing',
      totalEvaluationCount: 1,
      failedEvaluationCount: 1,
      passedEvaluationCount: 0,
      completedFailureCount: 1,
    })).toMatchObject({
      status: 'recommendation_locked',
      failureLockThreshold: 1,
      canRecordExternalEvaluation: false,
    })
  })

  it('locks after a pass and declares that internal preflight never counts', () => {
    expect(RECOMMENDATION_POLICY).toMatchObject({
      maximumExternalEvaluations: 3,
      internalPreflightCountsAsEvaluation: false,
      countedSources: ['author_requested', 'platform_auto'],
    })
    expect(resolveRecommendationGateStatus({
      workState: 'serializing',
      totalEvaluationCount: 1,
      failedEvaluationCount: 0,
      passedEvaluationCount: 1,
    })).toMatchObject({ status: 'passed', locked: true, canRecordExternalEvaluation: false })
  })
})
