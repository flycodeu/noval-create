import React from 'react'
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Pagination,
  Select,
  Space,
  Tag,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  LinkOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import VirtualList from 'rc-virtual-list'
import type {
  Chapter,
  ChapterSegment,
  PagedResult,
  StoryMemoryCheckpoint,
  StoryStructureChapterSummary,
  StoryStructurePartSummary,
  StoryStructureSegmentSummary,
  StoryStructureVolumeSummary,
  TimelineAnchorFilters,
  TimelineEvent,
} from '../../../types'
import {
  getChapterLabel,
  getPartLabel,
  getSegmentLabel,
  getVolumeLabel,
} from '../shared/workspace-utils'
import { WorkspacePanel } from '../components/WorkspaceShell'
import type { ChapterFormValues, SegmentFormValues } from './helpers'
import { SEGMENT_STATUS_OPTIONS, SEGMENT_TYPE_OPTIONS, TIMELINE_STATUS_META, parseActiveThreadCount } from './helpers'

interface StructureLinkedEventsPanelProps {
  linked: PagedResult<TimelineEvent>
  timelineFilters: TimelineAnchorFilters | null
  onOpenEvent: (eventId: number) => void
  onPageChange: (page: number) => void
}

export function StructureLinkedEventsPanel({
  linked,
  timelineFilters,
  onOpenEvent,
  onPageChange,
}: StructureLinkedEventsPanelProps) {
  return (
    <WorkspacePanel title="关联事件">
      {linked.total === 0 ? (
        <div className="novel-empty">当前节点还没有关联事件。</div>
      ) : (
        <div className="novel-structure-linked-list">
          {linked.items.map((event) => (
            <button
              key={event.id}
              type="button"
              className="novel-structure-linked-card"
              onClick={() => onOpenEvent(event.id)}
            >
              <div className="novel-structure-linked-card__head">
                <strong>{event.eventTitle}</strong>
                <Tag color={TIMELINE_STATUS_META[event.status].color}>
                  {TIMELINE_STATUS_META[event.status].label}
                </Tag>
              </div>
              <div className="novel-structure-linked-card__meta">
                <span>{event.timeLabel || '时间未标注'}</span>
                {event.eventType ? <span>{event.eventType}</span> : null}
                {event.anchorInvalid ? <span>锚点待修复</span> : null}
              </div>
              <div className="novel-structure-linked-card__desc">
                {event.eventSummary || event.eventResult || event.eventCause || '这条事件还没有摘要。'}
              </div>
            </button>
          ))}
          <Pagination
            current={linked.page}
            pageSize={linked.pageSize}
            total={linked.total}
            size="small"
            showSizeChanger={false}
            onChange={(page) => {
              if (timelineFilters) onPageChange(page)
            }}
          />
        </div>
      )}
    </WorkspacePanel>
  )
}

interface StructureCheckpointsPanelProps {
  title: string
  checkpoints: PagedResult<StoryMemoryCheckpoint>
  onPageChange: (page: number) => void
}

export function StructureCheckpointsPanel({
  title,
  checkpoints,
  onPageChange,
}: StructureCheckpointsPanelProps) {
  return (
    <WorkspacePanel title={title}>
      {checkpoints.total === 0 ? (
        <div className="novel-empty">当前层级还没有检查点。</div>
      ) : (
        <div className="novel-structure-checkpoint-list">
          {checkpoints.items.map((item) => (
            <section
              key={item.id}
              className={`novel-structure-checkpoint ${item.stale === 1 ? 'novel-structure-checkpoint--stale' : ''}`}
            >
              <div className="novel-structure-checkpoint__head">
                <strong>{item.label || '未命名检查点'}</strong>
                <Tag color={item.stale === 1 ? 'warning' : 'success'}>
                  {item.stale === 1 ? '待刷新' : `v${item.version}`}
                </Tag>
              </div>
              <div className="novel-structure-checkpoint__summary">{item.summary || '暂无摘要。'}</div>
              <div className="novel-structure-checkpoint__meta">
                <span>
                  {item.sourceRangeStart
                    ? `章节 ${item.sourceRangeStart}-${item.sourceRangeEnd || item.sourceRangeStart}`
                    : '范围待定'}
                </span>
                <span>{parseActiveThreadCount(item.activeThreadsJson)} 条活跃线程</span>
              </div>
            </section>
          ))}
          <Pagination
            current={checkpoints.page}
            pageSize={checkpoints.pageSize}
            total={checkpoints.total}
            size="small"
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </div>
      )}
    </WorkspacePanel>
  )
}

export function StructureAsideTip() {
  return null
}

