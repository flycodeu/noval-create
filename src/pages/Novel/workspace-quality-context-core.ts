import React from 'react'
import type {
  WorkspaceQualityRepairPreview,
} from '../../types'

export interface RegisteredWorkspaceQualityController {
  workspaceKey: string
  getSnapshot: () => Record<string, unknown> | Promise<Record<string, unknown>>
  applySnapshot: (snapshot: Record<string, unknown>) => void | Promise<void>
  persistPreview?: (snapshot: Record<string, unknown>, preview: WorkspaceQualityRepairPreview) => Promise<void>
  readonly?: boolean
}

export interface WorkspaceQualityContextValue {
  controller: RegisteredWorkspaceQualityController | null
  registerController: (controller: RegisteredWorkspaceQualityController | null) => () => void
}

const DEFAULT_VALUE: WorkspaceQualityContextValue = {
  controller: null,
  registerController: () => () => {},
}

export const NovelWorkspaceQualityContext = React.createContext<WorkspaceQualityContextValue>(DEFAULT_VALUE)

export function useNovelWorkspaceQuality() {
  return React.useContext(NovelWorkspaceQualityContext)
}

export function useRegisterWorkspaceQualityController(controller: RegisteredWorkspaceQualityController | null) {
  const { registerController } = useNovelWorkspaceQuality()

  React.useEffect(() => {
    return registerController(controller)
  }, [controller, registerController])
}
