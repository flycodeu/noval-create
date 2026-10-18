import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, message } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import type { SourceSearchProviderMode, SourceSearchSettingsUpdate, SourceSearchSettingsView, SourceSearchTestResult } from '../../types'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspacePanel } from '../Novel/components/WorkspaceShell'

const MASKED_KEY = '已设置'
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
  const selectedSourceProvider = Form.useWatch('provider', sourceForm)
  const sourceSettingsRequestRef = useRef(0)
  const sourceTestRequestRef = useRef(0)
  const testInFlightRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)

  const loadSourceSettings = useCallback(async () => {
    const requestId = ++sourceSettingsRequestRef.current
    setSourceLoading(true)
    setSourceLoadError('')
    try {
      const settings = await window.electron.sourceSearch.getSettings()
      if (requestId !== sourceSettingsRequestRef.current) return
      setSourceSettings(settings)
      sourceForm.setFieldsValue({
        provider: settings.provider,
        tavilyApiKey: settings.tavilyApiKeySet ? MASKED_KEY : '',
        braveApiKey: settings.braveApiKeySet ? MASKED_KEY : '',
      })
    } catch (error) {
      if (requestId === sourceSettingsRequestRef.current) setSourceLoadError(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (requestId === sourceSettingsRequestRef.current) setSourceLoading(false)
    }
  }, [sourceForm])

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
    ++sourceTestRequestRef.current
    setSourceTesting(false)
    setSourceTestResult(null)
    if (sourceSettings) {
      sourceForm.setFieldsValue({
        provider: sourceSettings.provider,
        tavilyApiKey: sourceSettings.tavilyApiKeySet ? MASKED_KEY : '',
        braveApiKey: sourceSettings.braveApiKeySet ? MASKED_KEY : '',
      })
    }
    setSourceEditorOpen(true)
  }

  const closeSourceEditor = () => {
    if (saveInFlightRef.current) return
    ++sourceTestRequestRef.current
    setSourceTesting(false)
    setSourceTestResult(null)
    setSourceEditorOpen(false)
    sourceForm.resetFields()
  }

  const handleSourceSave = async () => {
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true
    ++sourceTestRequestRef.current
    setSourceTesting(false)
    setSourceSaving(true)
    try {
      const values = await sourceForm.validateFields().catch(() => null)
      if (!values) return
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
      saveInFlightRef.current = false
      setSourceSaving(false)
    }
  }

  const handleSourceTest = async (useSaved = false) => {
    if (saveInFlightRef.current || testInFlightRef.current === sourceTestRequestRef.current) return
    const requestId = ++sourceTestRequestRef.current
    testInFlightRef.current = requestId
    setSourceTesting(true)
    setSourceTestResult(null)
    try {
      const values = useSaved ? undefined : await sourceForm.validateFields().catch(() => null)
      if (values === null || requestId !== sourceTestRequestRef.current) return
      const result = await window.electron.sourceSearch.test(values)
      if (requestId === sourceTestRequestRef.current) setSourceTestResult(result)
    } catch (error) {
      if (requestId === sourceTestRequestRef.current) setSourceTestResult({
        success: false,
        providerName: null,
        latency: 0,
        info: error instanceof Error ? error.message : getErrorMessage(error, 'model.testFailed'),
      })
    } finally {
      if (testInFlightRef.current === requestId) testInFlightRef.current = null
      if (requestId === sourceTestRequestRef.current) setSourceTesting(false)
    }
  }

  useImperativeHandle(ref, () => ({ open: openSourceEditor, refresh: () => { void loadSourceSettings() } }))

  const currentSourceMode = (selectedSourceProvider || sourceSettings?.provider || 'auto') as SourceSearchProviderMode
  const sourceGuide = SOURCE_PROVIDER_GUIDE[currentSourceMode] || SOURCE_PROVIDER_GUIDE.auto
  const activeSourceLabel = sourceSettings?.activeProvider
    ? getSourceProviderLabel(sourceSettings.activeProvider)
    : sourceSettings?.provider === 'disabled' ? '已关闭' : '未配置 API Key'

  return <>
        <WorkspacePanel
          title="联网搜索"
          className="model-manager-source-panel"
          extra={(
            <Button type="primary" icon={<EditOutlined />} disabled={sourceLoading || !sourceSettings || Boolean(sourceLoadError)} onClick={openSourceEditor}>
              配置搜索
            </Button>
          )}
        >
          {sourceLoadError ? (
            <Alert
              type="error"
              showIcon
              message="无法读取搜索配置"
              description={sourceLoadError}
              action={<Button onClick={() => void loadSourceSettings()}>重试</Button>}
            />
          ) : (
            <div className="admin-detail-stack source-search-config">
              <p className="model-manager-source-description">用于创作资料的联网搜索，需单独配置 Tavily 或 Brave Search API Key。</p>
              <div className="source-search-config__status-grid">
                <div className="source-search-config__status">
                  <span>搜索状态</span>
                  <strong>{sourceLoading ? '加载中' : activeSourceLabel}</strong>
                </div>
                <div className="source-search-config__status">
                  <span>Tavily API Key</span>
                  <strong>{sourceLoading ? '加载中' : getSourceKeyStatus(sourceSettings?.tavilyApiKeySet, sourceSettings?.tavilyEnvSet)}</strong>
                </div>
                <div className="source-search-config__status">
                  <span>Brave Search API Key</span>
                  <strong>{sourceLoading ? '加载中' : getSourceKeyStatus(sourceSettings?.braveApiKeySet, sourceSettings?.braveEnvSet)}</strong>
                </div>
              </div>
              <div className="source-search-config__actions">
                <Button loading={!sourceEditorOpen && sourceTesting} disabled={sourceLoading || !sourceSettings?.activeProvider || sourceEditorOpen} onClick={() => void handleSourceTest(true)}>
                  测试已保存配置
                </Button>
                <span className="source-search-config__test-result">
                  {`最近保存：${formatSavedAt(sourceSettings?.updatedAt)}`}
                </span>
                {!sourceEditorOpen && sourceTestResult ? (
                  <span role="status" className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
                    {sourceTestResult.success
                      ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms`
                      : sourceTestResult.info}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </WorkspacePanel>

      <Modal
        title="联网搜索配置"
        className="model-manager-source-modal"
        open={sourceEditorOpen}
        forceRender
        width={720}
        maskClosable={!sourceSaving}
        closable={!sourceSaving}
        keyboard={!sourceSaving}
        onCancel={closeSourceEditor}
        destroyOnHidden={false}
        footer={(
          <Space wrap>
            <Button disabled={sourceSaving} onClick={closeSourceEditor}>取消</Button>
            <Button loading={sourceTesting} disabled={sourceSaving} onClick={() => void handleSourceTest()}>
              测试连接
            </Button>
            <Button type="primary" loading={sourceSaving} onClick={() => void handleSourceSave()}>
              保存
            </Button>
          </Space>
        )}
      >
        <div className="admin-detail-stack source-search-config">
          <div className="model-manager-source-intro">
            <strong>{sourceGuide.title}</strong>
            <p>{sourceGuide.detail}</p>
          </div>

          <Form
            form={sourceForm}
            name="sourceSearch"
            layout="vertical"
            disabled={sourceSaving}
            className="model-manager-source-form"
            onValuesChange={() => {
              ++sourceTestRequestRef.current
              setSourceTesting(false)
              setSourceTestResult(null)
            }}
          >
              <Form.Item name="provider" label="搜索服务" initialValue="auto">
                <Select options={SOURCE_PROVIDER_OPTIONS} />
              </Form.Item>
            <div className="model-manager-source-key-grid">
              <Form.Item
                name="tavilyApiKey"
                label="Tavily API Key"
                extra={getSourceKeyStatus(sourceSettings?.tavilyApiKeySet, sourceSettings?.tavilyEnvSet)}
              >
                <Input.Password
                  allowClear
                  disabled={sourceSaving || currentSourceMode === 'disabled'}
                  placeholder={sourceSettings?.tavilyApiKeySet ? MASKED_KEY : '输入 Tavily API Key'}
                />
              </Form.Item>
              <Form.Item
                name="braveApiKey"
                label="Brave Search API Key"
                extra={getSourceKeyStatus(sourceSettings?.braveApiKeySet, sourceSettings?.braveEnvSet)}
              >
                <Input.Password
                  allowClear
                  disabled={sourceSaving || currentSourceMode === 'disabled'}
                  placeholder={sourceSettings?.braveApiKeySet ? MASKED_KEY : '输入 Brave Search API Key'}
                />
              </Form.Item>
            </div>
          </Form>

          <p className="model-manager-source-note">测试连接不会保存配置。已保存的密钥以掩码显示，清空并保存可删除本地密钥；环境变量不受影响。</p>

          {sourceTestResult ? (
            <span role="status" className={`source-search-config__test-result${sourceTestResult.success ? ' is-success' : ' is-error'}`}>
              {sourceTestResult.success
                ? `${getSourceProviderLabel(sourceTestResult.providerName)} 连接成功 · ${sourceTestResult.latency}ms · ${sourceTestResult.info}`
                : sourceTestResult.info}
            </span>
          ) : null}
        </div>
      </Modal>

  </>
})

export default SourceSearchSettings
