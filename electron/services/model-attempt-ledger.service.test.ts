import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createUnknownCallUsage, type ModelRequestEvent } from '../../src/shared/model-call-telemetry'

vi.mock('../database/db', () => ({ getSqlite: vi.fn() }))

import { getSqlite } from '../database/db'
import {
  createModelAttemptLedgerSink,
  interruptStartedModelAttempts,
  listModelAttemptsByTask,
  MAX_RECORDED_MODEL_OUTPUT_CHARS,
  MAX_RECORDED_MODEL_PROMPT_CHARS,
  snapshotModelPrompt,
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
  prompt_hash: string | null
  prompt_text: string | null
  prompt_truncated: number
  options_json: string | null
  output_text: string | null
  output_sha256: string | null
  output_chars: number
  output_truncated: number
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
          prompt_hash: values[10] as string | null, output_text: null, output_sha256: null,
          prompt_text: values[11] as string | null, prompt_truncated: Number(values[12]),
          options_json: values[13] as string | null,
          output_chars: 0, output_truncated: 0,
        })
        return { changes: 1 }
      } }
    }
    if (sql.includes("WHERE request_id = ? AND status = 'started'")) {
      return { run: (...values: unknown[]) => {
        const row = rows.find((item) => item.request_id === values[9] && item.status === 'started')
        if (!row) return { changes: 0 }
        row.status = String(values[0]); row.finished_at = String(values[1]); row.usage_json = String(values[2])
        row.completion_json = values[3] as string | null; row.error_code = values[4] as string | null
        if (values[5] !== null) {
          row.output_text = values[5] as string
          row.output_sha256 = values[6] as string
          row.output_chars = Number(values[7])
          row.output_truncated = Number(values[8])
        }
        return { changes: 1 }
      } }
    }
    if (sql.includes('SET output_text = ?')) {
      return { run: (...values: unknown[]) => {
        const row = rows.find((item) => item.request_id === values[4])
        if (!row) return { changes: 0 }
        row.output_text = values[0] as string
        row.output_sha256 = values[1] as string
        row.output_chars = Number(values[2])
        row.output_truncated = Number(values[3])
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

  it('stores each chat result beside its prompt fingerprint without request headers', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 15, novelId: 3, promptHash: `sha256:${'a'.repeat(64)}`, promptText: '<user>写作</user>' })
    sink.onRequestStart?.(event('chat-one', 'started'))
    sink.onRequestEnd?.(event('chat-one', 'success'))
    sink.recordOutput('第一稿')
    sink.onRequestStart?.(event('chat-two', 'started'))
    sink.onRequestEnd?.(event('chat-two', 'success'))
    sink.recordOutput('第二稿')

    expect(listModelAttemptsByTask(15)).toMatchObject([
      { output_text: '第一稿', prompt_hash: `sha256:${'a'.repeat(64)}`, prompt_text: '<user>写作</user>', output_chars: 3 },
      { output_text: '第二稿', prompt_hash: `sha256:${'a'.repeat(64)}`, prompt_text: '<user>写作</user>', output_chars: 3 },
    ])
    expect(JSON.stringify(fake.rows)).not.toContain('Authorization')
  })

  it('keeps partial stream output when the physical request fails', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 16 })
    sink.onRequestStart?.(event('stream-partial', 'started'))
    sink.appendOutput('半段')
    sink.appendOutput('正文')
    sink.onRequestEnd?.(event('stream-partial', 'failed'))

    expect(listModelAttemptsByTask(16)).toMatchObject([{
      status: 'failed', output_text: '半段正文', output_chars: 4,
      output_sha256: createHash('sha256').update('半段正文').digest('hex'),
      output_truncated: 0,
    }])
  })

  it('hashes streamed Unicode correctly when a surrogate pair crosses chunks', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 18 })
    const emoji = '📝'
    sink.onRequestStart?.(event('unicode-stream', 'started'))
    sink.appendOutput(emoji.slice(0, 1))
    sink.appendOutput(emoji.slice(1))
    sink.onRequestEnd?.(event('unicode-stream', 'success'))
    expect((listModelAttemptsByTask(18) as AttemptRow[])[0]).toMatchObject({
      output_text: emoji,
      output_sha256: createHash('sha256').update(emoji).digest('hex'),
    })
  })

  it('snapshots actual prompt messages within a size limit and redacts common credential forms', () => {
    const secret = 'sk-' + 'q'.repeat(24)
    const snapshot = snapshotModelPrompt([
      { role: 'user', content: `写作，OPENAI_API_KEY=${secret}；Bearer ${secret}` },
    ], '遵守章节合同')
    expect(snapshot.promptText).toContain('遵守章节合同')
    expect(snapshot.promptText).toContain('写作')
    expect(snapshot.promptText).not.toContain(secret)
    expect(snapshot.promptHash).toMatch(/^sha256:[a-f0-9]{64}$/)

    const large = snapshotModelPrompt([{ role: 'user', content: '章'.repeat(MAX_RECORDED_MODEL_PROMPT_CHARS) }])
    expect(large.promptText.length).toBe(MAX_RECORDED_MODEL_PROMPT_CHARS)
    expect(large.promptTruncated).toBe(true)
  })

  it('bounds stored output while retaining exact original length and digest', () => {
    const fake = buildFakeSqlite()
    vi.mocked(getSqlite).mockReturnValue(fake.sqlite as never)
    const sink = createModelAttemptLedgerSink({ taskId: 17 })
    const secret = `sk-${'k'.repeat(24)}`
    const output = secret + '正'.repeat(MAX_RECORDED_MODEL_OUTPUT_CHARS)
    sink.onRequestStart?.(event('large-chat', 'started'))
    sink.onRequestEnd?.(event('large-chat', 'success'))
    sink.recordOutput(output)

    const [row] = listModelAttemptsByTask(17) as AttemptRow[]
    expect(row.output_text).not.toContain(secret)
    expect(row.output_text!.length).toBe(MAX_RECORDED_MODEL_OUTPUT_CHARS)
    expect(row.output_truncated).toBe(1)
    expect(row.output_chars).toBe(output.length)
    expect(row.output_sha256).toBe(createHash('sha256').update(output).digest('hex'))
  })
})
