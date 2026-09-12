import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Modal, message } from 'antd'
import { getErrorMessage } from '@/utils/user-facing-message'
import { formatStaleReasonsSummary } from '../../../shared/context-change-reasons'
import { type AiExecutionMode } from '../../../shared/ai-execution'
import { parseStorySettingsSnapshot } from '../../../shared/story-settings'
import type {
  HardConstraintSourceLabel,
  ChapterPublishCheck,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { useChapterEditor } from './useChapterEditor'
import { useWritingRouteState } from './useWritingRouteState'
import { useWritingWorkspaceData } from './useWritingWorkspaceData'
import { useChapterReview } from './useChapterReview'
import { useChapterWriteback } from './useChapterWriteback'
import { useChapterGeneration, type WritingActionError } from './useChapterGeneration'
import WritingModals from './components/WritingModals'
import WritingWorkspaceLayout from './components/WritingWorkspaceLayout'
import { useWritingInspectorComposition } from './useWritingInspectorComposition'
import { useWritingPipelineItems } from './useWritingPipelineItems'
import { useWritingChapterCrudController } from './useWritingChapterCrudController'
import { useWritingCommandBindings } from './useWritingCommandBindings'
import { useWritingContractSections } from './useWritingContractSections'
import { useWritingEditorLifecycle } from './useWritingEditorLifecycle'
import { useWritingHistoryLifecycle } from './useWritingHistoryLifecycle'
import { useWritingPresentationModel } from './useWritingPresentationModel'
import {
  useWritingEditorRuntimePresentation,
  useWritingPreGenerationPresentation,
} from './useWritingRuntimePresentation'
import { hasMultipleChapterSegments } from './writing-runtime-presentation'
import { useWritingWorkspaceActionController } from './useWritingWorkspaceActionController'
import { buildEditorHeaderViewModel, getWritebackPhaseLabel } from './writing-chapter-presentation'
import { useWritingChapterReadiness } from './useWritingChapterReadiness'
import { useWritingReviewState } from './useWritingReviewState'
import { buildWritingViewComposition } from './writing-view-composition'
import './index.css'

interface Props {
  novelId: number
}

const getPublishCheckAlertType = (check: ChapterPublishCheck | null) => {
  if (!check) return 'info'
  if (check.gateLevel === 'rewrite' || check.gateLevel === 'blocker') return 'error'
  if (check.gateLevel === 'warning') return 'warning'
  return 'success'
}
export default function Writing({ novelId }: Props) {
  const { activeWritingRoute, creativeStageId, navigate, navigateToWritingRoute, routeChapterId, setCreativeStageId, setRouteChapterId } = useWritingRouteState(novelId)
  const { notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const setCurrentNovel = useNovelStore((state) => state.setCurrentNovel)
  const updateChapter = useNovelStore((state) => state.updateChapter)
  const chapterEditor = useChapterEditor()
  const {
    editorRef,
    content,
    wordCount,
    selectedSnippet,
    setSelectedSnippet,
    loadContent: loadEditorContent,
    applyInput: applyEditorInput,
    commitContentState,
    syncSelection: syncEditorSelection,
    undo: undoEditor,
    redo: redoEditor,
  } = chapterEditor
  const [preserveConstraintLabels, setPreserveConstraintLabels] = useState<HardConstraintSourceLabel[]>([])
  const [generationExecutionModeOverride, setGenerationExecutionModeOverride] = useState<AiExecutionMode | 'follow_default'>('follow_default')
  const [insightPanelOpen, setInsightPanelOpen] = useState(false)
  // 正文优先：修订建议/验收提示默认折叠在编辑器下方，避免把正文挤出首屏。
  const [advisoryPanelOpen, setAdvisoryPanelOpen] = useState(false)
  // 主链路失败提示常驻编辑器区域，替代一闪而过的 message.error。
  const [actionError, setActionError] = useState<WritingActionError | null>(null)
  const reviewState = useWritingReviewState()
  const {
    gateReportExpanded,
    optimizeModalOpen,
    optimizingChapter,
    publishCheck,
    rewriteModalOpen,
    rewritingSelection,
    setGateReportExpanded,
    setOptimizeModalOpen,
    setPublishCheck,
    setRewriteModalOpen,
  } = reviewState
  const storySettings = useMemo(() => parseStorySettingsSnapshot(currentNovel?.settingsJson), [currentNovel?.settingsJson])
  const defaultAiExecutionMode = storySettings.aiDefaultMode
  const effectiveAiExecutionMode = generationExecutionModeOverride === 'follow_default' ? defaultAiExecutionMode : generationExecutionModeOverride
  const isHistoryRoute = activeWritingRoute === 'history'
  const preserveEditorContentRef = useRef(false)
  const shouldPreserveEditorContent = useCallback(() => preserveEditorContentRef.current, [])
  const workspaceData = useWritingWorkspaceData({
    novelId,
    routeChapterId,
    creativeStageId,
    effectiveAiExecutionMode,
    preserveConstraintLabels,
    loadEditorContent,
    setSelectedSnippet,
    setActionError,
    setPublishCheck,
    resetChapterReview: reviewState.resetChapterReview,
    shouldPreserveEditorContent,
  })
  const {
    currentChapter, setCurrentChapter,
    consistencyReport, storyMemory, qualityDashboard, contextStatus,
    storyFacts, storyVolumes, chapterCharacters, foreshadowLedger, setForeshadowLedger,
    timelineEvents, storyItems, chapterSegments, aiResult, setAiResult,
    foreshadowSnapshot, chapterContextPreview, chapterContextPreviewError, latestPipelineTask,
    clearChapterArtifacts, refreshChapterContextPreview, refreshContextStatus,
    refreshForeshadowSnapshot, refreshMeta, refreshPublishCheck, refreshQualityDashboard,
    chapters, currentChapterId, currentChapterIdRef, chapterIdsRef,
    loading, refreshing, loadChapters, refreshBackgroundChapter,
    selectChapter: selectWorkspaceChapter,
  } = workspaceData
  const hasMultiSegments = hasMultipleChapterSegments(currentChapter)
  const mountedEditorRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (mountedEditorRef.current === editorRef.current) return
    mountedEditorRef.current = editorRef.current
    // The initial query can finish before the editor mounts. Reattach its
    // owner's text only for a new DOM node; metadata refresh keeps selection/undo.
    if (editorRef.current) commitContentState(content)
  }, [commitContentState, content, currentChapter?.id, editorRef, hasMultiSegments])
  const editorLifecycle = useWritingEditorLifecycle({
    currentChapter,
    content,
    editorRef,
    currentChapterIdRef,
    applyEditorInput,
    commitContentState,
    syncEditorSelection,
    undoEditor,
    redoEditor,
    updateChapter,
    refreshContextStatus,
    refreshPublishCheck,
    registerSaveHandler,
    clearChapterArtifacts,
  })
  const {
    applyChapterContent,
    getEditorText,
    handleCompositionEnd,
    handleCompositionStart,
    handleContentChange,
    handleSaveCurrentChapter,
    hasUnsavedChanges,
    saveCoordinator,
    saveState,
    saveNow,
    syncSelectedSnippet,
  } = editorLifecycle
  useEffect(() => {
    preserveEditorContentRef.current = hasUnsavedChanges
  }, [hasUnsavedChanges])
  const chapterCrud = useWritingChapterCrudController({
    novelId,
    chapters,
    currentChapter,
    volumes: storyVolumes,
    saveCoordinator,
    selectWorkspaceChapter,
    loadChapters,
    refreshMeta,
    refreshContextStatus,
  })
  const {
    addChapter: handleAddChapter,
    deleteChapter: handleDeleteChapter,
    selectChapter: selectWorkspaceChapterById,
  } = chapterCrud
  const handleSelectChapter = useCallback(async (chapterId: number) => {
    setRouteChapterId(chapterId)
    await selectWorkspaceChapterById(chapterId)
  }, [selectWorkspaceChapterById, setRouteChapterId])
  const handleGuardedSelectChapter = useCallback((chapterId: number) => {
    if (!hasUnsavedChanges || currentChapter?.id === chapterId) {
      void handleSelectChapter(chapterId)
      return
    }
    Modal.confirm({
      title: '正文还有未保存修改',
      content: '保存当前章节后再切换，避免刚输入的正文丢失。',
      okText: '保存并切换',
      cancelText: '留在当前章',
      onOk: async () => {
        const saved = await handleSaveCurrentChapter()
        if (saved) await handleSelectChapter(chapterId)
      },
    })
  }, [currentChapter?.id, handleSaveCurrentChapter, handleSelectChapter, hasUnsavedChanges])
  const handleGuardedAddChapter = useCallback((volumeId?: number | null) => {
    if (!hasUnsavedChanges) {
      void handleAddChapter(volumeId)
      return
    }
    Modal.confirm({
      title: '正文还有未保存修改',
      content: '保存当前章节后再新建，避免刚输入的正文丢失。',
      okText: '保存并新建',
      cancelText: '留在当前章',
      onOk: async () => {
        const saved = await handleSaveCurrentChapter()
        if (saved) await handleAddChapter(volumeId)
      },
    })
  }, [handleAddChapter, handleSaveCurrentChapter, hasUnsavedChanges])

  const presentation = useWritingPresentationModel({
    currentChapter,
    currentNovel,
    chapters,
    timelineEvents,
    storyItems,
    storyFacts,
    storyVolumes,
    consistencyReport,
    publishCheck,
    qualityDashboard,
    aiResult,
  })
  const {
    contractAudit: currentContractAudit,
    events: relatedEvents,
    productionBriefItems,
    reviewNotes,
    scenePlan,
    staleReasons: currentChapterStaleReasons,
    truthStats: currentVolumeTruthStats,
  } = presentation
  const preGenerationPresentation = useWritingPreGenerationPresentation({
    currentChapter,
    foreshadowSnapshot,
    chapterContextPreview,
  })
  const {
    dueForeshadow: {
      items: dueForeshadowItems,
    },
    writebackStatus: currentWritebackStatus,
  } = preGenerationPresentation
  const chapterReadiness = useWritingChapterReadiness({
    chapter: currentChapter,
    publishCheck,
    sceneCount: scenePlan.length,
    chapterSegments,
    storyMemory,
    chapterCharacters,
    relatedEvents,
    staleReasonCount: currentChapterStaleReasons.length,
    dueForeshadowCount: dueForeshadowItems.length,
    contextStatus,
    writebackStatus: currentWritebackStatus,
  })
  const { generationPreflight, writability: chapterWritability } = chapterReadiness

  const generationPreflightWarning = useCallback((messages: string[]) => {
    Modal.warning({
      title: '当前章节暂不适合生成',
      okText: '知道了',
      content: (
        <div className="novel-note-list">
          {messages.slice(0, 6).map((item) => (
            <div key={item} className="novel-note-list__item">
              {item}
            </div>
          ))}
        </div>
      ),
    })
  }, [])
  const chapterGeneration = useChapterGeneration({
    chapterIdsRef,
    currentChapterIdRef,
    currentChapter,
    content,
    creativeStageId,
    effectiveAiExecutionMode,
    preserveConstraintLabels,
    latestPipelineTask,
    generationPreflight,
    setActionError,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    showPreflightWarning: generationPreflightWarning,
    flushEditor: async (chapterId, text) => {
      try {
        await saveNow(chapterId, text)
        return true
      } catch (error) {
        console.error(error)
        message.error(getErrorMessage(error, 'writing.saveFailed'))
        return false
      }
    },
  })
  const {
    pipelineRuntime,
    activeGeneration,
    lastGenerationByChapter,
    generate: handleGenerateContent,
    restart: handleRestartGeneration,
    resume: handleResumePartialContent,
    cancel: handleCancelGenerate,
    resumablePartialContent,
    hasResumablePartialContent,
  } = chapterGeneration
  const currentPipelineSnapshot = pipelineRuntime.snapshot
  const historyLifecycle = useWritingHistoryLifecycle({
    currentChapter,
    currentChapterIdRef,
    isHistoryRoute,
    optimizeModalOpen,
    rewriteModalOpen,
    setOptimizeModalOpen,
    setRewriteModalOpen,
    navigateToWritingRoute,
    registerEscapeHandler,
  })
  const {
    loading: versionHistoryLoading,
    refreshVersionHistory,
    selectedVersion,
    selectedVersionId,
    setSelectedVersionId,
    versions: chapterVersions,
  } = historyLifecycle

  const workspaceActions = useWritingWorkspaceActionController({
    currentChapter,
    currentChapterIdRef,
    currentNovel,
    setCurrentNovel,
    loadChapters,
    refreshMeta,
    refreshContextStatus,
    refreshChapterContextPreview,
  })
  const {
    changeDefaultAiMode: handleDefaultAiModeChange,
    compileChapter: handleCompileCurrentChapter,
    savingAiMode,
  } = workspaceActions

  const chapterReview = useChapterReview({
    novelId,
    currentChapter,
    currentChapterIdRef,
    selectedSnippet,
    hasMultiSegments,
    editorText: getEditorText,
    modelConfigId: currentNovel?.modelConfigId,
    effectiveAiExecutionMode,
    selectedVersionId,
    selectedVersion,
    ...reviewState,
    setCurrentChapter,
    setAiResult,
    setActionError,
    navigate,
    navigateToWritingRoute,
    applyChapterContent,
    commitContentState,
    saveNow,
    loadChapters,
    refreshMeta,
    refreshContextStatus,
    refreshQualityDashboard,
    refreshVersionHistory,
    notifyWorkspaceMutation,
  })
  const {
    runAiCheck: handleAiCheck,
    openRewriteModal: handleOpenRewriteModal,
    optimizeChapter: handleOptimizeChapter,
    openGateIssue: handleOpenGateIssue,
    changeStatus: handleStatusChange,
    restoreVersion: handleRestoreVersion,
  } = chapterReview

  const chapterWriteback = useChapterWriteback({
    novelId,
    currentChapter,
    setCurrentChapter,
    setForeshadowLedger,
    updateChapter,
    refreshForeshadowSnapshot,
    notifyWorkspaceMutation,
  })
  const {
    updatingRevealConstraints,
    updatingForeshadowWriteback,
    updateRevealConstraints: handleUpdateRevealConstraints,
    createForeshadowWriteback: handleCreateForeshadowWriteback,
    patchForeshadowWriteback: handlePatchForeshadowWriteback,
    deleteForeshadowWriteback: handleDeleteForeshadowWriteback,
  } = chapterWriteback

  const editorRuntime = useWritingEditorRuntimePresentation({
    currentChapter,
    activeGeneration,
    lastGenerationByChapter,
    productionBriefCount: productionBriefItems.length,
    staleReasonCount: currentChapterStaleReasons.length,
    publishCheck,
    hasMultiSegments,
    writebackStatus: currentWritebackStatus,
  })
  const {
    advisoryCount: editorAdvisoryCount,
    generating: currentChapterGenerating,
  } = editorRuntime

  const inspector = useWritingInspectorComposition({
    novelId,
    chapter: currentChapter,
    novel: currentNovel,
    effectiveAiExecutionMode,
    presentation,
    pipeline: pipelineRuntime,
    preGeneration: preGenerationPresentation,
    context: {
      storyMemory,
      preview: chapterContextPreview,
      previewError: chapterContextPreviewError,
      preserveConstraintLabels,
    },
    assets: {
      facts: storyFacts,
      volumes: storyVolumes,
      characters: chapterCharacters,
      segments: chapterSegments,
      foreshadowLedger,
    },
    review: {
      consistencyReport,
      publishCheck,
      gateReportExpanded,
      qualityDashboard,
      aiResult,
    },
    history: {
      versions: chapterVersions,
      selectedVersion,
      loading: versionHistoryLoading,
    },
    saving: {
      revealConstraints: updatingRevealConstraints,
      foreshadowWriteback: updatingForeshadowWriteback,
    },
    actions: {
      navigate,
      navigateToWritingRoute,
      setPreserveConstraintLabels,
      updateRevealConstraints: handleUpdateRevealConstraints,
      createForeshadow: handleCreateForeshadowWriteback,
      patchForeshadow: handlePatchForeshadowWriteback,
      deleteForeshadow: handleDeleteForeshadowWriteback,
      openGateIssue: handleOpenGateIssue,
      setGateReportExpanded,
      getEditorContent: getEditorText,
      regenerate: applyChapterContent,
      setSelectedVersionId,
      restoreVersion: handleRestoreVersion,
    },
  })

  const editorHeader = buildEditorHeaderViewModel({ chapter: currentChapter })

  const contractSections = useWritingContractSections({
    chapter: currentChapter,
    scenePlan,
    activeThreads: storyMemory?.activeThreads || [],
    dueForeshadowItems,
    truthRevealOverLimit: currentVolumeTruthStats.overLimit,
    staleReasons: currentChapterStaleReasons,
    publishCheck,
    contractAudit: currentContractAudit,
  })

  const retryPipeline = useCallback(() => void handleGenerateContent(), [handleGenerateContent])
  const pipelineItems = useWritingPipelineItems({
    chapter: currentChapter,
    snapshot: currentPipelineSnapshot,
    reviewNotes,
    sceneCount: scenePlan.length,
  }, retryPipeline)

  const commandBindings = useWritingCommandBindings({
    navigator: {
      novelId,
      chapters,
      volumes: storyVolumes,
      currentChapter,
      currentChapterId,
      defaultAiExecutionMode,
      executionModeOverride: generationExecutionModeOverride,
      setExecutionMode: setGenerationExecutionModeOverride,
      selectChapter: async (chapterId) => handleGuardedSelectChapter(chapterId),
      addChapter: handleGuardedAddChapter,
      deleteChapter: handleDeleteChapter,
      navigate,
    },
    commandBar: {
      novelId,
      creativeStageId: creativeStageId || null,
      defaultAiExecutionMode,
      savingAiMode,
      selectedSnippetLength: selectedSnippet?.text.length || 0,
      hasChapter: Boolean(currentChapter),
      hasMultiSegments,
      generating: currentChapterGenerating,
      generationReady: generationPreflight.ready,
      generationBlockedReason: generationPreflight.messages[0],
      rewritingSelection,
      optimizingChapter,
      setCreativeStageId,
      changeDefaultAiMode: handleDefaultAiModeChange,
      save: handleSaveCurrentChapter,
      cancelGeneration: handleCancelGenerate,
      generate: handleGenerateContent,
      openRewrite: handleOpenRewriteModal,
      optimize: handleOptimizeChapter,
      aiCheck: handleAiCheck,
      changeStatus: handleStatusChange,
    },
    statusBar: {
      currentChapter,
      editorTitle: editorHeader.title,
      wordCount,
      writability: chapterWritability,
      versionCount: chapterVersions.length,
      currentStatusLabel: editorHeader.statusLabel,
      saveState,
      insightPanelOpen,
      setInsightPanelOpen,
      onNavigate: navigateToWritingRoute,
    },
    editorActions: {
      novelId,
      resumableVisible: hasResumablePartialContent,
      resumableContent: resumablePartialContent,
      resumableCancelled: currentPipelineSnapshot?.status === 'cancelled',
      resume: handleResumePartialContent,
      restart: handleRestartGeneration,
      setActionError,
      navigate,
      compile: handleCompileCurrentChapter,
      advisoryCount: editorAdvisoryCount,
      advisoryOpen: advisoryPanelOpen,
      productionBriefItems,
      staleReasonSummary: formatStaleReasonsSummary(currentChapterStaleReasons),
      writebackStatus: currentWritebackStatus,
      writebackPhaseLabel: getWritebackPhaseLabel(currentWritebackStatus?.phase),
      publishCheck,
      publishCheckAlertType: getPublishCheckAlertType(publishCheck),
      setAdvisoryPanelOpen,
    },
  })
  // The pure composition builder forwards editorRef; it never reads ref.current.
  // eslint-disable-next-line react-hooks/refs
  const viewComposition = buildWritingViewComposition({
    workspace: {
      loading,
      refreshing,
      currentChapter,
      pipelineItems,
      insightPanelOpen,
      activeRoute: activeWritingRoute,
      onNavigate: navigateToWritingRoute,
    },
    generation: chapterGeneration,
    runtime: editorRuntime,
    commandBindings,
    editor: {
      currentChapter,
      content,
      editorRef,
      actionError,
      segments: chapterSegments,
      onInput: handleContentChange,
      onCompositionStart: handleCompositionStart,
      onCompositionEnd: handleCompositionEnd,
      onSyncSelection: syncSelectedSnippet,
    },
    inspector,
    contracts: contractSections,
    history: historyLifecycle,
    modals: {
      novelId,
      chapters,
      selectedText: selectedSnippet?.text || '',
      state: reviewState,
      actions: chapterReview,
    },
  })

  return (
    <>
      <WritingWorkspaceLayout {...viewComposition.layout} />
      <WritingModals {...viewComposition.modals} />
    </>
  )
}
