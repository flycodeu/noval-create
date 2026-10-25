import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Pagination, Spin, Tabs } from 'antd'
import type { StoryAtlasEntity, StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { ATLAS_KIND_LABELS, atlasTabFor } from './atlas-profile'
import { LoadFailure } from './shared'
import ResearchLibrary from './ResearchLibrary'

export default function ManuscriptReferences({ novelId, chapterNum, onOpen }: { novelId: number; chapterNum: number; onOpen: (route: string) => void }) {
  return <ReferenceSnapshot key={`${novelId}:${chapterNum}`} novelId={novelId} chapterNum={chapterNum} onOpen={onOpen} />
}

function ReferenceSnapshot({ novelId, chapterNum, onOpen }: { novelId: number; chapterNum: number; onOpen: (route: string) => void }) {
  const [snapshot, setSnapshot] = useState<StoryAtlasSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const epoch = useRef(0)
  useEffect(() => {
    const current = ++epoch.current
    void window.electron.storyAtlas.query({ novelId, atChapter: chapterNum, boundary: 'start', includePlanned: false }).then(result => { if (epoch.current === current) { setSnapshot(result); setError('') } }).catch(cause => { if (epoch.current === current) setError(cause instanceof Error ? cause.message : '读取本章设定失败') })
    return () => { epoch.current += 1 }
  }, [novelId, chapterNum, refresh])
  const items = useMemo(() => snapshot?.entities.filter(item => ['character', 'location'].includes(item.kind) && `${item.name} ${ATLAS_KIND_LABELS[item.kind]}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || [], [snapshot, query])
  const selected = items.find(item => item.id === selectedId)
  const openEntity = (entity: StoryAtlasEntity) => onOpen(`narrative-board?${new URLSearchParams({ tab: atlasTabFor(entity), entity: entity.id, atChapter: String(chapterNum), includePlanned: 'false' })}`)
  return <Tabs defaultActiveKey="atlas" size="small" items={[
    { key: 'atlas', label: '人物与地点', children: <section className="manuscript-references" aria-label="本章人物与地点参考"><p className="author-muted">第 {chapterNum} 章起笔时的已保存设定，不包含计划。</p>
      {error && <LoadFailure message={error} retry={() => setRefresh(value => value + 1)} />}
      {!snapshot && !error ? <Spin /> : <><Input allowClear value={query} aria-label="查找本章人物或地点" placeholder="查找人物或地点" onChange={event => { setQuery(event.target.value); setPage(1) }} />
        <div className="manuscript-references__list">{items.slice((page - 1) * 12, page * 12).map(entity => <button key={entity.id} type="button" aria-pressed={selectedId === entity.id} onClick={() => setSelectedId(entity.id)}><strong>{entity.name}</strong><small>{ATLAS_KIND_LABELS[entity.kind]}</small></button>)}{!items.length && <p className="author-muted">当前章位没有匹配的已保存资料。</p>}</div>
        {items.length > 12 && <Pagination size="small" simple current={page} pageSize={12} total={items.length} onChange={setPage} />}
        {selected && <article className="manuscript-references__peek" aria-label={`${selected.name}参考摘要`}><h3>{selected.name}</h3><small>{ATLAS_KIND_LABELS[selected.kind]} · {selected.effectiveFromChapter ? `第 ${selected.effectiveFromChapter} 章起` : '初始设定'}</small><p>{selected.kind === 'character' ? typeof selected.attributes.publicSummary === 'string' && selected.attributes.publicSummary.trim() || '尚未整理正文已知简介。' : selected.summary || '尚未整理地点简介。'}</p><Button size="small" onClick={() => openEntity(selected)}>查看完整档案</Button></article>}
      </>}
    </section> },
    { key: 'research', label: '参考来源', children: <div className="manuscript-references__research"><ResearchLibrary novelId={novelId} disabled /><Button type="link" onClick={() => onOpen('narrative-board?tab=research')}>前往资料库检索</Button></div> },
  ]} />
}
