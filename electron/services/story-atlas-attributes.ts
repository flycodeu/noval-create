import { formatUserFacingMessage } from '../../src/shared/user-facing-messages'
import { isDeepStrictEqual } from 'node:util'
import { STORY_ATLAS_ATTRIBUTE_SCHEMAS, type StoryAtlasAttributeMode, type StoryAtlasEntityKind, type StoryAtlasGeography, type StoryAtlasMapPoint, type StoryAtlasPosition, type StoryAtlasRelationKind } from '../../src/shared/story-atlas'
import { validateJsonSchema } from '../../src/shared/tool-contracts'
export { atlasBoundariesOverlap } from '../../src/shared/story-atlas-geography'

export function meaningfulAtlasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return Boolean(value.trim())
  if (typeof value === 'object') return Object.values(value).some(meaningfulAtlasValue)
  return true
}

const referenceAttributes = new Set(['campFactionIds', 'birthLocationId', 'homeLocationId', 'activityLocationIds', 'headquartersLocationId', 'baseLocationIds', 'territoryLocationIds'])

function replacementValue(value: unknown): unknown {
  if (!meaningfulAtlasValue(value)) return null
  if (Array.isArray(value)) return value.map(replacementValue).filter(item => item !== null)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, replacementValue(item)]).filter(([, item]) => item !== null))
  return value
}

export function normalizeAtlasAttributePatch(kind: StoryAtlasEntityKind | StoryAtlasRelationKind, raw: Record<string, unknown> = {}, current: Record<string, unknown> = {}, mode: StoryAtlasAttributeMode = 'merge'): Record<string, unknown> {
  if (raw.stateTiming !== undefined && !['chapter_start', 'chapter_end'].includes(String(raw.stateTiming))) throw new Error(formatUserFacingMessage('services.atlas.stateTimingInvalid'))
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (referenceAttributes.has(key)) {
      // Old native snapshots contain these references. Echoing them is harmless, but all changes must use validated graph edges.
      if (isDeepStrictEqual(value, current[key]) || !meaningfulAtlasValue(value) && !meaningfulAtlasValue(current[key])) continue
      throw new Error(formatUserFacingMessage('services.atlas.unvalidatedReference', { key: `${key}` }))
    }
    if (mode === 'replace') patch[key] = replacementValue(value)
    else if (meaningfulAtlasValue(value)) patch[key] = value
  }
  const schema = STORY_ATLAS_ATTRIBUTE_SCHEMAS[kind]
  if (schema) {
    const result = validateJsonSchema(Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)), schema)
    if (!result.valid) throw new Error(formatUserFacingMessage('services.atlas.structureInvalid', { kind: `${kind}`, issues: `${result.issues.join('；')}` }))
  }
  if (kind === 'faction' && Array.isArray(patch.positions)) {
    const ids = patch.positions.map(position => (position as StoryAtlasPosition).id)
    if (new Set(ids).size !== ids.length) throw new Error(formatUserFacingMessage('services.atlas.duplicatePositionPatches'))
  }
  if (kind === 'location' && patch.geography) validateAtlasGeography(patch.geography)
  return patch
}

/** Merge preserves empty fields and adds list entries; replace changes only supplied top-level fields. */
export function mergeAtlasAttributes(current: Record<string, unknown> = {}, patch: Record<string, unknown>, mode: StoryAtlasAttributeMode = 'merge'): Record<string, unknown> {
  const next = { ...current, ...patch }
  if (mode === 'replace') {
    for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key]
    return next
  }
  if (patch.geography && typeof patch.geography === 'object' && !Array.isArray(patch.geography)) {
    // Geometry is one coherent drawing; a new boundary replaces all points while omitted geography fields survive.
    next.geography = { ...(current.geography as StoryAtlasGeography | undefined), ...patch.geography }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!Array.isArray(value)) continue
    const previous = Array.isArray(current[key]) ? current[key] as unknown[] : []
    if (value.every(item => typeof item === 'string')) next[key] = [...new Set([...previous, ...value])]
    else if (key === 'positions') {
      const positions = new Map((previous as StoryAtlasPosition[]).map(position => [position.id, position]))
      for (const position of value as StoryAtlasPosition[]) positions.set(position.id, { ...positions.get(position.id), ...position })
      next[key] = [...positions.values()]
    }
  }
  return next
}

