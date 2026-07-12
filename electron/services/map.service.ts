import { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { mapRelations, novels, storyItems, timelineEvents, worldMap } from '../database/schema'
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
import type {
  MapBatchGenerateOptions,
  MapBatchGenerationResult,
  MapGraphPayload,
  MapGraphQueryInput,
  MapGraphNode,
  MapRelation,
  MapRelationInput,
} from '../../src/types'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { markNovelContextChanged } from './context-impact.service'
import {
  resolveFactionNamesFromReferences,
  stringifyFactionReferences,
} from './faction-reference.service'
import { cleanupMapSoftReferences } from './data-cascade.service'
import { refreshWorldStateVersionsForNovel } from './world-state.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import { logError, logInfo, logWarn } from '../utils/runtime-log'

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
type MapRelationRow = typeof mapRelations.$inferSelect

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

type MapContextVersionConflict = Error & {
  code?: string
  expectedContextVersion?: number
  currentContextVersion?: number
}

function getNovelContextVersion(novelId: number): number {
  const row = getDb().select({ contextVersion: novels.contextVersion })
    .from(novels)
    .where(eq(novels.id, novelId))
    .all()[0]
  if (!row) throwUserFacingError('novel.notFound')
  return row.contextVersion || 1
}

function assertMapContextVersion(novelId: number, expectedContextVersion: number): void {
  const currentContextVersion = getNovelContextVersion(novelId)
  if (currentContextVersion === expectedContextVersion) return

  const error = new Error(
    `地图生成期间项目上下文已从 v${expectedContextVersion} 变为 v${currentContextVersion}，本批结果未写入，请重新生成。`,
  ) as MapContextVersionConflict
  error.name = 'MapContextVersionConflictError'
  error.code = 'CONTEXT_VERSION_CONFLICT'
  error.expectedContextVersion = expectedContextVersion
  error.currentContextVersion = currentContextVersion
  throw error
}

function isMapContextVersionConflict(error: unknown): error is MapContextVersionConflict {
  return error instanceof Error && (error as MapContextVersionConflict).code === 'CONTEXT_VERSION_CONFLICT'
}

interface MapNodeQueryFilters {
  novelId: number
  parentId?: number | null
  level?: number
  keyword?: string
  page?: number
  pageSize?: number
}

interface ParseGeneratedNodeBatchContext {
  label: string
  expectedCount: number
  parentName?: string
}

const MAP_JSON_OUTPUT_RULES = [
  '只返回合法 JSON，不要写注释、说明、Markdown、代码块或省略号。',
  '所有字段值必须是完整的 JSON 字符串或数组，不要输出半截名称、半截句子或未闭合引号。',
  '如果字段内容里需要引号，请改写表达，不要输出未转义的双引号。',
]

const MAP_GENERATED_NODE_ALLOWED_KEYS = [
  'name',
  'node_type',
  'location_type',
  'structure_role',
  'description',
  'atmosphere',
  'plot_relevance',
  'tags',
  'affiliated_factions',
  'danger_level',
  'children',
]

const MAP_NODE_BATCH_SCHEMA = '[{"name":"","node_type":"","location_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]'

function cleanPromptText(value?: string | null): string {
  return value?.trim() || ''
}

function section(title: string, content?: string | null): string {
  const body = cleanPromptText(content)
  if (!body) return ''
  return `【${title}】\n${body}`
}

function renderPrompt(parts: Array<string | undefined | null | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n')
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function normalizeNameKey(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase()
}

function uniqueNumberArray(values: Array<number | null | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))]
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

function stringifyFactionReferenceInput(novelId: number, input: unknown): string {
  return novelId > 0 ? stringifyFactionReferences(novelId, input) : JSON.stringify(toStringArray(input))
}

function resolveFactionJson(novelId: number, raw?: string | null): string | undefined {
  const names = novelId > 0
    ? resolveFactionNamesFromReferences(novelId, raw)
    : parseJsonStringArray(raw)
  return names.length > 0 ? JSON.stringify(names) : undefined
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

function formatGeneratedNodeBatchTarget(context: ParseGeneratedNodeBatchContext): string {
  return context.parentName
    ? `${context.label}（父节点：${context.parentName}）`
    : context.label
}

function buildGeneratedNodeBatchError(context: ParseGeneratedNodeBatchContext, message: string): Error {
  const target = formatGeneratedNodeBatchTarget(context)
  return new Error(`${target} 当前批次返回的 JSON 无法解析：${message}。系统会按当前批次重试策略处理。`)
}

function sanitizeMapErrorMessage(error: unknown, fallback = '地图生成失败'): string {
  const raw = error instanceof Error ? error.message : fallback
  const normalized = raw
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/。原始输出片段：.*$/u, '')
    .replace(/。输出片段：.*$/u, '')
    .trim()
  return normalized || fallback
}

function previewText(text: string, max = 220): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max)
}

