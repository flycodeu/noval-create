import { atlasRouteOpen } from './story-atlas'
import type { StoryAtlasDiagnostic, StoryAtlasEntity, StoryAtlasRelation } from './story-atlas'
import { atlasRouteStraightLineKm, isAtlasInteriorConnection } from './story-atlas-geography'

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const numberLabel = (value: number) => Number(value.toFixed(2)).toLocaleString('zh-CN')

export type AtlasTravelSeason = 'spring' | 'summer' | 'autumn' | 'winter'
export const ATLAS_TRAVEL_SEASONS: Record<AtlasTravelSeason, string> = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' }
export interface AtlasJourneyOptions { travelMode?: string; allowTransfers?: boolean; season?: AtlasTravelSeason }
export interface AtlasJourneyStep { routeId: string; fromId: string; toId: string; travelMode: string; travelHours: number; distanceKm?: number }
export interface AtlasJourneyTransfer { locationId: string; fromMode: string; toMode: string; minutes: number }
export interface AtlasJourneyResult {
  status: 'known' | 'unknown'
  reason?: string
  steps: AtlasJourneyStep[]
  transfers: AtlasJourneyTransfer[]
  totalHours?: number
  totalDistanceKm?: number
  excludedRoutes: Array<{ routeId: string; reasons: string[] }>
}
export function atlasTravelMode(value: unknown): string {
  const mode = text(value).toLowerCase()
  return ({ foot: '步行', walk: '步行', walking: '步行', boat: '舟船', ship: '舟船', 船: '舟船', horse: '骑马' } as Record<string, string>)[mode] || mode
}

/** Shortest time among explicitly recorded, usable roads. No parent-child shortcuts or terrain inference. */
export function calculateAtlasJourney(entities: readonly StoryAtlasEntity[], relations: readonly StoryAtlasRelation[], fromId: string, toId: string, options: AtlasJourneyOptions = {}): AtlasJourneyResult {
  const byId = new Map(entities.filter(entity => entity.kind === 'location').map(entity => [entity.id, entity]))
  const empty: AtlasJourneyResult = { status: 'unknown', steps: [], transfers: [], excludedRoutes: [] }
  if (!byId.has(fromId) || !byId.has(toId)) return { ...empty, reason: '起点或终点尚未登记。' }
  if (byId.get(fromId)!.status !== 'confirmed' || byId.get(toId)!.status !== 'confirmed') return { ...empty, reason: '起点或终点属于规划地点。' }
  if (fromId === toId) return { ...empty, status: 'known', totalHours: 0, totalDistanceKm: 0 }
  const edges = new Map<string, AtlasJourneyStep[]>()
  const topology = new Map<string, string[]>(), reversed = new Map<string, string[]>()
  const excluded: AtlasJourneyResult['excludedRoutes'] = []
  const allowedMode = atlasTravelMode(options.travelMode)
  const addTopology = (from: string, to: string) => { topology.set(from, [...(topology.get(from) || []), to]); reversed.set(to, [...(reversed.get(to) || []), from]) }
  for (const route of relations.filter(relation => relation.kind === 'route' && byId.has(relation.fromId) && byId.has(relation.toId))) {
    const bilateral = route.attributes.bilateral !== false && route.attributes.bilateral !== 0
    addTopology(route.fromId, route.toId)
    if (bilateral) addTopology(route.toId, route.fromId)
    const reasons: string[] = []
    const mode = atlasTravelMode(route.attributes.travelMode)
    if (route.status !== 'confirmed' || byId.get(route.fromId)!.status !== 'confirmed' || byId.get(route.toId)!.status !== 'confirmed') reasons.push('通路或端点尚属规划')
    if (atlasRouteOpen(route.attributes.routeOpen) !== true) reasons.push(atlasRouteOpen(route.attributes.routeOpen) === false ? '通路已关闭' : '是否通行尚未确认')
    if (!positive(route.attributes.travelHours)) reasons.push('行程耗时缺失或不是正数')
    if (!mode) reasons.push('交通方式未登记')
    if (allowedMode && mode !== allowedMode) reasons.push('不符合所选交通方式')
    if (options.season) {
      const access = route.attributes.seasonAccess
      const state = access && typeof access === 'object' && !Array.isArray(access) ? (access as Record<string, unknown>)[options.season] : undefined
      if (state !== 'open') reasons.push(state === 'closed' ? `${ATLAS_TRAVEL_SEASONS[options.season]}不通行` : `${ATLAS_TRAVEL_SEASONS[options.season]}通行状态未登记`)
    }
    const km = route.attributes.distanceKm, lowerBound = atlasRouteStraightLineKm(route, entities)
    if (positive(km) && lowerBound !== undefined && km + 0.01 < lowerBound) reasons.push('里程小于地图直线下限，需校正')
    if (reasons.length) { excluded.push({ routeId: route.id, reasons }); continue }
    const step: AtlasJourneyStep = { routeId: route.id, fromId: route.fromId, toId: route.toId, travelMode: mode, travelHours: Number(route.attributes.travelHours), ...(positive(km) ? { distanceKm: km } : {}) }
    edges.set(step.fromId, [...(edges.get(step.fromId) || []), step])
    if (bilateral) edges.set(step.toId, [...(edges.get(step.toId) || []), { ...step, fromId: step.toId, toId: step.fromId }])
  }
  const reachable = (graph: Map<string, string[]>, start: string) => {
    const visited = new Set([start]), queue = [start]
    for (let index = 0; index < queue.length; index++) for (const id of graph.get(queue[index]) || []) if (!visited.has(id)) { visited.add(id); queue.push(id) }
    return visited
  }
  const forward = reachable(topology, fromId), backward = reachable(reversed, toId)
  empty.excludedRoutes = excluded.filter(issue => {
    const route = relations.find(relation => relation.id === issue.routeId)!
    return forward.has(route.fromId) && backward.has(route.toId)
      || route.attributes.bilateral !== false && route.attributes.bilateral !== 0 && forward.has(route.toId) && backward.has(route.fromId)
  })
  type State = { locationId: string; mode: string; hours: number; steps: AtlasJourneyStep[]; transfers: AtlasJourneyTransfer[] }
  const queue: State[] = [{ locationId: fromId, mode: '', hours: 0, steps: [], transfers: [] }]
  const best = new Map<string, number>()
  while (queue.length) {
    queue.sort((a, b) => a.hours - b.hours || a.locationId.localeCompare(b.locationId) || a.mode.localeCompare(b.mode))
    const current = queue.shift()!
    const key = JSON.stringify([current.locationId, current.mode])
    if ((best.get(key) ?? Infinity) <= current.hours) continue
    best.set(key, current.hours)
    if (current.locationId === toId) return { status: 'known', steps: current.steps, transfers: current.transfers, totalHours: current.hours,
      ...(current.steps.every(step => step.distanceKm !== undefined) ? { totalDistanceKm: current.steps.reduce((sum, step) => sum + step.distanceKm!, 0) } : {}), excludedRoutes: empty.excludedRoutes }
    for (const step of edges.get(current.locationId) || []) {
      let transfer: AtlasJourneyTransfer | undefined
      if (current.mode && current.mode !== step.travelMode) {
        if (!options.allowTransfers) continue
        const raw = byId.get(current.locationId)!.attributes.transfers
        const candidates = Array.isArray(raw) ? raw.filter(value => value && typeof value === 'object').map(value => value as Record<string, unknown>) : []
        const entry = candidates.filter(value => atlasTravelMode(value.fromMode) === current.mode && atlasTravelMode(value.toMode) === step.travelMode
          && typeof value.minutes === 'number' && Number.isFinite(value.minutes) && value.minutes >= 0).sort((a, b) => Number(a.minutes) - Number(b.minutes))[0]
        if (!entry) continue
        transfer = { locationId: current.locationId, fromMode: current.mode, toMode: step.travelMode, minutes: Number(entry.minutes) }
      }
      const hours = current.hours + step.travelHours + (transfer?.minutes || 0) / 60
      if (!Number.isFinite(hours)) continue
      queue.push({ locationId: step.toId, mode: step.travelMode, hours, steps: [...current.steps, step], transfers: [...current.transfers, ...(transfer ? [transfer] : [])] })
    }
  }
  return { ...empty, reason: '未找到条件完整的行程；需核对通路、耗时、交通方式或换乘安排。' }
}

