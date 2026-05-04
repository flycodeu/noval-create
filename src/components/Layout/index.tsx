import React from 'react'
import { Layout, Menu } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  BookOutlined,
  RobotOutlined,
  AppstoreOutlined,
  ScheduleOutlined,
  MessageOutlined,
  BulbOutlined,
} from '@ant-design/icons'
import { useThemeStore, Theme } from '../../stores/theme.store'
import AppErrorBoundary from './AppErrorBoundary'
import AppShellBar from './AppShellBar'
import './AppLayout.css'

const { Sider, Content } = Layout

interface AppLayoutProps {
  children: React.ReactNode
}

const menuItems = [
  {
    key: '/novels',
    icon: <BookOutlined />,
    label: '我的小说',
  },
  {
    key: '/models',
    icon: <RobotOutlined />,
    label: '模型管理',
  },
  {
    key: '/templates',
    icon: <AppstoreOutlined />,
    label: '模板系统',
  },
  {
    key: '/prompts',
    icon: <MessageOutlined />,
    label: '提示词',
  },
  {
    key: '/tasks',
    icon: <ScheduleOutlined />,
    label: '任务中心',
  },
]

const THEME_OPTIONS: { value: Theme; label: string; icon: string }[] = [
  { value: 'dark', label: '深色', icon: '🌙' },
  { value: 'light', label: '浅色', icon: '☀️' },
  { value: 'soft', label: '柔和', icon: '◐' },
]

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, setTheme } = useThemeStore()

  const selectedKey = menuItems.find(item => location.pathname.startsWith(item.key))?.key || '/novels'
  const isNovelWorkspace = location.pathname.startsWith('/novels/') && location.pathname !== '/novels'
  const hideAppSidebar = isNovelWorkspace
  const novelWorkspaceResetKey = React.useMemo(() => {
    if (!isNovelWorkspace) return location.pathname

    const segments = location.pathname.split('/').filter(Boolean)
    const novelId = segments[1]
    return novelId ? `/novels/${novelId}` : '/novels'
  }, [isNovelWorkspace, location.pathname])

  return (
    <Layout className="app-layout">
      <AppShellBar />

      <Layout className="app-layout__body">
        {!hideAppSidebar ? (
          <Sider width={256} className="app-layout__sider">
            <Menu
              className="app-layout-menu"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={menuItems}
              onClick={({ key }) => navigate(key)}
            />

            <div className="app-layout__theme-panel">
              <div className="app-layout__theme-title">
                <BulbOutlined style={{ fontSize: 12 }} />
                主题设置
              </div>
              <div className="app-layout__theme-options">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTheme(opt.value)}
                    className={`app-layout__theme-option${theme === opt.value ? ' is-active' : ''}`}
                  >
                    <span>{opt.label}</span>
                    <span>{opt.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sider>
        ) : null}

        <Content className="app-layout__content">
          <AppErrorBoundary resetKey={novelWorkspaceResetKey}>
            {children}
          </AppErrorBoundary>
        </Content>
      </Layout>
    </Layout>
  )
}
