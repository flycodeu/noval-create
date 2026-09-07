import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createUnknownCallUsage, type ModelRequestEvent } from '../../src/shared/model-call-telemetry'

vi.mock('../database/db', () => ({ getSqlite: vi.fn() }))

import { getSqlite } from '../database/db'
import {
  createModelAttemptLedgerSink,
  interruptStartedModelAttempts,
  listModelAttemptsByTask,
} from './model-attempt-ledger.service'

interface AttemptRow {
  request_id: string
  task_id: number | null
  novel_id: number | null
  kind: string
  provider: string
  model_id: string
  attempt_index: number
  status: string
  started_at: string
  finished_at: string | null
  usage_json: string
  completion_json: string | null
  error_code: string | null
  context_pack_id: string | null
}

function buildFakeSqlite(options: { failInsert?: boolean } = {}) {
  const rows: AttemptRow[] = []
  const prepare = (sql: string) => {
    if (sql.includes('COALESCE(MAX(attempt_index)')) {
      return { get: (taskId: number) => ({ next_index: Math.max(0, ...rows.filter((row) => row.task_id === taskId).map((row) => row.attempt_index)) + 1 }) }
    }
    if (sql.includes('INSERT INTO model_request_attempts')) {
      return { run: (...values: unknown[]) => {
        if (options.failInsert) throw new Error('disk full')
        rows.push({
          request_id: String(values[0]), task_id: values[1] as number | null, novel_id: values[2] as number | null,
          kind: String(values[3]), provider: String(values[4]), model_id: String(values[5]), attempt_index: Number(values[6]),
          status: 'started', started_at: String(values[7]), finished_at: null, usage_json: String(values[8]),
          completion_json: null, error_code: null, context_pack_id: values[9] as string | null,
        })
        return { changes: 1 }
      } }
    }
    if (sql.includes("WHERE request_id = ? AND status = 'started'")) {
      return { run: (...values: unknown[]) => {
        const row = rows.find((item) => item.request_id === values[5] && item.status === 'started')
        if (!row) return { changes: 0 }
        row.status = String(values[0]); row.finished_at = String(values[1]); row.usage_json = String(values[2])
        row.completion_json = values[3] as string | null; row.error_code = values[4] as string | null
        return { changes: 1 }
      } }
    }
    if (sql.includes("SET status = 'interrupted'")) {
      return { run: (finishedAt: string) => {
        let changes = 0
        for (const row of rows.filter((item) => item.status === 'started')) {
          row.status = 'interrupted'; row.finished_at = finishedAt; row.error_code = 'APP_RESTART_INTERRUPTED'; changes += 1
        }
        return { changes }
      } }
    }
    if (sql.includes('WHERE task_id = ?')) {
      return { all: (taskId: number) => rows.filter((row) => row.task_id === taskId).sort((a, b) => a.attempt_index - b.attempt_index) }
    }
    throw new Error(`unexpected sql: ${sql}`)
  }
  const transaction = (operation: () => void) => Object.assign(() => operation(), { immediate: () => operation() })
  return { sqlite: { prepare, transaction }, rows }
}

function event(requestId: string, status: ModelRequestEvent['status'], output: number | null = null): ModelRequestEvent {
  const usage = createUnknownCallUsage()
  if (output !== null) usage.output = { value: output, source: 'reported' }
  return { requestId, kind: 'chat', provider: 'openai', modelId: 'gpt-test', status, usage, completion: null }
}

describe('model attempt ledger service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allocates monotonic task attempt indexes and finalizes each physical request', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 7, novelId: 3 })

    sink.onRequestStart?.(event('request-a', 'started'))
    sink.onRequestEnd?.(event('request-a', 'failed'))
    sink.onRequestStart?.(event('request-b', 'started'))
    sink.onRequestEnd?.(event('request-b', 'success', 12))

    expect(listModelAttemptsByTask(7)).toMatchObject([
      { request_id: 'request-a', attempt_index: 1, status: 'failed' },
      { request_id: 'request-b', attempt_index: 2, status: 'success' },
    ])
  })

  it('keeps the first terminal snapshot when completion is delivered repeatedly', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 9, novelId: 3 })
    sink.onRequestStart?.(event('request-once', 'started'))
    sink.onRequestEnd?.(event('request-once', 'success', 8))
    sink.onRequestEnd?.(event('request-once', 'success', 99))

    const [row] = listModelAttemptsByTask(9) as AttemptRow[]
    expect(row.status).toBe('success')
    expect(JSON.parse(row.usage_json).output.value).toBe(8)
  })

  it('interrupts only orphaned started attempts and is idempotent on repeat recovery', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 11, novelId: 3 })
    sink.onRequestStart?.(event('orphan', 'started'))
    sink.onRequestStart?.(event('done', 'started'))
    sink.onRequestEnd?.(event('done', 'success', 4))

    expect(interruptStartedModelAttempts()).toBe(1)
    expect(interruptStartedModelAttempts()).toBe(0)
    expect(fake.rows.find((row) => row.request_id === 'orphan')).toMatchObject({
      status: 'interrupted', error_code: 'APP_RESTART_INTERRUPTED',
    })
    expect(JSON.parse(fake.rows.find((row) => row.request_id === 'orphan')!.usage_json).input.value).toBeNull()
  })

  it('reports persistence failures without inventing a ledger row', () => {
    const fake = buildFakeSqlite({ failInsert: true })
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 13, novelId: 3 })

    expect(() => sink.onRequestStart?.(event('failed-write', 'started'))).toThrow('disk full')
    expect(sink.getPersistenceFailures()).toHaveLength(1)
    expect(fake.rows).toHaveLength(0)
  })
})
