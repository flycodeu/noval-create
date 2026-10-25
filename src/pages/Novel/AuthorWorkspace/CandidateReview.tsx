import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { useScopedState } from '@/hooks/useScopedState'
import React, { useCallback, useEffect, useRef } from 'react'
import { Button, Input, Select, Spin } from 'antd'
import type { AgentArtifact } from '../../../shared/agent-artifacts'
import { CREATIVE_STAGE_LABELS, type CreativeRun } from '../../../shared/creative-workflow'
import type { RevisionTask } from '../../../types'
import { getUserFacingMessage } from '../../../utils/user-facing-message'
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

async function readCandidateSnapshot(novelId: number, artifactId: string) {
  let referenceError = ''
  const [result, tasks, nextNames] = await Promise.all([
    callAuthorTool<{ artifact: AgentArtifact }>('novelforge.artifacts.get', { artifactId }),
    callAuthorTool<{ runs: CreativeRun[] }>('novelforge.workflows.list', { novelId }),
    loadDocumentNames(novelId, value => { referenceError = value }),
  ])
  if (result.artifact.novelId !== novelId) throw new Error(getUserFacingMessage('workspace.candidate.wrongNovel'))
  const item = result.artifact
  const relatedRun = tasks.runs.find(task => task.novelId === novelId && (task.artifactId === item.id || task.reviewArtifactId === item.id)) || null
  const related = await callAuthorTool<{ artifacts: ArtifactReference[] }>('novelforge.artifacts.list', { novelId, parentArtifactId: item.id, kind: item.status === 'committed' ? 'creative_commit' : 'creative_comparison', limit: 200 })
  const comparison = related.artifacts.find(child => child.parentArtifactId === item.id)
  const [comparisonResult, reviewResult] = await Promise.all([
    comparison ? callAuthorTool<{ artifact: AgentArtifact<{ history?: Change[] }> }>('novelforge.artifacts.get', { artifactId: comparison.id }) : null,
    item.reviewArtifactId ? callAuthorTool<{ artifact: AgentArtifact }>('novelforge.artifacts.get', { artifactId: item.reviewArtifactId }) : null,
  ])
  if ((comparisonResult && comparisonResult.artifact.novelId !== novelId) || (reviewResult && reviewResult.artifact.novelId !== novelId)) {
    throw new Error(getUserFacingMessage('workspace.candidate.relatedRecordWrongNovel'))
  }
  return {
    artifact: item,
    run: relatedRun,
    names: nextNames,
    review: reviewResult?.artifact.content ?? null,
    history: comparisonResult?.artifact.content.history ?? null,
    referenceError,
  }
}

function resolveRevisionSources(issues: RevisionTask[], run: CreativeRun): string[] {
  if (run.operation !== 'review') return []
  const sources: string[] = []
  for (const id of run.revisionIssueIds || []) {
    const issue = issues.find(row => row.id === id)
    if (!issue) throw new Error(getUserFacingMessage('workspace.candidate.revisionIssueMissing'))
    const meta = recordOf(parseDocument(issue.originMetaJson))
    const sourceId = meta.repairArtifactId || meta.candidateArtifactId
    if (typeof sourceId === 'string' && sourceId && !sources.includes(sourceId)) {
      sources.push(sourceId)
    }
  }
  return sources
}

async function buildReviseTarget(novelId: number, run: CreativeRun, current: AgentArtifact, feedback: string, revisionTarget: 'original' | 'chapter' | 'summary') {
  const issues = run.operation === 'review' ? await window.electron.revision.list(novelId) : []
  const sources = resolveRevisionSources(issues, run)
  if (sources.length > 1) throw new Error(getUserFacingMessage('workspace.candidate.mixedRevisionSources'))
  const route = artifactTarget({ ...run, ...(typeof sources[0] === 'string' ? { sourceArtifactId: sources[0] } : {}) }, current.id, feedback.trim(), run.operation === 'review' ? current.content : undefined)
  const target = objectTaskFromRoute(route, `${CREATIVE_STAGE_LABELS[run.stage]} · ${runChapterLabel(run)}`)
  if (run.stage === 'chapter') {
    target.chapterRevision = revisionTarget === 'summary' ? { target: 'summary' } : revisionTarget === 'original' ? run.chapterRevision : undefined
  }
  return target
}

