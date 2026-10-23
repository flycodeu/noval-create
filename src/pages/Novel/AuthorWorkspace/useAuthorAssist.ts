import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthorAssistKind, AuthorAssistRun } from '../../../shared/author-assist'
import { isAssistActive } from '../../../shared/author-assist'
import { callAuthorTool } from './workflow-client'

export function useAuthorAssist<T>(novelId: number, kind: AuthorAssistKind, chapterId?: number) {
  const [run, setRun] = useState<AuthorAssistRun | null>(null)
  const [runs, setRuns] = useState<AuthorAssistRun[]>([])
  const [loaded, setLoaded] = useState<{ id: string; content: T } | null>(null)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const selectedEpoch = useRef(0)
  useEffect(() => {
    alive.current = true
    let cancelled = false
    const epoch = selectedEpoch.current
    void callAuthorTool<{ runs: AuthorAssistRun[] }>('novelforge.assist.list', { novelId, kind, ...(chapterId ? { chapterId } : {}) })
      .then(data => { if (!cancelled && selectedEpoch.current === epoch) { setRuns(data.runs); setRun(data.runs[0] || null) } })
      .catch(cause => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true; alive.current = false }
  }, [novelId, kind, chapterId])
  const track = useCallback((next: AuthorAssistRun) => {
    if (!alive.current) return
    selectedEpoch.current += 1
    setRun(next); setLoaded(null); setError('')
    setRuns(items => [next, ...items.filter(item => item.taskId !== next.taskId)].slice(0, 20))
  }, [])
  useEffect(() => {
    if (!run || !isAssistActive(run)) return
    let stopped = false
    const timer = window.setTimeout(() => {
      void callAuthorTool<{ run: AuthorAssistRun }>('novelforge.assist.get', { novelId, taskId: run.taskId })
        .then(data => { if (!stopped) { setRun(data.run); setError('') } })
        .catch(cause => { if (!stopped) { setError(String(cause)); setRun({ ...run }) } })
    }, 1200)
    return () => { stopped = true; window.clearTimeout(timer) }
  }, [run, novelId])
  useEffect(() => {
    if (run?.status !== 'success' || !run.artifactId) return
    const id = run.artifactId
    let cancelled = false
    void callAuthorTool<{ artifact: { novelId: number; kind: string; content: T } }>('novelforge.artifacts.get', { artifactId: run.artifactId })
      .then(data => {
        if (data.artifact.novelId !== novelId || data.artifact.kind !== kind) throw new Error('任务结果不属于当前作品。')
        if (!cancelled) setLoaded({ id, content: data.artifact.content })
      }).catch(cause => { if (!cancelled) setError(String(cause)) })
    return () => { cancelled = true }
  }, [run?.artifactId, run?.status, novelId, kind])
  const cancel = async () => {
    if (!run) return
    try { const data = await callAuthorTool<{ run: AuthorAssistRun }>('novelforge.assist.cancel', { novelId, taskId: run.taskId }); if (alive.current) setRun(data.run) }
    catch (cause) { if (alive.current) setError(String(cause)) }
  }
  const result = loaded && run?.status === 'success' && run.artifactId === loaded.id ? loaded.content : null
  return { run, runs, result, error, track, cancel, active: isAssistActive(run) }
}
