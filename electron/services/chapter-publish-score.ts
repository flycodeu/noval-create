import type { ChapterContractValidationResult } from '../../src/types'
import { normalizeChapterGateScoreBreakdown } from './chapter-gate-utils'
import type { ConsistencyIssue } from './consistency.service'
import { getPublishContractValidationScore } from './chapter-publish-contract-gate'
import type {
  ChapterContractAudit,
  ChapterGateLevel,
  ChapterPublishCheckItem,
  ChapterPublishCheckScoreBreakdown,
  ContractAuditStatus,
  ReviewStateSnapshot,
} from './chapter-publish-types'

function gateScoreForStatus(status: ChapterGateLevel | ContractAuditStatus): number {
  if (status === 'pass') return 100
  if (status === 'warning') return 70
  if (status === 'blocker') return 30
  return 0
}

export function buildChapterGateSummary(
  gateLevel: ChapterGateLevel,
  rewriteCount: number,
  blockerCount: number,
  warningCount: number,
): string {
  if (gateLevel === 'rewrite') {
    return `章节验收要求退回重写，命中 ${rewriteCount} 项重写、${blockerCount} 项阻塞、${warningCount} 项预警。`
  }
  if (gateLevel === 'blocker') {
    return `章节验收未通过，命中 ${blockerCount} 项阻塞、${warningCount} 项预警。`
  }
  if (gateLevel === 'warning') {
    return `章节验收可进入人工复核，但仍有 ${warningCount} 项预警。`
  }
  return '章节验收通过。'
}

export interface PublishCheckScoreContext {
  contractAudit: ChapterContractAudit
  contractValidation?: ChapterContractValidationResult | null
  checklist: ChapterPublishCheckItem[]
  reviewState: ReviewStateSnapshot
  aiScore: number | null
  highIssues: ConsistencyIssue[]
  mediumIssues: ConsistencyIssue[]
  staleReasons: string[]
  recallStaleCount: number
  sceneHookCount: number
  weakFunction: boolean
  blockerCount: number
  warningCount: number
  rewriteCount: number
}

