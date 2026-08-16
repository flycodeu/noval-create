import React from 'react'
import { Spin } from 'antd'
import PipelineBar, { type PipelineBarItem } from '../../../../components/novel/writing/PipelineBar'
import type { Chapter } from '../../../../types'
import type { ChapterHeaderViewModel, WritingMetadataViewModel } from '../writing-chapter-presentation'
import type { WritingCommandBindings } from '../useWritingCommandBindings'
import ChapterNavigator from './ChapterNavigator'
import WritingAcceptanceSummary from './WritingAcceptanceSummary'
import WritingChapterHeader from './WritingChapterHeader'
import WritingCommandBar from './WritingCommandBar'
import WritingEditorPane, { type WritingEditorPaneProps } from './WritingEditorPane'
import WritingFooter, { type WritingFooterProps } from './WritingFooter'
import WritingInspector, { type WritingInspectorProps } from './WritingInspector'
import WritingStatusBar from './WritingStatusBar'

export interface WritingWorkspaceLayoutProps {
  loading: boolean
  refreshing: boolean
  currentChapter: Chapter | null
  pipelineItems: PipelineBarItem[]
  chapterHeader: ChapterHeaderViewModel
  insightPanelOpen: boolean
  commandBindings: WritingCommandBindings
  editor: Omit<WritingEditorPaneProps, 'commandBar'>
  acceptance: WritingMetadataViewModel['acceptance']
  qualityIssues: WritingMetadataViewModel['qualityIssues']
  inspector: WritingInspectorProps
  footer: WritingFooterProps
}

export default function WritingWorkspaceLayout({
  acceptance,
  chapterHeader,
  commandBindings,
  currentChapter,
  editor,
  footer,
  insightPanelOpen,
  inspector,
  loading,
  pipelineItems,
  qualityIssues,
  refreshing,
}: WritingWorkspaceLayoutProps) {
  return (
    <div className="novel-writing-console-page chapter-console-page">
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
          <div className="chapter-console-page__pipeline">
            <PipelineBar items={pipelineItems} />
          </div>

          <WritingChapterHeader model={chapterHeader} />

          <div className={`chapter-console-page__grid${insightPanelOpen ? ' has-assist-panel' : ' is-assist-collapsed'}`}>
            <aside className="chapter-console-page__column chapter-console-page__column--left">
              <ChapterNavigator {...commandBindings.navigator} />
            </aside>

            <section className="chapter-console-page__column chapter-console-page__column--center">
              <WritingStatusBar {...commandBindings.statusBar} />
              <WritingEditorPane
                {...editor}
                commandBar={<WritingCommandBar {...commandBindings.commandBar} />}
              />
              <WritingAcceptanceSummary acceptance={acceptance} qualityIssues={qualityIssues} />
            </section>

            <WritingInspector {...inspector} />
          </div>

          <WritingFooter {...footer} />
        </>
      )}
    </div>
  )
}
