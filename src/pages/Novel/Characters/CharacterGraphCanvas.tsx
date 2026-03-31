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
import type { Character, CharacterGraphPayload, CharacterRelation } from '../../../types'
import { getCharacterRelationLabel, normalizeCharacterRelationLevel } from '../../../shared/character-relations'

interface CharacterGraphCanvasProps {
  data: CharacterGraphPayload
  selectedCharacterId?: number | null
  onCharacterSelect?: (characterId: number) => void
  onCanvasClick?: () => void
}

interface CanvasNodeData {
  item: Character
  active: boolean
  dimmed: boolean
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

const LEGEND_ITEMS = [
  { label: '亲密 / 家人 / 恋人', color: '#b26a43', note: '暖色线代表高情感温度关系' },
  { label: '朋友 / 同盟 / 师徒', color: '#2f7b70', note: '青绿色线代表协作与信任' },
  { label: '陌生 / 同事 / 上下级', color: '#5b6f9a', note: '蓝灰线代表日常或结构关系' },
  { label: '竞争 / 敌对', color: '#b5544e', note: '红色虚线代表高张力或对抗' },
]

function truncate(text?: string, max = 68) {
  if (!text) return ''
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trim()}...`
}

function isRelationConnectedToSelection(relation: CharacterRelation, selectedCharacterId?: number | null) {
  if (!selectedCharacterId) return true
  return relation.charAId === selectedCharacterId || relation.charBId === selectedCharacterId
}

function getConnectedCharacterIds(relations: CharacterRelation[], selectedCharacterId?: number | null) {
  const ids = new Set<number>()
  if (!selectedCharacterId) return ids
  ids.add(selectedCharacterId)
  relations.forEach((relation) => {
    if (!isRelationConnectedToSelection(relation, selectedCharacterId)) return
    ids.add(relation.charAId)
    ids.add(relation.charBId)
  })
  return ids
}

function getRelationColor(type?: string | null) {
  switch (type) {
    case 'family':
      return '#a56a36'
    case 'lover':
      return '#bb5b78'
    case 'friend':
    case 'ally':
    case 'mentor_student':
      return '#2f7b70'
    case 'colleague':
    case 'subordinate':
      return '#5b6f9a'
    case 'stranger':
    case 'acquaintance':
      return '#8c7d6d'
    case 'rival':
    case 'enemy':
      return '#b5544e'
    default:
      return '#8a6f54'
  }
}

function getRelationStrokeWidth(relation: CharacterRelation) {
  const intimacy = normalizeCharacterRelationLevel(relation.intimacyLevel) || 0
  const tension = normalizeCharacterRelationLevel(relation.tensionLevel) || 0
  return 1.5 + intimacy * 0.24 + tension * 0.32
}

function buildEdgeLabel(relation: CharacterRelation, crowded: boolean) {
  if (crowded) return undefined
  const label = getCharacterRelationLabel(relation.relationType, relation.relationLabel)
  const intimacy = normalizeCharacterRelationLevel(relation.intimacyLevel)
  const tension = normalizeCharacterRelationLevel(relation.tensionLevel)
  const parts = [
    label,
    intimacy ? `亲密${intimacy}/5` : '',
    tension ? `张力${tension}/5` : '',
  ].filter(Boolean)
  return parts.join(' · ')
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
          dimmed: false,
        },
        style: { width },
      })
    })
  })

  return nodes
}

function buildGraphEdges(data: CharacterGraphPayload, selectedCharacterId?: number | null) {
  const crowded = data.relations.length > 18

  return data.relations.map((relation) => {
    const color = getRelationColor(relation.relationType)
    const connected = isRelationConnectedToSelection(relation, selectedCharacterId)
    const tension = normalizeCharacterRelationLevel(relation.tensionLevel) || 0
    const opacity = !selectedCharacterId ? 0.76 : connected ? 0.92 : 0.14

    return {
      id: `relation-${relation.id}`,
      source: `character-${relation.charAId}`,
      target: `character-${relation.charBId}`,
      type: 'smoothstep',
      label: buildEdgeLabel(relation, crowded),
      style: {
        stroke: color,
        strokeWidth: getRelationStrokeWidth(relation),
        strokeOpacity: opacity,
        strokeDasharray: tension >= 4 || relation.relationType === 'rival' || relation.relationType === 'enemy'
          ? '10 6'
          : undefined,
      },
      labelStyle: {
        fill: connected || !selectedCharacterId ? '#49392a' : 'rgba(73, 57, 42, 0.42)',
        fontSize: 12,
        fontWeight: 700,
      },
      labelBgStyle: {
        fill: connected || !selectedCharacterId ? 'rgba(255,255,255,0.94)' : 'rgba(255,255,255,0.68)',
        fillOpacity: 1,
      },
      labelBgPadding: [6, 4],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
      },
      markerStart: relation.bilateral
        ? {
          type: MarkerType.ArrowClosed,
          color,
        }
        : undefined,
      animated: !crowded && connected && tension >= 5,
      zIndex: connected ? 10 : 1,
      data: relation,
    } satisfies Edge
  })
}

function CharacterNode({ data }: NodeProps<CanvasNodeData>) {
  const { item, active, dimmed } = data
  return (
    <div
      className={[
        'character-graph-node',
        `character-graph-node--${item.roleType}`,
        active ? 'character-graph-node--active' : '',
        dimmed ? 'character-graph-node--dimmed' : '',
      ].filter(Boolean).join(' ')}
    >
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

function decorateNodes(
  nodes: Node<CanvasNodeData>[],
  relations: CharacterRelation[],
  selectedCharacterId?: number | null,
) {
  const connectedIds = getConnectedCharacterIds(relations, selectedCharacterId)

  return nodes.map((node) => {
    const item = (node.data as CanvasNodeData).item
    const active = item.id === selectedCharacterId
    const dimmed = Boolean(selectedCharacterId) && !active && !connectedIds.has(item.id)

    return {
      ...node,
      data: {
        ...node.data,
        active,
        dimmed,
      },
    }
  })
}

export default function CharacterGraphCanvas({
  data,
  selectedCharacterId,
  onCharacterSelect,
  onCanvasClick,
}: CharacterGraphCanvasProps) {
  const baseNodes = useMemo(() => buildGraphNodes(data), [data])
  const baseEdges = useMemo(() => buildGraphEdges(data, selectedCharacterId), [data, selectedCharacterId])
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNodeData>(
    decorateNodes(baseNodes, data.relations, selectedCharacterId),
  )
  const [edges, setEdges, onEdgesChange] = useEdgesState(baseEdges)
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null)
  const fittedRef = useRef(false)

  useEffect(() => {
    setNodes(decorateNodes(baseNodes, data.relations, selectedCharacterId))
  }, [baseNodes, data.relations, selectedCharacterId, setNodes])

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
      <div className="character-graph-shell__legend">
        <div className="character-graph-shell__legend-title">关系图例</div>
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="character-graph-shell__legend-row">
            <span className="character-graph-shell__legend-swatch" style={{ background: item.color }} />
            <div>
              <strong>{item.label}</strong>
              <span>{item.note}</span>
            </div>
          </div>
        ))}
        <div className="character-graph-shell__legend-note">
          线越粗代表关系越强；虚线代表高张力；单箭头表示单向感受，双箭头表示双方都承认这层关系。
        </div>
      </div>
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
