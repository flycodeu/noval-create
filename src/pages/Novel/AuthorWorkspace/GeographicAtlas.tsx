import React, { useEffect, useId, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { HomeOutlined, PlusOutlined, MinusOutlined, ExpandOutlined, ArrowRightOutlined } from '@ant-design/icons'
import type { StoryAtlasEntity, StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { locationPath, atlasAttributeValue } from './atlas-presentation'
import { atlasEntityMatchesSearch, atlasLocationScope } from './atlas-profile'
import { atlasGeography, geographicLayer, geographicDescendants, geographicSettlements, geographicLabelPositions, geographicAppearance, geographicUnmappedAnchor, locationCategory, mapArea, DEVELOPMENT_LABELS } from './geographic-map'
import { resolveAtlasGeography, atlasGeographicCoverage } from '../../../shared/story-atlas-geography'
import { AtlasJourneyPlanner } from './AtlasJourneyPlanner'
import './geographic-atlas.css'

type Props = { snapshot: StoryAtlasSnapshot; parentId: string | null; selectedId: string | null; onSelect: (entity: StoryAtlasEntity) => void; onDrill: (entity: StoryAtlasEntity | null) => void; onRelation: (relation: StoryAtlasRelation) => void; onGenerate: () => void }
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
  const parentMetrics = parent ? resolveAtlasGeography(parent, snapshot.entities) : undefined
  const coverage = parent && (locationCategory(parent) === 'country' || layer.some(item => ['country', 'region'].includes(locationCategory(item.entity))))
    ? atlasGeographicCoverage(parent, snapshot.entities) : undefined
  const descendants = geographicDescendants(snapshot, parentId)
  const counts = { country: 0, region: 0, settlement: 0, site: 0 }
  descendants.forEach(entity => counts[locationCategory(entity)]++)
  const countryIndex = descendants.filter(entity => locationCategory(entity) === 'country')
  const unexploredCount = layer.filter(item => item.geography.development === 'unexplored').length
  const path = locationPath(snapshot.entities, parentId)
  const matched = layer.filter(item => atlasEntityMatchesSearch(item.entity, search) || geographicDescendants(snapshot, item.entity.id).some(entity => atlasEntityMatchesSearch(entity, search)))
  const selected = layer.find(item => item.entity.id === selectedId)
  const positioned = layer.filter(item => item.center)
  const hasBoundaries = layer.some(item => item.geography.boundary.length)
  const frame = parentMetrics?.frame
  const ratio = frame ? frame.widthKm / frame.heightKm : 840 / 560
  const width = Math.min(840, 560 * ratio), height = Math.min(560, 840 / ratio)
  const left = (1000 - width) / 2, top = (700 - height) / 2
  const pixelScale = Math.min(viewport.width / view.width, viewport.height / view.height)
  const labelScale = pixelScale > 0 ? Math.max(1, Math.min(2.2, .78 / pixelScale)) : 1
  const scaleLength = Math.min(width / 5, view.width / 4)
  const project = (point: { x: number; y: number }) => ({ x: left + point.x / 100 * width, y: top + point.y / 100 * height })
  const polygonPoints = (boundary: Array<{ x: number; y: number }>) => boundary.map(point => { const p = project(point); return `${p.x},${p.y}` }).join(' ')
  const outline = parentMetrics?.localBoundary?.length ? polygonPoints(parentMetrics.localBoundary) : undefined
  const unmappedAnchor = parentMetrics?.localBoundary && coverage?.unmappedAreaKm2 && coverage.unmappedAreaKm2 > 0
    ? geographicUnmappedAnchor(parentMetrics.localBoundary, layer.map(item => item.geography.boundary)) : undefined
  const settlements = geographicSettlements(snapshot, parentId)
  const labels = [...positioned.map(item => ({ entity: item.entity, center: item.center!, region: item.geography.boundary.length > 0, preview: item.preview, area: item.metrics.calculatedAreaKm2 ?? item.geography.areaKm2, development: item.geography.development, regionId: item.entity.id })), ...settlements.map(item => ({ ...item, region: false, preview: false, area: undefined, development: undefined }))]
  const nationalView = !parent || locationCategory(parent) === 'country'
  const labelOffsets = geographicLabelPositions(labels.map(item => {
    const type = String(item.entity.attributes.nodeType || item.entity.attributes.locationType || '')
    const highlighted = selectedId === item.entity.id || Boolean(search && atlasEntityMatchesSearch(item.entity, search))
    return { ...project(item.center), text: item.entity.name, primary: item.region, scale: labelScale,
      priority: highlighted ? 6 : item.region ? 4 : ['city', 'capital'].includes(type) ? 3 : ['town', 'settlement'].includes(type) ? 2 : 1,
      hidden: nationalView && view.width > 650 && type === 'village' && !highlighted }
  }), labels.filter(item => !item.region).map(item => project(item.center)))
  const rootName = parent?.name || '世界地图'
  const zoom = (factor: number) => setView(old => {
    const nextWidth = Math.max(250, Math.min(1600, old.width * factor)), nextHeight = nextWidth * .7
    return { x: old.x + (old.width - nextWidth) / 2, y: old.y + (old.height - nextHeight) / 2, width: nextWidth, height: nextHeight }
  })
  const select = (entity: StoryAtlasEntity) => { if (!drag.current?.moved) onSelect(entity) }
  const enter = (entity: StoryAtlasEntity) => { if (!drag.current?.moved) onDrill(entity) }
  const openPlace = (entity: StoryAtlasEntity, fromKeyboard = false) => {
    if (fromKeyboard) drag.current = null
    if (['country', 'region'].includes(locationCategory(entity)) || snapshot.entities.some(child => child.kind === 'location' && child.parentId === entity.id)) enter(entity)
    else select(entity)
  }
  const routes = snapshot.relations.filter(edge => edge.kind === 'route' && labels.some(item => item.entity.id === edge.fromId) && labels.some(item => item.entity.id === edge.toId))
  return <section className="geographic-atlas" aria-label="区域地图">
    <nav className="author-atlas-path" aria-label="地域路径"><button type="button" onClick={() => onDrill(null)}><HomeOutlined /> 全部地域</button>{path.map(entity => <React.Fragment key={entity.id}><span>/</span><button type="button" onClick={() => onDrill(entity)}>{entity.name}</button></React.Fragment>)}</nav>
    <div className="geographic-heading"><div><h2>{rootName}</h2><span>{parent ? parentGeography.development ? DEVELOPMENT_LABELS[parentGeography.development] : '' : `${layer.length} 处地域`}</span></div><Button onClick={onGenerate}>设计地理</Button></div>
    <div className="geographic-overview" aria-label="地域规模"><div className="geographic-counts">{counts.country > 0 && <span><b>{counts.country}</b> 个国家</span>}{counts.region > 0 && <span><b>{counts.region}</b> 片地区</span>}{counts.settlement > 0 && <span><b>{counts.settlement}</b> 处城镇村落</span>}{counts.site > 0 && <span><b>{counts.site}</b> 处地点</span>}{unexploredCount > 0 && <span><b>{unexploredCount}</b> 片地域待拓展</span>}</div>{parentMetrics && <dl className="geographic-measures">{parentMetrics.declaredAreaKm2 !== undefined && (parentMetrics.calculatedAreaKm2 === undefined || (parentMetrics.areaDifferenceRatio || 0) > .000001) && <div><dt>设定面积</dt><dd>{mapArea(parentMetrics.declaredAreaKm2)}</dd></div>}{parentMetrics.calculatedAreaKm2 !== undefined && <div><dt>按边界计算</dt><dd>{mapArea(parentMetrics.calculatedAreaKm2)}</dd></div>}{coverage?.mappedAreaKm2 !== undefined && <div><dt>已划分</dt><dd>{mapArea(coverage.mappedAreaKm2)}</dd></div>}{coverage?.unmappedAreaKm2 !== undefined && <div><dt>尚未划分</dt><dd>{mapArea(coverage.unmappedAreaKm2)}</dd></div>}{frame && <div><dt>东西 × 南北</dt><dd>{frame.widthKm.toLocaleString('zh-CN')} × {frame.heightKm.toLocaleString('zh-CN')} 公里</dd></div>}</dl>}{parentMetrics?.areaDifferenceRatio !== undefined && parentMetrics.areaDifferenceRatio > .05 && <span className="geographic-data-status">设定面积与边界不一致</span>}{!parentId && countryIndex.length > 0 && <div className="geographic-countries" aria-label="国家索引">{countryIndex.map(entity => <button type="button" key={entity.id} onClick={() => onDrill(entity)}>{entity.name}<ArrowRightOutlined /></button>)}</div>}</div>
    <div className="geographic-search"><Input.Search aria-label="查找本层地域" placeholder="查找地区、城镇与地点" value={search} onChange={event => setSearch(event.target.value)} allowClear /></div>
    {layer.some(item => item.geography.boundary.length) && <nav className="geographic-region-tabs" aria-label="进入内部地图">{matched.filter(item => item.geography.boundary.length).map(item => <button type="button" key={item.entity.id} onClick={() => onDrill(item.entity)} style={{ '--region-color': geographicAppearance(item.entity).color } as React.CSSProperties}><i /><span>{item.entity.name}</span>{item.entity.status === 'planned' && <small>规划</small>}<ArrowRightOutlined /></button>)}</nav>}
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
        <defs><pattern id={`${patternId}-blank`} patternUnits="userSpaceOnUse" width="16" height="16" patternTransform="rotate(35)"><path d="M 0 0 V 16" stroke="#8e9987" strokeWidth=".65" opacity=".2" /></pattern><pattern id={`${patternId}-unknown`} patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(35)"><path d="M 0 0 V 9" stroke="#5c725b" strokeWidth="2" opacity=".3" /></pattern>{outline && <clipPath id={`${patternId}-land`}><polygon points={outline} /></clipPath>}</defs>
        {outline ? <><polygon points={outline} fill="#efeee3" /><polygon points={outline} fill={`url(#${patternId}-blank)`} /></> : <><rect x={left} y={top} width={width} height={height} rx="2" fill="#efeee3" stroke="#b5bdab" strokeWidth="1" /><rect x={left} y={top} width={width} height={height} fill={`url(#${patternId}-blank)`} /></>}
        <g clipPath={outline ? `url(#${patternId}-land)` : undefined}>
        {layer.map(item => {
          if (!item.geography.boundary.length) return null
          const points = polygonPoints(item.geography.boundary)
          return <g key={item.entity.id} className={`geographic-region${selectedId === item.entity.id ? ' is-selected' : ''}`} opacity={search && !matched.includes(item) ? .2 : 1} role="button" tabIndex={0} aria-label={`进入${item.entity.name}地图`} onClick={() => enter(item.entity)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDrill(item.entity) } }}>
            <title>{`${item.entity.name} · ${mapArea(item.metrics.calculatedAreaKm2 ?? item.geography.areaKm2)}${item.entity.status === 'planned' ? ' · 规划地域' : ''}`}</title><polygon points={points} fill={geographicAppearance(item.entity).color} stroke="#697c68" strokeWidth={selectedId === item.entity.id ? 3 : 1.6} strokeDasharray={item.entity.status === 'planned' ? '7 5' : undefined} vectorEffect="non-scaling-stroke" />
            {item.geography.development === 'unexplored' && <polygon points={points} fill={`url(#${patternId}-unknown)`} pointerEvents="none" />}
          </g>
        })}
        {routes.map(edge => {
          const from = project(labels.find(item => item.entity.id === edge.fromId)!.center), to = project(labels.find(item => item.entity.id === edge.toId)!.center)
          return <g key={edge.id} className="geographic-route" role="button" tabIndex={0} aria-label={`查看通路：${edge.label}`} onClick={() => { if (!drag.current?.moved) onRelation(edge) }} onKeyDown={event => { if (event.key === 'Enter') onRelation(edge) }}><title>{edge.label}</title><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="transparent" strokeWidth="16" /><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#806a4a" strokeWidth="2" strokeDasharray={edge.status === 'planned' || edge.attributes.routeOpen === false ? '4 7' : '9 5'} pointerEvents="none" /></g>
        })}
        </g>
        {outline && <polygon points={outline} fill="none" stroke="#4f644f" strokeWidth="2.5" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        {unmappedAnchor && <text x={project(unmappedAnchor).x} y={project(unmappedAnchor).y} textAnchor="middle" className="geographic-unmapped-label" pointerEvents="none">尚未划分</text>}
        {labels.map((item, index) => {
          const p = project(item.center), region = item.region, offset = labelOffsets[index]
          return <g key={`label:${item.entity.id}`} transform={`translate(${p.x},${p.y})`} className={`geographic-pin${selectedId === item.entity.id ? ' is-selected' : ''}`} opacity={search && !matched.some(region => region.entity.id === item.regionId) ? .2 : 1} role="button" tabIndex={0} aria-label={`打开${item.entity.name}`} onClick={() => openPlace(item.entity)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPlace(item.entity, true) } }}>
            <title>{item.entity.name}</title>
            {!region && offset && (offset.x !== 0 || Math.abs(offset.y) > 32 * labelScale) && <line x1="0" y1="0" x2={offset.x ? offset.x - Math.sign(offset.x) * Math.max(34, item.entity.name.length * 16) * labelScale / 2 : 0} y2={offset.y - 7 * labelScale} stroke="#6a795b" strokeWidth="1" opacity=".65" pointerEvents="none" />}
            {!region && <circle r="6" fill={item.preview ? '#fcfaf2' : '#687a60'} stroke="#586750" strokeWidth="2" />}
            {offset !== undefined && <text x={offset.x} y={offset.y} textAnchor="middle" className={region ? 'geographic-region-name' : ''} style={{ fontSize: (region ? 22 : 16) * labelScale }}>{item.entity.name}</text>}
          </g>
        })}
        {!positioned.length && !unmappedAnchor && <text x="500" y="342" textAnchor="middle" className="geographic-empty-label">{layer.length ? '地点尚未定位' : '这片地域尚未展开'}</text>}
      </svg>
      <div className="geographic-compass" aria-label="上北下南，左西右东"><span>北</span><i>↑</i><span>南</span></div>
      <div className="geographic-zoom"><Button aria-label="放大地图" icon={<PlusOutlined />} onClick={() => zoom(.8)} /><Button aria-label="缩小地图" icon={<MinusOutlined />} onClick={() => zoom(1.25)} /><Button aria-label="复位地图" icon={<ExpandOutlined />} onClick={() => setView({ x: 0, y: 0, width: 1000, height: 700 })} /></div>
      <div className="geographic-map-key">{hasBoundaries && <span><i />已划分地域</span>}{layer.some(item => item.entity.status === 'planned') && <span><i className="is-planned" />规划边界</span>}{unexploredCount > 0 && <span><i className="is-unknown" />待拓展</span>}{outline && <span><i className="is-border" />{locationCategory(parent!) === 'country' ? '国界' : '地域边界'}</span>}{(coverage?.unmappedAreaKm2 || 0) > 0 && <span><i className="is-unmapped" />尚未划分</span>}{!hasBoundaries && !outline && <span>边界未设</span>}{positioned.some(item => item.preview) && <span>空心点：示意位置</span>}</div>
      {frame && pixelScale > 0 && <div className="geographic-scale" style={{ width: scaleLength * pixelScale }}><span>{(frame.widthKm * scaleLength / width).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 公里</span></div>}
    </div>
    {selected && <div className="geographic-selection"><div><strong>{selected.entity.name}</strong><span>{mapArea(selected.metrics.calculatedAreaKm2 ?? selected.geography.areaKm2)}{selected.geography.development && ` · ${DEVELOPMENT_LABELS[selected.geography.development]}`}</span></div><Button onClick={() => onDrill(selected.entity)}>进入地域 <ArrowRightOutlined /></Button></div>}
    <AtlasJourneyPlanner key={snapshot.novelId} snapshot={snapshot} initialFromId={selectedId || ''} onRelation={onRelation} />
    <div className="geographic-index-heading"><h3>{parent ? `${parent.name} · 地域一览` : '国家与地域'}</h3><span>{matched.length} 处</span></div>
    <div className="geographic-location-index" aria-label="本层地点">{matched.map((item, index) => {
      const children = snapshot.entities.filter(child => child.kind === 'location' && child.parentId === item.entity.id)
      const appearance = geographicAppearance(item.entity)
      const area = item.metrics.calculatedAreaKm2 ?? item.geography.areaKm2
      const isRegion = ['country', 'region'].includes(locationCategory(item.entity))
      const childCounts = geographicDescendants(snapshot, item.entity.id).reduce((counts, place) => {
        counts[locationCategory(place)] += 1
        return counts
      }, { country: 0, region: 0, settlement: 0, site: 0 })
      return <article key={item.entity.id} className={selectedId === item.entity.id ? 'is-selected' : ''} style={{ '--region-color': appearance.color } as React.CSSProperties}>
        <div className="geographic-index-title"><button type="button" onClick={() => onSelect(item.entity)}>
          <span>{String(atlasAttributeValue('nodeType', item.entity.attributes.nodeType || item.entity.attributes.locationType || 'location'))}{item.entity.status === 'planned' ? ' · 规划' : ''}</span>
          <strong><i>{String(index + 1).padStart(2, '0')}</i>{item.entity.name}</strong>
          {(area !== undefined || isRegion) && <small>{mapArea(area)}{!item.geography.boundary.length && isRegion ? ' · 边界未设' : ''}</small>}
        </button><button type="button" className="geographic-enter" aria-label={`进入${item.entity.name}`} onClick={() => onDrill(item.entity)}><ArrowRightOutlined /></button></div>
        {appearance.terrain && <span className="geographic-terrain">{appearance.terrain}</span>}
        {item.entity.summary && <p>{item.entity.summary}</p>}
        {isRegion && <div className="geographic-child-counts">{childCounts.region > 0 && <span>{childCounts.region} 片地区</span>}{childCounts.settlement > 0 ? <span>{childCounts.settlement} 处城镇村落</span> : <span>城镇尚未设计</span>}{childCounts.site > 0 && <span>{childCounts.site} 处地点</span>}</div>}
        {children.length > 0 && <div className="geographic-child-index">{children.slice(0, 8).map(child => <button type="button" key={child.id} onClick={() => onDrill(child)}><span>{String(atlasAttributeValue('nodeType', child.attributes.nodeType || child.attributes.locationType || 'location'))}</span>{child.name}</button>)}{children.length > 8 && <button type="button" onClick={() => onDrill(item.entity)}>另 {children.length - 8} 处 <ArrowRightOutlined /></button>}</div>}
        <div className="geographic-index-actions"><span>{item.geography.development ? DEVELOPMENT_LABELS[item.geography.development] : ''}</span><button type="button" onClick={() => onSelect(item.entity)}>资料</button>{(isRegion || children.length > 0) && <button type="button" onClick={() => onDrill(item.entity)}>内部地图 <ArrowRightOutlined /></button>}</div>
      </article>
    })}</div>
    {search && !matched.length && <p className="geographic-no-results">本层没有匹配的地点</p>}
  </section>
}
