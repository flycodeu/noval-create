import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../database/db'
import {
  characterRelations,
  characters,
  factions,
  storyItems,
  worldMap,
} from '../database/schema'
import { parseFactionExternalRelations } from '../../src/shared/factions'
import { parseFactionReferenceArray } from './faction-reference.service'

type CharacterRow = typeof characters.$inferSelect
type ItemRow = typeof storyItems.$inferSelect
type LocationRow = typeof worldMap.$inferSelect
type FactionRow = typeof factions.$inferSelect
type RelationRow = typeof characterRelations.$inferSelect

export type CharacterMentionCatalogRow = Pick<
  CharacterRow,
  | 'id'
  | 'novelId'
  | 'fullName'
  | 'surname'
  | 'givenName'
  | 'roleType'
  | 'gender'
  | 'occupation'
  | 'rankLevel'
  | 'socialIdentity'
  | 'species'
  | 'sourceContextJson'
  | 'campFactionIdsJson'
  | 'sortOrder'
>

export type ItemMentionCatalogRow = Pick<
  ItemRow,
  | 'id'
  | 'novelId'
  | 'itemName'
  | 'itemKind'
  | 'subType'
  | 'tagsJson'
  | 'sourceContextJson'
  | 'typedRefsJson'
  | 'sortOrder'
>

export type LocationMentionCatalogRow = Pick<
  LocationRow,
  | 'id'
  | 'novelId'
  | 'parentId'
  | 'level'
  | 'name'
  | 'locationType'
  | 'structureRole'
  | 'nodeType'
  | 'tagsJson'
  | 'description'
  | 'atmosphere'
  | 'plotRelevance'
  | 'sortOrder'
>

export type FactionMentionCatalogRow = Pick<
  FactionRow,
  | 'id'
  | 'novelId'
  | 'name'
  | 'notes'
  | 'externalRelationsJson'
  | 'sortOrder'
>

export type RelationMentionProjectionRow = Pick<
  RelationRow,
  | 'id'
  | 'novelId'
  | 'charAId'
  | 'charBId'
  | 'relationType'
  | 'relationLabel'
  | 'intimacyLevel'
  | 'tensionLevel'
  | 'interactionStyle'
>

export interface ChapterEntityMentionCatalogs {
  characters: CharacterMentionCatalogRow[]
  items: ItemMentionCatalogRow[]
  locations: LocationMentionCatalogRow[]
  factions: FactionMentionCatalogRow[]
  relations: RelationMentionProjectionRow[]
  maxMapDepth: number
  speciesCount: number
}

export interface ChapterEntityMentionCatalogLoadOptions {
  /** Novel context versions are advanced by entity/canon edits. */
  contextVersion?: number
}

const ENTITY_CATALOG_CACHE_LIMIT = 8
const entityCatalogCache = new Map<string, ChapterEntityMentionCatalogs>()

export interface ChapterEntityMentionCatalogLookups {
  characterIdByName: Map<string, number>
  itemIdByName: Map<string, number>
  locationIdByName: Map<string, number>
  factionIdByName: Map<string, number>
  characterNameById: Map<number, string>
  locationNameById: Map<number, string>
  locationById: Map<number, LocationMentionCatalogRow>
  majorCharacterRows: CharacterMentionCatalogRow[]
}

const entityCatalogLookupCache = new WeakMap<ChapterEntityMentionCatalogs, ChapterEntityMentionCatalogLookups>()

export function clearChapterEntityMentionCatalogCache(novelId?: number): void {
  if (typeof novelId !== 'number') {
    entityCatalogCache.clear()
    return
  }
  for (const key of entityCatalogCache.keys()) {
    if (key.startsWith(`${novelId}:`)) entityCatalogCache.delete(key)
  }
}

function getCachedEntityCatalog(novelId: number, contextVersion?: number): ChapterEntityMentionCatalogs | null {
  if (!Number.isInteger(contextVersion) || (contextVersion as number) <= 0) return null
  const key = `${novelId}:${contextVersion}`
  const cached = entityCatalogCache.get(key)
  if (!cached) return null
  // Refresh LRU order without retaining multiple versions of one novel.
  entityCatalogCache.delete(key)
  entityCatalogCache.set(key, cached)
  return cached
}

