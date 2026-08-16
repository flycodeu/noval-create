import { createElement, useCallback, useRef } from 'react'
import { Modal, message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Dispatch, SetStateAction } from 'react'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { Chapter, ChapterPublishCheck } from '../../../types'
import type { WritingRouteKey } from './components/InsightPanel'
import { resolvePublishFinalizationDecision } from './chapter-review-policy'

export interface UseChapterPublicationOptions {
  novelId: number
  currentChapter: Chapter | null
  selectedVersionId: number | null
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>
  setPublishCheck: Dispatch<SetStateAction<ChapterPublishCheck | null>>
  navigate(path: string): void
  navigateToWritingRoute(route: WritingRouteKey): void
  loadChapters(preferredChapterId?: number): Promise<void>
  refreshMeta(): Promise<void>
  refreshContextStatus(): Promise<void>
  refreshVersionHistory(chapterId: number, isCurrent?: () => boolean): Promise<void>
  notifyWorkspaceMutation(): void
}

function buildGateModalContent(summary: string, messages: string[]) {
  return createElement(
    'div',
    { className: 'novel-note-list novel-note-list--spaced-top' },
    createElement('div', { className: 'novel-note-list__item' }, summary),
    ...messages.map((item) => createElement('div', { className: 'novel-note-list__item', key: item }, item)),
  )
}

export function useChapterPublication(options: UseChapterPublicationOptions) {
  const statusChangeInFlightRef = useRef(false)
  const {
    currentChapter,
    loadChapters,
    navigate,
    navigateToWritingRoute,
    novelId,
    notifyWorkspaceMutation,
    refreshContextStatus,
    refreshMeta,
    refreshVersionHistory,
    selectedVersionId,
    setCurrentChapter,
    setPublishCheck,
  } = options

  const openGateIssue = useCallback((item: ChapterPublishCheck['checklist'][number]) => {
    if (!currentChapter) return
    if (item.relatedPage === 'structure') {
      const params = new URLSearchParams({ chapterId: String(currentChapter.id) })
      if (typeof item.segmentId === 'number') params.set('segmentId', String(item.segmentId))
      navigate(buildWorkspaceRoute(novelId, `structure?${params.toString()}`))
      return
    }
    const workspacePage = item.relatedPage === 'contracts'
      ? `contracts?chapterId=${currentChapter.id}`
      : item.relatedPage === 'revision'
        ? 'revision'
        : item.relatedPage === 'volume-design'
          ? 'volume-design'
          : item.relatedPage === 'threads'
            ? 'threads'
            : null
    if (workspacePage) {
      navigate(buildWorkspaceRoute(novelId, workspacePage))
      return
    }
    navigateToWritingRoute('editor')
    message.info(item.status === 'rewrite'
      ? getUserFacingMessage('writing.gateIssueRewriteOpen')
      : getUserFacingMessage('writing.gateIssueOpen'))
  }, [currentChapter, navigate, navigateToWritingRoute, novelId])

  const restoreVersion = useCallback(async () => {
    if (!selectedVersionId || !currentChapter) return
    try {
      await window.electron.chapter.restoreVersion(selectedVersionId)
      await Promise.all([
        loadChapters(currentChapter.id),
        refreshMeta(),
        refreshContextStatus(),
        refreshVersionHistory(currentChapter.id),
      ])
      message.success(getUserFacingMessage('writing.versionRestored'))
      notifyWorkspaceMutation()
    } catch (error: unknown) {
      message.error(getErrorMessage(error, 'writing.restoreVersionFailed'))
    }
  }, [currentChapter, loadChapters, notifyWorkspaceMutation, refreshContextStatus, refreshMeta, refreshVersionHistory, selectedVersionId])

  const changeStatusInternal = useCallback(async (status: Chapter['status']) => {
    if (!currentChapter) return
    if (status === 'final') {
      const nextPublishCheck = await window.electron.chapter.runPublishCheck(currentChapter.id)
      setPublishCheck(nextPublishCheck)
      setCurrentChapter((current) => current && current.id === currentChapter.id
        ? { ...current, contractAuditJson: JSON.stringify(nextPublishCheck.contractAudit) }
        : current)
      await refreshContextStatus()
      const decision = resolvePublishFinalizationDecision(nextPublishCheck)
      if (decision.kind === 'block') {
        Modal.confirm({
          title: decision.title,
          content: buildGateModalContent(nextPublishCheck.summary, decision.messages),
          okText: '去处理',
          cancelText: '留在当前页',
          onOk: () => {
            if (decision.primaryIssue) {
              openGateIssue(decision.primaryIssue)
              return
            }
            if (nextPublishCheck.gateLevel === 'blocker') {
              navigate(buildWorkspaceRoute(novelId, `contracts?chapterId=${currentChapter.id}`))
            }
          },
        })
        return
      }
      if (decision.kind === 'confirm-warning') {
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            title: decision.title,
            content: buildGateModalContent(nextPublishCheck.summary, decision.messages),
            okText: '仍标记完成',
            cancelText: '继续处理',
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          })
        })
        if (!shouldContinue) return
      }
    }
    await window.electron.chapter.update(currentChapter.id, { status })
    await Promise.all([loadChapters(currentChapter.id), refreshMeta(), refreshContextStatus()])
  }, [
    currentChapter,
    loadChapters,
    navigate,
    novelId,
    openGateIssue,
    refreshContextStatus,
    refreshMeta,
    setCurrentChapter,
    setPublishCheck,
  ])

  const changeStatus = useCallback(async (status: Chapter['status']) => {
    if (!currentChapter || statusChangeInFlightRef.current) return
    statusChangeInFlightRef.current = true
    try {
      await changeStatusInternal(status)
    } finally {
      statusChangeInFlightRef.current = false
    }
  }, [changeStatusInternal, currentChapter])

  return { openGateIssue, changeStatus, restoreVersion }
}
