/** The same story graph contract is used by the author workspace and MCP. */
import type { AgentToolJsonSchema } from './tool-contracts'

export type StoryAtlasEntityKind = 'location' | 'character' | 'faction' | 'item' | 'event'
export type StoryAtlasRelationKind = 'relationship' | 'route' | 'presence' | 'ownership' | 'membership' | 'participation'
export type StoryAtlasStatus = 'confirmed' | 'planned'
export type StoryAtlasAttributeMode = 'merge' | 'replace'
export const STORY_ATLAS_LOCATION_ROLES = ['current', 'birthplace', 'residence', 'activity', 'headquarters', 'outpost', 'jurisdiction'] as const
export type StoryAtlasLocationRole = typeof STORY_ATLAS_LOCATION_ROLES[number]
export interface StoryAtlasMapPoint { x: number; y: number }
export interface StoryAtlasGeography {
  /** Simple polygon in the parent's local 0..100 map. Do not repeat the first point. */
  boundary?: StoryAtlasMapPoint[]
  position?: StoryAtlasMapPoint
  /** Explicit author/candidate setting, never inferred from drawing pixels. */
  areaKm2?: number
  /** How far the author has developed the place, not whether characters have explored it. */
  development?: 'detailed' | 'outlined' | 'unexplored'
  /** Explicit setting or reviewed design candidate for this place's own internal map. */
  mapFrame?: { widthKm: number; heightKm: number }
}
export interface StoryAtlasPosition {
  /** Stable within this organization. A position is not a person. */
  id: string
  title: string
  status: 'planned' | 'established'
  responsibilities?: string
  requirements?: string
  reportsToPositionId?: string | null
}
export interface StoryAtlasCharacterAttributes extends Record<string, unknown> {
  occupation?: string
  dailyRoutine?: string
  motivation?: string
  goals?: string
  publicSummary?: string
  publicGoal?: string
  personalityTraits?: string[]
  flaws?: string[]
  habits?: string[]
  speechPattern?: string
  abilityLimits?: string
  abilityCosts?: string
}
export interface StoryAtlasFactionAttributes extends Record<string, unknown> {
  organizationLevel?: 'organization' | 'department' | 'branch'
  traits?: string[]
  ideology?: string
  methods?: string
  funding?: string
  goal?: string
  resources?: string
  memberPolicy?: string
  positions?: StoryAtlasPosition[]
}
const atlasText: AgentToolJsonSchema = { type: 'string', minLength: 1, maxLength: 12000 }
const atlasTexts: AgentToolJsonSchema = { type: 'array', maxItems: 100, items: atlasText }
const textFields = (...keys: string[]) => Object.fromEntries(keys.map(key => [key, atlasText]))
const mapPoint: AgentToolJsonSchema = { type: 'object', required: ['x', 'y'], additionalProperties: false, properties: {
  x: { type: 'number', minimum: 0, maximum: 100 }, y: { type: 'number', minimum: 0, maximum: 100 },
} }
/** Optional fields: absent or empty input does not establish a story fact. */
export const STORY_ATLAS_ATTRIBUTE_SCHEMAS: Partial<Record<StoryAtlasEntityKind | StoryAtlasRelationKind, AgentToolJsonSchema>> = {
  location: { type: 'object', properties: {
    geography: { type: 'object', additionalProperties: false, properties: {
      boundary: { type: 'array', minItems: 3, maxItems: 64, items: mapPoint }, position: mapPoint,
      areaKm2: { type: 'number', minimum: 0, description: '严格大于零；沿用已有明确面积，缺失时可按用户地理设计需求提出自洽候选并说明依据，经审校后应用。不仅从示意像素推算，不能超过内部地图宽高范围或已知上级面积。' },
      development: { enum: ['detailed', 'outlined', 'unexplored'], description: '资料展开程度，不是人物探索进度。' },
      mapFrame: { type: 'object', description: '本地点内部地图的公里宽高。沿用既定尺度；尚未设定时可提出自洽设计候选，经审校后应用。', required: ['widthKm', 'heightKm'], additionalProperties: false, properties: {
        widthKm: { type: 'number', minimum: 0 }, heightKm: { type: 'number', minimum: 0 },
      } },
    } },
  }, additionalProperties: true },
  character: { type: 'object', properties: {
    ...textFields('gender', 'birthDate', 'occupation', 'dailyRoutine', 'motivation', 'goals', 'publicSummary', 'publicGoal', 'surfaceDesire', 'deepNeed', 'coreFear', 'moralLine', 'speechPattern', 'abilityLimits', 'abilityCosts', 'relationshipTension', 'dramaticEngine'),
    age: { type: 'integer', minimum: 0 }, personalityTraits: atlasTexts, flaws: atlasTexts, habits: atlasTexts,
    abilities: { anyOf: [atlasText, { type: 'array', maxItems: 50, items: { anyOf: [atlasText, { type: 'object', required: ['name'], additionalProperties: false, properties: textFields('name', 'effect', 'limits', 'cost') }] } }] },
  }, additionalProperties: true },
  faction: { type: 'object', properties: {
    ...textFields('type', 'goal', 'resources', 'memberPolicy', 'currentPhase', 'ideology', 'methods', 'funding'), traits: atlasTexts,
    organizationLevel: { enum: ['organization', 'department', 'branch'] },
    positions: { type: 'array', maxItems: 100, items: { type: 'object', required: ['id'], additionalProperties: false,
      properties: { ...textFields('id', 'title', 'responsibilities', 'requirements'), status: { enum: ['planned', 'established'] }, reportsToPositionId: { type: ['string', 'null'], minLength: 1 } } } },
  }, additionalProperties: true },
  presence: { type: 'object', properties: { locationRole: { enum: [...STORY_ATLAS_LOCATION_ROLES] } }, additionalProperties: true },
  membership: { type: 'object', properties: textFields('positionId', 'roleTitle', 'responsibilities'), additionalProperties: true },
}
export interface StoryAtlasSource { kind: string; id?: string; note?: string }
export interface StoryAtlasEntity {
  id: string
  kind: StoryAtlasEntityKind
  name: string
  summary: string
  parentId: string | null
  attributes: Record<string, unknown>
  status: StoryAtlasStatus
  effectiveFromChapter: number
  source: StoryAtlasSource
}
export interface StoryAtlasRelation {
  id: string
  kind: StoryAtlasRelationKind
  fromId: string
  toId: string
  label: string
  attributes: Record<string, unknown>
  status: StoryAtlasStatus
  effectiveFromChapter: number
  source: StoryAtlasSource
}
export interface StoryAtlasDiagnostic {
  severity: 'info' | 'warning'
  code: string
  message: string
  entityIds: string[]
}
export interface StoryAtlasQuery {
  novelId: number
  /** Story chapter number, not the database chapter ID. Omit for current records. */
  atChapter?: number
  /** Omit or null for root locations. A location ID selects its direct children. */
  locationParentId?: string | null
  focusEntityId?: string
  includePlanned?: boolean
}
export interface StoryAtlasSnapshot {
  novelId: number
  contextVersion: number
  atChapter: number | null
  entities: StoryAtlasEntity[]
  relations: StoryAtlasRelation[]
  locationChildren: StoryAtlasEntity[]
  diagnostics: StoryAtlasDiagnostic[]
}
export type StoryAtlasChange = {
  op: 'upsert_entity'
  id?: string
  /** New references can use this value in other changes in the same batch. */
  clientId?: string
  kind: StoryAtlasEntityKind
  name: string
  summary?: string
  parentId?: string | null
  attributes?: Record<string, unknown>
  /** Default merge adds values; replace replaces only supplied top-level fields and deletes empty fields. */
  attributeMode?: StoryAtlasAttributeMode
  status?: StoryAtlasStatus
} | {
  op: 'upsert_relation'
  id?: string
  clientId?: string
  kind: StoryAtlasRelationKind
  fromId: string
  toId: string
  label?: string
  attributes?: Record<string, unknown>
  attributeMode?: StoryAtlasAttributeMode
  status?: StoryAtlasStatus
} | { op: 'retire'; id: string }
export interface StoryAtlasApplyInput {
  novelId: number
  expectedContextVersion: number
  idempotencyKey: string
  /** 0 is background canon; use a chapter number for changes occurring in the story. */
  effectiveFromChapter: number
  source: StoryAtlasSource
  changes: StoryAtlasChange[]
}
export interface StoryAtlasApplyResult {
  novelId: number
  contextVersion: number
  appliedIds: string[]
  idMap: Record<string, string>
  diagnostics: StoryAtlasDiagnostic[]
  idempotentReplay: boolean
}
export interface StoryAtlasValidationResult {
  valid: true
  novelId: number
  contextVersion: number
  diagnostics: StoryAtlasDiagnostic[]
}
