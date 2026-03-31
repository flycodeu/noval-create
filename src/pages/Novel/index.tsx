import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Spin } from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarsOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  EditOutlined,
  EnvironmentOutlined,
  GlobalOutlined,
  LeftOutlined,
  RightOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNovelStore } from '../../stores/novel.store'
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspace.store'
import StudioPage from './Studio'
import GuidedWorkspaceStep from './GuidedStep'
import Overview from './Overview'
import PremisePage from './Premise'
import CoreSettings from './CoreSettings'
import ProjectBriefPage from './ProjectBrief'
import ThemeVoicePage from './ThemeVoice'
import WorldRules from './WorldRules'
import MapExplorer from './MapExplorer'
import Characters from './Characters'
import ItemsWorkspace from './ItemsWorkspace'
import StoryThreadsPage from './StoryThreads'
import Outline from './Outline'
import Structure from './Structure'
import TimelinePage from './Timeline'
import Writing from './Writing'
import RevisionCenterPage from './RevisionCenter'
import {
  EMPTY_WORKFLOW_STATS,
  getGuidedStepProgressMap,
  loadWorkflowStats,
  getRecommendedGuidedWorkflowStep,
  getRecommendedWorkflowStep,
  isMapStructureReady,
  isStoryCoreReady,
  isStoryPlotReady,
  isWorldFoundationReady,
  type GuidedWorkflowStepKey,
  type WorkflowRecommendationKey,
  type WorkflowStats,
} from './workflow'

type ProWorkspaceKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'story-design'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'threads'
  | 'outline'
  | 'structure'
  | 'timeline'
  | 'revision'
  | 'writing'

type WorkspaceKey = GuidedWorkflowStepKey | ProWorkspaceKey

interface WorkspaceItem {
  key: WorkspaceKey
  icon: React.ReactNode
  label: string
  summary: string
}

const GUIDED_ITEMS: WorkspaceItem[] = [
  { key: 'basics', icon: <DashboardOutlined />, label: '基础信息', summary: '只填书名、简介和背景。' },
  { key: 'project-brief', icon: <AppstoreOutlined />, label: '项目立项', summary: '先明确读者承诺、卖点与禁区。' },
  { key: 'story-core', icon: <SettingOutlined />, label: '基础设定', summary: '先定背景定位、主角起点和底层约束。' },
  { key: 'theme-voice', icon: <EditOutlined />, label: '主题与文风', summary: '固定主题、视角、时态与语言边界。' },
  { key: 'world-foundation', icon: <GlobalOutlined />, label: '世界规则', summary: '先同步题材规则。' },
  { key: 'map-structure', icon: <EnvironmentOutlined />, label: '地图结构', summary: '先搭地点骨架。' },
  { key: 'items-equipment', icon: <AppstoreOutlined />, label: '物品装备', summary: '先补关键道具和装备。' },
  { key: 'character-roster', icon: <TeamOutlined />, label: '角色系统', summary: '基于物品和地图补主角与关键角色。' },
  { key: 'story-threads', icon: <BarsOutlined />, label: '故事线程', summary: '把主线、支线和伏笔回收挂成线。' },
  { key: 'story-plot', icon: <BarsOutlined />, label: '故事设计', summary: '资产齐后再设计主线、支线和结局。' },
  { key: 'write-start', icon: <EditOutlined />, label: '开始写作', summary: '生成骨架后进入正文。' },
]

