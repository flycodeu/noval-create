import React from 'react'

interface Props {
  title?: string
  subtitle?: string
  children: React.ReactNode
}

export default function HistoryRoute({ title = '版本视图', subtitle: _subtitle = '历史版本与恢复操作', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--history" data-route="history">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
