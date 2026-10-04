import React, { useState } from 'react'
import { Checkbox, Select } from 'antd'
import type { StoryAtlasRelation, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_TRAVEL_SEASONS, atlasTravelMode, calculateAtlasJourney, type AtlasTravelSeason } from '../../../shared/story-atlas-travel'
import { locationPath } from './atlas-presentation'

export function AtlasJourneyPlanner({ snapshot, initialFromId = '', initialToId = '', onRelation }: { snapshot: StoryAtlasSnapshot; initialFromId?: string; initialToId?: string; onRelation: (relation: StoryAtlasRelation) => void }) {
  const [fromId, setFromId] = useState(initialFromId)
  const [toId, setToId] = useState(initialToId)
  const [mode, setMode] = useState('')
  const [season, setSeason] = useState<AtlasTravelSeason | ''>('')
  const [allowTransfers, setAllowTransfers] = useState(false)
  const places = snapshot.entities.filter(entity => entity.kind === 'location' && entity.status === 'confirmed')
  const options = places.map(place => ({ value: place.id, label: locationPath(snapshot.entities, place.id).map(entity => entity.name).join(' / ') }))
  const modes = [...new Set(snapshot.relations.filter(relation => relation.kind === 'route' && relation.status === 'confirmed').map(relation => atlasTravelMode(relation.attributes.travelMode)).filter(Boolean))]
  const result = fromId && toId ? calculateAtlasJourney(snapshot.entities, snapshot.relations, fromId, toId, { ...(mode ? { travelMode: mode } : {}), ...(season ? { season } : {}), allowTransfers }) : null
  const placeName = (id: string) => snapshot.entities.find(entity => entity.id === id)?.name || '地点不可用'
  const amount = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  return <details className="author-disclosure atlas-journey-planner"><summary>行程查询</summary>
    <div className="atlas-journey-controls">
      <Select aria-label="行程起点" placeholder="起点" showSearch optionFilterProp="label" value={fromId || undefined} options={options} onChange={setFromId} />
      <Select aria-label="行程终点" placeholder="终点" showSearch optionFilterProp="label" value={toId || undefined} options={options} onChange={setToId} />
      <Select aria-label="行程交通方式" value={mode} options={[{ value: '', label: '不限交通方式' }, ...modes.map(value => ({ value, label: value }))]} onChange={setMode} />
      <Select aria-label="行程季节" value={season} options={[{ value: '', label: '不指定季节' }, ...Object.entries(ATLAS_TRAVEL_SEASONS).map(([value, label]) => ({ value, label }))]} onChange={setSeason} />
      <Checkbox checked={allowTransfers} onChange={event => setAllowTransfers(event.target.checked)}>允许已登记换乘</Checkbox>
    </div>
    {result && <div className="atlas-journey-result" aria-live="polite">
      {result.status === 'known' ? <><strong>已登记方案：{amount(result.totalHours!)} 小时{result.totalDistanceKm !== undefined ? ` · ${amount(result.totalDistanceKm)} 公里` : ' · 里程资料未齐'}</strong>
        {result.steps.length > 0 && <ol>{result.steps.map((step, index) => {
          const route = snapshot.relations.find(relation => relation.id === step.routeId)!
          return <li key={`${step.routeId}:${index}`}><button type="button" onClick={() => onRelation(route)}>{placeName(step.fromId)} → {placeName(step.toId)}</button><span>{step.travelMode} · {amount(step.travelHours)} 小时</span></li>
        })}</ol>}
        {result.transfers.map((transfer, index) => <p key={`${transfer.locationId}:${index}`}>{placeName(transfer.locationId)}：{transfer.fromMode}转{transfer.toMode}，换乘 {amount(transfer.minutes)} 分钟</p>)}
        <small>按条件完整的已登记路线计算；未登记道路和通行条件需另行核实。</small>
      </> : <p>{result.reason}</p>}
      {result.excludedRoutes.length > 0 && <details><summary>待核对通路 · {result.excludedRoutes.length}</summary><ul>{result.excludedRoutes.map(issue => {
        const route = snapshot.relations.find(relation => relation.id === issue.routeId)!
        return <li key={issue.routeId}><button type="button" onClick={() => onRelation(route)}>{route.label || `${placeName(route.fromId)}至${placeName(route.toId)}`}</button><span>{issue.reasons.join('、')}</span></li>
      })}</ul></details>}
    </div>}
  </details>
}
