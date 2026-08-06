import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Alert, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './components/Layout'
import { useThemeStore } from './stores/theme.store'
import { initTaskEventBridge } from './services/task-events'
import { getAntdThemeConfig } from './theme/antd-tokens'

const NovelList = React.lazy(() => import('./pages/NovelList'))
const ModelManager = React.lazy(() => import('./pages/ModelManager'))
const TemplateManager = React.lazy(() => import('./pages/TemplateManager'))
const TaskCenter = React.lazy(() => import('./pages/TaskCenter'))
const PromptManager = React.lazy(() => import('./pages/PromptManager'))
const NovelRouter = React.lazy(() => import('./pages/Novel'))

type LocalBackendStatus = {
  isWebPreview: boolean
  status: 'checking' | 'connected' | 'unavailable'
  connected: boolean
  lastError: string
  message: string
  capabilities?: {
    realDatabase: boolean
    writesEnabled: boolean
    generationEnabled: boolean
    eventStreaming: boolean
  }
  demoFallbackEnabled?: boolean
}

export default function App() {
  const { theme } = useThemeStore()
  const [localBackendStatus, setLocalBackendStatus] = useState<LocalBackendStatus | null>(null)
  const hasElectronBridge = typeof window !== 'undefined'
    && typeof window.electron?.on === 'function'
    && typeof window.electron?.novel?.list === 'function'

  useEffect(() => {
    if (!hasElectronBridge) {
      console.error('Runtime bridge is unavailable. Refresh the page or start the desktop app through Electron.')
      return undefined
    }
    return initTaskEventBridge()
  }, [hasElectronBridge])

  useEffect(() => {
    if (!hasElectronBridge || typeof window.electron.app?.getLocalBackendStatus !== 'function') return undefined

    let disposed = false
    let requestInFlight = false
    const refreshStatus = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const status = await window.electron.app.getLocalBackendStatus?.()
        if (!disposed && status) setLocalBackendStatus(status)
      } catch {
        if (!disposed) setLocalBackendStatus(null)
      } finally {
        requestInFlight = false
      }
    }

    void refreshStatus()
    const timer = window.setInterval(() => {
      void refreshStatus()
    }, 2500)

    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [hasElectronBridge])

  const antdThemeConfig = useMemo(() => getAntdThemeConfig(theme), [theme])

  return (
    <ConfigProvider theme={antdThemeConfig} locale={zhCN}>
      {!hasElectronBridge ? (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <Alert
            type="error"
            showIcon
            message="运行桥接未加载"
            description="当前页面缺少运行桥接。请刷新浏览器页面，或通过 Electron 启动桌面应用。"
            style={{ maxWidth: 720 }}
          />
        </div>
      ) : (
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppLayout>
          {localBackendStatus?.isWebPreview && localBackendStatus.status === 'unavailable' ? (
            <Alert
              type="warning"
              showIcon
              banner
              message={localBackendStatus.demoFallbackEnabled ? '网页端正在使用显式演示数据' : '网页端未连接真实本地后端'}
              description={localBackendStatus.demoFallbackEnabled
                ? '当前为演示模式，不会读取或写入正式数据库；移除地址中的 ?demo=1 后再进行真实操作。'
                : (localBackendStatus.message || '真实数据库与生成功能已暂停，请运行 npm run dev:web 后刷新页面。')}
            />
          ) : null}
          <Suspense fallback={<div style={{ padding: 24, color: 'var(--text-muted)' }}>页面加载中...</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/novels" replace />} />
              <Route path="/novels" element={<NovelList />} />
              <Route path="/novels/:id/*" element={<NovelRouter />} />
              <Route path="/models" element={<ModelManager />} />
              <Route path="/templates" element={<TemplateManager />} />
              <Route path="/tasks" element={<TaskCenter />} />
              <Route path="/prompts" element={<PromptManager />} />
              <Route path="*" element={<Navigate to="/novels" replace />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </HashRouter>
      )}
    </ConfigProvider>
  )
}
