import type {
  MapAutoGenerateStatus,
  MapBatchGenerateOptions,
  MapGraphPayload,
  MapNodeSummary,
  MapRelation,
  MapStats,
  PagedResult,
  WorldMapItem,
} from '../../../types'

export interface DetailFormValues {
  name: string
  locationType?: string
  nodeType?: string
  structureRole?: string
  description?: string
  atmosphere?: string
  plotRelevance?: string
  dangerLevel?: string
  tags: string[]
  affiliatedFactions: string[]
}

export interface RelationFormValues {
  mapAId?: number
  mapBId?: number
  relationType?: string
  relationLabel?: string
  bilateral?: boolean
  description?: string
  intensity?: string
  colorHint?: string
  sortOrder?: number
}

export interface RefreshVisibleOptions {
  preferredId?: number | null
  parent?: MapNodeSummary | null
  rootPage?: number
  branchPage?: number
  keyword?: string
}

export interface GraphFilterState {
  relationDepth: number
  includeSiblingNodes: boolean
  includeRelationEdges: boolean
  showHierarchyEdges: boolean
  showSummary: boolean
  showMeta: boolean
}

export interface FlattenedTree {
  flat: MapNodeSummary[]
  byId: Map<number, MapNodeSummary>
  pathById: Map<number, MapNodeSummary[]>
}

export type WorkspaceMode = 'list' | 'graph'

export const PAGE_SIZE = 20
export const EMPTY_PAGE: PagedResult<MapNodeSummary> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
export const EMPTY_STATS: MapStats = { total: 0, rootCount: 0, secondLevelCount: 0, leafCount: 0, maxDepth: 0, countsByLevel: [] }
export const EMPTY_AUTO_STATUS: MapAutoGenerateStatus = { taskId: 0, novelId: 0, status: 'pending', currentStage: 'idle', targetDepth: null, currentParentName: '', generatedNodeCount: 0, processedParentCount: 0, pendingParentCount: 0, retryCount: 0, lastError: '', completed: false, message: '', currentBatchKey: '' }
export const EMPTY_GRAPH: MapGraphPayload = { nodes: [], edges: [], relationNodeIds: [], rootNodeIds: [] }

export const DEFAULT_GRAPH_FILTERS: GraphFilterState = {
  relationDepth: 1,
  includeSiblingNodes: true,
  includeRelationEdges: false,
  showHierarchyEdges: true,
  showSummary: false,
  showMeta: false,
}

export const RELATION_TYPE_OPTIONS = [
  { value: 'adjacent', label: '相邻 / 接壤', color: '#C28C32' },
  { value: 'transport', label: '交通 / 通路', color: '#2D7DB2' },
  { value: 'control', label: '控制 / 归属', color: '#8B4AA8' },
  { value: 'hostile', label: '敌对 / 封锁', color: '#B74444' },
  { value: 'trade', label: '贸易 / 补给', color: '#2F8D61' },
  { value: 'pollution', label: '污染 / 外溢', color: '#7D5A3E' },
  { value: 'secret_link', label: '隐蔽通道', color: '#4C63B6' },
] as const

export const RELATION_INTENSITY_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'critical', label: '极高' },
]

export function parseStringArrayJson(raw?: string) {
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

export function toFormValues(node: MapNodeSummary): DetailFormValues {
  return {
    name: node.name,
    locationType: node.locationType || '',
    nodeType: node.nodeType || '',
    structureRole: node.structureRole || '',
    description: node.description || '',
    atmosphere: node.atmosphere || '',
    plotRelevance: node.plotRelevance || '',
    dangerLevel: node.dangerLevel || '',
    tags: parseStringArrayJson(node.tagsJson),
    affiliatedFactions: parseStringArrayJson(node.affiliatedFactionIdsJson),
  }
}

export function buildGenerateOptions(
  values: Record<string, unknown>,
  blueprintLevels: Array<{ depth: number; suggestedCount: number }>,
): MapBatchGenerateOptions {
  return {
    layerCounts: blueprintLevels.map((level) => ({
      depth: level.depth,
      count: Number(values[`layer_${level.depth}`] || level.suggestedCount),
    })),
    namedPlaces: typeof values.namedPlaces === 'string' ? values.namedPlaces : '',
    parentBatchSize: Number(values.parentBatchSize || 1),
    maxRetries: Number(values.maxRetries || 2),
  }
}

export function buildInitialBatchFormValues(blueprintLevels: Array<{ depth: number; suggestedCount: number }>): Record<string, number> {
  const initialValues: Record<string, number> = { parentBatchSize: 1, maxRetries: 2 }
  blueprintLevels.forEach((level) => {
    initialValues[`layer_${level.depth}`] = level.suggestedCount
  })
  return initialValues
}

export function mapTreeItemToSummary(item: WorldMapItem): MapNodeSummary {
  return {
    id: item.id,
    novelId: item.novelId,
    level: item.level,
    parentId: item.parentId,
    name: item.name,
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
    sortOrder: item.sortOrder,
    childCount: Array.isArray(item.children) ? item.children.length : 0,
  }
}

export function flattenTree(items: WorldMapItem[], trail: MapNodeSummary[] = [], result?: FlattenedTree): FlattenedTree {
  const current = result || {
    flat: [],
    byId: new Map<number, MapNodeSummary>(),
    pathById: new Map<number, MapNodeSummary[]>(),
  }

  items.forEach((item) => {
    const summary = mapTreeItemToSummary(item)
    const path = [...trail, summary]
    current.flat.push(summary)
    current.byId.set(summary.id, summary)
    current.pathById.set(summary.id, path)
    if (Array.isArray(item.children) && item.children.length > 0) flattenTree(item.children, path, current)
  })

  return current
}

export function getRelationTypeOption(type?: string) {
  return RELATION_TYPE_OPTIONS.find((item) => item.value === type)
}

export function getRelationLabel(relation: Pick<MapRelation, 'relationType' | 'relationLabel'>) {
  return relation.relationLabel || getRelationTypeOption(relation.relationType)?.label || relation.relationType || '未命名关系'
}

export function getNodeLead(node?: MapNodeSummary | null) {
  if (!node) return '未选择节点时，图谱只展示根层节点。选择任意地点后，会自动展开它的上下级和显式关系。'
  return node.plotRelevance || node.description || node.structureRole || node.atmosphere || '这个节点还没有补充简介。'
}

export function getOtherNodeId(relation: MapRelation, nodeId: number) {
  if (relation.mapAId === nodeId) return relation.mapBId
  if (relation.mapBId === nodeId) return relation.mapAId
  return relation.mapBId
}

export function buildRelationFormValues(relation?: MapRelation | null, selectedNodeId?: number): RelationFormValues {
  if (!relation) {
    const defaultType = RELATION_TYPE_OPTIONS[0]
    return {
      mapAId: selectedNodeId,
      mapBId: undefined,
      relationType: defaultType.value,
      relationLabel: '',
      bilateral: true,
      description: '',
      intensity: 'medium',
      colorHint: defaultType.color,
      sortOrder: 0,
    }
  }

  return {
    mapAId: relation.mapAId,
    mapBId: relation.mapBId,
    relationType: relation.relationType || RELATION_TYPE_OPTIONS[0].value,
    relationLabel: relation.relationLabel || '',
    bilateral: relation.bilateral > 0,
    description: relation.description || '',
    intensity: relation.intensity || 'medium',
    colorHint: relation.colorHint || getRelationTypeOption(relation.relationType)?.color || '',
    sortOrder: relation.sortOrder || 0,
  }
}
