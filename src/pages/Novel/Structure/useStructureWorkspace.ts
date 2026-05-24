import { Form, Modal, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterSegment,
  PagedResult,
  StoryMemoryCheckpoint,
  StoryStructureChapterSummary,
  StoryStructurePartSummary,
  StoryStructureSegmentSummary,
  StoryStructureVolumeSummary,
  TimelineEvent,
} from '../../../types'
import { createEmptyPage, getPartLabel, getSegmentLabel, getVolumeLabel, optionalId } from '../shared/workspace-utils'
import type { ChapterFormValues, SegmentFormValues, StructureSelection } from './helpers'
import {
  CHAPTER_PAGE_SIZE,
  CHECKPOINT_PAGE_SIZE,
  LINKED_PAGE_SIZE,
  PART_PAGE_SIZE,
  SEGMENT_PAGE_SIZE,
  buildCheckpointFilters,
  buildStructureParams,
  buildTimelineFilters,
  createStructureSelection,
  parseStructureRoute,
  reorderItems,
  toTimelineAnchorFilters,
} from './helpers'

export const STRUCTURE_BATCH_CREATE_MAX = 1000

function normalizeBatchCreateCount(count: number) {
  return Math.max(1, Math.min(Math.floor(count) || 1, STRUCTURE_BATCH_CREATE_MAX))
}

