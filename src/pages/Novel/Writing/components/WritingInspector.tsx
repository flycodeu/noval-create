import React, { useEffect } from 'react'
import type { ContractPanelSection } from '../../../../components/novel/writing/ContractPanel'
import type { WritingInspectorActions, WritingInspectorViewModels } from '../writing-inspector-view-model'
import InsightPanel, { type WritingRouteKey } from './InsightPanel'

const routeLoaders = {
  editor: () => import('../routes/EditorRoute'),
  context: () => import('../routes/ContextRoute'),
  review: () => import('../routes/ReviewRoute'),
  history: () => import('../routes/HistoryRoute'),
} satisfies Record<WritingRouteKey, () => Promise<unknown>>

const WritingEditorRoute = React.lazy(routeLoaders.editor)
const WritingContextRoute = React.lazy(routeLoaders.context)
const WritingReviewRoute = React.lazy(routeLoaders.review)
const WritingHistoryRoute = React.lazy(routeLoaders.history)

export interface WritingInspectorProps {
  open: boolean
  activeRoute: WritingRouteKey
  chapterContractSections: ContractPanelSection[]
  sceneContractSections: ContractPanelSection[]
  viewModels: WritingInspectorViewModels
  actions: WritingInspectorActions
  onNavigate(route: WritingRouteKey): void
}

export default function WritingInspector(props: WritingInspectorProps) {
  const { actions, activeRoute, chapterContractSections, onNavigate, open, sceneContractSections, viewModels } = props
  useEffect(() => {
    void routeLoaders[activeRoute]().catch(console.error)
    const preloadTargets = (Object.keys(routeLoaders) as WritingRouteKey[]).filter((route) => route !== activeRoute)
    const timer = window.setTimeout(() => {
      preloadTargets.forEach((route) => void routeLoaders[route]().catch(console.error))
    }, 120)
    return () => window.clearTimeout(timer)
  }, [activeRoute])

  const content = activeRoute === 'context'
    ? <WritingContextRoute model={viewModels.context} />
    : activeRoute === 'review'
      ? <WritingReviewRoute model={viewModels.review} actions={actions.review} />
      : activeRoute === 'history'
        ? <WritingHistoryRoute model={viewModels.history} actions={actions.history} />
        : <WritingEditorRoute model={viewModels.editor} actions={actions.editor} />

  return (
    <InsightPanel open={open} activeRoute={activeRoute} chapterContractSections={chapterContractSections} sceneContractSections={sceneContractSections} onNavigate={onNavigate}>
      <React.Suspense fallback={<div className="novel-copy-block">正在切换视图...</div>}>{content}</React.Suspense>
    </InsightPanel>
  )
}