interface StructureVolumesPanelProps {
  volumes: StoryStructureVolumeSummary[]
  selectedVolumeId: number | null
  editingVolumeId: number | null
  editingTitle: string
  onEditingTitleChange: (value: string) => void
  onSelectVolume: (volumeId: number) => void
  onStartRenameVolume: (volume: StoryStructureVolumeSummary) => void
  onCancelRename: () => void
  onSaveRename: () => void
  onAddPart: (volumeId: number) => void
  onDeleteVolume: (volume: StoryStructureVolumeSummary) => void
  onDragEnd: (result: DropResult) => void
}

export function StructureVolumesPanel({
  volumes,
  selectedVolumeId,
  editingVolumeId,
  editingTitle,
  onEditingTitleChange,
  onSelectVolume,
  onStartRenameVolume,
  onCancelRename,
  onSaveRename,
  onAddPart,
  onDeleteVolume,
  onDragEnd,
}: StructureVolumesPanelProps) {
  return (
    <WorkspacePanel title="卷">
      {volumes.length === 0 ? (
        <div className="novel-empty">先创建一卷。</div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="volumes" type="volume">
            {(drop) => (
              <div ref={drop.innerRef} {...drop.droppableProps} className="novel-structure-volume-board">
                {volumes.map((volume, index) => (
                  <Draggable key={volume.id} draggableId={`volume-${volume.id}`} index={index}>
                    {(drag) => (
                      <section
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={`novel-structure-volume-card ${selectedVolumeId === volume.id ? 'is-active' : ''}`}
                      >
                        <div className="novel-structure-volume-card__head">
                          <div className="novel-structure-card-title">
                            <button type="button" className="novel-structure-drag-handle" {...drag.dragHandleProps}>
                              <HolderOutlined />
                            </button>
                            <button
                              type="button"
                              className="novel-structure-card-title__main"
                              onClick={() => onSelectVolume(volume.id)}
                            >
                              <div className="novel-kicker">{`第 ${volume.volumeNumber} 卷`}</div>
                              {editingVolumeId === volume.id ? (
                                <div className="novel-structure-inline-editor" onClick={(event) => event.stopPropagation()}>
                                  <Input
                                    value={editingTitle}
                                    onChange={(event) => onEditingTitleChange(event.target.value)}
                                    onPressEnter={onSaveRename}
                                    autoFocus
                                  />
                                  <Button size="small" type="primary" onClick={onSaveRename}>保存</Button>
                                  <Button size="small" onClick={onCancelRename}>取消</Button>
                                </div>
                              ) : (
                                <strong>{getVolumeLabel(volume)}</strong>
                              )}
                            </button>
                          </div>
                          <Space size={8}>
                            {editingVolumeId !== volume.id ? (
                              <Button size="small" icon={<EditOutlined />} onClick={() => onStartRenameVolume(volume)}>
                                改名
                              </Button>
                            ) : null}
                            <Button size="small" icon={<PlusOutlined />} onClick={() => onAddPart(volume.id)}>
                              加一部
                            </Button>
                            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeleteVolume(volume)}>
                              删除
                            </Button>
                          </Space>
                        </div>
                        <div className="novel-structure-volume-card__meta">
                          <span>{volume.partCount} 部</span>
                          <span>{volume.chapterCount} 章</span>
                          <span>{volume.segmentCount} 场景</span>
                          <span>{volume.linkedTimelineEventCount} 条事件</span>
                        </div>
                      </section>
                    )}
                  </Draggable>
                ))}
                {drop.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </WorkspacePanel>
  )
}

interface StructurePartsPanelProps {
  currentVolume: StoryStructureVolumeSummary | null
  parts: PagedResult<StoryStructurePartSummary>
  selectedPartId: number | null
  editingPartId: number | null
  editingTitle: string
  onEditingTitleChange: (value: string) => void
  onSelectPart: (partId: number) => void
  onStartRenamePart: (part: StoryStructurePartSummary) => void
  onCancelRename: () => void
  onSaveRename: () => void
  onDeletePart: (part: StoryStructurePartSummary) => void
  onPageChange: (page: number) => void
  onDragEnd: (result: DropResult) => void
}

export function StructurePartsPanel({
  currentVolume,
  parts,
  selectedPartId,
  editingPartId,
  editingTitle,
  onEditingTitleChange,
  onSelectPart,
  onStartRenamePart,
  onCancelRename,
  onSaveRename,
  onDeletePart,
  onPageChange,
  onDragEnd,
}: StructurePartsPanelProps) {
  return (
    <WorkspacePanel title={currentVolume ? `部 · ${getVolumeLabel(currentVolume)}` : '部'}>
      {!currentVolume ? (
        <div className="novel-empty">先选择一卷。</div>
      ) : parts.total === 0 ? (
        <Empty description="当前卷还没有部。" />
      ) : (
        <>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="parts" type="part">
              {(drop) => (
                <div ref={drop.innerRef} {...drop.droppableProps} className="novel-structure-part-stack">
                  {parts.items.map((part, index) => (
                    <Draggable key={part.id} draggableId={`part-${part.id}`} index={index}>
                      {(drag) => (
                        <section
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          className={`novel-structure-part-card ${selectedPartId === part.id ? 'is-active' : ''}`}
                        >
                          <div className="novel-structure-part-card__head">
                            <div className="novel-structure-card-title">
                              <button type="button" className="novel-structure-drag-handle" {...drag.dragHandleProps}>
                                <HolderOutlined />
                              </button>
                              <button
                                type="button"
                                className="novel-structure-card-title__main"
                                onClick={() => onSelectPart(part.id)}
                              >
                                <div className="novel-kicker">{`第 ${part.partNumber} 部`}</div>
                                {editingPartId === part.id ? (
                                  <div className="novel-structure-inline-editor" onClick={(event) => event.stopPropagation()}>
                                    <Input
                                      value={editingTitle}
                                      onChange={(event) => onEditingTitleChange(event.target.value)}
                                      onPressEnter={onSaveRename}
                                      autoFocus
                                    />
                                    <Button size="small" type="primary" onClick={onSaveRename}>保存</Button>
                                    <Button size="small" onClick={onCancelRename}>取消</Button>
                                  </div>
                                ) : (
                                  <strong>{getPartLabel(part)}</strong>
                                )}
                              </button>
                            </div>
                            <Space size={8}>
                              {editingPartId !== part.id ? (
                                <Button size="small" icon={<EditOutlined />} onClick={() => onStartRenamePart(part)}>
                                  改名
                                </Button>
                              ) : null}
                              <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDeletePart(part)}>
                                删除
                              </Button>
                            </Space>
                          </div>
                          <div className="novel-structure-part-card__meta">
                            <span>{part.chapterCount} 章</span>
                            <span>{part.segmentCount} 场景</span>
                            <span>{part.linkedTimelineEventCount} 条事件</span>
                          </div>
                        </section>
                      )}
                    </Draggable>
                  ))}
                  {drop.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
          <Pagination
            current={parts.page}
            pageSize={parts.pageSize}
            total={parts.total}
            size="small"
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </>
      )}
    </WorkspacePanel>
  )
}

interface StructureChaptersPanelProps {
  currentPart: StoryStructurePartSummary | null
  chapters: PagedResult<StoryStructureChapterSummary>
  selectedChapterId: number | null
  onSelectChapter: (chapterId: number) => void
  onAddChapter: () => void
  onPageChange: (page: number) => void
}

export function StructureChaptersPanel({
  currentPart,
  chapters,
  selectedChapterId,
  onSelectChapter,
  onAddChapter,
  onPageChange,
}: StructureChaptersPanelProps) {
  return (
    <WorkspacePanel
      title={currentPart ? `章节 · ${getPartLabel(currentPart)}` : '章节'}
      extra={currentPart ? <Button icon={<PlusOutlined />} onClick={onAddChapter}>加章节</Button> : null}
    >
      {!currentPart ? (
        <div className="novel-empty">先选择一部。</div>
      ) : chapters.total === 0 ? (
        <Empty description="当前部还没有章节。" />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <VirtualList data={chapters.items} height={380} itemHeight={112} itemKey="id">
            {(chapter: StoryStructureChapterSummary) => (
              <button
                key={chapter.id}
                type="button"
                className={`novel-structure-chapter-card ${selectedChapterId === chapter.id ? 'is-active' : ''}`}
                onClick={() => onSelectChapter(chapter.id)}
              >
                <div className="novel-structure-chapter-card__head">
                  <span>{getChapterLabel(chapter)}</span>
                  <Tag color={chapter.segmentCount && chapter.segmentCount > 1 ? 'blue' : 'default'}>
                    {chapter.segmentCount || 0} 场景
                  </Tag>
                </div>
                <strong>{chapter.title || getChapterLabel(chapter)}</strong>
                <div className="novel-structure-chapter-card__meta">
                  <span>{chapter.wordCount || 0} 字</span>
                  <span>{chapter.linkedTimelineEventCount} 条事件</span>
                  <span>{chapter.compiledFromSegments ? '已编译' : '待编译'}</span>
                </div>
              </button>
            )}
          </VirtualList>
          <Pagination
            current={chapters.page}
            pageSize={chapters.pageSize}
            total={chapters.total}
            size="small"
            showSizeChanger={false}
            onChange={onPageChange}
          />
        </div>
      )}
    </WorkspacePanel>
  )
}

interface StructureSegmentsPanelProps {
  chapterDetail: Chapter | null
  segments: PagedResult<StoryStructureSegmentSummary>
  selectedSegmentId: number | null
  canReorderSegments: boolean
  onSelectSegment: (segmentId: number) => void
  onAddSegment: () => void
  onCreateEvent: () => void
  onDragEnd: (result: DropResult) => void
  onPageChange: (page: number) => void
}

export function StructureSegmentsPanel({
  chapterDetail,
  segments,
  selectedSegmentId,
  canReorderSegments,
  onSelectSegment,
  onAddSegment,
  onCreateEvent,
  onDragEnd,
  onPageChange,
}: StructureSegmentsPanelProps) {
  return (
    <WorkspacePanel
      title={chapterDetail ? `场景 · 第 ${chapterDetail.chapterNum} 章` : '场景'}
      extra={chapterDetail ? (
        <Space size={8}>
          <Button icon={<PlusOutlined />} onClick={onAddSegment}>加场景</Button>
          <Button icon={<LinkOutlined />} onClick={onCreateEvent}>建事件</Button>
        </Space>
      ) : null}
    >
      {!chapterDetail ? (
        <div className="novel-empty">先选择章节。</div>
      ) : segments.total === 0 ? (
        <Empty description="当前章节还没有场景。" />
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {canReorderSegments ? (
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="segments" type="segment">
                {(drop) => (
                  <div ref={drop.innerRef} {...drop.droppableProps} className="novel-structure-scene-board">
                    {segments.items.map((segment, index) => (
                      <Draggable key={segment.id} draggableId={`segment-${segment.id}`} index={index}>
                        {(drag) => (
                          <button
                            ref={drag.innerRef}
                            {...drag.draggableProps}
                            {...drag.dragHandleProps}
                            type="button"
                            className={`novel-structure-scene-card ${selectedSegmentId === segment.id ? 'is-active' : ''}`}
                            onClick={() => onSelectSegment(segment.id)}
                          >
                            <StructureSegmentCard segment={segment} />
                          </button>
                        )}
                      </Draggable>
                    ))}
                    {drop.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>
          ) : (
            <>
              <VirtualList data={segments.items} height={340} itemHeight={112} itemKey="id">
                {(segment: StoryStructureSegmentSummary) => (
                  <button
                    key={segment.id}
                    type="button"
                    className={`novel-structure-scene-card ${selectedSegmentId === segment.id ? 'is-active' : ''}`}
                    onClick={() => onSelectSegment(segment.id)}
                  >
                    <StructureSegmentCard segment={segment} />
                  </button>
                )}
              </VirtualList>
              <Pagination
                current={segments.page}
                pageSize={segments.pageSize}
                total={segments.total}
                size="small"
                showSizeChanger={false}
                onChange={onPageChange}
              />
            </>
          )}
        </div>
      )}
    </WorkspacePanel>
  )
}

function StructureSegmentCard({ segment }: { segment: StoryStructureSegmentSummary }) {
  return (
    <>
      <div className="novel-structure-scene-card__head">
        <span>{`场景 ${String(segment.segmentOrder).padStart(2, '0')}`}</span>
        <Tag color={segment.status === 'locked' ? 'success' : segment.status === 'draft' ? 'processing' : 'default'}>
          {segment.status || 'planned'}
        </Tag>
      </div>
      <strong>{getSegmentLabel(segment)}</strong>
      <div className="novel-structure-scene-card__meta">
        <span>{segment.segmentType || 'scene'}</span>
        <span>{segment.locationName || '地点未定'}</span>
        <span>{segment.linkedTimelineEventCount || 0} 条事件</span>
      </div>
      <div className="novel-structure-scene-card__desc">
        {segment.purpose || segment.summary || '先写清这个场景为什么存在。'}
      </div>
    </>
  )
}

interface ChapterEditorPanelProps {
  chapterDetail: Chapter | null
  parts: PagedResult<StoryStructurePartSummary>
  chapterForm: ReturnType<typeof Form.useForm<ChapterFormValues>>[0]
  savingChapter: boolean
  onSaveChapter: () => void
  onDeleteChapter: () => void
  aiActions?: React.ReactNode
}

export function ChapterEditorPanel({
  chapterDetail,
  parts,
  chapterForm,
  savingChapter,
  onSaveChapter,
  onDeleteChapter,
  aiActions,
}: ChapterEditorPanelProps) {
  return (
    <WorkspacePanel
      title={chapterDetail ? `章节编辑 · 第 ${chapterDetail.chapterNum} 章` : '章节编辑'}
      extra={chapterDetail ? (
        <Space>
          {aiActions}
          <Button danger icon={<DeleteOutlined />} onClick={onDeleteChapter}>
            删除章节
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={savingChapter} onClick={onSaveChapter}>
            保存章节
          </Button>
        </Space>
      ) : null}
    >
      {!chapterDetail ? (
        <div className="novel-empty">先选择章节。</div>
      ) : (
        <Form form={chapterForm} layout="vertical">
          <div className="novel-grid novel-grid--2">
            <Form.Item name="title" label="章节标题">
              <Input />
            </Form.Item>
            <Form.Item name="partId" label="所属部">
              <Select options={parts.items.map((item) => ({ value: item.id, label: getPartLabel(item) }))} />
            </Form.Item>
          </div>
          <div className="novel-grid novel-grid--2">
            <Form.Item name="targetWords" label="目标字数">
              <InputNumber min={1000} step={500} style={{ width: '100%' }} />
            </Form.Item>
            <div className="novel-structure-inline-hint">
              <strong>正文状态</strong>
              <span>{chapterDetail.compiledFromSegments ? '正文来自场景编译。' : '正文可能与场景结构不同步。'}</span>
            </div>
          </div>
          <Form.Item name="outline" label="章节目标">
            <Input.TextArea rows={4} placeholder="本章推进什么、收束什么、留下什么。" />
          </Form.Item>
        </Form>
      )}
    </WorkspacePanel>
  )
}

interface SegmentEditorPanelProps {
  segmentDetail: ChapterSegment | null
  selectionSegmentId: number | null
  visibleSegments: StoryStructureSegmentSummary[]
  segmentForm: ReturnType<typeof Form.useForm<SegmentFormValues>>[0]
  savingSegment: boolean
  onSaveSegment: () => void
  onDeleteSegment: () => void
  aiActions?: React.ReactNode
}

export function SegmentEditorPanel({
  segmentDetail,
  selectionSegmentId,
  visibleSegments,
  segmentForm,
  savingSegment,
  onSaveSegment,
  onDeleteSegment,
  aiActions,
}: SegmentEditorPanelProps) {
  const isSelectedSegmentOutsideWindow = Boolean(
    segmentDetail
      && selectionSegmentId
      && !visibleSegments.some((item) => item.id === selectionSegmentId),
  )

  return (
    <WorkspacePanel
      title={segmentDetail ? `场景编辑 · ${getSegmentLabel(segmentDetail)}` : '场景编辑'}
      extra={segmentDetail ? (
        <Space>
          {aiActions}
          <Button danger icon={<DeleteOutlined />} onClick={onDeleteSegment}>
            删除场景
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={savingSegment} onClick={onSaveSegment}>
            保存场景
          </Button>
        </Space>
      ) : null}
    >
      {!segmentDetail ? (
        <div className="novel-empty">先选择一个场景。</div>
      ) : (
        <>
          <Form form={segmentForm} layout="vertical">
            <div className="novel-grid novel-grid--2">
              <Form.Item name="title" label="场景标题">
                <Input />
              </Form.Item>
              <Form.Item name="segmentType" label="片段类型">
                <Select options={SEGMENT_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
              </Form.Item>
            </div>
            <div className="novel-grid novel-grid--3">
              <Form.Item name="timeAnchor" label="时间锚点">
                <Input />
              </Form.Item>
              <Form.Item name="locationName" label="地点">
                <Input />
              </Form.Item>
              <Form.Item name="status" label="状态">
                <Select options={SEGMENT_STATUS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
              </Form.Item>
            </div>
            <div className="novel-grid novel-grid--2">
              <Form.Item name="inputState" label="进入状态">
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="outputState" label="离开状态">
                <Input.TextArea rows={3} />
              </Form.Item>
            </div>
            <Form.Item name="purpose" label="场景作用">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="summary" label="片段摘要">
              <Input.TextArea rows={3} />
            </Form.Item>
            <Form.Item name="content" label="场景正文">
              <Input.TextArea rows={10} />
            </Form.Item>
          </Form>
          {isSelectedSegmentOutsideWindow ? (
            <Alert
              style={{ marginTop: 14 }}
              showIcon
              type="info"
              message="当前场景不在本页窗口中。"
              description="编辑面板已经定位到目标场景，场景列表可翻页继续查看它所在的窗口。"
            />
          ) : null}
        </>
      )}
    </WorkspacePanel>
  )
}
