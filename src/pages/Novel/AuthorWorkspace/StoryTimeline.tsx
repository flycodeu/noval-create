import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Spin } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Chapter, Novel } from '../../../types'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { buildStoryTimelineEntries, chapterWritingLabel, STORY_TIMELINE_STATES, storyTimelineClock, storyTimelineGroups, timelineEntityRoute, type StoryTimelineEntry, type StoryTimelineState } from './story-timeline'
import './story-timeline.css'

const DETAILS = [{ key: 'eventCause', title: '前因' }, { key: 'eventProcess', title: '经过' }, { key: 'eventResult', title: '结果' }]

export default function StoryTimeline({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const mode = params.get('view') === 'time' ? 'time' : 'chapter'
  const status = (Object.keys(STORY_TIMELINE_STATES).includes(params.get('status') || '') ? params.get('status') : 'all') as StoryTimelineState | 'all'
  const chapterFilter = params.has('chapter') && Number.isInteger(Number(params.get('chapter'))) ? Number(params.get('chapter')) : null
  const keyword = params.get('q') || ''
  const [snapshot, setSnapshot] = useState<StoryAtlasSnapshot | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [novel, setNovel] = useState<Novel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const detailRef = useRef<HTMLElement | null>(null)
  const load = useCallback(async () => {
    const token = ++epoch.current
    setLoading(true)
    try {
      const [atlas, rows, project] = await Promise.all([
        window.electron.storyAtlas.query({ novelId, includePlanned: true }), window.electron.chapter.list(novelId), window.electron.novel.get(novelId),
      ])
      if (token === epoch.current) { setSnapshot(atlas); setChapters(rows); setNovel(project); setError('') }
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取时间轴失败') }
    finally { if (token === epoch.current) setLoading(false) }
  }, [novelId])
  useEffect(() => { void load(); return () => { epoch.current += 1 } }, [load])
  useEffect(() => {
    const refresh = () => { void load() }
    window.addEventListener('novelforge:creative-completed', refresh); window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('novelforge:creative-completed', refresh); window.removeEventListener('focus', refresh) }
  }, [load])
  const updateParams = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); setParams(next, { replace: key === 'q' }) }
  const clock = storyTimelineClock(novel?.worldRulesJson, chapters)
  const entries = snapshot ? buildStoryTimelineEntries(snapshot, chapters) : []
  const filtered = entries.filter(entry => (status === 'all' || entry.state === status)
    && (chapterFilter == null || entry.chapterNum === chapterFilter)
    && `${entry.entity.name} ${entry.entity.summary} ${entry.timeLabel} ${entry.links.map(link => link.entity.name).join(' ')}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
  const groups = storyTimelineGroups(filtered, chapterFilter == null ? chapters : chapters.filter(chapter => chapter.chapterNum === chapterFilter), mode, status === 'all' && !keyword.trim())
  const selected = filtered.find(entry => entry.entity.id === params.get('event')) || groups.find(group => group.entries.length)?.entries[0]
  const open = (route: string) => navigate(buildWorkspaceRoute(novelId, route))
  const discuss = (entry?: StoryTimelineEntry) => open(`guide?${new URLSearchParams({ stage: entry ? 'events' : 'world_rules', autoApply: 'false', request: entry
    ? `结合现有正文检查事件“${entry.entity.name}”（${entry.entity.id}）的发生时间、章节锚点、因果顺序、参与人物和地点。区分已经写定与计划；仅在有依据时细化日期。只有先后证据时使用chronologyOrder表达项目内事件先后，不猜日期，也不把列表sortOrder当时间证据；保留原有事实和正文。`
    : '结合已有正文和世界设定梳理小说时间：朝代、纪年、开篇时间、当前故事时间及对应已写章序。使用 worldRules.timelineConfig 的 dynastyName、storyStartLabel、currentTimeLabel、currentTimeChapterNum、currentTimeEvidence 保存；当前时间必须有原文或作者设定依据，不能取历史事件时间、电脑日期或数据库记录时间。时间不足先输出候选和缺口，不改正文。' })}`)
  const selectEvent = (entry: StoryTimelineEntry) => {
    updateParams('event', entry.entity.id)
    if (window.matchMedia('(max-width: 1120px)').matches) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }
  const eventCard = (entry: StoryTimelineEntry) => <button type="button" className={`story-timeline-event${selected?.entity.id === entry.entity.id ? ' is-selected' : ''}`} key={entry.entity.id} aria-pressed={selected?.entity.id === entry.entity.id} onClick={() => selectEvent(entry)}>
    <span className={`story-timeline-state story-timeline-state--${entry.state}`}>{STORY_TIMELINE_STATES[entry.state]}</span>
    <strong>{entry.entity.name}</strong>
    {entry.timeLabel && <time>{entry.timeLabel}{entry.precision ? ` · ${entry.precision}` : ''}</time>}
    {entry.entity.summary && <span className="story-timeline-event__summary">{entry.entity.summary}</span>}
    {entry.links.length > 0 && <span className="story-timeline-event__links">{entry.links.slice(0, 4).map(link => link.entity.name).join(' · ')}{entry.links.length > 4 ? ` 等 ${entry.links.length} 项` : ''}</span>}
  </button>
  return <AuthorPage title="时间轴">
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {!snapshot && loading ? <div className="author-loading"><Spin /></div> : !snapshot ? <EmptyWork title="时间轴暂未读到" /> : <>
      <section className="story-timeline-overview" aria-label="小说时间与进度">
        <div><span>正文进度</span><strong>{clock.latest ? `已写至第 ${clock.latest.chapterNum} 章` : '尚未开始正文'}</strong><small>{clock.written.length} 章已有正文 · {chapters.length} 章已安排</small>{clock.latest && <Button type="link" onClick={() => open(`writing/editor?chapterId=${clock.latest!.id}`)}>{clock.latest.title || '打开最新正文'} <ArrowRightOutlined /></Button>}</div>
        <div><span>{clock.dynasty ? '朝代与纪年' : '时代与纪年'}</span><strong>{clock.dynasty || clock.epoch || clock.era || '尚未设定'}</strong>{clock.era && clock.era !== (clock.dynasty || clock.epoch) && <small>{clock.era}</small>}{clock.start && <small>起点：{clock.start}</small>}</div>
        <div><span>当前故事时间</span><strong>{clock.current || (clock.needsAlignment ? '时间待对齐' : '尚未确定')}</strong>{clock.current && <small>截至第 {clock.anchor} 章</small>}{clock.needsAlignment && <small>最后记录：{clock.recorded}{clock.anchor != null ? `（第 ${clock.anchor} 章）` : ''}</small>}{clock.current && clock.evidence && <details><summary>时间依据</summary><p>{clock.evidence}</p></details>}</div>
      </section>
      {!clock.current && <div className="story-timeline-gap">{clock.needsAlignment ? '当前时间记录尚缺最新正文的章位或时间依据。' : '尚未记录最新正文对应的故事时间。'}</div>}
      <div className="story-timeline-toolbar">
        <nav aria-label="时间轴视图">{[{ key: 'chapter', label: '按章节' }, { key: 'time', label: '按故事时间' }].map(item => <button type="button" key={item.key} aria-pressed={mode === item.key} onClick={() => updateParams('view', item.key)}>{item.label}</button>)}</nav>
        <Select aria-label="事件进度" value={status} onChange={value => updateParams('status', value === 'all' ? '' : value)} options={[{ value: 'all', label: '全部事件' }, ...Object.entries(STORY_TIMELINE_STATES).map(([value, label]) => ({ value, label: `${label} · ${entries.filter(entry => entry.state === value).length}` }))]} />
        <Select<number | 'all'> aria-label="关联章节" value={chapterFilter ?? 'all'} onChange={value => updateParams('chapter', value === 'all' ? '' : String(value))} options={[{ value: 'all', label: '全部章节' }, { value: 0, label: '背景事件' }, ...chapters.map(chapter => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章` }))]} />
        <Input.Search aria-label="搜索时间轴" placeholder="事件、人物或地点" allowClear value={keyword} onChange={event => updateParams('q', event.target.value)} />
        <Button onClick={() => discuss()}>完善时间设计</Button>
        {loading && <Spin size="small" />}
      </div>
      <div className={`story-timeline-layout${selected ? '' : ' story-timeline-layout--single'}`}>
        <section className="story-timeline-track" aria-label={mode === 'chapter' ? '章节事件' : '故事时间事件'}>{groups.length ? groups.map(group => <section className="story-timeline-group" key={group.key}><div className="story-timeline-group__heading"><h2>{group.title}</h2>{group.chapter && <><span>{chapterWritingLabel(group.chapter)}</span><Button type="link" size="small" onClick={() => open(`story-design?section=structure&chapterId=${group.chapter!.id}`)}>章节安排</Button></>}</div>{group.entries.length ? group.entries.map(eventCard) : <p className="story-timeline-empty">尚未登记本章事件</p>}</section>) : <EmptyWork title={entries.length ? '没有符合条件的事件' : '尚未登记事件'} />}</section>
        {selected && <aside ref={detailRef} className="story-timeline-detail" aria-label="事件详情"><div className="author-section-heading"><h2>{selected.entity.name}</h2><span className={`story-timeline-state story-timeline-state--${selected.state}`}>{STORY_TIMELINE_STATES[selected.state]}</span></div>
          <dl><div><dt>故事时间</dt><dd>{selected.timeLabel || '尚未确定'}</dd></div><div><dt>关联章节</dt><dd>{selected.chapterNum == null ? '待定位' : selected.chapterNum === 0 ? '背景事件' : `第 ${selected.chapterNum} 章`}</dd></div></dl>
          {selected.entity.summary && <p className="author-prose">{selected.entity.summary}</p>}
          {DETAILS.map(field => typeof selected.entity.attributes[field.key] === 'string' && String(selected.entity.attributes[field.key]).trim() ? <section key={field.key}><h3>{field.title}</h3><p className="author-prose">{String(selected.entity.attributes[field.key])}</p></section> : null)}
          {selected.links.length > 0 && <section><h3>人物与地点</h3><div className="story-timeline-related">{selected.links.map(link => <button type="button" key={link.entity.id} onClick={() => open(timelineEntityRoute(link.entity))}><strong>{link.entity.name}</strong><small>{link.planned ? '计划关联' : link.label}</small><ArrowRightOutlined /></button>)}</div></section>}
          <div className="story-timeline-detail__actions"><Button onClick={() => open(timelineEntityRoute(selected.entity))}>完整档案</Button><Button onClick={() => discuss(selected)}>讨论本事件</Button></div>
        </aside>}
      </div>
    </>}
  </AuthorPage>
}
