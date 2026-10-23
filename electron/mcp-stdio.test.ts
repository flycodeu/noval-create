import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ probe: vi.fn(), read: vi.fn(), request: vi.fn(), input: vi.fn(), spawn: vi.fn(), testProfile: false, packaged: true, quit: vi.fn() }))
vi.mock('electron', () => ({ app: { whenReady: async () => {}, get isPackaged() { return mocks.packaged }, getPath: (key: string) => key === 'exe' ? 'D:/NovelForge.exe' : 'C:/Users/author/AppData/Roaming/NovelForge', quit: mocks.quit } }))
vi.mock('node:fs', () => ({ default: { createReadStream: mocks.input } }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./utils/desktop-profile', () => ({ applicationVersion: () => '2.4.25', isTestProfile: () => mocks.testProfile, sameDirectory: (a: string, b: string) => a === b }))
vi.mock('./utils/update-lifecycle', () => ({ assertNotUpdating: () => {} }))
vi.mock('./utils/mcp-runtime', () => ({ probeRuntime: mocks.probe, readRuntimeConnection: mocks.read, runtimeRequest: mocks.request }))
import { startMcpStdio } from './mcp-stdio'
const connection = { instanceId: 'manual', pid: 1234, url: 'http://127.0.0.1:1234', token: 'private' }
const health = { desktopOpen: true, identity: { environment: 'formal', source: 'installed', executable: 'D:/NovelForge.exe', dataDirectory: 'C:/Users/author/AppData/Roaming/NovelForge' } }
let input: PassThrough
const logging = { log: console.log, info: console.info, debug: console.debug }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.testProfile = false; mocks.packaged = true
  input = new PassThrough(); mocks.input.mockReturnValue(input)
  mocks.probe.mockResolvedValue({ connection, health }); mocks.read.mockReturnValue(connection)
  mocks.request.mockResolvedValue({ ok: true, text: async () => '{"jsonrpc":"2.0","id":1,"result":{}}' })
  vi.spyOn(process, 'kill').mockReturnValue(true)
  vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})
afterEach(async () => {
  input.emit('end'); input.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); Object.assign(console, logging)
})
describe('MCP never launches a database owner', () => {
  it('fails promptly without spawning or creating input when the app is closed', async () => {
    mocks.probe.mockResolvedValue(null)
    await expect(startMcpStdio()).rejects.toThrow('请先手动打开')
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.input).not.toHaveBeenCalled()
  })
  it.each(['source', 'temporary'])('refuses a %s bridge before probing storage', async mode => {
    mocks.packaged = mode !== 'source'; mocks.testProfile = mode === 'temporary'
    await expect(startMcpStdio()).rejects.toThrow('临时数据目录')
    expect(mocks.probe).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('does not open an existing headless runtime window', async () => {
    mocks.probe.mockResolvedValue({ connection, health: { ...health, desktopOpen: false } })
    await expect(startMcpStdio()).rejects.toThrow('请先手动打开')
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('forwards once to the same manually opened owner, then closes on owner replacement', async () => {
    await startMcpStdio()
    input.write('{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n')
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith(connection, '/mcp', expect.any(Object))
    mocks.read.mockReturnValue({ ...connection, instanceId: 'replacement' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(input.destroyed).toBe(true)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('stops when the desktop closes even if the owner process remains', async () => {
    await startMcpStdio()
    mocks.probe.mockResolvedValue({ connection, health: { ...health, desktopOpen: false } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(input.destroyed).toBe(true)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
