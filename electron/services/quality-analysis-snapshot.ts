import { createHash } from 'node:crypto'
import type { ChapterContractValidationResult } from '../../src/types'
import type { QualityIssueV1 } from '../../src/shared/quality-issue'
import { parseChapterContractValidationFromReviewNotes } from './chapter-contract-validator.service'
import { readQualityIssuesFromReviewNotesJson } from './quality-issue-policy'

/** Bump when the issue or stored contract normalization rules change. */
export const QUALITY_ANALYSIS_RULES_VERSION = 'nf16-stored-quality-v1'

export interface QualityAnalysisInput {
  content: string
  reviewNotesJson?: string | null
  contextVersion: number
  rulesVersion?: string
}

export interface QualityAnalysisSnapshot {
  artifactHash: string
  contextVersion: number
  rulesVersion: string
  issues: QualityIssueV1[]
  metrics: {
    reviewHash: string
    contractValidation: ChapterContractValidationResult | null
  }
}

export interface QualityAnalysisOptions {
  contextVersion: number
  rulesVersion?: string
  snapshot?: QualityAnalysisSnapshot
  memo?: QualityAnalysisMemo
}

function hash(text: string): string {
  return createHash('sha256').update(text, 'utf16le').digest('hex')
}

function identity(input: QualityAnalysisInput) {
  return {
    artifactHash: hash(input.content),
    contextVersion: input.contextVersion,
    rulesVersion: input.rulesVersion ?? QUALITY_ANALYSIS_RULES_VERSION,
    reviewHash: hash(input.reviewNotesJson ?? ''),
  }
}

function matches(snapshot: QualityAnalysisSnapshot, expected: ReturnType<typeof identity>): boolean {
  return snapshot.artifactHash === expected.artifactHash
    && snapshot.contextVersion === expected.contextVersion
    && snapshot.rulesVersion === expected.rulesVersion
    && snapshot.metrics.reviewHash === expected.reviewHash
}

/** Pure projection of existing review artifacts; never runs a detector/model or writes state. */
export function getQualityAnalysisSnapshot(
  input: QualityAnalysisInput,
  snapshot?: QualityAnalysisSnapshot,
): QualityAnalysisSnapshot {
  const expected = identity(input)
  if (snapshot && matches(snapshot, expected)) return structuredClone(snapshot)
  const { reviewHash, ...version } = expected
  return {
    ...version,
    issues: readQualityIssuesFromReviewNotesJson(input.reviewNotesJson),
    metrics: {
      reviewHash,
      contractValidation: parseChapterContractValidationFromReviewNotes(input.reviewNotesJson),
    },
  }
}

/** Create inside one request; the closure must not be retained across requests. */
export function createQualityAnalysisMemo() {
  const entries = new Map<string, QualityAnalysisSnapshot>()
  let analysisCount = 0
  return {
    get(input: QualityAnalysisInput, snapshot?: QualityAnalysisSnapshot): QualityAnalysisSnapshot {
      const key = JSON.stringify(identity(input))
      const cached = entries.get(key)
      if (cached) return structuredClone(cached)
      const result = getQualityAnalysisSnapshot(input, snapshot)
      analysisCount += 1
      entries.set(key, structuredClone(result))
      return result
    },
    diagnostics() {
      return { analysisCount, entryCount: entries.size }
    },
  }
}

export type QualityAnalysisMemo = ReturnType<typeof createQualityAnalysisMemo>
