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
  useEdgesState,
  useNodesState,
} from 'reactflow'
import type { Character, CharacterGraphPayload } from '../../../types'

interface CharacterGraphCanvasProps {
  data: CharacterGraphPayload
  selectedCharacterId?: number | null
  onCharacterSelect?: (characterId: number) => void
  onCanvasClick?: () => void
}

interface CanvasNodeData {
  item: Character
  active: boolean
}

const ROLE_LABELS: Record<Character['roleType'], string> = {
  protagonist: '主角',
  major: '主要人物',
  antagonist: '对立角色',
  supporting: '功能角色',
  minor: '次要人物',
}

const ROLE_COLORS: Record<Character['roleType'], string> = {
  protagonist: '#0b677f',
  major: '#8d6734',
  antagonist: '#a64545',
  supporting: '#5b7f3a',
  minor: '#6f648e',
}

const RELATION_META: Record<string, { label: string; color: string }> = {
  friend: { label: '朋友', color: '#3b7fa5' },
  enemy: { label: '敌人', color: '#b55252' },
  family: { label: '家人', color: '#7b5a2e' },
  parent_child: { label: '亲属', color: '#7b5a2e' },
  colleague: { label: '同事', color: '#6d6d90' },
  acquaintance: { label: '陌生/泛识', color: '#8a826c' },
  rival: { label: '竞争', color: '#8a4e91' },
  mentor_student: { label: '师徒', color: '#0e7c6c' },
  ally: { label: '同盟', color: '#19806a' },
  subordinate: { label: '从属', color: '#576fa8' },
  benefactor: { label: '恩主', color: '#b07a2d' },
  debtor: { label: '债务', color: '#8b5b47' },
  handler: { label: '操控', color: '#8c4969' },
  teammate: { label: '队友', color: '#1f7d61' },
  lover: { label: '恋人', color: '#b35678' },
  spouse: { label: '伴侣', color: '#b35678' },
  ex_lover: { label: '旧情', color: '#8d5a72' },
  political_partner: { label: '政治同盟', color: '#7b6a42' },
}

function truncate(text?: string, max = 68) {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trim()}...`
}

function buildGraphNodes(data: CharacterGraphPayload) {
  const roleOrder: Character['roleType'][] = ['minor', 'major', 'protagonist', 'supporting', 'antagonist']
  const degreeMap = new Map<number, number>()
  data.relations.forEach((relation) => {
    degreeMap.set(relation.charAId, (degreeMap.get(relation.charAId) || 0) + 1)
    degreeMap.set(relation.charBId, (degreeMap.get(relation.charBId) || 0) + 1)
  })

  const byRole = new Map<Character['roleType'], Character[]>()
  roleOrder.forEach((role) => byRole.set(role, []))
  data.characters.forEach((character) => {
    const bucket = byRole.get(character.roleType) || []
    bucket.push(character)
    byRole.set(character.roleType, bucket)
  })

  const columnWidth = 290
  const laneGap = 90
  const rowGap = 188
  const width = 236
  const nodes: Node<CanvasNodeData>[] = []

  roleOrder.forEach((role, columnIndex) => {
    const items = (byRole.get(role) || []).sort((left, right) => (
      (degreeMap.get(right.id) || 0) - (degreeMap.get(left.id) || 0)
      || left.sortOrder - right.sortOrder
      || left.id - right.id
    ))
    items.forEach((item, rowIndex) => {
      nodes.push({
        id: `character-${item.id}`,
        type: 'characterNode',
        position: {
          x: columnIndex * (columnWidth + laneGap) + 40,
          y: rowIndex * rowGap + 52,
        },
        data: {
          item,
          active: false,
        },
        style: { width },
      })
    })
  })

  return nodes
}

function buildGraphEdges(data: CharacterGraphPayload) {
  const crowded = data.relations.length > 18
  return data.relations.map((relation) => {
    const meta = RELATION_META[relation.relationType || ''] || {
      label: relation.relationLabel || relation.relationType || '关系',
      color: '#8a6f54',
    }
    return {
      id: `relation-${relation.id}`,
      source: `character-${relation.charAId}`,
      target: `character-${relation.charBId}`,
      type: 'smoothstep',
      label: crowded ? undefined : (relation.relationLabel || meta.label),
      style: {
        stroke: meta.color,
        strokeWidth: 1.7,
        strokeOpacity: 0.72,
      },
      labelStyle: {
        fill: '#49392a',
        fontSize: 12,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: 'rgba(255,255,255,0.94)',
        fillOpacity: 1,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: meta.color,
      },
      markerStart: relation.bilateral
        ? {
          type: MarkerType.ArrowClosed,
          color: meta.color,
        }
        : undefined,
      data: relation,
    } satisfies Edge
  })
}

function CharacterNode({ data }: NodeProps<CanvasNodeData>) {
  const { item, active } = data
  return (
    <div className={`character-graph-node character-graph-node--${item.roleType} ${active ? 'character-graph-node--active' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <div className="character-graph-node__eyebrow">
        <span style={{ color: ROLE_COLORS[item.roleType] }}>{ROLE_LABELS[item.roleType]}</span>
        <span>{item.recordStatus === 'draft' ? '草稿' : '正式'}</span>
      </div>
      <div className="character-graph-node__title">{item.fullName}</div>
      <div className="character-graph-node__meta">
        {item.species ? <span>{item.species}</span> : null}
        {item.gender ? <span>{item.gender}</span> : null}
        {item.occupation ? <span>{item.occupation}</span> : null}
      </div>
      <div className="character-graph-node__summary">
        {truncate(item.innerConflict || item.goals || item.relationshipTension || item.background || '等待补充这个角色的剧情作用。')}
      </div>
    </div>
  )
}

