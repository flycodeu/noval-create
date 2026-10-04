import type { StoryAtlasDiagnostic, StoryAtlasEntity, StoryAtlasRelation } from './story-atlas'
import { atlasRouteStraightLineKm, isAtlasInteriorConnection } from './story-atlas-geography'

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value)
const text = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const numberLabel = (value: number) => Number(value.toFixed(2)).toLocaleString('zh-CN')

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
      const routes = relations.filter(route => route.kind === 'route' && route.status === 'confirmed' && route.attributes.routeOpen === true
        && (route.fromId === fromId && route.toId === toId || route.attributes.bilateral !== false && route.fromId === toId && route.toId === fromId))
        .filter(route => positive(route.attributes.travelHours) && text(route.attributes.travelMode) && !(diagnostics.some(issue => issue.code === 'ROUTE_DISTANCE_BELOW_MAP' && issue.entityIds.includes(route.id))))
      const firstMinute = minute(from), lastMinute = minute(to)
      const dayDifference = Number(to.attributes.relativeDay) - Number(from.attributes.relativeDay)
      if (firstMinute === undefined || lastMinute === undefined || !routes.length) {
        diagnostics.push({ severity: 'info', code: 'EVENT_TRAVEL_TIME_UNKNOWN', message: `${person.name}在“${from.name}”与“${to.name}”涉及不同地点；精确发生时刻或明确可通行路线的耗时尚不齐备，无法核对行程。事件先后序号不等于小时。`, entityIds: ids })
        continue
      }
      const availableHours = dayDifference * 24 + (lastMinute - firstMinute) / 60
      const route = routes.reduce((best, next) => Number(next.attributes.travelHours) < Number(best.attributes.travelHours) ? next : best)
      if (availableHours + 1e-8 < Number(route.attributes.travelHours)) diagnostics.push({ severity: 'warning', code: 'EVENT_TRAVEL_TIME_REVIEW', message: `${person.name}从“${from.name}”到“${to.name}”仅间隔 ${numberLabel(availableHours)} 小时，已登记的直接通路需 ${numberLabel(Number(route.attributes.travelHours))} 小时；请复核事件时刻、路线或其他有依据的通行方式。`, entityIds: [...ids, route.id] })
    }
  }
  return diagnostics
}
