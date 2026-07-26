import { collectQualityGuardrailFindings } from '../../src/shared/content-guardrails'
import type { RewriteMiniReviewVerdict } from './chapter-pipeline-policy.service'
import type { ChapterReviewNotes } from './chapter-review-notes'

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
