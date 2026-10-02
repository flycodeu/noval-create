import React from 'react'
import { Button, Spin } from 'antd'
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons'
import type { CreativeRun, CreativeStage } from '../../../shared/creative-workflow'
import { CREATIVE_STAGE_LABELS } from '../../../shared/creative-workflow'
import { runStatusLabel } from './workflow-client'
import './author-workspace.css'

export function AuthorPage({ eyebrow, title, description, actions, children }: {
  eyebrow?: string; title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode
}) {
  return <div className="author-workspace"><header className="author-page-heading"><div>
    {eyebrow && <span className="author-eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}
  </div>{actions && <div className="author-heading-actions">{actions}</div>}</header>{children}</div>
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

export function RunProgress({ run, active, onCancel, onResume, onOpenResult }: {
  run: CreativeRun; active: boolean; onCancel?: () => void; onResume?: () => void; onOpenResult?: () => void
}) {
  const current = RUN_STEPS.findIndex((step) => step.key === run.step)
  return <section className="author-run" aria-live="polite">
    <div className="author-section-heading"><div><span className="author-eyebrow">当前任务 · {CREATIVE_STAGE_LABELS[run.stage as CreativeStage] || run.stage}</span><h2>{runStatusLabel(run)}</h2></div>
      {active ? <Button size="small" onClick={onCancel}>停止</Button> : run.step === 'needs_attention' || run.status === 'failed' || run.step === 'cancelled' ? <Button size="small" onClick={onResume}>{run.reviewStatus === 'passed' ? '应用候选' : '重试任务'}</Button> : null}
    </div>
    <p className="author-run__request">{run.request}</p>
    <div className="author-run__steps">{RUN_STEPS.map((step, i) => <span key={step.key} className={run.step === 'completed' || i < current ? 'is-done' : i === current ? 'is-current' : ''}>
      <i>{i + 1}</i>{step.label}</span>)}</div>
    <div className="author-run__message">{active && <Spin size="small" />}<span>{run.message || '任务已记录。'}</span></div>
    {run.artifactId && onOpenResult && <Button type="link" onClick={onOpenResult}>查看结果与评审 <ArrowRightOutlined /></Button>}
    {run.context && <details className="author-disclosure"><summary>本次使用的上下文</summary><p>预计输入 {run.context.estimatedTokens.toLocaleString()} tokens · 为输出预留 {run.context.outputReserve.toLocaleString()} tokens</p>
      <ul>{run.context.sources.map((source) => <li key={source}>{source}</li>)}</ul>
      {run.context.omittedSources.length > 0 && <p>本轮未加入：{run.context.omittedSources.join('、')}</p>}
    </details>}
    {run.events.length > 0 && <details className="author-disclosure"><summary>运行记录</summary><ol>{run.events.map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}</li>)}</ol></details>}
  </section>
}
