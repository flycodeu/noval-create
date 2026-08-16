import { useCallback, useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { getErrorMessage } from '@/utils/user-facing-message'
import type { Dispatch, SetStateAction } from 'react'
import type { Chapter, ChapterSegment } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { createWritingWorkspaceRequestTracker } from './writing-workspace-requests'

interface UseWritingWorkspaceDataOptions {
  novelId: number
  routeChapterId: number | null
  currentChapter: Chapter | null
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>
  beforeChapterLoad(): void
  onChapterLoaded(chapter: Chapter, segments: ChapterSegment[], isCurrent: () => boolean): Promise<void>
  onEmptyWorkspace(): void
  refreshWorkspaceMetadata(): Promise<void>
}

export function useWritingWorkspaceData(options: UseWritingWorkspaceDataOptions) {
  const {
    novelId,
    routeChapterId,
    currentChapter,
    setCurrentChapter,
    beforeChapterLoad,
    onChapterLoaded,
    onEmptyWorkspace,
    refreshWorkspaceMetadata,
  } = options
  const chapters = useNovelStore((state) => state.chapters)
  const currentChapterId = useNovelStore((state) => state.currentChapterId)
  const setChapters = useNovelStore((state) => state.setChapters)
  const setCurrentChapterId = useNovelStore((state) => state.setCurrentChapterId)
  const updateChapter = useNovelStore((state) => state.updateChapter)
  const trackerRef = useRef(createWritingWorkspaceRequestTracker())
  const routeChapterFocusRef = useRef<number | null>(null)
  const routeChapterRequestRef = useRef(0)
  const loadedOnceRef = useRef(false)
  const initializedRef = useRef(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const tracker = trackerRef.current

  useEffect(() => {
    tracker.syncCurrentChapterId(currentChapterId)
  }, [currentChapterId, tracker])

  useEffect(() => {
    tracker.syncChapterIds(chapters.map((chapter) => chapter.id))
  }, [chapters, tracker])

  const refreshChapter = useCallback(async (chapterId: number) => {
    const isCurrent = tracker.beginDetailRequest(chapterId)
    beforeChapterLoad()
    const [full, segments] = await Promise.all([
      window.electron.chapter.get(chapterId),
      window.electron.structure.listSegments(chapterId),
    ])
    if (!full || !isCurrent()) return
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

  const refreshBackgroundChapter = useCallback(async (chapterId: number) => {
    await loadChapters(undefined, { selectChapter: false })
    if (tracker.currentChapterIdRef.current === chapterId) await refreshChapter(chapterId)
  }, [loadChapters, refreshChapter, tracker])

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
