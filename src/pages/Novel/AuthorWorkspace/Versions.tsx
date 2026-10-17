import React, { useCallback, useEffect, useState } from 'react'
import { Button, Checkbox, Input, Pagination, Select, Spin } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CREATIVE_STAGES, CREATIVE_STAGE_LABELS, type CreativeRun, type CreativeStage } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { Chapter, RevisionTask } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure, RunProgress } from './shared'
import { callAuthorTool, isRunActive, runStatusLabel } from './workflow-client'
import { runChapterLabel, runResultPresentation, reviewReportTitle } from './run-presentation'
import { parseDocument, recordOf } from './content-document'
import { issueTarget, formalIssueReviewTarget } from './revision-target'
import { loadDocumentNames } from './document-references'
import CandidateReview from './CandidateReview'
import { ARTIFACT_STATUS_LABELS, type ArtifactReference } from './candidate-record'
import ObjectTaskPanel, { type ObjectTaskTarget } from './ObjectTaskPanel'
import { objectTaskFromRoute } from './object-task'

function artifactTitle(item: ArtifactReference, runs: CreativeRun[], names: Record<string, string>) {
  const run = runs.find(task => task.artifactId === item.id || task.reviewArtifactId === item.id)
  if (item.kind.includes('review') || item.kind === 'quality_report') return run ? `${CREATIVE_STAGE_LABELS[run.stage]} · ${reviewReportTitle(undefined, run)}` : '评审报告'
  return run ? runResultPresentation(run, undefined, names).title : item.kind === 'creative_commit' ? '保存记录' : '创作内容'
}

