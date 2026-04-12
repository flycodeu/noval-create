import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import 'reactflow/dist/style.css'
import ReactFlow, {
  Background,
  MarkerType,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
  Handle,
} from 'reactflow'
import { AimOutlined, MinusOutlined, PlusOutlined } from '@ant-design/icons'
import type { FactionGraphPayload } from '../../../types'

interface Props {
  data: FactionGraphPayload
  selectedFactionId?: number | null
  onFactionSelect?: (factionId: number) => void
}

interface CanvasNodeData {
  entityType: 'faction' | 'character'
  entityId: number
  label: string
  subLabel?: string
  summary?: string
  active: boolean
  dimmed: boolean
}

interface LayoutResult {
  nodes: Node<CanvasNodeData>[]
  canvasHeight: number
}

function clampColumns(count: number, preferred: number) {
  return Math.max(1, Math.min(preferred, count || 1))
}

function buildNodes(data: FactionGraphPayload): LayoutResult {
  const factions = data.nodes.filter((node) => node.entityType === 'faction')
  const characters = data.nodes.filter((node) => node.entityType === 'character')
  const nodes: Node<CanvasNodeData>[] = []
  const factionColumns = clampColumns(factions.length, factions.length <= 2 ? 2 : factions.length <= 6 ? 3 : 4)
  const factionRowCount = Math.max(1, Math.ceil(Math.max(factions.length, 1) / factionColumns))
  const factionGapX = 300
  const factionGapY = 166
  const factionStartX = 40
  const factionStartY = 44

  factions.forEach((node, index) => {
    const column = index % factionColumns
    const row = Math.floor(index / factionColumns)
    nodes.push({
      id: node.id,
      type: 'factionNode',
      position: { x: factionStartX + column * factionGapX, y: factionStartY + row * factionGapY },
      data: {
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        subLabel: node.subLabel,
        summary: node.summary,
        active: false,
        dimmed: false,
      },
      style: { width: 248 },
    })
  })

  const characterStartY = factionStartY + factionRowCount * factionGapY + 92
  const characterColumns = clampColumns(characters.length, characters.length <= 2 ? 2 : characters.length <= 6 ? 3 : 4)
  const characterGapX = 260
  const characterGapY = 142

  characters.forEach((node, index) => {
    const column = index % characterColumns
    const row = Math.floor(index / characterColumns)
    nodes.push({
      id: node.id,
      type: 'factionNode',
      position: { x: factionStartX + column * characterGapX, y: characterStartY + row * characterGapY },
      data: {
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        subLabel: node.subLabel,
        summary: node.summary,
        active: false,
        dimmed: false,
      },
      style: { width: 220 },
    })
  })

  const characterRowCount = characters.length > 0 ? Math.ceil(characters.length / characterColumns) : 0
  const canvasHeight = Math.max(560, characterStartY + Math.max(characterRowCount, 1) * characterGapY + 140)

  return {
    nodes,
    canvasHeight,
  }
}

function buildEdges(data: FactionGraphPayload, selectedFactionId?: number | null): Edge[] {
  return data.edges.map((edge) => {
    const connected = !selectedFactionId
      || edge.source === `faction-${selectedFactionId}`
      || edge.target === `faction-${selectedFactionId}`
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      label: edge.relationLabel,
      style: {
        stroke: edge.color || '#856f58',
        strokeWidth: edge.relationType === 'leader' ? 3 : 2,
        strokeDasharray: edge.relationType === 'enemy' || edge.relationType === 'rival' || edge.relationType === 'infiltrates'
          ? '8 6'
          : undefined,
        opacity: connected ? 0.92 : 0.18,
      },
      labelStyle: {
        fill: connected ? '#4a3829' : 'rgba(74,56,41,0.45)',
        fontSize: 12,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: 'rgba(255,255,255,0.92)',
      },
      labelBgPadding: [6, 4],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edge.color || '#856f58',
      },
      markerStart: edge.bilateral
        ? {
          type: MarkerType.ArrowClosed,
          color: edge.color || '#856f58',
        }
        : undefined,
    }
  })
}

