import React from 'react'
import { Button, Tag } from 'antd'
import type { ChapterVersion } from '../../../types'

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
        <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>版本历史</strong>
        {onRestore ? <Button size="small" disabled={!selectedVersionId} onClick={onRestore}>恢复所选版本</Button> : null}
      </div>

      {versions.length > 0 ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {versions.slice(0, 6).map((version) => {
            const active = version.id === selectedVersionId

            return (
              <button
                key={version.id}
                type="button"
                onClick={() => onSelect?.(version.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'rgba(166, 106, 43, 0.28)' : 'var(--border-light)'}`,
                  background: active ? 'var(--primary-soft)' : '#fff',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                  <strong style={{ fontSize: 12, color: 'var(--text-main)' }}>{sourceLabel(version.versionSource)}</strong>
                  <span style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                    {`${version.wordCount || 0} 字 · ${new Date(version.createdAt).toLocaleString()}`}
                  </span>
                </div>
                {active ? <Tag color="gold" style={{ margin: 0 }}>当前选择</Tag> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>当前章节还没有可恢复的版本。</div>
      )}
    </section>
  )
}
