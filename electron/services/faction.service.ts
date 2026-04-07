import { asc, eq } from 'drizzle-orm'
import type { Faction as AppFaction, FactionStats } from '../../src/types'
import { getDb } from '../database/db'
import { characters, factions, worldMap } from '../database/schema'
import { markNovelContextChanged } from './context-impact.service'
import { parseFactionExternalRelations } from '../../src/shared/factions'
import {
  parseFactionReferenceArray,
  stringifyFactionReferences,
} from './faction-reference.service'

interface FactionQueryFilters {
  novelId: number
  type?: AppFaction['type']
  keyword?: string
  page?: number
  pageSize?: number
}

function normalizePage(page?: number, pageSize?: number) {
  const nextPage = Math.max(1, page || 1)
  const nextPageSize = Math.max(1, Math.min(pageSize || 24, 200))
  return {
    page: nextPage,
    pageSize: nextPageSize,
    offset: (nextPage - 1) * nextPageSize,
  }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value))
  return undefined
}

function stringifyNumberArray(input: unknown): string {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed
          .map((item) => asNumber(item))
          .filter((item): item is number => typeof item === 'number'))
      }
    } catch {
      return '[]'
    }
  }

  if (!Array.isArray(input)) return '[]'
  return JSON.stringify(input
    .map((item) => asNumber(item))
    .filter((item): item is number => typeof item === 'number'))
}

function sanitizeFactionPayload(
  novelId: number,
  data: Partial<typeof factions.$inferInsert>,
): Partial<typeof factions.$inferInsert> {
  const next: Partial<typeof factions.$inferInsert> = {}

  if (typeof data.name === 'string') next.name = asText(data.name)
  if (typeof data.type === 'string') next.type = asText(data.type)
  if (typeof data.goal === 'string') next.goal = asText(data.goal)
  if (typeof data.resources === 'string') next.resources = asText(data.resources)
  if ('territoryMapNodeIdsJson' in data) next.territoryMapNodeIdsJson = stringifyNumberArray(data.territoryMapNodeIdsJson)
  if ('leaderCharacterId' in data) next.leaderCharacterId = asNumber(data.leaderCharacterId)
  if (typeof data.memberPolicy === 'string') next.memberPolicy = asText(data.memberPolicy)
  if (typeof data.currentPhase === 'string') next.currentPhase = asText(data.currentPhase)
  if (typeof data.externalRelationsJson === 'string') next.externalRelationsJson = data.externalRelationsJson
  if (typeof data.notes === 'string') next.notes = asText(data.notes)
  if ('sortOrder' in data) next.sortOrder = asNumber(data.sortOrder) ?? 0

  if ('leaderCharacterId' in next && typeof next.leaderCharacterId === 'number') {
    const db = getDb()
    const leader = db.select().from(characters).where(eq(characters.id, next.leaderCharacterId)).all()[0]
    if (!leader || leader.novelId !== novelId) next.leaderCharacterId = null
  }

  return next
}

function mapFactionEntity(row: typeof factions.$inferSelect): AppFaction {
  return {
    id: row.id,
    novelId: row.novelId,
    name: row.name,
    type: (row.type as AppFaction['type']) || 'faction',
    goal: row.goal ?? undefined,
    resources: row.resources ?? undefined,
    territoryMapNodeIdsJson: row.territoryMapNodeIdsJson ?? undefined,
    leaderCharacterId: row.leaderCharacterId ?? undefined,
    memberPolicy: row.memberPolicy ?? undefined,
    currentPhase: row.currentPhase ?? undefined,
    externalRelationsJson: row.externalRelationsJson ?? undefined,
    notes: row.notes ?? undefined,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  }
}

function cleanupFactionReferences(factionId: number, novelId: number, factionName: string) {
  const db = getDb()
  const normalizeName = (value: string) => value.trim().replace(/\s+/g, '').toLowerCase()
  const targetName = normalizeName(factionName)

  db.select().from(characters).where(eq(characters.novelId, novelId)).all().forEach((character) => {
    const next = parseFactionReferenceArray(character.campFactionIdsJson).filter((value) => {
      if (typeof value === 'number') return value !== factionId
      return normalizeName(value) !== targetName
    })
    db.update(characters).set({
      campFactionIdsJson: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    }).where(eq(characters.id, character.id)).run()
  })

  db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all().forEach((node) => {
    const next = parseFactionReferenceArray(node.affiliatedFactionIdsJson).filter((value) => {
      if (typeof value === 'number') return value !== factionId
      return normalizeName(value) !== targetName
    })
    db.update(worldMap).set({
      affiliatedFactionIdsJson: JSON.stringify(next),
    }).where(eq(worldMap.id, node.id)).run()
  })

  db.select().from(factions).where(eq(factions.novelId, novelId)).all().forEach((row) => {
    const nextRelations = parseFactionExternalRelations(row.externalRelationsJson).filter((relation) => {
      if (typeof relation.targetFactionId === 'number' && relation.targetFactionId === factionId) return false
      if (relation.targetFactionName && normalizeName(relation.targetFactionName) === targetName) return false
      return true
    })
    db.update(factions).set({
      externalRelationsJson: JSON.stringify(nextRelations.map((relation) => ({
        target_faction_id: relation.targetFactionId,
        target_faction_name: relation.targetFactionName,
        relation: relation.relation,
        note: relation.note,
      }))),
      updatedAt: new Date().toISOString(),
    }).where(eq(factions.id, row.id)).run()
  })
}

