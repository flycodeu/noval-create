import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { geographicDefaultScope } from './geographic-map'

export function atlasIncludesPlanned(params: URLSearchParams, map: boolean): boolean {
  return params.has('includePlanned') ? params.get('includePlanned') === 'true' : map
}

export function atlasMapScope(params: URLSearchParams, snapshot: StoryAtlasSnapshot | null, geographic: boolean): string | null {
  const explicit = params.get('location')
  if (explicit) return explicit
  if (!geographic || !snapshot || params.get('mapScope') === 'world') return null
  return geographicDefaultScope(snapshot)
}
