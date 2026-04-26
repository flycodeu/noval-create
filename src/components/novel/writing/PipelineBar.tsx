import React from 'react'
import { Button, Tag } from 'antd'

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
    <section
      style={{
        display: 'grid',
        gap: 12,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-light)',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>章节流水线</strong>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Planner → Writer → Critic → Rewriter → Canonizer → Finalize</span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(152px, 1fr))',
          gap: 10,
        }}
      >
        {items.map((item) => {
          const meta = statusMeta(item.status)

          return (
            <article
              key={item.key}
              style={{
                display: 'grid',
                gap: 8,
                padding: 12,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-light)',
                background: item.status === 'running' ? 'rgba(37, 99, 235, 0.05)' : '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{item.label}</strong>
                <Tag color={meta.color} style={{ margin: 0 }}>{meta.label}</Tag>
              </div>
              <span style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-sub)' }}>{item.detail || '等待进入该阶段。'}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {`任务 ${item.taskId || '-'} · 合同 ${item.contractVersion || '-'} · ${item.durationMs ? `${(item.durationMs / 1000).toFixed(1)}s` : '-'} · ${item.tokensUsed || 0} tok`}
              </span>
              {item.error ? (
                <span style={{ fontSize: 11, color: 'var(--danger)' }}>{item.error}</span>
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
