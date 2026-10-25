import { describe, expect, it } from 'vitest'
import { atlasWorkspaceSearch, restoreAtlasWorkspaceEntry } from './atlas-workspace-memory'

const memory = { search: 'tab=relationships&entity=character%3A80&includePlanned=true', selected: { character: 'character:80', faction: 'faction:6' } }
describe('atlas workspace entry memory', () => {
  it('restores the last view and isolated selected character after leaving the workspace', () => {
    const result = restoreAtlasWorkspaceEntry(new URLSearchParams(), memory)
    expect(result.get('tab')).toBe('relationships')
    expect(result.get('entity')).toBe('character:80')
    expect(restoreAtlasWorkspaceEntry(new URLSearchParams('tab=factions'), memory).get('entity')).toBe('faction:6')
  })
  it('respects explicit selection, empty selection, historical chapters and plan filters', () => {
    for (const search of ['tab=characters&entity=character%3A1', 'tab=characters&entity=', 'tab=characters&atChapter=6', 'tab=relationships&includePlanned=false', 'tab=map&mapScope=world']) {
      expect(restoreAtlasWorkspaceEntry(new URLSearchParams(search), memory).toString()).toBe(search)
    }
  })
  it('keeps unrelated route actions out of remembered views', () => {
    expect(atlasWorkspaceSearch(new URLSearchParams('tab=characters&action=delete&chapterId=999&entity=character%3A80'))).toBe('tab=characters&entity=character%3A80')
    expect(restoreAtlasWorkspaceEntry(new URLSearchParams(), { search: '', selected: {} }).toString()).toBe('')
  })
})
