import React from 'react'
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
  description?: string
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
  description,
  chrome = 'legacy',
  actions,
  actionContract,
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
}: WorkspacePageProps) {
  const hasAside = Boolean(aside)
  const metricItems = flattenWorkspaceNodes(metrics)
  const metricCount = metricItems.length
  const visibleMetrics = metricItems.slice(0, 2)
  const overflowMetrics = metricItems.slice(2)
  const inlineMetrics = metricCount > 0 && metricCount <= 2
  const portal = useWorkspaceChromePortal()
  const usesSharedChrome = chrome === 'shared'
  const isProjectShell = Boolean(portal)
  const sharedInformation = usesSharedChrome ? (
    <WorkspaceInformationRail
      eyebrow={eyebrow}
      title={title}
      description={description}
      contextSummary={contextSummary}
      metrics={metrics}
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
        {actions ? <div className="novel-hero__actions">{actions}</div> : null}
        {sharedActions && !sharedActionsMounted ? <div className="novel-hero__actions">{sharedActions}</div> : null}
        {contextSummary ? <div className="novel-hero__context">{contextSummary}</div> : null}
        {visibleMetrics.length > 0 ? <div className="novel-hero__metrics">{visibleMetrics}</div> : null}
        {overflowMetrics.length > 0 ? (
          <details className="novel-hero__metric-more">
            <summary title="查看其余指标">更多指标 <span aria-hidden="true">{overflowMetrics.length}</span></summary>
            <div className="novel-hero__metric-more-grid">{overflowMetrics}</div>
          </details>
        ) : null}
      </section> : null}

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
  const descriptionContent = description ? descriptionMode === 'inline' ? (
    <div className="novel-panel__desc">{description}</div>
  ) : (
    <details className="novel-panel__description-disclosure">
      <summary title="查看说明">说明</summary>
      <div className="novel-panel__desc">{description}</div>
    </details>
  ) : null

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
              {descriptionContent}
            </div>
          ) : description ? <div className="novel-panel__copy">{descriptionContent}</div> : null}
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
