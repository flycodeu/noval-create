import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Pagination, Progress, Select, Space, Spin, Switch, Tag, message } from 'antd'
import { ApartmentOutlined, DeleteOutlined, DownOutlined, EditOutlined, EyeInvisibleOutlined, FullscreenExitOutlined, FullscreenOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, ShareAltOutlined, StopOutlined, UnorderedListOutlined, UpOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { MapAutoGenerateStatus, MapGraphPayload, MapNodeSummary, MapRelation, MapRelationInput, Task, WorldMapItem } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { getBlueprintLevelByDepth, getFactionNameOptions, getMapBlueprintDepth, getMapNodeTypeOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { scaleMapLayerCounts } from '../../../shared/creation-tools'
import { buildDraftMessages, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel, WorkspaceStepGuide } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import '../components/boards.css'
import './map-explorer.css'
import MapGraphCanvas from './MapGraphCanvas'
import {
  buildGenerateOptions,
  buildInitialBatchFormValues,
  buildRelationFormValues,
  DEFAULT_GRAPH_FILTERS,
  EMPTY_AUTO_STATUS,
  EMPTY_GRAPH,
  EMPTY_PAGE,
  EMPTY_STATS,
  flattenTree,
  getOtherNodeId,
  PAGE_SIZE,
  parseStringArrayJson,
  type DetailFormValues,
  type GraphFilterState,
  type RefreshVisibleOptions,
  type RelationFormValues,
  RELATION_INTENSITY_OPTIONS,
  RELATION_TYPE_OPTIONS,
  toFormValues,
  type WorkspaceMode,
} from './shared'

interface Props {
  novelId: number
}

const RELATION_TYPE_TEXT: Record<string, string> = {
  adjacent: '相邻 / 接壤',
  transport: '交通 / 通路',
  control: '控制 / 归属',
  hostile: '敌对 / 封锁',
  trade: '贸易 / 补给',
  pollution: '污染 / 外溢',
  secret_link: '隐蔽通道',
}

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const RELATION_INTENSITY_TEXT: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  critical: '极高',
}

const AUTO_TASK_STATUS_TEXT: Record<string, string> = {
  pending: '准备中',
  running: '运行中',
  cancel_requested: '停止中',
  paused: '已暂停',
  cancelled: '已停止',
  failed: '失败',
  success: '已完成',
}

function getRelationLabelText(relation: Pick<MapRelation, 'relationType' | 'relationLabel'>) {
  return relation.relationLabel || RELATION_TYPE_TEXT[relation.relationType || ''] || relation.relationType || '未命名关系'
}

function getRelationTypeMeta(type?: string) {
  return RELATION_TYPE_OPTIONS.find((item) => item.value === type)
}

function getRelationIntensityText(value?: string) {
  if (!value) return '未设置'
  return RELATION_INTENSITY_TEXT[value] || value
}

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeMapGraphPayload(graph: MapGraphPayload | null | undefined): MapGraphPayload {
  if (!graph) return EMPTY_GRAPH
  return {
    ...EMPTY_GRAPH,
    ...graph,
    nodes: ensureArray(graph.nodes),
    edges: ensureArray(graph.edges),
    relationNodeIds: ensureArray(graph.relationNodeIds),
    rootNodeIds: ensureArray(graph.rootNodeIds),
  }
}

function TaskStrip({
  title,
  summary,
  actions,
  tone = 'info',
  children,
  className,
  expanded,
  defaultExpanded = false,
  onToggle,
}: {
  title: string
  summary: React.ReactNode
  actions?: React.ReactNode
  tone?: 'info' | 'success' | 'warning' | 'error'
  children: React.ReactNode
  className?: string
  expanded?: boolean
  defaultExpanded?: boolean
  onToggle?: (nextExpanded: boolean) => void
}) {
  const [innerExpanded, setInnerExpanded] = useState(defaultExpanded)
  const resolvedExpanded = typeof expanded === 'boolean' ? expanded : innerExpanded
  const palette = {
    info: { border: 'rgba(59, 109, 138, 0.22)', glow: 'rgba(18, 90, 124, 0.14)', pillBg: 'rgba(25, 112, 150, 0.12)', pillText: '#0C607B' },
    success: { border: 'rgba(63, 138, 96, 0.22)', glow: 'rgba(42, 108, 77, 0.14)', pillBg: 'rgba(49, 136, 87, 0.12)', pillText: '#236C47' },
    warning: { border: 'rgba(174, 124, 48, 0.22)', glow: 'rgba(136, 93, 30, 0.14)', pillBg: 'rgba(189, 137, 56, 0.14)', pillText: '#8E5E1B' },
    error: { border: 'rgba(176, 68, 68, 0.22)', glow: 'rgba(124, 40, 40, 0.14)', pillBg: 'rgba(183, 68, 68, 0.14)', pillText: '#8A3131' },
  }[tone]
  const handleToggle = () => {
    const nextExpanded = !resolvedExpanded
    if (typeof expanded !== 'boolean') setInnerExpanded(nextExpanded)
    onToggle?.(nextExpanded)
  }

  return (
    <section
      className={`${className} map-graph-callout`}
      style={{
        border: `1px solid ${palette.border}`,
        boxShadow: `0 18px 34px ${palette.glow}`,
      }}
    >
      <div className="map-graph-callout__head">
        <div className="map-graph-callout__copy">
          <div className="map-graph-callout__summary-row">
            <span className="map-graph-callout__pill" style={{ background: palette.pillBg, color: palette.pillText }}>{title}</span>
            <div className="map-graph-callout__summary">{summary}</div>
          </div>
        </div>
        <div className="map-graph-callout__actions">
          {actions}
          <Button size="small" type="text" icon={resolvedExpanded ? <UpOutlined /> : <DownOutlined />} onClick={handleToggle}>
            {resolvedExpanded ? '收起详情' : '展开详情'}
          </Button>
        </div>
      </div>
      {resolvedExpanded ? <div className="map-graph-callout__body">{children}</div> : null}
    </section>
  )
}

export default function MapExplorerPage({ novelId }: Props) {
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [searchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const [detailForm] = Form.useForm<DetailFormValues>()
  const [batchForm] = Form.useForm()
  const [relationForm] = Form.useForm<RelationFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoStopping, setAutoStopping] = useState(false)
  const [relationSaving, setRelationSaving] = useState(false)
  const [rootData, setRootData] = useState(EMPTY_PAGE)
  const [branchData, setBranchData] = useState(EMPTY_PAGE)
  const [stats, setStats] = useState(EMPTY_STATS)
  const [treeData, setTreeData] = useState<WorldMapItem[]>([])
  const [allRelations, setAllRelations] = useState<MapRelation[]>([])
  const [selectedNode, setSelectedNode] = useState<MapNodeSummary | null>(null)
  const selectedNodeRef = useRef<MapNodeSummary | null>(null)
  const autoTaskRef = useRef<Task | null>(null)
  const autoStatusRef = useRef<MapAutoGenerateStatus>(EMPTY_AUTO_STATUS)
  const autoRefreshInFlightRef = useRef(false)
  const autoRefreshQueuedRef = useRef(false)
  const graphStageRef = useRef<HTMLDivElement | null>(null)
  const [selectedRelation, setSelectedRelation] = useState<MapRelation | null>(null)
  const [branchPath, setBranchPath] = useState<MapNodeSummary[]>([])
  const [rootPage, setRootPage] = useState(1)
  const [branchPage, setBranchPage] = useState(1)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('list')
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphData, setGraphData] = useState<MapGraphPayload>(EMPTY_GRAPH)
  const [graphFilters, setGraphFilters] = useState<GraphFilterState>(DEFAULT_GRAPH_FILTERS)
  const [graphInspectorOpen, setGraphInspectorOpen] = useState(false)
  const [graphInspectorTab, setGraphInspectorTab] = useState<'focus' | 'relations' | 'detail'>('focus')
  const [graphFullscreen, setGraphFullscreen] = useState(false)
  const [relationModalOpen, setRelationModalOpen] = useState(false)
  const [editingRelation, setEditingRelation] = useState<MapRelation | null>(null)
  const [autoTask, setAutoTask] = useState<Task | null>(null)
  const [autoStatus, setAutoStatus] = useState(EMPTY_AUTO_STATUS)
  const [autoTaskCardExpanded, setAutoTaskCardExpanded] = useState(false)
  const routeNodeFocusRef = useRef<number | null>(null)
  const initialRefreshDoneRef = useRef(false)

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const blueprintLevels = useMemo(() => [...worldRules.mapBlueprint.levels].sort((a, b) => a.depth - b.depth), [worldRules.mapBlueprint.levels])
  const scaledBlueprintLevels = useMemo(() => scaleMapLayerCounts(blueprintLevels, currentNovel?.genreName, {
    launchMode: currentNovel?.launchMode,
    targetWords: currentNovel?.targetWords,
    settingsJson: currentNovel?.settingsJson,
    mapDepth: blueprintLevels.length,
    factionCount: worldRules.factionSystem.length,
    speciesCount: worldRules.speciesSystem.length,
    powerSystemCount: worldRules.powerSystems.length,
  }), [
    blueprintLevels,
    currentNovel?.genreName,
    currentNovel?.launchMode,
    currentNovel?.settingsJson,
    currentNovel?.targetWords,
    worldRules.factionSystem.length,
    worldRules.powerSystems.length,
    worldRules.speciesSystem.length,
  ])
  const maxDepth = getMapBlueprintDepth(worldRules)
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const nodeTypeOptions = useMemo(() => getMapNodeTypeOptions(worldRules), [worldRules])
  const initialBatchValues = useMemo(() => buildInitialBatchFormValues(scaledBlueprintLevels), [scaledBlueprintLevels])
  const flattenedTree = useMemo(() => flattenTree(treeData), [treeData])
  const currentParent = branchPath[branchPath.length - 1] || null
  const currentDisplayPath = useMemo(() => {
    if (selectedNode?.id && flattenedTree.pathById.has(selectedNode.id)) return flattenedTree.pathById.get(selectedNode.id) || []
    return branchPath
  }, [branchPath, flattenedTree.pathById, selectedNode?.id])
  const pathLabel = currentDisplayPath.length > 0 ? currentDisplayPath.map((item) => item.name).join(' / ') : '未进入分支'
  const selectedNodeLead = useMemo(() => {
    if (!selectedNode) return ''
    return selectedNode.plotRelevance || selectedNode.description || selectedNode.structureRole || selectedNode.atmosphere || '这个节点还没有补充简介。'
  }, [selectedNode])
  const selectedNodeTags = useMemo(() => parseStringArrayJson(selectedNode?.tagsJson), [selectedNode?.tagsJson])
  const selectedNodeFactions = useMemo(() => parseStringArrayJson(selectedNode?.affiliatedFactionIdsJson), [selectedNode?.affiliatedFactionIdsJson])
  const selectedNodeRelations = useMemo(() => {
    if (!selectedNode) return []
    return allRelations.filter((relation) => relation.mapAId === selectedNode.id || relation.mapBId === selectedNode.id)
  }, [allRelations, selectedNode])
  const graphRelationCount = useMemo(() => graphData.edges.filter((edge) => edge.edgeKind === 'relation').length, [graphData.edges])
  const graphHierarchyCount = useMemo(() => graphData.edges.filter((edge) => edge.edgeKind === 'hierarchy').length, [graphData.edges])
  const nodePathOptions = useMemo(() => flattenedTree.flat.map((item) => ({
    value: item.id,
    label: (flattenedTree.pathById.get(item.id) || [item]).map((part) => part.name).join(' / '),
  })), [flattenedTree.flat, flattenedTree.pathById])
  const relationTypeDisplayOptions = useMemo(() => RELATION_TYPE_OPTIONS.map((item) => ({
    value: item.value,
    label: RELATION_TYPE_TEXT[item.value] || item.label,
    color: item.color,
  })), [])
  const relationIntensityDisplayOptions = useMemo(() => RELATION_INTENSITY_OPTIONS.map((item) => ({
    value: item.value,
    label: RELATION_INTENSITY_TEXT[item.value] || item.label,
  })), [])
  const routeNodeId = useMemo(() => parseRouteId(searchParams.get('nodeId')), [searchParams])

  const loadRoots = useCallback(async (targetPage = rootPage, keyword = searchKeyword) => {
    const trimmedKeyword = keyword.trim()
    const list = await window.electron.map.queryNodes(trimmedKeyword
      ? { novelId, keyword: trimmedKeyword, page: targetPage, pageSize: PAGE_SIZE }
      : { novelId, parentId: null, page: targetPage, pageSize: PAGE_SIZE })
    setRootData(list)
  }, [novelId, rootPage, searchKeyword])

  const loadBranch = useCallback(async (parent: MapNodeSummary | null, targetPage = branchPage) => {
    if (!parent) {
      setBranchData(EMPTY_PAGE)
      return
    }
    setBranchData(await window.electron.map.queryNodes({ novelId, parentId: parent.id, page: targetPage, pageSize: PAGE_SIZE }))
  }, [branchPage, novelId])

  const loadStats = useCallback(async () => {
    setStats(await window.electron.map.getStats(novelId))
  }, [novelId])

  const loadTree = useCallback(async () => {
    const nextTree = await window.electron.map.getTree(novelId)
    setTreeData(nextTree)
    return nextTree
  }, [novelId])

  const loadAllRelations = useCallback(async () => {
    const relations = ensureArray(await window.electron.map.getRelations(novelId))
    setAllRelations(relations)
    setSelectedRelation((current) => (current ? relations.find((item) => item.id === current.id) || null : current))
    return relations
  }, [novelId])

  const loadAutoStatus = useCallback(async () => {
    const latestTask = await window.electron.map.getLatestAutoGenerateTask(novelId)
    if (latestTask) {
      autoTaskRef.current = latestTask
      setAutoTask(latestTask)
      const latestStatus = await window.electron.map.getAutoGenerateStatus(latestTask.id) || EMPTY_AUTO_STATUS
      autoStatusRef.current = latestStatus
      setAutoStatus(latestStatus)
      return latestTask
    }

    const retainedTask = autoTaskRef.current
    if (retainedTask && ['success', 'failed', 'cancelled'].includes(retainedTask.status || '')) {
      setAutoTask(retainedTask)
      setAutoStatus(autoStatusRef.current)
      return retainedTask
    }

    autoTaskRef.current = null
    autoStatusRef.current = EMPTY_AUTO_STATUS
    setAutoTask(null)
    setAutoStatus(EMPTY_AUTO_STATUS)
    return null
  }, [novelId])

  const selectNode = useCallback((node: MapNodeSummary | null) => {
    selectedNodeRef.current = node
    setSelectedNode(node)
    setSelectedRelation((current) => {
      if (!current) return current
      if (!node) return null
      return current.mapAId === node.id || current.mapBId === node.id ? current : null
    })
    if (node) detailForm.setFieldsValue(toFormValues(node))
  }, [detailForm])

  const loadGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const [graph, relations] = await Promise.all([
        window.electron.map.getGraph({
          novelId,
          includeRelationEdges: graphFilters.includeRelationEdges,
        }),
        window.electron.map.getRelations(novelId),
      ])
      const nextGraph = normalizeMapGraphPayload(graph)
      setGraphData(nextGraph)
      setAllRelations(relations)
      setSelectedRelation((current) => (current ? relations.find((item) => item.id === current.id) || null : current))
      return { graph: nextGraph, relations }
    } finally {
      setGraphLoading(false)
    }
  }, [graphFilters.includeRelationEdges, novelId])

  const resetBatchForm = useCallback(() => {
    batchForm.resetFields()
    batchForm.setFieldsValue(initialBatchValues)
  }, [batchForm, initialBatchValues])

  const resetWorkspaceState = useCallback(() => {
    setRootData(EMPTY_PAGE)
    setBranchData(EMPTY_PAGE)
    setStats(EMPTY_STATS)
    setTreeData([])
    setAllRelations([])
    setBranchPath([])
    setRootPage(1)
    setBranchPage(1)
    setSearchKeyword('')
    setBatchOpen(false)
    setWorkspaceMode('list')
    setGraphData(EMPTY_GRAPH)
    setGraphFilters(DEFAULT_GRAPH_FILTERS)
    setGraphInspectorOpen(false)
    setGraphInspectorTab('focus')
    setSelectedRelation(null)
    setRelationModalOpen(false)
    setEditingRelation(null)
    setAutoTask(null)
    setAutoStatus(EMPTY_AUTO_STATUS)
    selectNode(null)
    resetBatchForm()
  }, [resetBatchForm, selectNode])

  const refreshVisible = useCallback(async (options: RefreshVisibleOptions = {}) => {
    const nextParent = options.parent !== undefined ? options.parent : currentParent
    const nextRootPage = options.rootPage ?? rootPage
    const nextBranchPage = options.branchPage ?? branchPage
    const nextKeyword = options.keyword ?? searchKeyword

    setLoading(true)
    try {
      await Promise.all([
        loadRoots(nextRootPage, nextKeyword),
        loadBranch(nextParent, nextBranchPage),
        loadStats(),
        loadTree(),
        loadAllRelations(),
        loadAutoStatus(),
      ])

      const currentId = options.preferredId !== undefined ? options.preferredId : selectedNodeRef.current?.id
      const nextSelected = currentId ? await window.electron.map.getNode(currentId) : null
      if (nextSelected) selectNode(nextSelected)
      else selectNode(null)
      if (workspaceMode === 'graph') await loadGraph()
    } finally {
      setLoading(false)
    }
  }, [branchPage, currentParent, loadAllRelations, loadAutoStatus, loadBranch, loadGraph, loadRoots, loadStats, loadTree, rootPage, searchKeyword, selectNode, workspaceMode])

  const refreshGeneratedContent = useCallback(async (preferredId: number | null = selectedNodeRef.current?.id || null) => {
    if (autoRefreshInFlightRef.current) {
      autoRefreshQueuedRef.current = true
      return
    }

    autoRefreshInFlightRef.current = true

    try {
      await Promise.all([
        loadRoots(rootPage, searchKeyword),
        loadBranch(currentParent, branchPage),
        loadStats(),
        loadTree(),
        workspaceMode === 'graph' ? loadGraph() : loadAllRelations(),
      ])

      const nextSelected = preferredId ? await window.electron.map.getNode(preferredId) : null
      if (nextSelected) selectNode(nextSelected)
      else if (preferredId != null && selectedNodeRef.current?.id === preferredId) selectNode(null)
    } finally {
      autoRefreshInFlightRef.current = false

      if (autoRefreshQueuedRef.current) {
        autoRefreshQueuedRef.current = false
        void refreshGeneratedContent(selectedNodeRef.current?.id || null)
      }
    }
  }, [branchPage, currentParent, loadAllRelations, loadBranch, loadGraph, loadRoots, loadStats, loadTree, rootPage, searchKeyword, selectNode, workspaceMode])

  const focusNodeById = useCallback(async (nodeId?: number | null) => {
    if (!nodeId) {
      setBranchPath([])
      setBranchPage(1)
      setSelectedRelation(null)
      selectNode(null)
      await loadBranch(null, 1)
      return
    }

    const node = await window.electron.map.getNode(nodeId) || flattenedTree.byId.get(nodeId) || null
    if (!node) return

    const nextPath = flattenedTree.pathById.get(nodeId) || [node]
    setBranchPath(nextPath)
    setBranchPage(1)
    selectNode(node)
    await loadBranch(node, 1)
  }, [flattenedTree.byId, flattenedTree.pathById, loadBranch, selectNode])

  useEffect(() => {
    if (initialRefreshDoneRef.current) return
    initialRefreshDoneRef.current = true
    void refreshVisible()
  }, [refreshVisible])
  useEffect(() => {
    if (!routeNodeId || routeNodeFocusRef.current === routeNodeId) return
    routeNodeFocusRef.current = routeNodeId
    void focusNodeById(routeNodeId)
  }, [focusNodeById, routeNodeId])

  useEffect(() => {
    if (rootPage === 1 && branchPage === 1) return
    void loadRoots(rootPage)
    void loadBranch(currentParent, branchPage)
  }, [branchPage, currentParent, loadBranch, loadRoots, rootPage])

  useEffect(() => {
    setRootPage(1)
    void loadRoots(1, searchKeyword)
  }, [loadRoots, searchKeyword])

  useEffect(() => {
    autoTaskRef.current = autoTask
  }, [autoTask])

  useEffect(() => {
    autoStatusRef.current = autoStatus
  }, [autoStatus])

  useEffect(() => {
    if (workspaceMode !== 'graph') return
    void loadGraph()
  }, [loadGraph, workspaceMode])

  useEffect(() => {
    if (!autoTask?.id) return
    if (!['running', 'cancel_requested'].includes(autoTask.status || '')) return

    const updateAutoTaskStatus = (status?: Task['status']) => {
      if (!status) return
      setAutoTask((current) => {
        if (!current || current.id !== autoTask.id) return current
        const nextTask = { ...current, status }
        autoTaskRef.current = nextTask
        return nextTask
      })
    }

    const syncProgress = (nextProgress: MapAutoGenerateStatus) => {
      const previous = autoStatusRef.current
      autoStatusRef.current = nextProgress
      setAutoStatus(nextProgress)

      const batchAdvanced = nextProgress.generatedNodeCount > previous.generatedNodeCount
        || nextProgress.processedParentCount > previous.processedParentCount
        || (nextProgress.completed && !previous.completed)
        || ['paused', 'success'].includes(nextProgress.status || '')

      if (batchAdvanced) {
        void refreshGeneratedContent(selectedNodeRef.current?.id || null)
      }
    }

    const reload = () => {
      void loadAutoStatus()
      void refreshGeneratedContent(selectedNodeRef.current?.id || null)
    }

    const unsubProgress = window.electron.on('task:progress', (data: unknown) => {
      const payload = data as { taskId: number; progress?: MapAutoGenerateStatus }
      if (payload?.taskId !== autoTask.id) return
      if (payload.progress && typeof payload.progress === 'object') {
        syncProgress(payload.progress)
        return
      }
      void loadAutoStatus()
    })

    const unsubStatus = window.electron.on('task:status-change', (data: unknown) => {
      const payload = data as { taskId: number; status?: Task['status'] }
      if (payload?.taskId !== autoTask.id) return
      updateAutoTaskStatus(payload.status)
      if (['paused', 'success', 'failed', 'cancelled'].includes(payload.status || '')) {
        void refreshGeneratedContent(selectedNodeRef.current?.id || null)
      }
      void loadAutoStatus()
    })

    const unsubComplete = window.electron.on('task:complete', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) {
        reload()
      }
    })

    const timer = setInterval(reload, 5000)

    return () => {
      clearInterval(timer)
      unsubProgress()
      unsubStatus()
      unsubComplete()
    }
  }, [autoTask?.id, autoTask?.status, loadAutoStatus, refreshGeneratedContent])

  useEffect(() => {
    const syncFullscreenState = () => {
      setGraphFullscreen(document.fullscreenElement === graphStageRef.current)
    }

    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  useEffect(() => {
    if (autoTask?.status === 'paused' || autoTask?.status === 'failed') setAutoTaskCardExpanded(true)
  }, [autoTask?.id, autoTask?.status])

  const toggleGraphFullscreen = useCallback(async () => {
    if (!graphStageRef.current) return
    if (document.fullscreenElement === graphStageRef.current) {
      await document.exitFullscreen()
      return
    }

    await graphStageRef.current.requestFullscreen()
  }, [])

  const openBatchModal = useCallback(() => {
    resetBatchForm()
    setBatchOpen(true)
  }, [resetBatchForm])

  const waitForAutoTaskToSettle = useCallback(async (taskId: number) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const latestTask = await window.electron.map.getLatestAutoGenerateTask(novelId)
      if (!latestTask || latestTask.id !== taskId || !['pending', 'running', 'cancel_requested'].includes(latestTask.status || '')) return
      await new Promise((resolve) => window.setTimeout(resolve, 200))
    }
  }, [novelId])

  const handleSelectRoot = async (node: MapNodeSummary) => {
    setBranchPath([node])
    setBranchPage(1)
    selectNode(node)
    await loadBranch(node, 1)
  }

  const handleDive = async (node: MapNodeSummary) => {
    setBranchPath((current) => [...current, node])
    setBranchPage(1)
    selectNode(node)
    await loadBranch(node, 1)
  }

  const handleBreadcrumb = async (index: number) => {
    const nextPath = branchPath.slice(0, index + 1)
    const node = nextPath[nextPath.length - 1] || null
    setBranchPath(nextPath)
    setBranchPage(1)
    selectNode(node)
    await loadBranch(node, 1)
  }

  const handleSave = async () => {
    if (!selectedNode) return
    const values = detailForm.getFieldsValue()
    setSaving(true)
    try {
      await window.electron.map.update(selectedNode.id, {
        ...values,
        tagsJson: JSON.stringify(values.tags || []),
        affiliatedFactionIdsJson: JSON.stringify(values.affiliatedFactions || []),
      })
      await refreshVisible({ preferredId: selectedNode.id })
      message.success(getUserFacingMessage('map.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'map.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedNode) return
    Modal.confirm({
      title: `删除“${selectedNode.name}”？`,
      content: '会同时删除它下面的全部子节点，以及这些节点关联的地图关系。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.map.delete(selectedNode.id)
        setSelectedRelation(null)
        setBranchPath((current) => current.filter((item) => item.id !== selectedNode.id))
        selectNode(null)
        await refreshVisible({ preferredId: null })
        message.success(getUserFacingMessage('map.nodeDeleted'))
      },
    })
  }

  const handleAddRoot = async () => {
    const levelRule = blueprintLevels[0]
    const nextId = await window.electron.map.create(novelId, {
      level: 1,
      name: levelRule?.examples?.[0] || '新根节点',
      nodeType: levelRule?.nodeTypes?.[0] || '区域',
      structureRole: levelRule?.relationHint || '',
    })
    await refreshVisible({ preferredId: nextId })
    message.success(getUserFacingMessage('map.rootCreated'))
  }

  const handleAddChild = async () => {
    if (!selectedNode) return
    const nextLevel = selectedNode.level + 1
    if (nextLevel > maxDepth) {
      message.warning(getUserFacingMessage('map.maxDepthReached'))
      return
    }

    const levelRule = getBlueprintLevelByDepth(worldRules, nextLevel)
    const nextId = await window.electron.map.create(novelId, {
      level: nextLevel,
      parentId: selectedNode.id,
      name: levelRule?.examples?.[0] || `新${levelRule?.label || '节点'}`,
      nodeType: levelRule?.nodeTypes?.[0] || '地点',
      parentRuleType: selectedNode.nodeType || selectedNode.locationType || '',
      structureRole: levelRule?.relationHint || '',
    })

    if (currentParent?.id !== selectedNode.id) {
      setBranchPath((current) => [...current, selectedNode])
      setBranchPage(1)
      await loadBranch(selectedNode, 1)
    }

    await refreshVisible({ preferredId: nextId, parent: selectedNode, branchPage: 1 })
    message.success(getUserFacingMessage('map.childCreated'))
  }

  const handleClear = useCallback(async () => {
    Modal.confirm({
      title: '清空地图结构？',
      content: '会删除当前小说下的全部地图节点与关系，并丢弃当前未保存的编辑内容。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        if (autoTask?.id) {
          await window.electron.workflow.cancel(autoTask.id)
          await waitForAutoTaskToSettle(autoTask.id)
        }
        await window.electron.map.clear(novelId)
        resetWorkspaceState()
        setLoading(true)
        try {
          await Promise.all([loadRoots(1, ''), loadBranch(null, 1), loadStats(), loadTree(), loadAllRelations()])
        } finally {
          setLoading(false)
        }
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('map.cleared'))
      },
    })
  }, [autoTask, loadAllRelations, loadBranch, loadRoots, loadStats, loadTree, novelId, notifyWorkspaceMutation, resetWorkspaceState, waitForAutoTaskToSettle])

  useEffect(() => {
    registerClearHandler(() => {
      void handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  const handleStartAutoGenerate = async () => {
    setAutoLoading(true)
    try {
      const values = batchForm.getFieldsValue()
      await window.electron.map.startAutoGenerate(novelId, buildGenerateOptions(values, blueprintLevels))
      await loadAutoStatus()
      setBatchOpen(false)
      setAutoTaskCardExpanded(true)
      message.success(getUserFacingMessage('map.autoGenerateStarted'))
    } catch (error: unknown) {
      message.error(getErrorMessage(error, 'map.autoGenerateStartFailed'))
    } finally {
      setAutoLoading(false)
    }
  }

  const handleStopAutoGenerate = async () => {
    if (!autoTask?.id) return
    setAutoStopping(true)
    try {
      await window.electron.workflow.cancel(autoTask.id)
      await loadAutoStatus()
      setAutoTaskCardExpanded(true)
      message.info(getUserFacingMessage('map.autoGeneratePauseRequested'))
    } finally {
      setAutoStopping(false)
    }
  }

  const handleResumeAutoGenerate = async () => {
    if (!autoTask?.id) return
    setAutoLoading(true)
    try {
      await window.electron.map.resumeAutoGenerate(autoTask.id)
      await loadAutoStatus()
      setAutoTaskCardExpanded(true)
      message.success(getUserFacingMessage('map.autoGenerateResumed'))
    } catch (error: unknown) {
      message.error(getErrorMessage(error, 'map.autoGenerateResumeFailed'))
    } finally {
      setAutoLoading(false)
    }
  }

  const openCreateRelation = useCallback(() => {
    if (!selectedNode) {
      message.info(getUserFacingMessage('map.relation.selectNodeFirst'))
      return
    }
    setEditingRelation(null)
    relationForm.setFieldsValue(buildRelationFormValues(null, selectedNode.id))
    setRelationModalOpen(true)
  }, [relationForm, selectedNode])

  const openEditRelation = useCallback((relation: MapRelation) => {
    setEditingRelation(relation)
    relationForm.setFieldsValue(buildRelationFormValues(relation, selectedNode?.id))
    setSelectedRelation(relation)
    setRelationModalOpen(true)
  }, [relationForm, selectedNode?.id])

  const handleSaveRelation = async () => {
    try {
      const values = await relationForm.validateFields()
      if (!values.mapAId || !values.mapBId) {
        message.warning(getUserFacingMessage('map.relation.selectEndpoints'))
        return
      }
      const payload: MapRelationInput = {
        id: editingRelation?.id,
        novelId,
        mapAId: Number(values.mapAId),
        mapBId: Number(values.mapBId),
        relationType: values.relationType || RELATION_TYPE_OPTIONS[0].value,
        relationLabel: values.relationLabel?.trim() || '',
        bilateral: values.bilateral ? 1 : 0,
        description: values.description?.trim() || '',
        intensity: values.intensity || '',
        colorHint: values.colorHint || '',
        sortOrder: typeof values.sortOrder === 'number' ? values.sortOrder : 0,
      }

      setRelationSaving(true)
      await window.electron.map.upsertRelation(payload)
      const { relations } = await loadGraph()
      const nextSelected = editingRelation
        ? relations.find((item) => item.id === editingRelation.id) || null
        : relations.find((item) => (
          item.mapAId === payload.mapAId
          && item.mapBId === payload.mapBId
          && (item.relationType || '') === (payload.relationType || '')
          && (item.relationLabel || '') === (payload.relationLabel || '')
        )) || null

      setSelectedRelation(nextSelected)
      setRelationModalOpen(false)
      setEditingRelation(null)
      message.success(getUserFacingMessage(editingRelation ? 'common.relationUpdated' : 'map.relation.created'))
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'errorFields' in error) return
      message.error(getErrorMessage(error, 'common.relationSaveRetryLater'))
    } finally {
      setRelationSaving(false)
    }
  }

  const handleDeleteRelation = useCallback((relation: MapRelation) => {
    Modal.confirm({
      title: `删除关系“${getRelationLabelText(relation)}”？`,
      content: '删除后，这条显式关系会从图谱和节点详情中移除。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.map.deleteRelation(relation.id)
        setSelectedRelation(null)
        await loadGraph()
        message.success(getUserFacingMessage('map.relation.deleted'))
      },
    })
  }, [loadGraph])

  const handleGraphRelationSelect = useCallback((relationId: number) => {
    const relation = allRelations.find((item) => item.id === relationId) || null
    setSelectedRelation(relation)
    setGraphInspectorOpen(true)
    setGraphInspectorTab('relations')
  }, [allRelations])

  const openGraphInspector = useCallback((tab: 'focus' | 'relations' | 'detail') => {
    setGraphInspectorOpen(true)
    setGraphInspectorTab(tab)
  }, [])

  const handleGraphNodeSelect = useCallback((nodeId: number) => {
    setSelectedRelation(null)
    setGraphInspectorOpen(true)
    setGraphInspectorTab('detail')
    void focusNodeById(nodeId)
  }, [focusNodeById])

  const handleGraphCanvasClick = useCallback(() => {
    setSelectedRelation(null)
  }, [])

  const aiActions = selectedNode ? (
    <AIGenerateButton
      novelId={novelId}
      label="AI 补全·当前节点"
      isJson
      buildMessages={() => {
        const values = detailForm.getFieldsValue(true)
        return buildDraftMessages({
          task: '优化地图节点信息',
          mode: values.name ? 'optimize' : 'replace',
          context: [
            { label: '小说标题', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '当前路径', value: pathLabel },
            { label: '当前层级', value: selectedNode.level },
            { label: '父节点', value: currentParent?.name || '' },
          ],
          fields: [
            { key: 'name', label: '节点名称', value: values.name, hint: '名称要准确、可辨识，并且符合当前层级定位。' },
            { key: 'nodeType', label: '节点类型', value: values.nodeType, hint: '写清节点在地图结构中的类别，不要过于笼统。' },
            { key: 'locationType', label: '地点类型', value: values.locationType, hint: '补充这个地点的物理或功能类型。' },
            { key: 'structureRole', label: '结构定位', value: values.structureRole, hint: '说明它在整张地图里的作用，例如据点、交通枢纽、污染源。' },
            { key: 'description', label: '节点描述', value: values.description, hint: '描述要具体，可直接用于设定与写作。' },
            { key: 'atmosphere', label: '氛围', value: values.atmosphere, hint: '概括读者进入该地点后的第一感受。' },
            { key: 'plotRelevance', label: '剧情作用', value: values.plotRelevance, hint: '写清它和主线、冲突或支线的关系。' },
            { key: 'dangerLevel', label: '危险等级', value: values.dangerLevel, hint: '例如低、中、高、极高。' },
            { key: 'tags', label: '标签', type: 'string[]', value: values.tags, hint: '保留 3 到 6 个最有辨识度的标签。' },
            { key: 'affiliatedFactions', label: '关联势力', type: 'string[]', value: values.affiliatedFactions, hint: '只保留真正与节点有关系的势力。' },
          ],
          requirements: [
            '所有字段必须与当前世界规则、父节点和路径一致，不能脱离现有设定。',
            '优先补足信息密度，避免空话、套话和泛泛而谈。',
          ],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
        const currentValues = detailForm.getFieldsValue(true)
        detailForm.setFieldsValue({
          ...currentValues,
          name: typeof draft.name === 'string' ? draft.name : currentValues.name,
          nodeType: typeof draft.nodeType === 'string' ? draft.nodeType : currentValues.nodeType,
          locationType: typeof draft.locationType === 'string' ? draft.locationType : currentValues.locationType,
          structureRole: typeof draft.structureRole === 'string' ? draft.structureRole : currentValues.structureRole,
          description: typeof draft.description === 'string' ? draft.description : currentValues.description,
          atmosphere: typeof draft.atmosphere === 'string' ? draft.atmosphere : currentValues.atmosphere,
          plotRelevance: typeof draft.plotRelevance === 'string' ? draft.plotRelevance : currentValues.plotRelevance,
          dangerLevel: typeof draft.dangerLevel === 'string' ? draft.dangerLevel : currentValues.dangerLevel,
          tags: normalizeStringArray(draft.tags ?? currentValues.tags),
          affiliatedFactions: normalizeStringArray(draft.affiliatedFactions ?? currentValues.affiliatedFactions),
        })
      }}
    />
  ) : null

  const autoPercent = autoStatus
    ? autoStatus.completed
      ? 100
      : autoStatus.pendingParentCount > 0
        ? Math.max(5, Math.min(95, Math.round((autoStatus.processedParentCount / Math.max(autoStatus.processedParentCount + autoStatus.pendingParentCount, 1)) * 100)))
        : autoTask?.status === 'running'
          ? 15
          : 0
    : 0

  const hasRunningAutoTask = autoTask?.status === 'running' || autoTask?.status === 'cancel_requested'
  const isSearching = searchKeyword.trim().length > 0

  const getNodeName = useCallback((nodeId: number) => {
    return flattenedTree.byId.get(nodeId)?.name || `节点 #${nodeId}`
  }, [flattenedTree.byId])

  const autoTaskTone = autoTask?.status === 'failed'
    ? 'error'
    : autoTask?.status === 'paused' || autoTask?.status === 'cancelled'
      ? 'warning'
      : autoTask?.status === 'success'
        ? 'success'
        : 'info'
  const autoTaskStatusText = autoTask ? (AUTO_TASK_STATUS_TEXT[autoTask.status || ''] || autoTask.status || '未运行') : '未运行'

  const autoTaskActions = (
    <Space wrap>
      {!autoTask || !['running', 'cancel_requested', 'paused'].includes(autoTask.status || '') ? (
        <Button type="primary" icon={<RobotOutlined />} loading={autoLoading} onClick={() => void handleStartAutoGenerate()}>
          启动自动分批
        </Button>
      ) : null}
      {['paused', 'cancelled'].includes(autoTask?.status || '') ? (
        <Button icon={<ReloadOutlined />} loading={autoLoading} onClick={() => void handleResumeAutoGenerate()}>
          继续
        </Button>
      ) : null}
      {hasRunningAutoTask ? (
        <Button danger icon={<StopOutlined />} loading={autoStopping} onClick={() => void handleStopAutoGenerate()}>
          暂停
        </Button>
      ) : null}
    </Space>
  )

  const autoTaskSummary = autoTask
    ? `任务${autoTaskStatusText} · 第 ${autoStatus.targetDepth ?? '-'} 层 · 已处理 ${autoStatus.processedParentCount} · 待处理 ${autoStatus.pendingParentCount}${autoStatus.currentParentName ? ` · 当前对象 ${autoStatus.currentParentName}` : ''}`
    : '暂未启动自动分批。启动后系统会按地图蓝图在后台持续补齐节点。'
  const autoTaskTitle = autoTask ? `自动分批 · ${autoTaskStatusText}` : '自动分批'
  const autoTaskMessage = autoTask
    ? (autoStatus.message || `自动分批${autoTaskStatusText}。`)
    : '当前没有运行中的自动任务。'
  const autoTaskDescription = autoTask
    ? (autoStatus.lastError || (autoStatus.currentParentName ? `当前处理对象：${autoStatus.currentParentName}` : '系统会逐批校验蓝图、补齐节点并刷新图谱。'))
    : '需要时可展开查看进度，或直接从这里启动后台自动分批。'

  const renderAutoTaskStrip = (mode: 'graph' | 'list') => (
    <TaskStrip
      className={`map-auto-task-card map-auto-task-card--${mode}`}
      title={autoTaskTitle}
      summary={autoTaskSummary}
      actions={autoTaskActions}
      tone={autoTaskTone}
      expanded={autoTaskCardExpanded}
      onToggle={setAutoTaskCardExpanded}
    >
      <Alert
        type={autoTask?.status === 'failed' ? 'error' : autoTask?.status === 'paused' || autoTask?.status === 'cancelled' ? 'warning' : autoTask?.status === 'success' ? 'success' : 'info'}
        showIcon
        message={autoTaskMessage}
        description={autoTaskDescription}
      />

      <div className="map-auto-task-card__progress">
        <Progress percent={autoPercent} status={autoTask?.status === 'failed' ? 'exception' : autoTask?.status === 'success' ? 'success' : 'active'} />
        <div className="novel-note-list map-auto-task-card__notes">
          <div className="novel-note-list__item">{`任务状态：${autoTaskStatusText}`}</div>
          <div className="novel-note-list__item">{`当前层级：${autoStatus.targetDepth ?? '-'}`}</div>
          <div className="novel-note-list__item">{`已处理父节点：${autoStatus.processedParentCount}`}</div>
          <div className="novel-note-list__item">{`待处理父节点：${autoStatus.pendingParentCount}`}</div>
          <div className="novel-note-list__item">{`累计生成节点：${autoStatus.generatedNodeCount}`}</div>
          <div className="novel-note-list__item">{`当前重试次数：${autoStatus.retryCount}`}</div>
        </div>
      </div>
    </TaskStrip>
  )

  const detailActions = (
    <Space wrap>
      {aiActions}
      {workspaceMode === 'graph' && selectedNode ? <Button icon={<ShareAltOutlined />} onClick={openCreateRelation}>新建关系</Button> : null}
      {selectedNode && selectedNode.level < maxDepth ? <Button icon={<PlusOutlined />} onClick={() => void handleAddChild()}>添加子节点</Button> : null}
      {selectedNode ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}
      <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!selectedNode} onClick={() => void handleSave()}>保存</Button>
    </Space>
  )

  const detailFormContent = (
    <Form form={detailForm} layout="vertical">
      <div className="novel-grid novel-grid--3">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="nodeType" label="节点类型">
          <Select showSearch allowClear options={nodeTypeOptions.map((value) => ({ value, label: value }))} />
        </Form.Item>
        <Form.Item name="dangerLevel" label="危险等级">
          <Input placeholder="例如：低 / 中 / 高 / 极高" />
        </Form.Item>
      </div>

      <div className="novel-grid novel-grid--2">
        <Form.Item name="locationType" label="地点类型">
          <Input />
        </Form.Item>
        <Form.Item name="structureRole" label="结构定位">
          <Input />
        </Form.Item>
      </div>

      <Form.Item name="description" label="描述">
        <Input.TextArea rows={5} />
      </Form.Item>
      <Form.Item name="atmosphere" label="氛围">
        <Input />
      </Form.Item>
      <Form.Item name="plotRelevance" label="剧情作用">
        <Input.TextArea rows={6} />
      </Form.Item>

      <div className="novel-grid novel-grid--2">
        <Form.Item name="tags" label="标签">
          <Select mode="tags" open={false} placeholder="输入后回车" />
        </Form.Item>
        <Form.Item name="affiliatedFactions" label="关联势力">
          <Select mode="tags" options={factionOptions.map((value) => ({ value, label: value }))} placeholder="可输入或选择现有势力" />
        </Form.Item>
      </div>
    </Form>
  )

  return (
    <WorkspacePage
      className="novel-map-page"
      layout="wide"
      eyebrow="地图结构"
      title="地图结构"
      description="图谱默认显示整张地图树结构，优先保证全局可浏览、可定位、可查看；右侧检查器只负责节点和关系详情，不再主导主画布布局。"
      guide={(
        <WorkspaceStepGuide
          steps={[
            { title: '先定位层级或焦点节点', description: '优先从根层、路径或节点定位开始，不再先滚过整页表单再找地图位置。', status: 'focus' },
            { title: '再看关系或节点详情', description: '图谱模式右侧检查器只负责焦点、关系、详情三件事；列表模式则固定在右侧编辑当前节点。', status: 'todo' },
            { title: '最后再执行生成或修补', description: 'AI 入口只补当前节点或按层级生成，不直接挤占主画布。', status: 'todo' },
          ]}
        />
      )}
      actions={(
        <Space wrap>
          <Button type={workspaceMode === 'list' ? 'primary' : 'default'} icon={<UnorderedListOutlined />} onClick={() => setWorkspaceMode('list')}>列表模式</Button>
          <Button type={workspaceMode === 'graph' ? 'primary' : 'default'} icon={<ShareAltOutlined />} onClick={() => setWorkspaceMode('graph')}>图谱模式</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshVisible({ preferredId: selectedNode?.id || null })}>刷新</Button>
          <Button icon={<ApartmentOutlined />} onClick={openBatchModal}>AI 生成·层级骨架</Button>
          <Button icon={<PlusOutlined />} onClick={() => void handleAddRoot()}>添加根节点</Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '题材', value: currentNovel?.genreName || '未设置' },
            { label: '蓝图层级', value: `${blueprintLevels.length} 层` },
            { label: '当前路径', value: pathLabel },
            { label: '当前焦点', value: selectedNode?.name || '未选中节点' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="根节点" value={stats.rootCount} tone="warm" />
          <WorkspaceMetric label="第二层" value={stats.secondLevelCount} />
          <WorkspaceMetric label="叶子节点" value={stats.leafCount} tone="cool" />
          <WorkspaceMetric label="显式关系" value={allRelations.length} hint="手工维护的地图关系条目" />
          <WorkspaceMetric label="总节点" value={stats.total} hint={`最大深度 ${stats.maxDepth || 0} 层`} />
        </>
      )}
    >
      {workspaceMode === 'graph' ? (
        <div className={`map-graph-workspace ${graphInspectorOpen ? 'map-graph-workspace--inspector-open' : 'map-graph-workspace--inspector-closed'} ${graphFullscreen ? 'map-graph-workspace--fullscreen' : ''}`}>
          <div ref={graphStageRef} className={`map-graph-stage ${graphFullscreen ? 'map-graph-stage--fullscreen' : ''}`}>
            <WorkspacePanel
              className="map-graph-stage-panel"
              bodyClassName="map-graph-stage-panel__body"
              title="地图图谱"
              description="图谱优先展示上下级、关联关系和节点简介；右侧信息区只在需要时展开，让主画布保持完整和可拖拽。"
              extra={(
                <div className="map-graph-toolbar">
                  <div className="map-graph-toolbar__row">
                    <Select
                      showSearch
                      allowClear
                      placeholder="定位节点"
                      value={selectedNode?.id}
                      options={nodePathOptions}
                      optionFilterProp="label"
                      onChange={(value) => {
                        setGraphInspectorOpen(typeof value === 'number')
                        setGraphInspectorTab(typeof value === 'number' ? 'detail' : 'focus')
                        void focusNodeById(value)
                      }}
                    />
                    <Button onClick={() => void focusNodeById(undefined)}>根层总览</Button>
                    <Button icon={<ReloadOutlined />} onClick={() => void loadGraph()}>刷新总览</Button>
                    <Button icon={graphFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />} onClick={() => void toggleGraphFullscreen()}>
                      {graphFullscreen ? '退出全屏' : '画布全屏'}
                    </Button>
                  </div>

                  <div className="map-graph-toolbar__row map-graph-toolbar__row--actions">
                    <Button type={graphInspectorOpen && graphInspectorTab === 'focus' ? 'primary' : 'default'} onClick={() => openGraphInspector('focus')}>焦点</Button>
                    <Button type={graphInspectorOpen && graphInspectorTab === 'relations' ? 'primary' : 'default'} disabled={!selectedNode} onClick={() => openGraphInspector('relations')}>关系</Button>
                    <Button type={graphInspectorOpen && graphInspectorTab === 'detail' ? 'primary' : 'default'} disabled={!selectedNode} onClick={() => openGraphInspector('detail')}>详情</Button>
                    <Button
                      icon={graphInspectorOpen ? <EyeInvisibleOutlined /> : <DownOutlined />}
                      onClick={() => {
                        if (graphInspectorOpen) setGraphInspectorOpen(false)
                        else openGraphInspector(selectedRelation ? 'relations' : selectedNode ? 'detail' : 'focus')
                      }}
                    >
                      {graphInspectorOpen ? '隐藏侧栏' : '展开侧栏'}
                    </Button>
                  </div>

                  <div className="map-graph-toolbar__row">
                    <Tag color="gold">{`层级边 ${graphHierarchyCount}`}</Tag>
                    <Tag color="blue">{`关系边 ${graphRelationCount}`}</Tag>
                    <Tag>{`可见节点 ${graphData.nodes.length}`}</Tag>
                    <Tag color={graphInspectorOpen ? 'processing' : 'default'}>{graphInspectorOpen ? '检查器已展开' : '主画布优先'}</Tag>
                  </div>
                </div>
              )}
            >
            <div className="map-graph-stage-brief">
              <div className="map-graph-stage-brief__copy">
                <div className="novel-kicker">{selectedNode ? '当前焦点' : '根层总览'}</div>
                <strong>{selectedNode?.name || '未锁定焦点节点'}</strong>
                <div className="map-graph-stage-brief__path">{pathLabel}</div>
                <p>{selectedNodeLead || '默认展示整张地图树。拖动画布浏览，滚轮缩放，点击任意节点后可在右侧检查器查看具体信息。'}</p>
                <div className="map-graph-stage-brief__tags">
                  {selectedNode?.nodeType ? <Tag color="blue">{selectedNode.nodeType}</Tag> : null}
                  {selectedNode?.locationType ? <Tag>{selectedNode.locationType}</Tag> : null}
                  {selectedNode?.dangerLevel ? <Tag color="red">{selectedNode.dangerLevel}</Tag> : null}
                  {selectedNodeTags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                </div>
              </div>

              <div className="map-graph-stage-brief__metrics">
                <div className="map-graph-stage-pill">
                  <span>{selectedNode ? '直属下级' : '根节点'}</span>
                  <strong>{selectedNode ? selectedNode.childCount : stats.rootCount}</strong>
                </div>
                <div className="map-graph-stage-pill">
                  <span>{selectedNode ? '显式关系' : '关系条目'}</span>
                  <strong>{selectedNode ? selectedNodeRelations.length : allRelations.length}</strong>
                </div>
                <div className="map-graph-stage-pill">
                  <span>{selectedNode ? '所在层级' : '最大深度'}</span>
                  <strong>{selectedNode ? `L${selectedNode.level}` : `${stats.maxDepth || 0} 层`}</strong>
                </div>
                <div className="map-graph-stage-pill">
                  <span>当前可见</span>
                  <strong>{graphData.nodes.length}</strong>
                </div>
              </div>
            </div>

            {renderAutoTaskStrip('graph')}

            {graphLoading ? (
              <div className="novel-empty map-graph-loading"><Spin /></div>
            ) : (
              <MapGraphCanvas
                data={graphData}
                selectedNodeId={selectedNode?.id}
                selectedRelationId={selectedRelation?.id}
                showSummary={graphFilters.showSummary}
                showMeta={graphFilters.showMeta}
                showHierarchyEdges={graphFilters.showHierarchyEdges}
                showRelationEdges={graphFilters.includeRelationEdges}
                onNodeSelect={handleGraphNodeSelect}
                onRelationSelect={handleGraphRelationSelect}
                onCanvasClick={handleGraphCanvasClick}
              />
            )}
            </WorkspacePanel>
          </div>

          {graphInspectorOpen ? (
            <div className="map-graph-sidebar">
              <div className="map-graph-inspector-switches">
                <Button type={graphInspectorTab === 'focus' ? 'primary' : 'default'} onClick={() => setGraphInspectorTab('focus')}>焦点</Button>
                <Button type={graphInspectorTab === 'relations' ? 'primary' : 'default'} disabled={!selectedNode} onClick={() => setGraphInspectorTab('relations')}>关系</Button>
                <Button type={graphInspectorTab === 'detail' ? 'primary' : 'default'} disabled={!selectedNode} onClick={() => setGraphInspectorTab('detail')}>详情</Button>
              </div>

              {graphInspectorTab === 'focus' ? (
                <WorkspacePanel className="map-graph-inspector-panel" bodyClassName="map-graph-inspector-panel__body" title="焦点概览" description="显示当前节点的定位、标签和关系摘要。" scrollable sticky>
                  <div className="map-graph-focus-card">
                    <div className="map-graph-focus-card__title">
                      <div>
                        <div className="novel-kicker">{selectedNode ? '当前焦点' : '根层总览'}</div>
                        <strong>{selectedNode?.name || '未锁定焦点节点'}</strong>
                      </div>
                      <Tag color={selectedNode ? 'processing' : 'default'}>{selectedNode ? `L${selectedNode.level}` : 'ROOT'}</Tag>
                    </div>

                    <div className="map-graph-focus-card__summary">{selectedNodeLead || '先选择一个节点，图谱会围绕它展开。'}</div>

                    <div className="map-graph-focus-card__path">{pathLabel}</div>

                    <div className="map-graph-badges">
                      {selectedNode?.nodeType ? <Tag color="blue">{selectedNode.nodeType}</Tag> : null}
                      {selectedNode?.locationType ? <Tag>{selectedNode.locationType}</Tag> : null}
                      {selectedNode?.dangerLevel ? <Tag color="red">{selectedNode.dangerLevel}</Tag> : null}
                      {selectedNodeTags.slice(0, 4).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                      {selectedNodeFactions.slice(0, 2).map((faction) => <Tag key={faction} color="geekblue">{faction}</Tag>)}
                    </div>

                    <div className="map-graph-stats">
                      <div className="map-graph-stat">
                        <strong>{selectedNode?.childCount || 0}</strong>
                        <span>直属下级</span>
                      </div>
                      <div className="map-graph-stat">
                        <strong>{selectedNodeRelations.length}</strong>
                        <span>显式关系</span>
                      </div>
                      <div className="map-graph-stat">
                        <strong>{selectedNode ? selectedNodeRelations.length : allRelations.length}</strong>
                        <span>{selectedNode ? '显式关系' : '关系条目'}</span>
                      </div>
                      <div className="map-graph-stat">
                        <strong>{graphData.nodes.length}</strong>
                        <span>当前可见</span>
                      </div>
                    </div>
                  </div>

                  <div className="map-graph-filters">
                    <div className="map-graph-filters__hint">总览模式固定展示整张地图树。可按需切换层级边、关系边和节点信息密度。</div>
                    <div className="map-graph-switch-list">
                      <div className="map-graph-switch">
                        <span>显示层级边</span>
                        <Switch checked={graphFilters.showHierarchyEdges} onChange={(checked) => setGraphFilters((current) => ({ ...current, showHierarchyEdges: checked }))} />
                      </div>
                      <div className="map-graph-switch">
                        <span>显示关系边</span>
                        <Switch checked={graphFilters.includeRelationEdges} onChange={(checked) => setGraphFilters((current) => ({ ...current, includeRelationEdges: checked }))} />
                      </div>
                      <div className="map-graph-switch">
                        <span>显示简介</span>
                        <Switch checked={graphFilters.showSummary} onChange={(checked) => setGraphFilters((current) => ({ ...current, showSummary: checked }))} />
                      </div>
                      <div className="map-graph-switch">
                        <span>显示标签 / 势力</span>
                        <Switch checked={graphFilters.showMeta} onChange={(checked) => setGraphFilters((current) => ({ ...current, showMeta: checked }))} />
                      </div>
                    </div>
                  </div>
                </WorkspacePanel>
              ) : null}

              {graphInspectorTab === 'relations' ? (
                <WorkspacePanel
                  className="map-graph-inspector-panel"
                  bodyClassName="map-graph-inspector-panel__body"
                  title={selectedRelation ? `关系详情 · ${getRelationLabelText(selectedRelation)}` : selectedNode ? `节点关系 · ${selectedNode.name}` : '节点关系'}
                  description="维护选中节点的显式关系，并快速查看两端节点之间的连接说明。"
                  scrollable
                  sticky
                >
                  {selectedNode ? (
                    <div className="map-graph-detail-actions">
                      <Space wrap>
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRelation}>新建关系</Button>
                        {selectedRelation ? <Button icon={<EditOutlined />} onClick={() => openEditRelation(selectedRelation)}>编辑</Button> : null}
                        {selectedRelation ? <Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteRelation(selectedRelation)}>删除</Button> : null}
                      </Space>
                    </div>
                  ) : null}

                  {selectedRelation ? (
                    <div className="map-graph-detail-grid">
                      <div className="map-graph-detail-grid__item">
                        <span>关系类型</span>
                        <strong>{getRelationLabelText(selectedRelation)}</strong>
                      </div>
                      <div className="map-graph-detail-grid__item">
                        <span>连接节点</span>
                        <strong>{`${getNodeName(selectedRelation.mapAId)} ↔ ${getNodeName(selectedRelation.mapBId)}`}</strong>
                      </div>
                      <div className="map-graph-detail-grid__item">
                        <span>关系强度</span>
                        <strong>{getRelationIntensityText(selectedRelation.intensity)}</strong>
                      </div>
                      <div className="map-graph-detail-grid__item">
                        <span>方向</span>
                        <strong>{selectedRelation.bilateral > 0 ? '双向' : '单向'}</strong>
                      </div>
                      <div className="map-graph-detail-grid__item">
                        <span>说明</span>
                        <strong>{selectedRelation.description || '还没有补充关系说明。'}</strong>
                      </div>
                    </div>
                  ) : null}

                  {selectedNode ? (
                    <div className={selectedRelation ? 'map-graph-relations-offset' : undefined}>
                      {selectedNodeRelations.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前节点还没有显式关系。" />
                      ) : (
                        <div className="map-graph-relation-list">
                          {selectedNodeRelations.map((relation) => {
                            const otherNodeId = getOtherNodeId(relation, selectedNode.id)
                            const relationType = getRelationTypeMeta(relation.relationType)
                            return (
                              <button
                                key={relation.id}
                                type="button"
                                className={`map-graph-relation-item ${selectedRelation?.id === relation.id ? 'map-graph-relation-item--active' : ''}`}
                                onClick={() => setSelectedRelation(relation)}
                              >
                                <div className="map-graph-relation-item__head">
                                  <div className="map-graph-relation-item__title">{getNodeName(otherNodeId)}</div>
                                  <Tag color={relationType ? undefined : 'default'} style={relationType ? { color: relationType.color, borderColor: `${relationType.color}55`, background: `${relationType.color}11` } : undefined}>
                                    {getRelationLabelText(relation)}
                                  </Tag>
                                </div>
                                <div className="map-graph-relation-item__meta map-graph-relation-item__meta--spaced">
                                  <Tag>{relation.bilateral > 0 ? '双向' : '单向'}</Tag>
                                  {relation.intensity ? <Tag color="processing">{getRelationIntensityText(relation.intensity)}</Tag> : null}
                                </div>
                                <div className="map-graph-relation-item__desc">{relation.description || '还没有补充关系说明。'}</div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="novel-empty">先选择一个节点，再查看或维护它的地图关系。</div>
                  )}
                </WorkspacePanel>
              ) : null}

              {graphInspectorTab === 'detail' ? (
                <WorkspacePanel className="map-graph-inspector-panel" bodyClassName="map-graph-inspector-panel__body" title={selectedNode ? `节点详情 · ${selectedNode.name}` : '节点详情'} description="编辑焦点节点的基础信息，右侧表单不会再压缩主图谱视图。" scrollable sticky>
                  <div className="map-graph-detail-actions">{detailActions}</div>
                  {!selectedNode ? (
                    <div className="novel-empty">从图谱中选择一个节点开始编辑。</div>
                  ) : null}
                  <div hidden={!selectedNode}>{detailFormContent}</div>
                </WorkspacePanel>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="map-list-workspace">
          <WorkspacePanel
            className="map-list-panel"
            title={isSearching ? '搜索结果' : '根节点'}
            description={isSearching ? '关键词会在全部地图节点中检索，结果仍可作为图谱焦点继续展开。' : '根节点决定地图的最高层级结构，适合先建立主区域、主基地或主城市。'}
            scrollable
            extra={(
              <div className="novel-filter-bar">
                <div className="novel-filter-bar__row">
                  <Input.Search allowClear placeholder="搜索名称、类型、简介" value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)} onSearch={setSearchKeyword} />
                </div>
                <div className="novel-filter-bar__summary">{isSearching ? `搜索结果 ${rootData.total} 条` : `根节点共 ${rootData.total} 个`}</div>
              </div>
            )}
          >
            <div className="map-list-panel__stack">
              {renderAutoTaskStrip('list')}

              {loading ? (
                <div className="novel-empty"><Spin /></div>
              ) : rootData.total === 0 ? (
                <div className="novel-empty">{isSearching ? '当前关键词下没有匹配节点。' : '还没有根节点，先创建一个。'}</div>
              ) : (
                <div className="map-list-panel__results">
                  <div className="map-node-stack">
                    {rootData.items.map((node: MapNodeSummary) => (
                      <button key={node.id} type="button" className={`novel-list-card workspace-button-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => void handleSelectRoot(node)}>
                        <div className="novel-list-card__title">{node.name}</div>
                        <div className="novel-list-card__meta">
                          <Tag color="blue">{node.nodeType || node.locationType || `L${node.level}`}</Tag>
                          <Tag>{`${node.childCount} 个下级`}</Tag>
                        </div>
                        <div className="novel-list-card__desc">{node.plotRelevance || node.description || '还没有补充说明。'}</div>
                      </button>
                    ))}
                  </div>
                  <Pagination current={rootData.page} pageSize={rootData.pageSize} total={rootData.total} size="small" showSizeChanger={false} onChange={setRootPage} />
                </div>
              )}
            </div>
          </WorkspacePanel>

          <WorkspacePanel
            className="map-list-panel"
            title={currentParent ? `分支下级 · ${currentParent.name}` : '分支下级'}
            description={currentParent ? '展示当前节点的直属下级，可继续下钻，也可直接在右侧编辑。' : '先从左侧选择一个根节点，再查看它的下级结构。'}
            scrollable
            extra={branchPath.length > 0 ? (
              <Space wrap>
                {branchPath.map((item, index) => <Button key={item.id} size="small" type={index === branchPath.length - 1 ? 'primary' : 'default'} onClick={() => void handleBreadcrumb(index)}>{item.name}</Button>)}
              </Space>
            ) : null}
          >
            {!currentParent ? (
              <div className="novel-empty">先选择一个根节点。</div>
            ) : branchData.total === 0 ? (
              <div className="novel-empty">当前节点还没有下级，可直接在右侧新增。</div>
            ) : (
              <div className="map-list-panel__results">
                <div className="map-node-stack">
                  {branchData.items.map((node: MapNodeSummary) => (
                    <button key={node.id} type="button" className={`novel-list-card workspace-button-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => selectNode(node)}>
                      <div className="novel-list-card__title">{node.name}</div>
                      <div className="novel-list-card__meta">
                        <Tag>{node.nodeType || node.locationType || `L${node.level}`}</Tag>
                        <Tag color={node.childCount > 0 ? 'processing' : 'default'}>{`${node.childCount} 个下级`}</Tag>
                        {node.dangerLevel ? <Tag color="red">{node.dangerLevel}</Tag> : null}
                      </div>
                      <div className="novel-list-card__desc">{node.plotRelevance || node.description || '还没有补充说明。'}</div>
                      {node.childCount > 0 ? (
                        <div className="map-list-panel__link">
                          <Button size="small" type="link" onClick={(event) => { event.stopPropagation(); void handleDive(node) }}>进入下级</Button>
                        </div>
                      ) : null}
                    </button>
                  ))}
                </div>
                <Pagination current={branchData.page} pageSize={branchData.pageSize} total={branchData.total} size="small" showSizeChanger={false} onChange={setBranchPage} />
              </div>
            )}
          </WorkspacePanel>

          <WorkspacePanel className="map-list-panel map-list-panel--detail" title={selectedNode ? `节点详情 · ${selectedNode.name}` : '节点详情'} description="图谱与列表共用同一套详情表单，方便随时补充简介、上下级和关系信息。" extra={detailActions} scrollable sticky>
            {!selectedNode ? (
              <div className="novel-empty">从左侧选择一条节点记录，或先新建。</div>
            ) : null}
            <div hidden={!selectedNode}>{detailFormContent}</div>
            {selectedNode ? (
              <>
                <div className="map-node-relations-inline">
                  <div className="map-node-relations-inline__head">
                    <strong>相关关系</strong>
                    <Space>
                      <Button size="small" icon={<ShareAltOutlined />} onClick={() => { setWorkspaceMode('graph'); openGraphInspector('relations') }}>转到图谱查看</Button>
                      <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreateRelation}>新建关系</Button>
                    </Space>
                  </div>

                  {selectedNodeRelations.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前节点还没有显式关系。" />
                  ) : (
                    <div className="map-graph-relation-list">
                      {selectedNodeRelations.slice(0, 4).map((relation) => {
                        const otherNodeId = getOtherNodeId(relation, selectedNode.id)
                        return (
                          <button key={relation.id} type="button" className="map-graph-relation-item" onClick={() => { setSelectedRelation(relation); setWorkspaceMode('graph'); openGraphInspector('relations') }}>
                            <div className="map-graph-relation-item__head">
                              <div className="map-graph-relation-item__title">{getNodeName(otherNodeId)}</div>
                              <Tag>{getRelationLabelText(relation)}</Tag>
                            </div>
                            <div className="map-graph-relation-item__desc">{relation.description || '还没有补充关系说明。'}</div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </WorkspacePanel>
        </div>
      )}

      <Modal
        title="按层级生成地图"
        open={batchOpen}
        forceRender
        onCancel={() => { if (!autoLoading) setBatchOpen(false) }}
        onOk={() => void handleStartAutoGenerate()}
        confirmLoading={autoLoading}
        okText="开始后台生成"
        cancelButtonProps={{ disabled: autoLoading }}
      >
        <Form form={batchForm} layout="vertical">
          {blueprintLevels.map((level) => {
            const scaledLevel = scaledBlueprintLevels.find((item) => item.depth === level.depth)
            const recommendedCount = scaledLevel?.suggestedCount || level.suggestedCount
            return (
            <Form.Item
              key={level.depth}
              name={`layer_${level.depth}`}
              label={level.depth === 1 ? `${level.label || '根层'}建议数量` : `第 ${level.depth} 层 · ${level.label || '节点'} 建议数量`}
              initialValue={recommendedCount}
              tooltip={scaledLevel?.rationale}
            >
              <InputNumber min={1} max={Math.max(12, recommendedCount)} addonAfter={recommendedCount !== level.suggestedCount ? '规模推荐' : undefined} className="workspace-input-number-full" />
            </Form.Item>
          )})}
          <Form.Item name="parentBatchSize" label="每批父节点数量" initialValue={1}>
            <Select options={[1, 2, 3].map((value) => ({ value, label: `${value} 个父节点 / 批` }))} />
          </Form.Item>
          <Form.Item name="maxRetries" label="单批最大重试次数" initialValue={2}>
            <Select options={[1, 2, 3, 4].map((value) => ({ value, label: `${value} 次` }))} />
          </Form.Item>
          <Form.Item name="namedPlaces" label="指定地名 / 重点地点">
            <Input.TextArea rows={5} placeholder="可输入希望优先覆盖的城市、据点、地标、禁区等地点信息。" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRelation ? '编辑关系' : '新建关系'}
        open={relationModalOpen}
        forceRender
        onCancel={() => {
          if (!relationSaving) {
            setRelationModalOpen(false)
            setEditingRelation(null)
          }
        }}
        onOk={() => void handleSaveRelation()}
        confirmLoading={relationSaving}
        okText={editingRelation ? '保存关系' : '创建关系'}
      >
        <Form form={relationForm} layout="vertical">
          <div className="novel-grid novel-grid--2">
            <Form.Item name="mapAId" label="起点节点" rules={[{ required: true, message: '请选择起点节点' }]}>
              <Select showSearch optionFilterProp="label" options={nodePathOptions} />
            </Form.Item>
            <Form.Item name="mapBId" label="终点节点" rules={[{ required: true, message: '请选择终点节点' }]}>
              <Select showSearch optionFilterProp="label" options={nodePathOptions} />
            </Form.Item>
          </div>

          <div className="novel-grid novel-grid--2">
            <Form.Item name="relationType" label="关系类型" rules={[{ required: true, message: '请选择关系类型' }]}>
              <Select
                options={relationTypeDisplayOptions.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(value) => {
                  const option = getRelationTypeMeta(value)
                  if (!option) return
                  if (!relationForm.getFieldValue('colorHint')) relationForm.setFieldValue('colorHint', option.color)
                }}
              />
            </Form.Item>
            <Form.Item name="intensity" label="关系强度">
              <Select allowClear options={relationIntensityDisplayOptions} />
            </Form.Item>
          </div>

          <div className="novel-grid novel-grid--2">
            <Form.Item name="relationLabel" label="关系标签">
              <Input placeholder="例如：补给线 / 互相敌视 / 隐蔽通道" />
            </Form.Item>
            <Form.Item name="colorHint" label="关系颜色">
              <Select allowClear options={relationTypeDisplayOptions.map((item) => ({ value: item.color, label: `${item.label} · ${item.color}` }))} />
            </Form.Item>
          </div>

          <div className="novel-grid novel-grid--2">
            <Form.Item name="bilateral" label="双向关系" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <InputNumber min={0} className="workspace-input-number-full" />
            </Form.Item>
          </div>

          <Form.Item name="description" label="关系说明">
            <Input.TextArea rows={6} placeholder="补充这条关系如何形成、有什么影响、是否稳定等信息。" />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
