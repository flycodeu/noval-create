import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import 'reactflow/dist/style.css'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import { Button, Tag, message } from 'antd'
import { AppstoreOutlined, EyeInvisibleOutlined, EyeOutlined, SaveOutlined } from '@ant-design/icons'
import type {
  Character,
  CharacterLocationBinding,
  MapBoardLayoutNode,
  MapBoardViewport,
  MapRelation,
  NarrativeMapLayerKey,
  TimelineEvent,
  WorldMapItem,
} from '../../../types'

interface NarrativeMapCanvasProps {
  nodes: WorldMapItem[]
  allNodes: WorldMapItem[]
  mapRelations: MapRelation[]
  layout: MapBoardLayoutNode[]
  viewport: MapBoardViewport | null
  events: TimelineEvent[]
  characters: Character[]
  bindings: CharacterLocationBinding[]
  selectedId?: number
  onSelect: (node: WorldMapItem | null) => void
  onEnter: (node: WorldMapItem) => void
}

interface MapCanvasNodeData {
  item: WorldMapItem
  eventCount: number
  peopleCount: number
  factionCount: number
  showEvents: boolean
  showPeople: boolean
  showFactions: boolean
}

const LAYER_LABELS: Array<{ key: NarrativeMapLayerKey; label: string }> = [
  { key: 'regions', label: '区域' },
  { key: 'routes', label: '路线' },
  { key: 'events', label: '事件' },
  { key: 'people', label: '人物' },
  { key: 'factions', label: '势力' },
]

function flatten(nodes: WorldMapItem[]): WorldMapItem[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children || [])])
}

function idsForNode(node: WorldMapItem): Set<number> {
  const ids = new Set<number>([node.id])
  const visit = (children: WorldMapItem[]) => children.forEach((child) => {
    ids.add(child.id)
    visit(child.children || [])
  })
  visit(node.children || [])
  return ids
}

function parseArray(raw?: string): Array<number | string> {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value) ? value.filter((item): item is number | string => (typeof item === 'number' && Number.isSafeInteger(item)) || typeof item === 'string') : []
  } catch {
    return []
  }
}

function MapCanvasNode({ data }: NodeProps<MapCanvasNodeData>) {
  const { item, eventCount, peopleCount, factionCount, showEvents, showPeople, showFactions } = data
  return (
    <div className={`narrative-map-flow-node narrative-map-flow-node--level-${Math.min(item.level, 4)}`}>
      <Handle type="target" position={Position.Top} className="narrative-map-flow-node__handle" />
      <Handle type="source" position={Position.Bottom} className="narrative-map-flow-node__handle" />
      <div className="narrative-map-flow-node__kicker"><span>L{item.level}</span><span>{item.locationType || item.nodeType || '区域'}</span></div>
      <strong>{item.name}</strong>
      <small>{item.plotRelevance || item.description || '点击查看地区详情，拖动调整地图布局。'}</small>
      <div className="narrative-map-flow-node__badges">
        {showEvents && eventCount > 0 ? <Tag color="gold">事件 {eventCount}</Tag> : null}
        {showPeople && peopleCount > 0 ? <Tag color="cyan">人物 {peopleCount}</Tag> : null}
        {showFactions && factionCount > 0 ? <Tag color="purple">势力 {factionCount}</Tag> : null}
      </div>
    </div>
  )
}

const nodeTypes = { mapRegion: MapCanvasNode }

function layoutForNode(node: WorldMapItem, layoutById: Map<number, MapBoardLayoutNode>, index: number) {
  const persisted = layoutById.get(node.id)
  if (persisted) return persisted
  return {
    x: (index % 4) * 340 + Math.max(0, node.level - 1) * 34,
    y: Math.floor(index / 4) * 220 + Math.max(0, node.level - 1) * 34,
    width: 260,
    height: 150,
    zIndex: 0,
  }
}

