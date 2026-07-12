import React, { Suspense, useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Alert, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './components/Layout'
import { useTaskStore } from './stores/task.store'
import { useThemeStore } from './stores/theme.store'
import { parseTaskChunkEvent, parseTaskStatusEvent } from './shared/task-stream-events'

const FONT = "-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"
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
}

export default function App() {
  const { addStream, appendStreamChunk, completeStream } = useTaskStore()
  const { theme } = useThemeStore()
  const [localBackendStatus, setLocalBackendStatus] = useState<LocalBackendStatus | null>(null)
  const isDarkTheme = theme === 'dark'
  const isSoftTheme = theme === 'soft'
  const hasElectronBridge = typeof window !== 'undefined'
    && typeof window.electron?.on === 'function'
    && typeof window.electron?.novel?.list === 'function'

  useEffect(() => {
    if (!hasElectronBridge) {
      console.error('Runtime bridge is unavailable. Refresh the page or start the desktop app through Electron.')
      return undefined
    }

    const unsubChunk = window.electron.on('task:stream-chunk', (data: unknown) => {
      const event = parseTaskChunkEvent(data)
      if (event) appendStreamChunk(event.taskId, event.chunk)
    })
    const unsubComplete = window.electron.on('task:complete', (data: unknown) => {
      const event = parseTaskStatusEvent(data)
      if (!event || !['success', 'failed', 'cancelled'].includes(event.status)) return
      completeStream(
        event.taskId,
        event.status === 'success'
          ? 'completed'
          : event.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      )
    })
    const unsubStatus = window.electron.on('task:status-change', (data: unknown) => {
      const event = parseTaskStatusEvent(data)
      if (event?.status === 'running') addStream(event.taskId)
    })
    return () => { unsubChunk(); unsubComplete(); unsubStatus() }
  }, [addStream, appendStreamChunk, completeStream, hasElectronBridge])

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

  const antdThemeConfig = useMemo(() => {
    if (isDarkTheme) {
      return {
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#d4944a',
          fontFamily: FONT,
          borderRadius: 12,
          controlHeight: 40,
          colorBgBase: '#0f1117',
          colorTextBase: '#e8eaed',
          colorBgContainer: '#1a1d27',
          colorBgLayout: '#0f1117',
          colorBgElevated: '#252840',
          colorBgSpotlight: '#252840',
          colorBorder: 'rgba(255,255,255,0.08)',
          colorBorderSecondary: 'rgba(255,255,255,0.06)',
        },
        components: {
          Layout: {
            bodyBg: '#0f1117',
            siderBg: '#1a1d27',
            headerBg: '#1a1d27',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            itemSelectedBg: 'rgba(166, 106, 43, 0.18)',
            itemSelectedColor: '#e8eaed',
          },
          Card: {
            colorBgContainer: '#1a1d27',
          },
          Modal: {
            contentBg: '#1a1d27',
            headerBg: '#1a1d27',
          },
          Input: {
            colorBgContainer: '#1e2235',
          },
          Select: {
            colorBgContainer: '#1e2235',
          },
          Table: {
            colorBgContainer: '#1a1d27',
            headerBg: '#252840',
          },
        },
      }
    }

    if (isSoftTheme) {
      return {
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#6b8f71',
          fontFamily: FONT,
          borderRadius: 12,
          controlHeight: 40,
          colorBgBase: '#f4f0eb',
          colorTextBase: '#2d2520',
          colorBgContainer: '#faf7f4',
          colorBgLayout: '#f4f0eb',
          colorBgElevated: '#ece8e1',
          colorBgSpotlight: '#ece8e1',
          colorBorder: '#d4c9be',
          colorBorderSecondary: '#e3d9cf',
          colorText: '#2d2520',
          colorTextSecondary: '#6b5e52',
          colorTextTertiary: '#9b8a7a',
          colorFillAlter: '#ece8e1',
          colorFillContent: '#e4ddd4',
        },
        components: {
          Layout: {
            bodyBg: '#f4f0eb',
            siderBg: '#faf7f4',
            headerBg: '#faf7f4',
          },
          Menu: {
            itemSelectedBg: 'rgba(107, 143, 113, 0.12)',
            itemSelectedColor: '#4a6b50',
            itemHoverColor: '#4a6b50',
          },
          Button: {
            primaryShadow: '0 10px 24px rgba(107, 143, 113, 0.16)',
          },
          Card: {
            colorBgContainer: '#faf7f4',
          },
          Modal: {
            contentBg: '#faf7f4',
            headerBg: '#faf7f4',
          },
          Input: {
            colorBgContainer: '#faf7f4',
          },
          Select: {
            colorBgContainer: '#faf7f4',
          },
          Table: {
            colorBgContainer: '#faf7f4',
            headerBg: '#ece8e1',
          },
        },
      }
    }

    return {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: '#8f6330',
        fontFamily: FONT,
        borderRadius: 12,
        controlHeight: 40,
        colorBgBase: '#fcfbf8',
        colorTextBase: '#1e2738',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f4efe6',
        colorBgElevated: '#ffffff',
        colorBgSpotlight: '#f7f1e6',
        colorBorder: 'rgba(122, 93, 52, 0.14)',
        colorBorderSecondary: 'rgba(122, 93, 52, 0.08)',
        colorText: '#1e2738',
        colorTextSecondary: '#5c6577',
        colorTextTertiary: '#7b8494',
        colorFillAlter: '#f7f1e6',
        colorFillContent: '#efe7da',
      },
      components: {
        Layout: {
          bodyBg: '#f4efe6',
          siderBg: '#fffaf2',
          headerBg: '#fffaf2',
        },
        Menu: {
          itemSelectedBg: 'rgba(143, 99, 48, 0.12)',
          itemSelectedColor: '#8f6330',
          itemHoverColor: '#8f6330',
        },
        Button: {
          primaryShadow: '0 10px 24px rgba(143, 99, 48, 0.16)',
        },
        Card: {
          colorBgContainer: '#ffffff',
        },
        Modal: {
          contentBg: '#fffdf9',
          headerBg: '#fffdf9',
        },
        Input: {
          colorBgContainer: '#fffdf9',
        },
        Select: {
          colorBgContainer: '#fffdf9',
        },
        Table: {
          colorBgContainer: '#ffffff',
          headerBg: '#f7f1e6',
        },
      },
    }
  }, [isDarkTheme, isSoftTheme])

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
              message="网页预览正在使用演示/空数据"
              description={localBackendStatus.message || '本地后端未连接，请运行 npm run dev:web 后刷新页面。'}
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
            </Routes>
          </Suspense>
        </AppLayout>
      </HashRouter>
      )}
    </ConfigProvider>
  )
}