function buildMapNodeBatchRepairPrompt(context: ParseGeneratedNodeBatchContext, raw: string): string {
  return renderPrompt([
    `你现在只负责修复 ${formatGeneratedNodeBatchTarget(context)} 的 JSON 格式，不新增设定，不重写内容。`,
    section('任务目标', [
      `把下面的原始输出整理成一个合法的 JSON 数组，数组长度保持为 ${context.expectedCount}。`,
      `每个节点只允许保留这些键：${MAP_GENERATED_NODE_ALLOWED_KEYS.join(' / ')}`,
      'name、node_type、location_type、structure_role、description、atmosphere、plot_relevance、danger_level 必须是字符串。',
      'tags、affiliated_factions、children 必须是 JSON 数组，children 必须返回空数组。',
    ].join('\n')),
    section('原始输出', raw),
    section('强约束', [
      '不要补剧情，不要扩写，不要改事实方向。',
      '如果有代码块、解释文字、数组外包裹对象、多余字段或 children 的子内容，删除它们。',
      '如果字符串内部出现双引号，必须正确转义。',
      '只输出合法 JSON 数组，不要解释，不要 Markdown，不要注释。',
    ].join('\n')),
    `输出格式参考：${MAP_NODE_BATCH_SCHEMA}`,
  ])
}

function mapNodeBatchSchemaHint(expectedCount: number): string {
  return [
    `输出必须保持为 ${expectedCount} 个地图节点组成的 JSON 数组。`,
    '每个节点必须保留 name、node_type、location_type、structure_role、description、atmosphere、plot_relevance、tags、affiliated_factions、danger_level、children 字段。',
    'children 必须返回空数组，不要跨层扩展。',
  ].join('\n')
}

function parseGeneratedNodeBatch(raw: string, context: ParseGeneratedNodeBatchContext): GeneratedMapNode[] {
  let parsed: unknown
  try {
    parsed = cleanAiValue(safeParseJson<unknown>(raw))
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知解析错误'
    throw buildGeneratedNodeBatchError(context, message)
  }

  if (Array.isArray(parsed)) return toGeneratedNodes(parsed)
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>
    const preferred = toGeneratedNodes(record.nodes)
    if (preferred.length > 0) return preferred

    const fallback = toGeneratedNodes(record.items)
    if (fallback.length > 0) return fallback
  }

  throw buildGeneratedNodeBatchError(context, `返回结果不是长度为 ${context.expectedCount} 的节点数组`)
}

async function runMapPromptTaskWithJsonRepair<T>(
  params: {
    novelId: number
    modelConfigId?: number
    prompt: string
    parentTaskId?: number
    sender?: WebContents
    context: ParseGeneratedNodeBatchContext
    reviewContext: string
    reviewFocus?: string[]
    rewriteConstraints?: string[]
    parser: (raw: string) => T
  },
) : Promise<{ value: T; repaired: boolean; reviewWarning?: string }> {
  const raw = await runMapPromptTask({
    novelId: params.novelId,
    modelConfigId: params.modelConfigId,
    prompt: params.prompt,
    parentTaskId: params.parentTaskId,
    sender: params.sender,
  })

  let candidateRaw = raw
  let repaired = false

  try {
    params.parser(raw)
  } catch (initialError) {
    const initialMessage = sanitizeMapErrorMessage(initialError, `${formatGeneratedNodeBatchTarget(params.context)} 解析失败`)

    let repairedRaw = ''
    try {
      repairedRaw = await runMapPromptTask({
        novelId: params.novelId,
        modelConfigId: params.modelConfigId,
        prompt: buildMapNodeBatchRepairPrompt(params.context, raw),
        parentTaskId: params.parentTaskId,
        sender: params.sender,
      })
    } catch (repairTaskError) {
      throw new Error(`${formatGeneratedNodeBatchTarget(params.context)} JSON 解析失败，自动修复步骤执行失败：${sanitizeMapErrorMessage(repairTaskError)}。原始输出片段：${previewText(raw)}`)
    }

    try {
      params.parser(repairedRaw)
      candidateRaw = repairedRaw
      repaired = true
    } catch (repairError) {
      throw new Error(
        `${formatGeneratedNodeBatchTarget(params.context)} JSON 解析失败，已自动修复一次仍未成功。首轮原因：${initialMessage}。修复后原因：${sanitizeMapErrorMessage(repairError)}。原始输出片段：${previewText(raw)}`,
      )
    }
  }

  const quality = await runAssetQualityLoop({
    targetType: 'map',
    novelId: params.novelId,
    modelConfigId: params.modelConfigId,
    relatedEntityType: 'novel',
    relatedEntityId: params.novelId,
    parentTaskId: params.parentTaskId,
    sender: params.sender,
    contextSummary: params.reviewContext,
    generatedOutput: candidateRaw,
    schemaHint: mapNodeBatchSchemaHint(params.context.expectedCount),
    reviewFocus: params.reviewFocus,
    rewriteConstraints: params.rewriteConstraints,
  })
  if (quality.stage === 'rejected') {
    throw new Error(`${formatGeneratedNodeBatchTarget(params.context)} 审校拒收：${summarizeAssetQualityWarnings(quality) || quality.review.summary}`)
  }

  return {
    value: params.parser(quality.finalOutput),
    repaired,
    reviewWarning: summarizeAssetQualityWarnings(quality) || undefined,
  }
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

function sanitizeMapPayload(novelId: number, data: Partial<typeof worldMap.$inferInsert>): Partial<typeof worldMap.$inferInsert> {
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
  if ('affiliatedFactionIdsJson' in data) next.affiliatedFactionIdsJson = stringifyFactionReferenceInput(novelId, data.affiliatedFactionIdsJson)
  if (typeof data.dangerLevel === 'string') next.dangerLevel = asText(data.dangerLevel)
  if (typeof data.sortOrder === 'number') next.sortOrder = Math.max(0, Math.round(data.sortOrder))
  return next
}

function mapNodeSummaryRecord(row: Record<string, unknown>) {
  const novelId = Number(row.novel_id)
  return {
    id: Number(row.id),
    novelId,
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
    affiliatedFactionIdsJson: resolveFactionJson(novelId, typeof row.affiliated_faction_ids_json === 'string' ? row.affiliated_faction_ids_json : undefined),
    dangerLevel: typeof row.danger_level === 'string' ? row.danger_level : undefined,
    sortOrder: Number(row.sort_order || 0),
    childCount: Number(row.childCount || 0),
  }
}

function mapRelationRecord(row: Record<string, unknown>): MapRelation {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    mapAId: Number(row.map_a_id),
    mapBId: Number(row.map_b_id),
    relationType: typeof row.relation_type === 'string' ? row.relation_type : undefined,
    relationLabel: typeof row.relation_label === 'string' ? row.relation_label : undefined,
    bilateral: Number(row.bilateral || 0),
    description: typeof row.description === 'string' ? row.description : undefined,
    intensity: typeof row.intensity === 'string' ? row.intensity : undefined,
    colorHint: typeof row.color_hint === 'string' ? row.color_hint : undefined,
    sortOrder: Number(row.sort_order || 0),
  }
}

function parseJsonStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function buildMapGraphSummary(row: MapRow): string {
  return [
    row.plotRelevance,
    row.description,
    row.structureRole,
    row.atmosphere,
  ].find((item) => typeof item === 'string' && item.trim())?.trim() || ''
}

function buildMapGraphNode(row: MapRow, graphRole: MapGraphNode['graphRole'], childCount: number): MapGraphNode {
  const affiliatedFactionIdsJson = resolveFactionJson(row.novelId, row.affiliatedFactionIdsJson)
  const affiliatedFactions = resolveFactionNamesFromReferences(row.novelId, row.affiliatedFactionIdsJson)
  return {
    id: row.id,
    novelId: row.novelId,
    level: row.level,
    parentId: row.parentId == null ? undefined : row.parentId,
    name: row.name,
    locationType: row.locationType || undefined,
    nodeType: row.nodeType || undefined,
    structureRole: row.structureRole || undefined,
    parentRuleType: row.parentRuleType || undefined,
    description: row.description || undefined,
    atmosphere: row.atmosphere || undefined,
    plotRelevance: row.plotRelevance || undefined,
    tagsJson: row.tagsJson || undefined,
    affiliatedFactionIdsJson,
    dangerLevel: row.dangerLevel || undefined,
    sortOrder: row.sortOrder || 0,
    childCount,
    graphRole,
    tags: parseJsonStringArray(row.tagsJson),
    affiliatedFactions,
    summaryText: buildMapGraphSummary(row),
  }
}

function getAncestorIds(rowById: Map<number, MapRow>, startId: number): number[] {
  const ids: number[] = []
  let current = rowById.get(startId)
  while (current && typeof current.parentId === 'number') {
    ids.unshift(current.parentId)
    current = rowById.get(current.parentId)
  }
  return ids
}

function buildRelationAdjacency(relations: MapRelation[]): Map<number, MapRelation[]> {
  const adjacency = new Map<number, MapRelation[]>()
  relations.forEach((relation) => {
    const existingA = adjacency.get(relation.mapAId) || []
    existingA.push(relation)
    adjacency.set(relation.mapAId, existingA)

    const existingB = adjacency.get(relation.mapBId) || []
    existingB.push(relation)
    adjacency.set(relation.mapBId, existingB)
  })
  return adjacency
}

