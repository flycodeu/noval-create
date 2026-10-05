import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Progress } from 'antd'
import { ArrowRightOutlined, CheckOutlined, CloudDownloadOutlined, CopyOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { DesktopUpdateStatus } from '../../shared/desktop-update'
import type { CodexMcpSetupStatus } from '../../shared/codex-mcp-setup'
import type { ModelConfig } from '../../types'
import { isElectronRuntime } from '../../runtime/environment'
import { useThemeStore, type Theme } from '../../stores/theme.store'
import './index.css'
import EmbeddingSettings from './EmbeddingSettings'

function statusText(status: DesktopUpdateStatus): string {
  if (status.mode === 'portable') return '便携版请下载新版软件包后更新。'
  if (status.mode === 'development') return '开发环境不执行软件更新。'
  if (status.mode === 'unsupported') return '当前环境不支持应用内更新。'
  switch (status.phase) {
    case 'checking': return '正在检查新版本…'
    case 'downloading': return `正在下载 ${status.latestVersion || '新版本'}…`
    case 'ready': return `${status.latestVersion || '新版本'} 已下载，随时可以重启安装。`
    case 'up_to_date': return '已经是最新版本。'
    case 'error': return '更新未完成，请重试。'
    default: return '可以手动检查新版本。'
  }
}
const THEMES: Array<{ value: Theme; label: string }> = [{ value: 'light', label: '浅色' }, { value: 'soft', label: '柔和' }, { value: 'dark', label: '深色' }]

export default function AppSettings() {
  const navigate = useNavigate()
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [mcpStatus, setMcpStatus] = useState<CodexMcpSetupStatus | null>(null)
  const [codexCliPath, setCodexCliPath] = useState('')
  const [mcpBusy, setMcpBusy] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [copied, setCopied] = useState(false)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [modelError, setModelError] = useState('')
  const copiedTimer = useRef<number | undefined>()
  const desktopRuntime = isElectronRuntime()

  useEffect(() => {
    let active = true
    void window.electron.model.list().then((rows) => { if (active) setModels(rows) }).catch((cause) => { if (active) setModelError(cause instanceof Error ? cause.message : '读取模型失败') })
    return () => { active = false; window.clearTimeout(copiedTimer.current) }
  }, [])
  useEffect(() => {
    if (!desktopRuntime || typeof window.electron.app.getUpdateStatus !== 'function') return
    let active = true
    const unsubscribe = window.electron.on('app:update-status', (value) => {
      if (active && value && typeof value === 'object' && 'currentVersion' in value) setStatus(value as DesktopUpdateStatus)
    })
    void window.electron.app.getUpdateStatus().then((value) => { if (active) setStatus(value) }).catch((cause: unknown) => { if (active) setLoadError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false; unsubscribe() }
  }, [desktopRuntime])
  useEffect(() => {
    if (!desktopRuntime || typeof window.electron.app.getCodexMcpSetupStatus !== 'function') return
    let active = true
    void window.electron.app.getCodexMcpSetupStatus().then((value) => {
      if (active) { setMcpStatus(value); setCodexCliPath(value.codexCliPath ?? '') }
    }).catch((cause: unknown) => { if (active) setMcpError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [desktopRuntime])
  const refreshMcp = async (configure = false) => {
    setMcpBusy(true); setMcpError(''); setCopied(false)
    try {
      const value = await (configure ? window.electron.app.configureCodexMcp : window.electron.app.getCodexMcpSetupStatus)(codexCliPath.trim() || undefined)
      setMcpStatus(value); setCodexCliPath(value.codexCliPath ?? '')
    } catch (cause) { setMcpError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setMcpBusy(false) }
  }
  const copyMcpCommand = async () => {
    if (!mcpStatus?.command) return
    try {
      await navigator.clipboard.writeText(mcpStatus.command)
      setCopied(true); window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch (cause) { setMcpError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const check = async () => {
    setBusy(true); setLoadError('')
    try { setStatus(await window.electron.app.checkForUpdates()) }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const install = async () => {
    setBusy(true); setLoadError('')
    try { if (!await window.electron.app.installUpdate()) setStatus(await window.electron.app.getUpdateStatus()) }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const openReleasePage = async () => {
    try { await window.electron.app.openReleasePage() }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const defaultModel = models.find((model) => model.isDefault === 1)
  const downloading = status?.phase === 'downloading'
  const ready = status?.phase === 'ready'
  const mcpPathChanged = codexCliPath.trim() !== (mcpStatus?.codexCliPath ?? '')
  const registered = !mcpPathChanged && mcpStatus?.registration === 'configured'
  const serviceReady = Boolean(mcpStatus?.runtime?.reachable && mcpStatus.runtime.projectReadable)
  const connectionReady = registered && serviceReady && !mcpError && !mcpBusy
  const connectionTitle = !desktopRuntime ? '请在桌面版连接 Codex' : mcpBusy ? '正在检查连接配置…' : mcpError ? '暂时无法检查连接' : mcpPathChanged ? '路径已修改，等待检查' : registered && serviceReady ? '配置已登记，创作服务可用' : registered ? '配置已登记，服务待检查' : mcpStatus?.registration === 'different' ? '连接配置需要更新' : mcpStatus?.registration === 'missing' ? '尚未连接 Codex' : mcpStatus ? '需要完成连接配置' : '正在检查连接…'
  const connectionDetail = !desktopRuntime ? '模型与外观可在这里调整；MCP 登记需要在 NovelForge 桌面版完成。' : mcpStatus && !mcpStatus.codexCliPath ? '没有找到 Codex 程序，可展开下方手动配置。' : registered && !serviceReady && mcpStatus.runtime ? mcpStatus.runtime.message : registered ? 'NovelForge 可以保持打开。更改配置后，请重启 Codex，让当前会话加载工具。' : mcpStatus?.registration === 'different' ? '已登记的程序位置与当前安装不一致，更新后再重启 Codex。' : '连接后，Codex 可以读取作品，并调用项目模型生成、评审和保存内容。'

  return <div className="app-settings">
    <header className="app-settings__heading"><span>NovelForge</span><h1>应用设置</h1></header>
    <section className="app-settings__section app-settings__connection" aria-labelledby="settings-mcp-title">
      <div className="app-settings__section-heading"><div><span className="app-settings__eyebrow">创作连接</span><h2 id="settings-mcp-title">Codex MCP</h2></div><span className={`app-settings__connection-state${connectionReady ? ' is-ready' : ''}`}><i />{!desktopRuntime ? '桌面功能' : connectionReady ? '可用' : mcpBusy ? '检查中' : '待检查'}</span></div>
      <div className="app-settings__connection-copy"><strong>{connectionTitle}</strong><p>{connectionDetail}</p></div>
      {mcpError && <Alert type="error" showIcon message={mcpError} />}
      <div className="app-settings__actions"><Button type={registered ? 'default' : 'primary'} onClick={() => void refreshMcp(true)} loading={mcpBusy} disabled={!desktopRuntime || !mcpStatus?.supported || (!mcpStatus.codexCliPath && !codexCliPath.trim())}>{registered || mcpStatus?.registration === 'different' ? '更新连接配置' : '配置到 Codex'}</Button><Button icon={<ReloadOutlined />} onClick={() => void refreshMcp()} loading={mcpBusy} disabled={!desktopRuntime}>检查连接</Button></div>
      <details className="app-settings__details"><summary>手动配置与连接诊断</summary><div className="app-settings__details-body">
        <label className="app-settings__field" htmlFor="codex-cli-path"><span>Codex 程序路径</span><Input id="codex-cli-path" value={codexCliPath} onChange={(event) => { setCodexCliPath(event.target.value); setCopied(false) }} placeholder="自动检测不到时，填写 codex.exe 的绝对路径" disabled={!desktopRuntime || mcpBusy} /></label>
        {mcpStatus?.command && <div className="app-settings__command"><div><span>PowerShell 命令</span><Button type="text" size="small" icon={copied ? <CheckOutlined /> : <CopyOutlined />} onClick={() => void copyMcpCommand()} disabled={mcpPathChanged}>{copied ? '已复制' : '复制命令'}</Button></div><code>{mcpStatus.command}</code>{mcpPathChanged && <p>检查新路径后，命令会同步更新。</p>}</div>}
        <dl className="app-settings__diagnostics"><div><dt>命令登记</dt><dd>{mcpPathChanged ? '新路径尚未检查' : mcpStatus?.message || '尚无检查结果'}</dd></div>{mcpStatus?.runtime && <><div><dt>创作服务</dt><dd>{mcpStatus.runtime.message}</dd></div><div><dt>模型配置</dt><dd>{mcpStatus.runtime.modelConfigured ? '已配置' : '尚未配置'}</dd></div><div><dt>工具与任务</dt><dd>{mcpStatus.runtime.toolCount} 个工具 · {mcpStatus.runtime.activeRequests} 个活动请求</dd></div></>}</dl>
        {mcpStatus?.registeredCommand && mcpStatus.registration === 'different' && <div className="app-settings__command"><span>当前登记的旧命令</span><code>{mcpStatus.registeredCommand} {mcpStatus.registeredArgs.join(' ')}</code></div>}
      </div></details>
    </section>
    <EmbeddingSettings models={models} />
    <div className="app-settings__preferences">
      <section className="app-settings__section" aria-labelledby="settings-model-title"><h2 id="settings-model-title">模型</h2><p className="app-settings__model-name">{defaultModel?.name || (models.length ? '尚未选择默认模型' : '添加一个创作模型')}</p><p className="app-settings__description">{defaultModel ? `${defaultModel.modelId} · 项目可在创作台单独选择模型。` : '配置服务地址和密钥后，即可用于创作。'}</p>{modelError && <p className="app-settings__error" role="alert">{modelError}</p>}<Button onClick={() => navigate('/models')}>管理模型与搜索</Button></section>
      <section className="app-settings__section" aria-labelledby="settings-theme-title"><h2 id="settings-theme-title">外观</h2><div className="app-settings__themes" role="group" aria-label="应用外观">{THEMES.map((option) => <button type="button" key={option.value} className={`app-settings__theme app-settings__theme--${option.value}${theme === option.value ? ' is-selected' : ''}`} aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}><span className="app-settings__theme-sample"><i /><i /><i /></span><span>{option.label}{theme === option.value && <CheckOutlined />}</span></button>)}</div></section>
    </div>
    <section className="app-settings__section" aria-labelledby="settings-update-title"><div className="app-settings__section-heading"><div><h2 id="settings-update-title">版本与更新</h2><p className="app-settings__description">{status?.mode === 'installed' ? 'Windows 安装版' : status?.mode === 'portable' ? 'Windows 便携版' : desktopRuntime ? '桌面应用' : '网页预览'}</p></div><strong className="app-settings__version" data-app-version>{status?.currentVersion ? `v${status.currentVersion}` : desktopRuntime ? '读取中…' : '网页预览'}</strong></div>
      <p className="app-settings__update-status" data-update-status>{status ? statusText(status) : desktopRuntime ? '正在读取更新状态…' : '软件更新请在桌面版进行。'}</p>
      {downloading && <Progress percent={status.downloadPercent ?? 0} size="small" status="active" />}
      {(status?.error || loadError) && <Alert type="error" showIcon message={loadError || status?.error} />}
      <div className="app-settings__actions">{ready ? <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => void install()} loading={busy}>重启并安装</Button> : <Button icon={<ReloadOutlined />} onClick={() => void check()} loading={busy || status?.phase === 'checking'} disabled={!desktopRuntime || (!!status && status.mode !== 'installed') || downloading}>{status?.phase === 'error' || loadError ? '重试更新' : '检查更新'}</Button>}{desktopRuntime && <Button type="text" icon={<ExportOutlined />} onClick={() => void openReleasePage()}>GitHub 发布页</Button>}</div>
      <p className="app-settings__note">{status?.checkedAt ? `上次检查：${new Date(status.checkedAt).toLocaleString('zh-CN')}。` : ''}{status?.mode === 'installed' && '下载不打断写作，安装前会提示保存。'}</p>
      <details className="app-settings__details"><summary>作品保存与导出</summary><div className="app-settings__details-body"><p className="app-settings__description">作品保存在本机。打开作品后，可从右上角菜单导出 TXT、Markdown、Word 或 EPUB 正文。</p><p className="app-settings__note">正文导出不包含完整的人物、地图和项目配置。</p><div><Button onClick={() => navigate('/novels')}>选择要导出的作品 <ArrowRightOutlined /></Button></div></div></details>
    </section>
  </div>
}
