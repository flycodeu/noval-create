import React, { useCallback, useEffect, useState } from 'react'
import { Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { Chapter } from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { callAuthorTool } from './workflow-client'
import { EmptyWork, LoadFailure } from './shared'

interface Fact {
  id: number; title: string; summary?: string; status: string; kind: string
  plannedRevealChapterNum?: number | null; plannedRevealVolume?: number | null; forbiddenBeforeVolume?: number | null
  readerKnownChapterId?: number | null; protagonistKnownChapterId?: number | null
  characterKnowledge?: Array<{ characterId: string; nativeId: number; knownChapterId: number | null; knownFromStart: boolean }>
}
export default function StoryFacts({ novelId, chapters }: { novelId: number; chapters: Chapter[] }) {
  const navigate = useNavigate()
  const [facts, setFacts] = useState<Fact[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const load = useCallback(() => Promise.all([callAuthorTool<{ facts: Fact[] }>('novelforge.assets.query', { novelId }), window.electron.storyAtlas.query({ novelId, includePlanned: true })]), [novelId])
  const install = useCallback(([result, atlas]: Awaited<ReturnType<typeof load>>) => {
    setFacts(result.facts || []); setNames(Object.fromEntries(atlas.entities.map(item => [item.id, item.name]))); setError('')
  }, [])
  const refresh = () => load().then(install).catch(cause => setError(cause instanceof Error ? cause.message : '读取信息点失败'))
  useEffect(() => { let alive = true; void load().then(result => { if (alive) install(result) }).catch(cause => { if (alive) setError(String(cause)) }); return () => { alive = false } }, [load, install])
  const chapterLabel = (id: number | null | undefined) => {
    if (!id) return '尚未揭示'
    const chapter = chapters.find(item => item.id === id)
    return chapter ? `第 ${chapter.chapterNum} 章${chapter.title ? ` · ${chapter.title}` : ''}` : '关联章节不可用'
  }
  return <section className="author-paper author-design-section"><div className="author-section-heading"><div><h2>秘密、信息点与知情边界</h2></div><Button onClick={() => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage: 'story', autoApply: 'false', request: '检查现有秘密、信息点与揭示安排。结合已写正文，保留已定事实，明确计划揭示章位和开书前已经知情的人物，避免提前泄密。' })}`))}>规划信息与揭示</Button></div>{error && <LoadFailure message={error} retry={() => void refresh()} />}
    {facts.length ? facts.map(fact => <article className="author-change-card" key={fact.id}><h3>{fact.title}</h3><p className="author-prose">{fact.summary || '尚未补充内容'}</p><dl className="author-document-fields"><div><dt>计划揭示</dt><dd>{fact.plannedRevealChapterNum ? `第 ${fact.plannedRevealChapterNum} 章` : fact.plannedRevealVolume ? `第 ${fact.plannedRevealVolume} 卷` : '尚未安排'}</dd></div>{fact.forbiddenBeforeVolume != null && <div><dt>揭示限制</dt><dd>第 {fact.forbiddenBeforeVolume} 卷之前不得揭示</dd></div>}<div><dt>读者已知</dt><dd>{chapterLabel(fact.readerKnownChapterId)}</dd></div><div><dt>主角已知</dt><dd>{chapterLabel(fact.protagonistKnownChapterId)}</dd></div><div><dt>人物知情</dt><dd>{fact.characterKnowledge?.length ? fact.characterKnowledge.map(item => <p key={item.characterId}>{names[item.characterId] || '关联人物不可用'} · {item.knownFromStart ? '开书前已知' : chapterLabel(item.knownChapterId)}</p>) : '尚无已记录的知情人物'}</dd></div></dl></article>) : <EmptyWork title="尚未记录信息点">需要逐步揭开的真相、秘密和人物认知可在这里规划，并随正文证据更新。</EmptyWork>}
  </section>
}