function cacheEntityCatalog(
  novelId: number,
  contextVersion: number | undefined,
  catalogs: ChapterEntityMentionCatalogs,
): void {
  if (typeof contextVersion !== 'number' || !Number.isInteger(contextVersion) || contextVersion <= 0) return
  const key = `${novelId}:${contextVersion}`
  for (const existingKey of entityCatalogCache.keys()) {
    if (existingKey.startsWith(`${novelId}:`) && existingKey !== key) entityCatalogCache.delete(existingKey)
  }
  entityCatalogCache.delete(key)
  entityCatalogCache.set(key, catalogs)
  while (entityCatalogCache.size > ENTITY_CATALOG_CACHE_LIMIT) {
    const oldestKey = entityCatalogCache.keys().next().value as string | undefined
    if (!oldestKey) break
    entityCatalogCache.delete(oldestKey)
  }
}

export interface ChapterEntityContextProjection {
  characterFullIds: number[]
  itemFullIds: number[]
  locationFullIds: number[]
  factionFullIds: number[]
  relationFullIds: number[]
}

export interface ProjectedChapterEntityRows {
  characters: CharacterRow[]
  items: ItemRow[]
  locations: LocationRow[]
  factions: FactionRow[]
  relations: RelationRow[]
}

interface ResolveChapterEntityContextProjectionInput {
  mentionedCharacterNames: string[]
  mentionedItemNames: string[]
  mentionedLocationNames: string[]
  mentionedFactionNames: string[]
  relationFocusText: string
  characterLimit: number
  itemLimit: number
  locationLimit: number
  factionLimit: number
  relationLimit?: number
}

function roleRank(roleType?: string | null): number {
  switch (roleType) {
    case 'protagonist':
      return 0
    case 'major':
      return 1
    case 'antagonist':
      return 2
    case 'supporting':
      return 3
    case 'minor':
      return 4
    default:
      return 5
  }
}

function normalizedName(value?: string | null): string {
  return (value || '').trim().replace(/\s+/g, '').toLowerCase()
}

export function getChapterEntityMentionCatalogLookups(
  catalogs: ChapterEntityMentionCatalogs,
): ChapterEntityMentionCatalogLookups {
  const cached = entityCatalogLookupCache.get(catalogs)
  if (cached) return cached
  const lookups: ChapterEntityMentionCatalogLookups = {
    characterIdByName: new Map(catalogs.characters.map((row) => [normalizedName(row.fullName), row.id])),
    itemIdByName: new Map(catalogs.items.map((row) => [normalizedName(row.itemName), row.id])),
    locationIdByName: new Map(catalogs.locations.map((row) => [normalizedName(row.name), row.id])),
    factionIdByName: new Map(catalogs.factions.map((row) => [normalizedName(row.name), row.id])),
    characterNameById: new Map(catalogs.characters.map((row) => [row.id, row.fullName || ''])),
    locationNameById: new Map(catalogs.locations.map((row) => [row.id, row.name || ''])),
    locationById: new Map(catalogs.locations.map((row) => [row.id, row])),
    majorCharacterRows: [...catalogs.characters].sort((left, right) =>
      roleRank(left.roleType) - roleRank(right.roleType)
      || Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
      || left.id - right.id),
  }
  entityCatalogLookupCache.set(catalogs, lookups)
  return lookups
}

function appendUnique(target: number[], seen: Set<number>, values: Iterable<number>, limit: number): void {
  for (const value of values) {
    if (!Number.isInteger(value) || value <= 0 || seen.has(value)) continue
    seen.add(value)
    target.push(value)
    if (target.length >= limit) return
  }
}

function idsForNames(
  idByName: ReadonlyMap<string, number>,
  names: string[],
): number[] {
  return names.flatMap((name) => idByName.get(normalizedName(name)) || [])
}

