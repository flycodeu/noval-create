import React, { useEffect, useMemo } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Alert, ConfigProvider, theme as antdTheme } from 'antd'
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
          borderRadius: 12,
          colorBgBase: '#0a0a0c',
          colorTextBase: '#f5f5f7',
          colorBgContainer: '#1c1c1e',
          colorBgLayout: '#000000',
          colorBgElevated: '#2c2c2e',
          colorBgSpotlight: '#3a3a3c',
          colorBorder: 'rgba(255,255,255,0.1)',
          colorBorderSecondary: 'rgba(255,255,255,0.04)',
        },
      }
    }
    if (theme === 'soft') {
      return {
        algorithm: antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#6b8f71',
          fontFamily: FONT,
          borderRadius: 12,
          colorBgBase: '#fdfcfb',
          colorTextBase: '#2d2520',
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f4f0eb',
          colorBgElevated: '#ffffff',
          colorBgSpotlight: '#ece8e1',
          colorBorder: 'rgba(0,0,0,0.06)',
          colorBorderSecondary: 'rgba(0,0,0,0.03)',
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
        colorPrimary: '#0066cc',
        fontFamily: FONT,
        borderRadius: 12,
        colorBgBase: '#ffffff',
        colorTextBase: '#1d1d1f',
        colorBgContainer: '#ffffff',
        colorBgLayout: '#f5f5f7',
        colorBgElevated: '#ffffff',
        colorBgSpotlight: '#f2f2f7',
        colorBorder: 'rgba(0,0,0,0.08)',
        colorBorderSecondary: 'rgba(0,0,0,0.04)',
        colorText: '#1d1d1f',
        colorTextSecondary: '#86868b',
        colorTextTertiary: '#d2d2d7',
        colorFillAlter: '#f5f5f7',
        colorFillContent: '#f2f2f7',
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
