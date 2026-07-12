import type { AgentArtifact } from './agent-artifacts'
import type {
  ChapterOptimizationFactGuard,
  ChapterOptimizationQualityGate,
  QualityDashboardRiskKind,
  QualityRepairAction,
  QualityRepairMetricKey,
} from '../types'

export type AgentQualityProfile = 'longform_health_v1' | 'recommendation_ready_v1'
export type AgentQualityScopeType = 'novel' | 'volume' | 'chapter'
export type AgentQualityStatus = 'passed' | 'needs_revision' | 'blocked'
export type AgentQualityFindingSeverity = 'info' | 'warning' | 'critical'

export interface AgentQualityScope {
  type: AgentQualityScopeType
  label: string
  volumeId?: number
  chapterId?: number
  chapterNums: number[]
}

export interface AgentQualityProfileSnapshot {
  profile: AgentQualityProfile
  minimumHealthScore: number
  minimumAverageScore: number
  minimumCoverageRate: number
  maximumAverageAiLikeRate: number
  requireProductionReady: boolean
  blockCriticalRisks: boolean
  blockRiskyChapterGates: boolean
  blockHighRiskAiRecurrence: boolean
  blockFeedbackPauseSignals: boolean
}

export interface AgentQualityFindingAction {
  id: string
  label: string
  description: string
  actionType: QualityRepairAction['actionType']
  metricKey: QualityRepairMetricKey
  targetPage: string
  safeToExecute: boolean
  chapterId?: number
  chapterNum?: number
  entityType?: string
  entityId?: number
}

export interface AgentQualityFinding {
  id: string
  signature: string
  code: string
  kind: QualityDashboardRiskKind | 'coverage' | 'score' | 'production_readiness' | 'chapter_gate' | 'semantic'
  severity: AgentQualityFindingSeverity
  blocking: boolean
  title: string
  detail: string
  whyItHappened: string
  howToFix: string
  volumeId?: number
  chapterNums: number[]
  evidenceRefs: string[]
  suggestedActions: AgentQualityFindingAction[]
}

export interface AgentQualityMetricSnapshot {
  healthScore: number
  averageOverallScore: number
  averageAiLikeRate: number
  coverageRate: number
  totalChapterCount: number
  analyzedChapterCount: number
  criticalRiskCount: number
  warningRiskCount: number
  riskyChapterGateCount: number
  productionReadinessStatus: 'ready' | 'warning' | 'blocked'
  highRiskAiRecurrenceCount: number
  feedbackPauseSuggestedCount: number
}

export interface AgentQualityRepairMetricSnapshot {
  key: QualityRepairMetricKey
  label: string
  score: number
  summary: string
  riskCount: number
  focusLabels: string[]
}

export interface AgentQualityReportContent {
  schemaVersion: 'agent-quality-report-v1'
  requestFingerprint: string
  profile: AgentQualityProfileSnapshot
  scope: AgentQualityScope
  status: AgentQualityStatus
  score: number
  confidenceLowerBound: number
  coverageRate: number
  summary: string
  blockers: string[]
  warnings: string[]
  findings: AgentQualityFinding[]
  metrics: AgentQualityMetricSnapshot
  repairMetrics: AgentQualityRepairMetricSnapshot[]
  semanticReview?: AgentQualitySemanticReviewSnapshot
  contextVersion: number
  baselineReportArtifactId: string | null
  createdAt: string
}

export type AgentQualitySemanticDimension =
  | 'causality'
  | 'character_arc'
  | 'theme_progression'
  | 'world_consistency'
  | 'foreshadow_payoff'
  | 'pacing'

export interface AgentQualitySemanticReviewSnapshot {
  schemaVersion: 'agent-quality-semantic-review-v1'
  sourceReportArtifactId: string
  sourceReportContentHash: string
  dimensions: AgentQualitySemanticDimension[]
  totalScopeChapterCount: number
  coveredChapterCount: number
  semanticCoverageRate: number
  windowCount: number
  failedWindowCount: number
  dimensionCoverageRate: number
  validEvidenceCount: number
  rejectedEvidenceCount: number
  taskIds: number[]
  independentModelReview: true
}

