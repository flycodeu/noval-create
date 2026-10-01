import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: new Map<string, (info: { version: string }) => void>(),
  beforeQuit: null as null | (() => void),
  app: {
    isPackaged: true,
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
    on: vi.fn((event: string, listener: (info: { version: string }) => void) => {
      mocks.events.set(event, listener)
    }),
  },
  showMessageBox: vi.fn(),
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

import { startDesktopUpdater } from './desktop-updater'

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
    mocks.updater.quitAndInstall.mockClear()
    mocks.updater.on.mockClear()
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
  })

  it('does not start installation when the user postpones it', async () => {
    mocks.showMessageBox.mockResolvedValue({ response: 1 })
    startDesktopUpdater(() => null)
    mocks.events.get('update-downloaded')?.({ version: '1.0.2' })
    await vi.waitFor(() => expect(mocks.showMessageBox).toHaveBeenCalledOnce())
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
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
