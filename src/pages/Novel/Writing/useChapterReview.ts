import { useCallback } from 'react'
import { message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Dispatch, SetStateAction } from 'react'
import type { AiExecutionMode } from '../../../shared/ai-execution'
import type { Chapter, ChapterOptimizeResult, ChapterPublishCheck } from '../../../types'
import type { WritingActionError } from './useChapterGeneration'
import type { AiCheckPayload } from './parsers'
import type { WritingRouteKey } from './components/InsightPanel'
import { normalizeEditorText, type TextSelectionSnapshot } from './useChapterEditor'
import { canApplyChapterOptimization } from './chapter-review-policy'
import { useChapterPublication } from './useChapterPublication'

interface UseChapterReviewOptions {
  novelId: number
  currentChapter: Chapter | null
  selectedSnippet: TextSelectionSnapshot | null
  hasMultiSegments: boolean
  editorText(): string
  modelConfigId?: number
  effectiveAiExecutionMode: AiExecutionMode
  rewriteRequirements: string
  optimizeRequirements: string
  optimizationResult: ChapterOptimizeResult | null
  selectedVersionId: number | null
  setCurrentChapter: Dispatch<SetStateAction<Chapter | null>>
  setAiResult: Dispatch<SetStateAction<AiCheckPayload | null>>
  setPublishCheck: Dispatch<SetStateAction<ChapterPublishCheck | null>>
  setRewriteRequirements: Dispatch<SetStateAction<string>>
  setRewriteModalOpen: Dispatch<SetStateAction<boolean>>
  setRewritingSelection: Dispatch<SetStateAction<boolean>>
  setOptimizingChapter: Dispatch<SetStateAction<boolean>>
  setApplyingOptimizedChapter: Dispatch<SetStateAction<boolean>>
  setOptimizeModalOpen: Dispatch<SetStateAction<boolean>>
  setOptimizationResult: Dispatch<SetStateAction<ChapterOptimizeResult | null>>
  setActionError: Dispatch<SetStateAction<WritingActionError | null>>
  navigate(path: string): void
  navigateToWritingRoute(route: WritingRouteKey): void
  applyChapterContent(text: string, versionSource?: 'manual-save' | 'ai-rewrite'): void
  commitContentState(text: string): string
  saveNow(chapterId: number, text: string, versionSource?: 'manual-save' | 'ai-rewrite'): Promise<void>
  loadChapters(preferredChapterId?: number): Promise<void>
  refreshMeta(): Promise<void>
  refreshContextStatus(): Promise<void>
  refreshQualityDashboard(): Promise<void>
  refreshVersionHistory(chapterId: number, isCurrent?: () => boolean): Promise<void>
  notifyWorkspaceMutation(): void
}

