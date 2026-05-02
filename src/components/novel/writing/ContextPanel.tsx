import React from 'react'
import { Tag } from 'antd'

export interface ContextPanelSection {
  key: string
  title: string
  items: string[]
  tone?: 'default' | 'danger'
}

interface ContextPanelProps {
  title: string
  sections: ContextPanelSection[]
}

export default function ContextPanel({ title, sections }: ContextPanelProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 14,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-light)',
        background: 'var(--bg-surface)',
      }}
    >
      <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>{title}</strong>

      {sections.map((section) => (
        <div
          key={section.key}
          style={{
            display: 'grid',
            gap: 8,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${section.tone === 'danger' ? 'rgba(194, 65, 12, 0.18)' : 'var(--border-light)'}`,
            background: 'var(--bg-elevated)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{section.title}</strong>
            <Tag style={{ margin: 0 }}>{section.items.length}</Tag>
          </div>
          {section.items.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {section.items.slice(0, 6).map((item, index) => (
                <div key={`${section.key}-${index}`} style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-sub)' }}>
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>当前没有可展示内容。</div>
          )}
        </div>
      ))}
    </section>
  )
}
