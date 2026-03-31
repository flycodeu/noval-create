import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import 'reactflow/dist/style.css'
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type ReactFlowInstance,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from 'reactflow'
import type { MapGraphNode, MapGraphPayload } from '../../../types'

interface MapGraphCanvasProps {
  data: MapGraphPayload
  selectedNodeId?: number | null
  selectedRelationId?: number | null
  showSummary?: boolean
  showMeta?: boolean
  showHierarchyEdges?: boolean
  showRelationEdges?: boolean
  onNodeSelect?: (nodeId: number) => void
  onRelationSelect?: (relationId: number) => void
  onCanvasClick?: () => void
}

interface CanvasNodeData {
  item: MapGraphNode
  showSummary: boolean
  showMeta: boolean
  active: boolean
}

const ROLE_LABELS: Record<MapGraphNode['graphRole'], string> = {
  root: '根层',
  focus: '焦点',
  ancestor: '上级',
  descendant: '下级',
  sibling: '同级',
  related: '关联',
}

const ROLE_COLORS: Record<MapGraphNode['graphRole'], string> = {
  root: '#A4773B',
  focus: '#0F6A84',
  ancestor: '#7A5138',
  descendant: '#2D7C64',
  sibling: '#7B5EA7',
  related: '#B24A5A',
}

const RELATION_COLORS: Record<string, string> = {
  adjacent: '#C28C32',
  transport: '#2D7DB2',
  control: '#8B4AA8',
  hostile: '#B74444',
  trade: '#2F8D61',
  pollution: '#7D5A3E',
  secret_link: '#4C63B6',
}

const RELATION_LABELS: Record<string, string> = {
  adjacent: '相邻 / 接壤',
  transport: '交通 / 通路',
  control: '控制 / 归属',
  hostile: '敌对 / 封锁',
  trade: '贸易 / 补给',
  pollution: '污染 / 外溢',
  secret_link: '隐蔽通道',
}

function getRelationColor(type?: string, hint?: string) {
  const normalizedHint = typeof hint === 'string' ? hint.trim() : ''
  if (normalizedHint) return normalizedHint
  const normalizedType = typeof type === 'string' ? type.trim() : ''
  return RELATION_COLORS[normalizedType] || '#8D6E63'
}

