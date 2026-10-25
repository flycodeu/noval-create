import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Button, Input, Select, Spin } from 'antd'
import { ArrowRightOutlined, BookOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'
import { buildOutlineVolumes, OUTLINE_LINES, outlineChapterHasProse, outlineChapterMatches, outlineChapterRange, outlineLineLabel, outlineMatches, outlineTimelineGroups, type OutlineVolume } from './story-outline'
import './story-outline.css'

export default function StoryOutline({ novelId, timeline = false, atlasSnapshot }: { novelId: number; timeline?: boolean; atlasSnapshot?: StoryAtlasSnapshot }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const keyword = params.get('q') || ''
  const line = params.get('line') || 'all'
  const detailRef = useRef<HTMLElement>(null)
  const read = useCallback(async () => {
    const [tree, snapshot] = await Promise.all([window.electron.structure.getTree(novelId), atlasSnapshot ? Promise.resolve(atlasSnapshot) : window.electron.storyAtlas.query({ novelId, includePlanned: true })])
    return { tree, snapshot }
  }, [novelId, atlasSnapshot])
  const { data, loading, error, reload } = useAsyncSnapshot(read)
  useEffect(() => { if (atlasSnapshot) return; const refresh = () => { void reload() }; window.addEventListener('novelforge:creative-completed', refresh); window.addEventListener('focus', refresh); return () => { window.removeEventListener('novelforge:creative-completed', refresh); window.removeEventListener('focus', refresh) } }, [reload, atlasSnapshot])
  const rows = useMemo(() => data ? buildOutlineVolumes(data.tree, data.snapshot) : [], [data])
  const filtered = rows.filter(row => (line === 'all' || row.lines.includes(line as 'A' | 'B' | 'C')) && outlineMatches(row, keyword))
  const chapterId = Number(params.get('chapterId')) || null
  const selected = rows.find(row => row.chapters.some(chapter => chapter.id === chapterId))
    || rows.find(row => row.volume.id === Number(params.get('volume') || params.get('volumeId'))) || filtered[0]
  const groups = outlineTimelineGroups(filtered)
  const open = (route: string) => navigate(buildWorkspaceRoute(novelId, route))
  const change = (key: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(key, value); else next.delete(key); if (key === 'q' || key === 'line' || key === 'volume') { next.delete('chapterId'); next.delete('volumeId') }; if (key === 'q' || key === 'line') next.delete('volume'); setParams(next, { replace: key === 'q' }) }
  const select = (row: OutlineVolume) => { change('volume', String(row.volume.id)); requestAnimationFrame(() => detailRef.current?.scrollTo({ top: 0 })) }
  const totalChapters = rows.reduce((sum, row) => sum + row.chapters.length, 0)
  const totalWritten = rows.reduce((sum, row) => sum + row.written, 0)
  const selectedVolumeId = selected?.volume.id
  useEffect(() => {
    if (!chapterId || !selectedVolumeId) return
    const frame = requestAnimationFrame(() => document.getElementById(`outline-chapter-${chapterId}`)?.scrollIntoView({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [chapterId, selectedVolumeId, data])
  const switchView = (next: 'outline' | 'volumes' | 'events') => {
    const query = new URLSearchParams()
    if (selected && next !== 'events') query.set('volume', String(selected.volume.id))
    if (next === 'volumes') query.set('view', 'volumes')
    if (next === 'events') query.set('view', 'chapter')
    open(`${next === 'outline' ? 'outline' : 'timeline'}?${query}`)
  }
  const details = (row: OutlineVolume) => <>
    <header className="story-outline-detail-heading"><div><span className="author-eyebrow">卷级规划 · {outlineChapterRange(row)}</span><h2>{row.volume.title || `第 ${row.volume.volumeNumber} 卷`}</h2></div><Button size="small" onClick={() => open(`writing/editor?chapterId=${row.chapters[0]?.id || ''}&panel=arrangement`)} disabled={!row.chapters.length}>安排卷章 <ArrowRightOutlined /></Button></header>
    <div className="story-outline-meta"><span>{row.chapters.length} 章 · {row.written} 章已有正文</span>{row.lines.length > 0 && <span>{row.lines.join(' / ')} 线</span>}{row.region && <span>{row.region}</span>}</div>
    {row.calendar && <p className="story-outline-calendar"><ClockCircleOutlined /> <span>{row.calendar}</span></p>}
    {row.volume.summary && <section className="story-outline-section"><h3>这一卷讲什么</h3><p>{row.volume.summary}</p></section>}
    {[[row.conflict, '冲突与选择'], [row.emotion, '情绪与关系变化'], [row.consequence, '留下的结果与代价'], [row.pov, '叙事视角']].map(([value, title]) => value && <section className="story-outline-section" key={title}><h3>{title}</h3><p>{value}</p></section>)}
    {row.truths.length > 0 && <section className="story-outline-section"><h3>真相与误读</h3><ul>{row.truths.map((truth, index) => <li key={index}>{truth}</li>)}</ul></section>}
    {row.clues.length > 0 && <section className="story-outline-section"><h3>伏笔的埋设与回收</h3><ul className="story-outline-clues">{row.clues.map((clue, index) => <li key={`${clue.id}:${index}`}><span>{clue.action || '伏笔'}{clue.id && <small>{clue.id}</small>}</span><p>{clue.meaning}</p></li>)}</ul></section>}
    <section className="story-outline-chapters"><h3>逐章细纲 <span>{row.chapters.length} 章</span></h3>{row.volume.parts.map(part => {
      const matches = keyword.trim() ? part.chapters.filter(chapter => outlineChapterMatches(chapter, keyword)) : part.chapters
      return <section className="story-outline-part" key={part.id}><h4>{part.title || `第 ${part.partNumber} 部`}<span>{part.chapters.length} 章</span></h4>{part.chapters.map(chapter => <details id={`outline-chapter-${chapter.id}`} key={chapter.id} open={chapterId === chapter.id || keyword.trim() && matches.some(item => item.id === chapter.id) ? true : undefined} className={chapterId === chapter.id ? 'is-targeted' : ''}><summary><span className="story-outline-chapter-number">{chapter.chapterNum}</span><strong>{chapter.title || '未命名章节'}</strong><small>{outlineChapterHasProse(chapter) ? '已有正文' : chapter.outline?.trim() ? '待写 · 有细纲' : '待安排'}</small></summary><div><p>{chapter.outline?.trim() || '尚未保存本章细纲。'}</p><Button size="small" type="text" onClick={() => open(`writing/editor?chapterId=${chapter.id}&panel=arrangement`)}>打开本章安排 <ArrowRightOutlined /></Button></div></details>)}</section>
    })}</section>
  </>
  return <AuthorPage title={timeline ? '卷级时间线' : '故事大纲'}><div className={`story-outline-workspace${timeline ? ' story-outline-workspace--timeline' : ''}`}>
    <header className="story-outline-overview"><div><span className="author-eyebrow">{timeline ? '故事如何在时间里交织' : '从全书走进每一章'}</span><h2>{timeline ? '卷级时间线' : '故事大纲'}</h2></div><p><strong>{rows.length}</strong> 卷 <i>/</i> <strong>{totalChapters}</strong> 章<span>{totalWritten} 章已有正文，其余仍为创作安排</span></p><nav aria-label="大纲与时间视图"><button type="button" aria-pressed={!timeline} onClick={() => switchView('outline')}><BookOutlined /> 卷章大纲</button><button type="button" aria-pressed={timeline} onClick={() => switchView('volumes')}><ClockCircleOutlined /> 卷级时间线</button><button type="button" onClick={() => switchView('events')}>事件时间轴 <ArrowRightOutlined /></button></nav></header>
    <div className="story-outline-toolbar"><Input.Search aria-label="搜索大纲" placeholder="找卷章、人物、伏笔或地名" value={keyword} allowClear onChange={event => change('q', event.target.value)} /><Select aria-label="筛选叙事线" value={line} onChange={value => change('line', value === 'all' ? '' : value)} options={[{ value: 'all', label: '全部叙事线' }, ...OUTLINE_LINES.map(value => ({ value, label: `${outlineLineLabel(rows, value)} · ${rows.filter(row => row.lines.includes(value)).length} 卷` }))]} /><span>{filtered.length} / {rows.length} 卷</span>{loading && <Spin size="small" />}</div>
    {Boolean(error) && <LoadFailure message={error instanceof Error ? error.message : '读取大纲失败'} retry={() => void reload()} />}
    {!data ? loading ? <div className="author-loading"><Spin /></div> : <EmptyWork title="大纲暂未读到" /> : !rows.length ? <EmptyWork title="尚未安排卷章" action={() => open('writing/editor?panel=arrangement')} actionLabel="安排卷章" /> : timeline ? <>
      <p className="story-outline-timeline-note">按已保存的起始年月分组；跨月范围、回叙与同月先后见各卷时间说明。共线卷只展示一次；各列不表示人物即时会合。</p>
      <div className="story-outline-timeline-layout"><div className="story-outline-timeline-scroll"><div className="story-outline-lanes"><div className="story-outline-lane-head"><span>起始年月</span>{OUTLINE_LINES.map(value => <strong key={value} className={`outline-line-${value}`}>{outlineLineLabel(rows, value)}</strong>)}</div>{groups.map(group => <section className="story-outline-time-group" key={group.key}><h3>{group.title}</h3><div>{group.rows.map(row => {
        const single = row.lines.length === 1 ? OUTLINE_LINES.indexOf(row.lines[0]) : -1
        return <button type="button" key={row.volume.id} className={`story-outline-time-card ${single >= 0 ? `outline-line-${row.lines[0]}` : 'outline-line-shared'}${selected?.volume.id === row.volume.id ? ' is-selected' : ''}`} style={{ gridColumn: single >= 0 ? single + 1 : '1 / -1' }} aria-pressed={selected?.volume.id === row.volume.id} onClick={() => select(row)}><span>{outlineChapterRange(row)} <em>{row.lines.length ? `${row.lines.join(' / ')} 线` : '叙事线待定'}</em></span><strong>{row.volume.title || `第 ${row.volume.volumeNumber} 卷`}</strong><p>{row.calendar || '尚未登记故事时间'}</p>{row.region && <small>{row.region}</small>}</button>
      })}</div></section>)}</div>{!filtered.length && <EmptyWork title="没有符合条件的卷" />}</div><section className="story-outline-detail story-outline-time-detail" ref={detailRef} aria-label="时间线所选卷详情">{selected ? details(selected) : <EmptyWork title="选择一卷查看细纲" />}</section></div>
    </> : <div className="story-outline-layout"><nav className="story-outline-index" aria-label="大纲卷目录">{filtered.map(row => <button type="button" key={row.volume.id} className={selected?.volume.id === row.volume.id ? 'is-selected' : ''} aria-current={selected?.volume.id === row.volume.id ? 'true' : undefined} onClick={() => select(row)}><span className="story-outline-volume-number">{String(row.volume.volumeNumber).padStart(2, '0')}</span><span><strong>{row.volume.title || `第 ${row.volume.volumeNumber} 卷`}</strong><small>{outlineChapterRange(row)} · {row.chapters.length} 章</small>{row.lines.length > 0 && <em>{row.lines.join(' / ')} 线{row.region ? ` · ${row.region}` : ''}</em>}<i className="story-outline-progress" aria-label={`${row.written} 章已有正文`}><i style={{ width: `${row.chapters.length ? row.written / row.chapters.length * 100 : 0}%` }} /></i></span></button>)}{!filtered.length && <EmptyWork title="没有符合条件的卷" />}</nav><section className="story-outline-detail" ref={detailRef} aria-label="所选卷大纲">{selected ? details(selected) : <EmptyWork title="选择一卷查看细纲" />}</section></div>}
  </div></AuthorPage>
}
