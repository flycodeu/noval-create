import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tree,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  ShareAltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlowProvider,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useNovelStore } from '../../../stores/novel.store'
import type { MapBatchGenerationResult, WorldMapItem } from '../../../types'
import {
  getBlueprintLevelByDepth,
  getMapBlueprintDepth,
  getFactionNameOptions,
  getMapNodeTypeOptions,
  parseWorldRulesJson,
} from '../../../shared/genre-system'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props { novelId: number }

interface MapGenerationStatus {
  completed: boolean
  nextDepth: number | null
  nextLabel: string
  pendingParentCount: number
  pendingNodeCount: number
}

const COPY = {
  eyebrow: '地图结构',
  title: '地图结构',
  description: '先把国家、区域、地点的父子结构搭稳，再把剧情用途、氛围和势力归属补齐。地图是故事空间骨架，不再只是地点清单。',
  treeView: '树形编辑',
  graphView: '图谱总览',
  generate: '按层级生成',
  addRoot: '添加根节点',
  theme: '题材',
  blueprintDepth: '蓝图层级',
  structurePath: '结构口径',
  currentSelection: '当前选中',
  selectHint: '先选一个节点再编辑',
  rootMetric: '根节点',
  rootHint: '国家 / 大区 / 界域等顶层结构',
  secondMetric: '第二层区域',
  secondHint: '每个根节点下的直属区域',
  leafMetric: '最末层地点',
  leafHint: '当前最深层承载剧情的地点数',
  totalMetric: '总节点数',
  panelTitle: '地图结构编辑台',
  panelDescription: '顶栏只保留层级规则和数量语义。第二层开始的数量表示每个父节点各自拥有多少个直属子节点。',
  treeModePill: '当前为树形编辑模式',
  graphModePill: '当前为图谱总览模式',
  rootCountEyebrow: '根层总数',
  perParentEyebrow: '每个父节点的直属数量',
  typePrefix: '节点类型：',
  treeTitle: '结构树',
  treeCopy: '左侧只看父子层级，右侧集中编辑节点信息。',
  generatedCountPrefix: '已生成',
  generatedCountSuffix: '个节点',
  emptyMap: '还没有地图结构，先按层级生成一版',
  detailFallbackTitle: '节点详情',
  detailEmpty: '从左侧选择节点后，在这里集中编辑名称、结构职责、剧情用途和势力归属。',
  addChild: '添加子节点',
  delete: '删除',
  save: '保存',
  basicTitle: '基础信息',
  basicDesc: '先定义它叫什么、属于哪一层、表面上是什么地方。',
  name: '名称',
  nodeType: '节点类型',
  dangerLevel: '风险等级',
  dangerPlaceholder: '例如：低 / 中 / 高 / 禁入',
  locationType: '地点细分',
  locationPlaceholder: '例如：都城、边境区、港口、实验设施、洞府',
  structureRole: '结构职责',
  rolePlaceholder: '例如：国家首都、区域枢纽、冲突爆发点、补给节点',
  atmosphereTitle: '空间气质',
  atmosphereDesc: '让这个地方既有外观感，也有可写的氛围基调。',
  descriptionLabel: '空间描述',
  descriptionPlaceholder: '写清楚地貌、建筑、秩序和活动方式。',
  atmosphereLabel: '氛围基调',
  atmospherePlaceholder: '例如：繁华但高压、封锁死寂、灵气浓郁、军管森严',
  storyTitle: '剧情用途与关联',
  storyDesc: '这部分直接决定后续时间轴、人物和物品怎么挂靠到这里。',
  plotRelevance: '剧情用途',
  plotPlaceholder: '写这里会承载什么事件、冲突、伏笔或回收。',
  tags: '地点标签',
  tagsPlaceholder: '例如：主角起点、势力核心、补给点、禁区、秘境入口',
  factions: '关联势力',
  noSelection: '选择一个节点后，这里会展开完整编辑表单。',
  graphEmpty: '还没有地图结构，先生成一版国家 → 区域 → 地点层级。',
  modalTitle: '按层级生成地图',
  modalOk: '生成下一批',
  batchSizeLabel: '每批父节点数',
  batchSizeExtra: '长篇建议先用 1，稳定后再提高到 2 或 3。',
  progressTitle: '当前分批进度',
  progressDone: '当前按这组数量配置，地图蓝图已经补齐。',
  progressPendingPrefix: '下一批将补',
  progressParentsSuffix: '个父节点',
  actionStart: '开始分批生成',
  actionContinue: '继续生成下一批',
  rootCountExtra: '这是根层总数。',
  perParentExtra: '这里表示每个上一级节点各自拥有多少个直属子节点。',
  namedPlaces: '已知地点名称（每行一个，可留空）',
  namedPlacesPlaceholder: '例如：帝都\\n南境要塞\\n九曜秘境',
  saveSuccess: '地图节点已保存',
  saveError: '保存失败',
  deleteContent: '会同时删除它下面的全部子节点。',
  maxDepthWarning: '当前题材蓝图已经到最深层级了',
  generateSuccess: '地图结构已生成',
  generateError: '地图生成失败',
  emptyNodeName: '新节点',
  regionFallback: '区域',
  placeFallback: '地点',
  placeholderUnknown: '未设置',
} as const

