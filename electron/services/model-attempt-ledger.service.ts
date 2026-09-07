import { getSqlite } from '../database/db'
import type { ModelRequestEvent, ModelRequestObserver } from '../../src/shared/model-call-telemetry'

export interface ModelAttemptLedgerSink extends ModelRequestObserver {
  getPersistenceFailures: () => readonly Error[]
}

function normalizePersistenceError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

export function createModelAttemptLedgerSink(input: {
  taskId?: number | null
  novelId?: number | null
  contextPackId?: string | null
}): ModelAttemptLedgerSink {
  const taskId = typeof input.taskId === 'number' ? input.taskId : null
  const novelId = typeof input.novelId === 'number' ? input.novelId : null
  const contextPackId = input.contextPackId?.trim() || null
  const persistenceFailures: Error[] = []

  const safely = (operation: () => void) => {
    try {
      operation()
    } catch (error) {
      persistenceFailures.push(normalizePersistenceError(error))
      throw error
    }
  }

  return {
    onRequestStart: (event) => safely(() => insertStartedAttempt(event, { taskId, novelId, contextPackId })),
    onRequestEnd: (event) => safely(() => finishAttempt(event)),
    getPersistenceFailures: () => [...persistenceFailures],
  }
}

function insertStartedAttempt(
  event: ModelRequestEvent,
  scope: { taskId: number | null; novelId: number | null; contextPackId: string | null },
): void {
  const sqlite = getSqlite()
  const insert = sqlite.transaction(() => {
    const attemptIndex = scope.taskId === null
      ? 1
      : Number((sqlite.prepare(`
          SELECT COALESCE(MAX(attempt_index), 0) + 1 AS next_index
          FROM model_request_attempts
          WHERE task_id = ?
        `).get(scope.taskId) as { next_index: number }).next_index)
    sqlite.prepare(`
      INSERT INTO model_request_attempts (
        request_id, task_id, novel_id, kind, provider, model_id,
        attempt_index, status, started_at, usage_json, completion_json,
        error_code, context_pack_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, NULL, NULL, ?)
    `).run(
      event.requestId,
      scope.taskId,
      scope.novelId,
      event.kind,
      event.provider,
      event.modelId,
      attemptIndex,
      new Date().toISOString(),
      serialize(event.usage),
      scope.contextPackId,
    )
  })
  insert.immediate()
}

function finishAttempt(event: ModelRequestEvent): void {
  if (event.status === 'started') return
  const sqlite = getSqlite()
  sqlite.prepare(`
    UPDATE model_request_attempts
    SET status = ?, finished_at = ?, usage_json = ?, completion_json = ?, error_code = ?
    WHERE request_id = ? AND status = 'started'
  `).run(
    event.status,
    new Date().toISOString(),
    serialize(event.usage),
    event.completion ? serialize(event.completion) : null,
    event.errorCode?.slice(0, 120) || null,
    event.requestId,
  )
}

export function interruptStartedModelAttempts(): number {
  const result = getSqlite().prepare(`
    UPDATE model_request_attempts
    SET status = 'interrupted',
        finished_at = ?,
        error_code = 'APP_RESTART_INTERRUPTED'
    WHERE status = 'started'
  `).run(new Date().toISOString())
  return Number(result.changes)
}

export function listModelAttemptsByTask(taskId: number) {
  return getSqlite().prepare(`
    SELECT *
    FROM model_request_attempts
    WHERE task_id = ?
    ORDER BY attempt_index ASC, request_id ASC
  `).all(taskId)
}
