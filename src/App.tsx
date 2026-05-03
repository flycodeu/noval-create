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
  const isDarkTheme = theme === 'dark'
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
    if (isDarkTheme) {
      return {
        algorithm: antdTheme.darkAlgorithm,
        token: {
          colorPrimary: '#0a84ff',
          fontFamily: FONT,
          borderRadius: 12,
          controlHeight: 40,
          colorBgBase: '#000000',
          colorTextBase: '#f5f5f7',
          colorBgContainer: '#1c1c1e',
          colorBgLayout: '#000000',
          colorBgElevated: '#2c2c2e',
          colorBgSpotlight: '#3a3a3c',
          colorBorder: 'rgba(255,255,255,0.1)',
          colorBorderSecondary: 'rgba(255,255,255,0.04)',
        },
        components: {
          Layout: {
            bodyBg: '#000000',
            siderBg: '#1c1c1e',
            headerBg: '#1c1c1e',
          },
          Menu: {
            darkItemBg: 'transparent',
            darkSubMenuItemBg: 'transparent',
            itemSelectedBg: 'rgba(10, 132, 255, 0.16)',
            itemSelectedColor: '#f5f5f7',
          },
          Card: {
            colorBgContainer: '#1c1c1e',
          },
          Modal: {
            contentBg: '#1c1c1e',
            headerBg: '#1c1c1e',
          },
          Input: {
            colorBgContainer: '#2c2c2e',
          },
          Select: {
            colorBgContainer: '#2c2c2e',
          },
          Table: {
            colorBgContainer: '#1c1c1e',
            headerBg: '#2c2c2e',
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
  }, [isDarkTheme])

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
