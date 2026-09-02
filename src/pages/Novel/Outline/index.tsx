import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Pagination, Progress, Select, Space, Spin, Tag, message } from 'antd'
import { DeleteOutlined, EditOutlined, HolderOutlined, PlusOutlined, RobotOutlined, SwapOutlined } from '@ant-design/icons'
import { DragDropContext, Draggable, Droppable, type DragDropContextProps, type DraggableProvidedDragHandleProps } from '@hello-pangea/dnd'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type {
  Chapter,
  RhythmTemplateOption,
  StoryArc,
  StoryArcProgressPoint,
  StoryArcProgressSnapshot,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeOptionalNumber, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateOutlineArcDraft } from '../shared/planning-ai-service'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { useChapterOutlineBatch } from './useChapterOutlineBatch'
import CreativeStageScope from '../../../components/novel/CreativeStageScope'
import './index.css'

interface Props { novelId: number }
interface ArcFormValues {
  arcName: string
  chapterStart?: number
  chapterEnd?: number
  arcGoal?: string
  arcSummary?: string
  growthLedger?: string
  costLedger?: string
  phase25Chapter?: number
  phase25Beat?: string
  phase50Chapter?: number
  phase50Beat?: string
  phase75Chapter?: number
  phase75Beat?: string
  phaseClosureChapter?: number
  phaseClosureBeat?: string
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  outline: { label: '待写', color: '#5c6378' },
  writing: { label: '写作中', color: '#2E86AB' },
  draft: { label: '草稿', color: '#faad14' },
  reviewing: { label: '审核中', color: '#e67e22' },
  final: { label: '已完成', color: '#52c41a' },
}

const OUTLINE_CHAPTER_PAGE_SIZE = 50
const RHYTHM_SCOPE_LABELS: Record<RhythmTemplateOption['scope'], string> = {
  opening: '开局',
  arc: '弧级',
  volume: '卷级',
}
const PHASE_FIELD_CONFIG = [
  { key: 'phase_25', label: '25%', ratio: 0.25, chapterField: 'phase25Chapter', beatField: 'phase25Beat' },
  { key: 'phase_50', label: '50%', ratio: 0.5, chapterField: 'phase50Chapter', beatField: 'phase50Beat' },
  { key: 'phase_75', label: '75%', ratio: 0.75, chapterField: 'phase75Chapter', beatField: 'phase75Beat' },
  { key: 'phase_closure', label: '收束', ratio: 1, chapterField: 'phaseClosureChapter', beatField: 'phaseClosureBeat' },
] as const

function arcProgressTagColor(progressRate: number): 'success' | 'warning' | 'error' {
  if (progressRate >= 40) return 'success'
  return progressRate >= 25 ? 'warning' : 'error'
}

function arcStallTagColor(stallRate: number): 'error' | 'warning' | 'default' {
  if (stallRate >= 70) return 'error'
  return stallRate >= 50 ? 'warning' : 'default'
}

function arcPhaseTagColor(missedPhaseCount: number, hitPhaseCount: number): 'error' | 'processing' | 'default' {
  if (missedPhaseCount > 0) return 'error'
  return hitPhaseCount > 0 ? 'processing' : 'default'
}

function buildDefaultPhaseTargets(chapterStart?: number, chapterEnd?: number): Map<string, number> {
  if (typeof chapterStart !== 'number' || typeof chapterEnd !== 'number' || chapterEnd < chapterStart) {
    return new Map()
  }

  const total = Math.max(chapterEnd - chapterStart + 1, 1)
  return new Map(PHASE_FIELD_CONFIG.map((phase) => [
    phase.key,
    phase.key === 'phase_closure'
      ? chapterEnd
      : chapterStart + Math.round((total - 1) * phase.ratio),
  ]))
}

function parsePhaseTargetValues(arc?: StoryArc | null): Partial<ArcFormValues> {
  if (!arc?.phaseTargetsJson?.trim()) return {}

  try {
    const parsed = JSON.parse(arc.phaseTargetsJson) as unknown
    if (!Array.isArray(parsed)) return {}

    return parsed.reduce<Partial<ArcFormValues>>((result, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return result
      const record = item as Record<string, unknown>
      const config = PHASE_FIELD_CONFIG.find((phase) => phase.key === record.key || phase.label === record.label)
      if (!config) return result
      if (typeof record.targetChapterNum === 'number') {
        result[config.chapterField] = Math.max(1, Math.round(record.targetChapterNum))
      }
      if (typeof record.expectedBeat === 'string') {
        result[config.beatField] = record.expectedBeat
      }
      return result
    }, {})
  } catch {
    return {}
  }
}

