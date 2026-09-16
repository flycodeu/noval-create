import type { PassageFeedbackInput } from './components/ReaderFeedbackPanel'
import { createReaderFeedbackSourceRef } from '../../../shared/reader-feedback'
import { useCallback, useRef, useState } from 'react'
import { message } from 'antd'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { Dispatch, SetStateAction } from 'react'
import type { AiExecutionMode } from '../../../shared/ai-execution'
import type { Chapter, ChapterOptimizeResult, ChapterPublishCheck, ChapterVersion } from '../../../types'
import type { WritingActionError } from './useChapterGeneration'
import type { AiCheckPayload } from './parsers'
import type { WritingRouteKey } from './components/InsightPanel'
import { normalizeEditorText, type TextSelectionSnapshot } from './useChapterEditor'
import { canApplyChapterOptimization } from './chapter-review-policy'
import { applyRevisionPatch, buildRevisionPatchArtifactHash, type RevisionPatch } from '../../../shared/revision-patch'
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
  selectedVersion?: ChapterVersion | null
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
  saveNow(chapterId: number, text: string, versionSource?: 'manual-save' | 'ai-rewrite', expectedContent?: string): Promise<void>
  currentChapterIdRef: { current: number | null }
  loadChapters(preferredChapterId?: number): Promise<void>
  refreshMeta(): Promise<void>
  refreshContextStatus(): Promise<void>
  refreshQualityDashboard(): Promise<void>
  refreshVersionHistory(chapterId: number, isCurrent?: () => boolean): Promise<void>
  notifyWorkspaceMutation(): void
}

