import type { StoryAtlasEntity, StoryAtlasGeography, StoryAtlasMapPoint } from './story-atlas'

type Point = StoryAtlasMapPoint
type Frame = NonNullable<StoryAtlasGeography['mapFrame']>
const epsilon = 1e-8
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const opposite = (a: number, b: number) => a > epsilon && b < -epsilon || a < -epsilon && b > epsilon
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false
  const point = value as Point
  return [point.x, point.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)
}
function onSegment(point: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, point)) < epsilon && point.x >= Math.min(a.x, b.x) - epsilon
    && point.x <= Math.max(a.x, b.x) + epsilon && point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon
}
export function atlasPolygonArea(points: readonly Point[]): number {
  return Math.abs(signedArea(points))
}
function signedArea(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0) / 2
}
export function atlasPolygonBounds(points: readonly Point[]) {
  if (points.length < 3) return undefined
  const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
  const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
  return maxX - minX > epsilon && maxY - minY > epsilon ? { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY } : undefined
}
export function atlasPolygonContainsPoint(polygon: readonly Point[], point: Point, includeBorder = true): boolean {
  let inside = false
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index], b = polygon[(index + 1) % polygon.length]
    if (onSegment(point, a, b)) return includeBorder
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
/** Check every edge interval, including excursions across the opening of a concave parent. */
export function atlasPolygonContainsPolygon(parent: readonly Point[], child: readonly Point[]): boolean {
  if (parent.length < 3 || child.length < 3 || !child.every(point => atlasPolygonContainsPoint(parent, point))) return false
  return child.every((a, index) => {
    const b = child[(index + 1) % child.length], dx = b.x - a.x, dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared < epsilon) return true
    const cuts = [0, 1]
    for (let other = 0; other < parent.length; other++) {
      const c = parent[other], d = parent[(other + 1) % parent.length]
      const ex = d.x - c.x, ey = d.y - c.y, determinant = dx * ey - dy * ex
      if (Math.abs(determinant) < epsilon) {
        if (Math.abs(cross(a, b, c)) < epsilon) for (const p of [c, d]) {
          const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
          if (t > 0 && t < 1) cuts.push(t)
        }
      } else {
        const t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / determinant
        const u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / determinant
        if (t > 0 && t < 1 && u >= -epsilon && u <= 1 + epsilon) cuts.push(t)
      }
    }
    cuts.sort((x, y) => x - y)
    return cuts.slice(1).every((end, i) => {
      const t = (cuts[i] + end) / 2
      return atlasPolygonContainsPoint(parent, { x: a.x + dx * t, y: a.y + dy * t })
    })
  })
}
/** Shared edges and corner contacts are allowed; only interior overlap counts. */
export function atlasBoundariesOverlap(first: readonly Point[], second: readonly Point[]): boolean {
  for (let index = 0; index < first.length; index++) {
    const a = first[index], b = first[(index + 1) % first.length]
    for (let other = 0; other < second.length; other++) {
      const c = second[other], d = second[(other + 1) % second.length]
      if (opposite(cross(a, b, c), cross(a, b, d)) && opposite(cross(c, d, a), cross(c, d, b))) return true
    }
  }
  const hasInterior = (polygon: readonly Point[], other: readonly Point[]) => {
    const orientation = Math.sign(signedArea(polygon))
    return polygon.some((point, index) => {
      if (atlasPolygonContainsPoint(other, point, false)) return true
      const next = polygon[(index + 1) % polygon.length], dx = next.x - point.x, dy = next.y - point.y, length = Math.hypot(dx, dy)
      if (!length) return false
      const probe = { x: (point.x + next.x) / 2 - orientation * dy / length * 0.00001, y: (point.y + next.y) / 2 + orientation * dx / length * 0.00001 }
      return atlasPolygonContainsPoint(polygon, probe, false) && atlasPolygonContainsPoint(other, probe, false)
    })
  }
  return hasInterior(first, second) || hasInterior(second, first)
}

export interface ResolvedAtlasGeography {
  boundary?: Point[]
  localBoundary?: Point[]
  position?: Point
  frame?: Frame
  frameSource?: 'explicit' | 'parent'
  declaredAreaKm2?: number
  calculatedAreaKm2?: number
  /** Relative difference; undefined when the two independent sources are unavailable. */
  areaDifferenceRatio?: number
  frameDifferenceRatio?: number
}

