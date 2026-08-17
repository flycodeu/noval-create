import { eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { mapRelations, worldMap } from '../database/schema'

export interface TravelRelation {
  id: number
  mapAId: number
  mapBId: number
  bilateral: number | null
  travelHours: number | null
  travelMode: string | null
  routeOpen: number | null
}

export interface TravelPathStep {
  fromMapId: number
  toMapId: number
  fromName: string
  toName: string
  relationId: number
  travelHours: number
  travelMode: string | null
}

export interface TravelRouteResult {
  reachable: boolean
  totalHours: number
  steps: TravelPathStep[]
  reason: 'same_location' | 'direct' | 'path' | 'no_route'
}

export interface MovementValidationInput {
  fromMapId: number
  toMapId: number
  relations: TravelRelation[]
  availableHours?: number
  blockedRouteIds?: number[]
  mapNames?: ReadonlyMap<number, string>
}

export interface MovementValidationResult {
  ok: boolean
  reason: 'same_location' | 'reachable' | 'no_route' | 'insufficient_time'
  travelHours: number
  route: TravelPathStep[]
}

const DEFAULT_TRAVEL_HOURS = 24

/**
 * 未填 travel_hours 的关系使用保守默认耗时，避免被误判为瞬移。
 */
export function relationTravelHours(relation: TravelRelation): number {
  return typeof relation.travelHours === 'number' && Number.isFinite(relation.travelHours) && relation.travelHours > 0
    ? relation.travelHours
    : DEFAULT_TRAVEL_HOURS
}

function neighborsFor(
  nodeId: number,
  relations: TravelRelation[],
  blockedRouteIds: Set<number>,
): Array<{ to: number; relation: TravelRelation }> {
  const result: Array<{ to: number; relation: TravelRelation }> = []
  for (const relation of relations) {
    if (blockedRouteIds.has(relation.id)) continue
    if (relation.mapAId === nodeId) {
      result.push({ to: relation.mapBId, relation })
    } else if (relation.mapBId === nodeId && (relation.bilateral === 1 || relation.bilateral == null)) {
      result.push({ to: relation.mapAId, relation })
    }
  }
  return result
}

function buildRoute(
  fromMapId: number,
  toMapId: number,
  cameFrom: Map<number, { prev: number; relation: TravelRelation }>,
  mapNames: ReadonlyMap<number, string>,
): TravelPathStep[] {
  const steps: TravelPathStep[] = []
  let current = toMapId
  while (current !== fromMapId) {
    const entry = cameFrom.get(current)
    if (!entry) break
    steps.unshift({
      fromMapId: entry.prev,
      toMapId: current,
      fromName: mapNames.get(entry.prev) ?? '',
      toName: mapNames.get(current) ?? '',
      relationId: entry.relation.id,
      travelHours: relationTravelHours(entry.relation),
      travelMode: entry.relation.travelMode ?? null,
    })
    current = entry.prev
  }
  return steps
}

/**
 * 在图上做 Dijkstra，找出 fromMapId -> toMapId 的最短耗时路线。
 * 只走 open 的关系（route_open != 0），可显式排除封锁路线。纯函数，便于测试。
 */
export function findTravelRoute(
  fromMapId: number,
  toMapId: number,
  relations: TravelRelation[],
  options: { blockedRouteIds?: number[]; mapNames?: ReadonlyMap<number, string> } = {},
): TravelRouteResult {
  const mapNames = options.mapNames ?? new Map<number, string>()
  if (fromMapId === toMapId) {
    return { reachable: true, totalHours: 0, steps: [], reason: 'same_location' }
  }

  const openRelations = relations.filter((relation) => relation.routeOpen !== 0)
  const blocked = new Set(options.blockedRouteIds ?? [])
  const queue: Array<{ nodeId: number; totalHours: number }> = [{ nodeId: fromMapId, totalHours: 0 }]
  const bestHours = new Map<number, number>([[fromMapId, 0]])
  const cameFrom = new Map<number, { prev: number; relation: TravelRelation }>()

  while (queue.length > 0) {
    queue.sort((a, b) => a.totalHours - b.totalHours || a.nodeId - b.nodeId)
    const current = queue.shift()!
    if (current.totalHours !== bestHours.get(current.nodeId)) continue
    if (current.nodeId === toMapId) break

    for (const neighbor of neighborsFor(current.nodeId, openRelations, blocked)) {
      const candidateHours = current.totalHours + relationTravelHours(neighbor.relation)
      const knownHours = bestHours.get(neighbor.to)
      if (knownHours !== undefined && candidateHours >= knownHours) continue
      bestHours.set(neighbor.to, candidateHours)
      cameFrom.set(neighbor.to, { prev: current.nodeId, relation: neighbor.relation })
      queue.push({ nodeId: neighbor.to, totalHours: candidateHours })
    }
  }

  if (!cameFrom.has(toMapId)) {
    return { reachable: false, totalHours: 0, steps: [], reason: 'no_route' }
  }

  const steps = buildRoute(fromMapId, toMapId, cameFrom, mapNames)
  const totalHours = steps.reduce((sum, step) => sum + step.travelHours, 0)
  return { reachable: true, totalHours, steps, reason: steps.length === 1 ? 'direct' : 'path' }
}

/**
 * 校验一次人物移动：瞬移（无路线）、时间不足都会失败关闭。
 * 可用时间缺失时只校验可达性。纯函数，便于测试。
 */
export function validateCharacterMovement(input: MovementValidationInput): MovementValidationResult {
  const { fromMapId, toMapId, relations, availableHours, blockedRouteIds, mapNames } = input

  if (fromMapId === toMapId) {
    return { ok: true, reason: 'same_location', travelHours: 0, route: [] }
  }

  const route = findTravelRoute(fromMapId, toMapId, relations, { blockedRouteIds, mapNames })

  if (!route.reachable) {
    return { ok: false, reason: 'no_route', travelHours: 0, route: [] }
  }

  if (typeof availableHours === 'number' && Number.isFinite(availableHours) && route.totalHours > availableHours) {
    return { ok: false, reason: 'insufficient_time', travelHours: route.totalHours, route: route.steps }
  }

  return { ok: true, reason: 'reachable', travelHours: route.totalHours, route: route.steps }
}

/** 读取某小说的全部关系为可旅行图输入。 */
export function loadTravelRelations(novelId: number): TravelRelation[] {
  const db = getDb()
  return db.select().from(mapRelations).where(eq(mapRelations.novelId, novelId)).all().map((relation) => ({
    id: relation.id,
    mapAId: relation.mapAId,
    mapBId: relation.mapBId,
    bilateral: relation.bilateral,
    travelHours: relation.travelHours,
    travelMode: relation.travelMode,
    routeOpen: relation.routeOpen,
  }))
}

/** 由关系行反查两个地点的名称，用于可读的校验报告。 */
export function resolveMapNames(novelId: number, mapIds: number[]): Map<number, string> {
  const db = getDb()
  const uniqueIds = Array.from(new Set(mapIds)).filter((id) => Number.isInteger(id) && id > 0)
  if (uniqueIds.length === 0) return new Map()
  const rows = db.select({ id: worldMap.id, name: worldMap.name }).from(worldMap)
    .where(eq(worldMap.novelId, novelId))
    .all()
    .filter((row) => uniqueIds.includes(row.id))
  return new Map(rows.map((row) => [row.id, row.name]))
}
