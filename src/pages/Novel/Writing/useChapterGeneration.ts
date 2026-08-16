import { useCallback, useEffect, useRef } from 'react'
import { message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { getAiExecutionModeLabel, type AiExecutionMode } from '../../../shared/ai-execution'
import type { Chapter, HardConstraintSourceLabel, Task } from '../../../types'
import { useTaskStore } from '../../../stores/task.store'
import { useWritingViewStore, type WritingGenerationStage } from '../../../stores/writingView.store'
import { normalizeEditorText } from './useChapterEditor'
import type { WritingPipelineRole, WritingPipelineSnapshot } from './parsers'
import { getResumablePartialContent } from './chapter-generation-snapshot'

export interface WritingActionError {
  title: string
  message: string
  retry?: () => void
}

export interface ChapterGenerationPreflight {
  ready: boolean
  messages: string[]
}

interface ChapterGenerationProgressEvent {
  chapterId: number
  taskId?: number
  streamTaskId?: number
  role?: WritingPipelineRole
  stage: WritingGenerationStage
  label: string
  detail?: string
  completed: number
  total: number
  status: 'running' | 'success' | 'failed' | 'cancelled'
  pipeline?: WritingPipelineSnapshot
}

interface UseChapterGenerationOptions {
  chapterIdsRef: MutableRefObject<Set<number>>
  currentChapterIdRef: MutableRefObject<number | null>
  currentChapter: Chapter | null
  content: string
  creativeStageId: number | null
  effectiveAiExecutionMode: AiExecutionMode
  preserveConstraintLabels: HardConstraintSourceLabel[]
  latestPipelineTask: Task | null
  currentPipelineSnapshot: WritingPipelineSnapshot | null
  generationPreflightRef: MutableRefObject<ChapterGenerationPreflight | null>
  setLivePipelineSnapshot: Dispatch<SetStateAction<WritingPipelineSnapshot | null>>
  setActionError: Dispatch<SetStateAction<WritingActionError | null>>
  refreshBackgroundChapter(chapterId: number): Promise<void>
  refreshMeta(): Promise<void>
  refreshQualityDashboard(): Promise<void>
  showPreflightWarning(messages: string[]): void
}

function useGenerationProgressEvents(options: UseChapterGenerationOptions & {
  generationBaselineRef: MutableRefObject<string>
  generateRetryRef: MutableRefObject<() => void>
}) {
  const {
    chapterIdsRef,
    currentChapterIdRef,
    generationBaselineRef,
    generateRetryRef,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    setActionError,
    setLivePipelineSnapshot,
  } = options
  const clearStream = useTaskStore((state) => state.clearStream)
  const { completeGeneration, updateGenerationStage, updateGenerationTask } = useWritingViewStore()

  useEffect(() => {
    const unsubscribe = window.electron.on('chapter:generation-progress', (data: unknown) => {
      const payload = data as ChapterGenerationProgressEvent
      if (!Number.isSafeInteger(payload?.chapterId) || !chapterIdsRef.current.has(payload.chapterId)) return
      if (!['running', 'success', 'failed', 'cancelled'].includes(payload.status)) return
      if (payload.pipeline && currentChapterIdRef.current === payload.chapterId) setLivePipelineSnapshot(payload.pipeline)
      if (payload.taskId) updateGenerationTask({ chapterId: payload.chapterId, taskId: payload.taskId })
      updateGenerationStage({
        chapterId: payload.chapterId,
        taskId: payload.taskId,
        streamTaskId: payload.streamTaskId,
        stage: payload.stage,
        status: payload.status === 'failed' ? 'failed' : 'running',
        label: payload.label,
        detail: payload.detail,
      })

      if (payload.status === 'success' && payload.stage === 'completed') {
        if (payload.streamTaskId) clearStream(payload.streamTaskId)
        void (async () => {
          await Promise.all([refreshBackgroundChapter(payload.chapterId), refreshMeta(), refreshQualityDashboard()])
          const latestChapter = await window.electron.chapter.get(payload.chapterId)
          const hasVisibleContentChange = normalizeEditorText(latestChapter?.content || '') !== generationBaselineRef.current
          completeGeneration({
            taskId: payload.taskId,
            chapterId: payload.chapterId,
            status: 'success',
            stage: 'completed',
            label: payload.label || '章节流水线已完成',
            detail: hasVisibleContentChange
              ? getUserFacingMessage('writing.pipelineCompleted')
              : '章节流水线已完成，但正文未产生新增内容。请优先检查合同、审校意见与回写草案。',
          })
          message.success(getUserFacingMessage('writing.pipelineCompleted'))
        })().catch((error) => {
          console.error('Failed to refresh completed chapter generation', error)
          completeGeneration({
            taskId: payload.taskId,
            chapterId: payload.chapterId,
            status: 'success',
            stage: 'completed',
            label: payload.label || '章节流水线已完成',
            detail: getUserFacingMessage('writing.pipelineCompleted'),
          })
          message.success(getUserFacingMessage('writing.pipelineCompleted'))
        })
        return
      }

      if (payload.status !== 'failed' && payload.status !== 'cancelled') return
      if (payload.streamTaskId) clearStream(payload.streamTaskId)
      void Promise.all([refreshBackgroundChapter(payload.chapterId), refreshQualityDashboard()])
        .catch((error) => console.error('Failed to refresh failed chapter generation', error))
      completeGeneration({
        taskId: payload.taskId,
        chapterId: payload.chapterId,
        status: payload.status,
        stage: payload.stage,
        label: payload.status === 'cancelled' ? '章节流水线已取消' : '章节流水线执行失败',
        detail: payload.detail || (payload.status === 'cancelled'
          ? getUserFacingMessage('writing.generateCancelled')
          : getUserFacingMessage('writing.generateFailed')),
        error: payload.status === 'failed'
          ? (payload.detail || getUserFacingMessage('writing.generateFailed'))
          : null,
      })
      if (payload.status === 'cancelled') {
        message.info(getUserFacingMessage('writing.generateCancelled'))
      } else if (currentChapterIdRef.current === payload.chapterId) {
        setActionError({
          title: '章节流水线执行失败',
          message: payload.detail || getUserFacingMessage('writing.generateFailed'),
          retry: () => generateRetryRef.current(),
        })
      } else {
        message.error(getUserFacingMessage('writing.generateFailed'))
      }
    })
    return unsubscribe
  }, [
    chapterIdsRef,
    clearStream,
    completeGeneration,
    currentChapterIdRef,
    generationBaselineRef,
    generateRetryRef,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    setActionError,
    setLivePipelineSnapshot,
    updateGenerationStage,
    updateGenerationTask,
  ])
}

function useGenerationStreamStatus(options: UseChapterGenerationOptions & {
  generationBaselineRef: MutableRefObject<string>
  generateRetryRef: MutableRefObject<() => void>
}) {
  const {
    currentChapterIdRef,
    generationBaselineRef,
    generateRetryRef,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    setActionError,
  } = options
  const clearStream = useTaskStore((state) => state.clearStream)
  const { activeGeneration, completeGeneration } = useWritingViewStore()
  const activeStreamStatus = useTaskStore((state) => (
    activeGeneration.taskId ? state.streams[activeGeneration.taskId]?.status ?? null : null
  ))

  useEffect(() => {
    if (activeGeneration.status !== 'running' || !activeGeneration.taskId || !activeGeneration.chapterId || !activeStreamStatus) return
    const chapterId = activeGeneration.chapterId
    const taskId = activeGeneration.taskId

    if (activeStreamStatus === 'completed') {
      clearStream(taskId)
      void (async () => {
        await Promise.all([refreshBackgroundChapter(chapterId), refreshMeta(), refreshQualityDashboard()])
        const latestChapter = await window.electron.chapter.get(chapterId)
        const hasVisibleContentChange = normalizeEditorText(latestChapter?.content || '') !== generationBaselineRef.current
        completeGeneration({
          taskId,
          chapterId,
          status: 'success',
          stage: 'completed',
          label: '章节流水线已完成',
          detail: hasVisibleContentChange
            ? getUserFacingMessage('writing.pipelineCompleted')
            : '章节流水线已完成，但正文未产生新增内容。请优先检查场景计划与审校建议。',
        })
        message.success(getUserFacingMessage('writing.pipelineCompleted'))
      })().catch((error) => {
        console.error('Failed to refresh completed chapter stream', error)
        completeGeneration({
          taskId,
          chapterId,
          status: 'success',
          stage: 'completed',
          label: '章节流水线已完成',
          detail: getUserFacingMessage('writing.pipelineCompleted'),
        })
        message.success(getUserFacingMessage('writing.pipelineCompleted'))
      })
      return
    }

    if (activeStreamStatus === 'failed') {
      clearStream(taskId)
      void Promise.all([refreshBackgroundChapter(chapterId), refreshQualityDashboard()])
        .catch((error) => console.error('Failed to refresh failed chapter stream', error))
      completeGeneration({
        taskId,
        chapterId,
        status: 'failed',
        stage: activeGeneration.stage,
        label: '章节流水线执行失败',
        detail: activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
        error: activeGeneration.error || activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
      })
      if (currentChapterIdRef.current === chapterId) {
        setActionError({
          title: '章节流水线执行失败',
          message: activeGeneration.error || activeGeneration.detail || getUserFacingMessage('writing.generateFailed'),
          retry: () => generateRetryRef.current(),
        })
      } else {
        message.error(getUserFacingMessage('writing.generateFailed'))
      }
      return
    }

    if (activeStreamStatus !== 'cancelled') return
    clearStream(taskId)
    void refreshBackgroundChapter(chapterId)
      .catch((error) => console.error('Failed to refresh cancelled chapter stream', error))
    completeGeneration({
      taskId,
      chapterId,
      status: 'cancelled',
      stage: activeGeneration.stage,
      label: '章节流水线已取消',
      detail: getUserFacingMessage('writing.generateCancelled'),
    })
    message.info(getUserFacingMessage('writing.generateCancelled'))
  }, [
    activeGeneration,
    activeStreamStatus,
    clearStream,
    completeGeneration,
    currentChapterIdRef,
    generateRetryRef,
    generationBaselineRef,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    setActionError,
  ])
}

export function useChapterGeneration(options: UseChapterGenerationOptions) {
  const {
    content,
    creativeStageId,
    currentChapter,
    currentPipelineSnapshot,
    effectiveAiExecutionMode,
    generationPreflightRef,
    latestPipelineTask,
    preserveConstraintLabels,
    setActionError,
    showPreflightWarning,
  } = options
  const clearStream = useTaskStore((state) => state.clearStream)
  const {
    activeGeneration,
    lastGenerationByChapter,
    startGeneration,
    updateGenerationTask,
    updateGenerationStage,
    completeGeneration,
  } = useWritingViewStore()
  const generationBaselineRef = useRef('')
  const generationStartingRef = useRef(false)
  const generateRetryRef = useRef<() => void>(() => {})
  const resumeRetryRef = useRef<() => void>(() => {})
  const resumablePartialContent = getResumablePartialContent(currentPipelineSnapshot)
  const hasResumablePartialContent = Boolean(currentChapter && resumablePartialContent)

  useGenerationProgressEvents({ ...options, generationBaselineRef, generateRetryRef })
  useGenerationStreamStatus({ ...options, generationBaselineRef, generateRetryRef })

  const generate = useCallback(async () => {
    if (!currentChapter) {
      message.warning(getUserFacingMessage('writing.selectChapterFirst'))
      return
    }
    if (generationStartingRef.current || activeGeneration.status === 'running') return
    const preflight = generationPreflightRef.current
    if (preflight && !preflight.ready) {
      showPreflightWarning(preflight.messages)
      return
    }
    generationStartingRef.current = true
    generationBaselineRef.current = normalizeEditorText(currentChapter.content || content)
    setActionError(null)
    startGeneration({ chapterId: currentChapter.id })
    updateGenerationStage({
      chapterId: currentChapter.id,
      stage: 'planning',
      label: '正在启动章节流水线',
      detail: `正在创建任务，并按「${getAiExecutionModeLabel(effectiveAiExecutionMode)}」模式准备本章场景计划与上下文注入。`,
    })
    try {
      const taskId = await window.electron.chapter.generateContent(currentChapter.id, {
        executionMode: effectiveAiExecutionMode,
        preserveConstraintLabels,
        stageId: creativeStageId || undefined,
      })
      updateGenerationTask({ chapterId: currentChapter.id, taskId })
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'writing.configureModelFirst')
      completeGeneration({ chapterId: currentChapter.id, status: 'failed', stage: 'planning', label: '章节流水线启动失败', detail: errorMessage, error: errorMessage })
      setActionError({ title: '章节流水线启动失败', message: errorMessage, retry: () => generateRetryRef.current() })
    } finally {
      generationStartingRef.current = false
    }
  }, [
    activeGeneration.status,
    completeGeneration,
    content,
    creativeStageId,
    currentChapter,
    effectiveAiExecutionMode,
    generationPreflightRef,
    preserveConstraintLabels,
    setActionError,
    showPreflightWarning,
    startGeneration,
    updateGenerationStage,
    updateGenerationTask,
  ])

  useEffect(() => {
    generateRetryRef.current = () => void generate()
  }, [generate])

  const resume = useCallback(async () => {
    if (!currentChapter || !latestPipelineTask?.id || !hasResumablePartialContent) return
    if (generationStartingRef.current || activeGeneration.status === 'running') return
    generationStartingRef.current = true
    generationBaselineRef.current = normalizeEditorText(resumablePartialContent)
    setActionError(null)
    startGeneration({ chapterId: currentChapter.id, taskId: latestPipelineTask.id })
    updateGenerationStage({
      chapterId: currentChapter.id,
      taskId: latestPipelineTask.id,
      stage: 'drafting',
      label: '正在从断点继续',
      detail: '系统将基于已保留正文继续补齐本章，不会从头重写前文。',
    })
    try {
      const taskId = await window.electron.chapter.resumeContent(latestPipelineTask.id)
      updateGenerationTask({ chapterId: currentChapter.id, taskId })
      message.success(getUserFacingMessage('writing.resumedFromDraft'))
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error, 'writing.generateFailed')
      completeGeneration({ chapterId: currentChapter.id, status: 'failed', stage: 'drafting', label: '断点续写启动失败', detail: errorMessage, error: errorMessage })
      setActionError({ title: '断点续写启动失败', message: errorMessage, retry: () => resumeRetryRef.current() })
    } finally {
      generationStartingRef.current = false
    }
  }, [
    activeGeneration.status,
    completeGeneration,
    currentChapter,
    hasResumablePartialContent,
    latestPipelineTask?.id,
    resumablePartialContent,
    setActionError,
    startGeneration,
    updateGenerationStage,
    updateGenerationTask,
  ])

  useEffect(() => {
    resumeRetryRef.current = () => void resume()
  }, [resume])

  const cancel = useCallback(async () => {
    if (!activeGeneration.taskId || !activeGeneration.chapterId) return
    await window.electron.task.cancel(activeGeneration.taskId)
    if (activeGeneration.streamTaskId) clearStream(activeGeneration.streamTaskId)
    completeGeneration({
      taskId: activeGeneration.taskId,
      chapterId: activeGeneration.chapterId,
      status: 'cancelled',
      stage: activeGeneration.stage,
      label: '章节流水线已取消',
      detail: getUserFacingMessage('writing.generateCancelled'),
    })
  }, [activeGeneration, clearStream, completeGeneration])

  return {
    activeGeneration,
    lastGenerationByChapter,
    generate,
    restart: generate,
    resume,
    cancel,
    resumablePartialContent,
    hasResumablePartialContent,
  }
}
