import { useMemo } from 'react'
import type {
  Chapter,
  ChapterContractAudit,
  ChapterPublishCheck,
  ConsistencyIssue,
  WritebackSyncStatus,
} from '../../../types'
import type { ChapterWritabilitySummary } from '../../../shared/novel-workspace'
import type { AiCheckPayload, ReviewNotes, WritingPipelineSnapshot } from './parsers'
import {
  buildAcceptanceCards,
  buildChapterHeaderViewModel,
  buildEditorHeaderViewModel,
  buildPipelineMetadata,
  buildQualityIssueItems,
} from './writing-chapter-presentation'

interface UseWritingChapterControllerInput {
  chapter: Chapter | null
  volumeName: string
  wordCount: number
  versionCount: number
  generating: boolean
  refreshing: boolean
  hasMultiSegments: boolean
  writability: ChapterWritabilitySummary
  publishCheck: ChapterPublishCheck | null
  writebackStatus: WritebackSyncStatus | null
  pipelineSnapshot: WritingPipelineSnapshot | null
  activePromptOverrideKeys: string[]
  contractAudit: ChapterContractAudit | null
  aiResult: AiCheckPayload | null
  reviewNotes: ReviewNotes | null
  chapterIssues: ConsistencyIssue[]
}

export function useWritingChapterController(input: UseWritingChapterControllerInput) {
  const header = useMemo(() => buildChapterHeaderViewModel({
    chapter: input.chapter,
    volumeName: input.volumeName,
    wordCount: input.wordCount,
    versionCount: input.versionCount,
    writability: input.writability,
  }), [input.chapter, input.versionCount, input.volumeName, input.wordCount, input.writability])

  const editor = useMemo(() => buildEditorHeaderViewModel({
    chapter: input.chapter,
    generating: input.generating,
    refreshing: input.refreshing,
    hasMultiSegments: input.hasMultiSegments,
  }), [input.chapter, input.generating, input.hasMultiSegments, input.refreshing])

  const metadata = useMemo(() => ({
    pipeline: buildPipelineMetadata({
      snapshot: input.pipelineSnapshot,
      writebackStatus: input.writebackStatus,
      activePromptOverrideKeys: input.activePromptOverrideKeys,
    }),
    acceptance: buildAcceptanceCards({
      contractAudit: input.contractAudit,
      publishCheck: input.publishCheck,
      aiResult: input.aiResult,
      reviewNotes: input.reviewNotes,
    }),
    qualityIssues: buildQualityIssueItems({
      publishCheck: input.publishCheck,
      chapterIssues: input.chapterIssues,
      aiResult: input.aiResult,
    }),
  }), [
    input.activePromptOverrideKeys,
    input.aiResult,
    input.chapterIssues,
    input.contractAudit,
    input.pipelineSnapshot,
    input.publishCheck,
    input.reviewNotes,
    input.writebackStatus,
  ])

  return { editor, header, metadata }
}