function getNodeGraphRole(params: {
  id: number
  focusNodeId?: number
  rootNodeIds: Set<number>
  ancestorIds: Set<number>
  descendantIds: Set<number>
  siblingIds: Set<number>
  relationNodeIds: Set<number>
}): MapGraphNode['graphRole'] {
  if (typeof params.focusNodeId === 'number' && params.id === params.focusNodeId) return 'focus'
  if (params.ancestorIds.has(params.id)) return 'ancestor'
  if (params.descendantIds.has(params.id)) return 'descendant'
  if (params.siblingIds.has(params.id)) return 'sibling'
  if (params.relationNodeIds.has(params.id)) return 'related'
  return params.rootNodeIds.has(params.id) ? 'root' : 'descendant'
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

export function getMapRelations(novelId: number, focusNodeId?: number): MapRelation[] {
  const sqlite = getSqlite()
  const rows = typeof focusNodeId === 'number'
    ? sqlite.prepare(`
      SELECT *
      FROM map_relations
      WHERE novel_id = ?
        AND (map_a_id = ? OR map_b_id = ?)
      ORDER BY sort_order ASC, id ASC
    `).all(novelId, focusNodeId, focusNodeId) as Array<Record<string, unknown>>
    : sqlite.prepare(`
      SELECT *
      FROM map_relations
      WHERE novel_id = ?
      ORDER BY sort_order ASC, id ASC
    `).all(novelId) as Array<Record<string, unknown>>
  return rows.map(mapRelationRecord)
}

export function getMapGraph(filters: MapGraphQueryInput): MapGraphPayload {
  const rows = listMapRows(filters.novelId)
  if (rows.length === 0) {
    return { nodes: [], edges: [], focusNodeId: filters.focusNodeId, relationNodeIds: [], rootNodeIds: [] }
  }

  const rowById = new Map(rows.map((row) => [row.id, row]))
  const childCountByParentId = new Map<number, number>()
  rows.forEach((row) => {
    if (typeof row.parentId !== 'number') return
    childCountByParentId.set(row.parentId, (childCountByParentId.get(row.parentId) || 0) + 1)
  })

  const rootNodeIds = rows.filter((row) => row.level === 1).map((row) => row.id)
  const allRelations = getMapRelations(filters.novelId)
  const adjacency = buildRelationAdjacency(allRelations)
  const relationDepth = Math.max(1, Math.min(2, Math.round(filters.relationDepth || 1)))
  const visibleIds = new Set<number>()
  const ancestorIds = new Set<number>()
  const descendantIds = new Set<number>()
  const siblingIds = new Set<number>()
  const relationNodeIds = new Set<number>()
  const includeRelationEdges = filters.includeRelationEdges !== false

  if (typeof filters.focusNodeId === 'number' && rowById.has(filters.focusNodeId)) {
    visibleIds.add(filters.focusNodeId)

    getAncestorIds(rowById, filters.focusNodeId).forEach((id) => {
      ancestorIds.add(id)
      visibleIds.add(id)
    })

    rows.filter((row) => row.parentId === filters.focusNodeId).forEach((row) => {
      descendantIds.add(row.id)
      visibleIds.add(row.id)
    })

    const focusRow = rowById.get(filters.focusNodeId)
    if (filters.includeSiblingNodes !== false && typeof focusRow?.parentId === 'number') {
      rows.filter((row) => row.parentId === focusRow.parentId && row.id !== filters.focusNodeId).forEach((row) => {
        siblingIds.add(row.id)
        visibleIds.add(row.id)
      })
    }

    let frontier = new Set<number>([filters.focusNodeId])
    for (let depth = 0; depth < relationDepth; depth += 1) {
      const nextFrontier = new Set<number>()
      frontier.forEach((sourceId) => {
        ;(adjacency.get(sourceId) || []).forEach((relation) => {
          const targetId = relation.mapAId === sourceId ? relation.mapBId : relation.mapAId
          if (!rowById.has(targetId)) return
          relationNodeIds.add(targetId)
          visibleIds.add(targetId)
          if (!frontier.has(targetId)) nextFrontier.add(targetId)
        })
      })
      frontier = nextFrontier
    }
  } else {
    rows.forEach((row) => visibleIds.add(row.id))
  }

  const nodes = rows
    .filter((row) => visibleIds.has(row.id))
    .map((row) => buildMapGraphNode(
      row,
      getNodeGraphRole({
        id: row.id,
        focusNodeId: filters.focusNodeId,
        rootNodeIds: new Set(rootNodeIds),
        ancestorIds,
        descendantIds,
        siblingIds,
        relationNodeIds,
      }),
      childCountByParentId.get(row.id) || 0,
    ))
    .sort((a, b) => a.level - b.level || a.sortOrder - b.sortOrder || a.id - b.id)

  const edges: MapGraphPayload['edges'] = []
  rows.forEach((row) => {
    if (typeof row.parentId !== 'number') return
    if (!visibleIds.has(row.id) || !visibleIds.has(row.parentId)) return
    edges.push({
      id: `hierarchy:${row.parentId}:${row.id}`,
      sourceId: row.parentId,
      targetId: row.id,
      edgeKind: 'hierarchy',
    })
  })

  if (includeRelationEdges) {
    allRelations.forEach((relation) => {
      if (!visibleIds.has(relation.mapAId) || !visibleIds.has(relation.mapBId)) return
      edges.push({
        id: `relation:${relation.id}`,
        sourceId: relation.mapAId,
        targetId: relation.mapBId,
        edgeKind: 'relation',
        relationId: relation.id,
        relationType: relation.relationType,
        relationLabel: relation.relationLabel,
        description: relation.description,
        bilateral: relation.bilateral,
        colorHint: relation.colorHint,
      })
    })
  }

  return {
    nodes,
    edges,
    focusNodeId: typeof filters.focusNodeId === 'number' ? filters.focusNodeId : undefined,
    relationNodeIds: [...relationNodeIds],
    rootNodeIds,
  }
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
        affiliatedFactionIdsJson: resolveFactionJson(item.novelId, item.affiliatedFactionIdsJson) || null,
        dangerLevel: item.dangerLevel,
        children: buildTree(item.id),
      }))
  }
  return buildTree(null)
}

