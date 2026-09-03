import { useCallback, useState } from 'react'
import { Modal, message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Dispatch, SetStateAction } from 'react'
import type { Chapter, ForeshadowLedgerEntry } from '../../../types'
import { normalizeIdArray } from './components/InsightPanel/insight-utils'

interface UseChapterWritebackOptions {
  novelId: number
  currentChapter: Chapter | null
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>
  setForeshadowLedger: Dispatch<SetStateAction<ForeshadowLedgerEntry[]>>
  updateChapter(chapterId: number, data: Partial<Chapter>): void
  refreshForeshadowSnapshot(chapter?: Chapter | null, isCurrent?: () => boolean): Promise<void>
  notifyWorkspaceMutation(): void
}

export function useChapterWriteback(options: UseChapterWritebackOptions) {
  const {
    currentChapter,
    novelId,
    notifyWorkspaceMutation,
    refreshForeshadowSnapshot,
    setCurrentChapter,
    setForeshadowLedger,
    updateChapter,
  } = options
  const [updatingRevealConstraints, setUpdatingRevealConstraints] = useState(false)
  const [updatingForeshadowWriteback, setUpdatingForeshadowWriteback] = useState(false)

  const updateRevealConstraints = useCallback(async (nextAllowedIds: number[], nextRevealedIds: number[]) => {
    if (!currentChapter) return
    const chapterId = currentChapter.id
    const normalizedAllowed = normalizeIdArray(nextAllowedIds)
    const normalizedRevealed = normalizeIdArray(nextRevealedIds.filter((id) => normalizedAllowed.includes(id)))
    const patch = {
      allowedFactIdsJson: JSON.stringify(normalizedAllowed),
      revealedFactIdsJson: JSON.stringify(normalizedRevealed),
    }
    setUpdatingRevealConstraints(true)
    try {
      await window.electron.chapter.update(chapterId, patch, {
        skipStaleTracking: true,
        versionSource: false,
      })
      setCurrentChapter((previous) => previous && previous.id === chapterId
        ? { ...previous, ...patch }
        : previous)
      updateChapter(chapterId, patch)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setUpdatingRevealConstraints(false)
    }
  }, [currentChapter, setCurrentChapter, updateChapter])

  const createForeshadowWriteback = useCallback(async (data: Partial<ForeshadowLedgerEntry>) => {
    if (!currentChapter) return
    const chapter = currentChapter
    setUpdatingForeshadowWriteback(true)
    try {
      const nextRows = await window.electron.foreshadow.upsertLedger(novelId, {
        ...data,
        sourceChapterId: chapter.id,
      })
      setForeshadowLedger(nextRows)
      await refreshForeshadowSnapshot(chapter, () => true)
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('writing.foreshadowCreated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
      throw error
    } finally {
      setUpdatingForeshadowWriteback(false)
    }
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot, setForeshadowLedger])

  const patchForeshadowWriteback = useCallback(async (id: number, data: Partial<ForeshadowLedgerEntry>) => {
    if (!currentChapter) return
    const chapter = currentChapter
    setUpdatingForeshadowWriteback(true)
    try {
      const nextRows = await window.electron.foreshadow.upsertLedger(novelId, { id, ...data })
      setForeshadowLedger(nextRows)
      await refreshForeshadowSnapshot(chapter, () => true)
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('writing.foreshadowUpdated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setUpdatingForeshadowWriteback(false)
    }
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot, setForeshadowLedger])

  const deleteForeshadowWriteback = useCallback((entry: ForeshadowLedgerEntry) => {
    Modal.confirm({
      title: `删除伏笔「${entry.title}」`,
      content: '删除后会从伏笔账本移除，本章回写记录也会同步消失。',
      okType: 'danger',
      onOk: async () => {
        const chapter = currentChapter
        if (!chapter) return
        setUpdatingForeshadowWriteback(true)
        try {
          const nextRows = await window.electron.foreshadow.deleteLedger(novelId, entry.id)
          setForeshadowLedger(nextRows)
          await refreshForeshadowSnapshot(chapter, () => true)
          notifyWorkspaceMutation()
          message.success(getUserFacingMessage('writing.foreshadowDeleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.saveFailed'))
        } finally {
          setUpdatingForeshadowWriteback(false)
        }
      },
    })
  }, [currentChapter, novelId, notifyWorkspaceMutation, refreshForeshadowSnapshot, setForeshadowLedger])

  return {
    updatingRevealConstraints,
    updatingForeshadowWriteback,
    updateRevealConstraints,
    createForeshadowWriteback,
    patchForeshadowWriteback,
    deleteForeshadowWriteback,
  }
}
