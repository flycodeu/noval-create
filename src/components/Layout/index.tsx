import React from 'react'
import { Layout, Menu, Tooltip } from 'antd'
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

const THEME_OPTIONS: { value: Theme; label: string; icon: string; tip: string }[] = [
  { value: 'dark', label: '深色', icon: '🌙', tip: '深色主题' },
  { value: 'light', label: '浅色', icon: '☀️', tip: '浅色主题（默认）' },
  { value: 'soft', label: '柔和', icon: '🍵', tip: '柔和暖色主题' },
]

export default function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { theme, setTheme } = useThemeStore()

  const selectedKey = menuItems.find(item => location.pathname.startsWith(item.key))?.key || '/novels'
  const hideAppSidebar = location.pathname.startsWith('/novels/') && location.pathname !== '/novels'

  return (
    <Layout style={{ height: '100vh', background: 'var(--color-bg-primary)' }}>
      {!hideAppSidebar ? (
      <Sider
        width={180}
        style={{
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo */}
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

        {/* 导航菜单 */}
        <Menu
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

        {/* 主题切换 */}
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
          <div style={{ display: 'flex', gap: 6 }}>
            {THEME_OPTIONS.map(opt => (
              <Tooltip key={opt.value} title={opt.tip}>
                <button
                  onClick={() => setTheme(opt.value)}
                  style={{
                    flex: 1,
                    height: 28,
                    border: `2px solid ${theme === opt.value ? 'var(--color-blue-primary)' : 'var(--border-color)'}`,
                    borderRadius: 4,
                    background: theme === opt.value ? 'rgba(46,134,171,0.15)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'border-color 0.15s',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {opt.icon}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      </Sider>
      ) : null}

      <Content style={{
        background: 'var(--color-bg-primary)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {children}
      </Content>
    </Layout>
  )
}
