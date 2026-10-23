import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Switch } from 'antd'
import type { ZhuqueSettingsView, ZhuqueTestResult } from '../../shared/zhuque-detection'
import './zhuque-settings.css'

export default function ZhuqueSettings() {
  const [settings, setSettings] = useState<ZhuqueSettingsView | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [automatic, setAutomatic] = useState(true)
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<'save' | 'test' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [testResult, setTestResult] = useState<ZhuqueTestResult | null>(null)
  const locked = useRef(false)
  const busy = action !== null
  const canTest = !clearKey && (Boolean(key.trim()) || Boolean(settings?.apiKeySet))
  const invalidateResult = () => { setTestResult(null); setFeedback('') }
  useEffect(() => { let active = true; void window.electron.zhuque.getSettings().then(view => { if (active) setSettings(view) }).catch(() => { if (active) setFeedback('朱雀配置无法读取，请检查本机服务。') }); return () => { active = false } }, [])
  const edit = () => {
    if (!settings) return
    setEnabled(settings.enabled); setAutomatic(settings.autoDetect); setKey(''); setClearKey(false); setFeedback(''); setTestResult(null); setOpen(true)
  }
  const save = async (test: boolean) => {
    if (locked.current) return
    locked.current = true; setAction(test ? 'test' : 'save'); setFeedback(''); setTestResult(null)
    try {
      const view = await window.electron.zhuque.updateSettings({ enabled, autoDetect: automatic, ...(clearKey ? { apiKey: '' } : key.trim() ? { apiKey: key.trim() } : {}) })
      setSettings(view); setKey(''); setClearKey(false)
      window.dispatchEvent(new Event('novelforge:zhuque-settings-changed'))
      if (test) setTestResult(await window.electron.zhuque.test())
      else { setFeedback('朱雀配置已保存。'); setOpen(false) }
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : '未完成保存或测试，请稍后重试。'
      setFeedback(key.trim() ? message.split(key.trim()).join('[密钥已隐藏]') : message)
    }
    finally { locked.current = false; setAction(null) }
  }
  return <section className="admin-detail-stack" data-zhuque-settings>
    <div className="source-search-config__summary">
      <div className="source-search-config__summary-copy"><strong>朱雀 AI 检测</strong></div>
      <div className="source-search-config__status-grid">
        <div className="source-search-config__status"><span>检测状态</span><strong>{settings ? settings.enabled ? '已启用' : '已关闭' : '加载中'}</strong></div>
        <div className="source-search-config__status"><span>本地密钥</span><strong>{settings?.apiKeySet ? '已保存' : '未配置'}</strong></div>
        <div className="source-search-config__status"><span>保存后自动检测</span><strong>{settings?.enabled && settings.autoDetect ? '开启' : '关闭'}</strong></div>
      </div>
    </div>
    <div><Button disabled={!settings || busy} onClick={edit}>配置朱雀检测</Button></div>
    {feedback ? <p role="status">{feedback}</p> : null}
    <Modal title="朱雀检测配置" open={open} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={() => { if (!busy) { setOpen(false); setKey('') } }} footer={<Space><Button disabled={busy || !canTest} loading={action === 'test'} onClick={() => void save(true)}>保存并测试</Button><Button type="primary" disabled={busy} loading={action === 'save'} onClick={() => void save(false)}>保存配置</Button></Space>}>
      <div className="zhuque-settings-form">
        <label className="zhuque-settings-form__toggle">启用朱雀检测 <Switch aria-label="启用朱雀检测" checked={enabled} disabled={busy || clearKey} onChange={value => { setEnabled(value); invalidateResult() }} /></label>
        <label className="zhuque-settings-form__toggle">保存正文后自动检测 <Switch aria-label="保存正文后自动检测" checked={automatic} disabled={busy} onChange={value => { setAutomatic(value); invalidateResult() }} /></label>
        <label className="zhuque-settings-form__key">EdgeOne Makers API Key<Input.Password aria-label="朱雀 API Key" value={key} disabled={busy || clearKey} autoComplete="new-password" placeholder={settings?.apiKeySet ? '已保存；留空保留密钥' : '输入 API Key'} onChange={event => { setKey(event.target.value); invalidateResult() }} /></label>
        {settings?.apiKeySet ? <label className="zhuque-settings-form__toggle">清除本地密钥 <Switch aria-label="清除朱雀密钥" checked={clearKey} disabled={busy} onChange={value => { setClearKey(value); invalidateResult(); if (value) setEnabled(false) }} /></label> : null}

        <p className="zhuque-settings-form__link"><a href="https://cloud.tencent.com/document/product/1552/137539" target="_blank" rel="noreferrer">获取 API Key</a></p>
        <p className="zhuque-settings-form__hint">保存并测试仅提交固定示例文本。检测关闭时也可测试，正文检测仍保持关闭。</p>
        {testResult ? <p role="status">{testResult.info}{testResult.success ? `（${testResult.latency}ms）` : ''}</p> : null}
        {feedback ? <p role="status">{feedback}</p> : null}
      </div>
    </Modal>
  </section>
}
