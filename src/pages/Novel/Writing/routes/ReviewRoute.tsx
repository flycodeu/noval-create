import React from 'react'

interface Props {
  title?: string
  children: React.ReactNode
}

export default function ReviewRoute({ title = '审校视图', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--review" data-route="review">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
