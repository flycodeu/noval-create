import type { StoryAtlasEntity, StoryAtlasRelation } from '../../../shared/story-atlas'
import { CAST_ROLES, characterCastRole, type CastRole } from '../../../shared/cast-role'
import { relationshipNeighbors } from './atlas-relationship-layout'

export interface AtlasGraphView {
  keyword: string
  role: CastRole | 'all'
  focused: boolean
  limit: number
  contactPage: number
  positions: Record<string, { x: number; y: number }>
  viewport?: { x: number; y: number; zoom: number }
  signature?: string
}

export function graphViewKey(novelId: number, mode: 'map' | 'relationships', atChapter: number | null, parentId: string | null) {
  return `novelforge:atlas-graph:v2:${novelId}:${mode}:${atChapter ?? 'all'}:${mode === 'map' ? parentId ?? 'world' : 'cast'}`
}

export function readGraphView(key: string, storage?: Pick<Storage, 'getItem'>): AtlasGraphView {
  const fallback: AtlasGraphView = { keyword: '', role: 'all', focused: true, limit: 80, contactPage: 0, positions: {} }
  try {
    const parsed = JSON.parse(storage?.getItem(key) || 'null')
    if (!parsed || typeof parsed !== 'object') return fallback
    const positions = Object.fromEntries(Object.entries(parsed.positions || {}).filter((entry): entry is [string, { x: number; y: number }] => {
      const point = entry[1] as { x?: number; y?: number } | null
      return point != null && Number.isFinite(point.x) && Number.isFinite(point.y)
    }))
    const viewport = parsed.viewport && [parsed.viewport.x, parsed.viewport.y, parsed.viewport.zoom].every(Number.isFinite) && parsed.viewport.zoom >= .1 && parsed.viewport.zoom <= 2 ? parsed.viewport : undefined
    return { ...fallback, keyword: typeof parsed.keyword === 'string' ? parsed.keyword : '', role: ['all', ...CAST_ROLES.map(role => role.value)].includes(parsed.role) ? parsed.role : 'all', focused: parsed.focused !== false, limit: Number.isInteger(parsed.limit) && parsed.limit >= 80 ? Math.min(parsed.limit, 2000) : 80, contactPage: Number.isInteger(parsed.contactPage) && parsed.contactPage >= 0 ? parsed.contactPage : 0, positions, viewport, signature: typeof parsed.signature === 'string' ? parsed.signature : undefined }
  } catch { return fallback }
}

export function writeGraphView(key: string, view: AtlasGraphView, storage?: Pick<Storage, 'setItem'>) {
  try { storage?.setItem(key, JSON.stringify(view)) } catch { /* A restricted/full browser store must not prevent using the graph. */ }
}

export function selectRelationshipEntities(entities: StoryAtlasEntity[], relations: StoryAtlasRelation[], options: { selectedId: string | null; role: CastRole | 'all'; focused: boolean; limit: number; contactPage?: number }) {
  const characters = entities.filter(entity => entity.kind === 'character')
  const neighbors = relationshipNeighbors(characters, relations)
  const selected = characters.find(entity => entity.id === options.selectedId)
  const anchor = selected || [...characters].sort((a, b) => neighbors.get(b.id)!.size - neighbors.get(a.id)!.size)[0]
  const candidates = options.focused && anchor
    ? characters.filter(entity => entity.id === anchor.id || neighbors.get(anchor.id)!.has(entity.id))
    : characters.filter(entity => options.role === 'all' || characterCastRole(entity.attributes) === options.role)
  const pinned = selected || (options.focused ? anchor : undefined)
  // A selected person is reachable even beyond the first page or outside the role filter.
  const contacts = candidates.filter(entity => entity.id !== pinned?.id)
  const pageSize = Math.max(1, options.limit - 1)
  const contactPages = Math.max(1, Math.ceil(contacts.length / pageSize))
  const contactPage = Math.min(options.contactPage || 0, contactPages - 1)
  const visible = options.focused && pinned
    ? [pinned, ...contacts.slice(contactPage * pageSize, (contactPage + 1) * pageSize)]
    : pinned ? [pinned, ...contacts].slice(0, options.limit) : candidates.slice(0, options.limit)
  return { characters, anchor, candidates, visible, neighbors, contactPage, contactPages }
}
