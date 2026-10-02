import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: new Map<string, (info: { version: string; percent?: number }) => void>(),
  beforeQuit: null as null | (() => void),
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.1.1'),
    getPath: vi.fn(() => 'D:\\My Novels\\NovelForge.exe'),
    once: vi.fn((_event: string, listener: () => void) => { mocks.beforeQuit = listener }),
  },
  updater: {
    installDirectory: undefined as string | undefined,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: (info: { version: string; percent?: number }) => void) => {
      mocks.events.set(event, listener)
    }),
  },
  showMessageBox: vi.fn(),
  prepare: vi.fn(),
  beginMaintenance: vi.fn(),
  releaseMaintenance: vi.fn(),
}))

vi.mock('electron', () => ({
  app: mocks.app,
  dialog: { showMessageBox: mocks.showMessageBox },
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.updater } }))
vi.mock('../utils/runtime-log', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}))
vi.mock('../utils/update-lifecycle', () => ({ beginUpdateMaintenance: mocks.beginMaintenance }))

import { checkDesktopUpdates, getDesktopUpdateStatus, installDownloadedUpdate, startDesktopUpdater as start } from './desktop-updater'
const startDesktopUpdater = (getWindow: () => BrowserWindow | null) => start(getWindow, mocks.prepare)

describe('desktop updater installation', () => {
  const portableExecutable = process.env.PORTABLE_EXECUTABLE_FILE

  beforeEach(() => {
    delete process.env.PORTABLE_EXECUTABLE_FILE
    mocks.events.clear()
    mocks.beforeQuit = null
    mocks.app.isPackaged = true
    mocks.app.getPath.mockReturnValue('D:\\My Novels\\NovelForge.exe')
    mocks.updater.installDirectory = undefined
    mocks.showMessageBox.mockReset().mockResolvedValue({ response: 0 })
    mocks.updater.quitAndInstall.mockReset()
    mocks.prepare.mockReset().mockResolvedValue(undefined)
    mocks.releaseMaintenance.mockReset()
    mocks.beginMaintenance.mockReset().mockReturnValue({ release: mocks.releaseMaintenance })
    mocks.updater.on.mockClear()
    mocks.updater.checkForUpdates.mockReset().mockResolvedValue(null)
  })

  afterEach(() => {
    mocks.beforeQuit?.()
    if (portableExecutable === undefined) delete process.env.PORTABLE_EXECUTABLE_FILE
    else process.env.PORTABLE_EXECUTABLE_FILE = portableExecutable
  })

  it('silently installs only after confirmation, using the installed directory', async () => {
    startDesktopUpdater(() => null)
    expect(mocks.updater.installDirectory).toBe('D:\\My Novels')

    mocks.events.get('update-downloaded')?.({ version: '1.0.2' })
    await vi.waitFor(() => expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(true, true))
    expect(mocks.showMessageBox).toHaveBeenCalledOnce()
    expect(mocks.beginMaintenance.mock.invocationCallOrder[0]).toBeLessThan(mocks.prepare.mock.invocationCallOrder[0])
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.updater.quitAndInstall.mock.invocationCallOrder[0])
  })

  it('waits for shutdown and bridge exit before starting the installer', async () => {
    let finish!: () => void
    mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '2.0.2' })
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(mocks.releaseMaintenance).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce())
  })

  it('does not run the installer and releases maintenance when shutdown or bridge waiting fails', async () => {
    mocks.prepare.mockRejectedValue(new Error('MCP bridges did not exit'))
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '2.0.2' })
    await vi.waitFor(() => expect(mocks.releaseMaintenance).toHaveBeenCalledOnce())
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(getDesktopUpdateStatus()).toMatchObject({ phase: 'ready', error: 'MCP bridges did not exit' })
  })

  it('releases maintenance for updater errors dispatched instead of thrown by quitAndInstall', async () => {
    mocks.updater.quitAndInstall.mockImplementation(() => {
      mocks.events.get('error')?.(Object.assign(new Error('Installer could not start'), { version: '' }))
    })
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '2.0.2' })
    await vi.waitFor(() => expect(mocks.releaseMaintenance).toHaveBeenCalledOnce())
    expect(getDesktopUpdateStatus()).toMatchObject({ phase: 'ready', error: 'Installer could not start' })
  })

  it('also releases maintenance for an asynchronous installer spawn error', async () => {
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '2.0.2' })
    await vi.waitFor(() => expect(mocks.updater.quitAndInstall).toHaveBeenCalledOnce())
    mocks.events.get('error')?.(Object.assign(new Error('Async spawn failed'), { version: '' }))
    expect(mocks.releaseMaintenance).toHaveBeenCalledOnce()
    expect(getDesktopUpdateStatus()).toMatchObject({ phase: 'ready', error: 'Async spawn failed' })
  })

  it('does not start installation when the user postpones it', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '1.0.2' })
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledOnce())
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
    expect(mocks.beginMaintenance).not.toHaveBeenCalled()
    expect(getDesktopUpdateStatus()).toMatchObject({ currentVersion: '1.1.1', phase: 'ready', latestVersion: '1.0.2' })
    mocks.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await installDownloadedUpdate()).toBe(true)
    expect(mocks.updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('reports the current version and manual check result', async () => {
    startDesktopUpdater(() => null)
    expect(getDesktopUpdateStatus()).toMatchObject({ currentVersion: '1.1.1', mode: 'installed', phase: 'idle' })
    const result = await checkDesktopUpdates()
    expect(mocks.updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ phase: 'up_to_date', currentVersion: '1.1.1' })
  })

  it('shows a failure and permits retry after a failed manual check', async () => {
    startDesktopUpdater(() => null)
    mocks.updater.checkForUpdates.mockRejectedValueOnce(new Error('network unavailable'))
    expect(await checkDesktopUpdates()).toMatchObject({ phase: 'error', error: 'network unavailable' })
    expect(await checkDesktopUpdates()).toMatchObject({ phase: 'up_to_date', error: null })
  })

  it('sends download state to the settings page', async () => {
    const send = vi.fn()
    const window = { isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    startDesktopUpdater(() => window)
    mocks.events.get('update-available')?.({ version: '1.1.2' })
    mocks.events.get('download-progress')?.({ version: '1.1.2', percent: 42.4 })
    expect(getDesktopUpdateStatus()).toMatchObject({ phase: 'downloading', latestVersion: '1.1.2', downloadPercent: 42 })
    mocks.events.get('update-downloaded')?.({ version: '1.1.2' })
    expect(getDesktopUpdateStatus()).toMatchObject({ phase: 'ready', latestVersion: '1.1.2', downloadPercent: 100 })
    expect(send).toHaveBeenLastCalledWith('app:update-status', expect.objectContaining({ phase: 'ready' }))
  })

  it('does not configure an updater in development, portable, or invalid installations', () => {
    mocks.app.isPackaged = false
    startDesktopUpdater(() => null)
    expect(mocks.updater.on).not.toHaveBeenCalled()

    mocks.app.isPackaged = true
    process.env.PORTABLE_EXECUTABLE_FILE = 'D:\\NovelForge-Portable.exe'
    startDesktopUpdater(() => null)
    expect(mocks.updater.on).not.toHaveBeenCalled()

    delete process.env.PORTABLE_EXECUTABLE_FILE
    mocks.app.getPath.mockReturnValue('NovelForge.exe')
    startDesktopUpdater(() => null)
    expect(mocks.updater.on).not.toHaveBeenCalled()
    expect(mocks.updater.installDirectory).toBeUndefined()
  })
})
