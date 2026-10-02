import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getPath: vi.fn(() => 'D:\\Program Files\\NovelForge\\NovelForge.exe') },
  command: 'D:\\Program Files\\NovelForge\\NovelForge.exe',
  args: ['--mcp'],
  missing: false,
  execFile: vi.fn(),
}))

vi.mock('electron', () => ({ app: mocks.app }))
vi.mock('node:fs', () => ({ default: { statSync: () => ({ isFile: () => true }) } }))
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
}))

import { configureCodexMcp, getCodexMcpSetupStatus } from './codex-mcp-setup.service'

describe('Codex MCP setup', () => {
  beforeEach(() => {
    mocks.app.isPackaged = true
    mocks.command = 'D:\\Program Files\\NovelForge\\NovelForge.exe'
    mocks.args = ['--mcp']
    mocks.missing = false
    mocks.execFile.mockReset().mockImplementation((_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
      if (args[1] === 'add') {
        mocks.command = args[4]
        mocks.args = args.slice(5)
        callback(null, '')
      } else if (mocks.missing) {
        callback(Object.assign(new Error('No MCP server named novelforge found'), {
          code: 1,
          stderr: 'No MCP server named novelforge found',
        }), '')
      } else {
        callback(null, JSON.stringify({
          enabled: true,
          transport: { type: 'stdio', command: mocks.command, args: mocks.args },
        }))
      }
    })
  })

  it('recognizes the installed app and existing Codex registration', async () => {
    const status = await getCodexMcpSetupStatus('C:\\Tools\\codex.exe')
    expect(status.registration).toBe('configured')
    expect(status.command).toContain("'D:\\Program Files\\NovelForge\\NovelForge.exe' --mcp")
    expect(mocks.execFile).toHaveBeenCalledWith('C:\\Tools\\codex.exe', ['mcp', 'get', 'novelforge', '--json'], expect.objectContaining({ windowsHide: true }), expect.any(Function))
  })

  it('replaces a stale path using fixed argument boundaries and verifies the result', async () => {
    mocks.command = 'D:\\Old\\NovelForge.exe'
    const status = await configureCodexMcp('C:\\Tools\\codex.exe')
    expect(status.registration).toBe('configured')
    expect(mocks.execFile).toHaveBeenCalledWith('C:\\Tools\\codex.exe', ['mcp', 'add', 'novelforge', '--', 'D:\\Program Files\\NovelForge\\NovelForge.exe', '--mcp'], expect.not.objectContaining({ shell: true }), expect.any(Function))
  })

  it('reports a missing registration without attempting to start the MCP server', async () => {
    mocks.missing = true
    const status = await getCodexMcpSetupStatus('C:\\Tools\\codex.exe')
    expect(status.registration).toBe('missing')
    expect(mocks.execFile).toHaveBeenCalledTimes(1)
    expect(mocks.execFile.mock.calls[0][1]).toEqual(['mcp', 'get', 'novelforge', '--json'])
  })

  it('rejects an arbitrary command instead of invoking a shell', async () => {
    await expect(configureCodexMcp('powershell -Command Remove-Item')).rejects.toThrow('codex.exe')
    expect(mocks.execFile).not.toHaveBeenCalled()
  })
})
