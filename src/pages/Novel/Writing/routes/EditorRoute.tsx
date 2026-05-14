import React from 'react'

interface Props {
  title?: string
  subtitle?: string
  children: React.ReactNode
}

export default function EditorRoute({ title = '正文生产', subtitle: _subtitle = '章节合同、编辑器与执行状态', children }: Props) {
  return (
    <section className="writing-route-view writing-route-view--editor" data-route="editor">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        {children}
      </div>
    </section>
  )
}
