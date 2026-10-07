import React, { useMemo, useState } from 'react'
import { Button, Input, Select } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, atlasEntityMatchesSearch, atlasEntitySummary, atlasLinks, atlasLocationScope } from './atlas-profile'
import { locationPath } from './atlas-presentation'
import { EmptyWork } from './shared'

type Props = { kind: StoryAtlasEntity['kind']; snapshot: StoryAtlasSnapshot; selectedId?: string | null; onSelect: (entity: StoryAtlasEntity) => void; onGenerate: () => void }
export function AtlasEntityLibrary(props: Props) {
  return <AtlasEntityLibraryContent key={`${props.snapshot.novelId}:${props.kind}:${props.snapshot.atChapter}`} {...props} />
}
function AtlasEntityLibraryContent({ kind, snapshot, selectedId, onSelect, onGenerate }: Props) {
  const [keyword, setKeyword] = useState('')
  const [regionId, setRegionId] = useState<string | undefined>()
  const [limit, setLimit] = useState(80)
  const activeRegionId = atlasLocationScope(snapshot, regionId)
  const rows = useMemo(() => snapshot.entities.filter(entity => entity.kind === kind && atlasEntityMatchesSearch(entity, keyword) && (!activeRegionId || atlasLinks(snapshot, entity, 'location').some(link => locationPath(snapshot.entities, link.entity.id).some(item => item.id === activeRegionId)))), [snapshot, kind, keyword, activeRegionId])
  return <section className="atlas-library" aria-label={`${ATLAS_KIND_LABELS[kind]}列表`}>
    <div className="atlas-library-tools"><Input.Search aria-label={`查找${ATLAS_KIND_LABELS[kind]}`} placeholder={`查找${ATLAS_KIND_LABELS[kind]}`} value={keyword} onChange={event => { setKeyword(event.target.value); setLimit(80) }} allowClear />{['character', 'faction'].includes(kind) && <Select aria-label="按关联地域筛选" value={activeRegionId ?? undefined} placeholder="所有关联地域" allowClear onChange={value => { setRegionId(value); setLimit(80) }} showSearch optionFilterProp="label" options={snapshot.entities.filter(item => item.kind === 'location').map(item => ({ value: item.id, label: locationPath(snapshot.entities, item.id).map(parent => parent.name).join(' / ') }))} />}</div>
    <div className="atlas-library-count"><span>{rows.length} 条{ATLAS_KIND_LABELS[kind]}记录</span><Button size="small" onClick={onGenerate}>补充{kind === 'faction' ? '组织' : ATLAS_KIND_LABELS[kind]}</Button></div>
    {rows.length ? <div className="atlas-library-list">{rows.slice(0, limit).map(entity => <button type="button" className={selectedId === entity.id ? 'is-selected' : ''} onClick={() => onSelect(entity)} key={entity.id}><span>{entity.status === 'planned' ? '计划' : '已记录'}</span><strong>{entity.name}</strong>{atlasEntitySummary(entity) && <p>{atlasEntitySummary(entity)}</p>}</button>)}</div> : <EmptyWork title="没有匹配的资料" action={onGenerate} />}
    {rows.length > limit && <Button onClick={() => setLimit(value => value + 80)}>继续显示（{limit}/{rows.length}）</Button>}
  </section>
}
