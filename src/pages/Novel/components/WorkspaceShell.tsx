import React, { cloneElement, isValidElement } from 'react'
import { createPortal } from 'react-dom'
import {
  WorkspaceContractActions,
  WorkspaceInformationRail,
} from '../../../components/novel/workspace-layout/workspace-chrome'
import {
  useWorkspaceChromePortal,
  flattenWorkspaceNodes,
  type WorkspaceActionContract,
} from '../../../components/novel/workspace-layout/workspace-chrome-contract'
import './workspace-simplification.css'

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

interface WorkspacePageBaseProps {
  eyebrow?: string
  title: string
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
}

type WorkspacePageChromeProps =
  | {
      chrome?: 'legacy'
      actions?: React.ReactNode
      actionContract?: never
    }
  | {
      chrome: 'shared'
      actions?: never
      actionContract: WorkspaceActionContract
    }

type WorkspacePageProps = WorkspacePageBaseProps & WorkspacePageChromeProps

export function WorkspacePage({
  eyebrow,
  title,
  chrome = 'legacy',
  actions,
  actionContract,
  metrics,
  contextSummary: _contextSummary,
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
}: WorkspacePageProps) {
  const hasAside = Boolean(aside)
  const metricItems = flattenWorkspaceNodes(metrics)
  const metricCount = metricItems.length
  const compactMetrics = metricCount > 0
    ? (
      <div className="novel-hero__metrics novel-hero__metrics--compact" data-metric-count={metricCount}>
        {metricItems.map((node, index) => (
          isValidElement(node)
            ? cloneElement(node as React.ReactElement<{ compact?: boolean }>, {
                compact: true,
                key: node.key ?? `metric-${index}`,
              })
            : node
        ))}
      </div>
    )
    : null
  const portal = useWorkspaceChromePortal()
  const usesSharedChrome = chrome === 'shared'
  const isProjectShell = Boolean(portal)
  const sharedInformation = usesSharedChrome ? (
    <WorkspaceInformationRail
      eyebrow={eyebrow}
      title={title}
    />
  ) : null
  const sharedActions = usesSharedChrome && actionContract
    ? <WorkspaceContractActions contract={actionContract} />
    : null
  const sharedInformationMounted = Boolean(usesSharedChrome && portal?.informationTarget)
  const sharedActionsMounted = Boolean(usesSharedChrome && portal?.actionTarget)

  return (
    <>
    {sharedInformationMounted && sharedInformation
      ? createPortal(sharedInformation, portal?.informationTarget as HTMLDivElement)
      : null}
    {sharedActionsMounted && sharedActions
      ? createPortal(sharedActions, portal?.actionTarget as HTMLDivElement)
      : null}
    <div
      className={joinClassNames(
        'novel-workspace',
        `novel-workspace--${layout}`,
        `novel-workspace--${scrollMode}`,
        usesSharedChrome && 'novel-workspace--shared-chrome',
        className,
      )}
      data-workspace-surface="quiet"
      data-workspace-chrome={chrome}
      data-workspace-information-mounted={usesSharedChrome ? String(sharedInformationMounted) : 'legacy'}
      data-workspace-actions-mounted={usesSharedChrome ? String(sharedActionsMounted) : 'legacy'}
      data-workspace-project-shell={String(isProjectShell)}
    >
      {!usesSharedChrome || !sharedInformationMounted ? <section
        className={joinClassNames(
          'novel-hero',
          heroVariant === 'compact' && 'novel-hero--compact',
          Boolean(actions || sharedActions) && 'novel-hero--has-actions',
          Boolean(metrics) && 'novel-hero--has-metrics',
          metricCount > 0 && 'novel-hero--compact-metrics',
        )}
        data-metric-count={metricCount || undefined}
      >
        <div className="novel-hero__copy">
          {eyebrow ? <div className="novel-hero__eyebrow">{eyebrow}</div> : null}
          <div className="novel-hero__title-row">
            <h1 className="novel-hero__title">{title}</h1>
            {compactMetrics}
          </div>
        </div>
        {actions ? <div className="novel-hero__actions">{actions}</div> : null}
        {sharedActions && !sharedActionsMounted ? <div className="novel-hero__actions">{sharedActions}</div> : null}
      </section> : compactMetrics ? (
        <div className="novel-workspace__page-metrics">{compactMetrics}</div>
      ) : null}

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
  compact = false,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'warm' | 'cool'
  compact?: boolean
}) {
  return (
    <div className={joinClassNames('novel-metric', `novel-metric--${tone}`, compact && 'novel-metric--compact')}>
      <span className="novel-metric__label">{label}</span>
      <span className="novel-metric__value">{value}</span>
    </div>
  )
}

export function WorkspacePanel({
  title,
  description,
  extra,
  scrollable = false,
  sticky = false,
  descriptionMode = 'disclosure',
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  extra?: React.ReactNode
  scrollable?: boolean
  sticky?: boolean
  descriptionMode?: 'disclosure' | 'inline'
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  const hasDescription = description !== undefined && description !== null && description !== ''

  return (
    <section
      className={joinClassNames(
        'novel-panel',
        scrollable && 'novel-panel--scrollable',
        sticky && 'novel-panel--sticky',
        className,
      )}
    >
      {title || hasDescription || extra ? (
        <div className="novel-panel__header">
          {title ? (
            <div className="novel-panel__copy">
              <h2 className="novel-panel__title">{title}</h2>
              {hasDescription && descriptionMode === 'disclosure' ? (
                <details className="novel-panel__description-disclosure">
                  <summary>查看说明</summary>
                  <div className="novel-panel__desc">{description}</div>
                </details>
              ) : null}
              {hasDescription && descriptionMode === 'inline' ? (
                <div className="novel-panel__desc novel-panel__desc--inline">{description}</div>
              ) : null}
            </div>
          ) : hasDescription ? (
            <div className="novel-panel__copy">
              {descriptionMode === 'disclosure' ? (
                <details className="novel-panel__description-disclosure">
                  <summary>查看说明</summary>
                  <div className="novel-panel__desc">{description}</div>
                </details>
              ) : <div className="novel-panel__desc novel-panel__desc--inline">{description}</div>}
            </div>
          ) : null}
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
          <span className="novel-step-guide__eyebrow">流程提示</span>
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
