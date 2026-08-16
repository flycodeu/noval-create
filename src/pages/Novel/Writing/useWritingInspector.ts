import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type {
  Chapter,
  ChapterVersion,
  ForeshadowLedgerEntry,
  HardConstraintSourceLabel,
  StoryMemorySnapshot,
} from '../../../types'
import type { WritingRouteKey } from './components/InsightPanel'
import {
  buildHistoryInspectorViewModel,
  buildMemoryInspectorViewModel,
  type ChapterInspectorViewModel,
  type ReviewInspectorViewModel,
  type WritingInspectorActions,
  type WritingInspectorViewModels,
} from './writing-inspector-view-model'

interface InspectorHistoryInput {
  chapter: Chapter | null
  versions: ChapterVersion[]
  selectedVersion: ChapterVersion | null
  loading: boolean
}

interface InspectorActionInput {
  novelId: number
  chapter: Chapter | null
  navigate(path: string): void
  navigateToWritingRoute(route: WritingRouteKey): void
  setPreserveConstraintLabels: Dispatch<SetStateAction<HardConstraintSourceLabel[]>>
  updateRevealConstraints(nextAllowedIds: number[], nextRevealedIds: number[]): Promise<void>
  createForeshadow(data: Partial<ForeshadowLedgerEntry>): Promise<void>
  patchForeshadow(id: number, data: Partial<ForeshadowLedgerEntry>): Promise<void>
  deleteForeshadow(entry: ForeshadowLedgerEntry): void
  openGateIssue: WritingInspectorActions['review']['onOpenGateIssue']
  setGateReportExpanded: Dispatch<SetStateAction<boolean>>
  getEditorContent(): string
  regenerate(content: string): void
  setSelectedVersionId: Dispatch<SetStateAction<number | null>>
  restoreVersion(): Promise<void>
}

interface UseWritingInspectorInput {
  chapter: ChapterInspectorViewModel
  storyMemory: StoryMemorySnapshot | null
  review: ReviewInspectorViewModel
  history: InspectorHistoryInput
  actions: InspectorActionInput
}

function useChapterInspectorViewModel(input: ChapterInspectorViewModel): ChapterInspectorViewModel {
  const {
    allowedRevealFactIds,
    chapter,
    chapterSegments,
    characters,
    contextPreview,
    contextPreviewError,
    dueForeshadowEyebrow,
    dueForeshadowItems,
    effectiveAiModeLabel,
    facts,
    focus,
    foreshadowLedger,
    foreshadowWritebackSaving,
    hasWorldRules,
    pipelineExecutionModeLabel,
    pipelineRoles,
    pipelineSnapshot,
    preserveConstraintLabels,
    productionBriefItems,
    relatedInsightItems,
    revealConstraintsSaving,
    revealedFactIds,
    reviewInsightItems,
    scenes,
    truthStats,
    volumes,
    worldRulesSummary,
  } = input
  return useMemo(() => ({
    allowedRevealFactIds,
    chapter,
    chapterSegments,
    characters,
    contextPreview,
    contextPreviewError,
    dueForeshadowEyebrow,
    dueForeshadowItems,
    effectiveAiModeLabel,
    facts,
    focus,
    foreshadowLedger,
    foreshadowWritebackSaving,
    hasWorldRules,
    pipelineExecutionModeLabel,
    pipelineRoles,
    pipelineSnapshot,
    preserveConstraintLabels,
    productionBriefItems,
    relatedInsightItems: relatedInsightItems.slice(0, 12),
    revealConstraintsSaving,
    revealedFactIds,
    reviewInsightItems,
    scenes,
    truthStats,
    volumes,
    worldRulesSummary,
  }), [
    allowedRevealFactIds,
    chapter,
    chapterSegments,
    characters,
    contextPreview,
    contextPreviewError,
    dueForeshadowEyebrow,
    dueForeshadowItems,
    effectiveAiModeLabel,
    facts,
    focus,
    foreshadowLedger,
    foreshadowWritebackSaving,
    hasWorldRules,
    pipelineExecutionModeLabel,
    pipelineRoles,
    pipelineSnapshot,
    preserveConstraintLabels,
    productionBriefItems,
    relatedInsightItems,
    revealConstraintsSaving,
    revealedFactIds,
    reviewInsightItems,
    scenes,
    truthStats,
    volumes,
    worldRulesSummary,
  ])
}

