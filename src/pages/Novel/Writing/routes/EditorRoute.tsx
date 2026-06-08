import React from 'react'

interface Props {
  title?: string
  subtitle?: string
  children: React.ReactNode
}

export default function EditorRoute({ title = '本章焦点', subtitle = '合同、场景、约束与承接信息', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--editor" data-route="editor">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
