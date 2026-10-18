import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { wrapIpcHandler } from './ipc-wrapper'
import { UserFacingError } from './user-facing-error'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

describe('production IPC search configuration errors', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([
    'sourceSearch.credentialsChanged',
    'sourceSearch.unsafeUrl',
    'sourceSearch.incompletePlatform',
  ] as const)('preserves the fixed actionable message for %s without internal detail', async (code) => {
    const secret = 'test-only-private-upstream-detail'
    const handler = wrapIpcHandler('sourceSearch:updateSettings', () => {
      throw new UserFacingError(code, {}, { cause: new Error(secret) })
    })
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toEqual({
      ok: false,
      error: { code, message: formatUserFacingMessage(code), detail: undefined },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('keeps arbitrary upstream errors private instead of exposing their messages', async () => {
    const secret = 'test-only-private-upstream-error'
    const handler = wrapIpcHandler('sourceSearch:updateSettings', () => {
      throw new Error(secret)
    })
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'common.executionFailed',
        message: formatUserFacingMessage('common.executionFailed'),
        detail: undefined,
      },
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })
})
