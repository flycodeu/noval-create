import type { Dispatch, SetStateAction } from 'react'
import { getAiExecutionModeLabel, type AiExecutionMode } from '../../../shared/ai-execution'
import type {
  Chapter,
  ChapterContextPreview,
  ChapterVersion,
  Character,
  ForeshadowLedgerEntry,
  HardConstraintSourceLabel,
  Novel,
  NovelConsistencyReport,
  QualityDashboardData,
  StoryFact,
  StoryMemorySnapshot,
  StoryVolume,
} from '../../../types'
import type { AiCheckPayload } from './parsers'
import type { WritingRouteKey } from './components/InsightPanel'
import { useWritingInspector } from './useWritingInspector'
import type { useWritingPipelineRuntimePresentation, useWritingPreGenerationPresentation } from './useWritingRuntimePresentation'
import type { useWritingPresentationModel } from './useWritingPresentationModel'

interface WritingInspectorCompositionInput {
  novelId: number
  chapter: Chapter | null
  novel: Novel | null
  effectiveAiExecutionMode: AiExecutionMode
  presentation: ReturnType<typeof useWritingPresentationModel>
  pipeline: ReturnType<typeof useWritingPipelineRuntimePresentation>
  preGeneration: ReturnType<typeof useWritingPreGenerationPresentation>
  context: {
    storyMemory: StoryMemorySnapshot | null
    preview: ChapterContextPreview | null
    previewError: string | null
    preserveConstraintLabels: HardConstraintSourceLabel[]
  }
  assets: {
    facts: StoryFact[]
    volumes: StoryVolume[]
    characters: Character[]
    segments: NonNullable<Parameters<typeof useWritingInspector>[0]['chapter']['chapterSegments']>
    foreshadowLedger: ForeshadowLedgerEntry[]
  }
  review: {
    consistencyReport: NovelConsistencyReport | null
    publishCheck: Parameters<typeof useWritingInspector>[0]['review']['publishCheck']
    gateReportExpanded: boolean
    qualityDashboard: QualityDashboardData | null
    aiResult: AiCheckPayload | null
  }
  history: {
    versions: ChapterVersion[]
    selectedVersion: ChapterVersion | null
    loading: boolean
  }
  saving: {
    revealConstraints: boolean
    foreshadowWriteback: boolean
  }
  actions: {
    navigate(path: string): void
    navigateToWritingRoute(route: WritingRouteKey): void
    setPreserveConstraintLabels: Dispatch<SetStateAction<HardConstraintSourceLabel[]>>
    updateRevealConstraints(nextAllowedIds: number[], nextRevealedIds: number[]): Promise<void>
    createForeshadow(data: Partial<ForeshadowLedgerEntry>): Promise<void>
    patchForeshadow(id: number, data: Partial<ForeshadowLedgerEntry>): Promise<void>
    deleteForeshadow(entry: ForeshadowLedgerEntry): void
    openGateIssue: Parameters<typeof useWritingInspector>[0]['actions']['openGateIssue']
    setGateReportExpanded: Dispatch<SetStateAction<boolean>>
    getEditorContent(): string
    regenerate(content: string): void
    setSelectedVersionId: Dispatch<SetStateAction<number | null>>
    restoreVersion(): Promise<void>
  }
}

export function useWritingInspectorComposition(input: WritingInspectorCompositionInput) {
  const { assets, chapter, context, history, novel, pipeline, preGeneration, presentation, review, saving } = input
  return useWritingInspector({
    chapter: {
      chapter,
      focus: {
        summary: chapter?.summary,
        nextChapterSeed: chapter?.nextChapterSeed,
        continuityItems: presentation.continuityItems,
        bridgeItems: presentation.bridgeItems,
        qualityItems: presentation.qualityFocusItems,
      },
      scenes: presentation.scenePlan,
      pipelineSnapshot: pipeline.snapshot,
      pipelineRoles: pipeline.roles,
      pipelineExecutionModeLabel: pipeline.executionModeLabel,
      contextPreview: context.preview,
      contextPreviewError: context.previewError,
      preserveConstraintLabels: context.preserveConstraintLabels,
      effectiveAiModeLabel: getAiExecutionModeLabel(input.effectiveAiExecutionMode),
      productionBriefItems: presentation.productionBriefItems,
      relatedInsightItems: presentation.relatedInsightItems,
      facts: assets.facts,
      volumes: assets.volumes,
      characters: assets.characters,
      allowedRevealFactIds: presentation.allowedRevealFactIds,
      revealedFactIds: presentation.revealedFactIds,
      truthStats: presentation.truthStats,
      revealConstraintsSaving: saving.revealConstraints,
      chapterSegments: assets.segments,
      foreshadowLedger: assets.foreshadowLedger,
      foreshadowWritebackSaving: saving.foreshadowWriteback,
      dueForeshadowEyebrow: preGeneration.dueForeshadow.eyebrow,
      dueForeshadowItems: preGeneration.dueForeshadow.items,
      reviewInsightItems: presentation.reviewInsightItems,
      worldRulesSummary: presentation.worldRulesSummary,
      hasWorldRules: Boolean(novel?.worldRulesJson),
    },
    storyMemory: context.storyMemory,
    review: {
      consistencyReport: review.consistencyReport,
      chapterIssues: presentation.issues,
      reviewNotes: presentation.reviewNotes,
      publishCheck: review.publishCheck,
      gateReportExpanded: review.gateReportExpanded,
      publishCheckDriftHighlights: presentation.publish.driftHighlights,
      publishCheckHistoryItems: presentation.publish.historyItems,
      publishCheckScores: presentation.publish.scores,
      publishCheckSections: presentation.publish.sections,
      contractAudit: presentation.contractAudit,
      qualityDashboard: review.qualityDashboard,
      chapter,
      aiResult: review.aiResult,
      aiScore: {
        genreContext: novel?.genreName || '',
        novelBackground: [novel?.synopsis, novel?.expandedBackground].filter(Boolean).join('\n'),
        modelConfigId: novel?.modelConfigId || undefined,
        novelId: input.novelId,
        disabled: !chapter,
      },
      focusAreas: review.consistencyReport?.focusAreas || [],
    },
    history: { chapter, ...history },
    actions: { novelId: input.novelId, chapter, ...input.actions },
  })
}
