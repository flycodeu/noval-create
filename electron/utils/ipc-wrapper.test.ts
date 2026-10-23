import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { wrapIpcHandler } from './ipc-wrapper'
import { UserFacingError } from './user-facing-error'
import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { confirmWindowClose } from './window-close'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ app: { isPackaged: true } }))

describe('production IPC error disclosure', () => {
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

  it('does not make a centralized ordinary runtime error public', async () => {
    const handler = wrapIpcHandler('window:confirmClose', () => confirmWindowClose({} as BrowserWindow, 'discard'))
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toEqual({
      ok: false,
      error: { code: 'common.executionFailed', message: formatUserFacingMessage('common.executionFailed'), detail: undefined },
    })
    expect(JSON.stringify(result)).not.toContain(formatUserFacingMessage('window.invalidAction'))
  })

  it('keeps internal causes private after formatting a shutdown error', async () => {
    const cause = new Error('test-only-private-shutdown-cause')
    const handler = wrapIpcHandler('app:installUpdate', () => {
      throw new Error(formatUserFacingMessage('update.shutdownIncomplete'), { cause })
    })
    const result = await handler({} as IpcMainInvokeEvent)
    expect(result).toEqual({
      ok: false,
      error: { code: 'common.executionFailed', message: formatUserFacingMessage('common.executionFailed'), detail: undefined },
    })
    expect(JSON.stringify(result)).not.toContain(cause.message)
    expect(JSON.stringify(result)).not.toContain(formatUserFacingMessage('update.shutdownIncomplete'))
  })
})
