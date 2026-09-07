import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
  getSqlite: vi.fn(),
}))

vi.mock('./model.service', () => ({
  createAdapter: vi.fn(),
  getDefaultModelConfigRecord: vi.fn(),
  getModelConfigRecord: vi.fn(),
  getModelProviderOptions: vi.fn(),
  getProviderTokenSafetyMarginPct: vi.fn(() => 5),
  getProviderRuntimeDefaults: vi.fn(() => ({ temperature: 0.85, maxTokens: 4096 })),
}))

import { getDb, getSqlite } from '../database/db'
import { createAdapter, getModelConfigRecord, getModelProviderOptions } from './model.service'
import { OpenAIAdapter } from '../adapters/openai.adapter'
import {
  cancelTask,
  executeChatTask,
  executeStreamTask,
  isTransientModelNetworkError,
  recoverOrphanedTasks,
  shouldRetryTransientModelTaskError,
} from './task.service'

function buildFakeDb(rows: unknown[], whereResults: unknown[][] = []) {
  let whereCall = 0
  const updates: Array<Record<string, unknown>> = []
  const db = {
    select: () => ({
      from: () => ({
        all: () => rows,
        where: () => ({
          all: () => whereResults[whereCall++] || [],
        }),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => ({
          run: () => {
            updates.push(data)
          },
        }),
      }),
    }),
  }
  return { db, updates }
}

function buildError(message: string, code?: string, cause?: unknown): Error {
  const error = new Error(message) as Error & { code?: string; cause?: unknown }
  if (code) error.code = code
  if (cause) error.cause = cause
  return error
}

function buildLedgerSqlite() {
  const rows: Array<Record<string, unknown>> = []
  const prepare = (sql: string) => {
    if (sql.includes('COALESCE(MAX(attempt_index)')) return { get: (taskId: number) => ({
      next_index: Math.max(0, ...rows.filter((row) => row.task_id === taskId).map((row) => Number(row.attempt_index))) + 1,
    }) }
    if (sql.includes('INSERT INTO model_request_attempts')) return { run: (...values: unknown[]) => {
      rows.push({ request_id: values[0], task_id: values[1], attempt_index: values[6], status: 'started', usage_json: values[8] })
      return { changes: 1 }
    } }
    if (sql.includes("WHERE request_id = ? AND status = 'started'")) return { run: (...values: unknown[]) => {
      const row = rows.find((item) => item.request_id === values[5] && item.status === 'started')
      if (!row) return { changes: 0 }
      Object.assign(row, { status: values[0], usage_json: values[2], completion_json: values[3], error_code: values[4] })
      return { changes: 1 }
    } }
    throw new Error(`unexpected ledger sql: ${sql}`)
  }
  return {
    rows,
    sqlite: { prepare, transaction: (operation: () => void) => ({ immediate: operation }) },
  }
}

function configureTaskRuntime(adapter: OpenAIAdapter, overrides: Record<string, unknown> = {}) {
  vi.mocked(getModelConfigRecord).mockReturnValue({
    id: 2, provider: 'openai', modelId: 'test-model', maxConcurrency: 1, temperature: 0.8, maxTokens: 100,
    ...overrides,
  } as never)
  vi.mocked(getModelProviderOptions).mockReturnValue(undefined)
  vi.mocked(createAdapter).mockReturnValue(adapter)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.mocked(getSqlite).mockReturnValue({
    prepare: () => ({ run: () => ({ changes: 0 }) }),
  } as never)
})

