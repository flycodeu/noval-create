import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Drawer, Grid, Input, InputNumber, Modal, Select, Spin, message } from 'antd'
import { HistoryOutlined, MenuOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Chapter, ChapterVersion, StoryStructureTree } from '../../../types'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { countChapterWords } from '../Writing/useChapterEditor'
import { EmptyWork, LoadFailure, RunProgress } from './shared'
import { useCreativeWorkflow } from './workflow-client'
import ChapterArrangement from './ChapterArrangement'
import ChapterChanges from './ChapterChanges'
import { ContentDocument } from './ContentDocument'
import { selectedChapterParagraphs } from './chapter-revision-selection'
import { manuscriptGenerationFields } from './manuscript-generation'
import ZhuqueChapterPanel from '../../../components/ZhuqueChapterPanel'
import ChapterDirectory from './ChapterDirectory'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import ManuscriptReferences from './ManuscriptReferences'
import './manuscript-workspace.css'

const VERSION_LABELS = { 'manual-save': '手动保存', 'ai-rewrite': 'AI 修订', 'pipeline-generate': '生成正文', 'version-restore': '恢复版本' }

export default function Manuscript({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const chapterParam = Number(params.get('chapterId')) || null
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [tree, setTree] = useState<StoryStructureTree | null>(null)
  const [structureError, setStructureError] = useState('')
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [draft, setDraft] = useState('')
  const [baseline, setBaseline] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [request, setRequest] = useState('')
  const [revisionTarget, setRevisionTarget] = useState<'chapter' | 'paragraphs' | 'summary'>('chapter')
  const [selectedParagraphs, setSelectedParagraphs] = useState<number[]>([])
  const panel = params.get('panel') || 'text'
  const [arrangementDirty, setArrangementDirty] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [taskTarget, setTaskTarget] = useState<ObjectTaskTarget | null>(null)
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
  const screens = Grid.useBreakpoint()
  const { registerSaveHandler, registerLeaveGuard, registerViewLeaveGuard, notifyWorkspaceMutation } = useNovelWorkspaceActions()
  const dirty = draft !== baseline
  const historyChapterId = chapter?.id
  useEffect(() => {
    if (panel !== 'history' || !historyChapterId) return
    let alive = true
    void window.electron.chapter.listVersions(historyChapterId).then(rows => { if (alive) { setVersions(rows); setSelectedVersion(null) } }).catch(cause => { if (alive) setError(String(cause)) })
    return () => { alive = false }
  }, [panel, historyChapterId])
  useEffect(() => {
    if (chapterParam || !chapter || draftRef.current !== baselineRef.current) return
    const search = new URLSearchParams(params)
    search.set('chapterId', String(chapter.id))
    setParams(search, { replace: true })
  }, [chapterParam, chapter, params, setParams])

  const installChapter = useCallback((next: Chapter) => {
    selectedId.current = next.id
    draftRef.current = next.content || ''
    baselineRef.current = next.content || ''
    setChapter(next); setDraft(draftRef.current); setBaseline(baselineRef.current); setError('')
    setSelectedParagraphs([]); setRevisionTarget('chapter'); setSelectedVersion(null); setVersions([])
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
  const reloadStructure = useCallback(async () => {
    try { setTree(await window.electron.structure.getTree(novelId)); setStructureError('') }
    catch (cause) { setStructureError(cause instanceof Error ? cause.message : '读取卷章结构失败') }
  }, [novelId])
  useEffect(() => { void reloadStructure() }, [reloadStructure])

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
  useLayoutEffect(() => { registerLeaveGuard(() => arrangementDirty || draftRef.current !== baselineRef.current); return () => registerLeaveGuard(null) }, [registerLeaveGuard, arrangementDirty])
  useLayoutEffect(() => { registerViewLeaveGuard?.(() => arrangementDirty); return () => registerViewLeaveGuard?.(null) }, [registerViewLeaveGuard, arrangementDirty])
  useEffect(() => {
    const refresh = () => {
      void reloadList().catch((cause) => setError(String(cause)))
      void reloadStructure()
      if (selectedId.current && draftRef.current === baselineRef.current) void loadChapter(selectedId.current)
    }
    window.addEventListener('novelforge:creative-completed', refresh)
    return () => window.removeEventListener('novelforge:creative-completed', refresh)
  }, [loadChapter, reloadList, reloadStructure])

  const chooseChapter = (id: number) => {
    if (id === chapter?.id) { setDirectoryOpen(false); return }
    const change = () => { const search = new URLSearchParams(params); search.set('chapterId', String(id)); setParams(search); setDirectoryOpen(false); setArrangementDirty(false); setTaskTarget(null) }
    if (!dirty && !arrangementDirty) { change(); return }
    Modal.confirm({ title: dirty ? '保存这一章的修改？' : '放弃安排中的未保存修改？', content: arrangementDirty ? '安排编辑中的未保存修改会放弃；正文修改会先保存，再切换章节。' : '保存后再切换章节。', okText: dirty ? '保存并切换' : '放弃并切换', cancelText: '继续编辑', onOk: async () => { if (dirty && !await save()) throw new Error('保存失败，请检查正文提示'); change() } })
  }
  const generate = async () => {
    if (!chapter || !await save()) return
    if (revisionTarget !== 'chapter' && !baselineRef.current.trim()) { setError('请先保存正文，再进行局部修订。'); return }
    if (revisionTarget === 'paragraphs' && (!selectedParagraphs.length || selectedParagraphs.length > 30)) { setError('请在正文中选中需要修改的段落，每次最多 30 段。'); return }
    const fields = manuscriptGenerationFields({ chapterNum: chapter.chapterNum, title: chapter.title, hasSavedProse: Boolean(baselineRef.current.trim()), revisionTarget, userRequest: request, run: workflow.run })
    setTaskTarget({ title: `第 ${chapter.chapterNum} 章 · ${revisionTarget === 'paragraphs' ? '选中段落修订' : revisionTarget === 'summary' ? '摘要修订' : chapter.content?.trim() ? '正文修订' : '生成正文'}`, stage: 'chapter', atChapter: chapter.chapterNum,
      ...(revisionTarget === 'summary' ? { chapterRevision: { target: 'summary' } } : revisionTarget === 'paragraphs' ? { chapterRevision: { target: 'paragraphs', paragraphIndexes: selectedParagraphs } } : {}),
      ...fields })
  }
  const restore = (version: ChapterVersion) => {
    if (!chapter) return
    Modal.confirm({ title: '恢复这个正文版本？', content: '当前已保存正文仍保留在历史版本中。', okText: '恢复版本', cancelText: '取消', onOk: async () => {
      if (!await save()) throw new Error('请先处理正文保存冲突')
      await window.electron.chapter.update(chapter.id, { content: version.content, wordCount: version.wordCount }, { expectedContent: baselineRef.current, versionSource: 'version-restore' })
      await loadChapter(chapter.id); await reloadList(); setVersions(await window.electron.chapter.listVersions(chapter.id)); notifyWorkspaceMutation(); message.success('正文已恢复')
    } })
  }
  const createChapter = async () => {
    try {
      if (chapter && !await save()) return
      const id = await window.electron.chapter.create(novelId, { chapterNum: newNumber, title: newTitle.trim() || undefined, targetWords: 3200, status: 'outline' })
      await reloadList(); setCreating(false); setNewTitle(''); setParams({ chapterId: String(id) }); notifyWorkspaceMutation()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建章节失败') }
  }
  const changePanel = (next: string) => {
    const change = () => { registerViewLeaveGuard?.(null); const search = new URLSearchParams(params); if (next === 'text') search.delete('panel'); else search.set('panel', next); if (chapter) search.set('chapterId', String(chapter.id)); setParams(search); setArrangementDirty(false) }
    if (arrangementDirty && next !== panel) Modal.confirm({ title: '放弃安排中的未保存修改？', okText: '放弃并切换', cancelText: '继续编辑', onOk: change })
    else change()
  }
  const afterApplied = () => { void reloadList(); void reloadStructure(); if (selectedId.current && draftRef.current === baselineRef.current) void loadChapter(selectedId.current) }
  const openRun = () => {
    const run = workflow.run
    if (!run) return
    setTaskTarget({ title: `第 ${run.atChapter} 章 · 任务结果`, stage: run.stage, atChapter: run.atChapter, count: run.count, request: run.request, changeScope: run.changeScope, chapterRevision: run.chapterRevision, sourceArtifactId: run.sourceArtifactId, revisionIssueIds: run.revisionIssueIds, runId: run.runId, artifactId: run.artifactId })
  }
  const directory = <><ChapterDirectory chapters={chapters} tree={tree} selectedId={chapter?.id || null} onChoose={chooseChapter} onCreate={() => { setNewNumber(Math.max(0, ...chapters.map(item => item.chapterNum)) + 1); setCreating(true) }} onPlan={() => setTaskTarget({ title: '规划卷章', stage: 'outline', request: '结合已有作品规划接下来一个单元，保留已有卷、单元和章节；明确每章目标、场景、承接与约束。' })} />{structureError && <LoadFailure message={structureError} retry={() => void reloadStructure()} />}</>
  const openReference = (route: string) => {
    const open = () => {
      const [path, query = ''] = route.split('?')
      const search = new URLSearchParams(query)
      if (chapter) search.set('chapterId', String(chapter.id))
      navigate(buildWorkspaceRoute(novelId, `${path}?${search}`))
    }
    if (!dirty && !arrangementDirty) { open(); return }
    Modal.confirm({ title: dirty ? '保存正文后查看资料？' : '放弃安排中的未保存修改？', content: arrangementDirty ? '安排中的未保存修改会放弃；正文会先保存，再打开完整资料。' : '保存当前正文后打开完整资料。', okText: dirty ? '保存并查看' : '放弃并查看', cancelText: '继续编辑', onOk: async () => { if (dirty && !await save()) throw new Error('保存失败，请检查正文提示'); open() } })
  }
  const contextTabs = [{ key: 'arrangement', label: '本章安排' }, { key: 'references', label: '参考资料' }, { key: 'review', label: '审校' }, { key: 'changes', label: '章后变化' }, { key: 'history', label: '本章历史' }]
  const activeContext = contextTabs.find(item => item.key === panel)
  const context = chapter && <div className="manuscript-context__body">
    {panel === 'arrangement' && <ChapterArrangement key={chapter.id} chapter={chapter} onDirtyChange={setArrangementDirty} onDiscuss={setTaskTarget} onSaved={() => { void reloadList(); if (!dirty) void loadChapter(chapter.id) }} />}
    {panel === 'changes' && <ChapterChanges key={chapter.id} chapterId={chapter.id} />}
    {panel === 'references' && <ManuscriptReferences key={chapter.id} novelId={novelId} chapterNum={chapter.chapterNum} onOpen={openReference} />}
    {panel === 'review' && <section className="manuscript-review"><ZhuqueChapterPanel chapterId={chapter.id} savedContent={chapter.content} getContent={() => draftRef.current} /><h2>正文评审</h2><Input.TextArea aria-label="本章评审要求" value={request} onChange={event => setRequest(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="本次评审重点，可留空" /><Button loading={workflow.submitting} disabled={dirty || workflow.active || !chapter.content?.trim()} onClick={() => void workflow.review(chapter.id, request.trim() || '评审本章的因果、连续性、人物与视角边界、叙事和语言，指出具体证据与修改建议。')}>仅评审第 {chapter.chapterNum} 章</Button>{dirty && <p>请先保存正文，再评审这一版。</p>}{workflow.run?.operation === 'review' && workflow.run.atChapter === chapter.chapterNum && workflow.run.result && <ContentDocument value={workflow.run.result} />}<Button type="link" disabled={workflow.active || saving} onClick={() => void generate()}>根据评审意见提出修订</Button></section>}
    {panel === 'history' && <><div className="author-manuscript__versions">{versions.length ? versions.map(version => <button className={selectedVersion?.id === version.id ? 'is-active' : ''} key={version.id} onClick={() => setSelectedVersion(version)}><span>{VERSION_LABELS[version.versionSource]} · {version.wordCount.toLocaleString()} 字</span><time>{new Date(version.createdAt).toLocaleString()}</time></button>) : <EmptyWork title="还没有历史版本" />}</div>{selectedVersion && <section className="author-version-preview"><Button onClick={() => restore(selectedVersion)}>恢复此版本</Button><pre>{selectedVersion.content}</pre></section>}</>}
  </div>

  return <div className={`author-manuscript manuscript-workspace${activeContext && screens.xl ? ' manuscript-workspace--context' : ''}`}>
    <aside className="author-manuscript__chapters">{directory}</aside>
    <section className="author-manuscript__desk" aria-label="正文工作区">
      {!chapter && <Button className="manuscript-directory-trigger" icon={<MenuOutlined />} onClick={() => setDirectoryOpen(true)}>卷章目录</Button>}
      {error && <LoadFailure message={error} retry={() => { if (!dirty && chapter) void loadChapter(chapter.id); else void save() }} />}
      {loading ? <div className="author-loading"><Spin /></div> : !chapter ? <EmptyWork title="从第一章开始" actionLabel="安排章节" action={() => setTaskTarget({ title: '安排首批章节', stage: 'outline', request: '根据现有背景、人物和卷单元安排，规划首批章节和场景。保留已有卷、单元及已确定设定。' })} /> : <>
        <div className="manuscript-sticky-header"><header className="author-manuscript__heading"><div><span className="author-eyebrow">第 {chapter.chapterNum} 章</span><h1>{chapter.title || '未命名'}</h1><small>{countChapterWords(draft).toLocaleString()} 字 · {dirty ? '有未保存修改' : '已保存'}</small></div><div className="author-heading-actions"><Button className="manuscript-directory-trigger" icon={<MenuOutlined />} onClick={() => setDirectoryOpen(true)}>卷章目录</Button><Button icon={<HistoryOutlined />} onClick={() => changePanel(panel === 'history' ? 'text' : 'history')}>本章历史</Button><Button icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存</Button></div></header>
        <div className="manuscript-toolbar"><div className="manuscript-toolbar__context" role="group" aria-label="本章辅助面板">{contextTabs.filter(item => item.key !== 'history').map(item => <Button key={item.key} size="small" aria-pressed={panel === item.key} onClick={() => changePanel(panel === item.key ? 'text' : item.key)}>{item.label}</Button>)}</div><div className="manuscript-toolbar__task"><Select aria-label="修订范围" value={revisionTarget} disabled={workflow.active || saving || !draft.trim()} onChange={setRevisionTarget} options={[{ value: 'chapter', label: '整章' }, { value: 'paragraphs', label: `选中段落${selectedParagraphs.length ? `（${selectedParagraphs.length}）` : ''}` }, { value: 'summary', label: '仅摘要' }]} /><Button type="primary" icon={<SendOutlined />} loading={workflow.submitting} disabled={workflow.active || saving || arrangementDirty} onClick={() => void generate()}>{chapter.content?.trim() ? 'AI 修订' : '生成正文'}</Button></div></div>
        </div><textarea className="author-manuscript__editor" aria-label={`第 ${chapter.chapterNum} 章正文`} value={draft} disabled={saving} onChange={(event) => { draftRef.current = event.target.value; setDraft(event.target.value); setSelectedParagraphs([]) }} onSelect={(event) => { const editor = event.currentTarget; setSelectedParagraphs(selectedChapterParagraphs(editor.value, editor.selectionStart, editor.selectionEnd)) }} placeholder="输入正文" spellCheck={false} />
      </>}
      {workflow.error && <LoadFailure message={workflow.error} retry={() => void workflow.refresh()} />}
      {workflow.run && chapter && workflow.run.atChapter === chapter.chapterNum && <RunProgress run={workflow.run} active={workflow.active} onCancel={() => void workflow.control('cancel')} onResume={() => void workflow.control('resume')} onOpenResult={openRun} />}
      {workflow.run && workflow.active && (!chapter || workflow.run.atChapter !== chapter.chapterNum) && <p className="author-muted">第 {workflow.run.atChapter} 章正在运行。<Button size="small" type="link" onClick={() => void workflow.control('cancel')}>停止</Button></p>}
    </section>
    <Drawer rootClassName={`manuscript-context-drawer${screens.xl ? ' manuscript-context-drawer--inline' : ''}`} rootStyle={screens.xl ? { position: 'relative', height: '100%', minWidth: 0, zIndex: 1 } : { position: 'fixed' }} getContainer={false} mask={!screens.xl} autoFocus={!screens.xl} title={activeContext?.label || '本章辅助'} width={screens.xl ? '100%' : 540} open={Boolean(activeContext)} destroyOnClose onClose={() => changePanel('text')}><div aria-label={`本章辅助 · ${activeContext?.label || ''}`}>{context}</div></Drawer>
    <Drawer title="卷章目录" width={340} open={directoryOpen} onClose={() => setDirectoryOpen(false)} destroyOnClose className="manuscript-directory-drawer">{directory}</Drawer>
    <ObjectTaskPanel novelId={novelId} target={taskTarget} onClose={() => setTaskTarget(null)} onApplied={afterApplied} />
    <Modal title="添加章节" open={creating} onCancel={() => setCreating(false)} onOk={() => void createChapter()} okText="添加"><div className="author-new-chapter"><label>章节序号<InputNumber min={1} precision={0} value={newNumber} onChange={(value) => setNewNumber(value || 1)} /></label><label>章节标题<Input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="可以暂不填写" /></label></div></Modal>
  </div>
}
