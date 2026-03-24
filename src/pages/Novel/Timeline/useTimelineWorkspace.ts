import { Form, Modal, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  Character,
  MapNodeSummary,
  PagedResult,
  StoryArc,
  StoryItem,
  StoryStructureChapterSummary,
  StoryStructurePartSummary,
  StoryStructureSegmentSummary,
  StoryStructureVolumeSummary,
  TimelineEvent,
  TimelineFilterOptions,
  TimelineQueryInput,
  TimelineStats,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import {
  createEmptyPage,
  getPartOptionLabel,
  getSegmentOptionLabel,
  getVolumeOptionLabel,
} from '../shared/workspace-utils'
import type {
  NumericFilter,
  TimelineFormValues,
  TimelineGenerateValues,
  TimelineStatusFilter,
} from './helpers'
import {
  TIME_MODE_EXAMPLES,
  TIME_MODE_OPTIONS,
  TIMELINE_BOARD_COLUMNS,
  TIMELINE_TEXT,
  TIMELINE_STATUS_META,
  buildDefaultTimelineValues,
  buildStructureJumpParams,
  buildStructureTags,
  getInitialGenerateValues,
  mergeEntitiesById,
  parseNumberArray,
  parseTimelineRoute,
  serializeTimelineValues,
  toTimelineFormValues,
} from './helpers'

const EMPTY_TIMELINE_STATS: TimelineStats = {
  total: 0,
  majorCount: 0,
  resolvedCount: 0,
  openThreadCount: 0,
}

const EMPTY_FILTER_OPTIONS: TimelineFilterOptions = {
  eventTypes: [],
}

export function useTimelineWorkspace(novelId: number) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const route = useMemo(() => parseTimelineRoute(searchParams), [searchParams])
  const routeKeyRef = useRef('')
  const suppressRefreshRef = useRef(false)

  const { currentNovel } = useNovelStore()
  const [form] = Form.useForm<TimelineFormValues>()
  const [generateForm] = Form.useForm<TimelineGenerateValues>()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  const [pageData, setPageData] = useState<PagedResult<TimelineEvent>>(createEmptyPage(100))
  const [stats, setStats] = useState<TimelineStats>(EMPTY_TIMELINE_STATS)
  const [filterOptions, setFilterOptions] = useState<TimelineFilterOptions>(EMPTY_FILTER_OPTIONS)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null)
  const [creating, setCreating] = useState(false)

  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [volumeFilter, setVolumeFilter] = useState<NumericFilter>('all')
  const [partFilter, setPartFilter] = useState<NumericFilter>('all')
  const [chapterFilter, setChapterFilter] = useState<NumericFilter>('all')
  const [segmentFilter, setSegmentFilter] = useState<NumericFilter>('all')
  const [page, setPage] = useState(1)

  const [volumes, setVolumes] = useState<StoryStructureVolumeSummary[]>([])
  const [filterParts, setFilterParts] = useState<StoryStructurePartSummary[]>([])
  const [filterChapters, setFilterChapters] = useState<StoryStructureChapterSummary[]>([])

  const [formParts, setFormParts] = useState<StoryStructurePartSummary[]>([])
  const [formChapters, setFormChapters] = useState<StoryStructureChapterSummary[]>([])
  const [formSegments, setFormSegments] = useState<StoryStructureSegmentSummary[]>([])

  const [arcs, setArcs] = useState<StoryArc[]>([])
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [locationOptions, setLocationOptions] = useState<MapNodeSummary[]>([])
  const [itemOptions, setItemOptions] = useState<StoryItem[]>([])

  const worldRules = useMemo(
    () => parseWorldRulesJson(currentNovel?.worldRulesJson, currentNovel?.genreName),
    [currentNovel?.genreName, currentNovel?.worldRulesJson],
  )
  const defaultMode = worldRules.timelineConfig.calendarType
  const defaultPrecision = worldRules.timelineConfig.precisionOptions[0] || '\u9636\u6bb5'
  const defaultType = worldRules.timelineConfig.recommendedEventTypes[0] || ''

  const watchedVolumeId = Form.useWatch('volumeId', form)
  const watchedPartId = Form.useWatch('partId', form)
  const watchedChapterStartId = Form.useWatch('chapterStartId', form)
  const watchedChapterEndId = Form.useWatch('chapterEndId', form)
  const watchedSegmentId = Form.useWatch('segmentId', form)
  const selectedTimeMode = Form.useWatch('timeMode', form) || defaultMode

  const modeLabel = TIME_MODE_OPTIONS.find((item) => item.value === selectedTimeMode)?.label || selectedTimeMode
  const laneItems = useMemo(
    () => TIMELINE_BOARD_COLUMNS.map((status) => ({
      status,
      items: pageData.items.filter((item) => item.status === status),
    })),
    [pageData.items],
  )

  const volumeById = useMemo(() => new Map(volumes.map((item) => [item.id, item])), [volumes])
  const partById = useMemo(
    () => new Map([...filterParts, ...formParts].map((item) => [item.id, item])),
    [filterParts, formParts],
  )
  const chapterById = useMemo(
    () => new Map([...filterChapters, ...formChapters].map((item) => [item.id, item])),
    [filterChapters, formChapters],
  )
  const segmentById = useMemo(
    () => new Map(formSegments.map((item) => [item.id, item])),
    [formSegments],
  )
  const structureLookups = useMemo(
    () => ({ volumeById, partById, chapterById, segmentById }),
    [chapterById, partById, segmentById, volumeById],
  )

  const filterSummary = useMemo(
    () => `${TIMELINE_TEXT.listSummaryPrefix}${pageData.total}${TIMELINE_TEXT.listSummaryMiddle}${pageData.items.length}${TIMELINE_TEXT.listSummarySuffix}`,
    [pageData.items.length, pageData.total],
  )
  const structureFilterSummary = useMemo(
    () => (volumeFilter === 'all' && partFilter === 'all' && chapterFilter === 'all' && segmentFilter === 'all'
      ? TIMELINE_TEXT.global
      : TIMELINE_TEXT.filtered),
    [chapterFilter, partFilter, segmentFilter, volumeFilter],
  )
  const timeModeHint = TIME_MODE_EXAMPLES[selectedTimeMode] || TIMELINE_TEXT.defaultTimeModeHint
  const filterVolumeOptions = useMemo(
    () => volumes.map((item) => ({ value: item.id, label: getVolumeOptionLabel(item) })),
    [volumes],
  )
  const filterPartOptions = useMemo(
    () => filterParts.map((item) => ({ value: item.id, label: getPartOptionLabel(item) })),
    [filterParts],
  )
  const filterChapterOptions = useMemo(
    () => filterChapters.map((item) => ({ value: item.id, label: `\u7b2c ${item.chapterNum} \u7ae0` })),
    [filterChapters],
  )
  const formVolumeOptions = useMemo(
    () => volumes.map((item) => ({ value: item.id, label: getVolumeOptionLabel(item) })),
    [volumes],
  )
  const formPartOptions = useMemo(
    () => formParts.map((item) => ({ value: item.id, label: getPartOptionLabel(item) })),
    [formParts],
  )
  const formChapterOptions = useMemo(
    () => formChapters.map((item) => ({ value: item.id, label: `\u7b2c ${item.chapterNum} \u7ae0` })),
    [formChapters],
  )
  const formSegmentOptions = useMemo(
    () => formSegments.map((item) => ({ value: item.id, label: getSegmentOptionLabel(item) })),
    [formSegments],
  )
  const timePrecisionOptions = useMemo(
    () => worldRules.timelineConfig.precisionOptions.map((item) => ({ value: item, label: item })),
    [worldRules.timelineConfig.precisionOptions],
  )
  const statusOptions = useMemo(
    () => [
      { value: 'all', label: TIMELINE_TEXT.statusAll },
      ...Object.entries(TIMELINE_STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
    ],
    [],
  )
  const eventTypeOptions = useMemo(
    () => [{ value: 'all', label: TIMELINE_TEXT.typeAll }, ...filterOptions.eventTypes.map((item) => ({ value: item, label: item }))],
    [filterOptions.eventTypes],
  )

  const loadShared = useCallback(async () => {
    const [volumeRows, arcRows, nextFilters] = await Promise.all([
      window.electron.structure.listVolumes(novelId),
      window.electron.outline.getArcs(novelId),
      window.electron.timeline.getFilterOptions(novelId),
    ])

    setVolumes(volumeRows)
    setArcs(arcRows)
    setFilterOptions(nextFilters)
  }, [novelId])

  const searchCharacters = useCallback(async (value = '') => {
    const rows = await window.electron.character.search(novelId, value, 20)
    setCharacterOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId])

  const searchLocations = useCallback(async (value = '') => {
    const rows = await window.electron.map.searchNodes(novelId, value, 20)
    setLocationOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId])

  const searchItems = useCallback(async (value = '') => {
    const rows = await window.electron.item.search(novelId, value, 'instance', 20)
    setItemOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId])

  const hydrateOptions = useCallback(async (event?: TimelineEvent | null) => {
    const locationId = event?.locationMapId
    const characterIds = [
      ...parseNumberArray(event?.presentCharacterIdsJson),
      ...parseNumberArray(event?.affectedCharacterIdsJson),
    ]
    const itemIds = parseNumberArray(event?.linkedItemIdsJson)

    const [
      baseCharacters,
      baseLocations,
      baseItems,
      extraLocation,
      extraCharacters,
      extraItems,
    ] = await Promise.all([
      window.electron.character.search(novelId, '', 20),
      window.electron.map.searchNodes(novelId, '', 20),
      window.electron.item.search(novelId, '', 'instance', 20),
      locationId ? window.electron.map.getNode(locationId) : Promise.resolve(null),
      Promise.all(characterIds.map((id) => window.electron.character.get(id))),
      Promise.all(itemIds.map((id) => window.electron.item.get(id))),
    ])

    setCharacterOptions(mergeEntitiesById(baseCharacters, extraCharacters))
    setLocationOptions(mergeEntitiesById(baseLocations, [extraLocation]))
    setItemOptions(mergeEntitiesById(baseItems, extraItems))
  }, [novelId])

  const loadPartsFor = useCallback(async (volumeId?: number, target: 'filter' | 'form' = 'filter') => {
    if (!volumeId) {
      if (target === 'filter') {
        setFilterParts([])
      } else {
        setFormParts([])
      }
      return []
    }

    const result = await window.electron.structure.listPartsPage(volumeId, 1, 200)

    if (target === 'filter') {
      setFilterParts(result.items)
    } else {
      setFormParts(result.items)
    }

    return result.items
  }, [])

  const loadChaptersFor = useCallback(async (partId?: number, target: 'filter' | 'form' = 'filter') => {
    if (!partId) {
      if (target === 'filter') {
        setFilterChapters([])
      } else {
        setFormChapters([])
      }
      return []
    }

    const result = await window.electron.structure.listChaptersPage(partId, 1, 200)

    if (target === 'filter') {
      setFilterChapters(result.items)
    } else {
      setFormChapters(result.items)
    }

    return result.items
  }, [])

  const loadSegmentsFor = useCallback(async (chapterId?: number) => {
    if (!chapterId) {
      setFormSegments([])
      return []
    }

    const result = await window.electron.structure.listSegmentsPage(chapterId, 1, 200)
    setFormSegments(result.items)
    return result.items
  }, [])

  const loadEventDetail = useCallback(async (id: number) => {
    const row = await window.electron.timeline.get(id)
    setSelectedEvent(row)
    setSelectedId(row?.id || null)

    if (row) {
      setCreating(false)
      form.setFieldsValue(toTimelineFormValues(row, defaultMode, defaultPrecision, defaultType))

      if (row.volumeId) await loadPartsFor(row.volumeId, 'form')
      if (row.partId) await loadChaptersFor(row.partId, 'form')

      let segmentChapterId = row.chapterStartId || row.chapterEndId
      if (!segmentChapterId && row.segmentId) {
        const segment = await window.electron.structure.getSegment(row.segmentId)
        segmentChapterId = segment?.chapterId
      }

      await loadSegmentsFor(segmentChapterId)
      await hydrateOptions(row)
    } else {
      await hydrateOptions(null)
    }

    return row
  }, [defaultMode, defaultPrecision, defaultType, form, hydrateOptions, loadChaptersFor, loadPartsFor, loadSegmentsFor])

  const buildQuery = useCallback((pageValue = page): TimelineQueryInput => ({
    novelId,
    page: pageValue,
    pageSize: 100,
    sortBy: 'timeSortValue',
    sortDirection: 'asc',
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(typeFilter !== 'all' ? { eventType: typeFilter } : {}),
    ...(volumeFilter !== 'all' ? { volumeId: volumeFilter } : {}),
    ...(partFilter !== 'all' ? { partId: partFilter } : {}),
    ...(chapterFilter !== 'all' ? { chapterId: chapterFilter } : {}),
    ...(segmentFilter !== 'all' ? { segmentId: segmentFilter } : {}),
  }), [chapterFilter, novelId, page, partFilter, segmentFilter, statusFilter, typeFilter, volumeFilter])

  const buildStatsQuery = useCallback((query: TimelineQueryInput) => {
    const { page: _page, pageSize: _pageSize, ...rest } = query
    return rest
  }, [])

  const buildRouteQuery = useCallback((): TimelineQueryInput => ({
    ...buildQuery(1),
    ...(route.volumeId ? { volumeId: route.volumeId } : {}),
    ...(route.partId ? { partId: route.partId } : {}),
    ...(route.chapterId ? { chapterId: route.chapterId } : {}),
    ...(route.segmentId ? { segmentId: route.segmentId } : {}),
  }), [buildQuery, route.chapterId, route.partId, route.segmentId, route.volumeId])

  const refreshPage = useCallback(async (preferredId?: number | null, routeAction?: string | null) => {
    setLoading(true)

    try {
      const query = routeAction ? buildRouteQuery() : buildQuery(page)
      const [list, summary] = await Promise.all([
        window.electron.timeline.query(query),
        window.electron.timeline.getStats(buildStatsQuery(query)),
      ])

      setPageData(list)
      setStats(summary)

      if (routeAction === 'new') {
        const anchor = {
          volumeId: route.volumeId ?? (volumeFilter === 'all' ? undefined : volumeFilter),
          partId: route.partId ?? (partFilter === 'all' ? undefined : partFilter),
          chapterStartId: route.chapterId ?? (chapterFilter === 'all' ? undefined : chapterFilter),
          chapterEndId: route.chapterId ?? (chapterFilter === 'all' ? undefined : chapterFilter),
          segmentId: route.segmentId ?? (segmentFilter === 'all' ? undefined : segmentFilter),
        }

        setCreating(true)
        setSelectedId(null)
        setSelectedEvent(null)
        form.setFieldsValue(buildDefaultTimelineValues(defaultMode, defaultPrecision, defaultType, anchor, list.total + 1))

        if (anchor.volumeId) await loadPartsFor(anchor.volumeId, 'form')
        if (anchor.partId) await loadChaptersFor(anchor.partId, 'form')
        if (anchor.chapterStartId) await loadSegmentsFor(anchor.chapterStartId)

        await hydrateOptions(null)
        return
      }

      const nextId = preferredId ?? route.eventId ?? selectedId ?? list.items[0]?.id ?? null
      if (nextId) {
        await loadEventDetail(nextId)
      } else {
        setSelectedId(null)
        setSelectedEvent(null)
        setCreating(false)
        form.setFieldsValue(buildDefaultTimelineValues(defaultMode, defaultPrecision, defaultType, {}, list.total + 1))
        setFormParts([])
        setFormChapters([])
        setFormSegments([])
        await hydrateOptions(null)
      }
    } finally {
      setLoading(false)
    }
  }, [
    buildQuery,
    buildRouteQuery,
    buildStatsQuery,
    chapterFilter,
    defaultMode,
    defaultPrecision,
    defaultType,
    form,
    hydrateOptions,
    loadChaptersFor,
    loadEventDetail,
    loadPartsFor,
    loadSegmentsFor,
    page,
    partFilter,
    route.chapterId,
    route.eventId,
    route.partId,
    route.segmentId,
    route.volumeId,
    selectedId,
    segmentFilter,
    volumeFilter,
  ])

  useEffect(() => {
    void loadShared()
    void hydrateOptions(null)
    generateForm.setFieldsValue(getInitialGenerateValues())
  }, [generateForm, hydrateOptions, loadShared])

  useEffect(() => {
    const key = searchParams.toString()
    if (routeKeyRef.current === key) return

    routeKeyRef.current = key
    suppressRefreshRef.current = true
    setVolumeFilter(route.volumeId || 'all')
    setPartFilter(route.partId || 'all')
    setChapterFilter(route.chapterId || 'all')
    setSegmentFilter(route.segmentId || 'all')
    setPage(1)

    if (route.volumeId) void loadPartsFor(route.volumeId, 'filter')
    if (route.partId) void loadChaptersFor(route.partId, 'filter')
    if (route.chapterId) void loadSegmentsFor(route.chapterId)

    void refreshPage(undefined, route.action || '__route__')
  }, [
    loadChaptersFor,
    loadPartsFor,
    loadSegmentsFor,
    refreshPage,
    route.action,
    route.chapterId,
    route.partId,
    route.segmentId,
    route.volumeId,
    searchParams,
  ])

  useEffect(() => {
    if (!routeKeyRef.current) return
    if (suppressRefreshRef.current) {
      suppressRefreshRef.current = false
      return
    }

    void refreshPage()
  }, [page, statusFilter, typeFilter, volumeFilter, partFilter, chapterFilter, segmentFilter, refreshPage])

  useEffect(() => {
    if (volumeFilter === 'all') {
      setFilterParts([])
      setPartFilter('all')
      setFilterChapters([])
      setChapterFilter('all')
      setSegmentFilter('all')
      return
    }

    void loadPartsFor(volumeFilter, 'filter')
  }, [loadPartsFor, volumeFilter])

  useEffect(() => {
    if (partFilter === 'all') {
      setFilterChapters([])
      setChapterFilter('all')
      setSegmentFilter('all')
      return
    }

    void loadChaptersFor(partFilter, 'filter')
  }, [loadChaptersFor, partFilter])

  useEffect(() => {
    if (!watchedVolumeId) {
      setFormParts([])
      setFormChapters([])
      setFormSegments([])
      return
    }

    void loadPartsFor(watchedVolumeId, 'form')
  }, [loadPartsFor, watchedVolumeId])

  useEffect(() => {
    if (!watchedPartId) {
      setFormChapters([])
      setFormSegments([])
      return
    }

    void loadChaptersFor(watchedPartId, 'form')
  }, [loadChaptersFor, watchedPartId])

  useEffect(() => {
    const chapterId = watchedSegmentId
      ? segmentById.get(watchedSegmentId)?.chapterId
      : watchedChapterStartId || watchedChapterEndId

    if (!chapterId) {
      setFormSegments([])
      return
    }

    void loadSegmentsFor(chapterId)
  }, [loadSegmentsFor, segmentById, watchedChapterEndId, watchedChapterStartId, watchedSegmentId])

  const handleSelect = useCallback(async (event: TimelineEvent) => {
    await loadEventDetail(event.id)
  }, [loadEventDetail])

  const handleNew = useCallback(() => {
    setCreating(true)
    setSelectedId(null)
    setSelectedEvent(null)
    form.setFieldsValue(buildDefaultTimelineValues(
      defaultMode,
      defaultPrecision,
      defaultType,
      {
        volumeId: volumeFilter === 'all' ? undefined : volumeFilter,
        partId: partFilter === 'all' ? undefined : partFilter,
        chapterStartId: chapterFilter === 'all' ? undefined : chapterFilter,
        chapterEndId: chapterFilter === 'all' ? undefined : chapterFilter,
        segmentId: segmentFilter === 'all' ? undefined : segmentFilter,
      },
      pageData.total + 1,
    ))
    void hydrateOptions(null)
  }, [chapterFilter, defaultMode, defaultPrecision, defaultType, form, hydrateOptions, pageData.total, partFilter, segmentFilter, volumeFilter])

  const handleFormValuesChange = useCallback((changed: Partial<TimelineFormValues>, values: TimelineFormValues) => {
    if ('volumeId' in changed) {
      form.setFieldsValue({
        partId: undefined,
        chapterStartId: undefined,
        chapterEndId: undefined,
        segmentId: undefined,
      })
    }

    if ('partId' in changed) {
      if (changed.partId) {
        const part = partById.get(changed.partId)
        form.setFieldsValue({
          volumeId: part?.volumeId,
          chapterStartId: undefined,
          chapterEndId: undefined,
          segmentId: undefined,
        })
      } else {
        form.setFieldsValue({
          chapterStartId: undefined,
          chapterEndId: undefined,
          segmentId: undefined,
        })
      }
    }

    if ('chapterStartId' in changed && changed.chapterStartId) {
      const chapter = chapterById.get(changed.chapterStartId)
      form.setFieldsValue({
        volumeId: chapter?.volumeId,
        partId: chapter?.partId,
        segmentId: undefined,
      })
    }

    if ('chapterEndId' in changed && changed.chapterEndId && !values.chapterStartId) {
      const chapter = chapterById.get(changed.chapterEndId)
      form.setFieldsValue({
        volumeId: chapter?.volumeId,
        partId: chapter?.partId,
      })
    }

    if ('segmentId' in changed && changed.segmentId) {
      const segment = segmentById.get(changed.segmentId)
      if (segment) {
        const chapterId = segment.chapterId
        const chapter = chapterById.get(chapterId)
        form.setFieldsValue({
          volumeId: chapter?.volumeId,
          partId: chapter?.partId,
          chapterStartId: chapterId,
          chapterEndId: chapterId,
        })
      }
    }
  }, [chapterById, form, partById, segmentById])

  const handleSave = useCallback(async () => {
    const values = await form.validateFields()
    setSaving(true)

    try {
      if (selectedEvent?.id) {
        await window.electron.timeline.update(selectedEvent.id, serializeTimelineValues(values))
        await refreshPage(selectedEvent.id)
      } else {
        const nextId = await window.electron.timeline.create(novelId, serializeTimelineValues(values))
        await refreshPage(nextId)
      }

      setCreating(false)
      message.success(TIMELINE_TEXT.saveSuccess)
    } catch (error) {
      console.error(error)
      message.error(TIMELINE_TEXT.saveFailed)
    } finally {
      setSaving(false)
    }
  }, [form, novelId, refreshPage, selectedEvent?.id])

  const handleDelete = useCallback(() => {
    if (!selectedEvent?.id) return

    Modal.confirm({
      title: `${TIMELINE_TEXT.deleteConfirmTitlePrefix}${selectedEvent.eventTitle}${TIMELINE_TEXT.deleteConfirmTitleSuffix}`,
      content: TIMELINE_TEXT.deleteConfirmContent,
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.timeline.delete(selectedEvent.id)
        await refreshPage()
        message.success(TIMELINE_TEXT.deleteSuccess)
      },
    })
  }, [refreshPage, selectedEvent])

  const handleGenerate = useCallback(async () => {
    const values = generateForm.getFieldsValue()
    setGenerating(true)

    try {
      await window.electron.timeline.generate(novelId, {
        count: values.count || 12,
        batchSize: values.batchSize || 4,
        focus: values.focus || TIMELINE_TEXT.generateFocusDefault,
      })
      setGenerateOpen(false)
      await refreshPage()
      message.success(TIMELINE_TEXT.generateSuccess)
    } catch (error) {
      console.error(error)
      message.error(TIMELINE_TEXT.generateFailed)
    } finally {
      setGenerating(false)
    }
  }, [generateForm, novelId, refreshPage])

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: TIMELINE_TEXT.clearConfirmTitle,
      content: TIMELINE_TEXT.clearConfirmContent,
      okType: 'danger',
      okText: TIMELINE_TEXT.clearConfirmOk,
      onOk: async () => {
        await window.electron.timeline.clear(novelId)
        form.resetFields()
        setSelectedId(null)
        setSelectedEvent(null)
        setCreating(false)
        await refreshPage(null)
        message.success(TIMELINE_TEXT.clearSuccess)
      },
    })
  }, [form, novelId, refreshPage])

  const openSelectedEventInStructure = useCallback(() => {
    if (!selectedEvent) return
    navigate(`/novels/${novelId}/structure?${buildStructureJumpParams(selectedEvent).toString()}`)
  }, [navigate, novelId, selectedEvent])

  const getStructureTagsForEvent = useCallback(
    (event: TimelineEvent) => buildStructureTags(event, structureLookups),
    [structureLookups],
  )

  return {
    arcs,
    chapterFilter,
    characterOptions,
    creating,
    currentNovel,
    defaultMode,
    defaultPrecision,
    defaultType,
    eventTypeOptions,
    filterChapterOptions,
    filterOptions,
    filterPartOptions,
    filterSummary,
    filterVolumeOptions,
    form,
    formVolumeOptions,
    formChapterOptions,
    formChapters,
    formPartOptions,
    formParts,
    formSegmentOptions,
    formSegments,
    generateForm,
    generateOpen,
    generating,
    getStructureTagsForEvent,
    handleClear,
    handleDelete,
    handleFormValuesChange,
    handleGenerate,
    handleNew,
    handleSave,
    handleSelect,
    itemOptions,
    laneItems,
    loading,
    locationOptions,
    modeLabel,
    openSelectedEventInStructure,
    page,
    pageData,
    partFilter,
    route,
    saving,
    searchCharacters,
    searchItems,
    searchLocations,
    segmentFilter,
    selectedEvent,
    selectedId,
    selectedTimeMode,
    setChapterFilter,
    setGenerateOpen,
    setPage,
    setPartFilter,
    setSegmentFilter,
    setStatusFilter,
    setTypeFilter,
    setVolumeFilter,
    stats,
    statusFilter,
    statusOptions,
    structureFilterSummary,
    timeModeHint,
    timePrecisionOptions,
    typeFilter,
    volumes,
    volumeFilter,
    worldRules,
    refreshPage,
  }
}
