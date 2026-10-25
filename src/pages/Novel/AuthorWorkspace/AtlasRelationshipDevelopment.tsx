import React from 'react'
import { Link } from 'react-router-dom'
import { recordOf } from './content-document'
import './atlas-relationship-development.css'

export function AtlasRelationshipDevelopment({ value, novelId, chapters }: { value: unknown; novelId: number; chapters: Array<{ id: number; chapterNum: number }> }) {
  if (!Array.isArray(value) || !value.length) return null
  return <section className="atlas-relationship-development" aria-label="关系发展规划">
    <header><h3>关系如何变化</h3><span>作者规划</span></header>
    <p>按拟写卷章查看双方的不同感受、转折原因和仍未解决的问题。</p>
    {value.map((raw, i) => {
      const track = recordOf(raw)
      const stages = (Array.isArray(track.changes) ? track.changes : []).map(recordOf).sort((a, b) => Number(a.volume || 0) - Number(b.volume || 0))
      return <article key={String(track.perspectiveId || i)}>
        <h4>{String(track.perspectiveName || '人物')}的视角 <small>→ {String(track.targetName || '对方')}</small></h4>
        {Boolean(track.initialState) && <p className="atlas-relationship-initial">起点：{String(track.initialState)}</p>}
        <ol>{stages.map((stage, index) => <li key={index}>
          <div className="atlas-relationship-chapters"><strong>第 {String(stage.volume)} 卷</strong>{(Array.isArray(stage.chapters) ? stage.chapters : []).map(number => {
            const chapter = chapters.find(item => item.chapterNum === Number(number))
            return chapter ? <Link key={chapter.id} to={`/novels/${novelId}/outline?chapterId=${chapter.id}`}>第 {chapter.chapterNum} 章</Link> : <span key={String(number)}>第 {String(number)} 章</span>
          })}</div>
          <p className="atlas-relationship-shift"><span>{String(stage.from || '')}</span><b aria-label="变化为">→</b><strong>{String(stage.to || '')}</strong></p>
          {Boolean(stage.cause) && <p><span className="atlas-relationship-label">转折原因</span>{String(stage.cause)}</p>}
          {Boolean(stage.unresolved) && <p><span className="atlas-relationship-label">仍未解决</span>{String(stage.unresolved)}</p>}
        </li>)}</ol>
      </article>
    })}
  </section>
}
