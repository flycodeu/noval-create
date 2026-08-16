import type { FormEvent, ReactNode, RefObject } from 'react'
import { Alert, Button, Tag } from 'antd'
import { ApartmentOutlined, BranchesOutlined } from '@ant-design/icons'
import ActionErrorAlert from '../../../../components/common/ActionErrorAlert'
import SectionHeader from '../../../../components/novel/common/SectionHeader'
import type { Chapter, ChapterPublishCheck, ChapterSegment, WritebackSyncStatus } from '../../../../types'
import type { WritingActionError } from '../useChapterGeneration'
import { countChapterWords } from '../useChapterEditor'
import StreamingOutput from './StreamingOutput'

export interface WritingEditorPaneProps {
  title: string
  subtitle: string
  currentChapter: Chapter | null
  content: string
  wordCount: number
  editorRef: RefObject<HTMLDivElement>
  commandBar: ReactNode
  actionError: WritingActionError | null
  generating: boolean
  streamTaskId?: number | null
  resumable: { visible: boolean; content: string; cancelled: boolean; onResume(): void; onRestart(): void }
  segments: ChapterSegment[]
  onInput(event: FormEvent<HTMLDivElement>): void
  onSyncSelection(): void
  onDismissError(): void
  onOpenStructure(): void
  onCompile(): void
  advisory: {
    count: number
    open: boolean
    productionBriefItems: string[]
    staleReasonSummary: string
    writebackStatus: WritebackSyncStatus | null
    writebackPhaseLabel: string
    publishCheck: ChapterPublishCheck | null
    publishCheckAlertType: 'success' | 'info' | 'warning' | 'error'
    onToggle(): void
  }
}

