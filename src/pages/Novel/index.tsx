import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Spin, Tag } from 'antd'
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarsOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  LeftOutlined,
  RocketOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNovelStore } from '../../stores/novel.store'
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspace.store'
import GuidePage from './Guide'
import Overview from './Overview'
import CoreSettings from './CoreSettings'
import WorldRules from './WorldRules'
import MapManager from './MapManager'
import Characters from './Characters'
import ItemsPage from './Items'
import Outline from './Outline'
import TimelinePage from './Timeline'
import Writing from './Writing'
import {
  countMapNodes,
  EMPTY_WORKFLOW_STATS,
  getRecommendedWorkflowStep,
  type WorkflowStats,
} from './workflow'

type WorkspaceKey =
  | 'guide'
  | 'overview'
  | 'core-settings'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'outline'
  | 'timeline'
  | 'writing'

interface WorkspaceItem {
  key: WorkspaceKey
  icon: React.ReactNode
  label: string
  summary: string
}

const workspaceGroups: Array<{ title: string; items: WorkspaceItem[] }> = [
  {
    title: '创作总览',
    items: [
      { key: 'guide', icon: <RocketOutlined />, label: '创作向导', summary: '按步骤补齐设定、资产和写作前置' },
      { key: 'overview', icon: <DashboardOutlined />, label: '概览', summary: '查看进度、缺口和当前结构状态' },
      { key: 'core-settings', icon: <SettingOutlined />, label: '核心设定', summary: '统一主题、冲突、主线和结局方向' },
      { key: 'world-rules', icon: <GlobalOutlined />, label: '世界规则', summary: '同步种族、等级、地图层级和时间制度' },
    ],
  },
  {
    title: '结构资产',
    items: [
      { key: 'map', icon: <EnvironmentOutlined />, label: '地图结构', summary: '国家、势力、门派、基地和关键场景' },
      { key: 'characters', icon: <TeamOutlined />, label: '人物系统', summary: '角色、种族、关系网络和角色定位' },
      { key: 'items', icon: <AppstoreOutlined />, label: '物品装备', summary: '按题材生成模板、实例和剧情挂点' },
      { key: 'timeline', icon: <ClockCircleOutlined />, label: '事件时间轴', summary: '把事件、人物、物品和章节串起来' },
    ],
  },
  {
    title: '写作推进',
    items: [
      { key: 'outline', icon: <BarsOutlined />, label: '故事大纲', summary: '故事弧、章节细纲和节奏结构' },
      { key: 'writing', icon: <EditOutlined />, label: '正文写作', summary: '四阶段流水线、长文记忆和结构体检' },
    ],
  },
]

const MODE_COPY: Record<WorkspaceMode, { label: string; description: string }> = {
  guided: {
    label: '小白模式',
    description: '告诉你先做什么、为什么先做，并把关键操作压缩成一套清晰流程。',
  },
  pro: {
    label: '专业模式',
    description: '保留完整结构信息和联动细节，适合边写边调参与精修设定。',
  },
}

function getStatusLabel(status?: string) {
  switch (status) {
    case 'writing':
      return '写作中'
    case 'completed':
      return '已完成'
    case 'archived':
      return '已归档'
    default:
      return '草稿中'
  }
}

function getTargetWordsLabel(targetWords?: number) {
  if (!targetWords || targetWords <= 0) return '未设置'
  if (targetWords >= 10000) return `${Math.round(targetWords / 1000) / 10} 万字`
  return `${targetWords} 字`
}