function resolveFactionReferenceIds(
  rows: FactionMentionCatalogRow[],
  raw?: string | null,
): number[] {
  const byId = new Map(rows.map((row) => [row.id, row.id]))
  const byName = new Map(rows.map((row) => [normalizedName(row.name), row.id]))
  return parseFactionReferenceArray(raw).flatMap((value) => {
    if (typeof value === 'number') return byId.get(value) || []
    return byName.get(normalizedName(value)) || []
  })
}

function relationScore(
  relation: RelationMentionProjectionRow,
  focusText: string,
  mentionedCharacterIds: Set<number>,
  majorCharacterIds: Set<number>,
): number {
  const relationSignalMatched = [relation.relationLabel, relation.interactionStyle]
    .filter(Boolean)
    .some((term) => focusText.includes(term || ''))
  return (
    (relationSignalMatched ? 20 : 0)
    + (mentionedCharacterIds.has(relation.charAId) ? 8 : 0)
    + (mentionedCharacterIds.has(relation.charBId) ? 8 : 0)
    + (majorCharacterIds.has(relation.charAId) ? 3 : 0)
    + (majorCharacterIds.has(relation.charBId) ? 3 : 0)
    + Number(relation.intimacyLevel || 0)
    + Number(relation.tensionLevel || 0)
    + (
      relation.relationType === 'lover'
      || relation.relationType === 'enemy'
      || relation.relationType === 'family'
        ? 1
        : 0
    )
  )
}

