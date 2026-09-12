import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { getErrorMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterPublishCheck,
  ChapterSegment,
  Character,
  ForeshadowLedgerEntry,
  ForeshadowSnapshot,
  HardConstraintSourceLabel,
  NovelConsistencyReport,
  NovelContextStatus,
  QualityDashboardData,
  StoryFact,
  StoryItem,
  StoryMemorySnapshot,
  StoryVolume,
  Task,
  TimelineEvent,
} from '../../../types'
import type { AiExecutionMode } from '../../../shared/ai-execution'
import { parseAiCheck, parseNumberArray, type AiCheckPayload } from './parsers'
import type { TextSelectionSnapshot } from './useChapterEditor'
import type { WritingActionError } from './useChapterGeneration'
import { reduceWritingContextPreview, type WritingContextPreviewState } from './writing-state-ownership'

type Setter<T> = Dispatch<SetStateAction<T>>
type IsCurrent = () => boolean

interface WorkspaceRefreshState {
  setConsistencyReport: Setter<NovelConsistencyReport | null>
  setStoryMemory: Setter<StoryMemorySnapshot | null>
  setQualityDashboard: Setter<QualityDashboardData | null>
  setStoryFacts: Setter<StoryFact[]>
  setStoryVolumes: Setter<StoryVolume[]>
  setChapterCharacters: Setter<Character[]>
  setForeshadowLedger: Setter<ForeshadowLedgerEntry[]>
  setContextStatus: Setter<NovelContextStatus | null>
}

interface ChapterRefreshState {
  setTimelineEvents: Setter<TimelineEvent[]>
  setStoryItems: Setter<StoryItem[]>
  setChapterSegments: Setter<ChapterSegment[]>
  setAiResult: Setter<AiCheckPayload | null>
  setForeshadowSnapshot: Setter<ForeshadowSnapshot | null>
  setContextPreview: Setter<WritingContextPreviewState>
  setLatestPipelineTask: Setter<Task | null>
  setCurrentChapter: Setter<Chapter | null>
}

export interface WritingWorkspaceRefreshOperations {
  setPublishCheck: Setter<ChapterPublishCheck | null>
  setSelectedSnippet: Setter<TextSelectionSnapshot | null>
  setActionError: Setter<WritingActionError | null>
  resetChapterReview(): void
  novelId: number
  creativeStageId: number | null
  effectiveAiExecutionMode: AiExecutionMode
  preserveConstraintLabels: HardConstraintSourceLabel[]
  loadEditorContent(text: string): void
}

interface UseWritingWorkspaceRefreshControllerInput extends WorkspaceRefreshState, ChapterRefreshState, WritingWorkspaceRefreshOperations {
  captureChapterSelection(chapterId: number | null): IsCurrent
}

function useWorkspaceMetadataRefreshes(input: UseWritingWorkspaceRefreshControllerInput) {
  const {
    novelId,
    setChapterCharacters,
    setConsistencyReport,
    setContextStatus,
    setForeshadowLedger,
    setQualityDashboard,
    setStoryFacts,
    setStoryMemory,
    setStoryVolumes,
  } = input
  const refreshMeta = useCallback(async () => {
    const [report, memory] = await Promise.all([
      window.electron.novel.runConsistencyCheck(novelId),
      window.electron.novel.getStoryMemory(novelId),
    ])
    setConsistencyReport(report)
    setStoryMemory(memory)
  }, [novelId, setConsistencyReport, setStoryMemory])
  const refreshContextStatus = useCallback(async () => {
    setContextStatus(await window.electron.novel.getContextStatus(novelId))
  }, [novelId, setContextStatus])
  const refreshQualityDashboard = useCallback(async () => {
    try {
      setQualityDashboard(await window.electron.quality.getDashboard(novelId))
    } catch (error) {
      console.error('Failed to load quality dashboard snapshot', error)
    }
  }, [novelId, setQualityDashboard])
  const refreshInfoGapAssets = useCallback(async () => {
    try {
      const [facts, volumes, characters] = await Promise.all([
        window.electron.storyFact.list(novelId),
        window.electron.structure.listVolumes(novelId),
        window.electron.character.list(novelId),
      ])
      setStoryFacts(facts)
      setStoryVolumes(volumes)
      setChapterCharacters(characters)
    } catch (error) {
      console.error('Failed to load info-gap board assets', error)
    }
  }, [novelId, setChapterCharacters, setStoryFacts, setStoryVolumes])
  const refreshForeshadowLedger = useCallback(async () => {
    try {
      setForeshadowLedger(await window.electron.foreshadow.listLedger(novelId))
    } catch (error) {
      console.error('Failed to load foreshadow ledger', error)
      setForeshadowLedger([])
    }
  }, [novelId, setForeshadowLedger])
  return { refreshContextStatus, refreshForeshadowLedger, refreshInfoGapAssets, refreshMeta, refreshQualityDashboard }
}

