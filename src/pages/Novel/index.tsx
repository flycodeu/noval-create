import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Drawer, Dropdown, Input, Modal, Spin, message } from 'antd'
import { ArrowLeftOutlined, EllipsisOutlined, MenuOutlined, SearchOutlined } from '@ant-design/icons'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { AUTHOR_WORKSPACE_PAGES, getAuthorWorkspaceKey, resolveAuthorWorkspaceRoute, type AuthorWorkspaceKey } from '../../shared/author-workspace'
import { buildWorkspaceRoute } from '../../shared/novel-workspace'
import { useNovelStore } from '../../stores/novel.store'
import { useThemeStore } from '../../stores/theme.store'
import { isElectronRuntime } from '../../runtime/environment'
import ProjectSidebar from '../../components/novel/layout/ProjectSidebar'
import WindowControls from '../../components/Layout/WindowControls'
import { WorkspaceChromePortalContext } from '../../components/novel/workspace-layout/workspace-chrome-contract'
import WorkspaceErrorBoundary from './components/WorkspaceErrorBoundary'
import { NovelWorkspaceActionsProvider } from './workspace-shortcuts'
import { NovelWorkspaceQualityProvider } from './workspace-quality-context'
import type { RegisteredWorkspaceQualityController } from './workspace-quality-context-core'
import type { Chapter } from '../../types'
import './AuthorWorkspace/author-workspace.css'

const WORKSPACE_STAGE_LOADERS = {
  guide: () => import('./AuthorWorkspace/Studio'),
  'story-design': () => import('./AuthorWorkspace/StoryDesign'),
  'narrative-board': () => import('./AuthorWorkspace/WorldAndCast'),
  timeline: () => import('./AuthorWorkspace/StoryTimeline'),
  writing: () => import('./AuthorWorkspace/Manuscript'),
  revision: () => import('./AuthorWorkspace/Versions'),
}
const PAGES = Object.fromEntries(Object.entries(WORKSPACE_STAGE_LOADERS).map(([key, loader]) => [key, React.lazy(loader)])) as Record<AuthorWorkspaceKey, React.LazyExoticComponent<React.ComponentType<{ novelId: number }>>>

