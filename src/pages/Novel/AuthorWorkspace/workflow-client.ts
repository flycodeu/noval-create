import { useCallback, useEffect, useRef, useState } from 'react'
import type { CreativeRun, CreativeWorkflowInput } from '../../../shared/creative-workflow'

export { runStatusLabel } from './run-presentation'

export async function callAuthorTool<T>(toolId: string, input: Record<string, unknown>): Promise<T> {
  const response = await window.electron.agentTools.call({ toolId, input })
  if (!response.ok) throw new Error(response.error.message)
  return response.data as T
}

export function isRunActive(run: CreativeRun | null | undefined) {
  return Boolean(run && !['completed', 'needs_attention', 'cancelled'].includes(run.step)
    && !['failed', 'completed', 'cancelled', 'paused'].includes(run.status))
}

export function useCreativeWorkflow(novelId: number) {
  const [run, setRun] = useState<CreativeRun | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const alive = useRef(true)
  const requestEpoch = useRef(0)
  const mutationEpoch = useRef(0)
  const mutationInProgress = useRef(false)
  const refreshInProgress = useRef(false)
  const notifiedRun = useRef<string | null>(null)
  const refresh = useCallback(async (runId?: number) => {
    if (refreshInProgress.current || mutationInProgress.current) return null
    refreshInProgress.current = true
    const epoch = ++requestEpoch.current
    try {
      const response = await callAuthorTool<{ run: CreativeRun | null }>('novelforge.workflows.get', { novelId, ...(runId ? { runId } : {}) })
      const next = response.run
      if (alive.current && epoch === requestEpoch.current) { setRun(next); setError('') }
      return next
    } catch (cause) {
      if (alive.current && epoch === requestEpoch.current) setError(cause instanceof Error ? cause.message : '读取创作任务失败')
      return null
    } finally { refreshInProgress.current = false }
  }, [novelId])

  useEffect(() => {
    alive.current = true
    mutationInProgress.current = false
    setSubmitting(false)
    setError('')
    setRun(null)
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      const next = await refresh()
      if (!stopped) timer = window.setTimeout(() => { void poll() }, isRunActive(next) ? 1600 : 5000)
    }
    void poll()
    return () => { stopped = true; alive.current = false; requestEpoch.current += 1; mutationEpoch.current += 1; mutationInProgress.current = false; window.clearTimeout(timer) }
  }, [refresh])

  useEffect(() => {
    if (!run || run.step !== 'completed') return
    const key = `${run.runId}:${run.updatedAt}`
    if (notifiedRun.current === key) return
    notifiedRun.current = key
    window.dispatchEvent(new Event('novelforge:creative-completed'))
  }, [run])

  const start = useCallback(async (input: Omit<CreativeWorkflowInput, 'novelId' | 'idempotencyKey'>) => {
    if (mutationInProgress.current) return null
    const epoch = ++mutationEpoch.current
    mutationInProgress.current = true
    requestEpoch.current += 1
    setSubmitting(true)
    setError('')
    try {
      const result = await callAuthorTool<{ run: CreativeRun | null }>('novelforge.workflows.start', {
        ...input, novelId, idempotencyKey: `author:${novelId}:${crypto.randomUUID()}`,
      })
      const next = result.run
      if (alive.current && epoch === mutationEpoch.current) setRun(next)
      return next
    } catch (cause) {
      if (alive.current && epoch === mutationEpoch.current) setError(cause instanceof Error ? cause.message : '启动创作任务失败')
      return null
    } finally { if (alive.current && epoch === mutationEpoch.current) { mutationInProgress.current = false; setSubmitting(false) } }
  }, [novelId])

  const control = useCallback(async (action: 'cancel' | 'resume') => {
    if (!run || mutationInProgress.current) return
    const epoch = ++mutationEpoch.current
    mutationInProgress.current = true
    requestEpoch.current += 1
    setSubmitting(true)
    try {
      const result = await callAuthorTool<{ run: CreativeRun }>(`novelforge.workflows.${action}`, { novelId, runId: run.runId })
      if (!alive.current || epoch !== mutationEpoch.current) return
      setRun(result.run); setError('')
    } catch (cause) { if (alive.current && epoch === mutationEpoch.current) setError(cause instanceof Error ? cause.message : '任务操作失败') }
    finally { if (alive.current && epoch === mutationEpoch.current) { mutationInProgress.current = false; setSubmitting(false) } }
  }, [novelId, run])
  const review = useCallback(async (chapterId: number, request: string) => {
    if (mutationInProgress.current) return
    const epoch = ++mutationEpoch.current
    mutationInProgress.current = true
    requestEpoch.current += 1
    setSubmitting(true); setError('')
    try {
      const result = await callAuthorTool<{ run: CreativeRun }>('novelforge.chapters.review', { novelId, chapterId, request, idempotencyKey: `author-review:${novelId}:${crypto.randomUUID()}` })
      if (alive.current && epoch === mutationEpoch.current) setRun(result.run)
    } catch (cause) { if (alive.current && epoch === mutationEpoch.current) setError(cause instanceof Error ? cause.message : '启动章节评审失败') }
    finally { if (alive.current && epoch === mutationEpoch.current) { mutationInProgress.current = false; setSubmitting(false) } }
  }, [novelId])
  return { run, error, submitting, active: isRunActive(run), start, review, refresh, control }
}
