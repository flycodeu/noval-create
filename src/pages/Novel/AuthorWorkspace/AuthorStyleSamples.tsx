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
export default function AuthorStyleSamples({ novelId, chapters, onDirtyChange }: { novelId: number; chapters: Chapter[]; onDirtyChange?: (dirty: boolean) => void }) {
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
  const alive = useRef(true)
  const dirty = busy || Boolean(text.trim()) || chapterIds.length > 0 || Boolean(scene.trim())
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
  const load = useCallback(() => callAuthorTool<Catalog>('novelforge.style.list', { novelId }), [novelId])
  useEffect(() => { alive.current = true; void load().then(value => { if (alive.current) { setCatalog(value); setSelected(current => current ?? (value.samples.some(item => item.id === value.activeId) ? value.activeId : null)) } }).catch(cause => { if (alive.current) setError(String(cause)) }); return () => { alive.current = false } }, [load])
  useEffect(() => { let current = true; if (selected) void callAuthorTool<Sample>('novelforge.style.get', { fingerprintId: selected }).then(value => { if (current) setSample(value) }).catch(cause => { if (current) setError(String(cause)) }); return () => { current = false } }, [selected])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (cause) { if (alive.current) setError(String(cause)) } finally { if (alive.current) setBusy(false) }
  }
  const refresh = async () => { const value = await load(); if (alive.current) setCatalog(value) }
  const analyze = () => run(async () => {
    const result = await callAuthorTool<Sample>('novelforge.style.analyze', { novelId, name, ...(mode === 'paste' ? { text } : { chapterIds }) })
    if (alive.current) { setSample(result); setSelected(result.record.id); setText(''); setChapterIds([]); messageApi.success('分析已保存为候选，尚未认可') }
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
  return <section className="author-paper author-design-section">{messageContext}
    <div className="author-section-heading"><div><h2>样稿分析与复用</h2><p>提供实际叙事正文，查看统计与分析后再认可。文风偏好说明仍在上方单独编辑。</p></div><Button disabled={busy} onClick={() => void run(refresh)}>刷新样稿</Button></div>
    {error && <Alert type="error" message={error} />}
    {catalog?.activeId && catalog.diagnostics.length > 0 ? <Alert type="warning" message="已选样稿来源发生变化，当前不供生成使用；请重新分析后认可" /> : null}
    <div className="author-library-grid"><div>
      <label htmlFor="style-sample-name">样稿名称</label><Input id="style-sample-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} disabled={busy} />
      <Radio.Group value={mode} onChange={event => setMode(event.target.value)} disabled={busy} options={[{ value: 'paste', label: '粘贴正文' }, { value: 'chapters', label: '本作章节' }]} />
      {mode === 'paste' ? <><Input.TextArea aria-label="样稿正文" value={text} onChange={event => setText(event.target.value)} maxLength={48000} autoSize={{ minRows: 7, maxRows: 16 }} disabled={busy} placeholder="粘贴实际正文，最多 48000 字符" />{text.trim() && <Stats stats={computeStyleStats(text)} />}</> : <Select aria-label="选择样稿章节" mode="multiple" style={{ width: '100%' }} value={chapterIds} onChange={setChapterIds} disabled={busy} options={chapters.filter(item => item.content?.trim()).map(item => ({ value: item.id, label: `第 ${item.chapterNum} 章 · ${item.title}` }))} />}
      <Button type="primary" loading={busy} disabled={!name.trim() || (mode === 'paste' ? !text.trim() : !chapterIds.length)} onClick={() => void analyze()}>分析并保存候选</Button>
    </div><div>
      <label htmlFor="style-sample-picker">已保存样稿</label><Select id="style-sample-picker" showSearch optionFilterProp="label" style={{ width: '100%' }} value={selected} disabled={busy} onChange={setSelected} placeholder="选择本作或其他作品的样稿" options={catalog?.samples.map(item => ({ value: item.id, label: `${item.novelId === novelId ? '本作' : '其他作品'} · ${item.name}${item.id === catalog.activeId ? ' · 已选择' : ''}` }))} />
      {catalog?.activeId && <Button disabled={busy} onClick={() => void approve(null)}>撤销当前认可</Button>}
      {busy && <div role="status"><Spin size="small" /> 正在处理，结果保留为候选，不改写正文。</div>}
    </div></div>
    {localSample && <article className="author-change-card">
      <Space wrap><h3>{localSample.record.name}</h3><Tag color={active ? 'green' : 'default'}>{active ? '已认可，供生成使用' : '待作者认可'}</Tag></Space>
      <Stats stats={localSample.stats} /><p>统计由程序计算，用于描述与比较，不设固定配额。</p>
      <dl className="author-document-fields">{[['叙事技巧', localSample.fingerprint.narrativeTechniques], ['对话风格', localSample.fingerprint.dialogueStyle], ['描写与节奏', `${localSample.fingerprint.descriptionDensity} ${localSample.fingerprint.paceProfile}`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '未提供'}</dd></div>)}</dl>
      {localSample.fingerprint.exampleExcerpts.filter(quote => localSample.record.sourceText?.includes(quote)).map(quote => <blockquote key={quote}>{quote}</blockquote>)}
      <details><summary>查看样稿正文与来源</summary><p className="author-prose">{localSample.record.sourceText}</p>{localSample.record.sourceReferenceJson && <p>来自作者明确复制的已保存样稿，本作持有独立文本副本。</p>}</details>
      {localSample.record.novelId !== novelId ? <Button disabled={busy} onClick={() => void run(async () => { const copied = await callAuthorTool<Sample>('novelforge.style.copy_sample', { novelId, sourceId: selected }); if (alive.current) { setSample(copied); setSelected(copied.record.id) } await refresh() })}>复制样稿到本作，再决定认可</Button> : <Space wrap><Button type="primary" disabled={busy || active} onClick={() => void approve(selected)}>认可为本作样稿</Button><Button disabled={busy || !scene.trim()} onClick={() => void run(async () => { const result = await callAuthorTool<StyleAbTestResult>('novelforge.style.trial', { novelId, fingerprintId: selected, sceneBrief: scene }); if (alive.current) setTrial({ id: selected!, scene, result }) })}>同场景试写对照</Button></Space>}
      <Input.TextArea aria-label="试写场景梗概" placeholder="填入同一场景的事实、人物选择与结果，用于两份试写对照" value={scene} onChange={event => setScene(event.target.value)} maxLength={4000} disabled={busy} autoSize={{ minRows: 3, maxRows: 8 }} />
      {trial?.id === selected && <><p className="author-prose">本次试写依据：{trial.scene}</p><div className="author-library-compare"><div><h4>参考所选样稿</h4><p>{trial.result.withFingerprint.text}</p><Stats stats={trial.result.withFingerprint.stats} /><Button disabled={busy} onClick={() => void approveTrial(trial.result.withFingerprint.text)}>认可这份试写为样稿</Button></div><div><h4>未参考样稿</h4><p>{trial.result.without.text}</p><Stats stats={trial.result.without.stats} /><Button disabled={busy} onClick={() => void approveTrial(trial.result.without.text)}>认可这份试写为样稿</Button></div></div></>}
    </article>}
  </section>
}
