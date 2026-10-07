import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Switch } from 'antd'
import type { ZhuqueSettingsView, ZhuqueTestResult } from '../../shared/zhuque-detection'

export default function ZhuqueSettings() {
  const [settings, setSettings] = useState<ZhuqueSettingsView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [automatic, setAutomatic] = useState(true)
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [testResult, setTestResult] = useState<ZhuqueTestResult | null>(null)
  const locked = useRef(false)
  useEffect(() => { let active = true; void window.electron.zhuque.getSettings().then(view => { if (active) setSettings(view) }).catch(() => { if (active) setFeedback('朱雀配置无法读取，请检查本机服务。') }); return () => { active = false } }, [])
  const edit = () => {
    if (!settings) return
    setEnabled(settings.enabled); setAutomatic(settings.autoDetect); setKey(''); setClearKey(false); setFeedback(''); setTestResult(null); setOpen(true)
  }
  const save = async (test: boolean) => {
    if (locked.current) return
    locked.current = true; setBusy(true); setFeedback(''); setTestResult(null)
    try {
      const view = await window.electron.zhuque.updateSettings({ enabled, autoDetect: automatic, ...(clearKey ? { apiKey: '' } : key.trim() ? { apiKey: key.trim() } : {}) })
      setSettings(view); setKey(''); setClearKey(false)
      window.dispatchEvent(new Event('novelforge:zhuque-settings-changed'))
      if (test) setTestResult(await window.electron.zhuque.test())
      else { setFeedback('朱雀配置已保存。'); setOpen(false) }
    } catch { setFeedback('未完成保存或测试。请确认已填写有效密钥、本机安全存储可用；测试需先启用检测。') }
    finally { locked.current = false; setBusy(false) }
  }
  return <section className="admin-detail-stack" data-zhuque-settings>
    <div className="source-search-config__summary">
      <div className="source-search-config__summary-copy"><strong>朱雀 AI 检测</strong><p>检查正文的 AI 内容占比，结果与文学质量评估分别展示。</p></div>
      <div className="source-search-config__status-grid">
        <div className="source-search-config__status"><span>检测状态</span><strong>{settings ? settings.enabled ? '已启用' : '已关闭' : '加载中'}</strong></div>
        <div className="source-search-config__status"><span>本地密钥</span><strong>{settings?.apiKeySet ? '已保存' : '未配置'}</strong></div>
        <div className="source-search-config__status"><span>保存后自动检测</span><strong>{settings?.enabled && settings.autoDetect ? '开启' : '关闭'}</strong></div>
      </div>
    </div>
    <div><Button disabled={!settings || busy} onClick={edit}>配置朱雀检测</Button></div>
    {feedback ? <p role="status">{feedback}</p> : null}
    <Modal title="朱雀检测配置" open={open} onCancel={() => { if (!busy) { setOpen(false); setKey('') } }} footer={<Space><Button disabled={busy || !enabled} onClick={() => void save(true)}>保存并测试</Button><Button type="primary" loading={busy} onClick={() => void save(false)}>保存配置</Button></Space>}>
      <div className="admin-detail-stack">
        <label>启用朱雀检测 <Switch aria-label="启用朱雀检测" checked={enabled} disabled={busy} onChange={setEnabled} /></label>
        <label>保存正文后自动检测 <Switch aria-label="保存正文后自动检测" checked={automatic} disabled={busy} onChange={setAutomatic} /></label>
        <label>EdgeOne Makers API Key<Input.Password aria-label="朱雀 API Key" value={key} disabled={busy || clearKey} autoComplete="new-password" placeholder={settings?.apiKeySet ? '已保存；留空保留密钥' : '输入 API Key'} onChange={event => setKey(event.target.value)} /></label>
        {settings?.apiKeySet ? <label>清除本地密钥 <Switch aria-label="清除朱雀密钥" checked={clearKey} disabled={busy} onChange={value => { setClearKey(value); if (value) setEnabled(false) }} /></label> : null}
        <p>密钥仅在本机加密保存，不参与项目导出或模型提示词。启用检测时，正文发送给腾讯朱雀，密钥仅用于官方接口鉴权。相同正文复用已成功的结果；失败后由你手动重试。</p>
        <p><a href="https://cloud.tencent.com/document/product/1552/137539" target="_blank" rel="noreferrer">获取 API Key 与接口说明</a></p>
        {testResult ? <p role="status">{testResult.info}{testResult.success ? `（${testResult.latency}ms）` : ''}</p> : null}
        {feedback ? <p role="status">{feedback}</p> : null}
      </div>
    </Modal>
  </section>
}
