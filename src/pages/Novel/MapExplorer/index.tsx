import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import { ApartmentOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, ShareAltOutlined, UnorderedListOutlined } from '@ant-design/icons'
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow'
import VirtualList from 'rc-virtual-list'
import 'reactflow/dist/style.css'
import type { MapBatchGenerateOptions, MapBatchGenerationResult, MapNodeSummary, MapStats, PagedResult } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { getBlueprintLevelByDepth, getFactionNameOptions, getMapBlueprintDepth, getMapNodeTypeOptions, parseWorldRulesJson } from '../../../shared/genre-system'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import '../components/boards.css'

interface Props { novelId: number }
interface DetailFormValues { name: string; locationType?: string; nodeType?: string; structureRole?: string; description?: string; atmosphere?: string; plotRelevance?: string; dangerLevel?: string; tags: string[]; affiliatedFactions: string[] }

const PAGE_SIZE = 20
const EMPTY_PAGE: PagedResult<MapNodeSummary> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: MapStats = { total: 0, rootCount: 0, secondLevelCount: 0, leafCount: 0, maxDepth: 0, countsByLevel: [] }

function parseStringArrayJson(raw?: string): string[] { if (!raw) return []; try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [] } catch { return [] } }
function toFormValues(node: MapNodeSummary): DetailFormValues { return { name: node.name, locationType: node.locationType || '', nodeType: node.nodeType || '', structureRole: node.structureRole || '', description: node.description || '', atmosphere: node.atmosphere || '', plotRelevance: node.plotRelevance || '', dangerLevel: node.dangerLevel || '', tags: parseStringArrayJson(node.tagsJson), affiliatedFactions: parseStringArrayJson(node.affiliatedFactionIdsJson) } }

