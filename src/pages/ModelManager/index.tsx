import React, { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Skeleton,
  Slider,
  Space,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons'
import type {
  ModelConfig,
  SourceSearchProviderMode,
  SourceSearchSettingsUpdate,
  SourceSearchSettingsView,
  SourceSearchTestResult,
} from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../Novel/components/WorkspaceShell'

const DEFAULT_MODEL_MAX_TOKENS = 65536
const MAX_MODEL_MAX_TOKENS = 1000000
const MASKED_KEY = '已设置'

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-4o-mini'] },
  { value: 'anthropic', label: 'Anthropic Claude', models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] },
  { value: 'deepseek', label: 'DeepSeek', models: [] },
  { value: 'kimi', label: 'Kimi / Moonshot', models: ['kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'] },
  { value: 'aliyun', label: '阿里通义 Qwen', models: ['qwen3.6-max', 'qwen3.6-plus', 'qwen3.5-plus', 'qwen-max', 'qwen-plus', 'qwen-long'] },
  { value: 'baidu', label: '百度文心', models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed'] },
  { value: 'custom', label: '自定义（OpenAI 兼容）', models: [] },
  { value: 'codex', label: 'Codex 原生模型（本机登录）', models: [] },
  { value: 'claude_code', label: 'Claude 原生模型（本机登录）', models: [] },
]

const PROVIDER_DEFAULTS: Record<string, { temperature: number; maxTokens: number; modelId?: string; baseUrl?: string; maxContextTokens?: number }> = {
  openai: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'gpt-4o', baseUrl: '' },
  anthropic: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'claude-sonnet-4-6' },
  deepseek: { temperature: 0.7, maxTokens: 384000, modelId: 'deepseek-v4-flash', baseUrl: '' },
  kimi: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'kimi-k2.6', baseUrl: 'https://api.moonshot.cn/v1', maxContextTokens: 256000 },
  aliyun: { temperature: 0.85, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'qwen3.6-max', maxContextTokens: 128000 },
  baidu: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'ernie-4.0-8k' },
  custom: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, baseUrl: 'http://localhost:11434/v1' },
  codex: { temperature: 0.8, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'gpt-5', maxContextTokens: 128000 },
  claude_code: { temperature: 0.75, maxTokens: DEFAULT_MODEL_MAX_TOKENS, modelId: 'sonnet', maxContextTokens: 200000 },
}

const SOURCE_PROVIDER_OPTIONS = [
  { value: 'auto', label: '自动选择' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'brave', label: 'Brave Search' },
  { value: 'disabled', label: '关闭来源检索' },
]

const SOURCE_PROVIDER_GUIDE: Record<SourceSearchProviderMode, { title: string; detail: string }> = {
  auto: {
    title: '自动选择可用检索',
    detail: '系统会按当前可用配置选择检索来源。',
  },
  tavily: {
    title: '固定使用 Tavily',
    detail: '用于网页摘要和来源补充。',
  },
  brave: {
    title: '固定使用 Brave Search',
    detail: '用于通用网页检索结果。',
  },
  disabled: {
    title: '关闭来源检索',
    detail: '不会自动补充网页资料。',
  },
}

function providerRequiresApiKey(provider?: string): boolean {
  return provider !== 'custom' && provider !== 'codex' && provider !== 'claude_code'
}

