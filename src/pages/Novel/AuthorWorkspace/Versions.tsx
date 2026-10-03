import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, Spin } from 'antd'
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentArtifact } from '../../../shared/agent-artifacts'
import { CREATIVE_STAGE_LABELS, type CreativeRun } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { Chapter, Novel, RevisionTask } from '../../../types'
import type { StoryAtlasSnapshot } from '../../../shared/story-atlas'
import { parseStorySettingsDocument } from '../../../shared/story-settings'
import { parseThemeVoiceDocument } from '../../../shared/theme-voice'
import { AuthorPage, EmptyWork, LoadFailure, RunProgress } from './shared'
import { callAuthorTool, isRunActive, runStatusLabel } from './workflow-client'
import { runChapterLabel, runResultPresentation } from './run-presentation'
import { ContentDocument } from './ContentDocument'
import { changedFields, parseDocument, recordOf } from './content-document'
import { artifactTarget, issueTarget } from './revision-target'
import { loadDocumentNames } from './document-references'

type ArtifactReference = Omit<AgentArtifact, 'content' | 'idempotencyKey'>
const STATUS_LABELS: Record<string, string> = { draft: '候选', reviewed: '已评审', approved: '已认可', committed: '已保存', rejected: '未通过', superseded: '旧版本' }
function candidateValue(content: unknown) { const data = recordOf(content); return parseDocument(data.output ?? content) }
function patchShape(current: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return current
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, patchShape(recordOf(current)[key], value)]))
}
function artifactListTitle(item: ArtifactReference, runs: CreativeRun[], names: Record<string, string>): string {
  const run = runs.find(candidate => candidate.artifactId === item.id || candidate.reviewArtifactId === item.id)
  if (item.kind.includes('review') || item.kind === 'quality_report') return run ? `${CREATIVE_STAGE_LABELS[run.stage]} · 评审报告` : '评审报告'
  if (run) return runResultPresentation(run, undefined, names).title
  return item.kind === 'creative_commit' ? '保存记录' : '创作内容'
}

