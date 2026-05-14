import React from 'react'
import { Empty, Tag } from 'antd'
import './WritingSidePanels.css'

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

export default function ContractPanel({ title, subtitle: _subtitle, sections }: ContractPanelProps) {
  return (
    <section className="writing-side-panel">
      <div className="writing-side-panel__header">
        <strong className="writing-side-panel__title">{title}</strong>
      </div>

      {sections.map((section) => (
        <div
          key={section.key}
          className={`writing-side-panel__section${section.tone ? ` writing-side-panel__section--${section.tone}` : ''}`}
        >
          <div className="writing-side-panel__section-head">
            <strong className="writing-side-panel__section-title">{section.title}</strong>
            <Tag className="writing-side-panel__count-tag">{section.items.length}</Tag>
          </div>
          {section.items.length > 0 ? (
            <div className="writing-side-panel__item-list">
              {section.items.map((item, index) => (
                <div key={`${section.key}-${index}`} className="writing-side-panel__item">
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <Empty className="writing-side-panel__empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前还没有内容" />
          )}
        </div>
      ))}
    </section>
  )
}
