import React from 'react'
import { Button, Spin } from 'antd'
import { InsightCard } from '../components/InsightPanel'
import type { HistoryInspectorActions, HistoryInspectorViewModel } from '../writing-inspector-view-model'

interface Props {
  model: HistoryInspectorViewModel
  actions: HistoryInspectorActions
  title?: string
}

export default function HistoryRoute({ model, actions, title = '版本视图' }: Props) {
  return (
    <section className="writing-route-view writing-route-view--history" data-route="history">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        <div className="novel-writing-shell__insight-stack">
          <InsightCard title="章节版本历史" eyebrow={model.eyebrow}>
            {!model.chapterSelected ? (
              <div className="novel-copy-block">请先从左侧选择一个章节。</div>
            ) : (
              <div className="novel-split novel-split--sidebar">
                <div className="novel-note-list">
                  {model.loading ? <Spin size="small" /> : null}
                  {!model.loading && model.versions.length === 0 ? <div className="novel-note-list__item">当前章节还没有可恢复的版本。</div> : null}
                  {model.versions.map((version) => (
                    <button
                      key={version.id}
                      type="button"
                      className={`novel-sidebar__nav-item chapter-console-page__version-button ${model.selectedVersionId === version.id ? 'novel-sidebar__nav-item--active' : ''}`}
                      onClick={() => actions.onSelectVersion(version.id)}
                    >
                      <span className="novel-sidebar__nav-copy">
                        <strong>{version.sourceLabel}</strong>
                        <small>{version.meta}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="writing-layout-stack">
                  <div className="novel-copy-block writing-layout-copy-prewrap writing-layout-copy-tall">{model.selectedContent}</div>
                  <div className="writing-layout-row writing-layout-row--end writing-layout-row--wrap">
                    <Button onClick={actions.onReturnToEditor}>返回编辑</Button>
                    <Button type="primary" disabled={!model.canRestore} onClick={actions.onRestoreVersion}>恢复所选版本</Button>
                  </div>
                </div>
              </div>
            )}
          </InsightCard>
        </div>
      </div>
    </section>
  )
}
