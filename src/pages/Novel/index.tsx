import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams, type NavigateOptions } from 'react-router-dom'
import { Alert, Button, Drawer, Input, Modal, Spin, message } from 'antd'
import type { MenuProps } from 'antd'
import { getErrorMessage, getUserFacingMessage, isUserFacingMessage } from '@/utils/user-facing-message'
import { isElectronRuntime } from '../../runtime/environment'
import {
  LeftOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons'
import ProjectSidebar from '../../components/novel/layout/ProjectSidebar'
import ProjectTopbar from '../../components/novel/layout/ProjectTopbar'
import { useNovelStore } from '../../stores/novel.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  ALL_WORKSPACE_ROUTE_KEYS,
  buildWorkspaceRoute,
  WORKSPACE_MODULE_DEFINITIONS,
  getWorkspaceNavKey,
  getWorkspaceSnapshot,
  type WorkspaceRouteKey,
  type WorkspaceViewMode,
} from '../../shared/novel-workspace'
import { getWorkspaceViewModeForNovel } from '../../shared/operating-mode'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary'
import WorkspaceAIQualityBoard from './components/WorkspaceAIQualityBoard'
import WorkspaceChatAssistant from './components/WorkspaceChatAssistant'
import {
  EMPTY_WORKFLOW_STATS,
  loadWorkflowStats,
  type GuidedWorkflowStepKey,
  type WorkflowStats,
} from './workflow'
import { NovelWorkspaceActionsProvider } from './workspace-shortcuts'
import {
  NovelWorkspaceQualityProvider,
} from './workspace-quality-context'
import type { RegisteredWorkspaceQualityController } from './workspace-quality-context-core'
import type { Chapter, ChapterQualityAnalysisStatus, OperationLog, PlatformFormat, PlatformFormatResult, PlatformFormatScope } from '../../types'
import { readBrowserStorage, writeBrowserStorage } from '../../utils/browser-storage'

type ProWorkspaceKey = WorkspaceRouteKey
interface WorkspaceStageProps {
  novelId: number
}

type WorkspaceStageModule = {
  default: React.ComponentType<WorkspaceStageProps>
}

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
  'resistance-system': 'resistance',
  'story-threads': 'threads',
  'story-plot': 'story-design',
  'volume-planning': 'volume-design',
  'outline-structure': 'outline',
  'timeline-causality': 'timeline',
  'write-start': 'writing',
}

const WORKSPACE_VIEW_MODE_STORAGE_KEY = 'novelforge-workbench-view-mode'
const WORKSPACE_RECENT_PAGE_STORAGE_KEY = 'novelforge-workspace-recent-page'
const WORKSPACE_LAST_WRITING_VIEW_STORAGE_KEY = 'novelforge-workspace-last-writing-view'
const WORKSPACE_ASSISTANT_OPEN_STORAGE_KEY = 'novelforge-workspace-assistant-open'
const WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY = 'novelforge-workspace-assistant-width'
const WORKSPACE_PAGE_META = new Map(WORKSPACE_MODULE_DEFINITIONS.map((item) => [item.key, item] as const))
const WORKSPACE_PREWARM_DELAY_MS = 140
const MAX_IDLE_PREWARM_ROUTES = 4
const COMPACT_SHELL_BREAKPOINT = 1200
const COMPACT_SHELL_MEDIA_QUERY = `(max-width: ${COMPACT_SHELL_BREAKPOINT - 1}px)`
const WORKSPACE_ASSISTANT_DEFAULT_WIDTH = 380
const WORKSPACE_ASSISTANT_MIN_WIDTH = 320
const WORKSPACE_ASSISTANT_MAX_WIDTH = 680
const WORKSPACE_CONTENT_MIN_WIDTH = 720
const WORKSPACE_SIDEBAR_WIDTH = 292

const WORKSPACE_STAGE_LOADERS = {
  guide: () => import('./Studio'),
  overview: () => import('./Overview'),
  'project-brief': () => import('./ProjectBrief'),
  'core-settings': () => import('./Premise'),
  'theme-voice': () => import('./ThemeVoice'),
  'style-lab': () => import('./StyleLab'),
  'world-rules': () => import('./WorldRules'),
  endgame: () => import('./Endgame'),
  map: () => import('./MapExplorer'),
  factions: () => import('./Factions'),
  characters: () => import('./Characters'),
  'arc-center': () => import('./CharacterArcCenter'),
  resistance: () => import('./Resistance'),
  items: () => import('./ItemsWorkspace'),
  glossary: () => import('./Glossary'),
  threads: () => import('./StoryThreads'),
  'scene-templates': () => import('./SceneTemplates'),
  'story-design': () => import('./CoreSettings'),
  outline: () => import('./Outline'),
  'volume-design': () => import('./VolumeDesign'),
  'stage-planner': () => import('./StagePlanner'),
  contracts: () => import('./Contracts'),
  structure: () => import('./Structure'),
  timeline: () => import('./Timeline'),
  'info-gap-board': () => import('./InfoGapBoard'),
  'foreshadow-ledger': () => import('./ForeshadowLedger'),
  'growth-system': () => import('./GrowthSystem'),
  writing: () => import('./Writing'),
  writeback: () => import('./WritebackCenter'),
  'batch-workbench': () => import('./BatchWorkbench'),
  revision: () => import('./RevisionCenter'),
  quality: () => import('./QualityDashboard'),
} satisfies Record<ProWorkspaceKey, () => Promise<WorkspaceStageModule>>

