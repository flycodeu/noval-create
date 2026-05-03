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
  { value: 'soft', label: '柔和', icon: '🍵' },
]

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, setTheme } = useThemeStore()

  const selectedKey = menuItems.find(item => location.pathname.startsWith(item.key))?.key || '/novels'
  const isNovelWorkspace = location.pathname.startsWith('/novels/') && location.pathname !== '/novels'
  const hideAppSidebar = isNovelWorkspace

  return (
    <Layout style={{ height: '100dvh', minHeight: 0, background: 'var(--color-bg-primary)', overflow: 'hidden' }}>
      {!hideAppSidebar ? (
      <Sider
        width={256}
        className="app-layout-sider"
        style={{
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: '100dvh',
        }}
      >
        <div style={{
          padding: '24px 20px 16px',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: -0.5,
          }}>
            NovelForge
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
            AI 小说创作平台
          </div>
        </div>

        <Menu
          className="app-layout-menu"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{
            background: 'transparent',
            border: 'none',
            flex: 1,
            marginTop: 12,
            padding: '0 12px',
          }}
        />

        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--border-color)',
        }}>
          <div style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <BulbOutlined style={{ fontSize: 12 }} />
            主题设置
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                style={{
                  width: '100%',
                  minHeight: 40,
                  border: `1px solid ${theme === opt.value ? 'var(--color-blue-primary)' : 'transparent'}`,
                  borderRadius: 12,
                  background: theme === opt.value ? 'var(--color-bg-hover)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  transition: 'all 0.2s',
                  color: theme === opt.value ? 'var(--color-blue-primary)' : 'var(--color-text-primary)',
                  padding: '0 16px',
                }}
              >
                <span>{opt.label}</span>
                <span>{opt.icon}</span>
              </button>
            ))}
          </div>
        </div>
      </Sider>
      ) : null}

      <Content style={{
        background: 'transparent',
        overflowX: 'hidden',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
      }}>
        <AppErrorBoundary resetKey={location.pathname}>
          {children}
        </AppErrorBoundary>
      </Content>
    </Layout>
  )
}
