import { getDb } from '../database/db'
import { worldMap, novels, templates } from '../database/schema'
import { eq, asc } from 'drizzle-orm'
import { runChatTask } from './task.service'
import { mapGenerationPrompt } from './prompts'
import { safeParseJson } from '../utils/json'

export interface MapTreeNode {
  id: number
  name: string
  level: number
  locationType: string | null
  description: string | null
  atmosphere: string | null
  plotRelevance: string | null
  children: MapTreeNode[]
}

export function getMapTree(novelId: number): MapTreeNode[] {
  const db = getDb()
  const items = db.select().from(worldMap)
    .where(eq(worldMap.novelId, novelId))
    .orderBy(asc(worldMap.sortOrder), asc(worldMap.id))
    .all()

  function buildTree(parentId: number | null): MapTreeNode[] {
    return items
      .filter(item => item.parentId === parentId)
      .map(item => ({
        id: item.id,
        name: item.name,
        level: item.level,
        locationType: item.locationType,
        description: item.description,
        atmosphere: item.atmosphere,
        plotRelevance: item.plotRelevance,
        children: buildTree(item.id),
      }))
  }

  return buildTree(null)
}

export function createMapItem(novelId: number, data: {
  level: number
  parentId?: number
  name: string
  locationType?: string
  description?: string
  atmosphere?: string
  plotRelevance?: string
}) {
  const db = getDb()
  const result = db.insert(worldMap).values({ novelId, ...data }).run()
  return Number(result.lastInsertRowid)
}

export function updateMapItem(id: number, data: Partial<{
  name: string
  locationType: string
  description: string
  atmosphere: string
  plotRelevance: string
  keyEventsJson: string
}>) {
  const db = getDb()
  db.update(worldMap).set(data).where(eq(worldMap.id, id)).run()
}

export function deleteMapItem(id: number) {
  const db = getDb()
  // 同时删除子节点
  const db2 = getDb()
  const children = db2.select().from(worldMap).where(eq(worldMap.parentId, id)).all()
  for (const child of children) {
    deleteMapItem(child.id)
  }
  db.delete(worldMap).where(eq(worldMap.id, id)).run()
}

export async function batchGenerateMap(novelId: number, structure: {
  level1Count: number
  level2Count: number
  level3Count: number
  namedPlaces: string
}): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  let worldSummary = ''
  if (novel.worldTemplateId) {
    const tmpl = db.select().from(templates).where(eq(templates.id, novel.worldTemplateId)).all()[0]
    if (tmpl?.contentJson) {
      const content = JSON.parse(tmpl.contentJson)
      worldSummary = `${tmpl.name}：${content.power_system?.rules || ''}`
    }
  }

  const mapStructure = `第一级（大区域）${structure.level1Count}个，每个第一级下${structure.level2Count}个第二级（区域），每个第二级下${structure.level3Count}个第三级（具体地点）`

  const prompt = mapGenerationPrompt({
    novelTitle: novel.title,
    worldSummary,
    genre: '未知题材',
    mapStructure,
    namedPlaces: structure.namedPlaces,
  })

  const result = await runChatTask({
    type: 'generate_map',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  try {
    const parsed = safeParseJson<{ regions: Record<string, unknown>[] }>(result)
    for (const region of parsed.regions || []) {
      const l1Id = createMapItem(novelId, {
        level: 1,
        name: region.name,
        description: region.description,
        atmosphere: region.atmosphere,
      })

      for (const subRegion of region.sub_regions || []) {
        const l2Id = createMapItem(novelId, {
          level: 2,
          parentId: l1Id,
          name: subRegion.name,
          description: subRegion.description,
          atmosphere: subRegion.atmosphere,
        })

        for (const location of subRegion.locations || []) {
          createMapItem(novelId, {
            level: 3,
            parentId: l2Id,
            name: location.name,
            locationType: location.type,
            description: location.description,
            atmosphere: location.atmosphere,
            plotRelevance: location.plot_relevance,
          })
        }
      }
    }
  } catch (e) {
    console.error('地图生成解析失败:', e)
    throw new Error('地图生成结果解析失败，请重试')
  }
}