export function useStructureWorkspace(novelId: number) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const route = useMemo(() => parseStructureRoute(searchParams), [searchParams])
  const [chapterForm] = Form.useForm<ChapterFormValues>()
  const [segmentForm] = Form.useForm<SegmentFormValues>()

  const [loading, setLoading] = useState(true)
  const [savingChapter, setSavingChapter] = useState(false)
  const [savingSegment, setSavingSegment] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [volumes, setVolumes] = useState<StoryStructureVolumeSummary[]>([])
  const [parts, setParts] = useState<PagedResult<StoryStructurePartSummary>>(createEmptyPage(PART_PAGE_SIZE))
  const [chapters, setChapters] = useState<PagedResult<StoryStructureChapterSummary>>(createEmptyPage(CHAPTER_PAGE_SIZE))
  const [segments, setSegments] = useState<PagedResult<StoryStructureSegmentSummary>>(createEmptyPage(SEGMENT_PAGE_SIZE))
  const [linked, setLinked] = useState<PagedResult<TimelineEvent>>(createEmptyPage(LINKED_PAGE_SIZE))
  const [checkpoints, setCheckpoints] = useState<PagedResult<StoryMemoryCheckpoint>>(createEmptyPage(CHECKPOINT_PAGE_SIZE))
  const [selection, setSelection] = useState<StructureSelection>(createStructureSelection())

  const [chapterDetail, setChapterDetail] = useState<Chapter | null>(null)
  const [segmentDetail, setSegmentDetail] = useState<ChapterSegment | null>(null)

  const [editingVolumeId, setEditingVolumeId] = useState<number | null>(null)
  const [editingPartId, setEditingPartId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const routeApplyingRef = useRef(false)
  const partsCache = useRef(new Map<string, PagedResult<StoryStructurePartSummary>>())
  const chapterCache = useRef(new Map<string, PagedResult<StoryStructureChapterSummary>>())
  const segmentCache = useRef(new Map<string, PagedResult<StoryStructureSegmentSummary>>())
  const linkedCache = useRef(new Map<string, PagedResult<TimelineEvent>>())
  const checkpointCache = useRef(new Map<string, PagedResult<StoryMemoryCheckpoint>>())

  const currentVolume = useMemo(
    () => volumes.find((item) => item.id === selection.volumeId) || null,
    [selection.volumeId, volumes],
  )
  const currentPart = useMemo(
    () => parts.items.find((item) => item.id === selection.partId) || null,
    [parts.items, selection.partId],
  )
  const timelineFilters = useMemo(
    () => buildTimelineFilters(novelId, selection),
    [novelId, selection],
  )
  const checkpointFilters = useMemo(
    () => buildCheckpointFilters(novelId, selection),
    [novelId, selection],
  )
  const checkpointPanelTitle = useMemo(() => {
    if (selection.partId) return '当前部检查点'
    if (selection.volumeId) return '当前卷检查点'
    return '全书检查点'
  }, [selection.partId, selection.volumeId])
  const canReorderSegments = segments.total > 0 && segments.total <= segments.pageSize

  const clearCaches = useCallback(() => {
    partsCache.current.clear()
    chapterCache.current.clear()
    segmentCache.current.clear()
    linkedCache.current.clear()
    checkpointCache.current.clear()
  }, [])

  const loadVolumes = useCallback(async () => {
    const rows = await window.electron.structure.listVolumes(novelId)
    setVolumes(rows)
    return rows
  }, [novelId])

  const loadParts = useCallback(async (volumeId: number, page: number, force = false) => {
    const key = `${volumeId}:${page}`

    if (!force && partsCache.current.has(key)) {
      const cached = partsCache.current.get(key)!
      setParts(cached)
      return cached
    }

    const next = await window.electron.structure.listPartsPage(volumeId, page, PART_PAGE_SIZE)
    partsCache.current.set(key, next)
    setParts(next)
    return next
  }, [])

  const loadChapters = useCallback(async (partId: number, page: number, force = false) => {
    const key = `${partId}:${page}`

    if (!force && chapterCache.current.has(key)) {
      const cached = chapterCache.current.get(key)!
      setChapters(cached)
      return cached
    }

    const next = await window.electron.structure.listChaptersPage(partId, page, CHAPTER_PAGE_SIZE)
    chapterCache.current.set(key, next)
    setChapters(next)
    return next
  }, [])

  const loadSegments = useCallback(async (chapterId: number, page: number, force = false) => {
    const key = `${chapterId}:${page}`

    if (!force && segmentCache.current.has(key)) {
      const cached = segmentCache.current.get(key)!
      setSegments(cached)
      return cached
    }

    const next = await window.electron.structure.listSegmentsPage(chapterId, page, SEGMENT_PAGE_SIZE)
    segmentCache.current.set(key, next)
    setSegments(next)
    return next
  }, [])

  const loadLinked = useCallback(async (page: number, force = false) => {
    if (!timelineFilters) {
      setLinked(createEmptyPage(LINKED_PAGE_SIZE))
      return createEmptyPage<TimelineEvent>(LINKED_PAGE_SIZE)
    }

    const key = JSON.stringify({ ...timelineFilters, page })
    if (!force && linkedCache.current.has(key)) {
      const cached = linkedCache.current.get(key)!
      setLinked(cached)
      return cached
    }

    const next = await window.electron.structure.listLinkedTimelineEventsPage(
      timelineFilters,
      page,
      LINKED_PAGE_SIZE,
    )
    linkedCache.current.set(key, next)
    setLinked(next)
    return next
  }, [timelineFilters])

  const loadCheckpoints = useCallback(async (page: number, force = false) => {
    const key = JSON.stringify({ ...checkpointFilters, page })

    if (!force && checkpointCache.current.has(key)) {
      const cached = checkpointCache.current.get(key)!
      setCheckpoints(cached)
      return cached
    }

    const next = await window.electron.structure.listCheckpointsPage(
      checkpointFilters,
      page,
      CHECKPOINT_PAGE_SIZE,
    )
    checkpointCache.current.set(key, next)
    setCheckpoints(next)
    return next
  }, [checkpointFilters])

  const loadChapterDetail = useCallback(async (chapterId: number) => {
    const chapter = await window.electron.chapter.get(chapterId)
    setChapterDetail(chapter)
    return chapter
  }, [])

  const loadSegmentDetail = useCallback(async (segmentId: number | null) => {
    if (!segmentId) {
      setSegmentDetail(null)
      return null
    }

    const segment = await window.electron.structure.getSegment(segmentId)
    setSegmentDetail(segment)
    return segment
  }, [])

  const resolveAndLoad = useCallback(async (preferred: Partial<StructureSelection>, force = false) => {
    routeApplyingRef.current = true
    setLoading(true)

    try {
      const volumeRows = await loadVolumes()

      if (volumeRows.length === 0) {
        setSelection(createStructureSelection())
        setParts(createEmptyPage(PART_PAGE_SIZE))
        setChapters(createEmptyPage(CHAPTER_PAGE_SIZE))
        setSegments(createEmptyPage(SEGMENT_PAGE_SIZE))
        setLinked(createEmptyPage(LINKED_PAGE_SIZE))
        setCheckpoints(createEmptyPage(CHECKPOINT_PAGE_SIZE))
        setChapterDetail(null)
        setSegmentDetail(null)
        return
      }

      const resolved = await window.electron.structure.resolvePath(
        toTimelineAnchorFilters({ novelId, ...preferred }),
      )

      const nextSelection: StructureSelection = {
        volumeId: resolved.volumeId,
        partId: resolved.partId,
        chapterId: resolved.chapterId,
        segmentId: resolved.segmentId,
      }

      setSelection(nextSelection)

      if (resolved.volumeId) {
        await loadParts(resolved.volumeId, resolved.partPage, force)
      } else {
        setParts(createEmptyPage(PART_PAGE_SIZE))
      }

      if (resolved.partId) {
        await loadChapters(resolved.partId, resolved.chapterPage, force)
      } else {
        setChapters(createEmptyPage(CHAPTER_PAGE_SIZE))
      }

      if (resolved.chapterId) {
        await Promise.all([
          loadSegments(resolved.chapterId, resolved.segmentPage, force),
          loadChapterDetail(resolved.chapterId),
        ])
      } else {
        setSegments(createEmptyPage(SEGMENT_PAGE_SIZE))
        setChapterDetail(null)
        setSegmentDetail(null)
      }
    } finally {
      setLoading(false)
      routeApplyingRef.current = false
    }
  }, [loadChapterDetail, loadChapters, loadParts, loadSegments, loadVolumes, novelId])

  useEffect(() => {
    void resolveAndLoad(route, true)
  }, [resolveAndLoad, route])

  useEffect(() => {
    if (routeApplyingRef.current) return

    const next = buildStructureParams(selection).toString()
    const current = searchParams.toString()

    if (next !== current) {
      navigate(`/novels/${novelId}/structure${next ? `?${next}` : ''}`, { replace: true })
    }
  }, [navigate, novelId, searchParams, selection])

  useEffect(() => {
    if (!selection.chapterId) {
      setChapterDetail(null)
      setSegmentDetail(null)
      return
    }

    void loadChapterDetail(selection.chapterId)
  }, [loadChapterDetail, selection.chapterId])

  useEffect(() => {
    if (!selection.chapterId) {
      setSegmentDetail(null)
      return
    }

    const activeSegmentId = selection.segmentId ?? segments.items[0]?.id ?? null
    void loadSegmentDetail(activeSegmentId)
  }, [loadSegmentDetail, segments.items, selection.chapterId, selection.segmentId])

  useEffect(() => {
    if (loading) return

    if (!chapterDetail) {
      chapterForm.resetFields()
      return
    }

    chapterForm.setFieldsValue({
      title: chapterDetail.title || '',
      outline: chapterDetail.outline || '',
      targetWords: chapterDetail.targetWords || 3000,
      partId: chapterDetail.partId,
    })
  }, [chapterDetail, chapterForm, loading])

  useEffect(() => {
    if (loading) return

    if (!segmentDetail) {
      segmentForm.resetFields()
      return
    }

    segmentForm.setFieldsValue({
      title: segmentDetail.title || '',
      segmentType: segmentDetail.segmentType || 'scene',
      purpose: segmentDetail.purpose || '',
      timeAnchor: segmentDetail.timeAnchor || '',
      locationName: segmentDetail.locationName || '',
      inputState: segmentDetail.inputState || '',
      outputState: segmentDetail.outputState || '',
      summary: segmentDetail.summary || '',
      content: segmentDetail.content || '',
      status: segmentDetail.status || 'planned',
    })
  }, [loading, segmentDetail, segmentForm])

  useEffect(() => {
    void loadLinked(1)
  }, [loadLinked])

  useEffect(() => {
    void loadCheckpoints(1)
  }, [loadCheckpoints])

  const refreshStructure = useCallback(async () => {
    await resolveAndLoad(selection, true)
  }, [resolveAndLoad, selection])

  const saveRename = useCallback(async () => {
    const title = editingTitle.trim()
    if (!title) {
      message.warning(getUserFacingMessage('structure.titleRequired'))
      return
    }

    if (editingVolumeId) {
      await window.electron.structure.updateVolume(editingVolumeId, { title })
    }

    if (editingPartId) {
      await window.electron.structure.updatePart(editingPartId, { title })
    }

    setEditingTitle('')
    setEditingPartId(null)
    setEditingVolumeId(null)

    clearCaches()
    await resolveAndLoad(selection, true)
    message.success(getUserFacingMessage('structure.renameUpdated'))
  }, [clearCaches, editingPartId, editingTitle, editingVolumeId, resolveAndLoad, selection])

  const cancelRename = useCallback(() => {
    setEditingTitle('')
    setEditingPartId(null)
    setEditingVolumeId(null)
  }, [])

  const startRenameVolume = useCallback((volume: StoryStructureVolumeSummary) => {
    setEditingTitle(getVolumeLabel(volume))
    setEditingVolumeId(volume.id)
    setEditingPartId(null)
  }, [])

  const startRenamePart = useCallback((part: StoryStructurePartSummary) => {
    setEditingTitle(getPartLabel(part))
    setEditingPartId(part.id)
    setEditingVolumeId(null)
  }, [])

  const addVolume = useCallback(async () => {
    const volumeId = await window.electron.structure.createVolume(novelId, {})
    clearCaches()
    await resolveAndLoad({ volumeId }, true)
    message.success(getUserFacingMessage('structure.volumeCreated'))
  }, [clearCaches, novelId, resolveAndLoad])

  const addVolumes = useCallback(async (count: number) => {
    const safeCount = normalizeBatchCreateCount(count)
    let lastVolumeId: number | null = null

    for (let index = 0; index < safeCount; index += 1) {
      lastVolumeId = await window.electron.structure.createVolume(novelId, {})
    }

    clearCaches()
    await resolveAndLoad(lastVolumeId ? { volumeId: lastVolumeId } : {}, true)
    message.success(getUserFacingMessage('structure.volumesCreated', { count: safeCount }))
  }, [clearCaches, novelId, resolveAndLoad])

  const addPart = useCallback(async (volumeId: number) => {
    const partId = await window.electron.structure.createPart(volumeId, {})
    clearCaches()
    await resolveAndLoad({ volumeId, partId }, true)
    message.success(getUserFacingMessage('structure.partCreated'))
  }, [clearCaches, resolveAndLoad])

  const addParts = useCallback(async (volumeId: number, count: number) => {
    const safeCount = normalizeBatchCreateCount(count)
    let lastPartId: number | null = null

    for (let index = 0; index < safeCount; index += 1) {
      lastPartId = await window.electron.structure.createPart(volumeId, {})
    }

    clearCaches()
    await resolveAndLoad(lastPartId ? { volumeId, partId: lastPartId } : { volumeId }, true)
    message.success(getUserFacingMessage('structure.partsCreated', { count: safeCount }))
  }, [clearCaches, resolveAndLoad])

  const addChapter = useCallback(async () => {
    if (!selection.partId || !selection.volumeId) return

    const chapterId = await window.electron.chapter.create(novelId, {
      status: 'outline',
      targetWords: 3000,
      partId: selection.partId,
      volumeId: selection.volumeId,
    })

    clearCaches()
    await resolveAndLoad(
      {
        volumeId: selection.volumeId,
        partId: selection.partId,
        chapterId,
      },
      true,
    )
    message.success(getUserFacingMessage('structure.chapterCreated'))
  }, [clearCaches, novelId, resolveAndLoad, selection.partId, selection.volumeId])

  const addChapters = useCallback(async (count: number) => {
    if (!selection.partId || !selection.volumeId) return

    const safeCount = normalizeBatchCreateCount(count)
    let lastChapterId: number | null = null

    for (let index = 0; index < safeCount; index += 1) {
      lastChapterId = await window.electron.chapter.create(novelId, {
        status: 'outline',
        targetWords: 3000,
        partId: selection.partId,
        volumeId: selection.volumeId,
      })
    }

    clearCaches()
    await resolveAndLoad(
      {
        volumeId: selection.volumeId,
        partId: selection.partId,
        chapterId: lastChapterId ?? undefined,
      },
      true,
    )
    message.success(getUserFacingMessage('structure.chaptersCreated', { count: safeCount }))
  }, [clearCaches, novelId, resolveAndLoad, selection.partId, selection.volumeId])

  const addSegment = useCallback(async () => {
    if (!selection.chapterId) return

    const segmentId = await window.electron.structure.createSegment(selection.chapterId, {
      title: `场景 ${String((segments.total || 0) + 1).padStart(2, '0')}`,
      segmentType: 'scene',
      status: 'planned',
    })

    clearCaches()
    await resolveAndLoad(
      {
        volumeId: optionalId(selection.volumeId),
        partId: optionalId(selection.partId),
        chapterId: selection.chapterId,
        segmentId,
      },
      true,
    )
    message.success(getUserFacingMessage('structure.segmentCreated'))
  }, [clearCaches, resolveAndLoad, segments.total, selection.chapterId, selection.partId, selection.volumeId])

  const addSegments = useCallback(async (count: number) => {
    if (!selection.chapterId) return

    const safeCount = normalizeBatchCreateCount(count)
    let lastSegmentId: number | null = null
    const baseOrder = segments.total || 0

    for (let index = 0; index < safeCount; index += 1) {
      lastSegmentId = await window.electron.structure.createSegment(selection.chapterId, {
        title: `场景 ${String(baseOrder + index + 1).padStart(2, '0')}`,
        segmentType: 'scene',
        status: 'planned',
      })
    }

    clearCaches()
    await resolveAndLoad(
      {
        volumeId: optionalId(selection.volumeId),
        partId: optionalId(selection.partId),
        chapterId: selection.chapterId,
        segmentId: lastSegmentId ?? undefined,
      },
      true,
    )
    message.success(getUserFacingMessage('structure.segmentsCreated', { count: safeCount }))
  }, [clearCaches, resolveAndLoad, segments.total, selection.chapterId, selection.partId, selection.volumeId])

  const deleteVolume = useCallback(async (volume: StoryStructureVolumeSummary) => {
    const shouldDelete = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `删除 ${getVolumeLabel(volume)}？`,
        content: '会移除该卷及其下属结构。请确认当前内容已经整理完毕。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

    if (!shouldDelete) return

    await window.electron.structure.deleteVolume(volume.id)
    clearCaches()
    await resolveAndLoad({}, true)
    message.success(getUserFacingMessage('structure.volumeDeleted'))
  }, [clearCaches, resolveAndLoad])

  const deletePart = useCallback(async (part: StoryStructurePartSummary) => {
    const shouldDelete = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `删除 ${getPartLabel(part)}？`,
        content: '会移除该部及其下属章节和场景。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

    if (!shouldDelete) return

    await window.electron.structure.deletePart(part.id)
    clearCaches()
    await resolveAndLoad({ volumeId: optionalId(selection.volumeId) }, true)
    message.success(getUserFacingMessage('structure.partDeleted'))
  }, [clearCaches, resolveAndLoad, selection.volumeId])

  const deleteChapter = useCallback(async () => {
    if (!chapterDetail) return

    const shouldDelete = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `删除第 ${chapterDetail.chapterNum} 章？`,
        content: '会删除当前章节及其结构数据，请确认正文内容不再需要。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

    if (!shouldDelete) return

    await window.electron.chapter.delete(chapterDetail.id)
    clearCaches()
    await resolveAndLoad({
      volumeId: optionalId(selection.volumeId),
      partId: optionalId(selection.partId),
    }, true)
    message.success(getUserFacingMessage('structure.chapterDeleted'))
  }, [chapterDetail, clearCaches, resolveAndLoad, selection.partId, selection.volumeId])

  const deleteSegment = useCallback(async () => {
    if (!segmentDetail) return

    const shouldDelete = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: `删除 ${getSegmentLabel(segmentDetail)}？`,
        content: '会删除当前场景。',
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

    if (!shouldDelete) return

    await window.electron.structure.deleteSegment(segmentDetail.id)
    clearCaches()
    await resolveAndLoad({
      volumeId: optionalId(selection.volumeId),
      partId: optionalId(selection.partId),
      chapterId: optionalId(selection.chapterId),
    }, true)
    message.success(getUserFacingMessage('structure.segmentDeleted'))
  }, [clearCaches, resolveAndLoad, segmentDetail, selection.chapterId, selection.partId, selection.volumeId])

  const saveChapter = useCallback(async () => {
    if (!chapterDetail) return

    const values = await chapterForm.validateFields()
    setSavingChapter(true)

    try {
      if (values.partId && values.partId !== chapterDetail.partId) {
        await window.electron.structure.assignChapter(chapterDetail.id, values.partId)
      }

      await window.electron.chapter.update(chapterDetail.id, {
        title: values.title?.trim() || chapterDetail.title,
        outline: values.outline?.trim() || '',
        targetWords: values.targetWords || 3000,
      })

      clearCaches()
      await resolveAndLoad(selection, true)
      message.success(getUserFacingMessage('structure.chapterSaved'))
    } finally {
      setSavingChapter(false)
    }
  }, [chapterDetail, chapterForm, clearCaches, resolveAndLoad, selection])

  const saveSegment = useCallback(async () => {
    if (!segmentDetail) return

    const values = await segmentForm.validateFields()
    setSavingSegment(true)

    try {
      await window.electron.structure.updateSegment(segmentDetail.id, values)
      clearCaches()
      await resolveAndLoad(selection, true)
      message.success(getUserFacingMessage('structure.segmentSaved'))
    } finally {
      setSavingSegment(false)
    }
  }, [clearCaches, resolveAndLoad, segmentDetail, segmentForm, selection])

  const compileChapter = useCallback(async () => {
    if (!selection.chapterId) return

    await window.electron.structure.compileChapter(selection.chapterId)
    clearCaches()
    await resolveAndLoad(selection, true)
    message.success(getUserFacingMessage('structure.chapterRecompiled'))
  }, [clearCaches, resolveAndLoad, selection])

  const refreshMemory = useCallback(async () => {
    setRefreshing(true)

    try {
      await window.electron.structure.refreshCheckpoints(novelId)
      checkpointCache.current.clear()
      await loadCheckpoints(1, true)
      message.success(getUserFacingMessage('structure.checkpointsRefreshed'))
    } finally {
      setRefreshing(false)
    }
  }, [loadCheckpoints, novelId])

  const handleVolumeDragEnd = useCallback(async (result: { destination: { index: number } | null; source: { index: number } }) => {
    if (!result.destination) return

    const ordered = reorderItems(volumes, result.source.index, result.destination.index)
    await window.electron.structure.reorderVolumes(novelId, ordered.map((item) => item.id))
    await loadVolumes()
    message.success(getUserFacingMessage('structure.volumeOrderUpdated'))
  }, [loadVolumes, novelId, volumes])

  const handlePartDragEnd = useCallback(async (result: { destination: { index: number } | null; source: { index: number } }) => {
    if (!result.destination || !selection.volumeId) return

    if (parts.total > parts.pageSize) {
      message.warning(getUserFacingMessage('structure.partOrderPaged'))
      return
    }

    const ordered = reorderItems(parts.items, result.source.index, result.destination.index)
    await window.electron.structure.reorderPartsInVolume(selection.volumeId, ordered.map((item) => item.id))
    partsCache.current.clear()
    await loadParts(selection.volumeId, 1, true)
    message.success(getUserFacingMessage('structure.partOrderUpdated'))
  }, [loadParts, parts.items, parts.pageSize, parts.total, selection.volumeId])

  const handleSegmentDragEnd = useCallback(async (result: { destination: { index: number } | null; source: { index: number } }) => {
    if (!result.destination || !selection.chapterId) return

    if (segments.total > segments.pageSize) {
      message.warning(getUserFacingMessage('structure.segmentOrderPaged'))
      return
    }

    const ordered = reorderItems(segments.items, result.source.index, result.destination.index)
    await window.electron.structure.reorderSegments(selection.chapterId, ordered.map((item) => item.id))
    clearCaches()
    await resolveAndLoad(selection, true)
    message.success(getUserFacingMessage('structure.segmentOrderUpdated'))
  }, [clearCaches, resolveAndLoad, segments.items, segments.pageSize, segments.total, selection])

  const selectVolume = useCallback(async (volumeId: number) => {
    await resolveAndLoad({ volumeId })
  }, [resolveAndLoad])

  const selectPart = useCallback(async (partId: number) => {
    if (!currentVolume) return
    await resolveAndLoad({ volumeId: currentVolume.id, partId })
  }, [currentVolume, resolveAndLoad])

  const selectChapter = useCallback(async (chapterId: number) => {
    await resolveAndLoad({
      volumeId: optionalId(selection.volumeId),
      partId: optionalId(selection.partId),
      chapterId,
    })
  }, [resolveAndLoad, selection.partId, selection.volumeId])

  const selectSegment = useCallback(async (segmentId: number) => {
    if (!chapterDetail) return

    await resolveAndLoad({
      volumeId: optionalId(selection.volumeId),
      partId: optionalId(selection.partId),
      chapterId: chapterDetail.id,
      segmentId,
    })
  }, [chapterDetail, resolveAndLoad, selection.partId, selection.volumeId])

  const openCreateEvent = useCallback(() => {
    navigate(`/novels/${novelId}/timeline?${buildStructureParams(selection).toString()}&action=new`)
  }, [navigate, novelId, selection])

  const openWritingPage = useCallback(() => {
    navigate(`/novels/${novelId}/writing`)
  }, [navigate, novelId])

  const openLinkedEvent = useCallback((eventId: number) => {
    navigate(`/novels/${novelId}/timeline?eventId=${eventId}`)
  }, [navigate, novelId])

  return {
    chapterDetail,
    chapterForm,
    chapters,
    checkpointFilters,
    checkpointPanelTitle,
    checkpoints,
    currentPart,
    currentVolume,
    editingPartId,
    editingTitle,
    editingVolumeId,
    linked,
    loading,
    parts,
    refreshing,
    savingChapter,
    savingSegment,
    segmentDetail,
    segmentForm,
    segments,
    selection,
    timelineFilters,
    volumes,
    canReorderSegments,
    setEditingTitle,
    addChapter,
    addChapters,
    addPart,
    addParts,
    addSegment,
    addSegments,
    addVolume,
    addVolumes,
    cancelRename,
    compileChapter,
    deleteChapter,
    deletePart,
    deleteSegment,
    deleteVolume,
    loadCheckpoints,
    loadLinked,
    loadParts,
    loadChapters,
    loadSegments,
    openCreateEvent,
    openLinkedEvent,
    openWritingPage,
    refreshMemory,
    refreshStructure,
    saveChapter,
    saveRename,
    saveSegment,
    selectChapter,
    selectPart,
    selectSegment,
    selectVolume,
    startRenamePart,
    startRenameVolume,
    handlePartDragEnd,
    handleSegmentDragEnd,
    handleVolumeDragEnd,
  }
}