const WORKSPACE_STAGE_COMPONENTS = Object.fromEntries(
  (Object.keys(WORKSPACE_STAGE_LOADERS) as ProWorkspaceKey[]).map((key) => [
    key,
    React.lazy(WORKSPACE_STAGE_LOADERS[key]),
  ]),
) as Record<ProWorkspaceKey, React.LazyExoticComponent<React.ComponentType<WorkspaceStageProps>>>

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

function parseStoredAssistantWidth(): number {
  const stored = Number(readBrowserStorage(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY))
  if (!Number.isFinite(stored)) return WORKSPACE_ASSISTANT_DEFAULT_WIDTH
  return stored
}

function clampAssistantWidth(width: number, shellWidth = typeof window === 'undefined' ? 1400 : window.innerWidth): number {
  const maxByViewport = Math.max(
    WORKSPACE_ASSISTANT_MIN_WIDTH,
    shellWidth - WORKSPACE_SIDEBAR_WIDTH - WORKSPACE_CONTENT_MIN_WIDTH,
  )
  const maxWidth = Math.min(WORKSPACE_ASSISTANT_MAX_WIDTH, maxByViewport)
  return Math.round(Math.min(Math.max(width, WORKSPACE_ASSISTANT_MIN_WIDTH), maxWidth))
}

