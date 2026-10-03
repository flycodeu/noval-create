import React, { useMemo, useState } from 'react'
import { Button, Input, Select } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, atlasEntitySummary, atlasLinks } from './atlas-profile'
import { locationPath } from './atlas-presentation'
import { EmptyWork } from './shared'

export function AtlasEntityLibrary({ kind, snapshot, selectedId, onSelect, onGenerate }: { kind: StoryAtlasEntity['kind']; snapshot: StoryAtlasSnapshot; selectedId?: string | null; onSelect: (entity: StoryAtlasEntity) => void; onGenerate: () => void }) {
  const [keyword, setKeyword] = useState('')
  const [regionId, setRegionId] = useState<string | undefined>()
  const [limit, setLimit] = useState(80)
  const rows = useMemo(() => snapshot.entities.filter(entity => entity.kind === kind && `${entity.name} ${entity.summary}`.includes(keyword.trim()) && (!regionId || atlasLinks(snapshot, entity, 'location').some(link => locationPath(snapshot.entities, link.entity.id).some(item => item.id === regionId)))), [snapshot, kind, keyword, regionId])
  return <section className="atlas-library" aria-label={`${ATLAS_KIND_LABELS[kind]}列表`}>
    <div className="atlas-library-tools"><Input.Search aria-label={`查找${ATLAS_KIND_LABELS[kind]}`} placeholder={`查找${ATLAS_KIND_LABELS[kind]}`} value={keyword} onChange={event => { setKeyword(event.target.value); setLimit(80) }} allowClear />{['character', 'faction'].includes(kind) && <Select aria-label="按关联地域筛选" value={regionId} placeholder="所有关联地域" allowClear onChange={setRegionId} showSearch optionFilterProp="label" options={snapshot.entities.filter(item => item.kind === 'location').map(item => ({ value: item.id, label: locationPath(snapshot.entities, item.id).map(parent => parent.name).join(' / ') }))} />}</div>
    <div className="atlas-library-count"><span>{rows.length} 条{ATLAS_KIND_LABELS[kind]}记录</span><Button size="small" onClick={onGenerate}>补充{kind === 'faction' ? '组织' : ATLAS_KIND_LABELS[kind]}</Button></div>
    {rows.length ? <div className="atlas-library-list">{rows.slice(0, limit).map(entity => <button type="button" className={selectedId === entity.id ? 'is-selected' : ''} onClick={() => onSelect(entity)} key={entity.id}><span>{entity.status === 'planned' ? '计划' : '已记录'}</span><strong>{entity.name}</strong>{atlasEntitySummary(entity) && <p>{atlasEntitySummary(entity)}</p>}</button>)}</div> : <EmptyWork title="没有匹配的资料" action={onGenerate}>{keyword || regionId ? '调整关键词或地域筛选后重试。' : '结合现有背景补充资料，生成后的记录会显示在这里。'}</EmptyWork>}
    {rows.length > limit && <Button onClick={() => setLimit(value => value + 80)}>继续显示（{limit}/{rows.length}）</Button>}
  </section>
}
