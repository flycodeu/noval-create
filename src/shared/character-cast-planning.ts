import type { AiExecutionMode } from './ai-execution'

export type CharacterCastScopeType = 'novel' | 'volume'
export type CharacterRoleCoverage = 'covered' | 'partial' | 'missing' | 'overloaded' | 'redundant'
export type CharacterRoleAction = 'keep' | 'update' | 'merge' | 'create' | 'archive'
export type CharacterCastReviewStatus = 'passed' | 'needs_revision' | 'blocked'

export interface CharacterCastScope {
  type: CharacterCastScopeType
  volumeId?: number
  lookaheadChapters?: number
}

export interface CharacterCastConstraints {
  maxNewCharacters?: number
  allowMergeExisting?: boolean
  allowArchiveExisting?: boolean
  requiredRoleTypes?: string[]
}

export interface CharacterNeedsAnalysisInput {
  novelId: number
  scope?: CharacterCastScope
  goals?: string[]
  constraints?: CharacterCastConstraints
  executionMode?: AiExecutionMode
  modelConfigId?: number
}

export interface CharacterCastExistingAction {
  characterId: number
  characterName: string
  action: Exclude<CharacterRoleAction, 'create'>
  rationale: string
  targetedChanges: string[]
}

export interface CharacterCastMergeGroup {
  characterIds: number[]
  characterNames: string[]
  rationale: string
  survivorCharacterId: number
}

export interface CharacterNeedRoleSlot {
  slotId: string
  functionKey: string
  function: string
  coverage: CharacterRoleCoverage
  coveredByCharacterIds: number[]
  mustBeIndependent: boolean
  independenceReason: string
  evidenceRefs: string[]
  proposedAction: CharacterRoleAction
  proposedRoleType: string
  firstAppearanceWindow: string
  priority: number
}

export interface CharacterCastRecommendation {
  keep: number
  update: number
  mergeGroups: number
  create: number
  archive: number
  activeCastAfterCommit: number
  confidence: number
}

export interface CharacterCastDimensionScores {
  necessity: number
  causality: number
  worldFit: number
  tension: number
  differentiation: number
  writability: number
  growthSpace: number
  entranceFeasibility: number
}

export interface CharacterCastPlanReview {
  mode: 'deterministic' | 'model'
  status: CharacterCastReviewStatus
  score: number
  summary: string
  hardBlockers: string[]
  warnings: string[]
  revisionSuggestions: string[]
  dimensionScores: CharacterCastDimensionScores
}

export interface CharacterCastDeterministicCheck {
  code: string
  status: 'pass' | 'warn' | 'fail'
  message: string
}

export interface CharacterNeedsAnalysisResult {
  planId: string
  taskId: number
  reviewTaskId: number | null
  scopeSummary: string
  existingCount: number
  priorRange: {
    min: number
    suggested: number
    max: number
    rationale: string
  }
  recommended: CharacterCastRecommendation
  existingActions: CharacterCastExistingAction[]
  mergeGroups: CharacterCastMergeGroup[]
  roleSlots: CharacterNeedRoleSlot[]
  review: CharacterCastPlanReview
  deterministicChecks: CharacterCastDeterministicCheck[]
  risks: string[]
  assumptions: string[]
  contextVersion: number
}