function buildNodes(
  nodes: WorldMapItem[],
  allNodes: WorldMapItem[],
  layout: MapBoardLayoutNode[],
  events: TimelineEvent[],
  characters: Character[],
  bindings: CharacterLocationBinding[],
  activeLayers: Set<NarrativeMapLayerKey>,
): Node<MapCanvasNodeData>[] {
  const layoutById = new Map(layout.map((item) => [item.mapNodeId, item]))
  const flatAll = flatten(allNodes)
  const nodeById = new Map(flatAll.map((item) => [item.id, item]))
  const flattened = flatten(nodes)
  return flattened.map((item, index) => {
    const childIds = idsForNode(item)
    const eventCount = events.filter((event) => typeof event.locationMapId === 'number' && childIds.has(event.locationMapId)).length
    const peopleIds = new Set(events.filter((event) => typeof event.locationMapId === 'number' && childIds.has(event.locationMapId)).flatMap((event) => parseArray(event.presentCharacterIdsJson).concat(parseArray(event.affectedCharacterIdsJson)).filter((id): id is number => typeof id === 'number')))
    const bindingPeopleIds = new Set(bindings.filter((binding) => childIds.has(binding.mapNodeId)).map((binding) => binding.characterId))
    const peopleCount = characters.filter((character) => peopleIds.has(character.id) || bindingPeopleIds.has(character.id) || parseArray(character.activeRegionsJson).some((token) => token === item.id || (typeof token === 'string' && token === item.name))).length
    const factionCount = parseArray(item.affiliatedFactionIdsJson).length
    const persisted = layoutForNode(item, layoutById, index)
    const parentId = item.parentId && nodeById.has(item.parentId) ? item.parentId : undefined
    return {
      id: `map-${item.id}`,
      type: 'mapRegion',
      hidden: !activeLayers.has('regions'),
      position: { x: persisted.x, y: persisted.y },
      style: { width: persisted.width, height: persisted.height, zIndex: persisted.zIndex },
      data: {
        item: { ...item, parentId },
        eventCount,
        peopleCount,
        factionCount,
        showEvents: activeLayers.has('events'),
        showPeople: activeLayers.has('people'),
        showFactions: activeLayers.has('factions'),
      },
    }
  })
}

