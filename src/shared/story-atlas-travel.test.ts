import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasRelation } from './story-atlas'
import { atlasRouteStraightLineKm } from './story-atlas-geography'
import { calculateAtlasJourney, diagnoseAtlasTravel } from './story-atlas-travel'

const entity = (id: string, kind: StoryAtlasEntity['kind'], parentId: string | null, attributes: Record<string, unknown> = {}): StoryAtlasEntity => ({ id, kind, name: id, summary: '', parentId, attributes, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const relation = (id: string, kind: StoryAtlasRelation['kind'], fromId: string, toId: string, attributes: Record<string, unknown> = {}): StoryAtlasRelation => ({ id, kind, fromId, toId, attributes, label: kind === 'participation' ? '在场' : id, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const boundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
const country = entity('country', 'location', null, { geography: { boundary, mapFrame: { widthKm: 100, heightKm: 100 } } })
const a = entity('a', 'location', 'country', { geography: { position: { x: 10, y: 50 } }, nodeType: 'town' })
const b = entity('b', 'location', 'country', { geography: { position: { x: 60, y: 50 } }, nodeType: 'town' })
const route = relation('r', 'route', 'a', 'b', { travelMode: '步行', distanceKm: 60, travelHours: 15, routeOpen: true })

describe('map and event travel diagnostics', () => {
  it('uses comparable metric positions as a lower bound without inventing road distance', () => {
    expect(atlasRouteStraightLineKm(route, [country, a, b])).toBe(50)
    const wrong = { ...route, attributes: { ...route.attributes, distanceKm: 20 } }
    expect(diagnoseAtlasTravel([country, a, b], [wrong]).some(issue => issue.code === 'ROUTE_DISTANCE_BELOW_MAP')).toBe(true)
    expect(diagnoseAtlasTravel([country, a, b], [route])).toEqual([])
    expect(atlasRouteStraightLineKm(route, [{ ...country, attributes: {} }, a, b])).toBeUndefined()
  })
  it('reports missing transport data rather than estimating it from map positions', () => {
    const result = diagnoseAtlasTravel([country, a, b], [{ ...route, attributes: {} }])
    expect(result.map(issue => issue.code)).toEqual(['TRAVEL_DISTANCE_UNKNOWN', 'TRAVEL_TIME_UNKNOWN', 'TRAVEL_MODE_UNKNOWN'])
  })
  it('checks cross-region coordinate conversions and refuses conflicting nested scales', () => {
    const west = entity('west', 'location', 'country', { geography: { boundary: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 }] } })
    const east = entity('east', 'location', 'country', { geography: { boundary: [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }] } })
    const locations = [country, west, east, { ...a, parentId: 'west' }, { ...b, parentId: 'east' }]
    expect(atlasRouteStraightLineKm(route, locations)).toBe(75)
    locations[1] = { ...west, attributes: { geography: { ...(west.attributes.geography as object), mapFrame: { widthKm: 5, heightKm: 100 } } } }
    expect(atlasRouteStraightLineKm(route, locations)).toBeUndefined()
  })
  it('does not turn sequence numbers, reported witnesses or closed routes into travel proof', () => {
    const person = entity('person', 'character', null)
    const first = entity('e1', 'event', null, { status: 'written', relativeDay: 0, sequenceInDay: 1, evidenceQuote: '先在甲镇见他。' })
    const last = entity('e2', 'event', null, { status: 'written', relativeDay: 0, sequenceInDay: 2, evidenceQuote: '后来他在乙镇。' })
    const edges = [route, relation('p1', 'participation', person.id, first.id), relation('p2', 'participation', person.id, last.id), relation('l1', 'presence', first.id, a.id, { locationRole: 'current' }), relation('l2', 'presence', last.id, b.id, { locationRole: 'current' })]
    const entities = [country, a, b, person, first, last]
    expect(diagnoseAtlasTravel(entities, edges).some(issue => issue.code === 'EVENT_TRAVEL_TIME_UNKNOWN')).toBe(true)
    const timed = entities.map(item => item.id === first.id ? { ...first, attributes: { ...first.attributes, timeOfDayMinutes: 480 } } : item.id === last.id ? { ...last, attributes: { ...last.attributes, timeOfDayMinutes: 600 } } : item)
    expect(diagnoseAtlasTravel(timed, edges).some(issue => issue.code === 'EVENT_TRAVEL_TIME_REVIEW')).toBe(true)
    expect(diagnoseAtlasTravel(timed, edges.map(edge => edge.id === 'p1' ? { ...edge, label: '自述目击者' } : edge)).some(issue => issue.code.startsWith('EVENT_TRAVEL'))).toBe(false)
    expect(diagnoseAtlasTravel(timed, edges.map(edge => edge.id === route.id ? { ...edge, attributes: { ...edge.attributes, routeOpen: false } } : edge)).some(issue => issue.code === 'EVENT_TRAVEL_TIME_REVIEW')).toBe(false)
  })
})

describe('recorded multi-leg journeys', () => {
  const c = entity('c', 'location', 'other-region')
  const first = relation('ab', 'route', a.id, b.id, { travelMode: 'foot', travelHours: 3, distanceKm: 55, routeOpen: true })
  const second = relation('bc', 'route', b.id, c.id, { travelMode: '步行', travelHours: 2, distanceKm: 8, routeOpen: true })
  const places = [country, a, b, c, entity('other-region', 'location', country.id, { nodeType: 'region' })]
  it('keeps direct-route behavior and chooses a faster multi-leg path with route evidence', () => {
    expect(calculateAtlasJourney([country, a, b], [route], a.id, b.id)).toMatchObject({ status: 'known', totalHours: 15, totalDistanceKm: 60, steps: [{ routeId: route.id }] })
    const slow = relation('ac', 'route', a.id, c.id, { travelMode: '步行', travelHours: 8, routeOpen: true })
    const result = calculateAtlasJourney(places, [first, second, slow], a.id, c.id)
    expect(result).toMatchObject({ status: 'known', totalHours: 5, totalDistanceKm: 63, steps: [{ routeId: first.id, fromId: a.id, toId: b.id }, { routeId: second.id, fromId: b.id, toId: c.id }] })
    expect(result.transfers).toEqual([])
  })
  it('honors single directions, explicit closure, planning and missing time or mode', () => {
    const directed = [first, second].map(edge => ({ ...edge, attributes: { ...edge.attributes, bilateral: false } }))
    expect(calculateAtlasJourney(places, directed, a.id, c.id).status).toBe('known')
    expect(calculateAtlasJourney(places, directed, c.id, a.id).status).toBe('unknown')
    for (const attributes of [{ routeOpen: false }, { routeOpen: undefined }, { travelHours: null }, { travelHours: 0 }, { travelHours: '2' }, { travelMode: '' }]) {
      const result = calculateAtlasJourney(places, [first, { ...second, attributes: { ...second.attributes, ...attributes } }], a.id, c.id)
      expect(result.status).toBe('unknown')
      expect(result.excludedRoutes.map(issue => issue.routeId)).toContain(second.id)
    }
    expect(calculateAtlasJourney(places, [first, { ...second, status: 'planned' }], a.id, c.id).status).toBe('unknown')
    expect(calculateAtlasJourney(places.map(place => place.id === b.id ? { ...place, status: 'planned' } : place), [first, second], a.id, c.id).status).toBe('unknown')
  })
  it('can sum known durations without pretending missing distances or parent containment are roads', () => {
    const road = { ...second, attributes: { travelMode: '步行', travelHours: 2, routeOpen: true } }
    const result = calculateAtlasJourney(places, [first, road], a.id, c.id)
    expect(result.status).toBe('known')
    expect(result.totalHours).toBe(5)
    expect(result.totalDistanceKm).toBeUndefined()
    expect(calculateAtlasJourney(places, [], country.id, a.id).status).toBe('unknown')
    expect(calculateAtlasJourney(places, [first, second], a.id, 'missing').status).toBe('unknown')
    expect(calculateAtlasJourney(places, [first, second], a.id, a.id)).toMatchObject({ status: 'known', totalHours: 0, steps: [] })
  })
  it('does not assume arbitrary mode changes or omit explicit transfer waits', () => {
    const boat = { ...second, attributes: { ...second.attributes, travelMode: 'boat' } }
    expect(calculateAtlasJourney(places, [first, boat], a.id, c.id).status).toBe('unknown')
    expect(calculateAtlasJourney(places, [first, boat], a.id, c.id, { allowTransfers: true }).status).toBe('unknown')
    const dock = { ...b, attributes: { ...b.attributes, transfers: [{ fromMode: '步行', toMode: '舟船', minutes: 30 }] } }
    const result = calculateAtlasJourney([country, a, dock, c], [first, boat], a.id, c.id, { allowTransfers: true })
    expect(result).toMatchObject({ status: 'known', totalHours: 5.5, transfers: [{ locationId: b.id, fromMode: '步行', toMode: '舟船', minutes: 30 }] })
    expect(calculateAtlasJourney([country, a, dock, c], [first, boat], c.id, a.id, { allowTransfers: true }).status).toBe('unknown')
    expect(calculateAtlasJourney([country, a, dock, c], [first, boat], a.id, c.id, { allowTransfers: true, travelMode: '步行' }).status).toBe('unknown')
  })
  it('only applies explicit seasonal states when a season is requested, without deriving them from terrain', () => {
    expect(calculateAtlasJourney(places, [first, second], a.id, c.id).status).toBe('known')
    expect(calculateAtlasJourney(places, [first, second], a.id, c.id, { season: 'summer' }).status).toBe('unknown')
    const roads = [first, second].map(edge => ({ ...edge, attributes: { ...edge.attributes, terrain: '沿河堤', access: '雨汛积水需绕行', seasonAccess: { spring: 'open', summer: 'closed' } } }))
    expect(calculateAtlasJourney(places, roads, a.id, c.id, { season: 'spring' }).status).toBe('known')
    expect(calculateAtlasJourney(places, roads, a.id, c.id, { season: 'summer' }).status).toBe('unknown')
    expect(calculateAtlasJourney(places, roads, a.id, c.id, { season: 'winter' }).status).toBe('unknown')
  })
  it('excludes physically contradictory route lengths without substituting the straight line', () => {
    const wrong = { ...first, attributes: { ...first.attributes, distanceKm: 2 } }
    expect(calculateAtlasJourney(places, [wrong, second], a.id, c.id).status).toBe('unknown')
    expect(wrong.attributes.distanceKm).toBe(2)
  })
  it('uses the multi-leg evidence for time review and still keeps vague times unknown', () => {
    const person = entity('person', 'character', null)
    const events = [entity('e1', 'event', null, { status: 'written', relativeDay: 0, sequenceInDay: 1, timeOfDayMinutes: 480, evidenceQuote: '八时在甲镇。' }), entity('e2', 'event', null, { status: 'written', relativeDay: 0, sequenceInDay: 2, timeOfDayMinutes: 600, evidenceQuote: '十时在丙镇。' })]
    const edges = [first, second, ...events.map(event => relation(`p:${event.id}`, 'participation', person.id, event.id)), relation('at-a', 'presence', events[0].id, a.id, { locationRole: 'current' }), relation('at-c', 'presence', events[1].id, c.id, { locationRole: 'current' })]
    const result = diagnoseAtlasTravel([...places, person, ...events], edges)
    const issue = result.find(item => item.code === 'EVENT_TRAVEL_TIME_REVIEW')!
    expect(issue.entityIds).toContain(first.id)
    expect(issue.entityIds).toContain(second.id)
    expect(issue.message).toContain('5 小时')
    expect(diagnoseAtlasTravel([...places, person, ...events.map(event => ({ ...event, attributes: { ...event.attributes, timeOfDayMinutes: undefined } }))], edges).some(item => item.code === 'EVENT_TRAVEL_TIME_UNKNOWN')).toBe(true)
  })
})
