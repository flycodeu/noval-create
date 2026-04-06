import React from 'react'
import {
  NovelWorkspaceActionsContext,
  type NovelWorkspaceActions,
} from './workspace-shortcuts-context'

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
