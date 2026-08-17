import React from 'react'
import { Tag } from 'antd'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import type { ChapterHeaderViewModel } from '../writing-chapter-presentation'

interface Props {
  model: ChapterHeaderViewModel
}

export default function WritingChapterHeader({ model }: Props) {
  return (
    <div className="chapter-console-page__hero">
      <section className="chapter-console-page__panel chapter-console-page__hero-card">
        <SectionHeader
          title={model.title}
          description={model.description}
          extra={model.selected ? <Tag color={model.statusColor}>{model.statusLabel}</Tag> : null}
        />
        <div className="chapter-console-page__hero-meta">
          {model.metadata.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="chapter-console-page__panel chapter-console-page__writability-card">
        <SectionHeader
          title={model.writabilityTitle}
          description={model.writability.summary}
          extra={model.writability.ready ? <Tag color="success">可直接开写</Tag> : <Tag color="gold">建议先补缺口</Tag>}
        />
        <div className="chapter-console-page__writability-checks">
          {model.writability.checks.map((item) => (
            <div key={item.key} className={`chapter-console-page__writability-item ${item.ready ? 'is-ready' : 'is-risk'}`}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          ))}
        </div>
        {model.writability.risks.length > 0 ? (
          <div className="chapter-console-page__risk-note">
            <strong>主要风险</strong>
            <span>{model.writability.risks.slice(0, 2).join('；')}</span>
          </div>
        ) : null}
      </section>
    </div>
  )
}
