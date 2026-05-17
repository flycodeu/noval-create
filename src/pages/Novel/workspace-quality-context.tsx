import React from 'react'
import type { WorkspaceQualityContextValue } from './workspace-quality-context-core'
import { NovelWorkspaceQualityContext } from './workspace-quality-context-core'

export function NovelWorkspaceQualityProvider({
  value,
  children,
}: {
  value: WorkspaceQualityContextValue
  children: React.ReactNode
}) {
  return (
    <NovelWorkspaceQualityContext.Provider value={value}>
      {children}
    </NovelWorkspaceQualityContext.Provider>
  )
}
