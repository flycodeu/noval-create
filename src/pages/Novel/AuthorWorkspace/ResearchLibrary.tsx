import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Pagination, Spin } from 'antd'
import type { CreativeResearchSource } from '../../../shared/creative-research'
import { useNovelStore } from '../../../stores/novel.store'
import './research-library.css'

export default function ResearchLibrary({ novelId, disabled }: { novelId: number; disabled?: boolean }) {
  const [sources, setSources] = useState<CreativeResearchSource[]>([])
  const [request, setRequest] = useState('')
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const epoch = useRef(0)
  const busy = useRef(false)
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const refresh = useCallback(async () => {
    if (busy.current) return
    const current = ++epoch.current
    setLoading(true)
    try {
      const rows = await window.electron.sourceSearch.listResearch(novelId)
      if (current === epoch.current) { setSources(rows); setError(''); setPage(1) }
    } catch (cause) {
      if (current === epoch.current) setError(cause instanceof Error ? cause.message : '读取创作资料失败')
    } finally { if (current === epoch.current) setLoading(false) }
  }, [novelId])
  useEffect(() => {
    busy.current = false
    setSources([]); setRequest(''); setDiagnostics([]); setSearching(false)
    void refresh()
    return () => { epoch.current += 1 }
  }, [refresh])
  useEffect(() => {
    const completed = () => { void refresh() }
    window.addEventListener('novelforge:creative-completed', completed)
    return () => window.removeEventListener('novelforge:creative-completed', completed)
  }, [refresh])
  const search = async () => {
    if (!request.trim() || searching || disabled) return
    const current = ++epoch.current
    busy.current = true
    setSearching(true); setLoading(false); setError(''); setDiagnostics([])
    try {
      const result = await window.electron.sourceSearch.research(novelId, request.trim())
      if (current !== epoch.current) return
      setDiagnostics(result.diagnostics)
      const [rows, novel] = await Promise.all([
        window.electron.sourceSearch.listResearch(novelId), window.electron.novel.get(novelId),
      ])
      if (current !== epoch.current) return
      setSources(rows); setPage(1)
      if (novel) setNovel(novel)
    } catch (cause) {
      if (current === epoch.current) setError(cause instanceof Error ? cause.message : '检索资料失败')
    } finally { if (current === epoch.current) { busy.current = false; setSearching(false) } }
  }
  return <section className="author-paper research-library" aria-label="联网参考">
    <div className="author-section-heading"><h2>联网参考</h2><small>{sources.length} 条来源</small></div>
    <div className="research-library__search">
      <Input aria-label="需要查找的创作资料" placeholder="例如：查找适合本书的道教观念、行旅服饰与民间生活资料" value={request} maxLength={2000} disabled={disabled || searching} onChange={event => setRequest(event.target.value)} onPressEnter={() => void search()} />
      <Button onClick={() => void search()} loading={searching} disabled={disabled || !request.trim()}>搜索并保存参考</Button>
    </div>
    {error && <p className="author-error" role="alert">{error} <Button type="link" onClick={() => void refresh()}>重新读取</Button></p>}
    {diagnostics.length > 0 && <p className="author-muted" role="status">{diagnostics.join('；')}</p>}
    {loading ? <Spin /> : <div className="research-library__sources">{sources.slice((page - 1) * 5, page * 5).map(source => <article key={source.sourceKey}>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
      <small>{[source.topics.join(' · '), `检索于 ${source.recordedAt.slice(0, 10)}`,
        source.excerptKind === 'source_metadata' ? '仅来源链接，未返回网页摘要' : '来源摘要待核实'].filter(Boolean).join(' · ')}</small>
      {source.excerptKind !== 'source_metadata' && <p>{source.excerpt}</p>}
      <details><summary>检索问题与来源</summary><p>{source.query}</p><a href={source.url} target="_blank" rel="noreferrer">{source.url}</a></details>
    </article>)}</div>}
    {sources.length > 5 && <Pagination size="small" current={page} pageSize={5} total={sources.length} showSizeChanger={false} onChange={setPage} />}
  </section>
}