function truncate(text?: string, max = 110) {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trim()}...`
}

function sortGraphNodes(a: MapGraphNode, b: MapGraphNode) {
  return a.level - b.level || a.sortOrder - b.sortOrder || a.id - b.id
}

function buildLayeredTreePositions(nodes: MapGraphNode[], width: number, nodeHeight: number) {
  if (nodes.length === 0) return new Map<number, { x: number; y: number }>()

  const visibleIds = new Set(nodes.map((node) => node.id))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const pathCache = new Map<number, string>()

  const getPathKey = (node: MapGraphNode): string => {
    const cached = pathCache.get(node.id)
    if (cached) return cached
    const selfKey = `${String(node.sortOrder || 0).padStart(5, '0')}-${String(node.id).padStart(6, '0')}`
    const parent = typeof node.parentId === 'number' && visibleIds.has(node.parentId)
      ? byId.get(node.parentId)
      : undefined
    const resolved = parent ? `${getPathKey(parent)}.${selfKey}` : `${String(node.level || 0).padStart(3, '0')}.${selfKey}`
    pathCache.set(node.id, resolved)
    return resolved
  }

  const nodesByLevel = new Map<number, MapGraphNode[]>()
  nodes.forEach((node) => {
    const key = Math.max(1, node.level || 1)
    const current = nodesByLevel.get(key) || []
    current.push(node)
    nodesByLevel.set(key, current)
  })

  const orderedLevels = [...nodesByLevel.keys()].sort((a, b) => a - b)
  const positions = new Map<number, { x: number; y: number }>()
  const horizontalGap = width + 28
  const rowGap = 26
  const levelGap = 84
  let currentY = 68
  let minX = Number.POSITIVE_INFINITY

  orderedLevels.forEach((level) => {
    const levelNodes = (nodesByLevel.get(level) || []).sort((a, b) => getPathKey(a).localeCompare(getPathKey(b)))
    const maxColumns = level === 1
      ? Math.min(Math.max(levelNodes.length, 1), 4)
      : levelNodes.length > 70
        ? 8
        : levelNodes.length > 42
          ? 7
          : 6
    const rows: MapGraphNode[][] = []
    for (let index = 0; index < levelNodes.length; index += maxColumns) {
      rows.push(levelNodes.slice(index, index + maxColumns))
    }

    rows.forEach((row, rowIndex) => {
      const startX = -((row.length - 1) * horizontalGap) / 2
      row.forEach((node, columnIndex) => {
        const x = startX + columnIndex * horizontalGap
        const y = currentY + rowIndex * (nodeHeight + rowGap)
        minX = Math.min(minX, x)
        positions.set(node.id, { x, y })
      })
    })

    currentY += rows.length * (nodeHeight + rowGap) + levelGap
  })

  const normalized = new Map<number, { x: number; y: number }>()
  positions.forEach((position, id) => {
    normalized.set(id, {
      x: position.x - minX + 92,
      y: position.y,
    })
  })
  return normalized
}

function buildCanvasGraph(
  data: MapGraphPayload,
  showSummary: boolean,
  showMeta: boolean,
  showHierarchyEdges: boolean,
  showRelationEdges: boolean,
) {
  const width = showMeta ? 250 : showSummary ? 232 : 210
  const nodeHeight = showMeta ? 170 : showSummary ? 146 : 118
  const positions = buildLayeredTreePositions(data.nodes, width, nodeHeight)
  const relationEdgeCount = data.edges.filter((edge) => edge.edgeKind === 'relation').length
  const hideRelationLabels = relationEdgeCount > 10 || data.nodes.length > 24

  const nodes: Node<CanvasNodeData>[] = data.nodes.map((item) => ({
    id: `map-node-${item.id}`,
    type: 'mapRichNode',
    position: positions.get(item.id) || { x: 48, y: 48 },
    draggable: false,
    selectable: true,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      item,
      showSummary,
      showMeta,
      active: false,
    },
    style: { width },
  }))

  const edges: Edge[] = data.edges
    .filter((edge) => {
      if (edge.edgeKind === 'hierarchy') return showHierarchyEdges
      return showRelationEdges
    })
    .map((edge) => {
      const isRelation = edge.edgeKind === 'relation'
      const stroke = isRelation
        ? getRelationColor(edge.relationType, edge.colorHint)
        : '#B8A386'
      return {
        id: edge.id,
        source: `map-node-${edge.sourceId}`,
        target: `map-node-${edge.targetId}`,
        type: isRelation ? 'default' : 'smoothstep',
        animated: isRelation && relationEdgeCount <= 18 && edge.relationType === 'transport',
        label: isRelation && !hideRelationLabels ? (edge.relationLabel || RELATION_LABELS[edge.relationType || ''] || edge.relationType || '关系') : undefined,
        labelStyle: {
          fill: '#5D5348',
          fontWeight: 600,
          fontSize: 12,
        },
        labelBgStyle: {
          fill: 'rgba(255,255,255,0.92)',
          fillOpacity: 1,
          rx: 10,
          ry: 10,
        },
        style: {
          stroke,
          strokeWidth: isRelation ? 1.55 : 1.95,
          strokeOpacity: isRelation ? 0.64 : 0.88,
          strokeDasharray: isRelation ? '8 8' : undefined,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
        },
        markerStart: isRelation && edge.bilateral
          ? {
            type: MarkerType.ArrowClosed,
            color: stroke,
          }
          : undefined,
        zIndex: isRelation ? 6 : 3,
        data: {
          relationId: edge.relationId,
        },
      } satisfies Edge
    })

  return { nodes, edges }
}

function MapRichNode({ data }: NodeProps<CanvasNodeData>) {
  const { item, active, showMeta, showSummary } = data
  const lead = truncate(item.summaryText || item.plotRelevance || item.description || item.structureRole, 132)
  return (
    <div className={`map-graph-node map-graph-node--${item.graphRole} ${active ? 'map-graph-node--active' : ''}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />

      <div className="map-graph-node__eyebrow">
        <span>{ROLE_LABELS[item.graphRole]}</span>
        <span>{`L${item.level}`}</span>
      </div>

      <div className="map-graph-node__title">{item.name}</div>

      <div className="map-graph-node__meta">
        <span>{item.nodeType || item.locationType || '未分类'}</span>
        <span>{`下级 ${item.childCount}`}</span>
        {item.dangerLevel ? <span>{item.dangerLevel}</span> : null}
      </div>

      {showSummary && lead ? <div className="map-graph-node__summary">{lead}</div> : null}

      {showMeta ? (
        <>
          <div className="map-graph-node__chips">
            {item.structureRole ? <span className="map-graph-chip">{item.structureRole}</span> : null}
            {item.tags.slice(0, 3).map((tag) => <span key={tag} className="map-graph-chip">{tag}</span>)}
          </div>
          {item.affiliatedFactions.length > 0 ? (
            <div className="map-graph-node__footer">
              <span>关联势力</span>
              <strong>{item.affiliatedFactions.slice(0, 2).join(' / ')}</strong>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

const nodeTypes = {
  mapRichNode: MapRichNode,
}

function decorateNodes(nodes: Node<CanvasNodeData>[], selectedNodeId?: number | null) {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      active: (node.data as CanvasNodeData).item.id === selectedNodeId,
    },
  }))
}

