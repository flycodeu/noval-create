import type { MapRelation, WorldMapItem } from '../../../types'

export interface AtlasTerritory {
  item: WorldMapItem
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  points: string
  descendantIds: Set<number>
}

export interface AtlasRouteLink {
  id: string
  relationIds: number[]
  source: AtlasTerritory
  target: AtlasTerritory
  label?: string
  closed: boolean
}

const TERRITORY_WIDTH = 320
const TERRITORY_HEIGHT = 236
const COLUMN_STEP = 378
const ROW_STEP = 292
const MAP_PADDING = 72

const SHAPE_PATTERNS: Array<Array<[number, number]>> = [
  [[10, 5], [64, 1], [94, 18], [98, 57], [82, 91], [39, 99], [6, 78], [1, 34]],
  [[18, 1], [72, 7], [99, 31], [90, 76], [62, 98], [14, 91], [1, 55], [5, 19]],
  [[8, 16], [43, 1], [88, 8], [99, 45], [87, 88], [48, 97], [9, 84], [1, 42]],
  [[16, 4], [59, 2], [96, 24], [99, 68], [69, 98], [25, 91], [2, 69], [4, 25]],
  [[7, 7], [47, 1], [91, 15], [99, 52], [78, 94], [34, 98], [1, 73], [3, 30]],
]

function collectDescendantIds(node: WorldMapItem): Set<number> {
  const ids = new Set<number>([node.id])
  const visit = (items: WorldMapItem[]) => items.forEach((item) => {
    ids.add(item.id)
    visit(item.children || [])
  })
  visit(node.children || [])
  return ids
}

function territoryPoints(x: number, y: number, width: number, height: number, seed: number): string {
  const pattern = SHAPE_PATTERNS[Math.abs(seed) % SHAPE_PATTERNS.length]
  return pattern.map(([px, py]) => `${Math.round(x + width * px / 100)},${Math.round(y + height * py / 100)}`).join(' ')
}

export function buildAtlasTerritories(nodes: WorldMapItem[]): {
  territories: AtlasTerritory[]
  width: number
  height: number
} {
  const ordered = [...nodes].sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
  if (ordered.length === 0) return { territories: [], width: 960, height: 600 }

  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ordered.length * 1.15))))
  const territories = ordered.map((item, index) => {
    const row = Math.floor(index / columns)
    const column = index % columns
    const x = MAP_PADDING + column * COLUMN_STEP + (row % 2 ? Math.round(COLUMN_STEP / 2) : 0)
    const y = MAP_PADDING + row * ROW_STEP
    return {
      item,
      x,
      y,
      width: TERRITORY_WIDTH,
      height: TERRITORY_HEIGHT,
      centerX: x + TERRITORY_WIDTH / 2,
      centerY: y + TERRITORY_HEIGHT / 2,
      points: territoryPoints(x, y, TERRITORY_WIDTH, TERRITORY_HEIGHT, item.id),
      descendantIds: collectDescendantIds(item),
    }
  })
  const width = Math.max(960, ...territories.map((territory) => territory.x + territory.width + MAP_PADDING))
  const height = Math.max(600, ...territories.map((territory) => territory.y + territory.height + MAP_PADDING))
  return { territories, width, height }
}

export function findAtlasTerritoryForNode(territories: AtlasTerritory[], mapNodeId: number): AtlasTerritory | undefined {
  return territories.find((territory) => territory.descendantIds.has(mapNodeId))
}

export function buildAtlasRouteLinks(territories: AtlasTerritory[], relations: MapRelation[]): AtlasRouteLink[] {
  const links = new Map<string, AtlasRouteLink>()
  relations.forEach((relation) => {
    const source = findAtlasTerritoryForNode(territories, relation.mapAId)
    const target = findAtlasTerritoryForNode(territories, relation.mapBId)
    if (!source || !target || source.item.id === target.item.id) return
    const pair = [source.item.id, target.item.id].sort((left, right) => left - right)
    const key = `${pair[0]}:${pair[1]}`
    const existing = links.get(key)
    if (existing) {
      existing.relationIds.push(relation.id)
      existing.closed = existing.closed && relation.routeOpen === 0
      if (!existing.label) existing.label = relation.relationLabel || relation.relationType || relation.travelMode || undefined
      return
    }
    links.set(key, {
      id: `atlas-route-${key}`,
      relationIds: [relation.id],
      source,
      target,
      label: relation.relationLabel || relation.relationType || relation.travelMode || undefined,
      closed: relation.routeOpen === 0,
    })
  })
  return [...links.values()]
}