describe('task service transient retry policy', () => {
  it('recognizes nested undici socket termination as transient', () => {
    const error = buildError(
      '模型服务连接不稳定',
      undefined,
      buildError('other side closed', 'UND_ERR_SOCKET'),
    )

    expect(isTransientModelNetworkError(error)).toBe(true)
  })

  it('retries retryable tasks for transient model network errors', () => {
    const error = buildError('terminated')

    expect(shouldRetryTransientModelTaskError(error, {
      retryable: true,
      attemptNumber: 0,
    })).toBe(true)
  })

  it('does not retry after the task-level transient retry limit', () => {
    const error = buildError('terminated')

    expect(shouldRetryTransientModelTaskError(error, {
      retryable: true,
      attemptNumber: 2,
    })).toBe(false)
  })

  it('does not retry non-retryable tasks or streams with partial output', () => {
    const error = buildError('terminated')

    expect(shouldRetryTransientModelTaskError(error, {
      retryable: false,
      attemptNumber: 0,
    })).toBe(false)
    expect(shouldRetryTransientModelTaskError(error, {
      retryable: true,
      attemptNumber: 0,
      receivedOutput: true,
    })).toBe(false)
  })

  it('does not retry non-network business failures', () => {
    expect(shouldRetryTransientModelTaskError(new Error('AI JSON 解析失败'), {
      retryable: true,
      attemptNumber: 0,
    })).toBe(false)
  })

  it('rejects an oversized final request before the adapter is called', async () => {
    const task = { id: 46, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    const adapter = new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1', 8_000, 0.8, 100)
    const chat = vi.spyOn(adapter, 'chat').mockResolvedValue('should-not-run')
    configureTaskRuntime(adapter, { maxContextTokens: 8_000 })

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer',
      novelId: task.novelId,
      modelConfigId: 2,
      messages: [{ role: 'user', content: 'x'.repeat(30_000) }],
      chatOpts: { maxTokens: 2_000 },
    })).rejects.toMatchObject({ code: 'NF_REQUEST_BUDGET_EXCEEDED' })

    expect(chat).not.toHaveBeenCalled()
    expect(fakeTaskDb.updates.at(-1)).toMatchObject({ status: 'failed' })
  })

  it('runs prepareInput once, then rechecks the final messages', async () => {
    const task = { id: 47, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    const adapter = new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1', 20_000, 0.8, 100)
    const chat = vi.spyOn(adapter, 'chat').mockResolvedValue('should-not-run')
    configureTaskRuntime(adapter, { maxContextTokens: 20_000 })
    const prepareInput = vi.fn(async () => ({
      messages: [{ role: 'user' as const, content: 'x'.repeat(100_000) }],
      diagnostics: { removedOptional: 1 },
    }))

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer',
      novelId: task.novelId,
      modelConfigId: 2,
      messages: [{ role: 'user', content: 'short' }],
      chatOpts: { maxTokens: 2_000 },
      prepareInput,
    })).rejects.toMatchObject({ code: 'NF_REQUEST_BUDGET_EXCEEDED' })

    expect(prepareInput).toHaveBeenCalledOnce()
    expect(chat).not.toHaveBeenCalled()
  })

  it('allows prepareInput to trim once while preserving the actual maxTokens override', async () => {
    const task = { id: 48, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    const adapter = new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1', 8_000, 0.8, 100)
    const chat = vi.spyOn(adapter, 'chat').mockImplementation(async (_messages, opts) => {
      expect(opts?.maxTokens).toBe(2_000)
      return 'ok'
    })
    configureTaskRuntime(adapter, { maxContextTokens: 8_000 })
    const prepareInput = vi.fn(async (request: { budgetReport: { allowed: boolean } }) => {
      expect(request.budgetReport.allowed).toBe(false)
      return {
        messages: [{ role: 'user' as const, content: 'trimmed' }],
        diagnostics: { removedOptional: 1 },
      }
    })

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer',
      novelId: task.novelId,
      modelConfigId: 2,
      messages: [{ role: 'user', content: 'x'.repeat(30_000) }],
      chatOpts: { maxTokens: 2_000 },
      prepareInput,
    })).resolves.toBe('ok')

    expect(prepareInput).toHaveBeenCalledOnce()
    expect(chat).toHaveBeenCalledOnce()
  })
})

