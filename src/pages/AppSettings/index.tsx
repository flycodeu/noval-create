import React, { useEffect, useState } from 'react'
import { Alert, Button, Progress } from 'antd'
import { CheckCircleOutlined, CloudDownloadOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import type { DesktopUpdateStatus } from '../../shared/desktop-update'
import { isElectronRuntime } from '../../runtime/environment'
import { WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'
import './index.css'

function statusText(status: DesktopUpdateStatus): string {
  if (status.mode === 'portable') return '便携版不支持应用内更新。需要升级时请下载新版便携包。'
  if (status.mode === 'development') return '开发环境不执行软件更新。'
  if (status.mode === 'unsupported') return '当前运行环境不支持应用内更新。'
  switch (status.phase) {
    case 'checking': return '正在检查 GitHub Releases…'
    case 'downloading': return `正在下载 ${status.latestVersion || '新版本'}…`
    case 'ready': return `${status.latestVersion || '新版本'} 已下载，可以重启安装。`
    case 'up_to_date': return '当前已是最新版本。'
    case 'error': return '检查或下载更新失败。'
    default: return '尚未检查更新。'
  }
}

export default function AppSettings() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const desktopRuntime = isElectronRuntime()

  useEffect(() => {
    if (!desktopRuntime || typeof window.electron.app.getUpdateStatus !== 'function') return
    let active = true
    const unsubscribe = window.electron.on('app:update-status', (value) => {
      if (active && value && typeof value === 'object' && 'currentVersion' in value) {
        setStatus(value as DesktopUpdateStatus)
      }
    })
    void window.electron.app.getUpdateStatus().then((value) => {
      if (active) setStatus(value)
    }).catch((error: unknown) => {
      if (active) setLoadError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false; unsubscribe() }
  }, [desktopRuntime])

  const check = async () => {
    setBusy(true)
    setLoadError('')
    try {
      setStatus(await window.electron.app.checkForUpdates())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    setBusy(true)
    setLoadError('')
    try {
      const started = await window.electron.app.installUpdate()
      if (!started) setStatus(await window.electron.app.getUpdateStatus())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const openReleasePage = async () => {
    try {
      await window.electron.app.openReleasePage()
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }

  const canUpdate = status?.mode === 'installed'
  const downloading = status?.phase === 'downloading'
  const ready = status?.phase === 'ready'
  return (
    <WorkspacePage className="app-settings" layout="standard" scrollMode="document" heroVariant="compact" eyebrow="NovelForge" title="应用设置">
      <WorkspacePanel title="版本与更新" description="查看当前安装版本，手动检查更新。下载完成后由你决定何时重启安装。" descriptionMode="inline">
        <div className="app-settings__version">
          <div>
            <span className="app-settings__label">当前版本</span>
            <strong data-app-version>{status?.currentVersion ? `v${status.currentVersion}` : desktopRuntime ? '读取中…' : '网页预览'}</strong>
          </div>
          <span className="app-settings__edition">{status?.mode === 'installed' ? 'Windows 安装版' : status?.mode === 'portable' ? 'Windows 便携版' : desktopRuntime ? '开发环境' : '网页预览'}</span>
        </div>

        <div className="app-settings__update">
          <div className="app-settings__update-copy">
            <span className="app-settings__label">更新状态</span>
            <strong data-update-status>{status ? statusText(status) : desktopRuntime ? '正在读取更新状态…' : '网页预览不支持软件更新。'}</strong>
            {status?.latestVersion && status.mode === 'installed' && status.phase !== 'up_to_date' ? <span>发现版本 v{status.latestVersion}</span> : null}
            {status?.checkedAt ? <span>上次检查：{new Date(status.checkedAt).toLocaleString('zh-CN')}</span> : null}
          </div>
          {status?.phase === 'up_to_date' ? <CheckCircleOutlined className="app-settings__success" aria-hidden="true" /> : null}
        </div>

        {downloading ? <Progress percent={status.downloadPercent ?? 0} size="small" status="active" /> : null}
        {status?.error ? <Alert type="error" showIcon message={status.error} /> : null}
        {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

        <div className="app-settings__actions">
          <Button icon={<ReloadOutlined />} onClick={() => void check()} loading={busy || status?.phase === 'checking'} disabled={!canUpdate || downloading || ready}>
            检查更新
          </Button>
          {ready ? <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void install()} loading={busy}>重启并安装</Button> : null}
          {desktopRuntime ? <Button type="link" icon={<ExportOutlined />} onClick={() => void openReleasePage()}>查看发布版本</Button> : null}
        </div>
        <p className="app-settings__note">安装版会在启动后检查，并定期检查 GitHub Releases。下载不会打断写作；安装前会再次提示保存。</p>
      </WorkspacePanel>
    </WorkspacePage>
  )
}
