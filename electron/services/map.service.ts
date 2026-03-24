import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { novels, storyItems, timelineEvents, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import {
  buildMapBlueprintSummary,
  getBlueprintLevelByDepth,
  getFactionNameOptions,
  parseWorldRulesJson,
} from '../../src/shared/genre-system'
import { buildHumanLanguageRules } from '../../src/shared/prompt-library'
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

export interface MapNextBatchPreview {
  stage: 'root' | 'children' | 'completed'
  targetDepth: number | null
  pendingParentCount: number
  batchCount: number
  plannedParentNames: string[]
  batchKey: string
}

interface MapBatchGenerateRuntimeOptions {
  parentTaskId?: number
  sender?: WebContents
  onBatchPlan?: (preview: MapNextBatchPreview) => void
  shouldStop?: () => boolean
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

function normalizeNameKey(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
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
  return text ? cleanAiStringArray(text.split(/[\n,，、]/)) : []
}

function toGeneratedNodes(value: unknown): GeneratedMapNode[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is GeneratedMapNode => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
}

function clampBatchSize(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.min(3, Math.round(value)))
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 30) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  return { page: nextPage, pageSize: nextPageSize, offset: (nextPage - 1) * nextPageSize }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return { items, page, pageSize, total, hasMore: page * pageSize < total }
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
  return labels.join(' -> ')
}

function parseGeneratedNodeBatch(raw: string): GeneratedMapNode[] {
  const parsed = cleanAiValue(safeParseJson<unknown>(raw))
  if (Array.isArray(parsed)) return toGeneratedNodes(parsed)
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const preferred = toGeneratedNodes(record.nodes)
    return preferred.length > 0 ? preferred : toGeneratedNodes(record.items)
  }
  return []
}

function validateGeneratedNodes(nodes: GeneratedMapNode[], expectedCount: number, label: string, existingNames: string[]) {
  if (nodes.length !== expectedCount) {
    throw new Error(`${label} 需要 ${expectedCount} 个节点，实际生成 ${nodes.length} 个`)
  }

  const seen = new Set<string>()
  const existing = new Set(existingNames.map(normalizeNameKey).filter(Boolean))
  for (let index = 0; index < nodes.length; index += 1) {
    const node = cleanAiValue(nodes[index])
    const name = asText(node.name)
    if (!name) throw new Error(`${label} 第 ${index + 1} 个节点缺少名称`)
    const key = normalizeNameKey(name)
    if (seen.has(key) || existing.has(key)) {
      throw new Error(`${label} 出现重名节点：${name}`)
    }
    if (!asText(node.description) && !asText(node.plot_relevance)) {
      throw new Error(`${label} 中的节点 ${name} 缺少描述或剧情作用`)
    }
    seen.add(key)
  }
}

function sanitizeMapPayload(data: Partial<typeof worldMap.$inferInsert>): Partial<typeof worldMap.$inferInsert> {
  const next: Partial<typeof worldMap.$inferInsert> = {}
  if (typeof data.level === 'number') next.level = Math.max(1, Math.round(data.level))
  if ('parentId' in data) next.parentId = data.parentId == null ? null : Number(data.parentId)
  if (typeof data.name === 'string') next.name = asText(data.name)
  if (typeof data.locationType === 'string') next.locationType = asText(data.locationType)
  if (typeof data.nodeType === 'string') next.nodeType = asText(data.nodeType)
  if (typeof data.structureRole === 'string') next.structureRole = asText(data.structureRole)
  if (typeof data.parentRuleType === 'string') next.parentRuleType = asText(data.parentRuleType)
  if (typeof data.description === 'string') next.description = asText(data.description)
  if (typeof data.atmosphere === 'string') next.atmosphere = asText(data.atmosphere)
  if (typeof data.plotRelevance === 'string') next.plotRelevance = asText(data.plotRelevance)
  if (typeof data.tagsJson === 'string') next.tagsJson = data.tagsJson
  if (typeof data.affiliatedFactionIdsJson === 'string') next.affiliatedFactionIdsJson = data.affiliatedFactionIdsJson
  if (typeof data.dangerLevel === 'string') next.dangerLevel = asText(data.dangerLevel)
  if (typeof data.sortOrder === 'number') next.sortOrder = Math.max(0, Math.round(data.sortOrder))
  return next
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
    if (filters.parentId == null) whereClauses.push('m.parent_id IS NULL')
    else {
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
    whereClauses.push("(m.name LIKE ? OR COALESCE(m.node_type,'') LIKE ? OR COALESCE(m.location_type,'') LIKE ? OR COALESCE(m.structure_role,'') LIKE ? OR COALESCE(m.plot_relevance,'') LIKE ? OR COALESCE(m.description,'') LIKE ?)")
    params.push(like, like, like, like, like, like)
  }
  return { whereSql: whereClauses.join(' AND '), params }
}