export function loadChapterEntityMentionCatalogs(
  novelId: number,
  options: ChapterEntityMentionCatalogLoadOptions = {},
): ChapterEntityMentionCatalogs {
  const cached = getCachedEntityCatalog(novelId, options.contextVersion)
  if (cached) return cached

  const db = getDb()
  const characterRows = db.select({
    id: characters.id,
    novelId: characters.novelId,
    fullName: characters.fullName,
    surname: characters.surname,
    givenName: characters.givenName,
    roleType: characters.roleType,
    gender: characters.gender,
    occupation: characters.occupation,
    rankLevel: characters.rankLevel,
    socialIdentity: characters.socialIdentity,
    species: characters.species,
    sourceContextJson: characters.sourceContextJson,
    campFactionIdsJson: characters.campFactionIdsJson,
    sortOrder: characters.sortOrder,
  }).from(characters)
    .where(eq(characters.novelId, novelId))
    .orderBy(asc(characters.sortOrder), asc(characters.id))
    .all()
  const itemRows = db.select({
    id: storyItems.id,
    novelId: storyItems.novelId,
    itemName: storyItems.itemName,
    itemKind: storyItems.itemKind,
    subType: storyItems.subType,
    tagsJson: storyItems.tagsJson,
    sourceContextJson: storyItems.sourceContextJson,
    typedRefsJson: storyItems.typedRefsJson,
    sortOrder: storyItems.sortOrder,
  }).from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
  const locationRows = db.select({
    id: worldMap.id,
    novelId: worldMap.novelId,
    parentId: worldMap.parentId,
    level: worldMap.level,
    name: worldMap.name,
    locationType: worldMap.locationType,
    structureRole: worldMap.structureRole,
    nodeType: worldMap.nodeType,
    tagsJson: worldMap.tagsJson,
    description: worldMap.description,
    atmosphere: worldMap.atmosphere,
    plotRelevance: worldMap.plotRelevance,
    sortOrder: worldMap.sortOrder,
  }).from(worldMap)
    .where(eq(worldMap.novelId, novelId))
    .orderBy(asc(worldMap.level), asc(worldMap.sortOrder), asc(worldMap.id))
    .all()
  const factionRows = db.select({
    id: factions.id,
    novelId: factions.novelId,
    name: factions.name,
    notes: factions.notes,
    externalRelationsJson: factions.externalRelationsJson,
    sortOrder: factions.sortOrder,
  }).from(factions)
    .where(eq(factions.novelId, novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
  const relationRows = db.select({
    id: characterRelations.id,
    novelId: characterRelations.novelId,
    charAId: characterRelations.charAId,
    charBId: characterRelations.charBId,
    relationType: characterRelations.relationType,
    relationLabel: characterRelations.relationLabel,
    intimacyLevel: characterRelations.intimacyLevel,
    tensionLevel: characterRelations.tensionLevel,
    interactionStyle: characterRelations.interactionStyle,
  }).from(characterRelations)
    .where(eq(characterRelations.novelId, novelId))
    .orderBy(asc(characterRelations.id))
    .all()

  const catalogs = {
    characters: characterRows,
    items: itemRows,
    locations: locationRows,
    factions: factionRows,
    relations: relationRows,
    maxMapDepth: Math.max(1, ...locationRows.map((row) => Number(row.level || 0))),
    speciesCount: new Set(characterRows.map((row) => row.species).filter(Boolean)).size,
  }
  cacheEntityCatalog(novelId, options.contextVersion, catalogs)
  return catalogs
}

export function resolveChapterEntityContextProjection(
  catalogs: ChapterEntityMentionCatalogs,
  input: ResolveChapterEntityContextProjectionInput,
): ChapterEntityContextProjection {
  const lookups = getChapterEntityMentionCatalogLookups(catalogs)
  const mentionedCharacterIds = idsForNames(lookups.characterIdByName, input.mentionedCharacterNames)
  const mentionedCharacterIdSet = new Set(mentionedCharacterIds)
  const majorCharacterRows = lookups.majorCharacterRows
  const majorCharacterIds = new Set(
    majorCharacterRows.filter((row) => roleRank(row.roleType) <= 2).map((row) => row.id),
  )
  const relationLimit = Math.max(1, Math.min(16, input.relationLimit || 8))
  const relationFullIds = catalogs.relations
    .map((relation) => ({
      relation,
      score: relationScore(
        relation,
        input.relationFocusText,
        mentionedCharacterIdSet,
        majorCharacterIds,
      ),
    }))
    .sort((left, right) => right.score - left.score || right.relation.id - left.relation.id)
    .slice(0, relationLimit)
    .map((entry) => entry.relation.id)
  const selectedRelationIdSet = new Set(relationFullIds)
  const relationEndpointIds = catalogs.relations
    .filter((relation) => selectedRelationIdSet.has(relation.id))
    .flatMap((relation) => [relation.charAId, relation.charBId])

  const characterFullLimit = Math.max(15, input.characterLimit) + relationLimit * 2
  const characterFullIds: number[] = []
  const characterSeen = new Set<number>()
  appendUnique(characterFullIds, characterSeen, mentionedCharacterIds, characterFullLimit)
  appendUnique(characterFullIds, characterSeen, relationEndpointIds, characterFullLimit)
  appendUnique(characterFullIds, characterSeen, majorCharacterRows.map((row) => row.id), characterFullLimit)

  const itemFullLimit = Math.max(12, input.itemLimit)
  const itemFullIds: number[] = []
  const itemSeen = new Set<number>()
  appendUnique(
    itemFullIds,
    itemSeen,
    idsForNames(lookups.itemIdByName, input.mentionedItemNames),
    itemFullLimit,
  )
  appendUnique(
    itemFullIds,
    itemSeen,
    catalogs.items.filter((row) => row.itemKind === 'instance').map((row) => row.id),
    itemFullLimit,
  )

  const locationById = lookups.locationById
  const mentionedLocationIds = idsForNames(lookups.locationIdByName, input.mentionedLocationNames)
  const locationFullLimit = Math.max(
    input.locationLimit,
    Math.min(128, input.locationLimit * Math.max(2, catalogs.maxMapDepth)),
  )
  const locationFullIds: number[] = []
  const locationSeen = new Set<number>()
  for (const locationId of mentionedLocationIds) {
    appendUnique(locationFullIds, locationSeen, [locationId], locationFullLimit)
    let parentId = locationById.get(locationId)?.parentId
    let remainingDepth = Math.min(5, catalogs.maxMapDepth)
    while (typeof parentId === 'number' && remainingDepth > 0 && locationFullIds.length < locationFullLimit) {
      if (locationSeen.has(parentId)) break
      appendUnique(locationFullIds, locationSeen, [parentId], locationFullLimit)
      parentId = locationById.get(parentId)?.parentId
      remainingDepth -= 1
    }
  }

  const mentionedFactionIds = idsForNames(lookups.factionIdByName, input.mentionedFactionNames)
  const mentionedCharacterRows = catalogs.characters.filter((row) => mentionedCharacterIdSet.has(row.id))
  const characterFactionIds = mentionedCharacterRows.flatMap((row) =>
    resolveFactionReferenceIds(catalogs.factions, row.campFactionIdsJson))
  const baseFactionIds = [...new Set([...mentionedFactionIds, ...characterFactionIds])]
  const baseFactionIdSet = new Set(baseFactionIds)
  const directlyRelatedFactionIds = catalogs.factions.flatMap((row) => {
    const directRelations = parseFactionExternalRelations(row.externalRelationsJson)
      .filter((relation) => relation.relation === 'enemy' || relation.relation === 'subordinate')
    const outgoing = baseFactionIdSet.has(row.id)
      ? directRelations.flatMap((relation) => relation.targetFactionId || [])
      : []
    const reverse = directRelations.some((relation) =>
      typeof relation.targetFactionId === 'number' && baseFactionIdSet.has(relation.targetFactionId))
      ? [row.id]
      : []
    return [...outgoing, ...reverse]
  })
  const factionFullLimit = Math.max(6, input.factionLimit, baseFactionIds.length) + 6
  const factionFullIds: number[] = []
  const factionSeen = new Set<number>()
  appendUnique(factionFullIds, factionSeen, baseFactionIds, factionFullLimit)
  appendUnique(factionFullIds, factionSeen, directlyRelatedFactionIds, factionFullLimit)

  return {
    characterFullIds,
    itemFullIds,
    locationFullIds,
    factionFullIds,
    relationFullIds,
  }
}

function orderProjectedRows<T extends { id: number }>(rows: T[], ids: number[]): T[] {
  const rowById = new Map(rows.map((row) => [row.id, row]))
  return ids.flatMap((id) => rowById.get(id) || [])
}

export function loadProjectedChapterEntityRows(
  novelId: number,
  projection: ChapterEntityContextProjection,
): ProjectedChapterEntityRows {
  const db = getDb()
  const characterRows = projection.characterFullIds.length > 0
    ? db.select().from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        inArray(characters.id, projection.characterFullIds),
      ))
      .limit(projection.characterFullIds.length)
      .all()
    : []
  const itemRows = projection.itemFullIds.length > 0
    ? db.select().from(storyItems)
      .where(and(
        eq(storyItems.novelId, novelId),
        inArray(storyItems.id, projection.itemFullIds),
      ))
      .limit(projection.itemFullIds.length)
      .all()
    : []
  const locationRows = projection.locationFullIds.length > 0
    ? db.select().from(worldMap)
      .where(and(
        eq(worldMap.novelId, novelId),
        inArray(worldMap.id, projection.locationFullIds),
      ))
      .limit(projection.locationFullIds.length)
      .all()
    : []
  const factionRows = projection.factionFullIds.length > 0
    ? db.select().from(factions)
      .where(and(
        eq(factions.novelId, novelId),
        inArray(factions.id, projection.factionFullIds),
      ))
      .limit(projection.factionFullIds.length)
      .all()
    : []
  const relationRows = projection.relationFullIds.length > 0
    ? db.select().from(characterRelations)
      .where(and(
        eq(characterRelations.novelId, novelId),
        inArray(characterRelations.id, projection.relationFullIds),
      ))
      .limit(projection.relationFullIds.length)
      .all()
    : []

  return {
    characters: orderProjectedRows(characterRows, projection.characterFullIds),
    items: orderProjectedRows(itemRows, projection.itemFullIds),
    locations: orderProjectedRows(locationRows, projection.locationFullIds),
    factions: orderProjectedRows(factionRows, projection.factionFullIds),
    relations: orderProjectedRows(relationRows, projection.relationFullIds),
  }
}
