import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import electronUpdater, { type NsisUpdater } from 'electron-updater'
import type { DesktopUpdateMode, DesktopUpdateStatus } from '../../src/shared/desktop-update'
import { canUseDesktopUpdater } from './desktop-updater-policy'
import { logError, logInfo, logWarn } from '../utils/runtime-log'
import { beginUpdateMaintenance, type UpdateMaintenance } from '../utils/update-lifecycle'

const FIRST_CHECK_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const { autoUpdater } = electronUpdater

let windowProvider: (() => BrowserWindow | null) | null = null
let prepareUpdate: (() => Promise<void>) | null = null
let updateMaintenance: UpdateMaintenance | null = null
let checkPromise: Promise<DesktopUpdateStatus> | null = null
let installing = false
let promptedVersion = ''
let updateState: Omit<DesktopUpdateStatus, 'currentVersion' | 'mode'> = {
  phase: 'idle',
  latestVersion: null,
  downloadPercent: null,
  checkedAt: null,
  error: null,
}

function updateMode(): DesktopUpdateMode {
  if (!app.isPackaged) return 'development'
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  if (process.platform !== 'win32') return 'unsupported'
  const executablePath = app.getPath('exe')
  return path.isAbsolute(executablePath) && path.extname(executablePath).toLowerCase() === '.exe'
    ? 'installed' : 'unsupported'
}

export function getDesktopUpdateStatus(): DesktopUpdateStatus {
  return { currentVersion: app.getVersion(), mode: updateMode(), ...updateState }
}

function publishStatus(patch: Partial<typeof updateState>): DesktopUpdateStatus {
  updateState = { ...updateState, ...patch }
  const status = getDesktopUpdateStatus()
  const window = windowProvider?.()
  if (window && !window.isDestroyed()) window.webContents.send('app:update-status', status)
  return status
}

async function showUpdateDialog(options: Electron.MessageBoxOptions): Promise<number> {
  const window = windowProvider?.()
  const result = window && !window.isDestroyed()
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response
}

function releaseUpdateMaintenance(): void {
  const maintenance = updateMaintenance
  updateMaintenance = null
  try { maintenance?.release() } catch (error) { logError('desktop-updater', 'Could not clear update maintenance', { error }) }
}

async function beginInstall(version: string): Promise<boolean> {
  if (installing || updateState.phase !== 'ready') return false
  installing = true
  try {
    if (!prepareUpdate) throw new Error('更新准备流程尚未就绪，请重新启动 NovelForge。')
    updateMaintenance = beginUpdateMaintenance(app.getPath('userData'), app.getVersion())
    // NSIS must not run until storage and background requests have actually stopped.
    await prepareUpdate()
    logInfo('desktop-updater', 'User requested update install', { context: { version } })
    autoUpdater.quitAndInstall(true, true)
    return installing
  } catch (error) {
    installing = false
    releaseUpdateMaintenance()
    logError('desktop-updater', 'Could not start installer', { error })
    const message = error instanceof Error ? error.message : String(error)
    publishStatus({ phase: 'ready', error: message })
    void showUpdateDialog({
      type: 'error',
      title: '更新未安装',
      message: '更新准备或启动失败，请重新启动 NovelForge 后重试。',
      detail: message,
      buttons: ['知道了'],
      noLink: true,
    }).catch((dialogError: unknown) => logError('desktop-updater', 'Could not show installer error', { error: dialogError }))
    return false
  }
}