function isNativeAgentProvider(provider?: string): boolean {
  return provider === 'codex' || provider === 'claude_code'
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

function getProviderDefaultContextWindow(provider?: string, modelId?: string): number {
  if (provider === 'anthropic') return 200000
  if (provider === 'deepseek') return 1000000
  if (provider === 'kimi') return getKimiContextWindow(modelId) || 256000
  if (provider === 'openai') return 128000
  if (provider === 'aliyun') return 32000
  if (provider === 'baidu') return 8192
  if (provider === 'codex') return 128000
  if (provider === 'claude_code') return 200000
  return 32000
}

function formatTokenBudget(value?: number | null) {
  if (!value || !Number.isFinite(value)) return '默认'
  if (value >= 10000) return `${Math.round(value / 1000)}K`
  return String(value)
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

function getSourceProviderLabel(provider?: string | null) {
  if (provider === 'tavily') return 'Tavily'
  if (provider === 'brave') return 'Brave'
  if (provider === 'disabled') return '已关闭'
  return '自动'
}

function getSourceKeyStatus(saved?: boolean, env?: boolean) {
  if (saved && env) return '已保存 + 环境变量'
  if (saved) return '已保存'
  if (env) return '环境变量'
  return '未配置'
}

function formatSavedAt(value?: string | null) {
  if (!value) return '未保存'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

export default function ModelManager() {
  const [configs, setConfigs] = useState<ModelConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ModelConfig | null>(null)
  const [form] = Form.useForm()
  const [sourceForm] = Form.useForm<SourceSearchSettingsUpdate>()
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; latency: number; info: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false)
  const [sourceSettings, setSourceSettings] = useState<SourceSearchSettingsView | null>(null)
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceTesting, setSourceTesting] = useState(false)
  const [sourceTestResult, setSourceTestResult] = useState<SourceSearchTestResult | null>(null)

  const selectedProvider = Form.useWatch('provider', form)
  const selectedModelId = Form.useWatch('modelId', form)
  const selectedConfigProvider = selected?.provider
  const selectedSourceProvider = Form.useWatch('provider', sourceForm)

  const refreshConfigs = useCallback(async () => {
    const list = await window.electron.model.list()
    setConfigs(list)
    return list
  }, [])

  const loadConfigs = useCallback(async () => {
    setLoading(true)
    try {
      await refreshConfigs()
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [refreshConfigs])

  const loadSourceSettings = useCallback(async () => {
    try {
      const settings = await window.electron.sourceSearch.getSettings()
      setSourceSettings(settings)
      sourceForm.setFieldsValue({
        provider: settings.provider,
        tavilyApiKey: settings.tavilyApiKeySet ? MASKED_KEY : '',
        braveApiKey: settings.braveApiKeySet ? MASKED_KEY : '',
      })
    } catch (error) {
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }
  }, [sourceForm])

  useEffect(() => {
    void loadConfigs()
    void loadSourceSettings()
  }, [loadConfigs, loadSourceSettings])

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

  const hydrateModelForm = useCallback((config: ModelConfig) => {
    const extraParams = parseModelExtraParams(config.extraParamsJson)
    form.setFieldsValue({
      name: config.name,
      provider: config.provider,
      modelId: config.modelId,
      apiKey: config.apiKey ? MASKED_KEY : '',
      baseUrl: config.baseUrl,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      maxContextTokens: config.maxContextTokens ?? undefined,
      maxConcurrency: config.maxConcurrency,
      kimiThinking: config.provider === 'kimi' ? extraParams.kimiThinking || 'disabled' : undefined,
    })
  }, [form])

  const selectConfig = (config: ModelConfig) => {
    setSelected(config)
    setIsNew(false)
    setTestResult(null)
    hydrateModelForm(config)
  }

  const openModelEditor = (config: ModelConfig) => {
    selectConfig(config)
    setEditorOpen(true)
  }

  const handleNew = () => {
    setSelected(null)
    setIsNew(true)
    setTestResult(null)
    form.resetFields()
    form.setFieldsValue({ maxConcurrency: 2, provider: 'openai', maxContextTokens: undefined })
    applyProviderDefaults('openai')
    setEditorOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    const payload = buildModelSavePayload(values)
    setSaving(true)
    try {
      if (isNew) {
        const id = await window.electron.model.create(payload)
        const nextConfigs = await refreshConfigs()
        const newConfig = nextConfigs.find((config) => config.id === id)
        message.success(getUserFacingMessage('model.created'))
        if (newConfig) {
          setSelected(newConfig)
          hydrateModelForm(newConfig)
          setIsNew(false)
          setEditorOpen(false)
        } else {
          message.warning(getUserFacingMessage('model.saveListNotRefreshed'))
        }
        return
      }

      if (selected) {
        await window.electron.model.update(selected.id, payload)
        const nextConfigs = await refreshConfigs()
        const updated = nextConfigs.find((config) => config.id === selected.id)
        if (updated) {
          setSelected(updated)
          hydrateModelForm(updated)
        }
        message.success(getUserFacingMessage('model.saved'))
        setEditorOpen(false)
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
        try {
          await window.electron.model.delete(config.id)
          const nextConfigs = await refreshConfigs()
          setSelected((current) => current?.id === config.id ? null : current)
          setIsNew(false)
          setEditorOpen(false)
          if (nextConfigs.length === 0) {
            setTestResult(null)
          }
          message.success(getUserFacingMessage('model.deleted'))
        } catch (error) {
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }

  const handleSetDefault = async (config: ModelConfig) => {
    try {
      await window.electron.model.setDefault(config.id)
      const nextConfigs = await refreshConfigs()
      const updated = nextConfigs.find((item) => item.id === config.id)
      if (updated) {
        setSelected(updated)
        hydrateModelForm(updated)
      }
      message.success(getUserFacingMessage('model.defaultSet', { name: config.name }))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }

  const handleTest = async () => {
    if (!selected && !isNew) return
    if (isNew) {
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

  const openSourceEditor = () => {
    if (sourceSettings) {
      sourceForm.setFieldsValue({
        provider: sourceSettings.provider,
        tavilyApiKey: sourceSettings.tavilyApiKeySet ? MASKED_KEY : '',
        braveApiKey: sourceSettings.braveApiKeySet ? MASKED_KEY : '',
      })
    }
    setSourceEditorOpen(true)
  }

  const handleSourceSave = async () => {
    const values = await sourceForm.validateFields().catch(() => null)
    if (!values) return
    setSourceSaving(true)
    try {
      const settings = await window.electron.sourceSearch.updateSettings(values)
      setSourceSettings(settings)
      sourceForm.setFieldsValue({
        provider: settings.provider,
        tavilyApiKey: settings.tavilyApiKeySet ? MASKED_KEY : '',
        braveApiKey: settings.braveApiKeySet ? MASKED_KEY : '',
      })
      setSourceTestResult(null)
      setSourceEditorOpen(false)
      message.success(getUserFacingMessage('model.sourceSearchSaved'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSourceSaving(false)
    }
  }

  const handleSourceTest = async () => {
    setSourceTesting(true)
    setSourceTestResult(null)
    try {
      setSourceTestResult(await window.electron.sourceSearch.test())
    } catch (error) {
      setSourceTestResult({
        success: false,
        providerName: null,
        latency: 0,
        info: error instanceof Error ? error.message : getErrorMessage(error, 'model.testFailed'),
      })
    } finally {
      setSourceTesting(false)
    }
  }

  const currentProviderModels = PROVIDER_OPTIONS.find((provider) => provider.value === selectedProvider)?.models || []
  const fixedTemperatureKimiModel = selectedProvider === 'kimi' && (selectedModelId === 'kimi-k2.6' || selectedModelId === 'kimi-k2.5')
  const selectedDefaultContextWindow = getProviderDefaultContextWindow(selectedProvider, selectedModelId)
  const currentSourceMode = (selectedSourceProvider || sourceSettings?.provider || 'auto') as SourceSearchProviderMode
  const sourceGuide = SOURCE_PROVIDER_GUIDE[currentSourceMode] || SOURCE_PROVIDER_GUIDE.auto
  const defaultCount = configs.filter((config) => config.isDefault === 1).length
  const providerCount = new Set(configs.map((config) => config.provider)).size
  const activeSourceLabel = sourceSettings?.activeProvider
    ? getSourceProviderLabel(sourceSettings.activeProvider)
    : getSourceProviderLabel(sourceSettings?.provider)

  const refreshAll = () => {
    void loadConfigs()
    void loadSourceSettings()
  }

  return (
    <>
      <WorkspacePage
        className="admin-page model-manager-page"
        layout="wide"
        heroVariant="compact"
        eyebrow="模型 / 检索"
        title="模型与搜索管理"
        description="管理 AI 模型接入、联网检索和连接测试。"
        actions={(
          <div className="admin-toolbar">
            <div className="novel-pill">{`已配置 ${configs.length} 套模型，默认 ${defaultCount} 套`}</div>
            <div className="admin-toolbar__actions">
              <Button icon={<SearchOutlined />} onClick={openSourceEditor}>
                搜索 API
              </Button>
              <Button icon={<ReloadOutlined />} onClick={refreshAll} loading={loading}>
                刷新
              </Button>
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
            <WorkspaceMetric label="来源检索" value={activeSourceLabel} />
          </>
        )}
      >
        <div className="model-manager-layout">
          <WorkspacePanel
            scrollable
            className="model-manager-list-panel"
            title="模型配置"
            description="已保存的模型配置列表。"
            extra={<Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNew}>新建</Button>}
          >
            {loading ? (
              <Skeleton active paragraph={{ rows: 8 }} />
            ) : configs.length === 0 ? (
              <div className="admin-empty-panel">
                <Empty description="暂无配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              <div className="admin-sidebar-list model-manager-config-list">
                {configs.map((config) => (
                  <div
                    key={config.id}
                    role="button"
                    tabIndex={0}
                    className={`admin-sidebar-item model-manager-config-card ${selected?.id === config.id ? 'admin-sidebar-item--active' : ''}`}
                    onClick={() => selectConfig(config)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectConfig(config)
                      }
                    }}
                  >
                    <div className="model-manager-config-card__main">
                      <div className="model-manager-config-card__title">
                        <span>{config.name}</span>
                        {config.isDefault === 1 ? <StarFilled /> : null}
                      </div>
                      <div className="admin-sidebar-item__meta">
                        {PROVIDER_OPTIONS.find((item) => item.value === config.provider)?.label || config.provider}
                        {' · '}
                        {config.modelId}
                      </div>
                      <div className="admin-sidebar-item__meta">
                        {`输出 ${formatTokenBudget(config.maxTokens)} · 上下文 ${formatTokenBudget(config.maxContextTokens || getProviderDefaultContextWindow(config.provider, config.modelId))} · 并发 ${config.maxConcurrency || 1}`}
                      </div>
                    </div>
                    <div
                      className="model-manager-config-card__actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button size="small" icon={<EditOutlined />} onClick={() => openModelEditor(config)}>
                        编辑
                      </Button>
                      <Button
                        size="small"
                        icon={config.isDefault ? <StarFilled /> : <StarOutlined />}
                        onClick={() => void handleSetDefault(config)}
                      >
                        {config.isDefault ? '默认' : '设默认'}
                      </Button>
                      <Button size="small" icon={<DeleteOutlined />} danger onClick={() => void handleDelete(config)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </WorkspacePanel>

          <WorkspacePanel
            className="model-manager-overview-panel"
            title="当前状态"
            description="查看模型参数与连接测试。"
            extra={<Button icon={<SearchOutlined />} onClick={openSourceEditor}>配置搜索 API</Button>}
          >
            {selected ? (
              <div className="admin-detail-stack">
                <div className="source-search-config__status-grid model-manager-status-grid">
                  <div className="source-search-config__status">
                    <span>当前模型</span>
                    <strong>{selected.name}</strong>
                  </div>
                  <div className="source-search-config__status">
                    <span>提供商</span>
                    <strong>{PROVIDER_OPTIONS.find((item) => item.value === selected.provider)?.label || selected.provider}</strong>
                  </div>
                  <div className="source-search-config__status">
                    <span>模型 ID</span>
                    <strong>{selected.modelId}</strong>
                  </div>
                  <div className="source-search-config__status">
                    <span>API Key</span>
                    <strong>{selected.apiKey ? '已保存' : '未配置'}</strong>
                  </div>
                  <div className="source-search-config__status">
                    <span>输出长度</span>
                    <strong>{formatTokenBudget(selected.maxTokens)}</strong>
                  </div>
                  <div className="source-search-config__status">
                    <span>上下文</span>
                    <strong>{formatTokenBudget(selected.maxContextTokens || getProviderDefaultContextWindow(selected.provider, selected.modelId))}</strong>
                  </div>
                </div>
                <div className="model-manager-status-actions">
                  <Button type="primary" icon={<EditOutlined />} onClick={() => openModelEditor(selected)}>
                    编辑模型
                  </Button>
                  <Button
                    icon={selected.isDefault ? <StarFilled /> : <StarOutlined />}
                    onClick={() => void handleSetDefault(selected)}
                  >
                    {selected.isDefault ? '已设为默认' : '设为默认'}
                  </Button>
                  <Button loading={testing} onClick={() => void handleTest()}>
                    测试连接
                  </Button>
                  {testResult ? (
                    <span className={`source-search-config__test-result${testResult.success ? ' is-success' : ' is-error'}`}>
                      {testResult.success ? `连接成功 · ${testResult.latency}ms` : testResult.info}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="admin-empty-panel">
                <Empty description="选择模型后查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            )}
          </WorkspacePanel>
        </div>

        <WorkspacePanel
          className="model-manager-source-panel"
          title="来源检索与 API Key"
          description="联网检索来源配置。"
          extra={<Button icon={<EditOutlined />} onClick={openSourceEditor}>编辑</Button>}
        >
          <div className="admin-detail-stack source-search-config">
            <div className="source-search-config__summary">
              <div className="source-search-config__summary-copy">
                <span className="source-search-config__eyebrow">来源检索</span>
                <strong>{sourceGuide.title}</strong>
                <p>{sourceGuide.detail}</p>
              </div>
              <div className="source-search-config__status-grid">
                <div className="source-search-config__status">
                  <span>当前模式</span>
                  <strong>{getSourceProviderLabel(sourceSettings?.provider)}</strong>
                </div>
                <div className="source-search-config__status">
                  <span>实际使用来源</span>
                  <strong>{activeSourceLabel}</strong>
                </div>
                <div className="source-search-config__status">
                  <span>Tavily Key</span>
                  <strong>{getSourceKeyStatus(sourceSettings?.tavilyApiKeySet, sourceSettings?.tavilyEnvSet)}</strong>
                </div>
                <div className="source-search-config__status">
                  <span>Brave Key</span>
                  <strong>{getSourceKeyStatus(sourceSettings?.braveApiKeySet, sourceSettings?.braveEnvSet)}</strong>
                </div>
              </div>
            </div>
            <div className="source-search-config__actions">
              <Button type="primary" icon={<EditOutlined />} onClick={openSourceEditor}>
                编辑来源检索
              </Button>
              <Button loading={sourceTesting} onClick={() => void handleSourceTest()}>
                测试连接
              </Button>
              <span className="source-search-config__test-result">
                {`最近保存：${formatSavedAt(sourceSettings?.updatedAt)}`}
              </span>
              {sourceTestResult ? (
                <span className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
                  {sourceTestResult.success
                    ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms · ${sourceTestResult.info}`
                    : sourceTestResult.info}
                </span>
              ) : null}
            </div>
          </div>
        </WorkspacePanel>
      </WorkspacePage>

      <Modal
        title={isNew ? '新建模型配置' : `编辑模型配置${selected ? `：${selected.name}` : ''}`}
        open={editorOpen}
        width={760}
        maskClosable={!saving}
        onCancel={() => setEditorOpen(false)}
        destroyOnHidden={false}
        footer={(
          <Space wrap>
            {!isNew && selected ? (
              <>
                <Button
                  icon={selected.isDefault ? <StarFilled /> : <StarOutlined />}
                  onClick={() => void handleSetDefault(selected)}
                >
                  {selected.isDefault ? '已设为默认' : '设为默认'}
                </Button>
                <Button icon={<DeleteOutlined />} danger onClick={() => void handleDelete(selected)}>
                  删除
                </Button>
              </>
            ) : null}
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button loading={saving} type="primary" onClick={() => void handleSave()}>
              保存
            </Button>
          </Space>
        )}
      >
        <Form form={form} layout="vertical" className="model-manager-modal-form">
          <div className="admin-form-grid admin-form-grid--three">
            <Form.Item name="name" label="配置名称" rules={[{ required: true }]}>
              <Input placeholder="例如：GPT-4o 主力模型" />
            </Form.Item>

            <Form.Item name="provider" label="AI 提供商" rules={[{ required: true }]}>
              <Select
                options={PROVIDER_OPTIONS.map((provider) => ({ value: provider.value, label: provider.label }))}
                onChange={(value) => {
                  setTestResult(null)
                  applyProviderDefaults(value, true)
                }}
              />
            </Form.Item>

            <Form.Item name="modelId" label="模型 ID" rules={[{ required: true }]}>
              {currentProviderModels.length > 0 ? (
                <Select
                  options={currentProviderModels.map((model) => ({ value: model, label: model }))}
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
                <Input
                  placeholder={selectedProvider === 'deepseek'
                    ? '输入模型名称，例如：deepseek-v4-flash'
                    : selectedProvider === 'kimi'
                      ? '输入模型 ID，例如：kimi-k2.6'
                      : selectedProvider === 'codex'
                        ? '输入 Codex 模型 ID，例如：gpt-5'
                        : selectedProvider === 'claude_code'
                          ? '输入 Claude 模型 ID，例如：sonnet / opus'
                      : '输入模型名称，例如：llama3:latest'}
                />
              )}
            </Form.Item>
          </div>

          {!isNativeAgentProvider(selectedProvider) ? (
            <Form.Item
              name="apiKey"
              label={selectedProvider === 'baidu' ? 'API Key（格式：APIKey|SecretKey）' : 'API Key'}
              rules={[{
                validator: async (_, value) => {
                  if (!providerRequiresApiKey(selectedProvider)) return
                  const textValue = typeof value === 'string' ? value.trim() : ''
                  if (textValue && textValue !== MASKED_KEY) return
                  if (!isNew && selected?.apiKey && selectedProvider === selectedConfigProvider && textValue === MASKED_KEY) return
                  throw new Error(getUserFacingMessage('model.apiKeyRequired'))
                },
              }]}
            >
              <Input.Password placeholder={selectedProvider === 'baidu' ? 'APIKey|SecretKey' : '输入 API Key'} />
            </Form.Item>
          ) : (
            <div className="model-manager-agent-note">
              使用本机已登录的 {selectedProvider === 'codex' ? 'Codex' : 'Claude'} 原生模型，不读取或保存 API Key。
              NovelForge 会禁用工具与持久会话，结果仍只进入草稿、质量门、独立审校和人工 Diff 链。
            </div>
          )}

          {(selectedProvider === 'openai' || selectedProvider === 'custom' || selectedProvider === 'deepseek' || selectedProvider === 'kimi') && (
            <Form.Item name="baseUrl" label="接口地址（Base URL）">
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
              label="Kimi 思考模式"
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

          <div className="admin-form-grid admin-form-grid--three">
            <Form.Item
              name="temperature"
              label="创造性（Temperature）"
              extra={fixedTemperatureKimiModel ? 'Kimi K2.x 使用固定采样参数，运行时会忽略此项。' : undefined}
            >
              <Slider disabled={fixedTemperatureKimiModel} min={0} max={1} step={0.05} marks={{ 0: '0', 0.5: '0.5', 1: '1' }} />
            </Form.Item>

            <Form.Item
              name="maxTokens"
              label="最大输出长度（Max Tokens）"
              extra={selectedProvider === 'deepseek'
                ? 'DeepSeek V4 当前最大输出长度为 384K。这里控制单次回复最多可生成多少 Token。'
                : '控制单次回复最多可生成多少 Token。实际可用上限仍取决于模型提供方。'}
            >
              <InputNumber min={512} max={MAX_MODEL_MAX_TOKENS} step={512} placeholder="例如：65536 / 128000 / 1000000" />
            </Form.Item>

            <Form.Item
              name="maxContextTokens"
              label="上下文窗口（可留空）"
              extra={selectedProvider === 'deepseek'
                ? 'DeepSeek V4 当前上下文窗口为 1M。通常应大于等于最大输出长度。'
                : selectedProvider === 'kimi'
                  ? 'Kimi K2.x 按 256K 预估；Moonshot v1 按模型名使用 8K/32K/128K。'
                  : `留空时使用该提供商的默认上下文长度：${formatTokenBudget(selectedDefaultContextWindow)}。`}
            >
              <InputNumber
                min={2048}
                max={2000000}
                step={1024}
                placeholder={`留空使用默认：${selectedDefaultContextWindow}`}
              />
            </Form.Item>
          </div>

          <Form.Item name="maxConcurrency" label="最大并发请求数">
            <InputNumber min={1} max={8} step={1} />
          </Form.Item>

          {!isNew && selected ? (
            <div className="model-manager-test-row">
              <Button loading={testing} onClick={() => void handleTest()}>
                测试连接
              </Button>
              {testResult ? (
                <span className={`source-search-config__test-result${testResult.success ? ' is-success' : ' is-error'}`}>
                  {testResult.success ? (
                    <>
                      <CheckCircleOutlined />
                      {` 连接成功 · ${testResult.latency}ms`}
                    </>
                  ) : (
                    <>
                      <CloseCircleOutlined />
                      {` ${testResult.info}`}
                    </>
                  )}
                </span>
              ) : null}
            </div>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="来源检索配置"
        open={sourceEditorOpen}
        width={720}
        maskClosable={!sourceSaving}
        onCancel={() => setSourceEditorOpen(false)}
        destroyOnHidden={false}
        footer={(
          <Space wrap>
            <Button onClick={() => setSourceEditorOpen(false)}>取消</Button>
            <Button loading={sourceTesting} onClick={() => void handleSourceTest()}>
              测试连接
            </Button>
            <Button type="primary" loading={sourceSaving} onClick={() => void handleSourceSave()}>
              保存
            </Button>
          </Space>
        )}
      >
        <div className="admin-detail-stack source-search-config">
          <div className="source-search-config__summary">
            <div className="source-search-config__summary-copy">
              <span className="source-search-config__eyebrow">来源检索</span>
              <strong>{sourceGuide.title}</strong>
              <p>{sourceGuide.detail}</p>
            </div>
            <div className="source-search-config__status-grid">
              <div className="source-search-config__status">
                <span>Tavily Key</span>
                <strong>{getSourceKeyStatus(sourceSettings?.tavilyApiKeySet, sourceSettings?.tavilyEnvSet)}</strong>
              </div>
              <div className="source-search-config__status">
                <span>Brave Key</span>
                <strong>{getSourceKeyStatus(sourceSettings?.braveApiKeySet, sourceSettings?.braveEnvSet)}</strong>
              </div>
            </div>
          </div>

          <Form form={sourceForm} layout="vertical" className="admin-source-form">
            <div className="admin-form-grid admin-form-grid--source">
              <Form.Item name="provider" label="检索来源" initialValue="auto">
                <Select options={SOURCE_PROVIDER_OPTIONS} />
              </Form.Item>
              <Form.Item
                name="tavilyApiKey"
                label="Tavily API Key"
                extra={sourceSettings?.tavilyEnvSet ? '已检测到备用配置。' : undefined}
              >
                <Input.Password
                  disabled={currentSourceMode === 'disabled'}
                  placeholder={sourceSettings?.tavilyApiKeySet ? MASKED_KEY : '输入 Tavily API Key'}
                />
              </Form.Item>
              <Form.Item
                name="braveApiKey"
                label="Brave Search API Key"
                extra={sourceSettings?.braveEnvSet ? '已检测到备用配置。' : undefined}
              >
                <Input.Password
                  disabled={currentSourceMode === 'disabled'}
                  placeholder={sourceSettings?.braveApiKeySet ? MASKED_KEY : '输入 Brave Search API Key'}
                />
              </Form.Item>
            </div>
          </Form>

          {sourceTestResult ? (
            <span className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
              {sourceTestResult.success
                ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms · ${sourceTestResult.info}`
                : sourceTestResult.info}
            </span>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
