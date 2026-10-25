import React, { useState } from 'react'
import { Button, Space } from 'antd'
import type { Novel } from '../../types'
import BookCover from './BookCover'
import CoverEditor from './CoverEditor'

export default function NovelBookHeading({ novel, chapterCount, onOpenChapters, onManageModels, onSaved }: {
  novel: Novel; chapterCount: number; onOpenChapters: () => void; onManageModels: () => void; onSaved?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const status = { draft: '构思中', writing: '连载中', completed: '已完结', archived: '已归档' }[novel.status]
  return <>
    <section className="novel-book-heading" aria-label="作品信息">
      <div className="novel-book-heading__cover"><BookCover title={novel.title} image={novel.coverImage} genre={novel.genreName} /></div>
      <div className="novel-book-heading__body">
        <div className="novel-book-heading__top">
          <div>
            <div className="novel-book-heading__meta"><span>{status}</span>{novel.genreName && <span>{novel.genreName}</span>}<span>{(novel.totalWords || 0).toLocaleString()} 字</span><span>{chapterCount} 章</span></div>
            <h2>{novel.title}</h2>
          </div>
          <Space wrap size={8}><Button size="small" onClick={onOpenChapters}>目录与正文</Button><Button type="text" size="small" onClick={() => setEditing(true)}>设置封面</Button></Space>
        </div>
        {novel.synopsis && <p className="novel-book-heading__synopsis">{novel.synopsis}</p>}
      </div>
    </section>
    {editing && <CoverEditor key={novel.id} novel={novel} onClose={() => setEditing(false)} onSaved={() => onSaved?.()} onManageModels={onManageModels} />}
  </>
}
