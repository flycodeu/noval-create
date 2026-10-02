import React, { useCallback, useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import type { ChapterWritebackCenterData } from '../../../types'
import { ContentDocument } from './ContentDocument'
import { LoadFailure } from './shared'

export default function ChapterChanges({ chapterId }: { chapterId: number }) {
  const [data, setData] = useState<ChapterWritebackCenterData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => { setData(await window.electron.writeback.getCenterData(chapterId)) }, [chapterId])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try { await action(); await load(); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取章后变化失败') }
    finally { setBusy(false) }
  }
  useEffect(() => { void load().catch(cause => setError(String(cause))) }, [load])
  return <section className="author-arrangement"><div className="author-section-heading"><h2>章后变化</h2><Button loading={busy} onClick={() => void act(() => window.electron.writeback.prepareRun(chapterId, 'manual'))}>从已保存正文提取变化</Button></div>
    <p className="author-muted">核对实际发生的人物、关系、地点与线索变化。接受的变化才进入回写；提取不会修改正文。</p>
    {error && <LoadFailure message={error} retry={() => void act(load)} />}
    {!data ? <Spin /> : data.diffs.length ? <>{data.diffs.map(diff => <article className="author-change-card" key={diff.id}><div className="author-section-heading"><h3>{diff.diffReason || diff.entityType}</h3><span>{diff.writebackStatus === 'applied' ? '已回写' : diff.canonDecision === 'accepted' ? '已接受' : diff.canonDecision === 'rejected' ? '已拒绝' : '待核对'}</span></div><div className="author-diff-columns"><section><h4>变化前</h4><ContentDocument value={diff.beforeStateJson} /></section><section><h4>正文后的变化</h4><ContentDocument value={diff.afterStateJson} /></section></div>{diff.writebackError && <p role="alert">{diff.writebackError}</p>}{diff.writebackStatus !== 'applied' && <div className="author-heading-actions"><Button disabled={busy} onClick={() => void act(() => window.electron.writeback.updateDecision(diff.id, { canonDecision: 'accepted' }))}>接受</Button><Button disabled={busy} onClick={() => void act(() => window.electron.writeback.updateDecision(diff.id, { canonDecision: 'rejected' }))}>拒绝</Button></div>}</article>)}{data.activeRun && <Button loading={busy} disabled={!data.diffs.some(diff => diff.canonDecision === 'accepted' && diff.writebackStatus !== 'applied')} onClick={() => void act(() => window.electron.writeback.applyRun(data.activeRun!.id))}>保存已接受的变化</Button>}</> : <p className="author-missing">本章尚无单独的回写候选。自动创作已应用的设定变化可在“世界与人物”按章位查看，或在版本记录查看生成依据。</p>}
  </section>
}