export function createMapItem(novelId: number, data: Partial<typeof worldMap.$inferInsert> & { level: number; name: string }, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const payload = sanitizeMapPayload(novelId, data)
  const result = db.insert(worldMap).values({
    ...payload,
    novelId,
    level: payload.level ?? data.level,
    name: payload.name ?? data.name,
  }).run()
  const id = Number(result.lastInsertRowid)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Map structure changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
  return id
}

function sanitizeMapRelationInput(data: MapRelationInput): MapRelationInput {
  return {
    id: typeof data.id === 'number' ? data.id : undefined,
    novelId: Number(data.novelId),
    mapAId: Number(data.mapAId),
    mapBId: Number(data.mapBId),
    relationType: asText(data.relationType),
    relationLabel: asText(data.relationLabel),
    bilateral: Number(data.bilateral ?? 1) > 0 ? 1 : 0,
    description: asText(data.description),
    intensity: asText(data.intensity),
    colorHint: asText(data.colorHint),
    sortOrder: typeof data.sortOrder === 'number' ? Math.max(0, Math.round(data.sortOrder)) : 0,
  }
}

function findExistingMapRelation(data: MapRelationInput): MapRelationRow | undefined {
  const db = getDb()
  const relations = db.select().from(mapRelations).where(eq(mapRelations.novelId, data.novelId)).all()
  return relations.find((relation) => {
    if (typeof data.id === 'number' && relation.id === data.id) return true
    const sameDirection = relation.mapAId === data.mapAId && relation.mapBId === data.mapBId
    const reverseDirection = relation.mapAId === data.mapBId && relation.mapBId === data.mapAId
    const matchesPair = data.bilateral ? (sameDirection || reverseDirection) : sameDirection
    if (!matchesPair) return false
    const sameType = (relation.relationType || '') === (data.relationType || '')
    const sameLabel = (relation.relationLabel || '') === (data.relationLabel || '')
    return sameType && sameLabel
  })
}

export function upsertMapRelation(input: MapRelationInput) {
  const db = getDb()
  const data = sanitizeMapRelationInput(input)
  if (!Number.isFinite(data.novelId) || !Number.isFinite(data.mapAId) || !Number.isFinite(data.mapBId)) {
    throwUserFacingError('map.relation.invalidParams')
  }
  if (data.mapAId === data.mapBId) throwUserFacingError('map.relation.sameNode')

  const nodeA = db.select().from(worldMap).where(eq(worldMap.id, data.mapAId)).all()[0]
  const nodeB = db.select().from(worldMap).where(eq(worldMap.id, data.mapBId)).all()[0]
  if (!nodeA || !nodeB || nodeA.novelId !== data.novelId || nodeB.novelId !== data.novelId) {
    throwUserFacingError('map.relation.nodeMismatch')
  }

  const existing = findExistingMapRelation(data)
  const payload = {
    novelId: data.novelId,
    mapAId: data.mapAId,
    mapBId: data.mapBId,
    relationType: data.relationType || null,
    relationLabel: data.relationLabel || null,
    bilateral: data.bilateral ?? 1,
    description: data.description || null,
    intensity: data.intensity || null,
    colorHint: data.colorHint || null,
    sortOrder: data.sortOrder ?? 0,
  }

  if (existing) {
    db.update(mapRelations).set(payload).where(eq(mapRelations.id, existing.id)).run()
  } else {
    db.insert(mapRelations).values(payload).run()
  }

  markNovelContextChanged(data.novelId, 'Map relations changed')
  refreshWorldStateVersionsForNovel(data.novelId)
}

export function deleteMapRelation(id: number) {
  const db = getDb()
  const current = db.select().from(mapRelations).where(eq(mapRelations.id, id)).all()[0]
  db.delete(mapRelations).where(eq(mapRelations.id, id)).run()
  if (current) {
    markNovelContextChanged(current.novelId, 'Map relations changed')
    refreshWorldStateVersionsForNovel(current.novelId)
  }
}

export function updateMapItem(id: number, data: Partial<typeof worldMap.$inferInsert>, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
  if (!current) return
  db.update(worldMap).set(sanitizeMapPayload(current.novelId, data)).where(eq(worldMap.id, id)).run()
  if (!options.skipContextTracking) {
    if (current) {
      markNovelContextChanged(current.novelId, 'Map structure changed')
      refreshWorldStateVersionsForNovel(current.novelId)
    }
  }
}

