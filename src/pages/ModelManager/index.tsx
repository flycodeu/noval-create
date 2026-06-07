import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Form, Input, Select, Slider, message,
  Modal, InputNumber, Empty, Skeleton
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined,
  StarOutlined, StarFilled
} from '@ant-design/icons'
import { ModelConfig } from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

const DEFAULT_MODEL_MAX_TOKENS = 65536
const MAX_MODEL_MAX_TOKENS = 1000000

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o-mini'] },
  { value: 'anthropic', label: 'Anthropic Claude', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { value: 'deepseek', label: 'DeepSeek', models: [] },
  { value: 'kimi', label: 'Kimi / Moonshot', models: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'] },
  { value: 'aliyun', label: '阿里通义', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'] },
  { value: 'baidu', label: '百度文心', models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed'] },
  { value: 'custom', label: '自定义（OpenAI 兼容）', models: [] },
]
const PROVIDER_DEFAULTS: Record<string, { temperature: number; maxTokens: number; modelId?: string; baseUrl?: string; maxContextTokens?: number }> = {
  openai: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'gpt-4o', baseUrl: '' },
  anthropic: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'claude-sonnet-4-6' },
  deepseek: { temperature: 0.7, maxTokens: 384000, modelId: 'deepseek-v4-flash', baseUrl: '' },
  kimi: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'kimi-k2.6', baseUrl: '', maxContextTokens: 256000 },
  aliyun: { temperature: 0.85, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'qwen-max' },
  baidu: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'ernie-4.0-8k' },
  custom: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, baseUrl: 'http://localhost:11434/v1' },
}

function providerRequiresApiKey(provider?: string): boolean {
  return provider !== 'custom'
}

function parseModelExtraParams(raw?: string | null): { kimiThinking?: 'enabled' | 'disabled' } {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return record.kimiThinking === 'enabled' || record.kimiThinking === 'disabled'
      ? { kimiThinking: record.kimiThinking }
      : {}
  } catch {
    return {}
  }
}

function getKimiContextWindow(modelId?: string): number | undefined {
  const normalized = (modelId || '').trim().toLowerCase()
  if (normalized === 'kimi-k2.6' || normalized === 'kimi-k2.5') return 256000
  if (normalized === 'moonshot-v1-8k') return 8000
  if (normalized === 'moonshot-v1-32k') return 32000
  if (normalized === 'moonshot-v1-128k') return 128000
  return undefined
}

