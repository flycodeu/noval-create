import React, { useEffect, useMemo } from 'react'
import 'reactflow/dist/style.css'
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
  Handle,
} from 'reactflow'
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

function truncate(text?: string, max = 70) {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max).trim()}...`
}

function buildNodes(data: FactionGraphPayload) {
  const factions = data.nodes.filter((node) => node.entityType === 'faction')
  const characters = data.nodes.filter((node) => node.entityType === 'character')
  const nodes: Node<CanvasNodeData>[] = []

  factions.forEach((node, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    nodes.push({
      id: node.id,
      type: 'factionNode',
      position: { x: 30 + column * 340, y: 40 + row * 170 },
      data: {
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        subLabel: node.subLabel,
        summary: node.summary,
        active: false,
        dimmed: false,
      },
      style: { width: 280 },
    })
  })

  characters.forEach((node, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    nodes.push({
      id: node.id,
      type: 'factionNode',
      position: { x: 760 + column * 280, y: 40 + row * 150 },
      data: {
        entityType: node.entityType,
        entityId: node.entityId,
        label: node.label,
        subLabel: node.subLabel,
        summary: node.summary,
        active: false,
        dimmed: false,
      },
      style: { width: 236 },
    })
  })

  return nodes
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
      <div className="faction-graph-node__summary">{truncate(data.summary || '等待补充上下文。')}</div>
    </div>
  )
}

const nodeTypes = {
  factionNode: FactionNode,
}

export default function FactionGraphCanvas({ data, selectedFactionId, onFactionSelect }: Props) {
  const baseNodes = useMemo(() => buildNodes(data), [data])
  const visualNodes = useMemo(() => decorateNodes(baseNodes, data.edges, selectedFactionId), [baseNodes, data.edges, selectedFactionId])
  const visualEdges = useMemo(() => buildEdges(data, selectedFactionId), [data, selectedFactionId])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(visualNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(visualEdges)

  useEffect(() => { setNodes(visualNodes) }, [setNodes, visualNodes])
  useEffect(() => { setEdges(visualEdges) }, [setEdges, visualEdges])

  return (
    <div className="faction-graph-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          if (node.data.entityType === 'faction') onFactionSelect?.(node.data.entityId)
        }}
        fitView
        minZoom={0.45}
        maxZoom={1.4}
      >
        <Background color="rgba(118, 86, 51, 0.12)" gap={22} />
        <MiniMap pannable zoomable nodeColor={(node) => ((node.data as CanvasNodeData).entityType === 'faction' ? '#8d6734' : '#6a7c8a')} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