function averageScores(values: number[], fallback = 70): number {
  if (values.length === 0) return fallback
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function scoreChecklistItem(
  checklist: ChapterPublishCheckItem[],
  key: string,
  fallback: ChapterGateLevel | ContractAuditStatus = 'warning',
): number {
  return gateScoreForStatus(checklist.find((item) => item.key === key)?.status || fallback)
}

function clampGateScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function reduceGateScore(base: number, penalties: number[]): number {
  return clampGateScore(base - penalties.reduce((sum, penalty) => sum + penalty, 0))
}

function calculateContractAuditScore(contractAudit: ChapterContractAudit): number {
  const contractTotal = Math.max(contractAudit.items.length, 1)
  let contractScore = Math.round(contractAudit.items.reduce((sum, item) => sum + gateScoreForStatus(item.status), 0) / contractTotal)
  if (contractAudit.blockerCount > 0) {
    contractScore = Math.min(contractScore, 59)
  } else if (contractAudit.warningCount > 0) {
    contractScore = Math.min(contractScore, 79)
  }
  return contractScore
}

export function buildPublishCheckScoreBreakdown(
  context: PublishCheckScoreContext,
): ChapterPublishCheckScoreBreakdown {
  const {
    contractAudit,
    contractValidation,
    checklist,
    reviewState,
    aiScore,
    highIssues,
    mediumIssues,
    staleReasons,
    recallStaleCount,
    sceneHookCount,
    weakFunction,
    blockerCount,
    warningCount,
    rewriteCount,
  } = context
  const auditContractScore = calculateContractAuditScore(contractAudit)
  const validationContractScore = getPublishContractValidationScore(contractValidation)
  let contractScore = validationContractScore == null
    ? auditContractScore
    : Math.round((auditContractScore + validationContractScore) / 2)
  if (contractValidation?.status === 'blocker') {
    contractScore = Math.min(contractScore, 49)
  } else if (contractAudit.blockerCount > 0) {
    contractScore = Math.min(contractScore, 59)
  } else if (contractValidation?.status === 'warning') {
    contractScore = Math.min(contractScore, 79)
  } else if (contractAudit.warningCount > 0) {
    contractScore = Math.min(contractScore, 79)
  }
  const hookScore = scoreChecklistItem(checklist, 'hook_strength')
  const povPurityScore = scoreChecklistItem(checklist, 'pov_purity')
  const povBoundaryScore = scoreChecklistItem(checklist, 'pov_boundary')
  const sensoryCoverageScore = scoreChecklistItem(checklist, 'sensory_coverage')
  const narrativeRatioScore = scoreChecklistItem(checklist, 'narrative_ratio')
  const threadStatuses = checklist
    .filter((item) => item.key === 'thread_progress' || item.key === 'line_progress')
    .map((item) => gateScoreForStatus(item.status))
  const threadProgressScore = threadStatuses.length > 0
    ? Math.round(threadStatuses.reduce((sum, item) => sum + item, 0) / threadStatuses.length)
    : 70
  const volumeAlignmentScore = scoreChecklistItem(checklist, 'volume_alignment')

  const continuityScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'context'),
      scoreChecklistItem(checklist, 'continuity'),
      scoreChecklistItem(checklist, 'consistency'),
      contractScore,
      threadProgressScore,
    ]),
    [
      Math.min(staleReasons.length, 2) * 12,
      Math.min(reviewState.continuityRisks.length, 3) * 9,
      Math.min(reviewState.contextDriftRisks.length, 2) * 10,
      Math.min(recallStaleCount, 3) * 6,
      Math.min(highIssues.length, 2) * 8,
      Math.min(mediumIssues.length, 3) * 4,
    ],
  )

  const coherenceScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'summary'),
      scoreChecklistItem(checklist, 'scene_plan'),
      scoreChecklistItem(checklist, 'outline'),
      scoreChecklistItem(checklist, 'consistency'),
      contractScore,
      povPurityScore,
      povBoundaryScore,
      sensoryCoverageScore,
    ]),
    [
      Math.min(reviewState.coherenceRisks.length, 3) * 8,
      Math.min(reviewState.realismRisks.length, 2) * 7,
      Math.min(reviewState.criticalFixes.length, 3) * 5,
      Math.min(mediumIssues.length, 3) * 3,
    ],
  )

  const dialogueVoiceScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'dialogue_voice'),
      scoreChecklistItem(checklist, 'review'),
      typeof aiScore === 'number' ? clampGateScore(aiScore) : 72,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.dialogueHomogenizationRisks.length, 3) * 9,
      Math.min(reviewState.dialogueDriftAlerts.length, 2) * 11,
      Math.min(reviewState.crossCharacterSimilarity.length, 2) * 10,
      Math.min(reviewState.humanLanguageRepairs.length, 2) * 4,
    ],
  )

  const hookStrengthScore = reduceGateScore(
    averageScores([
      hookScore,
      scoreChecklistItem(checklist, 'line_progress'),
      scoreChecklistItem(checklist, 'story_dynamics'),
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.readerHookRisks.length, 3) * 10,
      sceneHookCount === 0 ? 8 : 0,
      weakFunction ? 6 : 0,
    ],
  )

  const storyDynamicsScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'story_dynamics'),
      scoreChecklistItem(checklist, 'line_progress'),
      threadProgressScore,
      volumeAlignmentScore,
      contractScore,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.arcProgressRisks.length, 3) * 9,
      Math.min(reviewState.missingPayoffs.length, 2) * 12,
      reviewState.costEvaporation ? 14 : 0,
      reviewState.forcedReversal ? 14 : 0,
      reviewState.tooSmooth ? 10 : 0,
      reviewState.highPressureNoReward ? 10 : 0,
    ],
  )

  const languageNaturalnessScore = reduceGateScore(
    averageScores([
      scoreChecklistItem(checklist, 'review'),
      scoreChecklistItem(checklist, 'ai_score'),
      typeof aiScore === 'number' ? clampGateScore(aiScore) : 72,
      dialogueVoiceScore,
      povBoundaryScore,
      sensoryCoverageScore,
      narrativeRatioScore,
    ]),
    [
      Math.min(reviewState.languageRisks.length, 3) * 9,
      Math.min(reviewState.humanLanguageRepairs.length, 3) * 7,
      Math.min(reviewState.genreHollowingRisks.length, 2) * 8,
      Math.min(reviewState.coherenceRisks.length, 2) * 4,
    ],
  )

  const styleComplianceBaseScore = reviewState.styleComplianceChecked
    ? scoreChecklistItem(checklist, 'style_compliance')
    : 72
  let styleComplianceScore = reviewState.styleComplianceChecked
    ? reduceGateScore(
      averageScores([
        styleComplianceBaseScore,
        languageNaturalnessScore,
        dialogueVoiceScore,
        povBoundaryScore,
        narrativeRatioScore,
      ]),
      [
        Math.min(reviewState.styleComplianceDeviations.length, 3) * 8,
        Math.min(reviewState.styleComplianceForbiddenPatterns.length, 2) * 12,
      ],
    )
    : averageScores([languageNaturalnessScore, dialogueVoiceScore, povBoundaryScore], 72)
  if (reviewState.styleComplianceStatus === 'rewrite') {
    styleComplianceScore = Math.min(styleComplianceScore, 49)
  } else if (reviewState.styleComplianceStatus === 'warning') {
    styleComplianceScore = Math.min(styleComplianceScore, 79)
  }

  let totalScore = clampGateScore(
    continuityScore * 0.18
    + coherenceScore * 0.14
    + dialogueVoiceScore * 0.11
    + hookStrengthScore * 0.09
    + storyDynamicsScore * 0.14
    + languageNaturalnessScore * 0.11
    + styleComplianceScore * 0.10
    + povBoundaryScore * 0.06
    + sensoryCoverageScore * 0.04
    + narrativeRatioScore * 0.03,
  )

  if (rewriteCount > 0) {
    totalScore = Math.min(totalScore, 39)
  } else if (blockerCount > 0) {
    totalScore = Math.min(totalScore, 59)
  } else if (warningCount > 0) {
    totalScore = Math.min(totalScore, 79)
  }

  return normalizeChapterGateScoreBreakdown({
    totalScore,
    continuityScore,
    coherenceScore,
    dialogueVoiceScore,
    hookStrengthScore,
    storyDynamicsScore,
    languageNaturalnessScore,
    styleComplianceScore,
    povBoundaryScore,
    sensoryCoverageScore,
    narrativeRatioScore,
    contractScore,
    hookScore,
    povPurityScore,
    threadProgressScore,
    volumeAlignmentScore,
  })
}

