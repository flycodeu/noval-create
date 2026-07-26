import React, { useState } from 'react'

/** 右侧辅助区通用卡片：支持 hero / soft 三种色调与可折叠模式。 */
export function InsightCard({
  title,
  eyebrow,
  tone = 'default',
  collapsible = false,
  defaultOpen = false,
  children,
}: {
  title: string
  eyebrow?: string
  tone?: 'default' | 'hero' | 'soft'
  collapsible?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const cardClassName = `novel-writing-shell__insight-card novel-writing-shell__insight-card--${tone}`
  const header = (
    <div className="novel-writing-shell__insight-card-header">
      {eyebrow ? <div className="novel-writing-shell__insight-card-eyebrow">{eyebrow}</div> : null}
      <div className="novel-writing-shell__insight-card-title">{title}</div>
    </div>
  )

  if (!collapsible) {
    return (
      <section className={cardClassName}>
        {header}
        <div className="novel-writing-shell__insight-card-body">{children}</div>
      </section>
    )
  }

  return (
    <details
      className={`${cardClassName} novel-writing-shell__insight-card--collapsible`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="novel-writing-shell__insight-card-header">
        {eyebrow ? <span className="novel-writing-shell__insight-card-eyebrow">{eyebrow}</span> : null}
        <span className="novel-writing-shell__insight-card-title">{title}</span>
        <span className="novel-writing-shell__insight-card-toggle" aria-hidden="true">{open ? '收起' : '展开'}</span>
      </summary>
      <div className="novel-writing-shell__insight-card-body">{children}</div>
    </details>
  )
}

/** 简单字符串清单：空态展示占位文案。 */
export function StringList({ items, empty }: { items: string[]; empty: string }) {
  return items.length > 0 ? <div className="novel-insight-list">{items.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item">{item}</div>)}</div> : <div className="novel-copy-block">{empty}</div>
}
