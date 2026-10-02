/** The same story graph contract is used by the author workspace and MCP. */
export type StoryAtlasEntityKind = 'location' | 'character' | 'faction' | 'item' | 'event'
export type StoryAtlasRelationKind = 'relationship' | 'route' | 'presence' | 'ownership' | 'membership' | 'participation'
export type StoryAtlasStatus = 'confirmed' | 'planned'
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
