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

import {
  isTransientModelNetworkError,
  shouldRetryTransientModelTaskError,
} from './task.service'

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
