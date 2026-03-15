import React, { useEffect } from 'react'
import { Routes, Route, useParams, useNavigate, useLocation } from 'react-router-dom'
import { Layout, Menu, Spin } from 'antd'
import {
  DashboardOutlined, SettingOutlined, GlobalOutlined, EnvironmentOutlined,
  TeamOutlined, BarsOutlined, EditOutlined,
} from '@ant-design/icons'
import { useNovelStore } from '../../stores/novel.store'
import Overview from './Overview'
import CoreSettings from './CoreSettings'
import WorldRules from './WorldRules'
import MapManager from './MapManager'
import Characters from './Characters'
import Outline from './Outline'
import Writing from './Writing'

const { Sider, Content } = Layout

const subMenuItems = [
  { key: 'overview', icon: <DashboardOutlined />, label: '概览' },
  { key: 'core-settings', icon: <SettingOutlined />, label: '核心设定' },
  { key: 'world-rules', icon: <GlobalOutlined />, label: '世界规则' },
  { key: 'map', icon: <EnvironmentOutlined />, label: '地图管理' },
  { key: 'characters', icon: <TeamOutlined />, label: '人物系统' },
  { key: 'outline', icon: <BarsOutlined />, label: '大纲规划' },
  { key: 'writing', icon: <EditOutlined />, label: '正文编写' },
]

export default function NovelRouter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const [loading, setLoading] = React.useState(true)

  const novelId = parseInt(id || '0')

  useEffect(() => {
    if (!novelId) return
    setLoading(true)
    window.electron.novel.get(novelId).then(novel => {
      if (novel) {
        setCurrentNovel(novel)
      } else {
        navigate('/novels')
      }
      setLoading(false)
    })
  }, [novelId, setCurrentNovel, navigate])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin size="large" />
      </div>
    )
  }

  const pathSegments = location.pathname.split('/')
  const currentPage = pathSegments[pathSegments.length - 1] || 'overview'

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(`/novels/${novelId}/${key}`)
  }

  return (
    <Layout style={{ height: '100%', background: 'transparent' }}>
      <Sider
        width={150}
        style={{
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--border-color)',
        }}
      >
        {/* 小说标题 */}
        <div style={{
          padding: '12px 12px',
          borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {currentNovel?.title}
          </div>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[currentPage]}
          items={subMenuItems}
          onClick={handleMenuClick}
          style={{ background: 'transparent', border: 'none' }}
        />
      </Sider>

      <Content style={{ background: 'var(--color-bg-primary)', overflow: 'hidden' }}>
        <Routes>
          <Route path="overview" element={<Overview novelId={novelId} />} />
          <Route path="core-settings" element={<CoreSettings novelId={novelId} />} />
          <Route path="world-rules" element={<WorldRules novelId={novelId} />} />
          <Route path="map" element={<MapManager novelId={novelId} />} />
          <Route path="characters" element={<Characters novelId={novelId} />} />
          <Route path="outline" element={<Outline novelId={novelId} />} />
          <Route path="writing" element={<Writing novelId={novelId} />} />
          <Route path="*" element={<Overview novelId={novelId} />} />
        </Routes>
      </Content>
    </Layout>
  )
}
