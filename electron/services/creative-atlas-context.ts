import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../src/shared/story-atlas'
import type { CreativeStage } from '../../src/shared/creative-workflow'

type Atlas = Pick<StoryAtlasSnapshot, 'entities' | 'relations'>
const namedAtlasEntity = (text: string, entity: StoryAtlasEntity) => text.split(/[^\w:-]+/u).includes(entity.id)
  || (entity.name.trim().length > 1 && text.includes(entity.name))

export function isCreativeChapterScopedRequest(request: string): boolean {
  return /本章|当前章|这一章|现场|第\s*[\d一二三四五六七八九十百]+\s*章/u.test(request)
}

/** Asset design has narrower dependencies than a scene: a country does not require every resident's social graph. */
export function selectCreativeAssetAtlas(atlas: Atlas, input: {
  stage: 'map' | 'events'; request: string; anchorText?: string; fallbackText?: string
}) {
  const explicit = atlas.entities.filter(entity => namedAtlasEntity(input.request, entity))
  const anchor = input.anchorText || input.fallbackText || ''
  const seeds = new Set((explicit.length ? explicit : atlas.entities.filter(entity => namedAtlasEntity(anchor, entity))).map(entity => entity.id))
  if (!seeds.size) for (const entity of atlas.entities) {
    if (input.stage === 'map' ? entity.kind === 'location' && !entity.parentId : entity.kind === 'event') seeds.add(entity.id)
  }
  const entityIds = new Set(seeds), relationIds = new Set<string>()
  const byId = new Map(atlas.entities.map(entity => [entity.id, entity]))
  const include = (edge: StoryAtlasRelation) => { relationIds.add(edge.id); entityIds.add(edge.fromId); entityIds.add(edge.toId) }
  // Preserve the existing child directory when changing a parent's subdivision. Do not recursively load every room.
  if (input.stage === 'map') for (const entity of atlas.entities) if (entity.kind === 'location' && entity.parentId && seeds.has(entity.parentId)) entityIds.add(entity.id)
  if (input.stage === 'events') for (const edge of atlas.relations) {
    if (edge.kind === 'participation' && (seeds.has(edge.fromId) || seeds.has(edge.toId))) include(edge)
    if (edge.kind === 'presence' && seeds.has(edge.toId) && byId.get(edge.fromId)?.kind === 'event') include(edge)
  }
  const participants = new Set([...entityIds].filter(id => byId.get(id)?.kind !== 'location'))
  for (const edge of atlas.relations) if (edge.kind === 'presence' && participants.has(edge.fromId)) include(edge)
  const places = new Set([...entityIds].filter(id => byId.get(id)?.kind === 'location'))
  for (const edge of atlas.relations) if (edge.kind === 'route' && (places.has(edge.fromId) || places.has(edge.toId))) include(edge)
  for (const id of [...entityIds]) {
    const visited = new Set([id])
    let parent = byId.get(id)?.parentId
    while (parent && byId.has(parent) && !visited.has(parent)) {
      entityIds.add(parent); visited.add(parent); parent = byId.get(parent)?.parentId
    }
  }
  const constraintEntityIds = new Set<string>()
  if (input.stage === 'map') {
    // A local redraw must know its neighbours' occupied territory, but their biographies and social edges are irrelevant.
    const parentIds = new Set([...places].map(id => byId.get(id)?.parentId))
    for (const entity of atlas.entities) {
      const geography = entity.attributes.geography as { boundary?: unknown } | undefined
      if (entity.kind === 'location' && !entityIds.has(entity.id) && parentIds.has(entity.parentId)
        && Array.isArray(geography?.boundary) && geography.boundary.length >= 3) {
        constraintEntityIds.add(entity.id); entityIds.add(entity.id)
      }
    }
  }
  return { seedIds: seeds, entityIds, relationIds, constraintEntityIds }
}

