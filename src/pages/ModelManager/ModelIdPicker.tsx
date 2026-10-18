import React, { useEffect, useRef, useState } from 'react'
import { AutoComplete, Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { getErrorMessage } from '@/utils/user-facing-message'

interface ModelIdPickerProps {
  id?: string
  value?: string
  onChange?: (value: string) => void
  onSelect?: (value: string) => void
  provider?: string
  apiKey?: string
  baseUrl?: string
  configId?: number
  active: boolean
  disabled?: boolean
  suggestedModels: string[]
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-required'?: boolean | 'true' | 'false'
}

const DISCOVERY_PROVIDERS = new Set(['openai', 'anthropic', 'deepseek', 'kimi', 'aliyun', 'custom'])

export default function ModelIdPicker({
  id,
  value,
  onChange,
  onSelect,
  provider,
  apiKey,
  baseUrl,
  configId,
  active,
  disabled = false,
  suggestedModels,
  ...accessibility
}: ModelIdPickerProps) {
  const [models, setModels] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const requestRef = useRef(0)
  const supported = DISCOVERY_PROVIDERS.has(provider || '')

  useEffect(() => {
    requestRef.current += 1
    setModels(null)
    setError('')
    setLoading(false)
    setSearch('')
    setOpen(false)
    return () => { requestRef.current += 1 }
  }, [provider, apiKey, baseUrl, configId, active])

  const discover = async () => {
    if (!provider || !supported || loading || disabled) return
    if (provider !== 'custom' && !apiKey?.trim()) {
      setError('请先填写 API Key，再拉取模型列表。')
      return
    }
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    try {
      const result = await window.electron.model.discover({ provider, apiKey, baseUrl, configId })
      if (requestId !== requestRef.current) return
      setModels(result.models)
      setSearch('')
      setOpen(result.models.length > 0)
    } catch (cause) {
      if (requestId !== requestRef.current) return
      setError(getErrorMessage(cause, 'common.loadFailed'))
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }

  const candidates = models ?? suggestedModels
  const options = candidates
    .filter((model) => model.toLowerCase().includes(search.trim().toLowerCase()))
    .map((model) => ({ value: model, label: model }))
  const hint = !supported
    ? '此提供商暂不支持拉取列表，请选择预置模型或直接输入模型 ID。'
    : models !== null
      ? models.length > 0
        ? `已拉取 ${models.length} 个模型，可搜索选择，也可手动输入。`
        : '接口未返回可用模型，仍可手动输入模型 ID。'
      : '可手动输入模型 ID，或填写接口与密钥后拉取。'

  return (
    <div className="model-id-picker" data-model-discovery-count={models?.length || 0}>
      <div className="model-id-picker__controls">
        <AutoComplete
          {...accessibility}
          id={id}
          aria-label="模型 ID"
          value={value}
          disabled={disabled}
          options={options}
          open={active && open}
          filterOption={false}
          defaultActiveFirstOption={false}
          allowClear
          placeholder="拉取后选择，或直接输入模型 ID"
          onChange={onChange}
          onSearch={setSearch}
          onFocus={() => setSearch('')}
          onSelect={(model) => {
            setSearch('')
            setOpen(false)
            onSelect?.(model)
          }}
          onOpenChange={(visible) => {
            setOpen(visible)
            if (!visible) setSearch('')
          }}
        />
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          disabled={!supported || disabled}
          onClick={() => void discover()}
        >
          拉取模型
        </Button>
      </div>
      <div
        className={`model-id-picker__status${error ? ' is-error' : ''}`}
        data-model-discovery-status
        role={error ? 'alert' : 'status'}
      >
        {loading ? '正在拉取模型列表…' : error || hint}
      </div>
    </div>
  )
}
