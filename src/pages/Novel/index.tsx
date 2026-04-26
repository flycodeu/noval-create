import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Dropdown, Input, Modal, Spin, message } from 'antd'
import type { MenuProps } from 'antd'
import { getErrorMessage, getUserFacingMessage, isUserFacingMessage } from '@/utils/user-facing-message'
import {
  BarChartOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  LeftOutlined,
  RightOutlined,
  RollbackOutlined,
  SearchOutlined,
  QuestionCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import ProjectSidebar from '../../components/novel/layout/ProjectSidebar'
import ProjectTopbar from '../../components/novel/layout/ProjectTopbar'
import { useNovelStore } from '../../stores/novel.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  ALL_WORKSPACE_ROUTE_KEYS,
  WORKSPACE_MODULE_DEFINITIONS,
  getWorkspaceNavKey,
  getWorkspaceSnapshot,
  type WorkspaceRouteKey,
  type WorkspaceViewMode,
} from '../../shared/novel-workspace'
import StudioPage from './Studio'
import Overview from './Overview'
import PremisePage from './Premise'
import CoreSettings from './CoreSettings'
import ProjectBriefPage from './ProjectBrief'
import ThemeVoicePage from './ThemeVoice'
import WorldRules from './WorldRules'
import EndgamePage from './Endgame'
import Factions from './Factions'
import MapExplorer from './MapExplorer'
import Characters from './Characters'
import CharacterArcCenterPage from './CharacterArcCenter'
import ResistancePage from './Resistance'
import Glossary from './Glossary'
import ItemsWorkspace from './ItemsWorkspace'
import SceneTemplates from './SceneTemplates'
import StoryThreadsPage from './StoryThreads'
import Outline from './Outline'
import VolumeDesignPage from './VolumeDesign'
import ContractsPage from './Contracts'
import Structure from './Structure'
import TimelinePage from './Timeline'
import Writing from './Writing'
import WritebackCenterPage from './WritebackCenter'
import RevisionCenterPage from './RevisionCenter'
import QualityDashboard from './QualityDashboard'
import BatchWorkbenchPage from './BatchWorkbench'
import InfoGapBoardPage from './InfoGapBoard'
import ForeshadowLedgerPage from './ForeshadowLedger'
import GrowthSystemPage from './GrowthSystem'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary'
import WorkspaceAIQualityBoard from './components/WorkspaceAIQualityBoard'
import {
  EMPTY_WORKFLOW_STATS,
  loadWorkflowStats,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from './workflow'
import { NovelWorkspaceActionsProvider } from './workspace-shortcuts'
import {
  NovelWorkspaceQualityProvider,
  type RegisteredWorkspaceQualityController,
} from './workspace-quality-context'
import type { Chapter, OperationLog } from '../../types'

type ProWorkspaceKey = WorkspaceRouteKey

interface WorkspaceSearchResult {
  id: string
  type: 'chapter' | 'thread' | 'timeline' | 'character' | 'item' | 'map'
  label: string
  description: string
  route: string
}

const LEGACY_ROUTE_REDIRECTS: Record<GuidedWorkflowStepKey, ProWorkspaceKey> = {
  basics: 'overview',
  'project-brief': 'project-brief',
  'story-core': 'core-settings',
  'theme-voice': 'theme-voice',
  'world-foundation': 'world-rules',
  'endgame-design': 'endgame',
  'map-structure': 'map',
  'character-roster': 'characters',
  'items-equipment': 'items',
  'story-threads': 'threads',
  'story-plot': 'story-design',
  'volume-planning': 'structure',
  'write-start': 'writing',
}

const WORKSPACE_VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const WORKSPACE_PAGE_META = new Map(WORKSPACE_MODULE_DEFINITIONS.map((item) => [item.key, item] as const))

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
  const clearHandlerRef = useRef<(() => void) | null>(null)
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
  const [hasRegisteredClearHandler, setHasRegisteredClearHandler] = useState(false)
  const [qualityBoardOpen, setQualityBoardOpen] = useState(false)
  const [workspaceQualityController, setWorkspaceQualityController] = useState<RegisteredWorkspaceQualityController | null>(null)
  const [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>(() => {
    const stored = typeof localStorage !== 'undefined'
      ? localStorage.getItem(WORKSPACE_VIEW_MODE_STORAGE_KEY)
      : null
    return stored === 'quick' || stored === 'professional' ? stored : 'professional'
  })

  const novelId = Number.parseInt(id || '0', 10)
  const pathSegments = location.pathname.split('/').filter(Boolean)
  const pathSegment = pathSegments[2] || ''
  const legacyRouteTarget = useMemo(
    () => (
      Object.prototype.hasOwnProperty.call(LEGACY_ROUTE_REDIRECTS, pathSegment)
        ? LEGACY_ROUTE_REDIRECTS[pathSegment as GuidedWorkflowStepKey]
        : null
    ),
    [pathSegment],
  )

  const currentPage = useMemo<ProWorkspaceKey>(() => {
    if (ALL_WORKSPACE_ROUTE_KEYS.includes(pathSegment as WorkspaceRouteKey)) {
      return pathSegment as ProWorkspaceKey
    }

    return 'guide'
  }, [pathSegment])
  const currentChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === currentChapterId) || null,
    [chapters, currentChapterId],
  )
  const workspaceSnapshot = useMemo(
    () => getWorkspaceSnapshot(currentNovel, workflowStats, { viewMode: workspaceViewMode }),
    [currentNovel, workflowStats, workspaceViewMode],
  )
  const recommendedRoute = useMemo(
    () => (workspaceSnapshot.nextStep.targetPage === 'writing'
      ? 'writing/editor'
      : workspaceSnapshot.nextStep.targetPage),
    [workspaceSnapshot.nextStep.targetPage],
  )
  const currentNavKey = useMemo(
    () => getWorkspaceNavKey(currentPage, location.search),
    [currentPage, location.search],
  )
  const orderedPages = useMemo<ProWorkspaceKey[]>(
    () => ['guide', ...workspaceSnapshot.modules.map((item) => item.key)],
    [workspaceSnapshot.modules],
  )
  const currentPageIndex = useMemo(
    () => orderedPages.findIndex((item) => item === currentPage),
    [currentPage, orderedPages],
  )
  const resolvePageMeta = useCallback((pageKey: ProWorkspaceKey) => {
    if (pageKey === 'guide') {
      return {
        key: 'guide' as const,
        label: '创作总控台',
        summary: '总览当前阶段、blocker 和推荐下一步。',
        route: 'guide',
      }
    }

    const meta = WORKSPACE_PAGE_META.get(pageKey)
    return {
      key: pageKey,
      label: meta?.label || pageKey,
      summary: meta?.description || '',
      route: pageKey === 'writing' ? 'writing/editor' : pageKey,
    }
  }, [])
  const currentPageMeta = useMemo(
    () => resolvePageMeta(currentPage),
    [currentPage, resolvePageMeta],
  )
  const previousPageMeta = currentPageIndex > 0
    ? resolvePageMeta(orderedPages[currentPageIndex - 1])
    : null
  const nextPageMeta = currentPageIndex >= 0 && currentPageIndex < orderedPages.length - 1
    ? resolvePageMeta(orderedPages[currentPageIndex + 1])
    : null

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

  const handleWorkspaceExport = useCallback(async (format: string) => {
    try {
      const filePath = await window.electron.novel.export(novelId, format)
      message.success(getUserFacingMessage('novel.exportedTo', { path: filePath }))
    } catch (error) {
      if (!isUserFacingMessage(error, 'common.userCancelled')) {
        message.error(getErrorMessage(error, 'novel.exportFailed'))
      }
    }
  }, [novelId])

  const registerSaveHandler = useCallback((handler: (() => void) | null) => {
    saveHandlerRef.current = handler
  }, [])

  const registerClearHandler = useCallback((handler: (() => void) | null) => {
    clearHandlerRef.current = handler
    setHasRegisteredClearHandler(Boolean(handler))
  }, [])

  const registerEscapeHandler = useCallback((handler: (() => void) | null) => {
    escapeHandlerRef.current = handler
  }, [])

  const notifyWorkspaceMutation = useCallback(() => {
    setWorkspaceMutationToken((current) => current + 1)
    void Promise.all([refreshWorkflowStats(), refreshUndoable()])
  }, [refreshUndoable, refreshWorkflowStats])
  const registerWorkspaceQualityController = useCallback((controller: RegisteredWorkspaceQualityController | null) => {
    setWorkspaceQualityController(controller)
    return () => {
      setWorkspaceQualityController((current) => (current === controller ? null : current))
    }
  }, [])

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
    navigate(`/novels/${novelId}/writing/editor?chapterId=${chapterId}`)
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
          route: `/novels/${novelId}/writing/editor?chapterId=${chapter.id}`,
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKSPACE_VIEW_MODE_STORAGE_KEY, workspaceViewMode)
    }
  }, [workspaceViewMode])

  useEffect(() => {
    if (!currentNovel || typeof localStorage === 'undefined') return
    if (localStorage.getItem(WORKSPACE_VIEW_MODE_STORAGE_KEY)) return
    if (currentNovel.launchMode === 'fast_launch') {
      setWorkspaceViewMode('quick')
    }
  }, [currentNovel, setWorkspaceViewMode])

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
            navigate(`/novels/${novelId}/writing/editor?chapterId=${nextChapter.id}`)
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

    const validPath = ALL_WORKSPACE_ROUTE_KEYS.includes(pathSegment as WorkspaceRouteKey)
    if (!validPath) {
      navigate(`/novels/${novelId}/${recommendedRoute}`, { replace: true })
    }
  }, [legacyRouteTarget, loading, navigate, novelId, pathSegment, recommendedRoute])

  useEffect(() => {
    setQualityBoardOpen(false)
  }, [currentPage])

  const workspaceQuality = useMemo(() => ({
    controller: workspaceQualityController,
    registerController: registerWorkspaceQualityController,
  }), [registerWorkspaceQualityController, workspaceQualityController])

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
        registerClearHandler,
        registerEscapeHandler,
        notifyWorkspaceMutation,
      }}>
      <NovelWorkspaceQualityProvider value={workspaceQuality}>
      <div className="novel-route-shell novel-route-shell--single">
      <aside className="novel-route-shell__sidebar">
        <ProjectSidebar
          title={currentNovel?.title || '未命名小说'}
          stageLabel={workspaceSnapshot.stage.label}
          progressText={`${workspaceSnapshot.moduleDoneCount}/${workspaceSnapshot.moduleTotalCount}`}
          currentTask={workspaceSnapshot.nextStep.title}
          navGroups={workspaceSnapshot.navGroups}
          activeKey={currentNavKey}
          mode={workspaceViewMode}
          onModeChange={setWorkspaceViewMode}
          onNavigate={(route) => navigate(`/novels/${novelId}/${route}`)}
        />
      </aside>

      <main className="novel-route-shell__content">
        <div className="novel-route-shell__content-frame">
          <ProjectTopbar
            pageTitle={currentPageMeta.label}
            onBack={() => navigate('/novels')}
            onSearch={() => setQuickSearchOpen(true)}
            onQuality={() => setQualityBoardOpen(true)}
            onNextStep={() => navigate(`/novels/${novelId}/${recommendedRoute}`)}
            nextStepLabel="推荐下一步"
            showQuality={currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'batch-workbench'}
            showNextStep={currentPage !== workspaceSnapshot.nextStep.targetPage}
            moreMenu={{
              items: [
                hasRegisteredClearHandler ? {
                  key: 'clear',
                  icon: <DeleteOutlined />,
                  label: '清空当前步骤',
                  danger: true,
                  onClick: () => clearHandlerRef.current?.(),
                } : null,
                {
                  key: 'shortcuts',
                  icon: <QuestionCircleOutlined />,
                  label: '快捷键',
                  onClick: () => setShortcutHelpOpen(true),
                },
                {
                  key: 'jump-chapter',
                  label: '跳转章节',
                  onClick: () => void ensureChapterListLoaded().then(() => setChapterJumpOpen(true)).catch(console.error),
                },
                {
                  key: 'undo',
                  icon: <RollbackOutlined />,
                  label: '撤销最近操作',
                  disabled: !latestUndoable,
                  onClick: () => {
                    if (!latestUndoable) return
                    void window.electron.history.undo(latestUndoable.id)
                      .then(() => {
                        message.success(getUserFacingMessage('common.undoSucceeded', { summary: latestUndoable.summary }))
                        notifyWorkspaceMutation()
                      })
                      .catch((error: unknown) => {
                        console.error(error)
                        message.error(getErrorMessage(error, 'common.undoFailed'))
                      })
                  },
                },
                { type: 'divider' as const },
                {
                  key: 'export',
                  label: '导出',
                  children: [
                    {
                      key: 'export-txt',
                      label: '导出 TXT',
                      onClick: () => void handleWorkspaceExport('txt'),
                    },
                    {
                      key: 'export-md',
                      label: '导出 Markdown',
                      onClick: () => void handleWorkspaceExport('md'),
                    },
                    {
                      key: 'export-docx',
                      label: '导出 DOCX',
                      onClick: () => void handleWorkspaceExport('docx'),
                    },
                    {
                      key: 'export-epub',
                      label: '导出 EPUB',
                      onClick: () => void handleWorkspaceExport('epub'),
                    },
                  ],
                },
                {
                  key: 'settings',
                  label: '设置',
                  onClick: () => navigate(`/novels/${novelId}/overview`),
                },
                { type: 'divider' as const },
                {
                  key: 'prev',
                  icon: <LeftOutlined />,
                  label: `上一步${previousPageMeta ? `：${previousPageMeta.label}` : ''}`,
                  disabled: !previousPageMeta,
                  onClick: () => previousPageMeta && navigate(`/novels/${novelId}/${previousPageMeta.route}`),
                },
                {
                  key: 'next',
                  icon: <RightOutlined />,
                  label: `下一步${nextPageMeta ? `：${nextPageMeta.label}` : ''}`,
                  disabled: !nextPageMeta,
                  onClick: () => nextPageMeta && navigate(`/novels/${novelId}/${nextPageMeta.route}`),
                },
              ].filter(Boolean) as MenuProps['items'],
            }}
          />

          <div className="novel-route-shell__content-body">
            <Routes>
              <Route path="basics" element={<Navigate replace to={`/novels/${novelId}/overview`} />} />
              <Route path="story-core" element={<Navigate replace to={`/novels/${novelId}/core-settings`} />} />
              <Route path="world-foundation" element={<Navigate replace to={`/novels/${novelId}/world-rules`} />} />
              <Route path="endgame-design" element={<Navigate replace to={`/novels/${novelId}/endgame`} />} />
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
              <Route path="endgame" element={<EndgamePage novelId={novelId} />} />
              <Route path="map" element={<MapExplorer novelId={novelId} />} />
              <Route path="factions" element={<Factions novelId={novelId} />} />
              <Route path="characters" element={<Characters novelId={novelId} />} />
              <Route path="arc-center" element={<CharacterArcCenterPage novelId={novelId} />} />
              <Route path="resistance" element={<ResistancePage novelId={novelId} />} />
              <Route path="items" element={<ItemsWorkspace novelId={novelId} />} />
              <Route path="glossary" element={<Glossary novelId={novelId} />} />
              <Route path="threads" element={<StoryThreadsPage novelId={novelId} />} />
              <Route path="scene-templates" element={<SceneTemplates novelId={novelId} />} />
              <Route path="story-design" element={<CoreSettings novelId={novelId} />} />
              <Route path="outline" element={<Outline novelId={novelId} />} />
              <Route path="volume-design" element={<VolumeDesignPage novelId={novelId} />} />
              <Route path="contracts" element={<ContractsPage novelId={novelId} />} />
              <Route path="structure" element={<Structure novelId={novelId} />} />
              <Route path="timeline" element={<TimelinePage novelId={novelId} />} />
              <Route path="info-gap-board" element={<InfoGapBoardPage novelId={novelId} />} />
              <Route path="foreshadow-ledger" element={<ForeshadowLedgerPage novelId={novelId} />} />
              <Route path="growth-system" element={<GrowthSystemPage novelId={novelId} />} />
              <Route path="writing/*" element={<Writing novelId={novelId} />} />
              <Route path="writeback" element={<WritebackCenterPage novelId={novelId} />} />
              <Route path="batch-workbench" element={<BatchWorkbenchPage novelId={novelId} />} />
              <Route path="revision" element={<RevisionCenterPage novelId={novelId} />} />
              <Route path="quality" element={<QualityDashboard novelId={novelId} />} />
              <Route path="*" element={<Navigate replace to={`/novels/${novelId}/${recommendedRoute}`} />} />
            </Routes>
          </div>
        </div>
      </main>
      </div>
      {currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'writeback' && currentPage !== 'batch-workbench' ? (
        <WorkspaceAIQualityBoard
          open={qualityBoardOpen}
          onClose={() => setQualityBoardOpen(false)}
          workspaceKey={currentPage as Exclude<ProWorkspaceKey, 'guide' | 'quality' | 'writeback' | 'batch-workbench'>}
          workspaceLabel={currentPageMeta?.label || currentPage}
          workspaceSummary={currentPageMeta?.summary || ''}
          novelId={novelId}
          currentNovel={currentNovel}
          currentChapter={currentChapter}
          controller={workspaceQualityController}
          onApplied={notifyWorkspaceMutation}
        />
      ) : null}
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
      </NovelWorkspaceQualityProvider>
      </NovelWorkspaceActionsProvider>
    </WorkspaceErrorBoundary>
  )
}