export function useChapterReview(options: UseChapterReviewOptions) {
  const publication = useChapterPublication(options)
  const [rewriteCandidate, setRewriteCandidate] = useState<{ chapterId: number; original: string; replacement: string; patch: RevisionPatch } | null>(null)
  const {
    applyChapterContent,
    commitContentState,
    currentChapter,
    currentChapterIdRef,
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
  const rewriteRequestEpoch = useRef(0)
  const optimizationChapterIdRef = useRef<number | null>(null)

  const runAiCheck = useCallback(async () => {
    if (!currentChapter) return
    const chapterId = currentChapter.id
    setActionError(null)
    try {
      const result = await window.electron.chapter.aiCheck(chapterId) as AiCheckPayload
      if (currentChapterIdRef.current !== chapterId) return
      setAiResult(result)
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
  }, [currentChapter, currentChapterIdRef, navigateToWritingRoute, refreshQualityDashboard, setActionError, setAiResult])

  const openRewriteModal = useCallback(() => {
    if (!currentChapter || !selectedSnippet?.text) {
      message.warning(getUserFacingMessage('writing.selectSnippetFirst'))
      return
    }
    rewriteRequestEpoch.current += 1
    setRewriteCandidate(null)
    setRewriteRequirements('')
    setRewriteModalOpen(true)
  }, [currentChapter, selectedSnippet?.text, setRewriteModalOpen, setRewriteRequirements])

  const rewriteSelectedText = useCallback(async () => {
    if (!currentChapter || !selectedSnippet?.text) return
    const chapterId = currentChapter.id
    const epoch = rewriteRequestEpoch.current
    const latestText = editorText()
    const before = latestText.slice(0, selectedSnippet.start)
    if (latestText.slice(selectedSnippet.start, selectedSnippet.end) !== selectedSnippet.text) {
      message.warning('选区已变化，请重新选择。')
      return
    }
    setRewritingSelection(true)
    try {
      const rewritten = normalizeEditorText(await window.electron.ai.rewriteParagraph({
        chapterId,
        originalParagraph: selectedSnippet.text,
        contextBefore: before.slice(-800),
        specificRequirements: rewriteRequirements.trim() || '保持事件与设定不变，重点修语言自然度、逻辑衔接和人类表达。',
        modelConfigId,
        novelId,
        executionMode: effectiveAiExecutionMode,
      }) as string)
      if (currentChapterIdRef.current !== chapterId || epoch !== rewriteRequestEpoch.current) return
      if (!rewritten.trim()) {
        message.warning(getUserFacingMessage('writing.rewriteNoResult'))
        return
      }
      setRewriteCandidate({ chapterId, original: selectedSnippet.text, replacement: rewritten, patch: {
        baseArtifactHash: buildRevisionPatchArtifactHash(latestText),
        patches: [{ start: selectedSnippet.start, end: selectedSnippet.end, expectedText: selectedSnippet.text, replacement: rewritten, issueIds: ['author-selection'] }],
      } })
    } catch (error: unknown) {
      message.error(getUserFacingMessage('writing.rewriteFailed', {
        detail: error instanceof Error ? error.message : '请稍后重试。',
      }))
    } finally {
      setRewritingSelection(false)
    }
  }, [
    currentChapter,
    currentChapterIdRef,
    editorText,
    effectiveAiExecutionMode,
    modelConfigId,
    novelId,
    rewriteRequirements,
    selectedSnippet,
    setRewritingSelection,
  ])

  const applyRewriteCandidate = useCallback(() => {
    if (!rewriteCandidate || currentChapterIdRef.current !== rewriteCandidate.chapterId) return
    try {
      const original = editorText()
      const locked: unknown = JSON.parse(currentChapter?.lockedParagraphsJson || '[]')
      const ranges: Array<{ start: number; end: number }> = []
      if (Array.isArray(locked)) for (const paragraph of locked) {
        if (typeof paragraph !== 'string' || !paragraph) continue
        for (let start = original.indexOf(paragraph); start >= 0; start = original.indexOf(paragraph, start + paragraph.length)) ranges.push({ start, end: start + paragraph.length })
      }
      const text = applyRevisionPatch(original, rewriteCandidate.patch, ranges)
      applyChapterContent(text, 'ai-rewrite')
      setRewriteCandidate(null)
      setRewriteModalOpen(false)
      navigateToWritingRoute('review')
    } catch {
      message.warning('原稿已变化或候选触及锁定文段，请重新选择。')
    }
  }, [rewriteCandidate, currentChapter, currentChapterIdRef, editorText, applyChapterContent, setRewriteModalOpen, navigateToWritingRoute])

  const savePassageFeedback = useCallback(async (input: PassageFeedbackInput) => {
    if (!currentChapter || !selectedSnippet || currentChapterIdRef.current !== currentChapter.id) return
    const text = editorText()
    if (text.slice(selectedSnippet.start, selectedSnippet.end) !== selectedSnippet.text) throw new Error('选区已变化，请重新选择。')
    const source = createReaderFeedbackSourceRef(text, currentChapter.id, selectedSnippet.start, selectedSnippet.end)
    await saveNow(currentChapter.id, text)
    await window.electron.novel.saveReaderFeedback(novelId, { ...input, chapterId: currentChapter.id, start: source.start, end: source.end, expectedContentHash: source.contentHash })
  }, [currentChapter, currentChapterIdRef, selectedSnippet, editorText, saveNow, novelId])

  const optimizeChapter = useCallback(async () => {
    if (!currentChapter || hasMultiSegments) return
    const chapterId = currentChapter.id
    const latestText = editorText()
    setOptimizingChapter(true)
    setActionError(null)
    try {
      await saveNow(chapterId, latestText)
      const result = await window.electron.chapter.optimizeContent(chapterId, {
        executionMode: effectiveAiExecutionMode,
        extraRequirements: optimizeRequirements.trim(),
      })
      if (currentChapterIdRef.current !== chapterId) return
      optimizationChapterIdRef.current = chapterId
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
    currentChapterIdRef,
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
    if (optimizationChapterIdRef.current !== currentChapter.id) {
      message.warning(getUserFacingMessage('writing.optimizeWrongChapter'))
      setOptimizeModalOpen(false)
      setOptimizationResult(null)
      return
    }
    if (!canApplyChapterOptimization(optimizationResult)) {
      message.warning(getUserFacingMessage('writing.optimizeBlockedByQuality'))
      return
    }
    if (normalizeEditorText(editorText()) !== normalizeEditorText(optimizationResult.originalContent)) {
      message.warning(getUserFacingMessage('chapter.pipelineContentConflict'))
      return
    }
    setApplyingOptimizedChapter(true)
    const chapterId = currentChapter.id
    try {
      const normalized = normalizeEditorText(optimizationResult.optimizedContent)
      await saveNow(chapterId, normalized, 'ai-rewrite', optimizationResult.originalContent)
      if (currentChapterIdRef.current !== chapterId) {
        setOptimizeModalOpen(false)
        setOptimizationResult(null)
        return
      }
      if (normalizeEditorText(editorText()) === normalizeEditorText(optimizationResult.originalContent)) commitContentState(normalized)
      await Promise.all([refreshQualityDashboard(), refreshVersionHistory(chapterId)])
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
    currentChapterIdRef,
    optimizationResult,
    editorText,
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
    rewriteCandidate: rewriteCandidate ? { ...rewriteCandidate, stale: currentChapter?.id !== rewriteCandidate.chapterId || buildRevisionPatchArtifactHash(editorText()) !== rewriteCandidate.patch.baseArtifactHash } : null,
    savePassageFeedback,
    applyRewriteCandidate,
    optimizeChapter,
    applyOptimizedChapter,
    ...publication,
  }
}
