import type { WritingRouteKey } from './components/InsightPanel'
import type { WritingEditorPaneProps } from './components/WritingEditorPane'
import type { WritingModalsProps } from './components/WritingModals'
import type { WritingWorkspaceLayoutProps } from './components/WritingWorkspaceLayout'
import type { useChapterGeneration } from './useChapterGeneration'
import type { useChapterReview } from './useChapterReview'
import type { useWritingChapterController } from './useWritingChapterController'
import type { useWritingContractSections } from './useWritingContractSections'
import type { WritingCommandBindings } from './useWritingCommandBindings'
import type { useWritingHistoryLifecycle } from './useWritingHistoryLifecycle'
import type { useWritingInspectorComposition } from './useWritingInspectorComposition'
import type { useWritingReviewState } from './useWritingReviewState'
import type { useWritingEditorRuntimePresentation } from './useWritingRuntimePresentation'

interface WritingViewCompositionInput {
  workspace: Pick<
    WritingWorkspaceLayoutProps,
    'loading' | 'refreshing' | 'currentChapter' | 'pipelineItems' | 'insightPanelOpen'
  > & {
    activeRoute: WritingRouteKey
    onNavigate: WritingWorkspaceLayoutProps['inspector']['onNavigate']
  }
  chapter: ReturnType<typeof useWritingChapterController>
  generation: ReturnType<typeof useChapterGeneration>
  runtime: ReturnType<typeof useWritingEditorRuntimePresentation>
  commandBindings: WritingCommandBindings
  editor: Omit<WritingEditorPaneProps, 'commandBar' | keyof WritingCommandBindings['editorActions'] | 'title' | 'subtitle' | 'generating' | 'streamTaskId'>
  inspector: ReturnType<typeof useWritingInspectorComposition>
  contracts: ReturnType<typeof useWritingContractSections>
  history: ReturnType<typeof useWritingHistoryLifecycle>
  modals: {
    novelId: number
    chapters: WritingModalsProps['chapters']
    selectedText: string
    state: ReturnType<typeof useWritingReviewState>
    actions: ReturnType<typeof useChapterReview>
  }
}

export function buildWritingViewComposition(input: WritingViewCompositionInput): {
  layout: WritingWorkspaceLayoutProps
  modals: WritingModalsProps
} {
  const { chapter, commandBindings, contracts, generation, history, inspector, runtime, workspace } = input
  return {
    layout: {
      loading: workspace.loading,
      refreshing: workspace.refreshing,
      currentChapter: workspace.currentChapter,
      pipelineItems: workspace.pipelineItems,
      chapterHeader: chapter.header,
      insightPanelOpen: workspace.insightPanelOpen,
      commandBindings,
      editor: {
        ...input.editor,
        title: chapter.editor.title,
        subtitle: chapter.editor.subtitle,
        generating: runtime.generating,
        streamTaskId: generation.activeGeneration.streamTaskId,
        ...commandBindings.editorActions,
      },
      acceptance: chapter.metadata.acceptance,
      qualityIssues: chapter.metadata.qualityIssues,
      inspector: {
        open: workspace.insightPanelOpen,
        activeRoute: workspace.activeRoute,
        chapterContractSections: contracts.chapterSections,
        sceneContractSections: contracts.sceneSections,
        viewModels: inspector.viewModels,
        actions: inspector.actions,
        onNavigate: workspace.onNavigate,
      },
      footer: {
        pipelineMetadata: chapter.metadata.pipeline,
        versions: history.versions,
        selectedVersionId: history.selectedVersionId,
        onSelectVersion: history.setSelectedVersionId,
        onRestoreVersion: input.modals.actions.restoreVersion,
      },
    },
    modals: {
      novelId: input.modals.novelId,
      chapters: input.modals.chapters,
      rewrite: {
        open: input.modals.state.rewriteModalOpen,
        selectedText: input.modals.selectedText,
        requirements: input.modals.state.rewriteRequirements,
        loading: input.modals.state.rewritingSelection,
        onRequirementsChange: input.modals.state.setRewriteRequirements,
        onOpenChange: input.modals.state.setRewriteModalOpen,
        onConfirm: input.modals.actions.rewriteSelectedText,
      },
      optimize: {
        open: input.modals.state.optimizeModalOpen,
        result: input.modals.state.optimizationResult,
        requirements: input.modals.state.optimizeRequirements,
        applying: input.modals.state.applyingOptimizedChapter,
        onRequirementsChange: input.modals.state.setOptimizeRequirements,
        onOpenChange: input.modals.state.setOptimizeModalOpen,
        onApply: input.modals.actions.applyOptimizedChapter,
      },
    },
  }
}
