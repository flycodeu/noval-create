import type { ReactNode } from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { EllipsisOutlined } from '@ant-design/icons'
import {
  flattenWorkspaceNodes,
  type WorkspaceActionContract,
  type WorkspaceActionItem,
} from './workspace-chrome-contract'
import './workspace-chrome.css'

const MAX_VISIBLE_SECONDARY_ACTIONS = 2

function partitionWorkspaceActions(contract: WorkspaceActionContract) {
  const secondary = contract.secondary || []
  return {
    visibleSecondary: secondary.slice(0, MAX_VISIBLE_SECONDARY_ACTIONS),
    overflowSecondary: secondary.slice(MAX_VISIBLE_SECONDARY_ACTIONS),
  }
}

function actionToMenuItem(action: WorkspaceActionItem, prefix: string): NonNullable<MenuProps['items']>[number] {
  return {
    key: `${prefix}-${action.key}`,
    icon: action.icon,
    label: action.label,
    disabled: action.disabled || action.loading,
    danger: action.danger,
    onClick: action.onClick,
  }
}

function ActionButton({ action, primary = false }: { action: WorkspaceActionItem; primary?: boolean }) {
  return (
    <Button
      className={`workspace-contract-action${primary ? ' workspace-contract-action--primary' : ''}`}
      type={primary ? 'primary' : 'default'}
      icon={action.icon}
      loading={action.loading}
      disabled={action.disabled}
      danger={action.danger}
      onClick={action.onClick}
      aria-label={action.ariaLabel || action.label}
      title={action.ariaLabel || action.label}
    >
      {action.label}
    </Button>
  )
}

export function WorkspaceContractActions({ contract }: { contract: WorkspaceActionContract }) {
  const secondary = contract.secondary || []
  const { visibleSecondary, overflowSecondary } = partitionWorkspaceActions(contract)
  const explicitMoreItems = (contract.more?.items || []).filter(Boolean)
  const desktopOverflowItems: NonNullable<MenuProps['items']> = [
    ...overflowSecondary.map((action) => actionToMenuItem(action, 'workspace-overflow')),
    ...(overflowSecondary.length > 0 && explicitMoreItems.length > 0 ? [{ type: 'divider' as const }] : []),
    ...explicitMoreItems,
  ]
  const compactOverflowItems: NonNullable<MenuProps['items']> = [
    ...secondary.map((action) => actionToMenuItem(action, 'workspace-compact')),
    ...(secondary.length > 0 && explicitMoreItems.length > 0 ? [{ type: 'divider' as const }] : []),
    ...explicitMoreItems,
  ]

  return (
    <div className="workspace-contract-actions" data-visible-secondary={visibleSecondary.length}>
      <div className="workspace-contract-actions__secondary">
        {visibleSecondary.map((action) => <ActionButton key={action.key} action={action} />)}
      </div>
      {desktopOverflowItems.length > 0 ? (
        <Dropdown menu={{ ...contract.more, items: desktopOverflowItems }} trigger={['click']}>
          <Button
            className="workspace-contract-actions__more workspace-contract-actions__more--desktop"
            icon={<EllipsisOutlined />}
            aria-label="更多页面操作"
            title="更多页面操作"
          />
        </Dropdown>
      ) : null}
      {compactOverflowItems.length > 0 ? (
        <Dropdown menu={{ ...contract.more, items: compactOverflowItems }} trigger={['click']}>
          <Button
            className="workspace-contract-actions__more workspace-contract-actions__more--compact"
            icon={<EllipsisOutlined />}
            aria-label="页面操作"
            title="页面操作"
          >
            页面操作
          </Button>
        </Dropdown>
      ) : null}
      <ActionButton action={contract.primary} primary />
    </div>
  )
}

export function WorkspaceInformationRail({
  eyebrow,
  title,
  description: _description,
  contextSummary,
  metrics,
}: {
  eyebrow?: string
  title: string
  description?: string
  contextSummary?: ReactNode
  metrics?: ReactNode
}) {
  const metricItems = flattenWorkspaceNodes(metrics)
  const visibleMetrics = metricItems.slice(0, 2)
  const overflowMetrics = metricItems.slice(2)

  return (
    <section
      className="workspace-information-rail"
      aria-label={`${title} 页面信息`}
      data-workspace-information="rail"
    >
      <div className="workspace-information-rail__copy">
        {eyebrow ? <span className="workspace-information-rail__eyebrow">{eyebrow}</span> : null}
        <div className="workspace-information-rail__heading" title={title}>
          <h1>{title}</h1>
        </div>
      </div>
      {contextSummary || visibleMetrics.length > 0 || overflowMetrics.length > 0 ? (
        <div className="workspace-information-rail__facts">
          {contextSummary ? <div className="workspace-information-rail__context">{contextSummary}</div> : null}
          {visibleMetrics.length > 0 ? <div className="workspace-information-rail__metrics">{visibleMetrics}</div> : null}
          {overflowMetrics.length > 0 ? (
            <details className="workspace-information-rail__more-metrics">
              <summary title="查看其余指标">更多 <span aria-hidden="true">{overflowMetrics.length}</span></summary>
              <div className="workspace-information-rail__more-grid">{overflowMetrics}</div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
