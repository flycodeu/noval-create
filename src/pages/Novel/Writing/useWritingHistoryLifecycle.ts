import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { message } from 'antd'
import { getErrorMessage } from '@/utils/user-facing-message'
import type { Chapter, ChapterVersion } from '../../../types'
import type { WritingRouteKey } from './components/InsightPanel'
import { createWritingVersionHistoryRequestTracker, resolveSelectedVersionId } from './writing-version-history'

type CurrentChapterIdRef = { current: number | null }

interface UseWritingHistoryLifecycleInput {
  currentChapter: Chapter | null
  currentChapterIdRef: CurrentChapterIdRef
  isHistoryRoute: boolean
  optimizeModalOpen: boolean
  rewriteModalOpen: boolean
  setOptimizeModalOpen: Dispatch<SetStateAction<boolean>>
  setRewriteModalOpen: Dispatch<SetStateAction<boolean>>
  navigateToWritingRoute(route: WritingRouteKey): void
  registerEscapeHandler(handler: (() => void) | null): void
}

function useVersionHistoryData() {
  const trackerRef = useRef(createWritingVersionHistoryRequestTracker())
  const [loading, setLoading] = useState(false)
  const [versions, setVersions] = useState<ChapterVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null)
  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) || versions[0] || null,
    [selectedVersionId, versions],
  )
  const refreshVersionHistory = useCallback(async (chapterId: number, isCurrent: () => boolean = () => true) => {
    const requestId = trackerRef.current.beginRequest()
    setLoading(true)
    try {
      const nextVersions = await window.electron.chapter.listVersions(chapterId)
      if (!trackerRef.current.isCurrent(requestId, isCurrent)) return
      setVersions(nextVersions)
      setSelectedVersionId((current) => resolveSelectedVersionId(current, nextVersions))
    } finally {
      if (trackerRef.current.isCurrent(requestId, isCurrent)) setLoading(false)
    }
  }, [])
  const clearVersionHistory = useCallback(() => {
    trackerRef.current.invalidate()
    setLoading(false)
    setVersions([])
    setSelectedVersionId(null)
  }, [])
  return { clearVersionHistory, loading, refreshVersionHistory, selectedVersion, selectedVersionId, setSelectedVersionId, versions }
}

function useHistoryRouteEffects(
  currentChapter: Chapter | null,
  currentChapterIdRef: CurrentChapterIdRef,
  isHistoryRoute: boolean,
  refreshVersionHistory: ReturnType<typeof useVersionHistoryData>['refreshVersionHistory'],
  clearVersionHistory: () => void,
) {
  useEffect(() => {
    if (!isHistoryRoute || !currentChapter) return
    const chapterId = currentChapter.id
    const isCurrent = () => currentChapterIdRef.current === chapterId && isHistoryRoute
    void refreshVersionHistory(chapterId, isCurrent).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [currentChapter, currentChapterIdRef, isHistoryRoute, refreshVersionHistory])
  useEffect(() => {
    if (isHistoryRoute && currentChapter) return
    clearVersionHistory()
  }, [clearVersionHistory, currentChapter, isHistoryRoute])
}

function useWritingRouteEscape(input: UseWritingHistoryLifecycleInput) {
  const {
    isHistoryRoute,
    navigateToWritingRoute,
    optimizeModalOpen,
    registerEscapeHandler,
    rewriteModalOpen,
    setOptimizeModalOpen,
    setRewriteModalOpen,
  } = input
  useEffect(() => {
    registerEscapeHandler(() => {
      if (optimizeModalOpen) {
        setOptimizeModalOpen(false)
        return
      }
      if (rewriteModalOpen) {
        setRewriteModalOpen(false)
        return
      }
      if (isHistoryRoute) navigateToWritingRoute('editor')
    })
    return () => registerEscapeHandler(null)
  }, [isHistoryRoute, navigateToWritingRoute, optimizeModalOpen, registerEscapeHandler, rewriteModalOpen, setOptimizeModalOpen, setRewriteModalOpen])
}

export function useWritingHistoryLifecycle(input: UseWritingHistoryLifecycleInput) {
  const history = useVersionHistoryData()
  useHistoryRouteEffects(
    input.currentChapter,
    input.currentChapterIdRef,
    input.isHistoryRoute,
    history.refreshVersionHistory,
    history.clearVersionHistory,
  )
  useWritingRouteEscape(input)
  return history
}
