import React, { useMemo, useState } from 'react'
import { Button, Input, Pagination, Select } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { Chapter, StoryStructureTree } from '../../../types'
import { chapterDirectoryItems, CHAPTER_DIRECTORY_PAGE_SIZE } from './chapter-directory'

export default function ChapterDirectory({ chapters, tree, selectedId, onChoose, onCreate, onPlan }: {
  chapters: Chapter[]; tree: StoryStructureTree | null; selectedId: number | null
  onChoose: (id: number) => void; onCreate: () => void; onPlan: () => void
}) {
  const [query, setQuery] = useState('')
  const [pagination, setPagination] = useState({ scope: '', page: 1 })
  const [volumeId, setVolumeId] = useState<number | 'all'>('all')
  const selectedVolume = tree?.volumes.find(volume => volume.id === volumeId)
  const items = useMemo(() => chapterDirectoryItems(chapters, tree, query).filter(item => volumeId === 'all' || item.location?.volumeId === volumeId), [chapters, tree, query, volumeId])
  const pageCount = Math.max(1, Math.ceil(items.length / CHAPTER_DIRECTORY_PAGE_SIZE))
  const pageScope = JSON.stringify([selectedId, query, volumeId])
  const selectedIndex = items.findIndex(item => item.chapter.id === selectedId)
  // Opening a chapter from a link also reveals its position in a long directory.
  const currentPage = Math.min(pageCount, pagination.scope === pageScope ? pagination.page : Math.floor(Math.max(0, selectedIndex) / CHAPTER_DIRECTORY_PAGE_SIZE) + 1)
  const visible = items.slice((currentPage - 1) * CHAPTER_DIRECTORY_PAGE_SIZE, currentPage * CHAPTER_DIRECTORY_PAGE_SIZE)
  const groups = new Map<string, { title: string; summary?: string; parts: Map<string, { title: string; summary?: string; chapters: Chapter[] }> }>()
  // Future volumes and units can have useful arrangements before a first chapter exists.
  if (selectedVolume && !query.trim()) groups.set(String(selectedVolume.id), { title: `卷 ${selectedVolume.volumeNumber} · ${selectedVolume.title || '未命名'}`, summary: selectedVolume.summary, parts: new Map(selectedVolume.parts.map(part => [String(part.id), { title: part.title || `单元 ${part.partNumber}`, summary: part.summary, chapters: [] }])) })
  for (const { chapter, location } of visible) {
    const volumeKey = String(location?.volumeId || 'unassigned')
    if (!groups.has(volumeKey)) groups.set(volumeKey, { title: location?.volume || '尚未归入单元', summary: location?.volumeSummary, parts: new Map() })
    const group = groups.get(volumeKey)!
    const partKey = String(location?.partId || 'unassigned')
    if (!group.parts.has(partKey)) group.parts.set(partKey, { title: location?.part || '', summary: location?.partSummary, chapters: [] })
    group.parts.get(partKey)!.chapters.push(chapter)
  }
  return <nav className="manuscript-directory" aria-label="卷章目录">
    <div className="author-section-heading"><h2>卷章目录</h2><Button type="text" icon={<PlusOutlined />} aria-label="添加章节" onClick={onCreate} /></div>
    {Boolean(tree?.volumes.length) && <Select<number | 'all'> aria-label="卷章目录卷范围" value={selectedVolume ? selectedVolume.id : 'all'} onChange={setVolumeId} options={[{ value: 'all', label: '全部卷与章节' }, ...(tree?.volumes || []).map(volume => ({ value: volume.id, label: `卷 ${volume.volumeNumber} · ${volume.title || '未命名'}` }))]} />}
    <Input allowClear prefix={<SearchOutlined />} aria-label="搜索卷、单元或章节" placeholder="搜索卷、单元或章节" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="manuscript-directory__tree">
      {[...groups].map(([key, volume]) => <details open key={key} className="manuscript-directory__volume"><summary>{volume.title}</summary>
        {volume.summary && <details className="manuscript-directory__summary"><summary>本卷安排</summary><p>{volume.summary}</p></details>}
        {[...volume.parts].map(([partKey, part]) => <details open key={partKey} className="manuscript-directory__part"><summary>{part.title || '章节'}</summary>
          {part.summary && <details className="manuscript-directory__summary"><summary>单元安排</summary><p>{part.summary}</p></details>}
          {part.chapters.map(item => <button key={item.id} type="button" aria-current={item.id === selectedId ? 'page' : undefined} className={item.id === selectedId ? 'is-active' : ''} onClick={() => onChoose(item.id)}><small>第 {item.chapterNum} 章 · {item.wordCount > 0 ? `${item.wordCount.toLocaleString()} 字` : '待写'}</small><strong>{item.title || '未命名'}</strong></button>)}
        </details>)}
      </details>)}
      {!items.length && <p className="author-muted">{query ? '没有匹配的章节' : selectedVolume ? '本卷尚未安排章节' : '还没有章节'}</p>}
    </div>
    <div className="manuscript-directory__footer"><small>{query ? `找到 ${items.length} 章` : `共 ${chapters.length} 章`}</small>{items.length > CHAPTER_DIRECTORY_PAGE_SIZE && <Pagination size="small" simple current={currentPage} pageSize={CHAPTER_DIRECTORY_PAGE_SIZE} total={items.length} onChange={page => setPagination({ scope: pageScope, page })} showSizeChanger={false} />}<Button size="small" type="text" onClick={onPlan}>规划卷章</Button></div>
  </nav>
}
