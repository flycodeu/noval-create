import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { novels, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { mapGenerationPrompt } from './prompts'
import { runChatTask } from './task.service'
import {
  buildMapBlueprintSummary,
  getBlueprintLevelByDepth,
  getFactionNameOptions,
  getMapBlueprintDepth,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'

export interface MapTreeNode {
  id: number
  name: string
  level: number
  locationType: string | null
  nodeType: string | null
  structureRole: string | null
  parentRuleType: string | null
  description: string | null
  atmosphere: string | null
  plotRelevance: string | null
  tagsJson: string | null
  affiliatedFactionIdsJson: string | null
  dangerLevel: string | null
  children: MapTreeNode[]
}

interface BatchGenerateMapInput {
  layerCounts?: number[] | Array<{ depth: number; count: number }>
  namedPlaces?: string
}

interface GeneratedMapNode {
  name?: unknown
  node_type?: unknown
  location_type?: unknown
  structure_role?: unknown
  description?: unknown
  atmosphere?: unknown
  plot_relevance?: unknown
  tags?: unknown
  affiliated_factions?: unknown
  danger_level?: unknown
  children?: unknown
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,，、]/))
}

function toGeneratedNodes(value: unknown): GeneratedMapNode[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is GeneratedMapNode => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function getLayerCount(input: BatchGenerateMapInput, depth: number, fallback: number): number {
  if (Array.isArray(input.layerCounts)) {
    if (input.layerCounts.every((item) => typeof item === 'number')) {
      const indexValue = input.layerCounts[depth - 1]
      return typeof indexValue === 'number' && Number.isFinite(indexValue)
        ? Math.max(1, Math.round(indexValue))
        : fallback
    }

    const entry = (input.layerCounts as Array<{ depth: number; count: number }>).find((item) => item.depth === depth)
    if (entry && Number.isFinite(entry.count)) return Math.max(1, Math.round(entry.count))
  }

  return fallback
}

export function getMapTree(novelId: number): MapTreeNode[] {
  const db = getDb()
  const items = db.select().from(worldMap)
    .where(eq(worldMap.novelId, novelId))
    .orderBy(asc(worldMap.sortOrder), asc(worldMap.id))
    .all()

  function buildTree(parentId: number | null): MapTreeNode[] {
    return items
      .filter((item) => item.parentId === parentId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        level: item.level,
        locationType: item.locationType,
        nodeType: item.nodeType,
        structureRole: item.structureRole,
        parentRuleType: item.parentRuleType,
        description: item.description,
        atmosphere: item.atmosphere,
        plotRelevance: item.plotRelevance,
        tagsJson: item.tagsJson,
        affiliatedFactionIdsJson: item.affiliatedFactionIdsJson,
        dangerLevel: item.dangerLevel,
        children: buildTree(item.id),
      }))
  }

  return buildTree(null)
}

export function createMapItem(novelId: number, data: Partial<typeof worldMap.$inferInsert> & {
  level: number
  name: string
}) {
  const db = getDb()
  const result = db.insert(worldMap).values({ novelId, ...data }).run()
  return Number(result.lastInsertRowid)
}

export function updateMapItem(id: number, data: Partial<typeof worldMap.$inferInsert>) {
  const db = getDb()
  db.update(worldMap).set(data).where(eq(worldMap.id, id)).run()
}

export function deleteMapItem(id: number) {
  const db = getDb()
  const children = db.select().from(worldMap).where(eq(worldMap.parentId, id)).all()
  for (const child of children) {
    deleteMapItem(child.id)
  }
  db.delete(worldMap).where(eq(worldMap.id, id)).run()
}

