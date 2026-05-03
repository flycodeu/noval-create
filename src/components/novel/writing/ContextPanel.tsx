import React from 'react'
import { Tag } from 'antd'
import './WritingSidePanels.css'

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
    <section className="writing-side-panel">
      <strong className="writing-side-panel__title">{title}</strong>

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
              {section.items.slice(0, 6).map((item, index) => (
                <div key={`${section.key}-${index}`} className="writing-side-panel__item">
                  {item}
                </div>
              ))}
            </div>
          ) : (
            <div className="writing-side-panel__empty">当前没有可展示内容。</div>
          )}
        </div>
      ))}
    </section>
  )
}
