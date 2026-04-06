import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Form, Input, InputNumber, Modal, Pagination, Select, Space, Spin, Tag, message } from 'antd'
import { DeleteOutlined, EditOutlined, HolderOutlined, PlusOutlined, RobotOutlined, SwapOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, type DragDropContextProps, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import VirtualList from 'rc-virtual-list'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type { Chapter, OutlineChapterBatchGenerationResult, StoryArc } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateOutlineArcDraft } from '../shared/planning-ai-service'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

interface Props { novelId: number }
interface ArcFormValues {
  arcName: string
  chapterStart?: number
  chapterEnd?: number
  arcGoal?: string
  arcSummary?: string
  growthLedger?: string
  costLedger?: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  outline: { label: '待写', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  draft: { label: '草稿', color: '#faad14' },
  reviewing: { label: '审核中', color: '#e67e22' },
  final: { label: '已完成', color: '#52c41a' },
}

const OUTLINE_CHAPTER_PAGE_SIZE = 50

export default function Outline({ novelId }: Props) {
  const { chapters, setChapters, currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [arcForm] = Form.useForm<ArcFormValues>()
  const [arcModalOpen, setArcModalOpen] = useState(false)
  const [editingArc, setEditingArc] = useState<StoryArc | null>(null)
  const [expandedArcId, setExpandedArcId] = useState<number | null>(null)
  const [expandedChapterPage, setExpandedChapterPage] = useState(1)
  const [outlineBatchSize, setOutlineBatchSize] = useState(4)
  const [outlineTargetCount, setOutlineTargetCount] = useState(8)
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [lastSelectedChapterId, setLastSelectedChapterId] = useState<number | null>(null)
  const [batchStatus, setBatchStatus] = useState<Chapter['status']>('outline')
  const [batchStartChapterNum, setBatchStartChapterNum] = useState(1)
  const [reorderMode, setReorderMode] = useState(false)
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)

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

  useEffect(() => { void loadData() }, [loadData, mutationToken])

  const openCreateModal = () => {
    setEditingArc(null)
    arcForm.setFieldsValue({ arcName: '', chapterStart: undefined, chapterEnd: undefined, arcGoal: '', arcSummary: '', growthLedger: '', costLedger: '' })
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
      growthLedger: arc.growthLedger || '',
      costLedger: arc.costLedger || '',
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
      message.success(getUserFacingMessage('outline.arcGenerated'))
    } catch (error: unknown) {
      message.error(error instanceof Error
        ? getUserFacingMessage('outline.generateFailedDetail', { detail: error.message })
        : getUserFacingMessage('outline.generateFailedCompleteBasics'))
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateChapterOutlines = async (arcId: number) => {
    setGenerating(true)
    try {
      const safeBatchSize = Math.max(1, Math.min(outlineBatchSize, 6))
      const safeTargetCount = Math.max(1, Math.min(outlineTargetCount, 24))
      let generatedCount = 0
      let lastResult: OutlineChapterBatchGenerationResult | null = null

      while (generatedCount < safeTargetCount) {
        const currentBatchSize = Math.min(safeBatchSize, safeTargetCount - generatedCount)
        const result = await window.electron.outline.generateChapterOutlines(arcId, { batchSize: currentBatchSize })
        lastResult = result as OutlineChapterBatchGenerationResult
        generatedCount += lastResult.generatedCount || 0
        if (lastResult.completed || lastResult.generatedCount <= 0) break
      }

      await loadData()
      const summary = lastResult?.message || '章节细纲已生成一批。'
      message.success(generatedCount > 0
        ? getUserFacingMessage('outline.batchGenerated', { summary, count: generatedCount })
        : summary)
    } catch (error: unknown) {
      message.error(getUserFacingMessage('outline.generateFailedDetail', {
        detail: error instanceof Error ? error.message : '',
      }))
    } finally {
      setGenerating(false)
    }
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
      onOk: async () => { await window.electron.outline.clear(novelId); setExpandedArcId(null); await loadData(); message.success(getUserFacingMessage('outline.cleared')) },
    })
  }

  const getArcChapters = useCallback((arc: StoryArc) => chapters.filter((chapter) => chapter.arcId === arc.id || (chapter.chapterNum >= (arc.chapterStart || 0) && chapter.chapterNum <= (arc.chapterEnd || 9999))).sort((a, b) => a.chapterNum - b.chapterNum), [chapters])

