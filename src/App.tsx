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
  const isSoftTheme = theme === 'soft'
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