function buildPhaseTargetsOverrideJson(values: ArcFormValues): string | null {
  const defaultTargets = buildDefaultPhaseTargets(values.chapterStart, values.chapterEnd)
  const overrides = PHASE_FIELD_CONFIG
    .map((phase) => {
      const targetChapterNum = normalizeOptionalNumber(values[phase.chapterField])
      const expectedBeat = typeof values[phase.beatField] === 'string' ? values[phase.beatField]?.trim() : ''
      const defaultTarget = defaultTargets.get(phase.key)
      const hasChapterOverride = typeof targetChapterNum === 'number'
        ? targetChapterNum !== defaultTarget
        : false
      const hasBeatOverride = Boolean(expectedBeat)
      if (!hasChapterOverride && !hasBeatOverride) return null
      return {
        key: phase.key,
        label: phase.label,
        targetRatio: phase.ratio,
        targetChapterNum,
        expectedBeat,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return overrides.length > 0 ? JSON.stringify(overrides) : null
}

export default function Outline({ novelId }: Props) {
  const chapters = useNovelStore((state) => state.chapters)
  const setChapters = useNovelStore((state) => state.setChapters)
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const {
    mutationToken,
    notifyWorkspaceMutation,
    registerClearHandler,
    registerEscapeHandler,
    registerSaveHandler,
  } = useNovelWorkspaceActions()
  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [rhythmTemplates, setRhythmTemplates] = useState<RhythmTemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [arcSaving, setArcSaving] = useState(false)
  const [arcProgressSnapshot, setArcProgressSnapshot] = useState<StoryArcProgressSnapshot | null>(null)
  const [arcForm] = Form.useForm<ArcFormValues>()
  const [arcModalOpen, setArcModalOpen] = useState(false)
  const [editingArc, setEditingArc] = useState<StoryArc | null>(null)
  const [expandedArcId, setExpandedArcId] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const stored = Number(window.sessionStorage.getItem(`novelforge-outline-arc:${novelId}`))
    return Number.isSafeInteger(stored) && stored > 0 ? stored : null
  })
  const [expandedChapterPage, setExpandedChapterPage] = useState(1)
  const [outlineBatchSize, setOutlineBatchSize] = useState(4)
  const [outlineTargetCount, setOutlineTargetCount] = useState(8)
  const [selectedChapterIds, setSelectedChapterIds] = useState<number[]>([])
  const [lastSelectedChapterId, setLastSelectedChapterId] = useState<number | null>(null)
  const [batchStatus, setBatchStatus] = useState<Chapter['status']>('outline')
  const [batchStartChapterNum, setBatchStartChapterNum] = useState(1)
  const [reorderMode, setReorderMode] = useState(false)
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const [creativeStageId, setCreativeStageId] = useState<number | null>(() => {
    const value = new URLSearchParams(window.location.hash.split('?')[1] || '').get('stageId')
    return value && Number.isSafeInteger(Number(value)) ? Number(value) : null
  })
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
  const loadRequestRef = React.useRef(0)
  const arcSaveActionRef = React.useRef(false)
  const arcDirtyRef = React.useRef(false)
  const [arcHasUnsavedChanges, setArcHasUnsavedChanges] = useState(false)

  const loadData = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoading(true)
    try {
      const [arcList, chapterList, arcProgress] = await Promise.all([
        window.electron.outline.getArcs(novelId),
        window.electron.chapter.list(novelId),
        window.electron.outline.getArcProgressSnapshot(novelId),
      ])
      if (loadRequestRef.current !== requestId) return
      setArcs(arcList.sort((a, b) => a.arcOrder - b.arcOrder))
      setChapters(chapterList)
      setArcProgressSnapshot(arcProgress)
    } catch (error) {
      if (loadRequestRef.current === requestId) {
        console.error(error)
        message.error(getUserFacingMessage('common.loadFailed'))
      }
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false)
    }
  }, [novelId, setChapters])

  useEffect(() => { void loadData() }, [loadData, mutationToken])
  useEffect(() => {
    if (expandedArcId) window.sessionStorage.setItem(`novelforge-outline-arc:${novelId}`, String(expandedArcId))
  }, [expandedArcId, novelId])

  useEffect(() => {
    let cancelled = false
    void window.electron.rhythm.listTemplates(novelId)
      .then((templates) => { if (!cancelled) setRhythmTemplates(templates) })
      .catch((error) => console.error(error))
    return () => { cancelled = true }
  }, [novelId])

  const rhythmTemplateMap = useMemo(
    () => new Map(rhythmTemplates.map((template) => [template.key, template])),
    [rhythmTemplates],
  )

  const handleAttachRhythmTemplate = useCallback(async (arc: StoryArc, templateKey: string | null) => {
    try {
      await window.electron.rhythm.attachToArc(arc.id, templateKey)
      await loadData()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage(templateKey ? 'rhythm.attached' : 'rhythm.detached'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    }
  }, [loadData, notifyWorkspaceMutation])

  const outlineBatch = useChapterOutlineBatch(loadData)
  const outlineBatchRunning = outlineBatch.progress.phase === 'running'

  const openCreateModal = () => {
    setEditingArc(null)
    arcDirtyRef.current = false
    setArcHasUnsavedChanges(false)
    arcForm.setFieldsValue({
      arcName: '',
      chapterStart: undefined,
      chapterEnd: undefined,
      arcGoal: '',
      arcSummary: '',
      growthLedger: '',
      costLedger: '',
      phase25Chapter: undefined,
      phase25Beat: '',
      phase50Chapter: undefined,
      phase50Beat: '',
      phase75Chapter: undefined,
      phase75Beat: '',
      phaseClosureChapter: undefined,
      phaseClosureBeat: '',
    })
    setArcModalOpen(true)
  }

  const openEditModal = (arc: StoryArc) => {
    const summaryTargets = arcProgressSnapshot?.arcs.find((item) => item.arcId === arc.id)?.phaseTargets || []
    const phaseFields = summaryTargets.reduce<Partial<ArcFormValues>>((result, target) => {
      const config = PHASE_FIELD_CONFIG.find((phase) => phase.key === target.key)
      if (!config) return result
      result[config.chapterField] = target.targetChapterNum
      result[config.beatField] = target.expectedBeat || ''
      return result
    }, parsePhaseTargetValues(arc))
    setEditingArc(arc)
    arcDirtyRef.current = false
    setArcHasUnsavedChanges(false)
    arcForm.setFieldsValue({
      arcName: arc.arcName,
      chapterStart: arc.chapterStart,
      chapterEnd: arc.chapterEnd,
      arcGoal: arc.arcGoal || '',
      arcSummary: arc.arcSummary || '',
      growthLedger: arc.growthLedger || '',
      costLedger: arc.costLedger || '',
      ...phaseFields,
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
    const finished = await outlineBatch.start(arcId, {
      batchSize: outlineBatchSize,
      targetCount: outlineTargetCount,
      stageId: creativeStageId || undefined,
    })
    if (finished.phase !== 'done') return
    const linkage = finished.lastResult?.structureLinkage
    const linkageSummary = linkage
      ? `已补齐 ${linkage.createdChapterContractCount} 章合同、${linkage.createdSceneContractCount} 条场景合同和 ${linkage.createdTimelineEventCount} 个时间锚点。`
      : ''
    const summary = [finished.lastResult?.message || '章节细纲已生成一批。', linkageSummary].filter(Boolean).join(' ')
    message.success(finished.generated > 0
      ? getUserFacingMessage('outline.batchGenerated', { summary, count: finished.generated })
      : summary)
  }

  const handleDeleteArc = async (arc: StoryArc) => {
    Modal.confirm({
      title: `删除“${arc.arcName}”？`,
      okType: 'danger',
      onOk: async () => {
        try {
          await window.electron.outline.deleteArc(arc.id)
          await loadData()
          notifyWorkspaceMutation()
          message.success(getUserFacingMessage('outline.arcDeleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }

  const handleClear = useCallback(async () => {
    Modal.confirm({
      title: '清空故事大纲？',
      content: '会删除全部故事弧和章节细纲归属，但不会删除正文。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.outline.clear(novelId)
        setExpandedArcId(null)
        await loadData()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('outline.cleared'))
      },
    })
  }, [loadData, novelId, notifyWorkspaceMutation, setExpandedArcId])

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
    // Droppable 只渲染当前分页；Draggable 的 index 必须从 0 连续计数，
    // 这里再把页内位置换算回完整故事弧的位置。
    const sourceIndex = expandedChapterPageStart + result.source.index
    const destinationIndex = expandedChapterPageStart + result.destination.index
    const [moved] = arcChapters.splice(sourceIndex, 1)
    if (!moved) return
    arcChapters.splice(destinationIndex, 0, moved)
    await window.electron.chapter.reorder(
      arcChapters.map((chapter) => chapter.id),
      arc.chapterStart || 1,
    )
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
  const arcProgressSummaryMap = useMemo(
    () => new Map((arcProgressSnapshot?.arcs || []).map((summary) => [summary.arcId, summary] as const)),
    [arcProgressSnapshot],
  )
  const arcPointMap = useMemo(
    () => new Map((arcProgressSnapshot?.chapterPoints || []).map((point) => [`${point.arcId}:${point.chapterId}`, point] as const)),
    [arcProgressSnapshot],
  )
  const expandedArcSummary = expandedArc ? arcProgressSummaryMap.get(expandedArc.id) : undefined
  const expandedArcAlerts = expandedArcSummary?.alerts || []

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

  useEffect(() => {
    registerClearHandler(() => {
      void handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])
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
    setEditingArc(null)
    setArcHasUnsavedChanges(true)
    arcDirtyRef.current = true
    setArcModalOpen(true)
  }, [arcForm])
  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<ArcFormValues>({
    novelId,
    pageKey: 'outline',
    applyDraft: applyOutlineDraft,
  })
  const handleSaveArc = useCallback(async () => {
    if (arcSaveActionRef.current) return
    arcSaveActionRef.current = true
    try {
      const values = await arcForm.validateFields().catch(() => null)
      if (!values) return
      setArcSaving(true)
      const payload = {
        arcName: values.arcName,
        chapterStart: normalizeOptionalNumber(values.chapterStart),
        chapterEnd: normalizeOptionalNumber(values.chapterEnd),
        arcGoal: values.arcGoal,
        arcSummary: values.arcSummary,
        growthLedger: values.growthLedger,
        costLedger: values.costLedger,
        phaseTargetsJson: buildPhaseTargetsOverrideJson(values),
      }
      if (editingArc) {
        await window.electron.outline.updateArc(editingArc.id, payload)
      } else {
        await window.electron.outline.createArc(novelId, { ...payload, arcOrder: arcs.length + 1 })
      }
      await finalizeDraft(values)
      await clearDraft()
      arcDirtyRef.current = false
      setArcHasUnsavedChanges(false)
      setArcModalOpen(false)
      setEditingArc(null)
      arcForm.resetFields()
      await loadData()
      notifyWorkspaceMutation()
      message.success(editingArc ? '故事弧已更新。' : '故事弧已创建。')
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      arcSaveActionRef.current = false
      setArcSaving(false)
    }
  }, [arcForm, arcs.length, clearDraft, editingArc, finalizeDraft, loadData, novelId, notifyWorkspaceMutation])

  const closeArcModal = useCallback(() => {
    if (arcSaveActionRef.current) return
    if (!arcDirtyRef.current) {
      setArcModalOpen(false)
      arcForm.resetFields()
      setEditingArc(null)
      return
    }
    Modal.confirm({
      title: '关闭当前故事弧编辑？',
      content: '当前故事弧还有未保存修改，关闭后草稿会保留在本地恢复区。',
      okText: '关闭并保留草稿',
      cancelText: '留下继续编辑',
      onOk: () => {
        setArcModalOpen(false)
        arcDirtyRef.current = false
        setArcHasUnsavedChanges(false)
        arcForm.resetFields()
        setEditingArc(null)
      },
    })
  }, [arcForm])

  useEffect(() => {
    registerSaveHandler(arcModalOpen ? () => { void handleSaveArc() } : null)
    return () => registerSaveHandler(null)
  }, [arcModalOpen, handleSaveArc, registerSaveHandler])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!arcDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])
  const arcDraftButton = (
    <AIGenerateButton
      novelId={novelId}
      label="AI 生成·故事弧草稿"
      intent="generate"
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
      eyebrow="卷章大纲 / 故事骨架"
      title="故事大纲"
      className="novel-outline-page"
      chrome="shared"
      actionContract={{
        primary: { key: 'create-outline-arc', label: '新建故事弧', icon: <PlusOutlined />, onClick: openCreateModal },
        secondary: [
          { key: 'generate-outline-arcs', label: 'AI 生成故事弧', icon: <RobotOutlined />, loading: generating, onClick: () => void handleGenerateArcs() },
        ],
        more: {
          items: [
            { key: 'clear-outline', icon: <DeleteOutlined />, danger: true, label: '清空故事大纲', onClick: () => void handleClear() },
          ],
        },
      }}
      metrics={<><WorkspaceMetric label="故事弧" value={arcs.length} tone="warm" /><WorkspaceMetric label="章节数" value={chapters.length} /><WorkspaceMetric label="已完成章节" value={totalCompletedChapters} tone="cool" /><WorkspaceMetric label="当前展开" value={expandedArc?.arcName || '未选择'} /></>}
    >
      <div className="novel-outline-page__status-rail" data-outline-save-state={arcHasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`novel-outline-page__status-dot${arcHasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{arcHasUnsavedChanges ? '当前故事弧有未保存修改' : '故事弧目录与章节数据同步'}</strong>
        <span>目录只负责定位；编辑、拖拽、批量操作都作用于当前展开的一条故事弧。</span>
      </div>
      <details className="novel-outline-page__tools-disclosure" data-outline-tools>
        <summary>生成与阶段工具</summary>
        <div className="novel-outline-page__tools-body">
          <CreativeStageScope
            novelId={novelId}
            value={creativeStageId}
            onChange={(stageId) => {
              setCreativeStageId(stageId)
              const route = window.location.hash.split('?')[0]
              window.location.hash = `${route}${stageId ? `?stageId=${stageId}` : ''}`
            }}
          />
          <div className="novel-outline-page__toolbar-group">
            <span className="novel-outline-page__toolbar-label">单批</span>
            <InputNumber min={1} max={6} value={outlineBatchSize} onChange={(value) => setOutlineBatchSize(Number(value) || 4)} className="novel-outline-page__count-input novel-outline-page__count-input--sm" />
            <span className="novel-outline-page__toolbar-label">本轮总数</span>
            <InputNumber min={1} max={24} value={outlineTargetCount} onChange={(value) => setOutlineTargetCount(Number(value) || 8)} className="novel-outline-page__count-input novel-outline-page__count-input--md" />
          </div>
        </div>
      </details>
      {outlineBatch.progress.phase !== 'idle' ? (
        <WorkspacePanel title="细纲批量生成">
          <div className="novel-outline-page__batch-progress">
            <Progress
              percent={outlineBatch.progress.target > 0
                ? Math.min(100, Math.round((outlineBatch.progress.generated / outlineBatch.progress.target) * 100))
                : 0}
              status={outlineBatch.progress.phase === 'failed'
                ? 'exception'
                : outlineBatch.progress.phase === 'running' ? 'active' : 'success'}
              format={() => `${outlineBatch.progress.generated}/${outlineBatch.progress.target} 章`}
            />
            {outlineBatch.progress.phase === 'running' ? (
              <Space>
                <span className="novel-outline-page__batch-hint">
                  {outlineBatch.progress.cancelRequested
                    ? '将在当前批次结束后停止…'
                    : `正在生成第 ${outlineBatch.progress.batchIndex} 批，已生成的细纲会即时保存。`}
                </span>
                <Button size="small" danger disabled={outlineBatch.progress.cancelRequested} onClick={outlineBatch.cancel}>
                  停止生成
                </Button>
              </Space>
            ) : null}
            {outlineBatch.progress.phase === 'failed' ? (
              <Alert
                type="error"
                showIcon
                message="细纲生成中断"
                description={`${outlineBatch.progress.errorMessage || '生成失败'}；已生成 ${outlineBatch.progress.generated} 章并已保存，可点击重试从中断处继续。`}
                action={(
                  <Space direction="vertical">
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        const arcId = outlineBatch.progress.arcId
                        if (arcId) void handleGenerateChapterOutlines(arcId)
                      }}
                    >
                      重试
                    </Button>
                    <Button size="small" onClick={outlineBatch.reset}>关闭</Button>
                  </Space>
                )}
              />
            ) : null}
            {outlineBatch.progress.phase === 'done' ? (
              <Space>
                <span className="novel-outline-page__batch-hint">
                  {outlineBatch.progress.cancelRequested ? '已按请求停止，进度已保存。' : '本轮生成完成。'}
                </span>
                <Button size="small" onClick={outlineBatch.reset}>关闭</Button>
              </Space>
            ) : null}
            {outlineBatch.progress.designGate && !outlineBatch.progress.designGate.passed ? (
              <Alert
                type="warning"
                showIcon
                message="设计对齐提醒"
                description={`${outlineBatch.progress.designGate.summary}${outlineBatch.progress.designGate.flaggedChapters.length > 0 ? `（涉及第 ${outlineBatch.progress.designGate.flaggedChapters.join('、')} 章）` : ''}`}
              />
            ) : null}
          </div>
        </WorkspacePanel>
      ) : null}
      {draftWarnings.length > 0 ? (
        <WorkspacePanel title="AI 修补提示">
          <div className="novel-note-list">
            {draftWarnings.map((warning) => <div key={warning} className="novel-note-list__item">{warning}</div>)}
          </div>
        </WorkspacePanel>
      ) : null}
      {draft?.appliedAt ? (
        <div data-outline-draft-recovery>
        <WorkspacePanel title="草稿恢复" className="novel-outline-page__draft-panel" >
          <div className="novel-note-list">
            <div className="novel-note-list__item">最近一次已应用但未保存的故事弧草稿已恢复到表单。保存故事弧后会自动清除。</div>
          </div>
        </WorkspacePanel>
        </div>
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
          <div className="novel-outline-page__workspace">
          <WorkspacePanel title="故事弧目录" className="novel-outline-page__arc-panel">
            <div className="novel-outline-track" data-outline-arc-list>
              {arcs.map((arc, index) => {
                const arcChapters = getArcChapters(arc)
                const arcSummary = arcProgressSummaryMap.get(arc.id)
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
                      {arc.rhythmTemplateKey ? (
                        <div className="novel-outline-page__tag-row novel-outline-page__tag-row--top">
                          <Tag color="geekblue" className="novel-outline-page__tag-reset">
                            节奏模板：{rhythmTemplateMap.get(arc.rhythmTemplateKey)?.name || arc.rhythmTemplateKey}
                          </Tag>
                        </div>
                      ) : null}
                      <div className="novel-outline-arc__desc">{missingOutlineCount > 0 ? `待补细纲：${missingOutlineCount} 章` : '当前故事弧细纲已补齐'}</div>
                      {arcSummary ? (
                        <div className="novel-outline-page__tag-row novel-outline-page__tag-row--top">
                          <Tag color={arcProgressTagColor(arcSummary.progressRate)} className="novel-outline-page__tag-reset">
                            推进率 {arcSummary.progressRate}%
                          </Tag>
                          <Tag color={arcStallTagColor(arcSummary.stallRate)} className="novel-outline-page__tag-reset">
                            空转率 {arcSummary.stallRate}%
                          </Tag>
                          <Tag color={arcPhaseTagColor(arcSummary.missedPhaseCount, arcSummary.hitPhaseCount)} className="novel-outline-page__tag-reset">
                            阶段 {arcSummary.hitPhaseCount}/{arcSummary.phaseTargets.length}
                          </Tag>
                          {arcSummary.alerts.length > 0 ? <Tag color="error" className="novel-outline-page__tag-reset">{arcSummary.alerts.length} 条告警</Tag> : null}
                        </div>
                      ) : null}
                      <div className="novel-outline-arc__progress"><div className="novel-outline-page__progress-fill" style={{ width: `${progressPercent}%`, background: progressPercent === 100 ? '#4f8b64' : '#8f6330' }} /></div>
                      <div className="novel-outline-arc__progress-label">{completedCount}/{arcChapters.length} 章完成</div>
                      <div className="novel-outline-arc__actions" onClick={(event) => event.stopPropagation()}>
                        <Button
                          size="small"
                          icon={<RobotOutlined />}
                          loading={outlineBatchRunning && outlineBatch.progress.arcId === arc.id}
                          disabled={missingOutlineCount <= 0 || outlineBatchRunning}
                          onClick={() => void handleGenerateChapterOutlines(arc.id)}
                        >
                          {arcChapters.some((chapter) => chapter.outline?.trim()) ? '继续生成' : '生成细纲'}
                        </Button>
                        <Select
                          size="small"
                          allowClear
                          placeholder="节奏模板"
                          popupMatchSelectWidth={false}
                          style={{ minWidth: 128 }}
                          value={arc.rhythmTemplateKey || undefined}
                          options={rhythmTemplates.map((template) => ({
                            value: template.key,
                            label: `${template.name}（${RHYTHM_SCOPE_LABELS[template.scope]}）`,
                            title: template.summary,
                          }))}
                          onChange={(value) => void handleAttachRhythmTemplate(arc, value || null)}
                        />
                        <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(arc)} />
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDeleteArc(arc)} />
                      </div>
                    </div>
                  </React.Fragment>
                )
              })}
            </div>
          </WorkspacePanel>

          <div data-outline-current-detail>
          <WorkspacePanel title={expandedArc ? `章节细纲 · ${expandedArc.arcName}` : '当前章节细纲'} className="novel-outline-page__current-panel" extra={expandedArc ? <Space><Button size="small" icon={<SwapOutlined />} type={reorderMode ? 'primary' : 'default'} onClick={() => setReorderMode(!reorderMode)}>{reorderMode ? '完成排序' : '拖拽排序'}</Button><Tag>{`第 ${expandedArc.chapterStart || '?'} ~ ${expandedArc.chapterEnd || '?'} 章`}</Tag></Space> : null}>
            {!expandedArc ? (
              <div className="novel-empty">先展开一条故事弧。</div>
            ) : expandedArcChapters.length === 0 ? (
              <Empty description="当前故事弧下还没有章节。" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <>
                {expandedArcSummary ? (
                  <div className="novel-outline-page__section-stack novel-outline-page__section-stack--bottom">
                    <div className="novel-outline-page__metric-grid">
                      <div className="novel-filter-card">
                        <div className="novel-filter-card__label">已记录推进</div>
                        <div className="novel-filter-card__value">{expandedArcSummary.progressPercent}%</div>
                        <div className="novel-filter-card__hint">{expandedArcSummary.statusSummary}</div>
                      </div>
                      <div className="novel-filter-card">
                        <div className="novel-filter-card__label">连续空转</div>
                        <div className="novel-filter-card__value">{expandedArcSummary.stalledChapterCount}</div>
                        <div className="novel-filter-card__hint">最长空转 {expandedArcSummary.longestStalledRun} 章</div>
                      </div>
                      <div className="novel-filter-card">
                        <div className="novel-filter-card__label">阶段兑现</div>
                        <div className="novel-filter-card__value">{expandedArcSummary.hitPhaseCount}/{expandedArcSummary.phaseTargets.length}</div>
                        <div className="novel-filter-card__hint">未兑现 {expandedArcSummary.missedPhaseCount} 个</div>
                      </div>
                    </div>
                    <div className="novel-outline-page__info-panel">
                      <div className="novel-outline-page__panel-title">阶段目标</div>
                      <div className="novel-outline-page__stack-sm">
                        {expandedArcSummary.phaseTargets.map((target) => (
                          <div key={`${expandedArcSummary.arcId}-${target.key}`} className="novel-outline-page__target-row">
                            <div className="novel-outline-page__tag-row">
                              <Tag color={target.source === 'manual' ? 'processing' : 'default'} className="novel-outline-page__tag-reset">{target.label}</Tag>
                              <span className="novel-outline-page__muted novel-outline-page__muted--light">目标章节：{target.targetChapterNum || '自动推导'}</span>
                            </div>
                            <span className="novel-outline-page__muted">{target.expectedBeat || '未填写验收条件，默认按推进与兑现判断。'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {expandedArcAlerts.length > 0 ? (
                      <div className="novel-outline-page__info-panel">
                        <div className="novel-outline-page__panel-title">推进告警</div>
                        {expandedArcAlerts.slice(0, 4).map((alert, index) => (
                          <div key={`${alert.code}-${index}`} className="novel-outline-page__stack-xs">
                            <div className="novel-outline-page__tag-row">
                              <Tag color={alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'default'} className="novel-outline-page__tag-reset">
                                {alert.severity === 'critical' ? '高优先' : alert.severity === 'warning' ? '中优先' : '低优先'}
                              </Tag>
                              <span className="novel-outline-page__alert-title">{alert.title}</span>
                            </div>
                            <div className="novel-outline-page__muted novel-outline-page__muted--light">{alert.detail}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {selectedChapterIds.length > 0 ? (
                  <div className="novel-filter-bar novel-outline-page__filter-bar">
                    <div className="novel-filter-bar__row">
                      <Tag color="processing">{`已选 ${selectedChapterIds.length} 章`}</Tag>
                      <Select
                        value={batchStatus}
                        className="novel-outline-page__status-select"
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
                            index={index}
                          >
                            {(prov, snapshot) => (
                              <div ref={prov.innerRef} {...prov.draggableProps} style={{ ...prov.draggableProps.style, opacity: snapshot.isDragging ? 0.82 : 1 }}>
                                <ChapterCard
                                  chapter={chapter}
                                  arcPoint={arcPointMap.get(`${expandedArc.id}:${chapter.id}`)}
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
                  {visibleExpandedArcChapters.map((chapter) => (
                    <ChapterCard
                      key={chapter.id}
                      chapter={chapter}
                      arcPoint={arcPointMap.get(`${expandedArc.id}:${chapter.id}`)}
                      selected={selectedChapterIds.includes(chapter.id)}
                      onClick={(event) => handleChapterSelection(event, chapter, expandedArcChapters)}
                    />
                  ))}
                </div>
                )}
                {expandedArcChapters.length > OUTLINE_CHAPTER_PAGE_SIZE ? (
                  <div className="novel-outline-page__pagination">
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
          </div>
          </div>
        </>
      )}

      <Modal title={editingArc ? '编辑故事弧' : '新建故事弧'} open={arcModalOpen} forceRender onCancel={closeArcModal} onOk={() => void handleSaveArc()} okText="保存" confirmLoading={arcSaving} cancelButtonProps={{ disabled: arcSaving }} maskClosable={!arcSaving}>
        <div className="novel-outline-page__modal-header">
          {arcDraftButton}
        </div>
        <Form form={arcForm} layout="vertical" onValuesChange={() => { arcDirtyRef.current = true; setArcHasUnsavedChanges(true) }}>
          <Form.Item name="arcName" label="名称" rules={[{ required: true, message: '请填写故事弧名称' }]}><Input placeholder="例如：觉醒线、南境追击线" /></Form.Item>
          <div className="novel-outline-page__range-row">
            <Form.Item name="chapterStart" label="起始章节" className="novel-outline-page__range-field"><Input type="number" min={1} /></Form.Item>
            <Form.Item name="chapterEnd" label="结束章节" className="novel-outline-page__range-field"><Input type="number" min={1} /></Form.Item>
          </div>
          <Form.Item name="arcGoal" label="本弧目标"><Input.TextArea rows={6} placeholder="写清这一弧要推进什么" /></Form.Item>
          <Form.Item name="arcSummary" label="本弧概述"><Input.TextArea rows={5} placeholder="写清起点、转折和阶段收束" /></Form.Item>
          <Form.Item name="growthLedger" label="成长账本"><Input.TextArea rows={6} placeholder="写清这一弧主角具体获得了什么变化" /></Form.Item>
          <Form.Item name="costLedger" label="代价账本"><Input.TextArea rows={6} placeholder="写清这一弧具体付出了什么代价" /></Form.Item>
          <div className="novel-outline-page__section-stack">
            <div className="novel-outline-page__panel-title">阶段目标覆盖</div>
            <div className="novel-outline-page__muted novel-outline-page__muted--light">默认按章节范围自动推导 25% / 50% / 75% / 收束；只有你填写的内容才会作为覆盖配置保存。</div>
            {PHASE_FIELD_CONFIG.map((phase) => (
              <div key={phase.key} className="novel-outline-page__info-panel">
                <div className="novel-outline-page__panel-title">{phase.label}</div>
                <div className="novel-outline-page__phase-fields">
                  <Form.Item name={phase.chapterField} label="目标章节" className="novel-outline-page__phase-field novel-outline-page__phase-field--chapter">
                    <InputNumber min={1} className="novel-outline-page__full-width-input" placeholder="留空则自动推导" />
                  </Form.Item>
                  <Form.Item name={phase.beatField} label="验收条件" className="novel-outline-page__phase-field novel-outline-page__phase-field--beat">
                    <Input placeholder="例如：主线真相第一次被证实、关系彻底翻面" />
                  </Form.Item>
                </div>
              </div>
            ))}
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}

function ChapterCard({
  chapter,
  arcPoint,
  selected,
  dragHandleProps,
  onClick,
}: {
  chapter: Chapter
  arcPoint?: StoryArcProgressPoint
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
      <div {...dragHandleProps} className="novel-outline-chapter-card__handle"><HolderOutlined className="novel-outline-page__handle-icon" /></div>
      <div className="novel-outline-page__chapter-main">
        <div className="novel-outline-chapter-card__meta">
          <span className="novel-outline-chapter-card__number">第 {chapter.chapterNum} 章</span>
          <Tag className="novel-outline-page__chapter-status" style={{ borderColor: status.color, color: status.color }}>{status.label}</Tag>
        </div>
        <div className="novel-outline-chapter-card__title">{chapter.title || `第 ${chapter.chapterNum} 章`}</div>
        {chapter.outline ? <div className="novel-outline-chapter-card__summary novel-outline-page__chapter-summary">{chapter.outline}</div> : null}
        {arcPoint ? (
          <div className="novel-outline-page__tag-row novel-outline-page__tag-row--top">
            <Tag color={arcPoint.progressHit ? 'success' : 'default'} className="novel-outline-page__tag-reset">{arcPoint.progressHit ? '推进章' : '空转章'}</Tag>
            {arcPoint.checkpointPhaseLabels.map((label) => <Tag key={`${chapter.id}-${label}`} color={arcPoint.progressHit ? 'processing' : 'warning'} className="novel-outline-page__tag-reset">{label}</Tag>)}
            {arcPoint.alertDetails.length > 0 ? <Tag color="error" className="novel-outline-page__tag-reset">{arcPoint.alertDetails.length} 条告警</Tag> : null}
          </div>
        ) : null}
        <div className="novel-outline-chapter-card__words novel-outline-page__chapter-words">已写 {chapter.wordCount ?? 0} 字 · 参考 {chapter.targetWords ?? 0} 字（弹性）</div>
      </div>
    </div>
  )
}
