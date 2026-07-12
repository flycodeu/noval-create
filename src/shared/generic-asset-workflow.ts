import type { AiExecutionMode } from './ai-execution'
import type { AgentArtifact } from './agent-artifacts'
import type { AssetReviewResult, AssetReviewTarget } from '../types'

export type GenericAssetType = AssetReviewTarget
export type GenericAssetOutputFormat = 'json' | 'markdown' | 'text'

export interface GenericAssetQualitySnapshot {
  stage: 'accepted' | 'rewritten' | 'rejected'
  review: AssetReviewResult
  rewrittenReview?: AssetReviewResult
  warnings: string[]
}

export interface GenericAssetDraftContent {
  schemaVersion: 'generic-asset-draft-v1'
  requestFingerprint: string
  assetType: GenericAssetType
  title: string
  outputFormat: GenericAssetOutputFormat
  requirements: string[]
  schemaHint: string
  output: string
  contextSummaryHash: string
  taskId: number
  quality: GenericAssetQualitySnapshot
  createdAt: string
}

export interface GenericAssetReviewCheck {
  code: 'non_empty' | 'output_shape' | 'process_leak' | 'model_review' | 'context_freshness'
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export interface GenericAssetReviewContent {
  schemaVersion: 'generic-asset-review-v1'
  /** Fingerprint of the resolved review mode and model route. */
  requestFingerprint?: string
  draftArtifactId: string
  draftContentHash: string
  effectiveArtifactId: string
  effectiveContentHash: string
  status: 'passed' | 'needs_revision' | 'blocked'
  score: number
  readyForHumanApply: boolean
  summary: string
  hardBlockers: string[]
  warnings: string[]
  checks: GenericAssetReviewCheck[]
  modelReview: GenericAssetQualitySnapshot
  reviewedContextVersion: number
  createdAt: string
}

export interface GenerateGenericAssetDraftInput {
  novelId: number
  assetType: GenericAssetType
  title: string
  requirements?: string[]
  outputFormat?: GenericAssetOutputFormat
  schemaHint?: string
  executionMode?: AiExecutionMode
  modelConfigId?: number
  parentArtifactId?: string
  idempotencyKey: string
}

export interface GenerateGenericAssetDraftResult {
  draftArtifact: AgentArtifact<GenericAssetDraftContent>
  reviewArtifact: AgentArtifact<GenericAssetReviewContent>
  effectiveArtifact: AgentArtifact<GenericAssetDraftContent>
  taskId: number
  outputPreview: string
  review: GenericAssetReviewContent
  idempotentReplay: boolean
}

export interface ReviewGenericAssetDraftInput {
  novelId: number
  draftArtifactId: string
  executionMode?: AiExecutionMode
  modelConfigId?: number
  idempotencyKey: string
}

export interface ReviewGenericAssetDraftResult {
  sourceArtifact: AgentArtifact<GenericAssetDraftContent>
  effectiveArtifact: AgentArtifact<GenericAssetDraftContent>
  reviewArtifact: AgentArtifact<GenericAssetReviewContent>
  outputPreview: string
  review: GenericAssetReviewContent
  idempotentReplay: boolean
}
