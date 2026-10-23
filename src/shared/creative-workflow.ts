import type { AgentToolJsonSchema } from './tool-contracts'

export const CREATIVE_STAGES = ['background', 'world_rules', 'story', 'style', 'characters', 'relationships', 'outline', 'map', 'factions', 'items', 'events', 'chapter'] as const
export type CreativeStage = typeof CREATIVE_STAGES[number]
export const CREATIVE_STAGE_LABELS: Record<CreativeStage, string> = {
  background: '背景', world_rules: '规则与限制', story: '故事设计', style: '文风', outline: '卷章大纲', characters: '人物', map: '地图', relationships: '关系',
  factions: '阵营', items: '物品', events: '事件', chapter: '正文',
}
export interface CreativeWorkflowInput {
  novelId: number
  stage: CreativeStage
  request: string
  count?: number
  atChapter?: number
  autoApply?: boolean
  sourceArtifactId?: string
  operation?: 'generate' | 'review'
  changeScope?: CreativeChangeScope
  revisionIssueIds?: number[]
  chapterRevision?: CreativeChapterRevision
  idempotencyKey: string
}
/** Paragraphs are numbered from one; blank-line separators stay outside every editable range. */
export type CreativeChapterRevision =
  | { target: 'summary' }
  | { target: 'paragraphs'; paragraphIndexes: number[] }
  | { target: 'scene'; sceneId: number; paragraphIndexes?: number[] }
export const CREATIVE_CHAPTER_REVISION_SCHEMA: AgentToolJsonSchema = {
  anyOf: [
    { type: 'object', additionalProperties: false, properties: { target: { const: 'summary' } }, required: ['target'] },
    { type: 'object', additionalProperties: false, properties: { target: { const: 'paragraphs' }, paragraphIndexes: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'integer', minimum: 1 } } }, required: ['target', 'paragraphIndexes'] },
    { type: 'object', additionalProperties: false, properties: { target: { const: 'scene' }, sceneId: { type: 'integer', minimum: 1 }, paragraphIndexes: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'integer', minimum: 1 } } }, required: ['target', 'sceneId'] },
  ],
}
/** Optional hard boundaries; count remains a planning hint for mixed incremental batches. */
export interface CreativeChangeScope {
  existingEntityIds?: string[]
  existingRelationIds?: string[]
  newEntityCount?: number
  allowNewRelations?: boolean
  chapterIds?: number[]
  preserveChapterFields?: Array<'title' | 'outline' | 'volumeId' | 'partId' | 'targetWords' | 'allowedFactIds' | 'revealedFactIds'>
}
export const PROSE_ONLY_CHANGE_SCOPE: CreativeChangeScope = { existingEntityIds: [], existingRelationIds: [], newEntityCount: 0, allowNewRelations: false }
export const CREATIVE_CHANGE_SCOPE_SCHEMA: AgentToolJsonSchema = {
  type: 'object', additionalProperties: false, properties: {
    existingEntityIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 200 } },
    existingRelationIds: { type: 'array', maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 200 } },
    newEntityCount: { type: 'integer', minimum: 0, maximum: 50 },
    allowNewRelations: { type: 'boolean' },
    chapterIds: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'integer', minimum: 1 } },
    preserveChapterFields: { type: 'array', minItems: 1, maxItems: 7, items: { enum: ['title', 'outline', 'volumeId', 'partId', 'targetWords', 'allowedFactIds', 'revealedFactIds'] } },
  },
}
export interface CreativeContextReport {
  text: string
  estimatedTokens: number
  maxInputTokens: number
  outputReserve: number
  /** Independent review may require more reasoning than a small revision patch. */
  reviewOutputReserve?: number
  sources: string[]
  omittedSources: string[]
}
export interface CreativeRun {
  runId: number
  novelId: number
  stage: CreativeStage
  request: string
  atChapter: number
  count?: number
  sourceArtifactId?: string
  operation?: 'generate' | 'review'
  changeScope?: CreativeChangeScope
  revisionIssueIds?: number[]
  chapterRevision?: CreativeChapterRevision
  status: string
  step: 'context' | 'generating' | 'reviewing' | 'revising' | 'applying' | 'completed' | 'needs_attention' | 'cancelled'
  message: string
  modelConfigId: number | null
  reviewModelConfigId?: number | null
  artifactId?: string
  reviewArtifactId?: string
  reviewStatus?: string
  recoveryPending?: boolean
  result?: Record<string, unknown>
  context?: Omit<CreativeContextReport, 'text'>
  events: Array<{ at: string; step: CreativeRun['step']; message: string }>
  createdAt: string | null
  updatedAt: string | null
}
