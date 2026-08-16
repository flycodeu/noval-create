import { useCallback, useEffect, useState } from 'react'
import { message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { getAiExecutionModeLabel, type AiExecutionMode } from '../../../shared/ai-execution'
import type { Chapter, Novel } from '../../../types'
import { compileWritingChapter, persistWritingDefaultAiMode } from './writing-workspace-actions'

interface UseWritingWorkspaceActionControllerInput {
  currentChapter: Chapter | null
  currentChapterIdRef: { current: number | null }
  currentNovel: Novel | null
  setCurrentNovel(novel: Novel | null): void
  loadChapters(chapterId: number): Promise<unknown>
  refreshMeta(): Promise<unknown>
  refreshContextStatus(): Promise<unknown>
  refreshChapterContextPreview(chapter: Chapter, isCurrent: () => boolean): Promise<void>
}

function useChapterContextPreviewTrigger(input: UseWritingWorkspaceActionControllerInput) {
  const { currentChapter, currentChapterIdRef, refreshChapterContextPreview } = input
  useEffect(() => {
    if (!currentChapter) return
    const chapterId = currentChapter.id
    const isCurrent = () => currentChapterIdRef.current === chapterId
    void refreshChapterContextPreview(currentChapter, isCurrent)
  }, [currentChapter, currentChapterIdRef, refreshChapterContextPreview])
}

function useDefaultAiModeAction(input: UseWritingWorkspaceActionControllerInput) {
  const { currentNovel, setCurrentNovel } = input
  const [savingAiMode, setSavingAiMode] = useState(false)
  const changeDefaultAiMode = useCallback(async (mode: AiExecutionMode) => {
    if (!currentNovel) return
    setSavingAiMode(true)
    try {
      await persistWritingDefaultAiMode({
        novel: currentNovel,
        mode,
        updateNovel: (id, settingsJson) => window.electron.novel.update(id, { settingsJson }),
        setCurrentNovel,
      })
      message.success(getUserFacingMessage('writing.defaultModeChanged', {
        mode: getAiExecutionModeLabel(mode),
      }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSavingAiMode(false)
    }
  }, [currentNovel, setCurrentNovel])
  return { changeDefaultAiMode, savingAiMode }
}

function useCompileChapterAction(input: UseWritingWorkspaceActionControllerInput) {
  const { currentChapter, loadChapters, refreshContextStatus, refreshMeta } = input
  return useCallback(async () => {
    if (!currentChapter) return
    try {
      await compileWritingChapter({
        chapterId: currentChapter.id,
        compileChapter: (chapterId) => window.electron.structure.compileChapter(chapterId),
        loadChapters,
        refreshMeta,
        refreshContextStatus,
      })
      message.success(getUserFacingMessage('writing.compiled'))
    } catch (error) {
      message.error(getErrorMessage(error, 'writing.compileFailed'))
    }
  }, [currentChapter, loadChapters, refreshContextStatus, refreshMeta])
}

export function useWritingWorkspaceActionController(input: UseWritingWorkspaceActionControllerInput) {
  useChapterContextPreviewTrigger(input)
  const aiMode = useDefaultAiModeAction(input)
  const compileChapter = useCompileChapterAction(input)
  return { ...aiMode, compileChapter }
}
