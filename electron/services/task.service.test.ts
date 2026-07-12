import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

vi.mock('../database/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('./model.service', () => ({
  createAdapter: vi.fn(),
  getDefaultModelConfigRecord: vi.fn(),
  getModelConfigRecord: vi.fn(),
  getModelProviderOptions: vi.fn(),
  getProviderRuntimeDefaults: vi.fn(() => ({ temperature: 0.85, maxTokens: 4096 })),
}))

import { getDb } from '../database/db'
import {
  cancelTask,
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
})
