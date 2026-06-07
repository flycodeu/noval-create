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
  MoonOutlined,
  SunOutlined,
  HighlightOutlined,
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
    label: '风格模板',
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

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'soft', label: '柔和', icon: <HighlightOutlined /> },
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
      {!isNovelWorkspace ? <AppShellBar /> : null}

      {!isNovelWorkspace ? (
        <nav className="app-layout__mobile-nav" aria-label="主导航">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`app-layout__mobile-nav-item${selectedKey === item.key ? ' is-active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              <span className="app-layout__mobile-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}

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
                    <span className="app-layout__theme-option-icon">{opt.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </Sider>
        ) : null}

        <Content className={`app-layout__content${hideAppSidebar ? ' is-novel-workspace' : ''}`}>
          <AppErrorBoundary resetKey={novelWorkspaceResetKey}>
            {children}
          </AppErrorBoundary>
        </Content>
      </Layout>
    </Layout>
  )
}
