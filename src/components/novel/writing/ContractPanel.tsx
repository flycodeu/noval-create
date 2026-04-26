import React from 'react'
import { Empty, Tag } from 'antd'

export interface ContractPanelSection {
  key: string
  title: string
  items: string[]
  tone?: 'default' | 'danger' | 'soft'
}

interface ContractPanelProps {
  title: string
  subtitle?: string
  sections: ContractPanelSection[]
}

export default function ContractPanel({ title, subtitle, sections }: ContractPanelProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 14,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-light)',
        background: '#fff',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>{title}</strong>
        {subtitle ? <span style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>{subtitle}</span> : null}
      </div>

      {sections.map((section) => (
        <div
          key={section.key}
          style={{
            display: 'grid',
            gap: 8,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            border: `1px solid ${section.tone === 'danger' ? 'rgba(194, 65, 12, 0.18)' : 'var(--border-light)'}`,
            background: section.tone === 'soft' ? 'var(--bg-soft)' : '#fff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{section.title}</strong>
            <Tag style={{ margin: 0 }}>{section.items.length}</Tag>
          </div>
          {section.items.length > 0 ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {section.items.map((item, index) => (
                <div key={`${section.key}-${index}`} style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-sub)' }}>
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有内容" styles={{ image: { height: 40 }, description: { fontSize: 12 } }} />
          )}
        </div>
      ))}
    </section>
  )
}
