import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, InputNumber, Modal, Switch, message } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import type { HistoryCleanupPreview, HistoryRetentionSettings } from '../../shared/history-retention'
import type { TaskHistoryClearResult } from '../../types'
import { getUserFacingMessage } from '../../utils/user-facing-message'

type RetentionDraft = Omit<HistoryRetentionSettings, 'keepDays'> & { keepDays: number | null }
function validPolicy(value: RetentionDraft | null): value is HistoryRetentionSettings {
  return value !== null && value.keepDays !== null && Number.isInteger(value.keepDays) && value.keepDays >= 1 && value.keepDays <= 3650
}

export default function HistoryCleanup({ onCleaned }: { onCleaned: (result: TaskHistoryClearResult) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<RetentionDraft | null>(null)
  const [preview, setPreview] = useState<HistoryCleanupPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const settingsRef = useRef(settings)
  useEffect(() => { settingsRef.current = settings }, [settings])
  useEffect(() => {
    if (!open || !validPolicy(settings)) return
    let active = true
    void window.electron.task.previewCleanup(settings).then(result => {
      if (active) { setPreview(result); setError('') }
    }).catch(() => { if (active) setError(getUserFacingMessage('historyRetention.previewFailed')) })
    return () => { active = false }
  }, [open, settings])

  const show = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true); setError('')
    try { setPreview(null); setSettings(await window.electron.task.getRetentionSettings()); setOpen(true) }
    catch { message.error(getUserFacingMessage('historyRetention.settingsLoadFailed')) }
    finally { locked.current = false; setBusy(false) }
  }
  const save = async () => {
    if (!validPolicy(settings) || locked.current) return
    locked.current = true; setBusy(true)
    try { await window.electron.task.updateRetentionSettings(settings); message.success(getUserFacingMessage('historyRetention.saved')); setOpen(false) }
    catch { setError(getUserFacingMessage('historyRetention.saveFailed')) }
    finally { locked.current = false; setBusy(false) }
  }
  const clean = () => {
    if (!validPolicy(settings) || !preview || locked.current) return
    const snapshot = settings
    Modal.confirm({ title: '删除过期运行记录？', content: `将删除 ${preview.taskCount} 条任务、${preview.attemptCount} 条关联调用记录和 ${preview.logCount} 个过期日志文件。删除后不可恢复。`, okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => {
      if (locked.current || settingsRef.current !== snapshot) return
      locked.current = true; setBusy(true)
      try {
        const result = await window.electron.task.runCleanup(snapshot)
        setPreview(null)
        await onCleaned(result)
        setPreview(await window.electron.task.previewCleanup(snapshot))
        message.success(getUserFacingMessage('historyRetention.cleaned', { tasks: result.deletedCount, logs: result.deletedLogs }))
      } catch { setPreview(null); setError(getUserFacingMessage('historyRetention.cleanupIncomplete')) }
      finally { locked.current = false; setBusy(false) }
    } })
  }
  return <>
    <Button icon={<SettingOutlined />} loading={busy && !open} onClick={() => void show()}>清理设置</Button>
    <Modal title="历史清理" className="history-cleanup-modal" open={open} onCancel={() => { if (!busy) setOpen(false) }} maskClosable={!busy} closable={!busy} keyboard={!busy}
      footer={<><Button disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button danger disabled={busy || !preview || !preview.taskCount && !preview.logCount} onClick={clean}>立即清理</Button><Button type="primary" disabled={!validPolicy(settings)} loading={busy} onClick={() => void save()}>保存策略</Button></>}>
      {settings ? <div className="history-cleanup-form">
        <label>自动清理<Switch aria-label="自动清理" checked={settings.enabled} disabled={busy} onChange={enabled => { setPreview(null); setSettings({ ...settings, enabled }) }} /></label>
        <label>保留最近<InputNumber aria-label="保留天数" min={1} max={3650} precision={0} value={settings.keepDays} suffix="天" disabled={busy} onChange={keepDays => { setPreview(null); setSettings({ ...settings, keepDays }) }} /></label>
        <label>已结束任务与关联模型调用<Switch aria-label="清理已结束任务" checked={settings.cleanTasks} disabled={busy} onChange={cleanTasks => { setPreview(null); setSettings({ ...settings, cleanTasks }) }} /></label>
        <label>过期运行日志<Switch aria-label="清理过期日志" checked={settings.cleanLogs} disabled={busy} onChange={cleanLogs => { setPreview(null); setSettings({ ...settings, cleanLogs }) }} /></label>
        <p className="history-cleanup-note">自动清理在应用运行期间每小时检查。正文、资料、草稿、恢复链路、成果引用及撤销记录均保留。</p>
        <div className="history-cleanup-preview" role="status">{!validPolicy(settings) ? '请输入 1–3650 天的保留期限' : preview ? <><strong>{preview.taskCount} 条任务 · {preview.attemptCount} 条调用记录</strong><span>{preview.logCount} 个日志 · {(preview.logBytes / 1024 / 1024).toFixed(2)} MB</span><span>{preview.protectedTaskCount} 条关联任务受保护</span></> : '正在预览…'}</div>
        {error ? <Alert type="error" message={error} /> : null}
      </div> : null}
    </Modal>
  </>
}