function SegmentBoardPreview({ segments, onOpenStructure, onCompile }: {
  segments: ChapterSegment[]
  onOpenStructure(): void
  onCompile(): void
}) {
  return (
    <div className="novel-writing-shell__segment-board">
      <div className="novel-writing-shell__segment-board-head">
        <div><div className="novel-kicker">场景结构</div><strong>{segments.length} 个场景片段</strong></div>
        <div className="novel-writing-shell__segment-board-actions">
          <Button size="small" icon={<ApartmentOutlined />} onClick={onOpenStructure}>结构页</Button>
          <Button size="small" icon={<BranchesOutlined />} onClick={onCompile}>编译章节</Button>
        </div>
      </div>
      <div className="novel-writing-shell__segment-board-grid">
        {segments.map((segment) => (
          <div key={segment.id} className="novel-writing-shell__segment-card">
            <div className="novel-writing-shell__segment-card-head">
              <span>{`场景 ${String(segment.segmentOrder).padStart(2, '0')}`}</span>
              <Tag color={segment.status === 'locked' ? 'success' : segment.status === 'draft' ? 'processing' : 'default'}>
                {segment.status || 'planned'}
              </Tag>
            </div>
            <strong>{segment.title || `场景 ${segment.segmentOrder}`}</strong>
            <div className="novel-writing-shell__segment-card-meta">
              <span>{segment.segmentType || 'scene'}</span><span>{segment.locationName || '地点未定'}</span><span>{segment.timeAnchor || '时间未定'}</span>
            </div>
            <div className="novel-writing-shell__segment-card-desc">{segment.purpose || segment.summary || '当前场景还没有明确作用。'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function WritingEditorPane(props: WritingEditorPaneProps) {
  const {
    actionError, advisory, commandBar, content, currentChapter, editorRef, generating, onCompile,
    onDismissError, onInput, onOpenStructure, onSyncSelection, resumable, segments, streamTaskId,
    subtitle, title, wordCount,
  } = props
  const hasMultiSegments = (currentChapter?.segmentCount || 0) > 1
  return (
    <section className="chapter-console-page__panel chapter-console-page__editor-card">
      <SectionHeader title={title} description={subtitle} extra={currentChapter ? <Tag color="default">{`字数 ${wordCount}`}</Tag> : null} />
      {commandBar}
      {actionError ? <ActionErrorAlert title={actionError.title} message={actionError.message} onRetry={actionError.retry} onDismiss={onDismissError} /> : null}
      {generating ? <StreamingOutput streamTaskId={streamTaskId} /> : null}
      {resumable.visible ? (
        <Alert showIcon type={resumable.cancelled ? 'warning' : 'error'} message="检测到可恢复的中断正文" description={(
          <div className="novel-writing-shell__segment-alert">
            <div className="novel-writing-shell__segment-alert-copy">{`已保留 ${countChapterWords(resumable.content)} 字正文草稿。当前恢复模式会基于这份内容继续往后写，不会重写前文。`}</div>
            <div className="novel-writing-shell__segment-alert-actions">
              <Button size="small" type="primary" onClick={resumable.onResume}>从断点继续</Button>
              <Button size="small" onClick={resumable.onRestart}>从头重来</Button>
            </div>
          </div>
        )} />
      ) : null}
      <div className="chapter-console-page__editor-sheet-wrap">
        {currentChapter ? (hasMultiSegments ? (
          <div className="novel-writing-shell__segment-preview">
            <div className="novel-writing-shell__editor-sheet novel-writing-shell__editor-sheet--readonly">{content}</div>
            <SegmentBoardPreview segments={segments} onOpenStructure={onOpenStructure} onCompile={onCompile} />
          </div>
        ) : (
          <div ref={editorRef} contentEditable suppressContentEditableWarning onInput={onInput} onMouseUp={onSyncSelection} onKeyUp={onSyncSelection} className="novel-writing-shell__editor-sheet">{content}</div>
        )) : <div className="novel-empty novel-empty--writing">请选择左侧章节，或先创建一个新章节开始写作。</div>}
      </div>
      {advisory.count > 0 ? (
        <div className="chapter-console-page__advisory">
          <button type="button" className="chapter-console-page__advisory-toggle" onClick={advisory.onToggle}>{advisory.open ? '收起' : '展开'}修订建议与验收（{advisory.count}）</button>
          {advisory.open ? (
            <div className="chapter-console-page__advisory-body">
              {advisory.productionBriefItems.length > 0 ? <div className="chapter-console-page__brief-strip">{advisory.productionBriefItems.map((item) => <div key={item} className="chapter-console-page__brief-chip">{item}</div>)}</div> : null}
              {advisory.staleReasonSummary ? <Alert showIcon type="warning" message="当前章节上下文已过期" description={advisory.staleReasonSummary} /> : null}
              {advisory.writebackStatus?.readyForNextChapter === false ? (
                <Alert showIcon type={advisory.writebackStatus.phase === 'failed' ? 'error' : 'warning'} message={advisory.writebackStatus.candidateReady ? '候选已生成，等待正典应用' : '等待回写候选'} description={`当前处于 ${advisory.writebackPhaseLabel}，正典${advisory.writebackStatus.canonApplied ? '已应用' : '尚未应用'}。${advisory.writebackStatus.lastError ? `原因：${advisory.writebackStatus.lastError}` : '完成正典应用前，系统会暂停后续章节生成。'}`} />
              ) : null}
              {advisory.publishCheck ? <Alert showIcon type={advisory.publishCheckAlertType} message={`章节验收：${advisory.publishCheck.summary}`} description={`重写 ${advisory.publishCheck.rewriteCount} 项，阻塞 ${advisory.publishCheck.blockerCount} 项，预警 ${advisory.publishCheck.warningCount} 项。`} /> : null}
              {hasMultiSegments ? (
                <Alert showIcon type="info" message="当前章节处于多场景结构模式" description={(
                  <div className="novel-writing-shell__segment-alert">
                    <div className="novel-writing-shell__segment-alert-copy">该章节已经拆成多个场景。请优先维护场景合同，再重新编译整章。</div>
                    <div className="novel-writing-shell__segment-alert-actions">
                      <Button size="small" icon={<ApartmentOutlined />} onClick={onOpenStructure}>去结构页</Button>
                      <Button size="small" icon={<BranchesOutlined />} onClick={onCompile}>重新编译</Button>
                    </div>
                  </div>
                )} />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
