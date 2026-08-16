import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { Chapter, ChapterPublishCheck, WritebackSyncStatus } from '../../../types'
import type { WritingActionError } from './useChapterGeneration'
import type { ChapterNavigatorProps } from './components/ChapterNavigator'
import type { WritingCommandBarProps } from './components/WritingCommandBar'
import type { WritingEditorPaneProps } from './components/WritingEditorPane'
import type { WritingStatusBarProps } from './components/WritingStatusBar'

interface NavigatorBindingInput extends Omit<
  ChapterNavigatorProps,
  'onExecutionModeChange' | 'onSelectChapter' | 'onAddChapter' | 'onDeleteChapter' | 'onOpenStructure'
> {
  novelId: number
  setExecutionMode: ChapterNavigatorProps['onExecutionModeChange']
  selectChapter(chapterId: number): Promise<void>
  addChapter(volumeId?: number | null): Promise<void>
  deleteChapter: ChapterNavigatorProps['onDeleteChapter']
  navigate(path: string): void
}

interface CommandBarBindingInput extends Omit<
  WritingCommandBarProps,
  | 'onCreativeStageChange'
  | 'onDefaultAiModeChange'
  | 'onSave'
  | 'onCancelGeneration'
  | 'onGenerate'
  | 'onOpenRewrite'
  | 'onOptimize'
  | 'onAiCheck'
  | 'onFinalize'
> {
  setCreativeStageId: WritingCommandBarProps['onCreativeStageChange']
  changeDefaultAiMode: WritingCommandBarProps['onDefaultAiModeChange']
  save: WritingCommandBarProps['onSave']
  cancelGeneration(): Promise<void>
  generate(): Promise<void>
  openRewrite: WritingCommandBarProps['onOpenRewrite']
  optimize(): Promise<void>
  aiCheck(): Promise<void>
  changeStatus(status: Chapter['status']): Promise<void>
}

interface StatusBarBindingInput extends Omit<WritingStatusBarProps, 'onToggleInspector'> {
  setInsightPanelOpen: Dispatch<SetStateAction<boolean>>
}

interface EditorActionBindingInput {
  novelId: number
  resumableVisible: boolean
  resumableContent: string
  resumableCancelled: boolean
  resume(): Promise<void>
  restart(): Promise<void>
  setActionError: Dispatch<SetStateAction<WritingActionError | null>>
  navigate(path: string): void
  compile(): Promise<void>
  advisoryCount: number
  advisoryOpen: boolean
  productionBriefItems: string[]
  staleReasonSummary: string
  writebackStatus: WritebackSyncStatus | null
  writebackPhaseLabel: string
  publishCheck: ChapterPublishCheck | null
  publishCheckAlertType: 'success' | 'info' | 'warning' | 'error'
  setAdvisoryPanelOpen: Dispatch<SetStateAction<boolean>>
}

export interface WritingCommandBindings {
  navigator: ChapterNavigatorProps
  commandBar: WritingCommandBarProps
  statusBar: WritingStatusBarProps
  editorActions: Pick<
    WritingEditorPaneProps,
    'resumable' | 'onDismissError' | 'onOpenStructure' | 'onCompile' | 'advisory'
  >
}

function useNavigatorBindings(input: NavigatorBindingInput): ChapterNavigatorProps {
  const {
    addChapter,
    chapters,
    currentChapter,
    currentChapterId,
    defaultAiExecutionMode,
    deleteChapter,
    executionModeOverride,
    navigate,
    novelId,
    selectChapter,
    setExecutionMode,
    volumes,
  } = input
  return useMemo(() => ({
    chapters,
    volumes,
    currentChapter,
    currentChapterId,
    defaultAiExecutionMode,
    executionModeOverride,
    onExecutionModeChange: setExecutionMode,
    onSelectChapter: (chapterId) => void selectChapter(chapterId),
    onAddChapter: (volumeId) => void addChapter(volumeId),
    onDeleteChapter: deleteChapter,
    onOpenStructure: () => navigate(buildWorkspaceRoute(novelId, 'structure')),
  }), [
    addChapter,
    chapters,
    currentChapter,
    currentChapterId,
    defaultAiExecutionMode,
    deleteChapter,
    executionModeOverride,
    navigate,
    novelId,
    selectChapter,
    setExecutionMode,
    volumes,
  ])
}