function decorateEdges(edges: Edge[], selectedRelationId?: number | null) {
  return edges.map((edge) => {
    const relationId = Number((edge.data as { relationId?: number } | undefined)?.relationId)
    const baseStrokeWidth = Number((edge.style as { strokeWidth?: number } | undefined)?.strokeWidth || 2)
    const isActive = Number.isFinite(relationId) && relationId > 0 && relationId === selectedRelationId
    return {
      ...edge,
      labelStyle: {
        ...(edge.labelStyle || {}),
        fill: isActive ? '#1F1A16' : '#5D5348',
        fontWeight: isActive ? 700 : 600,
      },
      style: {
        ...(edge.style || {}),
        strokeWidth: isActive ? 3 : baseStrokeWidth,
      },
    }
  })
}

export default function MapGraphCanvas({
  data,
  selectedNodeId,
  selectedRelationId,
  showSummary = true,
  showMeta = true,
  showHierarchyEdges = true,
  showRelationEdges = true,
  onNodeSelect,
  onRelationSelect,
  onCanvasClick,
}: MapGraphCanvasProps) {
  const graph = useMemo(
    () => buildCanvasGraph(
      data,
      showSummary,
      showMeta,
      showHierarchyEdges,
      showRelationEdges,
    ),
    [data, showSummary, showMeta, showHierarchyEdges, showRelationEdges],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(decorateNodes(graph.nodes, selectedNodeId))
  const [edges, setEdges, onEdgesChange] = useEdgesState(decorateEdges(graph.edges, selectedRelationId))
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const hasInteractedRef = useRef(false)
  const hasFittedRef = useRef(false)
  const lastGraphSignatureRef = useRef('')
  const graphSignature = useMemo(
    () => [
      data.nodes.map((item) => `${item.id}:${item.parentId ?? 'root'}`).join('|'),
      data.edges.filter((edge) => {
        if (edge.edgeKind === 'hierarchy') return showHierarchyEdges
        return showRelationEdges
      }).map((edge) => edge.id).join('|'),
      showSummary ? 'summary' : 'compact',
      showMeta ? 'meta' : 'plain',
    ].join('::'),
    [data.edges, data.nodes, showHierarchyEdges, showMeta, showRelationEdges, showSummary],
  )

  const markInteracted = useCallback(() => {
    hasInteractedRef.current = true
  }, [])

  const unlockViewport = useCallback(() => {
    hasInteractedRef.current = false
  }, [])

  useEffect(() => {
    setNodes(decorateNodes(graph.nodes, selectedNodeId))
  }, [graph.nodes, selectedNodeId, setNodes])

  useEffect(() => {
    setEdges(decorateEdges(graph.edges, selectedRelationId))
  }, [graph.edges, selectedRelationId, setEdges])

  useEffect(() => {
    if (!flowInstance) return
    const graphChanged = lastGraphSignatureRef.current !== graphSignature
    lastGraphSignatureRef.current = graphSignature
    const shouldFit = !hasFittedRef.current || (graphChanged && !hasInteractedRef.current)
    if (!shouldFit) return
    const frame = window.requestAnimationFrame(() => {
      void flowInstance.fitView({ padding: 0.18, minZoom: 0.12, duration: 320 })
    })
    hasFittedRef.current = true
    return () => window.cancelAnimationFrame(frame)
  }, [flowInstance, graphSignature])

  const handleFitView = () => {
    unlockViewport()
    void flowInstance?.fitView({ padding: 0.18, minZoom: 0.12, duration: 320 })
  }

  const handleZoomIn = () => {
    void flowInstance?.zoomIn({ duration: 180 })
  }

  const handleZoomOut = () => {
    void flowInstance?.zoomOut({ duration: 180 })
  }

  const handleCenterFocus = () => {
    const focusId = typeof selectedNodeId === 'number' ? selectedNodeId : data.focusNodeId
    if (!flowInstance || typeof focusId !== 'number') {
      handleFitView()
      return
    }
    const focusNode = nodes.find((item) => item.id === `map-node-${focusId}`)
    if (!focusNode) {
      handleFitView()
      return
    }
    unlockViewport()
    void flowInstance.setCenter(focusNode.position.x + 136, focusNode.position.y + 92, { zoom: 0.94, duration: 320 })
  }

  if (graph.nodes.length === 0) {
    return <div className="map-graph-empty">先选择一个地图节点，或先建立根层地图。</div>
  }

  return (
    <div className="map-graph-shell">
      <div className="map-graph-view-tools">
        <Button size="small" onClick={handleZoomIn}>放大</Button>
        <Button size="small" onClick={handleZoomOut}>缩小</Button>
        <Button size="small" onClick={handleFitView}>总览</Button>
        <Button size="small" onClick={handleCenterFocus}>回到焦点</Button>
      </div>
      <ReactFlow
        className="map-graph-flow"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView={false}
        defaultViewport={{ x: 0, y: 0, zoom: 0.72 }}
        fitViewOptions={{ padding: 0.18, minZoom: 0.12 }}
        onInit={setFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesDraggable={false}
        nodesConnectable={false}
        onlyRenderVisibleElements
        elementsSelectable
        nodesFocusable
        edgesFocusable
        minZoom={0.08}
        maxZoom={1.85}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        selectionOnDrag={false}
        preventScrolling
        proOptions={{ hideAttribution: true }}
        onMoveStart={markInteracted}
        onNodeClick={(_event, node) => onNodeSelect?.((node.data as CanvasNodeData).item.id)}
        onEdgeClick={(_event, edge) => {
          const relationId = Number((edge.data as { relationId?: number } | undefined)?.relationId)
          if (Number.isFinite(relationId) && relationId > 0) onRelationSelect?.(relationId)
        }}
        onPaneClick={onCanvasClick}
      >
        {data.nodes.length <= 80 ? (
          <MiniMap
            className="map-graph-minimap"
            style={{ backgroundColor: 'rgba(255, 249, 240, 0.94)' }}
            maskColor="rgba(111, 89, 61, 0.12)"
            pannable
            zoomable
            nodeStrokeWidth={3}
            nodeColor={(node) => {
              const graphRole = (node.data as CanvasNodeData | undefined)?.item.graphRole || 'related'
              return ROLE_COLORS[graphRole]
            }}
          />
        ) : null}
        <Controls />
        <Background color="rgba(112, 91, 64, 0.10)" gap={20} size={1.1} />
      </ReactFlow>
    </div>
  )
}
