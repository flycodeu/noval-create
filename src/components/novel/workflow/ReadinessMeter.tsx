import React from 'react'
import { Progress } from 'antd'
import type { WorkspaceReadinessSummary } from '../../../shared/novel-workspace'
import './workflow-panels.css'

interface ReadinessMeterProps {
  readiness: WorkspaceReadinessSummary
}

export default function ReadinessMeter({ readiness }: ReadinessMeterProps) {
  return (
    <section className="workflow-panel workflow-panel--readiness">
      <div className="workflow-panel__header workflow-panel__header--baseline">
        <div className="workflow-panel__header-copy">
          <span className="workflow-panel__eyebrow">
            写作准备度
          </span>
          <div className="workflow-panel__score-row">
            <strong className="workflow-panel__score">{`${readiness.score}%`}</strong>
            <span className="workflow-panel__score-label">{readiness.label}</span>
          </div>
        </div>
      </div>

      <Progress percent={readiness.score} showInfo={false} strokeColor="var(--primary)" trailColor="rgba(166, 106, 43, 0.08)" />

      <div className="workflow-panel__metrics">
        {readiness.metrics.map((metric) => (
          <div key={metric.key} className="workflow-panel__metric">
            <div className="workflow-panel__metric-head">
              <strong className="workflow-panel__metric-label">{metric.label}</strong>
              <span className="workflow-panel__metric-score">{`${metric.score}%`}</span>
            </div>
            <Progress percent={metric.score} showInfo={false} size="small" strokeColor="var(--primary)" trailColor="rgba(166, 106, 43, 0.08)" />
            <span className="workflow-panel__metric-summary">{metric.summary}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