/** Geometry derives measurements for display/review only. It never writes a new canon field. */
export function resolveAtlasGeography(entity: StoryAtlasEntity | undefined, entities: readonly StoryAtlasEntity[]): ResolvedAtlasGeography {
  const byId = new Map(entities.map(item => [item.id, item]))
  const resolve = (item: StoryAtlasEntity | undefined, visited: Set<string>): ResolvedAtlasGeography => {
    if (!item || visited.has(item.id)) return {}
    visited.add(item.id)
    const raw = (item.attributes.geography || {}) as StoryAtlasGeography
    const boundary = Array.isArray(raw.boundary) && raw.boundary.length >= 3 && raw.boundary.every(validPoint) && atlasPolygonArea(raw.boundary) > epsilon ? raw.boundary : undefined
    const bounds = boundary && atlasPolygonBounds(boundary)
    const localBoundary = boundary && bounds ? boundary.map(p => ({ x: (p.x - bounds.minX) / bounds.width * 100, y: (p.y - bounds.minY) / bounds.height * 100 })) : undefined
    const parent = item.parentId ? resolve(byId.get(item.parentId), visited) : undefined
    const inheritedFrame = parent?.frame && bounds ? { widthKm: parent.frame.widthKm * bounds.width / 100, heightKm: parent.frame.heightKm * bounds.height / 100 } : undefined
    const explicitFrame = positive(raw.mapFrame?.widthKm) && positive(raw.mapFrame?.heightKm) && Number.isFinite(raw.mapFrame.widthKm * raw.mapFrame.heightKm) ? raw.mapFrame : undefined
    const frame = explicitFrame || inheritedFrame
    const declaredAreaKm2 = positive(raw.areaKm2) ? raw.areaKm2 : undefined
    const calculatedAreaKm2 = boundary && parent?.frame ? atlasPolygonArea(boundary) / 10000 * parent.frame.widthKm * parent.frame.heightKm
      : localBoundary && frame ? atlasPolygonArea(localBoundary) / 10000 * frame.widthKm * frame.heightKm : undefined
    return {
      boundary, localBoundary, position: validPoint(raw.position) ? raw.position : undefined, frame,
      frameSource: explicitFrame ? 'explicit' : inheritedFrame ? 'parent' : undefined,
      declaredAreaKm2, calculatedAreaKm2,
      areaDifferenceRatio: declaredAreaKm2 && calculatedAreaKm2 ? Math.abs(declaredAreaKm2 - calculatedAreaKm2) / calculatedAreaKm2 : undefined,
      frameDifferenceRatio: explicitFrame && inheritedFrame ? Math.max(Math.abs(explicitFrame.widthKm - inheritedFrame.widthKm) / inheritedFrame.widthKm, Math.abs(explicitFrame.heightKm - inheritedFrame.heightKm) / inheritedFrame.heightKm) : undefined,
    }
  }
  return resolve(entity, new Set())
}

export function atlasGeographicCoverage(parent: StoryAtlasEntity, entities: readonly StoryAtlasEntity[]) {
  const geometry = resolveAtlasGeography(parent, entities)
  const children = entities.filter(entity => entity.kind === 'location' && entity.parentId === parent.id)
  const regions = children.map(entity => ({ entity, geography: resolveAtlasGeography(entity, entities) })).filter(item => item.geography.boundary)
  const overlapping = regions.some((item, index) => regions.slice(index + 1).some(other => atlasBoundariesOverlap(item.geography.boundary!, other.geography.boundary!)))
  const outsideParent = Boolean(geometry.localBoundary && regions.some(item => !atlasPolygonContainsPolygon(geometry.localBoundary!, item.geography.boundary!)))
  const inconsistentScale = (geometry.frameDifferenceRatio || 0) > 0.05
  const measurable = Boolean(geometry.frame && !overlapping && !outsideParent && !inconsistentScale)
  const mappedAreaKm2 = measurable ? regions.reduce((sum, item) => sum + (item.geography.calculatedAreaKm2 || 0), 0) : undefined
  const totalAreaKm2 = geometry.localBoundary && geometry.frame ? atlasPolygonArea(geometry.localBoundary) / 10000 * geometry.frame.widthKm * geometry.frame.heightKm : undefined
  return {
    mappedAreaKm2,
    unmappedAreaKm2: mappedAreaKm2 !== undefined && totalAreaKm2 !== undefined ? Math.max(0, totalAreaKm2 - mappedAreaKm2) : undefined,
    overlapping, outsideParent, inconsistentScale,
    counts: { children: children.length, withBoundary: regions.length, withoutBoundary: children.length - regions.length },
  }
}
