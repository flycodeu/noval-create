import React from 'react'
import { Button, Tag } from 'antd'
import './PipelineBar.css'

export interface PipelineBarItem {
  key: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'blocked'
  detail?: string
  taskId?: number
  contractVersion?: string
  durationMs?: number
  tokensUsed?: number
  error?: string
  canRetry?: boolean
  onRetry?: () => void
}

interface PipelineBarProps {
  items: PipelineBarItem[]
}

function statusMeta(status: PipelineBarItem['status']) {
  if (status === 'success') return { color: 'success', label: '完成' }
  if (status === 'running') return { color: 'processing', label: '运行中' }
  if (status === 'failed') return { color: 'error', label: '失败' }
  if (status === 'blocked') return { color: 'warning', label: '阻塞' }
  return { color: 'default', label: '待执行' }
}

export default function PipelineBar({ items }: PipelineBarProps) {
  return (
    <section className="pipeline-bar">
      <div className="pipeline-bar__head">
        <strong className="pipeline-bar__title">章节流水线</strong>
        <span className="pipeline-bar__subtitle">规划 → 写作 → 审校 → 重写 → 回写 → 定稿</span>
      </div>

      <div className="pipeline-bar__grid">
        {items.map((item) => {
          const meta = statusMeta(item.status)

          return (
            <article key={item.key} className={`pipeline-bar__item${item.status === 'running' ? ' is-running' : ''}`}>
              <div className="pipeline-bar__item-head">
                <strong className="pipeline-bar__item-title">{item.label}</strong>
                <Tag color={meta.color}>{meta.label}</Tag>
              </div>
              <span className="pipeline-bar__item-copy">{item.detail || '等待进入该阶段。'}</span>
              <span className="pipeline-bar__item-meta">
                {`任务 ${item.taskId || '-'} · 合同 ${item.contractVersion || '-'} · ${item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}秒` : '-'} · 用量 ${item.tokensUsed || 0}`}
              </span>
              {item.error ? (
                <span className="pipeline-bar__item-error">{item.error}</span>
              ) : null}
              {item.canRetry && item.onRetry ? (
                <div>
                  <Button size="small" onClick={item.onRetry}>重试</Button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
