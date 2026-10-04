import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasRelation } from './story-atlas'
import { atlasRouteStraightLineKm } from './story-atlas-geography'
import { diagnoseAtlasTravel } from './story-atlas-travel'

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