function insertGeneratedNodes(
  novelId: number,
  nodes: GeneratedMapNode[],
  depth: number,
  maxDepth: number,
  parentId: number | undefined,
  parentRuleType: string,
  defaultNodeType: string,
  rulesRaw: ReturnType<typeof parseWorldRulesJson>,
) {
  if (depth > maxDepth) return
  for (const rawNode of nodes) {
    const node = cleanAiValue(rawNode)
    const name = asText(node.name)
    if (!name) continue

    const nodeType = asText(node.node_type) || asText(node.location_type) || defaultNodeType
    const nodeId = createMapItem(novelId, {
      level: depth,
      parentId,
      name,
      locationType: asText(node.location_type),
      nodeType,
      structureRole: asText(node.structure_role),
      parentRuleType,
      description: asText(node.description),
      atmosphere: asText(node.atmosphere),
      plotRelevance: asText(node.plot_relevance),
      tagsJson: JSON.stringify(toStringArray(node.tags)),
      affiliatedFactionIdsJson: JSON.stringify(toStringArray(node.affiliated_factions)),
      dangerLevel: asText(node.danger_level),
    })

    const children = toGeneratedNodes(node.children)
    if (children.length > 0) {
      insertGeneratedNodes(
        novelId,
        children,
        depth + 1,
        maxDepth,
        nodeId,
        nodeType,
        getBlueprintLevelByDepth(rulesRaw, depth + 1)?.nodeTypes[0] || '地点',
        rulesRaw,
      )
    }
  }
}

export async function batchGenerateMap(novelId: number, structure: BatchGenerateMapInput): Promise<void> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const maxDepth = getMapBlueprintDepth(rules)

  const structureSummary = rules.mapBlueprint.levels
    .sort((left, right) => left.depth - right.depth)
    .map((layer) => `${layer.label} ${getLayerCount(structure, layer.depth, layer.suggestedCount)} 个`)
    .join('；')

  const prompt = mapGenerationPrompt({
    novelTitle: novel.title,
    worldSummary: profile.worldRulesSummary,
    genre: profile.genre,
    mapStructure: structureSummary,
    namedPlaces: structure.namedPlaces || '',
    factionSummary: getFactionNameOptions(rules).join('、'),
    mapSummary: buildMapBlueprintSummary(rules),
    writingConstraints: rules.writingConstraints.extraRules.join('；'),
  })

  const result = await runChatTask({
    type: 'generate_map',
    novelId,
    messages: [{ role: 'user', content: prompt }],
    modelConfigId: novel.modelConfigId || undefined,
  })

  try {
    const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(result))
    const nodes = toGeneratedNodes(parsed.nodes)

    if (nodes.length === 0 && Array.isArray(parsed.regions)) {
      const legacyNodes = (parsed.regions as Array<Record<string, unknown>>).map((region) => ({
        name: region.name,
        description: region.description,
        atmosphere: region.atmosphere,
        node_type: getBlueprintLevelByDepth(rules, 1)?.nodeTypes[0] || '区域',
        children: Array.isArray(region.sub_regions)
          ? (region.sub_regions as Array<Record<string, unknown>>).map((subRegion) => ({
              name: subRegion.name,
              description: subRegion.description,
              atmosphere: subRegion.atmosphere,
              node_type: getBlueprintLevelByDepth(rules, 2)?.nodeTypes[0] || '区域',
              children: Array.isArray(subRegion.locations)
                ? (subRegion.locations as Array<Record<string, unknown>>).map((location) => ({
                    name: location.name,
                    location_type: location.type,
                    node_type: location.type || getBlueprintLevelByDepth(rules, 3)?.nodeTypes[0] || '地点',
                    description: location.description,
                    atmosphere: location.atmosphere,
                    plot_relevance: location.plot_relevance,
                    children: [],
                  }))
                : [],
            }))
          : [],
      }))

      insertGeneratedNodes(
        novelId,
        legacyNodes,
        1,
        maxDepth,
        undefined,
        '',
        getBlueprintLevelByDepth(rules, 1)?.nodeTypes[0] || '区域',
        rules,
      )
      return
    }

    insertGeneratedNodes(
      novelId,
      nodes,
      1,
      maxDepth,
      undefined,
      '',
      getBlueprintLevelByDepth(rules, 1)?.nodeTypes[0] || '区域',
      rules,
    )
  } catch (error) {
    console.error('地图生成解析失败:', error)
    throw new Error('地图生成结果解析失败，请重试')
  }

  const topLevelNodes = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  for (const node of topLevelNodes) {
    if (node.level > maxDepth) {
      db.update(worldMap)
        .set({ level: maxDepth })
        .where(eq(worldMap.id, node.id))
        .run()
    }
  }
}
