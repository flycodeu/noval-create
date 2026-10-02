import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Input, Spin } from 'antd'
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentArtifact } from '../../../shared/agent-artifacts'
import { CREATIVE_STAGE_LABELS, type CreativeRun, type CreativeStage } from '../../../shared/creative-workflow'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { RevisionTask } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure, RunProgress } from './shared'
import { callAuthorTool, isRunActive, runStatusLabel } from './workflow-client'

type ArtifactReference = Omit<AgentArtifact, 'content' | 'idempotencyKey'>
const STATUS_LABELS: Record<string, string> = { draft: '候选', reviewed: '已评审', approved: '已认可', committed: '已应用', rejected: '未通过', superseded: '旧版本' }
const CONTENT_LABELS: Record<string, string> = {
  title: '标题', name: '名称', fullName: '姓名', background: '故事背景', userBackground: '故事背景', expandedBackground: '补充设定', synopsis: '简介',
  summary: '摘要', description: '描述', content: '正文', output: '内容', outline: '大纲', chapters: '章节', chapterNum: '章节序号', chapterNumber: '章节序号',
  characters: '人物', locations: '地点', entities: '设定', relations: '关系', changes: '修改内容', attributes: '特点与设定',
  requirements: '本轮要求', warnings: '提示', issues: '评审问题', score: '评分', status: '状态', hardBlockers: '阻塞问题',
  reason: '原因', evidence: '依据', suggestion: '修改建议', review: '评审', roleType: '角色定位', goals: '目标', personalityTraits: '性格',
  nameA: '人物', nameB: '关联人物', relationType: '关系类型', label: '关系', mainPlot: '主线', coreConflict: '核心冲突', ending: '结局',
  checks: '核对结果', message: '说明', modelReview: '模型评审', rewrittenReview: '修订后评审', stage: '处理结果',
  age: '年龄', occupation: '职业', speechPattern: '说话特点', coreFear: '恐惧', surfaceDesire: '表面欲望', deepNeed: '内在需要',
  relationshipTension: '关系压力', nodeType: '地点类型', travelHours: '行程小时', travelMode: '交通方式',
}
const INTERNAL_FIELDS = new Set(['schemaVersion', 'requestFingerprint', 'contextSummaryHash', 'createdAt', 'taskId', 'externalSource', 'schemaHint', 'quality', 'id', 'clientId', 'source', 'novelId', 'op', 'kind', 'fromId', 'toId', 'parentId', 'effectiveFromChapter', 'assetType', 'outputFormat', 'draftArtifactId', 'draftContentHash', 'effectiveArtifactId', 'effectiveContentHash', 'reviewedContextVersion', 'readyForHumanApply', 'code'])
function ReadableContent({ value, depth = 0 }: { value: unknown; depth?: number }): React.ReactElement | null {
  if (value == null || value === '') return null
  if (depth > 6) return <p>{String(value)}</p>
  if (typeof value === 'string') {
    let parsed: unknown = null
    try { parsed = JSON.parse(value) } catch { /* Prose stays prose. */ }
    if (parsed && typeof parsed === 'object') return <ReadableContent value={parsed} depth={depth + 1} />
    return <div className="author-prose">{value}</div>
  }
  if (Array.isArray(value)) return <div className="author-output-list">{value.map((item, index) => <section key={index}><ReadableContent value={item} depth={depth + 1} /></section>)}</div>
  if (typeof value === 'object') return <dl className="author-output-fields">{Object.entries(value).filter(([key, item]) => !INTERNAL_FIELDS.has(key) && item != null && item !== '' && (!Array.isArray(item) || item.length > 0)).map(([key, item]) => <div key={key}><dt>{CONTENT_LABELS[key] || key}</dt><dd><ReadableContent value={item} depth={depth + 1} /></dd></div>)}</dl>
  return <span>{String(value)}</span>
}

