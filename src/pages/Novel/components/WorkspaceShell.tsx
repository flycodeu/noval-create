import React, { useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import type { MenuProps } from 'antd'
import {
  useWorkspaceActionDispatch,
  useWorkspaceActionPortal,
} from '../../../components/novel/workspace-layout/workspace-actions-context'

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function countRenderableNodes(node: React.ReactNode): number {
  if (node === null || node === undefined || typeof node === 'boolean') return 0
  if (Array.isArray(node)) {
    return node.reduce((total, child) => total + countRenderableNodes(child), 0)
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === React.Fragment) {
    return countRenderableNodes(node.props.children)
  }
  return 1
}

export function WorkspacePage({
  eyebrow,
  title,
  description,
  actions,
  primaryAction,
  secondaryActions,
  moreMenu,
  metrics,
  contextSummary,
  guide,
  aside,
  footerBar,
  heroVariant = 'default',
  layout = 'wide',
  scrollMode = 'sectioned',
  asidePlacement = 'below',
  bodyClassName,
  className,
  children,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: React.ReactNode
  primaryAction?: React.ReactNode
  secondaryActions?: React.ReactNode[]
  moreMenu?: MenuProps
  metrics?: React.ReactNode
  contextSummary?: React.ReactNode
  guide?: React.ReactNode
  aside?: React.ReactNode
  footerBar?: React.ReactNode
  heroVariant?: 'default' | 'compact'
  layout?: 'standard' | 'wide'
  scrollMode?: 'sectioned' | 'document'
  asidePlacement?: 'side' | 'below'
  bodyClassName?: string
  className?: string
  children: React.ReactNode
}) {
  const hasAside = Boolean(aside)
  const metricCount = countRenderableNodes(metrics)
  const inlineMetrics = metricCount > 0 && metricCount <= 2

  const dispatch = useWorkspaceActionDispatch()
  const actionPortal = useWorkspaceActionPortal()
  const isMigrated = Boolean(primaryAction || secondaryActions || moreMenu)
  const pageActions = isMigrated ? (
    <>
      {secondaryActions}
      {primaryAction}
    </>
  ) : actions

  useLayoutEffect(() => {
    if (!dispatch?.setActions) return undefined
    dispatch.setActions(moreMenu ? { moreMenu } : null)
    return () => {
      dispatch.setActions(null)
    }
  }, [dispatch, moreMenu])

  return (
    <>
    {actionPortal && pageActions ? createPortal(pageActions, actionPortal) : null}
    <div
      className={joinClassNames(
        'novel-workspace',
        `novel-workspace--${layout}`,
        `novel-workspace--${scrollMode}`,
        className,
      )}
    >
      <section
        className={joinClassNames(
          'novel-hero',
          heroVariant === 'compact' && 'novel-hero--compact',
          Boolean(actions) && 'novel-hero--has-actions',
          Boolean(contextSummary) && 'novel-hero--has-context',
          Boolean(metrics) && 'novel-hero--has-metrics',
          inlineMetrics && 'novel-hero--inline-metrics',
        )}
        data-metric-count={metricCount || undefined}
      >
        <div className="novel-hero__copy">
          {eyebrow ? <div className="novel-hero__eyebrow">{eyebrow}</div> : null}
          <h1 className="novel-hero__title">{title}</h1>
          {description ? <p className="novel-hero__description">{description}</p> : null}
        </div>
        {pageActions && !actionPortal ? <div className="novel-hero__actions">{pageActions}</div> : null}
        {contextSummary ? <div className="novel-hero__context">{contextSummary}</div> : null}
        {metrics ? <div className="novel-hero__metrics">{metrics}</div> : null}
      </section>

      {guide ? <div className="novel-workspace__guide">{guide}</div> : null}

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
    </>
  )
}

export function WorkspaceMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'warm' | 'cool'
}) {
  return (
    <div className={`novel-metric novel-metric--${tone}`}>
      <div className="novel-metric__label">{label}</div>
      <div className="novel-metric__value">{value}</div>
    </div>
  )
}

export function WorkspacePanel({
  title,
  description,
  extra,
  scrollable = false,
  sticky = false,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  extra?: React.ReactNode
  scrollable?: boolean
  sticky?: boolean
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={joinClassNames(
        'novel-panel',
        scrollable && 'novel-panel--scrollable',
        sticky && 'novel-panel--sticky',
        className,
      )}
    >
      {title || description || extra ? (
        <div className="novel-panel__header">
          {title ? (
            <div className="novel-panel__copy">
              {title ? <h2 className="novel-panel__title">{title}</h2> : null}
              {description ? <div className="novel-panel__desc">{description}</div> : null}
            </div>
          ) : description ? <div className="novel-panel__copy"><div className="novel-panel__desc">{description}</div></div> : null}
          {extra ? <div className="novel-panel__extra">{extra}</div> : null}
        </div>
      ) : null}
      <div className={joinClassNames('novel-panel__body', bodyClassName)}>{children}</div>
    </section>
  )
}

export function WorkspaceStepGuide({
  title = '本页流程',
  steps,
}: {
  title?: string
  steps: Array<{ title: string; description: string; status?: 'todo' | 'focus' | 'done' }>
}) {
  const completedCount = steps.filter((step) => step.status === 'done').length

  return (
    <details className="novel-step-guide">
      <summary className="novel-step-guide__head">
        <div className="novel-step-guide__head-copy">
          <div className="novel-step-guide__eyebrow">按需展开</div>
          <strong>{title}</strong>
        </div>
        <span className="novel-step-guide__progress">{`${completedCount}/${steps.length}`}</span>
      </summary>
      <div className="novel-step-guide__grid">
        {steps.map((step, index) => (
          <article
            key={`${index + 1}-${step.title}`}
            className={joinClassNames(
              'novel-step-guide__item',
              step.status && `novel-step-guide__item--${step.status}`,
            )}
          >
            <div className="novel-step-guide__index">{String(index + 1).padStart(2, '0')}</div>
            <div className="novel-step-guide__copy">
              <strong>{step.title}</strong>
              {step.description ? <span>{step.description}</span> : null}
            </div>
          </article>
        ))}
      </div>
    </details>
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
