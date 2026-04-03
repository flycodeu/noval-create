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
import { useWorkspaceStore } from '../../stores/workspace.store'
import StudioPage from './Studio'
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
  getRecommendedWorkflowStep,
  isWritingStepReady,
  loadWorkflowStats,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from './workflow'

type ProWorkspaceKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'world-rules'
  | 'map'
  | 'characters'
  | 'items'
  | 'threads'
  | 'story-design'
  | 'outline'
  | 'structure'
  | 'timeline'
  | 'writing'
  | 'revision'

interface WorkspaceItem {
  key: ProWorkspaceKey
  icon: React.ReactNode
  label: string
  summary: string
}

const WORKSPACE_GROUPS: Array<{ title: string; items: WorkspaceItem[] }> = [
  {
    title: '总览',
    items: [
      { key: 'guide', icon: <DashboardOutlined />, label: '创作总览', summary: '先看整体进度、风险和下一步。' },
      { key: 'overview', icon: <AppstoreOutlined />, label: '基础信息', summary: '维护书名、简介、背景和目标字数。' },
    ],
  },
  {
    title: '底盘',
    items: [
      { key: 'project-brief', icon: <AppstoreOutlined />, label: '项目立项', summary: '先定读者承诺、卖点和禁区。' },
      { key: 'core-settings', icon: <SettingOutlined />, label: '基础设定', summary: '固定定位、主角起点和底层约束。' },
      { key: 'theme-voice', icon: <EditOutlined />, label: '主题与文风', summary: '固定主题、叙事口吻和语言边界。' },
    ],
  },
  {
    title: '世界与资源',
    items: [
      { key: 'world-rules', icon: <GlobalOutlined />, label: '世界规则', summary: '统一题材规则、时间制度和写作约束。' },
      { key: 'map', icon: <EnvironmentOutlined />, label: '地图结构', summary: '让地点能承载路线、冲突和代价。' },
      { key: 'characters', icon: <TeamOutlined />, label: '角色系统', summary: '补齐主角与关键人物关系。' },
      { key: 'items', icon: <AppstoreOutlined />, label: '物品装备', summary: '补齐道具、资源和可回收线索。' },
      { key: 'threads', icon: <BarsOutlined />, label: '故事线程', summary: '把主线、支线和伏笔挂成可追踪线程。' },
    ],
  },
  {
    title: '推进',
    items: [
      { key: 'story-design', icon: <BarsOutlined />, label: '故事设计', summary: '在资产到位后统一设计主线、支线和结局。' },
      { key: 'outline', icon: <BarsOutlined />, label: '故事大纲', summary: '按章节推进主线，落实关键转折。' },
      { key: 'structure', icon: <ApartmentOutlined />, label: '结构规划', summary: '拆卷、拆部、拆章，稳住长篇节奏。' },
      { key: 'timeline', icon: <ClockCircleOutlined />, label: '时间轴', summary: '维护事件顺序、后果链和时间锚点。' },
      { key: 'writing', icon: <EditOutlined />, label: '正文写作', summary: '集中处理场景计划、主写、审校和定稿。' },
      { key: 'revision', icon: <EditOutlined />, label: '修订中心', summary: '收口一致性问题和上下文同步任务。' },
    ],
  },
]

const LEGACY_ROUTE_REDIRECTS: Record<GuidedWorkflowStepKey, ProWorkspaceKey> = {
  basics: 'overview',
  'project-brief': 'project-brief',
  'story-core': 'core-settings',
  'theme-voice': 'theme-voice',
  'world-foundation': 'world-rules',
  'map-structure': 'map',
  'character-roster': 'characters',
  'items-equipment': 'items',
  'story-threads': 'threads',
  'story-plot': 'story-design',
  'volume-planning': 'structure',
  'write-start': 'writing',
}

