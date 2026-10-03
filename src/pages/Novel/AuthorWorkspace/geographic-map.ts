import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { recordOf } from './content-document'
import { locationCoordinates } from './atlas-presentation'
import { atlasPolygonContainsPoint, resolveAtlasGeography } from '../../../shared/story-atlas-geography'

export type MapPoint = { x: number; y: number }
export function atlasGeography(entity?: StoryAtlasEntity) {
  const value = recordOf(entity?.attributes.geography)
  const point = (raw: unknown): MapPoint | undefined => {
    const p = recordOf(raw)
    return typeof p.x === 'number' && Number.isFinite(p.x) && p.x >= 0 && p.x <= 100
      && typeof p.y === 'number' && Number.isFinite(p.y) && p.y >= 0 && p.y <= 100 ? { x: p.x, y: p.y } : undefined
  }
  const boundary = Array.isArray(value.boundary) ? value.boundary.map(point) : []
  const frame = recordOf(value.mapFrame)
  return {
    boundary: boundary.length >= 3 && boundary.every(Boolean) ? boundary as MapPoint[] : [],
    position: point(value.position),
    areaKm2: typeof value.areaKm2 === 'number' && Number.isFinite(value.areaKm2) && value.areaKm2 > 0 ? value.areaKm2 : undefined,
    development: ['detailed', 'outlined', 'unexplored'].includes(String(value.development)) ? String(value.development) : undefined,
    frame: typeof frame.widthKm === 'number' && typeof frame.heightKm === 'number' && Number.isFinite(frame.widthKm) && Number.isFinite(frame.heightKm) && frame.widthKm > 0 && frame.heightKm > 0 ? { widthKm: frame.widthKm, heightKm: frame.heightKm } : undefined,
  }
}
export const DEVELOPMENT_LABELS: Record<string, string> = { detailed: '已展开', outlined: '已有轮廓', unexplored: '待拓展' }
export function mapArea(area: number | undefined) { return area === undefined ? '面积未设' : `${area.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 平方公里` }

function insidePolygon(point: MapPoint, boundary: MapPoint[]): boolean {
  let inside = false
  for (let index = 0; index < boundary.length; index++) {
    const a = boundary[index], b = boundary[(index + 1) % boundary.length]
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)
    if (Math.abs(cross) < 1e-8 && point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x)
      && point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y)) return false
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** A concave region's vertex average may be in a neighbour. Scan interior spans before placing its label and route anchor. */
function polygonAnchor(boundary: MapPoint[]): MapPoint | undefined {
  if (!boundary.length) return undefined
  const average = { x: boundary.reduce((sum, point) => sum + point.x, 0) / boundary.length, y: boundary.reduce((sum, point) => sum + point.y, 0) / boundary.length }
  if (insidePolygon(average, boundary)) return average
  const levels = [...new Set(boundary.map(point => point.y))].sort((a, b) => a - b)
  let selected: MapPoint | undefined, widest = 0
  for (let row = 1; row < levels.length; row++) {
    const y = (levels[row - 1] + levels[row]) / 2
    const crossings: number[] = []
    for (let index = 0; index < boundary.length; index++) {
      const a = boundary[index], b = boundary[(index + 1) % boundary.length]
      if ((a.y > y) !== (b.y > y)) crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y))
    }
    crossings.sort((a, b) => a - b)
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const width = Math.min(crossings[index + 1] - crossings[index], levels[row] - levels[row - 1])
      const point = { x: (crossings[index] + crossings[index + 1]) / 2, y }
      if (width > widest && insidePolygon(point, boundary)) { selected = point; widest = width }
    }
  }
  return selected
}