function deleteMapItemCascade(id: number): void {
  const db = getDb()
  const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
  if (!current) return
  const children = db.select().from(worldMap).where(eq(worldMap.parentId, id)).all()
  for (const child of children) deleteMapItemCascade(child.id)
  cleanupMapSoftReferences(current.novelId, id)
  db.delete(worldMap).where(eq(worldMap.id, id)).run()
}

export function deleteMapItem(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(worldMap).where(eq(worldMap.id, id)).all()[0]
  getSqlite().transaction(() => {
    deleteMapItemCascade(id)
  })()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Map structure changed')
    refreshWorldStateVersionsForNovel(current.novelId)
  }
}

export function clearMapByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  db.update(timelineEvents).set({ locationMapId: null, updatedAt: new Date().toISOString() }).where(eq(timelineEvents.novelId, novelId)).run()
  db.update(storyItems).set({ locationMapId: null, updatedAt: new Date().toISOString() }).where(eq(storyItems.novelId, novelId)).run()
  db.delete(worldMap).where(eq(worldMap.novelId, novelId)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Map structure changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
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
    ...MAP_JSON_OUTPUT_RULES,
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
    ...MAP_JSON_OUTPUT_RULES,
    buildHumanLanguageRules(['内容必须紧扣父节点，不要跳出当前层级乱扩设定。', 'plot_relevance 只写这个地点在剧情里的具体作用。']),
    '[{"name":"","node_type":"","location_type":"","structure_role":"","description":"","atmosphere":"","plot_relevance":"","tags":["标签1"],"affiliated_factions":["势力1"],"danger_level":"","children":[]}]',
  ].filter(Boolean).join('\n')
}

function createAbortError() {
  const error = new Error('用户已取消')
  error.name = 'AbortError'
  return error
}

function getInlineBatchRetryLimit(structure: MapBatchGenerateOptions, runtime: MapBatchGenerateRuntimeOptions): number {
  if (typeof runtime.parentTaskId === 'number') return 0
  const retries = typeof structure.maxRetries === 'number' ? structure.maxRetries : 2
  return Math.max(0, Math.min(5, Math.round(retries)))
}

