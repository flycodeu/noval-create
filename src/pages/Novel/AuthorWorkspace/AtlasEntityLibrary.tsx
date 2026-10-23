import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Pagination, Select } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, atlasEntitySummary, atlasLocationScope } from './atlas-profile'
import { locationPath } from './atlas-presentation'
import { EmptyWork } from './shared'
import { atlasLibraryPage, atlasLibraryRows, type AtlasLibraryOrder, type AtlasLibraryStatus } from './atlas-library'
import { atlasPortraitImage } from './atlas-portrait'

type Props = { kind: StoryAtlasEntity['kind']; snapshot: StoryAtlasSnapshot; selectedId?: string | null; viewScope?: string; onSelect: (entity: StoryAtlasEntity) => void; onGenerate: () => void }
type LibraryView = { keyword: string; regionId?: string; paging: { page: number; selection?: string | null }; pageSize: number; status: AtlasLibraryStatus; order: AtlasLibraryOrder; scrollTop: number }
// Session-only view preferences. Canon, selection and chapter scope continue to come from the current snapshot and URL.
const libraryViews = new Map<string, LibraryView>()
function rememberLibraryView(key: string, value: LibraryView) {
  libraryViews.delete(key); libraryViews.set(key, value)
  if (libraryViews.size > 48) libraryViews.delete(libraryViews.keys().next().value!)
}
export function AtlasEntityLibrary(props: Props) {
  return <AtlasEntityLibraryContent key={`${props.snapshot.novelId}:${props.kind}:${props.snapshot.atChapter}:${props.viewScope || ''}`} {...props} />
}
function AtlasEntityLibraryContent({ kind, snapshot, selectedId, viewScope, onSelect, onGenerate }: Props) {
  const viewKey = `${snapshot.novelId}:${kind}:${snapshot.atChapter}:${viewScope || ''}`
  const [initial] = useState(() => libraryViews.get(viewKey))
  const scroller = useRef<HTMLElement>(null)
  const [keyword, setKeyword] = useState(initial?.keyword || '')
  const [regionId, setRegionId] = useState<string | undefined>(initial?.regionId)
  const [paging, setPaging] = useState<{ page: number; selection?: string | null }>(initial?.paging || { page: 1 })
  const [pageSize, setPageSize] = useState(initial?.pageSize || 12)
  const [status, setStatus] = useState<AtlasLibraryStatus>(initial?.status || 'all')
  const [order, setOrder] = useState<AtlasLibraryOrder>(initial?.order || 'planned')
  useLayoutEffect(() => { if (scroller.current) scroller.current.scrollTop = initial?.scrollTop || 0 }, [initial])
  useEffect(() => { rememberLibraryView(viewKey, { keyword, regionId, paging, pageSize, status, order, scrollTop: scroller.current?.scrollTop || 0 }) }, [viewKey, keyword, regionId, paging, pageSize, status, order])
  const activeRegionId = atlasLocationScope(snapshot, regionId)
  const rows = useMemo(() => atlasLibraryRows(snapshot, { kind, keyword, regionId: activeRegionId, status, order }), [snapshot, kind, keyword, activeRegionId, status, order])
  const selectedIndex = rows.findIndex(entity => entity.id === selectedId)
  const requestedPage = paging.selection === selectedId ? paging.page : selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) + 1 : 1
  const visible = atlasLibraryPage(rows, requestedPage, pageSize)
  const setPage = (page: number) => setPaging({ page, selection: selectedId })
  const total = snapshot.entities.filter(entity => entity.kind === kind).length
  const planned = snapshot.entities.filter(entity => entity.kind === kind && entity.status === 'planned').length
  return <section ref={scroller} className="atlas-library" aria-label={`${ATLAS_KIND_LABELS[kind]}列表`} onScroll={event => rememberLibraryView(viewKey, { keyword, regionId, paging, pageSize, status, order, scrollTop: event.currentTarget.scrollTop })}>
    <div className="atlas-library-tools"><Input.Search aria-label={`查找${ATLAS_KIND_LABELS[kind]}`} placeholder={`查找${ATLAS_KIND_LABELS[kind]}`} value={keyword} onChange={event => { setKeyword(event.target.value); setPage(1) }} allowClear />{['character', 'faction'].includes(kind) && <Select aria-label="按关联地域筛选" value={activeRegionId ?? undefined} placeholder="所有关联地域" allowClear onChange={value => { setRegionId(value); setPage(1) }} showSearch optionFilterProp="label" options={snapshot.entities.filter(item => item.kind === 'location').map(item => ({ value: item.id, label: locationPath(snapshot.entities, item.id).map(parent => parent.name).join(' / ') }))} />}<div className="atlas-library-filters"><Select aria-label="资料状态" value={status} onChange={value => { setStatus(value); setPage(1) }} options={[{ value: 'all', label: '全部状态' }, { value: 'planned', label: '计划设定' }, { value: 'confirmed', label: '已记录' }]} /><Select aria-label="资料排序" value={order} onChange={value => { setOrder(value); setPage(1) }} options={[{ value: 'planned', label: '计划优先' }, { value: 'name', label: '按名称' }, { value: 'chapter', label: '章位由近到远' }]} /></div></div>
    <div className="atlas-library-count"><span aria-live="polite">{rows.length === total ? `共 ${total}` : `筛选 ${rows.length} / ${total}`} 条{ATLAS_KIND_LABELS[kind]} · 计划 {planned}</span><Button size="small" onClick={onGenerate}>补充{kind === 'faction' ? '组织' : ATLAS_KIND_LABELS[kind]}</Button></div>
    {rows.length ? <div className="atlas-library-list">{visible.rows.map(entity => <button type="button" className={selectedId === entity.id ? 'is-selected' : ''} aria-pressed={selectedId === entity.id} onClick={() => onSelect(entity)} key={entity.id}>{kind === 'character' && atlasPortraitImage(entity.attributes.portraitImage) && <img className="atlas-library-portrait" src={atlasPortraitImage(entity.attributes.portraitImage)} alt="" />}<span>{entity.status === 'planned' ? '计划设定' : '已记录'} · {entity.effectiveFromChapter ? `第 ${entity.effectiveFromChapter} 章起` : '初始设定'}</span><strong>{entity.name}</strong>{atlasEntitySummary(entity) && <p>{atlasEntitySummary(entity)}</p>}</button>)}</div> : <EmptyWork title="没有匹配的资料" action={onGenerate} />}
    {rows.length > 0 && <nav className="atlas-library-pagination" aria-label={`${ATLAS_KIND_LABELS[kind]}分页`}><Pagination size="small" current={visible.current} pageSize={pageSize} total={visible.total} showSizeChanger pageSizeOptions={[12, 24, 48]} onChange={(next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size) }} showTotal={(count, range) => `${range[0]}–${range[1]} / ${count}`} /></nav>}
  </section>
}
