import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
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
import {
  buildContextAlignmentRules,
  buildGenreRealityRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import type { MapBatchGenerateOptions, MapBatchGenerationResult } from '../../src/types'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { markNovelContextChanged } from './context-impact.service'

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

interface MapNodeQueryFilters {
  novelId: number
  parentId?: number | null
  level?: number
  keyword?: string
  page?: number
  pageSize?: number
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
        ? getBlueprintLevelByDepth(rulesRaw, level.depth - 1)?.label || `第${level.depth - 1}层`
        : '',
    }))
}

function buildMapStructureSummary(plans: LayerPlan[]): string {
  return plans
    .map((plan) => plan.depth === 1
      ? `${plan.label}：总数 ${plan.count} 个`
      : `${plan.label}：每个${plan.parentLabel}下 ${plan.count} 个`)
    .join('；')
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
    || (depth === 1 ? '区域' : '地点')
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
    }, { skipContextTracking: true })
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
    '【语言要求】',
    buildHumanLanguageRules([
      'plot_relevance 只写这个地点会承接什么事件、冲突或用途，不要写空泛大词。',
      '不要把地点、势力、人物和无关概念强行拼接，例如卡路里、感染概率、金融指标之类。',
      'description 和 atmosphere 优先写读者能立刻感知到的空间特征，不要写假深刻文案。',
    ]),
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
    '【语言要求】',
    buildHumanLanguageRules([
      '只围绕这个父节点的空间功能和剧情作用来写，不要跳出当前层级发明无关设定。',
      '不要把没有直接关系的概念硬拼进一句话，例如卡路里、感染概率、金融指标之类。',
      'description、atmosphere、plot_relevance 都要写成自然中文短句，不要写口号或百科腔。',
    ]),
    '只输出 JSON 数组：[{"name":"","node_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 30) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function mapNodeSummaryRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    level: Number(row.level),
    parentId: row.parent_id == null ? undefined : Number(row.parent_id),
    name: String(row.name || ''),
    locationType: typeof row.location_type === 'string' ? row.location_type : undefined,
    nodeType: typeof row.node_type === 'string' ? row.node_type : undefined,
    structureRole: typeof row.structure_role === 'string' ? row.structure_role : undefined,
    parentRuleType: typeof row.parent_rule_type === 'string' ? row.parent_rule_type : undefined,
    description: typeof row.description === 'string' ? row.description : undefined,
    atmosphere: typeof row.atmosphere === 'string' ? row.atmosphere : undefined,
    plotRelevance: typeof row.plot_relevance === 'string' ? row.plot_relevance : undefined,
    tagsJson: typeof row.tags_json === 'string' ? row.tags_json : undefined,
    affiliatedFactionIdsJson: typeof row.affiliated_faction_ids_json === 'string' ? row.affiliated_faction_ids_json : undefined,
    dangerLevel: typeof row.danger_level === 'string' ? row.danger_level : undefined,
    sortOrder: Number(row.sort_order || 0),
    childCount: Number(row.childCount || 0),
  }
}

function buildMapWhere(filters: MapNodeQueryFilters) {
  const whereClauses = ['m.novel_id = ?']
  const params: Array<number | string> = [filters.novelId]

  if ('parentId' in filters) {
    if (filters.parentId == null) {
      whereClauses.push('m.parent_id IS NULL')
    } else {
      whereClauses.push('m.parent_id = ?')
      params.push(filters.parentId)
    }
  }

  if (typeof filters.level === 'number') {
    whereClauses.push('m.level = ?')
    params.push(filters.level)
  }

  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
  if (keyword) {
    const like = `%${keyword}%`
    whereClauses.push(`
      (
        m.name LIKE ?
        OR COALESCE(m.node_type, '') LIKE ?
        OR COALESCE(m.location_type, '') LIKE ?
        OR COALESCE(m.structure_role, '') LIKE ?
        OR COALESCE(m.plot_relevance, '') LIKE ?
        OR COALESCE(m.description, '') LIKE ?
      )
    `)
    params.push(like, like, like, like, like, like)
  }

  return {
    whereSql: whereClauses.join(' AND '),
    params,
  }
}