function useChapterLinkedAssetRefreshes(input: UseWritingWorkspaceRefreshControllerInput) {
  const {
    captureChapterSelection,
    creativeStageId,
    effectiveAiExecutionMode,
    novelId,
    preserveConstraintLabels,
    setContextPreview,
    setCurrentChapter,
    setForeshadowSnapshot,
    setLatestPipelineTask,
    setPublishCheck,
    setStoryItems,
    setTimelineEvents,
  } = input
  const refreshForeshadowSnapshot = useCallback(async (chapter?: Chapter | null, isCurrent: IsCurrent = captureChapterSelection(chapter?.id ?? null)) => {
    if (!chapter) {
      if (isCurrent()) setForeshadowSnapshot(null)
      return
    }
    try {
      const snapshot = await window.electron.thread.getForeshadowSnapshot(novelId, chapter.chapterNum)
      if (isCurrent()) setForeshadowSnapshot(snapshot)
    } catch (error) {
      console.error('Failed to load foreshadow snapshot', error)
      if (isCurrent()) setForeshadowSnapshot(null)
    }
  }, [captureChapterSelection, novelId, setForeshadowSnapshot])
  const refreshChapterLinks = useCallback(async (chapter?: Chapter | null, isCurrent: IsCurrent = captureChapterSelection(chapter?.id ?? null)) => {
    if (!chapter) {
      if (isCurrent()) {
        setTimelineEvents([])
        setStoryItems([])
      }
      return
    }
    const events = await window.electron.timeline.query({
      novelId,
      chapterId: chapter.id,
      page: 1,
      pageSize: 200,
      sortBy: 'timeSortValue',
      sortDirection: 'asc',
    })
    const itemIds = [...new Set(events.items.flatMap((event) => parseNumberArray(event.linkedItemIdsJson)))]
    const items = await Promise.all(itemIds.map((id) => window.electron.item.get(id)))
    if (!isCurrent()) return
    setTimelineEvents(events.items)
    setStoryItems(items.filter((item): item is StoryItem => Boolean(item)))
  }, [captureChapterSelection, novelId, setStoryItems, setTimelineEvents])
  const refreshChapterContextPreview = useCallback(async (chapter?: Chapter | null, isCurrent: IsCurrent = captureChapterSelection(chapter?.id ?? null)) => {
    if (!chapter) {
      if (isCurrent()) {
        setContextPreview((state) => reduceWritingContextPreview(state, { type: 'clear' }))
      }
      return
    }
    if (isCurrent()) setContextPreview((state) => reduceWritingContextPreview(state, { type: 'start' }))
    try {
      const preview = await window.electron.chapter.getContextPreview(chapter.id, {
        executionMode: effectiveAiExecutionMode,
        preserveConstraintLabels,
        stageId: creativeStageId || undefined,
      })
      if (isCurrent()) {
        setContextPreview((state) => reduceWritingContextPreview(state, { type: 'success', preview }))
      }
    } catch (error) {
      if (isCurrent()) {
        setContextPreview((state) => reduceWritingContextPreview(state, { type: 'failure', error: getErrorMessage(error, 'common.loadFailed') }))
      }
    }
  }, [captureChapterSelection, creativeStageId, effectiveAiExecutionMode, preserveConstraintLabels, setContextPreview])
  const refreshPublishCheck = useCallback(async (chapterId: number, isCurrent: IsCurrent = captureChapterSelection(chapterId)) => {
    const nextCheck = await window.electron.chapter.runPublishCheck(chapterId)
    if (!isCurrent()) return
    setPublishCheck(nextCheck)
    setCurrentChapter((current) => current?.id === chapterId
      ? { ...current, contractAuditJson: JSON.stringify(nextCheck.contractAudit) }
      : current)
  }, [captureChapterSelection, setCurrentChapter, setPublishCheck])
  const refreshLatestPipelineTask = useCallback(async (chapterId?: number, isCurrent: IsCurrent = captureChapterSelection(chapterId ?? null)) => {
    if (!chapterId) {
      if (isCurrent()) setLatestPipelineTask(null)
      return
    }
    try {
      const task = await window.electron.task.getLatestChapterPipeline(chapterId)
      if (isCurrent()) setLatestPipelineTask(task)
    } catch {
      if (isCurrent()) setLatestPipelineTask(null)
    }
  }, [captureChapterSelection, setLatestPipelineTask])
  return { refreshChapterContextPreview, refreshChapterLinks, refreshForeshadowSnapshot, refreshLatestPipelineTask, refreshPublishCheck }
}

