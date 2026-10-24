import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Select, Checkbox } from 'antd'
import { HomeOutlined } from '@ant-design/icons'
import ReactFlow, { Background, Controls, MarkerType, Position, type Edge, type Node, type ReactFlowInstance } from 'reactflow'
import 'reactflow/dist/style.css'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { atlasAttributeValue, displayValue, locationCoordinates, locationPath } from './atlas-presentation'
import { CAST_ROLES, characterCastRole, type CastRole } from '../../../shared/cast-role'
import { relationshipPositions } from './atlas-relationship-layout'
import { EmptyWork } from './shared'
import { atlasEntityMatchesSearch, atlasEntitySummary, atlasLocationScope } from './atlas-profile'

type Props = { mode: 'map' | 'relationships'; snapshot: StoryAtlasSnapshot; parentId: string | null; selectedId: string | null; onSelect: (entity: StoryAtlasEntity) => void; onRelation: (relation: StoryAtlasRelation) => void; onDrill: (entity: StoryAtlasEntity | null) => void; onGenerate: () => void }
export function WorldAtlasGraph(props: Props) {
  const parentId = atlasLocationScope(props.snapshot, props.parentId)
  return <WorldAtlasGraphContent key={`${props.snapshot.novelId}:${props.mode}:${parentId}:${props.snapshot.atChapter}`} {...props} parentId={parentId} />
}
function WorldAtlasGraphContent({ mode, snapshot, parentId, selectedId, onSelect, onRelation, onDrill, onGenerate }: Props) {
  const [keyword, setKeyword] = useState('')
  const [limit, setLimit] = useState(80)
  const [role, setRole] = useState<CastRole | 'all'>('all')
  const [focused, setFocused] = useState(false)
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const flowRef = useRef<ReactFlowInstance | null>(null)
  const entities = snapshot.entities
  const parent = entities.find(item => item.id === parentId)
  const path = locationPath(entities, parentId)
  const neighbors = new Set([selectedId])
  if (focused && selectedId) for (const relation of snapshot.relations) {
    if (relation.kind !== 'relationship') continue
    if (relation.fromId === selectedId) neighbors.add(relation.toId)
    if (relation.toId === selectedId) neighbors.add(relation.fromId)
  }
  const shown = entities.filter(item => (mode === 'relationships' ? item.kind === 'character' : item.kind === 'location' && item.parentId === parentId) && atlasEntityMatchesSearch(item, keyword) && (mode !== 'relationships' || ((role === 'all' || characterCastRole(item.attributes) === role) && (!focused || !selectedId || neighbors.has(item.id)))))
  const visible = shown.slice(0, limit)
  const graph = useMemo(() => {
    const coordinates = mode === 'map' ? locationCoordinates(visible) : relationshipPositions(visible, snapshot.relations)
    const ids = new Set(visible.map(item => item.id))
    const columns = mode === 'relationships' ? Math.max(2, Math.min(5, Math.ceil(Math.sqrt(visible.length)))) : 3
    const nodes: Node[] = visible.map((entity, index) => ({
      id: entity.id,
      position: positions[entity.id] || coordinates.get(entity.id) || { x: (index % columns) * (mode === 'relationships' ? 360 : 280), y: Math.floor(index / columns) * 205 + 90 + (coordinates.size ? 650 : 0) },
      ...(mode === 'relationships' ? { sourcePosition: Position.Right, targetPosition: Position.Left } : {}),
      data: { label: <div className="author-atlas-node"><span>{mode === 'relationships' ? CAST_ROLES.find(role => role.value === characterCastRole(entity.attributes))?.label || '待分类' : displayValue(atlasAttributeValue('nodeType', entity.attributes.nodeType || entity.attributes.locationType)) || '地点'}{entity.status === 'planned' ? ' · 计划' : ''}</span><strong>{entity.name}</strong><p>{atlasEntitySummary(entity) || '点击查看资料'}</p>{mode === 'map' && entities.some(item => item.parentId === entity.id) && <small>双击进入下级地点</small>}</div> },
      className: `author-atlas-flow-node${selectedId === entity.id ? ' is-selected' : ''}`, style: { width: 224 },
    }))
    const edges: Edge[] = snapshot.relations.filter(relation => ids.has(relation.fromId) && ids.has(relation.toId) && relation.kind === (mode === 'relationships' ? 'relationship' : 'route')).map(relation => ({
      id: relation.id, source: relation.fromId, target: relation.toId, label: mode === 'map' || visible.length <= 12 || relation.fromId === selectedId || relation.toId === selectedId ? relation.label : undefined, ariaLabel: `${entities.find(item => item.id === relation.fromId)?.name} · ${relation.label} · ${entities.find(item => item.id === relation.toId)?.name}`, type: 'smoothstep',
      ...(relation.attributes.bilateral === false || relation.attributes.bilateral === 0 ? { markerEnd: { type: MarkerType.ArrowClosed, color: '#80958b' } } : {}),
      style: { stroke: '#80958b', strokeWidth: 1.5, ...(relation.status === 'planned' ? { strokeDasharray: '5 4' } : {}) }, labelStyle: { fill: 'var(--text-secondary)', fontSize: 11 }, labelBgStyle: { fill: 'var(--bg-surface)' },
    }))
    if (mode === 'map' && parent && nodes.length) {
      const id = `scope:${parent.id}`
      nodes.unshift({ id, position: { x: 280, y: -70 }, data: { label: parent.name }, className: 'author-atlas-scope-node', style: { width: 224 } })
      visible.forEach(entity => edges.unshift({ id: `hierarchy:${entity.id}`, source: id, target: entity.id, type: 'smoothstep', style: { stroke: '#b7c1b7', strokeDasharray: '3 4' } }))
    }
    return { nodes, edges, hasCoordinates: coordinates.size > 0 }
  }, [mode, visible, entities, parent, selectedId, snapshot.relations, positions])
  useEffect(() => {
    if (!canvasRef.current) return
    let frame = 0
    const observer = new ResizeObserver(() => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => flowRef.current?.fitView({ padding: .22, maxZoom: 1.15 })) })
    observer.observe(canvasRef.current)
    return () => { observer.disconnect(); window.cancelAnimationFrame(frame) }
  }, [mode, visible.length])
  const relations = snapshot.relations.filter(item => item.kind === (mode === 'map' ? 'route' : 'relationship') && visible.some(entity => entity.id === item.fromId) && visible.some(entity => entity.id === item.toId))
  return <section className="atlas-graph-panel">
    {mode === 'map' && <nav className="author-atlas-path" aria-label="地域路径">{mode === 'map' ? <><button type="button" onClick={() => onDrill(null)}><HomeOutlined /> 全部地域</button>{path.map(item => <React.Fragment key={item.id}><span>/</span><button type="button" onClick={() => onDrill(item)}>{item.name}</button></React.Fragment>)}</> : null}</nav>}
    <div className="author-atlas-actions"><Input.Search aria-label="查找图谱内容" value={keyword} onChange={event => { setKeyword(event.target.value); setLimit(80) }} placeholder={mode === 'map' ? '查找本层地点' : '查找人物'} allowClear />{mode === 'relationships' && <><Select aria-label="人物作用" value={role} onChange={value => { setRole(value); setLimit(80) }} options={[{ value: 'all', label: `全部人物 · ${entities.filter(item => item.kind === 'character').length}` }, ...CAST_ROLES.map(role => ({ ...role, label: `${role.label} · ${entities.filter(item => item.kind === 'character' && characterCastRole(item.attributes) === role.value).length}` }))]} /><Checkbox checked={focused} disabled={!selectedId || !entities.some(item => item.id === selectedId && item.kind === 'character')} onChange={event => { setFocused(event.target.checked); setLimit(80) }}>只看所选人物的联系</Checkbox><Button onClick={() => { setPositions({}); requestAnimationFrame(() => flowRef.current?.fitView({ padding: .22, maxZoom: 1.15 })) }}>整理位置</Button></>}<Button onClick={onGenerate}>{mode === 'map' ? '完善此处' : '完善关系'}</Button></div>
    {visible.length ? <><div className="author-atlas-canvas" ref={canvasRef}><ReactFlow key={`${mode}:${parentId}:${snapshot.atChapter}:${keyword}:${role}:${focused ? selectedId : ""}:${limit}`} onInit={instance => { flowRef.current = instance }} nodes={graph.nodes} edges={graph.edges} onNodeClick={(_, node) => { const entity = entities.find(item => item.id === node.id); if (entity) onSelect(entity) }} onNodeDoubleClick={(_, node) => { if (mode === 'map') { const entity = entities.find(item => item.id === node.id); if (entity) onDrill(entity) } }} onEdgeClick={(_, edge) => { const relation = snapshot.relations.find(item => item.id === edge.id); if (relation) onRelation(relation) }} fitView fitViewOptions={{ padding: .22, maxZoom: 1.15 }} minZoom={.2} maxZoom={1.8} nodesDraggable={mode === 'relationships'} onNodesChange={changes => { const moved = changes.filter(change => change.type === 'position' && change.position); if (moved.length) setPositions(old => { const next = { ...old }; for (const change of moved) if (change.type === 'position' && change.position) next[change.id] = change.position; return next }) }} nodesConnectable={false}><Background color="#9ca99c" gap={26} size={.6} /><Controls showInteractive={false} /></ReactFlow></div></> : <EmptyWork title={keyword ? '没有匹配资料' : mode === 'map' ? parent ? `${parent.name}尚无下级地点` : '尚未建立地图' : '尚未建立人物关系'} action={onGenerate} />}
    {shown.length > limit && <Button onClick={() => setLimit(value => value + 80)}>继续显示（{limit}/{shown.length}）</Button>}
    {mode === 'map' && visible.length > 0 && <div className="atlas-map-location-list">{visible.map(entity => <button type="button" key={entity.id} onClick={() => onSelect(entity)}>{entity.name}</button>)}</div>}
    {relations.length > 0 && <details className="author-disclosure"><summary>{mode === 'map' ? '通路' : '人物关系'}列表 · {relations.length}</summary><div className="atlas-relation-list">{relations.map(relation => <button type="button" key={relation.id} onClick={() => onRelation(relation)}><span>{entities.find(item => item.id === relation.fromId)?.name || '关联资料不可用'} → {entities.find(item => item.id === relation.toId)?.name || '关联资料不可用'}</span><strong>{relation.label}</strong></button>)}</div></details>}
  </section>
}