export function listFactions(novelId: number) {
  const db = getDb()
  return db.select().from(factions)
    .where(eq(factions.novelId, novelId))
    .orderBy(asc(factions.sortOrder), asc(factions.id))
    .all()
    .map(mapFactionEntity)
}

export function queryFactions(filters: FactionQueryFilters) {
  const { page, pageSize, offset } = normalizePage(filters.page, filters.pageSize)
  const keyword = filters.keyword?.trim().toLowerCase()

  const rows = listFactions(filters.novelId).filter((row) => {
    if (filters.type && row.type !== filters.type) return false
    if (keyword) {
      const haystack = [row.name, row.goal, row.resources, row.memberPolicy, row.currentPhase, row.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })

  return buildPagedResult(rows.slice(offset, offset + pageSize), page, pageSize, rows.length)
}

export function getFactionStats(filters: { novelId: number }): FactionStats {
  const rows = listFactions(filters.novelId)
  return {
    total: rows.length,
    withLeaderCount: rows.filter((row) => typeof row.leaderCharacterId === 'number').length,
    territoryBoundCount: rows.filter((row) => {
      if (!row.territoryMapNodeIdsJson) return false
      try {
        const parsed = JSON.parse(row.territoryMapNodeIdsJson)
        return Array.isArray(parsed) && parsed.length > 0
      } catch {
        return false
      }
    }).length,
    relationCount: rows.reduce((sum, row) => sum + parseFactionExternalRelations(row.externalRelationsJson).length, 0),
  }
}

export function getFaction(id: number) {
  const db = getDb()
  const row = db.select().from(factions).where(eq(factions.id, id)).all()[0]
  return row ? mapFactionEntity(row) : null
}

export function searchFactions(novelId: number, keyword = '', limit = 12) {
  return listFactions(novelId)
    .filter((row) => {
      if (!keyword.trim()) return true
      const haystack = [row.name, row.goal, row.resources, row.currentPhase, row.notes].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(keyword.trim().toLowerCase())
    })
    .slice(0, Math.max(1, Math.min(limit, 50)))
}

export function createFaction(novelId: number, data: Partial<typeof factions.$inferInsert>) {
  const db = getDb()
  const rows = db.select().from(factions).where(eq(factions.novelId, novelId)).all()
  const payload = sanitizeFactionPayload(novelId, data)
  const result = db.insert(factions).values({
    novelId,
    name: payload.name || '未命名势力',
    type: payload.type || 'faction',
    goal: payload.goal || '',
    resources: payload.resources || '',
    territoryMapNodeIdsJson: payload.territoryMapNodeIdsJson || '[]',
    leaderCharacterId: payload.leaderCharacterId ?? null,
    memberPolicy: payload.memberPolicy || '',
    currentPhase: payload.currentPhase || '',
    externalRelationsJson: payload.externalRelationsJson || '[]',
    notes: payload.notes || '',
    sortOrder: rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1,
  }).run()

  markNovelContextChanged(novelId, 'Factions changed')
  return Number(result.lastInsertRowid)
}

export function updateFaction(id: number, data: Partial<typeof factions.$inferInsert>) {
  const current = getFaction(id)
  if (!current) return
  const db = getDb()
  db.update(factions).set({
    ...sanitizeFactionPayload(current.novelId, data),
    updatedAt: new Date().toISOString(),
  }).where(eq(factions.id, id)).run()

  markNovelContextChanged(current.novelId, 'Factions changed')
}

export function deleteFaction(id: number) {
  const current = getFaction(id)
  if (!current) return
  const db = getDb()
  cleanupFactionReferences(current.id, current.novelId, current.name)
  db.delete(factions).where(eq(factions.id, id)).run()
  markNovelContextChanged(current.novelId, 'Factions changed')
}

export function resolveFactionNameOptions(novelId: number): string[] {
  return listFactions(novelId).map((row) => row.name)
}

export function normalizeFactionReferenceJsonForNovel(novelId: number, input: unknown): string {
  return stringifyFactionReferences(novelId, input)
}