function useReviewInspectorViewModel(input: ReviewInspectorViewModel): ReviewInspectorViewModel {
  const {
    aiResult,
    aiScore,
    chapter,
    chapterIssues,
    consistencyReport,
    contractAudit,
    focusAreas,
    gateReportExpanded,
    publishCheck,
    publishCheckDriftHighlights,
    publishCheckHistoryItems,
    publishCheckScores,
    publishCheckSections,
    qualityDashboard,
    reviewNotes,
  } = input
  return useMemo(() => ({
    aiResult,
    aiScore,
    chapter,
    chapterIssues,
    consistencyReport,
    contractAudit,
    focusAreas,
    gateReportExpanded,
    publishCheck,
    publishCheckDriftHighlights,
    publishCheckHistoryItems,
    publishCheckScores,
    publishCheckSections,
    qualityDashboard,
    reviewNotes,
  }), [
    aiResult,
    aiScore,
    chapter,
    chapterIssues,
    consistencyReport,
    contractAudit,
    focusAreas,
    gateReportExpanded,
    publishCheck,
    publishCheckDriftHighlights,
    publishCheckHistoryItems,
    publishCheckScores,
    publishCheckSections,
    qualityDashboard,
    reviewNotes,
  ])
}

function useInspectorActions(input: InspectorActionInput): WritingInspectorActions {
  const {
    chapter,
    createForeshadow,
    deleteForeshadow,
    getEditorContent,
    navigate,
    navigateToWritingRoute,
    novelId,
    openGateIssue,
    patchForeshadow,
    regenerate,
    restoreVersion,
    setGateReportExpanded,
    setPreserveConstraintLabels,
    setSelectedVersionId,
    updateRevealConstraints,
  } = input
  return useMemo(() => ({
    editor: {
      onOpenContracts: () => {
        if (chapter) {
          navigate(buildWorkspaceRoute(novelId, `contracts?chapterId=${chapter.id}`))
        }
      },
      onPreserveConstraintChange: setPreserveConstraintLabels,
      onUpdateRevealConstraints: updateRevealConstraints,
      onOpenInfoGapBoard: () => navigate(buildWorkspaceRoute(novelId, 'info-gap-board')),
      onCreateForeshadow: createForeshadow,
      onPatchForeshadow: patchForeshadow,
      onDeleteForeshadow: deleteForeshadow,
      onOpenForeshadowLedger: () => navigate(buildWorkspaceRoute(novelId, 'foreshadow-ledger')),
    },
    review: {
      onOpenGateIssue: openGateIssue,
      onToggleGateReport: () => setGateReportExpanded((current) => !current),
      onOpenQualityDashboard: () => navigate(buildWorkspaceRoute(novelId, 'quality')),
      onOpenWriteback: () => {
        if (chapter) {
          navigate(buildWorkspaceRoute(novelId, `writeback?chapterId=${chapter.id}`))
        }
      },
      getEditorContent,
      onRegenerate: regenerate,
    },
    history: {
      onSelectVersion: setSelectedVersionId,
      onReturnToEditor: () => navigateToWritingRoute('editor'),
      onRestoreVersion: () => void restoreVersion(),
    },
  }), [
    chapter,
    createForeshadow,
    deleteForeshadow,
    getEditorContent,
    navigate,
    navigateToWritingRoute,
    novelId,
    openGateIssue,
    patchForeshadow,
    regenerate,
    restoreVersion,
    setGateReportExpanded,
    setPreserveConstraintLabels,
    setSelectedVersionId,
    updateRevealConstraints,
  ])
}

export function useWritingInspector(input: UseWritingInspectorInput): {
  viewModels: WritingInspectorViewModels
  actions: WritingInspectorActions
} {
  const { actions: actionInput, chapter: chapterInput, history: historyInput, review: reviewInput, storyMemory } = input
  const {
    chapter: historyChapter,
    loading: historyLoading,
    selectedVersion,
    versions,
  } = historyInput
  const chapter = useChapterInspectorViewModel(chapterInput)
  const context = useMemo(() => buildMemoryInspectorViewModel(storyMemory), [storyMemory])
  const review = useReviewInspectorViewModel(reviewInput)
  const history = useMemo(() => buildHistoryInspectorViewModel({
    chapter: historyChapter,
    loading: historyLoading,
    selectedVersion,
    versions,
  }), [historyChapter, historyLoading, selectedVersion, versions])
  const actions = useInspectorActions(actionInput)
  const viewModels = useMemo<WritingInspectorViewModels>(
    () => ({ editor: chapter, context, review, history }),
    [chapter, context, history, review],
  )

  return { viewModels, actions }
}