const geometryEpsilon = 1e-8
const cross = (a: StoryAtlasMapPoint, b: StoryAtlasMapPoint, c: StoryAtlasMapPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
function onSegment(point: StoryAtlasMapPoint, a: StoryAtlasMapPoint, b: StoryAtlasMapPoint): boolean {
  return Math.abs(cross(a, b, point)) < geometryEpsilon && point.x >= Math.min(a.x, b.x) - geometryEpsilon
    && point.x <= Math.max(a.x, b.x) + geometryEpsilon && point.y >= Math.min(a.y, b.y) - geometryEpsilon && point.y <= Math.max(a.y, b.y) + geometryEpsilon
}
function segmentsCross(a: StoryAtlasMapPoint, b: StoryAtlasMapPoint, c: StoryAtlasMapPoint, d: StoryAtlasMapPoint, includeTouch: boolean): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > geometryEpsilon && abD < -geometryEpsilon) || (abC < -geometryEpsilon && abD > geometryEpsilon))
    && ((cdA > geometryEpsilon && cdB < -geometryEpsilon) || (cdA < -geometryEpsilon && cdB > geometryEpsilon))) return true
  return includeTouch && (onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d))
}
function polygonAreaTwice(points: StoryAtlasMapPoint[]): number {
  return points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]; return sum + point.x * next.y - next.x * point.y }, 0)
}

/** Reject corrupt geometry before it enters the revision store. Coordinates have no implied physical scale. */
export function validateAtlasGeography(raw: unknown): StoryAtlasGeography | undefined {
  if (raw === undefined) return undefined
  const result = validateJsonSchema({ geography: raw }, STORY_ATLAS_ATTRIBUTE_SCHEMAS.location!)
  if (!result.valid) throw new Error(formatUserFacingMessage('services.atlas.mapGeographyInvalid', { issues: `${result.issues.join('；')}` }))
  const geography = raw as StoryAtlasGeography
  for (const value of [geography.areaKm2, geography.mapFrame?.widthKm, geography.mapFrame?.heightKm]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(formatUserFacingMessage('services.atlas.areaScaleInvalid'))
  }
  if (geography.mapFrame && !Number.isFinite(geography.mapFrame.widthKm * geography.mapFrame.heightKm)) throw new Error(formatUserFacingMessage('services.atlas.scaleOutOfRange'))
  if (geography.areaKm2 && geography.mapFrame && geography.areaKm2 > geography.mapFrame.widthKm * geography.mapFrame.heightKm) {
    throw new Error(formatUserFacingMessage('services.atlas.areaExceedsBounds'))
  }
  for (const point of [...(geography.boundary || []), ...(geography.position ? [geography.position] : [])]) {
    if (![point.x, point.y].every(value => Number.isFinite(value) && value >= 0 && value <= 100)) throw new Error(formatUserFacingMessage('services.atlas.coordinatesInvalid'))
  }
  const points = geography.boundary
  if (!points) return geography
  if (new Set(points.map(point => `${point.x},${point.y}`)).size !== points.length) throw new Error(formatUserFacingMessage('services.atlas.duplicateBoundaryPoints'))
  if (Math.abs(polygonAreaTwice(points)) < geometryEpsilon) throw new Error(formatUserFacingMessage('services.atlas.boundaryAreaEmpty'))
  for (let index = 0; index < points.length; index++) {
    const a = points[index], b = points[(index + 1) % points.length], previous = points[(index + points.length - 1) % points.length]
    if (Math.abs(cross(previous, a, b)) < geometryEpsilon && (onSegment(b, previous, a) || onSegment(previous, a, b))) throw new Error(formatUserFacingMessage('services.atlas.boundaryEdgesOverlap'))
    for (let other = index + 1; other < points.length; other++) {
      if (other === index + 1 || index === 0 && other === points.length - 1) continue
      if (segmentsCross(a, b, points[other], points[(other + 1) % points.length], true)) throw new Error(formatUserFacingMessage('services.atlas.boundarySelfIntersection'))
    }
  }
  return geography
}

export function validateAtlasPositions(raw: unknown): StoryAtlasPosition[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new Error(formatUserFacingMessage('services.atlas.positionsArrayRequired'))
  const positions = raw as StoryAtlasPosition[]
  const ids = new Set<string>()
  for (const position of positions) {
    if (!position.id?.trim() || ids.has(position.id)) throw new Error(formatUserFacingMessage('services.atlas.positionIdInvalid'))
    if (!position.title?.trim() || !['planned', 'established'].includes(position.status)) throw new Error(formatUserFacingMessage('services.atlas.positionIdentityMissing'))
    ids.add(position.id)
  }
  const byId = new Map(positions.map(position => [position.id, position]))
  for (const position of positions) {
    let parentId = position.reportsToPositionId
    const seen = new Set([position.id])
    while (parentId) {
      const parent = byId.get(parentId)
      if (!parent) throw new Error(formatUserFacingMessage('services.atlas.parentPositionWrongOrganization'))
      if (seen.has(parentId)) throw new Error(formatUserFacingMessage('services.atlas.positionHierarchyCycle'))
      if (position.status === 'established' && parent.status === 'planned') throw new Error(formatUserFacingMessage('services.atlas.parentPositionNotEstablished'))
      seen.add(parentId)
      parentId = parent.reportsToPositionId
    }
  }
  return positions
}