/** A global rules edit is not a scene continuation. Local asset edits retain their actual records and direct links. */
export function selectCreativePlanningAtlas(atlas: Atlas, input: {
  stage: CreativeStage; request: string; anchorText?: string; fallbackText?: string
}) {
  const globalStage = ['background', 'world_rules', 'style', 'story'].includes(input.stage)
  const namedEdges = atlas.relations.filter(edge => input.request.split(/[^\w:-]+/u).includes(edge.id))
  const seeds = new Set(atlas.entities.filter(entity => namedAtlasEntity(input.request, entity)).map(entity => entity.id))
  for (const edge of namedEdges) { seeds.add(edge.fromId); seeds.add(edge.toId) }
  const chapterScoped = isCreativeChapterScopedRequest(input.request)
  if (input.stage === 'outline' && chapterScoped) {
    // A correction can name only one participant. The saved chapter and preceding handoff
    // still establish its other participants and physical scene; explicit names do not replace them.
    const scene = `${input.anchorText || ''}\n${input.fallbackText || ''}`
    for (const entity of atlas.entities) if (namedAtlasEntity(scene, entity)) seeds.add(entity.id)
  }
  if (!seeds.size && !globalStage) {
    const kind = ({ characters: 'character', relationships: 'character', items: 'item', factions: 'faction' } as Record<string, string>)[input.stage]
    const anchor = input.anchorText || input.fallbackText || ''
    for (const entity of atlas.entities) if ((entity.kind === kind || input.stage === 'outline' && chapterScoped) && namedAtlasEntity(anchor, entity)) seeds.add(entity.id)
    if (!seeds.size && ['characters', 'relationships'].includes(input.stage) && /主角|主人公|主要人物|核心人物/u.test(input.request)) {
      for (const entity of atlas.entities) if (entity.kind === 'character' && entity.attributes.roleType === 'protagonist') seeds.add(entity.id)
    }
  }
  const byId = new Map(atlas.entities.map(entity => [entity.id, entity]))
  const entityIds = new Set(seeds), relationIds = new Set<string>()
  const include = (edge: StoryAtlasRelation) => { relationIds.add(edge.id); entityIds.add(edge.fromId); entityIds.add(edge.toId) }
  for (const edge of namedEdges) include(edge)
  const characterSeeds = [...seeds].filter(id => byId.get(id)?.kind === 'character')
  for (const edge of atlas.relations) {
    const from = seeds.has(edge.fromId), to = seeds.has(edge.toId)
    if (!from && !to) continue
    if (globalStage) { if (from && to) include(edge); continue }
    if (edge.kind === 'relationship' && (input.stage === 'characters' || input.stage === 'relationships' && (characterSeeds.length < 2 || from && to))) include(edge)
    if (edge.kind === 'presence' && from) include(edge)
    if (edge.kind === 'membership' && (from && ['characters', 'relationships', 'factions', 'outline'].includes(input.stage) || to && input.stage === 'factions')) include(edge)
    if (edge.kind === 'ownership' && ['items', 'characters'].includes(input.stage)) include(edge)
    if (edge.kind === 'participation' && chapterScoped) include(edge)
    if (edge.kind === 'route' && input.stage === 'outline') include(edge)
  }
  if (input.stage === 'factions') for (const entity of atlas.entities) if (entity.kind === 'faction' && entity.parentId && seeds.has(entity.parentId)) entityIds.add(entity.id)
  for (const id of [...entityIds]) {
    const visited = new Set([id])
    let parent = byId.get(id)?.parentId
    while (parent && byId.has(parent) && !visited.has(parent)) {
      entityIds.add(parent); visited.add(parent); parent = byId.get(parent)?.parentId
    }
  }
  return { seedIds: seeds, entityIds, relationIds, constraintEntityIds: new Set<string>() }
}

/** New chapter participants are introduction plans, never replacements for the preceding chapter's state. */
export function selectChapterAtlasIntroductions(before: Atlas, current: Atlas, input: {
  chapterNum: number; request: string; anchorText?: string; povNames?: string[]
}) {
  const previous = new Map(before.entities.map(entity => [entity.id, entity]))
  const eligible = new Map(current.entities.filter(entity => !previous.has(entity.id) && entity.effectiveFromChapter === input.chapterNum
    && entity.status === 'confirmed' && entity.kind !== 'event' && entity.attributes.authorOnly !== true && entity.attributes.futureOnly !== true)
    .map(entity => [entity.id, entity]))
  const selected = new Set([...eligible.values()].filter(entity => namedAtlasEntity(`${input.request}\n${input.anchorText || ''}`, entity)
    || input.povNames?.includes(entity.name)).map(entity => entity.id))
  const previousParentIds = new Set<string>()
  for (const id of [...selected]) {
    const child = eligible.get(id)!
    if (child.kind !== 'location') continue
    const visited = new Set([id])
    let parentId = child.parentId
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      // Prefer the old parent even if its current-chapter terrain or description has already changed.
      const parent = previous.get(parentId) || eligible.get(parentId)
      if (!parent || parent.kind !== 'location' || parent.attributes.authorOnly === true || parent.attributes.futureOnly === true) break
      if (previous.has(parentId)) previousParentIds.add(parentId)
      else selected.add(parentId)
      parentId = parent.parentId
    }
  }
  return { entities: [...eligible.values()].filter(entity => selected.has(entity.id)), previousParentIds }
}

