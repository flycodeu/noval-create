import React, { useState } from 'react'
import { ArrowRightOutlined, HomeOutlined } from '@ant-design/icons'
import { Button, Input } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { locationPath } from './atlas-presentation'
import { atlasEntityMatchesSearch } from './atlas-profile'
import { atlasGeography, geographicAppearance, geographicDescendants, geographicPolities } from './geographic-map'

type Props = { snapshot: StoryAtlasSnapshot; parentId: string | null; onDrill: (entity: StoryAtlasEntity | null) => void }

export function AtlasPolityNavigation({ snapshot, parentId, onDrill }: Props) {
  const polities = geographicPolities(snapshot)
  if (polities.length < 2) return null
  const current = locationPath(snapshot.entities, parentId).reverse().find(entity => polities.some(polity => polity.entity.id === entity.id))
  return <nav className="geographic-polity-nav" aria-label="国家与政体索引">
    <button type="button" onClick={() => onDrill(null)}><HomeOutlined /> 政体总览</button>
    {polities.map(polity => <button type="button" key={polity.entity.id} aria-current={current?.id === polity.entity.id ? 'page' : undefined} onClick={() => onDrill(polity.entity)}>{polity.name}<small>{polity.label}</small></button>)}
  </nav>
}

export function AtlasPolityOverview({ snapshot, onDrill, onSelect, onGenerate }: Omit<Props, 'parentId'> & { onSelect: (entity: StoryAtlasEntity) => void; onGenerate: () => void }) {
  const [search, setSearch] = useState('')
  const polities = geographicPolities(snapshot)
  const matched = polities.filter(polity => atlasEntityMatchesSearch(polity.entity, search) || geographicDescendants(snapshot, polity.entity.id).some(entity => atlasEntityMatchesSearch(entity, search)))
  return <section className="geographic-atlas geographic-polity-overview" aria-label="国家与政体总览">
    <div className="geographic-heading"><div><h2>国家与政体</h2><span>{polities.length} 方政体</span></div><Button onClick={onGenerate}>设计地理</Button></div>
    <p className="geographic-polity-intro">从各方政体进入疆域与据点。尚未测绘的国界和国间距离保留待定。</p>
    <div className="geographic-search"><Input.Search aria-label="查找国家与政体" placeholder="查找国家、联盟或境内地点" value={search} onChange={event => setSearch(event.target.value)} allowClear /></div>
    <div className="geographic-polity-cards">
      {matched.map(({ entity, name, label, note }, index) => {
        const geography = atlasGeography(entity)
        const children = geographicDescendants(snapshot, entity.id)
        return <article key={entity.id} style={{ '--region-color': geographicAppearance(entity).color } as React.CSSProperties}>
          <div className="geographic-polity-kicker"><span>{String(index + 1).padStart(2, '0')} · {label}</span>{entity.status === 'planned' && <span>作者规划</span>}</div>
          <h3><button type="button" onClick={() => onDrill(entity)}>{name}<ArrowRightOutlined /></button></h3>
          <p>{entity.summary || '政体资料待补充。'}</p>
          <div className="geographic-polity-meta"><span>{children.length} 处已设地域与据点</span><span>{geography.boundary.length ? '已有地域轮廓' : '边界未测绘'}</span></div>
          {note && <details><summary>地理与政治范围</summary><p>{note}</p></details>}
          <div className="geographic-polity-actions"><button type="button" onClick={() => onSelect(entity)}>查看设定</button><button type="button" onClick={() => onDrill(entity)}>进入地域 <ArrowRightOutlined /></button></div>
        </article>
      })}
    </div>
    {!matched.length && <p className="geographic-no-results">没有匹配的国家或政体</p>}
  </section>
}
