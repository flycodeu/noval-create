import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Modal, Form, Input, Select, Tag, Empty,
  message, Spin, Tooltip
} from 'antd'
import {
  PlusOutlined, RobotOutlined, DeleteOutlined, EditOutlined,
  HolderOutlined
} from '@ant-design/icons'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { StoryArc, Chapter } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'

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
      loadData()
      message.success('故事弧规划完成')
    } catch (e: unknown) {
      message.error(`生成失败：${e instanceof Error ? e.message : '请先完善核心设定'}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateChapterOutlines = async (arcId: number) => {
    setGenerating(true)
    try {
      await window.electron.outline.generateChapterOutlines(arcId)
      loadData()
      message.success('章节细纲生成完成')
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

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>大纲规划</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            icon={<RobotOutlined />}
            loading={generating}
            onClick={handleGenerateArcs}
          >
            AI 生成故事弧
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setEditingArc(null); arcForm.resetFields(); setArcModalOpen(true) }}
          >
            新建故事弧
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
      ) : arcs.length === 0 ? (
        <Empty
          description="还没有故事弧，点击「AI 生成故事弧」或手动创建"
          style={{ paddingTop: 60 }}
        />
      ) : (
        <>
          {/* 水平时间线 */}
          <div style={{
            display: 'flex',
            gap: 0,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 24,
            alignItems: 'stretch',
          }}>
            {arcs.map((arc, idx) => {
              const arcChapters = getArcChapters(arc)
              const isExpanded = expandedArcId === arc.id
              const completedCount = arcChapters.filter(c => c.status === 'final').length
              const progressPercent = arcChapters.length > 0
                ? Math.round((completedCount / arcChapters.length) * 100)
                : 0

              return (
                <React.Fragment key={arc.id}>
                  {/* 连接线 */}
                  {idx > 0 && (
                    <div style={{
                      width: 24,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <div style={{ width: 24, height: 2, background: 'rgba(255,255,255,0.15)' }} />
                    </div>
                  )}

                  <div
                    onClick={() => setExpandedArcId(isExpanded ? null : arc.id)}
                    style={{
                      minWidth: 160,
                      maxWidth: 220,
                      background: isExpanded ? 'rgba(46,134,171,0.15)' : 'var(--color-bg-card)',
                      border: `2px solid ${isExpanded ? '#2E86AB' : 'var(--border-color-hover)'}`,
                      borderRadius: 10,
                      padding: '14px 16px',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s, background 0.2s',
                      position: 'relative',
                      flexShrink: 0,
                    }}
                  >
                    {/* 弧序号 */}
                    <div style={{
                      position: 'absolute',
                      top: -10,
                      left: 16,
                      background: isExpanded ? '#2E86AB' : '#252840',
                      border: '2px solid rgba(255,255,255,0.15)',
                      borderRadius: '50%',
                      width: 20,
                      height: 20,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'white',
                    }}>
                      {idx + 1}
                    </div>

                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, marginTop: 4 }}>
                      {arc.arcName}
                    </div>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: 11, marginBottom: 8 }}>
                      第 {arc.chapterStart}~{arc.chapterEnd} 章
                    </div>
                    {arc.arcGoal && (
                      <div style={{
                        color: 'var(--color-text-secondary)',
                        fontSize: 11,
                        marginBottom: 8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}>
                        {arc.arcGoal}
                      </div>
                    )}

                    {/* 进度条 */}
                    <div style={{
                      height: 3,
                      background: 'rgba(255,255,255,0.08)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${progressPercent}%`,
                        height: '100%',
                        background: progressPercent === 100 ? '#52c41a' : '#2E86AB',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {completedCount}/{arcChapters.length} 章完成
                    </div>

                    {/* 操作按钮 */}
                    <div
                      style={{ display: 'flex', gap: 4, marginTop: 10 }}
                      onClick={e => e.stopPropagation()}
                    >
                      <Button
                        size="small"
                        icon={<RobotOutlined />}
                        loading={generating}
                        onClick={() => handleGenerateChapterOutlines(arc.id)}
                        style={{ flex: 1, fontSize: 11 }}
                      >
                        生成细纲
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
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteArc(arc)}
                      />
                    </div>
                  </div>
                </React.Fragment>
              )
            })}
          </div>

          {/* 展开的章节列表 */}
          {expandedArcId && (() => {
            const arc = arcs.find(a => a.id === expandedArcId)
            if (!arc) return null
            const arcChapters = getArcChapters(arc)

            return (
              <div style={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--border-color-hover)',
                padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{arc.arcName}</span>
                  <Tag>第{arc.chapterStart}~{arc.chapterEnd}章</Tag>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{arc.arcGoal}</span>
                </div>

                {arcChapters.length === 0 ? (
                  <Empty description="暂无章节，点击「生成细纲」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <DragDropContext onDragEnd={handleChapterDragEnd}>
                    <Droppable droppableId={`arc-${arc.id}`}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                            gap: 8,
                          }}
                        >
                          {arcChapters.map((chapter, index) => (
                            <Draggable
                              key={chapter.id}
                              draggableId={`${arc.id}-${chapter.id}`}
                              index={index}
                            >
                              {(prov, snapshot) => (
                                <div
                                  ref={prov.innerRef}
                                  {...prov.draggableProps}
                                  style={{
                                    ...prov.draggableProps.style,
                                    opacity: snapshot.isDragging ? 0.8 : 1,
                                  }}
                                >
                                  <ChapterCard
                                    chapter={chapter}
                                    dragHandleProps={prov.dragHandleProps}
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
              </div>
            )
          })()}
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
    </div>
  )
}

function ChapterCard({
  chapter,
  dragHandleProps,
}: {
  chapter: Chapter
  dragHandleProps?: Record<string, unknown>
}) {
  const status = STATUS_LABELS[chapter.status] || STATUS_LABELS.outline

  return (
    <div style={{
      background: 'var(--color-bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      padding: 12,
      display: 'flex',
      gap: 8,
    }}>
      {/* 拖拽手柄 */}
      <div
        {...dragHandleProps}
        style={{
          color: 'var(--color-text-muted)',
          cursor: 'grab',
          display: 'flex',
          alignItems: 'flex-start',
          paddingTop: 2,
          flexShrink: 0,
        }}
      >
        <HolderOutlined style={{ fontSize: 12 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>第{chapter.chapterNum}章</span>
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
        <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>
          {chapter.title || `第${chapter.chapterNum}章`}
        </div>
        {chapter.outline && (
          <div style={{
            color: 'var(--color-text-muted)',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {chapter.outline}
          </div>
        )}
        <div style={{ marginTop: 6, color: 'var(--color-text-muted)', fontSize: 11 }}>
          {chapter.wordCount} / {chapter.targetWords} 字
        </div>
      </div>
    </div>
  )
}