export default function Versions({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState(params.get('artifact') ? 'versions' : params.get('issue') ? 'issues' : params.get('view') || 'runs')
  const [runs, setRuns] = useState<CreativeRun[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const [issues, setIssues] = useState<RevisionTask[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [novel, setNovel] = useState<Novel | null>(null)
  const [atlas, setAtlas] = useState<StoryAtlasSnapshot | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [selectedRun, setSelectedRun] = useState<CreativeRun | null>(null)
  const [artifact, setArtifact] = useState<(ArtifactReference & { content: unknown }) | null>(null)
  const [review, setReview] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [applying, setApplying] = useState(false)
  const [preparingRevision, setPreparingRevision] = useState(false)
  const readEpoch = useRef(0)
  const load = useCallback(async () => {
    setLoading(true)
    let referenceError = ''
    try {
      const [runResult, artifactResult, nextIssues, rows, project, snapshot, nextNames] = await Promise.all([
        callAuthorTool<{ runs: CreativeRun[] }>('novelforge.workflows.list', { novelId }),
        callAuthorTool<{ artifacts: ArtifactReference[] }>('novelforge.artifacts.list', { novelId, limit: 200 }),
        window.electron.revision.list(novelId), window.electron.chapter.list(novelId), window.electron.novel.get(novelId), window.electron.storyAtlas.query({ novelId, includePlanned: true }),
        loadDocumentNames(novelId, value => { referenceError = value }),
      ])
      setRuns(runResult.runs); setArtifacts(artifactResult.artifacts); setIssues(nextIssues); setChapters(rows); setNovel(project); setAtlas(snapshot); setNames(nextNames); setError(referenceError)
      setSelectedRun(current => runResult.runs.find(run => run.runId === current?.runId) || runResult.runs[0] || null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取版本记录失败') }
    finally { setLoading(false) }
  }, [novelId])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!selectedRun || !isRunActive(selectedRun)) return
    let alive = true
    const timer = window.setTimeout(() => {
      void callAuthorTool<{ run: CreativeRun | null }>('novelforge.workflows.get', { novelId, runId: selectedRun.runId }).then(({ run }) => {
        if (!alive || !run) return
        setSelectedRun(run); setRuns(current => current.map(item => item.runId === run.runId ? run : item))
        if (run.step === 'completed') { window.dispatchEvent(new Event('novelforge:creative-completed')); void load() }
      }).catch(cause => { if (alive) setError(String(cause)) })
    }, 1600)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [novelId, selectedRun, load])
  const openArtifact = useCallback(async (id: string) => {
    const epoch = ++readEpoch.current
    setReading(true); setReview(null)
    try {
      const result = await callAuthorTool<{ artifact: ArtifactReference & { content: unknown } }>('novelforge.artifacts.get', { artifactId: id })
      if (epoch !== readEpoch.current) return
      if (result.artifact.novelId !== novelId) throw new Error('这份内容属于另一部作品。')
      setArtifact(result.artifact); setFeedback(''); setError('')
      if (result.artifact.reviewArtifactId) {
        const reviewResult = await callAuthorTool<{ artifact: { content: unknown } }>('novelforge.artifacts.get', { artifactId: result.artifact.reviewArtifactId })
        if (epoch === readEpoch.current) setReview(reviewResult.artifact.content)
      }
    } catch (cause) { if (epoch === readEpoch.current) setError(cause instanceof Error ? cause.message : '读取版本失败') }
    finally { if (epoch === readEpoch.current) setReading(false) }
  }, [novelId])
  useEffect(() => { const id = params.get('artifact'); if (id) { setView('versions'); void openArtifact(id) } else if (params.get('issue')) setView('issues') }, [params, openArtifact])
  useEffect(() => () => { readEpoch.current += 1 }, [])
  const artifactRun = runs.find(run => run.artifactId === artifact?.id || run.reviewArtifactId === artifact?.id)
  const candidate = candidateValue(artifact?.content)
  const parsed = recordOf(candidate)
  const story = parseStorySettingsDocument(novel?.settingsJson)
  const currentChapter = chapters.find(item => item.chapterNum === (artifactRun?.atChapter || parsed.chapterNum))
  const currentDocument = { ...story, themeVoice: parseThemeVoiceDocument(novel?.themeVoiceJson), worldRules: parseDocument(novel?.worldRulesJson), background: novel?.userBackground, userBackground: novel?.userBackground, expandedBackground: novel?.expandedBackground, synopsis: novel?.synopsis, title: currentChapter?.title || novel?.title, content: currentChapter?.content, summary: currentChapter?.summary, chapterNum: currentChapter?.chapterNum }
  const changes = artifactRun?.operation === 'review' ? [] : Array.isArray(parsed.changes) ? parsed.changes.map(change => {
    const value = recordOf(change)
    const existing = [...(atlas?.entities || []), ...(atlas?.relations || [])].find(item => item.id === value.id)
    const after = { ...value }; delete after.op
    return { path: String(value.name || value.label || '设定变化'), fieldKey: '', before: existing ? patchShape(existing, after) : null, after }
  }) : Object.keys(parsed).length ? changedFields(patchShape(currentDocument, parsed), parsed) : []
  const visibleArtifacts = artifacts.filter(item => showHistory || !['superseded', 'rejected'].includes(item.status))
  const visibleIssues = issues.filter(issue => showHistory || ['open', 'in_progress'].includes(issue.status))
  const control = async (action: 'cancel' | 'resume', run: CreativeRun) => { try { await callAuthorTool(`novelforge.workflows.${action}`, { novelId, runId: run.runId }); await load() } catch (cause) { setError(String(cause)) } }
  const editIssue = async (issue: RevisionTask, status: RevisionTask['status']) => { try { await window.electron.revision.update(issue.id, { status }); await load() } catch (cause) { setError(String(cause)) } }
  const continueRevision = async () => {
    if (!artifact || !artifactRun || !feedback.trim()) return
    setPreparingRevision(true)
    try {
      let reportContent: unknown
      if (artifactRun.operation === 'review') {
        const result = await callAuthorTool<{ artifact: ArtifactReference & { content: unknown } }>('novelforge.artifacts.get', { artifactId: artifact.id })
        if (result.artifact.novelId !== novelId || result.artifact.kind !== 'quality_report') throw new Error('未能读取本章评审报告，请重新打开后再试。')
        reportContent = result.artifact.content
      }
      navigate(buildWorkspaceRoute(novelId, artifactTarget(artifactRun, artifact.id, feedback.trim(), reportContent)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取评审意见失败') }
    finally { setPreparingRevision(false) }
  }

  return <AuthorPage title="版本与问题" actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>}>
    <div className="author-atlas-toolbar"><div className="author-tabs" role="tablist">{[{ key: 'runs', label: '创作记录' }, { key: 'versions', label: '内容版本' }, { key: 'issues', label: '待处理问题' }].map(tab => <button key={tab.key} role="tab" aria-selected={view === tab.key} onClick={() => setView(tab.key)}>{tab.label}</button>)}</div><Checkbox checked={showHistory} onChange={event => setShowHistory(event.target.checked)}>显示历史与已处理</Checkbox></div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {loading && !runs.length && !artifacts.length ? <Spin /> : view === 'runs' ? runs.length ? <div className="author-history-layout"><div className="author-history-list">{runs.map(run => <button key={run.runId} className={selectedRun?.runId === run.runId ? 'is-selected' : ''} onClick={() => setSelectedRun(run)}><small>{run.operation === 'review' ? '仅评审' : CREATIVE_STAGE_LABELS[run.stage]} · {runStatusLabel(run)} · {runChapterLabel(run)}</small><strong>{runResultPresentation(run, undefined, names).title}</strong><time>{run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}</time></button>)}</div><div>{selectedRun && <RunProgress run={selectedRun} names={names} active={isRunActive(selectedRun)} onCancel={() => void control('cancel', selectedRun)} onResume={() => void control('resume', selectedRun)} onOpenResult={() => setParams({ artifact: selectedRun.artifactId || '' })} />}</div></div> : <EmptyWork title="还没有创作记录">创作与独立评审的过程会保存在这里。</EmptyWork> : view === 'versions' ? <div className="author-history-layout"><div className="author-history-list">{visibleArtifacts.map(item => <button key={item.id} className={artifact?.id === item.id ? 'is-selected' : ''} onClick={() => setParams({ artifact: item.id })}><small>{STATUS_LABELS[item.status]} · 版本 {item.version}</small><strong>{artifactListTitle(item, runs, names)}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></button>)}{artifacts.length >= 200 && <p className="author-muted">当前列出最近 200 份内容。旧内容可从对应创作记录进入。</p>}</div><section className="author-paper author-version-detail">{reading ? <Spin /> : artifact ? <>
      <div className="author-section-heading"><h2>{artifactRun?.operation === 'review' ? '章节评审报告' : `${STATUS_LABELS[artifact.status]} · 版本 ${artifact.version}`}</h2><small>{artifactRun ? `${runChapterLabel(artifactRun)} · ${CREATIVE_STAGE_LABELS[artifactRun.stage]}` : ''}</small></div>
      {artifactRun?.operation !== 'review' && artifact.status !== 'committed' && artifactRun?.reviewStatus === 'passed' && <Button type="primary" loading={applying} onClick={() => {
        setApplying(true)
        void callAuthorTool('novelforge.workflows.apply', { novelId, runId: artifactRun.runId }).then(async () => { await load(); await openArtifact(artifact.id); window.dispatchEvent(new Event('novelforge:creative-completed')) }).catch(cause => setError(String(cause))).finally(() => setApplying(false))
      }}>应用这一版</Button>}
      {changes.length > 0 && <section className="author-candidate-diff"><h3>与当前已保存内容的差异</h3><p className="author-muted">仅列出候选涉及的字段；未涉及的内容保留。</p>{changes.map((change, index) => <article className="author-change-card" key={`${change.path}-${index}`}><h4>{change.path}</h4><div className="author-diff-columns"><section><h4>当前已保存</h4><ContentDocument value={change.before} names={names} fieldKey={change.fieldKey} /></section><section><h4>本轮候选</h4><ContentDocument value={change.after} names={names} fieldKey={change.fieldKey} /></section></div></article>)}</section>}
      <details open={changes.length === 0} className="author-disclosure"><summary>{artifactRun?.operation === 'review' ? '完整评审' : '完整内容'}</summary><ContentDocument value={candidate} names={names} /></details>
      {review != null && <section className="author-review-result"><h2>这一版的评审</h2><ContentDocument value={review} names={names} /></section>}
      {artifact.parentArtifactId && <Button type="link" onClick={() => setParams({ artifact: artifact.parentArtifactId! })}>查看上一版依据</Button>}
      {artifactRun ? <div className="author-version-discussion"><label htmlFor="version-feedback">针对这一版，接下来怎样调整？</label><Input.TextArea id="version-feedback" value={feedback} onChange={event => setFeedback(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="说明要保留什么、修改什么。目标章节和候选依据会自动带入。" /><Button disabled={!feedback.trim()} loading={preparingRevision} onClick={() => void continueRevision()}>继续修订原目标 <ArrowRightOutlined /></Button></div> : <p className="author-muted">此历史内容没有可定位的创作任务。请到对应章节或资料提出修订，避免误改目标。</p>}
    </> : <EmptyWork title="选择一个版本">查看完整内容、差异与评审。</EmptyWork>}</section></div> : <section className="author-paper">{visibleIssues.length ? <div className="author-problem-list">{visibleIssues.map(issue => <article key={issue.id} className={String(issue.id) === params.get('issue') ? 'is-selected' : ''}><div><small>{issue.severity === 'high' ? '优先处理' : '待核对'} · {issue.status === 'resolved' ? '已解决' : issue.status === 'ignored' ? '已忽略' : '待处理'}{issue.chapterId ? ` · 第 ${chapters.find(item => item.id === issue.chapterId)?.chapterNum ?? '?'} 章` : ''}</small><h2>{issue.title}</h2><p>{issue.description || '暂无进一步说明。'}</p>{issue.fixBrief && <p>修订建议：{issue.fixBrief}</p>}</div><div className="author-heading-actions">{issue.chapterId && <Button onClick={() => navigate(buildWorkspaceRoute(novelId, `writing/editor?chapterId=${issue.chapterId}&panel=review`))}>定位章节</Button>}<Button onClick={() => { try { navigate(buildWorkspaceRoute(novelId, issueTarget(issue, chapters))) } catch (cause) { setError(String(cause)) } }}>生成修订候选</Button><Button onClick={() => void editIssue(issue, issue.status === 'resolved' ? 'open' : 'resolved')}>{issue.status === 'resolved' ? '重新打开' : '确认已解决'}</Button></div></article>)}</div> : <EmptyWork title="没有待处理的问题">评审记录与待处理事项会集中显示在这里。</EmptyWork>}</section>}
  </AuthorPage>
}