export default function NovelRouter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { currentNovel, setCurrentNovel } = useNovelStore()
  const { mode, setMode } = useWorkspaceStore()
  const [loading, setLoading] = useState(true)
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)

  const novelId = Number.parseInt(id || '0', 10)
  const flatItems = useMemo(() => workspaceGroups.flatMap((group) => group.items), [])

  const currentPage = useMemo<WorkspaceKey>(() => {
    const segment = location.pathname.split('/').filter(Boolean).at(-1)
    return flatItems.some((item) => item.key === segment)
      ? (segment as WorkspaceKey)
      : 'guide'
  }, [flatItems, location.pathname])

  const currentPageMeta = useMemo(
    () => flatItems.find((item) => item.key === currentPage) || flatItems[0],
    [currentPage, flatItems],
  )
  const currentPageIndex = useMemo(
    () => flatItems.findIndex((item) => item.key === currentPage),
    [currentPage, flatItems],
  )
  const previousPageMeta = currentPageIndex > 0 ? flatItems[currentPageIndex - 1] : null
  const nextPageMeta = currentPageIndex >= 0 && currentPageIndex < flatItems.length - 1
    ? flatItems[currentPageIndex + 1]
    : null
  const recommendedPageKey = useMemo(
    () => getRecommendedWorkflowStep(currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )
  const recommendedPageMeta = useMemo(
    () => recommendedPageKey
      ? flatItems.find((item) => item.key === recommendedPageKey) || null
      : null,
    [flatItems, recommendedPageKey],
  )

  const navigateToPage = (pageKey: WorkspaceKey) => {
    navigate(`/novels/${novelId}/${pageKey}`)
  }

  const refreshWorkflowStats = useCallback(async () => {
    if (!novelId) return

    try {
      const [mapTree, characters, items, arcs, events] = await Promise.all([
        window.electron.map.getTree(novelId),
        window.electron.character.list(novelId),
        window.electron.item.list(novelId),
        window.electron.outline.getArcs(novelId),
        window.electron.timeline.list(novelId),
      ])

      setWorkflowStats({
        mapCount: countMapNodes(mapTree),
        characterCount: characters.length,
        itemCount: items.length,
        outlineCount: arcs.length,
        timelineCount: events.length,
      })
    } catch (error) {
      console.error(error)
    }
  }, [novelId])

  useEffect(() => {
    if (!novelId) return

    let alive = true
    setLoading(true)

    window.electron.novel.get(novelId).then((novel) => {
      if (!alive) return

      if (novel) {
        setCurrentNovel(novel)
      } else {
        navigate('/novels')
      }

      setLoading(false)
    })

    return () => {
      alive = false
    }
  }, [navigate, novelId, setCurrentNovel])

  useEffect(() => {
    void refreshWorkflowStats()
  }, [location.pathname, refreshWorkflowStats])

  if (loading) {
    return (
      <div className="novel-route-shell novel-route-shell--loading">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className={`novel-route-shell novel-route-shell--${mode}`}>
      <aside className="novel-route-shell__sidebar">
        <div className="novel-sidebar__brand">
          <div className="novel-sidebar__brand-mark">Novel Forge Workspace</div>
          <div className="novel-sidebar__brand-rule" />
        </div>

        <div className="novel-sidebar__summary">
          <div className="novel-sidebar__eyebrow">小说编辑台</div>
          <h1 className="novel-sidebar__title">{currentNovel?.title || '未命名小说'}</h1>
          <div className="novel-sidebar__meta">
            <Tag color="gold">{currentNovel?.genreName || '未设置题材'}</Tag>
            <Tag color="blue">{getStatusLabel(currentNovel?.status)}</Tag>
          </div>
          <div className="novel-sidebar__target">目标字数：{getTargetWordsLabel(currentNovel?.targetWords)}</div>
          <div className="novel-sidebar__focus">
            {currentPageMeta?.label || '创作向导'}
            <span>{currentPageMeta?.summary || '围绕同一套背景、类型和主题，推进整本书的写作工作流。'}</span>
          </div>
        </div>

        <section className="novel-sidebar__assist novel-sidebar__assist--hidden" aria-hidden="true">
          <div className="novel-sidebar__assist-title">当前页面要做什么</div>
          <div className="novel-sidebar__assist-copy">{currentPageMeta?.summary}</div>
          <ul className="novel-sidebar__hint-list">
            <li>所有模块都会持续继承题材、主题、背景、世界规则和既有资产。</li>
            <li>人物、物品、时间轴和章节不再孤立生成，而是互相回写和校验。</li>
            <li>写作页会直接看到场景计划、审校意见、长文记忆和一致性体检。</li>
          </ul>
        </section>

        <div className="novel-sidebar__nav">
          {workspaceGroups.map((group) => (
            <section key={group.title} className="novel-sidebar__group">
              <div className="novel-sidebar__group-title">{group.title}</div>
              <div className="novel-sidebar__group-list">
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`novel-sidebar__nav-item ${currentPage === item.key ? 'novel-sidebar__nav-item--active' : ''}`}
                    onClick={() => navigate(`/novels/${novelId}/${item.key}`)}
                  >
                    <span className="novel-sidebar__nav-icon">{item.icon}</span>
                    <span className="novel-sidebar__nav-copy">
                      <strong>{item.label}</strong>
                      <small>{item.summary}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="novel-sidebar__footer">
          系统会持续串联人物、事件、时间轴、地图、物品和章节信息，并在正文生成前后做全书级一致性校验。
        </div>
      </aside>

      <main className="novel-route-shell__content">
        <div className="novel-route-shell__content-frame">
          <div className="novel-route-shell__content-topbar">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/novels')}>
              返回主页
            </Button>
            <div className="novel-route-shell__content-breadcrumb">
              <strong>{currentNovel?.title || '当前小说'}</strong>
              <span>{currentPageMeta?.label || '创作向导'}</span>
            </div>
          </div>
          <div className="novel-route-shell__flowbar">
            <div className="novel-route-shell__flowbar-header">
              <div className="novel-route-shell__flowbar-summary">
                <div className="novel-route-shell__flowbar-kicker">当前页面</div>
                <strong>{currentPageMeta?.label || '创作向导'}</strong>
                <span>{currentPageMeta?.summary || '围绕同一套背景、类型和主题，推进整本书的写作工作流。'}</span>
              </div>
              <div className="novel-route-shell__flowbar-actions">
                <button
                  type="button"
                  className="novel-route-shell__next-step"
                  onClick={() => recommendedPageMeta && navigateToPage(recommendedPageMeta.key)}
                  disabled={!recommendedPageMeta}
                  title={recommendedPageMeta?.summary || '正在读取当前小说的完成状态。'}
                >
                  <span className="novel-route-shell__next-step-kicker">
                    {recommendedPageMeta?.key === currentPage ? '当前建议' : '下一步建议'}
                  </span>
                  <strong>{recommendedPageMeta?.label || '正在分析流程'}</strong>
                </button>
                <div className="novel-route-shell__flowbar-mode" title={MODE_COPY[mode].description}>
                  <span className="novel-route-shell__flowbar-mode-label">{MODE_COPY[mode].label}</span>
                  <div className="novel-mode-switch novel-mode-switch--compact" role="tablist" aria-label="工作台模式">
                    {(['guided', 'pro'] as WorkspaceMode[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`novel-mode-switch__button ${mode === value ? 'novel-mode-switch__button--active' : ''}`}
                        onClick={() => setMode(value)}
                      >
                        {MODE_COPY[value].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="novel-route-shell__content-body">
            <Routes>
              <Route path="guide" element={<GuidePage novelId={novelId} />} />
              <Route path="overview" element={<Overview novelId={novelId} />} />
              <Route path="core-settings" element={<CoreSettings novelId={novelId} />} />
              <Route path="world-rules" element={<WorldRules novelId={novelId} />} />
              <Route path="map" element={<MapManager novelId={novelId} />} />
              <Route path="characters" element={<Characters novelId={novelId} />} />
              <Route path="items" element={<ItemsPage novelId={novelId} />} />
              <Route path="outline" element={<Outline novelId={novelId} />} />
              <Route path="timeline" element={<TimelinePage novelId={novelId} />} />
              <Route path="writing" element={<Writing novelId={novelId} />} />
              <Route path="*" element={<GuidePage novelId={novelId} />} />
            </Routes>
          </div>
          <div className="novel-route-shell__content-footer">
            <div className="novel-route-shell__content-footer-copy">
              <strong>{currentPageMeta?.label || '创作向导'}</strong>
              <span>
                {previousPageMeta ? `上一步：${previousPageMeta.label}` : '当前已经是第一个流程'}
                {' · '}
                {nextPageMeta ? `下一步：${nextPageMeta.label}` : '当前已经是最后一个流程'}
              </span>
            </div>
            <div className="novel-route-shell__content-footer-actions">
              <Button
                icon={<LeftOutlined />}
                disabled={!previousPageMeta}
                onClick={() => previousPageMeta && navigateToPage(previousPageMeta.key)}
              >
                上一步
              </Button>
              <Button
                type="primary"
                icon={<RightOutlined />}
                disabled={!nextPageMeta}
                onClick={() => nextPageMeta && navigateToPage(nextPageMeta.key)}
              >
                下一步
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
