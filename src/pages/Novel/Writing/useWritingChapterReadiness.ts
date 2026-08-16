import { useMemo } from 'react'
import { getChapterWritabilitySummary } from '../../../shared/novel-workspace'
import type {
  Chapter,
  ChapterPublishCheck,
  ChapterSegment,
  Character,
  NovelContextStatus,
  StoryMemorySnapshot,
  TimelineEvent,
  WritebackSyncStatus,
} from '../../../types'
import { buildGenerationPreflight } from './writing-chapter-presentation'

interface UseWritingChapterReadinessInput {
  chapter: Chapter | null
  publishCheck: ChapterPublishCheck | null
  sceneCount: number
  chapterSegments: ChapterSegment[]
  storyMemory: StoryMemorySnapshot | null
  chapterCharacters: Character[]
  relatedEvents: TimelineEvent[]
  staleReasonCount: number
  dueForeshadowCount: number
  contextStatus: NovelContextStatus | null
  writebackStatus: WritebackSyncStatus | null
}

export function useWritingChapterReadiness(input: UseWritingChapterReadinessInput) {
  const writability = useMemo(() => getChapterWritabilitySummary({
    chapter: input.chapter,
    publishCheck: input.publishCheck,
    scenePlanCount: input.sceneCount,
    chapterSegmentCount: input.chapterSegments.length,
    threadCount: input.storyMemory?.activeThreads.length || 0,
    chapterCharactersCount: input.chapterCharacters.length,
    relatedEventCount: input.relatedEvents.length,
    staleReasonCount: input.staleReasonCount,
    dueForeshadowCount: input.dueForeshadowCount,
    revisionBlockerCount: input.publishCheck?.blockerCount || 0,
    staleAssetCount: input.contextStatus?.staleAssetCount || 0,
    staleCheckpointCount: input.contextStatus?.staleCheckpointCount || 0,
  }), [
    input.chapter,
    input.chapterCharacters.length,
    input.chapterSegments.length,
    input.contextStatus?.staleAssetCount,
    input.contextStatus?.staleCheckpointCount,
    input.dueForeshadowCount,
    input.publishCheck,
    input.relatedEvents.length,
    input.sceneCount,
    input.staleReasonCount,
    input.storyMemory?.activeThreads.length,
  ])

  const generationPreflight = useMemo(() => buildGenerationPreflight({
    chapter: input.chapter,
    writability,
    writebackStatus: input.writebackStatus,
  }), [input.chapter, input.writebackStatus, writability])

  return { generationPreflight, writability }
}
