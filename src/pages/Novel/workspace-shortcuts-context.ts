import { createContext, useContext } from 'react'

export interface NovelWorkspaceActions {
  registerSaveHandler: (handler: (() => void) | null) => void
  registerEscapeHandler: (handler: (() => void) | null) => void
  notifyWorkspaceMutation: () => void
  mutationToken: number
}

const DEFAULT_ACTIONS: NovelWorkspaceActions = {
  registerSaveHandler: () => {},
  registerEscapeHandler: () => {},
  notifyWorkspaceMutation: () => {},
  mutationToken: 0,
}

export const NovelWorkspaceActionsContext = createContext<NovelWorkspaceActions>(DEFAULT_ACTIONS)

export function useNovelWorkspaceActions() {
  return useContext(NovelWorkspaceActionsContext)
}
