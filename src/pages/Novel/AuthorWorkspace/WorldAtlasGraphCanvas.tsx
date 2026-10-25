import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select } from 'antd'
import { HomeOutlined, AimOutlined, FullscreenOutlined } from '@ant-design/icons'
import ReactFlow, { Background, Controls, Handle, MarkerType, MiniMap, Position, useNodesInitialized, type Edge, type Node, type NodeProps, type ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasAttributeValue, displayValue, locationCoordinates, locationPath } from './atlas-presentation'
import { CAST_ROLES, characterCastRole } from '../../../shared/cast-role'
import { relationshipPositions } from './atlas-relationship-layout'
import { graphViewKey, readGraphView, selectRelationshipEntities, writeGraphView, type AtlasGraphView } from './atlas-graph-view'
import { EmptyWork } from './shared'
import { atlasEntityMatchesSearch, atlasEntitySummary, atlasLocationScope } from './atlas-profile'
import './relationship-graph.css'

type Props = { mode: 'map' | 'relationships'; snapshot: StoryAtlasSnapshot; parentId: string | null; selectedId: string | null; onSelect: (entity: StoryAtlasEntity) => void; onRelation: (relation: StoryAtlasRelation) => void; onDrill: (entity: StoryAtlasEntity | null) => void; onGenerate: () => void }
function graphStorage() { try { return window.sessionStorage } catch { return undefined } }
const sides = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }
function CharacterNode({ data }: NodeProps<{ label: React.ReactNode }>) {
  return <>{Object.entries(sides).map(([side, position]) => <React.Fragment key={side}><Handle type="source" id={`source-${side}`} position={position} /><Handle type="target" id={`target-${side}`} position={position} /></React.Fragment>)}{data.label}</>
}
const nodeTypes = { character: CharacterNode }
function GraphReady({ onReady }: { onReady: (ready: boolean) => void }) {
  const ready = useNodesInitialized()
  useEffect(() => { onReady(ready) }, [ready, onReady])
  return null
}

export function WorldAtlasGraph(props: Props) {
  const parentId = props.mode === 'map' ? atlasLocationScope(props.snapshot, props.parentId) : null
  return <WorldAtlasGraphContent key={graphViewKey(props.snapshot.novelId, props.mode, props.snapshot.atChapter, parentId)} {...props} parentId={parentId} />
}

