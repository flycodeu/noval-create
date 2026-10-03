import React from 'react'
import { Button, Spin } from 'antd'
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import type { CreativeRun } from '../../../shared/creative-workflow'
import { runChapterLabel, runResultPresentation, runStatusLabel } from './run-presentation'
import './author-workspace.css'

export function AuthorPage({ title, actions, children }: {
  title: string; actions?: React.ReactNode; children: React.ReactNode
}) {
  return <div className="author-workspace"><h1 className="author-visually-hidden">{title}</h1>{actions && <div className="author-page-actions">{actions}</div>}{children}</div>
}

export function EmptyWork({ title, children, action, actionLabel }: { title: string; children: React.ReactNode; action?: () => void; actionLabel?: string }) {
  return <div className="author-empty"><strong>{title}</strong><p>{children}</p>{action && <Button icon={<ArrowRightOutlined />} onClick={action}>{actionLabel || '提出生成要求'}</Button>}</div>
}

export function LoadFailure({ message, retry }: { message: string; retry: () => void }) {
  return <div className="author-error" role="alert"><span>{message}</span><Button size="small" icon={<ReloadOutlined />} onClick={retry}>重试</Button></div>
}

const RUN_STEPS: Array<{ key: CreativeRun['step']; label: string }> = [
  { key: 'context', label: '读取依据' }, { key: 'generating', label: '生成' },
  { key: 'reviewing', label: '评审' }, { key: 'revising', label: '修订' }, { key: 'applying', label: '保存结果' },
]

export function RunProgress({ run, active, onCancel, onResume, onOpenResult, names }: {
  run: CreativeRun; active: boolean; onCancel?: () => void; onResume?: () => void; onOpenResult?: () => void; names?: Record<string, string>
}) {
  const presentation = runResultPresentation(run, undefined, names)
  const steps = run.operation === 'review' ? RUN_STEPS.filter(step => ['context', 'reviewing'].includes(step.key)) : RUN_STEPS
  const current = steps.findIndex((step) => step.key === run.step)
  return <section className="author-run" aria-live="polite">
    <div className="author-section-heading"><div><span className="author-eyebrow">{runStatusLabel(run)} · {runChapterLabel(run)}</span><h2>{presentation.title}</h2></div>
      {active && onCancel ? <Button size="small" onClick={onCancel}>停止</Button> : !presentation.saved && onResume && (run.step === 'needs_attention' || run.status === 'failed' || run.step === 'cancelled') ? <Button size="small" onClick={onResume}>{runStatusLabel(run) === '候选待确认' ? '确认保存候选' : '重试任务'}</Button> : null}
    </div>
    {active && <div className="author-run__steps">{steps.map((step, i) => <span key={step.key} className={i < current ? 'is-done' : i === current ? 'is-current' : ''}>
      <i>{i + 1}</i>{step.label}</span>)}</div>}
    <div className="author-run__message">{active && <Spin size="small" />}<span>{presentation.summary}</span></div>
    {run.artifactId && onOpenResult && <Button type="link" onClick={onOpenResult}>查看结果与评审 <ArrowRightOutlined /></Button>}
    <details className="author-disclosure"><summary>任务详情</summary>
      {run.count != null && <p>请求数量：{run.count}</p>}
      <p>生成模型：{run.modelConfigId ?? '未知'} · 审校模型：{run.reviewModelConfigId ?? run.modelConfigId ?? '未知'}</p>
      <h3>原始请求</h3><p className="author-run__request">{run.request}</p>
      {run.message && <><h3>运行反馈</h3><p className="author-run__request">{run.message}</p></>}
    </details>
    {run.context && <details className="author-disclosure"><summary>本次使用的上下文</summary><p>预计输入 {run.context.estimatedTokens.toLocaleString()} tokens · 为输出预留 {run.context.outputReserve.toLocaleString()} tokens</p>
      <ul>{run.context.sources.map((source) => <li key={source}>{source}</li>)}</ul>
      {run.context.omittedSources.length > 0 && <p>本轮未加入：{run.context.omittedSources.join('、')}</p>}
    </details>}
    {run.events.length > 0 && <details className="author-disclosure"><summary>运行记录</summary><ol>{run.events.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}</li>)}</ol></details>}
  </section>
}
