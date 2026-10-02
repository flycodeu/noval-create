import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { locationCoordinates, locationPath, relatedEntities } from './atlas-presentation'
import { getAuthorWorkspaceKey } from '../../../shared/author-workspace'

const entity = (id: string, kind: StoryAtlasEntity['kind'], parentId: string | null = null): StoryAtlasEntity => ({ id, kind, parentId, name: id, summary: '', attributes: {}, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } })
describe('author atlas navigation', () => {
  it('keeps the region, town and scene hierarchy without inventing geometry', () => {
    const entities = [entity('location:1', 'location'), entity('location:2', 'location', 'location:1'), entity('location:3', 'location', 'location:2')]
    expect(locationPath(entities, 'location:3').map((item) => item.id)).toEqual(['location:1', 'location:2', 'location:3'])
    expect(locationPath(entities, 'location:missing')).toEqual([])
  })
  it('does not hang if an imported parent chain contains a cycle', () => {
    expect(locationPath([entity('a', 'location', 'b'), entity('b', 'location', 'a')], 'a')).toHaveLength(2)
  })
  it('preserves coordinate direction and leaves absent or invalid coordinates unplaced', () => {
    const west = { ...entity('west', 'location'), attributes: { x: -10, y: 0 } }
    const east = { ...entity('east', 'location'), attributes: { x: 10, y: 20 } }
    const invalid = { ...entity('invalid', 'location'), attributes: { x: Infinity, y: 0 } }
    const positions = locationCoordinates([west, east, invalid, entity('unknown', 'location')])
    expect(positions.size).toBe(2)
    expect(positions.get('west')!.x).toBeLessThan(positions.get('east')!.x)
    expect(positions.get('west')!.y).toBeLessThan(positions.get('east')!.y)
    expect(positions.has('unknown')).toBe(false)
  })
  it('falls back from identical default coordinates and separates partial duplicates', () => {
    const first = { ...entity('first', 'location'), attributes: { x: 0, y: 0 } }
    const second = { ...entity('second', 'location'), attributes: { x: 0, y: 0 } }
    expect(locationCoordinates([first, second]).size).toBe(0)
    const positions = locationCoordinates([first, second, { ...entity('third', 'location'), attributes: { x: 30, y: 30 } }])
    expect(positions.get('first')).not.toEqual(positions.get('second'))
  })
  it('shows people and events linked to descendant towns, excluding unlocated characters', () => {
    const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: 3, locationChildren: [], diagnostics: [], entities: [entity('region', 'location'), entity('town', 'location', 'region'), entity('hero', 'character'), entity('event', 'event'), entity('outsider', 'character')], relations: [
      { id: 'p', kind: 'presence', fromId: 'hero', toId: 'town', label: '', attributes: {}, status: 'confirmed', effectiveFromChapter: 1, source: { kind: 'test' } },
      { id: 'e', kind: 'participation', fromId: 'event', toId: 'town', label: '', attributes: {}, status: 'confirmed', effectiveFromChapter: 2, source: { kind: 'test' } },
    ] }
    expect(relatedEntities(snapshot, 'region').map((item) => item.id)).toEqual(['hero', 'event'])
    expect(relatedEntities(snapshot, 'missing')).toEqual([])
  })
  it('keeps chapter review routes in the manuscript workspace and entity pages in the atlas', () => {
    expect(getAuthorWorkspaceKey('/novels/292/writing/review?chapterId=3')).toBe('writing')
    expect(getAuthorWorkspaceKey('map')).toBe('narrative-board')
    expect(getAuthorWorkspaceKey('characters')).toBe('narrative-board')
    expect(getAuthorWorkspaceKey('quality')).toBe('revision')
  })
})
