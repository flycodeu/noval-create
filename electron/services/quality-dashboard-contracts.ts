import type { QualityDashboardData } from '../../src/types'

type DirectDashboardFields = Pick<QualityDashboardData,
  | 'agentQualityObservability'
  | 'millionRuntimeObservability'
  | 'typedRefObservability'
  | 'structuredMemoryObservability'
  | 'repairActionSummary'
  | 'repairMetrics'
  | 'heatmapData'
  | 'overallScoreTrend'
  | 'aiLikeRateTrend'
  | 'chapterGateTrend'
  | 'chapterGateHeatmap'
  | 'chapterGateSummary'
  | 'chapterGateDriftAlerts'
  | 'languageDriftTrends'
  | 'recentLanguageDriftAlerts'
  | 'volumeLanguageDrift'
  | 'novelLanguageDriftSummary'
  | 'storyDynamicsTrend'
  | 'storyPacingAlerts'
  | 'volumeStoryDynamics'
  | 'novelQualityMetrics'
  | 'chapterFunctionSummary'
  | 'repeatedFunctionRuns'
  | 'chapterFunctionAlerts'
  | 'volumeChapterFunctions'
  | 'storyArcProgressSummary'
  | 'storyArcProgressTrend'
  | 'recentWorldStateAlerts'
  | 'expressionDedupSummary'
  | 'summaryHealthSummary'
  | 'hookContinuitySummary'
  | 'voiceEvolutionSummary'
  | 'recallSummary'
  | 'recentRecallAlerts'
  | 'recentEndgameDebtAlerts'
  | 'volumeRecallDiagnostics'
  | 'volumeWorldStateStability'
  | 'worldStateSummary'
  | 'protagonistSetbackSummary'
  | 'reversalDistributionSummary'
  | 'weakDimensionFrequency'
  | 'chapterDetails'
>

export type QualityDashboardAssemblyContext = DirectDashboardFields & {
  rows: Array<{ id: number; launchMode?: string | null }>
  novelMeta: {
    launchMode?: string | null
    targetWords?: number | null
    settingsJson?: string | null
    genreName?: string | null
  } | null
  millionWordDashboard: Pick<QualityDashboardData,
    'productionReadiness' | 'batchHealth' | 'continuityHealth' | 'contractDelivery' | 'batchReview'
  > & { dashboardNotes: string[] }
  currentOperatingMode: NonNullable<QualityDashboardData['operatingModeObservability']>['mode']
  currentOperatingModePolicy: {
    label: string
    modeSummary: string
    chapterWords: { recommended: number }
    recentContextWindow: number
  }
  resolvedGenreKey: string
  historicalGenericFallback: boolean
  groundingAssessment: {
    mode: NonNullable<QualityDashboardData['genreGroundingObservability']>['historicalMode']
    coverage: NonNullable<QualityDashboardData['genreGroundingObservability']>['sourceCoverage']
    conservativeFallbackActive: boolean
    sourceSignals: unknown[]
    summary: string
  }
  averageLanguageDriftMetrics: QualityDashboardData['averageLanguageDrift']
  antiAiSummary: {
    overview: Omit<QualityDashboardData['antiAiRecurrence'], 'topRepeatedRules' | 'promotedRules' | 'recentAlerts' | 'volumeEntries'>
    topRepeatedRules: QualityDashboardData['antiAiRecurrence']['topRepeatedRules']
    promotedRules: QualityDashboardData['antiAiRecurrence']['promotedRules']
    recentAlerts: QualityDashboardData['antiAiRecurrence']['recentAlerts']
  }
  antiAiVolumeEntries: QualityDashboardData['antiAiRecurrence']['volumeEntries']
  feedbackSummary: {
    overview: Omit<QualityDashboardData['feedbackRecurrence'], 'topRepeatedIssues' | 'promotedIssues' | 'recentAlerts' | 'humanization' | 'volumeEntries'>
    topRepeatedIssues: QualityDashboardData['feedbackRecurrence']['topRepeatedIssues']
    promotedIssues: QualityDashboardData['feedbackRecurrence']['promotedIssues']
    recentAlerts: QualityDashboardData['feedbackRecurrence']['recentAlerts']
    humanizationSummary: QualityDashboardData['feedbackRecurrence']['humanization']
  }
  feedbackVolumeEntries: QualityDashboardData['feedbackRecurrence']['volumeEntries']
  styleComplianceSummary: QualityDashboardData['styleCompliance']
  dialogueSnapshot: Pick<QualityDashboardData,
    | 'dialogueFingerprintStats'
    | 'characterDialogueSignatures'
    | 'crossCharacterDialogueSimilarity'
    | 'dialogueDriftTrend'
    | 'volumeDialogueSimilarity'
    | 'recentDialogueAlerts'
    | 'requiredDialogueVoiceLocks'
  >
  volumeQualityMetricsWithRepairs: QualityDashboardData['volumeQualityMetrics']
  storyArcProgressSnapshot: {
    arcs: QualityDashboardData['storyArcProgressArcs']
    alerts: QualityDashboardData['storyArcProgressAlerts']
    volumeEntries: QualityDashboardData['storyArcProgressVolumes']
  }
  worldStateLedger: {
    trend: QualityDashboardData['worldStateTrend']
    conflictEntities: QualityDashboardData['worldConflictEntities']
  }
  costPersistenceState: QualityDashboardData['costPersistenceSummary']
  scoredCount: number
  totalOverall: number
  totalAiLike: number
}