  const handleChapterSelection = useCallback((event: React.MouseEvent, chapter: Chapter, orderedChapters: Chapter[]) => {
    const withMeta = event.metaKey || event.ctrlKey
    const withShift = event.shiftKey

    setSelectedChapterIds((current) => {
      if (withShift && lastSelectedChapterId) {
        const startIndex = orderedChapters.findIndex((item) => item.id === lastSelectedChapterId)
        const endIndex = orderedChapters.findIndex((item) => item.id === chapter.id)
        if (startIndex >= 0 && endIndex >= 0) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
          const rangeIds = orderedChapters.slice(from, to + 1).map((item) => item.id)
          return [...new Set([...current, ...rangeIds])]
        }
      }

      if (withMeta) {
        return current.includes(chapter.id)
          ? current.filter((item) => item !== chapter.id)
          : [...current, chapter.id]
      }

      return [chapter.id]
    })

    setLastSelectedChapterId(chapter.id)
  }, [lastSelectedChapterId])

  const handleBatchStatusUpdate = useCallback(async () => {
    if (selectedChapterIds.length === 0) return
    await window.electron.chapter.batchUpdate(selectedChapterIds, { status: batchStatus })
    setSelectedChapterIds([])
    await loadData()
    notifyWorkspaceMutation()
    message.success(getUserFacingMessage('outline.batchStatusUpdated', { count: selectedChapterIds.length }))
  }, [batchStatus, loadData, notifyWorkspaceMutation, selectedChapterIds])

  const handleBatchDelete = useCallback(() => {
    if (selectedChapterIds.length === 0) return
    Modal.confirm({
      title: `删除选中的 ${selectedChapterIds.length} 章？`,
      content: '会删除章节正文、细纲和场景片段，但可通过“撤销最近操作”恢复。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.chapter.batchDelete(selectedChapterIds)
        setSelectedChapterIds([])
        await loadData()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('outline.batchDeleted'))
      },
    })
  }, [loadData, notifyWorkspaceMutation, selectedChapterIds])

  const handleBatchRenumber = useCallback(async () => {
    if (selectedChapterIds.length === 0) return
    await window.electron.chapter.batchRenumber(selectedChapterIds, batchStartChapterNum)
    setSelectedChapterIds([])
    await loadData()
    notifyWorkspaceMutation()
    message.success(getUserFacingMessage('outline.batchRenumbered', { start: batchStartChapterNum }))
  }, [batchStartChapterNum, loadData, notifyWorkspaceMutation, selectedChapterIds])

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
  const expandedArcChapters = useMemo(
    () => (expandedArc ? getArcChapters(expandedArc) : []),
    [expandedArc, getArcChapters],
  )
  const expandedChapterPageStart = (expandedChapterPage - 1) * OUTLINE_CHAPTER_PAGE_SIZE
  const visibleExpandedArcChapters = useMemo(
    () => expandedArcChapters.slice(expandedChapterPageStart, expandedChapterPageStart + OUTLINE_CHAPTER_PAGE_SIZE),
    [expandedArcChapters, expandedChapterPageStart],
  )
  const selectedExpandedChapters = useMemo(
    () => expandedArcChapters.filter((chapter) => selectedChapterIds.includes(chapter.id)),
    [expandedArcChapters, selectedChapterIds],
  )
  const getMissingOutlineCount = useCallback((arc: StoryArc) => (
    getArcChapters(arc).filter((chapter) => !chapter.outline?.trim()).length
  ), [getArcChapters])

  useEffect(() => {
    setExpandedChapterPage(1)
    setSelectedChapterIds([])
    setLastSelectedChapterId(null)
  }, [expandedArcId])

  useEffect(() => {
    if (selectedExpandedChapters.length === 0) return
    setBatchStartChapterNum(Math.min(...selectedExpandedChapters.map((chapter) => chapter.chapterNum)))
  }, [selectedExpandedChapters])

  useEffect(() => {
    registerEscapeHandler(() => {
      setSelectedChapterIds([])
      setLastSelectedChapterId(null)
    })

    return () => registerEscapeHandler(null)
  }, [registerEscapeHandler])
  const applyOutlineDraft = useCallback((draft: Partial<ArcFormValues>) => {
    const currentValues = arcForm.getFieldsValue(true)
    arcForm.setFieldsValue({
      ...currentValues,
      arcName: typeof draft.arcName === 'string' ? draft.arcName : currentValues.arcName,
      chapterStart: normalizeOptionalNumber(draft.chapterStart ?? currentValues.chapterStart),
      chapterEnd: normalizeOptionalNumber(draft.chapterEnd ?? currentValues.chapterEnd),
      arcGoal: typeof draft.arcGoal === 'string' ? draft.arcGoal : currentValues.arcGoal,
      arcSummary: typeof draft.arcSummary === 'string' ? draft.arcSummary : currentValues.arcSummary,
      growthLedger: typeof draft.growthLedger === 'string' ? draft.growthLedger : currentValues.growthLedger,
      costLedger: typeof draft.costLedger === 'string' ? draft.costLedger : currentValues.costLedger,
    })
  }, [arcForm])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<ArcFormValues>({
    novelId,
    pageKey: 'outline',
    applyDraft: applyOutlineDraft,
  })
  const handleSaveArc = useCallback(async () => {
    const values = await arcForm.validateFields()
    if (editingArc) {
      await window.electron.outline.updateArc(editingArc.id, values)
    } else {
      await window.electron.outline.createArc(novelId, { ...values, arcOrder: arcs.length + 1 })
    }
    await finalizeDraft(values)
    await clearDraft()
    setArcModalOpen(false)
    setEditingArc(null)
    arcForm.resetFields()
    await loadData()
  }, [arcForm, arcs.length, clearDraft, editingArc, finalizeDraft, loadData, novelId])

  useEffect(() => {
    registerSaveHandler(arcModalOpen ? () => { void handleSaveArc() } : null)
    return () => registerSaveHandler(null)
  }, [arcModalOpen, handleSaveArc, registerSaveHandler])
  const arcDraftButton = (
    <AIGenerateButton
      label="AI 起草故事弧"
      isJson
      runGeneration={async (input) => {
        const result = await generateOutlineArcDraft(input, arcs.map((item) => item.arcName), { genre: currentNovel?.genreName })
        draftWarningsRef.current = result.warnings
        draftObservabilityRef.current = result.observability
        setDraftWarnings(result.warnings)
        return result.outputs
      }}
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
            { key: 'growthLedger', label: '成长账本', value: values.growthLedger, hint: '写清这一弧主角具体获得了什么变化。' },
            { key: 'costLedger', label: '代价账本', value: values.costLedger, hint: '写清这一弧具体付出了什么代价。' },
          ],
          requirements: ['不要和已有故事弧重名。', '不要写成空泛的“成长、蜕变、命运交汇”。'],
        })
      }}
      onResult={(raw) => {
        const parsedDraft = parseDraftJson<ArcFormValues>(raw)
        const currentValues = arcForm.getFieldsValue(true)
        const mergedDraft: ArcFormValues = {
          ...currentValues,
          arcName: typeof parsedDraft.arcName === 'string' ? parsedDraft.arcName : currentValues.arcName,
          chapterStart: normalizeOptionalNumber(parsedDraft.chapterStart ?? currentValues.chapterStart),
          chapterEnd: normalizeOptionalNumber(parsedDraft.chapterEnd ?? currentValues.chapterEnd),
          arcGoal: typeof parsedDraft.arcGoal === 'string' ? parsedDraft.arcGoal : currentValues.arcGoal,
          arcSummary: typeof parsedDraft.arcSummary === 'string' ? parsedDraft.arcSummary : currentValues.arcSummary,
          growthLedger: typeof parsedDraft.growthLedger === 'string' ? parsedDraft.growthLedger : currentValues.growthLedger,
          costLedger: typeof parsedDraft.costLedger === 'string' ? parsedDraft.costLedger : currentValues.costLedger,
        }
        applyOutlineDraft(mergedDraft)
        void saveAppliedDraft(mergedDraft, draftWarningsRef.current, 'outline', draftObservabilityRef.current || undefined).catch(console.error)
      }}
    />
  )

  return (
    <WorkspacePage
      eyebrow="故事大纲"
      title="故事大纲"
      description="按故事弧组织章节，单条故事弧支持 AI 起草。"
      actions={(
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button icon={<RobotOutlined />} loading={generating} onClick={() => void handleGenerateArcs()}>AI 生成故事弧</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建故事弧</Button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>单批</span>
            <InputNumber min={1} max={6} value={outlineBatchSize} onChange={(value) => setOutlineBatchSize(Number(value) || 4)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>本轮总数</span>
            <InputNumber min={1} max={24} value={outlineTargetCount} onChange={(value) => setOutlineTargetCount(Number(value) || 8)} style={{ width: 92 }} />
          </div>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button>
        </div>
      )}
      metrics={<><WorkspaceMetric label="故事弧" value={arcs.length} tone="warm" hint="按阶段组织长篇结构" /><WorkspaceMetric label="章节数" value={chapters.length} hint="当前小说全部章节" /><WorkspaceMetric label="已完成章节" value={totalCompletedChapters} tone="cool" hint="状态为 final 的章节" /><WorkspaceMetric label="当前展开" value={expandedArc?.arcName || '未选择'} hint="展开后查看章节细纲" /></>}
    >
      {draftWarnings.length > 0 ? (
        <WorkspacePanel title="AI 提醒">
          <div className="novel-note-list">
            {draftWarnings.map((warning) => <div key={warning} className="novel-note-list__item">{warning}</div>)}
          </div>
        </WorkspacePanel>
      ) : null}
      {draft?.appliedAt ? (
        <WorkspacePanel title="草稿恢复">
          <div className="novel-note-list">
            <div className="novel-note-list__item">最近一次已应用但未保存的故事弧草稿已恢复到表单。保存故事弧后会自动清除。</div>
          </div>
        </WorkspacePanel>
      ) : null}
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
                const missingOutlineCount = getMissingOutlineCount(arc)
                return (
                  <React.Fragment key={arc.id}>
                    {index > 0 ? <div className="novel-outline-link" /> : null}
                    <div className={`novel-outline-arc ${isExpanded ? 'novel-outline-arc--active' : ''}`} onClick={() => setExpandedArcId(isExpanded ? null : arc.id)}>
                      <div className="novel-outline-arc__index">{index + 1}</div>
                      <div className="novel-outline-arc__title">{arc.arcName}</div>
                      <div className="novel-outline-arc__meta">第 {arc.chapterStart || '?'} ~ {arc.chapterEnd || '?'} 章</div>
                      {arc.arcGoal ? <div className="novel-outline-arc__desc">{arc.arcGoal}</div> : null}
                      {arc.growthLedger ? <div className="novel-outline-arc__desc">成长账本：{arc.growthLedger}</div> : null}
                      {arc.costLedger ? <div className="novel-outline-arc__desc">代价账本：{arc.costLedger}</div> : null}
                      <div className="novel-outline-arc__desc">{missingOutlineCount > 0 ? `待补细纲：${missingOutlineCount} 章` : '当前故事弧细纲已补齐'}</div>
                      <div className="novel-outline-arc__progress"><div style={{ width: `${progressPercent}%`, height: '100%', background: progressPercent === 100 ? '#4f8b64' : '#8f6330', transition: 'width 0.3s' }} /></div>
                      <div className="novel-outline-arc__progress-label">{completedCount}/{arcChapters.length} 章完成</div>
                      <div className="novel-outline-arc__actions" onClick={(event) => event.stopPropagation()}>
                        <Button size="small" icon={<RobotOutlined />} loading={generating} disabled={missingOutlineCount <= 0} onClick={() => void handleGenerateChapterOutlines(arc.id)}>{arcChapters.some((chapter) => chapter.outline?.trim()) ? '继续生成' : '生成细纲'}</Button>
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(arc)} />
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDeleteArc(arc)} />
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </WorkspacePanel>

          <WorkspacePanel title={expandedArc ? `章节细纲 · ${expandedArc.arcName}` : '章节细纲'} extra={expandedArc ? <Space><Button size="small" icon={<SwapOutlined />} type={reorderMode ? 'primary' : 'default'} onClick={() => setReorderMode(!reorderMode)}>{reorderMode ? '完成排序' : '拖拽排序'}</Button><Tag>{`第 ${expandedArc.chapterStart || '?'} ~ ${expandedArc.chapterEnd || '?'} 章`}</Tag></Space> : null}>
            {!expandedArc ? (
              <div className="novel-empty">先展开一条故事弧。</div>
            ) : expandedArcChapters.length === 0 ? (
              <Empty description="当前故事弧下还没有章节。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <>
                {selectedChapterIds.length > 0 ? (
                  <div className="novel-filter-bar" style={{ marginBottom: 16 }}>
                    <div className="novel-filter-bar__row">
                      <Tag color="processing">{`已选 ${selectedChapterIds.length} 章`}</Tag>
                      <Select
                        value={batchStatus}
                        style={{ width: 140 }}
                        onChange={(value: Chapter['status']) => setBatchStatus(value)}
                        options={Object.entries(STATUS_LABELS).map(([value, meta]) => ({ value, label: meta.label }))}
                      />
                      <Button onClick={() => void handleBatchStatusUpdate()}>批量改状态</Button>
                      <InputNumber min={1} value={batchStartChapterNum} onChange={(value) => setBatchStartChapterNum(Number(value) || 1)} />
                      <Button onClick={() => void handleBatchRenumber()}>顺延重排</Button>
                      <Button danger onClick={() => void handleBatchDelete()}>批量删除</Button>
                    </div>
                    <div className="novel-filter-bar__summary">支持单选、Ctrl/Cmd 追加和 Shift 区间选择，`Esc` 可清空批量选择。</div>
                  </div>
                ) : null}
                {reorderMode ? (
                <DragDropContext onDragEnd={handleChapterDragEnd}>
                  <Droppable droppableId={`arc-${expandedArc.id}`}>
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="novel-outline-chapter-grid">
                        {visibleExpandedArcChapters.map((chapter, index) => (
                          <Draggable
                            key={chapter.id}
                            draggableId={`${expandedArc.id}-${chapter.id}`}
                            index={expandedChapterPageStart + index}
                          >
                            {(prov, snapshot) => (
                              <div ref={prov.innerRef} {...prov.draggableProps} style={{ ...prov.draggableProps.style, opacity: snapshot.isDragging ? 0.82 : 1 }}>
                                <ChapterCard
                                  chapter={chapter}
                                  selected={selectedChapterIds.includes(chapter.id)}
                                  dragHandleProps={prov.dragHandleProps ?? undefined}
                                  onClick={(event) => handleChapterSelection(event, chapter, expandedArcChapters)}
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
                ) : (
                <div className="novel-outline-chapter-grid">
                  <VirtualList data={visibleExpandedArcChapters} height={520} itemHeight={100} itemKey="id">
                    {(chapter: Chapter) => (
                      <ChapterCard
                        key={chapter.id}
                        chapter={chapter}
                        selected={selectedChapterIds.includes(chapter.id)}
                        onClick={(event) => handleChapterSelection(event, chapter, expandedArcChapters)}
                      />
                    )}
                  </VirtualList>
                </div>
                )}
                {expandedArcChapters.length > OUTLINE_CHAPTER_PAGE_SIZE ? (
                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <Pagination
                      current={expandedChapterPage}
                      pageSize={OUTLINE_CHAPTER_PAGE_SIZE}
                      total={expandedArcChapters.length}
                      showSizeChanger={false}
                      onChange={setExpandedChapterPage}
                    />
                  </div>
                ) : null}
              </>
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
          <Form.Item name="growthLedger" label="成长账本"><Input.TextArea rows={4} placeholder="写清这一弧主角具体获得了什么变化" /></Form.Item>
          <Form.Item name="costLedger" label="代价账本"><Input.TextArea rows={4} placeholder="写清这一弧具体付出了什么代价" /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}

function ChapterCard({
  chapter,
  selected,
  dragHandleProps,
  onClick,
}: {
  chapter: Chapter
  selected: boolean
  dragHandleProps?: DraggableProvidedDragHandleProps
  onClick: (event: React.MouseEvent<HTMLDivElement>) => void
}) {
  const status = STATUS_LABELS[chapter.status] || STATUS_LABELS.outline
  return (
    <div
      className={`novel-outline-chapter-card ${selected ? 'novel-outline-chapter-card--selected' : ''}`}
      onClick={onClick}
    >
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
