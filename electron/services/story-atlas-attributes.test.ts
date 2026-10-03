import { describe, expect, it } from 'vitest'
import { atlasBoundariesOverlap, mergeAtlasAttributes, normalizeAtlasAttributePatch, validateAtlasGeography, validateAtlasPositions } from './story-atlas-attributes'

describe('story atlas attributes', () => {
  const rectangle = (left = 0, top = 0, right = 50, bottom = 50) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
  it('accepts bounded regional geometry and preserves omitted map settings during incremental generation', () => {
    const geography = { boundary: rectangle(), position: { x: 20, y: 20 }, areaKm2: 400, mapFrame: { widthKm: 30, heightKm: 20 }, development: 'outlined' }
    expect(validateAtlasGeography(geography)).toEqual(geography)
    const patch = normalizeAtlasAttributePatch('location', { geography: { boundary: rectangle(5, 5, 60, 60), development: 'detailed' } })
    expect(mergeAtlasAttributes({ geography }, patch)).toEqual({ geography: { ...geography, boundary: rectangle(5, 5, 60, 60), development: 'detailed' } })
    expect(mergeAtlasAttributes({ geography }, normalizeAtlasAttributePatch('location', { geography: null }, { geography }, 'replace'), 'replace')).toEqual({})
    expect(validateAtlasGeography(undefined)).toBeUndefined()
  })
  it('rejects invalid coordinates, physical measurements, crossed and degenerate borders', () => {
    for (const geography of [
      { position: { x: Number.NaN, y: 2 } }, { position: { x: Infinity, y: 2 } }, { position: { x: -1, y: 2 } }, { position: { x: 2, y: 101 } },
      { areaKm2: 0 }, { areaKm2: Infinity }, { mapFrame: { widthKm: 10, heightKm: 0 } }, { development: 'visited' },
      { boundary: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }] }, { boundary: [...rectangle(), { x: 0, y: 0 }] },
      { boundary: [{ x: 0, y: 0 }, { x: 60, y: 50 }, { x: 0, y: 50 }, { x: 50, y: 0 }] },
    ]) expect(() => validateAtlasGeography(geography)).toThrow()
  })
  it('requires a known area to fit its own map frame while allowing unknown or exactly matching area', () => {
    const mapFrame = { widthKm: 30, heightKm: 20 }
    expect(validateAtlasGeography({ mapFrame })).toEqual({ mapFrame })
    expect(validateAtlasGeography({ areaKm2: 600, mapFrame })).toEqual({ areaKm2: 600, mapFrame })
    expect(() => validateAtlasGeography({ areaKm2: 600.01, mapFrame })).toThrow('不能超过内部地图')
    const updated = mergeAtlasAttributes({ geography: { areaKm2: 600, mapFrame } }, normalizeAtlasAttributePatch('location', { geography: { mapFrame: { widthKm: 20, heightKm: 20 } } }))
    expect(() => validateAtlasGeography(updated.geography)).toThrow('不能超过内部地图')
  })
  it('diagnoses overlap and containment without treating shared borders or isolated corners as overlap', () => {
    expect(atlasBoundariesOverlap(rectangle(), rectangle(50, 0, 100, 50))).toBe(false)
    expect(atlasBoundariesOverlap(rectangle(), rectangle(50, 50, 100, 100))).toBe(false)
    expect(atlasBoundariesOverlap(rectangle(), rectangle(40, 20, 80, 70))).toBe(true)
    expect(atlasBoundariesOverlap(rectangle(), rectangle(10, 10, 20, 20))).toBe(true)
    expect(atlasBoundariesOverlap(rectangle(), rectangle().reverse())).toBe(true)
    expect(atlasBoundariesOverlap(rectangle(), rectangle(25, 0, 75, 50))).toBe(true)
  })
  it('does not turn empty drafts into character facts or overwrite saved traits', () => {
    const patch = normalizeAtlasAttributePatch('character', { personalityTraits: [], motivation: ' ', campFactionIds: [], dailyRoutine: '清点渡船和绳索' })
    expect(patch).toEqual({ dailyRoutine: '清点渡船和绳索' })
    expect(mergeAtlasAttributes({ personalityTraits: ['谨慎'], privateCanon: '保留' }, { ...patch, personalityTraits: ['克制'] })).toEqual({ personalityTraits: ['谨慎', '克制'], privateCanon: '保留', dailyRoutine: '清点渡船和绳索' })
  })
  it('validates known field types and routes geographic references through graph edges', () => {
    expect(() => normalizeAtlasAttributePatch('character', { personalityTraits: '沉稳' })).toThrow('属性结构')
    expect(() => normalizeAtlasAttributePatch('character', { homeLocationId: 'location:other-project' })).toThrow('presence')
    expect(() => normalizeAtlasAttributePatch('presence', { locationRole: 'headquarter-misspelled' })).toThrow('属性结构')
  })
  it('allows unchanged migrated references but rejects adding, changing or clearing them', () => {
    const current = { campFactionIds: [4], homeLocationId: 'location:old' }
    expect(normalizeAtlasAttributePatch('character', { ...current, occupation: '船工' }, current, 'replace')).toEqual({ occupation: '船工' })
    for (const mode of ['merge', 'replace'] as const) {
      for (const campFactionIds of [[5], [], null]) expect(() => normalizeAtlasAttributePatch('character', { campFactionIds }, current, mode)).toThrow('membership')
      expect(() => normalizeAtlasAttributePatch('character', { homeLocationId: 'location:new' }, current, mode)).toThrow('presence')
    }
  })
  it('replaces supplied fields and clears empty values without losing omitted facts or zero and false', () => {
    const current = { personalityTraits: ['谨慎', '克制'], occupation: '船工', goals: '守住渡口', age: 22, appearance: { hair: '黑', clothing: '旧衫' }, privateCanon: '保留' }
    const patch = normalizeAtlasAttributePatch('character', { personalityTraits: ['直言'], goals: ' ', age: null, appearance: { hair: '', clothing: '短衫', scars: [], count: 0, visible: false } }, current, 'replace')
    expect(mergeAtlasAttributes(current, patch, 'replace')).toEqual({ personalityTraits: ['直言'], occupation: '船工', appearance: { clothing: '短衫', count: 0, visible: false }, privateCanon: '保留' })
    expect(mergeAtlasAttributes(current, normalizeAtlasAttributePatch('character', { personalityTraits: [], appearance: {} }, current, 'replace'), 'replace')).toEqual({ occupation: '船工', goals: '守住渡口', age: 22, privateCanon: '保留' })
    expect(normalizeAtlasAttributePatch('character', { age: 0, alive: false }, {}, 'replace')).toEqual({ age: 0, alive: false })
    expect(() => normalizeAtlasAttributePatch('character', { personalityTraits: '直言' }, current, 'replace')).toThrow('属性结构')
  })
  it('updates one stable organization slot without dropping other slots or its responsibilities', () => {
    const current = { positions: [{ id: 'head', title: '掌事', status: 'established', responsibilities: '安排船期' }, { id: 'clerk', title: '账房', status: 'planned' }] }
    const patch = normalizeAtlasAttributePatch('faction', { positions: [{ id: 'head', requirements: '熟悉航道' }] })
    const next = mergeAtlasAttributes(current, patch)
    expect(validateAtlasPositions(next.positions)).toEqual([{ ...current.positions[0], requirements: '熟悉航道' }, current.positions[1]])
    expect(() => normalizeAtlasAttributePatch('faction', { positions: [{ id: 'head' }, { id: 'head' }] })).toThrow('重复')
  })
  it('rejects invented, cyclic, and not-yet-established reporting lines', () => {
    expect(() => validateAtlasPositions([{ id: 'unknown' }])).toThrow('名称和计划')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }])).toThrow('同一组织')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }, { id: 'b', title: '乙', status: 'established', reportsToPositionId: 'a' }])).toThrow('循环')
    expect(() => validateAtlasPositions([{ id: 'a', title: '甲', status: 'established', reportsToPositionId: 'b' }, { id: 'b', title: '乙', status: 'planned' }])).toThrow('尚未设立')
  })
})
