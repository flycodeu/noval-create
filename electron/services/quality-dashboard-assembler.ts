import type { QualityDashboardData } from '../../src/types'
import { estimateChapterCountFromOperatingMode } from '../../src/shared/operating-mode'
import type { QualityDashboardAssemblyContext } from './quality-dashboard.service'

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100
}

export function assembleQualityDashboardData(
  context: QualityDashboardAssemblyContext,
): QualityDashboardData {
  const { rows, novelMeta, millionWordDashboard, currentOperatingMode } = context
  const { currentOperatingModePolicy, agentQualityObservability, millionRuntimeObservability } = context
  const { resolvedGenreKey, historicalGenericFallback, groundingAssessment } = context
  const { typedRefObservability, structuredMemoryObservability, repairActionSummary, repairMetrics } = context
  const { heatmapData, overallScoreTrend, aiLikeRateTrend, chapterGateTrend } = context
  const { chapterGateHeatmap, chapterGateSummary, chapterGateDriftAlerts, languageDriftTrends } = context
  const { averageLanguageDriftMetrics, recentLanguageDriftAlerts, volumeLanguageDrift } = context
  const { novelLanguageDriftSummary, antiAiSummary, antiAiVolumeEntries } = context
  const { feedbackSummary, feedbackVolumeEntries, styleComplianceSummary, dialogueSnapshot } = context
  const { storyDynamicsTrend, storyPacingAlerts, volumeStoryDynamics } = context
  const { volumeQualityMetricsWithRepairs, novelQualityMetrics, chapterFunctionSummary } = context
  const { repeatedFunctionRuns, chapterFunctionAlerts, volumeChapterFunctions } = context
  const { storyArcProgressSummary, storyArcProgressTrend, storyArcProgressSnapshot } = context
  const { worldStateLedger, recentWorldStateAlerts, expressionDedupSummary } = context
  const { summaryHealthSummary, hookContinuitySummary, voiceEvolutionSummary } = context
  const { recallSummary, recentRecallAlerts, recentEndgameDebtAlerts } = context
  const { volumeRecallDiagnostics, volumeWorldStateStability, worldStateSummary } = context
  const { protagonistSetbackSummary, costPersistenceState, reversalDistributionSummary } = context
  const { weakDimensionFrequency, chapterDetails, scoredCount, totalOverall, totalAiLike } = context

  return {
    dashboardVersion: 'v2-repair',
    dashboardNotes: [
      ...millionWordDashboard.dashboardNotes,
      '当前版本已升级为质量修复引擎：每个高价值风险都会给出原因、修法和直接动作。',
      '安全动作会直接落任务，其他动作会保留定位信息并引导到对应页面处理。',
    ],
    operatingModeObservability: {
      mode: currentOperatingMode,
      label: currentOperatingModePolicy.label,
      summary: currentOperatingModePolicy.modeSummary,
      quickStartAligned: (novelMeta?.launchMode || '') === 'fast_launch' && currentOperatingMode === 'shortform',
      recommendedChapterWords: currentOperatingModePolicy.chapterWords.recommended,
      estimatedChapterCount: estimateChapterCountFromOperatingMode({
        launchMode: novelMeta?.launchMode,
        targetWords: novelMeta?.targetWords,
        settingsJson: novelMeta?.settingsJson,
        chapterCount: rows.length,
      }),
      recentContextWindow: currentOperatingModePolicy.recentContextWindow,
    },
    agentQualityObservability,
    millionRuntimeObservability,
    genreGroundingObservability: {
      genreName: novelMeta?.genreName || '未设置题材',
      resolvedGenreKey,
      historicalGenericFallback,
      historicalMode: groundingAssessment.mode,
      sourceCoverage: groundingAssessment.coverage,
      conservativeFallbackActive: groundingAssessment.conservativeFallbackActive,
      sourceSignalCount: groundingAssessment.sourceSignals.length,
      summary: historicalGenericFallback
        ? '当前历史题材仍落在 generic fallback，应继续补来源层或 capability pack 约束。'
        : groundingAssessment.mode !== 'none'
          ? `${groundingAssessment.summary} 当前题材已命中 ${resolvedGenreKey} capability pack。`
          : `当前题材已命中 ${resolvedGenreKey} capability pack。`,
    },
    typedRefObservability,
    structuredMemoryObservability,
    repairActionSummary,
    repairMetrics,
    heatmapData,
    overallScoreTrend,
    aiLikeRateTrend,
    chapterGateTrend,
    chapterGateHeatmap,
    chapterGateSummary,
    chapterGateDriftAlerts,
    languageDriftTrends,
    averageLanguageDrift: averageLanguageDriftMetrics,
    recentLanguageDriftAlerts,
    volumeLanguageDrift,
    novelLanguageDriftSummary,
    antiAiRecurrence: {
      totalHitCount: antiAiSummary.overview.totalHitCount,
      hitChapterCount: antiAiSummary.overview.hitChapterCount,
      recurringRuleCount: antiAiSummary.overview.recurringRuleCount,
      promotedRuleCount: antiAiSummary.overview.promotedRuleCount,
      highRiskRuleCount: antiAiSummary.overview.highRiskRuleCount,
      topRepeatedRules: antiAiSummary.topRepeatedRules,
      promotedRules: antiAiSummary.promotedRules,
      recentAlerts: antiAiSummary.recentAlerts,
      volumeEntries: antiAiVolumeEntries,
    },
    feedbackRecurrence: {
      totalHitCount: feedbackSummary.overview.totalHitCount,
      hitChapterCount: feedbackSummary.overview.hitChapterCount,
      recurringIssueCount: feedbackSummary.overview.recurringIssueCount,
      promotedIssueCount: feedbackSummary.overview.promotedIssueCount,
      highRiskIssueCount: feedbackSummary.overview.highRiskIssueCount,
      pauseSuggestedIssueCount: feedbackSummary.overview.pauseSuggestedIssueCount,
      topRepeatedIssues: feedbackSummary.topRepeatedIssues,
      promotedIssues: feedbackSummary.promotedIssues,
      recentAlerts: feedbackSummary.recentAlerts,
      humanization: {
        totalHitCount: feedbackSummary.humanizationSummary.totalHitCount,
        hitChapterCount: feedbackSummary.humanizationSummary.hitChapterCount,
        recurringIssueCount: feedbackSummary.humanizationSummary.recurringIssueCount,
        promotedIssueCount: feedbackSummary.humanizationSummary.promotedIssueCount,
        highRiskIssueCount: feedbackSummary.humanizationSummary.highRiskIssueCount,
        pauseSuggestedIssueCount: feedbackSummary.humanizationSummary.pauseSuggestedIssueCount,
        topRepeatedIssues: feedbackSummary.humanizationSummary.topRepeatedIssues,
        promotedIssues: feedbackSummary.humanizationSummary.promotedIssues,
        recentAlerts: feedbackSummary.humanizationSummary.recentAlerts,
      },
      volumeEntries: feedbackVolumeEntries,
    },
    styleCompliance: styleComplianceSummary,
    dialogueFingerprintStats: dialogueSnapshot.dialogueFingerprintStats,
    characterDialogueSignatures: dialogueSnapshot.characterDialogueSignatures,
    crossCharacterDialogueSimilarity: dialogueSnapshot.crossCharacterDialogueSimilarity,
    dialogueDriftTrend: dialogueSnapshot.dialogueDriftTrend,
    volumeDialogueSimilarity: dialogueSnapshot.volumeDialogueSimilarity,
    recentDialogueAlerts: dialogueSnapshot.recentDialogueAlerts,
    requiredDialogueVoiceLocks: dialogueSnapshot.requiredDialogueVoiceLocks,
    storyDynamicsTrend,
    storyPacingAlerts,
    volumeStoryDynamics,
    volumeQualityMetrics: volumeQualityMetricsWithRepairs,
    novelQualityMetrics,
    productionReadiness: millionWordDashboard.productionReadiness,
    batchHealth: millionWordDashboard.batchHealth,
    continuityHealth: millionWordDashboard.continuityHealth,
    contractDelivery: millionWordDashboard.contractDelivery,
    batchReview: millionWordDashboard.batchReview,
    chapterFunctionSummary,
    repeatedFunctionRuns,
    chapterFunctionAlerts,
    volumeChapterFunctions,
    storyArcProgressSummary,
    storyArcProgressTrend,
    storyArcProgressArcs: storyArcProgressSnapshot.arcs,
    storyArcProgressAlerts: storyArcProgressSnapshot.alerts,
    storyArcProgressVolumes: storyArcProgressSnapshot.volumeEntries,
    worldStateTrend: worldStateLedger.trend,
    recentWorldStateAlerts,
    worldConflictEntities: worldStateLedger.conflictEntities,
    expressionDedupSummary,
    summaryHealthSummary,
    hookContinuitySummary,
    voiceEvolutionSummary,
    recallSummary,
    recentRecallAlerts,
    recentEndgameDebtAlerts,
    volumeRecallDiagnostics,
    volumeWorldStateStability,
    worldStateSummary,
    protagonistSetbackSummary,
    costPersistenceSummary: {
      averageCostDuration: costPersistenceState.averageCostDuration,
      evaporatedCostCount: costPersistenceState.evaporatedCostCount,
      unresolvedCostCount: costPersistenceState.unresolvedCostCount,
      activeCosts: costPersistenceState.activeCosts,
    },
    reversalDistributionSummary,
    weakDimensionFrequency,
    chapterDetails,
    totalChaptersScored: scoredCount,
    averageOverallScore: scoredCount > 0 ? roundMetric(totalOverall / scoredCount) : 0,
    averageAiLikeRate: scoredCount > 0 ? roundMetric(totalAiLike / scoredCount) : 0,
  }
}
