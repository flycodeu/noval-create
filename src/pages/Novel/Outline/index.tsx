import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Form, Input, Modal, Space, Spin, Tag, message } from 'antd'
import { DeleteOutlined, EditOutlined, HolderOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, type DragDropContextProps, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { Chapter, OutlineChapterBatchGenerationResult, StoryArc } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'

interface Props { novelId: number }
interface ArcFormValues {
  arcName: string
  chapterStart?: number
  chapterEnd?: number
  arcGoal?: string
  arcSummary?: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  outline: { label: '待写', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  draft: { label: '草稿', color: '#faad14' },
  reviewing: { label: '审核中', color: '#e67e22' },
  final: { label: '已完成', color: '#52c41a' },
}

export default function Outline({ novelId }: Props) {
  const { chapters, setChapters, currentNovel } = useNovelStore()
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [arcForm] = Form.useForm<ArcFormValues>()
  const [arcModalOpen, setArcModalOpen] = useState(false)
  const [editingArc, setEditingArc] = useState<StoryArc | null>(null)
  const [expandedArcId, setExpandedArcId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [arcList, chapterList] = await Promise.all([window.electron.outline.getArcs(novelId), window.electron.chapter.list(novelId)])
      setArcs(arcList.sort((a, b) => a.arcOrder - b.arcOrder))
      setChapters(chapterList)
    } finally {
      setLoading(false)
    }
  }, [novelId, setChapters])

  useEffect(() => { void loadData() }, [loadData])

  const openCreateModal = () => {
    setEditingArc(null)
    arcForm.setFieldsValue({ arcName: '', chapterStart: undefined, chapterEnd: undefined, arcGoal: '', arcSummary: '' })
    setArcModalOpen(true)
  }

  const openEditModal = (arc: StoryArc) => {
    setEditingArc(arc)
    arcForm.setFieldsValue({
      arcName: arc.arcName,
      chapterStart: arc.chapterStart,
      chapterEnd: arc.chapterEnd,
      arcGoal: arc.arcGoal || '',
      arcSummary: arc.arcSummary || '',
    })
    setArcModalOpen(true)
  }

  const handleGenerateArcs = async () => {
    if (arcs.length > 0 || chapters.some((chapter) => chapter.arcId || chapter.outline || chapter.emotionTone)) {
      const shouldContinue = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '重新生成故事弧？',
          content: '会替换现有故事弧，并清空章节的弧线归属和细纲。',
          okText: '继续',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })
      if (!shouldContinue) return
    }

    setGenerating(true)
    try {
      await window.electron.outline.generateArcs(novelId)
      await loadData()
      message.success('故事弧已生成。')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : '请先完善基础设定。'}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateChapterOutlines = async (arcId: number) => {
    setGenerating(true)
    try {
      const result = await window.electron.outline.generateChapterOutlines(arcId, { batchSize: 4 })
      await loadData()
      message.success((result as OutlineChapterBatchGenerationResult).message || '章节细纲已生成一批。')
    } catch (error: unknown) {
      message.error(`生成失败：${error instanceof Error ? error.message : ''}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleSaveArc = async () => {
    const values = await arcForm.validateFields()
    if (editingArc) {
      await window.electron.outline.updateArc(editingArc.id, values)
    } else {
      await window.electron.outline.createArc(novelId, { ...values, arcOrder: arcs.length + 1 })
    }
    setArcModalOpen(false)
    setEditingArc(null)
    arcForm.resetFields()
    await loadData()
  }

  const handleDeleteArc = async (arc: StoryArc) => {
    Modal.confirm({
      title: `删除“${arc.arcName}”？`,
      okType: 'danger',
      onOk: async () => { await window.electron.outline.deleteArc(arc.id); await loadData() },
    })
  }

  const handleClear = async () => {
    Modal.confirm({
      title: '清空故事大纲？',
      content: '会删除全部故事弧和章节细纲归属，但不会删除正文。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => { await window.electron.outline.clear(novelId); setExpandedArcId(null); await loadData(); message.success('故事大纲已清空。') },
    })
  }

  const getArcChapters = useCallback((arc: StoryArc) => chapters.filter((chapter) => chapter.arcId === arc.id || (chapter.chapterNum >= (arc.chapterStart || 0) && chapter.chapterNum <= (arc.chapterEnd || 9999))).sort((a, b) => a.chapterNum - b.chapterNum), [chapters])

  const handleChapterDragEnd: DragDropContextProps['onDragEnd'] = async (result) => {
    if (!result.destination) return
    const arcId = Number(result.draggableId.split('-')[0])
    const arc = arcs.find((item) => item.id === arcId)
    if (!arc) return
    const arcChapters = [...getArcChapters(arc)]
    const [moved] = arcChapters.splice(result.source.index, 1)
    arcChapters.splice(result.destination.index, 0, moved)
    for (let index = 0; index < arcChapters.length; index += 1) {
      const chapter = arcChapters[index]
      const nextNum = (arc.chapterStart || 1) + index
      if (chapter.chapterNum !== nextNum) await window.electron.chapter.update(chapter.id, { chapterNum: nextNum })
    }
    await loadData()
  }

  const totalCompletedChapters = chapters.filter((chapter) => chapter.status === 'final').length
  const expandedArc = expandedArcId ? arcs.find((arc) => arc.id === expandedArcId) || null : null
  const arcDraftButton = (
    <AIGenerateButton
      label="AI 起草故事弧"
      isJson
      buildMessages={() => {
        const values = arcForm.getFieldsValue(true)
        return buildDraftMessages({
          task: '故事弧草稿',
          mode: values.arcName ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '已有故事弧', value: arcs.slice(0, 8).map((arc) => arc.arcName).join('、') || '' },
          ],
          fields: [
            { key: 'arcName', label: '故事弧名称', value: values.arcName, hint: '短、准、可识别。' },
            { key: 'chapterStart', label: '起始章节', type: 'number', value: values.chapterStart, hint: '给出合理整数。' },
            { key: 'chapterEnd', label: '结束章节', type: 'number', value: values.chapterEnd, hint: '给出合理整数。' },
            { key: 'arcGoal', label: '本弧目标', value: values.arcGoal, hint: '写清这条弧要完成什么推进。' },
            { key: 'arcSummary', label: '本弧概述', value: values.arcSummary, hint: '写清起点、转折和阶段收束。' },
          ],
          requirements: ['不要和已有故事弧重名。', '不要写成空泛的“成长、蜕变、命运交汇”。'],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
        const currentValues = arcForm.getFieldsValue(true)
        arcForm.setFieldsValue({
          ...currentValues,
          arcName: typeof draft.arcName === 'string' ? draft.arcName : currentValues.arcName,
          chapterStart: normalizeOptionalNumber(draft.chapterStart ?? currentValues.chapterStart),
          chapterEnd: normalizeOptionalNumber(draft.chapterEnd ?? currentValues.chapterEnd),
          arcGoal: typeof draft.arcGoal === 'string' ? draft.arcGoal : currentValues.arcGoal,
          arcSummary: typeof draft.arcSummary === 'string' ? draft.arcSummary : currentValues.arcSummary,
        })
      }}
    />
  )

  return (
    <WorkspacePage
      eyebrow="故事大纲"
      title="故事大纲"
      description="按故事弧组织章节，单条故事弧支持 AI 起草。"
      actions={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button icon={<RobotOutlined />} loading={generating} onClick={() => void handleGenerateArcs()}>AI 生成故事弧</Button><Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建故事弧</Button><Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button></div>}
      metrics={<><WorkspaceMetric label="故事弧" value={arcs.length} tone="warm" hint="按阶段组织长篇结构" /><WorkspaceMetric label="章节数" value={chapters.length} hint="当前小说全部章节" /><WorkspaceMetric label="已完成章节" value={totalCompletedChapters} tone="cool" hint="状态为 final 的章节" /><WorkspaceMetric label="当前展开" value={expandedArc?.arcName || '未选择'} hint="展开后查看章节细纲" /></>}
    >
      {loading ? (
        <WorkspacePanel title="故事弧">
          <div className="novel-empty"><Spin /></div>
        </WorkspacePanel>
      ) : arcs.length === 0 ? (
        <WorkspacePanel title="故事弧">
          <div className="novel-empty">还没有故事弧。</div>
        </WorkspacePanel>
      ) : (
        <>
          <WorkspacePanel title="故事弧">
            <div className="novel-outline-track">
              {arcs.map((arc, index) => {
                const arcChapters = getArcChapters(arc)
                const isExpanded = expandedArcId === arc.id
                const completedCount = arcChapters.filter((chapter) => chapter.status === 'final').length
                const progressPercent = arcChapters.length > 0 ? Math.round((completedCount / arcChapters.length) * 100) : 0
                return (
                  <React.Fragment key={arc.id}>
                    {index > 0 ? <div className="novel-outline-link" /> : null}
                    <div className={`novel-outline-arc ${isExpanded ? 'novel-outline-arc--active' : ''}`} onClick={() => setExpandedArcId(isExpanded ? null : arc.id)}>
                      <div className="novel-outline-arc__index">{index + 1}</div>
                      <div className="novel-outline-arc__title">{arc.arcName}</div>
                      <div className="novel-outline-arc__meta">第 {arc.chapterStart || '?'} ~ {arc.chapterEnd || '?'} 章</div>
                      {arc.arcGoal ? <div className="novel-outline-arc__desc">{arc.arcGoal}</div> : null}
                      <div className="novel-outline-arc__progress"><div style={{ width: `${progressPercent}%`, height: '100%', background: progressPercent === 100 ? '#4f8b64' : '#8f6330', transition: 'width 0.3s' }} /></div>
                      <div className="novel-outline-arc__progress-label">{completedCount}/{arcChapters.length} 章完成</div>
                      <div className="novel-outline-arc__actions" onClick={(event) => event.stopPropagation()}>
                        <Button size="small" icon={<RobotOutlined />} loading={generating} onClick={() => void handleGenerateChapterOutlines(arc.id)}>生成细纲</Button>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(arc)} />
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDeleteArc(arc)} />
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </WorkspacePanel>

          <WorkspacePanel title={expandedArc ? `章节细纲 · ${expandedArc.arcName}` : '章节细纲'} extra={expandedArc ? <Tag>{`第 ${expandedArc.chapterStart || '?'} ~ ${expandedArc.chapterEnd || '?'} 章`}</Tag> : null}>
            {!expandedArc ? (
              <div className="novel-empty">先展开一条故事弧。</div>
            ) : getArcChapters(expandedArc).length === 0 ? (
              <Empty description="当前故事弧下还没有章节。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <DragDropContext onDragEnd={handleChapterDragEnd}>
                <Droppable droppableId={`arc-${expandedArc.id}`}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps} className="novel-outline-chapter-grid">
                      {getArcChapters(expandedArc).map((chapter, index) => (
                        <Draggable key={chapter.id} draggableId={`${expandedArc.id}-${chapter.id}`} index={index}>
                          {(prov, snapshot) => (
                            <div ref={prov.innerRef} {...prov.draggableProps} style={{ ...prov.draggableProps.style, opacity: snapshot.isDragging ? 0.82 : 1 }}>
                              <ChapterCard chapter={chapter} dragHandleProps={prov.dragHandleProps ?? undefined} />
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

      <Modal title={editingArc ? '编辑故事弧' : '新建故事弧'} open={arcModalOpen} forceRender onCancel={() => { setArcModalOpen(false); arcForm.resetFields(); setEditingArc(null) }} onOk={() => void handleSaveArc()} okText="保存">
        <div style={{ marginBottom: 12 }}>
          {arcDraftButton}
        </div>
        <Form form={arcForm} layout="vertical">
          <Form.Item name="arcName" label="名称" rules={[{ required: true, message: '请填写故事弧名称' }]}><Input placeholder="例如：觉醒线、南境追击线" /></Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="chapterStart" label="起始章节" style={{ flex: 1 }}><Input type="number" min={1} /></Form.Item>
            <Form.Item name="chapterEnd" label="结束章节" style={{ flex: 1 }}><Input type="number" min={1} /></Form.Item>
          </div>
          <Form.Item name="arcGoal" label="本弧目标"><Input.TextArea rows={4} placeholder="写清这一弧要推进什么" /></Form.Item>
          <Form.Item name="arcSummary" label="本弧概述"><Input.TextArea rows={5} placeholder="写清起点、转折和阶段收束" /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}

function ChapterCard({ chapter, dragHandleProps }: { chapter: Chapter; dragHandleProps?: DraggableProvidedDragHandleProps }) {
  const status = STATUS_LABELS[chapter.status] || STATUS_LABELS.outline
  return (
    <div className="novel-outline-chapter-card">
      <div {...dragHandleProps} className="novel-outline-chapter-card__handle"><HolderOutlined style={{ fontSize: 12 }} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="novel-outline-chapter-card__meta">
          <span className="novel-outline-chapter-card__number">第 {chapter.chapterNum} 章</span>
          <Tag style={{ background: 'transparent', border: `1px solid ${status.color}`, color: status.color, fontSize: 10, padding: '0 4px' }}>{status.label}</Tag>
        </div>
        <div className="novel-outline-chapter-card__title">{chapter.title || `第 ${chapter.chapterNum} 章`}</div>
        {chapter.outline ? <div className="novel-outline-chapter-card__summary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{chapter.outline}</div> : null}
        <div className="novel-outline-chapter-card__words" style={{ marginTop: 6 }}>{chapter.wordCount ?? 0} / {chapter.targetWords ?? 0} 字</div>
      </div>
    </div>
  )
}
