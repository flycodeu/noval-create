import { useMemo } from 'react'
import { translateContextChangeReasons } from '../../../shared/context-change-reasons'
import type {
  Chapter,
  ChapterPublishCheck,
  Novel,
  NovelConsistencyReport,
  QualityDashboardData,
  StoryFact,
  StoryItem,
  StoryVolume,
  TimelineEvent,
} from '../../../types'
import { computeVolumeTruthRevealStats, normalizeIdArray } from './components/InsightPanel/insight-utils'
import {
  buildBridgeItems,
  buildContinuityItems,
  buildProductionBriefItems,
  buildQualityFocusItems,
  buildRelatedInsightItems,
  buildReviewInsightItems,
} from './writing-inspector-view-model'
import {
  normalizeContractAudit,
  getWorldRulesSummary,
  parseBridgePlan,
  parseContinuity,
  parseContractAudit,
  parseExpressionDedup,
  parseHookContinuity,
  parseNumberArray,
  parseReviewNotes,
  parseScenePlan,
  parseStringArray,
  parseSummaryHealth,
  type AiCheckPayload,
} from './parsers'
import { buildPublishCheckPresentation, buildRelatedChapterAssets } from './writing-presentation-model'

interface UseWritingPresentationModelInput {
  currentChapter: Chapter | null
  currentNovel: Novel | null
  chapters: Chapter[]
  timelineEvents: TimelineEvent[]
  storyItems: StoryItem[]
  storyFacts: StoryFact[]
  storyVolumes: StoryVolume[]
  consistencyReport: NovelConsistencyReport | null
  publishCheck: ChapterPublishCheck | null
  qualityDashboard: QualityDashboardData | null
  aiResult: AiCheckPayload | null
}

function useChapterNarrativePresentation(input: UseWritingPresentationModelInput) {
  const { currentChapter, currentNovel, publishCheck, storyFacts, storyVolumes } = input
  const continuity = useMemo(() => parseContinuity(currentChapter?.continuityStateJson), [currentChapter?.continuityStateJson])
  const scenePlan = useMemo(() => parseScenePlan(currentChapter?.scenePlanJson), [currentChapter?.scenePlanJson])
  const reviewNotes = useMemo(() => parseReviewNotes(currentChapter?.reviewNotesJson), [currentChapter?.reviewNotesJson])
  const bridgePlan = useMemo(() => parseBridgePlan(currentChapter?.bridgePlanJson), [currentChapter?.bridgePlanJson])
  const summaryHealth = useMemo(() => parseSummaryHealth(currentChapter?.summaryHealthJson), [currentChapter?.summaryHealthJson])
  const expressionDedup = useMemo(() => parseExpressionDedup(currentChapter?.expressionDedupJson), [currentChapter?.expressionDedupJson])
  const hookContinuity = useMemo(() => parseHookContinuity(currentChapter?.hookContinuityJson), [currentChapter?.hookContinuityJson])
  const contractAudit = useMemo(
    () => normalizeContractAudit(publishCheck?.contractAudit) || parseContractAudit(currentChapter?.contractAuditJson),
    [currentChapter?.contractAuditJson, publishCheck],
  )
  const allowedRevealFactIds = useMemo(
    () => normalizeIdArray(parseNumberArray(currentChapter?.allowedFactIdsJson)),
    [currentChapter?.allowedFactIdsJson],
  )
  const revealedFactIds = useMemo(
    () => normalizeIdArray(parseNumberArray(currentChapter?.revealedFactIdsJson)),
    [currentChapter?.revealedFactIdsJson],
  )
  const truthStats = useMemo(
    () => computeVolumeTruthRevealStats(currentChapter, storyVolumes, storyFacts),
    [currentChapter, storyFacts, storyVolumes],
  )
  const staleReasons = useMemo(
    () => translateContextChangeReasons(parseStringArray(currentChapter?.staleReasonJson)),
    [currentChapter?.staleReasonJson],
  )
  const worldRulesSummary = useMemo(() => getWorldRulesSummary(currentNovel?.worldRulesJson), [currentNovel?.worldRulesJson])
  return { allowedRevealFactIds, bridgePlan, continuity, contractAudit, expressionDedup, hookContinuity, revealedFactIds, reviewNotes, scenePlan, staleReasons, summaryHealth, truthStats, worldRulesSummary }
}

function useChapterRelatedAssets(input: UseWritingPresentationModelInput) {
  const { chapters, consistencyReport, currentChapter, storyItems, timelineEvents } = input
  return useMemo(() => buildRelatedChapterAssets({
    chapter: currentChapter,
    chapters,
    consistencyReport,
    storyItems,
    timelineEvents,
  }), [chapters, consistencyReport, currentChapter, storyItems, timelineEvents])
}

function useChapterInsightItems(
  input: UseWritingPresentationModelInput,
  narrative: ReturnType<typeof useChapterNarrativePresentation>,
  related: ReturnType<typeof useChapterRelatedAssets>,
) {
  const { aiResult, currentChapter, publishCheck, qualityDashboard } = input
  const continuityItems = useMemo(() => buildContinuityItems(narrative.continuity), [narrative.continuity])
  const bridgeItems = useMemo(() => buildBridgeItems(narrative.bridgePlan), [narrative.bridgePlan])
  const qualityFocusItems = useMemo(() => buildQualityFocusItems({
    summaryHealth: narrative.summaryHealth,
    expressionDedup: narrative.expressionDedup,
    hookContinuity: narrative.hookContinuity,
    reviewNotes: narrative.reviewNotes,
    publishSummary: publishCheck?.summary,
    nextChapterSeed: currentChapter?.nextChapterSeed,
    voiceEvolutionSummary: qualityDashboard?.voiceEvolutionSummary?.summary,
  }), [currentChapter?.nextChapterSeed, narrative.expressionDedup, narrative.hookContinuity, narrative.reviewNotes, narrative.summaryHealth, publishCheck?.summary, qualityDashboard?.voiceEvolutionSummary?.summary])
  const relatedInsightItems = useMemo(() => buildRelatedInsightItems(related.events, related.items), [related.events, related.items])
  const reviewInsightItems = useMemo(() => buildReviewInsightItems(narrative.reviewNotes), [narrative.reviewNotes])
  const productionBriefItems = useMemo(
    () => buildProductionBriefItems(narrative.reviewNotes, aiResult?.issues || []),
    [aiResult?.issues, narrative.reviewNotes],
  )
  return { bridgeItems, continuityItems, productionBriefItems, qualityFocusItems, relatedInsightItems, reviewInsightItems }
}

export function useWritingPresentationModel(input: UseWritingPresentationModelInput) {
  const narrative = useChapterNarrativePresentation(input)
  const related = useChapterRelatedAssets(input)
  const insights = useChapterInsightItems(input, narrative, related)
  const publish = useMemo(() => buildPublishCheckPresentation(input.publishCheck), [input.publishCheck])
  return { ...narrative, ...related, ...insights, publish }
}