/** Select saved dependencies only. Each graph expansion is bounded to one pass, except parent chains. */
export function selectCreativeAtlas(atlas: Atlas, input: {
  request: string; anchorText?: string; fallbackText?: string; povNames?: string[]
}) {
  const seeds = new Set(atlas.entities.filter(entity => namedAtlasEntity(`${input.request}\n${input.anchorText || ''}`, entity)
    || input.povNames?.includes(entity.name)).map(entity => entity.id))
  const explicit = atlas.entities.some(entity => namedAtlasEntity(input.request, entity))
  if (!seeds.size && input.fallbackText) for (const entity of atlas.entities) if (namedAtlasEntity(input.fallbackText, entity)) seeds.add(entity.id)
  if ((!explicit && /主角|主人公|主要人物|核心人物/u.test(input.request)) || !seeds.size) {
    for (const entity of atlas.entities) if (entity.kind === 'character' && entity.attributes.roleType === 'protagonist') seeds.add(entity.id)
  }
  const entityIds = new Set(seeds)
  const relationIds = new Set<string>()
  const include = (edge: StoryAtlasRelation) => { relationIds.add(edge.id); entityIds.add(edge.fromId); entityIds.add(edge.toId) }
  for (const edge of atlas.relations) if (seeds.has(edge.fromId) || seeds.has(edge.toId)) include(edge)
  // A scene participant's home/organization is useful even when reached through a character bond.
  const participants = new Set(atlas.entities.filter(entity => entityIds.has(entity.id) && ['character', 'faction', 'item'].includes(entity.kind)).map(entity => entity.id))
  for (const edge of atlas.relations) if (participants.has(edge.fromId) && ['presence', 'membership', 'ownership'].includes(edge.kind)) include(edge)
  const byId = new Map(atlas.entities.map(entity => [entity.id, entity]))
  const ancestors = () => {
    for (const id of [...entityIds]) {
      const visited = new Set<string>([id])
      let parent = byId.get(id)?.parentId
      while (parent && byId.has(parent) && !visited.has(parent)) {
        entityIds.add(parent); visited.add(parent); parent = byId.get(parent)?.parentId
      }
    }
  }
  ancestors()
  // Include actual headquarters/jurisdictions for the selected organizations, not their whole roster.
  const factions = new Set(atlas.entities.filter(entity => entityIds.has(entity.id) && entity.kind === 'faction').map(entity => entity.id))
  for (const edge of atlas.relations) if (edge.kind === 'presence' && factions.has(edge.fromId)) include(edge)
  const places = new Set(atlas.entities.filter(entity => entityIds.has(entity.id) && entity.kind === 'location').map(entity => entity.id))
  for (const edge of atlas.relations) if (edge.kind === 'route' && (places.has(edge.fromId) || places.has(edge.toId))) include(edge)
  ancestors()
  return { seedIds: seeds, entityIds, relationIds }
}

const publicAttributes = new Set([
  'roleType', 'entityType', 'age', 'gender', 'occupation', 'appearance', 'personalityTraits', 'flaws', 'speechPattern',
  'publicSummary', 'firstImpression',
  'goals', 'habits', 'dailyRoutine', 'motivation', 'moralLine', 'surfaceDesire', 'abilityLimits', 'abilityCosts',
  'subtype', 'locationType', 'nodeType', 'terrain', 'climate', 'waterSource', 'livelihood', 'access', 'x', 'y',
  'category', 'function', 'abilities', 'limitations', 'culture', 'publicGoal', 'organizationLevel', 'traits', 'ideology', 'methods', 'funding',
  'type', 'goal', 'resources', 'memberPolicy', 'currentPhase', 'roleTitle',
  'distanceKm', 'travelHours', 'travelMode', 'direction', 'condition', 'relationType', 'routeOpen', 'bilateral',
  'locationRole', 'positionId', 'responsibilities',
])
const povPrivateAttributes = new Set(['goals', 'motivation', 'surfaceDesire', 'moralLine', 'abilities', 'abilityLimits', 'abilityCosts', 'limitations'])
const npcPublicAttributes = new Set(['entityType', 'age', 'gender', 'occupation', 'appearance', 'publicSummary', 'firstImpression', 'publicGoal', 'traits', 'habits', 'speechPattern'])

