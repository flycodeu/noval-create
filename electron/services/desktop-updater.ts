import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { canUseDesktopUpdater } from './desktop-updater-policy'
import { logError, logInfo, logWarn } from '../utils/runtime-log'

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export function startDesktopUpdater(
  getWindow: () => BrowserWindow | null,
): void {
  if (!canUseDesktopUpdater(app.isPackaged, process.platform, process.env.PORTABLE_EXECUTABLE_FILE)) return

  // electron-updater 6 is CommonJS; destructuring also works in the Electron Vite bundle.
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  let checking = false
  let installing = false
  let promptedVersion = ''

  const check = async () => {
    if (checking || installing) return
    checking = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      logWarn('desktop-updater', 'Update check failed', { error })
    } finally {
      checking = false
    }
  }

  autoUpdater.on('error', (error) => {
    logError('desktop-updater', 'Update failed', { error })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (installing || promptedVersion === info.version) return
    promptedVersion = info.version
    logInfo('desktop-updater', 'Update downloaded', { context: { version: info.version } })

    void (async () => {
      const options = {
        type: 'info' as const,
        title: 'NovelForge 更新已就绪',
        message: `NovelForge ${info.version} 已下载`,
        detail: '重启后将安装更新。请先保存正在编辑的内容；正在运行的 AI 任务会被中断。',
        buttons: ['重启并安装', '稍后再说'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const window = getWindow()
      const answer = window
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options)
      if (answer.response !== 0 || installing) return

      installing = true
      try {
        // The existing before-quit handler stops the worker, closes SQLite and
        // releases the writer lock before Electron exits.
        logInfo('desktop-updater', 'User requested update install', { context: { version: info.version } })
        autoUpdater.quitAndInstall(false, true)
      } catch (error) {
        installing = false
        logError('desktop-updater', 'Could not start installer', { error })
        const message = error instanceof Error ? error.message : String(error)
        const failure = {
          type: 'error' as const,
          title: '更新未安装',
          message: '启动更新安装器失败，请稍后重启并重试。',
          detail: message,
          buttons: ['知道了'],
          noLink: true,
        }
        const activeWindow = getWindow()
        if (activeWindow) await dialog.showMessageBox(activeWindow, failure)
        else await dialog.showMessageBox(failure)
      }
    })()
  })

  const firstCheck = setTimeout(() => void check(), FIRST_CHECK_DELAY_MS)
  firstCheck.unref()
  const periodicCheck = setInterval(() => void check(), CHECK_INTERVAL_MS)
  periodicCheck.unref()
  app.once('before-quit', () => {
    clearTimeout(firstCheck)
    clearInterval(periodicCheck)
  })
}