export interface RunAgentQualityEvaluationInput {
  novelId: number
  scopeType?: AgentQualityScopeType
  volumeId?: number
  chapterId?: number
  profile?: AgentQualityProfile
  maxFindings?: number
  baselineReportArtifactId?: string
  idempotencyKey: string
}

export interface RunAgentQualityEvaluationResult {
  reportArtifact: AgentArtifact<AgentQualityReportContent>
  report: AgentQualityReportContent
  idempotentReplay: boolean
}

export interface RunAgentQualitySemanticEvaluationInput {
  novelId: number
  reportArtifactId: string
  dimensions?: AgentQualitySemanticDimension[]
  maxWindows?: number
  maxFindings?: number
  executionMode?: 'fast' | 'balanced' | 'premium' | 'review_first' | 'cost_saver'
  idempotencyKey: string
}

export interface RunAgentQualitySemanticEvaluationResult extends RunAgentQualityEvaluationResult {
  sourceReportArtifact: AgentArtifact<AgentQualityReportContent>
}

export interface AgentRepairPlanItem {
  id: string
  priority: number
  severity: AgentQualityFindingSeverity
  blocking: boolean
  findingIds: string[]
  objective: string
  rationale: string
  targetVolumeId?: number
  targetChapterNums: number[]
  actionRefs: AgentQualityFindingAction[]
  acceptanceCriteria: string[]
  regressionGuards: string[]
  dependencies: string[]
  requiresHumanApproval: boolean
}

export interface AgentRepairPlanContent {
  schemaVersion: 'agent-repair-plan-v1'
  requestFingerprint: string
  sourceReportArtifactId: string
  sourceReportContentHash: string
  sourceContextVersion: number
  status: 'ready' | 'blocked'
  summary: string
  goals: string[]
  hardBlockers: string[]
  warnings: string[]
  items: AgentRepairPlanItem[]
  requiresFreshEvaluationAfterDraft: boolean
  canonicalWriteAllowed: false
  createdAt: string
}

export interface ProposeAgentQualityRepairsInput {
  novelId: number
  reportArtifactId: string
  goals?: string[]
  maxItems?: number
  idempotencyKey: string
}

export interface ProposeAgentQualityRepairsResult {
  sourceReportArtifact: AgentArtifact<AgentQualityReportContent>
  repairPlanArtifact: AgentArtifact<AgentRepairPlanContent>
  plan: AgentRepairPlanContent
  idempotentReplay: boolean
}

export interface AgentQualityRepairDraftChapter {
  chapterId: number
  chapterNum: number
  title: string
  repairItemIds: string[]
  originalContent: string
  originalContentHash: string
  optimizedContent: string
  optimizedContentHash: string
  changed: boolean
  issueSummary: string[]
  warnings: string[]
  factGuard: ChapterOptimizationFactGuard
  qualityGate: ChapterOptimizationQualityGate
  taskId: number | null
}

export interface AgentQualityRepairDraftContent {
  schemaVersion: 'agent-quality-repair-draft-v1'
  requestFingerprint: string
  repairPlanArtifactId: string
  repairPlanContentHash: string
  sourceReportArtifactId: string
  sourceContextVersion: number
  selectedRepairItemIds: string[]
  status: 'ready_for_review' | 'needs_revision' | 'blocked'
  summary: string
  hardBlockers: string[]
  warnings: string[]
  chapters: AgentQualityRepairDraftChapter[]
  readyForHumanReview: boolean
  canonicalWriteAllowed: false
  requiresFreshEvaluationAfterApply: true
  createdAt: string
}

export interface ApplyAgentQualityRepairDraftInput {
  novelId: number
  repairPlanArtifactId: string
  repairItemIds?: string[]
  maxChapters?: number
  executionMode?: 'fast' | 'balanced' | 'premium' | 'review_first' | 'cost_saver'
  extraRequirements?: string
  idempotencyKey: string
}

