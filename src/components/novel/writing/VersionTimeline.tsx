import React from 'react'
import { Button, Tag } from 'antd'
import type { ChapterVersion } from '../../../types'
import './WritingSidePanels.css'

function sourceLabel(source: ChapterVersion['versionSource']) {
  if (source === 'ai-rewrite') return 'AI 重写'
  if (source === 'pipeline-generate') return '流水线生成'
  if (source === 'version-restore') return '历史恢复'
  return '手动保存'
}

interface VersionTimelineProps {
  versions: ChapterVersion[]
  selectedVersionId?: number | null
  onSelect?: (versionId: number) => void
  onRestore?: () => void
}

export default function VersionTimeline({
  versions,
  selectedVersionId,
  onSelect,
  onRestore,
}: VersionTimelineProps) {
  return (
    <section className="writing-side-panel">
      <div className="writing-side-panel__section-head">
        <strong className="writing-side-panel__title">版本历史</strong>
        {onRestore ? <Button size="small" disabled={!selectedVersionId} onClick={onRestore}>恢复所选版本</Button> : null}
      </div>

      {versions.length > 0 ? (
        <div className="writing-side-panel__version-list">
          {versions.slice(0, 6).map((version) => {
            const active = version.id === selectedVersionId

            return (
              <button
                key={version.id}
                type="button"
                onClick={() => onSelect?.(version.id)}
                className={`writing-side-panel__version-button${active ? ' is-active' : ''}`}
              >
                <div className="writing-side-panel__version-copy">
                  <strong>{sourceLabel(version.versionSource)}</strong>
                  <span className="writing-side-panel__meta">
                    {`${version.wordCount || 0} 字 · ${new Date(version.createdAt).toLocaleString()}`}
                  </span>
                </div>
                {active ? <Tag color="gold" className="writing-side-panel__version-current">当前选择</Tag> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="writing-side-panel__empty">当前章节还没有可恢复的版本。</div>
      )}
    </section>
  )
}