/** Nested author-only keys are never passed through simply because their parent is public. */
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue).filter(item => item !== undefined)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.futureOnly === true || record.authorOnly === true || record.status === 'planned') return undefined
  return Object.fromEntries(Object.entries(record).filter(([key]) => !/secret|hidden|private|futureOnly|futurePlan|authorOnly|evidenceQuote|source/iu.test(key)).map(([key, item]) => [key, publicValue(item)]).filter(([, item]) => item !== undefined))
}
export function creativePublicAttributes(attributes: Record<string, unknown>, scope?: { kind: StoryAtlasEntity['kind']; isPov: boolean }): Record<string, unknown> {
  // An author's unregistered NPC motive or hidden ability is not automatically POV knowledge.
  const allowInnerAttributes = scope !== undefined && (scope.kind !== 'character' || scope.isPov)
  const projected = Object.fromEntries(Object.entries(attributes).filter(([key]) => publicAttributes.has(key)
    && (scope?.kind !== 'character' || scope.isPov || npcPublicAttributes.has(key))
    && (!povPrivateAttributes.has(key) || allowInnerAttributes))
    .map(([key, value]) => [key, publicValue(value)]).filter(([, value]) => value !== undefined))
  if (Array.isArray(attributes.positions)) projected.positions = attributes.positions.filter(position => position && typeof position === 'object' && position.status === 'established')
    .map(position => Object.fromEntries(Object.entries(position).filter(([key]) => ['id', 'title', 'status', 'responsibilities', 'requirements', 'reportsToPositionId'].includes(key)).map(([key, value]) => [key, publicValue(value)])))
  // Polygon drawing coordinates and author development flags do not establish character knowledge or travel distance.
  if (scope?.kind === 'location' && attributes.geography && typeof attributes.geography === 'object') {
    const geography = attributes.geography as Record<string, unknown>
    if (typeof geography.areaKm2 === 'number' && Number.isFinite(geography.areaKm2) && geography.areaKm2 > 0) projected.geography = { areaKm2: geography.areaKm2 }
  }
  return projected
}

/** Gaps guide writing and review; absence is never permission to invent canon or proof of nonexistence. */
export function creativeAtlasCoverage(atlas: Atlas, selectedIds: Set<string>) {
  const missing: Array<{ entityId?: string; fields: string[] }> = []
  const populated = (value: unknown) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0)
  if (!atlas.entities.some(entity => entity.kind === 'location')) missing.push({ fields: ['map_locations'] })
  for (const entity of atlas.entities.filter(entity => selectedIds.has(entity.id))) {
    const fields: string[] = []
    if (entity.kind === 'character') {
      if (!populated(entity.summary) && !populated(entity.attributes.publicSummary) && !populated(entity.attributes.firstImpression)) fields.push('public_description')
      for (const field of ['occupation', 'goals', 'personalityTraits', 'flaws', 'speechPattern']) if (!populated(entity.attributes[field])) fields.push(field)
      const places = atlas.relations.filter(edge => edge.kind === 'presence' && edge.fromId === entity.id)
      for (const role of ['residence', 'activity', 'current']) if (!places.some(edge => edge.attributes.locationRole === role)) fields.push(`location_${role}`)
    }
    if (entity.kind === 'faction' && !populated(entity.attributes.positions)) fields.push('established_positions')
    if (fields.length) missing.push({ entityId: entity.id, fields })
  }
  return {
    instruction: '下列字段未登记或当前视角不可知，表示未知，不表示不存在，也不能为填满档案擅自编造。仅当本次正文必须依赖该缺项时明确提出待补依据；无关缺项不妨碍写作。其他人物的内在目标、动机与能力不因作者档案存在而公开；publicGoal只表示公开目标。出生地、常住地、活动区域和组织辖区不等于本章当前在场。已设岗位不等于有人任职，实际任职以 membership 为准；未登记路线不能证明可通行或具体耗时。',
    selectedEntityIds: [...selectedIds], missing: missing.slice(0, 40), omittedGapCount: Math.max(0, missing.length - 40),
  }
}