export interface ApplyAgentQualityRepairDraftResult {
  repairPlanArtifact: AgentArtifact<AgentRepairPlanContent>
  repairDraftArtifact: AgentArtifact<AgentQualityRepairDraftContent>
  draft: AgentQualityRepairDraftContent
  idempotentReplay: boolean
}

export type AgentQualityRepairCheckType = 'acceptance' | 'regression_guard'
export type AgentQualityRepairCheckStatus = 'satisfied' | 'uncertain' | 'failed'
export type AgentQualityRepairRegressionSeverity = 'info' | 'warning' | 'critical'

export interface AgentQualityRepairReviewCheck {
  id: string
  repairItemId: string
  checkType: AgentQualityRepairCheckType
  criterion: string
  status: AgentQualityRepairCheckStatus
  evidence: string[]
  rationale: string
  recommendation: string
}

export interface AgentQualityRepairRegressionRisk {
  category: 'fact' | 'continuity' | 'character' | 'timeline' | 'foreshadow' | 'style' | 'pacing' | 'other'
  severity: AgentQualityRepairRegressionSeverity
  evidence: string[]
  recommendation: string
}

export interface AgentQualityRepairDraftChapterReview {
  chapterId: number
  chapterNum: number
  title: string
  originalContentHash: string
  optimizedContentHash: string
  draftTaskId: number | null
  reviewTaskId: number
  separateReviewTask: boolean
  status: AgentQualityStatus
  score: number
  evidenceCoverageRate: number
  summary: string
  blockers: string[]
  warnings: string[]
  checks: AgentQualityRepairReviewCheck[]
  regressionRisks: AgentQualityRepairRegressionRisk[]
  strengths: string[]
}

export interface AgentQualityRepairReviewContent {
  schemaVersion: 'agent-quality-repair-review-v1'
  requestFingerprint: string
  repairDraftArtifactId: string
  repairDraftContentHash: string
  repairPlanArtifactId: string
  repairPlanContentHash: string
  sourceContextVersion: number
  status: AgentQualityStatus
  score: number
  summary: string
  blockers: string[]
  warnings: string[]
  chapters: AgentQualityRepairDraftChapterReview[]
  independentModelReview: true
  readyForHumanDecision: boolean
  canonicalWriteAllowed: false
  requiresHumanDiff: true
  createdAt: string
}

export interface ReviewAgentQualityRepairDraftInput {
  novelId: number
  repairDraftArtifactId: string
  executionMode?: 'fast' | 'balanced' | 'premium' | 'review_first' | 'cost_saver'
  reviewFocus?: string[]
  idempotencyKey: string
}

export interface ReviewAgentQualityRepairDraftResult {
  repairDraftArtifact: AgentArtifact<AgentQualityRepairDraftContent>
  reviewArtifact: AgentArtifact<AgentQualityRepairReviewContent>
  review: AgentQualityRepairReviewContent
  idempotentReplay: boolean
}

export type AgentQualityComparisonStatus = 'improved' | 'mixed' | 'regressed' | 'unchanged'

export interface CompareAgentQualityRunsInput {
  novelId: number
  baselineReportArtifactId: string
  candidateReportArtifactId: string
}

export interface AgentQualityRunComparison {
  schemaVersion: 'agent-quality-comparison-v1'
  baselineReportArtifactId: string
  candidateReportArtifactId: string
  profileCompatible: boolean
  scopeCompatible: boolean
  status: AgentQualityComparisonStatus
  scoreDelta: number
  confidenceLowerBoundDelta: number
  coverageRateDelta: number
  closedFindings: AgentQualityFinding[]
  persistingFindings: AgentQualityFinding[]
  introducedFindings: AgentQualityFinding[]
  introducedBlockerCount: number
  candidateStatus: AgentQualityStatus
  readyForHumanReview: boolean
  summary: string
  warnings: string[]
}
