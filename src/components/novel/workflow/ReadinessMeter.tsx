import React from 'react'
import { Progress } from 'antd'
import type { WorkspaceReadinessSummary } from '../../../shared/novel-workspace'

interface ReadinessMeterProps {
  readiness: WorkspaceReadinessSummary
}

export default function ReadinessMeter({ readiness }: ReadinessMeterProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 16,
        padding: 18,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-light)',
        background: 'var(--bg-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            写作准备度
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong style={{ fontSize: 30, lineHeight: 1, color: 'var(--text-main)' }}>{`${readiness.score}%`}</strong>
            <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{readiness.label}</span>
          </div>
        </div>
      </div>

      <Progress percent={readiness.score} showInfo={false} strokeColor="var(--primary)" trailColor="rgba(166, 106, 43, 0.08)" />

      <div style={{ display: 'grid', gap: 10 }}>
        {readiness.metrics.map((metric) => (
          <div key={metric.key} style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{metric.label}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{`${metric.score}%`}</span>
            </div>
            <Progress percent={metric.score} showInfo={false} size="small" strokeColor="var(--primary)" trailColor="rgba(166, 106, 43, 0.08)" />
            <span style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted)' }}>{metric.summary}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
