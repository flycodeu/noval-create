import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { getErrorMessage } from '@/utils/user-facing-message'
import type { Chapter, ChapterSegment, Task, Character, ForeshadowLedgerEntry, ForeshadowSnapshot, NovelConsistencyReport, NovelContextStatus, QualityDashboardData, StoryFact, StoryItem, StoryMemorySnapshot, StoryVolume, TimelineEvent } from '../../../types'
import type { AiCheckPayload } from './parsers'
import { useWritingWorkspaceRefreshController, type WritingWorkspaceRefreshOperations } from './useWritingWorkspaceRefreshController'
import type { WritingContextPreviewState } from './writing-state-ownership'
import { useNovelStore } from '../../../stores/novel.store'
import { createWritingWorkspaceRequestTracker } from './writing-workspace-requests'

interface UseWritingWorkspaceDataOptions extends WritingWorkspaceRefreshOperations {
  routeChapterId: number | null
  shouldPreserveEditorContent?(): boolean
}

export function useWritingWorkspaceData(options: UseWritingWorkspaceDataOptions) {
  const { novelId, routeChapterId, shouldPreserveEditorContent } = options
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [storyMemory, setStoryMemory] = useState<StoryMemorySnapshot | null>(null)
  const [foreshadowSnapshot, setForeshadowSnapshot] = useState<ForeshadowSnapshot | null>(null)
  const [foreshadowLedger, setForeshadowLedger] = useState<ForeshadowLedgerEntry[]>([])
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])
  const [chapterSegments, setChapterSegments] = useState<ChapterSegment[]>([])
  const [storyFacts, setStoryFacts] = useState<StoryFact[]>([])
  const [storyVolumes, setStoryVolumes] = useState<StoryVolume[]>([])
  const [chapterCharacters, setChapterCharacters] = useState<Character[]>([])
  const [aiResult, setAiResult] = useState<AiCheckPayload | null>(null)
  const [qualityDashboard, setQualityDashboard] = useState<QualityDashboardData | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [contextPreview, setContextPreview] = useState<WritingContextPreviewState>({ preview: null, error: null })
  const [latestPipelineTask, setLatestPipelineTask] = useState<Task | null>(null)
  const trackerRef = useRef(createWritingWorkspaceRequestTracker())
  const tracker = trackerRef.current
  const workspaceRefresh = useWritingWorkspaceRefreshController({
    ...options,
    captureChapterSelection: tracker.captureChapterSelection,
    setCurrentChapter, setConsistencyReport, setStoryMemory, setQualityDashboard,
    setStoryFacts, setStoryVolumes, setChapterCharacters, setForeshadowLedger, setContextStatus,
    setTimelineEvents, setStoryItems, setChapterSegments, setAiResult, setForeshadowSnapshot,
    setContextPreview, setLatestPipelineTask,
  })
  const {
    beforeWorkspaceChapterLoad: beforeChapterLoad,
    handleWorkspaceChapterLoaded: onChapterLoaded,
    handleEmptyWorkspace: onEmptyWorkspace,
    refreshWorkspaceMetadata,
  } = workspaceRefresh
  const chapters = useNovelStore((state) => state.chapters)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const setChapters = useNovelStore((state) => state.setChapters)
  const setCurrentChapterId = useNovelStore((state) => state.setCurrentChapterId)
  const updateChapter = useNovelStore((state) => state.updateChapter)
  const routeChapterFocusRef = useRef<number | null>(null)
  const routeChapterRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const initializedRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    tracker.syncCurrentChapterId(currentChapterId)
  }, [currentChapterId, tracker])

  useEffect(() => {
    tracker.syncChapterIds(chapters.map((chapter) => chapter.id))
  }, [chapters, tracker])

  const refreshChapter = useCallback(async (chapterId: number) => {
    const isCurrent = tracker.beginDetailRequest(chapterId)
    const [full, segments] = await Promise.all([
      window.electron.chapter.get(chapterId),
      window.electron.structure.listSegments(chapterId),
    ])
    if (!full || !isCurrent()) return
    beforeChapterLoad()
    if (!isCurrent()) return
    setCurrentChapter(full)
    updateChapter(chapterId, full)
    await onChapterLoaded(full, segments, isCurrent)
  }, [beforeChapterLoad, onChapterLoaded, setCurrentChapter, tracker, updateChapter])

  const loadChapters = useCallback(async (
    preferredChapterId?: number,
    loadOptions: { selectChapter?: boolean } = {},
  ) => {
    const selectChapter = loadOptions.selectChapter !== false
    const request = tracker.beginListRequest(selectChapter)
    const list = await window.electron.chapter.list(novelId)
    if (tracker.isLatestListRequest(request.listRequestId)) setChapters(list)
    if (!selectChapter || !tracker.isLatestSelectionRequest(request.selectionRequestId)) return
    if (list.length === 0) {
      tracker.syncCurrentChapterId(null)
      tracker.invalidateDetailRequest()
      setCurrentChapter(null)
      setCurrentChapterId(null)
      onEmptyWorkspace()
      return
    }
    const target = list.find((chapter) => chapter.id === (preferredChapterId ?? tracker.currentChapterIdRef.current)) || list[0]
    tracker.syncCurrentChapterId(target.id)
    setCurrentChapterId(target.id)
    await refreshChapter(target.id)
  }, [novelId, onEmptyWorkspace, refreshChapter, setChapters, setCurrentChapter, setCurrentChapterId, tracker])

  const refreshBackgroundChapter = useCallback(async (
    chapterId: number,
    options: { replaceEditor?: boolean } = {},
  ) => {
    await loadChapters(undefined, { selectChapter: false })
    if (tracker.currentChapterIdRef.current !== chapterId) return
    if (!options.replaceEditor && shouldPreserveEditorContent?.()) {
      const isCurrent = tracker.beginDetailRequest(chapterId)
      const full = await window.electron.chapter.get(chapterId)
      if (!full || !isCurrent()) return
      setCurrentChapter((current) => {
        if (!current || current.id !== chapterId) return current
        return { ...full, content: current.content, wordCount: current.wordCount }
      })
      updateChapter(chapterId, full)
      return
    }
    await refreshChapter(chapterId)
  }, [loadChapters, refreshChapter, setCurrentChapter, shouldPreserveEditorContent, tracker, updateChapter])

  const selectChapter = useCallback(async (chapterId: number) => {
    tracker.selectChapter(chapterId)
    setCurrentChapterId(chapterId)
    try {
      await refreshChapter(chapterId)
    } catch (error) {
      if (tracker.currentChapterIdRef.current !== chapterId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }
  }, [refreshChapter, setCurrentChapterId, tracker])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    routeChapterFocusRef.current = routeChapterId

    let alive = true
    void (async () => {
      setLoading(true)
      setRefreshing(false)
      try {
        await loadChapters(routeChapterId || undefined)
        if (!alive) return
        loadedOnceRef.current = true
        setLoading(false)
        setRefreshing(false)
        void refreshWorkspaceMetadata().catch((error) => {
          console.error('Failed to refresh writing workspace metadata', error)
        })
      } catch (error) {
        if (alive) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.loadFailed'))
        }
      } finally {
        if (alive && !loadedOnceRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    })()
    return () => {
      alive = false
      if (!loadedOnceRef.current) initializedRef.current = false
    }
  }, [loadChapters, refreshWorkspaceMetadata, routeChapterId])

  useEffect(() => {
    if (!routeChapterId || routeChapterFocusRef.current === routeChapterId) return
    const requestId = ++routeChapterRequestRef.current
    routeChapterFocusRef.current = routeChapterId
    if (loadedOnceRef.current) setRefreshing(true)
    else setLoading(true)
    void loadChapters(routeChapterId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }).finally(() => {
      if (routeChapterRequestRef.current === requestId) {
        setLoading(false)
        setRefreshing(false)
      }
    })
  }, [loadChapters, routeChapterId])

  return {
    ...workspaceRefresh,
    setCurrentChapter, consistencyReport, storyMemory, qualityDashboard, contextStatus,
    storyFacts, storyVolumes, chapterCharacters, foreshadowLedger, setForeshadowLedger,
    timelineEvents, storyItems, chapterSegments, aiResult, setAiResult, foreshadowSnapshot,
    chapterContextPreview: contextPreview.preview,
    chapterContextPreviewError: contextPreview.error,
    latestPipelineTask,
    chapters,
    currentChapter,
    currentChapterId,
    currentChapterIdRef: tracker.currentChapterIdRef,
    chapterIdsRef: tracker.chapterIdsRef,
    loading,
    refreshing,
    loadChapters,
    refreshBackgroundChapter,
    refreshChapter,
    selectChapter,
  }
}