function parseStringArrayJson(raw?: string): string[] {
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

function countTreeNodes(items: WorldMapItem[]): number {
  return items.reduce((total, item) => total + 1 + countTreeNodes(item.children || []), 0)
}

function countNodesByDepth(items: WorldMapItem[], depth: number): number {
  return items.reduce((total, item) => {
    const current = item.level === depth ? 1 : 0
    return total + current + countNodesByDepth(item.children || [], depth)
  }, 0)
}

function flattenMapItems(items: WorldMapItem[]): WorldMapItem[] {
  return items.flatMap((item) => [item, ...flattenMapItems(item.children || [])])
}

function getMapGenerationStatus(
  items: WorldMapItem[],
  requestedCounts: Map<number, number>,
  blueprintLevels: Array<{ depth: number; label: string }>,
): MapGenerationStatus {
  if (blueprintLevels.length === 0) {
    return {
      completed: true,
      nextDepth: null,
      nextLabel: '蓝图未设置',
      pendingParentCount: 0,
      pendingNodeCount: 0,
    }
  }

  const rootLevel = blueprintLevels[0]
  const rootTarget = requestedCounts.get(rootLevel.depth) || 1
  if (items.length < rootTarget) {
    return {
      completed: false,
      nextDepth: rootLevel.depth,
      nextLabel: rootLevel.label,
      pendingParentCount: rootTarget - items.length,
      pendingNodeCount: rootTarget - items.length,
    }
  }

  const flatItems = flattenMapItems(items)
  for (let index = 1; index < blueprintLevels.length; index += 1) {
    const level = blueprintLevels[index]
    const parentDepth = level.depth - 1
    const requiredCount = requestedCounts.get(level.depth) || 1
    const parents = flatItems.filter((item) => item.level === parentDepth)
    const pendingParents = parents.filter((parent) => (parent.children || []).length < requiredCount)
    if (pendingParents.length > 0) {
      const pendingNodeCount = pendingParents.reduce((total, parent) => total + Math.max(requiredCount - (parent.children || []).length, 0), 0)
      return {
        completed: false,
        nextDepth: level.depth,
        nextLabel: level.label,
        pendingParentCount: pendingParents.length,
        pendingNodeCount,
      }
    }
  }

  return {
    completed: true,
    nextDepth: null,
    nextLabel: blueprintLevels[blueprintLevels.length - 1]?.label || '地图层级',
    pendingParentCount: 0,
    pendingNodeCount: 0,
  }
}

function getLevelSymbol(level: number): string {
  switch (level) {
    case 1:
      return '国'
    case 2:
      return '区'
    case 3:
      return '点'
    default:
      return '层'
  }
}

function mapToTreeData(items: WorldMapItem[]): DataNode[] {
  return items.map((item) => ({
    key: item.id,
    title: (
      <span className="novel-map-tree__title-row">
        <span className="novel-map-tree__symbol">{getLevelSymbol(item.level)}</span>
        <span className="novel-map-tree__label">{item.name}</span>
        <span className="novel-map-tree__meta">{item.nodeType || item.locationType || `第${item.level}层`}</span>
      </span>
    ),
    children: item.children ? mapToTreeData(item.children) : [],
  }))
}

function getSubtreeWidth(item: WorldMapItem): number {
  if (!item.children || item.children.length === 0) return 1
  return item.children.reduce((total, child) => total + getSubtreeWidth(child), 0)
}

function buildFlowGraph(items: WorldMapItem[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const levelColors: Record<number, string> = {
    1: '#8f6330',
    2: '#2E86AB',
    3: '#4f8b64',
    4: '#c86b3c',
  }
  const horizontalGap = 260
  const verticalGap = 190

  function traverse(list: WorldMapItem[], parentId: number | null, depth: number, offsetX: number) {
    let cursor = offsetX
    for (const item of list) {
      const subtreeWidth = getSubtreeWidth(item)
      const x = cursor + ((subtreeWidth - 1) * horizontalGap) / 2
      const y = depth * verticalGap + 40

      nodes.push({
        id: String(item.id),
        position: { x, y },
        data: {
          label: (
            <div className="novel-map-graph-node">
              <div className="novel-map-graph-node__title">{item.name}</div>
              <div className="novel-map-graph-node__meta">{item.nodeType || item.locationType || `第${item.level}层`}</div>
              {item.structureRole ? <div className="novel-map-graph-node__role">{item.structureRole}</div> : null}
            </div>
          ),
        },
        style: {
          width: 220,
          padding: 14,
          borderRadius: 18,
          border: `2px solid ${levelColors[item.level] || '#5c6378'}`,
          background: 'rgba(255, 252, 246, 0.98)',
          boxShadow: '0 18px 32px rgba(37, 31, 24, 0.12)',
        },
      })

      if (parentId !== null) {
        edges.push({
          id: `e${parentId}-${item.id}`,
          source: String(parentId),
          target: String(item.id),
          markerEnd: { type: MarkerType.ArrowClosed },
          style: { stroke: levelColors[item.level] || '#5c6378', strokeWidth: 1.6 },
        })
      }

      if (item.children && item.children.length > 0) {
        traverse(item.children, item.id, depth + 1, cursor)
      }

      cursor += subtreeWidth * horizontalGap
    }
  }

  traverse(items, null, 0, 40)
  return { nodes, edges }
}

export default function MapManager({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [treeData, setTreeData] = useState<WorldMapItem[]>([])
  const [selected, setSelected] = useState<WorldMapItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'graph'>('tree')
  const [detailForm] = Form.useForm()
  const [batchForm] = Form.useForm()

  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const blueprintLevels = useMemo(
    () => [...worldRules.mapBlueprint.levels].sort((left, right) => left.depth - right.depth),
    [worldRules.mapBlueprint.levels],
  )
  const maxDepth = getMapBlueprintDepth(worldRules)
  const factionOptions = getFactionNameOptions(worldRules)
  const nodeTypeOptions = getMapNodeTypeOptions(worldRules)

  const loadTree = useCallback(async () => {
    setLoading(true)
    const data = await window.electron.map.getTree(novelId)
    setTreeData(data)
    setLoading(false)
  }, [novelId])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  useEffect(() => {
    const initialValues: Record<string, number> = {}
    for (const level of blueprintLevels) {
      initialValues[`layer_${level.depth}`] = level.suggestedCount
    }
    initialValues.parentBatchSize = 1
    batchForm.setFieldsValue(initialValues)
  }, [batchForm, blueprintLevels])
  const batchPreviewValues = Form.useWatch([], batchForm) as Record<string, number> | undefined
  const requestedLayerCounts = useMemo(() => new Map(
    blueprintLevels.map((level) => [level.depth, batchPreviewValues?.[`layer_${level.depth}`] || level.suggestedCount]),
  ), [batchPreviewValues, blueprintLevels])

  const findItem = (items: WorldMapItem[], id: number): WorldMapItem | null => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.children) {
        const found = findItem(item.children, id)
        if (found) return found
      }
    }
    return null
  }

  const handleSelect = (keys: React.Key[]) => {
    if (keys.length === 0) {
      setSelected(null)
      return
    }

    const item = findItem(treeData, Number(keys[0]))
    if (!item) return

    setSelected(item)
    detailForm.setFieldsValue({
      name: item.name,
      locationType: item.locationType,
      nodeType: item.nodeType,
      structureRole: item.structureRole,
      parentRuleType: item.parentRuleType,
      description: item.description,
      atmosphere: item.atmosphere,
      plotRelevance: item.plotRelevance,
      dangerLevel: item.dangerLevel,
      tags: parseStringArrayJson(item.tagsJson),
      affiliatedFactions: parseStringArrayJson(item.affiliatedFactionIdsJson),
    })
  }

  const handleSaveDetail = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const values = detailForm.getFieldsValue()
      const { tags, affiliatedFactions, ...restValues } = values
      await window.electron.map.update(selected.id, {
        ...restValues,
        tagsJson: JSON.stringify(tags || []),
        affiliatedFactionIdsJson: JSON.stringify(affiliatedFactions || []),
      })
      message.success(COPY.saveSuccess)
      await loadTree()
    } catch {
      message.error(COPY.saveError)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    Modal.confirm({
      title: `确认删除「${selected.name}」？`,
      content: COPY.deleteContent,
      okType: 'danger',
      onOk: async () => {
        await window.electron.map.delete(selected.id)
        setSelected(null)
        await loadTree()
      },
    })
  }

  const handleAddRoot = async () => {
    const rootLevel = blueprintLevels[0]
    await window.electron.map.create(novelId, {
      level: 1,
      name: rootLevel?.examples?.[0] || `新${rootLevel?.label || COPY.emptyNodeName}`,
      nodeType: rootLevel?.nodeTypes?.[0] || COPY.regionFallback,
      structureRole: rootLevel?.relationHint || '',
    })
    await loadTree()
  }

  const handleAddChild = async (parentItem: WorldMapItem) => {
    const newLevel = parentItem.level + 1
    if (newLevel > maxDepth) {
      message.warning(COPY.maxDepthWarning)
      return
    }

    const levelRule = getBlueprintLevelByDepth(worldRules, newLevel)
    await window.electron.map.create(novelId, {
      level: newLevel,
      parentId: parentItem.id,
      name: levelRule?.examples?.[0] || `新${levelRule?.label || COPY.placeFallback}`,
      nodeType: levelRule?.nodeTypes?.[0] || COPY.placeFallback,
      parentRuleType: parentItem.nodeType || parentItem.locationType || '',
      structureRole: levelRule?.relationHint || '',
    })
    await loadTree()
  }

  const buildLayerFieldLabel = useCallback((depth: number) => {
    const current = blueprintLevels.find((level) => level.depth === depth)
    if (!current) return `第${depth}层数量`
    if (depth === 1) return `${current.label}数量`
    const parent = blueprintLevels.find((level) => level.depth === depth - 1)
    return `每个${parent?.label || `第${depth - 1}层`}下的${current.label}数量`
  }, [blueprintLevels])

  const handleBatchGenerate = async () => {
    setBatchLoading(true)
    try {
      const values = batchForm.getFieldsValue()
      const result = await window.electron.map.batchGenerate(novelId, {
        layerCounts: blueprintLevels.map((level) => ({
          depth: level.depth,
          count: values[`layer_${level.depth}`] || level.suggestedCount,
        })),
        namedPlaces: values.namedPlaces || '',
        parentBatchSize: values.parentBatchSize || 1,
      })
      await loadTree()
      message.success((result as MapBatchGenerationResult).message || COPY.generateSuccess)
      if ((result as MapBatchGenerationResult).completed) {
        setBatchOpen(false)
      }
    } catch (error: unknown) {
      message.error(error instanceof Error ? error.message : COPY.generateError)
    } finally {
      setBatchLoading(false)
    }
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空地图结构？',
      content: '会删除当前小说下全部国家、区域、地点节点及其层级关系，此操作不可撤销。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.map.clear(novelId)
        setSelected(null)
        detailForm.resetFields()
        await loadTree()
        message.success('地图结构已清空')
      },
    })
  }

  const { nodes, edges } = useMemo(() => buildFlowGraph(treeData), [treeData])
  const nodeCount = countTreeNodes(treeData)
  const rootCount = treeData.length
  const secondLevelCount = countNodesByDepth(treeData, 2)
  const leafCount = countNodesByDepth(treeData, Math.max(maxDepth, 1))
  const selectedRule = selected ? getBlueprintLevelByDepth(worldRules, selected.level) : null
  const mapGenerationStatus = useMemo(
    () => getMapGenerationStatus(treeData, requestedLayerCounts, blueprintLevels),
    [treeData, requestedLayerCounts, blueprintLevels],
  )
  const parentBatchSize = batchPreviewValues?.parentBatchSize || 1
  const generateButtonLabel = mapGenerationStatus.completed
    ? COPY.generate
    : nodeCount === 0
      ? COPY.actionStart
      : COPY.actionContinue

  return (
    <WorkspacePage
      className="novel-map-page"
      eyebrow={COPY.eyebrow}
      title={COPY.title}
      description={COPY.description}
      actions={(
        <Space wrap>
          <Button
            type={viewMode === 'tree' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('tree')}
          >
            {'树形编辑'}
          </Button>
          <Button
            type={viewMode === 'graph' ? 'primary' : 'default'}
            icon={<ShareAltOutlined />}
            onClick={() => setViewMode('graph')}
          >
            {'图谱总览'}
          </Button>
          <Button icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>
            {generateButtonLabel}
          </Button>
          <Button icon={<PlusOutlined />} onClick={handleAddRoot}>
            {'添加根节点'}
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>
            {'清空地图'}
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: COPY.theme, value: currentNovel?.genreName || COPY.placeholderUnknown },
            { label: COPY.blueprintDepth, value: `${blueprintLevels.length} 层` },
            {
              label: COPY.structurePath,
              value: blueprintLevels.map((level) => level.label).join(' → '),
            },
            {
              label: COPY.currentSelection,
              value: selected ? `${selected.name} · 第${selected.level}层` : COPY.selectHint,
            },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label={COPY.rootMetric} value={rootCount} tone="warm" hint={COPY.rootHint} />
          <WorkspaceMetric label={COPY.secondMetric} value={secondLevelCount} hint={COPY.secondHint} />
          <WorkspaceMetric label={COPY.leafMetric} value={leafCount} tone="cool" hint={COPY.leafHint} />
          <WorkspaceMetric label={COPY.totalMetric} value={nodeCount} hint={`${factionOptions.length} 个势力标签可联动`} />
        </>
      )}
    >
      <WorkspacePanel
        title={COPY.panelTitle}
        description={COPY.panelDescription}
        extra={<div className="novel-pill">{viewMode === 'tree' ? COPY.treeModePill : COPY.graphModePill}</div>}
      >
        <div className="novel-map-shell">
          <div className="novel-map-blueprint">
            {blueprintLevels.map((level) => (
              <div key={level.depth} className="novel-map-blueprint-card">
                <div className="novel-map-blueprint-card__eyebrow">{level.depth === 1 ? COPY.rootCountEyebrow : COPY.perParentEyebrow}</div>
                <div className="novel-map-blueprint-card__title">
                  <span>{level.label}</span>
                  <span className="novel-map-blueprint-card__count">{batchPreviewValues?.[`layer_${level.depth}`] || level.suggestedCount}</span>
                </div>
                <div className="novel-map-blueprint-card__types">{COPY.typePrefix}{level.nodeTypes.join('、') || COPY.placeholderUnknown}</div>
                <div className="novel-map-blueprint-card__hint">{level.relationHint}</div>
              </div>
            ))}
          </div>

          <div className="novel-note-list" style={{ marginBottom: 18 }}>
            <div className="novel-note-list__item">
              {mapGenerationStatus.completed
                ? COPY.progressDone
                : `${COPY.progressPendingPrefix}第 ${mapGenerationStatus.nextDepth} 层「${mapGenerationStatus.nextLabel}」，当前还有 ${mapGenerationStatus.pendingParentCount} ${COPY.progressParentsSuffix}，待补节点约 ${mapGenerationStatus.pendingNodeCount} 个。`}
            </div>
            <div className="novel-note-list__item">
              {`当前每批按 ${parentBatchSize} 个父节点推进，适合长篇场景逐步补地图，不再一次性要求整棵树输出。`}
            </div>
          </div>

          <div className="novel-map-main" style={viewMode === 'graph' ? { gridTemplateColumns: '1fr' } : undefined}>
            {viewMode === 'tree' ? (
              <>
                <div className="novel-map-tree">
                  <div className="novel-map-tree__header">
                    <div>
                      <div className="novel-map-tree__title">{COPY.treeTitle}</div>
                      <div className="novel-map-tree__copy">{COPY.treeCopy}</div>
                    </div>
                    <div className="novel-pill">{`${COPY.generatedCountPrefix} ${nodeCount} ${COPY.generatedCountSuffix}`}</div>
                  </div>
                  <div className="novel-map-tree__body">
                    {loading ? (
                      <div className="novel-empty"><Spin /></div>
                    ) : treeData.length === 0 ? (
                      <Empty description={COPY.emptyMap} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '40px 0' }} />
                    ) : (
                      <Tree
                        treeData={mapToTreeData(treeData)}
                        onSelect={handleSelect}
                        defaultExpandAll
                        style={{ background: 'transparent', color: 'var(--color-text-primary)' }}
                      />
                    )}
                  </div>
                </div>

                <div className="novel-map-detail">
                  <div className="novel-map-detail__header">
                    <div>
                      <div className="novel-map-detail__title">{selected ? selected.name : COPY.detailFallbackTitle}</div>
                      <div className="novel-map-detail__copy">
                        {selected
                          ? `${selected.nodeType || selected.locationType || `第${selected.level}层`} · ${selectedRule?.relationHint || COPY.detailEmpty}`
                          : COPY.detailEmpty}
                      </div>
                    </div>
                    {selected ? (
                      <Space wrap>
                        {selected.level < maxDepth ? (
                          <Button icon={<PlusOutlined />} onClick={() => handleAddChild(selected)}>
                            {'添加子节点'}
                          </Button>
                        ) : null}
                        <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>
                          {'删除'}
                        </Button>
                        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSaveDetail}>
                          {'保存'}
                        </Button>
                      </Space>
                    ) : null}
                  </div>

                  <div className="novel-map-detail__body">
                    {selected ? (
                      <Form form={detailForm} layout="vertical">
                        <div className="novel-form-section">
                          <div className="novel-form-section__header">
                            <div className="novel-form-section__title">{COPY.basicTitle}</div>
                            <div className="novel-form-section__desc">{COPY.basicDesc}</div>
                          </div>
                          <div className="novel-grid novel-grid--3">
                            <Form.Item name="name" label={COPY.name}>
                              <Input />
                            </Form.Item>
                            <Form.Item name="nodeType" label={COPY.nodeType}>
                              <Select
                                showSearch
                                allowClear
                                options={nodeTypeOptions.map((value) => ({ value, label: value }))}
                              />
                            </Form.Item>
                            <Form.Item name="dangerLevel" label={COPY.dangerLevel}>
                              <Input placeholder={COPY.dangerPlaceholder} />
                            </Form.Item>
                          </div>
                          <div className="novel-grid novel-grid--2">
                            <Form.Item name="locationType" label={COPY.locationType}>
                              <Input placeholder={COPY.locationPlaceholder} />
                            </Form.Item>
                            <Form.Item name="structureRole" label={COPY.structureRole}>
                              <Input placeholder={COPY.rolePlaceholder} />
                            </Form.Item>
                          </div>
                        </div>

                        <div className="novel-form-section">
                          <div className="novel-form-section__header">
                            <div className="novel-form-section__title">{COPY.atmosphereTitle}</div>
                            <div className="novel-form-section__desc">{COPY.atmosphereDesc}</div>
                          </div>
                          <Form.Item name="description" label={COPY.descriptionLabel}>
                            <Input.TextArea rows={5} placeholder={COPY.descriptionPlaceholder} />
                          </Form.Item>
                          <Form.Item name="atmosphere" label={COPY.atmosphereLabel}>
                            <Input placeholder={COPY.atmospherePlaceholder} />
                          </Form.Item>
                        </div>

                        <div className="novel-form-section">
                          <div className="novel-form-section__header">
                            <div className="novel-form-section__title">{COPY.storyTitle}</div>
                            <div className="novel-form-section__desc">{COPY.storyDesc}</div>
                          </div>
                          <Form.Item name="plotRelevance" label={COPY.plotRelevance}>
                            <Input.TextArea rows={4} placeholder={COPY.plotPlaceholder} />
                          </Form.Item>
                          <div className="novel-grid novel-grid--2">
                            <Form.Item name="tags" label={COPY.tags}>
                              <Select mode="tags" placeholder={COPY.tagsPlaceholder} />
                            </Form.Item>
                            <Form.Item name="affiliatedFactions" label={COPY.factions}>
                              <Select mode="tags" options={factionOptions.map((value) => ({ value, label: value }))} />
                            </Form.Item>
                          </div>
                        </div>
                      </Form>
                    ) : (
                      <div className="novel-empty">{COPY.noSelection}</div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="novel-map-graph">
                {loading ? (
                  <div className="novel-empty" style={{ height: '100%' }}><Spin /></div>
                ) : treeData.length === 0 ? (
                  <div className="novel-empty" style={{ height: '100%' }}>{COPY.graphEmpty}</div>
                ) : (
                  <ReactFlowProvider>
                    <ReactFlow nodes={nodes} edges={edges} fitView style={{ background: 'transparent' }}>
                      <Background color="rgba(122, 93, 52, 0.14)" gap={20} />
                      <Controls />
                    </ReactFlow>
                  </ReactFlowProvider>
                )}
              </div>
            )}
          </div>
        </div>
      </WorkspacePanel>

      <Modal
        title={COPY.modalTitle}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={handleBatchGenerate}
        confirmLoading={batchLoading}
        okText={COPY.modalOk}
      >
        <Form form={batchForm} layout="vertical">
          <div className="novel-note-list" style={{ marginBottom: 16 }}>
            <div className="novel-note-list__item">
              {mapGenerationStatus.completed
                ? COPY.progressDone
                : `${COPY.progressPendingPrefix}第 ${mapGenerationStatus.nextDepth} 层「${mapGenerationStatus.nextLabel}」，待处理父节点 ${mapGenerationStatus.pendingParentCount} 个。`}
            </div>
            <div className="novel-note-list__item">
              {`这轮会按 ${parentBatchSize} 个父节点为一批推进。长篇建议从 1 开始，确认稳定后再调到 2 或 3。`}
            </div>
          </div>

          {blueprintLevels.map((level) => (
            <Form.Item
              key={level.depth}
              name={`layer_${level.depth}`}
              label={buildLayerFieldLabel(level.depth)}
              initialValue={level.suggestedCount}
              extra={level.depth === 1 ? COPY.rootCountExtra : COPY.perParentExtra}
            >
              <InputNumber min={1} max={12} style={{ width: '100%' }} />
            </Form.Item>
          ))}
          <Form.Item
            name="parentBatchSize"
            label={COPY.batchSizeLabel}
            initialValue={1}
            extra={COPY.batchSizeExtra}
          >
            <Select
              options={[
                { value: 1, label: '1 个父节点' },
                { value: 2, label: '2 个父节点' },
                { value: 3, label: '3 个父节点' },
              ]}
            />
          </Form.Item>
          <Form.Item name="namedPlaces" label={COPY.namedPlaces}>
            <Input.TextArea rows={5} placeholder={COPY.namedPlacesPlaceholder} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