function formatCountState(count: number, singularUnit: string, emptyLabel = '待补') {
  if (count <= 0) return emptyLabel
  return `${count}${singularUnit}`
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
  const workspaceGroups = useMemo(() => WORKSPACE_GROUPS, [])
  const workspaceItems = useMemo(
    () => workspaceGroups.flatMap((group) => group.items),
    [workspaceGroups],
  )
  const pathSegment = location.pathname.split('/').filter(Boolean).at(-1) || ''
  const legacyRouteTarget = useMemo(
    () => (
      Object.prototype.hasOwnProperty.call(LEGACY_ROUTE_REDIRECTS, pathSegment)
        ? LEGACY_ROUTE_REDIRECTS[pathSegment as GuidedWorkflowStepKey]
        : null
    ),
    [pathSegment],
  )

  const currentPage = useMemo<ProWorkspaceKey>(() => {
    if (workspaceItems.some((item) => item.key === pathSegment)) {
      return pathSegment as ProWorkspaceKey
    }

    return workspaceItems[0]?.key || 'guide'
  }, [pathSegment, workspaceItems])

  const currentPageMeta = useMemo(
    () => workspaceItems.find((item) => item.key === currentPage) || workspaceItems[0],
    [workspaceItems, currentPage],
  )

  const currentPageIndex = useMemo(
    () => workspaceItems.findIndex((item) => item.key === currentPage),
    [workspaceItems, currentPage],
  )

  const previousPageMeta = currentPageIndex > 0 ? workspaceItems[currentPageIndex - 1] : null
  const nextPageMeta = currentPageIndex >= 0 && currentPageIndex < workspaceItems.length - 1
    ? workspaceItems[currentPageIndex + 1]
    : null

  const guidedProgressMap = useMemo(
    () => getGuidedStepProgressMap(currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )

  const recommendedKey = useMemo(
    () => getRecommendedWorkflowStep(currentNovel, workflowStats) || 'guide',
    [currentNovel, workflowStats],
  )

  const readinessMap = useMemo<Record<Exclude<ProWorkspaceKey, 'guide' | 'revision'>, boolean>>(
    () => ({
      overview: guidedProgressMap.basics.isComplete,
      'project-brief': guidedProgressMap['project-brief'].isComplete,
      'core-settings': guidedProgressMap['story-core'].isComplete,
      'theme-voice': guidedProgressMap['theme-voice'].isComplete,
      'world-rules': guidedProgressMap['world-foundation'].isComplete,
      map: guidedProgressMap['map-structure'].isComplete,
      characters: guidedProgressMap['character-roster'].isComplete,
      items: guidedProgressMap['items-equipment'].isComplete,
      threads: guidedProgressMap['story-threads'].isComplete,
      'story-design': guidedProgressMap['story-plot'].isComplete,
      outline: workflowStats.outlineCount > 0,
      structure: guidedProgressMap['volume-planning'].isComplete,
      timeline: workflowStats.timelineCount > 0,
      writing: isWritingStepReady(workflowStats),
    }),
    [guidedProgressMap, workflowStats],
  )

  const workspaceReadyCount = useMemo(
    () => Object.values(readinessMap).filter(Boolean).length,
    [readinessMap],
  )
  const workspaceTotalCount = useMemo(
    () => Object.keys(readinessMap).length,
    [readinessMap],
  )

  const workspaceStateMap = useMemo<Record<ProWorkspaceKey, { label: string; complete: boolean }>>(
    () => ({
      guide: {
        label: `${workspaceReadyCount}/${workspaceTotalCount}`,
        complete: workspaceReadyCount >= workspaceTotalCount,
      },
      overview: {
        label: guidedProgressMap.basics.isComplete ? '已就绪' : `${guidedProgressMap.basics.completedCount}/${guidedProgressMap.basics.totalCount}`,
        complete: guidedProgressMap.basics.isComplete,
      },
      'project-brief': {
        label: guidedProgressMap['project-brief'].isComplete ? '已就绪' : `${guidedProgressMap['project-brief'].completedCount}/${guidedProgressMap['project-brief'].totalCount}`,
        complete: guidedProgressMap['project-brief'].isComplete,
      },
      'core-settings': {
        label: guidedProgressMap['story-core'].isComplete ? '已就绪' : `${guidedProgressMap['story-core'].completedCount}/${guidedProgressMap['story-core'].totalCount}`,
        complete: guidedProgressMap['story-core'].isComplete,
      },
      'theme-voice': {
        label: guidedProgressMap['theme-voice'].isComplete ? '已就绪' : `${guidedProgressMap['theme-voice'].completedCount}/${guidedProgressMap['theme-voice'].totalCount}`,
        complete: guidedProgressMap['theme-voice'].isComplete,
      },
      'world-rules': {
        label: guidedProgressMap['world-foundation'].isComplete ? '已就绪' : '待补',
        complete: guidedProgressMap['world-foundation'].isComplete,
      },
      map: {
        label: formatCountState(workflowStats.mapCount, '处'),
        complete: guidedProgressMap['map-structure'].isComplete,
      },
      characters: {
        label: workflowStats.characterCount > 0
          ? `${workflowStats.characterCount}人`
          : '待补',
        complete: guidedProgressMap['character-roster'].isComplete,
      },
      items: {
        label: formatCountState(workflowStats.itemCount, '项'),
        complete: guidedProgressMap['items-equipment'].isComplete,
      },
      threads: {
        label: formatCountState(workflowStats.threadCount, '条'),
        complete: guidedProgressMap['story-threads'].isComplete,
      },
      'story-design': {
        label: guidedProgressMap['story-plot'].isComplete ? '已就绪' : `${guidedProgressMap['story-plot'].completedCount}/${guidedProgressMap['story-plot'].totalCount}`,
        complete: guidedProgressMap['story-plot'].isComplete,
      },
      outline: {
        label: formatCountState(workflowStats.outlineCount, '条'),
        complete: workflowStats.outlineCount > 0,
      },
      structure: {
        label: workflowStats.volumeCount > 0 ? `${workflowStats.volumeCount}卷` : '待补',
        complete: guidedProgressMap['volume-planning'].isComplete,
      },
      timeline: {
        label: formatCountState(workflowStats.timelineCount, '项'),
        complete: workflowStats.timelineCount > 0,
      },
      writing: {
        label: workflowStats.chapterCount > 0
          ? `${workflowStats.chapterCount}章`
          : workflowStats.totalWords > 0
            ? `${workflowStats.totalWords.toLocaleString()}字`
            : '未开写',
        complete: isWritingStepReady(workflowStats),
      },
      revision: {
        label: workflowStats.revisionTaskCount > 0 ? `${workflowStats.revisionTaskCount}项待处理` : '已清空',
        complete: workflowStats.revisionTaskCount <= 0,
      },
    }),
    [guidedProgressMap, workflowStats, workspaceReadyCount, workspaceTotalCount],
  )

  const recommendedPageMeta = useMemo(
    () => workspaceItems.find((item) => item.key === recommendedKey) || workspaceItems[0],
    [recommendedKey, workspaceItems],
  )

  const headerSummary = useMemo(() => {
    if (!currentPageMeta) return '进入当前模块。'
    if (recommendedPageMeta && currentPage !== recommendedKey) {
      return `${currentPageMeta.summary} 当前建议优先推进「${recommendedPageMeta.label}」。`
    }
    return currentPageMeta.summary
  }, [currentPage, currentPageMeta, recommendedKey, recommendedPageMeta])

  const refreshWorkflowStats = useCallback(async () => {
    if (!novelId) return

    try {
      setWorkflowStats(await loadWorkflowStats(novelId))
    } catch (error) {
      console.error(error)
    }
  }, [novelId])

  useEffect(() => {
    if (mode !== 'pro') {
      setMode('pro')
    }
  }, [mode, setMode])

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

    if (legacyRouteTarget && pathSegment !== legacyRouteTarget) {
      navigate(`/novels/${novelId}/${legacyRouteTarget}`, { replace: true })
      return
    }

    const validPath = workspaceItems.some((item) => item.key === pathSegment)
    if (!validPath) {
      navigate(`/novels/${novelId}/${recommendedKey}`, { replace: true })
    }
  }, [legacyRouteTarget, loading, navigate, novelId, pathSegment, recommendedKey, workspaceItems])

  if (loading) {
    return (
      <div className="novel-route-shell novel-route-shell--loading">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <div className="novel-route-shell novel-route-shell--single">
      <aside className="novel-route-shell__sidebar">
        <div className="novel-sidebar__title-block">
          <div className="novel-sidebar__eyebrow">小说工作台</div>
          <div className="novel-sidebar__title-row">
            <h1 className="novel-sidebar__title">{currentNovel?.title || '未命名小说'}</h1>
            <span className="novel-sidebar__title-meta">{`${workspaceReadyCount}/${workspaceTotalCount}`}</span>
          </div>
          <div className="novel-sidebar__summary-copy">
            {currentNovel?.synopsis?.trim() || '先补一句话简介和基础背景，后面的角色、世界和正文都会沿着这里展开。'}
          </div>
        </div>

        <div className="novel-sidebar__progress-card">
          <div className="novel-sidebar__progress-head">
            <span className="novel-sidebar__progress-label">整体进度</span>
            <span className="novel-sidebar__progress-value">{`${workspaceReadyCount}/${workspaceTotalCount}`}</span>
          </div>
          <div className="novel-sidebar__progress-copy">
            {`${workspaceReadyCount} 个模块已就绪，当前继续沿主流程往下推进。`}
          </div>
          <button
            type="button"
            className="novel-sidebar__recommend"
            disabled={currentPage === recommendedKey}
            onClick={() => navigate(`/novels/${novelId}/${recommendedKey}`)}
          >
            <span>当前建议</span>
            <strong>{recommendedPageMeta?.label || '继续推进'}</strong>
          </button>
        </div>

        <div className="novel-sidebar__nav">
          {workspaceGroups.map((group) => (
            <section key={group.title} className="novel-sidebar__group">
              <div className="novel-sidebar__group-title">{group.title}</div>
              <div className="novel-sidebar__group-list">
                {group.items.map((item) => {
                  const isActive = currentPage === item.key
                  const state = workspaceStateMap[item.key]

                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`novel-sidebar__nav-item ${isActive ? 'novel-sidebar__nav-item--active' : ''}`}
                      onClick={() => navigate(`/novels/${novelId}/${item.key}`)}
                    >
                      <span className="novel-sidebar__nav-icon">{item.icon}</span>
                      <span className="novel-sidebar__nav-copy">
                        <strong>{item.label}</strong>
                        <small>{item.summary}</small>
                      </span>
                      <span className={`novel-sidebar__nav-state ${state.complete ? 'novel-sidebar__nav-state--done' : ''}`}>
                        {state.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
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
              {currentPage !== recommendedKey ? (
                <Button onClick={() => navigate(`/novels/${novelId}/${recommendedKey}`)}>
                  推荐下一步
                </Button>
              ) : null}
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
              <Route path="basics" element={<Navigate replace to={`/novels/${novelId}/overview`} />} />
              <Route path="story-core" element={<Navigate replace to={`/novels/${novelId}/core-settings`} />} />
              <Route path="world-foundation" element={<Navigate replace to={`/novels/${novelId}/world-rules`} />} />
              <Route path="map-structure" element={<Navigate replace to={`/novels/${novelId}/map`} />} />
              <Route path="character-roster" element={<Navigate replace to={`/novels/${novelId}/characters`} />} />
              <Route path="items-equipment" element={<Navigate replace to={`/novels/${novelId}/items`} />} />
              <Route path="story-threads" element={<Navigate replace to={`/novels/${novelId}/threads`} />} />
              <Route path="story-plot" element={<Navigate replace to={`/novels/${novelId}/story-design`} />} />
              <Route path="volume-planning" element={<Navigate replace to={`/novels/${novelId}/structure`} />} />
              <Route path="write-start" element={<Navigate replace to={`/novels/${novelId}/writing`} />} />

              <Route path="guide" element={<StudioPage novelId={novelId} />} />
              <Route path="overview" element={<Overview novelId={novelId} />} />
              <Route path="project-brief" element={<ProjectBriefPage novelId={novelId} />} />
              <Route path="core-settings" element={<PremisePage novelId={novelId} />} />
              <Route path="theme-voice" element={<ThemeVoicePage novelId={novelId} />} />
              <Route path="world-rules" element={<WorldRules novelId={novelId} />} />
              <Route path="map" element={<MapExplorer novelId={novelId} />} />
              <Route path="characters" element={<Characters novelId={novelId} />} />
              <Route path="items" element={<ItemsWorkspace novelId={novelId} />} />
              <Route path="threads" element={<StoryThreadsPage novelId={novelId} />} />
              <Route path="story-design" element={<CoreSettings novelId={novelId} />} />
              <Route path="outline" element={<Outline novelId={novelId} />} />
              <Route path="structure" element={<Structure novelId={novelId} />} />
              <Route path="timeline" element={<TimelinePage novelId={novelId} />} />
              <Route path="writing" element={<Writing novelId={novelId} />} />
              <Route path="revision" element={<RevisionCenterPage novelId={novelId} />} />
              <Route path="*" element={<Navigate replace to={`/novels/${novelId}/${recommendedKey}`} />} />
            </Routes>
          </div>
        </div>
      </main>
    </div>
  )
}
