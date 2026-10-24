import { it, expect } from 'vitest'
import { relationshipPositions } from './atlas-relationship-layout'
import type { StoryAtlasEntity, StoryAtlasRelation } from '../../../shared/story-atlas'

it('keeps independent casts and isolated people without inventing hero links', () => {
  const entities = ['hero', 'partner', 'witness', 'neighbor', 'visitor', 'passerby'].map(id => ({ id } as StoryAtlasEntity))
  const relations = [
    { kind: 'relationship', fromId: 'hero', toId: 'partner' },
    { kind: 'relationship', fromId: 'witness', toId: 'neighbor' },
    { kind: 'participation', fromId: 'hero', toId: 'witness' },
    { kind: 'relationship', fromId: 'missing', toId: 'hero' },
  ] as StoryAtlasRelation[]
  const before = JSON.stringify({ entities, relations })
  const positions = relationshipPositions(entities, relations)
  expect(positions.size).toBe(6)
  expect(positions.get('hero')!.y).toBe(positions.get('partner')!.y)
  expect(positions.get('witness')!.y).toBeGreaterThan(positions.get('partner')!.y + 190)
  expect(positions.get('visitor')!.y).toBe(positions.get('passerby')!.y)
  expect(JSON.stringify({ entities, relations })).toBe(before)
})