const MemoWorkspaceStage = React.memo(({
  pageKey,
  novelId,
}: {
  pageKey: ProWorkspaceKey
  novelId: number
}) => {
  const WorkspaceStage = WORKSPACE_STAGE_COMPONENTS[pageKey]

  return (
    <React.Suspense fallback={(
      <div className="novel-route-shell__stage-loading">
        <Spin size="small" />
        <span>正在加载模块...</span>
      </div>
    )}
    >
      <WorkspaceStage novelId={novelId} />
    </React.Suspense>
  )
})

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
  const contentBodyRef = useRef<HTMLDivElement | null>(null)
  const routeShellRef = useRef<HTMLDivElement | null>(null)
  const quickSearchRequestRef = useRef(0)
  const batchAnalysisStartingRef = useRef(false)
  const assistantResizeCleanupRef = useRef<(() => void) | null>(null)
  const prefetchedPagesRef = useRef<Set<ProWorkspaceKey>>(new Set())
  const scrollPositionsRef = useRef<Partial<Record<ProWorkspaceKey, number>>>({})
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
  const [assistantOpen, setAssistantOpen] = useState<boolean>(() => (
    readBrowserStorage(WORKSPACE_ASSISTANT_OPEN_STORAGE_KEY) === '1'
  ))
  const [assistantWidth, setAssistantWidth] = useState<number>(() => clampAssistantWidth(parseStoredAssistantWidth()))
  const [isSidebarDrawerOpen, setIsSidebarDrawerOpen] = useState(false)
  const [platformCopyOpen, setPlatformCopyOpen] = useState(false)
  const [platformCopyResult, setPlatformCopyResult] = useState<PlatformFormatResult | null>(null)
  const [qualityAnalysisOpen, setQualityAnalysisOpen] = useState(false)
  const [qualityAnalysisTaskId, setQualityAnalysisTaskId] = useState<number | null>(null)
  const [qualityAnalysisStatus, setQualityAnalysisStatus] = useState<ChapterQualityAnalysisStatus | null>(null)
  const [isCompactShell, setIsCompactShell] = useState<boolean>(() => (
    typeof window !== 'undefined' ? window.innerWidth < COMPACT_SHELL_BREAKPOINT : false
  ))
  const [workspaceQualityController, setWorkspaceQualityController] = useState<RegisteredWorkspaceQualityController | null>(null)
  const [pendingPage, setPendingPage] = useState<ProWorkspaceKey | null>(null)
  const [batchAnalyzingChapters, setBatchAnalyzingChapters] = useState(false)
  const [workspaceViewMode, setWorkspaceViewMode] = useState<WorkspaceViewMode>(() => {
    const stored = readBrowserStorage(WORKSPACE_VIEW_MODE_STORAGE_KEY)
    return stored === 'quick' || stored === 'professional' ? stored : 'quick'
  })
  const showWindowControls = isElectronRuntime()

  const novelId = Number(id || 0)
  const hasValidNovelId = Number.isSafeInteger(novelId) && novelId > 0
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
    () => workspaceSnapshot.nextStep.targetPage,
    [workspaceSnapshot.nextStep.targetPage],
  )
  const currentNavKey = useMemo(
    () => getWorkspaceNavKey(currentPage, location.search),
    [currentPage, location.search],
  )
  const pendingNavKey = useMemo(() => {
    if (!pendingPage || pendingPage === currentPage) return null
    return pendingPage === 'guide' ? 'guide:overview' : pendingPage
  }, [currentPage, pendingPage])
  const recentNavKey = useMemo(() => {
    const stored = readBrowserStorage(WORKSPACE_RECENT_PAGE_STORAGE_KEY)
    return stored && stored !== currentNavKey ? stored : null
  }, [currentNavKey])
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

  const resolveWorkspacePageKey = useCallback((routeOrPage: string | ProWorkspaceKey | null | undefined): ProWorkspaceKey | null => {
    if (!routeOrPage) return null
    if (routeOrPage === 'guide') return 'guide'
    if (ALL_WORKSPACE_ROUTE_KEYS.includes(routeOrPage as WorkspaceRouteKey)) {
      return routeOrPage as ProWorkspaceKey
    }

    const normalizedRoute = routeOrPage.replace(/^\/novels\/\d+\//, '').split('?')[0]
    const rootSegment = normalizedRoute.split('/').filter(Boolean)[0]
    if (!rootSegment) return null
    if (rootSegment === 'guide') return 'guide'
    return ALL_WORKSPACE_ROUTE_KEYS.includes(rootSegment as WorkspaceRouteKey)
      ? rootSegment as ProWorkspaceKey
      : null
  }, [])

  const warmWorkspacePage = useCallback((routeOrPage: string | ProWorkspaceKey | null | undefined) => {
    const pageKey = resolveWorkspacePageKey(routeOrPage)
    if (!pageKey) return
    if (prefetchedPagesRef.current.has(pageKey)) return
    prefetchedPagesRef.current.add(pageKey)
    void WORKSPACE_STAGE_LOADERS[pageKey]().catch((error) => {
      prefetchedPagesRef.current.delete(pageKey)
      console.error(error)
    })
  }, [resolveWorkspacePageKey])

  useEffect(() => {
    setPendingPage((current) => (current === currentPage ? null : current))
  }, [currentPage])

  useEffect(() => {
    setPendingPage(null)
    scrollPositionsRef.current = {}
  }, [novelId])

  useEffect(() => {
    if (loading) return undefined

    const routesToWarm = Array.from(new Set([
      recommendedRoute,
      nextPageMeta?.route,
      previousPageMeta?.route,
      currentPage === 'guide' ? workspaceSnapshot.groups[1]?.route : workspaceSnapshot.nextStep.targetPage,
    ].filter((route): route is string => Boolean(route))))
      .filter((route) => resolveWorkspacePageKey(route) !== currentPage)
      .slice(0, MAX_IDLE_PREWARM_ROUTES)

    if (routesToWarm.length === 0) return undefined

    const timer = window.setTimeout(() => {
      routesToWarm.forEach((route) => warmWorkspacePage(route))
    }, WORKSPACE_PREWARM_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [
    currentPage,
    loading,
    nextPageMeta?.route,
    previousPageMeta?.route,
    recommendedRoute,
    workspaceSnapshot.groups,
    workspaceSnapshot.nextStep.targetPage,
    resolveWorkspacePageKey,
    warmWorkspacePage,
  ])

  const refreshWorkflowStats = useCallback(async () => {
    if (!hasValidNovelId) return

    try {
      setWorkflowStats(await loadWorkflowStats(novelId))
    } catch (error) {
      console.error(error)
    }
  }, [hasValidNovelId, novelId])

  const refreshUndoable = useCallback(async () => {
    if (!hasValidNovelId) return
    try {
      setLatestUndoable(await window.electron.history.getLatestUndoable(novelId))
    } catch (error) {
      console.error(error)
    }
  }, [hasValidNovelId, novelId])

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

  const copyPlatformText = useCallback(async (text: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      message.success(getUserFacingMessage('novel.platformCopySucceeded', { label }))
    } catch (error) {
      message.error(getErrorMessage(error, 'novel.platformCopyFailed'))
    }
  }, [])

  const handleCopyPlatformFormat = useCallback(async (
    scope: PlatformFormatScope,
    platform: PlatformFormat = 'fanqie',
    options: { batchSize?: number } = {},
  ) => {
    if (scope === 'currentChapter' && !currentChapter?.id) {
      message.warning(getUserFacingMessage('novel.platformCopySelectChapter'))
      return
    }
    try {
      const result = await window.electron.novel.formatForPlatform(novelId, {
        platform,
        scope,
        chapterId: currentChapter?.id,
        batchSize: options.batchSize,
      })
      if (result.batches.length > 1) {
        setPlatformCopyResult(result)
        setPlatformCopyOpen(true)
        message.success(getUserFacingMessage('novel.platformBatchGenerated', { count: result.batches.length }))
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(result.content)
      const warningText = result.warnings.length > 0 ? `；${result.warnings[0]}` : ''
      message.success(getUserFacingMessage('novel.platformBookCopied', {
        chapterCount: result.chapterCount,
        wordCount: result.wordCount,
        warning: warningText,
      }))
    } catch (error) {
      message.error(getErrorMessage(error, 'novel.platformCopyFailed'))
    }
  }, [currentChapter?.id, novelId])

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

  const transitionNavigate = useCallback((to: string, options?: NavigateOptions) => {
    startTransition(() => {
      navigate(to, options)
    })
  }, [navigate])

  const navigateWithinWorkspace = useCallback((route: string, options?: NavigateOptions) => {
    const pageKey = resolveWorkspacePageKey(route)
    if (pageKey && pageKey !== currentPage) {
      setPendingPage(pageKey)
    }
    warmWorkspacePage(route)

    transitionNavigate(buildWorkspaceRoute(novelId, route), options)
  }, [currentPage, novelId, resolveWorkspacePageKey, transitionNavigate, warmWorkspacePage])

  const notifyWorkspaceMutation = useCallback(() => {
    setWorkspaceMutationToken((current) => current + 1)
    void Promise.all([refreshWorkflowStats(), refreshUndoable()])
  }, [refreshUndoable, refreshWorkflowStats])
  const registerWorkspaceQualityController = useCallback((controller: RegisteredWorkspaceQualityController | null) => {
    setWorkspaceQualityController(controller)
    return () => {
      setWorkspaceQualityController((current: RegisteredWorkspaceQualityController | null) => (current === controller ? null : current))
    }
  }, [])

  const ensureChapterListLoaded = useCallback(async (): Promise<Chapter[]> => {
    if (chapters.length > 0) return chapters
    const list = await window.electron.chapter.list(novelId)
    setChapters(list)
    return list
  }, [chapters, novelId, setChapters])

  const handleSequentialChapterAnalysis = useCallback(async () => {
    if (batchAnalyzingChapters || batchAnalysisStartingRef.current) return
    batchAnalysisStartingRef.current = true
    setBatchAnalyzingChapters(true)
    try {
      const taskId = await window.electron.chapterBatch.startQualityAnalysis(novelId, {
        includeAiCheck: true,
        includePublishCheck: true,
      })
      setQualityAnalysisTaskId(taskId)
      setQualityAnalysisOpen(true)
      message.success(getUserFacingMessage('novel.chapterQualityQueueStarted', { taskId }))
      notifyWorkspaceMutation()
    } catch (error) {
      message.error(getErrorMessage(error, 'novel.chapterQualityQueueStartFailed'))
      batchAnalysisStartingRef.current = false
      setBatchAnalyzingChapters(false)
    }
  }, [batchAnalyzingChapters, notifyWorkspaceMutation, novelId])

  useEffect(() => {
    if (!qualityAnalysisTaskId) return undefined
    let disposed = false
    let requestInFlight = false
    const refresh = async () => {
      if (requestInFlight) return
      requestInFlight = true
      try {
        const status = await window.electron.chapterBatch.getQualityAnalysisStatus(qualityAnalysisTaskId)
        if (disposed) return
        setQualityAnalysisStatus(status)
        if (!status) {
          batchAnalysisStartingRef.current = false
          setBatchAnalyzingChapters(false)
          setQualityAnalysisTaskId(null)
          return
        }
        if (status && !['pending', 'running', 'cancel_requested'].includes(status.status)) {
          batchAnalysisStartingRef.current = false
          setBatchAnalyzingChapters(false)
          setQualityAnalysisTaskId(null)
          notifyWorkspaceMutation()
        }
      } catch (error) {
        if (!disposed) {
          console.error(error)
        }
      } finally {
        requestInFlight = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [notifyWorkspaceMutation, qualityAnalysisTaskId])

  const handleCancelQualityAnalysis = useCallback(async () => {
    if (!qualityAnalysisTaskId) return
    try {
      await window.electron.task.cancel(qualityAnalysisTaskId)
      message.info(getUserFacingMessage('novel.chapterQualityQueueStopRequested'))
    } catch (error) {
      message.error(getErrorMessage(error, 'novel.chapterQualityQueueStopFailed'))
    }
  }, [qualityAnalysisTaskId])

  const openWorkspaceQualityBoard = useCallback(() => {
    if (isCompactShell) {
      setAssistantOpen(false)
    }
    setQualityBoardOpen(true)
  }, [isCompactShell])

  const jumpToChapter = useCallback(async (chapterId: number) => {
    const list = await ensureChapterListLoaded()
    const target = list.find((chapter) => chapter.id === chapterId)
    if (!target) return
    transitionNavigate(buildWorkspaceRoute(novelId, `writing?chapterId=${chapterId}`))
    setChapterJumpOpen(false)
  }, [ensureChapterListLoaded, novelId, transitionNavigate])

  const performQuickSearch = useCallback(async (keyword: string, requestId: number) => {
    const trimmed = keyword.trim()
    if (!trimmed) {
      if (requestId === quickSearchRequestRef.current) {
        setQuickSearchResults([])
        setQuickSearchLoading(false)
      }
      return
    }

    if (requestId === quickSearchRequestRef.current) setQuickSearchLoading(true)
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
          route: buildWorkspaceRoute(novelId, `writing/editor?chapterId=${chapter.id}`),
        })),
        ...threadPage.items.map((thread) => ({
          id: `thread-${thread.id}`,
          type: 'thread' as const,
          label: thread.title,
          description: thread.summary || thread.currentState || '跳到故事线程页',
          route: buildWorkspaceRoute(novelId, `threads?threadId=${thread.id}&action=edit`),
        })),
        ...timelineRows.map((event) => ({
          id: `timeline-${event.id}`,
          type: 'timeline' as const,
          label: event.eventTitle,
          description: event.eventSummary || event.eventResult || event.timeLabel,
          route: buildWorkspaceRoute(novelId, `timeline?eventId=${event.id}`),
        })),
        ...characterRows.map((character) => ({
          id: `character-${character.id}`,
          type: 'character' as const,
          label: character.fullName,
          description: character.background || character.goals || '跳到角色页',
          route: buildWorkspaceRoute(novelId, `characters?characterId=${character.id}`),
        })),
        ...itemRows.map((item) => ({
          id: `item-${item.id}`,
          type: 'item' as const,
          label: item.itemName,
          description: item.summary || item.plotFunction || '跳到物品页',
          route: buildWorkspaceRoute(novelId, `items?itemId=${item.id}`),
        })),
        ...mapRows.map((node) => ({
          id: `map-${node.id}`,
          type: 'map' as const,
          label: node.name,
          description: node.description || node.plotRelevance || '跳到地图页',
          route: buildWorkspaceRoute(novelId, `map?nodeId=${node.id}`),
        })),
      ]

      if (requestId === quickSearchRequestRef.current) {
        setQuickSearchResults(results.slice(0, 24))
      }
    } catch (error) {
      if (requestId === quickSearchRequestRef.current) {
        console.error(error)
        setQuickSearchResults([])
        message.error(getErrorMessage(error, 'common.loadFailed'))
      }
    } finally {
      if (requestId === quickSearchRequestRef.current) setQuickSearchLoading(false)
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
    writeBrowserStorage(WORKSPACE_VIEW_MODE_STORAGE_KEY, workspaceViewMode)
  }, [workspaceViewMode])

  useEffect(() => {
    writeBrowserStorage(WORKSPACE_ASSISTANT_OPEN_STORAGE_KEY, assistantOpen ? '1' : '0')
  }, [assistantOpen])

  useEffect(() => {
    writeBrowserStorage(WORKSPACE_ASSISTANT_WIDTH_STORAGE_KEY, String(assistantWidth))
  }, [assistantWidth])

  useEffect(() => {
    writeBrowserStorage(WORKSPACE_RECENT_PAGE_STORAGE_KEY, currentNavKey)
    if (currentPage === 'writing') {
      const writingView = location.pathname.split('/').filter(Boolean)[4] || 'editor'
      writeBrowserStorage(WORKSPACE_LAST_WRITING_VIEW_STORAGE_KEY, writingView)
    }
  }, [currentNavKey, currentPage, location.pathname])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mediaQuery = window.matchMedia(COMPACT_SHELL_MEDIA_QUERY)
    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsCompactShell(event.matches)
    }

    handleChange(mediaQuery)
    const listener = (event: MediaQueryListEvent) => handleChange(event)
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || isCompactShell) return undefined

    const handleResize = () => {
      const shellWidth = routeShellRef.current?.getBoundingClientRect().width || window.innerWidth
      setAssistantWidth((current) => clampAssistantWidth(current, shellWidth))
    }

    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [isCompactShell])

  useEffect(() => {
    if (!currentNovel) return
    if (readBrowserStorage(WORKSPACE_VIEW_MODE_STORAGE_KEY)) return
    if (getWorkspaceViewModeForNovel(currentNovel) === 'quick') {
      setWorkspaceViewMode('quick')
    }
  }, [currentNovel, setWorkspaceViewMode])

  useEffect(() => {
    if (!hasValidNovelId) {
      setLoading(false)
      return
    }

    let alive = true
    setLoading(true)

    void window.electron.novel.get(novelId).then((novel) => {
      if (!alive) return

      if (novel) {
        setCurrentNovel(novel)
      } else {
        navigate('/novels')
      }

      setLoading(false)
    }).catch((error: unknown) => {
      if (!alive) return
      console.error(error)
      setLoading(false)
      message.error(getErrorMessage(error, 'common.loadFailed'))
      navigate('/novels', { replace: true })
    })

    return () => {
      alive = false
      resetWorkspace()
    }
  }, [hasValidNovelId, navigate, novelId, resetWorkspace, setCurrentNovel])

  useEffect(() => {
    void refreshWorkflowStats()
  }, [refreshWorkflowStats])

  useEffect(() => {
    void refreshUndoable()
  }, [refreshUndoable])

  useEffect(() => {
    const requestId = ++quickSearchRequestRef.current
    if (!quickSearchOpen) {
      setQuickSearchLoading(false)
      return undefined
    }
    const timer = window.setTimeout(() => {
      void performQuickSearch(quickSearchKeyword, requestId)
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
            transitionNavigate(buildWorkspaceRoute(novelId, `writing?chapterId=${nextChapter.id}`))
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
    novelId,
    quickSearchOpen,
    shortcutHelpOpen,
    transitionNavigate,
  ])

  useEffect(() => {
    if (loading || !novelId) return

    if (legacyRouteTarget && pathSegment !== legacyRouteTarget) {
      transitionNavigate(buildWorkspaceRoute(novelId, legacyRouteTarget), { replace: true })
      return
    }

    const validPath = ALL_WORKSPACE_ROUTE_KEYS.includes(pathSegment as WorkspaceRouteKey)
    if (!validPath) {
      transitionNavigate(buildWorkspaceRoute(novelId, recommendedRoute), { replace: true })
    }
  }, [legacyRouteTarget, loading, novelId, pathSegment, recommendedRoute, transitionNavigate])

  useEffect(() => {
    setQualityBoardOpen(false)
  }, [currentPage])

  useEffect(() => {
    if (!isCompactShell) return
    setIsSidebarDrawerOpen(false)
  }, [currentPage, isCompactShell])

  useEffect(() => {
    if (!isCompactShell && isSidebarDrawerOpen) {
      setIsSidebarDrawerOpen(false)
    }
  }, [isCompactShell, isSidebarDrawerOpen])

  useEffect(() => {
    const contentBody = contentBodyRef.current
    if (!contentBody) return undefined

    const nextScrollTop = scrollPositionsRef.current[currentPage] ?? 0
    const frame = window.requestAnimationFrame(() => {
      contentBody.scrollTo({ top: nextScrollTop, behavior: 'auto' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [currentPage])

  const handleContentBodyScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    scrollPositionsRef.current[currentPage] = event.currentTarget.scrollTop
  }, [currentPage])

  const handleAssistantResizeStart = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (isCompactShell) return
    assistantResizeCleanupRef.current?.()
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const shellRect = routeShellRef.current?.getBoundingClientRect()
    const shellRight = shellRect?.right ?? window.innerWidth
    const shellWidth = shellRect?.width ?? window.innerWidth

    document.body.classList.add('is-resizing-workspace-assistant')

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setAssistantWidth(clampAssistantWidth(shellRight - moveEvent.clientX, shellWidth))
    }
    const cleanup = () => {
      document.body.classList.remove('is-resizing-workspace-assistant')
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      if (assistantResizeCleanupRef.current === cleanup) assistantResizeCleanupRef.current = null
    }
    const handlePointerUp = () => cleanup()

    assistantResizeCleanupRef.current = cleanup
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
  }, [isCompactShell])

  useEffect(() => () => {
    assistantResizeCleanupRef.current?.()
  }, [])

  const workspaceQuality = useMemo(() => ({
    controller: workspaceQualityController,
    registerController: registerWorkspaceQualityController,
  }), [registerWorkspaceQualityController, workspaceQualityController])
  const statusTone = pendingPage && pendingPage !== currentPage
    ? 'processing'
    : currentPage === 'writing'
      ? 'warning'
      : 'default'
  const contextualChapter = currentPage === 'writing' ? currentChapter : null
  const sidebarStatusText = pendingPage && pendingPage !== currentPage
    ? `正在切换到 ${resolvePageMeta(pendingPage).label}`
    : `${workspaceSnapshot.stage.label} · 模块完成 ${workspaceSnapshot.moduleDoneCount}/${workspaceSnapshot.moduleTotalCount}`
  const sidebarContent = (
    <ProjectSidebar
      stageLabel={workspaceSnapshot.stage.label}
      progressText={`${workspaceSnapshot.moduleDoneCount}/${workspaceSnapshot.moduleTotalCount}`}
      currentTask={workspaceSnapshot.nextStep.title}
      navGroups={workspaceSnapshot.navGroups}
      activeKey={currentNavKey}
      pendingKey={pendingNavKey}
      recentKey={recentNavKey}
      onDismissDrawer={isCompactShell ? () => setIsSidebarDrawerOpen(false) : undefined}
      onPrefetchRoute={warmWorkspacePage}
      onNavigate={navigateWithinWorkspace}
    />
  )

  if (!hasValidNovelId) {
    return <Navigate to="/novels" replace />
  }

  if (loading || currentNovel?.id !== novelId) {
    return (
      <div className="novel-route-shell novel-route-shell--loading">
        <Spin size="large" />
      </div>
    )
  }

  return (
    <WorkspaceErrorBoundary resetKey={String(novelId)}>
      <NovelWorkspaceActionsProvider value={{
        mutationToken: workspaceMutationToken,
        registerSaveHandler,
        registerClearHandler,
        registerEscapeHandler,
        notifyWorkspaceMutation,
      }}>
      <NovelWorkspaceQualityProvider value={workspaceQuality}>
      <div
        ref={routeShellRef}
        className={`novel-route-shell novel-route-shell--single${isCompactShell ? ' novel-route-shell--compact' : ''}${assistantOpen && !isCompactShell ? ' novel-route-shell--assistant-open' : ''}`}
        style={{ '--novel-shell-assistant-width': `${assistantWidth}px` } as React.CSSProperties}
      >
      <ProjectTopbar
        projectTitle={currentNovel?.title || '未命名小说'}
        workspaceLabel={currentPageMeta.label}
        statusTone={statusTone}
        statusText={sidebarStatusText}
        mode={workspaceViewMode}
        onModeChange={setWorkspaceViewMode}
        onBack={() => transitionNavigate('/novels')}
        onToggleSidebar={isCompactShell ? () => setIsSidebarDrawerOpen(true) : undefined}
        sidebarToggleActive={isCompactShell ? isSidebarDrawerOpen : false}
        onClear={hasRegisteredClearHandler ? () => clearHandlerRef.current?.() : undefined}
        onJumpChapter={() => void ensureChapterListLoaded().then(() => setChapterJumpOpen(true)).catch(console.error)}
        onShortcuts={() => setShortcutHelpOpen(true)}
        onSearch={() => setQuickSearchOpen(true)}
        onQuality={openWorkspaceQualityBoard}
        onToggleAssistant={() => setAssistantOpen((current) => !current)}
        assistantToggleActive={assistantOpen}
        onUndo={latestUndoable
          ? () => {
              void window.electron.history.undo(latestUndoable.id)
                .then(() => {
                  message.success(getUserFacingMessage('common.undoSucceeded', { summary: latestUndoable.summary }))
                  notifyWorkspaceMutation()
                })
                .catch((error: unknown) => {
                  console.error(error)
                  message.error(getErrorMessage(error, 'common.undoFailed'))
                })
            }
          : undefined}
        canUndo={Boolean(latestUndoable)}
        onNextStep={() => navigateWithinWorkspace(recommendedRoute)}
        nextStepLabel="推荐下一步"
        exportMenu={{
          items: [
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
            {
              key: 'export-json',
              label: '导出 JSON',
              onClick: () => void handleWorkspaceExport('json'),
            },
            { type: 'divider' as const },
            {
              key: 'copy-fanqie-current',
              label: '复制当前章·番茄格式',
              disabled: !currentChapter,
              onClick: () => void handleCopyPlatformFormat('currentChapter', 'fanqie'),
            },
            {
              key: 'copy-fanqie-all',
              label: '复制全书·番茄格式',
              onClick: () => void handleCopyPlatformFormat('all', 'fanqie'),
            },
            {
              key: 'copy-fanqie-batch',
              label: '复制全书·番茄分批检查',
              onClick: () => void handleCopyPlatformFormat('all', 'fanqie', { batchSize: 20 }),
            },
            {
              key: 'copy-feilu-all',
              label: '复制全书·飞卢格式',
              onClick: () => void handleCopyPlatformFormat('all', 'feilu'),
            },
            {
              key: 'copy-qidian-all',
              label: '复制全书·起点格式',
              onClick: () => void handleCopyPlatformFormat('all', 'qidian'),
            },
            {
              key: 'copy-jjwxc-all',
              label: '复制全书·晋江格式',
              onClick: () => void handleCopyPlatformFormat('all', 'jjwxc'),
            },
            {
              key: 'copy-generic-all',
              label: '复制全书·通用格式',
              onClick: () => void handleCopyPlatformFormat('all', 'generic'),
            },
          ],
        }}
        showQuality={currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'writeback' && currentPage !== 'batch-workbench'}
        showNextStep={currentPage !== workspaceSnapshot.nextStep.targetPage}
        showWindowControls={showWindowControls}
        moreMenu={{
          items: [
            {
              key: 'settings',
              label: '设置',
              onClick: () => navigateWithinWorkspace('overview'),
            },
            {
              key: 'batch-analyze-chapters',
              label: batchAnalyzingChapters ? '逐章分析中...' : '逐章 AI 体检队列',
              disabled: batchAnalyzingChapters,
              onClick: () => void handleSequentialChapterAnalysis(),
            },
            { type: 'divider' as const },
            {
              key: 'prev',
              icon: <LeftOutlined />,
              label: `上一步${previousPageMeta ? `：${previousPageMeta.label}` : ''}`,
              disabled: !previousPageMeta,
              onClick: () => previousPageMeta && navigateWithinWorkspace(previousPageMeta.route),
            },
            {
              key: 'next',
              icon: <RightOutlined />,
              label: `下一步${nextPageMeta ? `：${nextPageMeta.label}` : ''}`,
              disabled: !nextPageMeta,
              onClick: () => nextPageMeta && navigateWithinWorkspace(nextPageMeta.route),
            },
          ].filter(Boolean) as MenuProps['items'],
        }}
      />
      {!isCompactShell ? (
        <aside className="novel-route-shell__sidebar">
          {sidebarContent}
        </aside>
      ) : null}

      <main className="novel-route-shell__content">
        <div className="novel-route-shell__content-frame">
          <div
            ref={contentBodyRef}
            className={`novel-route-shell__content-body${pendingPage && pendingPage !== currentPage ? ' is-transitioning' : ''}`}
            aria-busy={Boolean(pendingPage && pendingPage !== currentPage)}
            onScroll={handleContentBodyScroll}
          >
            <section
              key={`${novelId}:${currentPage}`}
              className={`novel-route-shell__page-stage is-active${currentPage === pendingPage ? ' is-pending' : ''}`}
            >
              <MemoWorkspaceStage pageKey={currentPage} novelId={novelId} />
            </section>
          </div>
        </div>
      </main>
      {!isCompactShell ? (
        <WorkspaceChatAssistant
          open={assistantOpen}
          compact={false}
          resizable
          width={assistantWidth}
          workspaceKey={currentPage}
          workspaceLabel={currentPageMeta?.label || currentPage}
          workspaceSummary={currentPageMeta?.summary || ''}
          novelId={novelId}
          currentNovel={currentNovel}
          currentChapter={contextualChapter}
          controller={workspaceQualityController}
          onClose={() => setAssistantOpen(false)}
          onResizeStart={handleAssistantResizeStart}
          onApplied={notifyWorkspaceMutation}
          onOpenQuality={currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'writeback' && currentPage !== 'batch-workbench'
            ? openWorkspaceQualityBoard
            : undefined}
        />
      ) : null}
      {!assistantOpen && !isCompactShell ? (
        <button
          type="button"
          className="novel-route-shell__assistant-tab"
          onClick={() => setAssistantOpen(true)}
          aria-label="展开 AI 助手"
          title="展开 AI 助手"
        >
          <RobotOutlined />
          <span>AI</span>
        </button>
      ) : null}
      </div>
      <Drawer
        placement="left"
        width={320}
        title={null}
        open={isCompactShell && isSidebarDrawerOpen}
        onClose={() => setIsSidebarDrawerOpen(false)}
        className="novel-route-shell__drawer"
        rootClassName="novel-route-shell__drawer-root"
        closeIcon={null}
      >
        {sidebarContent}
      </Drawer>
      {isCompactShell ? (
        <WorkspaceChatAssistant
          open={assistantOpen}
          compact
          workspaceKey={currentPage}
          workspaceLabel={currentPageMeta?.label || currentPage}
          workspaceSummary={currentPageMeta?.summary || ''}
          novelId={novelId}
          currentNovel={currentNovel}
          currentChapter={contextualChapter}
          controller={workspaceQualityController}
          onClose={() => setAssistantOpen(false)}
          onApplied={notifyWorkspaceMutation}
          onOpenQuality={currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'writeback' && currentPage !== 'batch-workbench'
            ? openWorkspaceQualityBoard
            : undefined}
        />
      ) : null}
      {currentPage !== 'guide' && currentPage !== 'quality' && currentPage !== 'writeback' && currentPage !== 'batch-workbench' ? (
        <WorkspaceAIQualityBoard
          open={qualityBoardOpen}
          onClose={() => setQualityBoardOpen(false)}
          workspaceKey={currentPage as Exclude<ProWorkspaceKey, 'guide' | 'quality' | 'writeback' | 'batch-workbench'>}
          workspaceLabel={currentPageMeta?.label || currentPage}
          workspaceSummary={currentPageMeta?.summary || ''}
          novelId={novelId}
          currentNovel={currentNovel}
          currentChapter={contextualChapter}
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
        <div className="novel-note-list novel-route-shell__modal-list">
          {quickSearchLoading ? <Spin size="small" /> : null}
          {!quickSearchLoading && quickSearchResults.length === 0 ? (
            <div className="novel-note-list__item">输入关键词后会在整个 Novel 工作区里搜索。</div>
          ) : null}
          {quickSearchResults.map((result) => (
            <button
              key={result.id}
              type="button"
              className="novel-sidebar__nav-item novel-route-shell__modal-item"
              onClick={() => {
                transitionNavigate(result.route)
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
        <div className="novel-note-list novel-route-shell__modal-list">
          {filteredChapterResults.slice(0, 20).map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className="novel-sidebar__nav-item novel-route-shell__modal-item"
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
        title="平台分批复制"
        open={platformCopyOpen}
        onCancel={() => setPlatformCopyOpen(false)}
        width={760}
        footer={platformCopyResult ? [
          <Button key="copy-all" type="primary" onClick={() => void copyPlatformText(platformCopyResult.content, '全部平台正文')}>
            复制全部
          </Button>,
        ] : null}
      >
        {platformCopyResult?.warnings.length ? (
          <Alert
            className="novel-route-shell__modal-list"
            type="warning"
            showIcon
            message="平台复制提示"
            description={platformCopyResult.warnings.slice(0, 5).join('；')}
          />
        ) : null}
        {platformCopyResult?.sensitiveWordHits.length ? (
          <div className="novel-note-list novel-route-shell__modal-list">
            {platformCopyResult.sensitiveWordHits.slice(0, 8).map((hit) => (
              <div key={hit.word} className="novel-note-list__item">
                {`${hit.word} ×${hit.count}：第 ${hit.chapterNums.join('、')} 章`}
              </div>
            ))}
          </div>
        ) : null}
        <div className="novel-note-list novel-route-shell__modal-list">
          {platformCopyResult?.batches.map((batch) => (
            <button
              key={batch.index}
              type="button"
              className="novel-sidebar__nav-item novel-route-shell__modal-item"
              onClick={() => void copyPlatformText(batch.content, `第 ${batch.index} 批`)}
            >
              <span className="novel-sidebar__nav-copy">
                <strong>{batch.title}</strong>
                <small>{`${batch.chapterCount} 章 · 约 ${batch.wordCount} 字`}</small>
              </span>
            </button>
          ))}
        </div>
      </Modal>
      <Modal
        title="逐章 AI 体检队列"
        open={qualityAnalysisOpen}
        onCancel={() => setQualityAnalysisOpen(false)}
        footer={[
          <Button key="tasks" onClick={() => navigate('/tasks')}>打开任务中心</Button>,
          <Button
            key="cancel"
            danger
            disabled={!qualityAnalysisTaskId}
            onClick={() => void handleCancelQualityAnalysis()}
          >
            停止队列
          </Button>,
        ]}
      >
        {qualityAnalysisStatus ? (
          <div className="novel-note-list">
            <div className="novel-note-list__item">
              {`任务 #${qualityAnalysisStatus.taskId} · ${qualityAnalysisStatus.status} · ${qualityAnalysisStatus.generatedCount}/${qualityAnalysisStatus.requestedCount} 章`}
            </div>
            <div className="novel-note-list__item">
              {qualityAnalysisStatus.currentChapterNum
                ? `当前第 ${qualityAnalysisStatus.currentChapterNum} 章：${qualityAnalysisStatus.message}`
                : qualityAnalysisStatus.message}
            </div>
            <div className="novel-note-list__item">
              {`成功 ${qualityAnalysisStatus.completedChapterIds.length} 章，失败 ${qualityAnalysisStatus.failedChapterIds.length} 章，修订任务 ${qualityAnalysisStatus.generatedRevisionTaskCount} 个。`}
            </div>
            <div className="novel-note-list__item">
              {`发布阻断 ${qualityAnalysisStatus.publishBlockedChapterIds.length} 章，需重写 ${qualityAnalysisStatus.publishRewriteChapterIds.length} 章。`}
            </div>
            {qualityAnalysisStatus.warnings.slice(0, 5).map((warning) => (
              <div key={warning} className="novel-note-list__item">{warning}</div>
            ))}
          </div>
        ) : (
          <Spin size="small" />
        )}
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
