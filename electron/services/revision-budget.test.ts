import { describe, expect, it } from 'vitest'
import {
  createRevisionBudget,
  deriveRevisionBudgetFromLegacyAttempts,
  deriveRevisionBudgetFromLegacySnapshot,
  RevisionBudgetController,
  RevisionBudgetError,
  releaseUnstartedRevisionAttempt,
  reserveRevisionAttempt,
} from './revision-budget'

describe('revision budget', () => {
  it('atomically reserves at most two logical content attempts', () => {
    let budget = createRevisionBudget('chapter:1')
    budget = reserveRevisionAttempt(budget, 'rewriter:1').budget
    budget = reserveRevisionAttempt(budget, 'rewriter:2').budget

    expect(budget).toEqual({
      id: 'chapter:1',
      limit: 2,
      used: 2,
      attemptKeys: ['rewriter:1', 'rewriter:2'],
    })
    expect(() => reserveRevisionAttempt(budget, 'publish-gate:1')).toThrowError(
      expect.objectContaining({ code: 'NF_REVISION_BUDGET_EXHAUSTED' }),
    )
  })

  it('does not reserve the same attempt twice, including after recovery', () => {
    const budget = reserveRevisionAttempt(createRevisionBudget('chapter:2'), 'rewriter:2').budget
    expect(() => reserveRevisionAttempt(budget, 'rewriter:2')).toThrowError(
      expect.objectContaining({ code: 'NF_REVISION_ATTEMPT_DUPLICATE' }),
    )
    expect(budget.used).toBe(1)
  })

  it('allows a preflight rollback but never requires rollback for a started attempt', () => {
    const budget = reserveRevisionAttempt(createRevisionBudget('chapter:3'), 'rewriter:1').budget
    const rolledBack = releaseUnstartedRevisionAttempt(budget, 'rewriter:1')
    expect(rolledBack).toMatchObject({ used: 0, attemptKeys: [] })
    expect(releaseUnstartedRevisionAttempt(rolledBack, 'started-later')).toBe(rolledBack)
  })

  it('counts provider retry as one content attempt when the controller is reused', () => {
    const changes: string[] = []
    const controller = new RevisionBudgetController(createRevisionBudget('chapter:4'), {
      onChange: (budget) => changes.push(`${budget.used}:${budget.attemptKeys.join(',')}`),
    })
    expect(controller.tryReserve('rewriter:1')).not.toBeNull()
    // The physical retry deliberately does not call tryReserve again.
    expect(controller.tryReserve('rewriter:1')).toBeNull()
    expect(controller.snapshot.used).toBe(1)
    expect(changes).toEqual(['1:rewriter:1'])
  })

  it('keeps legacy recovery conservative when attempt evidence is missing', () => {
    const derived = deriveRevisionBudgetFromLegacySnapshot('chapter:5', {
      roles: { rewriter: { status: 'failed', taskId: 77 } },
    })
    expect(derived.reliable).toBe(false)
    expect(derived.budget.used).toBe(1)
    expect(deriveRevisionBudgetFromLegacySnapshot('chapter:6', {}).reliable).toBe(false)
  })

  it('derives a reliable used count from explicit legacy attempt keys', () => {
    const derived = deriveRevisionBudgetFromLegacyAttempts('chapter:7', [
      { attemptKey: 'a' },
      { attemptKey: 'a' },
      { attemptKey: 'b' },
    ])
    expect(derived).toMatchObject({ reliable: true, reason: 'attempt_keys' })
    expect(derived.budget).toMatchObject({ used: 2, attemptKeys: ['a', 'b'] })
  })

  it('09-06: conservatively derives restored usage from existing rewriter child task ids', () => {
    const derived = deriveRevisionBudgetFromLegacyAttempts('legacy-run', [
      { taskId: 71 },
      { taskId: 72 },
      { taskId: 72 },
    ])

    expect(derived).toMatchObject({ reliable: true, reason: 'task_ids' })
    expect(derived.budget).toMatchObject({ used: 2, attemptKeys: [
      'legacy:rewriter-task:71',
      'legacy:rewriter-task:72',
    ] })
  })

  it('retains typed errors for callers that need human handling', () => {
    const budget = createRevisionBudget('chapter:8', 1)
    let thrown: unknown
    try {
      reserveRevisionAttempt(reserveRevisionAttempt(budget, 'one').budget, 'two')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RevisionBudgetError)
    expect((thrown as RevisionBudgetError).code).toBe('NF_REVISION_BUDGET_EXHAUSTED')
  })
})
