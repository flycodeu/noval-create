import { Form, Modal, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
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
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
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

  const internalRouteKeyRef = useRef<string | null>(null)
  const resolveRequestRef = useRef(0)
  const volumesRequestRef = useRef(0)
  const partsRequestRef = useRef(0)
  const chaptersRequestRef = useRef(0)
  const segmentsRequestRef = useRef(0)
  const linkedRequestRef = useRef(0)
  const checkpointsRequestRef = useRef(0)
  const chapterDetailRequestRef = useRef(0)
  const segmentDetailRequestRef = useRef(0)
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

  const loadVolumes = useCallback(async (isCurrent: () => boolean = () => true) => {
    const requestId = ++volumesRequestRef.current
    const rows = await window.electron.structure.listVolumes(novelId)
    if (volumesRequestRef.current === requestId && isCurrent()) setVolumes(rows)
    return rows
  }, [novelId])

  const loadParts = useCallback(async (
    volumeId: number,
    page: number,
    force = false,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++partsRequestRef.current
    const key = `${volumeId}:${page}`

    if (!force && partsCache.current.has(key)) {
      const cached = partsCache.current.get(key)!
      if (partsRequestRef.current === requestId && isCurrent()) setParts(cached)
      return cached
    }

    const next = await window.electron.structure.listPartsPage(volumeId, page, PART_PAGE_SIZE)
    partsCache.current.set(key, next)
    if (partsRequestRef.current === requestId && isCurrent()) setParts(next)
    return next
  }, [])

  const loadChapters = useCallback(async (
    partId: number,
    page: number,
    force = false,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++chaptersRequestRef.current
    const key = `${partId}:${page}`

    if (!force && chapterCache.current.has(key)) {
      const cached = chapterCache.current.get(key)!
      if (chaptersRequestRef.current === requestId && isCurrent()) setChapters(cached)
      return cached
    }

    const next = await window.electron.structure.listChaptersPage(partId, page, CHAPTER_PAGE_SIZE)
    chapterCache.current.set(key, next)
    if (chaptersRequestRef.current === requestId && isCurrent()) setChapters(next)
    return next
  }, [])

  const loadSegments = useCallback(async (
    chapterId: number,
    page: number,
    force = false,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++segmentsRequestRef.current
    const key = `${chapterId}:${page}`

    if (!force && segmentCache.current.has(key)) {
      const cached = segmentCache.current.get(key)!
      if (segmentsRequestRef.current === requestId && isCurrent()) setSegments(cached)
      return cached
    }

    const next = await window.electron.structure.listSegmentsPage(chapterId, page, SEGMENT_PAGE_SIZE)
    segmentCache.current.set(key, next)
    if (segmentsRequestRef.current === requestId && isCurrent()) setSegments(next)
    return next
  }, [])

  const loadLinked = useCallback(async (page: number, force = false) => {
    const requestId = ++linkedRequestRef.current
    if (!timelineFilters) {
      if (linkedRequestRef.current === requestId) setLinked(createEmptyPage(LINKED_PAGE_SIZE))
      return createEmptyPage<TimelineEvent>(LINKED_PAGE_SIZE)
    }

    const key = JSON.stringify({ ...timelineFilters, page })
    if (!force && linkedCache.current.has(key)) {
      const cached = linkedCache.current.get(key)!
      if (linkedRequestRef.current === requestId) setLinked(cached)
      return cached
    }

    const next = await window.electron.structure.listLinkedTimelineEventsPage(
      timelineFilters,
      page,
      LINKED_PAGE_SIZE,
    )
    linkedCache.current.set(key, next)
    if (linkedRequestRef.current === requestId) setLinked(next)
    return next
  }, [timelineFilters])

  const loadCheckpoints = useCallback(async (page: number, force = false) => {
    const requestId = ++checkpointsRequestRef.current
    const key = JSON.stringify({ ...checkpointFilters, page })

    if (!force && checkpointCache.current.has(key)) {
      const cached = checkpointCache.current.get(key)!
      if (checkpointsRequestRef.current === requestId) setCheckpoints(cached)
      return cached
    }

    const next = await window.electron.structure.listCheckpointsPage(
      checkpointFilters,
      page,
      CHECKPOINT_PAGE_SIZE,
    )
    checkpointCache.current.set(key, next)
    if (checkpointsRequestRef.current === requestId) setCheckpoints(next)
    return next
  }, [checkpointFilters])

  const loadChapterDetail = useCallback(async (
    chapterId: number,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++chapterDetailRequestRef.current
    const chapter = await window.electron.chapter.get(chapterId)
    if (chapterDetailRequestRef.current === requestId && isCurrent()) setChapterDetail(chapter)
    return chapter
  }, [])

  const loadSegmentDetail = useCallback(async (
    segmentId: number | null,
    isCurrent: () => boolean = () => true,
  ) => {
    const requestId = ++segmentDetailRequestRef.current
    if (!segmentId) {
      if (isCurrent()) setSegmentDetail(null)
      return null
    }

    const segment = await window.electron.structure.getSegment(segmentId)
    if (segmentDetailRequestRef.current === requestId && isCurrent()) setSegmentDetail(segment)
    return segment
  }, [])

  const resolveAndLoad = useCallback(async (preferred: Partial<StructureSelection>, force = false) => {
    const requestId = ++resolveRequestRef.current
    const isCurrent = () => resolveRequestRef.current === requestId
    setLoading(true)

    try {
      const volumeRows = await loadVolumes(isCurrent)
      if (!isCurrent()) return

      if (volumeRows.length === 0) {
        const emptySelection = createStructureSelection()
        setSelection(emptySelection)
        setParts(createEmptyPage(PART_PAGE_SIZE))
        setChapters(createEmptyPage(CHAPTER_PAGE_SIZE))
        setSegments(createEmptyPage(SEGMENT_PAGE_SIZE))
        setLinked(createEmptyPage(LINKED_PAGE_SIZE))
        setCheckpoints(createEmptyPage(CHECKPOINT_PAGE_SIZE))
        setChapterDetail(null)
        setSegmentDetail(null)
        const currentRouteKey = searchParams.toString()
        if (currentRouteKey) {
          internalRouteKeyRef.current = ''
          navigate(buildWorkspaceRoute(novelId, 'structure'), { replace: true })
        }
        return
      }

      const resolved = await window.electron.structure.resolvePath(
        toTimelineAnchorFilters({ novelId, ...preferred }),
      )
      if (!isCurrent()) return

      const nextSelection: StructureSelection = {
        volumeId: resolved.volumeId,
        partId: resolved.partId,
        chapterId: resolved.chapterId,
        segmentId: resolved.segmentId,
      }

      setSelection(nextSelection)
      const nextRouteKey = buildStructureParams(nextSelection).toString()
      if (nextRouteKey !== searchParams.toString()) {
        internalRouteKeyRef.current = nextRouteKey
        navigate(buildWorkspaceRoute(novelId, `structure${nextRouteKey ? `?${nextRouteKey}` : ''}`), { replace: true })
      }

      if (resolved.volumeId) {
        await loadParts(resolved.volumeId, resolved.partPage, force, isCurrent)
      } else {
        setParts(createEmptyPage(PART_PAGE_SIZE))
      }
      if (!isCurrent()) return

      if (resolved.partId) {
        await loadChapters(resolved.partId, resolved.chapterPage, force, isCurrent)
      } else {
        setChapters(createEmptyPage(CHAPTER_PAGE_SIZE))
      }
      if (!isCurrent()) return

      if (resolved.chapterId) {
        const [segmentPage] = await Promise.all([
          loadSegments(resolved.chapterId, resolved.segmentPage, force, isCurrent),
          loadChapterDetail(resolved.chapterId, isCurrent),
        ])
        if (!isCurrent()) return
        await loadSegmentDetail(resolved.segmentId ?? segmentPage.items[0]?.id ?? null, isCurrent)
      } else {
        setSegments(createEmptyPage(SEGMENT_PAGE_SIZE))
        setChapterDetail(null)
        setSegmentDetail(null)
      }
    } catch (error) {
      if (isCurrent()) {
        console.error(error)
        message.error(getErrorMessage(error, 'common.loadFailed'))
      }
    } finally {
      if (isCurrent()) {
        setLoading(false)
      }
    }
  }, [loadChapterDetail, loadChapters, loadParts, loadSegmentDetail, loadSegments, loadVolumes, navigate, novelId, searchParams])

  useEffect(() => {
    const routeKey = searchParams.toString()
    if (internalRouteKeyRef.current === routeKey) {
      internalRouteKeyRef.current = null
      return
    }
    void resolveAndLoad(route, true)
  }, [resolveAndLoad, route, searchParams])

  useEffect(() => {
    if (!selection.chapterId) {
      setChapterDetail(null)
      setSegmentDetail(null)
      return
    }

    void loadChapterDetail(selection.chapterId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadChapterDetail, selection.chapterId])

  useEffect(() => {
    if (!selection.chapterId) {
      setSegmentDetail(null)
      return
    }

    const activeSegmentId = selection.segmentId ?? segments.items[0]?.id ?? null
    void loadSegmentDetail(activeSegmentId).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
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
      targetWords: chapterDetail.targetWords || undefined,
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
    void loadLinked(1).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [loadLinked])

  useEffect(() => {
    void loadCheckpoints(1).catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
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
    if (!chapterDetail) return false

    const values = await chapterForm.validateFields().catch(() => null)
    if (!values) return false
    setSavingChapter(true)

    try {
      if (values.partId && values.partId !== chapterDetail.partId) {
        await window.electron.structure.assignChapter(chapterDetail.id, values.partId)
      }

      await window.electron.chapter.update(chapterDetail.id, {
        title: values.title?.trim() || chapterDetail.title,
        outline: values.outline?.trim() || '',
        ...(typeof values.targetWords === 'number' && values.targetWords > 0
          ? { targetWords: values.targetWords }
          : {}),
      })

      clearCaches()
      await resolveAndLoad(selection, true)
      message.success(getUserFacingMessage('structure.chapterSaved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
      return false
    } finally {
      setSavingChapter(false)
    }
  }, [chapterDetail, chapterForm, clearCaches, resolveAndLoad, selection])

  const saveSegment = useCallback(async () => {
    if (!segmentDetail) return false

    const values = await segmentForm.validateFields().catch(() => null)
    if (!values) return false
    setSavingSegment(true)

    try {
      await window.electron.structure.updateSegment(segmentDetail.id, values)
      clearCaches()
      await resolveAndLoad(selection, true)
      message.success(getUserFacingMessage('structure.segmentSaved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
      return false
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
    navigate(buildWorkspaceRoute(novelId, `timeline?${buildStructureParams(selection).toString()}&action=new`))
  }, [navigate, novelId, selection])

  const openWritingPage = useCallback(() => {
    navigate(buildWorkspaceRoute(novelId, 'writing'))
  }, [navigate, novelId])

  const openLinkedEvent = useCallback((eventId: number) => {
    navigate(buildWorkspaceRoute(novelId, `timeline?eventId=${eventId}`))
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