/** Saved local geometry uses 0..100 coordinates. Legacy layout coordinates stay a visibly separate preview. */
export function geographicLayer(snapshot: StoryAtlasSnapshot, parentId: string | null) {
  const locations = snapshot.entities.filter(entity => entity.kind === 'location' && entity.parentId === parentId)
  const legacy = locationCoordinates(locations)
  const points = [...legacy.values()]
  const maxX = Math.max(1, ...points.map(p => p.x)), maxY = Math.max(1, ...points.map(p => p.y))
  return locations.map(entity => {
    const geography = atlasGeography(entity)
    const boundary = geography.boundary
    const centroid = polygonAnchor(boundary)
    const old = legacy.get(entity.id)
    const preview = !geography.position && !centroid && old ? points.length === 1 ? { x: 50, y: 50 } : { x: 15 + old.x / maxX * 70, y: 15 + old.y / maxY * 70 } : undefined
    return { entity, geography, metrics: resolveAtlasGeography(entity, snapshot.entities), center: geography.position || centroid || preview, preview: Boolean(preview) }
  })
}

export function locationCategory(entity: StoryAtlasEntity): 'country' | 'region' | 'settlement' | 'site' {
  const type = String(entity.attributes.nodeType || entity.attributes.locationType || '')
  if (['country', 'nation', 'kingdom', 'empire'].includes(type)) return 'country'
  if (['region', 'province', 'state', 'prefecture', 'district', 'continent'].includes(type)) return 'region'
  if (['city', 'town', 'village', 'settlement', 'capital'].includes(type)) return 'settlement'
  return 'site'
}

/** Descendant information remains visible even when older records have no cartographic geometry. */
export function geographicDescendants(snapshot: StoryAtlasSnapshot, parentId: string | null) {
  const result: StoryAtlasEntity[] = []
  const seen = new Set<string>(parentId ? [parentId] : [])
  const queue: Array<string | null> = [parentId]
  while (queue.length) {
    const id = queue.shift()
    for (const entity of snapshot.entities) if (entity.kind === 'location' && entity.parentId === id && !seen.has(entity.id)) {
      result.push(entity); seen.add(entity.id); queue.push(entity.id)
    }
  }
  return result
}

/** Draw a child's saved local position in its parent's boundary extent. No legacy schematic positions participate. */
export function geographicSettlements(snapshot: StoryAtlasSnapshot, parentId: string | null) {
  const result: Array<{ entity: StoryAtlasEntity; center: MapPoint; regionId: string }> = []
  for (const region of geographicLayer(snapshot, parentId)) {
    const boundary = region.geography.boundary
    if (!boundary.length) continue
    const minX = Math.min(...boundary.map(p => p.x)), maxX = Math.max(...boundary.map(p => p.x))
    const minY = Math.min(...boundary.map(p => p.y)), maxY = Math.max(...boundary.map(p => p.y))
    for (const child of geographicLayer(snapshot, region.entity.id)) {
      if (locationCategory(child.entity) !== 'settlement' || child.preview || !child.center) continue
      const center = { x: minX + child.center.x / 100 * (maxX - minX), y: minY + child.center.y / 100 * (maxY - minY) }
      if (atlasPolygonContainsPoint(boundary, center)) result.push({ entity: child.entity, center, regionId: region.entity.id })
    }
  }
  return result
}

export type MapLabel = { x: number; y: number; text: string; primary?: boolean; scale?: number }
/** Preserve marker positions while choosing a nearby readable label; crowded labels remain in the place index. */
export function geographicLabelPositions(labels: MapLabel[], markers: MapPoint[] = []) {
  const occupied = markers.map(point => ({ left: point.x - 10, right: point.x + 10, top: point.y - 10, bottom: point.y + 10 }))
  return labels.map(label => {
    const scale = label.scale || 1
    const width = Math.max(34, label.text.length * (label.primary ? 22 : 15)) * scale, height = (label.primary ? 46 : 22) * scale
    for (const rawOffset of label.primary ? [0, -26, 26, -52, 52] : [-16, 27, -36, 47]) {
      const offset = rawOffset * scale
      const box = { left: label.x - width / 2 - 5, right: label.x + width / 2 + 5, top: label.y + offset - 18 * scale, bottom: label.y + offset - 18 * scale + height }
      if (occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) continue
      occupied.push(box)
      return offset
    }
    return undefined
  })
}
