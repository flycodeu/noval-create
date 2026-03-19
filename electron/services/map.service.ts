import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { novels, storyItems, timelineEvents, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { runChatTask } from './task.service'
import {
  buildMapBlueprintSummary,
  getBlueprintLevelByDepth,
  getFactionNameOptions,
  getMapBlueprintDepth,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
import type { MapBatchGenerateOptions, MapBatchGenerationResult } from '../../src/types'
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

type ParsedWorldRules = ReturnType<typeof parseWorldRulesJson>
type MapRow = typeof worldMap.$inferSelect

interface LayerPlan {
  depth: number
  label: string
  count: number
  parentLabel: string
}

interface PendingParentPlan {
  row: MapRow
  missingCount: number
}

interface NextMapBatchPlan {
  stage: 'root' | 'children' | 'completed'
  targetDepth: number | null
  rootMissingCount?: number
  parents?: PendingParentPlan[]
  pendingParentCount: number
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
  return cleanAiStringArray(text.split(/[\n,\uFF0C\u3001]/))
}

function toGeneratedNodes(value: unknown): GeneratedMapNode[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is GeneratedMapNode => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function getLayerCount(input: MapBatchGenerateOptions, depth: number, fallback: number): number {
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

function getLayerPlans(input: MapBatchGenerateOptions, rulesRaw: ParsedWorldRules): LayerPlan[] {
  return [...rulesRaw.mapBlueprint.levels]
    .sort((left, right) => left.depth - right.depth)
    .map((level) => ({
      depth: level.depth,
      label: level.label,
      count: getLayerCount(input, level.depth, level.suggestedCount),
      parentLabel: level.depth > 1
        ? getBlueprintLevelByDepth(rulesRaw, level.depth - 1)?.label || `\u7b2c${level.depth - 1}\u5c42`
        : '',
    }))
}

function buildMapStructureSummary(plans: LayerPlan[]): string {
  return plans
    .map((plan) => plan.depth === 1
      ? `${plan.label}\uff1a\u603b\u6570 ${plan.count} \u4e2a`
      : `${plan.label}\uff1a\u6bcf\u4e2a${plan.parentLabel}\u4e0b ${plan.count} \u4e2a`)
    .join('\uff1b')
}

function clampBatchSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.min(3, Math.round(value)))
}

function listMapRows(novelId: number): MapRow[] {
  const db = getDb()
  return db.select().from(worldMap)
    .where(eq(worldMap.novelId, novelId))
    .orderBy(asc(worldMap.level), asc(worldMap.parentId), asc(worldMap.sortOrder), asc(worldMap.id))
    .all()
}

function getChildrenOf(rows: MapRow[], parentId?: number | null): MapRow[] {
  return rows.filter((row) => (row.parentId ?? null) === (parentId ?? null))
}

function buildNodePath(row: MapRow, rows: MapRow[]): string {
  const rowById = new Map(rows.map((item) => [item.id, item]))
  const labels: string[] = []
  let current: MapRow | undefined = row

  while (current) {
    labels.unshift(current.name)
    current = typeof current.parentId === 'number' ? rowById.get(current.parentId) : undefined
  }

  return labels.join(' → ')
}

function parseGeneratedNodeBatch(raw: string): GeneratedMapNode[] {
  const parsed = cleanAiValue(safeParseJson<unknown>(raw))
  if (Array.isArray(parsed)) return toGeneratedNodes(parsed)
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const preferred = toGeneratedNodes(record.nodes)
    if (preferred.length > 0) return preferred
    const fallback = toGeneratedNodes(record.items)
    if (fallback.length > 0) return fallback
  }
  return []
}

function ensureExactNodeCount(nodes: GeneratedMapNode[], expectedCount: number, label: string) {
  if (nodes.length !== expectedCount) {
    throw new Error(`${label}需要 ${expectedCount} 个节点，实际生成 ${nodes.length} 个`)
  }
}

function createNodesAtDepth(
  novelId: number,
  nodes: GeneratedMapNode[],
  depth: number,
  parent: MapRow | undefined,
  rulesRaw: ParsedWorldRules,
): number {
  const defaultNodeType = getBlueprintLevelByDepth(rulesRaw, depth)?.nodeTypes[0]
    || (depth === 1 ? '\u533a\u57df' : '\u5730\u70b9')
  let createdCount = 0

  for (const rawNode of nodes) {
    const node = cleanAiValue(rawNode)
    const name = asText(node.name)
    if (!name) continue

    createMapItem(novelId, {
      level: depth,
      parentId: parent?.id,
      name,
      locationType: asText(node.location_type),
      nodeType: asText(node.node_type) || asText(node.location_type) || defaultNodeType,
      structureRole: asText(node.structure_role),
      parentRuleType: parent?.nodeType || parent?.locationType || '',
      description: asText(node.description),
      atmosphere: asText(node.atmosphere),
      plotRelevance: asText(node.plot_relevance),
      tagsJson: JSON.stringify(toStringArray(node.tags)),
      affiliatedFactionIdsJson: JSON.stringify(toStringArray(node.affiliated_factions)),
      dangerLevel: asText(node.danger_level),
    })
    createdCount += 1
  }

  return createdCount
}

function findNextMapBatch(
  rows: MapRow[],
  layerPlans: LayerPlan[],
  parentBatchSize: number,
): NextMapBatchPlan {
  const rootPlan = layerPlans[0]
  const rootRows = rows.filter((row) => row.level === 1)
  if (rootPlan && rootRows.length < rootPlan.count) {
    return {
      stage: 'root',
      targetDepth: 1,
      rootMissingCount: rootPlan.count - rootRows.length,
      pendingParentCount: rootPlan.count - rootRows.length,
    }
  }

  for (let depth = 1; depth < layerPlans.length; depth += 1) {
    const parentDepth = depth
    const childPlan = layerPlans[depth]
    const parentRows = rows.filter((row) => row.level === parentDepth)
    const pendingParents = parentRows
      .map((row) => {
        const existingChildren = getChildrenOf(rows, row.id)
        const missingCount = childPlan.count - existingChildren.length
        return missingCount > 0 ? { row, missingCount } : null
      })
      .filter((item): item is PendingParentPlan => Boolean(item))

    if (pendingParents.length > 0) {
      return {
        stage: 'children',
        targetDepth: childPlan.depth,
        parents: pendingParents.slice(0, parentBatchSize),
        pendingParentCount: pendingParents.length,
      }
    }
  }

  return {
    stage: 'completed',
    targetDepth: null,
    pendingParentCount: 0,
  }
}

function buildRootBatchPrompt(params: {
  novelTitle: string
  genre: string
  worldSummary: string
  mapStructure: string
  rootLabel: string
  batchCount: number
  existingRootNames: string[]
  factionSummary?: string
  mapSummary?: string
  namedPlaces?: string
  writingConstraints?: string
}): string {
  return [
    `为小说《${params.novelTitle}》分批补地图根层。本次只生成 ${params.batchCount} 个第1层「${params.rootLabel}」节点。`,
    '【当前约束】',
    `题材：${params.genre}`,
    `世界规则：${params.worldSummary}`,
    `地图蓝图：${params.mapStructure}`,
    params.factionSummary ? `势力结构：${params.factionSummary}` : '',
    params.mapSummary ? `地图蓝图补充：${params.mapSummary}` : '',
    params.namedPlaces ? `用户指定地点：${params.namedPlaces}` : '',
    params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
    params.existingRootNames.length > 0 ? `已存在根节点：${params.existingRootNames.join('、')}` : '当前还没有根节点。',
    '【生成要求】',
    `1. 只生成本批 ${params.batchCount} 个根节点，不要补 children，不要生成后续层级。`,
    '2. 名称必须贴合题材和世界背景，且不要与已有根节点重名。',
    '3. description、atmosphere、plot_relevance 都要具体，能直接服务后续剧情和挂点。',
    '4. children 必须返回空数组。',
    '只输出 JSON 数组：[{"name":"","node_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
}

function buildChildBatchPrompt(params: {
  novelTitle: string
  genre: string
  worldSummary: string
  mapStructure: string
  targetLabel: string
  batchCount: number
  parent: MapRow
  parentPath: string
  existingChildNames: string[]
  factionSummary?: string
  mapSummary?: string
  namedPlaces?: string
  writingConstraints?: string
}): string {
  return [
    `为小说《${params.novelTitle}》分批补地图子节点。本次只处理 1 个父节点，只生成它的直属下一层孩子。`,
    '【当前约束】',
    `题材：${params.genre}`,
    `世界规则：${params.worldSummary}`,
    `地图蓝图：${params.mapStructure}`,
    params.factionSummary ? `势力结构：${params.factionSummary}` : '',
    params.mapSummary ? `地图蓝图补充：${params.mapSummary}` : '',
    params.namedPlaces ? `用户指定地点：${params.namedPlaces}` : '',
    params.writingConstraints ? `语言约束：${params.writingConstraints}` : '',
    '【父节点信息】',
    `路径：${params.parentPath}`,
    `名称：${params.parent.name}`,
    `节点类型：${params.parent.nodeType || params.parent.locationType || '未设置'}`,
    params.parent.structureRole ? `结构职责：${params.parent.structureRole}` : '',
    params.parent.description ? `空间描述：${params.parent.description}` : '',
    params.parent.atmosphere ? `氛围：${params.parent.atmosphere}` : '',
    params.parent.plotRelevance ? `剧情用途：${params.parent.plotRelevance}` : '',
    params.existingChildNames.length > 0 ? `该父节点已有直属子节点：${params.existingChildNames.join('、')}` : '该父节点当前还没有直属子节点。',
    '【生成要求】',
    `1. 只为这个父节点补 ${params.batchCount} 个直属「${params.targetLabel}」节点。`,
    '2. 不要生成 grandchildren，不要跨层，不要返回其他父节点的数据。',
    '3. 名称不要与该父节点已有直属子节点重名。',
    '4. children 必须返回空数组。',
    '5. plot_relevance 要写具体事件、用途或冲突，不写空话。',
    '只输出 JSON 数组：[{"name":"","node_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
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

export function clearMapByNovel(novelId: number) {
  const db = getDb()
  db.update(timelineEvents).set({
    locationMapId: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(timelineEvents.novelId, novelId)).run()

  db.update(storyItems).set({
    locationMapId: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(storyItems.novelId, novelId)).run()

  db.delete(worldMap).where(eq(worldMap.novelId, novelId)).run()
}

export async function batchGenerateMap(
  novelId: number,
  structure: MapBatchGenerateOptions,
): Promise<MapBatchGenerationResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('\u5c0f\u8bf4\u4e0d\u5b58\u5728')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const layerPlans = getLayerPlans(structure, rules)
  const structureSummary = buildMapStructureSummary(layerPlans)
  const factionSummary = getFactionNameOptions(rules).join('\u3001')
  const mapSummary = buildMapBlueprintSummary(rules)
  const writingConstraints = rules.writingConstraints.extraRules.join('\uff1b')
  const parentBatchSize = clampBatchSize(structure.parentBatchSize)
  const rows = listMapRows(novelId)
  const nextBatch = findNextMapBatch(rows, layerPlans, parentBatchSize)

  if (nextBatch.stage === 'completed') {
    return {
      stage: 'completed',
      targetDepth: null,
      generatedNodeCount: 0,
      processedParentCount: 0,
      pendingParentCount: 0,
      processedParentNames: [],
      completed: true,
      message: '\u5730\u56fe\u84dd\u56fe\u5df2\u8865\u9f50\uff0c\u5f53\u524d\u6ca1\u6709\u9700\u8981\u7ee7\u7eed\u751f\u6210\u7684\u6279\u6b21\u3002',
      nextDepth: null,
    }
  }

  let generatedNodeCount = 0
  const processedParentNames: string[] = []

  try {
    if (nextBatch.stage === 'root') {
      const rootPlan = layerPlans[0]
      if (!rootPlan) throw new Error('\u7f3a\u5c11\u6839\u5c42\u84dd\u56fe')

      const existingRootNames = rows.filter((row) => row.level === 1).map((row) => row.name).filter(Boolean)
      const batchCount = Math.min(parentBatchSize, nextBatch.rootMissingCount || rootPlan.count)
      const prompt = buildRootBatchPrompt({
        novelTitle: novel.title,
        genre: profile.genre,
        worldSummary: profile.worldRulesSummary,
        mapStructure: structureSummary,
        rootLabel: rootPlan.label,
        batchCount,
        existingRootNames,
        factionSummary,
        mapSummary,
        namedPlaces: structure.namedPlaces || '',
        writingConstraints,
      })

      const result = await runChatTask({
        type: 'generate_map',
        novelId,
        messages: [{ role: 'user', content: prompt }],
        modelConfigId: novel.modelConfigId || undefined,
      })

      const nodes = parseGeneratedNodeBatch(result)
      ensureExactNodeCount(nodes, batchCount, '\u6839\u5c42')
      generatedNodeCount += createNodesAtDepth(novelId, nodes, 1, undefined, rules)
      processedParentNames.push(...nodes.map((node) => asText(node.name)).filter(Boolean))
    } else {
      const targetDepth = nextBatch.targetDepth
      const targetPlan = targetDepth ? getBlueprintLevelByDepth(rules, targetDepth) : undefined
      if (!targetDepth || !targetPlan || !nextBatch.parents || nextBatch.parents.length === 0) {
        throw new Error('\u65e0\u6cd5\u786e\u5b9a\u5f53\u524d\u5730\u56fe\u6279\u6b21')
      }

      for (const plan of nextBatch.parents) {
        const latestRows = listMapRows(novelId)
        const currentParent = latestRows.find((row) => row.id === plan.row.id)
        if (!currentParent) continue

        const existingChildren = getChildrenOf(latestRows, currentParent.id)
        const missingCount = targetPlan.count - existingChildren.length
        if (missingCount <= 0) continue

        const prompt = buildChildBatchPrompt({
          novelTitle: novel.title,
          genre: profile.genre,
          worldSummary: profile.worldRulesSummary,
          mapStructure: structureSummary,
          targetLabel: targetPlan.label,
          batchCount: missingCount,
          parent: currentParent,
          parentPath: buildNodePath(currentParent, latestRows),
          existingChildNames: existingChildren.map((row) => row.name).filter(Boolean),
          factionSummary,
          mapSummary,
          namedPlaces: structure.namedPlaces || '',
          writingConstraints,
        })

        const result = await runChatTask({
          type: 'generate_map',
          novelId,
          messages: [{ role: 'user', content: prompt }],
          modelConfigId: novel.modelConfigId || undefined,
        })

        const nodes = parseGeneratedNodeBatch(result)
        ensureExactNodeCount(nodes, missingCount, `${currentParent.name}\u4e0b\u7684${targetPlan.label}`)
        generatedNodeCount += createNodesAtDepth(novelId, nodes, targetDepth, currentParent, rules)
        processedParentNames.push(currentParent.name)
      }
    }
  } catch (error) {
    console.error('\u5730\u56fe\u5206\u6279\u751f\u6210\u89e3\u6790\u5931\u8d25:', error)
    throw new Error(error instanceof Error ? error.message : '\u5730\u56fe\u751f\u6210\u7ed3\u679c\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5')
  }

  const refreshedRows = listMapRows(novelId)
  const nextState = findNextMapBatch(refreshedRows, layerPlans, parentBatchSize)

  if (nextBatch.stage === 'root') {
    return {
      stage: 'root',
      targetDepth: 1,
      generatedNodeCount,
      processedParentCount: processedParentNames.length,
      pendingParentCount: nextState.stage === 'root' ? nextState.pendingParentCount : 0,
      processedParentNames,
      completed: nextState.stage === 'completed',
      message: nextState.stage === 'completed'
        ? `\u6839\u5c42\u5df2\u751f\u6210\u5b8c\u6210\uff0c\u5730\u56fe\u84dd\u56fe\u4e5f\u5df2\u5168\u90e8\u8865\u9f50\u3002\u672c\u6279\u65b0\u589e ${generatedNodeCount} \u4e2a\u8282\u70b9\u3002`
        : `\u6839\u5c42\u672c\u6279\u65b0\u589e ${generatedNodeCount} \u4e2a\u8282\u70b9\uff0c\u4ecd\u53ef\u7ee7\u7eed\u751f\u6210\u540e\u7eed\u5c42\u7ea7\u3002`,
      nextDepth: nextState.stage === 'children' ? nextState.targetDepth : nextState.targetDepth,
    }
  }

  return {
    stage: 'children',
    targetDepth: nextBatch.targetDepth,
    generatedNodeCount,
    processedParentCount: processedParentNames.length,
    pendingParentCount: nextState.stage === 'children' && nextState.targetDepth === nextBatch.targetDepth
      ? nextState.pendingParentCount
      : nextState.stage === 'root'
        ? nextState.pendingParentCount
        : 0,
    processedParentNames,
    completed: nextState.stage === 'completed',
    message: nextState.stage === 'completed'
      ? `\u5df2\u8865\u9f50\u300c${processedParentNames.join('\u3001')} \u300d\u7684\u76f4\u5c5e\u5b50\u8282\u70b9\uff0c\u5730\u56fe\u84dd\u56fe\u5df2\u5168\u90e8\u5b8c\u6210\u3002`
      : `\u5df2\u8865\u9f50\u300c${processedParentNames.join('\u3001')} \u300d\u7684\u76f4\u5c5e\u5b50\u8282\u70b9\uff0c\u672c\u6279\u65b0\u589e ${generatedNodeCount} \u4e2a\u8282\u70b9\u3002`,
    nextDepth: nextState.targetDepth,
  }
}
