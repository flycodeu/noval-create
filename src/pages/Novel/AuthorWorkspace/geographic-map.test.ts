import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { GeographicAtlas } from './GeographicAtlas'
import { atlasGeography, geographicLayer, geographicSettlements, geographicDescendants, geographicLabelPositions, geographicDefaultScope, geographicPolities, geographicAppearance, geographicUnmappedAnchor, mapArea } from './geographic-map'

const entity = (id: string, parentId: string | null, attributes: Record<string, unknown> = {}): StoryAtlasEntity => ({ id, parentId, attributes, kind: 'location', name: id, summary: '', status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
const snapshot = (entities: StoryAtlasEntity[]): StoryAtlasSnapshot => ({ novelId: 1, contextVersion: 1, atChapter: 0, entities, relations: [], locationChildren: [], diagnostics: [] })
describe('geographic atlas display', () => {
  it('opens the single country interior while preserving multi-country choice', () => {
    const country = entity('country', null, { locationType: 'country' })
    const region = entity('region', 'country', { locationType: 'region' })
    expect(geographicDefaultScope(snapshot([country, region]))).toBe('country')
    expect(geographicDefaultScope(snapshot([region]))).toBeNull()
    expect(geographicDefaultScope(snapshot([country, entity('other-country', null, { nodeType: 'nation' })]))).toBeNull()
  })
  it('indexes a nested autonomous polity without changing its geographic parent or creating a second place', () => {
    const country = entity('景朝', null, { locationType: 'country' })
    const wetland = entity('芦荡', '景朝', { locationType: 'region' })
    const federation = entity('辖水', '芦荡', { locationType: 'territory', politicalStatus: { kind: 'autonomous_federation', shortName: '栖泽联国', label: '自治联国' } })
    const town = entity('商埠', '芦荡', { locationType: 'town', politicalStatus: { kind: 'trade_outpost' } })
    const atlas = snapshot([country, wetland, federation, town])
    expect(geographicPolities(atlas).map(polity => [polity.entity.id, polity.name, polity.label])).toEqual([['景朝', '景朝', '国家'], ['辖水', '栖泽联国', '自治联国']])
    expect(geographicDefaultScope(atlas)).toBeNull()
    expect(federation.parentId).toBe('芦荡')
  })
  it('offers unmeasured foreign polities without drawing a fictitious common world scale', () => {
    const country = entity('景朝', null, { locationType: 'country', geography: { mapFrame: { widthKm: 1100, heightKm: 850 }, boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] } })
    const foreign = entity('泊岬城盟', null, { locationType: 'country', politicalStatus: { kind: 'confederation', label: '城邦联盟' } })
    const atlas = snapshot([country, foreign])
    const markup = renderToStaticMarkup(createElement(GeographicAtlas, { snapshot: atlas, parentId: null, selectedId: null, onSelect: () => {}, onDrill: () => {}, onRelation: () => {}, onGenerate: () => {} }))
    expect(markup).toContain('国家与政体总览')
    expect(markup).toContain('泊岬城盟')
    expect(markup).toContain('城邦联盟')
    expect(markup).toContain('边界未测绘')
    expect(markup).not.toContain('geographic-canvas')
    expect(markup).not.toContain('1100')
    expect(geographicLayer(atlas, null).find(item => item.entity.id === foreign.id)?.center).toBeUndefined()
  })
  it('keeps direct polity navigation inside a nested territory and marks only the closest polity active', () => {
    const atlas = snapshot([
      entity('景朝', null, { locationType: 'country' }),
      entity('芦荡', '景朝', { locationType: 'region' }),
      entity('辖水', '芦荡', { locationType: 'territory', politicalStatus: { kind: 'autonomous_federation', shortName: '栖泽联国', label: '自治联国' } }),
    ])
    const markup = renderToStaticMarkup(createElement(GeographicAtlas, { snapshot: atlas, parentId: '辖水', selectedId: null, onSelect: () => {}, onDrill: () => {}, onRelation: () => {}, onGenerate: () => {} }))
    expect(markup).toContain('国家与政体索引')
    expect(markup).toContain('aria-current="page">栖泽联国')
    expect(markup).not.toContain('aria-current="page">景朝')
  })
  it('only derives terrain colours from saved terrain, never a suggestive place name', () => {
    const place = entity('place', null)
    const wetland = { ...place, attributes: { terrain: '低洼湖沼地区' } }
    expect(geographicAppearance(wetland).terrain).toBe('低洼湖沼地区')
    expect(geographicAppearance(wetland).color).not.toBe(geographicAppearance({ ...place, attributes: { terrain: '丘陵山地' } }).color)
    expect(geographicAppearance({ ...place, name: '黑沙漠', summary: '雪山边的一处旧地名。' })).toEqual(geographicAppearance(place))
  })
  it('uses the first stated terrain instead of a secondary landform later in the description', () => {
    const descriptions = ['西北高峻山地，低处有碎石坡', '西部丘陵与山麓缓坡', '东部低山与丘陵交错', '南部盆地，丘陵围合', '北部高台地；非荒漠', '冲积平地为主，河汊交织', '低洼湖沼，边缘有台地']
    const colors = descriptions.map(terrain => geographicAppearance(entity('same-id', null, { terrain })).color)
    expect(new Set(colors).size).toBe(descriptions.length)
    expect(geographicAppearance(entity('same-id', null, { terrain: '盆地' })).color).toBe(colors[3])
  })
  it('places unassigned territory labels outside child borders and omits fully divided maps', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    const west = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 100 }, { x: 0, y: 100 }]
    expect(geographicUnmappedAnchor(boundary, [west])!.x).toBeGreaterThan(60)
    expect(geographicUnmappedAnchor(boundary, [boundary])).toBeUndefined()
    expect(geographicUnmappedAnchor([], [west])).toBeUndefined()
  })
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
  it('projects towns through their own region extent, preserving local north and west', () => {
    const region = entity('west', 'country', { nodeType: 'region', geography: { boundary: [{ x: 10, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 80 }, { x: 10, y: 80 }] } })
    const city = entity('city', 'west', { nodeType: 'city', geography: { position: { x: 25, y: 50 } } })
    const legacy = entity('legacy-village', 'west', { nodeType: 'village', x: 15, y: 35 })
    const foreign = entity('foreign-town', 'elsewhere', { nodeType: 'town', geography: { position: { x: 25, y: 50 } } })
    expect(geographicSettlements(snapshot([region, city, legacy, foreign]), 'country')).toEqual([{ entity: city, center: { x: 20, y: 50 }, regionId: 'west' }])
  })
  it('renders a route between settlements in different regions on the country map', () => {
    const country = entity('country', null, { locationType: 'country' })
    const west = entity('west', 'country', { nodeType: 'region', geography: { boundary: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 }] } })
    const east = entity('east', 'country', { nodeType: 'region', geography: { boundary: [{ x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 50, y: 100 }] } })
    const from = entity('西镇', 'west', { nodeType: 'town', geography: { position: { x: 50, y: 50 } } })
    const to = entity('东镇', 'east', { nodeType: 'village', geography: { position: { x: 50, y: 50 } } })
    const atlas = snapshot([country, west, east, from, to])
    atlas.relations.push({ id: 'road', kind: 'route', fromId: from.id, toId: to.id, label: '东西驿道', attributes: {}, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
    const markup = renderToStaticMarkup(createElement(GeographicAtlas, { snapshot: atlas, parentId: 'country', selectedId: null, onSelect: () => {}, onDrill: () => {}, onRelation: () => {}, onGenerate: () => {} }))
    expect(markup).toContain('aria-label="查看通路：东西驿道"')
    expect(markup).toContain('x1="290" y1="350" x2="710" y2="350"')
    const localMarkup = renderToStaticMarkup(createElement(GeographicAtlas, { snapshot: atlas, parentId: 'west', selectedId: null, onSelect: () => {}, onDrill: () => {}, onRelation: () => {}, onGenerate: () => {} }))
    expect(localMarkup).not.toContain('aria-label="查看通路：东西驿道"')
  })
  it('does not draw a town in a concave region opening outside its territory', () => {
    const region = entity('horseshoe', null, { geography: { boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 70, y: 100 }, { x: 70, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 100 }, { x: 0, y: 100 }] } })
    const city = entity('outside', 'horseshoe', { nodeType: 'city', geography: { position: { x: 50, y: 70 } } })
    expect(geographicSettlements(snapshot([region, city]), null)).toEqual([])
  })
  it('retains the country-region-town hierarchy without requiring coordinates and stops at cycles', () => {
    const country = entity('country', 'town'), region = entity('region', 'country'), town = entity('town', 'region')
    expect(geographicDescendants(snapshot([country, region, town, entity('other', null)]), 'country').map(place => place.id)).toEqual(['region', 'town'])
    expect(geographicDescendants(snapshot([entity('country', null), region, town]), null).map(place => place.id)).toEqual(['country', 'region', 'town'])
  })
  it('keeps nearby text labels from piling over each other without moving markers', () => {
    const crowded = Array.from({ length: 16 }, () => ({ x: 50, y: 50, text: '临河城' }))
    const offsets = geographicLabelPositions(crowded)
    const rendered = offsets.filter(value => value !== undefined)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(crowded.length)
    expect(new Set(rendered.map(point => `${point!.x},${point!.y}`)).size).toBe(rendered.length)
    for (let index = 0; index < rendered.length; index++) for (let other = index + 1; other < rendered.length; other++) {
      expect(Math.abs(rendered[index]!.x - rendered[other]!.x) >= 58 || Math.abs(rendered[index]!.y - rendered[other]!.y) >= 22).toBe(true)
    }
  })
  it('keeps a region name clear of a town marker at the region centre', () => {
    const [offset] = geographicLabelPositions([{ x: 50, y: 50, text: '北岭州', primary: true }], [{ x: 50, y: 50 }])
    expect(offset).toBeDefined()
    expect(Math.abs(offset!.y)).toBeGreaterThan(26)
  })
  it('keeps nearby towns visible using horizontal labels and reserves major places before villages', () => {
    const labels = [
      { x: 520, y: 300, text: '乡村', hidden: true, priority: 1 },
      { x: 500, y: 310, text: '曲茅水乡', primary: true, priority: 4 },
      { x: 490, y: 300, text: '芦渡', priority: 2 },
      { x: 515, y: 305, text: '白茅镇', priority: 3 },
    ]
    const points = geographicLabelPositions(labels, labels.filter(label => !label.primary))
    expect(points[0]).toBeUndefined()
    expect(points.slice(1).every(Boolean)).toBe(true)
    expect(points.slice(2).some(point => point!.x !== 0)).toBe(true)
  })
})
