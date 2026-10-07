import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Space, Tag } from 'antd'
import type { ZhuqueChapterView } from '../shared/zhuque-detection'

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`
async function bindSavedVersion(view: ZhuqueChapterView, content: string): Promise<ZhuqueChapterView> {
  if (!view.report || view.status === 'running') return view
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return view.report.contentHash === hash ? view : { ...view, status: 'stale' }
}
export default function ZhuqueChapterPanel({ chapterId, savedContent, getContent }: { chapterId?: number; savedContent?: string | null; getContent: () => string }) {
  const [view, setView] = useState<ZhuqueChapterView | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const epoch = useRef(0), locked = useRef(false)
  const refresh = useCallback(async () => {
    if (!chapterId) return
    const token = epoch.current
    try { const next = await bindSavedVersion(await window.electron.zhuque.getChapterResult(chapterId), savedContent || ''); if (token === epoch.current) { setView(next); setError('') } }
    catch { if (token === epoch.current) setError('朱雀检测状态无法读取。') }
  }, [chapterId, savedContent])
  useEffect(() => {
    const token = ++epoch.current; setView(null); setError(''); setBusy(false)
    void refresh()
    window.addEventListener('novelforge:zhuque-settings-changed', refresh)
    window.addEventListener('focus', refresh)
    return () => { epoch.current = token + 1; window.removeEventListener('novelforge:zhuque-settings-changed', refresh); window.removeEventListener('focus', refresh) }
  }, [refresh, savedContent])
  useEffect(() => {
    if (view?.status !== 'running') return
    const interval = setInterval(() => void refresh(), 2000)
    return () => clearInterval(interval)
  }, [view?.status, refresh])
  const detect = async () => {
    if (!chapterId || locked.current) return
    if (getContent() !== (savedContent || '')) { setError('正文尚有未保存修改，请先保存，再检测当前版本。'); return }
    const token = epoch.current
    locked.current = true; setBusy(true); setError('')
    try { const next = await bindSavedVersion(await window.electron.zhuque.detectChapter(chapterId, savedContent || ''), savedContent || ''); if (token === epoch.current) setView(next) }
    catch { if (token === epoch.current) setError('未完成朱雀检测，请检查开关、密钥或本机服务。') }
    finally { locked.current = false; if (token === epoch.current) setBusy(false) }
  }
  const metrics = view?.report?.metrics
  const labels = { not_checked: '尚未检测', running: '检测中', success: '检测完成', failed: '检测失败', stale: '旧结果已过期' }
  return <section className="novel-issue-item" data-zhuque-chapter>
    <Space wrap><strong>朱雀 AI 检测</strong><Tag>{view ? labels[view.status] : '加载中'}</Tag>{view && !view.enabled ? <Tag>开关已关闭</Tag> : null}</Space>

    {metrics && view?.status === 'success' ? <Space wrap><span>AI内容 {percent(metrics.aiRatio)}</span><span>疑似AI {percent(metrics.suspectedAiRatio)}</span><span>人工内容 {percent(metrics.humanRatio)}</span></Space> : null}
    {view?.status === 'stale' ? <p role="status">正文已修改，请重新检测。</p> : null}
    {view?.status === 'failed' ? <p role="status">{view.report?.error || '朱雀未返回有效结果。'}</p> : null}
    {view?.report?.checkedAt ? <p>检测时间：{new Date(view.report.checkedAt).toLocaleString()}{view.report.metrics?.quotaTokensUsed !== undefined ? ` · Makers用量 ${view.report.metrics.quotaTokensUsed} tokens` : ''}</p> : null}
    <Space><Button size="small" loading={busy} disabled={!chapterId || !view?.enabled || view?.status === 'running'} onClick={() => void detect()}>{view?.status === 'success' ? '检查当前版本' : '检测正文'}</Button><Button size="small" onClick={() => void refresh()}>刷新状态</Button></Space>
    {metrics && view?.status === 'success' && metrics.segments.some(segment => segment.label !== 0) ? <details><summary>AI / 疑似 AI 分段</summary>{metrics.segments.filter(segment => segment.label !== 0).map((segment, index) => <blockquote key={index}><Tag>{segment.label === 1 ? 'AI' : '疑似AI'} · 置信度 {percent(segment.confidence)}</Tag>{segment.text}</blockquote>)}</details> : null}
    {error ? <p role="status">{error}</p> : null}
  </section>
}
