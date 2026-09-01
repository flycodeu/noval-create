import { describe, expect, it } from 'vitest'
import type { MapRelation, WorldMapItem } from '../../../types'
import { buildAtlasRouteLinks, buildAtlasTerritories, findAtlasTerritoryForNode } from './narrative-atlas-layout'

function map(id: number, name: string, sortOrder: number, children: WorldMapItem[] = []): WorldMapItem {
  return { id, novelId: 7, level: 1, name, sortOrder, children }
}

describe('narrative atlas layout', () => {
  it('builds stable non-rectangular territory blocks for the current map level only', () => {
    const child = { ...map(11, '北门镇', 0), level: 2, parentId: 1 }
    const nodes = [map(2, '南境', 2), map(1, '北境', 1, [child])]
    const result = buildAtlasTerritories(nodes)

    expect(result.territories.map((territory) => territory.item.id)).toEqual([1, 2])
    expect(result.territories[0].points.split(' ')).toHaveLength(8)
    expect(findAtlasTerritoryForNode(result.territories, 11)?.item.id).toBe(1)
    expect(result.territories[1].x).toBeGreaterThan(result.territories[0].x + result.territories[0].width)
    expect(result.width).toBeGreaterThanOrEqual(960)
  })

  it('projects child-node routes onto their visible parent territories and removes duplicates', () => {
    const northChild = { ...map(11, '北门镇', 0), level: 2, parentId: 1 }
    const southChild = { ...map(21, '南河镇', 0), level: 2, parentId: 2 }
    const { territories } = buildAtlasTerritories([
      map(1, '北境', 1, [northChild]),
      map(2, '南境', 2, [southChild]),
    ])
    const relations = [
      { id: 5, novelId: 7, mapAId: 11, mapBId: 21, relationType: 'road', routeOpen: 1 },
      { id: 6, novelId: 7, mapAId: 1, mapBId: 2, relationType: 'river', routeOpen: 0 },
    ] as MapRelation[]

    const links = buildAtlasRouteLinks(territories, relations)
    expect(links).toHaveLength(1)
    expect(links[0].relationIds).toEqual([5, 6])
    expect(links[0].closed).toBe(false)
  })
})
