import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Input, Modal, Select, Spin, message } from 'antd'
import { ApartmentOutlined, ArrowRightOutlined, EditOutlined, EnvironmentOutlined, HomeOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactFlow, { Background, Controls, MarkerType, Position, type Edge, type Node, type ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import type { Chapter } from '../../../types'
import type { StoryAtlasEntity, StoryAtlasSnapshot, StoryAtlasRelation } from '../../../shared/story-atlas'
import type { CreativeStage } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { chapterPositionLabel } from '../../../shared/author-workspace'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { atlasAttributeValue, atlasDisplayAttributes, displayValue, locationCoordinates, locationPath, relatedEntities } from './atlas-presentation'
import { ContentDocument, DocumentEditor } from './ContentDocument'
import { recordOf } from './content-document'

const KIND_LABELS = { location: '地点', character: '人物', event: '事件', faction: '组织', item: '物品' }

export default function WorldAndCast({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const mode = params.get('view') === 'characters' ? 'characters' : 'locations'
  const parentId = params.get('location') || null
  const [snapshot, setSnapshot] = useState<StoryAtlasSnapshot | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [atChapter, setAtChapter] = useState<number | null>(params.has('atChapter') ? Math.max(0, Number(params.get('atChapter')) || 0) : null)
  const [includePlanned, setIncludePlanned] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(params.get('entity'))
  const [keyword, setKeyword] = useState('')
  const [indexKind, setIndexKind] = useState<StoryAtlasEntity['kind'] | 'all'>(Object.keys(KIND_LABELS).includes(params.get('kind') || '') ? params.get('kind') as StoryAtlasEntity['kind'] : 'all')
  const [indexLimit, setIndexLimit] = useState(120)
  const [graphLimit, setGraphLimit] = useState(80)
  const [relation, setRelation] = useState<StoryAtlasRelation | null>(null)
  const [indexKeyword, setIndexKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editAttributes, setEditAttributes] = useState<unknown>({})
  const [saving, setSaving] = useState(false)
  const epoch = useRef(0)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const flowRef = useRef<ReactFlowInstance | null>(null)
  const load = useCallback(async () => {
    const token = ++epoch.current
    setLoading(true)
    try {
      const result = await window.electron.storyAtlas.query({ novelId, locationParentId: parentId, ...(atChapter != null ? { atChapter } : {}), includePlanned })
      if (token === epoch.current) { setSnapshot(result); setError('') }
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取世界与人物失败') }
    finally { if (token === epoch.current) setLoading(false) }
  }, [novelId, parentId, atChapter, includePlanned])
  useEffect(() => { void load(); return () => { epoch.current += 1 } }, [load])
  useEffect(() => {
    let current = true
    void window.electron.chapter.list(novelId).then((rows) => { if (current) setChapters(rows) }).catch(() => {})
    return () => { current = false }
  }, [novelId])
  const entities = useMemo(() => snapshot?.entities || [], [snapshot])
  const selected = entities.find((entity) => entity.id === selectedId) || null
  const parent = entities.find((entity) => entity.id === parentId) || null
  const breadcrumb = useMemo(() => locationPath(entities, parentId), [entities, parentId])
  const related = useMemo(() => snapshot ? relatedEntities(snapshot, parentId) : [], [snapshot, parentId])
  const characters = entities.filter((entity) => entity.kind === 'character')
  const candidates = mode === 'characters' ? characters : snapshot?.locationChildren || []
  const shown = candidates.filter((entity) => !keyword.trim() || `${entity.name} ${entity.summary}`.includes(keyword.trim()))
  const graphEntities = shown.slice(0, graphLimit)
  const indexedEntities = entities.filter((entity) => (indexKind === 'all' || entity.kind === indexKind) && `${entity.name} ${entity.summary}`.includes(indexKeyword.trim()))
  const coordinates = useMemo(() => mode === 'locations' ? locationCoordinates(graphEntities) : new Map<string, { x: number; y: number }>(), [mode, graphEntities])
  useEffect(() => {
    if (!canvasRef.current) return
    let frame = 0
    const observer = new ResizeObserver(() => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => flowRef.current?.fitView({ padding: .22, maxZoom: 1.15 })) })
    observer.observe(canvasRef.current)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [graphEntities.length, mode, parentId, atChapter])
  const graph = useMemo(() => {
    const visible = new Set(graphEntities.map((entity) => entity.id))
    const columns = mode === 'characters' ? Math.max(2, Math.min(5, Math.ceil(Math.sqrt(graphEntities.length)))) : 3
    const nodes: Node[] = graphEntities.map((entity, index) => ({
      id: entity.id,
      position: coordinates.get(entity.id) || { x: (index % columns) * (mode === 'characters' ? 360 : 255) + (mode === 'characters' && Math.floor(index / columns) % 2 ? 45 : 0), y: Math.floor(index / columns) * 175 + 70 + (coordinates.size ? 650 : 0) },
      ...(mode === 'characters' ? { sourcePosition: Position.Right, targetPosition: Position.Left } : {}),
      data: { label: <div className="author-atlas-node"><span>{mode === 'characters' ? displayValue(entity.attributes.occupation || atlasAttributeValue('roleType', entity.attributes.roleType)) || '人物' : displayValue(atlasAttributeValue('nodeType', entity.attributes.nodeType || entity.attributes.locationType)) || '地点'}{entity.status === 'planned' ? ' · 计划' : ''}</span><strong>{entity.name}</strong><p>{entity.summary || '点击查看资料'}</p>{mode === 'locations' && entities.some((child) => child.parentId === entity.id) && <small>进入下一级 →</small>}</div> },
      className: `author-atlas-flow-node${selectedId === entity.id ? ' is-selected' : ''}`,
      style: { width: 216 },
    }))
    const edges: Edge[] = (snapshot?.relations || []).filter((relation) => visible.has(relation.fromId) && visible.has(relation.toId)
      && relation.kind === (mode === 'characters' ? 'relationship' : 'route')).map((relation) => ({
      id: relation.id, source: relation.fromId, target: relation.toId, label: relation.label, ariaLabel: `${entities.find((entity) => entity.id === relation.fromId)?.name} · ${relation.label} · ${entities.find((entity) => entity.id === relation.toId)?.name}`,
      type: 'smoothstep', ...(relation.attributes.bilateral === false || relation.attributes.bilateral === 0 ? { markerEnd: { type: MarkerType.ArrowClosed, color: '#80958b' } } : {}),
      style: { stroke: '#80958b', strokeWidth: 1.5, ...(relation.status === 'planned' ? { strokeDasharray: '5 4' } : {}) },
      labelStyle: { fill: 'var(--text-secondary)', fontSize: 11 }, labelBgStyle: { fill: 'var(--bg-surface)' },
    }))
    if (mode === 'locations' && parent && nodes.length) {
      const parentGraphId = `scope:${parent.id}`
      nodes.forEach((node) => { node.position.y += 70 })
      nodes.unshift({ id: parentGraphId, position: { x: Math.min(nodes.length - 1, 2) * 255 / 2, y: 0 }, data: { label: parent.name }, className: 'author-atlas-scope-node', style: { width: 216 } })
      graphEntities.forEach((entity) => edges.unshift({ id: `hierarchy:${entity.id}`, source: parentGraphId, target: entity.id, type: 'smoothstep', style: { stroke: '#b7c1b7', strokeDasharray: '3 4' } }))
    }
    return { nodes, edges }
  }, [graphEntities, mode, entities, selectedId, snapshot?.relations, parent, coordinates])
  const switchView = (view: 'locations' | 'characters') => { const next = new URLSearchParams(params); next.set('view', view); next.delete('entity'); setSelectedId(null); setKeyword(''); setParams(next) }
  const drill = (location: StoryAtlasEntity | null) => {
    const next = new URLSearchParams(params)
    if (location) next.set('location', location.id); else next.delete('location')
    next.set('view', 'locations'); setKeyword(''); setSelectedId(location?.id || null); setParams(next)
  }
  const generate = (stage: CreativeStage, request: string) => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage, request, ...(atChapter != null ? { atChapter: String(atChapter) } : {}) })}`))
  const relatedToSelected = selected ? (snapshot?.relations || []).filter((relation) => relation.fromId === selected.id || relation.toId === selected.id) : []
  const names = Object.fromEntries(entities.map(entity => [entity.id, entity.name]))

  return <AuthorPage eyebrow="世界与人物" title="故事发生在哪里，谁身在其中" description="沿地点向下探索，在关系中查看人物；章位决定此时已知的状态。"
    actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>}>
    <div className="author-atlas-toolbar"><div className="author-tabs" role="tablist" aria-label="图谱视图">
      <button role="tab" aria-selected={mode === 'locations'} onClick={() => switchView('locations')}><EnvironmentOutlined /> 地点地图</button>
      <button role="tab" aria-selected={mode === 'characters'} onClick={() => switchView('characters')}><ApartmentOutlined /> 人物关系</button>
      <button onClick={() => navigate(buildWorkspaceRoute(novelId, 'story-design?section=world'))}>世界规则</button>
    </div><Select<number | 'all'> aria-label="故事章位" value={atChapter ?? 'all'} onChange={(value) => { setAtChapter(value === 'all' ? null : value); setSelectedId(null) }} options={[{ value: 'all', label: '全部已知设定' }, { value: 0, label: '初始设定 · 第 0 章' }, ...chapters.map((chapter) => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章 · ${chapter.title || ''}` }))]} /><Checkbox checked={includePlanned} onChange={(event) => setIncludePlanned(event.target.checked)}>包含计划</Checkbox></div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    <div className="author-atlas-layout">
      <section className="author-atlas-main">
        <div className="author-atlas-path">{mode === 'locations' ? <><button onClick={() => drill(null)}><HomeOutlined /> 全部地域</button>{breadcrumb.map((entity) => <React.Fragment key={entity.id}><span>/</span><button onClick={() => drill(entity)}>{entity.name}</button></React.Fragment>)}</> : <span>人物关系网络</span>}<small>{chapterPositionLabel(atChapter)}</small></div>
        <div className="author-atlas-actions"><Input.Search aria-label="查找图谱内容" placeholder={mode === 'characters' ? '查找人物' : '查找本层地点'} value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear />
          <Button onClick={() => generate(mode === 'characters' ? 'relationships' : 'map', mode === 'characters' ? '结合现有人物和已写正文，补全能够找到依据的人物关系，并检查不对称认知与关系变化。' : `结合现有背景和正文，补充${parent ? `“${parent.name}”下的` : '当前写作范围需要的'}地点层级与交通关系。已有地点不要重复创建，缺乏依据的地理细节标为计划。`)}>{mode === 'characters' ? '完善关系' : '完善此处'}</Button>
        </div>
        {loading && !snapshot ? <div className="author-loading"><Spin /></div> : graphEntities.length ? <>
          <div className="author-atlas-canvas" ref={canvasRef}><ReactFlow key={`${mode}:${parentId}:${atChapter}:${includePlanned}:${keyword}:${graphLimit}`} onInit={(instance) => { flowRef.current = instance }} nodes={graph.nodes} edges={graph.edges} onEdgeClick={(_, edge) => setRelation(snapshot?.relations.find(item => item.id === edge.id) || null)} fitView fitViewOptions={{ padding: .22, maxZoom: 1.15 }} minZoom={.2} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => {
            const entity = entities.find((item) => item.id === node.id)
            if (!entity) return
            setSelectedId(entity.id)
            if (mode === 'locations' && entities.some((child) => child.parentId === entity.id)) drill(entity)
          }}><Background color="#9ca99c" gap={26} size={.6} /><Controls showInteractive={false} /></ReactFlow></div>
          <div className="author-atlas-caption"><span>{mode === 'locations' ? coordinates.size ? '有坐标的地点按相对方位排列；无坐标地点另行排列。连线表示层级或实际通路，不表示里程。' : '地点层级与通路示意，排列不代表距离或方位。' : `${characters.length} 个人物 · ${graph.edges.length} 条本视图关系`}</span>{shown.length > graphLimit && <Button size="small" onClick={() => setGraphLimit(value => value + 80)}>显示更多地点/人物（已显示 {graphLimit}/{shown.length}）</Button>}</div>
        </> : <EmptyWork title={keyword ? '没有匹配的资料' : mode === 'characters' ? '人物还没有进入图谱' : parent ? `${parent.name}尚未划分下级地点` : '地图还没有建立'} action={keyword ? undefined : () => generate(mode === 'characters' ? 'characters' : 'map', mode === 'characters' ? '结合背景和已有章节建立核心人物档案，提取性格、行动目标、说话特征与关系，保留现有事实。' : `结合当前故事建立${parent ? `“${parent.name}”内的地点` : '地域、城镇、村庄与场景地点层级'}，仅展开当前剧情需要的范围，补上通行关系。`)}>
          {keyword ? '换一个姓名或地名试试。' : '生成后，地点、人物和事件会直接出现在这里。'}</EmptyWork>}
        {mode === 'locations' && <div className="author-place-life"><div className="author-section-heading"><h2>{parent ? `${parent.name} · 人物与事件` : '世界中的人物与事件'}</h2><small>来自已有位置与事件关联</small></div>
          {related.filter((entity) => ['character', 'event'].includes(entity.kind)).length ? <div className="author-entity-chips">{related.filter((entity) => ['character', 'event'].includes(entity.kind)).map((entity) => <button key={entity.id} onClick={() => setSelectedId(entity.id)}><small>{KIND_LABELS[entity.kind]}</small><strong>{entity.name}</strong></button>)}</div> : <p className="author-muted">此处尚无已记录的人物位置或事件关联。</p>}
        </div>}
      </section>
      <aside id="author-entity-inspector" className="author-entity-inspector">{selected ? <>
        <div className="author-section-heading"><span className="author-eyebrow">{KIND_LABELS[selected.kind]} · {selected.status === 'planned' ? '计划设定' : '已记录'}</span><Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setEditName(selected.name); setEditSummary(selected.summary); setEditAttributes(structuredClone(selected.attributes)); setEditing(true) }}>编辑</Button></div>
        <h2>{selected.name}</h2><p className="author-prose">{selected.summary || '尚未补充说明。'}</p>
        {selected.kind === 'location' && <Button block onClick={() => drill(selected)}>查看下级地点 <ArrowRightOutlined /></Button>}
        <ContentDocument value={selected.kind === 'character' ? { personalityTraits: '', goals: '', flaws: '', speechPattern: '', ...selected.attributes } : selected.attributes} names={names} showEmpty />
        {relatedToSelected.length > 0 && <div className="author-entity-relations"><h3>关联</h3>{relatedToSelected.map((relation) => {
          const other = entities.find((entity) => entity.id === (relation.fromId === selected.id ? relation.toId : relation.fromId))
          return other ? <button key={relation.id} onClick={() => setRelation(relation)}><span>{relation.label || relation.kind}</span><strong>{other.name}</strong><ArrowRightOutlined /></button> : null
        })}</div>}
        <Button block onClick={() => generate(selected.kind === 'location' ? 'map' : selected.kind === 'character' ? 'characters' : selected.kind === 'event' ? 'events' : selected.kind === 'faction' ? 'factions' : 'items', `请检查并优化${KIND_LABELS[selected.kind]}“${selected.name}”（${selected.id}）。结合当前章节与关联资料，说明设计是否合理；保留已定事实，重大改变先列为待讨论事项。`)}>讨论这个{KIND_LABELS[selected.kind]}</Button>
        <details className="author-disclosure"><summary>记录依据</summary><p>从第 {selected.effectiveFromChapter} 章起生效</p><p>{selected.source.note || '来自已有资料记录'}</p></details>
      </> : <EmptyWork title="点选一个地点或人物">这里会展示设定、特点、关系和来源。</EmptyWork>}</aside>
    </div>
    <section id="author-atlas-index" className="author-paper author-atlas-index"><div className="author-section-heading"><div><h2>全部资料</h2><p className="author-muted">地点、人物、组织、物品与事件，无关联的资料也在这里。</p></div><Button onClick={() => generate(indexKind === 'faction' ? 'factions' : indexKind === 'item' ? 'items' : indexKind === 'event' ? 'events' : indexKind === 'location' ? 'map' : 'characters', `结合背景、现有资料与正文，补充${indexKind === 'all' ? '当前剧情需要的核心人物' : KIND_LABELS[indexKind]}，已有条目不要重复创建，缺乏依据的细节标为计划。`)}>补充{indexKind === 'all' ? '人物' : KIND_LABELS[indexKind]}</Button></div>
      <div className="author-tabs author-section-tabs">{Object.entries(KIND_LABELS).map(([kind, label]) => <button key={kind} className={indexKind === kind ? 'is-selected' : ''} onClick={() => { setIndexKind(kind as StoryAtlasEntity['kind']); setIndexLimit(120) }}>{label} · {entities.filter(item => item.kind === kind).length}</button>)}</div>
      <div className="author-atlas-index__filters"><Select aria-label="资料类型" value={indexKind} onChange={setIndexKind} options={[{ value: 'all', label: '全部类型' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))]} /><Input.Search aria-label="查找全部资料" placeholder="按名称或说明查找" allowClear value={indexKeyword} onChange={(event) => setIndexKeyword(event.target.value)} /></div>
      {indexedEntities.length ? <div className="author-atlas-index__items">{indexedEntities.slice(0, indexLimit).map((entity) => <button key={entity.id} onClick={() => { setSelectedId(entity.id); document.getElementById('author-entity-inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }}><small>{KIND_LABELS[entity.kind]}{entity.status === 'planned' ? ' · 计划' : ''}</small><strong>{entity.name}</strong><span>{entity.summary || '尚未补充说明'}</span></button>)}</div> : <p className="author-muted">{indexKeyword ? '没有匹配的资料。' : '当前章位下还没有这类资料。'}</p>}
      {indexedEntities.length > indexLimit && <Button onClick={() => setIndexLimit(value => value + 120)}>继续显示（{indexLimit}/{indexedEntities.length}）</Button>}
    </section>
    {snapshot && snapshot.diagnostics.length > 0 && <details className="author-disclosure author-atlas-diagnostics"><summary>资料提示 · {snapshot.diagnostics.length}</summary><ul>{snapshot.diagnostics.map((item, index) => <li key={`${item.code}-${index}`}>{item.message}</li>)}</ul></details>}
    <Modal title={`编辑${selected ? KIND_LABELS[selected.kind] : '资料'}`} open={editing} onCancel={() => setEditing(false)} okText="保存" cancelText="取消" confirmLoading={saving} onOk={() => {
      if (!selected || !snapshot || !editName.trim()) return
      setSaving(true)
      void window.electron.storyAtlas.apply({ novelId, expectedContextVersion: snapshot.contextVersion, idempotencyKey: `author-atlas:${crypto.randomUUID()}`, effectiveFromChapter: atChapter ?? selected.effectiveFromChapter, source: { kind: 'human', note: '作者修订' }, changes: [{ op: 'upsert_entity', id: selected.id, kind: selected.kind, name: editName.trim(), summary: editSummary, parentId: selected.parentId, attributes: recordOf(editAttributes), status: selected.status }] })
        .then(() => { setEditing(false); message.success('资料已保存'); void load() }).catch((cause) => message.error(cause instanceof Error ? cause.message : '保存失败')).finally(() => setSaving(false))
    }}><label className="author-form-label">名称<Input value={editName} onChange={(event) => setEditName(event.target.value)} /></label><label className="author-form-label">设定说明<Input.TextArea value={editSummary} onChange={(event) => setEditSummary(event.target.value)} autoSize={{ minRows: 6, maxRows: 18 }} /></label><DocumentEditor value={editAttributes} onChange={setEditAttributes} /></Modal>
    <Modal title={relation?.label || '关系详情'} open={Boolean(relation)} onCancel={() => setRelation(null)} footer={<Button onClick={() => setRelation(null)}>关闭</Button>} width={720}>{relation && <><ContentDocument value={{ fromId: relation.fromId, toId: relation.toId, kind: relation.kind, ...atlasDisplayAttributes(relation.attributes, chapters), status: relation.status, effectiveFromChapter: relation.effectiveFromChapter }} names={names} showEmpty /><details className="author-disclosure"><summary>记录依据</summary><p>{relation.source.note || '来自已有关系记录'}</p></details><div className="author-heading-actions">{[relation.fromId, relation.toId].map(id => <Button key={id} onClick={() => { setSelectedId(id); setRelation(null) }}>查看{names[id] || id}</Button>)}<Button onClick={() => generate(relation.kind === 'route' ? 'map' : 'relationships', `讨论并优化${names[relation.fromId]}与${names[relation.toId]}的“${relation.label}”关系（${relation.id}），保留当前章位的已定事实，明确变化依据。`)}>讨论这条关系</Button></div></>}</Modal>
  </AuthorPage>
}
