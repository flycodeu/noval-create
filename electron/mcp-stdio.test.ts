import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const mocks = vi.hoisted(() => ({
  probe: vi.fn(), readConnection: vi.fn(), spawn: vi.fn(), request: vi.fn(), assertNotUpdating: vi.fn(), quit: vi.fn(),
  child: { once: vi.fn(), unref: vi.fn() },
  input: undefined as unknown as EventEmitter & { destroy: ReturnType<typeof vi.fn> },
  lines: undefined as unknown as EventEmitter & { close: ReturnType<typeof vi.fn> },
}))
vi.mock('electron', () => ({ app: {
  whenReady: async () => undefined,
  getPath: () => 'isolated-profile', getVersion: () => '2.0.1', isPackaged: true, quit: mocks.quit,
} }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./utils/mcp-runtime', () => ({ probeRuntime: mocks.probe, readRuntimeConnection: mocks.readConnection, runtimeRequest: mocks.request }))
vi.mock('./utils/update-lifecycle', () => ({ assertNotUpdating: mocks.assertNotUpdating }))
vi.mock('node:fs', () => ({ default: { createReadStream: () => mocks.input } }))
vi.mock('node:readline', () => ({ default: { createInterface: () => mocks.lines } }))

import { startMcpStdio } from './mcp-stdio'

describe('MCP owner and update lifecycle', () => {
  const connection = { protocol: 1, instanceId: 'first-owner', pid: 321, url: 'http://127.0.0.1:12345/', token: 'fixture-token' }
  const expectBridgeExit = () => {
    if (process.platform === 'win32') {
      expect(vi.mocked(process.kill).mock.calls.filter(([, signal]) => signal !== 0)).toEqual([[process.pid, 'SIGTERM']])
      expect(mocks.quit).not.toHaveBeenCalled()
    } else expect(mocks.quit).toHaveBeenCalledOnce()
  }
  afterEach(() => { mocks.input.emit('end'); vi.useRealTimers(); vi.restoreAllMocks() })

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    vi.useFakeTimers()
    mocks.input = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    mocks.lines = Object.assign(new EventEmitter(), { close: vi.fn() })
    mocks.probe.mockReset().mockResolvedValue({ connection })
    mocks.readConnection.mockReset().mockReturnValue(connection)
    mocks.spawn.mockReset().mockReturnValue(mocks.child)
    mocks.request.mockReset().mockResolvedValue({ ok: true, text: async () => '{"jsonrpc":"2.0","id":1,"result":{}}' })
    mocks.assertNotUpdating.mockReset()
    mocks.quit.mockReset()
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

  it('exits an idle bridge when its owner disappears while stdin stays open', async () => {
    await startMcpStdio()
    mocks.readConnection.mockReturnValue(null)
    await vi.advanceTimersByTimeAsync(1_000)
    expectBridgeExit()
    expect(mocks.input.destroy).toHaveBeenCalledOnce()
    mocks.lines.emit('line', '{"id":1,"method":"tools/list"}')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
    expectBridgeExit()
  })

  it.each([{ ...connection, instanceId: 'replacement' }, { ...connection, pid: 456 }])('rejects changed discovery before probing another owner: %j', async (replacement) => {
    await startMcpStdio()
    mocks.readConnection.mockReturnValue(replacement)
    mocks.lines.emit('line', '{"id":1,"method":"tools/list"}')
    await vi.advanceTimersByTimeAsync(0)
    expectBridgeExit()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.probe).toHaveBeenCalledOnce()
  })

  it('keeps the bridge alive through health timeouts when the same owner PID remains alive', async () => {
    await startMcpStdio()
    mocks.probe.mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.input.destroy).not.toHaveBeenCalled()
    mocks.lines.emit('line', '{"id":1,"method":"tools/list"}')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(connection, '/mcp', expect.any(Object))
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.input.destroy).not.toHaveBeenCalled()
  })

  it('exits within one heartbeat when the owner PID is gone despite stale discovery', async () => {
    await startMcpStdio()
    vi.mocked(process.kill).mockImplementation((_pid, signal) => {
      if (signal === 0) throw Object.assign(new Error('Process gone'), { code: 'ESRCH' })
      return true
    })
    await vi.advanceTimersByTimeAsync(1_000)
    expectBridgeExit()
    expect(mocks.probe).toHaveBeenCalledOnce()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('does not mistake signal permission denial for owner exit after a health timeout', async () => {
    await startMcpStdio()
    mocks.probe.mockResolvedValue(null)
    vi.mocked(process.kill).mockImplementation(() => { throw Object.assign(new Error('No permission'), { code: 'EPERM' }) })
    mocks.lines.emit('line', '{"id":1,"method":"tools/list"}')
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.input.destroy).not.toHaveBeenCalled()
    // Permit this test's normal EOF cleanup to terminate the mocked bridge.
    vi.mocked(process.kill).mockImplementation(() => true)
  })

  it('rechecks discovery after a pending health probe instead of forwarding to a retired owner', async () => {
    await startMcpStdio()
    mocks.readConnection.mockReturnValueOnce(connection).mockReturnValue(null)
    mocks.probe.mockResolvedValue(null)
    mocks.lines.emit('line', '{"id":1,"method":"tools/call"}')
    await vi.advanceTimersByTimeAsync(0)
    expectBridgeExit()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('honors maintenance that starts during a health timeout even when the PID is alive', async () => {
    await startMcpStdio()
    mocks.probe.mockResolvedValue(null)
    mocks.assertNotUpdating.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('UPDATE_IN_PROGRESS') })
    mocks.lines.emit('line', '{"id":1,"method":"tools/call"}')
    await vi.advanceTimersByTimeAsync(0)
    expectBridgeExit()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('checks the update marker both at entry and immediately before spawning', async () => {
    mocks.assertNotUpdating.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('UPDATE_IN_PROGRESS') })
    mocks.probe.mockResolvedValue(null)
    await expect(startMcpStdio()).rejects.toThrow('UPDATE_IN_PROGRESS')
    expect(mocks.assertNotUpdating).toHaveBeenNthCalledWith(2, 'isolated-profile', '2.0.1')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('refuses requests during update maintenance and releases the old bridge', async () => {
    await startMcpStdio()
    mocks.assertNotUpdating.mockImplementation(() => { throw new Error('UPDATE_IN_PROGRESS') })
    mocks.lines.emit('line', '{"id":1,"method":"tools/call"}')
    await vi.advanceTimersByTimeAsync(0)
    expectBridgeExit()
    expect(mocks.request).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('forwards once to the bound owner and never replays a failed mutation', async () => {
    await startMcpStdio()
    mocks.request.mockRejectedValue(new Error('connection reset'))
    const line = '{"id":1,"method":"tools/call"}'
    mocks.lines.emit('line', line)
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(mocks.request).toHaveBeenCalledWith(connection, '/mcp', expect.objectContaining({ body: line }))
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(vi.mocked(process.kill).mock.calls.every(([, signal]) => signal === 0)).toBe(true)
  })

  it('closes only the bridge on client EOF without shutting down the shared owner', async () => {
    await startMcpStdio()
    mocks.input.emit('end')
    await vi.advanceTimersByTimeAsync(2_000)
    expectBridgeExit()
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
