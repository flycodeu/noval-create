import React, { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import { ExportOutlined, MinusOutlined } from '@ant-design/icons'

/** One dialog above the routes, including Alt+F4 and taskbar close requests. */
export default function CloseWindowDialog() {
  const [open, setOpen] = useState(false)
  const [unsaved, setUnsaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const continueButton = useRef<HTMLButtonElement>(null)
  useEffect(() => window.electron?.windowControls?.onCloseRequested?.((hasUnsavedChanges) => {
    setUnsaved(hasUnsavedChanges)
    setError('')
    setOpen(true)
  }), [])
  const choose = async (choice: 'minimize' | 'exit') => {
    setBusy(true)
    setError('')
    // Close first: an editor's beforeunload guard may immediately reopen this
    // dialog with an unsaved warning while the IPC response is still pending.
    setOpen(false)
    try { await window.electron.windowControls.confirmClose(choice) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作未完成，请重试'); setOpen(true) }
    finally { setBusy(false) }
  }
  return <Modal open={open} centered width={440} className="close-window-dialog" title={unsaved ? '先保存，再退出' : '结束本次创作？'}
    onCancel={() => setOpen(false)} maskClosable={false} afterOpenChange={(visible) => { if (visible) continueButton.current?.focus() }}
    footer={<Button ref={continueButton} onClick={() => setOpen(false)}>继续编辑</Button>}>
    {unsaved && <p className="close-window-dialog__intro">还有未保存的修改。返回编辑器保存后，再退出软件。</p>}
    <div className="close-window-dialog__choices">
      <button type="button" disabled={busy} onClick={() => void choose('minimize')} className="close-window-dialog__choice">
        <MinusOutlined /><span><strong>最小化到任务栏</strong><small>保留编辑内容，正在运行的任务继续。</small></span>
      </button>
      {!unsaved && <button type="button" disabled={busy} onClick={() => void choose('exit')} className="close-window-dialog__choice close-window-dialog__choice--exit">
        <ExportOutlined /><span><strong>退出 NovelForge</strong><small>停止正在运行的任务，并断开 MCP 连接。</small></span>
      </button>}
    </div>
    {error && <p role="alert" className="close-window-dialog__error">{error}</p>}
  </Modal>
}
