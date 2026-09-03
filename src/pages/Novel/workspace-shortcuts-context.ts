import { createContext, useContext, useEffect, useRef } from 'react'

export interface NovelWorkspaceActions {
  registerSaveHandler: (handler: (() => void) | null) => void
  registerClearHandler: (handler: (() => void) | null) => void
  registerEscapeHandler: (handler: (() => void) | null) => void
  registerLeaveGuard: (isDirty: (() => boolean) | null) => void
  notifyWorkspaceMutation: () => void
  mutationToken: number
}

const DEFAULT_ACTIONS: NovelWorkspaceActions = {
  registerSaveHandler: () => {},
  registerClearHandler: () => {},
  registerEscapeHandler: () => {},
  registerLeaveGuard: () => {},
  notifyWorkspaceMutation: () => {},
  mutationToken: 0,
}

export const NovelWorkspaceActionsContext = createContext<NovelWorkspaceActions>(DEFAULT_ACTIONS)

export function useNovelWorkspaceActions() {
  return useContext(NovelWorkspaceActionsContext)
}

export function useRegisterWorkspaceLeaveGuard(isDirty: boolean) {
  const { registerLeaveGuard } = useNovelWorkspaceActions()
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  useEffect(() => {
    registerLeaveGuard(() => dirtyRef.current)
    return () => registerLeaveGuard(null)
  }, [registerLeaveGuard])
}
