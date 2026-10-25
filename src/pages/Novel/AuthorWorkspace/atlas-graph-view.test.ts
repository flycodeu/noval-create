import { describe, expect, it } from 'vitest'
import type { StoryAtlasEntity, StoryAtlasRelation } from '../../../shared/story-atlas'
import { graphViewKey, readGraphView, selectRelationshipEntities, writeGraphView } from './atlas-graph-view'
import { relationshipPositions } from './atlas-relationship-layout'

const character = (id: string, role = 'supporting'): StoryAtlasEntity => ({ id, kind: 'character', name: id, summary: '', parentId: null, attributes: { authorPlanning: { castRole: role } }, status: 'planned', effectiveFromChapter: 7, source: { kind: 'test' } })
const relation = (fromId: string, toId: string, kind = 'relationship'): StoryAtlasRelation => ({ id: `${fromId}-${toId}`, kind: kind as StoryAtlasRelation['kind'], fromId, toId, label: '同行但互有顾虑', attributes: {}, status: 'planned', effectiveFromChapter: 7, source: { kind: 'test' } })

describe('relationship graph visibility and restoration', () => {
  it('keeps an isolated selected person beyond the first eighty visible, including under another role filter', () => {
    const entities = Array.from({ length: 100 }, (_, index) => character(`person-${index}`))
    const result = selectRelationshipEntities(entities, [], { selectedId: 'person-99', role: 'protagonist', focused: false, limit: 80 })
    expect(result.visible.map(entity => entity.id)).toEqual(['person-99'])
    const unfiltered = selectRelationshipEntities(entities, [], { selectedId: 'person-99', role: 'all', focused: false, limit: 80 })
    expect(unfiltered.visible).toHaveLength(80)
    expect(unfiltered.visible[0].id).toBe('person-99')
  })
  it('focuses only real incoming and outgoing contacts and keeps isolates as one-person graphs', () => {
    const entities = ['center', 'out', 'in', 'participant', 'alone'].map(id => character(id))
    const edges = [relation('center', 'out'), relation('in', 'center'), relation('center', 'participant', 'participation'), relation('center', 'missing')]
    const result = selectRelationshipEntities(entities, edges, { selectedId: 'center', role: 'all', focused: true, limit: 80 })
    expect(result.visible.map(entity => entity.id)).toEqual(['center', 'out', 'in'])
    expect(selectRelationshipEntities(entities, edges, { selectedId: 'alone', role: 'all', focused: true, limit: 80 }).visible.map(entity => entity.id)).toEqual(['alone'])
    const positions = relationshipPositions(result.visible, edges, 'center')
    expect(positions.get('out')!.x).toBeLessThan(positions.get('center')!.x)
    expect(positions.get('in')!.x).toBeGreaterThan(positions.get('center')!.x)
  })
  it('chooses a connected anchor without claiming a selection or adding edges', () => {
    const entities = ['alone', 'witness', 'neighbor'].map(id => character(id))
    const edges = [relation('witness', 'neighbor')]
    const before = JSON.stringify([entities, edges])
    const result = selectRelationshipEntities(entities, edges, { selectedId: null, role: 'all', focused: true, limit: 80 })
    expect(result.anchor?.id).toBe('witness')
    expect(result.visible.map(entity => entity.id)).toEqual(['witness', 'neighbor'])
    expect(JSON.stringify([entities, edges])).toBe(before)
  })
  it('restores viewport, dragged positions and filters across a fresh component; isolates novels and chapter scopes', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const key = graphViewKey(292, 'relationships', null, 'some-map-scope')
    const view = { keyword: '', role: 'companion' as const, focused: false, limit: 160, contactPage: 2, positions: { 'all:person': { x: 541, y: -92 } }, viewport: { x: -141, y: 82, zoom: .74 }, signature: 'visible-persons' }
    writeGraphView(key, view, storage)
    expect(readGraphView(graphViewKey(292, 'relationships', null, null), storage)).toEqual(view)
    expect(readGraphView(graphViewKey(293, 'relationships', null, null), storage).viewport).toBeUndefined()
    expect(readGraphView(graphViewKey(292, 'relationships', 7, null), storage).viewport).toBeUndefined()
  })
  it('survives unavailable or malformed storage without breaking the graph', () => {
    const invalid = { getItem: () => JSON.stringify({ role: 'unknown', positions: { broken: { x: '1', y: 2 }, valid: { x: 3, y: 4 } }, viewport: { x: 0, y: 0, zoom: -2 } }) }
    const restored = readGraphView('scope', invalid)
    expect(restored.role).toBe('all')
    expect(restored.positions).toEqual({ valid: { x: 3, y: 4 } })
    expect(restored.viewport).toBeUndefined()
    expect(() => writeGraphView('scope', restored, { setItem: () => { throw new Error('quota exceeded') } })).not.toThrow()
    expect(readGraphView('scope', { getItem: () => '{' }).focused).toBe(true)
  })
  it('pages a highly connected person without losing contacts or repeating the anchor', () => {
    const entities = Array.from({ length: 15 }, (_, index) => character(`person-${index}`))
    const edges = entities.slice(1).map(entity => relation('person-0', entity.id))
    const contacts = []
    for (let page = 0; page < 3; page++) {
      const result = selectRelationshipEntities(entities, edges, { selectedId: 'person-0', role: 'all', focused: true, limit: 7, contactPage: page })
      expect(result.contactPages).toBe(3)
      expect(result.visible[0].id).toBe('person-0')
      expect(result.visible.length).toBeLessThanOrEqual(7)
      contacts.push(...result.visible.slice(1).map(entity => entity.id))
    }
    expect(contacts).toEqual(entities.slice(1).map(entity => entity.id))
  })
})