function useWorkspaceLoadLifecycle(
  input: UseWritingWorkspaceRefreshControllerInput,
  metadata: ReturnType<typeof useWorkspaceMetadataRefreshes>,
  assets: ReturnType<typeof useChapterLinkedAssetRefreshes>,
) {
  const {
    loadEditorContent,
    setActionError,
    setAiResult,
    setContextPreview,
    setChapterSegments,
    setForeshadowSnapshot,
    resetChapterReview,
    setLatestPipelineTask,
    setSelectedSnippet,
    setStoryItems,
    setTimelineEvents,
  } = input
  const { refreshContextStatus, refreshForeshadowLedger, refreshInfoGapAssets, refreshMeta, refreshQualityDashboard } = metadata
  const { refreshChapterLinks, refreshForeshadowSnapshot, refreshLatestPipelineTask, refreshPublishCheck } = assets
  const clearChapterArtifacts = useCallback(() => {
    setTimelineEvents([])
    setStoryItems([])
    setChapterSegments([])
    setAiResult(null)
    setForeshadowSnapshot(null)
    setContextPreview((state) => reduceWritingContextPreview(state, { type: 'clear' }))
    resetChapterReview()
    setLatestPipelineTask(null)
    setSelectedSnippet(null)
    setActionError(null)
  }, [setActionError, setAiResult, setContextPreview, setChapterSegments, setForeshadowSnapshot, resetChapterReview, setLatestPipelineTask, setSelectedSnippet, setStoryItems, setTimelineEvents])
  const beforeWorkspaceChapterLoad = clearChapterArtifacts
  const handleWorkspaceChapterLoaded = useCallback(async (chapter: Chapter, segments: ChapterSegment[], isCurrent: IsCurrent) => {
    if (!isCurrent()) return
    setChapterSegments(segments)
    const record = chapter as unknown as Record<string, unknown>
    setAiResult(parseAiCheck(chapter.aiScoreJson ?? record.ai_score_json))
    loadEditorContent(chapter.content || '')
    await Promise.all([
      refreshPublishCheck(chapter.id, isCurrent),
      refreshContextStatus(),
      refreshChapterLinks(chapter, isCurrent),
      refreshForeshadowSnapshot(chapter, isCurrent),
      refreshForeshadowLedger(),
      refreshLatestPipelineTask(chapter.id, isCurrent),
    ])
    if (!isCurrent()) return
  }, [loadEditorContent, refreshChapterLinks, refreshContextStatus, refreshForeshadowLedger, refreshForeshadowSnapshot, refreshLatestPipelineTask, refreshPublishCheck, setAiResult, setChapterSegments])
  const handleEmptyWorkspace = useCallback(() => {
    clearChapterArtifacts()
    loadEditorContent('')
    void refreshContextStatus().catch(console.error)
  }, [clearChapterArtifacts, loadEditorContent, refreshContextStatus])
  const refreshWorkspaceMetadata = useCallback(async () => {
    const results = await Promise.allSettled([
      refreshMeta(),
      refreshContextStatus(),
      refreshQualityDashboard(),
      refreshInfoGapAssets(),
      refreshForeshadowLedger(),
    ])
    results.forEach((result) => {
      if (result.status === 'rejected') console.error('Failed to refresh writing workspace metadata', result.reason)
    })
  }, [refreshContextStatus, refreshForeshadowLedger, refreshInfoGapAssets, refreshMeta, refreshQualityDashboard])
  return { beforeWorkspaceChapterLoad, clearChapterArtifacts, handleEmptyWorkspace, handleWorkspaceChapterLoaded, refreshWorkspaceMetadata }
}

export function useWritingWorkspaceRefreshController(input: UseWritingWorkspaceRefreshControllerInput) {
  const metadata = useWorkspaceMetadataRefreshes(input)
  const assets = useChapterLinkedAssetRefreshes(input)
  const lifecycle = useWorkspaceLoadLifecycle(input, metadata, assets)
  return { ...metadata, ...assets, ...lifecycle }
}