const nodeTypes = {
  characterNode: CharacterNode,
}

function decorateNodes(nodes: Node<CanvasNodeData>[], selectedCharacterId?: number | null) {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      active: (node.data as CanvasNodeData).item.id === selectedCharacterId,
    },
  }))
}

export default function CharacterGraphCanvas({
  data,
  selectedCharacterId,
  onCharacterSelect,
  onCanvasClick,
}: CharacterGraphCanvasProps) {
  const baseNodes = useMemo(() => buildGraphNodes(data), [data])
  const baseEdges = useMemo(() => buildGraphEdges(data), [data])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(decorateNodes(baseNodes, selectedCharacterId))
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges)
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null)
  const fittedRef = useRef(false)

  useEffect(() => {
    setNodes(decorateNodes(baseNodes, selectedCharacterId))
  }, [baseNodes, selectedCharacterId, setNodes])

  useEffect(() => {
    setEdges(baseEdges)
  }, [baseEdges, setEdges])

  useEffect(() => {
    if (!instance) return
    const frame = window.requestAnimationFrame(() => {
      void instance.fitView({ padding: 0.16, minZoom: 0.18, duration: fittedRef.current ? 180 : 320 })
      fittedRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [instance, baseNodes, baseEdges])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node<CanvasNodeData>) => {
    onCharacterSelect?.(node.data.item.id)
  }, [onCharacterSelect])

  const handleFit = useCallback(() => {
    void instance?.fitView({ padding: 0.16, minZoom: 0.18, duration: 180 })
  }, [instance])

  if (data.characters.length === 0) {
    return <div className="character-graph-empty">当前筛选下还没有可展示的人物关系。</div>
  }

  return (
    <div className="character-graph-shell">
      <button type="button" className="character-graph-shell__fit" onClick={handleFit}>重新居中</button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.12}
        maxZoom={1.8}
        fitView
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        onInit={setInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onPaneClick={onCanvasClick}
      >
        <Background gap={24} size={1} color="rgba(124, 95, 61, 0.08)" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={3}
          nodeColor={(node) => ROLE_COLORS[(node.data as CanvasNodeData).item.roleType]}
          maskColor="rgba(244, 236, 225, 0.72)"
        />
      </ReactFlow>
    </div>
  )
}
