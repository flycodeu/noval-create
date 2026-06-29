import React from 'react'

interface Props {
  title?: string
  children: React.ReactNode
}

export default function ContextRoute({ title = '上下文视图', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--context" data-route="context">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
