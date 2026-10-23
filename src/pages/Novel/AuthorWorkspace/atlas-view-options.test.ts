import { describe, expect, it } from 'vitest'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasIncludesPlanned, atlasMapScope } from './atlas-view-options'

const snapshot: StoryAtlasSnapshot = { novelId: 1, contextVersion: 1, atChapter: 0, relations: [], locationChildren: [], diagnostics: [], entities: [
  { id: 'location:1', kind: 'location', name: '景朝', summary: '', parentId: null, attributes: { locationType: 'country' }, status: 'confirmed', effectiveFromChapter: 0, source: { kind: 'test' } },
] }

describe('atlas entry and navigation', () => {
  it('shows planned geography by default while preserving explicit choices and other tabs', () => {
    expect(atlasIncludesPlanned(new URLSearchParams(), true)).toBe(true)
    expect(atlasIncludesPlanned(new URLSearchParams(), false)).toBe(false)
    expect(atlasIncludesPlanned(new URLSearchParams('includePlanned=false'), true)).toBe(false)
    expect(atlasIncludesPlanned(new URLSearchParams('includePlanned=true'), false)).toBe(true)
  })
  it('enters a single country but permits returning to the world and following a deep link', () => {
    expect(atlasMapScope(new URLSearchParams(), snapshot, true)).toBe('location:1')
    expect(atlasMapScope(new URLSearchParams('mapScope=world'), snapshot, true)).toBeNull()
    expect(atlasMapScope(new URLSearchParams('location=location:2'), snapshot, true)).toBe('location:2')
    expect(atlasMapScope(new URLSearchParams(), snapshot, false)).toBeNull()
    expect(atlasMapScope(new URLSearchParams(), null, true)).toBeNull()
  })
})