describe('task service recovery and cancellation', () => {
  it('pauses resumable workflow checkpoints instead of failing them on restart', () => {
    const workflow = {
      id: 11,
      runnerType: 'workflow',
      type: 'timeline_auto_generate',
      status: 'running',
      controlJson: JSON.stringify({ cancelRequested: false }),
      progressJson: JSON.stringify({
        status: 'running',
        resumeCursor: 1,
        totalBatches: 3,
        requestedCount: 6,
        generatedCount: 2,
        completed: false,
      }),
    }
    const pendingWorkflow = {
      ...workflow,
      id: 12,
      status: 'pending',
    }
    const cancelledWorkflow = {
      ...workflow,
      id: 13,
      status: 'cancel_requested',
      controlJson: JSON.stringify({ cancelRequested: true }),
    }
    const fake = buildFakeDb([workflow, pendingWorkflow, cancelledWorkflow])
    vi.mocked(getDb).mockReturnValue(fake.db as never)

    expect(recoverOrphanedTasks()).toBe(3)
    expect(fake.updates.map((update) => update.status)).toEqual(['paused', 'paused', 'cancelled'])
    expect(fake.updates[0].progressJson).toContain('"status":"paused"')
    expect(fake.updates[1].progressJson).toContain('"status":"paused"')
    expect(fake.updates[2].progressJson).toContain('"status":"cancelled"')
  })

  it('cascades cancellation from a chat parent to a pending child task', () => {
    const parent = {
      id: 21,
      runnerType: 'chat',
      status: 'running',
      currentChildTaskId: 22,
      controlJson: JSON.stringify({ cancelRequested: false }),
    }
    const child = {
      id: 22,
      runnerType: 'chat',
      status: 'pending',
      currentChildTaskId: null,
      controlJson: JSON.stringify({ cancelRequested: false }),
    }
    const fake = buildFakeDb([], [[parent], [child]])
    vi.mocked(getDb).mockReturnValue(fake.db as never)

    expect(cancelTask(parent.id)).toBe(true)
    expect(fake.updates.map((update) => update.status)).toEqual(['cancel_requested', 'cancelled'])
    expect(fake.updates[0].controlJson).toContain('"cancelRequested":true')
    expect(fake.updates[1].errorMessage).toBe('用户已取消')
  })

  it('cascades cancellation through a resumed workflow into its active role task', () => {
    const resumedWriterWorkflow = {
      id: 31,
      type: 'chapter_write',
      runnerType: 'workflow',
      status: 'running',
      currentChildTaskId: 32,
      controlJson: JSON.stringify({ cancelRequested: false }),
    }
    const downstreamChapterWorkflow = {
      id: 32,
      type: 'chapter_write',
      runnerType: 'workflow',
      status: 'running',
      currentChildTaskId: 33,
      controlJson: JSON.stringify({ cancelRequested: false }),
    }
    const activeCriticTask = {
      id: 33,
      type: 'chapter_critic',
      runnerType: 'chat',
      status: 'pending',
      currentChildTaskId: null,
      controlJson: JSON.stringify({ cancelRequested: false }),
    }
    const fake = buildFakeDb([], [
      [resumedWriterWorkflow],
      [downstreamChapterWorkflow],
      [activeCriticTask],
    ])
    vi.mocked(getDb).mockReturnValue(fake.db as never)

    expect(cancelTask(resumedWriterWorkflow.id)).toBe(true)
    expect(fake.updates.map((update) => update.status)).toEqual([
      'cancel_requested',
      'cancel_requested',
      'cancelled',
    ])
    expect(fake.updates.every((update) => String(update.controlJson).includes('"cancelRequested":true'))).toBe(true)
  })
})