export function queryMapNodes(filters: MapNodeQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 30)
  const query = buildMapWhere(filters)
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM world_map m
    WHERE ${query.whereSql}
  `).get(...query.params) as { total?: number } | undefined

  const rows = sqlite.prepare(`
    SELECT
      m.*,
      (
        SELECT COUNT(*)
        FROM world_map c
        WHERE c.parent_id = m.id
      ) AS childCount
    FROM world_map m
    WHERE ${query.whereSql}
    ORDER BY m.sort_order ASC, m.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map(mapNodeSummaryRecord)
  return buildPagedResult(items, paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function getMapNode(id: number) {
  const sqlite = getSqlite()
  const row = sqlite.prepare(`
    SELECT
      m.*,
      (
        SELECT COUNT(*)
        FROM world_map c
        WHERE c.parent_id = m.id
      ) AS childCount
    FROM world_map m
    WHERE m.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined
  return row ? mapNodeSummaryRecord(row) : null
}

export function searchMapNodes(novelId: number, keyword = '', limit = 20) {
  return queryMapNodes({
    novelId,
    keyword,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
  }).items
}

export function getMapStats(novelId: number) {
  const sqlite = getSqlite()
  const countsByLevel = sqlite.prepare(`
    SELECT level, COUNT(*) AS count
    FROM world_map
    WHERE novel_id = ?
    GROUP BY level
    ORDER BY level ASC
  `).all(novelId) as Array<{ level?: number | null; count?: number | null }>
  const summary = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN level = 1 THEN 1 ELSE 0 END) AS rootCount,
      SUM(CASE WHEN level = 2 THEN 1 ELSE 0 END) AS secondLevelCount,
      MAX(level) AS maxDepth
    FROM world_map
    WHERE novel_id = ?
  `).get(novelId) as Record<string, unknown> | undefined
  const leafRow = sqlite.prepare(`
    SELECT COUNT(*) AS leafCount
    FROM world_map m
    WHERE m.novel_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM world_map c
        WHERE c.parent_id = m.id
      )
  `).get(novelId) as Record<string, unknown> | undefined

  return {
    total: Number(summary?.total || 0),
    rootCount: Number(summary?.rootCount || 0),
    secondLevelCount: Number(summary?.secondLevelCount || 0),
    leafCount: Number(leafRow?.leafCount || 0),
    maxDepth: Number(summary?.maxDepth || 0),
    countsByLevel: countsByLevel.map((row) => ({
      level: Number(row.level || 0),
      count: Number(row.count || 0),
    })),
  }
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
}, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const result = db.insert(worldMap).values({ novelId, ...data }).run()
  const id = Number(result.lastInsertRowid)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Map structure changed')
  }
  return id
}

export function updateMapItem(
  id: number,
  data: Partial<typeof worldMap.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  db.update(worldMap).set(data).where(eq(worldMap.id, id)).run()
  if (!options.skipContextTracking) {
    const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
    if (current) {
      markNovelContextChanged(current.novelId, 'Map structure changed')
    }
  }
}

export function deleteMapItem(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
  const children = db.select().from(worldMap).where(eq(worldMap.parentId, id)).all()
  for (const child of children) {
    deleteMapItem(child.id, { skipContextTracking: true })
  }
  db.delete(worldMap).where(eq(worldMap.id, id)).run()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Map structure changed')
  }
}

export function clearMapByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
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
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Map structure changed')
  }
}

export async function batchGenerateMap(
  novelId: number,
  structure: MapBatchGenerateOptions,
): Promise<MapBatchGenerationResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throw new Error('小说不存在')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const layerPlans = getLayerPlans(structure, rules)
  const structureSummary = buildMapStructureSummary(layerPlans)
  const factionSummary = getFactionNameOptions(rules).join('、')
  const mapSummary = buildMapBlueprintSummary(rules)
  const writingConstraints = rules.writingConstraints.extraRules.join('；')
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
      message: '地图蓝图已补齐，当前没有需要继续生成的批次。',
      nextDepth: null,
    }
  }

  let generatedNodeCount = 0
  const processedParentNames: string[] = []

  try {
    if (nextBatch.stage === 'root') {
      const rootPlan = layerPlans[0]
      if (!rootPlan) throw new Error('缺少根层蓝图')

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
      ensureExactNodeCount(nodes, batchCount, '根层')
      generatedNodeCount += createNodesAtDepth(novelId, nodes, 1, undefined, rules)
      processedParentNames.push(...nodes.map((node) => asText(node.name)).filter(Boolean))
    } else {
      const targetDepth = nextBatch.targetDepth
      const targetPlan = targetDepth ? getBlueprintLevelByDepth(rules, targetDepth) : undefined
      if (!targetDepth || !targetPlan || !nextBatch.parents || nextBatch.parents.length === 0) {
        throw new Error('无法确定当前地图批次')
      }

      for (const plan of nextBatch.parents) {
        const latestRows = listMapRows(novelId)
        const currentParent = latestRows.find((row) => row.id === plan.row.id)
        if (!currentParent) continue

        const existingChildren = getChildrenOf(latestRows, currentParent.id)
        const missingCount = targetPlan.suggestedCount - existingChildren.length
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
        ensureExactNodeCount(nodes, missingCount, `${currentParent.name}下的${targetPlan.label}`)
        generatedNodeCount += createNodesAtDepth(novelId, nodes, targetDepth, currentParent, rules)
        processedParentNames.push(currentParent.name)
      }
    }
  } catch (error) {
    console.error('地图分批生成解析失败:', error)
    throw new Error(error instanceof Error ? error.message : '地图生成结果解析失败，请重试')
  }

  const refreshedRows = listMapRows(novelId)
  const nextState = findNextMapBatch(refreshedRows, layerPlans, parentBatchSize)
  if (generatedNodeCount > 0) {
    markNovelContextChanged(novelId, 'Map structure changed')
  }

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
        ? `根层已生成完成，地图蓝图也已全部补齐。本批新增 ${generatedNodeCount} 个节点。`
        : `根层本批新增 ${generatedNodeCount} 个节点，仍可继续生成后续层级。`,
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
      ? `已补齐「${processedParentNames.join('、')} 」的直属子节点，地图蓝图已全部完成。`
      : `已补齐「${processedParentNames.join('、')} 」的直属子节点，本批新增 ${generatedNodeCount} 个节点。`,
    nextDepth: nextState.targetDepth,
  }
}