export async function installDownloadedUpdate(): Promise<boolean> {
  if (getDesktopUpdateStatus().mode !== 'installed' || updateState.phase !== 'ready') return false
  const version = updateState.latestVersion || '新版本'
  const answer = await showUpdateDialog({
    type: 'warning',
    title: '安装 NovelForge 更新',
    message: `现在重启并安装 ${version}？`,
    detail: '请先保存正在编辑的内容。重启会中断正在运行的 AI 任务，更新将沿用当前安装位置。',
    buttons: ['重启并安装', '取消'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  })
  return answer === 0 ? beginInstall(version) : false
}

export function checkDesktopUpdates(): Promise<DesktopUpdateStatus> {
  if (getDesktopUpdateStatus().mode !== 'installed' || !windowProvider || installing || updateState.phase === 'ready') {
    return Promise.resolve(getDesktopUpdateStatus())
  }
  if (checkPromise) return checkPromise
  publishStatus({ phase: 'checking', latestVersion: null, error: null, downloadPercent: null, checkedAt: new Date().toISOString() })
  checkPromise = autoUpdater.checkForUpdates()
    .then(() => updateState.phase === 'checking' ? publishStatus({ phase: 'up_to_date' }) : getDesktopUpdateStatus())
    .catch((error: unknown) => {
      logWarn('desktop-updater', 'Update check failed', { error })
      return publishStatus({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
    })
    .finally(() => { checkPromise = null })
  return checkPromise
}

export function startDesktopUpdater(getWindow: () => BrowserWindow | null, prepareForUpdate: () => Promise<void>): void {
  if (!canUseDesktopUpdater(app.isPackaged, process.platform, process.env.PORTABLE_EXECUTABLE_FILE)) return
  const executablePath = app.getPath('exe')
  if (updateMode() !== 'installed') {
    logWarn('desktop-updater', 'Cannot determine installed application directory', { context: { executablePath } })
    return
  }
  windowProvider = getWindow
  prepareUpdate = prepareForUpdate
  updateState = { phase: 'idle', latestVersion: null, downloadPercent: null, checkedAt: null, error: null }
  installing = false
  promptedVersion = ''

  // NSIS uses /D to retain a custom installation directory during a silent update.
  const nsisUpdater = autoUpdater as NsisUpdater
  nsisUpdater.installDirectory = path.dirname(executablePath)
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => {
    publishStatus({ phase: 'checking', latestVersion: null, error: null, checkedAt: new Date().toISOString() })
  })
  autoUpdater.on('update-available', (info) => {
    publishStatus({ phase: 'downloading', latestVersion: info.version, downloadPercent: 0, error: null })
  })
  autoUpdater.on('update-not-available', (info) => {
    publishStatus({ phase: 'up_to_date', latestVersion: info.version, downloadPercent: null, error: null })
  })
  autoUpdater.on('download-progress', (progress) => {
    publishStatus({ phase: 'downloading', downloadPercent: Math.max(0, Math.min(100, Math.round(progress.percent))) })
  })
  autoUpdater.on('error', (error) => {
    logError('desktop-updater', 'Update failed', { error })
    const failedInstall = installing
    if (failedInstall) { installing = false; releaseUpdateMaintenance() }
    publishStatus({ phase: failedInstall ? 'ready' : 'error', error: error.message })
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (installing) return
    publishStatus({ phase: 'ready', latestVersion: info.version, downloadPercent: 100, error: null })
    if (promptedVersion === info.version) return
    promptedVersion = info.version
    logInfo('desktop-updater', 'Update downloaded', { context: { version: info.version } })
    void (async () => {
      const answer = await showUpdateDialog({
        type: 'info',
        title: 'NovelForge 更新已就绪',
        message: `NovelForge ${info.version} 已下载`,
        detail: '重启后将安装更新。请先保存正在编辑的内容；正在运行的 AI 任务会被中断。',
        buttons: ['重启并安装', '稍后再说'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (answer === 0) await beginInstall(info.version)
    })().catch((error: unknown) => {
      logError('desktop-updater', 'Could not show update prompt', { error })
    })
  })

  const firstCheck = setTimeout(() => void checkDesktopUpdates(), FIRST_CHECK_DELAY_MS)
  firstCheck.unref()
  const periodicCheck = setInterval(() => void checkDesktopUpdates(), CHECK_INTERVAL_MS)
  periodicCheck.unref()
  app.once('before-quit', () => {
    clearTimeout(firstCheck)
    clearInterval(periodicCheck)
  })
}
