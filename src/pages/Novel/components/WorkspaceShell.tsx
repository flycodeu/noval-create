import React from 'react'

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function getNodeTitle(value: React.ReactNode): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : undefined
}

export function WorkspacePage({
  eyebrow: _eyebrow,
  title,
  description: _description,
  actions,
  metrics,
  contextSummary,
  aside,
  footerBar,
  heroVariant = 'default',
  layout = 'wide',
  asidePlacement = 'below',
  bodyClassName,
  className,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  metrics?: React.ReactNode
  contextSummary?: React.ReactNode
  aside?: React.ReactNode
  footerBar?: React.ReactNode
  heroVariant?: 'default' | 'compact'
  layout?: 'standard' | 'wide'
  asidePlacement?: 'side' | 'below'
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const hasAside = Boolean(aside)

  return (
    <div className={joinClassNames('novel-workspace', `novel-workspace--${layout}`, className)}>
      <section className={joinClassNames('novel-hero', heroVariant === 'compact' && 'novel-hero--compact')}>
        <div className="novel-hero__copy">
          <h1 className="novel-hero__title">{title}</h1>
        </div>
        {actions ? <div className="novel-hero__actions">{actions}</div> : null}
        {contextSummary ? <div className="novel-hero__context">{contextSummary}</div> : null}
        {metrics ? <div className="novel-hero__metrics">{metrics}</div> : null}
      </section>

      <div
        className={joinClassNames(
          'novel-workspace__body',
          hasAside && 'novel-workspace__body--with-aside',
          hasAside && `novel-workspace__body--aside-${asidePlacement}`,
          bodyClassName,
        )}
      >
        <div className="novel-workspace__main">{children}</div>
        {aside ? <aside className="novel-workspace__aside">{aside}</aside> : null}
      </div>

      {footerBar ? <div className="novel-workspace__footer">{footerBar}</div> : null}
    </div>
  )
}

export function WorkspaceMetric({
  label,
  value,
  hint: _hint,
  tone = 'default',
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'warm' | 'cool'
}) {
  return (
    <div className={`novel-metric novel-metric--${tone}`}>
      <div className="novel-metric__label">{label}</div>
      <div className="novel-metric__value" title={getNodeTitle(value)}>{value}</div>
    </div>
  )
}

export function WorkspacePanel({
  title,
  description: _description,
  extra,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  extra?: React.ReactNode
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section className={joinClassNames('novel-panel', className)}>
      {title || extra ? (
        <div className="novel-panel__header">
          {title ? <div><h2 className="novel-panel__title">{title}</h2></div> : null}
          {extra ? <div className="novel-panel__extra">{extra}</div> : null}
        </div>
      ) : null}
      <div className={joinClassNames('novel-panel__body', bodyClassName)}>{children}</div>
    </section>
  )
}

export function WorkspaceTip({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="novel-tip-card">
      <div className="novel-tip-card__title">{title}</div>
      <div className="novel-tip-card__body">{children}</div>
    </section>
  )
}

export function WorkspaceContextSummary({
  items,
}: {
  items: Array<{ label: string; value: React.ReactNode }>
}) {
  return (
    <dl className="novel-context-summary">
      {items.map((item) => (
        <div key={item.label} className="novel-context-summary__item">
          <dt>{item.label}</dt>
          <dd title={getNodeTitle(item.value)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