async function runBatchWithRetries<T>(
  execute: () => Promise<T>,
  retryLimit: number,
  label: string,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    try {
      return await execute()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      if (isMapContextVersionConflict(error)) throw error
      lastError = error
      if (attempt >= retryLimit) break
      logWarn('map', '地图批次执行失败，准备重试。', {
        consoleSummary: `[map:warn] batch-retry label=${label} attempt=${attempt + 1}/${retryLimit + 1}`,
        context: {
          label,
          attempt: attempt + 1,
          maxAttempts: retryLimit + 1,
        },
        error,
      })
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`${label}执行失败`)
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
  if (!novel) throwUserFacingError('novel.notFound')
  const expectedContextVersion = novel.contextVersion || 1
  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const layerPlans = getLayerPlans(structure, rules)
  const structureSummary = buildMapStructureSummary(layerPlans)
  const factionSummary = getFactionNameOptions(rules).join('、')
  const mapSummary = buildMapBlueprintSummary(rules)
  const writingConstraints = rules.writingConstraints.extraRules.join('；')
  const parentBatchSize = clampBatchSize(structure.parentBatchSize)
  const inlineBatchRetryLimit = getInlineBatchRetryLimit(structure, runtime)
  const nextBatch = findNextMapBatch(listMapRows(novelId), layerPlans, parentBatchSize)
  runtime.onBatchPlan?.(buildMapBatchPreview(nextBatch, parentBatchSize))
  if (nextBatch.stage === 'completed') return { stage: 'completed', targetDepth: null, generatedNodeCount: 0, processedParentCount: 0, pendingParentCount: 0, processedParentNames: [], completed: true, message: '地图蓝图已补齐，当前没有需要继续生成的批次。', nextDepth: null }

  let generatedNodeCount = 0
  const processedParentNames: string[] = []
  try {
    if (nextBatch.stage === 'root') {
      const rootPlan = layerPlans[0]
      if (!rootPlan) throwUserFacingError('map.rootPlanMissing')
      const rows = listMapRows(novelId)
      const existingRootNames = rows.filter((row) => row.level === 1).map((row) => row.name).filter(Boolean)
      const batchCount = Math.min(parentBatchSize, nextBatch.rootMissingCount || rootPlan.count)
      const prompt = buildRootBatchPrompt({ novelTitle: novel.title, genre: profile.genre, worldSummary: profile.worldRulesSummary, mapStructure: structureSummary, rootLabel: rootPlan.label, batchCount, existingRootNames, factionSummary, mapSummary, namedPlaces: structure.namedPlaces || '', writingConstraints })
      const nodes = await runBatchWithRetries(async () => {
        const context = {
          label: '根层节点',
          expectedCount: batchCount,
        }
        const { value: parsed, repaired, reviewWarning } = await runMapPromptTaskWithJsonRepair({
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          prompt,
          parentTaskId: runtime.parentTaskId,
          sender: runtime.sender,
          context,
          reviewContext: [
            `题材：${profile.genre}`,
            profile.background ? `背景：${profile.background}` : '',
            profile.worldRulesSummary ? `世界规则：${profile.worldRulesSummary}` : '',
            `地图蓝图：${structureSummary}`,
            mapSummary ? `蓝图补充：${mapSummary}` : '',
            factionSummary ? `势力：${factionSummary}` : '',
            structure.namedPlaces ? `已知地点：${structure.namedPlaces}` : '',
            `本批目标：根层 ${rootPlan.label} 节点 ${batchCount} 个，禁止跨层。`,
            existingRootNames.length > 0 ? `已有根节点：${existingRootNames.join('、')}` : '当前还没有根节点。',
          ].filter(Boolean).join('\n\n'),
          reviewFocus: [
            '地点职责、层级和剧情作用必须具体，不能只是空泛地名模板。',
            'plot_relevance 要写清这个地点承接什么事件或冲突。',
          ],
          rewriteConstraints: [
            '保持节点数组长度不变。',
            'children 必须保持空数组，不要擅自生成子层节点。',
          ],
          parser: (raw) => parseGeneratedNodeBatch(raw, context),
        })
        if (repaired) {
          logInfo('map', '地图根层批次 JSON 已自动修复一次后继续使用。', {
            consoleSummary: '[map:info] root-batch-json-repaired',
            context: {
              batchCount,
              rootLabel: rootPlan.label,
            },
          })
        }
        if (reviewWarning) {
          logInfo('map', '地图根层批次已通过资产审校并附带修正提示。', {
            consoleSummary: '[map:info] root-batch-quality-reviewed',
            context: {
              batchCount,
              rootLabel: rootPlan.label,
              reviewWarning,
            },
          })
        }
        validateGeneratedNodes(parsed, batchCount, '根层', existingRootNames)
        return parsed
      }, inlineBatchRetryLimit, 'map root batch')
      assertMapContextVersion(novelId, expectedContextVersion)
      generatedNodeCount += createNodesAtDepth(novelId, nodes, 1, undefined, rules)
      processedParentNames.push(...nodes.map((node) => asText(node.name)).filter(Boolean))
    } else {
      const targetDepth = nextBatch.targetDepth
      const targetPlan = targetDepth ? getBlueprintLevelByDepth(rules, targetDepth) : undefined
      const targetLayerPlan = targetDepth ? getLayerPlanByDepth(layerPlans, targetDepth) : undefined
      if (!targetDepth || !targetPlan || !targetLayerPlan || !nextBatch.parents?.length) {
        throwUserFacingError('map.batchUndetermined')
      }
      for (const plan of nextBatch.parents) {
        if (runtime.shouldStop?.()) throw createAbortError()
        const rows = listMapRows(novelId)
        const currentParent = rows.find((row) => row.id === plan.row.id)
        if (!currentParent) continue
        const existingChildren = getChildrenOf(rows, currentParent.id)
        const missingCount = targetLayerPlan.count - existingChildren.length
        if (missingCount <= 0) continue
        const prompt = buildChildBatchPrompt({ novelTitle: novel.title, genre: profile.genre, worldSummary: profile.worldRulesSummary, mapStructure: structureSummary, targetLabel: targetPlan.label, batchCount: missingCount, parent: currentParent, parentPath: buildNodePath(currentParent, rows), existingChildNames: existingChildren.map((row) => row.name).filter(Boolean), factionSummary, mapSummary, namedPlaces: structure.namedPlaces || '', writingConstraints })
        const nodes = await runBatchWithRetries(async () => {
          const context = {
            label: `${targetPlan.label} 节点`,
            expectedCount: missingCount,
            parentName: currentParent.name,
          }
          const { value: parsed, repaired, reviewWarning } = await runMapPromptTaskWithJsonRepair({
            novelId,
            modelConfigId: novel.modelConfigId || undefined,
            prompt,
            parentTaskId: runtime.parentTaskId,
            sender: runtime.sender,
            context,
            reviewContext: [
              `题材：${profile.genre}`,
              profile.background ? `背景：${profile.background}` : '',
              profile.worldRulesSummary ? `世界规则：${profile.worldRulesSummary}` : '',
              `地图蓝图：${structureSummary}`,
              mapSummary ? `蓝图补充：${mapSummary}` : '',
              factionSummary ? `势力：${factionSummary}` : '',
              `父节点路径：${buildNodePath(currentParent, rows)}`,
              `父节点名称：${currentParent.name}`,
              currentParent.nodeType || currentParent.locationType ? `父节点类型：${currentParent.nodeType || currentParent.locationType}` : '',
              currentParent.structureRole ? `父节点职责：${currentParent.structureRole}` : '',
              currentParent.plotRelevance ? `父节点剧情作用：${currentParent.plotRelevance}` : '',
              `本批目标：为该父节点补 ${missingCount} 个 ${targetPlan.label} 直属子节点，禁止跨层。`,
              existingChildren.length > 0 ? `已有直属子节点：${existingChildren.map((row) => row.name).filter(Boolean).join('、')}` : '当前还没有直属子节点。',
            ].filter(Boolean).join('\n\n'),
            reviewFocus: [
              '子节点必须紧扣父节点职责和层级，不能跳层扩世界设定。',
              '地点描述和剧情作用必须具体，避免模板腔。',
            ],
            rewriteConstraints: [
              '保持节点数组长度不变。',
              'children 必须保持空数组，不要返回 grandchildren。',
            ],
            parser: (raw) => parseGeneratedNodeBatch(raw, context),
          })
          if (repaired) {
            logInfo('map', '地图子节点批次 JSON 已自动修复一次后继续使用。', {
              consoleSummary: `[map:info] child-batch-json-repaired parent_id=${currentParent.id}`,
              context: {
                parentId: currentParent.id,
                parentName: currentParent.name,
                targetLabel: targetPlan.label,
                batchCount: missingCount,
              },
            })
          }
          if (reviewWarning) {
            logInfo('map', '地图子节点批次已通过资产审校并附带修正提示。', {
              consoleSummary: `[map:info] child-batch-quality-reviewed parent_id=${currentParent.id}`,
              context: {
                parentId: currentParent.id,
                parentName: currentParent.name,
                targetLabel: targetPlan.label,
                reviewWarning,
              },
            })
          }
          validateGeneratedNodes(parsed, missingCount, `${currentParent.name}下的${targetPlan.label}`, existingChildren.map((row) => row.name).filter(Boolean))
          return parsed
        }, inlineBatchRetryLimit, `map child batch ${currentParent.id}`)
        assertMapContextVersion(novelId, expectedContextVersion)
        generatedNodeCount += createNodesAtDepth(novelId, nodes, targetDepth, currentParent, rules)
        processedParentNames.push(currentParent.name)
      }
    }
  } catch (error) {
    if ((error instanceof Error && error.name === 'AbortError') || isMapContextVersionConflict(error)) throw error
    logError('map', '地图分批生成失败。', {
      consoleSummary: '[map:error] batch-generation-failed',
      error,
    })
    throw new Error(sanitizeMapErrorMessage(error, '地图生成结果解析失败，请重试'))
  }
  if (generatedNodeCount > 0) {
    assertMapContextVersion(novelId, expectedContextVersion)
    markNovelContextChanged(novelId, 'Map structure changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
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

export interface MapGenerateToTargetResult {
  totalGeneratedNodeCount: number
  batchesRun: number
  completed: boolean
  lastResult: MapBatchGenerationResult | null
  message: string
}

/**
 * batchGenerateMap 单次只推进一个批次；同步调用方（脚本、一次性补齐入口）
 * 用本函数循环到蓝图补齐或无进展为止。UI 的异步版本走 workflow-task 的 map_auto_generate。
 */
export async function batchGenerateMapToTarget(
  novelId: number,
  structure: MapBatchGenerateOptions,
  runtime: MapBatchGenerateRuntimeOptions & { maxBatches?: number; targetNodeCount?: number } = {},
): Promise<MapGenerateToTargetResult> {
  const maxBatches = Math.max(1, Math.min(12, Math.round(runtime.maxBatches ?? 8)))
  // targetNodeCount：调用方只要求“够 N 个节点”时提前停，不必按蓝图层级钻到底（省时省钱）。
  const targetNodeCount = runtime.targetNodeCount && runtime.targetNodeCount > 0
    ? Math.round(runtime.targetNodeCount)
    : 0
  let totalGeneratedNodeCount = 0
  let batchesRun = 0
  let lastResult: MapBatchGenerationResult | null = null
  while (batchesRun < maxBatches) {
    if (runtime.shouldStop?.()) break
    if (targetNodeCount > 0 && listMapRows(novelId).length >= targetNodeCount) {
      return {
        totalGeneratedNodeCount,
        batchesRun,
        completed: true,
        lastResult,
        message: `已达到目标节点数量 ${targetNodeCount}，提前结束地图批量生成。`,
      }
    }
    const result = await batchGenerateMap(novelId, structure, runtime)
    lastResult = result
    batchesRun += 1
    totalGeneratedNodeCount += result.generatedNodeCount
    if (result.completed || result.stage === 'completed') {
      return {
        totalGeneratedNodeCount,
        batchesRun,
        completed: true,
        lastResult: result,
        message: result.message,
      }
    }
    // 本批没有任何推进说明生成被拒或反复失败，中断以避免无效循环烧额度。
    if (result.generatedNodeCount <= 0) break
  }
  return {
    totalGeneratedNodeCount,
    batchesRun,
    completed: Boolean(lastResult?.completed),
    lastResult,
    message: lastResult?.message || '地图批量生成没有推进任何批次。',
  }
}