function WorldAtlasGraphContent({ mode, snapshot, parentId, selectedId, onSelect, onRelation, onDrill, onGenerate }: Props) {
  const storageKey = graphViewKey(snapshot.novelId, mode, snapshot.atChapter, parentId)
  const [view, setView] = useState(() => readGraphView(storageKey, graphStorage()))
  const viewRef = useRef(view)
  const [initialView] = useState(view)
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null)
  const [nodesReady, setNodesReady] = useState(false)
  const initialized = useRef(false)
  const previousSignature = useRef('')
  const previousSelection = useRef(selectedId)
  const previousLayoutRevision = useRef(0)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const entities = snapshot.entities
  const parent = entities.find(item => item.id === parentId)
  const path = locationPath(entities, parentId)
  const personal = useMemo(() => selectRelationshipEntities(entities, snapshot.relations, { selectedId, role: view.role, focused: view.focused, limit: view.focused ? 7 : view.limit, contactPage: view.contactPage }), [entities, snapshot.relations, selectedId, view.role, view.focused, view.limit, view.contactPage])
  const shown = useMemo(() => mode === 'relationships' ? personal.candidates : entities.filter(item => item.kind === 'location' && item.parentId === parentId && atlasEntityMatchesSearch(item, view.keyword)), [mode, personal.candidates, entities, parentId, view.keyword])
  const visible = useMemo(() => mode === 'relationships' ? personal.visible : shown.slice(0, view.limit), [mode, personal.visible, shown, view.limit])
  const focusId = mode === 'relationships' && view.focused ? personal.anchor?.id : undefined
  const visibleIds = useMemo(() => new Set(visible.map(entity => entity.id)), [visible])
  const relations = useMemo(() => snapshot.relations.filter(relation => relation.kind === (mode === 'map' ? 'route' : 'relationship') && visibleIds.has(relation.fromId) && visibleIds.has(relation.toId)), [snapshot.relations, mode, visibleIds])
  const signature = JSON.stringify([mode, view.focused, focusId, selectedId, view.role, view.keyword, visible.map(entity => entity.id).sort()])
  const selected = entities.find(entity => entity.id === selectedId && entity.kind === 'character')
  const listAnchor = mode === 'relationships' ? selected || (view.focused ? personal.anchor : undefined) : undefined
  const listRelations = listAnchor ? snapshot.relations.filter(relation => relation.kind === 'relationship' && (relation.fromId === listAnchor.id || relation.toId === listAnchor.id)) : relations
  const updateView = (patch: Partial<AtlasGraphView>) => setView(old => ({ ...old, ...patch }))

  useEffect(() => {
    viewRef.current = { ...view, viewport: viewRef.current.viewport, signature }
    writeGraphView(storageKey, viewRef.current, graphStorage())
  }, [storageKey, view, signature])
  useEffect(() => () => {
    // Programmatic zoom controls may not emit onMoveEnd in every host. Capture
    // the live viewport when leaving as well as after direct pan/zoom gestures.
    if (flow) writeGraphView(storageKey, { ...viewRef.current, viewport: flow.getViewport() }, graphStorage())
  }, [flow, storageKey])

  const graph = useMemo(() => {
    const coordinates = mode === 'map' ? locationCoordinates(visible) : relationshipPositions(visible, snapshot.relations, focusId)
    const nodes: Node[] = visible.map((entity, index) => ({
      id: entity.id, ...(mode === 'relationships' ? { type: 'character' } : {}),
      position: view.positions[`${focusId || 'all'}:${entity.id}`] || coordinates.get(entity.id) || { x: (index % 3) * 280, y: Math.floor(index / 3) * 205 + 90 + (coordinates.size ? 650 : 0) },
      data: { label: mode === 'relationships' ? <div className="relationship-person"><span>{CAST_ROLES.find(role => role.value === characterCastRole(entity.attributes))?.label || '待分类'}<small>{entity.status === 'planned' ? '计划' : '已定'}</small></span><strong>{entity.name}</strong><p>{personal.neighbors.get(entity.id)?.size || 0} 位关联人物</p></div> : <div className="author-atlas-node"><span>{displayValue(atlasAttributeValue('nodeType', entity.attributes.nodeType || entity.attributes.locationType)) || '地点'}{entity.status === 'planned' ? ' · 计划' : ''}</span><strong>{entity.name}</strong><p>{atlasEntitySummary(entity) || '点击查看资料'}</p>{entities.some(item => item.parentId === entity.id) && <small>双击进入下级地点</small>}</div> },
      className: `${mode === 'relationships' ? 'relationship-person-node' : 'author-atlas-flow-node'}${selectedId === entity.id || focusId === entity.id ? ' is-selected' : ''}${entity.status === 'planned' ? ' is-planned' : ''}`, style: { width: mode === 'relationships' ? 200 : 224 },
    }))
    const byId = new Map(nodes.map(node => [node.id, node]))
    const edges: Edge[] = relations.map(relation => {
      const source = byId.get(relation.fromId)!.position
      const target = byId.get(relation.toId)!.position
      const horizontal = Math.abs(target.x - source.x) > Math.abs(target.y - source.y) * 1.3
      const sourceSide = horizontal ? target.x >= source.x ? 'right' : 'left' : target.y >= source.y ? 'bottom' : 'top'
      const targetSide = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' }[sourceSide]
      const color = relation.status === 'planned' ? '#9b793f' : '#58796b'
      return {
        id: relation.id, source: relation.fromId, target: relation.toId, label: relation.label,
        ...(mode === 'relationships' ? { sourceHandle: `source-${sourceSide}`, targetHandle: `target-${targetSide}` } : {}),
        ariaLabel: `${entities.find(item => item.id === relation.fromId)?.name} · ${relation.label} · ${entities.find(item => item.id === relation.toId)?.name}`,
        type: mode === 'relationships' ? 'default' : 'smoothstep',
        ...(relation.attributes.bilateral === false || relation.attributes.bilateral === 0 ? { markerEnd: { type: MarkerType.ArrowClosed, color } } : {}),
        style: { stroke: color, strokeWidth: 1.6, ...(relation.status === 'planned' ? { strokeDasharray: '6 5' } : {}) },
        labelStyle: { fill: 'var(--text-primary)', fontSize: 12 }, labelBgStyle: { fill: 'var(--bg-surface)', fillOpacity: .97 }, labelBgPadding: [7, 4], labelBgBorderRadius: 4,
      }
    })
    if (mode === 'map' && parent && nodes.length) {
      const id = `scope:${parent.id}`
      nodes.unshift({ id, position: { x: 280, y: -70 }, data: { label: parent.name }, className: 'author-atlas-scope-node', style: { width: 224 } })
      visible.forEach(entity => edges.unshift({ id: `hierarchy:${entity.id}`, source: id, target: entity.id, type: 'smoothstep', style: { stroke: '#b7c1b7', strokeDasharray: '3 4' } }))
    }
    return { nodes, edges }
  }, [mode, visible, entities, parent, selectedId, snapshot.relations, view.positions, focusId, relations, personal.neighbors])

  const locate = () => {
    const node = graph.nodes.find(item => item.id === selectedId || item.id === focusId)
    if (node) void flow?.setCenter(node.position.x + 100, node.position.y + 48, { zoom: 1, duration: 220 })
  }
  // React Flow handles element resizing. Do not reset the author's pan/zoom when
  // an inspector resizes or an unrelated snapshot refresh arrives.
  useEffect(() => {
    if (!flow || !nodesReady || !visible.length) return
    let firstFrame = 0
    let secondFrame = 0
    const wasInitialized = initialized.current
    const changedSelection = previousSelection.current !== selectedId
    const changedGraph = previousSignature.current !== signature
    const changedLayout = previousLayoutRevision.current !== layoutRevision
    const restore = !wasInitialized && initialView.signature === signature ? initialView.viewport : undefined
    if (!wasInitialized || changedGraph || changedSelection || changedLayout) {
      firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
        if (restore) void flow.setViewport(restore)
        else if (mode === 'relationships' && !view.focused && selectedId && (!wasInitialized || changedSelection)) {
          const node = flow.getNode(selectedId)
          if (node) void flow.setCenter(node.position.x + 100, node.position.y + 48, { zoom: .95, duration: wasInitialized ? 200 : 0 })
        } else void flow.fitView({ padding: .2, maxZoom: 1, minZoom: .25, duration: wasInitialized ? 200 : 0 })
        initialized.current = true
        previousSignature.current = signature
        previousSelection.current = selectedId
        previousLayoutRevision.current = layoutRevision
      }) })
    }
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame) }
  }, [flow, nodesReady, signature, selectedId, visible.length, mode, view.focused, layoutRevision, initialView])

  return <section className={`atlas-graph-panel${mode === 'relationships' ? ' relationship-graph-panel' : ''}`}>
    {mode === 'map' && <nav className="author-atlas-path" aria-label="地域路径"><button type="button" onClick={() => onDrill(null)}><HomeOutlined /> 全部地域</button>{path.map(item => <React.Fragment key={item.id}><span>/</span><button type="button" onClick={() => onDrill(item)}>{item.name}</button></React.Fragment>)}</nav>}
    <div className="author-atlas-actions">
      {mode === 'relationships' ? <>
        <Select className="relationship-person-search" aria-label="查找人物" showSearch optionFilterProp="label" placeholder="查找或选择人物" value={selected?.id || (view.focused ? personal.anchor?.id : undefined)} options={personal.characters.map(entity => ({ value: entity.id, label: `${entity.name}${entity.status === 'planned' ? ' · 计划' : ''}` }))} onChange={id => { const entity = personal.characters.find(item => item.id === id); if (entity) { updateView({ focused: true, limit: 80, contactPage: 0 }); onSelect(entity) } }} />
        <nav className="relationship-view-switch" aria-label="关系图范围"><button type="button" aria-pressed={view.focused} onClick={() => updateView({ focused: true, limit: 80 })}>人物联系</button><button type="button" aria-pressed={!view.focused} onClick={() => updateView({ focused: false, limit: 80 })}>全部人物 · {personal.characters.length}</button></nav>
        {!view.focused && <Select aria-label="人物作用" value={view.role} onChange={role => updateView({ role, limit: 80 })} options={[{ value: 'all', label: '全部作用' }, ...CAST_ROLES]} />}
      </> : <Input.Search aria-label="查找图谱内容" value={view.keyword} onChange={event => updateView({ keyword: event.target.value, limit: 80 })} placeholder="查找本层地点" allowClear />}
      <Button className="relationship-generate" onClick={onGenerate}>{mode === 'map' ? '完善此处' : '完善关系'}</Button>
    </div>
    {mode === 'relationships' && <div className="relationship-graph-caption"><span>{view.focused && personal.anchor ? <><strong>{personal.anchor.name}</strong> 的联系 · {personal.neighbors.get(personal.anchor.id)?.size || 0} 位关联人物</> : `显示 ${visible.length} / ${personal.characters.length} 位人物`}</span><span className="relationship-legend"><i /> 已定关系 <i className="is-planned" /> 计划关系</span><div><Button size="small" icon={<AimOutlined />} disabled={!selected && !focusId} onClick={locate}>定位人物</Button><Button size="small" icon={<FullscreenOutlined />} onClick={() => void flow?.fitView({ padding: .18, maxZoom: 1 })}>适合画布</Button><Button size="small" onClick={() => { updateView({ positions: {} }); setLayoutRevision(value => value + 1) }}>整理位置</Button></div>{view.focused && personal.contactPages > 1 && <nav className="relationship-contact-pages" aria-label="关联人物翻页"><span>每页 6 位联系 · 第 {personal.contactPage + 1} / {personal.contactPages} 页</span><Button size="small" disabled={personal.contactPage === 0} onClick={() => updateView({ contactPage: personal.contactPage - 1 })}>上一组联系</Button><Button size="small" disabled={personal.contactPage + 1 >= personal.contactPages} onClick={() => updateView({ contactPage: personal.contactPage + 1 })}>下一组联系</Button></nav>}</div>}
    {visible.length ? <div className="author-atlas-canvas" data-layout-ready={nodesReady}><ReactFlow
      onInit={setFlow} nodeTypes={nodeTypes} nodes={graph.nodes} edges={graph.edges}
      onNodeClick={(_, node) => { const entity = entities.find(item => item.id === node.id); if (entity) { updateView({ contactPage: 0 }); onSelect(entity) } }}
      onNodeDoubleClick={(_, node) => { const entity = entities.find(item => item.id === node.id); if (entity) { if (mode === 'map') onDrill(entity); else updateView({ focused: true }) } }}
      onEdgeClick={(_, edge) => { const relation = snapshot.relations.find(item => item.id === edge.id); if (relation) onRelation(relation) }}
      defaultViewport={initialView.viewport} minZoom={.1} maxZoom={1.8} nodesDraggable={mode === 'relationships'} nodesConnectable={false}
      onMoveEnd={(_, viewport) => { viewRef.current = { ...viewRef.current, viewport, signature }; writeGraphView(storageKey, viewRef.current, graphStorage()) }}
      onNodesChange={changes => { const moved = changes.filter(change => change.type === 'position' && change.position); if (moved.length) setView(old => { const positions = { ...old.positions }; for (const change of moved) if (change.type === 'position' && change.position) positions[`${focusId || 'all'}:${change.id}`] = change.position; return { ...old, positions } }) }}
    ><GraphReady onReady={setNodesReady} /><Background color="#9ca99c" gap={26} size={.6} /><Controls showInteractive={false} />{mode === 'relationships' && !view.focused && <MiniMap pannable zoomable nodeColor={node => node.id === selectedId ? '#9c7439' : '#8aa496'} maskColor="rgba(128, 136, 128, 0.12)" />}</ReactFlow></div> : <EmptyWork title={view.keyword ? '没有匹配资料' : mode === 'map' ? parent ? `${parent.name}尚无下级地点` : '尚未建立地图' : '尚未建立人物资料'} action={onGenerate} />}
    {(mode === 'map' || !view.focused) && shown.length > view.limit && <Button onClick={() => updateView({ limit: view.limit + 80 })}>继续显示（{visible.length}/{shown.length}）</Button>}
    {mode === 'map' && visible.length > 0 && <div className="atlas-map-location-list">{visible.map(entity => <button type="button" key={entity.id} onClick={() => onSelect(entity)}>{entity.name}</button>)}</div>}
    {mode === 'relationships' ? <section className="relationship-readable-list" aria-label="人物关系列表"><header><h3>{listAnchor ? `${listAnchor.name}的关系` : '画布中的关系'} <small>{listRelations.length}</small></h3><span>点击关系查看依据与变化</span></header>{listRelations.length ? <div>{listRelations.map(relation => <button type="button" key={relation.id} onClick={() => onRelation(relation)}><span>{entities.find(item => item.id === relation.fromId)?.name || '关联资料不可用'} <i>{relation.attributes.bilateral === false || relation.attributes.bilateral === 0 ? '→' : '—'}</i> {entities.find(item => item.id === relation.toId)?.name || '关联资料不可用'}</span><strong>{relation.label}</strong><small className={relation.status === 'planned' ? 'is-planned' : ''}>{relation.status === 'planned' ? '计划' : '已定'}</small></button>)}</div> : <p>{listAnchor ? `${listAnchor.name}尚未登记人物关系。可以查看人物档案，或补充已有依据的联系。` : '当前范围没有已登记的关系。'}</p>}</section> : relations.length > 0 && <details className="author-disclosure"><summary>通路列表 · {relations.length}</summary><div className="atlas-relation-list">{relations.map(relation => <button type="button" key={relation.id} onClick={() => onRelation(relation)}><span>{entities.find(item => item.id === relation.fromId)?.name || '关联资料不可用'} → {entities.find(item => item.id === relation.toId)?.name || '关联资料不可用'}</span><strong>{relation.label}</strong></button>)}</div></details>}
  </section>
}
