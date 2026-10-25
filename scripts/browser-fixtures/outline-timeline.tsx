import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import StoryTimeline from '../../src/pages/Novel/AuthorWorkspace/StoryTimeline'
import '../../src/styles/global.css'

const win = window as any
win.calls = []
const record = (service: string, novelId: number) => win.calls.push({ service, novelId })
const chapter = { id: 101, novelId: 1, chapterNum: 1, title: '已经写下的一章', outline: '未来大纲仍然保持规划属性。', content: '这是已经写下的正文。', wordCount: 12, status: 'draft', targetWords: 3000 }
const plan = { id: 'event:plan', kind: 'event', name: '卷级计划', summary: '这一卷的安排', parentId: null, status: 'planned', effectiveFromChapter: 7, source: { kind: 'test' }, attributes: { eventType: '卷级大纲规划', authorOnly: true, futureOnly: true, volumeId: 201, plannedVolume: 1, narrativeLine: 'ABC', timeLabel: '承宁二十四年三月上旬', calendarEra: '承宁', calendarYear: 24, calendarMonth: 3 } }
const event = { id: 'event:scene', kind: 'event', name: '已经发生的事件', summary: '原文有据', parentId: null, status: 'confirmed', effectiveFromChapter: 1, source: { kind: 'test' }, attributes: { chapterStartId: 101, eventType: '现场行动', relativeDay: 0, timeLabel: '开篇当日' } }
win.electron = {
  storyAtlas: { query: async ({ novelId }: { novelId: number }) => { record('atlas', novelId); return { novelId, contextVersion: 1, atChapter: null, entities: novelId === 1 ? [plan, event] : [], relations: [], locationChildren: [], diagnostics: [] } } },
  structure: { getTree: async (novelId: number) => { record('tree', novelId); return { novelId, volumes: [{ id: 201, novelId, volumeNumber: 1, title: '第一卷·旧灯', summary: '一卷安排', parts: [{ id: 301, partNumber: 1, title: '第一单元', chapters: [{ ...chapter, novelId, segments: [] }] }] }] } } },
  chapter: { list: async (novelId: number) => { record('chapters', novelId); return novelId === 1 ? [chapter] : [] } },
  novel: { get: async (novelId: number) => { record('novel', novelId); return { id: novelId, title: '隔离时间轴', worldRulesJson: '{}' } } },
}
function Fixture() {
  const [novelId, setNovelId] = useState(1)
  const navigate = useNavigate()
  useEffect(() => { win.go = (query: string, book = novelId) => { setNovelId(book); navigate(`/timeline${query ? `?${query}` : ''}`) } }, [navigate, novelId])
  return <div style={{ height: '100vh' }}><StoryTimeline novelId={novelId} /></div>
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/timeline']}><Fixture /></MemoryRouter>)