export function useChapterReview(options: UseChapterReviewOptions) {
  const publication = useChapterPublication(options)
  const {
    applyChapterContent,
    commitContentState,
    currentChapter,
    editorText,
    effectiveAiExecutionMode,
    hasMultiSegments,
    modelConfigId,
    navigateToWritingRoute,
    novelId,
    optimizationResult,
    optimizeRequirements,
    refreshQualityDashboard,
    refreshVersionHistory,
    rewriteRequirements,
    saveNow,
    selectedSnippet,
    setActionError,
    setAiResult,
    setApplyingOptimizedChapter,
    setOptimizationResult,
    setOptimizeModalOpen,
    setOptimizingChapter,
    setRewriteModalOpen,
    setRewriteRequirements,
    setRewritingSelection,
  } = options

  const runAiCheck = useCallback(async () => {
    if (!currentChapter) return
    setActionError(null)
    try {
      setAiResult(await window.electron.chapter.aiCheck(currentChapter.id) as AiCheckPayload)
      navigateToWritingRoute('review')
      await refreshQualityDashboard()
    } catch (error: unknown) {
      setActionError({
        title: '章节审校失败',
        message: getUserFacingMessage('writing.aiCheckFailed', {
          detail: error instanceof Error ? error.message : '请稍后重试。',
        }),
        retry: () => void runAiCheck(),
      })
    }
  }, [currentChapter, navigateToWritingRoute, refreshQualityDashboard, setActionError, setAiResult])

  const openRewriteModal = useCallback(() => {
    if (!currentChapter || !selectedSnippet?.text) {
      message.warning(getUserFacingMessage('writing.selectSnippetFirst'))
      return
    }
    setRewriteRequirements('')
    setRewriteModalOpen(true)
  }, [currentChapter, selectedSnippet?.text, setRewriteModalOpen, setRewriteRequirements])

  const rewriteSelectedText = useCallback(async () => {
    if (!currentChapter || !selectedSnippet?.text) return
    const latestText = editorText()
    const before = latestText.slice(0, selectedSnippet.start)
    const after = latestText.slice(selectedSnippet.end)
    setRewritingSelection(true)
    try {
      const rewritten = normalizeEditorText(await window.electron.ai.rewriteParagraph({
        originalParagraph: selectedSnippet.text,
        contextBefore: before.slice(-800),
        specificRequirements: rewriteRequirements.trim() || '保持事件与设定不变，重点修语言自然度、逻辑衔接和人类表达。',
        modelConfigId,
        novelId,
        executionMode: effectiveAiExecutionMode,
      }) as string)
      if (!rewritten.trim()) {
        message.warning(getUserFacingMessage('writing.rewriteNoResult'))
        return
      }
      applyChapterContent(`${before}${rewritten}${after}`, 'ai-rewrite')
      setRewriteModalOpen(false)
      navigateToWritingRoute('review')
      message.success(getUserFacingMessage('writing.rewriteApplied'))
    } catch (error: unknown) {
      message.error(getUserFacingMessage('writing.rewriteFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试。',
      }))
    } finally {
      setRewritingSelection(false)
    }
  }, [
    applyChapterContent,
    currentChapter,
    editorText,
    effectiveAiExecutionMode,
    modelConfigId,
    navigateToWritingRoute,
    novelId,
    rewriteRequirements,
    selectedSnippet,
    setRewriteModalOpen,
    setRewritingSelection,
  ])

  const optimizeChapter = useCallback(async () => {
    if (!currentChapter || hasMultiSegments) return
    const latestText = editorText()
    setOptimizingChapter(true)
    setActionError(null)
    try {
      await saveNow(currentChapter.id, latestText)
      const result = await window.electron.chapter.optimizeContent(currentChapter.id, {
        executionMode: effectiveAiExecutionMode,
        extraRequirements: optimizeRequirements.trim(),
      })
      setOptimizationResult(result)
      setOptimizeModalOpen(true)
      navigateToWritingRoute('review')
    } catch (error: unknown) {
      setActionError({
        title: '整章优化失败',
        message: getErrorMessage(error, 'writing.optimizeFailed'),
        retry: () => void optimizeChapter(),
      })
    } finally {
      setOptimizingChapter(false)
    }
  }, [
    currentChapter,
    editorText,
    effectiveAiExecutionMode,
    hasMultiSegments,
    navigateToWritingRoute,
    optimizeRequirements,
    saveNow,
    setActionError,
    setOptimizationResult,
    setOptimizeModalOpen,
    setOptimizingChapter,
  ])

  const applyOptimizedChapter = useCallback(async () => {
    if (!currentChapter || !optimizationResult?.optimizedContent.trim()) return
    if (!canApplyChapterOptimization(optimizationResult)) {
      message.warning(getUserFacingMessage('writing.optimizeBlockedByQuality'))
      return
    }
    setApplyingOptimizedChapter(true)
    try {
      const normalized = normalizeEditorText(optimizationResult.optimizedContent)
      await saveNow(currentChapter.id, normalized, 'ai-rewrite')
      commitContentState(normalized)
      await Promise.all([refreshQualityDashboard(), refreshVersionHistory(currentChapter.id)])
      setOptimizeModalOpen(false)
      setOptimizationResult(null)
      message.success(getUserFacingMessage('writing.optimizeApplied'))
    } catch (error) {
      message.error(getErrorMessage(error, 'writing.optimizeApplyFailed'))
    } finally {
      setApplyingOptimizedChapter(false)
    }
  }, [
    commitContentState,
    currentChapter,
    optimizationResult,
    refreshQualityDashboard,
    refreshVersionHistory,
    saveNow,
    setApplyingOptimizedChapter,
    setOptimizationResult,
    setOptimizeModalOpen,
  ])

  return {
    runAiCheck,
    openRewriteModal,
    rewriteSelectedText,
    optimizeChapter,
    applyOptimizedChapter,
    ...publication,
  }
}
