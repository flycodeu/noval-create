import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, message } from 'antd'
import { AppstoreOutlined, EyeInvisibleOutlined, EyeOutlined, MinusOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import type {
  Character,
  CharacterLocationBinding,
  MapBoardViewport,
  MapRelation,
  NarrativeMapLayerKey,
  TimelineEvent,
  WorldMapItem,
} from '../../../types'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import { buildAtlasRouteLinks, buildAtlasTerritories, type AtlasTerritory } from './narrative-atlas-layout'

interface NarrativeMapCanvasProps {
  novelId: number
  nodes: WorldMapItem[]
  mapRelations: MapRelation[]
  viewport: MapBoardViewport | null
  events: TimelineEvent[]
  characters: Character[]
  bindings: CharacterLocationBinding[]
  selectedId?: number
  onSelect: (node: WorldMapItem | null) => void
  onEnter: (node: WorldMapItem) => void
}

interface TerritoryStats {
  eventCount: number
  peopleCount: number
  factionCount: number
}

interface AtlasCamera {
  x: number
  y: number
  zoom: number
}

const ATLAS_LAYOUT_KEY = 'atlas-v1'
const DEFAULT_LAYERS: NarrativeMapLayerKey[] = ['regions', 'routes', 'events', 'people', 'factions']
const MIN_ZOOM = 0.72
const MAX_ZOOM = 2.4

const LAYER_LABELS: Array<{ key: NarrativeMapLayerKey; label: string }> = [
  { key: 'regions', label: '区域' },
  { key: 'routes', label: '路线' },
  { key: 'events', label: '事件' },
  { key: 'people', label: '人物' },
  { key: 'factions', label: '势力' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function safeNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseArray(raw?: string | null): Array<number | string> {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return []
    return value
      .map((item) => {
        if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item
        if (typeof item === 'string' && item.trim()) return item.trim()
        return null
      })
      .filter((item): item is number | string => item !== null)
  } catch {
    return []
  }
}

function descendantsForTerritory(territory: AtlasTerritory): Set<number> {
  return territory.descendantIds
}

function getTerritoryStats(
  territory: AtlasTerritory,
  events: TimelineEvent[],
  characters: Character[],
  bindings: CharacterLocationBinding[],
): TerritoryStats {
  const descendantIds = descendantsForTerritory(territory)
  const territoryEvents = events.filter((event) => typeof event.locationMapId === 'number' && descendantIds.has(event.locationMapId))
  const eventPeopleIds = new Set<number>()
  territoryEvents.forEach((event) => {
    parseArray(event.presentCharacterIdsJson)
      .concat(parseArray(event.affectedCharacterIdsJson))
      .forEach((token) => { if (typeof token === 'number') eventPeopleIds.add(token) })
  })
  const bindingPeopleIds = new Set(
    bindings.filter((binding) => descendantIds.has(binding.mapNodeId)).map((binding) => binding.characterId),
  )
  const peopleCount = characters.filter((character) => {
    if (eventPeopleIds.has(character.id) || bindingPeopleIds.has(character.id)) return true
    return parseArray(character.activeRegionsJson).some((token) => token === territory.item.name || (typeof token === 'number' && descendantIds.has(token)))
  }).length

  return {
    eventCount: territoryEvents.length,
    peopleCount,
    factionCount: parseArray(territory.item.affiliatedFactionIdsJson).length,
  }
}

function routePath(source: AtlasTerritory, target: AtlasTerritory): string {
  const dx = target.centerX - source.centerX
  const dy = target.centerY - source.centerY
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy))
  const startX = source.centerX + (dx / distance) * Math.min(source.width * 0.38, distance * 0.28)
  const startY = source.centerY + (dy / distance) * Math.min(source.height * 0.34, distance * 0.28)
  const endX = target.centerX - (dx / distance) * Math.min(target.width * 0.38, distance * 0.28)
  const endY = target.centerY - (dy / distance) * Math.min(target.height * 0.34, distance * 0.28)
  const bend = Math.max(34, Math.min(120, distance * 0.18))
  const controlX = dx >= 0 ? bend : -bend
  return `M ${Math.round(startX)} ${Math.round(startY)} C ${Math.round(startX + dx * 0.32 + controlX)} ${Math.round(startY + dy * 0.12)} ${Math.round(endX - dx * 0.32 + controlX)} ${Math.round(endY - dy * 0.12)} ${Math.round(endX)} ${Math.round(endY)}`
}

