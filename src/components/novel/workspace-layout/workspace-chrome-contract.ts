import { Fragment, createContext, isValidElement, useContext, type ReactNode } from 'react'
import type { MenuProps } from 'antd'

export function flattenWorkspaceNodes(node: ReactNode): ReactNode[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (Array.isArray(node)) return node.flatMap(flattenWorkspaceNodes)
  if (isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment) {
    return flattenWorkspaceNodes(node.props.children)
  }
  return [node]
}

export interface WorkspaceActionItem {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  danger?: boolean
  ariaLabel?: string
}

export interface WorkspaceActionContract {
  primary: WorkspaceActionItem
  secondary?: WorkspaceActionItem[]
  more?: MenuProps
}

export interface WorkspaceChromePortalTargets {
  actionTarget: HTMLDivElement | null
  informationTarget: HTMLDivElement | null
}

export const WorkspaceChromePortalContext = createContext<WorkspaceChromePortalTargets | null>(null)

export function useWorkspaceChromePortal() {
  return useContext(WorkspaceChromePortalContext)
}
