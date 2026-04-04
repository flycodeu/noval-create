import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Form, Input, Select, Slider, Switch, Tag, message, Spin,
  Modal, InputNumber, Empty
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined,
  StarOutlined, StarFilled
} from '@ant-design/icons'
import { ModelConfig } from '../../types'

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o-mini'] },
  { value: 'anthropic', label: 'Anthropic Claude', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { value: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { value: 'aliyun', label: '阿里通义', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'] },
  { value: 'baidu', label: '百度文心', models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed'] },
  { value: 'custom', label: '自定义（OpenAI 兼容）', models: [] },
]

export default function ModelManager() {
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ModelConfig | null>(null)
  const [form] = Form.useForm()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency: number; info: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [isNew, setIsNew] = useState(false)

  const selectedProvider = Form.useWatch('provider', form)

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    const list = await window.electron.model.list()
    setConfigs(list)
    setLoading(false)
  }, [])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  const handleSelect = (config: ModelConfig) => {
    setSelected(config)
    setIsNew(false)
    setTestResult(null)
    form.setFieldsValue({
      name: config.name,
      provider: config.provider,
      modelId: config.modelId,
      apiKey: '已设置',
      baseUrl: config.baseUrl,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maxConcurrency: config.maxConcurrency,
    })
  }

  const handleNew = () => {
    setSelected(null)
    setIsNew(true)
    setTestResult(null)
    form.resetFields()
    form.setFieldsValue({ temperature: 0.85, maxTokens: 4096, maxConcurrency: 2, provider: 'openai' })
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (isNew) {
        const id = await window.electron.model.create(values)
        message.success('配置已创建')
        await loadConfigs()
        const newConfigs = await window.electron.model.list()
        const newConfig = newConfigs.find(c => c.id === id)
        if (newConfig) handleSelect(newConfig)
        setIsNew(false)
      } else if (selected) {
        await window.electron.model.update(selected.id, values)
        message.success('已保存')
        await loadConfigs()
      }
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (config: ModelConfig) => {
    Modal.confirm({
      title: `确认删除「${config.name}」？`,
      okType: 'danger',
      onOk: async () => {
        await window.electron.model.delete(config.id)
        setSelected(null)
        setIsNew(false)
        loadConfigs()
      },
    })
  }

  const handleSetDefault = async (config: ModelConfig) => {
    await window.electron.model.setDefault(config.id)
    loadConfigs()
    message.success(`已将「${config.name}」设为默认模型`)
  }

  const handleTest = async () => {
    if (!selected && !isNew) return
    if (isNew) {
      // 先保存再测试
      message.info('请先保存配置')
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electron.model.test(selected!.id)
      setTestResult(result)
    } catch {
      setTestResult({ success: false, latency: 0, info: '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  const currentProviderModels = PROVIDER_OPTIONS.find(p => p.value === selectedProvider)?.models || []

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* 左侧配置列表 */}
      <div style={{
        width: 240,
        borderRight: '1px solid var(--border-color)',
        background: 'var(--color-bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600 }}>模型配置</span>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            新建
          </Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
          ) : configs.length === 0 && !isNew ? (
            <Empty description="暂无配置" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '40px 0' }} />
          ) : (
            <>
              {configs.map(config => (
                <div
                  key={config.id}
                  onClick={() => handleSelect(config)}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: selected?.id === config.id ? 'rgba(46,134,171,0.15)' : 'transparent',
                    borderLeft: selected?.id === config.id ? '3px solid #2E86AB' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {config.name}
                    </span>
                    {config.isDefault === 1 && <StarFilled style={{ color: '#faad14', fontSize: 12 }} />}
                  </div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                    {PROVIDER_OPTIONS.find(p => p.value === config.provider)?.label}
                    {' · '}
                    {config.modelId}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* 右侧编辑表单 */}
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {(selected || isNew) ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
              <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>
                {isNew ? '新建模型配置' : `编辑：${selected?.name}`}
              </h2>
              <div style={{ display: 'flex', gap: 8 }}>
                {!isNew && selected && (
                  <>
                    <Button
                      icon={selected.isDefault ? <StarFilled /> : <StarOutlined />}
                      onClick={() => handleSetDefault(selected)}
                      style={{ color: selected.isDefault ? '#faad14' : undefined }}
                    >
                      {selected.isDefault ? '已设为默认' : '设为默认'}
                    </Button>
                    <Button
                      icon={<DeleteOutlined />}
                      danger
                      onClick={() => handleDelete(selected)}
                    >
                      删除
                    </Button>
                  </>
                )}
                <Button loading={saving} type="primary" onClick={handleSave}>保存</Button>
              </div>
            </div>

            <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
              <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
                <Input placeholder="例如：GPT-4o 主力模型" />
              </Form.Item>

              <Form.Item name="provider" label="AI 提供商" rules={[{ required: true }]}>
                <Select
                  options={PROVIDER_OPTIONS.map(p => ({ value: p.value, label: p.label }))}
                  onChange={() => form.setFieldValue('modelId', undefined)}
                />
              </Form.Item>

              <Form.Item name="modelId" label="模型 ID" rules={[{ required: true }]}>
                {currentProviderModels.length > 0 ? (
                  <Select
                    options={currentProviderModels.map(m => ({ value: m, label: m }))}
                    showSearch
                    allowClear
                  />
                ) : (
                  <Input placeholder="输入模型名称，例如：llama3:latest" />
                )}
              </Form.Item>

              <Form.Item name="apiKey" label={selectedProvider === 'baidu' ? 'API Key（格式：APIKey|SecretKey）' : 'API Key'}>
                <Input.Password placeholder={selectedProvider === 'baidu' ? 'APIKey|SecretKey' : '输入 API Key'} />
              </Form.Item>

              {(selectedProvider === 'openai' || selectedProvider === 'custom') && (
                <Form.Item name="baseUrl" label="Base URL">
                  <Input placeholder={selectedProvider === 'custom' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1（留空使用默认）'} />
                </Form.Item>
              )}

              <Form.Item name="temperature" label="Temperature（创造性）">
                <Slider min={0} max={1} step={0.05} marks={{ 0: '0', 0.5: '0.5', 1: '1' }} />
              </Form.Item>

              <Form.Item name="maxTokens" label="Max Tokens（最大输出）">
                <InputNumber min={512} max={32000} step={512} style={{ width: '100%' }} />
              </Form.Item>

              <Form.Item name="maxConcurrency" label="最大并发请求数">
                <InputNumber min={1} max={8} step={1} style={{ width: '100%' }} />
              </Form.Item>

              {/* 测试连接 */}
              {!isNew && selected && (
                <div style={{
                  padding: 16,
                  background: 'var(--color-bg-card)',
                  borderRadius: 'var(--radius-md)',
                  marginTop: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Button loading={testing} onClick={handleTest}>测试连接</Button>
                    {testResult && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {testResult.success ? (
                          <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        ) : (
                          <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        )}
                        <span style={{ color: testResult.success ? '#52c41a' : '#ff4d4f' }}>
                          {testResult.success ? `连接成功 · ${testResult.latency}ms` : testResult.info}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Form>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Empty description="选择左侧配置进行编辑，或点击「新建」创建配置" />
          </div>
        )}
      </div>
    </div>
  )
}
