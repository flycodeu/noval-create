import React from 'react'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import VersionTimeline from '../../../../components/novel/writing/VersionTimeline'
import type { ChapterVersion } from '../../../../types'
import type { WritingMetadataViewModel } from '../writing-chapter-presentation'

export interface WritingFooterProps {
  pipelineMetadata: WritingMetadataViewModel['pipeline']
  versions: ChapterVersion[]
  selectedVersionId: number | null
  onSelectVersion(id: number): void
  onRestoreVersion(): Promise<void>
}

export default function WritingFooter({
  onRestoreVersion,
  onSelectVersion,
  pipelineMetadata,
  selectedVersionId,
  versions,
}: WritingFooterProps) {
  return (
    <div className="chapter-console-page__footer">
      <div className="chapter-console-page__footer-grid">
        <section className="chapter-console-page__panel">
          <SectionHeader title="执行记录" description="本次流水线运行记录。" />
          <div className="chapter-console-page__meta-grid">
            {pipelineMetadata.map((item) => (
              <div key={item.label} className="chapter-console-page__meta-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <VersionTimeline
          versions={versions}
          selectedVersionId={selectedVersionId}
          onSelect={onSelectVersion}
          onRestore={() => void onRestoreVersion()}
        />
      </div>
    </div>
  )
}
