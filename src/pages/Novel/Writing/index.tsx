import React, { useCallback, useMemo, useState } from 'react'
import { Modal } from 'antd'
import { formatStaleReasonsSummary } from '../../../shared/context-change-reasons'
import { type AiExecutionMode } from '../../../shared/ai-execution'
import { parseStorySettingsSnapshot } from '../../../shared/story-settings'
import type {
  Chapter,
  ChapterContextPreview,
  HardConstraintSourceLabel,
  ChapterPublishCheck,
  ChapterSegment,
  Task,
  Character,
  ForeshadowLedgerEntry,
  ForeshadowSnapshot,
  NovelConsistencyReport,
  NovelContextStatus,
  QualityDashboardData,
  StoryFact,
  StoryItem,
  StoryMemorySnapshot,
  StoryVolume,
  TimelineEvent,
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
import { useWritingChapterController } from './useWritingChapterController'
import { useWritingChapterCrudController } from './useWritingChapterCrudController'
import { useWritingCommandBindings } from './useWritingCommandBindings'
import { useWritingContractSections } from './useWritingContractSections'
import { useWritingEditorLifecycle } from './useWritingEditorLifecycle'
import { useWritingHistoryLifecycle } from './useWritingHistoryLifecycle'
import { useWritingPresentationModel } from './useWritingPresentationModel'
import {
  useWritingEditorRuntimePresentation,
  useWritingPipelineRuntimePresentation,
  useWritingPreGenerationPresentation,
} from './useWritingRuntimePresentation'
import { hasMultipleChapterSegments } from './writing-runtime-presentation'
import { useWritingWorkspaceActionController } from './useWritingWorkspaceActionController'
import { useWritingWorkspaceRefreshController } from './useWritingWorkspaceRefreshController'
import { getWritebackPhaseLabel } from './writing-chapter-presentation'
import { type AiCheckPayload, type WritingPipelineSnapshot } from './parsers'
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
  const { activeWritingRoute, creativeStageId, navigate, navigateToWritingRoute, routeChapterId, setCreativeStageId } = useWritingRouteState(novelId)
  const { notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const { currentNovel, setCurrentNovel, updateChapter } = useNovelStore()
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
  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [storyMemory, setStoryMemory] = useState<StoryMemorySnapshot | null>(null)
  const [foreshadowSnapshot, setForeshadowSnapshot] = useState<ForeshadowSnapshot | null>(null)
  const [foreshadowLedger, setForeshadowLedger] = useState<ForeshadowLedgerEntry[]>([])
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [storyItems, setStoryItems] = useState<StoryItem[]>([])
  const [preserveConstraintLabels, setPreserveConstraintLabels] = useState<HardConstraintSourceLabel[]>([])
  const [chapterSegments, setChapterSegments] = useState<ChapterSegment[]>([])
  const [storyFacts, setStoryFacts] = useState<StoryFact[]>([])
  const [storyVolumes, setStoryVolumes] = useState<StoryVolume[]>([])
  const [chapterCharacters, setChapterCharacters] = useState<Character[]>([])
  const [aiResult, setAiResult] = useState<AiCheckPayload | null>(null)
  const [qualityDashboard, setQualityDashboard] = useState<QualityDashboardData | null>(null)
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [chapterContextPreview, setChapterContextPreview] = useState<ChapterContextPreview | null>(null)
  const [chapterContextPreviewError, setChapterContextPreviewError] = useState<string | null>(null)
  const [generationExecutionModeOverride, setGenerationExecutionModeOverride] = useState<AiExecutionMode | 'follow_default'>('follow_default')
  const [latestPipelineTask, setLatestPipelineTask] = useState<Task | null>(null)
  const [livePipelineSnapshot, setLivePipelineSnapshot] = useState<WritingPipelineSnapshot | null>(null)
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
  const hasMultiSegments = hasMultipleChapterSegments(currentChapter)
  const workspaceRefresh = useWritingWorkspaceRefreshController({
    novelId,
    creativeStageId,
    effectiveAiExecutionMode,
    preserveConstraintLabels,
    loadEditorContent,
    setConsistencyReport,
    setStoryMemory,
    setQualityDashboard,
    setStoryFacts,
    setStoryVolumes,
    setChapterCharacters,
    setForeshadowLedger,
    setContextStatus,
    setTimelineEvents,
    setStoryItems,
    setChapterSegments,
    setAiResult,
    setForeshadowSnapshot,
    setChapterContextPreview,
    setChapterContextPreviewError,
    setPublishCheck,
    setLatestPipelineTask,
    setLivePipelineSnapshot,
    setGateReportExpanded,
    setSelectedSnippet,
    setActionError,
    setCurrentChapter,
  })
  const {
    beforeWorkspaceChapterLoad,
    clearChapterArtifacts,
    handleEmptyWorkspace,
    handleWorkspaceChapterLoaded,
    refreshChapterContextPreview,
    refreshContextStatus,
    refreshForeshadowSnapshot,
    refreshMeta,
    refreshPublishCheck,
    refreshQualityDashboard,
    refreshWorkspaceMetadata,
  } = workspaceRefresh

  const workspaceData = useWritingWorkspaceData({
    novelId,
    routeChapterId,
    currentChapter,
    setCurrentChapter,
    beforeChapterLoad: beforeWorkspaceChapterLoad,
    onChapterLoaded: handleWorkspaceChapterLoaded,
    onEmptyWorkspace: handleEmptyWorkspace,
    refreshWorkspaceMetadata,
  })
  const {
    chapters,
    currentChapterId,
    currentChapterIdRef,
    chapterIdsRef,
    loading,
    refreshing,
    loadChapters,
    refreshBackgroundChapter,
    selectChapter: selectWorkspaceChapter,
  } = workspaceData
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
    handleContentChange,
    handleSaveCurrentChapter,
    saveCoordinator,
    saveNow,
    syncSelectedSnippet,
  } = editorLifecycle
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
    selectChapter: handleSelectChapter,
  } = chapterCrud

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
    issues: chapterIssues,
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
    activePromptOverrideKeys,
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

  const pipelineRuntime = useWritingPipelineRuntimePresentation({
    currentChapter,
    livePipelineSnapshot,
    latestPipelineTask,
  })
  const {
    snapshot: currentPipelineSnapshot,
  } = pipelineRuntime
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
    currentPipelineSnapshot,
    generationPreflight,
    setLivePipelineSnapshot,
    setActionError,
    refreshBackgroundChapter,
    refreshMeta,
    refreshQualityDashboard,
    showPreflightWarning: generationPreflightWarning,
  })
  const {
    activeGeneration,
    lastGenerationByChapter,
    generate: handleGenerateContent,
    restart: handleRestartGeneration,
    resume: handleResumePartialContent,
    cancel: handleCancelGenerate,
    resumablePartialContent,
    hasResumablePartialContent,
  } = chapterGeneration
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
    selectedSnippet,
    hasMultiSegments,
    editorText: getEditorText,
    modelConfigId: currentNovel?.modelConfigId,
    effectiveAiExecutionMode,
    selectedVersionId,
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

  const chapterController = useWritingChapterController({
    chapter: currentChapter,
    volumeName: currentVolumeTruthStats.volumeName,
    wordCount,
    versionCount: chapterVersions.length,
    generating: currentChapterGenerating,
    refreshing,
    hasMultiSegments,
    writability: chapterWritability,
    publishCheck,
    writebackStatus: currentWritebackStatus,
    pipelineSnapshot: currentPipelineSnapshot,
    activePromptOverrideKeys,
    contractAudit: currentContractAudit,
    aiResult,
    reviewNotes,
    chapterIssues,
  })
  const { editor: editorHeader } = chapterController

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
      selectChapter: handleSelectChapter,
      addChapter: handleAddChapter,
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
      primaryStatusText: editorHeader.primaryStatusText,
      wordCount,
      writability: chapterWritability,
      versionCount: chapterVersions.length,
      currentStatusLabel: editorHeader.statusLabel,
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
    chapter: chapterController,
    generation: chapterGeneration,
    runtime: editorRuntime,
    commandBindings,
    editor: {
      currentChapter,
      content,
      wordCount,
      editorRef,
      actionError,
      segments: chapterSegments,
      onInput: handleContentChange,
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