function buildModelSavePayload(values: Record<string, unknown>): Record<string, unknown> {
  const provider = typeof values.provider === 'string' ? values.provider : ''
  const kimiThinking = values.kimiThinking === 'enabled' || values.kimiThinking === 'disabled'
    ? values.kimiThinking
    : 'disabled'
  const extraParamsJson = provider === 'kimi' ? JSON.stringify({ kimiThinking }) : null
  const { kimiThinking: _kimiThinking, ...payload } = values
  return {
    ...payload,
    extraParamsJson,
  }
}

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
  const selectedModelId = Form.useWatch('modelId', form)
  const selectedConfigProvider = selected?.provider

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    const list = await window.electron.model.list()
    setConfigs(list)
    setLoading(false)
  }, [])

  useEffect(() => { loadConfigs() }, [loadConfigs])

  const applyProviderDefaults = useCallback((provider: string, resetCredentials = false) => {
    const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai
    form.setFieldsValue({
      modelId: defaults.modelId,
      baseUrl: defaults.baseUrl,
      temperature: defaults.temperature,
      maxTokens: defaults.maxTokens,
      maxContextTokens: defaults.maxContextTokens,
      kimiThinking: provider === 'kimi' ? 'disabled' : undefined,
      ...(resetCredentials ? { apiKey: '' } : {}),
    })
  }, [form])

  const handleSelect = (config: ModelConfig) => {
    const extraParams = parseModelExtraParams(config.extraParamsJson)
    setSelected(config)
    setIsNew(false)
    setTestResult(null)
    form.setFieldsValue({
      name: config.name,
      provider: config.provider,
      modelId: config.modelId,
      apiKey: config.apiKey ? '已设置' : '',
      baseUrl: config.baseUrl,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maxContextTokens: config.maxContextTokens ?? undefined,
      maxConcurrency: config.maxConcurrency,
      kimiThinking: config.provider === 'kimi' ? extraParams.kimiThinking || 'disabled' : undefined,
    })
  }

  const handleNew = () => {
    setSelected(null)
    setIsNew(true)
    setTestResult(null)
    form.resetFields()
    form.setFieldsValue({ maxConcurrency: 2, provider: 'openai', maxContextTokens: undefined })
    applyProviderDefaults('openai')
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    const payload = buildModelSavePayload(values)
    setSaving(true)
    try {
      if (isNew) {
        const id = await window.electron.model.create(payload)
        message.success(getUserFacingMessage('model.created'))
        await loadConfigs()
        const newConfigs = await window.electron.model.list()
        const newConfig = newConfigs.find(c => c.id === id)
        if (newConfig) handleSelect(newConfig)
        setIsNew(false)
      } else if (selected) {
        await window.electron.model.update(selected.id, payload)
        message.success(getUserFacingMessage('model.saved'))
        await loadConfigs()
      }
    } catch (error) {
      message.error(getErrorMessage(error, 'model.saveFailed'))
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
    message.success(getUserFacingMessage('model.defaultSet', { name: config.name }))
  }

  const handleTest = async () => {
    if (!selected && !isNew) return
    if (isNew) {
      // 先保存再测试
      message.info(getUserFacingMessage('model.saveFirst'))
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.electron.model.test(selected!.id)
      setTestResult(result)
    } catch {
      setTestResult({ success: false, latency: 0, info: getUserFacingMessage('model.testFailed') })
    } finally {
      setTesting(false)
    }
  }

  const currentProviderModels = PROVIDER_OPTIONS.find(p => p.value === selectedProvider)?.models || []
  const fixedTemperatureKimiModel = selectedProvider === 'kimi' && (selectedModelId === 'kimi-k2.6' || selectedModelId === 'kimi-k2.5')
  const defaultCount = configs.filter((config) => config.isDefault === 1).length
  const providerCount = new Set(configs.map((config) => config.provider)).size

  return (
    <WorkspacePage
      className="admin-page model-manager-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="模型与连接"
      title="模型管理"
      description="集中维护模型提供商、上下文窗口、默认配置和连接测试。左侧看配置清单，右侧编辑可立即生效的运行参数。"
      actions={(
        <div className="admin-toolbar">
          <div className="novel-pill">{`已配置 ${configs.length} 套模型，默认 ${defaultCount} 套`}</div>
          <div className="admin-toolbar__actions">
            <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
              新建配置
            </Button>
          </div>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="模型配置" value={configs.length} tone="cool" />
          <WorkspaceMetric label="默认配置" value={defaultCount} />
          <WorkspaceMetric label="接入厂商" value={providerCount} tone="warm" />
          <WorkspaceMetric label="当前状态" value={selected || isNew ? '正在编辑' : '待选择'} />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          scrollable
          title="配置列表"
          description="默认模型会带星标，点击左侧即可切换编辑对象。"
          extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNew}>新建</Button>}
        >
          {loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : configs.length === 0 && !isNew ? (
            <div className="admin-empty-panel">
              <Empty description="暂无配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : (
            <div className="admin-sidebar-list">
              {configs.map((config) => (
                <button
                  key={config.id}
                  type="button"
                  className={`admin-sidebar-item ${selected?.id === config.id ? 'admin-sidebar-item--active' : ''}`}
                  onClick={() => handleSelect(config)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {config.name}
                    </span>
                    {config.isDefault === 1 ? <StarFilled style={{ color: '#faad14', fontSize: 12 }} /> : null}
                  </div>
                  <div className="admin-sidebar-item__meta">
                    {PROVIDER_OPTIONS.find((item) => item.value === config.provider)?.label}
                    {' · '}
                    {config.modelId}
                  </div>
                </button>
              ))}
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          title={(selected || isNew) ? (isNew ? '新建模型配置' : `编辑：${selected?.name}`) : '配置详情'}
          description={(selected || isNew) ? '修改后会直接影响运行时可用模型、默认连接与上下文预算。' : '先从左侧选择一套模型配置，或直接新建一套配置。'}
          extra={(selected || isNew) ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!isNew && selected ? (
                <>
                  <Button
                    icon={selected.isDefault ? <StarFilled /> : <StarOutlined />}
                    onClick={() => handleSetDefault(selected)}
                    style={{ color: selected.isDefault ? '#faad14' : undefined }}
                  >
                    {selected.isDefault ? '已设为默认' : '设为默认'}
                  </Button>
                  <Button icon={<DeleteOutlined />} danger onClick={() => handleDelete(selected)}>
                    删除
                  </Button>
                </>
              ) : null}
              <Button loading={saving} type="primary" onClick={handleSave}>保存</Button>
            </div>
          ) : null}
        >
          {(selected || isNew) ? (
            <div className="admin-detail-stack">
            <Form form={form} layout="vertical" style={{ maxWidth: 560 }}>
              <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
                <Input placeholder="例如：GPT-4o 主力模型" />
              </Form.Item>

              <Form.Item name="provider" label="AI 提供商" rules={[{ required: true }]}>
                <Select
                  options={PROVIDER_OPTIONS.map(p => ({ value: p.value, label: p.label }))}
                  onChange={(value) => {
                    setTestResult(null)
                    applyProviderDefaults(value, true)
                  }}
                />
              </Form.Item>

              <Form.Item name="modelId" label="模型 ID" rules={[{ required: true }]}>
                {currentProviderModels.length > 0 ? (
                  <Select
                    options={currentProviderModels.map(m => ({ value: m, label: m }))}
                    showSearch
                    allowClear
                    onChange={(value) => {
                      if (selectedProvider === 'kimi') {
                        const contextWindow = getKimiContextWindow(value)
                        form.setFieldValue('maxContextTokens', contextWindow)
                      }
                    }}
                  />
                ) : (
                  <Input placeholder={selectedProvider === 'deepseek'
                    ? '输入模型名称，例如：deepseek-v4-flash'
                    : selectedProvider === 'kimi'
                      ? '输入模型 ID，例如：kimi-k2.6'
                      : '输入模型名称，例如：llama3:latest'} />
                )}
              </Form.Item>

              <Form.Item
                name="apiKey"
                label={selectedProvider === 'baidu' ? 'API Key（格式：APIKey|SecretKey）' : 'API Key'}
                rules={[{
                  validator: async (_, value) => {
                    if (!providerRequiresApiKey(selectedProvider)) return
                    const textValue = typeof value === 'string' ? value.trim() : ''
                    if (textValue && textValue !== '已设置') return
                    if (!isNew && selected?.apiKey && selectedProvider === selectedConfigProvider && textValue === '已设置') return
                    throw new Error(getUserFacingMessage('model.apiKeyRequired'))
                  },
                }]}
              >
                <Input.Password placeholder={selectedProvider === 'baidu' ? 'APIKey|SecretKey' : '输入 API Key'} />
              </Form.Item>

              {(selectedProvider === 'openai' || selectedProvider === 'custom' || selectedProvider === 'deepseek' || selectedProvider === 'kimi') && (
                <Form.Item name="baseUrl" label="Base URL">
                  <Input
                    placeholder={
                      selectedProvider === 'custom'
                        ? 'http://localhost:11434/v1'
                        : selectedProvider === 'deepseek'
                          ? 'https://api.deepseek.com（留空使用默认）'
                          : selectedProvider === 'kimi'
                            ? 'https://api.moonshot.ai/v1（留空使用默认）'
                          : 'https://api.openai.com/v1（留空使用默认）'
                    }
                  />
                </Form.Item>
              )}

              {selectedProvider === 'kimi' && (
                <Form.Item
                  name="kimiThinking"
                  label="Kimi Thinking"
                  extra="默认禁用，降低连接测试和正文生成的不确定成本；需要模型显式思考时可开启。"
                >
                  <Select
                    options={[
                      { value: 'disabled', label: 'Disabled' },
                      { value: 'enabled', label: 'Enabled' },
                    ]}
                  />
                </Form.Item>
              )}

              <Form.Item
                name="temperature"
                label="Temperature（创造性）"
                extra={fixedTemperatureKimiModel ? 'Kimi K2.x 使用固定采样参数，运行时会忽略此项。' : undefined}
              >
                <Slider disabled={fixedTemperatureKimiModel} min={0} max={1} step={0.05} marks={{ 0: '0', 0.5: '0.5', 1: '1' }} />
              </Form.Item>

              <Form.Item
                name="maxTokens"
                label="Max Tokens（最大输出长度）"
                extra={selectedProvider === 'deepseek'
                  ? 'DeepSeek V4 当前最大输出长度为 384K。这里控制单次回复最多可生成多少 Token。'
                  : '控制单次回复最多可生成多少 Token。可设置到更大的输出预算，但实际可用上限仍取决于模型提供方。'}
              >
                <InputNumber min={512} max={MAX_MODEL_MAX_TOKENS} step={512} style={{ width: '100%' }} placeholder="例如：65536 / 128000 / 1000000" />
              </Form.Item>

              <Form.Item
                name="maxContextTokens"
                label="上下文窗口（总上下文预算，可留空使用默认）"
                extra={selectedProvider === 'deepseek'
                  ? 'DeepSeek V4 当前上下文窗口为 1M。通常应大于等于最大输出长度；留空时使用 DeepSeek 默认窗口。'
                  : selectedProvider === 'kimi'
                    ? 'Kimi K2.x 默认上下文窗口按 256K 预估；Moonshot v1 按模型名使用 8K/32K/128K。'
                  : '控制模型可接收的上下文总量。通常应大于等于最大输出长度。留空时使用对应适配器的默认窗口。'}
              >
                <InputNumber min={2048} max={2000000} step={1024} style={{ width: '100%' }} placeholder="例如：200000 / 512000 / 1000000" />
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
            </div>
          ) : (
            <div className="admin-empty-panel">
              <Empty description="选择左侧配置进行编辑，或点击“新建配置”创建配置" />
            </div>
          )}
        </WorkspacePanel>
      </div>
    </WorkspacePage>
  )
}
