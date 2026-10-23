import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Radio, Select, Space, Spin, Tag, message } from 'antd'
import type { Chapter, StyleAbTestResult, StyleFingerprint, StyleFingerprintRecord } from '../../../types'
import { computeStyleStats, type StyleStats } from '../../../shared/style-fingerprint-stats'
import { callAuthorTool } from './workflow-client'
import { useNovelStore } from '../../../stores/novel.store'
import './author-library.css'

interface Catalog { samples: Array<Pick<StyleFingerprintRecord, 'id' | 'name' | 'novelId' | 'sourceType'>>; activeId: number | null; contextVersion: number; diagnostics: string[] }
interface Sample { record: StyleFingerprintRecord; fingerprint: StyleFingerprint; stats: StyleStats }
function Stats({ stats }: { stats: StyleStats }) {
  return <div className="author-library-stats"><span>平均句长<strong>{stats.avgSentenceLength} 字</strong></span><span>平均段长<strong>{stats.avgParagraphLength} 字</strong></span><span>对话段占比<strong>{stats.dialogueLineRate}%</strong></span></div>
}
export default function AuthorStyleSamples({ novelId, chapters, onDirtyChange, preferences }: { novelId: number; chapters: Chapter[]; onDirtyChange?: (dirty: boolean) => void; preferences?: React.ReactNode }) {
  const [messageApi, messageContext] = message.useMessage()
  const setNovel = useNovelStore(state => state.setCurrentNovel)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [sample, setSample] = useState<Sample | null>(null)
  const [name, setName] = useState('我的文风样稿')
  const [text, setText] = useState('')
  const [mode, setMode] = useState('paste')
  const [chapterIds, setChapterIds] = useState<number[]>([])
  const [scene, setScene] = useState('')
  const [trial, setTrial] = useState<{ id: number; scene: string; result: StyleAbTestResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [keyword, setKeyword] = useState('')
  const operation = useRef(false)
  const alive = useRef(true)
  const dirty = busy || name !== '我的文风样稿' || Boolean(text.trim()) || chapterIds.length > 0 || Boolean(scene.trim())
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const load = useCallback(() => callAuthorTool<Catalog>('novelforge.style.list', { novelId }), [novelId])
  useEffect(() => { alive.current = true; void load().then(value => { if (alive.current) { setCatalog(value); setSelected(current => current ?? (value.samples.some(item => item.id === value.activeId) ? value.activeId : value.samples[0]?.id ?? null)) } }).catch(cause => { if (alive.current) setError(String(cause)) }); return () => { alive.current = false } }, [load])
  useEffect(() => { let current = true; if (selected) void callAuthorTool<Sample>('novelforge.style.get', { fingerprintId: selected }).then(value => { if (current) setSample(value) }).catch(cause => { if (current) setError(String(cause)) }); return () => { current = false } }, [selected])
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return
    operation.current = true
    setBusy(true); setError('')
    try { await action() } catch (cause) { if (alive.current) setError(String(cause)) } finally { operation.current = false; if (alive.current) setBusy(false) }
  }
  const refresh = async () => { const value = await load(); if (alive.current) setCatalog(value) }
  const analyze = () => run(async () => {
    const result = await callAuthorTool<Sample>('novelforge.style.analyze', { novelId, name, ...(mode === 'paste' ? { text } : { chapterIds }) })
    if (alive.current) { setSample(result); setSelected(result.record.id); setCreating(false); setText(''); setChapterIds([]); setName('我的文风样稿'); messageApi.success('样稿分析已保存') }
    await refresh()
  })
  const approve = (fingerprintId: number | null) => run(async () => {
    await callAuthorTool('novelforge.style.approve', { novelId, fingerprintId, expectedContextVersion: catalog?.contextVersion })
    await refresh(); const novel = await window.electron.novel.get(novelId)
    if (alive.current && novel && useNovelStore.getState().currentNovel?.id === novelId) { setNovel(novel); messageApi.success(fingerprintId ? '已认可这份样稿，供后续生成参考' : '已撤销样稿认可') }
  })
  const localSample = sample?.record.id === selected ? sample : null
  const approveTrial = (text: string) => run(async () => {
    const result = await callAuthorTool<Sample>('novelforge.style.approve_trial', { novelId, text, expectedContextVersion: catalog?.contextVersion })
    await refresh()
    const novel = await window.electron.novel.get(novelId)
    if (alive.current) { setSample(result); setSelected(result.record.id); setScene(''); setTrial(null); if (novel && useNovelStore.getState().currentNovel?.id === novelId) setNovel(novel); messageApi.success('已保留并认可所选试写为样稿') }
  })
  const active = catalog?.activeId === selected && !catalog?.diagnostics.length
  return <section className="author-paper author-style-workspace">{messageContext}
    <div className="author-section-heading"><h2>文风参考</h2><Space wrap><Button disabled={busy} onClick={() => void run(async () => { await refresh(); if (selected) { const value = await callAuthorTool<Sample>('novelforge.style.get', { fingerprintId: selected }); if (alive.current) setSample(value) } })}>刷新样稿</Button><Button type="primary" disabled={busy} onClick={() => setCreating(true)}>新增样稿</Button></Space></div>
    {preferences}
    {error && <Alert type="error" message={error} />}
    {catalog?.activeId && catalog.diagnostics.length > 0 ? <Alert type="warning" message="已选样稿来源发生变化，当前不供生成使用；请重新分析后认可" /> : null}
    <div className="author-style-layout"><aside className="author-style-catalog" aria-label="已保存样稿">
      <h3>样稿库 <small>{catalog?.samples.length ?? 0}</small></h3>
      <Input.Search aria-label="搜索样稿" placeholder="搜索样稿" value={keyword} onChange={event => setKeyword(event.target.value)} allowClear />
      {!catalog ? error ? <p>读取失败，请刷新样稿</p> : <Spin size="small" /> : catalog.samples.length ? <nav aria-label="选择样稿">{catalog.samples.filter(item => item.name.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={!creating && selected === item.id} onClick={() => { setSelected(item.id); setCreating(false) }}><strong>{item.name}</strong><span>{item.novelId === novelId ? '本作' : '其他作品'}{item.id === catalog.activeId ? ' · 使用中' : ''}</span></button>)}</nav> : <p className="author-missing">暂无样稿</p>}
      {catalog?.activeId ? <Button size="small" disabled={busy} onClick={() => void approve(null)}>停用当前样稿</Button> : null}
    </aside><div className="author-style-main">
    {creating || !selected ? <div className="author-style-form">
      <h3>新样稿</h3>
      <label htmlFor="style-sample-name">样稿名称</label><Input id="style-sample-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={busy} />
      <Radio.Group value={mode} onChange={event => setMode(event.target.value)} disabled={busy} options={[{ value: 'paste', label: '粘贴正文' }, { value: 'chapters', label: '本作章节' }]} />
      {mode === 'paste' ? <><Input.TextArea aria-label="样稿正文" value={text} onChange={event => setText(event.target.value)} maxLength={48000} autoSize={{ minRows: 7, maxRows: 16 }} disabled={busy} placeholder="粘贴实际正文，最多 48000 字符" />{text.trim() && <Stats stats={computeStyleStats(text)} />}</> : <Select aria-label="选择样稿章节" mode="multiple" style={{ width: '100%' }} value={chapterIds} onChange={setChapterIds} disabled={busy} options={chapters.filter(item => item.content?.trim()).map(item => ({ value: item.id, label: `第 ${item.chapterNum} 章 · ${item.title}` }))} />}
      <Button type="primary" loading={busy} disabled={!name.trim() || (mode === 'paste' ? !text.trim() : !chapterIds.length)} onClick={() => void analyze()}>分析并保存</Button>
    </div> : !localSample ? <div role="status">{error ? '读取失败，请刷新样稿' : <><Spin size="small" /> 读取样稿</>}</div> : <article className="author-style-detail">
      <Space wrap><h3>{localSample.record.name}</h3><Tag color={active ? 'green' : 'default'}>{active ? '使用中' : '未使用'}</Tag></Space>
      <Stats stats={localSample.stats} />
      <dl className="author-document-fields">{[['叙事技巧', localSample.fingerprint.narrativeTechniques], ['对话风格', localSample.fingerprint.dialogueStyle], ['描写与节奏', `${localSample.fingerprint.descriptionDensity} ${localSample.fingerprint.paceProfile}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '未提供'}</dd></div>)}</dl>
      {localSample.fingerprint.exampleExcerpts.filter(quote => localSample.record.sourceText?.includes(quote)).map(quote => <blockquote key={quote}>{quote}</blockquote>)}
      <details><summary>样稿正文</summary><p className="author-prose">{localSample.record.sourceText}</p></details>
      {localSample.record.novelId !== novelId ? <Button disabled={busy} onClick={() => void run(async () => { const copied = await callAuthorTool<Sample>('novelforge.style.copy_sample', { novelId, sourceId: selected }); if (alive.current) { setSample(copied); setSelected(copied.record.id) } await refresh() })}>复制到本作</Button> : <Space wrap><Button type="primary" disabled={busy || active} onClick={() => void approve(selected)}>使用这份样稿</Button><Button disabled={busy || !scene.trim()} onClick={() => void run(async () => { const result = await callAuthorTool<StyleAbTestResult>('novelforge.style.trial', { novelId, fingerprintId: selected, sceneBrief: scene }); if (alive.current) setTrial({ id: selected!, scene, result }) })}>同场景试写对照</Button></Space>}
      <Input.TextArea aria-label="试写场景梗概" placeholder="填入同一场景的事实、人物选择与结果，用于两份试写对照" value={scene} onChange={event => setScene(event.target.value)} maxLength={4000} disabled={busy} autoSize={{ minRows: 3, maxRows: 8 }} />
      {trial?.id === selected && <><p className="author-prose">本次试写依据：{trial.scene}</p><div className="author-library-compare"><div><h4>参考所选样稿</h4><p>{trial.result.withFingerprint.text}</p><Stats stats={trial.result.withFingerprint.stats} /><Button disabled={busy} onClick={() => void approveTrial(trial.result.withFingerprint.text)}>认可这份试写为样稿</Button></div><div><h4>未参考样稿</h4><p>{trial.result.without.text}</p><Stats stats={trial.result.without.stats} /><Button disabled={busy} onClick={() => void approveTrial(trial.result.without.text)}>认可这份试写为样稿</Button></div></div></>}
    </article>}
    </div></div>
  </section>
}
