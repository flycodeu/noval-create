import { useCallback, type MouseEvent } from 'react'
import { Modal, message } from 'antd'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import type { Chapter, StoryVolume } from '../../../types'
import type { ChapterSaveCoordinator } from './chapter-save-coordinator'
import { buildNewChapterDraft, deleteChapterAfterPendingSave } from './writing-chapter-crud'

interface UseWritingChapterCrudControllerInput {
  novelId: number
  chapters: Chapter[]
  currentChapter: Chapter | null
  volumes: StoryVolume[]
  saveCoordinator: ChapterSaveCoordinator
  selectWorkspaceChapter(chapterId: number): Promise<void>
  loadChapters(preferredChapterId?: number): Promise<void>
  refreshMeta(): Promise<void>
  refreshContextStatus(): Promise<void>
}

export function useWritingChapterCrudController(input: UseWritingChapterCrudControllerInput) {
  const {
    chapters,
    currentChapter,
    loadChapters,
    novelId,
    refreshContextStatus,
    refreshMeta,
    saveCoordinator,
    selectWorkspaceChapter,
    volumes,
  } = input

  const selectChapter = useCallback(
    (chapterId: number) => selectWorkspaceChapter(chapterId),
    [selectWorkspaceChapter],
  )

  const addChapter = useCallback(async (volumeId?: number | null) => {
    const draft = buildNewChapterDraft({
      chapters,
      currentChapter,
      volumes,
      requestedVolumeId: volumeId,
    })
    const chapterId = await window.electron.chapter.create(novelId, draft)
    await Promise.all([loadChapters(chapterId), refreshMeta(), refreshContextStatus()])
    message.success(getUserFacingMessage('writing.chapterCreated'))
  }, [chapters, currentChapter, loadChapters, novelId, refreshContextStatus, refreshMeta, volumes])

  const deleteChapter = useCallback((chapterId: number, event: MouseEvent) => {
    event.stopPropagation()
    Modal.confirm({
      title: '确认删除这个章节？',
      content: '删除后章节内容无法恢复。',
      okType: 'danger',
      okText: '删除',
      onOk: () => deleteChapterAfterPendingSave({
        chapterId,
        saveCoordinator,
        deleteChapter: (id) => window.electron.chapter.delete(id),
        refreshChapters: () => loadChapters(),
        refreshMeta,
        refreshContextStatus,
      }),
    })
  }, [loadChapters, refreshContextStatus, refreshMeta, saveCoordinator])

  return { addChapter, deleteChapter, selectChapter }
}