export default function NovelRouter() {
  const { id } = useParams<{ id: string }>()
  const novelId = Number(id)
  const navigate = useNavigate()
  const location = useLocation()
  const currentPage = getAuthorWorkspaceKey(location.pathname.split('/').filter(Boolean)[2] || 'guide')
  const page = AUTHOR_WORKSPACE_PAGES.find((item) => item.key === currentPage)!
  const Page = PAGES[currentPage]
  const legacyDestination = resolveAuthorWorkspaceRoute(location.pathname.split('/').filter(Boolean).slice(2).join('/'), location.search)
  const novel = useNovelStore((state) => state.currentNovel)
  const setNovel = useNovelStore((state) => state.setCurrentNovel)
  const resetWorkspace = useNovelStore((state) => state.resetWorkspace)
  const setTheme = useThemeStore((state) => state.setTheme)
  const [error, setError] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [mutationToken, setMutationToken] = useState(0)
  const [actionTarget, setActionTarget] = useState<HTMLDivElement | null>(null)
  const [informationTarget, setInformationTarget] = useState<HTMLDivElement | null>(null)
  const [controller, setController] = useState<RegisteredWorkspaceQualityController | null>(null)
  const saveRef = useRef<(() => void) | null>(null)
  const clearRef = useRef<(() => void) | null>(null)
  const escapeRef = useRef<(() => void) | null>(null)
  const dirtyRef = useRef<(() => boolean) | null>(null)
  const previousHash = useRef(window.location.hash)
  const skipHashGuard = useRef(false)
  const registerSaveHandler = useCallback((handler: (() => void) | null) => { saveRef.current = handler }, [])
  const registerClearHandler = useCallback((handler: (() => void) | null) => { clearRef.current = handler }, [])
  const registerEscapeHandler = useCallback((handler: (() => void) | null) => { escapeRef.current = handler }, [])
  const registerLeaveGuard = useCallback((handler: (() => boolean) | null) => { dirtyRef.current = handler }, [])
  const notifyWorkspaceMutation = useCallback(() => { setMutationToken((value) => value + 1) }, [])
  const registerController = useCallback((next: RegisteredWorkspaceQualityController | null) => { setController(next); return () => setController((current) => current === next ? null : current) }, [])
  const qualityContext = useMemo(() => ({ controller, registerController }), [controller, registerController])
  const chromeContext = useMemo(() => ({ actionTarget, informationTarget }), [actionTarget, informationTarget])
  const actions = useMemo(() => ({ registerSaveHandler, registerClearHandler, registerEscapeHandler, registerLeaveGuard, notifyWorkspaceMutation, mutationToken }), [registerSaveHandler, registerClearHandler, registerEscapeHandler, registerLeaveGuard, notifyWorkspaceMutation, mutationToken])

  useEffect(() => {
    if (!Number.isSafeInteger(novelId) || novelId <= 0) return
    let alive = true
    void window.electron.novel.get(novelId).then((result) => {
      if (!alive) return
      if (!result) { setError('这部作品不存在。'); return }
      setNovel(result); setError('')
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : '读取作品失败') })
    return () => { alive = false }
  }, [novelId, currentPage, mutationToken, setNovel])
  useEffect(() => () => resetWorkspace(), [novelId, resetWorkspace])
  useEffect(() => {
    const handle = () => notifyWorkspaceMutation()
    window.addEventListener('novelforge:creative-completed', handle)
    return () => window.removeEventListener('novelforge:creative-completed', handle)
  }, [notifyWorkspaceMutation])

  const go = useCallback((route: string) => {
    const target = route.startsWith('/') ? route : buildWorkspaceRoute(novelId, route)
    const perform = () => { skipHashGuard.current = true; navigate(target); setDrawerOpen(false) }
    if (!dirtyRef.current?.()) { perform(); return }
    Modal.confirm({ title: '当前内容还有未保存的修改', content: '离开后，未保存的修改会丢失。', okText: '放弃并离开', okButtonProps: { danger: true }, cancelText: '继续编辑', onOk: perform })
  }, [navigate, novelId, setDrawerOpen])

  useEffect(() => {
    const guardKey = (hash: string) => hash.replace(/\/writing(?:\/editor|\/review|\/history|\/context)?(?=[?#]|$)/, '/writing')
    const hashChange = () => {
      const next = window.location.hash
      const previous = previousHash.current
      if (skipHashGuard.current) { skipHashGuard.current = false; previousHash.current = next; return }
      if (guardKey(previous) === guardKey(next) || !dirtyRef.current?.()) { previousHash.current = next; return }
      skipHashGuard.current = true
      window.location.hash = previous
      Modal.confirm({ title: '当前内容还有未保存的修改', content: '离开后，未保存的修改会丢失。', okText: '放弃并离开', cancelText: '继续编辑', onOk: () => { skipHashGuard.current = true; window.location.hash = next } })
    }
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current?.()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('hashchange', hashChange)
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('hashchange', hashChange); window.removeEventListener('beforeunload', beforeUnload) }
  }, [])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    void window.electron.chapter.list(novelId).then(setChapters).catch((cause) => message.error(cause instanceof Error ? cause.message : '读取章节失败'))
  }, [novelId, setSearchOpen])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveRef.current?.() }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); openSearch() }
      if (event.key === 'Escape') { setSearchOpen(false); setDrawerOpen(false); escapeRef.current?.() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [openSearch])
  const exportBook = async (format: string) => {
    try { const path = await window.electron.novel.export(novelId, format); message.success(`已导出到 ${path}`) }
    catch (cause) { message.error(cause instanceof Error ? cause.message : '导出失败') }
  }
  const sidebar = <ProjectSidebar stageLabel="" progressText="" currentTask="" navGroups={[]} activeKey={currentPage} onNavigate={go} onPrefetchRoute={(route) => { void WORKSPACE_STAGE_LOADERS[getAuthorWorkspaceKey(route)]() }} />

  if (!Number.isSafeInteger(novelId) || novelId <= 0) return <Navigate to="/novels" replace />
  if (error && novel?.id !== novelId) return <div className="author-shell-error"><h2>作品暂时无法打开</h2><p>{error}</p><Button onClick={() => navigate('/novels')}>返回作品列表</Button></div>
  if (novel?.id !== novelId) return <div className="author-loading"><Spin size="large" /></div>
  if (legacyDestination) return <Navigate to={buildWorkspaceRoute(novelId, legacyDestination)} replace />

  return <WorkspaceErrorBoundary resetKey={`${novelId}:${currentPage}`}><NovelWorkspaceActionsProvider value={actions}><NovelWorkspaceQualityProvider value={qualityContext}><WorkspaceChromePortalContext.Provider value={chromeContext}>
    <div className={`author-shell${currentPage === 'writing' ? ' author-shell--writing' : ''}`}>
      <header className="author-shell-header">
        <div className="author-shell-header__identity"><Button type="text" icon={<ArrowLeftOutlined />} onClick={() => go('/novels')} aria-label="返回作品列表" /><Button type="text" className="author-mobile-menu" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} aria-label="打开导航" /><strong>{novel.title || '未命名作品'}</strong><span>/</span><span>{page.label}</span></div>
        <div ref={setInformationTarget} className="author-shell-header__information" />
        <div className="author-shell-header__actions"><div ref={setActionTarget} /><Button type="text" icon={<SearchOutlined />} onClick={openSearch} aria-label="查找章节" /><Dropdown trigger={['click']} menu={{ items: [
          { key: 'models', label: '模型与搜索', onClick: () => go('/models') }, { key: 'settings', label: 'MCP 与应用设置', onClick: () => go('/settings') },
          { type: 'divider' }, { key: 'export', label: '导出作品', children: ['txt', 'md', 'docx', 'epub'].map((format) => ({ key: format, label: format.toUpperCase(), onClick: () => void exportBook(format) })) },
          { key: 'theme', label: '外观', children: [{ key: 'light', label: '浅色', onClick: () => setTheme('light') }, { key: 'soft', label: '柔和', onClick: () => setTheme('soft') }, { key: 'dark', label: '深色', onClick: () => setTheme('dark') }] },
        ] }}><Button type="text" icon={<EllipsisOutlined />} aria-label="作品设置与导出" /></Dropdown>
        {isElectronRuntime() && <WindowControls className="author-window-controls" buttonClassName="author-window-button" dangerButtonClassName="author-window-button--danger" />}</div>
      </header>
      <aside className="author-shell-sidebar">{sidebar}</aside>
      <main className="author-shell-main" key={`${novelId}:${currentPage}`}><React.Suspense fallback={<div className="author-loading"><Spin /></div>}><Page novelId={novelId} /></React.Suspense></main>
    </div>
    <Drawer title="作品导航" open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" width={290}>{sidebar}</Drawer>
    <Modal title="查找章节" open={searchOpen} onCancel={() => setSearchOpen(false)} footer={null}><Input.Search autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="章节序号或标题" /><div className="author-search-results">{chapters.filter((chapter) => `${chapter.chapterNum} ${chapter.title}`.includes(search)).map((chapter) => <button key={chapter.id} onClick={() => { go(`writing/editor?chapterId=${chapter.id}`); setSearchOpen(false) }}><span>第 {chapter.chapterNum} 章</span><strong>{chapter.title || '未命名'}</strong></button>)}</div></Modal>
  </WorkspaceChromePortalContext.Provider></NovelWorkspaceQualityProvider></NovelWorkspaceActionsProvider></WorkspaceErrorBoundary>
}
