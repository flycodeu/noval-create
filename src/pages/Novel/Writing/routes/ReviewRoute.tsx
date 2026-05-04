import React from 'react'

interface Props {
  title?: string
  subtitle?: string
  children: React.ReactNode
}

export default function ReviewRoute({ title = '审校视图', subtitle = '验收门、AI 体检与修订建议', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--review" data-route="review">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
