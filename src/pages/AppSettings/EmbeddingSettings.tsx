import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Select } from 'antd'
import type { ModelConfig } from '../../types'
import type { EmbeddingSettings as Settings } from '../../shared/embedding-settings'

export default function EmbeddingSettings({ models }: { models: ModelConfig[] }) {
  const [value, setValue] = useState<Settings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const aliveRef = useRef(false)
  const saving = useRef(false)
  useEffect(() => {
    let alive = true
    aliveRef.current = true
    void window.electron.agentTools.call({ toolId: 'novelforge.retrieval.settings_get', input: {} }).then(result => {
      if (!alive) return
      if (result.ok) setValue(result.data as Settings)
      else setError(result.error.code === 'TOOL_NOT_FOUND' ? '更新应用后可配置独立检索模型。' : result.error.message)
    }).catch(cause => { if (alive) setError(String(cause)) })
    return () => { alive = false; aliveRef.current = false }
  }, [])
  const save = async () => {
    if (!value || saving.current) return
    saving.current = true
    setBusy(true); setError(''); setSaved(false)
    try {
      const result = await window.electron.agentTools.call({ toolId: 'novelforge.retrieval.settings_set', input: { ...value } })
      if (!result.ok) throw new Error(result.error.message)
      window.dispatchEvent(new Event('novelforge:embedding-settings-changed'))
      if (!aliveRef.current) return
      setValue(result.data as Settings)
      setSaved(true)
    } catch (cause) { if (aliveRef.current) setError(cause instanceof Error ? cause.message : '保存检索模型失败') }
    finally { saving.current = false; if (aliveRef.current) setBusy(false) }
  }
  const update = (next: Settings) => { setValue(next); setSaved(false) }
  return <section className="app-settings__section"><h2>检索模型</h2>{value && <div className="app-settings__actions">
    <Select aria-label="向量检索方式" value={value.mode} disabled={busy} onChange={mode => update({ ...value, mode })} options={[{ value: 'local', label: '本地中文向量' }, { value: 'remote', label: '独立远程向量接口' }]} />
    {value.mode === 'remote' && <><Select aria-label="向量接口" value={value.modelConfigId} disabled={busy} onChange={modelConfigId => update({ ...value, modelConfigId })} options={models.filter(model => ['openai', 'custom'].includes(model.provider)).map(model => ({ value: model.id, label: model.name }))} /><Input aria-label="向量模型名称" placeholder="向量模型名称" value={value.modelId} disabled={busy} onChange={event => update({ ...value, modelId: event.target.value })} /></>}
    <Button loading={busy} onClick={() => void save()}>保存检索配置</Button>{saved && <span role="status">已保存</span>}
  </div>}<p className="app-settings__description">与写作、评审模型独立。远程接口沿用所选连接的地址和密钥；向量模型单独指定。修改后可在创作台重建索引。</p>{error && <p role="alert">{error}</p>}</section>
}
