import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotUpdating, assertUpdateStorageReleased, beginUpdateMaintenance, UPDATE_MAINTENANCE_TTL_MS, UpdateInProgressError, waitForMcpBridgesToExit } from './update-lifecycle'

const mocks = vi.hoisted(() => ({ queryProcesses: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: mocks.queryProcesses,
}) }))

let directory: string
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'novelforge-update-test-'))
  mocks.queryProcesses.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), 'novelforge-update-test-'))) throw new Error('Unsafe test cleanup path')
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('update maintenance lifecycle', () => {
  it('blocks the outgoing version while allowing the newly installed version', () => {
    expect(() => assertNotUpdating(directory, 'old')).not.toThrow()
    const maintenance = beginUpdateMaintenance(directory, 'old')
    expect(() => assertNotUpdating(directory, 'old')).toThrow(UpdateInProgressError)
    expect(() => beginUpdateMaintenance(directory, 'old')).toThrow(UpdateInProgressError)
    expect(() => assertNotUpdating(directory, 'new')).not.toThrow()
    maintenance.release()
    expect(() => assertNotUpdating(directory, 'old')).not.toThrow()
  })

  it('preserves the maintenance error class, code and message', () => {
    const error = new UpdateInProgressError()
    expect(error.constructor).toBe(UpdateInProgressError)
    expect(error).toMatchObject({
      name: 'UpdateInProgressError',
      code: 'UPDATE_IN_PROGRESS',
      message: 'NovelForge 正在准备安装更新，当前版本暂时不能启动或重新连接。请等待安装完成后重启 Codex 的 MCP 连接；若安装已取消，请在 10 分钟后重试。',
    })
  })

  it('expires so a cancelled installer cannot permanently block the app', () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    beginUpdateMaintenance(directory, 'old')
    vi.mocked(Date.now).mockReturnValue(now + UPDATE_MAINTENANCE_TTL_MS)
    expect(() => assertNotUpdating(directory, 'old')).not.toThrow()
  })

  it('releases only its own marker when another version has replaced it', () => {
    const previous = beginUpdateMaintenance(directory, 'old')
    const current = beginUpdateMaintenance(directory, 'new')
    previous.release()
    expect(() => assertNotUpdating(directory, 'new')).toThrow(UpdateInProgressError)
    current.release()
    expect(() => assertNotUpdating(directory, 'new')).not.toThrow()
  })

  it('waits for remaining bridges and queries only the exact installed path', async () => {
    mocks.queryProcesses.mockResolvedValueOnce({ stdout: '[101,102]' }).mockResolvedValueOnce({ stdout: '[]' })
    const executable = "D:\\My Novel's\\NovelForge.exe"
    await waitForMcpBridgesToExit(executable)
    expect(mocks.queryProcesses).toHaveBeenCalledTimes(2)
    const [command, args, options] = mocks.queryProcesses.mock.calls[0]
    expect(command).toBe('powershell.exe')
    expect(options).toMatchObject({ windowsHide: true, env: { NOVELFORGE_UPDATE_EXECUTABLE: executable } })
    expect(args.at(-1)).toContain('[String]::Equals($_.ExecutablePath, $env:NOVELFORGE_UPDATE_EXECUTABLE')
    expect(args.at(-1)).not.toContain(executable)
  })

  it('rejects a timed-out bridge wait instead of allowing installation', async () => {
    mocks.queryProcesses.mockResolvedValue({ stdout: '[101]' })
    await expect(waitForMcpBridgesToExit('D:\\NovelForge\\NovelForge.exe', 0)).rejects.toThrow('等待 MCP 后台退出超时')
  })

  it('rejects unrecognized bridge state without retrying or allowing installation', async () => {
    mocks.queryProcesses.mockResolvedValue({ stdout: '{"pid":101}' })
    const error = await waitForMcpBridgesToExit('D:\\NovelForge\\NovelForge.exe').catch(error => error)
    expect(error?.constructor).toBe(Error)
    expect(error.message).toBe('无法确认 MCP 后台是否已退出，请关闭 Codex 后重新启动 NovelForge 再更新。')
    expect(mocks.queryProcesses).toHaveBeenCalledOnce()
  })

  it('blocks installation if another owner acquired storage after the previous shutdown', () => {
    expect(() => assertUpdateStorageReleased(directory)).not.toThrow()
    fs.writeFileSync(path.join(directory, 'novelforge.single-writer.lock'), JSON.stringify({ pid: process.pid }))
    expect(() => assertUpdateStorageReleased(directory)).toThrow('后台服务仍持有数据库')
  })
})
