import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Spin } from 'antd'
import type { AgentArtifact } from '../../../shared/agent-artifacts'
import { CREATIVE_STAGE_LABELS, type CreativeRun } from '../../../shared/creative-workflow'
import type { RevisionTask } from '../../../types'
import { ContentDocument } from './ContentDocument'
import { EmptyWork, LoadFailure } from './shared'
import { callAuthorTool } from './workflow-client'
import { canApplyRunCandidate, formalReviewPresentation, reviewReportTitle, runChapterLabel } from './run-presentation'
import { loadDocumentNames } from './document-references'
import { parseDocument, recordOf } from './content-document'
import { artifactTarget } from './revision-target'
import { objectTaskFromRoute, type ObjectTaskTarget } from './object-task'
import { ARTIFACT_STATUS_LABELS, type ArtifactReference } from './candidate-record'

type Change = { path: string; fieldKey: string; before: unknown; after: unknown }

export default function CandidateReview({ novelId, artifactId, onRevise, onApplied, onSelectArtifact }: {
  novelId: number; artifactId: string; onRevise: (target: ObjectTaskTarget) => void; onApplied?: () => void; onSelectArtifact?: (id: string) => void
}) {
  const [artifact, setArtifact] = useState<AgentArtifact | null>(null)
  const [loadedId, setLoadedId] = useState('')
  const [run, setRun] = useState<CreativeRun | null>(null)
  const [review, setReview] = useState<unknown>(null)
  const [history, setHistory] = useState<Change[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState('')
  const [revisionTarget, setRevisionTarget] = useState<'original' | 'chapter' | 'summary'>('original')
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const applyingRef = useRef(false)
  const load = useCallback(async () => {
    const token = ++epoch.current
    setLoading(true); setError(''); setLoadedId(''); setReview(null); setHistory(null)
    try {
      let referenceError = ''
      const [result, tasks, nextNames] = await Promise.all([
        callAuthorTool<{ artifact: AgentArtifact }>('novelforge.artifacts.get', { artifactId }),
        callAuthorTool<{ runs: CreativeRun[] }>('novelforge.workflows.list', { novelId }),
        loadDocumentNames(novelId, value => { referenceError = value }),
      ])
      if (token !== epoch.current) return
      if (result.artifact.novelId !== novelId) throw new Error('这份内容属于另一部作品。')
      const item = result.artifact
      const relatedRun = tasks.runs.find(task => task.novelId === novelId && (task.artifactId === item.id || task.reviewArtifactId === item.id)) || null
      const related = await callAuthorTool<{ artifacts: ArtifactReference[] }>('novelforge.artifacts.list', { novelId, parentArtifactId: item.id, kind: item.status === 'committed' ? 'creative_commit' : 'creative_comparison', limit: 200 })
      const comparison = related.artifacts.find(child => child.parentArtifactId === item.id)
      const [comparisonResult, reviewResult] = await Promise.all([
        comparison ? callAuthorTool<{ artifact: AgentArtifact<{ history?: Change[] }> }>('novelforge.artifacts.get', { artifactId: comparison.id }) : null,
        item.reviewArtifactId ? callAuthorTool<{ artifact: AgentArtifact }>('novelforge.artifacts.get', { artifactId: item.reviewArtifactId }) : null,
      ])
      if (token !== epoch.current) return
      if (comparisonResult && comparisonResult.artifact.novelId !== novelId || reviewResult && reviewResult.artifact.novelId !== novelId) throw new Error('关联记录不属于当前作品。')
      setArtifact(item); setRun(relatedRun); setNames(nextNames); setReview(reviewResult?.artifact.content ?? null)
      setHistory(comparisonResult?.artifact.content.history ?? null); setLoadedId(artifactId); setError(referenceError)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取候选失败') }
    finally { if (token === epoch.current) setLoading(false) }
  }, [novelId, artifactId])
  useEffect(() => { setFeedback(''); setRevisionTarget('original'); void load(); return () => { epoch.current += 1 } }, [load])
  const current = loadedId === artifactId && artifact?.novelId === novelId ? artifact : null
  const apply = async () => {
    if (applyingRef.current || !current || !canApplyRunCandidate(run, current)) return
    applyingRef.current = true; setApplying(true); setError('')
    const token = epoch.current
    try {
      await callAuthorTool('novelforge.workflows.apply', { novelId, runId: run!.runId })
      window.dispatchEvent(new Event('novelforge:creative-completed'))
      onApplied?.()
      if (token === epoch.current) await load()
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '应用候选失败') }
    finally { applyingRef.current = false; setApplying(false) }
  }
  const revise = async () => {
    if (!current || !run || !feedback.trim() || preparing) return
    setPreparing(true); setError('')
    const token = epoch.current
    try {
      const issues = run.operation === 'review' ? await window.electron.revision.list(novelId) : []
      const sources = [...new Set((run.operation === 'review' ? run.revisionIssueIds || [] : []).map(id => {
        const issue: RevisionTask | undefined = issues.find(row => row.id === id)
        if (!issue) throw new Error('修订问题已不在当前列表，请刷新后重试。')
        const meta = recordOf(parseDocument(issue.originMetaJson))
        return meta.repairArtifactId || meta.candidateArtifactId
      }))]
      if (sources.length > 1) throw new Error('这些问题属于不同候选，请分别修订。')
      const route = artifactTarget({ ...run, ...(typeof sources[0] === 'string' ? { sourceArtifactId: sources[0] } : {}) }, current.id, feedback.trim(), run.operation === 'review' ? current.content : undefined)
      const target = objectTaskFromRoute(route, `${CREATIVE_STAGE_LABELS[run.stage]} · ${runChapterLabel(run)}`)
      if (run.stage === 'chapter') target.chapterRevision = revisionTarget === 'summary' ? { target: 'summary' } : revisionTarget === 'original' ? run.chapterRevision : undefined
      if (token === epoch.current) onRevise(target)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取修订目标失败') }
    finally { if (token === epoch.current) setPreparing(false) }
  }
  const raw = recordOf(current?.content)
  const candidate = current?.kind === 'quality_report' ? formalReviewPresentation(current.content) : parseDocument(raw.output ?? current?.content)
  const changes = run?.operation === 'review' ? [] : history || []
  return <section className="candidate-review" aria-label="候选与评审">
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {loading ? <div className="author-loading"><Spin /></div> : current ? <>
      <header className="candidate-review-heading"><div><span className="author-eyebrow">{run ? `${runChapterLabel(run)} · ${CREATIVE_STAGE_LABELS[run.stage]}` : ''}</span><h2>{current.kind === 'quality_report' ? reviewReportTitle(current.content, run || undefined) : `${ARTIFACT_STATUS_LABELS[current.status]} · 版本 ${current.version}`}</h2></div><span className="author-muted">{current.status === 'committed' ? '已写入正式内容' : '独立保存的候选'}</span></header>
      {typeof run?.result?.supersededByArtifactId === 'string' && onSelectArtifact && <Button onClick={() => onSelectArtifact(String(run.result!.supersededByArtifactId))}>查看后续修订版</Button>}
      {changes.length > 0 && <section className="author-candidate-diff" aria-label="当前内容与本轮候选比较"><h3>这一版的变更记录</h3>{changes.map((change, index) => <article className="author-change-card" key={`${change.path}-${index}`}><h4>{change.path}</h4><div className="author-diff-columns"><section><h4>保存前</h4><ContentDocument value={change.before} names={names} fieldKey={change.fieldKey} /></section><section><h4>{current.status === 'committed' ? '本次保存' : '本轮候选'}</h4><ContentDocument value={change.after} names={names} fieldKey={change.fieldKey} /></section></div></article>)}</section>}
      {history === null && current.kind === 'generic_draft' && <p className="author-muted">此版本未保存比较快照，仅展示完整内容。</p>}
      <details open={changes.length === 0} className="author-disclosure"><summary>{run?.operation === 'review' ? '完整评审' : '完整内容'}</summary><ContentDocument value={candidate} names={names} /></details>
      {review != null && <section className="author-review-result"><h2>{reviewReportTitle(review)}</h2><ContentDocument value={formalReviewPresentation(review)} names={names} /></section>}
      {current.parentArtifactId && onSelectArtifact && <Button type="link" onClick={() => onSelectArtifact(current.parentArtifactId!)}>查看上一版依据</Button>}
      {run ? <section className="author-version-discussion"><label htmlFor="object-version-feedback">针对这一版，接下来怎样调整？</label><Input.TextArea id="object-version-feedback" value={feedback} disabled={applying || preparing} onChange={event => setFeedback(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="说明要保留和修改的内容，原目标与候选依据自动带入。" />{run.stage === 'chapter' && run.operation !== 'review' && <Select aria-label="候选修订范围" value={revisionTarget} onChange={setRevisionTarget} options={[{ value: 'original', label: '沿用原修订范围' }, { value: 'chapter', label: '整章' }, { value: 'summary', label: '仅摘要' }]} />}</section> : <p className="author-muted">无法定位原任务，请在对应资料重新发起修订。</p>}
      <footer className="candidate-review-actions">{canApplyRunCandidate(run, current) && <Button type="primary" loading={applying} disabled={preparing} onClick={() => void apply()}>应用这一版</Button>}{run && <Button disabled={!feedback.trim() || applying} loading={preparing} onClick={() => void revise()}>继续修订原目标</Button>}</footer>
    </> : !error && <EmptyWork title="未读到这份候选" />}
  </section>
}