function routeLabelPosition(source: AtlasTerritory, target: AtlasTerritory) {
  return {
    x: Math.round((source.centerX + target.centerX) / 2),
    y: Math.round((source.centerY + target.centerY) / 2 - 8),
  }
}

function isTerritoryTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-atlas-territory]'))
}

function initialCamera(viewport: MapBoardViewport | null): AtlasCamera {
  return {
    x: safeNumber(viewport?.centerX, 0),
    y: safeNumber(viewport?.centerY, 0),
    zoom: clamp(safeNumber(viewport?.zoom, 1), MIN_ZOOM, MAX_ZOOM),
  }
}

export default function NarrativeMapCanvas({
  novelId,
  nodes,
  mapRelations,
  viewport,
  events,
  characters,
  bindings,
  selectedId,
  onSelect,
  onEnter,
}: NarrativeMapCanvasProps) {
  const [activeLayers, setActiveLayers] = useState<Set<NarrativeMapLayerKey>>(
    () => new Set(viewport?.activeLayers?.length ? viewport.activeLayers : DEFAULT_LAYERS),
  )
  const activeLayersRef = useRef(activeLayers)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const saveErrorShownRef = useRef(false)
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)
  const justDraggedRef = useRef(false)
  const cameraRef = useRef<AtlasCamera>(initialCamera(viewport))
  const [camera, setCamera] = useState<AtlasCamera>(() => initialCamera(viewport))

  const atlas = useMemo(() => buildAtlasTerritories(nodes), [nodes])
  const territories = atlas.territories
  const routeLinks = useMemo(() => buildAtlasRouteLinks(territories, mapRelations), [mapRelations, territories])
  const statsById = useMemo(() => new Map(territories.map((territory) => [
    territory.item.id,
    getTerritoryStats(territory, events, characters, bindings),
  ])), [bindings, characters, events, territories])

  useEffect(() => {
    activeLayersRef.current = activeLayers
  }, [activeLayers])

  useEffect(() => {
    cameraRef.current = camera
  }, [camera])

  useEffect(() => () => {
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current)
  }, [])

  const persistViewport = useCallback((next: AtlasCamera, layers = activeLayersRef.current) => {
    if (!Number.isSafeInteger(novelId) || novelId <= 0) return
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void window.electron.narrativeBoard.saveViewport({
        novelId,
        layoutKey: ATLAS_LAYOUT_KEY,
        centerX: next.x,
        centerY: next.y,
        zoom: next.zoom,
        activeLayers: [...layers],
        layoutVersion: viewport?.layoutVersion || 1,
      }).catch(() => {
        if (!saveErrorShownRef.current) {
          saveErrorShownRef.current = true
          message.error(getUserFacingMessage('map.saveFailed'))
        }
      })
    }, 420)
  }, [novelId, viewport?.layoutVersion])

  const updateCamera = useCallback((next: AtlasCamera, persist = false) => {
    cameraRef.current = next
    setCamera(next)
    if (persist) persistViewport(next)
  }, [persistViewport])

  const zoomBy = useCallback((factor: number) => {
    const current = cameraRef.current
    const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const anchorX = atlas.width / 2
    const anchorY = atlas.height / 2
    updateCamera({
      x: anchorX - (anchorX - current.x) * nextZoom / current.zoom,
      y: anchorY - (anchorY - current.y) * nextZoom / current.zoom,
      zoom: nextZoom,
    }, true)
  }, [atlas.height, atlas.width, updateCamera])

  const handleFit = useCallback(() => {
    updateCamera({ x: 0, y: 0, zoom: 1 }, true)
  }, [updateCamera])

  const toggleLayer = useCallback((layer: NarrativeMapLayerKey) => {
    const next = new Set(activeLayersRef.current)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    activeLayersRef.current = next
    setActiveLayers(next)
    persistViewport(cameraRef.current, next)
  }, [persistViewport])

  const handlePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (isTerritoryTarget(event.target)) return
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY }
    justDraggedRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handlePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.lastX
    const deltaY = event.clientY - drag.lastY
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) justDraggedRef.current = true
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    const current = cameraRef.current
    updateCamera({ x: current.x + deltaX, y: current.y + deltaY, zoom: current.zoom })
  }, [updateCamera])

  const handlePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    persistViewport(cameraRef.current)
  }, [persistViewport])

  const handleWheel = useCallback((event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const current = cameraRef.current
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    const nextZoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const anchorX = atlas.width / 2
    const anchorY = atlas.height / 2
    updateCamera({
      x: anchorX - (anchorX - current.x) * nextZoom / current.zoom,
      y: anchorY - (anchorY - current.y) * nextZoom / current.zoom,
      zoom: nextZoom,
    }, true)
  }, [atlas.height, atlas.width, updateCamera])

  const handleSvgClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false
      return
    }
    if (!isTerritoryTarget(event.target)) onSelect(null)
  }, [onSelect])

  if (nodes.length === 0) {
    return <div className="narrative-map-canvas__empty">当前范围没有可展示的地区。先在地点资料页建立层级区域，或为阶段绑定地图资产。</div>
  }

  const cameraTransform = `translate(${Math.round(camera.x)} ${Math.round(camera.y)}) scale(${camera.zoom})`
  return (
    <div className="narrative-map-canvas narrative-atlas">
      <div className="narrative-map-canvas__toolbar narrative-atlas__toolbar">
        <div className="narrative-map-canvas__layers">
          <span><AppstoreOutlined /> 图层</span>
          {LAYER_LABELS.map((layer) => {
            const active = activeLayers.has(layer.key)
            return <Button key={layer.key} size="small" type={active ? 'primary' : 'default'} icon={active ? <EyeOutlined /> : <EyeInvisibleOutlined />} onClick={() => toggleLayer(layer.key)}>{layer.label}</Button>
          })}
        </div>
        <div className="narrative-atlas__camera" aria-label="地图缩放">
          <Button size="small" icon={<MinusOutlined />} aria-label="缩小地图" onClick={() => zoomBy(0.88)} />
          <span>{Math.round(camera.zoom * 100)}%</span>
          <Button size="small" icon={<PlusOutlined />} aria-label="放大地图" onClick={() => zoomBy(1.14)} />
          <Button size="small" icon={<SaveOutlined />} onClick={handleFit}>重新居中</Button>
        </div>
      </div>
      <div className="narrative-map-canvas__hint narrative-atlas__hint">
        <span>单击区域查看详情 · 双击有下级区域进入 · 拖动空白处平移 · 滚轮缩放</span>
        <span>{territories.length} 个当前区域 / {routeLinks.length} 条关联路线</span>
      </div>
      <div className="narrative-atlas__frame">
        <svg
          className="narrative-atlas__svg"
          viewBox={`0 0 ${atlas.width} ${atlas.height}`}
          role="application"
          aria-label="小说世界区域地图"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
          onClick={handleSvgClick}
        >
          <defs>
            <linearGradient id="narrative-atlas-sea" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#dbe8e3" />
              <stop offset="1" stopColor="#b9d2cd" />
            </linearGradient>
            <pattern id="narrative-atlas-grid" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M 56 0 L 0 0 0 56" fill="none" stroke="rgba(71, 105, 102, 0.12)" strokeWidth="1" />
              <circle cx="28" cy="28" r="1.5" fill="rgba(71, 105, 102, 0.18)" />
            </pattern>
            <marker id="narrative-atlas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#527f78" />
            </marker>
            <marker id="narrative-atlas-arrow-closed" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#a85d53" />
            </marker>
          </defs>
          <g className="narrative-atlas__camera-layer" transform={cameraTransform}>
            <rect className="narrative-atlas__water" x="0" y="0" width={atlas.width} height={atlas.height} rx="48" fill="url(#narrative-atlas-sea)" />
            <rect className="narrative-atlas__grid" x="0" y="0" width={atlas.width} height={atlas.height} rx="48" fill="url(#narrative-atlas-grid)" />
            <g className="narrative-atlas__contours" aria-hidden="true">
              <path d={`M 30 ${atlas.height * 0.22} C ${atlas.width * 0.2} ${atlas.height * 0.05}, ${atlas.width * 0.36} ${atlas.height * 0.32}, ${atlas.width * 0.55} ${atlas.height * 0.16} S ${atlas.width * 0.82} ${atlas.height * 0.12}, ${atlas.width - 30} ${atlas.height * 0.28}`} />
              <path d={`M 20 ${atlas.height * 0.78} C ${atlas.width * 0.18} ${atlas.height * 0.58}, ${atlas.width * 0.36} ${atlas.height * 0.9}, ${atlas.width * 0.58} ${atlas.height * 0.72} S ${atlas.width * 0.82} ${atlas.height * 0.64}, ${atlas.width - 26} ${atlas.height * 0.82}`} />
              <path d={`M ${atlas.width * 0.12} 28 C ${atlas.width * 0.22} ${atlas.height * 0.18}, ${atlas.width * 0.24} ${atlas.height * 0.45}, ${atlas.width * 0.12} ${atlas.height - 34}`} />
            </g>
            {activeLayers.has('routes') ? <g className="narrative-atlas-route-layer" aria-label="区域路线">
              {routeLinks.map((link) => {
                const position = routeLabelPosition(link.source, link.target)
                const color = link.closed ? '#a85d53' : '#527f78'
                return (
                  <g key={link.id} className={`narrative-atlas-route${link.closed ? ' is-closed' : ''}`}>
                    <path d={routePath(link.source, link.target)} stroke={color} markerEnd={`url(#${link.closed ? 'narrative-atlas-arrow-closed' : 'narrative-atlas-arrow'})`} aria-label={`${link.source.item.name}至${link.target.item.name}${link.closed ? '，路线关闭' : ''}`} />
                    {link.label ? <text x={position.x} y={position.y}>{link.label}</text> : null}
                  </g>
                )
              })}
            </g> : null}
            {activeLayers.has('regions') ? <g className="narrative-atlas-territory-layer" aria-label="地图区域">
              {territories.map((territory) => {
                const item = territory.item
                const stats = statsById.get(item.id) || { eventCount: 0, peopleCount: 0, factionCount: 0 }
                const hasChildren = Boolean(item.children?.length)
                const selected = item.id === selectedId
                const summary = item.plotRelevance || item.description || '尚未补充区域说明，点击查看详情。'
                return (
                  <g
                    key={item.id}
                    className={`narrative-atlas-territory${selected ? ' is-selected' : ''}`}
                    data-atlas-territory={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${item.name}，${item.locationType || item.nodeType || `层级 L${item.level}`}${hasChildren ? `，有 ${item.children?.length} 个下级区域` : ''}`}
                    aria-pressed={selected}
                    onClick={(event) => { event.stopPropagation(); onSelect(item) }}
                    onDoubleClick={(event) => { event.stopPropagation(); if (hasChildren) onEnter(item) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(item)
                      }
                    }}
                  >
                    <polygon points={territory.points} />
                    <foreignObject x={territory.x + 24} y={territory.y + 22} width={territory.width - 48} height={territory.height - 44}>
                      <div className="narrative-atlas-territory__label">
                        <div className="narrative-atlas-territory__meta"><span>L{item.level}</span><span>{item.locationType || item.nodeType || '区域'}</span></div>
                        <strong title={item.name}>{item.name}</strong>
                        <p title={summary}>{summary}</p>
                        <div className="narrative-atlas-territory__badges">
                          {activeLayers.has('events') && stats.eventCount > 0 ? <span className="is-event">事件 {stats.eventCount}</span> : null}
                          {activeLayers.has('people') && stats.peopleCount > 0 ? <span className="is-people">人物 {stats.peopleCount}</span> : null}
                          {activeLayers.has('factions') && stats.factionCount > 0 ? <span className="is-faction">势力 {stats.factionCount}</span> : null}
                          {hasChildren ? <span className="is-child">下级 {item.children?.length}</span> : null}
                        </div>
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
            </g> : null}
            <g className="narrative-atlas__compass" aria-label="地图方向">
              <circle cx={atlas.width - 76} cy={72} r={30} />
              <path d={`M ${atlas.width - 76} 50 L ${atlas.width - 67} 78 L ${atlas.width - 76} 72 L ${atlas.width - 85} 78 Z`} />
              <text x={atlas.width - 76} y={39}>N</text>
            </g>
          </g>
        </svg>
      </div>
    </div>
  )
}
