import React, { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Drawer, Input, InputNumber, Tabs } from 'antd'
import { CREATIVE_STAGE_LABELS } from '../../../shared/creative-workflow'
import { useCreativeWorkflow } from './workflow-client'
import { LoadFailure, RunProgress } from './shared'
import CandidateReview from './CandidateReview'
import type { ObjectTaskTarget } from './object-task'
import './object-task.css'

export type { ObjectTaskTarget } from './object-task'

export default function ObjectTaskPanel({ novelId, target, onClose, onApplied }: {
  novelId: number; target: ObjectTaskTarget | null; onClose: () => void; onApplied?: () => void
}) {
  return <Drawer title={target?.title ? `调整 · ${target.title}` : '当前对象'} open={Boolean(target)} width={820} destroyOnClose className="object-task-drawer" onClose={onClose}>
    {target && <TaskSession key={JSON.stringify([novelId, target])} novelId={novelId} initialTarget={target} onApplied={onApplied} />}
  </Drawer>
}

function TaskSession({ novelId, initialTarget, onApplied }: { novelId: number; initialTarget: ObjectTaskTarget; onApplied?: () => void }) {
  const [target, setTarget] = useState(initialTarget)
  const [request, setRequest] = useState(initialTarget.request)
  const [count, setCount] = useState(initialTarget.stage === 'chapter' ? 1 : initialTarget.count || 1)
  const [autoApply, setAutoApply] = useState(Boolean(initialTarget.initialAutoApply))
  const [runId, setRunId] = useState(initialTarget.runId)
  const [artifactId, setArtifactId] = useState(initialTarget.artifactId)
  const [tab, setTab] = useState(initialTarget.artifactId ? 'candidate' : 'request')
  const workflow = useCreativeWorkflow(novelId, runId)
  const run = runId && workflow.run?.runId === runId ? workflow.run : null
  const started = useRef(false)
  useEffect(() => { if (run?.artifactId) setArtifactId(run.artifactId) }, [run?.artifactId])
  const start = async () => {
    if (started.current || !request.trim() || workflow.active || workflow.submitting) return
    started.current = true
    try {
      const next = await workflow.start({ stage: target.stage, request: request.trim(), count: target.stage === 'chapter' ? 1 : count, atChapter: target.atChapter, autoApply,
        changeScope: target.changeScope, chapterRevision: target.chapterRevision, sourceArtifactId: target.sourceArtifactId, revisionIssueIds: target.revisionIssueIds })
      if (next) { setRunId(next.runId); setArtifactId(next.artifactId); setTab('progress') }
    } finally { started.current = false }
  }
  const revise = (next: ObjectTaskTarget) => { setTarget(next); setRequest(next.request); setCount(next.stage === 'chapter' ? 1 : next.count || 1); setAutoApply(false); setTab('request') }
  return <div className="object-task-session">
    <div className="object-task-context"><strong>{CREATIVE_STAGE_LABELS[target.stage]}</strong><span>{target.atChapter == null ? '当前设定章位' : `第 ${target.atChapter} 章`}</span>{target.sourceArtifactId && <span>沿用所选候选依据</span>}</div>
    {workflow.error && <LoadFailure message={workflow.error} retry={() => void workflow.refresh(runId)} />}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'request', label: '本轮要求', children: <section className="object-task-request"><label htmlFor="object-task-request">这一轮怎样调整？</label><Input.TextArea id="object-task-request" value={request} disabled={workflow.submitting || workflow.active} onChange={event => setRequest(event.target.value)} autoSize={{ minRows: 6, maxRows: 16 }} />
        <details className="author-disclosure"><summary>本轮设置</summary><div className="object-task-options"><label>本轮数量 <InputNumber aria-label="本轮生成数量" min={1} max={target.stage === 'chapter' ? 1 : 30} value={count} disabled={target.stage === 'chapter' || workflow.active || workflow.submitting || Boolean(target.changeScope || target.sourceArtifactId)} onChange={value => setCount(value || 1)} /></label><Checkbox checked={autoApply} disabled={workflow.active || workflow.submitting} onChange={event => setAutoApply(event.target.checked)}>模型评审通过后应用</Checkbox></div></details>
        {workflow.active && !run && <p className="author-muted">作品有任务正在运行；请在创作台查看，完成后再开始这一轮。</p>}
        <footer className="object-task-submit"><span>{autoApply ? '评审通过后保存' : '先保存为候选，确认后应用'}</span><Button type="primary" loading={workflow.submitting} disabled={!request.trim() || workflow.active} onClick={() => void start()}>开始这一轮</Button></footer>
      </section> },
      { key: 'progress', label: '运行进度', children: run ? <RunProgress run={run} active={workflow.active} onCancel={() => void workflow.control('cancel')} onResume={() => void workflow.control('resume')} onOpenResult={() => { if (run.artifactId) { setArtifactId(run.artifactId); setTab('candidate') } }} /> : <p className="author-muted">开始本轮后查看运行进度。</p> },
      { key: 'candidate', label: '候选与评审', children: artifactId ? <CandidateReview novelId={novelId} artifactId={artifactId} onApplied={onApplied} onRevise={revise} onSelectArtifact={setArtifactId} /> : <p className="author-muted">本轮还没有候选。</p> },
    ]} />
  </div>
}