describe('task service completion gate', () => {
  it('preserves a length-limited candidate and skips business success', async () => {
    const task = {
      id: 41,
      novelId: 5,
      runnerType: 'chat',
      status: 'running',
      currentChildTaskId: null,
      controlJson: '{}',
    }
    const fake = buildFakeDb([], [[task], [task], [task]])
    vi.mocked(getDb).mockReturnValue(fake.db as never)
    vi.mocked(getModelConfigRecord).mockReturnValue({
      id: 2,
      provider: 'openai',
      modelId: 'test-model',
      maxConcurrency: 1,
      temperature: 0.8,
      maxTokens: 100,
    } as never)
    vi.mocked(getModelProviderOptions).mockReturnValue(undefined)
    vi.mocked(createAdapter).mockReturnValue({
      chat: vi.fn(async (_messages, opts) => {
        opts?.onCompletion?.({
          finish: 'length',
          rawFinishReason: 'length',
          usage: {
            input: { value: 10, source: 'reported' },
            output: { value: 4, source: 'reported' },
            cacheRead: { value: null, source: 'unknown' },
            cacheWrite: { value: null, source: 'unknown' },
            reasoning: { value: null, source: 'unknown' },
          },
        })
        return '被截断的候选'
      }),
      countTokens: vi.fn(() => 4),
    } as never)
    const onSuccess = vi.fn()

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer',
      novelId: task.novelId,
      modelConfigId: 2,
      messages: [{ role: 'user', content: '写作' }],
      onSuccess,
    })).rejects.toMatchObject({ code: 'NF_MODEL_OUTPUT_INCOMPLETE', outputText: '被截断的候选' })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(fake.updates.at(-1)).toMatchObject({
      status: 'failed',
      outputText: '被截断的候选',
    })
    expect(String(fake.updates.at(-1)?.errorMessage)).toContain('模型输出未完整结束')
  })

  it('persists both physical attempts when a rate-limited task succeeds on retry', async () => {
    const task = { id: 42, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    const ledger = buildLedgerSqlite()
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    vi.mocked(getSqlite).mockReturnValue(ledger.sqlite as never)
    configureTaskRuntime(new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1'))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '完成' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer', novelId: task.novelId, modelConfigId: 2,
      messages: [{ role: 'user', content: '写作' }],
    })).resolves.toBe('完成')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ledger.rows.map((row) => [row.attempt_index, row.status])).toEqual([[1, 'failed'], [2, 'success']])
    expect(new Set(ledger.rows.map((row) => row.request_id)).size).toBe(2)
  })

  it('counts bottom transport retries and a task-level retry as separate physical attempts', async () => {
    const task = { id: 43, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    const ledger = buildLedgerSqlite()
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    vi.mocked(getSqlite).mockReturnValue(ledger.sqlite as never)
    configureTaskRuntime(new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1'))
    const networkError = () => Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '外层重试完成' }, finish_reason: 'stop' }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer', novelId: task.novelId, modelConfigId: 2, retryable: true,
      messages: [{ role: 'user', content: '写作' }], chatOpts: { requestRetryCount: 1 },
    })).resolves.toBe('外层重试完成')

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(ledger.rows.map((row) => row.attempt_index)).toEqual([1, 2, 3])
    expect(ledger.rows.map((row) => row.status)).toEqual(['failed', 'failed', 'success'])
  }, 10_000)

  it('keeps text from an HTTP 200 stream that ends before the protocol terminator', async () => {
    const task = { id: 44, novelId: 5, runnerType: 'stream', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    const ledger = buildLedgerSqlite()
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    vi.mocked(getSqlite).mockReturnValue(ledger.sqlite as never)
    configureTaskRuntime(new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1'))
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"半段正文"}}]}\n\n'))
        controller.close()
      },
    }), { status: 200 })))
    const onSuccess = vi.fn()

    await expect(executeStreamTask(task.id, {
      type: 'chapter_writer', novelId: task.novelId, modelConfigId: 2,
      messages: [{ role: 'user', content: '写作' }], onSuccess,
    })).rejects.toMatchObject({ code: 'MODEL_STREAM_INTERRUPTED' })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(fakeTaskDb.updates.at(-1)).toMatchObject({ status: 'failed', outputText: '半段正文' })
    expect(ledger.rows).toMatchObject([{ attempt_index: 1, status: 'failed', error_code: 'MODEL_STREAM_INTERRUPTED' }])
  })

  it('rejects a large system prompt after chat options are merged', async () => {
    const task = { id: 49, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    const adapter = new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1', 8_000, 0.8, 100)
    const chat = vi.spyOn(adapter, 'chat').mockResolvedValue('should-not-run')
    configureTaskRuntime(adapter, { maxContextTokens: 8_000 })

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer',
      novelId: task.novelId,
      modelConfigId: 2,
      messages: [{ role: 'user', content: 'short' }],
      chatOpts: { maxTokens: 2_000, systemPrompt: 'system '.repeat(20_000) },
    })).rejects.toMatchObject({ code: 'NF_REQUEST_BUDGET_EXCEEDED' })

    expect(chat).not.toHaveBeenCalled()
  })

  it('does not regenerate when the task ledger sink cannot persist', async () => {
    const task = { id: 45, novelId: 5, runnerType: 'chat', status: 'running', currentChildTaskId: null, controlJson: '{}' }
    const fakeTaskDb = buildFakeDb([], [[task], [task]])
    vi.mocked(getDb).mockReturnValue(fakeTaskDb.db as never)
    vi.mocked(getSqlite).mockReturnValue({
      transaction: (operation: () => void) => ({ immediate: operation }),
      prepare: (sql: string) => sql.includes('COALESCE(MAX(attempt_index)')
        ? { get: () => ({ next_index: 1 }) }
        : sql.includes('INSERT INTO model_request_attempts')
          ? { run: () => { throw new Error('ledger disk full') } }
          : { run: () => ({ changes: 0 }) },
    } as never)
    configureTaskRuntime(new OpenAIAdapter('key', 'test-model', 'http://127.0.0.1:1/v1'))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '仍然完成' }, finish_reason: 'stop' }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(executeChatTask(task.id, {
      type: 'chapter_writer', novelId: task.novelId, modelConfigId: 2,
      messages: [{ role: 'user', content: '写作' }],
    })).resolves.toBe('仍然完成')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fakeTaskDb.updates.at(-1)).toMatchObject({ status: 'success', outputText: '仍然完成' })
  })
})
