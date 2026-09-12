/**
 * Shared logical content-revision quota. Physical provider retries are not
 * reservations: the caller reserves once, then may retry the same attemptKey.
 */
export const DEFAULT_REVISION_BUDGET_LIMIT = 2

export interface RevisionBudgetState {
  id: string
  limit: number
  used: number
  attemptKeys: string[]
}

export type RevisionBudgetErrorCode =
  | 'NF_REVISION_BUDGET_INVALID'
  | 'NF_REVISION_BUDGET_EXHAUSTED'
  | 'NF_REVISION_ATTEMPT_DUPLICATE'
  | 'NF_REVISION_ATTEMPT_INVALID'

export class RevisionBudgetError extends Error {
  readonly code: RevisionBudgetErrorCode
  readonly attemptKey?: string
  readonly budget: RevisionBudgetState

  constructor(
    code: RevisionBudgetErrorCode,
    message: string,
    budget: RevisionBudgetState,
    attemptKey?: string,
  ) {
    super(`${code}: ${message}`)
    this.name = 'RevisionBudgetError'
    this.code = code
    this.attemptKey = attemptKey
    this.budget = budget
  }
}

export interface LegacyRevisionAttempt {
  attemptKey?: unknown
  attemptNumber?: unknown
  taskId?: unknown
}

export interface LegacyRevisionBudgetDerivation {
  budget: RevisionBudgetState
  reliable: boolean
  reason: 'snapshot' | 'attempt_keys' | 'attempt_numbers' | 'task_ids' | 'unknown'
}

function normalizeLimit(value: unknown, fallback = DEFAULT_REVISION_BUDGET_LIMIT): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback
  return Math.max(1, Math.floor(value))
}

function normalizeAttemptKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((key): key is string => typeof key === 'string')
    .map((key) => key.trim())
    .filter(Boolean))]
}

export function createRevisionBudget(
  id: string,
  limit = DEFAULT_REVISION_BUDGET_LIMIT,
  used = 0,
  attemptKeys: readonly string[] = [],
): RevisionBudgetState {
  const normalizedLimit = normalizeLimit(limit)
  const normalizedKeys = normalizeAttemptKeys(attemptKeys)
  const normalizedUsed = Math.min(
    normalizedLimit,
    Math.max(normalizedKeys.length, Math.max(0, Math.floor(used))),
  )
  return {
    id: id.trim() || 'revision-budget',
    limit: normalizedLimit,
    used: normalizedUsed,
    attemptKeys: normalizedKeys.slice(0, normalizedUsed),
  }
}

/** Parse an optional persisted snapshot without silently granting extra quota. */
export function normalizeRevisionBudget(
  value: unknown,
  fallbackId = 'revision-budget',
): RevisionBudgetState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id.trim()) return null
  if (typeof record.used !== 'number' || !Number.isInteger(record.used) || record.used < 0) return null
  if (typeof record.limit !== 'number' || !Number.isInteger(record.limit) || record.limit < 1) return null
  const keys = normalizeAttemptKeys(record.attemptKeys)
  return createRevisionBudget(record.id || fallbackId, record.limit, record.used, keys)
}

export function hasRevisionBudget(state: RevisionBudgetState): boolean {
  return state.used < state.limit
}

export interface RevisionReservation {
  attemptKey: string
  budget: RevisionBudgetState
}

/** Synchronously reserve one logical content attempt before the model call. */
export function reserveRevisionAttempt(
  state: RevisionBudgetState,
  attemptKey: string,
): RevisionReservation {
  const key = typeof attemptKey === 'string' ? attemptKey.trim() : ''
  if (!key) throw new RevisionBudgetError(
    'NF_REVISION_ATTEMPT_INVALID',
    'attemptKey 不能为空。',
    state,
  )
  if (state.attemptKeys.includes(key)) throw new RevisionBudgetError(
    'NF_REVISION_ATTEMPT_DUPLICATE',
    `attemptKey 已经发起过：${key}`,
    state,
    key,
  )
  if (!hasRevisionBudget(state)) throw new RevisionBudgetError(
    'NF_REVISION_BUDGET_EXHAUSTED',
    `内容修订额度已用尽（${state.used}/${state.limit}）。`,
    state,
    key,
  )
  const budget = {
    ...state,
    used: state.used + 1,
    attemptKeys: [...state.attemptKeys, key],
  }
  return { attemptKey: key, budget }
}

/** Roll back only a reservation that has not reached the network. */
export function releaseUnstartedRevisionAttempt(
  state: RevisionBudgetState,
  attemptKey: string,
): RevisionBudgetState {
  const key = attemptKey.trim()
  if (!state.attemptKeys.includes(key)) return state
  return {
    ...state,
    used: Math.max(0, state.used - 1),
    attemptKeys: state.attemptKeys.filter((candidate) => candidate !== key),
  }
}

/**
 * A small mutable façade used by one pipeline run. The mutation is synchronous
 * and the onChange callback persists the immutable snapshot before the caller
 * starts its model request.
 */
export class RevisionBudgetController {
  private current: RevisionBudgetState
  private readonly allowAutomatic: boolean
  private readonly onChange?: (budget: RevisionBudgetState) => void

  constructor(
    initial: RevisionBudgetState,
    options: {
      allowAutomatic?: boolean
      onChange?: (budget: RevisionBudgetState) => void
    } = {},
  ) {
    this.current = createRevisionBudget(initial.id, initial.limit, initial.used, initial.attemptKeys)
    this.allowAutomatic = options.allowAutomatic !== false
    this.onChange = options.onChange
  }

