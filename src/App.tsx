import React, { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Alert, Layout, ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import AppLayout from './components/Layout'
import NovelList from './pages/NovelList'
import ModelManager from './pages/ModelManager'
import TemplateManager from './pages/TemplateManager'
import TaskCenter from './pages/TaskCenter'
import PromptManager from './pages/PromptManager'
import NovelRouter from './pages/Novel'
import { useTaskStore } from './stores/task.store'
import { useThemeStore } from './stores/theme.store'

const { Content } = Layout
const FONT = "-apple-system, 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', sans-serif"

export default function App() {
  const { addStream, appendStreamChunk, completeStream } = useTaskStore()
  const { theme } = useThemeStore()
  const hasElectronBridge = typeof window !== 'undefined'
    && typeof window.electron?.on === 'function'
    && typeof window.electron?.novel?.list === 'function'

  useEffect(() => {
    if (!hasElectronBridge) {
      console.error('Electron preload bridge is unavailable. Open this app through Electron instead of a plain browser tab.')
      return undefined
    }

    const unsubChunk = window.electron.on('task:stream-chunk', (data: unknown) => {
      const { taskId, chunk } = data as { taskId: number; chunk: string }
      appendStreamChunk(taskId, chunk)
    })
    const unsubComplete = window.electron.on('task:complete', (data: unknown) => {
      const { taskId, status } = data as { taskId: number; status: string }
      completeStream(
        taskId,
        status === 'success'
          ? 'completed'
          : status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      )
    })
    const unsubStatus = window.electron.on('task:status-change', (data: unknown) => {
      const { taskId, status } = data as { taskId: number; status: string }
      if (status === 'running') addStream(taskId)
    })
    return () => { unsubChunk(); unsubComplete(); unsubStatus() }
  }, [addStream, appendStreamChunk, completeStream, hasElectronBridge])

  const antdThemeConfig = useMemo(() => {
    if (theme === 'dark') {
      return {
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#2E86AB',
          fontFamily: FONT,
          borderRadius: 6,
          colorBgBase: '#0f1117',
          colorTextBase: '#e8eaed',
          colorBgContainer: '#1e2235',
          colorBgLayout: '#1a1d27',
          colorBgElevated: '#252840',
          colorBgSpotlight: '#252840',
          colorBorder: 'rgba(255,255,255,0.12)',
          colorBorderSecondary: 'rgba(255,255,255,0.06)',
        },
      }
    }
    if (theme === 'soft') {
      return {
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#6b8f71',
          fontFamily: FONT,
          borderRadius: 6,
          colorBgBase: '#faf7f4',
          colorTextBase: '#2d2520',
          colorBgContainer: '#faf7f4',
          colorBgLayout: '#f4f0eb',
          colorBgElevated: '#faf7f4',
          colorBgSpotlight: '#ece8e1',
          colorBorder: '#d4c9be',
          colorBorderSecondary: '#e0d8cf',
          colorText: '#2d2520',
          colorTextSecondary: '#6b5e52',
          colorTextTertiary: '#9b8a7a',
        },
      }
    }
    // light (default)
    return {
      algorithm: antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: '#2E86AB',
        fontFamily: FONT,
        borderRadius: 6,
        colorBgBase: '#ffffff',
        colorTextBase: '#1a1d27',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f5f7fa',
        colorBgElevated: '#ffffff',
        colorBgSpotlight: '#f0f4f8',
        colorBorder: '#d9d9d9',
        colorBorderSecondary: '#e8ecf0',
        colorText: '#1a1d27',
        colorTextSecondary: '#4a5270',
        colorTextTertiary: '#8a93a8',
        colorFillAlter: '#f5f7fa',
        colorFillContent: '#f0f4f8',
      },
    }
  }, [theme])

  return (
    <ConfigProvider theme={antdThemeConfig} locale={zhCN}>
      {!hasElectronBridge ? (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
          <Alert
            type="error"
            showIcon
            message="Electron 桥接未加载"
            description="当前页面缺少 preload 注入的 window.electron。请通过 Electron 启动桌面应用，不要直接在普通浏览器里打开 Vite 地址。"
            style={{ maxWidth: 720 }}
          />
        </div>
      ) : (
      <HashRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<Navigate to="/novels" replace />} />
            <Route path="/novels" element={<NovelList />} />
            <Route path="/novels/:id/*" element={<NovelRouter />} />
            <Route path="/models" element={<ModelManager />} />
            <Route path="/templates" element={<TemplateManager />} />
            <Route path="/tasks" element={<TaskCenter />} />
            <Route path="/prompts" element={<PromptManager />} />
          </Routes>
        </AppLayout>
      </HashRouter>
      )}
    </ConfigProvider>
  )
}
