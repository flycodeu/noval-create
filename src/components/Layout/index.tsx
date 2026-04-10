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
    <Layout style={{ minHeight: '100vh', height: '100dvh', background: 'var(--color-bg-primary)' }}>
      {!hideAppSidebar ? (
      <Sider
        width={236}
        className="app-layout-sider"
        style={{
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: '100dvh',
        }}
      >
        <div style={{
          padding: '20px 16px 16px',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--color-blue-primary)',
            letterSpacing: 1,
          }}>
            ✦ NovelForge
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
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
            marginTop: 8,
          }}
        />

        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border-color)',
        }}>
          <div style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <BulbOutlined style={{ fontSize: 11 }} />
            主题
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                style={{
                  width: '100%',
                  minHeight: 36,
                  border: `2px solid ${theme === opt.value ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                  borderRadius: 8,
                  background: theme === opt.value ? 'rgba(46,134,171,0.15)' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  transition: 'border-color 0.15s',
                  color: 'var(--color-text-primary)',
                  padding: '0 12px',
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
        background: 'var(--color-bg-primary)',
        overflowX: 'hidden',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}>
        {children}
      </Content>
    </Layout>
  )
}