function buildEdges(nodes: WorldMapItem[], relations: MapRelation[], activeLayers: Set<NarrativeMapLayerKey>): Edge[] {
  if (!activeLayers.has('regions')) return []
  const visible = new Set(flatten(nodes).map((node) => node.id))
  const edges: Edge[] = []
  flatten(nodes).forEach((node) => {
    if (typeof node.parentId !== 'number' || !visible.has(node.parentId)) return
    edges.push({
      id: `hierarchy-${node.parentId}-${node.id}`,
      source: `map-${node.parentId}`,
      target: `map-${node.id}`,
      type: 'smoothstep',
      style: { stroke: '#b99b70', strokeWidth: 1.5, opacity: 0.58 },
    })
  })
  if (activeLayers.has('routes')) {
    relations.forEach((relation) => {
      if (!visible.has(relation.mapAId) || !visible.has(relation.mapBId)) return
      const color = relation.routeOpen === 0 ? '#a74642' : '#2f7b70'
      edges.push({
        id: `route-${relation.id}`,
        source: `map-${relation.mapAId}`,
        target: `map-${relation.mapBId}`,
        type: 'bezier',
        label: relation.relationLabel || relation.relationType || relation.travelMode || undefined,
        style: { stroke: color, strokeWidth: relation.routeOpen === 0 ? 1.5 : 2.4, strokeDasharray: relation.routeOpen === 0 ? '8 6' : undefined },
        labelStyle: { fill: '#49392a', fontSize: 11, fontWeight: 700 },
        labelBgStyle: { fill: 'rgba(255,250,242,0.92)', fillOpacity: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        markerStart: relation.bilateral ? { type: MarkerType.ArrowClosed, color } : undefined,
      })
    })
  }
  return edges
}

export default function NarrativeMapCanvas({
  nodes,
  allNodes,
  mapRelations,
  layout,
  viewport,
  events,
  characters,
  bindings,
  selectedId,
  onSelect,
  onEnter,
}: NarrativeMapCanvasProps) {
  const [activeLayers, setActiveLayers] = useState<Set<NarrativeMapLayerKey>>(new Set(viewport?.activeLayers || ['regions', 'routes', 'events', 'people', 'factions']))
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const currentViewportRef = useRef<Viewport>({ x: viewport?.centerX || 0, y: viewport?.centerY || 0, zoom: viewport?.zoom || 1 })

  const baseNodes = useMemo(() => buildNodes(nodes, allNodes, layout, events, characters, bindings, activeLayers), [activeLayers, allNodes, bindings, characters, events, layout, nodes])
  const baseEdges = useMemo(() => buildEdges(nodes, mapRelations, activeLayers), [activeLayers, mapRelations, nodes])
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<MapCanvasNodeData>(baseNodes)
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState(baseEdges)

  useEffect(() => {
    setFlowNodes(baseNodes.map((node) => ({
      ...node,
      className: node.data.item.id === selectedId ? 'narrative-map-flow-node--selected' : undefined,
    })))
  }, [baseNodes, selectedId, setFlowNodes])

  useEffect(() => {
    setFlowEdges(baseEdges)
  }, [baseEdges, setFlowEdges])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
  }, [])

  const persistViewport = useCallback((next: Viewport, layers = activeLayers) => {
    currentViewportRef.current = next
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void window.electron.narrativeBoard.saveViewport({
        novelId: nodes[0]?.novelId || allNodes[0]?.novelId || 0,
        layoutKey: viewport?.layoutKey || 'default',
        centerX: next.x,
        centerY: next.y,
        zoom: next.zoom,
        activeLayers: [...layers],
        layoutVersion: viewport?.layoutVersion || 1,
      }).catch(() => undefined)
    }, 450)
  }, [activeLayers, allNodes, nodes, viewport?.layoutKey, viewport?.layoutVersion])

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node<MapCanvasNodeData>) => {
    const item = node.data.item
    void window.electron.narrativeBoard.upsertLayoutNode({
      novelId: item.novelId,
      mapNodeId: item.id,
      layoutKey: viewport?.layoutKey || 'default',
      x: node.position.x,
      y: node.position.y,
      width: typeof node.style?.width === 'number' ? node.style.width : undefined,
      height: typeof node.style?.height === 'number' ? node.style.height : undefined,
      layoutVersion: viewport?.layoutVersion || 1,
    }).then(() => message.success('地图布局已保存')).catch(() => message.error('地图布局保存失败'))
  }, [viewport?.layoutKey, viewport?.layoutVersion])

  const toggleLayer = useCallback((layer: NarrativeMapLayerKey) => {
    setActiveLayers((current) => {
      const next = new Set(current)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      const nextViewport = { ...currentViewportRef.current, zoom: currentViewportRef.current.zoom }
      persistViewport(nextViewport, next)
      return next
    })
  }, [persistViewport])

  const handleFit = useCallback(() => {
    void flowInstance?.fitView({ padding: 0.16, minZoom: 0.16, duration: 240 })
  }, [flowInstance])

  if (nodes.length === 0) {
    return <div className="narrative-map-canvas__empty">当前范围没有可展示的地区。先在地点结构页建立层级区域，或为阶段绑定地图资产。</div>
  }

  const defaultViewport = { x: viewport?.centerX || 0, y: viewport?.centerY || 0, zoom: viewport?.zoom || 1 }
  return (
    <div className="narrative-map-canvas">
      <div className="narrative-map-canvas__toolbar">
        <div className="narrative-map-canvas__layers"><span><AppstoreOutlined /> 图层</span>{LAYER_LABELS.map((layer) => {
          const active = activeLayers.has(layer.key)
          return <Button key={layer.key} size="small" type={active ? 'primary' : 'default'} icon={active ? <EyeOutlined /> : <EyeInvisibleOutlined />} onClick={() => toggleLayer(layer.key)}>{layer.label}</Button>
        })}</div>
        <Button size="small" icon={<SaveOutlined />} onClick={handleFit}>重新居中</Button>
      </div>
      <div className="narrative-map-canvas__hint"><span>拖动区域保存位置 · 滚轮缩放 · 双击区域进入下一级</span><span>{flatten(nodes).length} 个区域 / {mapRelations.length} 条路线</span></div>
      <div className="narrative-map-canvas__flow">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          defaultViewport={defaultViewport}
          minZoom={0.12}
          maxZoom={2.5}
          onInit={(instance) => { setFlowInstance(instance) }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => onSelect(node.data.item)}
          onNodeDoubleClick={(_, node) => onEnter(node.data.item)}
          onPaneClick={() => onSelect(null)}
          onNodeDragStop={handleNodeDragStop}
          onMoveEnd={(_, next) => persistViewport(next)}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          fitView={false}
        >
          <Background gap={28} size={1} color="rgba(124, 95, 61, 0.1)" />
          <Controls position="bottom-right" showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={2}
            nodeColor={() => '#b26a43'}
            maskColor="rgba(244, 236, 225, 0.72)"
          />
        </ReactFlow>
      </div>
    </div>
  )
}
