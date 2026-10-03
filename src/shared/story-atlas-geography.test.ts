import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasGeography } from './story-atlas'
import { atlasGeographicCoverage, atlasPolygonContainsPolygon, resolveAtlasGeography } from './story-atlas-geography'

const rectangle = (left = 0, top = 0, right = 100, bottom = 100) => [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }]
const location = (id: string, parentId: string | null, geography: StoryAtlasGeography): StoryAtlasEntity => ({ id, parentId, kind: 'location', name: id, summary: '', attributes: { geography }, status: 'confirmed', source: { kind: 'test' }, effectiveFromChapter: 0 })
const country = location('country', null, { boundary: rectangle(10, 20, 90, 80), mapFrame: { widthKm: 1000, heightKm: 600 } })
const region = location('region', 'country', { boundary: rectangle(0, 0, 50, 100) })
describe('atlas physical geography', () => {
  it('calculates areas from scale and carries the same physical frame into nested maps without writing attributes', () => {
    const city = location('city', 'region', { boundary: rectangle(10, 20, 20, 30) })
    const entities = [country, region, city]
    const before = JSON.stringify(entities)
    expect(resolveAtlasGeography(country, entities)).toMatchObject({ calculatedAreaKm2: 600000, frameSource: 'explicit', localBoundary: rectangle() })
    expect(resolveAtlasGeography(region, entities)).toMatchObject({ calculatedAreaKm2: 300000, frame: { widthKm: 500, heightKm: 600 }, frameSource: 'parent' })
    expect(resolveAtlasGeography(city, entities)).toMatchObject({ calculatedAreaKm2: 3000, frame: { widthKm: 50, heightKm: 60 } })
    expect(JSON.stringify(entities)).toBe(before)
  })
  it('does not derive area from legacy positions, declared area alone or an unscaled outline', () => {
    for (const geography of [{ position: { x: 5, y: 5 }, areaKm2: 900 }, { boundary: rectangle() }, { mapFrame: { widthKm: 10, heightKm: 20 } }]) {
      expect(resolveAtlasGeography(location('unknown', null, geography), []).calculatedAreaKm2).toBeUndefined()
    }
    expect(resolveAtlasGeography(location('known', 'unmapped-parent', { boundary: rectangle(), mapFrame: { widthKm: 10, heightKm: 20 } }), []).calculatedAreaKm2).toBe(200)
  })
  it('keeps declared area and explicit conflicting scale independent of calculated values', () => {
    const conflicting = location('region', 'country', { boundary: rectangle(0, 0, 50, 100), areaKm2: 150000, mapFrame: { widthKm: 300, heightKm: 600 } })
    expect(resolveAtlasGeography(conflicting, [country, conflicting])).toMatchObject({ declaredAreaKm2: 150000, calculatedAreaKm2: 300000, areaDifferenceRatio: 0.5, frameDifferenceRatio: 0.4, frame: { widthKm: 300, heightKm: 600 } })
    expect(atlasGeographicCoverage(conflicting, [country, conflicting]).unmappedAreaKm2).toBeUndefined()
  })
  it('detects an edge leaving a concave country even when all child vertices are inside or on its boundary', () => {
    const u = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 70 }, { x: 70, y: 70 }, { x: 70, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    expect(atlasPolygonContainsPolygon(u, rectangle(10, 10, 90, 90))).toBe(false)
    expect(atlasPolygonContainsPolygon(u, rectangle(0, 70, 100, 100))).toBe(true)
    expect(atlasPolygonContainsPolygon(u, u)).toBe(true)
  })
  it('counts only non-overlapping measured boundaries and leaves unpartitioned territory available', () => {
    expect(atlasGeographicCoverage(country, [country, region])).toMatchObject({ mappedAreaKm2: 300000, unmappedAreaKm2: 300000, counts: { children: 1, withBoundary: 1 } })
    const east = location('east', 'country', { boundary: rectangle(50, 0, 100, 100) })
    expect(atlasGeographicCoverage(country, [country, region, east])).toMatchObject({ mappedAreaKm2: 600000, unmappedAreaKm2: 0, overlapping: false })
    const overlapping = location('overlap', 'country', { boundary: rectangle(40, 0, 100, 100) })
    expect(atlasGeographicCoverage(country, [country, region, overlapping])).toMatchObject({ overlapping: true, mappedAreaKm2: undefined, unmappedAreaKm2: undefined })
  })
  it('does not count an absent outline as a rectangular country and terminates damaged ancestry', () => {
    const missing = location('country', null, { mapFrame: { widthKm: 1000, heightKm: 600 } })
    expect(atlasGeographicCoverage(missing, [missing, region])).toMatchObject({ mappedAreaKm2: 300000, unmappedAreaKm2: undefined })
    const cyclic = location('cycle', 'cycle', { boundary: rectangle() })
    expect(resolveAtlasGeography(cyclic, [cyclic]).calculatedAreaKm2).toBeUndefined()
  })
})
