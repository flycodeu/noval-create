import React, { useEffect, useState } from 'react'
import { Drawer, Spin } from 'antd'
import type { PipelineBarItem } from '../../../../components/novel/writing/PipelineBar'
import type { Chapter } from '../../../../types'
import type { WritingCommandBindings } from '../useWritingCommandBindings'
import ChapterNavigator from './ChapterNavigator'
import WritingCommandBar from './WritingCommandBar'
import WritingEditorPane, { type WritingEditorPaneProps } from './WritingEditorPane'
import WritingInspector, { type WritingInspectorProps } from './WritingInspector'
import WritingPipelineStrip from './WritingPipelineStrip'
import WritingStatusBar from './WritingStatusBar'

export interface WritingWorkspaceLayoutProps {
  loading: boolean
  refreshing: boolean
  currentChapter: Chapter | null
  pipelineItems: PipelineBarItem[]
  insightPanelOpen: boolean
  commandBindings: WritingCommandBindings
  editor: Omit<WritingEditorPaneProps, 'commandBar'>
  inspector: WritingInspectorProps
}

function useNarrowWritingLayout() {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)')
    const sync = () => setNarrow(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])
  return narrow
}

export default function WritingWorkspaceLayout({
  commandBindings,
  currentChapter,
  editor,
  insightPanelOpen,
  inspector,
  loading,
  pipelineItems,
  refreshing,
}: WritingWorkspaceLayoutProps) {
  const narrow = useNarrowWritingLayout()
  const [navigatorOpen, setNavigatorOpen] = useState(false)
  const navigator = <ChapterNavigator {...commandBindings.navigator} />
  const inspectorPanel = <WritingInspector {...inspector} />

  return (
    <div
      className="novel-writing-console-page chapter-console-page"
      data-writing-navigator-mode={narrow ? 'drawer' : 'column'}
      data-writing-unsaved-guard={commandBindings.statusBar.saveState === 'saved' ? 'inactive' : 'active'}
    >
      {loading && !currentChapter ? (
        <div className="chapter-console-page__loading">
          <Spin size="large" />
        </div>
      ) : (
        <>
          {refreshing ? (
            <div className="novel-dashboard__refresh-indicator workspace-alert-spaced">
              <Spin size="small" />
              <span>正在同步正文工作台数据</span>
            </div>
          ) : null}
          <WritingPipelineStrip items={pipelineItems} />

          <div className={`chapter-console-page__grid${insightPanelOpen ? ' has-assist-panel' : ' is-assist-collapsed'}`}>
            {!narrow ? (
              <aside className="chapter-console-page__column chapter-console-page__column--left">
                {navigator}
              </aside>
            ) : null}

            <section className="chapter-console-page__column chapter-console-page__column--center">
              <WritingStatusBar
                {...commandBindings.statusBar}
                onOpenNavigator={narrow ? () => setNavigatorOpen(true) : undefined}
              />
              <WritingEditorPane
                {...editor}
                commandBar={<WritingCommandBar {...commandBindings.commandBar} />}
              />
            </section>

            {!narrow ? inspectorPanel : null}
          </div>

          {narrow ? (
            <>
              <Drawer
                className="writing-drawer writing-drawer--navigator"
                title="章节目录"
                placement="left"
                width="min(88vw, 340px)"
                open={navigatorOpen}
                onClose={() => setNavigatorOpen(false)}
                destroyOnHidden={false}
              >
                {navigator}
              </Drawer>
              <Drawer
                className="writing-drawer writing-drawer--inspector"
                title="章节辅助视图"
                placement="right"
                width="min(92vw, 420px)"
                open={insightPanelOpen}
                onClose={commandBindings.statusBar.onToggleInspector}
                destroyOnHidden={false}
              >
                {inspectorPanel}
              </Drawer>
            </>
          ) : null}
        </>
      )}
    </div>
  )
}
