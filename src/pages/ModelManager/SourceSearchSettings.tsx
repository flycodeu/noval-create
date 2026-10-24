import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, message } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type { SourceSearchProviderMode, SourceSearchSettingsUpdate, SourceSearchSettingsView, SourceSearchTestResult } from '../../types'
import {
  SOURCE_SEARCH_PLATFORM_DEFAULTS, SOURCE_SEARCH_PLATFORM_NAMES, SOURCE_SEARCH_PROTOCOL_LABELS, SOURCE_SEARCH_PROVIDER_LABELS,
  type SourceSearchPlatformName, type SourceSearchProtocol, type SourceSearchProviderName,
} from '../../shared/source-search'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspacePanel } from '../Novel/components/WorkspaceShell'

const MASKED_KEY = '已设置'
const PROVIDERS: SourceSearchProviderName[] = ['tavily', 'brave', 'deepseek', 'openai', 'custom']
const SOURCE_PROVIDER_OPTIONS = (['auto', ...PROVIDERS, 'disabled'] as SourceSearchProviderMode[])
  .map(value => ({ value, label: SOURCE_SEARCH_PROVIDER_LABELS[value] }))
const PLATFORM_OPTIONS = PROVIDERS.map(value => ({ value, label: SOURCE_SEARCH_PROVIDER_LABELS[value] }))
const PROTOCOLS: SourceSearchProtocol[] = ['responses', 'chat-completions', 'deepseek', 'tavily', 'brave']
const MODEL_PROTOCOLS: SourceSearchProtocol[] = ['responses', 'chat-completions']
const DEFAULT_SEARCH_MODELS = ['gpt-5.5', 'gpt-5-search-api']

function getSourceProviderLabel(provider?: string | null) {
  return provider && Object.hasOwn(SOURCE_SEARCH_PROVIDER_LABELS, provider)
    ? SOURCE_SEARCH_PROVIDER_LABELS[provider as SourceSearchProviderMode] : '未配置'
}

function getSourceKeyStatus(saved?: boolean, env?: boolean) {
  if (saved && env) return '已保存 · 环境变量可用'
  if (saved) return '已保存'
  if (env) return '环境变量可用'
  return undefined
}

function formValues(settings: SourceSearchSettingsView): SourceSearchSettingsUpdate {
  return {
    provider: settings.provider,
    tavilyApiKey: settings.tavilyApiKeySet ? MASKED_KEY : '',
    braveApiKey: settings.braveApiKeySet ? MASKED_KEY : '',
    platforms: Object.fromEntries(SOURCE_SEARCH_PLATFORM_NAMES.map(slot => [slot, {
      protocol: settings.platforms?.[slot]?.protocol || SOURCE_SEARCH_PLATFORM_DEFAULTS[slot].protocol,
      baseUrl: settings.platforms?.[slot]?.baseUrl ?? SOURCE_SEARCH_PLATFORM_DEFAULTS[slot].baseUrl,
      model: settings.platforms?.[slot]?.model ?? SOURCE_SEARCH_PLATFORM_DEFAULTS[slot].model,
      apiKey: settings.platforms?.[slot]?.apiKeySet ? MASKED_KEY : '',
    }])),
  }
}

