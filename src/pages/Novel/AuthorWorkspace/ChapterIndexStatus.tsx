import React, { useEffect, useRef, useState } from 'react'
import { Button, Spin } from 'antd'

interface IndexStatus {
  novelId: number
  savedChapterCount: number
  keywordIndexedChapterCount: number
  vectorIndexedChapterCount: number
  queue: { pending: number; processing: number; failed: number; dead_letter: number }
  errors: Array<{ chapterId: number; message: string }>
}

export default function ChapterIndexStatus({ novelId }: { novelId: number }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [error, setError] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0)
  const mutation = useRef(false)
  const statusRef = useRef<IndexStatus | null>(null)
  const unsupported = useRef(false)
  const openRef = useRef(false)
  const readEpoch = useRef(0)
  const refreshRef = useRef<() => void>(() => undefined)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>()

  useEffect(() => {
    const current = ++epoch.current
    let stopped = false, reading = false, refreshRequested = false
    statusRef.current = null; unsupported.current = false; mutation.current = false
    setStatus(null); setError(''); setUnavailable(false); setBusy(false)
    const load = async () => {
      if (stopped || mutation.current || unsupported.current) return
      if (reading) { refreshRequested = true; return }
      clearTimeout(pollTimer.current); pollTimer.current = undefined
      reading = true
      const request = ++readEpoch.current
      try {
        const result = await window.electron.agentTools.call({ toolId: 'novelforge.chapters.index_status', input: { novelId } })
        if (stopped || current !== epoch.current || request !== readEpoch.current || mutation.current) return
        if (!result.ok) {
          if (result.error.code === 'TOOL_NOT_FOUND') { unsupported.current = true; setUnavailable(true); return }
          throw new Error(result.error.message)
        }
        const next = result.data as IndexStatus
        if (next.novelId !== novelId) return
        statusRef.current = next; setStatus(next); setError('')
      } catch (cause) { if (!stopped && current === epoch.current && request === readEpoch.current && !mutation.current) setError(cause instanceof Error ? cause.message : '读取旧章检索失败') }
      finally {
        reading = false
        if (!stopped && current === epoch.current && !mutation.current && !unsupported.current) {
          const reload = refreshRequested
          refreshRequested = false
          if (reload) void load()
          else if (openRef.current && statusRef.current && statusRef.current.queue.pending + statusRef.current.queue.processing + statusRef.current.queue.failed > 0) {
            clearTimeout(pollTimer.current)
            pollTimer.current = setTimeout(() => { void load() }, 5000)
          }
        }
      }
    }
    const reload = () => { void load() }
    refreshRef.current = reload
    void load()
    window.addEventListener('novelforge:creative-completed', reload)
    return () => { stopped = true; epoch.current += 1; readEpoch.current += 1; clearTimeout(pollTimer.current); refreshRef.current = () => undefined; window.removeEventListener('novelforge:creative-completed', reload) }
  }, [novelId])

  const rebuild = async (vectors: boolean) => {
    if (mutation.current || unavailable) return
    const current = epoch.current
    readEpoch.current += 1
    clearTimeout(pollTimer.current); pollTimer.current = undefined
    mutation.current = true; setBusy(true); setError('')
    try {
      const response = await window.electron.agentTools.call({ toolId: 'novelforge.chapters.index_rebuild', input: { novelId, vectors } })
      if (current !== epoch.current) return
      if (!response.ok) {
        if (response.error.code === 'TOOL_NOT_FOUND') { setUnavailable(true); unsupported.current = true; return }
        throw new Error(response.error.message)
      }
      const next = response.data as IndexStatus
      if (next.novelId === novelId) { statusRef.current = next; setStatus(next) }
    } catch (cause) { if (current === epoch.current) setError(cause instanceof Error ? cause.message : '补齐索引失败') }
    finally {
      if (current === epoch.current) {
        mutation.current = false; setBusy(false)
        refreshRef.current()
      }
    }
  }

  const queued = status ? status.queue.pending + status.queue.processing : 0
  const failures = status ? status.queue.failed + status.queue.dead_letter : 0
  return <details className="author-index-status" open={open} onToggle={event => {
    const next = event.currentTarget.open
    openRef.current = next; setOpen(next)
    if (next) refreshRef.current()
    else { clearTimeout(pollTimer.current); pollTimer.current = undefined }
  }}>
    <summary>旧章检索{unavailable ? ' · 更新后可用' : status ? ` · ${status.keywordIndexedChapterCount}/${status.savedChapterCount} 章可检索${queued ? ' · 索引处理中' : ''}` : ''}</summary>
    {open && <div aria-live="polite">
      {unavailable ? <p className="author-muted">更新后可用</p> : <>
        {!status && !error ? <Spin size="small" /> : status && <p className="author-muted">已保存 {status.savedChapterCount} 章 · 文字检索 {status.keywordIndexedChapterCount} 章 · 向量就绪 {status.vectorIndexedChapterCount} 章{queued > 0 ? ` · 处理中 ${queued} 章` : ''}{failures > 0 ? ` · 重试或失败 ${failures} 章` : ''}</p>}
        <div className="author-heading-actions" style={{ flexWrap: 'wrap', paddingTop: 0 }}>
          <Button size="small" loading={busy} disabled={busy || !status?.savedChapterCount} onClick={() => void rebuild(false)}>补齐文字索引</Button>
          <Button size="small" loading={busy} disabled={busy || !status?.savedChapterCount || queued > 0} onClick={() => void rebuild(true)} title="允许使用项目模型生成向量；不支持时使用本地模型">生成向量索引</Button>
        </div>
        {status?.errors[0] && <p className="author-muted">{status.errors[0].message}</p>}
        {error && <p role="alert">{error}</p>}
      </>}
    </div>}
  </details>
}
