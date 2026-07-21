import type { AgentArtifact } from './agent-artifacts'
import type { CharacterNeedsAnalysisResult } from './character-cast-planning'

export interface CharacterDraftCard {
  roleType: string
  recordStatus: 'draft'
  entityType?: string | null
  species?: string | null
  surname?: string | null
  givenName?: string | null
  fullName: string
  gender?: string | null
  age?: number | null
  birthplace?: string | null
  occupation?: string | null
  rankLevel?: string | null
  socialIdentity?: string | null
  background?: string | null
  personalityTraitsJson?: string | null
  flawsJson?: string | null
  habitsJson?: string | null
  campFactionIdsJson?: string | null
  powerSystemRefsJson?: string | null
  contextHooksJson?: string | null
  goals?: string | null
  firstImpression?: string | null
  surfaceDesire?: string | null
  deepNeed?: string | null
  coreFear?: string | null
  innerConflict?: string | null
  hiddenSecret?: string | null
  moralLine?: string | null
  selfDeception?: string | null
  trauma?: string | null
  contradiction?: string | null
  relationshipTension?: string | null
  resonancePoint?: string | null
  dramaticEngine?: string | null
  characterArc?: string | null
  appearanceJson?: string | null
  sourceContextJson?: string | null
  appearChapter?: number | null
}

export interface CharacterDraftContent {
  schemaVersion: 'character-draft-v1'
  /** Fingerprint of every input that affects generation/replay safety. */
  requestFingerprint?: string
  planId: string
  planContentHash: string
  plan: CharacterNeedsAnalysisResult
  characters: CharacterDraftCard[]
  /**
   * Existing-character changes are kept beside new cards so the review and
   * commit steps can show/apply a real diff instead of silently skipping the
   * plan's update actions.
   */
  updatePatches: CharacterUpdatePatchDraft[]
  taskId: number
  qualityReview: Record<string, unknown>
  generatedAt: string
}

export interface CharacterUpdatePatchDraft {
  characterId: number
  characterName: string
  summary: string
  patch: Record<string, unknown>
  changedFields: Array<{
    field: string
    label: string
    before: string
    after: string
  }>
  taskId?: number
}

export type CharacterDraftReviewStatus = 'passed' | 'needs_revision' | 'blocked'

export interface CharacterDraftReviewCheck {
  code: string
  status: 'pass' | 'warn' | 'fail'
  message: string
  characterNames: string[]
}

export interface CharacterDraftReviewContent {
  schemaVersion: 'character-draft-review-v1'
  draftArtifactId: string
  draftContentHash: string
  status: CharacterDraftReviewStatus
  score: number
  committable: boolean
  summary: string
  hardBlockers: string[]
  warnings: string[]
  checks: CharacterDraftReviewCheck[]
  modelReview: Record<string, unknown>
  reviewedContextVersion: number
  createdAt: string
}

export interface GenerateCharacterDraftInput {
  novelId: number
  planId: string
  idempotencyKey: string
  maxCharacters?: number
  specialRequirements?: string
}

export interface GenerateCharacterDraftResult {
  draftArtifact: AgentArtifact<CharacterDraftContent>
  reviewArtifact: AgentArtifact<CharacterDraftReviewContent>
  taskId: number
  characterCount: number
  characterNames: string[]
  updatePreview?: Array<{
    characterId: number
    characterName: string
    summary: string
    fields: string[]
  }>
  diffSummary: {
    createCount: number
    updateSuggestionCount: number
    mergeSuggestionCount: number
    archiveSuggestionCount: number
  }
  review: CharacterDraftReviewContent
  idempotentReplay: boolean
}

export interface ReviewCharacterDraftInput {
  novelId: number
  draftArtifactId: string
}

export interface CommitCharacterDraftInput {
  novelId: number
  draftArtifactId: string
  expectedContextVersion: number
  expectedContentHash: string
  idempotencyKey: string
}

export interface CharacterCommitDiffContent {
  schemaVersion: 'character-commit-diff-v1'
  draftArtifactId: string
  draftContentHash: string
  reviewArtifactId: string
  createdCharacterIds: number[]
  createdCharacterNames: string[]
  updatedCharacterIds?: number[]
  updatedCharacterNames?: string[]
  archivedCharacterIds?: number[]
  archivedCharacterNames?: string[]
  mergedCharacterIds?: number[]
  skippedPlanActions: Array<{ action: string; characterId: number; characterName: string }>
  contextVersionBefore: number
  contextVersionAfter: number
  committedAt: string
}

export interface CommitCharacterDraftResult {
  draftArtifactId: string
  commitArtifact: AgentArtifact<CharacterCommitDiffContent>
  createdCharacterIds: number[]
  createdCharacterNames: string[]
  updatedCharacterIds?: number[]
  updatedCharacterNames?: string[]
  archivedCharacterIds?: number[]
  archivedCharacterNames?: string[]
  mergedCharacterIds?: number[]
  contextVersionBefore: number
  contextVersionAfter: number
  idempotentReplay: boolean
  warnings: string[]
}
