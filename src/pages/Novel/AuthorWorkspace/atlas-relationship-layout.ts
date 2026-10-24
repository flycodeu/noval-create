import type { StoryAtlasEntity, StoryAtlasRelation } from '../../../shared/story-atlas'

/** Place independent relationship components separately, including isolated characters. */
export function relationshipPositions(entities: StoryAtlasEntity[], relations: StoryAtlasRelation[]) {
  const neighbors = new Map(entities.map(entity => [entity.id, new Set<string>()]))
  for (const relation of relations) {
    if (relation.kind !== 'relationship' || !neighbors.has(relation.fromId) || !neighbors.has(relation.toId)) continue
    neighbors.get(relation.fromId)!.add(relation.toId)
    neighbors.get(relation.toId)!.add(relation.fromId)
  }
  const seen = new Set<string>()
  const groups: string[][] = []
  for (const entity of entities) {
    if (seen.has(entity.id)) continue
    const group = [entity.id]
    seen.add(entity.id)
    for (let i = 0; i < group.length; i++) for (const id of neighbors.get(group[i])!) {
      if (!seen.has(id)) { seen.add(id); group.push(id) }
    }
    groups.push(group)
  }
  const positions = new Map<string, { x: number; y: number }>()
  let top = 40
  const connected = groups.filter(group => group.length > 1).sort((a, b) => b.length - a.length)
  const isolated = groups.filter(group => group.length === 1).flat()
  for (const group of [...connected, ...(isolated.length ? [isolated] : [])]) {
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(group.length))))
    group.forEach((id, index) => positions.set(id, { x: (index % columns) * 320, y: top + Math.floor(index / columns) * 190 }))
    top += Math.ceil(group.length / columns) * 190 + 100
  }
  return positions
}