export function buildChapterGateTopIssueKeys(
  checklist: ChapterPublishCheckItem[],
  contractAudit: ChapterContractAudit,
  contractValidation?: ChapterContractValidationResult | null,
): string[] {
  const issueKeys = [
    ...checklist.filter((item) => item.status === 'rewrite').map((item) => item.key),
    ...checklist.filter((item) => item.status === 'blocker').map((item) => item.key),
    ...contractAudit.items.filter((item) => item.status === 'blocker').map((item) => `contract:${item.key}`),
    ...(contractValidation?.itemResults || [])
      .filter((item) => item.verdict === 'missing' || item.verdict === 'contradicted')
      .map((item) => `contract_delivery:${item.contractItemType}:${item.contractItemId || item.segmentId || item.expected}`),
    ...checklist.filter((item) => item.status === 'warning').map((item) => item.key),
    ...contractAudit.items.filter((item) => item.status === 'warning').map((item) => `contract:${item.key}`),
    ...(contractValidation?.itemResults || [])
      .filter((item) => item.verdict === 'weak' || item.verdict === 'overdelivered')
      .map((item) => `contract_delivery:${item.contractItemType}:${item.contractItemId || item.segmentId || item.expected}`),
  ]
  return [...new Set(issueKeys)].slice(0, 8)
}
