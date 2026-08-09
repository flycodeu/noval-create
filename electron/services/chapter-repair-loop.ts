import { collectQualityGuardrailFindings } from '../../src/shared/content-guardrails'
import {
  collectBlockerDimensions,
  type SemanticGateDimension,
  type SemanticGateHeuristicHint,
  type SemanticGateReview,
  type SemanticGateStatus,
  type SemanticGateVerdict,
} from '../../src/shared/semantic-gate'
import type { RewriteMiniReviewVerdict } from './chapter-pipeline-policy.service'
import { countNarrativeWords, type ChapterReviewNotes } from './chapter-review-notes'
import type { ChapterSemanticGateRun } from './semantic-gate/semantic-gate-runner.service'

export function guardrailRepairScore(findings: ReturnType<typeof collectQualityGuardrailFindings>): number {
  return findings.reduce((score, finding) => score + (
    finding.severity === 'high' ? 3 : finding.severity === 'medium' ? 2 : 1
  ), 0)
}

export function chooseBetterGuardrailCandidate(
  current: { content: string; reviewNotes: ChapterReviewNotes },
  candidate: { content: string; reviewNotes: ChapterReviewNotes },
  genre?: string,
  knownTerms: string[] = [],
): { content: string; reviewNotes: ChapterReviewNotes } {
  const currentFindings = collectQualityGuardrailFindings(current.content, genre, { knownTerms })
  const candidateFindings = collectQualityGuardrailFindings(candidate.content, genre, { knownTerms })
  const currentScore = guardrailRepairScore(currentFindings)
  const candidateScore = guardrailRepairScore(candidateFindings)
  return candidateScore < currentScore ? candidate : current
}

export type RepairDimensionOutcome = 'resolved' | 'persists' | 'regressed'

export interface RepairDimensionJudgement {
  dimension: SemanticGateDimension
  previousStatus: SemanticGateStatus
  currentStatus: SemanticGateStatus
  outcome: RepairDimensionOutcome
}

export interface RepairOutcomeJudgement {
  judgements: RepairDimensionJudgement[]
  review: SemanticGateReview | null
  degraded: boolean
  hasRegression: boolean
  resolvedCount: number
}

function judgeDimensionOutcome(previous: SemanticGateStatus, current: SemanticGateStatus): RepairDimensionOutcome {
  if (current === 'pass') return 'resolved'
  if (previous === 'blocker') {
    // blocker → pass/warning 视为已解决（以新 status 为准）；blocker → blocker 为仍存在。
    return current === 'warning' ? 'resolved' : 'persists'
  }
  if (current === 'blocker') return 'regressed'
  return 'persists'
}

/**
 * 修复复评判据：只复评上一轮 blocker/warning 维度，逐维度给出
 * resolved / persists / regressed。runGate 由调用方注入（便于预算控制与单测 mock），
 * 上一轮判定作为疑点线索回灌给语义门核实。
 */
export async function judgeRepairOutcome(params: {
  previousBlockerVerdicts: SemanticGateVerdict[]
  repairedContent: string
  runGate: (
    dimensions: SemanticGateDimension[],
    hints: SemanticGateHeuristicHint[],
  ) => Promise<ChapterSemanticGateRun>
}): Promise<RepairOutcomeJudgement> {
  const previousRelevant = params.previousBlockerVerdicts
    .filter((verdict) => verdict.status === 'blocker' || verdict.status === 'warning')
  if (previousRelevant.length === 0 || !params.repairedContent.trim()) {
    return { judgements: [], review: null, degraded: false, hasRegression: false, resolvedCount: 0 }
  }

  const dimensions = [...new Set(previousRelevant.map((verdict) => verdict.dimension))]
  const hints: SemanticGateHeuristicHint[] = previousRelevant.map((verdict) => ({
    dimension: verdict.dimension,
    source: 'previous-review',
    detail: `上一轮判定为 ${verdict.status}：${verdict.summary}`,
  }))
  const run = await params.runGate(dimensions, hints)
  if (run.degraded) {
    // 复评缺席时不做任何裁决（既不放行也不判退步），交由调用方按原判据处理。
    return { judgements: [], review: null, degraded: true, hasRegression: false, resolvedCount: 0 }
  }

  const currentByDimension = new Map(run.review.verdicts.map((verdict) => [verdict.dimension, verdict]))
  const judgements: RepairDimensionJudgement[] = previousRelevant.map((previous) => {
    const current = currentByDimension.get(previous.dimension)
    // 复评未返回该维度（按 uncertain 兜底）时保守判 persists。
    const currentStatus = current?.status ?? 'uncertain'
    return {
      dimension: previous.dimension,
      previousStatus: previous.status,
      currentStatus,
      outcome: judgeDimensionOutcome(previous.status, currentStatus),
    }
  })

  return {
    judgements,
    review: run.review,
    degraded: false,
    hasRegression: judgements.some((item) => item.outcome === 'regressed'),
    resolvedCount: judgements.filter((item) => item.outcome === 'resolved').length,
  }
}

