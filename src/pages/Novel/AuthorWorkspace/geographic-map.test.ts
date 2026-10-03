import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasGeography, geographicLayer, mapArea } from './geographic-map'

const entity = (id: string, parentId: string | null, attributes: Record<string, unknown> = {}): StoryAtlasEntity => ({ id, parentId, attributes, kind: 'location', name: id, summary: '', status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const snapshot = (entities: StoryAtlasEntity[]): StoryAtlasSnapshot => ({ novelId: 1, contextVersion: 1, atChapter: 0, entities, relations: [], locationChildren: [], diagnostics: [] })
describe('geographic atlas display', () => {
  it('uses saved boundaries and areas in the current parent only', () => {
    const west = entity('west', 'country', { geography: { boundary: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 25, y: 60 }], areaKm2: 8000, development: 'unexplored' } })
    const layer = geographicLayer(snapshot([west, entity('other', 'elsewhere')]), 'country')
    expect(layer).toHaveLength(1)
    expect(layer[0].center).toEqual({ x: 25, y: 100 / 3 })
    expect(layer[0].preview).toBe(false)
    expect(layer[0].geography.areaKm2).toBe(8000)
    expect(layer[0].geography.development).toBe('unexplored')
  })
  it('never infers borders or square kilometres from legacy layout coordinates', () => {
    const locations = [entity('west', null, { x: 10, y: 20 }), entity('east', null, { x: 50, y: 20 }), entity('unknown', null)]
    const layer = geographicLayer(snapshot(locations), null)
    expect(layer[0].center!.x).toBeLessThan(layer[1].center!.x)
    expect(layer[0].preview).toBe(true)
    expect(layer[0].geography.boundary).toEqual([])
    expect(layer[0].geography.areaKm2).toBeUndefined()
    expect(layer[2].center).toBeUndefined()
    expect(mapArea(undefined)).toBe('面积未设')
  })
  it('prefers an explicitly saved position and never renders corrupt coordinates', () => {
    const placed = entity('city', null, { x: 500, y: 500, geography: { position: { x: 30, y: 40 } } })
    expect(geographicLayer(snapshot([placed]), null)[0].center).toEqual({ x: 30, y: 40 })
    expect(atlasGeography(entity('bad', null, { geography: { position: { x: Infinity, y: 20 }, boundary: [{ x: -1, y: 10 }, { x: 50, y: 80 }, { x: 80, y: 40 }] } })).boundary).toEqual([])
  })
  it('keeps labels and route anchors inside concave regions instead of their gaps', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }]
    for (const points of [boundary, [...boundary].reverse()]) {
      const region = entity('horseshoe', null, { geography: { boundary: points } })
      const point = geographicLayer(snapshot([region]), null)[0].center!
      expect(point).toBeDefined()
      expect(point.x > 0 && point.x < 100 && point.y > 0 && point.y < 100).toBe(true)
      expect(point.y < 30 || point.x < 30 || point.x > 70).toBe(true)
    }
    const placed = entity('horseshoe', null, { geography: { boundary, position: { x: 15, y: 70 } } })
    expect(geographicLayer(snapshot([placed]), null)[0].center).toEqual({ x: 15, y: 70 })
  })
  it('omits a physical scale when saved frame dimensions are nonfinite or nonpositive', () => {
    for (const dimension of [Infinity, -Infinity, Number.NaN, 0, -1]) {
      expect(atlasGeography(entity('bad', null, { geography: { mapFrame: { widthKm: dimension, heightKm: 10 } } })).frame).toBeUndefined()
      expect(atlasGeography(entity('bad', null, { geography: { mapFrame: { widthKm: 10, heightKm: dimension } } })).frame).toBeUndefined()
    }
    expect(atlasGeography(entity('valid', null, { geography: { mapFrame: { widthKm: 40, heightKm: 20 } } })).frame).toEqual({ widthKm: 40, heightKm: 20 })
  })
})