function useCommandBarBindings(input: CommandBarBindingInput): WritingCommandBarProps {
  const {
    aiCheck,
    cancelGeneration,
    changeDefaultAiMode,
    creativeStageId,
    defaultAiExecutionMode,
    changeStatus,
    generate,
    generating,
    generationBlockedReason,
    generationReady,
    hasChapter,
    hasMultiSegments,
    novelId,
    openRewrite,
    optimize,
    optimizingChapter,
    rewritingSelection,
    save,
    savingAiMode,
    selectedSnippetLength,
    setCreativeStageId,
  } = input
  return useMemo(() => ({
    novelId,
    creativeStageId,
    defaultAiExecutionMode,
    savingAiMode,
    selectedSnippetLength,
    hasChapter,
    hasMultiSegments,
    generating,
    generationReady,
    generationBlockedReason,
    rewritingSelection,
    optimizingChapter,
    onCreativeStageChange: setCreativeStageId,
    onDefaultAiModeChange: changeDefaultAiMode,
    onSave: save,
    onCancelGeneration: () => void cancelGeneration(),
    onGenerate: () => void generate(),
    onOpenRewrite: openRewrite,
    onOptimize: () => void optimize(),
    onAiCheck: () => void aiCheck(),
    onFinalize: () => void changeStatus('final'),
  }), [
    aiCheck,
    cancelGeneration,
    changeDefaultAiMode,
    creativeStageId,
    defaultAiExecutionMode,
    changeStatus,
    generate,
    generating,
    generationBlockedReason,
    generationReady,
    hasChapter,
    hasMultiSegments,
    novelId,
    openRewrite,
    optimize,
    optimizingChapter,
    rewritingSelection,
    save,
    savingAiMode,
    selectedSnippetLength,
    setCreativeStageId,
  ])
}

function useStatusBarBindings(input: StatusBarBindingInput): WritingStatusBarProps {
  const {
    currentChapter,
    currentStatusLabel,
    editorTitle,
    insightPanelOpen,
    onNavigate,
    primaryStatusText,
    setInsightPanelOpen,
    versionCount,
    wordCount,
    writability,
  } = input
  return useMemo(() => ({
    currentChapter,
    currentStatusLabel,
    editorTitle,
    insightPanelOpen,
    onNavigate,
    primaryStatusText,
    versionCount,
    wordCount,
    writability,
    onToggleInspector: () => setInsightPanelOpen((current) => !current),
  }), [
    currentChapter,
    currentStatusLabel,
    editorTitle,
    insightPanelOpen,
    onNavigate,
    primaryStatusText,
    setInsightPanelOpen,
    versionCount,
    wordCount,
    writability,
  ])
}

function useEditorActionBindings(input: EditorActionBindingInput): WritingCommandBindings['editorActions'] {
  const {
    advisoryCount,
    advisoryOpen,
    compile,
    navigate,
    novelId,
    productionBriefItems,
    publishCheck,
    publishCheckAlertType,
    restart,
    resumableCancelled,
    resumableContent,
    resumableVisible,
    resume,
    setActionError,
    setAdvisoryPanelOpen,
    staleReasonSummary,
    writebackPhaseLabel,
    writebackStatus,
  } = input
  return useMemo(() => ({
    resumable: {
      visible: resumableVisible,
      content: resumableContent,
      cancelled: resumableCancelled,
      onResume: () => void resume(),
      onRestart: () => void restart(),
    },
    onDismissError: () => setActionError(null),
    onOpenStructure: () => navigate(buildWorkspaceRoute(novelId, 'structure')),
    onCompile: () => void compile(),
    advisory: {
      count: advisoryCount,
      open: advisoryOpen,
      productionBriefItems,
      staleReasonSummary,
      writebackStatus,
      writebackPhaseLabel,
      publishCheck,
      publishCheckAlertType,
      onToggle: () => setAdvisoryPanelOpen((current) => !current),
    },
  }), [
    advisoryCount,
    advisoryOpen,
    compile,
    navigate,
    novelId,
    productionBriefItems,
    publishCheck,
    publishCheckAlertType,
    restart,
    resumableCancelled,
    resumableContent,
    resumableVisible,
    resume,
    setActionError,
    setAdvisoryPanelOpen,
    staleReasonSummary,
    writebackPhaseLabel,
    writebackStatus,
  ])
}

export function useWritingCommandBindings(input: {
  navigator: NavigatorBindingInput
  commandBar: CommandBarBindingInput
  statusBar: StatusBarBindingInput
  editorActions: EditorActionBindingInput
}): WritingCommandBindings {
  const navigator = useNavigatorBindings(input.navigator)
  const commandBar = useCommandBarBindings(input.commandBar)
  const statusBar = useStatusBarBindings(input.statusBar)
  const editorActions = useEditorActionBindings(input.editorActions)
  return { commandBar, editorActions, navigator, statusBar }
}
