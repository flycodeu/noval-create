import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Input, Modal, Spin, message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
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
  RollbackOutlined,
  SearchOutlined,
  QuestionCircleOutlined,
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
import Factions from './Factions'
import MapExplorer from './MapExplorer'
import Characters from './Characters'
import Glossary from './Glossary'
import ItemsWorkspace from './ItemsWorkspace'
import SceneTemplates from './SceneTemplates'
import StoryThreadsPage from './StoryThreads'
import Outline from './Outline'
import Structure from './Structure'
import TimelinePage from './Timeline'
import Writing from './Writing'
import RevisionCenterPage from './RevisionCenter'
import QualityDashboard from './QualityDashboard'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary'
import {
  EMPTY_WORKFLOW_STATS,
  getGuidedStepProgressMap,
  getRecommendedWorkflowStep,
  isWritingStepReady,
  loadWorkflowStats,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from './workflow'
import { NovelWorkspaceActionsProvider } from './workspace-shortcuts'
import type { Chapter, OperationLog } from '../../types'

type ProWorkspaceKey =
  | 'guide'
  | 'overview'
  | 'project-brief'
  | 'core-settings'
  | 'theme-voice'
  | 'world-rules'
  | 'map'
  | 'factions'
  | 'characters'
  | 'items'
  | 'glossary'
  | 'threads'
  | 'scene-templates'
  | 'story-design'
  | 'outline'
  | 'structure'
  | 'timeline'
  | 'writing'
  | 'revision'
  | 'quality'

interface WorkspaceItem {
  key: ProWorkspaceKey
  icon: React.ReactNode
  label: string
  summary: string
}

interface WorkspaceSearchResult {
  id: string
  type: 'chapter' | 'thread' | 'timeline' | 'character' | 'item' | 'map'
  label: string
  description: string
  route: string
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
      { key: 'factions', icon: <ApartmentOutlined />, label: '势力系统', summary: '把角色归属和外部关系拆成结构化资产。' },
      { key: 'characters', icon: <TeamOutlined />, label: '角色系统', summary: '补齐主角与关键人物关系。' },
      { key: 'items', icon: <AppstoreOutlined />, label: '物品装备', summary: '补齐道具、资源和可回收线索。' },
      { key: 'glossary', icon: <BarsOutlined />, label: '设定词典', summary: '固定术语、阶位、材料和专有名词。' },
      { key: 'threads', icon: <BarsOutlined />, label: '故事线程', summary: '把主线、支线和伏笔挂成可追踪线程。' },
      { key: 'scene-templates', icon: <AppstoreOutlined />, label: '场景模板', summary: '沉淀高频场景的节拍和复用骨架。' },
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
      { key: 'quality', icon: <BarChartOutlined />, label: '质量监控', summary: '查看各章节评分热力图、趋势和薄弱维度。' },
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

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  const tagName = element.tagName?.toLowerCase()
  return Boolean(
    element.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || element.closest('.ant-select')
    || element.closest('.ant-input')
    || element.closest('[contenteditable="true"]'),
  )
}

export default function NovelRouter() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    chapters,
    currentChapterId,
    currentNovel,
    setChapters,
    setCurrentNovel,
    resetWorkspace,
  } = useNovelStore()
  const { mode, setMode } = useWorkspaceStore()
  const saveHandlerRef = useRef<(() => void) | null>(null)
  const escapeHandlerRef = useRef<(() => void) | null>(null)
  const [loading, setLoading] = useState(true)
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const [chapterJumpOpen, setChapterJumpOpen] = useState(false)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [chapterJumpKeyword, setChapterJumpKeyword] = useState('')
  const [quickSearchKeyword, setQuickSearchKeyword] = useState('')
  const [quickSearchLoading, setQuickSearchLoading] = useState(false)
  const [quickSearchResults, setQuickSearchResults] = useState<WorkspaceSearchResult[]>([])
  const [latestUndoable, setLatestUndoable] = useState<OperationLog | null>(null)
  const [workspaceMutationToken, setWorkspaceMutationToken] = useState(0)

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
      factions: workflowStats.factionCount > 0,
      characters: guidedProgressMap['character-roster'].isComplete,
      items: guidedProgressMap['items-equipment'].isComplete,
      glossary: workflowStats.glossaryCount > 0,
      threads: guidedProgressMap['story-threads'].isComplete,
      'scene-templates': workflowStats.sceneTemplateCount > 0,
      'story-design': guidedProgressMap['story-plot'].isComplete,
      outline: workflowStats.outlineCount > 0,
      structure: guidedProgressMap['volume-planning'].isComplete,
      timeline: workflowStats.timelineCount > 0,
      writing: isWritingStepReady(workflowStats),
      quality: true,
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
      factions: {
        label: formatCountState(workflowStats.factionCount, '个'),
        complete: workflowStats.factionCount > 0,
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
      glossary: {
        label: formatCountState(workflowStats.glossaryCount, '条'),
        complete: workflowStats.glossaryCount > 0,
      },
      threads: {
        label: formatCountState(workflowStats.threadCount, '条'),
        complete: guidedProgressMap['story-threads'].isComplete,
      },
      'scene-templates': {
        label: formatCountState(workflowStats.sceneTemplateCount, '套'),
        complete: workflowStats.sceneTemplateCount > 0,
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
      quality: {
        label: '查看',
        complete: true,
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

  const refreshUndoable = useCallback(async () => {
    if (!novelId) return
    try {
      setLatestUndoable(await window.electron.history.getLatestUndoable(novelId))
    } catch (error) {
      console.error(error)
    }
  }, [novelId])

  const registerSaveHandler = useCallback((handler: (() => void) | null) => {
    saveHandlerRef.current = handler
  }, [])

  const registerEscapeHandler = useCallback((handler: (() => void) | null) => {
    escapeHandlerRef.current = handler
  }, [])

  const notifyWorkspaceMutation = useCallback(() => {
    setWorkspaceMutationToken((current) => current + 1)
    void Promise.all([refreshWorkflowStats(), refreshUndoable()])
  }, [refreshUndoable, refreshWorkflowStats])

  const ensureChapterListLoaded = useCallback(async (): Promise<Chapter[]> => {
    if (chapters.length > 0) return chapters
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    return list
  }, [chapters, novelId, setChapters])

  const jumpToChapter = useCallback(async (chapterId: number) => {
    const list = await ensureChapterListLoaded()
    const target = list.find((chapter) => chapter.id === chapterId)
    if (!target) return
    navigate(`/novels/${novelId}/writing?chapterId=${chapterId}`)
    setChapterJumpOpen(false)
  }, [ensureChapterListLoaded, navigate, novelId])

  const performQuickSearch = useCallback(async (keyword: string) => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      setQuickSearchResults([])
      return
    }

    setQuickSearchLoading(true)
    try {
      const chapterList = await ensureChapterListLoaded()
      const [threadPage, timelineRows, characterRows, itemRows, mapRows] = await Promise.all([
        window.electron.thread.query({ novelId, keyword: trimmed, page: 1, pageSize: 6 }),
        window.electron.timeline.search(novelId, trimmed, 6),
        window.electron.character.search(novelId, trimmed, 6),
        window.electron.item.search(novelId, trimmed, undefined, 6),
        window.electron.map.searchNodes(novelId, trimmed, 6),
      ])

      const chapterRows = chapterList
        .filter((chapter) => {
          const haystack = [
            `第${chapter.chapterNum}章`,
            chapter.title || '',
            chapter.summary || '',
            chapter.outline || '',
          ].join(' ')
          return haystack.toLowerCase().includes(trimmed.toLowerCase())
        })
        .slice(0, 6)

      const results: WorkspaceSearchResult[] = [
        ...chapterRows.map((chapter) => ({
          id: `chapter-${chapter.id}`,
          type: 'chapter' as const,
          label: `第 ${chapter.chapterNum} 章 ${chapter.title || ''}`.trim(),
          description: chapter.summary || chapter.outline || '跳到正文写作页',
          route: `/novels/${novelId}/writing?chapterId=${chapter.id}`,
        })),
        ...threadPage.items.map((thread) => ({
          id: `thread-${thread.id}`,
          type: 'thread' as const,
          label: thread.title,
          description: thread.summary || thread.currentState || '跳到故事线程页',
          route: `/novels/${novelId}/threads?threadId=${thread.id}&action=edit`,
        })),
        ...timelineRows.map((event) => ({
          id: `timeline-${event.id}`,
          type: 'timeline' as const,
          label: event.eventTitle,
          description: event.eventSummary || event.eventResult || event.timeLabel,
          route: `/novels/${novelId}/timeline?eventId=${event.id}`,
        })),
        ...characterRows.map((character) => ({
          id: `character-${character.id}`,
          type: 'character' as const,
          label: character.fullName,
          description: character.background || character.goals || '跳到角色页',
          route: `/novels/${novelId}/characters?characterId=${character.id}`,
        })),
        ...itemRows.map((item) => ({
          id: `item-${item.id}`,
          type: 'item' as const,
          label: item.itemName,
          description: item.summary || item.plotFunction || '跳到物品页',
          route: `/novels/${novelId}/items?itemId=${item.id}`,
        })),
        ...mapRows.map((node) => ({
          id: `map-${node.id}`,
          type: 'map' as const,
          label: node.name,
          description: node.description || node.plotRelevance || '跳到地图页',
          route: `/novels/${novelId}/map?nodeId=${node.id}`,
        })),
      ]

      setQuickSearchResults(results.slice(0, 24))
    } finally {
      setQuickSearchLoading(false)
    }
  }, [ensureChapterListLoaded, novelId])

  const filteredChapterResults = useMemo(() => {
    const normalized = chapterJumpKeyword.trim().toLowerCase()
    return chapters.filter((chapter) => {
      if (!normalized) return true
      const haystack = [`第${chapter.chapterNum}章`, chapter.title || '', chapter.summary || '']
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalized)
    })
  }, [chapterJumpKeyword, chapters])

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
      resetWorkspace()
    }
  }, [navigate, novelId, resetWorkspace, setCurrentNovel])

  useEffect(() => {
    void refreshWorkflowStats()
  }, [location.pathname, refreshWorkflowStats])

  useEffect(() => {
    void refreshUndoable()
  }, [location.pathname, refreshUndoable])

  useEffect(() => {
    if (!quickSearchOpen) return undefined
    const timer = window.setTimeout(() => {
      void performQuickSearch(quickSearchKeyword)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [performQuickSearch, quickSearchKeyword, quickSearchOpen])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      const editable = isEditableTarget(event.target)

      if (key === 'escape') {
        if (quickSearchOpen) {
          event.preventDefault()
          setQuickSearchOpen(false)
          return
        }
        if (chapterJumpOpen) {
          event.preventDefault()
          setChapterJumpOpen(false)
          return
        }
        if (shortcutHelpOpen) {
          event.preventDefault()
          setShortcutHelpOpen(false)
          return
        }
        escapeHandlerRef.current?.()
        return
      }

      if (editable && !isMeta) {
        return
      }

      if (isMeta && key === 's') {
        event.preventDefault()
        saveHandlerRef.current?.()
        return
      }

      if (isMeta && key === 'f') {
        event.preventDefault()
        setQuickSearchOpen(true)
        return
      }

      if (isMeta && key === 'g') {
        event.preventDefault()
        void ensureChapterListLoaded().then(() => setChapterJumpOpen(true)).catch(console.error)
        return
      }

      if (isMeta && (key === 'arrowleft' || key === 'arrowright')) {
        event.preventDefault()
        void ensureChapterListLoaded().then((list) => {
          const currentId = currentChapterId || Number(new URLSearchParams(location.search).get('chapterId'))
          const currentIndex = list.findIndex((chapter) => chapter.id === currentId)
          if (currentIndex < 0) return
          const nextIndex = key === 'arrowleft' ? currentIndex - 1 : currentIndex + 1
          const nextChapter = list[nextIndex]
          if (nextChapter) {
            navigate(`/novels/${novelId}/writing?chapterId=${nextChapter.id}`)
          }
        }).catch(console.error)
        return
      }

      if (!editable && event.key === '?') {
        event.preventDefault()
        setShortcutHelpOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    chapterJumpOpen,
    currentChapterId,
    ensureChapterListLoaded,
    location.search,
    navigate,
    novelId,
    quickSearchOpen,
    shortcutHelpOpen,
  ])

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
    <WorkspaceErrorBoundary resetKey={`${novelId}:${location.pathname}`}>
      <NovelWorkspaceActionsProvider value={{
        mutationToken: workspaceMutationToken,
        registerSaveHandler,
        registerEscapeHandler,
        notifyWorkspaceMutation,
      }}>
      <div className="novel-route-shell novel-route-shell--single">
      <aside className="novel-route-shell__sidebar">
        <div className="novel-sidebar__title-block">
          <div className="novel-sidebar__eyebrow">小说工作台</div>
          <div className="novel-sidebar__title-row">
            <h1 className="novel-sidebar__title">{currentNovel?.title || '未命名小说'}</h1>
            <span className="novel-sidebar__title-meta">{`${workspaceReadyCount}/${workspaceTotalCount}`}</span>
          </div>
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
              <Button icon={<SearchOutlined />} onClick={() => setQuickSearchOpen(true)}>
                全局搜索
              </Button>
              <Button icon={<QuestionCircleOutlined />} onClick={() => setShortcutHelpOpen(true)}>
                快捷键
              </Button>
              <Button onClick={() => void ensureChapterListLoaded().then(() => setChapterJumpOpen(true)).catch(console.error)}>
                跳转章节
              </Button>
              <Button
                icon={<RollbackOutlined />}
                disabled={!latestUndoable}
                onClick={() => {
                  if (!latestUndoable) return
                  void window.electron.history.undo(latestUndoable.id)
                    .then(() => {
                      message.success(getUserFacingMessage('common.undoSucceeded', { summary: latestUndoable.summary }))
                      notifyWorkspaceMutation()
                    })
                    .catch((error) => {
                      console.error(error)
                      message.error(getErrorMessage(error, 'common.undoFailed'))
                    })
                }}
              >
                撤销最近操作
              </Button>
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
              <Route path="factions" element={<Factions novelId={novelId} />} />
              <Route path="characters" element={<Characters novelId={novelId} />} />
              <Route path="items" element={<ItemsWorkspace novelId={novelId} />} />
              <Route path="glossary" element={<Glossary novelId={novelId} />} />
              <Route path="threads" element={<StoryThreadsPage novelId={novelId} />} />
              <Route path="scene-templates" element={<SceneTemplates novelId={novelId} />} />
              <Route path="story-design" element={<CoreSettings novelId={novelId} />} />
              <Route path="outline" element={<Outline novelId={novelId} />} />
              <Route path="structure" element={<Structure novelId={novelId} />} />
              <Route path="timeline" element={<TimelinePage novelId={novelId} />} />
              <Route path="writing" element={<Writing novelId={novelId} />} />
              <Route path="revision" element={<RevisionCenterPage novelId={novelId} />} />
              <Route path="quality" element={<QualityDashboard novelId={novelId} />} />
              <Route path="*" element={<Navigate replace to={`/novels/${novelId}/${recommendedKey}`} />} />
            </Routes>
          </div>
        </div>
      </main>
      </div>
      <Modal
        title="工作区搜索"
        open={quickSearchOpen}
        footer={null}
        onCancel={() => setQuickSearchOpen(false)}
      >
        <Input
          autoFocus
          value={quickSearchKeyword}
          onChange={(event) => setQuickSearchKeyword(event.target.value)}
          placeholder="搜索章节、线程、时间轴、角色、物品或地点"
        />
        <div className="novel-note-list" style={{ marginTop: 16 }}>
          {quickSearchLoading ? <Spin size="small" /> : null}
          {!quickSearchLoading && quickSearchResults.length === 0 ? (
            <div className="novel-note-list__item">输入关键词后会在整个 Novel 工作区里搜索。</div>
          ) : null}
          {quickSearchResults.map((result) => (
            <button
              key={result.id}
              type="button"
              className="novel-sidebar__nav-item"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => {
                navigate(result.route)
                setQuickSearchOpen(false)
              }}
            >
              <span className="novel-sidebar__nav-copy">
                <strong>{result.label}</strong>
                <small>{`${result.type} · ${result.description}`}</small>
              </span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        title="章节跳转"
        open={chapterJumpOpen}
        footer={null}
        onCancel={() => setChapterJumpOpen(false)}
      >
        <Input
          autoFocus
          value={chapterJumpKeyword}
          onChange={(event) => setChapterJumpKeyword(event.target.value)}
          placeholder="按章节号或标题筛选"
        />
        <div className="novel-note-list" style={{ marginTop: 16 }}>
          {filteredChapterResults.slice(0, 20).map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className="novel-sidebar__nav-item"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => void jumpToChapter(chapter.id)}
            >
              <span className="novel-sidebar__nav-copy">
                <strong>{`第 ${chapter.chapterNum} 章 ${chapter.title || ''}`.trim()}</strong>
                <small>{chapter.summary || chapter.outline || '跳到正文写作页'}</small>
              </span>
            </button>
          ))}
          {filteredChapterResults.length === 0 ? (
            <div className="novel-note-list__item">当前没有匹配章节。</div>
          ) : null}
        </div>
      </Modal>
      <Modal
        title="工作区快捷键"
        open={shortcutHelpOpen}
        footer={null}
        onCancel={() => setShortcutHelpOpen(false)}
      >
        <div className="novel-note-list">
          <div className="novel-note-list__item">`Ctrl/Cmd+S`：保存当前页可保存内容</div>
          <div className="novel-note-list__item">`Ctrl/Cmd+F`：打开工作区搜索</div>
          <div className="novel-note-list__item">`Ctrl/Cmd+G`：打开章节跳转</div>
          <div className="novel-note-list__item">`Ctrl/Cmd+←/→`：上一章 / 下一章</div>
          <div className="novel-note-list__item">`Esc`：关闭当前弹窗或清空批量选择</div>
          <div className="novel-note-list__item">`?`：打开这份快捷键面板</div>
          <div className="novel-note-list__item">正文写作页额外支持 `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` 本地撤销重做。</div>
        </div>
      </Modal>
      </NovelWorkspaceActionsProvider>
    </WorkspaceErrorBoundary>
  )
}
