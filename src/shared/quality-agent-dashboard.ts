import type { AgentArtifactStatus } from './agent-artifacts'

export interface QualityAgentArtifactHistoryEntry {
  id: string
  kind: string
  status: AgentArtifactStatus
  version: number
  parentArtifactId: string | null
  reviewArtifactId: string | null
  contentHash: string
  contextVersion: number
  taskId: number | null
  createdAt: string
  updatedAt: string
}

export interface QualityAgentLatestReportView {
  artifactId: string
  status: 'passed' | 'needs_revision' | 'blocked'
  profile: string
  scopeLabel: string
  score: number
  confidenceLowerBound: number
  coverageRate: number
  contextVersion: number
  findingsCount: number
  blockingFindingCount: number
  summary: string
  semanticReview?: {
    coveredChapterCount: number
    totalScopeChapterCount: number
    semanticCoverageRate: number
    validEvidenceCount: number
    rejectedEvidenceCount: number
    independentModelReview: boolean
  }
}

export interface QualityAgentRepairPlanView {
  artifactId: string
  status: 'ready' | 'blocked'
  sourceReportArtifactId: string
  sourceContextVersion: number
  summary: string
  items: Array<{
    id: string
    priority: number
    severity: string
    blocking: boolean
    objective: string
    targetChapterNums: number[]
    dependencies: string[]
    acceptanceCriteriaCount: number
    regressionGuardsCount: number
    requiresHumanApproval: boolean
  }>
}

export interface QualityAgentCandidateDiffView {
  artifactId: string
  status: AgentArtifactStatus
  reviewArtifactId: string | null
  sourceReportArtifactId: string
  sourceContextVersion: number
  summary: string
  readyForHumanReview: boolean
  chapters: Array<{
    chapterId: number
    chapterNum: number
    title: string
    originalContentHash: string
    optimizedContentHash: string
    changed: boolean
    issueSummary: string[]
    warnings: string[]
    factGuardStatus: string
    qualityGateStatus: string
    taskId: number | null
  }>
}

export interface QualityAgentIndependentReviewView {
  artifactId: string
  status: AgentArtifactStatus
  score: number
  readyForHumanDecision: boolean
  independentModelReview: boolean
  summary: string
  chapters: Array<{
    chapterId: number
    chapterNum: number
    title: string
    reviewTaskId: number
    separateReviewTask: boolean
    status: string
    score: number
    evidenceCoverageRate: number
    checkCount: number
    evidencedCheckCount: number
    regressionRiskCount: number
  }>
}

export interface QualityAgentComparisonView {
  artifactId: string
  createdAt: string
  baselineReportArtifactId: string
  candidateReportArtifactId: string
  status: 'improved' | 'mixed' | 'regressed' | 'unchanged'
  scoreDelta: number
  coverageRateDelta: number
  confidenceLowerBoundDelta: number
  introducedBlockerCount: number
  candidateStatus: 'passed' | 'needs_revision' | 'blocked'
  readyForHumanReview: boolean
  summary: string
  warnings: string[]
}

export interface QualityAgentDashboardSnapshot {
  artifactHistory: QualityAgentArtifactHistoryEntry[]
  latestReport?: QualityAgentLatestReportView
  repairPlans: QualityAgentRepairPlanView[]
  candidateDiffs: QualityAgentCandidateDiffView[]
  independentReviews: QualityAgentIndependentReviewView[]
  comparisons: QualityAgentComparisonView[]
  summary: {
    artifactCount: number
    reportCount: number
    repairPlanCount: number
    candidateDiffCount: number
    independentReviewCount: number
    comparisonCount: number
    latestContextVersion?: number
  }
}
