import React from 'react'

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function WorkspacePage({
  eyebrow,
  title,
  description,
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
  description: string
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
          {eyebrow ? <div className="novel-hero__eyebrow">{eyebrow}</div> : null}
          <h1 className="novel-hero__title">{title}</h1>
          <p className="novel-hero__description">{description}</p>
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
  hint,
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
      <div className="novel-metric__value">{value}</div>
      {hint ? <div className="novel-metric__hint">{hint}</div> : null}
    </div>
  )
}

export function WorkspacePanel({
  title,
  description,
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
      {title || description || extra ? (
        <div className="novel-panel__header">
          <div>
            {title ? <h2 className="novel-panel__title">{title}</h2> : null}
            {description ? <div className="novel-panel__desc">{description}</div> : null}
          </div>
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
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