function buildBranchGraph(path: MapNodeSummary[], branchItems: MapNodeSummary[], selectedId: number | null) {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const chain = path.length > 0 ? path : branchItems
  chain.forEach((node, index) => {
    nodes.push({ id: `path-${node.id}`, position: { x: index * 240, y: 40 }, data: { label: `${node.name}\n${node.nodeType || node.locationType || `第 ${node.level} 层`}` }, draggable: false, style: { width: 180, borderRadius: 18, padding: '10px 12px', border: selectedId === node.id ? '2px solid rgba(143,99,48,.88)' : '1px solid rgba(122,93,52,.18)', background: 'rgba(255,255,255,.94)', whiteSpace: 'pre-line', boxShadow: '0 12px 24px rgba(71,53,28,.08)' } })
    if (index > 0) edges.push({ id: `path-edge-${path[index - 1].id}-${node.id}`, source: `path-${path[index - 1].id}`, target: `path-${node.id}`, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: '#8f6330', strokeWidth: 1.4 } })
  })
  const branchParent = path[path.length - 1]
  branchItems.forEach((node, index) => {
    nodes.push({ id: `branch-${node.id}`, position: { x: index * 220, y: 220 }, data: { label: `${node.name}\n${node.nodeType || node.locationType || `第 ${node.level} 层`}` }, draggable: false, style: { width: 180, borderRadius: 18, padding: '10px 12px', border: selectedId === node.id ? '2px solid rgba(46,134,171,.88)' : '1px solid rgba(46,134,171,.2)', background: 'rgba(255,255,255,.94)', whiteSpace: 'pre-line', boxShadow: '0 12px 24px rgba(24,44,52,.08)' } })
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

  const worldRules = useMemo(() => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName), [currentNovel?.genreName, currentNovel?.worldRulesJson])
  const blueprintLevels = useMemo(() => [...worldRules.mapBlueprint.levels].sort((left, right) => left.depth - right.depth), [worldRules.mapBlueprint.levels])
  const maxDepth = getMapBlueprintDepth(worldRules)
  const factionOptions = useMemo(() => getFactionNameOptions(worldRules), [worldRules])
  const nodeTypeOptions = useMemo(() => getMapNodeTypeOptions(worldRules), [worldRules])
  const currentParent = branchPath[branchPath.length - 1] || null
  const branchGraph = useMemo(() => buildBranchGraph(branchPath, branchData.items, selectedNode?.id || null), [branchData.items, branchPath, selectedNode?.id])

  const loadRoots = useCallback(async (targetPage = rootPage) => {
    const list = await window.electron.map.queryNodes(searchKeyword.trim() ? { novelId, keyword: searchKeyword.trim(), page: targetPage, pageSize: PAGE_SIZE } : { novelId, parentId: null, page: targetPage, pageSize: PAGE_SIZE })
    setRootData(list)
  }, [novelId, rootPage, searchKeyword])
  const loadBranch = useCallback(async (parent: MapNodeSummary | null, targetPage = branchPage) => {
    if (!parent) { setBranchData(EMPTY_PAGE); return }
    const list = await window.electron.map.queryNodes({ novelId, parentId: parent.id, page: targetPage, pageSize: PAGE_SIZE })
    setBranchData(list)
  }, [branchPage, novelId])
  const loadStats = useCallback(async () => { setStats(await window.electron.map.getStats(novelId)) }, [novelId])
  const selectNode = useCallback((node: MapNodeSummary | null) => { setSelectedNode(node); if (node) detailForm.setFieldsValue(toFormValues(node)); else detailForm.resetFields() }, [detailForm])

  const refreshVisible = useCallback(async (preferredId?: number | null) => {
    setLoading(true)
    try {
      await Promise.all([loadRoots(rootPage), loadBranch(currentParent, branchPage), loadStats()])
      const nextSelected = preferredId ? await window.electron.map.getNode(preferredId) : selectedNode?.id ? await window.electron.map.getNode(selectedNode.id) : null
      if (nextSelected) selectNode(nextSelected)
      else { setSelectedNode(null); detailForm.resetFields() }
    } finally { setLoading(false) }
  }, [branchPage, currentParent, detailForm, loadBranch, loadRoots, loadStats, rootPage, selectNode, selectedNode])

  useEffect(() => { void refreshVisible(selectedNode?.id || null) }, [refreshVisible, rootPage, branchPage])
  useEffect(() => { setRootPage(1) }, [searchKeyword])
  useEffect(() => { const initialValues: Record<string, number> = {}; blueprintLevels.forEach((level) => { initialValues[`layer_${level.depth}`] = level.suggestedCount }); initialValues.parentBatchSize = 1; batchForm.setFieldsValue(initialValues) }, [batchForm, blueprintLevels])

  const handleSelectRoot = async (node: MapNodeSummary) => { setBranchPath([node]); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleDive = async (node: MapNodeSummary) => { setBranchPath((current) => [...current, node]); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleBreadcrumb = async (index: number) => { const nextPath = branchPath.slice(0, index + 1); const node = nextPath[nextPath.length - 1] || null; setBranchPath(nextPath); setBranchPage(1); selectNode(node); await loadBranch(node, 1) }
  const handleSave = async () => { if (!selectedNode) return; const values = detailForm.getFieldsValue(); setSaving(true); try { await window.electron.map.update(selectedNode.id, { ...values, tagsJson: JSON.stringify(values.tags || []), affiliatedFactionIdsJson: JSON.stringify(values.affiliatedFactions || []) }); await refreshVisible(selectedNode.id); message.success('地图节点已保存') } catch (error) { console.error(error); message.error('保存失败，请稍后再试。') } finally { setSaving(false) } }
  const handleDelete = async () => { if (!selectedNode) return; Modal.confirm({ title: `删除「${selectedNode.name}」？`, content: '会同时删除它下面的全部子节点。', okType: 'danger', onOk: async () => { await window.electron.map.delete(selectedNode.id); const nextPath = branchPath.filter((item) => item.id !== selectedNode.id); setBranchPath(nextPath); selectNode(null); await refreshVisible(null); message.success('节点已删除') } }) }
  const handleAddRoot = async () => { const levelRule = blueprintLevels[0]; const nextId = await window.electron.map.create(novelId, { level: 1, name: levelRule?.examples?.[0] || '新根节点', nodeType: levelRule?.nodeTypes?.[0] || '区域', structureRole: levelRule?.relationHint || '' }); await refreshVisible(nextId); message.success('根节点已创建') }
  const handleAddChild = async () => { if (!selectedNode) return; const nextLevel = selectedNode.level + 1; if (nextLevel > maxDepth) { message.warning('当前题材蓝图已经到最深层了'); return } const levelRule = getBlueprintLevelByDepth(worldRules, nextLevel); const nextId = await window.electron.map.create(novelId, { level: nextLevel, parentId: selectedNode.id, name: levelRule?.examples?.[0] || `新${levelRule?.label || '节点'}`, nodeType: levelRule?.nodeTypes?.[0] || '地点', parentRuleType: selectedNode.nodeType || selectedNode.locationType || '', structureRole: levelRule?.relationHint || '' }); if (currentParent?.id !== selectedNode.id) { setBranchPath((current) => [...current, selectedNode]); setBranchPage(1); await loadBranch(selectedNode, 1) } await refreshVisible(nextId); message.success('子节点已创建') }
  const handleClear = async () => { Modal.confirm({ title: '清空地图结构？', content: '会删除当前小说下全部地图节点和层级关系，此操作不可撤销。', okType: 'danger', okText: '确认清空', onOk: async () => { await window.electron.map.clear(novelId); setBranchPath([]); selectNode(null); setBranchData(EMPTY_PAGE); await refreshVisible(null); message.success('地图结构已清空') } }) }
  const handleBatchGenerate = async () => { setBatchLoading(true); try { const values = batchForm.getFieldsValue(); const result = await window.electron.map.batchGenerate(novelId, { layerCounts: blueprintLevels.map((level) => ({ depth: level.depth, count: values[`layer_${level.depth}`] || level.suggestedCount })), namedPlaces: values.namedPlaces || '', parentBatchSize: values.parentBatchSize || 1 } as MapBatchGenerateOptions); await refreshVisible(selectedNode?.id || null); message.success((result as MapBatchGenerationResult).message || '地图结构已生成'); if ((result as MapBatchGenerationResult).completed) setBatchOpen(false) } catch (error: unknown) { message.error(error instanceof Error ? error.message : '地图生成失败') } finally { setBatchLoading(false) } }

  return (
    <WorkspacePage eyebrow="地图结构" title="地图结构" description="地图改成根层分页和分支下钻，图谱只显示当前可见分支，不再一次性构整棵树。" actions={<Space wrap><Button type={viewMode === 'branch' ? 'primary' : 'default'} icon={<UnorderedListOutlined />} onClick={() => setViewMode('branch')}>分支视图</Button><Button type={viewMode === 'graph' ? 'primary' : 'default'} icon={<ShareAltOutlined />} onClick={() => setViewMode('graph')}>局部图谱</Button><Button icon={<ReloadOutlined />} onClick={() => void refreshVisible(selectedNode?.id || null)}>刷新</Button><Button icon={<ApartmentOutlined />} onClick={() => setBatchOpen(true)}>按层级生成</Button><Button icon={<PlusOutlined />} onClick={() => void handleAddRoot()}>添加根节点</Button><Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空地图</Button></Space>} contextSummary={<WorkspaceContextSummary items={[{ label: '题材', value: currentNovel?.genreName || '未设置' }, { label: '蓝图层级', value: `${blueprintLevels.length} 层` }, { label: '当前路径', value: branchPath.length > 0 ? branchPath.map((item) => item.name).join(' / ') : '尚未进入分支' }, { label: '当前焦点', value: selectedNode ? selectedNode.name : '未选中节点' }]} />} metrics={<><WorkspaceMetric label="根层节点" value={stats.rootCount} tone="warm" hint="按页加载，不再一次性展开全部根层" /><WorkspaceMetric label="第二层节点" value={stats.secondLevelCount} hint="便于判断世界是否已展开到区域层" /><WorkspaceMetric label="叶子节点" value={stats.leafCount} tone="cool" hint="当前已经落到具体剧情地点的节点数" /><WorkspaceMetric label="总节点数" value={stats.total} hint={`最大深度 ${stats.maxDepth || 0} 层`} /></>}>
      <WorkspacePanel title="当前分支图谱" description={viewMode === 'graph' ? '只渲染当前路径和当前父节点的直属子节点。' : '切到局部图谱后，这里会显示当前路径和直属子节点。'}>
        {viewMode === 'graph' ? <div style={{ height: 420, borderRadius: 22, overflow: 'hidden', border: '1px solid rgba(122,93,52,.12)', background: 'rgba(255,255,255,.76)' }}>{loading ? <div className="novel-empty" style={{ height: '100%' }}><Spin /></div> : branchGraph.nodes.length === 0 ? <div className="novel-empty" style={{ height: '100%' }}>先从左侧选择根节点或搜索一个地点。</div> : <ReactFlow nodes={branchGraph.nodes} edges={branchGraph.edges} fitView onNodeClick={(_event, node) => { const id = Number(String(node.id).split('-').pop()); const found = [...branchPath, ...branchData.items].find((item) => item.id === id) || null; selectNode(found) }}><Background color="rgba(122,93,52,.14)" gap={20} /><Controls /></ReactFlow>}</div> : <div className="novel-empty">当前是分支视图，切到局部图谱后查看当前路径的可视化关系。</div>}
      </WorkspacePanel>
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel title={searchKeyword.trim() ? '节点搜索结果' : '根层节点'} description={searchKeyword.trim() ? '搜索结果按页返回，可直接选中或下钻。' : '这里只显示根层或顶层节点，适合在大地图里先定入口。'} extra={<div className="novel-filter-bar"><div className="novel-filter-bar__row"><Input.Search allowClear placeholder="搜索名称、类型、剧情作用" value={searchKeyword} onChange={(event) => setSearchKeyword(event.target.value)} onSearch={setSearchKeyword} /></div><div className="novel-filter-bar__summary">{searchKeyword.trim() ? `搜索命中 ${rootData.total} 个节点。` : `当前根层共 ${rootData.total} 个节点。`}</div></div>}>
          {loading ? <div className="novel-empty"><Spin /></div> : rootData.total === 0 ? <div className="novel-empty">{searchKeyword.trim() ? '没有搜索到匹配节点。' : '还没有地图根层结构，先创建或生成一版。'}</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={rootData.items} height={420} itemHeight={112} itemKey="id">{(node: MapNodeSummary) => <button key={node.id} type="button" className={`novel-list-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => { selectNode(node); if (node.childCount > 0) void handleSelectRoot(node) }} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{node.name}</div><div className="novel-list-card__meta"><Tag color="blue">{node.nodeType || node.locationType || `第 ${node.level} 层`}</Tag><Tag>{node.childCount} 个下级</Tag></div><div className="novel-list-card__desc">{node.plotRelevance || node.description || '这个节点还没有补出剧情用途。'}</div></button>}</VirtualList><Pagination current={rootData.page} pageSize={rootData.pageSize} total={rootData.total} size="small" showSizeChanger={false} onChange={setRootPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={currentParent ? `分支下级 · ${currentParent.name}` : '分支下级'} description={currentParent ? '当前只加载这个父节点的直属子节点。' : '先从左侧选择一个根节点，再进入它的下级。'} extra={branchPath.length > 0 ? <Space wrap>{branchPath.map((item, index) => <Button key={item.id} size="small" type={index === branchPath.length - 1 ? 'primary' : 'default'} onClick={() => void handleBreadcrumb(index)}>{item.name}</Button>)}</Space> : null}>
          {!currentParent ? <div className="novel-empty">先选中一个根节点或搜索结果，再从这里逐层下钻。</div> : branchData.total === 0 ? <div className="novel-empty">这个节点还没有下级，可以在右侧直接添加。</div> : <div style={{ display: 'grid', gap: 12 }}><VirtualList data={branchData.items} height={420} itemHeight={118} itemKey="id">{(node: MapNodeSummary) => <button key={node.id} type="button" className={`novel-list-card ${selectedNode?.id === node.id ? 'novel-list-card--active' : ''}`} onClick={() => selectNode(node)} style={{ textAlign: 'left', cursor: 'pointer' }}><div className="novel-list-card__title">{node.name}</div><div className="novel-list-card__meta"><Tag>{node.nodeType || node.locationType || `第 ${node.level} 层`}</Tag><Tag color={node.childCount > 0 ? 'processing' : 'default'}>{node.childCount} 个下级</Tag>{node.dangerLevel ? <Tag color="red">{node.dangerLevel}</Tag> : null}</div><div className="novel-list-card__desc">{node.plotRelevance || node.description || '这个节点还没有补出剧情用途。'}</div>{node.childCount > 0 ? <div style={{ marginTop: 10 }}><Button size="small" type="link" onClick={(event) => { event.stopPropagation(); void handleDive(node) }}>展开下级</Button></div> : null}</button>}</VirtualList><Pagination current={branchData.page} pageSize={branchData.pageSize} total={branchData.total} size="small" showSizeChanger={false} onChange={setBranchPage} /></div>}
        </WorkspacePanel>
        <WorkspacePanel title={selectedNode ? `编辑：${selectedNode.name}` : '节点详情'} description="右侧只编辑当前选中节点。你可以边看分支边修正剧情用途、氛围和势力归属。" extra={<Space>{selectedNode && selectedNode.level < maxDepth ? <Button icon={<PlusOutlined />} onClick={() => void handleAddChild()}>添加子节点</Button> : null}{selectedNode ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}<Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!selectedNode} onClick={() => void handleSave()}>保存</Button></Space>}>
          {!selectedNode ? <div className="novel-empty">从左侧选中一个节点后，这里就能直接编辑。地图页不再堆整树文本框，而是围绕当前分支工作。</div> : <Form form={detailForm} layout="vertical"><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">基础信息</div><div className="novel-form-section__desc">先定义它叫什么、属于哪一层、表面上是什么地方。</div></div><div className="novel-grid novel-grid--3"><Form.Item name="name" label="名称"><Input /></Form.Item><Form.Item name="nodeType" label="节点类型"><Select showSearch allowClear options={nodeTypeOptions.map((value) => ({ value, label: value }))} /></Form.Item><Form.Item name="dangerLevel" label="风险等级"><Input placeholder="例如：低 / 中 / 高 / 禁入" /></Form.Item></div><div className="novel-grid novel-grid--2"><Form.Item name="locationType" label="地点细分"><Input placeholder="例如：都城、边境区、实验设施、洞府" /></Form.Item><Form.Item name="structureRole" label="结构职责"><Input placeholder="例如：区域枢纽、冲突爆发点、补给节点" /></Form.Item></div></div><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">空间气质</div><div className="novel-form-section__desc">让地点既有外观感，也有能直接写进正文的氛围。</div></div><Form.Item name="description" label="空间描述"><Input.TextArea rows={5} placeholder="写清地貌、建筑、秩序和活动方式。" /></Form.Item><Form.Item name="atmosphere" label="氛围基调"><Input placeholder="例如：繁华但高压、封锁死寂、灵气浓郁、军管森严" /></Form.Item></div><div className="novel-form-section"><div className="novel-form-section__header"><div className="novel-form-section__title">剧情用途与关联</div><div className="novel-form-section__desc">这部分会直接影响时间轴、人物和物品如何挂进来。</div></div><Form.Item name="plotRelevance" label="剧情作用"><Input.TextArea rows={4} placeholder="写这里会承载什么事件、冲突、伏笔或回收。" /></Form.Item><div className="novel-grid novel-grid--2"><Form.Item name="tags" label="地点标签"><Select mode="tags" placeholder="例如：主角起点、补给点、禁区、秘境入口" /></Form.Item><Form.Item name="affiliatedFactions" label="关联势力"><Select mode="tags" options={factionOptions.map((value) => ({ value, label: value }))} /></Form.Item></div></div></Form>}
        </WorkspacePanel>
      </div>
      <Modal title="按层级生成地图" open={batchOpen} onCancel={() => setBatchOpen(false)} onOk={() => void handleBatchGenerate()} confirmLoading={batchLoading} okText="生成下一批"><Form form={batchForm} layout="vertical"><div className="novel-note-list" style={{ marginBottom: 16 }}><div className="novel-note-list__item">根层和各层子节点都按批次推进，适合长篇逐步补地图。</div><div className="novel-note-list__item">每批父节点数越小，结构越稳，越适合大数据量小说。</div></div>{blueprintLevels.map((level) => <Form.Item key={level.depth} name={`layer_${level.depth}`} label={level.depth === 1 ? `${level.label}数量` : `每个上一级节点下的${level.label}数量`} initialValue={level.suggestedCount}><InputNumber min={1} max={12} style={{ width: '100%' }} /></Form.Item>)}<Form.Item name="parentBatchSize" label="每批父节点数" initialValue={1}><Select options={[{ value: 1, label: '1 个父节点' }, { value: 2, label: '2 个父节点' }, { value: 3, label: '3 个父节点' }]} /></Form.Item><Form.Item name="namedPlaces" label="已知地点名称（每行一个，可留空）"><Input.TextArea rows={5} placeholder="例如：帝都\n南境要塞\n九渊秘境" /></Form.Item></Form></Modal>
    </WorkspacePage>
  )
}
