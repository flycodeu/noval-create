import React from 'react'

interface NovelWorkspaceActions {
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

const NovelWorkspaceActionsContext = React.createContext<NovelWorkspaceActions>(DEFAULT_ACTIONS)

export function NovelWorkspaceActionsProvider({
  value,
  children,
}: {
  value: NovelWorkspaceActions
  children: React.ReactNode
}) {
  return (
    <NovelWorkspaceActionsContext.Provider value={value}>
      {children}
    </NovelWorkspaceActionsContext.Provider>
  )
}

export function useNovelWorkspaceActions() {
  return React.useContext(NovelWorkspaceActionsContext)
}
