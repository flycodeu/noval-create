import React from 'react'
import { Collapse, Tag } from 'antd'
import type { GateItemSeverity, GateReport } from './gate-adapters'

interface QualityGateReportProps {
  reports: GateReport[]
}

const SEVERITY_META: Record<GateItemSeverity, { color: string; label: string }> = {
  blocker: { color: 'error', label: '阻塞' },
  warning: { color: 'warning', label: '预警' },
  info: { color: 'blue', label: '参考' },
}

/**
 * 统一质检报告：每个门一个折叠区，通过绿标 / 未通过红标，
 * 条目按 severity（blocker/warning/info）着色，附建议动作。
 */
export default function QualityGateReport({ reports }: QualityGateReportProps) {
  if (reports.length === 0) return null

  return (
    <Collapse
      size="small"
      defaultActiveKey={reports.filter((report) => !report.passed).map((report) => report.gateName)}
      items={reports.map((report) => ({
        key: report.gateName,
        label: (
          <span>
            <Tag color={report.passed ? 'success' : 'error'}>{report.passed ? '通过' : '未通过'}</Tag>
            {report.gateName}
            <span style={{ marginLeft: 8, opacity: 0.65, fontSize: 12 }}>{`${report.items.length} 项`}</span>
          </span>
        ),
        children: (
          <div className="novel-note-list">
            {report.items.map((item, index) => (
              <div key={`${report.gateName}-${index}`} className="novel-note-list__item">
                <Tag color={SEVERITY_META[item.severity].color}>{SEVERITY_META[item.severity].label}</Tag>
                <span>{item.message}</span>
                {item.suggestion ? (
                  <div style={{ marginLeft: 4, marginTop: 2, fontSize: 12, opacity: 0.75 }}>{`建议：${item.suggestion}`}</div>
                ) : null}
              </div>
            ))}
          </div>
        ),
      }))}
    />
  )
}