export default function Versions({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const view = params.get('artifact') ? 'versions' : params.get('issue') ? 'issues' : params.get('view') || 'versions'
  const artifactId = params.get('artifact') || ''
  const [runs, setRuns] = useState<CreativeRun[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const [issues, setIssues] = useState<RevisionTask[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [query, setQuery] = useState('')
  const [stage, setStage] = useState<CreativeStage | 'all'>('all')
  const [atChapter, setAtChapter] = useState<number | 'all'>('all')
  const [page, setPage] = useState(1)
  const [task, setTask] = useState<ObjectTaskTarget | null>(null)
  const [recheckingIssueId, setRecheckingIssueId] = useState<number | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    let referenceError = ''
    try {
      const [tasks, versions, nextIssues, rows, nextNames] = await Promise.all([
        callAuthorTool<{ runs: CreativeRun[] }>('novelforge.workflows.list', { novelId }),
        callAuthorTool<{ artifacts: ArtifactReference[] }>('novelforge.artifacts.list', { novelId, limit: 200 }),
        window.electron.revision.list(novelId), window.electron.chapter.list(novelId), loadDocumentNames(novelId, value => { referenceError = value }),
      ])
      setRuns(tasks.runs); setArtifacts(versions.artifacts); setIssues(nextIssues); setChapters(rows); setNames(nextNames); setError(referenceError)
      setSelectedRunId(current => tasks.runs.some(run => run.runId === current) ? current : tasks.runs[0]?.runId || null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取版本记录失败') }
    finally { setLoading(false) }
  }, [novelId])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const refresh = () => { void load() }; window.addEventListener('novelforge:creative-completed', refresh); return () => window.removeEventListener('novelforge:creative-completed', refresh) }, [load])
  const selectedRun = runs.find(run => run.runId === selectedRunId)
  useEffect(() => {
    if (!selectedRun || !isRunActive(selectedRun)) return
    let alive = true
    const timer = window.setTimeout(() => {
      void callAuthorTool<{ run: CreativeRun | null }>('novelforge.workflows.get', { novelId, runId: selectedRun.runId }).then(({ run }) => {
        if (!alive || !run) return
        setRuns(current => current.map(item => item.runId === run.runId ? run : item))
        if (run.step === 'completed' || run.step === 'needs_attention') { window.dispatchEvent(new Event('novelforge:creative-completed')); void load() }
      }).catch(cause => { if (alive) setError(String(cause)) })
    }, 1600)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [selectedRun, novelId, load])
  useEffect(() => setPage(1), [view, query, stage, atChapter, showHistory])
  const switchView = (next: string) => { const p = new URLSearchParams(params); p.set('view', next); p.delete('artifact'); p.delete('issue'); setParams(p) }
  const selectArtifact = (id: string) => { const p = new URLSearchParams(params); p.set('artifact', id); p.delete('issue'); setParams(p) }
  const matchesRun = (run: CreativeRun | undefined) => (stage === 'all' || run?.stage === stage) && (atChapter === 'all' || run?.atChapter === atChapter)
  const q = query.trim().toLocaleLowerCase()
  const visibleArtifacts = artifacts.filter(item => item.kind !== 'creative_comparison' && (showHistory || !['superseded', 'rejected', 'committed'].includes(item.status)) && matchesRun(runs.find(run => run.artifactId === item.id || run.reviewArtifactId === item.id)) && (!q || artifactTitle(item, runs, names).toLocaleLowerCase().includes(q)))
  const visibleRuns = runs.filter(run => matchesRun(run) && (!q || `${run.request} ${runResultPresentation(run, undefined, names).title}`.toLocaleLowerCase().includes(q)))
  const visibleIssues = issues.filter(issue => (String(issue.id) === params.get('issue') || showHistory || ['open', 'in_progress'].includes(issue.status)) && (atChapter === 'all' || chapters.find(chapter => chapter.id === issue.chapterId)?.chapterNum === atChapter) && (stage === 'all' || recordOf(parseDocument(issue.originMetaJson)).stage === stage) && (!q || `${issue.title} ${issue.description || ''}`.toLocaleLowerCase().includes(q)))
  const control = async (action: 'cancel' | 'resume', run: CreativeRun) => { try { await callAuthorTool(`novelforge.workflows.${action}`, { novelId, runId: run.runId }); await load() } catch (cause) { setError(String(cause)) } }
  const editIssue = async (issue: RevisionTask, status: RevisionTask['status']) => { try { await window.electron.revision.update(issue.id, { status }); await load() } catch (cause) { setError(String(cause)) } }
  const recheckIssue = async (issue: RevisionTask) => {
    setRecheckingIssueId(issue.id)
    try {
      const { run } = await callAuthorTool<{ run: CreativeRun }>('novelforge.workflows.start', { novelId, ...formalIssueReviewTarget(issue), request: `复核正式内容是否仍存在以下问题，并检查指定对象：${issue.title}\n${issue.description || ''}`, idempotencyKey: `recheck:${crypto.randomUUID()}` })
      setSelectedRunId(run.runId); switchView('runs'); await load()
    } catch (cause) { setError(String(cause)) }
    finally { setRecheckingIssueId(null) }
  }
  const length = view === 'versions' ? visibleArtifacts.length : view === 'runs' ? visibleRuns.length : visibleIssues.length
  const pageSize = 20
  const pointedIssueIndex = view === 'issues' && params.has('issue') ? visibleIssues.findIndex(issue => String(issue.id) === params.get('issue')) : -1
  const currentPage = pointedIssueIndex >= 0 ? Math.floor(pointedIssueIndex / pageSize) + 1 : Math.min(page, Math.max(1, Math.ceil(length / pageSize)))
  const slice = <T,>(rows: T[]) => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const changePage = (value: number) => {
    if (view === 'issues' && params.has('issue')) { const next = new URLSearchParams(params); next.delete('issue'); next.set('view', 'issues'); setParams(next) }
    setPage(value)
  }
  return <AuthorPage title="版本与问题" actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>}>
    <div className="author-atlas-toolbar"><div className="author-tabs" role="tablist">{[{ key: 'versions', label: '候选与评审' }, { key: 'issues', label: '待处理问题' }, { key: 'runs', label: '任务记录' }].map(tab => <button key={tab.key} role="tab" aria-selected={view === tab.key} onClick={() => switchView(tab.key)}>{tab.label}</button>)}</div><Checkbox checked={showHistory} onChange={event => setShowHistory(event.target.checked)}>显示历史与已处理</Checkbox></div>
    <div className="author-history-filters"><Input.Search aria-label="按对象或内容查找版本" value={query} onChange={event => setQuery(event.target.value)} placeholder="人物、章节或问题关键词" allowClear /><Select aria-label="版本内容类型" value={stage} onChange={setStage} options={[{ value: 'all', label: '全部内容类型' }, ...CREATIVE_STAGES.map(value => ({ value, label: CREATIVE_STAGE_LABELS[value] }))]} /><Select aria-label="版本章节" value={atChapter} onChange={setAtChapter} options={[{ value: 'all', label: '全部章节' }, { value: 0, label: '初始设定' }, ...chapters.map(chapter => ({ value: chapter.chapterNum, label: `第 ${chapter.chapterNum} 章 · ${chapter.title}` }))]} /></div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {loading && !runs.length && !artifacts.length ? <Spin /> : view === 'runs' ? <div className="author-history-layout"><div className="author-history-list">{slice(visibleRuns).map(run => <button key={run.runId} className={selectedRunId === run.runId ? 'is-selected' : ''} onClick={() => setSelectedRunId(run.runId)}><small>{run.operation === 'review' ? '仅评审' : CREATIVE_STAGE_LABELS[run.stage]} · {runStatusLabel(run)} · {runChapterLabel(run)}</small><strong>{runResultPresentation(run, undefined, names).title}</strong><time>{run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}</time></button>)}{!visibleRuns.length && <EmptyWork title="没有匹配的任务记录" />}</div><section>{selectedRun && <RunProgress run={selectedRun} names={names} active={isRunActive(selectedRun)} onCancel={() => void control('cancel', selectedRun)} onResume={() => void control('resume', selectedRun)} onOpenResult={() => { if (selectedRun.artifactId) selectArtifact(selectedRun.artifactId) }} />}</section></div> : view === 'versions' ? <div className="author-history-layout"><div className="author-history-list">{slice(visibleArtifacts).map(item => <button key={item.id} className={artifactId === item.id ? 'is-selected' : ''} onClick={() => selectArtifact(item.id)}><small>{ARTIFACT_STATUS_LABELS[item.status]} · 版本 {item.version}</small><strong>{artifactTitle(item, runs, names)}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></button>)}{!visibleArtifacts.length && <EmptyWork title="没有匹配的候选" />}{artifacts.length >= 200 && <p className="author-muted">最近 200 份内容，可按类型与章节筛选</p>}</div><section className="author-paper author-version-detail">{artifactId ? <CandidateReview key={artifactId} novelId={novelId} artifactId={artifactId} onRevise={setTask} onApplied={() => void load()} onSelectArtifact={selectArtifact} /> : <EmptyWork title="选择一份候选或评审" />}</section></div> : <section className="author-paper">{visibleIssues.length ? <div className="author-problem-list">{slice(visibleIssues).map(issue => {
      const meta = recordOf(parseDocument(issue.originMetaJson)), modelIssue = meta.issueCategory === 'creative_review'
      const canRecheck = modelIssue && CREATIVE_STAGES.includes(meta.stage as CreativeStage)
      return <article key={issue.id} className={String(issue.id) === params.get('issue') ? 'is-selected' : ''}><div><small>{modelIssue && `${meta.candidateArtifactId ? '候选评审' : meta.stage === 'chapter' ? '正式正文评审' : '正式资料评审'} · `}{issue.severity === 'high' ? '优先处理' : '待核对'} · {issue.status === 'resolved' ? '已解决' : issue.status === 'ignored' ? '已忽略' : issue.status === 'in_progress' ? '已修订，待复核' : '待处理'}{issue.chapterId ? ` · 第 ${chapters.find(item => item.id === issue.chapterId)?.chapterNum ?? '?'} 章` : ''}</small><h2>{issue.title}</h2><p>{issue.description || '暂无进一步说明。'}</p>{issue.fixBrief && <p>修订建议：{issue.fixBrief}</p>}</div><div className="author-heading-actions">
        {typeof meta.reviewArtifactId === 'string' && <Button onClick={() => selectArtifact(String(meta.reviewArtifactId))}>评审依据</Button>}
        {canRecheck && <Button loading={recheckingIssueId === issue.id} disabled={recheckingIssueId !== null} onClick={() => void recheckIssue(issue)}>{meta.stage === 'chapter' ? '复核正式正文' : '复核正式资料'}</Button>}
        {issue.chapterId && <Button onClick={() => navigate(buildWorkspaceRoute(novelId, `writing/editor?chapterId=${issue.chapterId}&panel=review`))}>定位章节</Button>}
        <Button onClick={() => { try { setTask(objectTaskFromRoute(issueTarget(issue, chapters), issue.title)) } catch (cause) { setError(String(cause)) } }}>生成修订候选</Button><Button onClick={() => void editIssue(issue, issue.status === 'resolved' ? 'open' : 'resolved')}>{issue.status === 'resolved' ? '重新打开' : '确认已解决'}</Button>
      </div></article>
    })}</div> : <EmptyWork title="没有匹配的待处理问题" />}</section>}
    {length > pageSize && <Pagination size="small" current={currentPage} pageSize={pageSize} total={length} showSizeChanger={false} onChange={changePage} />}
    <ObjectTaskPanel novelId={novelId} target={task} onClose={() => setTask(null)} onApplied={() => void load()} />
  </AuthorPage>
}
