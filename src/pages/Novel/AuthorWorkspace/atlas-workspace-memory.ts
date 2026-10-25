import type { StoryAtlasEntityKind } from '../../../shared/story-atlas'
import { ATLAS_TABS, resolveWorldWorkspaceTab } from './atlas-profile'

export type AtlasWorkspaceMemory = { search: string; selected: Partial<Record<StoryAtlasEntityKind, string>> }
const fields = ['tab', 'entity', 'location', 'mapScope', 'mapView', 'atChapter', 'includePlanned', 'kind', 'view']
const key = (novelId: number) => `novelforge:atlas-workspace:${novelId}`

export function atlasWorkspaceSearch(params: URLSearchParams) {
  const kept = new URLSearchParams()
  for (const field of fields) if (params.has(field)) kept.set(field, params.get(field)!)
  return kept.toString()
}

export function readAtlasWorkspaceMemory(novelId: number): AtlasWorkspaceMemory {
  try {
    const value = JSON.parse(sessionStorage.getItem(key(novelId)) || '{}')
    const selected: AtlasWorkspaceMemory['selected'] = {}
    for (const kind of ['character', 'location', 'faction', 'item', 'event'] as const) {
      if (typeof value.selected?.[kind] === 'string' && value.selected[kind].startsWith(`${kind}:`)) selected[kind] = value.selected[kind]
    }
    return { search: typeof value.search === 'string' ? atlasWorkspaceSearch(new URLSearchParams(value.search)) : '', selected }
  } catch { return { search: '', selected: {} } }
}

export function writeAtlasWorkspaceMemory(novelId: number, memory: AtlasWorkspaceMemory) {
  try { sessionStorage.setItem(key(novelId), JSON.stringify(memory)) } catch { /* Navigation still works if browser storage is unavailable. */ }
}

/** Only restore on workspace entry. Explicit deep links, filters and Back remain authoritative. */
export function restoreAtlasWorkspaceEntry(params: URLSearchParams, memory: AtlasWorkspaceMemory) {
  if (!params.toString()) return new URLSearchParams(memory.search)
  const next = new URLSearchParams(params)
  if (!next.has('entity') && !next.has('atChapter') && !next.has('includePlanned') && !next.has('location') && !next.has('mapScope')) {
    const kind = ATLAS_TABS.find(item => item.key === resolveWorldWorkspaceTab(next))?.kind
    if (kind && memory.selected[kind]) next.set('entity', memory.selected[kind]!)
  }
  return next
}