function formatSavedAt(value?: string | null) {
  if (!value) return '未保存'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export interface SourceSearchSettingsHandle {
  open: () => void
  refresh: () => void
}

const SourceSearchSettings = forwardRef<SourceSearchSettingsHandle, { onAvailabilityChange: (ready: boolean) => void }>(function SourceSearchSettings({ onAvailabilityChange }, ref) {
  const [sourceForm] = Form.useForm<SourceSearchSettingsUpdate>()
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false)
  const [sourceSettings, setSourceSettings] = useState<SourceSearchSettingsView | null>(null)
  const [sourceLoading, setSourceLoading] = useState(true)
  const [sourceLoadError, setSourceLoadError] = useState('')
  const [sourceSaving, setSourceSaving] = useState(false)
  const [sourceTesting, setSourceTesting] = useState(false)
  const [sourceTestResult, setSourceTestResult] = useState<SourceSearchTestResult | null>(null)
  const [editingPlatform, setEditingPlatform] = useState<SourceSearchProviderName>('tavily')
  const [keyResetRequired, setKeyResetRequired] = useState<Partial<Record<SourceSearchPlatformName, boolean>>>({})
  const selectedSourceProvider = Form.useWatch('provider', sourceForm)
  const platformValues = Form.useWatch('platforms', { form: sourceForm, preserve: true }) as SourceSearchSettingsUpdate['platforms']
  const sourceSettingsRequestRef = useRef(0)
  const sourceTestRequestRef = useRef(0)
  const testInFlightRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)

  const invalidateTest = () => {
    ++sourceTestRequestRef.current
    setSourceTestResult(null)
  }

  const hydrateSourceForm = (settings: SourceSearchSettingsView) => {
    sourceForm.resetFields()
    sourceForm.setFieldsValue(formValues(settings))
    setKeyResetRequired({})
    setEditingPlatform(settings.activeProvider || (PROVIDERS.includes(settings.provider as SourceSearchProviderName) ? settings.provider as SourceSearchProviderName : 'tavily'))
  }

  const loadSourceSettings = useCallback(async () => {
    const requestId = ++sourceSettingsRequestRef.current
    setSourceLoading(true)
    setSourceLoadError('')
    try {
      const settings = await window.electron.sourceSearch.getSettings()
      if (requestId !== sourceSettingsRequestRef.current) return
      setSourceSettings(settings)
    } catch (error) {
      if (requestId === sourceSettingsRequestRef.current) setSourceLoadError(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (requestId === sourceSettingsRequestRef.current) setSourceLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSourceSettings()
    return () => {
      sourceSettingsRequestRef.current += 1
      sourceTestRequestRef.current += 1
    }
  }, [loadSourceSettings])
  useEffect(() => {
    onAvailabilityChange(Boolean(sourceSettings) && !sourceLoading && !sourceLoadError)
  }, [sourceSettings, sourceLoading, sourceLoadError, onAvailabilityChange])

  const openSourceEditor = () => {
    if (!sourceSettings || sourceLoading || sourceLoadError || saveInFlightRef.current) return
    invalidateTest()
    hydrateSourceForm(sourceSettings)
    setSourceEditorOpen(true)
  }

  const closeSourceEditor = () => {
    if (saveInFlightRef.current) return
    invalidateTest()
    setSourceEditorOpen(false)
    sourceForm.resetFields()
    setKeyResetRequired({})
  }

  const readDraft = async () => {
    const unresolvedSlot = SOURCE_SEARCH_PLATFORM_NAMES.find(slot => keyResetRequired[slot])
    if (unresolvedSlot) {
      message.error(getUserFacingMessage('model.sourceSearchIdentityChanged', { platform: SOURCE_SEARCH_PROVIDER_LABELS[unresolvedSlot] }))
      return null
    }
    const valid = await sourceForm.validateFields().then(() => true).catch(() => false)
    // Keep all platform slots, including fields currently hidden by the selector.
    return valid ? sourceForm.getFieldsValue(true) as SourceSearchSettingsUpdate : null
  }

  const handleSourceSave = async () => {
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true
    invalidateTest()
    setSourceSaving(true)
    try {
      const values = await readDraft()
      if (!values) return
      const settings = await window.electron.sourceSearch.updateSettings(values)
      setSourceSettings(settings)
      hydrateSourceForm(settings)
      setSourceEditorOpen(false)
      message.success(getUserFacingMessage('model.sourceSearchSaved'))
    } catch (error) {
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      saveInFlightRef.current = false
      setSourceSaving(false)
    }
  }

  const currentSourceMode = (selectedSourceProvider || sourceSettings?.provider || 'auto') as SourceSearchProviderMode
  const currentPlatform = currentSourceMode === 'auto' ? editingPlatform
    : currentSourceMode === 'disabled' ? null : currentSourceMode
  const platformSlot = currentPlatform && SOURCE_SEARCH_PLATFORM_NAMES.includes(currentPlatform as SourceSearchPlatformName)
    ? currentPlatform as SourceSearchPlatformName : null
  const protocol = platformSlot ? platformValues?.[platformSlot]?.protocol || SOURCE_SEARCH_PLATFORM_DEFAULTS[platformSlot].protocol : null
  const currentSavedPlatform = platformSlot ? sourceSettings?.platforms?.[platformSlot] : null
  const currentEnvAvailable = Boolean(platformSlot && currentSavedPlatform?.envSet
    && platformValues?.[platformSlot]?.baseUrl?.trim().replace(/\/+$/u, '') === SOURCE_SEARCH_PLATFORM_DEFAULTS[platformSlot].baseUrl)
  const modelProtocol = Boolean(protocol && MODEL_PROTOCOLS.includes(protocol))

  const handleSourceTest = async (useSaved = false) => {
    if (saveInFlightRef.current || testInFlightRef.current !== null) return
    const requestId = ++sourceTestRequestRef.current
    testInFlightRef.current = requestId
    setSourceTesting(true)
    setSourceTestResult(null)
    try {
      const values = useSaved ? undefined : await readDraft()
      if (values === null || requestId !== sourceTestRequestRef.current) return
      // In auto mode test the slot being edited, not an unrelated saved provider.
      const input = values && currentSourceMode === 'auto' ? { ...values, provider: editingPlatform } : values
      const result = await window.electron.sourceSearch.test(input)
      if (requestId === sourceTestRequestRef.current) setSourceTestResult(result)
    } catch (error) {
      if (requestId === sourceTestRequestRef.current) setSourceTestResult({
        success: false, providerName: null, latency: 0, info: getErrorMessage(error, 'model.testFailed'),
      })
    } finally {
      if (testInFlightRef.current === requestId) {
        testInFlightRef.current = null
        setSourceTesting(false)
      }
    }
  }

  const handleDraftChange = (changed: SourceSearchSettingsUpdate) => {
    invalidateTest()
    for (const slot of SOURCE_SEARCH_PLATFORM_NAMES) {
      const patch = changed.platforms?.[slot]
      if (!patch) continue
      const draft = sourceForm.getFieldValue(['platforms', slot]) as NonNullable<SourceSearchSettingsUpdate['platforms']>[SourceSearchPlatformName]
      if ((patch.baseUrl !== undefined || patch.protocol !== undefined) && draft?.apiKey === MASKED_KEY) {
        sourceForm.setFieldValue(['platforms', slot, 'apiKey'], '')
        setKeyResetRequired(previous => ({ ...previous, [slot]: true }))
      }
      if (patch.apiKey?.trim() && patch.apiKey !== MASKED_KEY) {
        setKeyResetRequired(previous => ({ ...previous, [slot]: false }))
      }
      if (patch.protocol && MODEL_PROTOCOLS.includes(patch.protocol) && (!draft?.model || DEFAULT_SEARCH_MODELS.includes(draft.model))) {
        sourceForm.setFieldValue(['platforms', slot, 'model'], patch.protocol === 'chat-completions' ? 'gpt-5-search-api' : 'gpt-5.5')
      }
    }
  }

  useImperativeHandle(ref, () => ({ open: openSourceEditor, refresh: () => { void loadSourceSettings() } }))

  const configuredProviders = PROVIDERS.filter(provider => provider === 'tavily'
    ? sourceSettings?.tavilyApiKeySet || sourceSettings?.tavilyEnvSet
    : provider === 'brave' ? sourceSettings?.braveApiKeySet || sourceSettings?.braveEnvSet
      : sourceSettings?.platforms?.[provider]?.apiKeySet || sourceSettings?.platforms?.[provider]?.envSet)
  const activeSourceLabel = sourceSettings?.activeProvider
    ? getSourceProviderLabel(sourceSettings.activeProvider)
    : sourceSettings?.provider === 'disabled' ? '已关闭' : '未配置 API Key'

  return <>
    <WorkspacePanel
      title="联网搜索" className="model-manager-source-panel"
      extra={<Button type="primary" icon={<EditOutlined />} disabled={sourceLoading || !sourceSettings || Boolean(sourceLoadError)} onClick={openSourceEditor}>配置搜索</Button>}
    >
      {sourceLoadError ? <Alert type="error" showIcon message="无法读取搜索配置" description={sourceLoadError} action={<Button onClick={() => void loadSourceSettings()}>重试</Button>} /> : (
        <div className="admin-detail-stack source-search-config">
          <div className="source-search-config__status-grid">
            <div className="source-search-config__status"><span>当前服务</span><strong>{sourceLoading ? '加载中' : activeSourceLabel}</strong></div>
            {configuredProviders.length > 1 && <div className="source-search-config__status"><span>已配置平台</span><strong>{sourceLoading ? '加载中' : configuredProviders.map(getSourceProviderLabel).join('、') || '未配置'}</strong></div>}
            {sourceSettings?.provider !== sourceSettings?.activeProvider && <div className="source-search-config__status"><span>选择方式</span><strong>{sourceLoading ? '加载中' : getSourceProviderLabel(sourceSettings?.provider)}</strong></div>}
          </div>
          <div className="source-search-config__actions">
            <Button loading={!sourceEditorOpen && sourceTesting} disabled={sourceLoading || !sourceSettings?.activeProvider || sourceEditorOpen} onClick={() => void handleSourceTest(true)}>测试已保存配置</Button>
            <span className="source-search-config__test-result">{`最近保存：${formatSavedAt(sourceSettings?.updatedAt)}`}</span>
            {!sourceEditorOpen && sourceTestResult ? <span role="status" className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
              {sourceTestResult.success ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms` : sourceTestResult.info}
            </span> : null}
          </div>
        </div>
      )}
    </WorkspacePanel>

    <Modal
      title="联网搜索配置" className="model-manager-source-modal" open={sourceEditorOpen} forceRender width={680}
      maskClosable={!sourceSaving} closable={!sourceSaving} keyboard={!sourceSaving} onCancel={closeSourceEditor} destroyOnHidden={false}
      footer={<Space wrap>
        <Button disabled={sourceSaving} onClick={closeSourceEditor}>取消</Button>
        <Button loading={sourceTesting} disabled={sourceSaving} onClick={() => void handleSourceTest()}>测试连接</Button>
        <Button type="primary" loading={sourceSaving} onClick={() => void handleSourceSave()}>保存</Button>
      </Space>}
    >
      <div className="admin-detail-stack source-search-config">
        <Form form={sourceForm} name="sourceSearch" layout="vertical" disabled={sourceSaving} className="model-manager-source-form" onValuesChange={handleDraftChange}>
          <Form.Item name="provider" label="搜索服务"><Select options={SOURCE_PROVIDER_OPTIONS} /></Form.Item>
          {currentSourceMode === 'auto' ? <Form.Item label="配置平台">
            <Select id="sourceSearch_editingPlatform" value={editingPlatform} options={PLATFORM_OPTIONS} onChange={value => { invalidateTest(); setEditingPlatform(value) }} />
          </Form.Item> : null}
          {currentPlatform === 'tavily' || currentPlatform === 'brave' ? <Form.Item
            name={currentPlatform === 'tavily' ? 'tavilyApiKey' : 'braveApiKey'} label={`${getSourceProviderLabel(currentPlatform)} API Key`}
            extra={currentPlatform === 'tavily' ? getSourceKeyStatus(sourceSettings?.tavilyApiKeySet, sourceSettings?.tavilyEnvSet) : getSourceKeyStatus(sourceSettings?.braveApiKeySet, sourceSettings?.braveEnvSet)}
          ><Input.Password allowClear placeholder={`输入 ${getSourceProviderLabel(currentPlatform)} API Key`} /></Form.Item> : null}
          {platformSlot ? <div className="model-manager-source-platform" key={platformSlot}>
            {platformSlot !== 'deepseek' ? <Form.Item name={['platforms', platformSlot, 'protocol']} label="接口协议">
              <Select options={PROTOCOLS.filter(item => platformSlot === 'custom' || MODEL_PROTOCOLS.includes(item)).map(value => ({ value, label: SOURCE_SEARCH_PROTOCOL_LABELS[value] }))} />
            </Form.Item> : null}
            <Form.Item name={['platforms', platformSlot, 'baseUrl']} label="Base URL" extra={protocol === 'deepseek' ? '单次查询最多 128 个字符；超限将提示错误。' : undefined} rules={[{
              validator: async (_, value: string | undefined) => {
                if (!value?.trim() && (sourceForm.getFieldValue(['platforms', platformSlot, 'apiKey']) || currentEnvAvailable)) throw new Error(getUserFacingMessage('model.sourceSearchBaseUrlRequired'))
              },
            }]}><Input placeholder={platformSlot === 'custom' ? 'https://search.example.com/v1' : SOURCE_SEARCH_PLATFORM_DEFAULTS[platformSlot].baseUrl} autoComplete="off" /></Form.Item>
            {modelProtocol ? <Form.Item name={['platforms', platformSlot, 'model']} label="搜索模型" extra="仅保存来源标题与链接，不将模型回答当作网页摘录。" rules={[{
              validator: async (_, value: string | undefined) => {
                if (!value?.trim() && (sourceForm.getFieldValue(['platforms', platformSlot, 'apiKey']) || currentEnvAvailable)) throw new Error(getUserFacingMessage('model.sourceSearchModelRequired'))
              },
            }]}><Input placeholder={protocol === 'chat-completions' ? 'gpt-5-search-api' : 'gpt-5.5'} autoComplete="off" /></Form.Item> : null}
            <Form.Item name={['platforms', platformSlot, 'apiKey']} label="API Key" extra={getSourceKeyStatus(currentSavedPlatform?.apiKeySet, currentEnvAvailable)}>
              <Input.Password allowClear autoComplete="new-password" placeholder="输入此搜索平台的 API Key" />
            </Form.Item>
            {keyResetRequired[platformSlot] ? <Alert className="model-manager-source-key-reset" type="warning" showIcon message="接口已改变，请重新填写 API Key。" action={<Button size="small" onClick={() => {
              invalidateTest()
              sourceForm.setFieldValue(['platforms', platformSlot, 'apiKey'], '')
              setKeyResetRequired(previous => ({ ...previous, [platformSlot]: false }))
            }}>清空此平台密钥</Button>} /> : null}
          </div> : null}
          {currentSourceMode === 'disabled' ? <p className="model-manager-source-note">来源检索已关闭，已保存的配置仍会保留。</p> : null}
        </Form>
        {currentSourceMode !== 'disabled' ? <p className="model-manager-source-note">搜索密钥单独配置。测试不会保存；清空并保存可删除本地密钥，环境变量不受影响。</p> : null}
        {sourceTestResult ? <span role="status" className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
          {sourceTestResult.success ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms · ${sourceTestResult.info}` : sourceTestResult.info}
        </span> : null}
      </div>
    </Modal>
  </>
})

export default SourceSearchSettings
