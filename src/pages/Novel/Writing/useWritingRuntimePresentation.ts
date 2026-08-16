import { useMemo } from 'react'
import type { Chapter, ChapterContextPreview, ChapterPublishCheck, ForeshadowSnapshot, Task } from '../../../types'
import type { WritingGenerationSnapshot } from '../../../stores/writingView.store'
import { parseWritebackStatus, type WritingPipelineSnapshot } from './parsers'
import {
  buildDueForeshadowPresentation,
  buildWritingPipelineRuntimePresentation,
  countWritingEditorAdvisories,
  resolveCurrentChapterGeneration,
} from './writing-runtime-presentation'

export function useWritingPipelineRuntimePresentation(input: {
  currentChapter: Chapter | null
  livePipelineSnapshot: WritingPipelineSnapshot | null
  latestPipelineTask: Task | null
}) {
  const { currentChapter, latestPipelineTask, livePipelineSnapshot } = input
  return useMemo(() => buildWritingPipelineRuntimePresentation({
    chapterId: currentChapter?.id || null,
    latestTask: latestPipelineTask,
    liveSnapshot: livePipelineSnapshot,
  }), [currentChapter?.id, latestPipelineTask, livePipelineSnapshot])
}

export function useWritingEditorRuntimePresentation(input: {
  activeGeneration: WritingGenerationSnapshot
  lastGenerationByChapter: Record<number, WritingGenerationSnapshot>
  currentChapter: Chapter | null
  productionBriefCount: number
  staleReasonCount: number
  publishCheck: ChapterPublishCheck | null
  hasMultiSegments: boolean
  writebackStatus: ReturnType<typeof parseWritebackStatus>
}) {
  const {
    activeGeneration,
    currentChapter,
    hasMultiSegments,
    lastGenerationByChapter,
    productionBriefCount,
    publishCheck,
    staleReasonCount,
    writebackStatus,
  } = input
  const generation = useMemo(() => resolveCurrentChapterGeneration({
    activeGeneration,
    chapter: currentChapter,
    lastGenerationByChapter,
  }), [activeGeneration, currentChapter, lastGenerationByChapter])
  const advisoryCount = useMemo(() => countWritingEditorAdvisories({
    productionBriefCount,
    staleReasonCount,
    readyForNextChapter: writebackStatus?.readyForNextChapter,
    hasPublishCheck: Boolean(publishCheck),
    hasMultiSegments,
  }), [hasMultiSegments, productionBriefCount, publishCheck, staleReasonCount, writebackStatus?.readyForNextChapter])
  return { advisoryCount, ...generation }
}

export function useWritingPreGenerationPresentation(input: {
  currentChapter: Chapter | null
  foreshadowSnapshot: ForeshadowSnapshot | null
  chapterContextPreview: ChapterContextPreview | null
}) {
  const writebackStatus = useMemo(
    () => parseWritebackStatus(input.currentChapter?.writebackStatusJson),
    [input.currentChapter?.writebackStatusJson],
  )
  const activePromptOverrideKeys = useMemo(
    () => input.chapterContextPreview?.generationExplainability?.activePromptOverrideKeys || [],
    [input.chapterContextPreview?.generationExplainability?.activePromptOverrideKeys],
  )
  const dueForeshadow = useMemo(
    () => buildDueForeshadowPresentation(input.foreshadowSnapshot),
    [input.foreshadowSnapshot],
  )
  return { activePromptOverrideKeys, dueForeshadow, writebackStatus }
}