/**
 * 增强版候选采纳判据（enforce 模式）：
 * 1. candidate 相对 current 出现新增语义 blocker 维度 → 判负；
 * 2. candidate 篇幅 < originalLength * 0.85 且语义复评仍有 blocker → 判负（防“删戏过门”）；
 * 3. 语义 blocker 数更少 → 判胜；
 * 4. 语义平手（或缺少复评数据）才用 guardrailRepairScore 破平。
 * chooseBetterGuardrailCandidate 保持原签名与行为不变。
 */
export function chooseBetterRepairCandidate(
  current: { content: string; reviewNotes: ChapterReviewNotes },
  candidate: { content: string; reviewNotes: ChapterReviewNotes },
  opts: {
    currentSemantic?: SemanticGateReview
    candidateSemantic?: SemanticGateReview
    originalLength: number
    genre?: string
    knownTerms?: string[]
  },
): { content: string; reviewNotes: ChapterReviewNotes } {
  const currentBlockerDims = new Set(opts.currentSemantic ? collectBlockerDimensions(opts.currentSemantic) : [])
  const candidateBlockerDims = opts.candidateSemantic ? collectBlockerDimensions(opts.candidateSemantic) : null

  if (candidateBlockerDims) {
    const regressedDims = candidateBlockerDims.filter((dimension) => !currentBlockerDims.has(dimension))
    if (regressedDims.length > 0) return current
    if (
      candidateBlockerDims.length > 0
      && countNarrativeWords(candidate.content) < Math.round(opts.originalLength * 0.85)
    ) {
      return current
    }
    if (opts.currentSemantic && candidateBlockerDims.length < currentBlockerDims.size) return candidate
  }

  return chooseBetterGuardrailCandidate(current, candidate, opts.genre, opts.knownTerms || [])
}

export function rewriteMiniReviewScore(verdict: RewriteMiniReviewVerdict): number {
  const narrativePenalty = verdict.narrativeDelta.status === 'fail'
    ? 300
    : verdict.narrativeDelta.status === 'weak' ? 100 : 0
  const chainPenalty = [
    verdict.narrativeDelta.conflictChain,
    verdict.narrativeDelta.costChain,
    verdict.narrativeDelta.goalChain,
  ].reduce((score, chain) => score + (chain.status === 'fail' ? 40 : chain.status === 'weak' ? 12 : 0), 0)
  return (verdict.needsHumanReview ? 1000 : 0)
    + narrativePenalty
    + chainPenalty
    + (verdict.readingExperience?.status === 'rewrite' ? 60 : 0)
}

export function rewriteOutcomeScore(outcome: {
  content: string
  miniReview: RewriteMiniReviewVerdict
}, genre?: string, knownTerms: string[] = []): number {
  return rewriteMiniReviewScore(outcome.miniReview)
    + guardrailRepairScore(collectQualityGuardrailFindings(outcome.content, genre, { knownTerms }))
}
