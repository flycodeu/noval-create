import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Modal, Form, Input, Select, Tag, Empty,
  message, Spin, Tooltip
} from 'antd'
import {
  PlusOutlined, RobotOutlined, DeleteOutlined, EditOutlined,
  HolderOutlined
} from '@ant-design/icons'
import { DragDropContext, Droppable, Draggable, DropResult, DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import type { Chapter, OutlineChapterBatchGenerationResult, StoryArc } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'

interface Props { novelId: number }

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  outline: { label: '待写', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  draft: { label: '草稿', color: '#faad14' },
  reviewing: { label: '审核中', color: '#e67e22' },
  final: { label: '已完成', color: '#52c41a' },
}

export default function Outline({ novelId }: Props) {
  const { chapters, setChapters } = useNovelStore()
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [arcForm] = Form.useForm()
  const [arcModalOpen, setArcModalOpen] = useState(false)
  const [editingArc, setEditingArc] = useState<StoryArc | null>(null)
  const [expandedArcId, setExpandedArcId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [arcList, chapterList] = await Promise.all([
      window.electron.outline.getArcs(novelId),
      window.electron.chapter.list(novelId),
    ])
    setArcs(arcList.sort((a, b) => a.arcOrder - b.arcOrder))
    setChapters(chapterList)
    setLoading(false)
  }, [novelId, setChapters])

  useEffect(() => { loadData() }, [loadData])

  const handleGenerateArcs = async () => {
    setGenerating(true)
    try {
      await window.electron.outline.generateArcs(novelId)
      await loadData()
      message.success('故事弧首批规划完成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : '请先完善核心设定'}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateChapterOutlines = async (arcId: number) => {
    setGenerating(true)
    try {
      const result = await window.electron.outline.generateChapterOutlines(arcId, { batchSize: 4 })
      await loadData()
      message.success((result as OutlineChapterBatchGenerationResult).message || '章节细纲首批已生成。')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : ''}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleSaveArc = async () => {
    const values = arcForm.getFieldsValue()
    if (editingArc) {
      await window.electron.outline.updateArc(editingArc.id, values)
    } else {
      await window.electron.outline.createArc(novelId, {
        ...values,
        arcOrder: arcs.length + 1,
      })
    }
    setArcModalOpen(false)
    arcForm.resetFields()
    setEditingArc(null)
    loadData()
  }

  const handleDeleteArc = async (arc: StoryArc) => {
    Modal.confirm({
      title: `确认删除「${arc.arcName}」？`,
      okType: 'danger',
      onOk: async () => {
        await window.electron.outline.deleteArc(arc.id)
        loadData()
      },
    })
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空故事大纲？',
      content: '会删除全部故事弧与章节细纲归属，但不会删除已有章节正文。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.outline.clear(novelId)
        setExpandedArcId(null)
        loadData()
        message.success('故事大纲已清空')
      },
    })
  }

  const getArcChapters = (arc: StoryArc) => {
    return chapters.filter(c =>
      c.arcId === arc.id ||
      (c.chapterNum >= (arc.chapterStart || 0) && c.chapterNum <= (arc.chapterEnd || 9999))
    ).sort((a, b) => a.chapterNum - b.chapterNum)
  }

  // 拖拽排序章节
  const handleChapterDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const arcId = Number(result.draggableId.split('-')[0])
    const arcChapters = getArcChapters(arcs.find(a => a.id === arcId)!)
    const [moved] = arcChapters.splice(result.source.index, 1)
    arcChapters.splice(result.destination.index, 0, moved)

    // 更新 chapterNum
    for (let i = 0; i < arcChapters.length; i++) {
      const ch = arcChapters[i]
      const newNum = (arcs.find(a => a.id === arcId)?.chapterStart || 1) + i
      if (ch.chapterNum !== newNum) {
        await window.electron.chapter.update(ch.id, { chapterNum: newNum })
      }
    }
    loadData()
  }

  const totalCompletedChapters = chapters.filter((chapter) => chapter.status === 'final').length
  const expandedArc = expandedArcId ? arcs.find((arc) => arc.id === expandedArcId) || null : null

  return (
    <WorkspacePage
      eyebrow="故事大纲"
      title="故事大纲"
      description="先把小说拆成几条清晰的故事弧，再把每条弧分配到章节。这样时间轴、人物变化和正文推进才不会后期失控。"
      actions={(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button icon={<RobotOutlined />} loading={generating} onClick={handleGenerateArcs}>
            AI 生成故事弧
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingArc(null); arcForm.resetFields(); setArcModalOpen(true) }}
          >
            新建故事弧
          </Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>
            清空大纲
          </Button>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="故事弧数量" value={arcs.length} tone="warm" hint="大纲先按弧组织，而不是直接堆章节" />
          <WorkspaceMetric label="章节数量" value={chapters.length} hint="已关联到当前小说的全部章节" />
          <WorkspaceMetric label="完稿章节" value={totalCompletedChapters} tone="cool" hint="状态为 final 的章节数量" />
          <WorkspaceMetric label="当前展开" value={expandedArc?.arcName || '未选择'} hint="点选故事弧后可展开章节细纲" />
        </>
      )}
    >

      {loading ? (
        <WorkspacePanel title="故事弧时间线" description="正在读取当前小说的大纲结构。">
          <div className="novel-empty"><Spin /></div>
        </WorkspacePanel>
      ) : arcs.length === 0 ? (
        <WorkspacePanel title="故事弧时间线" description="先建立故事弧，后面章节细纲才有挂靠的阶段框架。">
          <div className="novel-empty">还没有故事弧，点击「AI 生成故事弧」或手动创建。</div>
        </WorkspacePanel>
      ) : (
        <>
          <WorkspacePanel title="故事弧时间线" description="按阶段浏览当前小说的结构推进。">
            <div className="novel-outline-track">
              {arcs.map((arc, idx) => {
                const arcChapters = getArcChapters(arc)
                const isExpanded = expandedArcId === arc.id
                const completedCount = arcChapters.filter((chapter) => chapter.status === 'final').length
                const progressPercent = arcChapters.length > 0
                  ? Math.round((completedCount / arcChapters.length) * 100)
                  : 0

                return (
                  <React.Fragment key={arc.id}>
                    {idx > 0 ? <div className="novel-outline-link" /> : null}
                    <div
                      className={`novel-outline-arc ${isExpanded ? 'novel-outline-arc--active' : ''}`}
                      onClick={() => setExpandedArcId(isExpanded ? null : arc.id)}
                    >
                      <div className="novel-outline-arc__index">{idx + 1}</div>
                      <div className="novel-outline-arc__title">{arc.arcName}</div>
                      <div className="novel-outline-arc__meta">第 {arc.chapterStart} ~ {arc.chapterEnd} 章</div>
                      {arc.arcGoal ? <div className="novel-outline-arc__desc">{arc.arcGoal}</div> : null}
                      <div className="novel-outline-arc__progress">
                        <div
                          style={{
                            width: `${progressPercent}%`,
                            height: '100%',
                            background: progressPercent === 100 ? '#4f8b64' : '#8f6330',
                            transition: 'width 0.3s',
                          }}
                        />
                      </div>
                      <div className="novel-outline-arc__progress-label">{completedCount}/{arcChapters.length} 章完成</div>
                      <div className="novel-outline-arc__actions" onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="small"
                          icon={<RobotOutlined />}
                          loading={generating}
                          onClick={() => handleGenerateChapterOutlines(arc.id)}
                        >
                          生成下一批细纲
                        </Button>
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => {
                            setEditingArc(arc)
                            arcForm.setFieldsValue(arc)
                            setArcModalOpen(true)
                          }}
                        />
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteArc(arc)} />
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </WorkspacePanel>

          <WorkspacePanel
            title={expandedArc ? `章节细纲 · ${expandedArc.arcName}` : '章节细纲'}
            description={expandedArc ? '当前故事弧下的章节顺序和细纲。拖拽可调整章节位置。' : '选择上方故事弧后，这里会展示章节细纲。'}
            extra={expandedArc ? <Tag>{`第${expandedArc.chapterStart}~${expandedArc.chapterEnd}章`}</Tag> : null}
          >
            {!expandedArc ? (
              <div className="novel-empty">点击上方任意故事弧，查看该阶段下的章节细纲。</div>
            ) : getArcChapters(expandedArc).length === 0 ? (
              <Empty description="暂无章节，点击「生成下一批细纲」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <DragDropContext onDragEnd={handleChapterDragEnd}>
                <Droppable droppableId={`arc-${expandedArc.id}`}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="novel-outline-chapter-grid"
                    >
                      {getArcChapters(expandedArc).map((chapter, index) => (
                        <Draggable
                          key={chapter.id}
                          draggableId={`${expandedArc.id}-${chapter.id}`}
                          index={index}
                        >
                          {(prov, snapshot) => (
                            <div
                              ref={prov.innerRef}
                              {...prov.draggableProps}
                              style={{
                                ...prov.draggableProps.style,
                                opacity: snapshot.isDragging ? 0.82 : 1,
                              }}
                            >
                              <ChapterCard
                                chapter={chapter}
                                dragHandleProps={prov.dragHandleProps ?? undefined}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            )}
          </WorkspacePanel>
        </>
      )}

      <Modal
        title={editingArc ? '编辑故事弧' : '新建故事弧'}
        open={arcModalOpen}
        onCancel={() => { setArcModalOpen(false); arcForm.resetFields(); setEditingArc(null) }}
        onOk={handleSaveArc}
        okText="保存"
      >
        <Form form={arcForm} layout="vertical">
          <Form.Item name="arcName" label="弧名称" rules={[{ required: true }]}>
            <Input placeholder="例如：觉醒之弧、黑暗降临" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="chapterStart" label="起始章节" style={{ flex: 1 }}>
              <Input type="number" min={1} />
            </Form.Item>
            <Form.Item name="chapterEnd" label="结束章节" style={{ flex: 1 }}>
              <Input type="number" min={1} />
            </Form.Item>
          </div>
          <Form.Item name="arcGoal" label="本弧目标">
            <Input.TextArea rows={5} placeholder="这个故事弧要完成什么叙事目标" />
          </Form.Item>
          <Form.Item name="arcSummary" label="本弧概述">
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}

function ChapterCard({
  chapter,
  dragHandleProps,
}: {
  chapter: Chapter
  dragHandleProps?: DraggableProvidedDragHandleProps
}) {
  const status = STATUS_LABELS[chapter.status] || STATUS_LABELS.outline

  return (
    <div className="novel-outline-chapter-card">
      <div
        {...dragHandleProps}
        className="novel-outline-chapter-card__handle"
      >
        <HolderOutlined style={{ fontSize: 12 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="novel-outline-chapter-card__meta">
          <span className="novel-outline-chapter-card__number">第{chapter.chapterNum}章</span>
          <Tag style={{
            background: 'transparent',
            border: `1px solid ${status.color}`,
            color: status.color,
            fontSize: 10,
            padding: '0 4px',
          }}>
            {status.label}
          </Tag>
        </div>
        <div className="novel-outline-chapter-card__title">
          {chapter.title || `第${chapter.chapterNum}章`}
        </div>
        {chapter.outline && (
          <div className="novel-outline-chapter-card__summary" style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {chapter.outline}
          </div>
        )}
        <div className="novel-outline-chapter-card__words" style={{ marginTop: 6 }}>
          {chapter.wordCount} / {chapter.targetWords} 字
        </div>
      </div>
    </div>
  )
}
