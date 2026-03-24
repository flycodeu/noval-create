import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, Modal, Pagination, Progress, Select, Space, Spin, Tag, message } from 'antd'
import { ApartmentOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ShareAltOutlined, StopOutlined, UnorderedListOutlined } from '@ant-design/icons'
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow'
import VirtualList from 'rc-virtual-list'
import 'reactflow/dist/style.css'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { MapAutoGenerateStatus, MapBatchGenerateOptions, MapBatchGenerationResult, MapNodeSummary, MapStats, PagedResult, Task } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getBlueprintLevelByDepth, getFactionNameOptions, getMapBlueprintDepth, getMapNodeTypeOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { buildDraftMessages, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import '../components/boards.css'

interface Props { novelId: number }
interface DetailFormValues {
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

const PAGE_SIZE = 20
const EMPTY_PAGE: PagedResult<MapNodeSummary> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: MapStats = { total: 0, rootCount: 0, secondLevelCount: 0, leafCount: 0, maxDepth: 0, countsByLevel: [] }
const EMPTY_AUTO_STATUS: MapAutoGenerateStatus = { taskId: 0, novelId: 0, status: 'pending', currentStage: 'idle', targetDepth: null, currentParentName: '', generatedNodeCount: 0, processedParentCount: 0, pendingParentCount: 0, retryCount: 0, lastError: '', completed: false, message: '', currentBatchKey: '' }

function parseStringArrayJson(raw?: string) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function toFormValues(node: MapNodeSummary): DetailFormValues {
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

function buildGenerateOptions(
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

function buildBranchGraph(path: MapNodeSummary[], branchItems: MapNodeSummary[], selectedId: number | null) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const chain = path.length > 0 ? path : branchItems
  chain.forEach((node, index) => {
    nodes.push({
      id: `path-${node.id}`,
      position: { x: index * 240, y: 40 },
      data: { label: `${node.name}\n${node.nodeType || node.locationType || `第 ${node.level} 层`}` },
      draggable: false,
      style: { width: 180, borderRadius: 18, padding: '10px 12px', border: selectedId === node.id ? '2px solid rgba(143,99,48,.88)' : '1px solid rgba(122,93,52,.18)', background: 'rgba(255,255,255,.94)', whiteSpace: 'pre-line', boxShadow: '0 12px 24px rgba(71,53,28,.08)' },
    })
    if (index > 0) edges.push({ id: `path-edge-${path[index - 1].id}-${node.id}`, source: `path-${path[index - 1].id}`, target: `path-${node.id}`, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#8f6330', strokeWidth: 1.4 } })
  })
  const branchParent = path[path.length - 1]
  branchItems.forEach((node, index) => {
    nodes.push({
      id: `branch-${node.id}`,
      position: { x: index * 220, y: 220 },
      data: { label: `${node.name}\n${node.nodeType || node.locationType || `第 ${node.level} 层`}` },
      draggable: false,
      style: { width: 180, borderRadius: 18, padding: '10px 12px', border: selectedId === node.id ? '2px solid rgba(46,134,171,.88)' : '1px solid rgba(46,134,171,.2)', background: 'rgba(255,255,255,.94)', whiteSpace: 'pre-line', boxShadow: '0 12px 24px rgba(24,44,52,.08)' },
    })
    if (branchParent) edges.push({ id: `branch-edge-${branchParent.id}-${node.id}`, source: `path-${branchParent.id}`, target: `branch-${node.id}`, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#2E86AB', strokeWidth: 1.4 } })
  })
  return { nodes, edges }
}

export default function MapExplorer({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const [detailForm] = Form.useForm<DetailFormValues>()
  const [batchForm] = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [autoLoading, setAutoLoading] = useState(false)
  const [autoStopping, setAutoStopping] = useState(false)
  const [rootData, setRootData] = useState<PagedResult<MapNodeSummary>>(EMPTY_PAGE)
  const [branchData, setBranchData] = useState<PagedResult<MapNodeSummary>>(EMPTY_PAGE)
  const [stats, setStats] = useState<MapStats>(EMPTY_STATS)
  const [selectedNode, setSelectedNode] = useState<MapNodeSummary | null>(null)
  const [branchPath, setBranchPath] = useState<MapNodeSummary[]>([])
  const [rootPage, setRootPage] = useState(1)
  const [branchPage, setBranchPage] = useState(1)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [batchOpen, setBatchOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'branch' | 'graph'>('branch')
  const [autoTask, setAutoTask] = useState<Task | null>(null)
  const [autoStatus, setAutoStatus] = useState<MapAutoGenerateStatus>(EMPTY_AUTO_STATUS)

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const blueprintLevels = useMemo(() => [...worldRules.mapBlueprint.levels].sort((a, b) => a.depth - b.depth), [worldRules.mapBlueprint.levels])
  const maxDepth = getMapBlueprintDepth(worldRules)
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const nodeTypeOptions = useMemo(() => getMapNodeTypeOptions(worldRules), [worldRules])
  const currentParent = branchPath[branchPath.length - 1] || null
  const branchGraph = useMemo(() => buildBranchGraph(branchPath, branchData.items, selectedNode?.id || null), [branchData.items, branchPath, selectedNode?.id])
  const pathLabel = branchPath.length > 0 ? branchPath.map((item) => item.name).join(' / ') : '未进入分支'

  const loadRoots = useCallback(async (targetPage = rootPage) => {
    const list = await window.electron.map.queryNodes(searchKeyword.trim() ? { novelId, keyword: searchKeyword.trim(), page: targetPage, pageSize: PAGE_SIZE } : { novelId, parentId: null, page: targetPage, pageSize: PAGE_SIZE })
    setRootData(list)
  }, [novelId, rootPage, searchKeyword])
  const loadBranch = useCallback(async (parent: MapNodeSummary | null, targetPage = branchPage) => {
    if (!parent) { setBranchData(EMPTY_PAGE); return }
    setBranchData(await window.electron.map.queryNodes({ novelId, parentId: parent.id, page: targetPage, pageSize: PAGE_SIZE }))
  }, [branchPage, novelId])
  const loadStats = useCallback(async () => { setStats(await window.electron.map.getStats(novelId)) }, [novelId])
  const loadAutoStatus = useCallback(async () => {
    const latestTask = await window.electron.map.getLatestAutoGenerateTask(novelId)
    setAutoTask(latestTask)
    if (latestTask) {
      setAutoStatus(await window.electron.map.getAutoGenerateStatus(latestTask.id) || EMPTY_AUTO_STATUS)
      return latestTask
    }
    setAutoStatus(EMPTY_AUTO_STATUS)
    return null
  }, [novelId])
  const selectNode = useCallback((node: MapNodeSummary | null) => { setSelectedNode(node); if (node) detailForm.setFieldsValue(toFormValues(node)); else detailForm.resetFields() }, [detailForm])

  const refreshVisible = useCallback(async (preferredId?: number | null) => {
    setLoading(true)
    try {
      await Promise.all([loadRoots(rootPage), loadBranch(currentParent, branchPage), loadStats(), loadAutoStatus()])
      const nextSelected = preferredId ? await window.electron.map.getNode(preferredId) : selectedNode?.id ? await window.electron.map.getNode(selectedNode.id) : null
      if (nextSelected) selectNode(nextSelected)
      else { setSelectedNode(null); detailForm.resetFields() }
    } finally {
      setLoading(false)
    }
  }, [branchPage, currentParent, detailForm, loadAutoStatus, loadBranch, loadRoots, loadStats, rootPage, selectNode, selectedNode])

  useEffect(() => { void refreshVisible(selectedNode?.id || null) }, [refreshVisible, rootPage, branchPage, selectedNode?.id])
  useEffect(() => { setRootPage(1) }, [searchKeyword])
  useEffect(() => { const initialValues: Record<string, number> = { parentBatchSize: 1, maxRetries: 2 }; blueprintLevels.forEach((level) => { initialValues[`layer_${level.depth}`] = level.suggestedCount }); batchForm.setFieldsValue(initialValues) }, [batchForm, blueprintLevels])
  useEffect(() => {
    if (!autoTask?.id) return
    const reload = () => { void loadAutoStatus(); void loadStats() }
    const unsubProgress = window.electron.on('task:progress', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) reload()
    })
    const unsubStatus = window.electron.on('task:status-change', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) reload()
    })
    const unsubComplete = window.electron.on('task:complete', (data: unknown) => {
      const payload = data as { taskId: number }
      if (payload?.taskId === autoTask.id) {
        reload()
        void refreshVisible(selectedNode?.id || null)
      }
    })
    const timer = setInterval(reload, 5000)
    return () => {
      clearInterval(timer)
      unsubProgress()
      unsubStatus()
      unsubComplete()
    }
  }, [autoTask?.id, loadAutoStatus, loadStats, refreshVisible, selectedNode?.id])

  const handleSelectRoot = async (node: MapNodeSummary) => { setBranchPath([node]); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleDive = async (node: MapNodeSummary) => { setBranchPath((current) => [...current, node]); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleBreadcrumb = async (index: number) => { const nextPath = branchPath.slice(0, index + 1); const node = nextPath[nextPath.length - 1] || null; setBranchPath(nextPath); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleSave = async () => { if (!selectedNode) return; const values = detailForm.getFieldsValue(); setSaving(true); try { await window.electron.map.update(selectedNode.id, { ...values, tagsJson: JSON.stringify(values.tags || []), affiliatedFactionIdsJson: JSON.stringify(values.affiliatedFactions || []) }); await refreshVisible(selectedNode.id); message.success('地图节点已保存。') } catch (error) { console.error(error); message.error('保存失败，请稍后再试。') } finally { setSaving(false) } }
  const handleDelete = async () => { if (!selectedNode) return; Modal.confirm({ title: `删除“${selectedNode.name}”？`, content: '会同时删除它下面的全部子节点。', okType: 'danger', onOk: async () => { await window.electron.map.delete(selectedNode.id); setBranchPath((current) => current.filter((item) => item.id !== selectedNode.id)); selectNode(null); await refreshVisible(null); message.success('节点已删除。') } }) }
  const handleAddRoot = async () => { const levelRule = blueprintLevels[0]; const nextId = await window.electron.map.create(novelId, { level: 1, name: levelRule?.examples?.[0] || '新根节点', nodeType: levelRule?.nodeTypes?.[0] || '区域', structureRole: levelRule?.relationHint || '' }); await refreshVisible(nextId); message.success('根节点已创建。') }
  const handleAddChild = async () => { if (!selectedNode) return; const nextLevel = selectedNode.level + 1; if (nextLevel > maxDepth) { message.warning('已经到当前蓝图的最深层。'); return } const levelRule = getBlueprintLevelByDepth(worldRules, nextLevel); const nextId = await window.electron.map.create(novelId, { level: nextLevel, parentId: selectedNode.id, name: levelRule?.examples?.[0] || `新${levelRule?.label || '节点'}`, nodeType: levelRule?.nodeTypes?.[0] || '地点', parentRuleType: selectedNode.nodeType || selectedNode.locationType || '', structureRole: levelRule?.relationHint || '' }); if (currentParent?.id !== selectedNode.id) { setBranchPath((current) => [...current, selectedNode]); setBranchPage(1); await loadBranch(selectedNode, 1) } await refreshVisible(nextId); message.success('子节点已创建。') }
  const handleClear = async () => { Modal.confirm({ title: '清空地图结构？', content: '会删除当前小说下全部地图节点。', okType: 'danger', okText: '确认清空', onOk: async () => { await window.electron.map.clear(novelId); setBranchPath([]); selectNode(null); setBranchData(EMPTY_PAGE); await refreshVisible(null); message.success('地图结构已清空。') } }) }
  const handleBatchGenerate = async () => { setBatchLoading(true); try { const values = batchForm.getFieldsValue(); const result = await window.electron.map.batchGenerate(novelId, { layerCounts: blueprintLevels.map((level) => ({ depth: level.depth, count: values[`layer_${level.depth}`] || level.suggestedCount })), namedPlaces: values.namedPlaces || '', parentBatchSize: values.parentBatchSize || 1 } as MapBatchGenerateOptions); await refreshVisible(selectedNode?.id || null); message.success((result as MapBatchGenerationResult).message || '地图结构已生成。'); if ((result as MapBatchGenerationResult).completed) setBatchOpen(false) } catch (error: unknown) { message.error(error instanceof Error ? error.message : '地图生成失败。') } finally { setBatchLoading(false) } }

  const handleStartAutoGenerate = async () => { setAutoLoading(true); try { const values = batchForm.getFieldsValue(); await window.electron.map.startAutoGenerate(novelId, buildGenerateOptions(values, blueprintLevels)); await loadAutoStatus(); setBatchOpen(false); message.success('地图自动分批生成已启动。') } catch (error: unknown) { message.error(error instanceof Error ? error.message : '地图自动生成启动失败。') } finally { setAutoLoading(false) } }
  const handleStopAutoGenerate = async () => { if (!autoTask?.id) return; setAutoStopping(true); try { await window.electron.workflow.cancel(autoTask.id); await loadAutoStatus(); message.info('已发送停止请求，当前批次结束后不会继续后续生成。') } finally { setAutoStopping(false) } }
  const handleResumeAutoGenerate = async () => { if (!autoTask?.id) return; setAutoLoading(true); try { await window.electron.workflow.resume(autoTask.id); await loadAutoStatus(); message.success('地图自动生成已继续。') } catch (error: unknown) { message.error(error instanceof Error ? error.message : '地图自动生成继续失败。') } finally { setAutoLoading(false) } }

  const aiActions = selectedNode ? (
    <AIGenerateButton
      label="AI 生成节点"
      isJson
      buildMessages={() => {
        const values = detailForm.getFieldsValue(true)
        return buildDraftMessages({
          task: '地图节点草稿',
          mode: values.name ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '当前路径', value: pathLabel },
            { label: '当前层级', value: selectedNode.level },
            { label: '父节点', value: currentParent?.name || '' },
          ],
          fields: [
            { key: 'name', label: '名称', value: values.name, hint: '像这个世界里真实存在的地点。' },
            { key: 'nodeType', label: '节点类型', value: values.nodeType, hint: '贴合当前世界规则。' },
            { key: 'locationType', label: '地点细分', value: values.locationType, hint: '进一步说明空间属性。' },
            { key: 'structureRole', label: '结构职责', value: values.structureRole, hint: '写清它在地图结构里的作用。' },
            { key: 'description', label: '空间描述', value: values.description, hint: '写读者能直接看见的空间特征。' },
            { key: 'atmosphere', label: '氛围', value: values.atmosphere, hint: '写场所基调。' },
            { key: 'plotRelevance', label: '剧情作用', value: values.plotRelevance, hint: '写会承载什么事件或冲突。' },
            { key: 'dangerLevel', label: '风险等级', value: values.dangerLevel, hint: '可用低、中、高、禁入。' },
            { key: 'tags', label: '标签', type: 'string[]', value: values.tags, hint: '3 到 6 个标签。' },
            { key: 'affiliatedFactions', label: '关联势力', type: 'string[]', value: values.affiliatedFactions, hint: '没有可留空。' },
          ],
          requirements: ['不要脱离当前路径和层级。', '不要写百科腔和大词空话。'],
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

  return (
    <WorkspacePage
      eyebrow="地图结构"
      title="地图结构"
      description="按层级浏览节点，单个地点支持 AI 起草。"
      actions={<Space wrap><Button type={viewMode === 'branch' ? 'primary' : 'default'} icon={<UnorderedListOutlined />} onClick={() => setViewMode('branch')}>分支视图</Button><Button type={viewMode === 'graph' ? 'primary' : 'default'} icon={<ShareAltOutlined />} onClick={() => setViewMode('graph')}>局部图谱</Button><Button icon={<ReloadOutlined />} onClick={() => void refreshVisible(selectedNode?.id || null)}>刷新</Button><Button icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>按层级生成</Button><Button icon={<PlusOutlined />} onClick={() => void handleAddRoot()}>添加根节点</Button><Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button></Space>}
      contextSummary={<WorkspaceContextSummary items={[{ label: '题材', value: currentNovel?.genreName || '未设置' }, { label: '蓝图层级', value: `${blueprintLevels.length} 层` }, { label: '当前路径', value: pathLabel }, { label: '当前焦点', value: selectedNode?.name || '未选中节点' }]} />}
      metrics={<><WorkspaceMetric label="根层节点" value={stats.rootCount} tone="warm" /><WorkspaceMetric label="第二层" value={stats.secondLevelCount} /><WorkspaceMetric label="叶子节点" value={stats.leafCount} tone="cool" /><WorkspaceMetric label="总节点" value={stats.total} hint={`最大深度 ${stats.maxDepth || 0} 层`} /></>}
    >
      <WorkspacePanel title="当前图谱" description={viewMode === 'graph' ? '只显示当前路径和直属子节点。' : '切到局部图谱后可查看可视化关系。'}>
        {viewMode === 'graph'
          ? <div style={{ height: 420, borderRadius: 22, overflow: 'hidden', border: '1px solid rgba(122,93,52,.12)', background: 'rgba(255,255,255,.76)' }}>{loading ? <div className="novel-empty" style={{ height: '100%' }}><Spin /></div> : branchGraph.nodes.length === 0 ? <div className="novel-empty" style={{ height: '100%' }}>先从左侧选择一个节点。</div> : <ReactFlow nodes={branchGraph.nodes} edges={branchGraph.edges} fitView onNodeClick={(_event, node) => { const id = Number(String(node.id).split('-').pop()); const found = [...branchPath, ...branchData.items].find((item) => item.id === id) || null; selectNode(found) }}><Background color="rgba(122,93,52,.14)" gap={20} /><Controls /></ReactFlow>}</div>
          : <div className="novel-empty">当前是分支视图。</div>}
      </WorkspacePanel>

      <WorkspacePanel
          title="AI 自动生成"
          description="后台按批次自动补地图节点，可在这里查看进度、暂停点和停止状态。"
          extra={(
            <Space wrap>
              {!autoTask ? <Button type="primary" loading={autoLoading} onClick={() => void handleStartAutoGenerate()}>启动自动分批</Button> : null}
              {autoTask?.status === 'paused' ? <Button icon={<ReloadOutlined />} loading={autoLoading} onClick={() => void handleResumeAutoGenerate()}>继续</Button> : null}
              {hasRunningAutoTask ? <Button danger icon={<StopOutlined />} loading={autoStopping} onClick={() => void handleStopAutoGenerate()}>停止</Button> : null}
            </Space>
          )}
        >
          <Alert
            type={autoTask?.status === 'failed' ? 'error' : autoTask?.status === 'paused' ? 'warning' : autoTask?.status === 'success' ? 'success' : 'info'}
            showIcon
            message={autoTask ? (autoStatus.message || '地图自动生成任务运行中') : '当前还没有运行中的自动任务'}
            description={autoTask ? (autoStatus.lastError || (autoStatus.currentParentName ? `当前对象：${autoStatus.currentParentName}` : '系统会逐批校验并继续执行。')) : '点击上方按钮后，系统会在后台自动连续补齐地图节点。'}
          />
          <div style={{ marginTop: 16 }}>
            <Progress percent={autoPercent} status={autoTask?.status === 'failed' ? 'exception' : autoTask?.status === 'success' ? 'success' : 'active'} />
            <div className="novel-note-list">
              <div className="novel-note-list__item">{`任务状态：${autoTask?.status || 'idle'}`}</div>
              <div className="novel-note-list__item">{`当前层级：${autoStatus.targetDepth ?? '-'}`}</div>
              <div className="novel-note-list__item">{`已处理对象：${autoStatus.processedParentCount}`}</div>
              <div className="novel-note-list__item">{`待处理对象：${autoStatus.pendingParentCount}`}</div>
              <div className="novel-note-list__item">{`累计生成节点：${autoStatus.generatedNodeCount}`}</div>
              <div className="novel-note-list__item">{`当前重试次数：${autoStatus.retryCount}`}</div>
            </div>
          </div>
        </WorkspacePanel>
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel title={searchKeyword.trim() ? '搜索结果' : '根层节点'} description={searchKeyword.trim() ? '结果按页返回。' : '这里只显示根层入口。'} extra={<div className="novel-filter-bar"><div className="novel-filter-bar__row"><Input.Search allowClear placeholder="搜索名称、类型、剧情作用" value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)} onSearch={setSearchKeyword} /></div><div className="novel-filter-bar__summary">{searchKeyword.trim() ? `命中 ${rootData.total} 个节点` : `当前根层 ${rootData.total} 个节点`}</div></div>}>
          {loading ? <div className="novel-empty"><Spin /></div> : rootData.total === 0 ? <div className="novel-empty">{searchKeyword.trim() ? '没有搜索到节点。' : '还没有根层节点。'}</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={rootData.items} height={420} itemHeight={112} itemKey="id">{(node: MapNodeSummary) => <button key={node.id} type="button" className={`novel-list-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => { selectNode(node); if (node.childCount > 0) void handleSelectRoot(node) }} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{node.name}</div><div className="novel-list-card__meta"><Tag color="blue">{node.nodeType || node.locationType || `第 ${node.level} 层`}</Tag><Tag>{node.childCount} 个下级</Tag></div><div className="novel-list-card__desc">{node.plotRelevance || node.description || '还没有补剧情作用。'}</div></button>}</VirtualList><Pagination current={rootData.page} pageSize={rootData.pageSize} total={rootData.total} size="small" showSizeChanger={false} onChange={setRootPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={currentParent ? `分支下级 · ${currentParent.name}` : '分支下级'} description={currentParent ? '当前只加载直属子节点。' : '先从左侧选择一个根节点。'} extra={branchPath.length > 0 ? <Space wrap>{branchPath.map((item, index) => <Button key={item.id} size="small" type={index === branchPath.length - 1 ? 'primary' : 'default'} onClick={() => void handleBreadcrumb(index)}>{item.name}</Button>)}</Space> : null}>
          {!currentParent ? <div className="novel-empty">先选中一个根节点。</div> : branchData.total === 0 ? <div className="novel-empty">这个节点还没有下级。</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={branchData.items} height={420} itemHeight={118} itemKey="id">{(node: MapNodeSummary) => <button key={node.id} type="button" className={`novel-list-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => selectNode(node)} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{node.name}</div><div className="novel-list-card__meta"><Tag>{node.nodeType || node.locationType || `第 ${node.level} 层`}</Tag><Tag color={node.childCount > 0 ? 'processing' : 'default'}>{node.childCount} 个下级</Tag>{node.dangerLevel ? <Tag color="red">{node.dangerLevel}</Tag> : null}</div><div className="novel-list-card__desc">{node.plotRelevance || node.description || '还没有补剧情作用。'}</div>{node.childCount > 0 ? <div style={{ marginTop: 10 }}><Button size="small" type="link" onClick={(event) => { event.stopPropagation(); void handleDive(node) }}>展开下级</Button></div> : null}</button>}</VirtualList><Pagination current={branchData.page} pageSize={branchData.pageSize} total={branchData.total} size="small" showSizeChanger={false} onChange={setBranchPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={selectedNode ? `编辑：${selectedNode.name}` : '节点详情'} description="只编辑当前节点。" extra={<Space wrap>{aiActions}{selectedNode && selectedNode.level < maxDepth ? <Button icon={<PlusOutlined />} onClick={() => void handleAddChild()}>添加子节点</Button> : null}{selectedNode ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}<Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!selectedNode} onClick={() => void handleSave()}>保存</Button></Space>}>
          {!selectedNode ? <div className="novel-empty">从左侧选一个节点开始编辑。</div> : <Form form={detailForm} layout="vertical"><div className="novel-grid novel-grid--3"><Form.Item name="name" label="名称"><Input /></Form.Item><Form.Item name="nodeType" label="节点类型"><Select showSearch allowClear options={nodeTypeOptions.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="dangerLevel" label="风险等级"><Input placeholder="例如：低 / 中 / 高 / 禁入" /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="locationType" label="地点细分"><Input /></Form.Item><Form.Item name="structureRole" label="结构职责"><Input /></Form.Item></div><Form.Item name="description" label="空间描述"><Input.TextArea rows={5} /></Form.Item><Form.Item name="atmosphere" label="氛围"><Input /></Form.Item><Form.Item name="plotRelevance" label="剧情作用"><Input.TextArea rows={4} /></Form.Item><div className="novel-grid novel-grid--2"><Form.Item name="tags" label="标签"><Select mode="tags" open={false} /></Form.Item><Form.Item name="affiliatedFactions" label="关联势力"><Select mode="tags" options={factionOptions.map((value) => ({ value, label: value }))} /></Form.Item></div></Form>}
        </WorkspacePanel>
      </div>

      <Modal title="按层级生成地图" open={batchOpen} forceRender onCancel={() => setBatchOpen(false)} onOk={() => void handleBatchGenerate()} confirmLoading={batchLoading} okText="生成下一批">
        <Form form={batchForm} layout="vertical">
          {blueprintLevels.map((level) => <Form.Item key={level.depth} name={`layer_${level.depth}`} label={level.depth === 1 ? `${level.label}数量` : `每个上一级节点下的${level.label}数量`} initialValue={level.suggestedCount}><InputNumber min={1} max={12} style={{ width: '100%' }} /></Form.Item>)}
          <Form.Item name="parentBatchSize" label="每批父节点数" initialValue={1}><Select options={[{ value: 1, label: '1 个父节点' }, { value: 2, label: '2 个父节点' }, { value: 3, label: '3 个父节点' }]} /></Form.Item>
          <Form.Item name="namedPlaces" label="已知地点名称（每行一个，可留空）"><Input.TextArea rows={5} placeholder="例如：帝都\n南境要塞\n九渊秘境" /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
