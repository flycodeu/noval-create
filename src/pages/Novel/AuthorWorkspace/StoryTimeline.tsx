import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Drawer, Input, Pagination, Select, Spin } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Chapter, Novel } from '../../../types'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { ContentDocument } from './ContentDocument'
import { buildStoryTimelineEntries, chapterWritingLabel, STORY_TIMELINE_STATES, storyTimelineClock, storyTimelineGroups, storyTimelineMatchesSearch, timelineEntityRoute, type StoryTimelineEntry, type StoryTimelineState } from './story-timeline'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import './story-timeline.css'

const DETAILS = [{ key: 'eventCause', title: '前因' }, { key: 'eventProcess', title: '经过' }, { key: 'eventResult', title: '结果' }]
const PAGE_SIZE = 12

export default function StoryTimeline({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const mode = params.get('view') === 'time' ? 'time' : 'chapter'
  const status = (Object.keys(STORY_TIMELINE_STATES).includes(params.get('status') || '') ? params.get('status') : 'all') as StoryTimelineState | 'all'
  const chapterFilter = params.has('chapter') && Number.isInteger(Number(params.get('chapter'))) && Number(params.get('chapter')) >= 0 ? Number(params.get('chapter')) : null
  const keyword = params.get('q') || ''
  const requestedEventId = params.get('event') || ''
  const [snapshot, setSnapshot] = useState<StoryAtlasSnapshot | null>(null)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [novel, setNovel] = useState<Novel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [taskTarget, setTaskTarget] = useState<ObjectTaskTarget | null>(null)
  const [paging, setPaging] = useState({ scope: '', selection: '', page: 1 })
  const epoch = useRef(0)
  const eventListRef = useRef<HTMLDivElement | null>(null)
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
  const filtered = entries.filter(entry => (status === 'all' || entry.state === status) && (chapterFilter == null || entry.chapterNum === chapterFilter) && storyTimelineMatchesSearch(entry, keyword))
  const groups = storyTimelineGroups(filtered, chapterFilter == null ? chapters : chapters.filter(chapter => chapter.chapterNum === chapterFilter), mode, status === 'all' && !keyword.trim())
  // A stable-ID deep link remains readable even if a saved filter hides its row.
  const selected = entries.find(entry => entry.entity.id === requestedEventId)
  const selectedGroup = groups.find(group => group.entries.some(entry => entry.entity.id === selected?.entity.id))
  const group = selectedGroup || groups.find(item => item.key === params.get('group')) || groups[0]
  const scope = JSON.stringify([novelId, mode, group?.key, status, chapterFilter, keyword])
  const selectedIndex = group?.entries.findIndex(entry => entry.entity.id === requestedEventId) ?? -1
  const requestedPage = paging.scope === scope && paging.selection === requestedEventId ? paging.page : selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) + 1 : 1
  const page = Math.min(Math.max(1, requestedPage), Math.max(1, Math.ceil((group?.entries.length || 0) / PAGE_SIZE)))
  const visible = group?.entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) || []
  useEffect(() => { eventListRef.current?.scrollTo({ top: 0 }) }, [scope, page])
  const open = (route: string) => navigate(buildWorkspaceRoute(novelId, route))
  const discuss = (entry?: StoryTimelineEntry) => setTaskTarget({ title: entry ? entry.entity.name : '小说时间设计', stage: entry ? 'events' : 'world_rules', ...(entry?.recordedChapterNum != null ? { atChapter: entry.recordedChapterNum } : {}), request: entry
    ? `结合现有正文检查事件“${entry.entity.name}”（${entry.entity.id}）的发生时间、章节锚点、因果顺序、参与人物和地点。${entry.planningKind ? '此条是作者规划；资料关联章位是规划登记或可见锚点，不代表事件在该章发生，不把整卷或单元规划塞入该章。' : ''}区分已经写定与计划；仅在有依据时细化日期。只有先后证据时使用chronologyOrder表达项目内事件先后，不猜日期，也不把列表sortOrder当时间证据；保留原有事实和正文。`
    : '结合已有正文和世界设定梳理小说时间：朝代、纪年、开篇时间、当前故事时间及对应已写章序。使用 worldRules.timelineConfig 的 dynastyName、storyStartLabel、currentTimeLabel、currentTimeChapterNum、currentTimeEvidence 保存；当前时间必须有原文或作者设定依据，不能取历史事件时间、电脑日期或数据库记录时间。时间不足先输出候选和缺口，不改正文。' })
  const selectGroup = (key: string) => { const next = new URLSearchParams(params); next.set('group', key); next.delete('event'); setParams(next) }
  const selectEvent = (entry: StoryTimelineEntry) => { const next = new URLSearchParams(params); next.set('event', entry.entity.id); if (group) next.set('group', group.key); setParams(next) }
  const closeDetail = () => {
    setPaging({ scope, selection: '', page })
    const next = new URLSearchParams(params)
    next.delete('event')
    if (group) next.set('group', group.key)
    setParams(next)
  }
  const names = Object.fromEntries(snapshot?.entities.map(entity => [entity.id, entity.name]) || [])
  const eventCard = (entry: StoryTimelineEntry, index: number) => <button type="button" className={`story-timeline-event${selected?.entity.id === entry.entity.id ? ' is-selected' : ''}`} key={entry.entity.id} aria-label={`查看事件：${entry.entity.name}`} aria-pressed={selected?.entity.id === entry.entity.id} onClick={() => selectEvent(entry)}>
    <span className="story-timeline-event__index">{String((page - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}</span>
    <span className="story-timeline-event__main"><strong>{entry.entity.name}</strong><span className="story-timeline-event__time" title={entry.timeLabel}>{entry.plannedVolume ? `第 ${entry.plannedVolume} 卷 · ` : ''}{entry.timeLabel || '故事时间待确定'}</span>{entry.entity.summary && <span className="story-timeline-event__summary">{entry.entity.summary}</span>}</span>
    <span className={`story-timeline-state story-timeline-state--${entry.state}`}>{entry.planningKind ? '作者规划' : STORY_TIMELINE_STATES[entry.state]}</span><ArrowRightOutlined />
  </button>
  return <AuthorPage title="时间轴"><div className="story-timeline-workspace">
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {!snapshot && loading ? <div className="author-loading"><Spin /></div> : !snapshot ? <EmptyWork title="时间轴暂未读到" /> : <>
      <section className="story-timeline-overview" aria-label="小说时间与进度">
        <div><span>正文进度</span><strong>{clock.latest ? `已写至第 ${clock.latest.chapterNum} 章` : '尚未开始正文'}</strong><small>{clock.written.length} 章已有正文 · {chapters.length} 章已安排</small></div>
        <div><span>当前故事时间</span><strong>{clock.current || (clock.needsAlignment ? '时间待对齐' : '尚未确定')}</strong><small>{clock.dynasty || clock.epoch || clock.era || '时代未设定'}{clock.current ? ` · 截至第 ${clock.anchor} 章` : ''}</small></div>
        <div><span>事件档案</span><strong>{entries.length} 条</strong><small>{entries.filter(entry => entry.state === 'occurred').length} 已发生 · {entries.filter(entry => entry.state === 'planned').length} 计划 · {entries.filter(entry => entry.state === 'unplaced').length} 待定位</small></div>
        <Button onClick={() => discuss()}>完善时间设计</Button>
      </section>
      <details className="story-timeline-clock"><summary>历法、起点与时间依据</summary><div><span>朝代：{clock.dynasty || clock.epoch || '尚未设定'}{clock.era ? ` · ${clock.era}` : ''}</span><span>开篇：{clock.start || '尚未设定'}</span>{clock.needsAlignment && <span>最后记录：{clock.recorded}{clock.anchor != null ? `（第 ${clock.anchor} 章）` : ''}，待与最新正文对齐。</span>}{!clock.current && !clock.needsAlignment && <span>尚未记录最新正文对应的故事时间。</span>}{clock.evidence && <p>{clock.evidence}</p>}{clock.latest && <Button type="link" onClick={() => open(`writing/editor?chapterId=${clock.latest!.id}`)}>打开最新正文 <ArrowRightOutlined /></Button>}</div></details>
      <div className="story-timeline-toolbar">
        <nav aria-label="时间轴视图">{[{ key: 'chapter', label: '按章节' }, { key: 'time', label: '按故事时间' }].map(item => <button type="button" key={item.key} aria-pressed={mode === item.key} onClick={() => updateParams('view', item.key)}>{item.label}</button>)}</nav>
        <Select aria-label="事件进度" value={status} onChange={value => updateParams('status', value === 'all' ? '' : value)} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(STORY_TIMELINE_STATES).map(([value, label]) => ({ value, label: `${label} · ${entries.filter(entry => entry.state === value).length}` }))]} />
        <Select<number | 'all'> aria-label="关联章节" value={chapterFilter ?? 'all'} onChange={value => updateParams('chapter', value === 'all' ? '' : String(value))} options={[{ value: 'all', label: '全部正文章节' }, { value: 0, label: '背景事件' }, ...chapters.map(chapter => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章` }))]} />
        <Input.Search aria-label="搜索时间轴" placeholder="事件、人物、地点或内容" allowClear value={keyword} onChange={event => updateParams('q', event.target.value)} />{loading && <Spin size="small" />}
      </div>
      <div className="story-timeline-layout">
        <Select className="story-timeline-mobile-index" aria-label="选择时间轴分组" value={group?.key} onChange={selectGroup} options={groups.map(item => ({ value: item.key, label: `${item.title} · ${item.entries.length} 条` }))} />
        <nav className="story-timeline-index" aria-label="时间轴目录">{[false, true].map(planning => {
          const rows = groups.filter(item => Boolean(item.planning) === planning)
          return rows.length > 0 && <section key={String(planning)}><h2>{planning ? '作者规划' : mode === 'chapter' ? '正文与章节' : '已登记故事时间'}</h2>{rows.map(item => <button type="button" key={item.key} className={group?.key === item.key ? 'is-selected' : ''} aria-current={group?.key === item.key ? 'true' : undefined} onClick={() => selectGroup(item.key)}><span><strong>{item.title}</strong>{item.chapter && <small>{chapterWritingLabel(item.chapter)}</small>}</span><em>{item.entries.length}</em></button>)}</section>
        })}{!groups.length && <EmptyWork title="没有匹配的分组" />}</nav>
        <section className="story-timeline-track" aria-label={mode === 'chapter' ? '章节事件' : '故事时间事件'}>
          {group ? <><header className="story-timeline-group__heading"><div><span className="author-eyebrow">{group.planning ? '作者规划 · 不代表已发生正文' : group.chapter ? chapterWritingLabel(group.chapter) : '以已保存依据为准'}</span><h2>{group.title}</h2></div><span>{group.entries.length} 条事件</span>{group.chapter && <Button onClick={() => open(`writing/editor?chapterId=${group.chapter!.id}&panel=arrangement`)}>章节安排</Button>}</header>
            <div ref={eventListRef} className="story-timeline-event-list">{visible.length ? visible.map(eventCard) : <EmptyWork title={group.chapter && !group.chapter.wordCount ? '本章待写，尚未登记发生事件' : '尚未登记本组事件'} />}</div>
            {group.entries.length > PAGE_SIZE && <nav className="story-timeline-pagination" aria-label="时间轴事件分页"><Pagination size="small" current={page} pageSize={PAGE_SIZE} total={group.entries.length} showSizeChanger={false} showTotal={(total, range) => `${range[0]}–${range[1]} / ${total}`} onChange={next => setPaging({ scope, selection: requestedEventId, page: next })} /></nav>}
          </> : <EmptyWork title={entries.length ? '没有符合条件的事件' : '尚未登记事件'} />}
          {requestedEventId && !selected && !loading && <p className="story-timeline-missing" role="status">所选事件已不可用。<Button type="link" onClick={closeDetail}>关闭失效定位</Button></p>}
        </section>
      </div>
      <Drawer className="story-timeline-detail-drawer" title="事件详情" width={720} open={Boolean(selected)} destroyOnClose onClose={closeDetail}>{selected && <article className="story-timeline-detail" aria-label="事件详情">
        <header><span className={`story-timeline-state story-timeline-state--${selected.state}`}>{selected.planningKind ? '作者规划' : STORY_TIMELINE_STATES[selected.state]}</span><h2>{selected.entity.name}</h2></header>
        <dl><div><dt>故事时间</dt><dd>{selected.timeLabel || '尚未确定'}{selected.precision ? ` · ${selected.precision}` : ''}</dd></div><div><dt>{selected.planningKind ? '正文发生章' : '关联章节'}</dt><dd>{selected.chapterNum == null ? '尚未定位' : selected.chapterNum === 0 ? '背景事件' : `第 ${selected.chapterNum} 章`}</dd></div>{selected.plannedVolume && <div><dt>规划卷次</dt><dd>第 {selected.plannedVolume} 卷</dd></div>}{selected.planningKind && selected.recordedChapterNum != null && <div><dt>资料关联章位</dt><dd>第 {selected.recordedChapterNum} 章 · 规划登记或可见锚点，不是发生章</dd></div>}</dl>
        {selected.entity.summary && <p className="author-prose">{selected.entity.summary}</p>}
        {DETAILS.map(field => typeof selected.entity.attributes[field.key] === 'string' && String(selected.entity.attributes[field.key]).trim() ? <section key={field.key}><h3>{field.title}</h3><p className="author-prose">{String(selected.entity.attributes[field.key])}</p></section> : null)}
        {selected.links.length > 0 && <section><h3>人物与地点</h3><div className="story-timeline-related">{selected.links.map(link => <button type="button" key={link.entity.id} onClick={() => open(timelineEntityRoute(link.entity))}><strong>{link.entity.name}</strong><small>{link.planned ? '计划关联' : link.label}</small><ArrowRightOutlined /></button>)}</div></section>}
        <details className="story-timeline-all-fields"><summary>更多已保存资料</summary><ContentDocument value={selected.entity.attributes} names={names} /></details>
        <footer className="story-timeline-detail__actions"><Button onClick={() => open(timelineEntityRoute(selected.entity))}>完整档案</Button><Button onClick={() => discuss(selected)}>讨论本事件</Button></footer>
      </article>}</Drawer>
    </>}
    <ObjectTaskPanel novelId={novelId} target={taskTarget} onClose={() => setTaskTarget(null)} onApplied={() => void load()} />
  </div></AuthorPage>
}