export function atlasRouteMissingFields(route: StoryAtlasRelation, entities: readonly StoryAtlasEntity[]): string[] {
  if (isAtlasInteriorConnection(route, entities)) return []
  return [!positive(route.attributes.distanceKm) && '路线里程', !positive(route.attributes.travelHours) && '行程耗时', !text(route.attributes.travelMode) && '交通方式'].filter((value): value is string => Boolean(value))
}

/** These are review prompts, not proofs about roads or physically impossible events. */
export function diagnoseAtlasTravel(entities: readonly StoryAtlasEntity[], relations: readonly StoryAtlasRelation[]): StoryAtlasDiagnostic[] {
  const diagnostics: StoryAtlasDiagnostic[] = []
  for (const route of relations.filter(relation => relation.kind === 'route')) {
    if (isAtlasInteriorConnection(route, entities)) continue
    const missing = atlasRouteMissingFields(route, entities)
    const ids = [route.id, route.fromId, route.toId]
    if (missing.includes('路线里程')) diagnostics.push({ severity: 'info', code: 'TRAVEL_DISTANCE_UNKNOWN', message: `${route.label || '路线'}尚未登记正数路线里程；地图直线距离不能代替实际道路长度。`, entityIds: ids })
    if (missing.includes('行程耗时')) diagnostics.push({ severity: 'info', code: 'TRAVEL_TIME_UNKNOWN', message: `${route.label || '路线'}尚未登记正数通行耗时。`, entityIds: ids })
    if (missing.includes('交通方式')) diagnostics.push({ severity: 'info', code: 'TRAVEL_MODE_UNKNOWN', message: `${route.label || '路线'}尚未登记交通方式。`, entityIds: ids })
    const km = route.attributes.distanceKm, hours = route.attributes.travelHours
    const direct = atlasRouteStraightLineKm(route, entities)
    if (positive(km) && direct !== undefined && km + 0.01 < direct) diagnostics.push({ severity: 'warning', code: 'ROUTE_DISTANCE_BELOW_MAP', message: `${route.label || '路线'}登记里程 ${numberLabel(km)} 公里，小于同一地图尺度下两处位置的直线距离 ${numberLabel(direct)} 公里；请复核位置、尺度或路线里程。`, entityIds: ids })
    if (positive(km) && positive(hours) && /步行|foot|walk/i.test(text(route.attributes.travelMode)) && km / hours > 8) diagnostics.push({ severity: 'warning', code: 'WALKING_SPEED_IMPLAUSIBLE', message: `${route.label || '路线'}的步行速度超过每小时 8 公里，请复核距离、耗时或特殊设定。`, entityIds: ids })
  }

  const byId = new Map(entities.map(entity => [entity.id, entity]))
  // Only written, explicitly located events and explicit in-person participation qualify.
  // Affected people, residence/activity links and reported witnesses do not establish presence.
  const events = entities.filter(entity => entity.kind === 'event' && entity.status === 'confirmed'
    && ['written', 'resolved'].includes(text(entity.attributes.status)) && whole(entity.attributes.relativeDay))
  const place = (event: StoryAtlasEntity) => {
    const ids = [...new Set(relations.filter(relation => relation.kind === 'presence' && relation.fromId === event.id && relation.status === 'confirmed' && relation.attributes.locationRole === 'current').map(relation => relation.toId))]
    return ids.length === 1 && byId.get(ids[0])?.kind === 'location' ? ids[0] : undefined
  }
  const present = (event: StoryAtlasEntity, relation: StoryAtlasRelation) => {
    if (relation.kind !== 'participation' || relation.toId !== event.id || relation.status !== 'confirmed' || byId.get(relation.fromId)?.kind !== 'character') return false
    if (/自述|转述|证言|目击者|受影响/.test(relation.label)) return false
    const ids = Array.isArray(event.attributes.presentCharacterIds) ? event.attributes.presentCharacterIds : []
    return relation.attributes.participationRole === 'present' || relation.label.startsWith('在场')
      || ids.some(id => relation.fromId === String(id) || relation.fromId === `character:${id}`)
  }
  const minute = (event: StoryAtlasEntity) => {
    const value = event.attributes.timeOfDayMinutes
    return whole(value) && value >= 0 && value < 1440 && text(event.attributes.evidenceQuote).length >= 4 ? value : undefined
  }
  for (const person of entities.filter(entity => entity.kind === 'character' && entity.status === 'confirmed')) {
    const entries = events.filter(event => relations.some(relation => relation.fromId === person.id && present(event, relation)))
      .filter(event => place(event) && (whole(event.attributes.sequenceInDay) || minute(event) !== undefined))
      .sort((a, b) => Number(a.attributes.relativeDay) - Number(b.attributes.relativeDay)
        || (minute(a) ?? Infinity) - (minute(b) ?? Infinity)
        || (whole(a.attributes.sequenceInDay) ? a.attributes.sequenceInDay : Infinity) - (whole(b.attributes.sequenceInDay) ? b.attributes.sequenceInDay : Infinity)
        || a.id.localeCompare(b.id))
    for (let index = 1; index < entries.length; index++) {
      const from = entries[index - 1], to = entries[index]
      const fromId = place(from)!, toId = place(to)!
      if (fromId === toId || isAtlasInteriorConnection({ fromId, toId, attributes: {} } as StoryAtlasRelation, entities)) continue
      const ids = [person.id, from.id, to.id, fromId, toId]
      const journey = calculateAtlasJourney(entities, relations, fromId, toId)
      const firstMinute = minute(from), lastMinute = minute(to)
      const dayDifference = Number(to.attributes.relativeDay) - Number(from.attributes.relativeDay)
      if (firstMinute === undefined || lastMinute === undefined || journey.status !== 'known') {
        diagnostics.push({ severity: 'info', code: 'EVENT_TRAVEL_TIME_UNKNOWN', message: `${person.name}在“${from.name}”与“${to.name}”涉及不同地点；精确发生时刻或明确可通行路线的耗时尚不齐备，无法核对行程。事件先后序号不等于小时。`, entityIds: ids })
        continue
      }
      const availableHours = dayDifference * 24 + (lastMinute - firstMinute) / 60
      if (availableHours + 1e-8 < journey.totalHours!) diagnostics.push({ severity: 'warning', code: 'EVENT_TRAVEL_TIME_REVIEW', message: `${person.name}从“${from.name}”到“${to.name}”仅间隔 ${numberLabel(availableHours)} 小时，条件已齐的登记路线中最短方案需 ${numberLabel(journey.totalHours!)} 小时（${journey.steps.map(step => relations.find(relation => relation.id === step.routeId)?.label || step.routeId).join(' → ')}）；请复核事件时刻、路线或其他有依据的通行方式。`, entityIds: [...new Set([...ids, ...journey.steps.map(step => step.routeId)])] })
    }
  }
  return diagnostics
}
