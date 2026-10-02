import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  probe: vi.fn(), spawn: vi.fn(),
  child: { once: vi.fn(), unref: vi.fn() },
}))
vi.mock('electron', () => ({ app: {
  whenReady: async () => undefined,
  getPath: () => 'isolated-profile', getVersion: () => '2.0.1', isPackaged: true,
} }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./utils/mcp-runtime', () => ({ probeRuntime: mocks.probe }))

import { startMcpStdio } from './mcp-stdio'

describe('MCP package version guard', () => {
  afterEach(() => { vi.restoreAllMocks() })

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    mocks.probe.mockReset()
    mocks.spawn.mockReset().mockReturnValue(mocks.child)
  })

  it('rejects an existing mismatched owner without spawning or forwarding a request', async () => {
    mocks.probe.mockRejectedValue(new Error('后台版本不一致，请重启 Codex'))
    await expect(startMcpStdio()).rejects.toThrow('后台版本不一致')
    expect(mocks.probe).toHaveBeenCalledWith('isolated-profile', '2.0.1')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not retry spawning when a competing incompatible owner appears during launch', async () => {
    mocks.probe.mockResolvedValueOnce(null).mockRejectedValue(new Error('后台版本不一致'))
    await expect(startMcpStdio()).rejects.toThrow('后台版本不一致')
    expect(mocks.spawn).toHaveBeenCalledTimes(1)
    expect(mocks.probe).toHaveBeenLastCalledWith('isolated-profile', '2.0.1')
  })
})