function resolveCandidateContent(current: AgentArtifact | null) {
  if (!current) return null
  if (current.kind === 'quality_report') return formalReviewPresentation(current.content)
  const raw = recordOf(current.content)
  return parseDocument(raw.output ?? current.content)
}

function resolveCandidateChanges(run: CreativeRun | null, history: Change[] | null): Change[] {
  if (run?.operation === 'review') return []
  return history || []
}

function resolveCandidateErrorMessage(actionError: string, readError: unknown, referenceError?: string): string {
  if (actionError) return actionError
  if (readError) return String(readError)
  return referenceError || ''
}

function CandidateDiffSection({
  changes,
  names,
  isCommitted,
}: {
  changes: Change[]
  names: Record<string, string>
  isCommitted: boolean
}) {
  return (
    <section className="author-candidate-diff" aria-label="当前内容与本轮候选比较">
      <h3>这一版的变更记录</h3>
      {changes.map((change, index) => (
        <article className="author-change-card" key={`${change.path}-${index}`}>
          <h4>{change.path}</h4>
          <div className="author-diff-columns">
            <section>
              <h4>保存前</h4>
              <ContentDocument value={change.before} names={names} fieldKey={change.fieldKey} />
            </section>
            <section>
              <h4>{isCommitted ? '本次保存' : '本轮候选'}</h4>
              <ContentDocument value={change.after} names={names} fieldKey={change.fieldKey} />
            </section>
          </div>
        </article>
      ))}
    </section>
  )
}

function CandidateDiscussionSection({
  run,
  feedback,
  setFeedback,
  revisionTarget,
  setRevisionTarget,
  disabled,
}: {
  run: CreativeRun | null
  feedback: string
  setFeedback: (v: string) => void
  revisionTarget: 'original' | 'chapter' | 'summary'
  setRevisionTarget: (v: 'original' | 'chapter' | 'summary') => void
  disabled: boolean
}) {
  if (!run) return <p className="author-muted">无法定位原任务，请在对应资料重新发起修订。</p>
  return (
    <section className="author-version-discussion">
      <label htmlFor="object-version-feedback">针对这一版，接下来怎样调整？</label>
      <Input.TextArea
        id="object-version-feedback"
        value={feedback}
        disabled={disabled}
        onChange={event => setFeedback(event.target.value)}
        autoSize={{ minRows: 3, maxRows: 8 }}
        placeholder="说明要保留和修改的内容，原目标与候选依据自动带入。"
      />
      {run.stage === 'chapter' && run.operation !== 'review' && (
        <Select
          aria-label="候选修订范围"
          value={revisionTarget}
          onChange={setRevisionTarget}
          options={[
            { value: 'original', label: '沿用原修订范围' },
            { value: 'chapter', label: '整章' },
            { value: 'summary', label: '仅摘要' },
          ]}
        />
      )}
    </section>
  )
}

