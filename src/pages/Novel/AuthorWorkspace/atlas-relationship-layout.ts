import type { StoryAtlasEntity, StoryAtlasRelation } from '../../../shared/story-atlas'

export function relationshipNeighbors(entities: StoryAtlasEntity[], relations: StoryAtlasRelation[]) {
  const neighbors = new Map(entities.map(entity => [entity.id, new Set<string>()]))
  for (const relation of relations) {
    if (relation.kind !== 'relationship' || relation.fromId === relation.toId || !neighbors.has(relation.fromId) || !neighbors.has(relation.toId)) continue
    neighbors.get(relation.fromId)!.add(relation.toId)
    neighbors.get(relation.toId)!.add(relation.fromId)
  }
  return neighbors
}

/** A centered personal network; overview packs independent casts without inventing links. */
export function relationshipPositions(entities: StoryAtlasEntity[], relations: StoryAtlasRelation[], focusId?: string | null) {
  const neighbors = relationshipNeighbors(entities, relations)
  const positions = new Map<string, { x: number; y: number }>()
  if (focusId && neighbors.has(focusId)) {
    const others = entities.filter(entity => entity.id !== focusId)
    const rows = Math.ceil(others.length / 2)
    positions.set(focusId, { x: 340, y: Math.max(0, (rows - 1) * 72) })
    others.forEach((entity, index) => positions.set(entity.id, { x: index % 2 === 0 ? 0 : 680, y: Math.floor(index / 2) * 144 }))
    return positions
  }
  const seen = new Set<string>()
  const groups: string[][] = []
  const ordered = [...entities].sort((a, b) => neighbors.get(b.id)!.size - neighbors.get(a.id)!.size || a.id.localeCompare(b.id))
  for (const entity of ordered) {
    if (seen.has(entity.id)) continue
    const group = [entity.id]
    seen.add(entity.id)
    for (let i = 0; i < group.length; i++) for (const id of neighbors.get(group[i])!) {
      if (!seen.has(id)) { seen.add(id); group.push(id) }
    }
    groups.push(group)
  }
  let top = 24
  const connected = groups.filter(group => group.length > 1).sort((a, b) => b.length - a.length)
  for (const group of connected) {
    const depth = new Map<string, number>([[group[0], 0]])
    for (const id of group) for (const neighbor of neighbors.get(id)!) {
      if (!depth.has(neighbor)) depth.set(neighbor, depth.get(id)! + 1)
    }
    const levels: string[][] = []
    for (const id of group) (levels[depth.get(id) || 0] ||= []).push(id)
    const height = Math.max(...levels.map(level => level.length)) * 140
    levels.forEach((level, column) => level.forEach((id, row) => positions.set(id, {
      x: column * 340, y: top + (height - level.length * 140) / 2 + row * 140,
    })))
    top += height + 180
  }
  const isolated = groups.filter(group => group.length === 1).flat()
  const columns = Math.max(1, Math.ceil(Math.sqrt(isolated.length * 1.6)))
  isolated.forEach((id, index) => positions.set(id, { x: (index % columns) * 270, y: top + Math.floor(index / columns) * 140 }))
  return positions
}