  get snapshot(): RevisionBudgetState {
    return this.current
  }

  canReserve(): boolean {
    return this.allowAutomatic && hasRevisionBudget(this.current)
  }

  tryReserve(attemptKey: string): RevisionReservation | null {
    if (!this.allowAutomatic) return null
    try {
      const reservation = reserveRevisionAttempt(this.current, attemptKey)
      this.current = reservation.budget
      this.onChange?.(this.current)
      return reservation
    } catch (error) {
      if (error instanceof RevisionBudgetError
        && (error.code === 'NF_REVISION_BUDGET_EXHAUSTED'
          || error.code === 'NF_REVISION_ATTEMPT_DUPLICATE')) return null
      throw error
    }
  }

  releaseUnstarted(attemptKey: string): void {
    this.current = releaseUnstartedRevisionAttempt(this.current, attemptKey)
    this.onChange?.(this.current)
  }
}

/**
 * Recover quota from legacy snapshots only when the old data exposes an
 * unambiguous attempt key/number. Unknown legacy state is deliberately marked
 * unreliable so callers can route to human handling instead of filling quota.
 */
export function deriveRevisionBudgetFromLegacyAttempts(
  id: string,
  attempts: readonly LegacyRevisionAttempt[] | undefined,
  limit = DEFAULT_REVISION_BUDGET_LIMIT,
): LegacyRevisionBudgetDerivation {
  const list = attempts || []
  const explicitKeys = normalizeAttemptKeys(list.map((attempt) => attempt?.attemptKey))
  if (explicitKeys.length > 0) {
    return {
      budget: createRevisionBudget(id, limit, explicitKeys.length, explicitKeys),
      reliable: true,
      reason: 'attempt_keys',
    }
  }
  const numbers = [...new Set(list
    .map((attempt) => typeof attempt?.attemptNumber === 'number' && Number.isInteger(attempt.attemptNumber)
      ? attempt.attemptNumber
      : null)
    .filter((number): number is number => number !== null && number > 0))]
  if (numbers.length > 0) {
    const keys = numbers.sort((left, right) => left - right).map((number) => `legacy:${number}`)
    return {
      budget: createRevisionBudget(id, limit, keys.length, keys),
      reliable: true,
      reason: 'attempt_numbers',
    }
  }
  // Pre-NF-09 task rows do not carry logical attempt keys. Counting distinct
  // rewriter child tasks is conservative (physical retries may consume more
  // quota, never less) and prevents a restored run from silently resetting it.
  const taskIds = [...new Set(list
    .map((attempt) => typeof attempt?.taskId === 'number' && Number.isInteger(attempt.taskId)
      ? attempt.taskId
      : null)
    .filter((taskId): taskId is number => taskId !== null && taskId > 0))]
  if (taskIds.length > 0) {
    const keys = taskIds.sort((left, right) => left - right).map((taskId) => `legacy:rewriter-task:${taskId}`)
    return {
      budget: createRevisionBudget(id, limit, keys.length, keys),
      reliable: true,
      reason: 'task_ids',
    }
  }
  return {
    budget: createRevisionBudget(id, limit),
    reliable: false,
    reason: 'unknown',
  }
}

/** Best-effort derivation for pre-NF-09 pipeline snapshots. */
export function deriveRevisionBudgetFromLegacySnapshot(
  id: string,
  snapshot: unknown,
  limit = DEFAULT_REVISION_BUDGET_LIMIT,
): LegacyRevisionBudgetDerivation {
  const persisted = normalizeRevisionBudget(snapshot && typeof snapshot === 'object'
    ? (snapshot as Record<string, unknown>).revisionBudget
    : undefined, id)
  if (persisted) return { budget: persisted, reliable: true, reason: 'snapshot' }

  const role = snapshot && typeof snapshot === 'object'
    ? (snapshot as Record<string, unknown>).roles
    : undefined
  const rewriter = role && typeof role === 'object'
    ? (role as Record<string, unknown>).rewriter
    : undefined
  const rewriterTaskId = rewriter && typeof rewriter === 'object'
    ? (rewriter as Record<string, unknown>).taskId
    : undefined
  if (typeof rewriterTaskId === 'number' && Number.isInteger(rewriterTaskId) && rewriterTaskId > 0) {
    return {
      budget: createRevisionBudget(id, limit, 1, [`legacy:rewriter-task:${rewriterTaskId}`]),
      reliable: false,
      reason: 'unknown',
    }
  }
  return { budget: createRevisionBudget(id, limit), reliable: false, reason: 'unknown' }
}

/** A persisted logical budget outranks child-task counts, which cannot reconstruct shared attempt keys. */
export function restoreRevisionBudget(
  id: string,
  snapshot: unknown,
  attempts: readonly LegacyRevisionAttempt[] = [],
): LegacyRevisionBudgetDerivation {
  const saved = deriveRevisionBudgetFromLegacySnapshot(id, snapshot)
  if (saved.reliable) return saved
  const legacy = deriveRevisionBudgetFromLegacyAttempts(id, attempts)
  if (legacy.reliable) return legacy
  // Persist exhausted quota for unknown old state so a second recovery cannot reinterpret it as a fresh run.
  return { budget: createRevisionBudget(id, DEFAULT_REVISION_BUDGET_LIMIT, DEFAULT_REVISION_BUDGET_LIMIT), reliable: false, reason: 'unknown' }
}