function decorateNodes(
  nodes: Node<CanvasNodeData>[],
  edges: FactionGraphPayload['edges'],
  selectedFactionId?: number | null,
) {
  if (!selectedFactionId) {
    return nodes.map((node) => ({
      ...node,
      data: { ...node.data, active: false, dimmed: false },
    }))
  }

  const connectedIds = new Set<string>([`faction-${selectedFactionId}`])
  edges.forEach((edge) => {
    if (edge.source === `faction-${selectedFactionId}` || edge.target === `faction-${selectedFactionId}`) {
      connectedIds.add(edge.source)
      connectedIds.add(edge.target)
    }
  })

  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      active: node.id === `faction-${selectedFactionId}`,
      dimmed: !connectedIds.has(node.id),
    },
  }))
}

function FactionNode({ data }: NodeProps<CanvasNodeData>) {
  return (
    <div
      className={[
        'faction-graph-node',
        `faction-graph-node--${data.entityType}`,
        data.active ? 'faction-graph-node--active' : '',
        data.dimmed ? 'faction-graph-node--dimmed' : '',
      ].filter(Boolean).join(' ')}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
      <div className="faction-graph-node__eyebrow">{data.entityType === 'faction' ? '势力' : '人物'}</div>
      <div className="faction-graph-node__title">{data.label}</div>
      {data.subLabel ? <div className="faction-graph-node__meta">{data.subLabel}</div> : null}
    </div>
  )
}

const nodeTypes = {
  factionNode: FactionNode,
}

export default function FactionGraphCanvas({ data, selectedFactionId, onFactionSelect }: Props) {
  const flowRef = useRef<ReactFlowInstance<CanvasNodeData> | null>(null)
  const fittedRef = useRef(false)
  const { nodes: baseNodes, canvasHeight } = useMemo(() => buildNodes(data), [data])
  const visualNodes = useMemo(() => decorateNodes(baseNodes, data.edges, selectedFactionId), [baseNodes, data.edges, selectedFactionId])
  const visualEdges = useMemo(() => buildEdges(data, selectedFactionId), [data, selectedFactionId])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(visualNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(visualEdges)
  const graphSignature = useMemo(
    () => `${data.nodes.map((node) => node.id).join('|')}::${data.edges.map((edge) => edge.id).join('|')}::${selectedFactionId || 'all'}`,
    [data.edges, data.nodes, selectedFactionId],
  )

  useEffect(() => { setNodes(visualNodes) }, [setNodes, visualNodes])
  useEffect(() => { setEdges(visualEdges) }, [setEdges, visualEdges])

  useEffect(() => {
    const flow = flowRef.current
    if (!flow || nodes.length === 0) return
    const delay = window.setTimeout(() => {
      void flow.fitView({
        padding: 0.18,
        minZoom: 0.2,
        maxZoom: 1.15,
        duration: fittedRef.current ? 180 : 320,
      })
      fittedRef.current = true
    }, 40)
    return () => window.clearTimeout(delay)
  }, [graphSignature, nodes.length])

  const handleFit = useCallback(() => {
    void flowRef.current?.fitView({ padding: 0.18, minZoom: 0.2, maxZoom: 1.15, duration: 220 })
  }, [])

  const handleZoomIn = useCallback(() => {
    void flowRef.current?.zoomIn({ duration: 180 })
  }, [])

  const handleZoomOut = useCallback(() => {
    void flowRef.current?.zoomOut({ duration: 180 })
  }, [])

  return (
    <div className="faction-graph-canvas" style={{ height: canvasHeight }}>
        <div className="faction-graph-canvas__tools">
          <button type="button" className="faction-graph-canvas__tool" onClick={handleFit}>
            <AimOutlined />
          </button>
          <button type="button" className="faction-graph-canvas__tool" onClick={handleZoomIn}>
            <PlusOutlined />
          </button>
          <button type="button" className="faction-graph-canvas__tool" onClick={handleZoomOut}>
            <MinusOutlined />
          </button>
        </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => {
          flowRef.current = instance
        }}
        onNodeClick={(_, node) => {
          if (node.data.entityType === 'faction') onFactionSelect?.(node.data.entityId)
        }}
        fitView={false}
        minZoom={0.2}
        maxZoom={1.4}
        zoomOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <Background color="rgba(118, 86, 51, 0.12)" gap={22} />
      </ReactFlow>
    </div>
  )
}
