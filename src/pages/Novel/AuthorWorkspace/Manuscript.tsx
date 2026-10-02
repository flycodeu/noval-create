import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Drawer, Input, InputNumber, Modal, Spin, message } from 'antd'
import { HistoryOutlined, PlusOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Chapter, ChapterVersion } from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { countChapterWords } from '../Writing/useChapterEditor'
import { EmptyWork, LoadFailure, RunProgress } from './shared'
import { useCreativeWorkflow } from './workflow-client'
import ChapterArrangement from './ChapterArrangement'
import ChapterChanges from './ChapterChanges'
import { ContentDocument } from './ContentDocument'

const VERSION_LABELS = { 'manual-save': '手动保存', 'ai-rewrite': 'AI 修订', 'pipeline-generate': '生成正文', 'version-restore': '恢复版本' }

export default function Manuscript({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const chapterParam = Number(params.get('chapterId')) || null
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [draft, setDraft] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState('')
  const [autoApply, setAutoApply] = useState(false)
  const panel = params.get('panel') || 'text'
  const [arrangementDirty, setArrangementDirty] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<ChapterVersion[]>([])
  const [selectedVersion, setSelectedVersion] = useState<ChapterVersion | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newNumber, setNewNumber] = useState(1)
  const draftRef = useRef('')
  const baselineRef = useRef('')
  const selectedId = useRef<number | null>(null)
  const loadEpoch = useRef(0)
  const workflow = useCreativeWorkflow(novelId)
  const { registerSaveHandler, registerLeaveGuard, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const dirty = draft !== baseline
  const historyChapterId = chapter?.id
  useEffect(() => {
    if (panel !== 'history' || !historyChapterId) return
    let alive = true
    void window.electron.chapter.listVersions(historyChapterId).then(rows => { if (alive) { setVersions(rows); setHistoryOpen(true) } }).catch(cause => { if (alive) setError(String(cause)) })
    return () => { alive = false }
  }, [panel, historyChapterId])

  const installChapter = useCallback((next: Chapter) => {
    selectedId.current = next.id
    draftRef.current = next.content || ''
    baselineRef.current = next.content || ''
    setChapter(next); setDraft(draftRef.current); setBaseline(baselineRef.current); setError('')
  }, [])
  const loadChapter = useCallback(async (id: number) => {
    const epoch = ++loadEpoch.current
    setLoading(true)
    try {
      const next = await window.electron.chapter.get(id)
      if (epoch !== loadEpoch.current) return
      if (!next || next.novelId !== novelId) throw new Error('所选章节不存在于这部作品中。')
      installChapter(next)
    } catch (cause) { if (epoch === loadEpoch.current) setError(cause instanceof Error ? cause.message : '读取正文失败') }
    finally { if (epoch === loadEpoch.current) setLoading(false) }
  }, [installChapter, novelId])
  const reloadList = useCallback(async () => {
    const rows = await window.electron.chapter.list(novelId)
    setChapters(rows)
    return rows
  }, [novelId])

  useEffect(() => {
    let alive = true
    void reloadList().then((rows) => {
      if (!alive) return
      const id = chapterParam || rows[0]?.id
      if (id && id !== selectedId.current && draftRef.current === baselineRef.current) void loadChapter(id)
      else setLoading(false)
    }).catch((cause) => { if (alive) { setError(cause instanceof Error ? cause.message : '读取章节失败'); setLoading(false) } })
    return () => { alive = false; loadEpoch.current += 1 }
  }, [chapterParam, loadChapter, reloadList])

  const save = useCallback(async () => {
    if (!chapter || saving) return false
    if (draftRef.current === baselineRef.current) return true
    setSaving(true)
    try {
      const content = draftRef.current
      const wordCount = countChapterWords(content)
      await window.electron.chapter.update(chapter.id, { content, wordCount }, { expectedContent: baselineRef.current, versionSource: 'manual-save' })
      baselineRef.current = content; setBaseline(content)
      setChapter((current) => current && { ...current, content, wordCount })
      setError(''); await reloadList(); notifyWorkspaceMutation()
      return true
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，正文仍保留在编辑器中'); return false }
    finally { setSaving(false) }
  }, [chapter, notifyWorkspaceMutation, reloadList, saving])
  useEffect(() => { registerSaveHandler(() => { void save() }); return () => registerSaveHandler(null) }, [registerSaveHandler, save])
  useEffect(() => { registerLeaveGuard(() => arrangementDirty || draftRef.current !== baselineRef.current); return () => registerLeaveGuard(null) }, [registerLeaveGuard, arrangementDirty])
  useEffect(() => {
    const refresh = () => {
      void reloadList().catch((cause) => setError(String(cause)))
      if (selectedId.current && draftRef.current === baselineRef.current) void loadChapter(selectedId.current)
    }
    window.addEventListener('novelforge:creative-completed', refresh)
    return () => window.removeEventListener('novelforge:creative-completed', refresh)
  }, [loadChapter, reloadList])

  const chooseChapter = (id: number) => {
    if (id === chapter?.id) return
    const change = () => setParams({ chapterId: String(id) })
    if (!dirty) { change(); return }
    Modal.confirm({ title: '保存这一章的修改？', content: '保存后再切换章节。', okText: '保存并切换', cancelText: '继续编辑', onOk: async () => { if (!await save()) throw new Error('保存失败，请检查正文提示'); change() } })
  }
  const generate = async () => {
    if (!chapter || !await save()) return
    await workflow.start({ stage: 'chapter', atChapter: chapter.chapterNum, autoApply,
      request: request.trim() || `结合本章安排、现有设定与前文，${chapter.content?.trim() ? '审阅并修订' : '生成'}第 ${chapter.chapterNum} 章《${chapter.title || '未命名'}》，保留已确定事实，完成连续性与叙事评审。` })
  }
  const openHistory = async () => {
    if (!chapter) return
    setHistoryOpen(true); setSelectedVersion(null)
    try { setVersions(await window.electron.chapter.listVersions(chapter.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '读取版本失败') }
  }
  const restore = (version: ChapterVersion) => {
    if (!chapter) return
    Modal.confirm({ title: '恢复这个正文版本？', content: '当前已保存正文仍保留在历史版本中。', okText: '恢复版本', cancelText: '取消', onOk: async () => {
      if (!await save()) throw new Error('请先处理正文保存冲突')
      await window.electron.chapter.update(chapter.id, { content: version.content, wordCount: version.wordCount }, { expectedContent: baselineRef.current, versionSource: 'version-restore' })
      await loadChapter(chapter.id); await reloadList(); setHistoryOpen(false); notifyWorkspaceMutation(); message.success('正文已恢复')
    } })
  }
  const createChapter = async () => {
    try {
      if (chapter && !await save()) return
      const id = await window.electron.chapter.create(novelId, { chapterNum: newNumber, title: newTitle.trim() || undefined, targetWords: 3200, status: 'outline' })
      await reloadList(); setCreating(false); setNewTitle(''); setParams({ chapterId: String(id) }); notifyWorkspaceMutation()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建章节失败') }
  }
  const changePanel = (next: string) => { const search = new URLSearchParams(params); search.set('panel', next); setParams(search) }

  return <div className="author-manuscript">
    <aside className="author-manuscript__chapters"><div className="author-section-heading"><h2>章节</h2><Button type="text" icon={<PlusOutlined />} aria-label="添加章节" onClick={() => { setNewNumber(Math.max(0, ...chapters.map((item) => item.chapterNum)) + 1); setCreating(true) }} /></div>
      <div className="author-manuscript__chapter-list">{chapters.map((item) => <button key={item.id} className={item.id === chapter?.id ? 'is-active' : ''} onClick={() => chooseChapter(item.id)}><small>第 {item.chapterNum} 章 · {item.wordCount > 0 ? `${item.wordCount.toLocaleString()} 字` : '待写'}</small><strong>{item.title || '未命名'}</strong></button>)}</div>
      <Button type="text" onClick={() => navigate(buildWorkspaceRoute(novelId, 'story-design'))}>查看故事安排</Button>
    </aside>
    <section className="author-manuscript__desk">
      {error && <LoadFailure message={error} retry={() => { if (!dirty && chapter) void loadChapter(chapter.id); else void save() }} />}
      {loading ? <div className="author-loading"><Spin /></div> : !chapter ? <EmptyWork title="从第一章开始" actionLabel="安排章节" action={() => navigate(buildWorkspaceRoute(novelId, 'guide?stage=outline'))}>可让 AI 根据背景安排首个单元，也可以手动添加章节。</EmptyWork> : <>
        <header className="author-manuscript__heading"><div><span className="author-eyebrow">第 {chapter.chapterNum} 章</span><h1>{chapter.title || '未命名'}</h1><small>{countChapterWords(draft).toLocaleString()} 字 · {dirty ? '有未保存修改' : '已保存'}</small></div><div className="author-heading-actions"><Button icon={<HistoryOutlined />} onClick={() => void openHistory()}>版本</Button><Button icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存</Button></div></header>
        <div className="author-tabs author-section-tabs" role="tablist">{[{ key: 'text', label: '正文' }, { key: 'arrangement', label: '本章安排' }, { key: 'review', label: '审校' }, { key: 'changes', label: '章后变化' }].map(item => <button key={item.key} role="tab" aria-selected={panel === item.key} onClick={() => changePanel(item.key)}>{item.label}</button>)}</div>
        {panel === 'arrangement' ? <ChapterArrangement key={chapter.id} chapter={chapter} onDirtyChange={setArrangementDirty} onSaved={() => { if (!dirty) void loadChapter(chapter.id) }} /> : panel === 'changes' ? <ChapterChanges key={chapter.id} chapterId={chapter.id} /> : panel === 'review' ? <section className="author-paper"><h2>只评审已保存的本章</h2><p className="author-muted">结合本章合同、世界与人物设定、前文和事实边界出具评审报告。此操作不修改正文或设定。</p><Button loading={workflow.submitting} disabled={dirty || workflow.active || !chapter.content?.trim()} onClick={() => void workflow.review(chapter.id, request.trim() || '评审本章的因果、连续性、人物与视角边界、叙事和语言，指出具体证据与修改建议。')}>仅评审第 {chapter.chapterNum} 章</Button>{dirty && <p>请先保存正文，再评审这一版。</p>}{workflow.run?.operation === 'review' && workflow.run.atChapter === chapter.chapterNum && workflow.run.result && <ContentDocument value={workflow.run.result} />}<Button type="link" onClick={() => changePanel('text')}>根据评审意见提出修订</Button></section> : <>
        {chapter.outline && <details className="author-disclosure author-manuscript__outline"><summary>本章安排</summary><p>{chapter.outline}</p></details>}
        <textarea className="author-manuscript__editor" aria-label={`第 ${chapter.chapterNum} 章正文`} value={draft} disabled={saving} onChange={(event) => { draftRef.current = event.target.value; setDraft(event.target.value) }} placeholder="正文从这里开始。也可以在下方说明这一章的要求，让 AI 生成并审校。" spellCheck={false} />
        <div className="author-manuscript__prompt"><Input.TextArea aria-label="本章生成或修订要求" value={request} onChange={(event) => setRequest(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="本章的生成或修订要求，例如：收紧对话，保留现有事件与人物立场。" /><div><Checkbox checked={autoApply} onChange={event => setAutoApply(event.target.checked)}>审校通过后直接保存</Checkbox><Button type="primary" icon={<SendOutlined />} loading={workflow.submitting} disabled={workflow.active || saving} onClick={() => void generate()}>{chapter.content?.trim() ? '按意见生成修订候选' : '生成并评审本章'}</Button></div><p className="author-muted">{autoApply ? '通过审校后保存，原正文保留历史版本。' : '先查看候选与差异，确认后再应用。'}</p></div>
        </>}
      </>}
      {workflow.error && <LoadFailure message={workflow.error} retry={() => void workflow.refresh()} />}
      {workflow.run && (workflow.active || workflow.run.stage === 'chapter') && <RunProgress run={workflow.run} active={workflow.active} onCancel={() => void workflow.control('cancel')} onResume={() => void workflow.control('resume')} onOpenResult={() => navigate(buildWorkspaceRoute(novelId, `revision?artifact=${workflow.run?.artifactId || ''}`))} />}
    </section>
    <Drawer title="正文历史版本" width={680} open={historyOpen} onClose={() => setHistoryOpen(false)}><div className="author-manuscript__versions">{versions.length ? versions.map((version) => <button className={selectedVersion?.id === version.id ? 'is-active' : ''} key={version.id} onClick={() => setSelectedVersion(version)}><span>{VERSION_LABELS[version.versionSource]} · {version.wordCount.toLocaleString()} 字</span><time>{new Date(version.createdAt).toLocaleString()}</time></button>) : <EmptyWork title="还没有历史版本">保存正文或完成生成后，版本会出现在这里。</EmptyWork>}</div>{selectedVersion && <section className="author-version-preview"><Button onClick={() => restore(selectedVersion)}>恢复此版本</Button><pre>{selectedVersion.content}</pre></section>}</Drawer>
    <Modal title="添加章节" open={creating} onCancel={() => setCreating(false)} onOk={() => void createChapter()} okText="添加"><div className="author-new-chapter"><label>章节序号<InputNumber min={1} precision={0} value={newNumber} onChange={(value) => setNewNumber(value || 1)} /></label><label>章节标题<Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="可以暂不填写" /></label></div></Modal>
  </div>
}
