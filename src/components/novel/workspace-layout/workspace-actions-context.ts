import { createContext, useContext, ReactNode } from 'react'
import type { MenuProps } from 'antd'

export interface WorkspaceActionContract {
  primaryAction?: ReactNode
  secondaryActions?: ReactNode[]
  moreMenu?: MenuProps
  legacyActions?: ReactNode
}

export interface WorkspaceActionDispatcher {
  setActions: (actions: WorkspaceActionContract | null) => void
}

export const WorkspaceActionContext = createContext<WorkspaceActionContract | null>(null)
export const WorkspaceActionDispatchContext = createContext<WorkspaceActionDispatcher | null>(null)
export const WorkspaceActionPortalContext = createContext<HTMLElement | null>(null)

export function useWorkspaceActions() {
  return useContext(WorkspaceActionContext)
}

export function useWorkspaceActionDispatch() {
  return useContext(WorkspaceActionDispatchContext)
}

export function useWorkspaceActionPortal() {
  return useContext(WorkspaceActionPortalContext)
}