const PRO_GROUPS: Array<{ title: string; items: WorkspaceItem[] }> = [
  {
    title: '基础',
    items: [
      { key: 'guide', icon: <DashboardOutlined />, label: 'AI Studio', summary: '统一编排底盘、资产与质量。' },
      { key: 'overview', icon: <AppstoreOutlined />, label: '基础总览', summary: '查看小说基础信息。' },
      { key: 'project-brief', icon: <AppstoreOutlined />, label: '项目立项', summary: '统一读者承诺、卖点和禁区。' },
      { key: 'core-settings', icon: <SettingOutlined />, label: '基础设定', summary: '维护 premise 与写作边界。' },
      { key: 'theme-voice', icon: <EditOutlined />, label: '主题与文风', summary: '维护主题、叙事口吻和禁用表达。' },
    ],
  },
  {
    title: '世界',
    items: [
      { key: 'world-rules', icon: <GlobalOutlined />, label: '世界规则', summary: '维护题材与语言规则。' },
      { key: 'map', icon: <EnvironmentOutlined />, label: '地图结构', summary: '维护地点层级。' },
    ],
  },
  {
    title: '资源',
    items: [
      { key: 'items', icon: <AppstoreOutlined />, label: '物品装备', summary: '维护道具与装备。' },
      { key: 'characters', icon: <TeamOutlined />, label: '角色系统', summary: '维护人物关系。' },
      { key: 'threads', icon: <BarsOutlined />, label: '故事线程', summary: '维护主线、支线、悬念与回收。' },
    ],
  },
  {
    title: '推进',
    items: [
      { key: 'story-design', icon: <BarsOutlined />, label: '故事设计', summary: '在资产到位后设计主线、支线和结局。' },
      { key: 'outline', icon: <BarsOutlined />, label: '故事大纲', summary: '维护故事弧。' },
      { key: 'timeline', icon: <ClockCircleOutlined />, label: '时间轴', summary: '维护事件顺序。' },
      { key: 'revision', icon: <EditOutlined />, label: '修订中心', summary: '集中处理一致性与上下文同步任务。' },
      { key: 'writing', icon: <EditOutlined />, label: '正文写作', summary: '进入正文编辑。' },
    ],
  },
]

const STRUCTURE_ITEM: WorkspaceItem = {
  key: 'structure',
  icon: <ApartmentOutlined />,
  label: '结构阶段',
  summary: '拆分卷、部、章和场景结构。',
}

const GUIDED_TO_PRO_PAGE: Record<GuidedWorkflowStepKey, ProWorkspaceKey> = {
  basics: 'overview',
  'project-brief': 'project-brief',
  'story-core': 'core-settings',
  'theme-voice': 'theme-voice',
  'story-plot': 'story-design',
  'world-foundation': 'world-rules',
  'map-structure': 'map',
  'character-roster': 'characters',
  'items-equipment': 'items',
  'story-threads': 'threads',
  'write-start': 'writing',
  'volume-planning': 'structure',
}

const MODE_COPY: Record<WorkspaceMode, string> = {
  guided: '向导',
  pro: '详细编辑',
}

function getGuidedStepStateLabel(completedCount: number, totalCount: number) {
  if (completedCount >= totalCount) return '完成'
  if (completedCount > 0) return `${completedCount}/${totalCount}`
  return '未做'
}

