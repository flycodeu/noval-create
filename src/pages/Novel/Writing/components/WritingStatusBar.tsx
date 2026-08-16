import { Button } from 'antd'
import type { Chapter } from '../../../../types'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import { formatChapterNumber } from '../chapter-labels'
import type { WritingRouteKey } from './InsightPanel'

export interface WritingStatusBarProps {
  currentChapter: Chapter | null
  editorTitle: string
  primaryStatusText: string
  wordCount: number
  writability: { score: number; label: string }
  versionCount: number
  currentStatusLabel: string
  insightPanelOpen: boolean
  onToggleInspector(): void
  onNavigate(route: WritingRouteKey): void
}

export default function WritingStatusBar({
  currentChapter,
  currentStatusLabel,
  editorTitle,
  insightPanelOpen,
  onNavigate,
  onToggleInspector,
  primaryStatusText,
  versionCount,
  wordCount,
  writability,
}: WritingStatusBarProps) {
  return (
    <section className="chapter-console-page__panel chapter-console-page__editor-hero">
      <div className="chapter-console-page__editor-hero-main">
        <SectionHeader
          eyebrow="写作主任务"
          title={currentChapter ? `${formatChapterNumber(currentChapter.chapterNum)} · ${editorTitle}` : '请选择一个章节'}
          description={primaryStatusText}
        />
        <div className="chapter-console-page__hero-meta chapter-console-page__hero-meta--compact">
          <div><span>字数</span><strong>{currentChapter ? `${wordCount} 字` : '未开始'}</strong></div>
          <div><span>可写性</span><strong>{`${writability.score}% · ${writability.label}`}</strong></div>
          <div><span>版本</span><strong>{versionCount > 0 ? `${versionCount} 个` : '暂无'}</strong></div>
          <div><span>状态</span><strong>{currentStatusLabel}</strong></div>
        </div>
      </div>
      <div className="chapter-console-page__editor-hero-actions">
        <Button onClick={onToggleInspector}>{insightPanelOpen ? '收起辅助区' : '展开辅助区'}</Button>
        <Button onClick={() => onNavigate('context')}>上下文</Button>
        <Button onClick={() => onNavigate('review')}>审校</Button>
      </div>
    </section>
  )
}
