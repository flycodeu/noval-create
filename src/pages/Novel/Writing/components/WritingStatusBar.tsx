import { Button, Dropdown, Tag } from 'antd'
import { BookOutlined, DownOutlined } from '@ant-design/icons'
import type { Chapter } from '../../../../types'
import { formatChapterNumber } from '../chapter-labels'
import type { WritingSaveState } from '../useWritingEditorLifecycle'
import type { WritingRouteKey } from './InsightPanel'

export interface WritingStatusBarProps {
  currentChapter: Chapter | null
  editorTitle: string
  primaryStatusText: string
  wordCount: number
  writability: { score: number; label: string }
  versionCount: number
  currentStatusLabel: string
  saveState: WritingSaveState
  insightPanelOpen: boolean
  onOpenNavigator?(): void
  onToggleInspector(): void
  onNavigate(route: WritingRouteKey): void
}

const SAVE_STATE_META: Record<WritingSaveState, { label: string; tone: string }> = {
  saved: { label: '已保存', tone: 'is-saved' },
  unsaved: { label: '有未保存修改', tone: 'is-unsaved' },
  saving: { label: '正在保存', tone: 'is-saving' },
  error: { label: '保存失败', tone: 'is-error' },
}

export default function WritingStatusBar({
  currentChapter,
  currentStatusLabel,
  editorTitle,
  insightPanelOpen,
  onOpenNavigator,
  onNavigate,
  onToggleInspector,
  saveState,
  versionCount,
  wordCount,
  writability,
}: WritingStatusBarProps) {
  const saveMeta = SAVE_STATE_META[saveState]
  const openInspectorRoute = (route: WritingRouteKey) => {
    onNavigate(route)
    if (!insightPanelOpen) onToggleInspector()
  }
  return (
    <section className="chapter-console-page__editor-hero" data-writing-status-bar="compact">
      <div className="chapter-console-page__editor-identity">
        {onOpenNavigator ? (
          <Button className="chapter-console-page__navigator-trigger" icon={<BookOutlined />} onClick={onOpenNavigator}>
            章节
          </Button>
        ) : null}
        <div className="chapter-console-page__editor-title">
          <strong>{currentChapter ? `${formatChapterNumber(currentChapter.chapterNum)} · ${editorTitle}` : '请选择一个章节'}</strong>
          <span>{currentChapter ? `${wordCount} 字 · ${currentStatusLabel}` : '从章节目录选择正文'}</span>
        </div>
      </div>
      <div className="chapter-console-page__editor-state">
        <span className={`chapter-console-page__save-state ${saveMeta.tone}`} data-writing-save-state={saveState}>
          {saveMeta.label}
        </span>
        <Tag color={writability.score >= 80 ? 'success' : 'gold'}>{`可写性 ${writability.score}%`}</Tag>
        {versionCount > 0 ? <span className="chapter-console-page__version-count">{`${versionCount} 个版本`}</span> : null}
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'editor', label: '焦点与合同' },
              { key: 'context', label: '上下文' },
              { key: 'review', label: '审校' },
              { key: 'history', label: '版本' },
            ],
            onClick: ({ key }) => openInspectorRoute(key as WritingRouteKey),
          }}
        >
          <Button>{insightPanelOpen ? '切换辅助视图' : '打开辅助视图'} <DownOutlined /></Button>
        </Dropdown>
      </div>
    </section>
  )
}