export function queryMapNodes(filters: MapNodeQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 30)
  const query = buildMapWhere(filters)
  const countRow = sqlite.prepare(`SELECT COUNT(*) AS total FROM world_map m WHERE ${query.whereSql}`).get(...query.params) as { total?: number } | undefined
  const rows = sqlite.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM world_map c WHERE c.parent_id = m.id) AS childCount
    FROM world_map m
    WHERE ${query.whereSql}
    ORDER BY m.sort_order ASC, m.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>
  return buildPagedResult(rows.map(mapNodeSummaryRecord), paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function getMapNode(id: number) {
  const sqlite = getSqlite()
  const row = sqlite.prepare(`
    SELECT m.*, (SELECT COUNT(*) FROM world_map c WHERE c.parent_id = m.id) AS childCount
    FROM world_map m
    WHERE m.id = ?
    LIMIT 1
  `).get(id) as Record<string, unknown> | undefined
  return row ? mapNodeSummaryRecord(row) : null
}

export function searchMapNodes(novelId: number, keyword = '', limit = 20) {
  return queryMapNodes({ novelId, keyword, page: 1, pageSize: Math.max(1, Math.min(limit, 50)) }).items
}

export function getMapStats(novelId: number) {
  const sqlite = getSqlite()
  const countsByLevel = sqlite.prepare('SELECT level, COUNT(*) AS count FROM world_map WHERE novel_id = ? GROUP BY level ORDER BY level ASC').all(novelId) as Array<{ level?: number | null; count?: number | null }>
  const summary = sqlite.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN level = 1 THEN 1 ELSE 0 END) AS rootCount,
      SUM(CASE WHEN level = 2 THEN 1 ELSE 0 END) AS secondLevelCount,
      MAX(level) AS maxDepth
    FROM world_map
    WHERE novel_id = ?
  `).get(novelId) as Record<string, unknown> | undefined
  const leafRow = sqlite.prepare('SELECT COUNT(*) AS leafCount FROM world_map m WHERE m.novel_id = ? AND NOT EXISTS (SELECT 1 FROM world_map c WHERE c.parent_id = m.id)').get(novelId) as Record<string, unknown> | undefined
  return {
    total: Number(summary?.total || 0),
    rootCount: Number(summary?.rootCount || 0),
    secondLevelCount: Number(summary?.secondLevelCount || 0),
    leafCount: Number(leafRow?.leafCount || 0),
    maxDepth: Number(summary?.maxDepth || 0),
    countsByLevel: countsByLevel.map((row) => ({ level: Number(row.level || 0), count: Number(row.count || 0) })),
  }
}

export function getMapTree(novelId: number): MapTreeNode[] {
  const items = listMapRows(novelId)
  function buildTree(parentId: number | null): MapTreeNode[] {
    return items
      .filter((item) => (item.parentId ?? null) === parentId)
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

export function createMapItem(novelId: number, data: Partial<typeof worldMap.$inferInsert> & { level: number; name: string }, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const result = db.insert(worldMap).values({ novelId, ...sanitizeMapPayload(data) }).run()
  const id = Number(result.lastInsertRowid)
  if (!options.skipContextTracking) markNovelContextChanged(novelId, 'Map structure changed')
  return id
}

export function updateMapItem(id: number, data: Partial<typeof worldMap.$inferInsert>, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  db.update(worldMap).set(sanitizeMapPayload(data)).where(eq(worldMap.id, id)).run()
  if (!options.skipContextTracking) {
    const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
    if (current) markNovelContextChanged(current.novelId, 'Map structure changed')
  }
}

export function deleteMapItem(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
  const children = db.select().from(worldMap).where(eq(worldMap.parentId, id)).all()
  for (const child of children) deleteMapItem(child.id, { skipContextTracking: true })
  db.delete(worldMap).where(eq(worldMap.id, id)).run()
  if (!options.skipContextTracking && current) markNovelContextChanged(current.novelId, 'Map structure changed')
}

export function clearMapByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  db.update(timelineEvents).set({ locationMapId: null, updatedAt: new Date().toISOString() }).where(eq(timelineEvents.novelId, novelId)).run()
  db.update(storyItems).set({ locationMapId: null, updatedAt: new Date().toISOString() }).where(eq(storyItems.novelId, novelId)).run()
  db.delete(worldMap).where(eq(worldMap.novelId, novelId)).run()
  if (!options.skipContextTracking) markNovelContextChanged(novelId, 'Map structure changed')
}

function getLayerCount(input: MapBatchGenerateOptions, depth: number, fallback: number): number {
  if (Array.isArray(input.layerCounts)) {
    if (input.layerCounts.every((item) => typeof item === 'number')) {
      const value = input.layerCounts[depth - 1]
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value)) : fallback
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
      parentLabel: level.depth > 1 ? getBlueprintLevelByDepth(rulesRaw, level.depth - 1)?.label || `第 ${level.depth - 1} 层` : '',
    }))
}

function getLayerPlanByDepth(layerPlans: LayerPlan[], depth: number) {
  return layerPlans.find((plan) => plan.depth === depth)
}

function buildMapStructureSummary(plans: LayerPlan[]): string {
  return plans.map((plan) => (plan.depth === 1 ? `${plan.label}：总数 ${plan.count}` : `${plan.label}：每个${plan.parentLabel}下约 ${plan.count} 个`)).join('；')
}

function findNextMapBatch(rows: MapRow[], layerPlans: LayerPlan[], parentBatchSize: number): NextMapBatchPlan {
  const rootPlan = layerPlans[0]
  const rootRows = rows.filter((row) => row.level === 1)
  if (rootPlan && rootRows.length < rootPlan.count) {
    return { stage: 'root', targetDepth: 1, rootMissingCount: rootPlan.count - rootRows.length, pendingParentCount: rootPlan.count - rootRows.length }
  }
  for (let depth = 1; depth < layerPlans.length; depth += 1) {
    const childPlan = layerPlans[depth]
    const pendingParents = rows
      .filter((row) => row.level === depth)
      .map((row) => {
        const missingCount = childPlan.count - getChildrenOf(rows, row.id).length
        return missingCount > 0 ? { row, missingCount } : null
      })
      .filter((item): item is PendingParentPlan => Boolean(item))
    if (pendingParents.length > 0) {
      return { stage: 'children', targetDepth: childPlan.depth, parents: pendingParents.slice(0, parentBatchSize), pendingParentCount: pendingParents.length }
    }
  }
  return { stage: 'completed', targetDepth: null, pendingParentCount: 0 }
}

function buildMapBatchPreview(nextBatch: NextMapBatchPlan, parentBatchSize: number): MapNextBatchPreview {
  if (nextBatch.stage === 'completed') return { stage: 'completed', targetDepth: null, pendingParentCount: 0, batchCount: 0, plannedParentNames: [], batchKey: 'completed' }
  if (nextBatch.stage === 'root') {
    const batchCount = Math.min(parentBatchSize, nextBatch.rootMissingCount || 0)
    return { stage: 'root', targetDepth: 1, pendingParentCount: nextBatch.pendingParentCount, batchCount, plannedParentNames: [], batchKey: `root:${batchCount}:${nextBatch.rootMissingCount || 0}` }
  }
  const plannedParentNames = (nextBatch.parents || []).map((item) => item.row.name).filter(Boolean)
  return {
    stage: 'children',
    targetDepth: nextBatch.targetDepth,
    pendingParentCount: nextBatch.pendingParentCount,
    batchCount: plannedParentNames.length,
    plannedParentNames,
    batchKey: `children:${nextBatch.targetDepth}:${(nextBatch.parents || []).map((item) => `${item.row.id}:${item.missingCount}`).join(',')}`,
  }
}

function buildRootBatchPrompt(params: { novelTitle: string; genre: string; worldSummary: string; mapStructure: string; rootLabel: string; batchCount: number; existingRootNames: string[]; factionSummary?: string; mapSummary?: string; namedPlaces?: string; writingConstraints?: string }) {
  return [
    `请为小说《${params.novelTitle}》补充 ${params.batchCount} 个根层地图节点。`,
    `题材：${params.genre}`,
    params.worldSummary ? `世界规则：${params.worldSummary}` : '',
    `地图蓝图：${params.mapStructure}`,
    params.mapSummary ? `蓝图补充：${params.mapSummary}` : '',
    params.factionSummary ? `势力：${params.factionSummary}` : '',
    params.namedPlaces ? `已知地点：${params.namedPlaces}` : '',
    params.writingConstraints ? `写作约束：${params.writingConstraints}` : '',
    params.existingRootNames.length > 0 ? `已有根节点：${params.existingRootNames.join('、')}` : '当前还没有根节点。',
    `只生成 ${params.batchCount} 个第 1 层“${params.rootLabel}”节点，不要生成 children，不要跨层。`,
    '名称必须与已有根节点区分开，description/plot_relevance 至少一个有实质内容，children 返回空数组。',
    buildHumanLanguageRules(['description 写可直接落笔的空间特征。', 'plot_relevance 只写这个地点承接什么事件或冲突。']),
    '[{"name":"","node_type":"","location_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
}

function buildChildBatchPrompt(params: { novelTitle: string; genre: string; worldSummary: string; mapStructure: string; targetLabel: string; batchCount: number; parent: MapRow; parentPath: string; existingChildNames: string[]; factionSummary?: string; mapSummary?: string; namedPlaces?: string; writingConstraints?: string }) {
  return [
    `请为小说《${params.novelTitle}》补充 ${params.batchCount} 个直属子节点。`,
    `题材：${params.genre}`,
    params.worldSummary ? `世界规则：${params.worldSummary}` : '',
    `地图蓝图：${params.mapStructure}`,
    `父节点路径：${params.parentPath}`,
    `父节点名称：${params.parent.name}`,
    `父节点类型：${params.parent.nodeType || params.parent.locationType || '未设置'}`,
    params.parent.structureRole ? `父节点职责：${params.parent.structureRole}` : '',
    params.parent.description ? `父节点描述：${params.parent.description}` : '',
    params.parent.plotRelevance ? `父节点剧情作用：${params.parent.plotRelevance}` : '',
    params.existingChildNames.length > 0 ? `已有直属子节点：${params.existingChildNames.join('、')}` : '当前还没有直属子节点。',
    `只生成这个父节点下 ${params.batchCount} 个直属“${params.targetLabel}”节点，不要返回 grandchildren。`,
    '名称不能与已有直属子节点重名，description/plot_relevance 至少一个有实质内容，children 返回空数组。',
    buildHumanLanguageRules(['内容必须紧扣父节点，不要跳出当前层级乱扩设定。', 'plot_relevance 只写这个地点在剧情里的具体作用。']),
    '[{"name":"","node_type":"","location_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
}

function createAbortError() {
  const error = new Error('User cancelled')
  error.name = 'AbortError'
  return error
}

async function runMapPromptTask(params: { novelId: number; modelConfigId?: number; prompt: string; parentTaskId?: number; sender?: WebContents }) {
  const messages = [{ role: 'user' as const, content: params.prompt }]
  if (typeof params.parentTaskId !== 'number') {
    return runChatTask({ type: 'generate_map', novelId: params.novelId, modelConfigId: params.modelConfigId, messages, sender: params.sender })
  }
  const childTaskId = await createTask({ type: 'generate_map', novelId: params.novelId, modelConfigId: params.modelConfigId, inputJson: JSON.stringify(messages), runnerType: 'chat', parentTaskId: params.parentTaskId })
  updateTask(params.parentTaskId, { currentChildTaskId: childTaskId })
  try {
    return await executeChatTask(childTaskId, { type: 'generate_map', novelId: params.novelId, modelConfigId: params.modelConfigId, messages, sender: params.sender })
  } finally {
    updateTask(params.parentTaskId, { currentChildTaskId: null })
  }
}

function createNodesAtDepth(novelId: number, nodes: GeneratedMapNode[], depth: number, parent: MapRow | undefined, rulesRaw: ParsedWorldRules) {
  const defaultNodeType = getBlueprintLevelByDepth(rulesRaw, depth)?.nodeTypes[0] || (depth === 1 ? '区域' : '地点')
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

export async function batchGenerateMap(novelId: number, structure: MapBatchGenerateOptions, runtime: MapBatchGenerateRuntimeOptions = {}): Promise<MapBatchGenerationResult> {
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
  const nextBatch = findNextMapBatch(listMapRows(novelId), layerPlans, parentBatchSize)
  runtime.onBatchPlan?.(buildMapBatchPreview(nextBatch, parentBatchSize))
  if (nextBatch.stage === 'completed') return { stage: 'completed', targetDepth: null, generatedNodeCount: 0, processedParentCount: 0, pendingParentCount: 0, processedParentNames: [], completed: true, message: '地图蓝图已补齐，当前没有需要继续生成的批次。', nextDepth: null }

  let generatedNodeCount = 0
  const processedParentNames: string[] = []
  try {
    if (nextBatch.stage === 'root') {
      const rootPlan = layerPlans[0]
      if (!rootPlan) throw new Error('缺少根层蓝图')
      const rows = listMapRows(novelId)
      const existingRootNames = rows.filter((row) => row.level === 1).map((row) => row.name).filter(Boolean)
      const batchCount = Math.min(parentBatchSize, nextBatch.rootMissingCount || rootPlan.count)
      const prompt = buildRootBatchPrompt({ novelTitle: novel.title, genre: profile.genre, worldSummary: profile.worldRulesSummary, mapStructure: structureSummary, rootLabel: rootPlan.label, batchCount, existingRootNames, factionSummary, mapSummary, namedPlaces: structure.namedPlaces || '', writingConstraints })
      const result = await runMapPromptTask({ novelId, modelConfigId: novel.modelConfigId || undefined, prompt, parentTaskId: runtime.parentTaskId, sender: runtime.sender })
      const nodes = parseGeneratedNodeBatch(result)
      validateGeneratedNodes(nodes, batchCount, '根层', existingRootNames)
      generatedNodeCount += createNodesAtDepth(novelId, nodes, 1, undefined, rules)
      processedParentNames.push(...nodes.map((node) => asText(node.name)).filter(Boolean))
    } else {
      const targetDepth = nextBatch.targetDepth
      const targetPlan = targetDepth ? getBlueprintLevelByDepth(rules, targetDepth) : undefined
      const targetLayerPlan = targetDepth ? getLayerPlanByDepth(layerPlans, targetDepth) : undefined
      if (!targetDepth || !targetPlan || !targetLayerPlan || !nextBatch.parents?.length) throw new Error('无法确定当前地图批次')
      for (const plan of nextBatch.parents) {
        if (runtime.shouldStop?.()) throw createAbortError()
        const rows = listMapRows(novelId)
        const currentParent = rows.find((row) => row.id === plan.row.id)
        if (!currentParent) continue
        const existingChildren = getChildrenOf(rows, currentParent.id)
        const missingCount = targetLayerPlan.count - existingChildren.length
        if (missingCount <= 0) continue
        const prompt = buildChildBatchPrompt({ novelTitle: novel.title, genre: profile.genre, worldSummary: profile.worldRulesSummary, mapStructure: structureSummary, targetLabel: targetPlan.label, batchCount: missingCount, parent: currentParent, parentPath: buildNodePath(currentParent, rows), existingChildNames: existingChildren.map((row) => row.name).filter(Boolean), factionSummary, mapSummary, namedPlaces: structure.namedPlaces || '', writingConstraints })
        const result = await runMapPromptTask({ novelId, modelConfigId: novel.modelConfigId || undefined, prompt, parentTaskId: runtime.parentTaskId, sender: runtime.sender })
        const nodes = parseGeneratedNodeBatch(result)
        validateGeneratedNodes(nodes, missingCount, `${currentParent.name}下的${targetPlan.label}`, existingChildren.map((row) => row.name).filter(Boolean))
        generatedNodeCount += createNodesAtDepth(novelId, nodes, targetDepth, currentParent, rules)
        processedParentNames.push(currentParent.name)
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    console.error('地图分批生成失败:', error)
    throw new Error(error instanceof Error ? error.message : '地图生成结果解析失败，请重试')
  }
  if (generatedNodeCount > 0) markNovelContextChanged(novelId, 'Map structure changed')
  const nextState = findNextMapBatch(listMapRows(novelId), layerPlans, parentBatchSize)
  return {
    stage: nextBatch.stage,
    targetDepth: nextBatch.stage === 'root' ? 1 : nextBatch.targetDepth,
    generatedNodeCount,
    processedParentCount: processedParentNames.length,
    pendingParentCount: nextState.stage === 'completed' ? 0 : nextState.pendingParentCount,
    processedParentNames,
    completed: nextState.stage === 'completed',
    message: nextState.stage === 'completed' ? '地图蓝图已全部补齐。' : `本批已补齐 ${processedParentNames.join('、') || '根层'}。`,
    nextDepth: nextState.targetDepth,
  }
}
