import { describe, expect, it } from 'vitest'
import { findTravelRoute, validateCharacterMovement, relationTravelHours, type TravelRelation } from './map-travel.service'

function relation(overrides: Partial<TravelRelation> & { id: number; mapAId: number; mapBId: number }): TravelRelation {
  return {
    bilateral: 1,
    travelHours: null,
    travelMode: null,
    routeOpen: 1,
    ...overrides,
  }
}

const NAMES = new Map<number, string>([
  [1, '城镇'],
  [2, '山谷'],
  [3, '隘口'],
  [4, '孤岛'],
])

describe('relationTravelHours', () => {
  it('uses explicit travel hours when present', () => {
    expect(relationTravelHours(relation({ id: 1, mapAId: 1, mapBId: 2, travelHours: 6.5 }))).toBeCloseTo(6.5)
  })

  it('falls back to a conservative default so missing hours are not a teleport', () => {
    expect(relationTravelHours(relation({ id: 1, mapAId: 1, mapBId: 2 }))).toBe(24)
  })
})

describe('findTravelRoute', () => {
  const relations = [
    relation({ id: 1, mapAId: 1, mapBId: 2, travelHours: 5 }),
    relation({ id: 2, mapAId: 2, mapBId: 3, travelHours: 3 }),
    relation({ id: 3, mapAId: 3, mapBId: 4, travelHours: 2 }),
  ]

  it('returns same_location with zero hours for identical nodes', () => {
    const result = findTravelRoute(1, 1, relations)
    expect(result.reachable).toBe(true)
    expect(result.reason).toBe('same_location')
    expect(result.totalHours).toBe(0)
  })

  it('finds a direct route', () => {
    const result = findTravelRoute(1, 2, relations)
    expect(result.reachable).toBe(true)
    expect(result.reason).toBe('direct')
    expect(result.totalHours).toBeCloseTo(5)
    expect(result.steps).toHaveLength(1)
  })

  it('finds a multi-hop route and sums hours', () => {
    const result = findTravelRoute(1, 4, relations, { mapNames: NAMES })
    expect(result.reachable).toBe(true)
    expect(result.reason).toBe('path')
    expect(result.totalHours).toBeCloseTo(10)
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0].fromName).toBe('城镇')
    expect(result.steps[2].toName).toBe('孤岛')
  })

  it('prefers lower travel time over fewer hops', () => {
    const result = findTravelRoute(1, 4, [
      relation({ id: 1, mapAId: 1, mapBId: 4, travelHours: 24 }),
      relation({ id: 2, mapAId: 1, mapBId: 2, travelHours: 2 }),
      relation({ id: 3, mapAId: 2, mapBId: 3, travelHours: 2 }),
      relation({ id: 4, mapAId: 3, mapBId: 4, travelHours: 1 }),
    ])
    expect(result.reachable).toBe(true)
    expect(result.totalHours).toBe(5)
    expect(result.steps.map((step) => step.relationId)).toEqual([2, 3, 4])
  })

  it('reports no_route when the graph is disconnected', () => {
    // 节点 9 没有任何关系，与图不连通。
    const result = findTravelRoute(9, 1, relations)
    expect(result.reachable).toBe(false)
    expect(result.reason).toBe('no_route')
  })

  it('respects blocked route ids', () => {
    const result = findTravelRoute(1, 3, relations, { blockedRouteIds: [1] })
    expect(result.reachable).toBe(false)
    expect(result.reason).toBe('no_route')
  })

  it('skips closed routes (routeOpen = 0)', () => {
    const closed = relations.map((item) => (item.id === 2 ? { ...item, routeOpen: 0 } : item))
    const result = findTravelRoute(1, 4, closed)
    expect(result.reachable).toBe(false)
  })

  it('uses bilateral relations in both directions', () => {
    const result = findTravelRoute(2, 1, relations)
    expect(result.reachable).toBe(true)
    expect(result.reason).toBe('direct')
  })
})

describe('validateCharacterMovement', () => {
  const relations = [
    relation({ id: 1, mapAId: 1, mapBId: 2, travelHours: 8 }),
    relation({ id: 2, mapAId: 2, mapBId: 3, travelHours: 4 }),
  ]

  it('passes when time is sufficient', () => {
    const result = validateCharacterMovement({ fromMapId: 1, toMapId: 3, relations, availableHours: 20 })
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('reachable')
    expect(result.travelHours).toBeCloseTo(12)
  })

  it('fails closed on insufficient time', () => {
    const result = validateCharacterMovement({ fromMapId: 1, toMapId: 3, relations, availableHours: 10 })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('insufficient_time')
    expect(result.travelHours).toBeCloseTo(12)
  })

  it('treats an explicit zero-hour budget as insufficient', () => {
    const result = validateCharacterMovement({ fromMapId: 1, toMapId: 3, relations, availableHours: 0 })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('insufficient_time')
  })

  it('fails closed on teleport (no route)', () => {
    const result = validateCharacterMovement({ fromMapId: 1, toMapId: 4, relations })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no_route')
  })

  it('accepts same-location movement instantly', () => {
    const result = validateCharacterMovement({ fromMapId: 2, toMapId: 2, relations })
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('same_location')
  })

  it('checks only reachability when no time budget is given', () => {
    const reachable = validateCharacterMovement({ fromMapId: 1, toMapId: 3, relations })
    expect(reachable.ok).toBe(true)

    const disconnected = validateCharacterMovement({ fromMapId: 1, toMapId: 4, relations })
    expect(disconnected.ok).toBe(false)
    expect(disconnected.reason).toBe('no_route')
  })
})
