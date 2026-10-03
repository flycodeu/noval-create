import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { HomeOutlined, PlusOutlined, MinusOutlined, ExpandOutlined, ArrowRightOutlined } from '@ant-design/icons'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { locationPath, atlasAttributeValue } from './atlas-presentation'
import { atlasEntityMatchesSearch, atlasLocationScope } from './atlas-profile'
import { atlasGeography, geographicLayer, mapArea, DEVELOPMENT_LABELS } from './geographic-map'
import './geographic-atlas.css'

type Props = { snapshot: StoryAtlasSnapshot; parentId: string | null; selectedId: string | null; onSelect: (entity: StoryAtlasEntity) => void; onDrill: (entity: StoryAtlasEntity | null) => void; onRelation: (relation: StoryAtlasRelation) => void; onGenerate: () => void }
const palette = ['#c7d5bd', '#decda5', '#bfd3cc', '#d9bfa9', '#d1c7da', '#c7d7d7']
export function GeographicAtlas(props: Props) {
  const parentId = atlasLocationScope(props.snapshot, props.parentId)
  return <GeographicLayer key={`${props.snapshot.novelId}:${parentId}:${props.snapshot.atChapter}`} {...props} parentId={parentId} />
}
function GeographicLayer({ snapshot, parentId, selectedId, onSelect, onDrill, onRelation, onGenerate }: Props) {
  const patternId = useId().replace(/:/g, '')
  const [search, setSearch] = useState('')
  const [view, setView] = useState({ x: 0, y: 0, width: 1000, height: 700 })
  const svgRef = useRef<SVGSVGElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => { const rect = svg.getBoundingClientRect(); setViewport({ width: rect.width, height: rect.height }) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])
  const drag = useRef<{ x: number; y: number; origin: typeof view; moved: boolean } | null>(null)
  const layer = geographicLayer(snapshot, parentId)
  const parent = snapshot.entities.find(entity => entity.id === parentId)
  const parentGeography = atlasGeography(parent)
  const path = locationPath(snapshot.entities, parentId)
  const matched = layer.filter(item => atlasEntityMatchesSearch(item.entity, search))
  const selected = layer.find(item => item.entity.id === selectedId)
  const positioned = layer.filter(item => item.center)
  const hasBoundaries = layer.some(item => item.geography.boundary.length)
  const frame = parentGeography.frame
  const ratio = frame ? frame.widthKm / frame.heightKm : 840 / 560
  const width = Math.min(840, 560 * ratio), height = Math.min(560, 840 / ratio)
  const left = (1000 - width) / 2, top = (700 - height) / 2
  const pixelScale = Math.min(viewport.width / view.width, viewport.height / view.height)
  const scaleLength = Math.min(width / 5, view.width / 4)
  const project = (point: { x: number; y: number }) => ({ x: left + point.x / 100 * width, y: top + point.y / 100 * height })
  const zoom = (factor: number) => setView(old => {
    const nextWidth = Math.max(250, Math.min(1600, old.width * factor)), nextHeight = nextWidth * .7
    return { x: old.x + (old.width - nextWidth) / 2, y: old.y + (old.height - nextHeight) / 2, width: nextWidth, height: nextHeight }
  })
  const select = (entity: StoryAtlasEntity) => { if (!drag.current?.moved) onSelect(entity) }
  const routes = snapshot.relations.filter(edge => edge.kind === 'route' && positioned.some(item => item.entity.id === edge.fromId) && positioned.some(item => item.entity.id === edge.toId))
  return <section className="geographic-atlas" aria-label="区域地图">
    <nav className="author-atlas-path" aria-label="地域路径"><button type="button" onClick={() => onDrill(null)}><HomeOutlined /> 全部地域</button>{path.map(entity => <React.Fragment key={entity.id}><span>/</span><button type="button" onClick={() => onDrill(entity)}>{entity.name}</button></React.Fragment>)}</nav>
    <div className="geographic-heading"><div><h2>{parent?.name || '世界地图'}</h2><span>{parent ? mapArea(parentGeography.areaKm2) : `${layer.length} 处地域`}{parentGeography.development && ` · ${DEVELOPMENT_LABELS[parentGeography.development]}`}</span></div><Button onClick={onGenerate}>设计地理</Button></div>
    <div className="geographic-search"><Input.Search aria-label="查找本层地域" placeholder="查找地区、城镇与地点" value={search} onChange={event => setSearch(event.target.value)} allowClear /></div>
    <div className="geographic-canvas">
      <svg ref={svgRef} aria-label={`${parent?.name || '世界'}区域图`} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={event => {
        if (event.button !== 0) return
        drag.current = { x: event.clientX, y: event.clientY, origin: view, moved: false }
      }} onPointerMove={event => {
        const start = drag.current
        if (!start || !(event.buttons & 1)) return
        const dx = event.clientX - start.x, dy = event.clientY - start.y
        if (Math.abs(dx) + Math.abs(dy) < 5) return
        start.moved = true
        event.currentTarget.setPointerCapture(event.pointerId)
        const rect = event.currentTarget.getBoundingClientRect()
        const scale = 1 / Math.min(rect.width / start.origin.width, rect.height / start.origin.height)
        setView({ ...start.origin, x: start.origin.x - dx * scale, y: start.origin.y - dy * scale })
      }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => { drag.current = null }}>
        <defs><pattern id={`${patternId}-blank`} patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(35)"><path d="M 0 0 V 16" stroke="#8e9987" strokeWidth=".65" opacity=".2" /></pattern><pattern id={`${patternId}-unknown`} patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(35)"><path d="M 0 0 V 9" stroke="#5c725b" strokeWidth="2" opacity=".3" /></pattern></defs>
        <rect x={left} y={top} width={width} height={height} rx="2" fill="#efeee3" stroke="#b5bdab" strokeWidth="1" />
        <rect x={left} y={top} width={width} height={height} fill={`url(#${patternId}-blank)`} />
        {layer.map((item, index) => {
          if (!item.geography.boundary.length) return null
          const points = item.geography.boundary.map(point => { const p = project(point); return `${p.x},${p.y}` }).join(' ')
          return <g key={item.entity.id} className={`geographic-region${selectedId === item.entity.id ? ' is-selected' : ''}`} opacity={search && !matched.includes(item) ? .2 : 1} role="button" tabIndex={0} aria-label={`查看${item.entity.name}区域`} onClick={() => select(item.entity)} onDoubleClick={() => onDrill(item.entity)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.entity) } }}>
            <title>{item.entity.name} · {mapArea(item.geography.areaKm2)}</title><polygon points={points} fill={palette[index % palette.length]} stroke="#697c68" strokeWidth={selectedId === item.entity.id ? 3 : 1.4} strokeDasharray={item.entity.status === 'planned' ? '7 5' : undefined} vectorEffect="non-scaling-stroke" />
            {item.geography.development === 'unexplored' && <polygon points={points} fill={`url(#${patternId}-unknown)`} pointerEvents="none" />}
          </g>
        })}
        {routes.map(edge => {
          const from = project(positioned.find(item => item.entity.id === edge.fromId)!.center!), to = project(positioned.find(item => item.entity.id === edge.toId)!.center!)
          return <g key={edge.id} className="geographic-route" role="button" tabIndex={0} aria-label={`查看通路：${edge.label}`} onClick={() => { if (!drag.current?.moved) onRelation(edge) }} onKeyDown={event => { if (event.key === 'Enter') onRelation(edge) }}><title>{edge.label}</title><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="16" /><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#806a4a" strokeWidth="2" strokeDasharray={edge.status === 'planned' || edge.attributes.routeOpen === false ? '4 7' : '9 5'} pointerEvents="none" /></g>
        })}
        {positioned.map(item => {
          const p = project(item.center!), region = item.geography.boundary.length > 0
          return <g key={`label:${item.entity.id}`} transform={`translate(${p.x},${p.y})`} className={`geographic-pin${selectedId === item.entity.id ? ' is-selected' : ''}`} opacity={search && !matched.includes(item) ? .2 : 1} role="button" tabIndex={0} aria-label={`查看${item.entity.name}`} onClick={() => select(item.entity)} onDoubleClick={() => onDrill(item.entity)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.entity) } }}>
            {!region && <circle r="6" fill={item.preview ? '#fcfaf2' : '#687a60'} stroke="#586750" strokeWidth="2" />}
            <text y={region ? 0 : -15} textAnchor="middle" className={region ? 'geographic-region-name' : ''}>{item.entity.name}</text>
            {region && <text y="23" textAnchor="middle" className="geographic-region-note">{item.geography.development === 'unexplored' ? '待拓展' : item.geography.areaKm2 ? mapArea(item.geography.areaKm2) : ''}</text>}
          </g>
        })}
        {!positioned.length && <text x="500" y="342" textAnchor="middle" className="geographic-empty-label">{layer.length ? '选择下方地点，设计边界与方位' : '这片地域尚未展开'}</text>}
      </svg>
      <div className="geographic-compass" aria-label="上北下南，左西右东"><span>北</span><i>↑</i><span>南</span></div>
      <div className="geographic-zoom"><Button aria-label="放大地图" icon={<PlusOutlined />} onClick={() => zoom(.8)} /><Button aria-label="缩小地图" icon={<MinusOutlined />} onClick={() => zoom(1.25)} /><Button aria-label="复位地图" icon={<ExpandOutlined />} onClick={() => setView({ x: 0, y: 0, width: 1000, height: 700 })} /></div>
      <div className="geographic-map-key"><span><i />已划分</span><span><i className="is-unknown" />待拓展</span>{!hasBoundaries && <span>边界未设</span>}{positioned.some(item => item.preview) && <span>空心点：已有示意方位</span>}</div>
      {frame && pixelScale > 0 && <div className="geographic-scale" style={{ width: scaleLength * pixelScale }}><span>{(frame.widthKm * scaleLength / width).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 公里</span></div>}
    </div>
    {selected && <div className="geographic-selection"><div><strong>{selected.entity.name}</strong><span>{mapArea(selected.geography.areaKm2)}{selected.geography.development && ` · ${DEVELOPMENT_LABELS[selected.geography.development]}`}</span></div><Button onClick={() => onDrill(selected.entity)}>进入地域 <ArrowRightOutlined /></Button></div>}
    <div className="geographic-location-index" aria-label="本层地点">{matched.map(item => <div key={item.entity.id} className={selectedId === item.entity.id ? 'is-selected' : ''}><button type="button" onClick={() => onSelect(item.entity)}><span>{String(atlasAttributeValue('nodeType', item.entity.attributes.nodeType || item.entity.attributes.locationType || 'location'))}{item.entity.status === 'planned' ? ' · 计划' : ''}</span><strong>{item.entity.name}</strong><small>{item.geography.development ? DEVELOPMENT_LABELS[item.geography.development] : `${snapshot.entities.filter(child => child.kind === 'location' && child.parentId === item.entity.id).length} 处下级地点`}{!item.center ? ' · 待定位' : ''}</small></button><button type="button" className="geographic-enter" aria-label={`进入${item.entity.name}`} onClick={() => onDrill(item.entity)}><ArrowRightOutlined /></button></div>)}</div>
    {search && !matched.length && <p className="geographic-no-results">本层没有匹配的地点</p>}
  </section>
}