function CandidateMainContent({
  current,
  run,
  names,
  changes,
  candidate,
  review,
  history,
  feedback,
  setFeedback,
  revisionTarget,
  setRevisionTarget,
  applying,
  preparing,
  onSelectArtifact,
  onApply,
  onRevise,
}: {
  current: AgentArtifact
  run: CreativeRun | null
  names: Record<string, string>
  changes: Change[]
  candidate: unknown
  review: unknown
  history: Change[] | null
  feedback: string
  setFeedback: (v: string) => void
  revisionTarget: 'original' | 'chapter' | 'summary'
  setRevisionTarget: (v: 'original' | 'chapter' | 'summary') => void
  applying: boolean
  preparing: boolean
  onSelectArtifact?: (id: string) => void
  onApply: () => void
  onRevise: () => void
}) {
  return (
    <>
      <header className="candidate-review-heading">
        <div>
          <span className="author-eyebrow">{run ? `${runChapterLabel(run)} · ${CREATIVE_STAGE_LABELS[run.stage]}` : ''}</span>
          <h2>{current.kind === 'quality_report' ? reviewReportTitle(current.content, run || undefined) : `${ARTIFACT_STATUS_LABELS[current.status]} · 版本 ${current.version}`}</h2>
        </div>
        <span className="author-muted">{current.status === 'committed' ? '已写入正式内容' : '独立保存的候选'}</span>
      </header>
      {typeof run?.result?.supersededByArtifactId === 'string' && onSelectArtifact && (
        <Button onClick={() => onSelectArtifact(String(run.result!.supersededByArtifactId))}>查看后续修订版</Button>
      )}
      {changes.length > 0 && <CandidateDiffSection changes={changes} names={names} isCommitted={current.status === 'committed'} />}
      {history === null && current.kind === 'generic_draft' && <p className="author-muted">此版本未保存比较快照，仅展示完整内容。</p>}
      <details open={changes.length === 0} className="author-disclosure">
        <summary>{run?.operation === 'review' ? '完整评审' : '完整内容'}</summary>
        <ContentDocument value={candidate} names={names} />
      </details>
      {review != null && (
        <section className="author-review-result">
          <h2>{reviewReportTitle(review)}</h2>
          <ContentDocument value={formalReviewPresentation(review)} names={names} />
        </section>
      )}
      {current.parentArtifactId && onSelectArtifact && (
        <Button type="link" onClick={() => onSelectArtifact(current.parentArtifactId!)}>查看上一版依据</Button>
      )}
      <CandidateDiscussionSection
        run={run}
        feedback={feedback}
        setFeedback={setFeedback}
        revisionTarget={revisionTarget}
        setRevisionTarget={setRevisionTarget}
        disabled={applying || preparing}
      />
      <footer className="candidate-review-actions">
        {canApplyRunCandidate(run, current) && (
          <Button type="primary" loading={applying} disabled={preparing} onClick={onApply}>应用这一版</Button>
        )}
        {run && (
          <Button disabled={!feedback.trim() || applying} loading={preparing} onClick={onRevise}>继续修订原目标</Button>
        )}
      </footer>
    </>
  )
}

export default function CandidateReview({ novelId, artifactId, onRevise, onApplied, onSelectArtifact, refreshKey }: {
  refreshKey?: number; novelId: number; artifactId: string; onRevise: (target: ObjectTaskTarget) => void; onApplied?: () => void; onSelectArtifact?: (id: string) => void
}) {
  const scope = JSON.stringify([novelId, artifactId])
  const [feedback, setFeedback] = useScopedState(scope, '')
  const [revisionTarget, setRevisionTarget] = useScopedState<'original' | 'chapter' | 'summary'>(scope, 'original')
  const [applying, setApplying] = useScopedState(scope, false)
  const [preparing, setPreparing] = useScopedState(scope, false)
  const [actionError, setError] = useScopedState(scope, '')
  const epoch = useRef(0), applyingRef = useRef(false)
  useEffect(() => () => { epoch.current += 1 }, [scope])

  const read = useCallback(() => readCandidateSnapshot(novelId, artifactId), [novelId, artifactId])
  const { data, loading, error: readError, reload: load } = useAsyncSnapshot(read, refreshKey)
  const current = data?.artifact ?? null, run = data?.run ?? null, names = data?.names ?? {}, review = data?.review ?? null, history = data?.history ?? null
  const error = resolveCandidateErrorMessage(actionError, readError, data?.referenceError)
  const candidate = resolveCandidateContent(current)
  const changes = resolveCandidateChanges(run, history)

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
      const target = await buildReviseTarget(novelId, run, current, feedback, revisionTarget)
      if (token === epoch.current) onRevise(target)
    } catch (cause) { if (token === epoch.current) setError(cause instanceof Error ? cause.message : '读取修订目标失败') }
    finally { if (token === epoch.current) setPreparing(false) }
  }

  return (
    <section className="candidate-review" aria-label="候选与评审">
      {error && <LoadFailure message={error} retry={() => void load()} />}
      {loading && !data ? (
        <div className="author-loading"><Spin /></div>
      ) : current ? (
        <CandidateMainContent
          current={current}
          run={run}
          names={names}
          changes={changes}
          candidate={candidate}
          review={review}
          history={history}
          feedback={feedback}
          setFeedback={setFeedback}
          revisionTarget={revisionTarget}
          setRevisionTarget={setRevisionTarget}
          applying={applying}
          preparing={preparing}
          onSelectArtifact={onSelectArtifact}
          onApply={() => void apply()}
          onRevise={() => void revise()}
        />
      ) : (
        !error && <EmptyWork title="未读到这份候选" />
      )}
    </section>
  )
}