export default function Versions({ novelId }: { novelId: number }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<'runs' | 'versions' | 'issues'>(params.get('artifact') ? 'versions' : params.get('issue') ? 'issues' : 'runs')
  const [runs, setRuns] = useState<CreativeRun[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactReference[]>([])
  const [issues, setIssues] = useState<RevisionTask[]>([])
  const [selectedRun, setSelectedRun] = useState<CreativeRun | null>(null)
  const [artifact, setArtifact] = useState<(ArtifactReference & { content: unknown }) | null>(null)
  const [review, setReview] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [applying, setApplying] = useState(false)
  const readEpoch = useRef(0)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [runResult, artifactResult, nextIssues] = await Promise.all([
        callAuthorTool<{ runs: CreativeRun[] }>('novelforge.workflows.list', { novelId }),
        callAuthorTool<{ artifacts: ArtifactReference[] }>('novelforge.artifacts.list', { novelId, limit: 150 }),
        window.electron.revision.list(novelId),
      ])
      setRuns(runResult.runs); setArtifacts(artifactResult.artifacts); setIssues(nextIssues); setError('')
      setSelectedRun((current) => runResult.runs.find((run) => run.runId === current?.runId) || runResult.runs[0] || null)
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
        setSelectedRun(run)
        setRuns((current) => current.map((item) => item.runId === run.runId ? run : item))
        if (run.step === 'completed') window.dispatchEvent(new Event('novelforge:creative-completed'))
      }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : '读取任务失败') })
    }, 1600)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [novelId, selectedRun])
  const openArtifact = useCallback(async (id: string) => {
    const epoch = ++readEpoch.current
    setReading(true); setReview(null)
    try {
      const result = await callAuthorTool<{ artifact: ArtifactReference & { content: unknown } }>('novelforge.artifacts.get', { artifactId: id })
      if (epoch !== readEpoch.current) return
      setArtifact(result.artifact); setFeedback(''); setError('')
      if (result.artifact.reviewArtifactId) {
        const reviewResult = await callAuthorTool<{ artifact: { content: unknown } }>('novelforge.artifacts.get', { artifactId: result.artifact.reviewArtifactId })
        if (epoch === readEpoch.current) setReview(reviewResult.artifact.content)
      }
    } catch (cause) { if (epoch === readEpoch.current) setError(cause instanceof Error ? cause.message : '读取版本失败') }
    finally { if (epoch === readEpoch.current) setReading(false) }
  }, [])
  useEffect(() => { const id = params.get('artifact'); if (id) { setView('versions'); void openArtifact(id) } }, [params, openArtifact])
  useEffect(() => () => { readEpoch.current += 1 }, [])
  const visibleArtifacts = artifacts.filter((item) => showHistory || !['superseded', 'rejected'].includes(item.status))
  const visibleIssues = issues.filter((issue) => showHistory || ['open', 'in_progress'].includes(issue.status))
  const discuss = (stage: CreativeStage, request: string) => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage, request })}`))
  const artifactRun = runs.find((run) => run.artifactId === artifact?.id || run.reviewArtifactId === artifact?.id)

  return <AuthorPage eyebrow="版本与问题" title="每一次修改，都有来处" description="候选、评审和已应用结果保存在作品里。需要时再导出文件。" actions={<Button icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>刷新</Button>}>
    <div className="author-atlas-toolbar"><div className="author-tabs" role="tablist" aria-label="版本记录视图">{([{ key: 'runs', label: '创作记录' }, { key: 'versions', label: '内容版本' }, { key: 'issues', label: '待处理问题' }] as const).map((tab) => <button key={tab.key} role="tab" aria-selected={view === tab.key} onClick={() => setView(tab.key)}>{tab.label}</button>)}</div><Checkbox checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)}>显示历史与已处理</Checkbox></div>
    {error && <LoadFailure message={error} retry={() => void load()} />}
    {loading && !runs.length && !artifacts.length ? <div className="author-loading"><Spin /></div> : view === 'runs' ? runs.length ? <div className="author-history-layout"><div className="author-history-list">{runs.map((run) => <button key={run.runId} className={selectedRun?.runId === run.runId ? 'is-selected' : ''} onClick={() => setSelectedRun(run)}><small>{CREATIVE_STAGE_LABELS[run.stage]} · {runStatusLabel(run)}</small><strong>{run.request}</strong><time>{run.createdAt ? new Date(run.createdAt).toLocaleString() : ''}</time></button>)}</div><div>{selectedRun && <RunProgress run={selectedRun} active={isRunActive(selectedRun)} onCancel={() => void callAuthorTool('novelforge.workflows.cancel', { novelId, runId: selectedRun.runId }).then(load).catch((cause) => setError(String(cause)))} onResume={() => void callAuthorTool('novelforge.workflows.resume', { novelId, runId: selectedRun.runId }).then(load).catch((cause) => setError(String(cause)))} onOpenResult={() => { setParams({ artifact: selectedRun.artifactId || '' }); setView('versions') }} />}</div></div> : <EmptyWork title="还没有创作记录" action={() => navigate(buildWorkspaceRoute(novelId, 'guide'))}>在创作台开始一轮生成，过程和结果会保存在这里。</EmptyWork> : view === 'versions' ? <div className="author-history-layout"><div className="author-history-list">{visibleArtifacts.length ? visibleArtifacts.map((item) => <button key={item.id} className={artifact?.id === item.id ? 'is-selected' : ''} onClick={() => setParams({ artifact: item.id })}><small>{STATUS_LABELS[item.status] || item.status} · 版本 {item.version}</small><strong>{runs.find((run) => run.artifactId === item.id)?.request || (item.kind.includes('review') ? '审校记录' : item.kind.includes('character') ? '人物设计' : '创作内容')}</strong><time>{new Date(item.createdAt).toLocaleString()}</time></button>) : <p className="author-muted">当前没有可显示的内容版本。</p>}</div><section className="author-paper author-version-detail">{reading ? <Spin /> : artifact ? <>
      <div className="author-section-heading"><h2>{STATUS_LABELS[artifact.status]} · 版本 {artifact.version}</h2><small>{new Date(artifact.createdAt).toLocaleString()}</small></div>
      {artifact.status !== 'committed' && artifactRun?.reviewStatus === 'passed' && <Button type="primary" loading={applying} onClick={() => {
        setApplying(true)
        void callAuthorTool('novelforge.workflows.apply', { novelId, runId: artifactRun.runId }).then(async () => { await load(); await openArtifact(artifact.id); window.dispatchEvent(new Event('novelforge:creative-completed')) }).catch((cause) => setError(cause instanceof Error ? cause.message : '应用版本失败')).finally(() => setApplying(false))
      }}>应用此版本</Button>}
      <ReadableContent value={artifact.content} />
      {review != null && <section className="author-review-result"><h2>这一版的评审</h2><ReadableContent value={review} /></section>}
      <div className="author-version-discussion"><label htmlFor="version-feedback">这一版要怎样调整？</label><Input.TextArea id="version-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="说出你觉得不合理的地方，或想保留的细节。" /><Button disabled={!feedback.trim()} onClick={() => discuss(artifactRun?.stage || 'background', `请根据候选版本 ${artifact.id} 和它的评审继续修订。我的意见：${feedback.trim()}`)}>继续讨论与修订 <ArrowRightOutlined /></Button></div>
    </> : <EmptyWork title="选择一个版本">查看这一版的内容、评审和修改依据。</EmptyWork>}</section></div> : <section className="author-paper">{visibleIssues.length ? <div className="author-problem-list">{visibleIssues.map((issue) => <article key={issue.id}><div><small>{issue.status === 'open' ? '待处理' : issue.status === 'in_progress' ? '处理中' : '已处理'}</small><h2>{issue.title}</h2><p>{issue.description || '暂无进一步说明。'}</p></div><Button onClick={() => discuss(issue.taskType === 'character' || issue.taskType === 'relation' ? 'characters' : issue.taskType === 'map' ? 'map' : issue.chapterId ? 'chapter' : 'background', `处理已记录问题 #${issue.id}：${issue.title}\n${issue.description || ''}\n基于当前作品内容修订并复核。`)}>交给 AI 修订</Button></article>)}</div> : <EmptyWork title="没有待处理的问题">审校发现的问题会集中显示在这里。</EmptyWork>}</section>}
  </AuthorPage>
}
