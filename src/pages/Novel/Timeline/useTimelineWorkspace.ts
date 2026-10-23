import { useAsyncSnapshot } from '@/hooks/useAsyncSnapshot'
import { useScopedState } from '@/hooks/useScopedState'
import { Form, Modal, message } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedSearch } from '../../../hooks/useDebouncedSearch'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type {
  Character,
  MapNodeSummary,
  PagedResult,
  StoryArc,
  StoryItem,
  StoryStructureVolumeSummary,
  TimelineEvent,
  TimelineFilterOptions,
  TimelineQueryInput,
  TimelineStats,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { parseWorldRulesJson } from '../../../shared/genre-system'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { getTimelineGenerationPreset } from '../../../shared/creation-tools'
import {
  EMPTY_WORKFLOW_STATS,
  getWorkflowBlockers,
  loadWorkflowStats,
  type WorkflowStats,
} from '../workflow'
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

export function useTimelineWorkspace(
  novelId: number,
  options?: {
    onCleared?: () => void
  },
) {
  const onCleared = options?.onCleared
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const route = useMemo(() => parseTimelineRoute(searchParams), [searchParams])
  const routeKeyRef = useRef<string | null>(null)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const refreshRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const selectedIdRef = useRef<number | null>(null)
  const creatingRef = useRef(false)
  const saveActionRef = useRef(false)
  const dirtyRef = useRef(false)

  const currentNovel = useNovelStore((state) => state.currentNovel)
  const [form] = Form.useForm<TimelineFormValues>()
  const [generateForm] = Form.useForm<TimelineGenerateValues>()

  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  const [pageData, setPageData] = useState<PagedResult<TimelineEvent>>(createEmptyPage(100))
  const [stats, setStats] = useState<TimelineStats>(EMPTY_TIMELINE_STATS)
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [filterOptions, setFilterOptions] = useState<TimelineFilterOptions>(EMPTY_FILTER_OPTIONS)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [lastSelectedListId, setLastSelectedListId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const [statusFilter, setStatusFilter] = useState<TimelineStatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [keywordInput, setKeyword, keyword] = useDebouncedSearch('')
  const routeKey = JSON.stringify([route.volumeId, route.partId, route.chapterId, route.segmentId, route.eventId, route.action])
  const routeFilters = { volume: route.volumeId || 'all', part: route.partId || 'all', chapter: route.chapterId || 'all', segment: route.segmentId || 'all' } as const
  const [filters, setFilters] = useState<{ source: string; volume: NumericFilter; part: NumericFilter; chapter: NumericFilter; segment: NumericFilter }>({ source: routeKey, ...routeFilters })
  if (filters.source !== routeKey) setFilters({ source: routeKey, ...routeFilters })
  const { volume: volumeFilter, part: partFilter, chapter: chapterFilter, segment: segmentFilter } = filters
  const setVolumeFilter = useCallback((volume: NumericFilter) => setFilters(current => ({ ...current, volume, part: 'all', chapter: 'all', segment: 'all' })), [])
  const setPartFilter = useCallback((part: NumericFilter) => setFilters(current => ({ ...current, part, chapter: 'all', segment: 'all' })), [])
  const setChapterFilter = useCallback((chapter: NumericFilter) => setFilters(current => ({ ...current, chapter, segment: 'all' })), [])
  const setSegmentFilter = useCallback((segment: NumericFilter) => setFilters(current => ({ ...current, segment })), [])
  const [page, setPage] = useScopedState(JSON.stringify([keyword, routeKey]), 1)
  const [volumes, setVolumes] = useState<StoryStructureVolumeSummary[]>([])

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
  const timelineGenerationPreset = useMemo(() => getTimelineGenerationPreset(currentNovel?.genreName, {
    launchMode: currentNovel?.launchMode,
    targetWords: currentNovel?.targetWords,
    settingsJson: currentNovel?.settingsJson,
    mapDepth: worldRules.mapBlueprint.levels.length,
    factionCount: worldRules.factionSystem.length,
    speciesCount: worldRules.speciesSystem.length,
    powerSystemCount: worldRules.powerSystems.length,
  }), [
    currentNovel?.genreName,
    currentNovel?.launchMode,
    currentNovel?.settingsJson,
    currentNovel?.targetWords,
    worldRules.factionSystem.length,
    worldRules.mapBlueprint.levels.length,
    worldRules.powerSystems.length,
    worldRules.speciesSystem.length,
  ])

  const watchedVolumeId = Form.useWatch('volumeId', form)
  const watchedPartId = Form.useWatch('partId', form)
  const watchedChapterStartId = Form.useWatch('chapterStartId', form)
  const watchedChapterEndId = Form.useWatch('chapterEndId', form)
  const watchedSegmentId = Form.useWatch('segmentId', form)
  const selectedTimeMode = Form.useWatch('timeMode', form) || defaultMode

  const readFilterParts = useCallback(async () => volumeFilter === 'all' ? [] : (await window.electron.structure.listPartsPage(volumeFilter, 1, 200)).items, [volumeFilter])
  const readFilterChapters = useCallback(async () => partFilter === 'all' ? [] : (await window.electron.structure.listChaptersPage(partFilter, 1, 200)).items, [partFilter])
  const readFormParts = useCallback(async () => !watchedVolumeId ? [] : (await window.electron.structure.listPartsPage(watchedVolumeId, 1, 200)).items, [watchedVolumeId])
  const readFormChapters = useCallback(async () => !watchedPartId ? [] : (await window.electron.structure.listChaptersPage(watchedPartId, 1, 200)).items, [watchedPartId])
  // Resolve the segment directly. Deriving its parent from the segment list
  // makes that list's own read depend on its previous result.
  const readSegment = useCallback(async () => watchedSegmentId ? window.electron.structure.getSegment(watchedSegmentId) : null, [watchedSegmentId])
  const segmentSnapshot = useAsyncSnapshot(readSegment)
  const segmentChapterId = watchedSegmentId ? segmentSnapshot.data?.chapterId : watchedChapterStartId || watchedChapterEndId
  const readFormSegments = useCallback(async () => segmentChapterId ? (await window.electron.structure.listSegmentsPage(segmentChapterId, 1, 200)).items : [], [segmentChapterId])
  const filterPartsSnapshot = useAsyncSnapshot(readFilterParts)
  const filterChaptersSnapshot = useAsyncSnapshot(readFilterChapters)
  const formPartsSnapshot = useAsyncSnapshot(readFormParts)
  const formChaptersSnapshot = useAsyncSnapshot(readFormChapters)
  const formSegmentsSnapshot = useAsyncSnapshot(readFormSegments)
  const filterParts = useMemo(() => filterPartsSnapshot.data ?? [], [filterPartsSnapshot.data])
  const filterChapters = useMemo(() => filterChaptersSnapshot.data ?? [], [filterChaptersSnapshot.data])
  const formParts = useMemo(() => formPartsSnapshot.data ?? [], [formPartsSnapshot.data])
  const formChapters = useMemo(() => formChaptersSnapshot.data ?? [], [formChaptersSnapshot.data])
  const formSegments = useMemo(() => formSegmentsSnapshot.data ?? [], [formSegmentsSnapshot.data])
  const optionsError = filterPartsSnapshot.error || filterChaptersSnapshot.error || formPartsSnapshot.error || formChaptersSnapshot.error || segmentSnapshot.error || formSegmentsSnapshot.error
  useEffect(() => {
    if (!optionsError) return
    console.error(optionsError)
    message.error(getErrorMessage(optionsError, 'common.loadFailed'))
  }, [optionsError])

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
    () => `${TIMELINE_TEXT.listSummaryPrefix}${pageData.total}${TIMELINE_TEXT.listSummaryMiddle}${pageData.items.length}${TIMELINE_TEXT.listSummarySuffix}${keyword.trim() ? ` · 搜索“${keyword.trim()}”` : ''}`,
    [keyword, pageData.items.length, pageData.total],
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
  const generationBlockers = useMemo(
    () => getWorkflowBlockers('timeline', currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )

  const searchCharacters = useCallback(async (value = '') => {
    const rows = await window.electron.character.search(novelId, value, 20)
    setCharacterOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId, setCharacterOptions])

  const searchLocations = useCallback(async (value = '') => {
    const rows = await window.electron.map.searchNodes(novelId, value, 20)
    setLocationOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId, setLocationOptions])

  const searchItems = useCallback(async (value = '') => {
    const rows = await window.electron.item.search(novelId, value, 'instance', 20)
    setItemOptions((prev) => mergeEntitiesById(rows, prev))
  }, [novelId, setItemOptions])

  const hydrateOptions = useCallback(async (
    event?: TimelineEvent | null,
    isCurrent: () => boolean = () => true,
  ) => {
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

    if (!isCurrent()) return
    setCharacterOptions(mergeEntitiesById(baseCharacters, extraCharacters))
    setLocationOptions(mergeEntitiesById(baseLocations, [extraLocation]))
    setItemOptions(mergeEntitiesById(baseItems, extraItems))
  }, [novelId, setCharacterOptions, setLocationOptions, setItemOptions])

  const loadEventDetail = useCallback(async (id: number) => {
    const requestId = ++detailRequestRef.current
    const sameSelection = selectedIdRef.current === id
    const keepDraft = dirtyRef.current && sameSelection
    selectedIdRef.current = id
    const isCurrent = () => detailRequestRef.current === requestId
    const row = await window.electron.timeline.get(id)
    if (!isCurrent()) return null
    setSelectedEvent(row)
    setSelectedId(row?.id || null)

    if (row) {
      selectedIdRef.current = row.id
      creatingRef.current = false
      setCreating(false)
      if (!keepDraft && !(sameSelection && dirtyRef.current)) {
        form.setFieldsValue(toTimelineFormValues(row, defaultMode, defaultPrecision, defaultType))
      }

      await hydrateOptions(row, isCurrent)
    } else {
      selectedIdRef.current = null
      await hydrateOptions(null, isCurrent)
    }

    return isCurrent() ? row : null
  }, [defaultMode, defaultPrecision, defaultType, form, hydrateOptions])

  const buildQuery = useCallback((pageValue: number): TimelineQueryInput => ({
    novelId,
    page: pageValue,
    pageSize: 100,
    sortBy: 'timeSortValue',
    sortDirection: 'asc',
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(typeFilter !== 'all' ? { eventType: typeFilter } : {}),
    ...(volumeFilter !== 'all' ? { volumeId: volumeFilter } : {}),
    ...(partFilter !== 'all' ? { partId: partFilter } : {}),
    ...(chapterFilter !== 'all' ? { chapterId: chapterFilter } : {}),
    ...(segmentFilter !== 'all' ? { segmentId: segmentFilter } : {}),
  }), [chapterFilter, keyword, novelId, partFilter, segmentFilter, statusFilter, typeFilter, volumeFilter])

  const buildStatsQuery = useCallback((query: TimelineQueryInput) => {
    const { page: _page, pageSize: _pageSize, ...rest } = query
    return rest
  }, [])

  const buildRouteQuery = useCallback((): TimelineQueryInput => ({
    novelId,
    page: 1,
    pageSize: 100,
    sortBy: 'timeSortValue',
    sortDirection: 'asc',
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(typeFilter !== 'all' ? { eventType: typeFilter } : {}),
    ...(route.volumeId ? { volumeId: route.volumeId } : {}),
    ...(route.partId ? { partId: route.partId } : {}),
    ...(route.chapterId ? { chapterId: route.chapterId } : {}),
    ...(route.segmentId ? { segmentId: route.segmentId } : {}),
  }), [novelId, route.chapterId, route.partId, route.segmentId, route.volumeId, statusFilter, typeFilter])

  const readPage = useCallback(async (query: TimelineQueryInput) => {
    const [list, summary] = await Promise.all([
      window.electron.timeline.query(query),
      window.electron.timeline.getStats(buildStatsQuery(query)),
    ])
    return { list, summary }
  }, [buildStatsQuery])
  const applyPage = useCallback(async (
    { list, summary }: Awaited<ReturnType<typeof readPage>>,
    preferredId: number | null | undefined,
    routeAction: string | null | undefined,
    detailRequestAtStart: number,
    isCurrent: () => boolean,
  ) => {
    if (!isCurrent()) return
    setPageData(list)
    setStats(summary)
    setLoadedOnce(true)
    if (detailRequestRef.current !== detailRequestAtStart) return

    if (routeAction === 'new') {
      detailRequestRef.current += 1
      selectedIdRef.current = null
      creatingRef.current = true
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

      await hydrateOptions(null, isCurrent)
      return
    }

    const hasExplicitId = typeof preferredId === 'number' || typeof route.eventId === 'number'
    const explicitId = typeof preferredId === 'number' ? preferredId : route.eventId
    if (!hasExplicitId && creatingRef.current) return
    if (!hasExplicitId && dirtyRef.current) return
    const currentSelectedId = selectedIdRef.current
    const nextId = explicitId
      ?? (list.items.some((item) => item.id === currentSelectedId) ? currentSelectedId : null)
      ?? list.items[0]?.id
      ?? null
    if (nextId) {
      await loadEventDetail(nextId)
    } else {
      detailRequestRef.current += 1
      selectedIdRef.current = null
      creatingRef.current = false
      setSelectedId(null)
      setSelectedEvent(null)
      setCreating(false)
      form.setFieldsValue(buildDefaultTimelineValues(defaultMode, defaultPrecision, defaultType, {}, list.total + 1))
      await hydrateOptions(null, isCurrent)
    }
  }, [
    chapterFilter,
    defaultMode,
    defaultPrecision,
    defaultType,
    form,
    hydrateOptions,
    loadEventDetail,
    partFilter,
    route.chapterId,
    route.eventId,
    route.partId,
    route.segmentId,
    route.volumeId,
    segmentFilter,
    volumeFilter,
  ])
  const query = useMemo(() => buildQuery(page), [buildQuery, page])
  const queryKey = JSON.stringify([query, routeKey])
  const [loading, setLoading] = useScopedState(queryKey, !loadedOnce)
  const [refreshing, setRefreshing] = useScopedState(queryKey, loadedOnce)
  const refreshPage = useCallback(async (preferredId?: number | null, routeAction?: string | null, showLoading = false) => {
    const requestId = ++refreshRequestRef.current
    const detailRequestAtStart = detailRequestRef.current
    const isCurrent = () => refreshRequestRef.current === requestId
    if (showLoading || !loadedOnce) setLoading(true)
    else setRefreshing(true)
    try {
      await applyPage(await readPage(routeAction ? buildRouteQuery() : query), preferredId, routeAction, detailRequestAtStart, isCurrent)
    } catch (error) {
      if (!isCurrent()) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (isCurrent()) { setLoading(false); setRefreshing(false) }
    }
  }, [applyPage, buildRouteQuery, loadedOnce, query, readPage, setLoading, setRefreshing])

  useEffect(() => {
    let active = true
    void Promise.all([
      window.electron.structure.listVolumes(novelId), window.electron.outline.getArcs(novelId),
      window.electron.timeline.getFilterOptions(novelId), loadWorkflowStats(novelId),
      window.electron.character.search(novelId, '', 20), window.electron.map.searchNodes(novelId, '', 20), window.electron.item.search(novelId, '', 'instance', 20),
    ]).then(([volumeRows, arcRows, nextFilters, nextStats, characters, locations, items]) => {
      if (!active) return
      setVolumes(volumeRows); setArcs(arcRows); setFilterOptions(nextFilters); setWorkflowStats(nextStats)
      setCharacterOptions(current => mergeEntitiesById(characters, current))
      setLocationOptions(current => mergeEntitiesById(locations, current))
      setItemOptions(current => mergeEntitiesById(items, current))
    }).catch(error => {
      if (!active) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
    return () => { active = false }
  }, [novelId])
  useEffect(() => { generateForm.setFieldsValue(getInitialGenerateValues(timelineGenerationPreset)) }, [generateForm, timelineGenerationPreset])
  useEffect(() => {
    const routeAction = routeKeyRef.current !== routeKey ? route.action || '__route__' : undefined
    const requestId = ++refreshRequestRef.current
    const detailRequestAtStart = detailRequestRef.current
    const isCurrent = () => refreshRequestRef.current === requestId
    void readPage(query).then(result => {
      if (!isCurrent()) return
      routeKeyRef.current = routeKey
      return applyPage(result, undefined, routeAction, detailRequestAtStart, isCurrent)
    }).catch(error => {
      if (!isCurrent()) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    }).finally(() => { if (isCurrent()) { setLoading(false); setRefreshing(false) } })
    return () => { refreshRequestRef.current += 1 }
  }, [applyPage, query, readPage, route.action, routeKey, setLoading, setRefreshing])

  const clearSelection = useCallback(() => {
    setSelectedIds([])
    setLastSelectedListId(null)
  }, [])

  const handleSelect = useCallback(async (
    event: TimelineEvent,
    nativeEvent?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean },
  ) => {
    const withMeta = Boolean(nativeEvent && (nativeEvent.metaKey || nativeEvent.ctrlKey))
    const withShift = Boolean(nativeEvent && nativeEvent.shiftKey)

    if (withShift && lastSelectedListId) {
      const startIndex = pageData.items.findIndex((item) => item.id === lastSelectedListId)
      const endIndex = pageData.items.findIndex((item) => item.id === event.id)
      if (startIndex >= 0 && endIndex >= 0) {
        const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
        const rangeIds = pageData.items.slice(from, to + 1).map((item) => item.id)
        setSelectedIds((current) => [...new Set([...current, ...rangeIds])])
        setLastSelectedListId(event.id)
        return
      }
    }

    if (withMeta) {
      setSelectedIds((current) => current.includes(event.id)
        ? current.filter((item) => item !== event.id)
        : [...current, event.id])
      setLastSelectedListId(event.id)
      return
    }

    if (dirtyRef.current && selectedIdRef.current && selectedIdRef.current !== event.id) {
      Modal.confirm({
        title: '当前事件还有未保存修改',
        content: '切换后未保存内容会丢失。',
        okText: '放弃并切换',
        okButtonProps: { danger: true },
        cancelText: '留下继续编辑',
        onOk: async () => {
          dirtyRef.current = false
          setHasUnsavedChanges(false)
          setSelectedIds([event.id])
          setLastSelectedListId(event.id)
          await loadEventDetail(event.id)
        },
      })
      return
    }
    setSelectedIds([event.id])
    setLastSelectedListId(event.id)
    await loadEventDetail(event.id)
  }, [lastSelectedListId, loadEventDetail, pageData.items])

  const handleNew = useCallback(() => {
    const startCreate = () => {
      dirtyRef.current = false
      setHasUnsavedChanges(false)
      detailRequestRef.current += 1
      selectedIdRef.current = null
      creatingRef.current = true
      setCreating(true)
      setSelectedId(null)
      setSelectedEvent(null)
      clearSelection()
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
    }
    if (dirtyRef.current) {
      Modal.confirm({
        title: '当前事件还有未保存修改',
        content: '新建前未保存内容会丢失。',
        okText: '放弃并新建',
        okButtonProps: { danger: true },
        cancelText: '留下继续编辑',
        onOk: () => startCreate(),
      })
      return
    }
    startCreate()
  }, [chapterFilter, clearSelection, defaultMode, defaultPrecision, defaultType, form, hydrateOptions, pageData.total, partFilter, segmentFilter, volumeFilter])

  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  useEffect(() => { creatingRef.current = creating }, [creating])

  const handleFormValuesChange = useCallback((changed: Partial<TimelineFormValues>, values: TimelineFormValues) => {
    dirtyRef.current = true
    setHasUnsavedChanges(true)
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
    if (saveActionRef.current) return false
    saveActionRef.current = true
    const selectionAtStart = selectedIdRef.current
    const detailAtStart = detailRequestRef.current
    try {
      const values = await form.validateFields().catch(() => null)
      if (!values || detailRequestRef.current !== detailAtStart) return false
      setSaving(true)
      let savedId: number
      if (selectionAtStart) {
        await window.electron.timeline.update(selectionAtStart, serializeTimelineValues(values))
        savedId = selectionAtStart
      } else {
        savedId = await window.electron.timeline.create(novelId, serializeTimelineValues(values))
      }
      if (selectedIdRef.current === selectionAtStart && detailRequestRef.current === detailAtStart) {
        // A newly persisted draft now owns this ID. Detail refresh must treat
        // input typed during the save as edits of that same event.
        selectedIdRef.current = savedId
        setSelectedId(savedId)
        creatingRef.current = false
        setCreating(false)
        const current = form.getFieldsValue(true)
        const fields = Object.keys(values) as Array<keyof TimelineFormValues>
        dirtyRef.current = !fields.every(field => JSON.stringify(current[field]) === JSON.stringify(values[field]))
        setHasUnsavedChanges(dirtyRef.current)
        await refreshPage(savedId)
      }
      message.success(getUserFacingMessage('timeline.saved'))
      return true
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'timeline.saveFailed'))
      return false
    } finally {
      saveActionRef.current = false
      setSaving(false)
    }
  }, [form, novelId, refreshPage])

  const handleDelete = useCallback(() => {
    if (!selectedEvent?.id) return

    Modal.confirm({
      title: `${TIMELINE_TEXT.deleteConfirmTitlePrefix}${selectedEvent.eventTitle}${TIMELINE_TEXT.deleteConfirmTitleSuffix}`,
      content: TIMELINE_TEXT.deleteConfirmContent,
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.timeline.delete(selectedEvent.id)
        await refreshPage()
        message.success(getUserFacingMessage('timeline.deleted'))
      },
    })
  }, [refreshPage, selectedEvent])

  const handleRegenerate = useCallback(async () => {
    if (!selectedEvent?.id) return
    setRegenerating(true)
    try {
      const regenerated = await window.electron.timeline.regenerate(selectedEvent.id)
      await refreshPage(regenerated?.id || selectedEvent.id)
      message.success(getUserFacingMessage('timeline.regenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'timeline.generateFailed'))
    } finally {
      setRegenerating(false)
    }
  }, [refreshPage, selectedEvent])

  const ensureGenerationAllowed = useCallback(async () => {
    const nextWorkflowStats = await loadWorkflowStats(novelId)
    setWorkflowStats(nextWorkflowStats)
    const blockers = getWorkflowBlockers('timeline', currentNovel, nextWorkflowStats)
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return false
    }
    return true
  }, [currentNovel, novelId])

  const handleGenerate = useCallback(async () => {
    if (!await ensureGenerationAllowed()) return

    const values = generateForm.getFieldsValue()
    setGenerating(true)

    try {
      await window.electron.timeline.generate(novelId, {
        count: values.count || timelineGenerationPreset.count,
        batchSize: values.batchSize || timelineGenerationPreset.batchSize,
        focus: values.focus || timelineGenerationPreset.focus || TIMELINE_TEXT.generateFocusDefault,
      })
      setGenerateOpen(false)
      await refreshPage()
      message.success(getUserFacingMessage('timeline.generated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'timeline.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }, [ensureGenerationAllowed, generateForm, novelId, refreshPage, timelineGenerationPreset])

  const openGenerateModal = useCallback(async () => {
    if (!await ensureGenerationAllowed()) return
    setGenerateOpen(true)
  }, [ensureGenerationAllowed])

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: TIMELINE_TEXT.clearConfirmTitle,
      content: TIMELINE_TEXT.clearConfirmContent,
      okType: 'danger',
      okText: TIMELINE_TEXT.clearConfirmOk,
      onOk: async () => {
        await window.electron.timeline.clear(novelId)
        detailRequestRef.current += 1
        selectedIdRef.current = null
        creatingRef.current = false
        dirtyRef.current = false
        setHasUnsavedChanges(false)
        form.resetFields()
        clearSelection()
        setSelectedId(null)
        setSelectedEvent(null)
        setCreating(false)
        await refreshPage(null)
        onCleared?.()
        message.success(getUserFacingMessage('timeline.cleared'))
      },
    })
  }, [clearSelection, form, novelId, onCleared, refreshPage])

  const openSelectedEventInStructure = useCallback(() => {
    if (!selectedEvent) return
    navigate(buildWorkspaceRoute(novelId, `structure?${buildStructureJumpParams(selectedEvent).toString()}`))
  }, [navigate, novelId, selectedEvent])

  const getStructureTagsForEvent = useCallback(
    (event: TimelineEvent) => buildStructureTags(event, structureLookups),
    [structureLookups],
  )

  return {
    arcs,
    chapterFilter,
    characterOptions,
    clearSelection,
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
    generationBlockers,
    generateOpen,
    generating,
    regenerating,
    hasUnsavedChanges,
    getStructureTagsForEvent,
    handleClear,
    handleDelete,
    handleFormValuesChange,
    handleGenerate,
    handleNew,
    handleRegenerate,
    handleSave,
    handleSelect,
    itemOptions,
    keyword,
    keywordInput,
    laneItems,
    loading,
    locationOptions,
    modeLabel,
    openSelectedEventInStructure,
    openGenerateModal,
    page,
    pageData,
    partFilter,
    refreshing,
    route,
    saving,
    searchCharacters,
    searchItems,
    searchLocations,
    segmentFilter,
    selectedEvent,
    selectedId,
    selectedIds,
    selectedTimeMode,
    setChapterFilter,
    setGenerateOpen,
    setKeyword,
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
    timelineGenerationPreset,
    refreshPage,
  }
}
