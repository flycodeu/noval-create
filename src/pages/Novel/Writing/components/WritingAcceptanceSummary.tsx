import React from 'react'
import TruncatedList from '../../../../components/common/TruncatedList'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import type { WritingMetadataViewModel } from '../writing-chapter-presentation'

interface Props {
  acceptance: WritingMetadataViewModel['acceptance']
  qualityIssues: WritingMetadataViewModel['qualityIssues']
}

export default function WritingAcceptanceSummary({ acceptance, qualityIssues }: Props) {
  return (
    <section className="chapter-console-page__panel chapter-console-page__review-strip">
      <SectionHeader
        title="当前章检查结果"
        description="合同、连续性、AI 味与节奏的当前状态。"
      />
      <div className="chapter-console-page__acceptance-grid">
        <TruncatedList
          items={acceptance}
          limit={4}
          renderItem={(item) => (
            <div key={item.label} className="chapter-console-page__acceptance-card">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          )}
        />
      </div>
      {qualityIssues.length > 0 ? (
        <div className="chapter-console-page__quality-list">
          <TruncatedList
            items={qualityIssues}
            limit={4}
            renderItem={(item) => (
              <div key={item} className="chapter-console-page__quality-item">
                {item}
              </div>
            )}
          />
        </div>
      ) : (
        <div className="chapter-console-page__empty-copy">当前还没有新的审校问题。</div>
      )}
    </section>
  )
}