function getGuidedTargetForProPage(
  page: ProWorkspaceKey,
  currentNovel: ReturnType<typeof useNovelStore.getState>['currentNovel'],
  workflowStats: WorkflowStats,
  recommendedKey: GuidedWorkflowStepKey,
): GuidedWorkflowStepKey {
  switch (page) {
    case 'guide':
    case 'overview':
      return 'basics'
    case 'project-brief':
      return 'project-brief'
    case 'core-settings':
      return 'story-core'
    case 'theme-voice':
      return 'theme-voice'
    case 'story-design':
      return 'story-plot'
    case 'world-rules':
      if (!isWorldFoundationReady(currentNovel)) return 'world-foundation'
      return isMapStructureReady(workflowStats) ? recommendedKey : 'map-structure'
    case 'map':
      return 'map-structure'
    case 'characters':
      return 'character-roster'
    case 'items':
      return 'items-equipment'
    case 'threads':
      return 'story-threads'
    case 'outline':
    case 'structure':
    case 'timeline':
    case 'revision':
    case 'writing':
      return 'write-start'
  }
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
  const proItems = useMemo(() => [...PRO_GROUPS.flatMap((group) => group.items), STRUCTURE_ITEM], [])
  const currentItems = mode === 'guided' ? GUIDED_ITEMS : proItems
  const pathSegment = location.pathname.split('/').filter(Boolean).at(-1) as WorkspaceKey | undefined

  const currentPage = useMemo<WorkspaceKey>(() => {
    if (pathSegment && currentItems.some((item) => item.key === pathSegment)) {
      return pathSegment
    }

    return currentItems[0]?.key || 'basics'
  }, [currentItems, pathSegment])

  const currentPageMeta = useMemo(
    () => currentItems.find((item) => item.key === currentPage) || currentItems[0],
    [currentItems, currentPage],
  )

  const currentPageIndex = useMemo(
    () => currentItems.findIndex((item) => item.key === currentPage),
    [currentItems, currentPage],
  )

  const previousPageMeta = currentPageIndex > 0 ? currentItems[currentPageIndex - 1] : null
  const nextPageMeta = currentPageIndex >= 0 && currentPageIndex < currentItems.length - 1
    ? currentItems[currentPageIndex + 1]
    : null

  const guidedProgressMap = useMemo(
    () => getGuidedStepProgressMap(currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )

  const recommendedGuidedKey = useMemo(
    () => getRecommendedGuidedWorkflowStep(currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )

  const recommendedProKey = useMemo(
    () => getRecommendedWorkflowStep(currentNovel, workflowStats) || 'guide',
    [currentNovel, workflowStats],
  )

  const recommendedKey = mode === 'guided' ? recommendedGuidedKey : recommendedProKey
  const headerSummary = currentPageMeta?.summary || '进入当前模块。'

  const refreshWorkflowStats = useCallback(async () => {
    if (!novelId) return

    try {
      setWorkflowStats(await loadWorkflowStats(novelId))
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

  useEffect(() => {
    if (loading || !novelId) return

    const validForCurrentMode = pathSegment && currentItems.some((item) => item.key === pathSegment)
    if (!validForCurrentMode) {
      navigate(`/novels/${novelId}/${recommendedKey}`, { replace: true })
    }
  }, [currentItems, loading, navigate, novelId, pathSegment, recommendedKey])

  const handleModeChange = (nextMode: WorkspaceMode) => {
    if (nextMode === mode) return

    setMode(nextMode)

    const targetKey = nextMode === 'guided'
      ? getGuidedTargetForProPage(currentPage as ProWorkspaceKey, currentNovel, workflowStats, recommendedGuidedKey)
      : (GUIDED_TO_PRO_PAGE[currentPage as GuidedWorkflowStepKey] || recommendedProKey)

    navigate(`/novels/${novelId}/${targetKey}`)
  }

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
        <div className="novel-sidebar__title-block">
          <div className="novel-sidebar__eyebrow">小说</div>
          <h1 className="novel-sidebar__title">{currentNovel?.title || '未命名小说'}</h1>
        </div>

        <div className="novel-sidebar__nav">
          {mode === 'guided' ? (
            GUIDED_ITEMS.map((item, index) => {
              const progress = guidedProgressMap[item.key as GuidedWorkflowStepKey]
              const isActive = currentPage === item.key

              return (
                <button
                  key={item.key}
                  type="button"
                  className={`novel-sidebar__nav-item ${isActive ? 'novel-sidebar__nav-item--active' : ''}`}
                  onClick={() => navigate(`/novels/${novelId}/${item.key}`)}
                >
                  <span className="novel-sidebar__nav-order">{index + 1}</span>
                  <span className="novel-sidebar__nav-copy">
                    <strong>{item.label}</strong>
                  </span>
                  <span className={`novel-sidebar__nav-state ${progress.isComplete ? 'novel-sidebar__nav-state--done' : ''}`}>
                    {getGuidedStepStateLabel(progress.completedCount, progress.totalCount)}
                  </span>
                </button>
              )
            })
          ) : (
            <>
              {PRO_GROUPS.map((group) => (
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
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}

              <section className="novel-sidebar__group">
                <div className="novel-sidebar__group-title">长篇</div>
                <div className="novel-sidebar__group-list">
                  <button
                    type="button"
                    className={`novel-sidebar__nav-item ${currentPage === STRUCTURE_ITEM.key ? 'novel-sidebar__nav-item--active' : ''}`}
                    onClick={() => navigate(`/novels/${novelId}/${STRUCTURE_ITEM.key}`)}
                  >
                    <span className="novel-sidebar__nav-icon">{STRUCTURE_ITEM.icon}</span>
                    <span className="novel-sidebar__nav-copy">
                      <strong>{STRUCTURE_ITEM.label}</strong>
                    </span>
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </aside>

      <main className="novel-route-shell__content">
        <div className="novel-route-shell__content-frame">
          <div className="novel-route-shell__header novel-route-shell__header--compact">
            <div className="novel-route-shell__header-main">
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/novels')}>
                返回项目列表
              </Button>
              <div className="novel-route-shell__header-copy">
                <div className="novel-route-shell__header-kicker">{currentNovel?.title || '当前小说'}</div>
                <strong>{currentPageMeta?.label}</strong>
                <span>{headerSummary}</span>
              </div>
            </div>
            <div className="novel-route-shell__header-actions">
              <div className="novel-mode-switch novel-mode-switch--compact novel-route-shell__header-switch" role="tablist" aria-label="工作模式切换">
                {(['guided', 'pro'] as WorkspaceMode[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`novel-mode-switch__button ${mode === value ? 'novel-mode-switch__button--active' : ''}`}
                    onClick={() => handleModeChange(value)}
                  >
                    {MODE_COPY[value]}
                  </button>
                ))}
              </div>
              <Button
                icon={<LeftOutlined />}
                disabled={!previousPageMeta}
                onClick={() => previousPageMeta && navigate(`/novels/${novelId}/${previousPageMeta.key}`)}
              >
                上一步
              </Button>
              <Button
                type="primary"
                icon={<RightOutlined />}
                disabled={!nextPageMeta}
                onClick={() => nextPageMeta && navigate(`/novels/${novelId}/${nextPageMeta.key}`)}
              >
                下一步
              </Button>
            </div>
          </div>

          <div className="novel-route-shell__content-body">
            <Routes>
              <Route path="basics" element={<GuidedWorkspaceStep novelId={novelId} stepKey="basics" />} />
              <Route
                path="project-brief"
                element={mode === 'guided'
                  ? <GuidedWorkspaceStep novelId={novelId} stepKey="project-brief" />
                  : <ProjectBriefPage novelId={novelId} />}
              />
              <Route path="story-core" element={<GuidedWorkspaceStep novelId={novelId} stepKey="story-core" />} />
              <Route
                path="theme-voice"
                element={mode === 'guided'
                  ? <GuidedWorkspaceStep novelId={novelId} stepKey="theme-voice" />
                  : <ThemeVoicePage novelId={novelId} />}
              />
              <Route path="story-plot" element={<GuidedWorkspaceStep novelId={novelId} stepKey="story-plot" />} />
              <Route path="world-foundation" element={<GuidedWorkspaceStep novelId={novelId} stepKey="world-foundation" />} />
              <Route path="map-structure" element={<GuidedWorkspaceStep novelId={novelId} stepKey="map-structure" />} />
              <Route path="character-roster" element={<GuidedWorkspaceStep novelId={novelId} stepKey="character-roster" />} />
              <Route path="items-equipment" element={<GuidedWorkspaceStep novelId={novelId} stepKey="items-equipment" />} />
              <Route path="story-threads" element={<GuidedWorkspaceStep novelId={novelId} stepKey="story-threads" />} />
              <Route path="write-start" element={<GuidedWorkspaceStep novelId={novelId} stepKey="write-start" />} />

              <Route path="guide" element={<StudioPage novelId={novelId} />} />
              <Route path="overview" element={<Overview novelId={novelId} />} />
              <Route path="core-settings" element={<PremisePage novelId={novelId} />} />
              <Route path="story-design" element={<CoreSettings novelId={novelId} />} />
              <Route path="world-rules" element={<WorldRules novelId={novelId} />} />
              <Route path="map" element={<MapExplorer novelId={novelId} />} />
              <Route path="characters" element={<Characters novelId={novelId} />} />
              <Route path="items" element={<ItemsWorkspace novelId={novelId} />} />
              <Route path="threads" element={<StoryThreadsPage novelId={novelId} />} />
              <Route path="outline" element={<Outline novelId={novelId} />} />
              <Route path="structure" element={<Structure novelId={novelId} />} />
              <Route path="timeline" element={<TimelinePage novelId={novelId} />} />
              <Route path="revision" element={<RevisionCenterPage novelId={novelId} />} />
              <Route path="writing" element={<Writing novelId={novelId} />} />
              <Route path="*" element={<Navigate replace to={`/novels/${novelId}/${recommendedKey}`} />} />
            </Routes>
          </div>
        </div>
      </main>
    </div>
  )
}
