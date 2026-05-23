import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Pagination, Select, Space, Spin, Tabs, Tag, message } from 'antd'
import {
  AppstoreAddOutlined,
  DeleteOutlined,
  InboxOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import VirtualList from 'rc-virtual-list'
import { useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import AIGenerateButton from '../../../components/AIGenerateButton'
import type {
  Character,
  MapNodeSummary,
  PagedResult,
  StoryArc,
  StoryItem,
  StoryItemLinkRecommendationResult,
  StoryItemDetailContext,
  StoryItemFilterOptions,
  StoryItemQueryInput,
  StoryItemStats,
  TimelineEvent,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, normalizeStringArray, parseDraftJson } from '../shared/ai-draft'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
  WorkspaceTip,
} from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import { EMPTY_WORKFLOW_STATS, getWorkflowBlockers, loadWorkflowStats, type WorkflowStats } from '../workflow'
import { getItemGenerationProfile } from '../../../shared/creation-tools'

interface Props {
  novelId: number
}

interface ItemFormValues {
  itemKind: 'template' | 'instance'
  parentItemId?: number
  itemName: string
  category?: string
  subType?: string
  rarity?: string
  ownerCharacterId?: number
  locationMapId?: number
  status: StoryItem['status']
  summary?: string
  acquisitionMethod?: string
  usageMethod?: string
  cost?: string
  risk?: string
  plotFunction?: string
  appearance?: string
  factionHint?: string
  linkedCharacterIds: number[]
  linkedTimelineEventIds: number[]
  tags: string[]
}

interface GenerateFormValues {
  templateOnly: boolean
  refreshTemplates: boolean
  count: number
  batchSize: number
  focus?: string
}

const PAGE_SIZE = 24
const EMPTY_PAGE: PagedResult<StoryItem> = { items: [], page: 1, pageSize: PAGE_SIZE, total: 0, hasMore: false }
const EMPTY_STATS: StoryItemStats = {
  total: 0,
  confirmedCount: 0,
  draftCount: 0,
  templateCount: 0,
  instanceCount: 0,
  linkedEventCount: 0,
  categoryCount: 0,
}
const EMPTY_FILTERS: StoryItemFilterOptions = { categories: [], rarities: [] }
const EMPTY_DETAIL: StoryItemDetailContext = {
  item: null,
  parentTemplate: null,
  ownerCharacter: null,
  location: null,
  relatedCharacters: [],
  relatedEvents: [],
  relatedArcs: [],
  relatedLocations: [],
  relatedSegments: [],
  derivedInstances: [],
  siblingInstances: [],
  sourceContexts: [],
}

const ITEM_KIND_OPTIONS = [
  { value: 'template', label: '模板' },
  { value: 'instance', label: '实例' },
] as const

const STATUS_OPTIONS = [
  { value: 'available', label: '可用' },
  { value: 'hidden', label: '隐藏' },
  { value: 'consumed', label: '已消耗' },
  { value: 'destroyed', label: '已损毁' },
] as const

const ITEM_KIND_META: Record<StoryItem['itemKind'], { label: string; color: string }> = {
  template: { label: '模板', color: 'blue' },
  instance: { label: '实例', color: 'processing' },
}

const STATUS_META: Record<StoryItem['status'], { label: string; color: string }> = {
  available: { label: '可用', color: 'green' },
  hidden: { label: '隐藏', color: 'default' },
  consumed: { label: '已消耗', color: 'gold' },
  destroyed: { label: '已损毁', color: 'red' },
}

const RARITY_OPTIONS = ['常见', '稀有', '核心', '禁用级']

const OverviewTab = React.lazy(() => import('./tabs/OverviewTab'))
const DetailsTab = React.lazy(() => import('./tabs/DetailsTab'))
const ConnectionsTab = React.lazy(() => import('./tabs/ConnectionsTab'))

function parseNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.map((item) => (typeof item === 'number' ? item : Number(item))).filter((item) => Number.isFinite(item))
      : []
  } catch {
    return []
  }
}

function parseStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)
      : []
  } catch {
    return []
  }
}

function mergeById<T extends { id: number }>(base: T[], extras: Array<T | null | undefined>) {
  const map = new Map(base.map((item) => [item.id, item]))
  extras.forEach((item) => {
    if (item) map.set(item.id, item)
  })
  return [...map.values()]
}

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function emptyValues(kind: StoryItem['itemKind']): ItemFormValues {
  return {
    itemKind: kind,
    parentItemId: undefined,
    itemName: '',
    category: '',
    subType: '',
    rarity: '',
    ownerCharacterId: undefined,
    locationMapId: undefined,
    status: 'available',
    summary: '',
    acquisitionMethod: '',
    usageMethod: '',
    cost: '',
    risk: '',
    plotFunction: '',
    appearance: '',
    factionHint: '',
    linkedCharacterIds: [],
    linkedTimelineEventIds: [],
    tags: [],
  }
}

function toFormValues(item: StoryItem): ItemFormValues {
  return {
    itemKind: item.itemKind,
    parentItemId: item.parentItemId,
    itemName: item.itemName,
    category: item.category || '',
    subType: item.subType || '',
    rarity: item.rarity || '',
    ownerCharacterId: item.ownerCharacterId,
    locationMapId: item.locationMapId,
    status: item.status,
    summary: item.summary || '',
    acquisitionMethod: item.acquisitionMethod || '',
    usageMethod: item.usageMethod || '',
    cost: item.cost || '',
    risk: item.risk || '',
    plotFunction: item.plotFunction || '',
    appearance: item.appearance || '',
    factionHint: item.factionHint || '',
    linkedCharacterIds: parseNumberArray(item.linkedCharacterIdsJson),
    linkedTimelineEventIds: parseNumberArray(item.linkedTimelineEventIdsJson),
    tags: parseStringArray(item.tagsJson),
  }
}

function serialize(values: ItemFormValues): Partial<StoryItem> {
  return {
    recordStatus: 'confirmed',
    itemKind: values.itemKind,
    parentItemId: values.itemKind === 'instance' ? values.parentItemId : undefined,
    itemName: values.itemName.trim(),
    category: values.category?.trim() || '',
    subType: values.subType?.trim() || '',
    rarity: values.rarity?.trim() || '',
    ownerCharacterId: values.ownerCharacterId,
    locationMapId: values.locationMapId,
    status: values.status,
    summary: values.summary?.trim() || '',
    acquisitionMethod: values.acquisitionMethod?.trim() || '',
    usageMethod: values.usageMethod?.trim() || '',
    cost: values.cost?.trim() || '',
    risk: values.risk?.trim() || '',
    plotFunction: values.plotFunction?.trim() || '',
    appearance: values.appearance?.trim() || '',
    factionHint: values.factionHint?.trim() || '',
    linkedCharacterIdsJson: JSON.stringify(values.linkedCharacterIds || []),
    linkedTimelineEventIdsJson: JSON.stringify(values.linkedTimelineEventIds || []),
    tagsJson: JSON.stringify((values.tags || []).map((item) => item.trim()).filter(Boolean)),
  }
}

function buildSourceLabel(source: StoryItemDetailContext['sourceContexts'][number]) {
  const main = source.label || source.page || '未知来源'
  return source.detectedAt ? `${main} · ${source.detectedAt}` : main
}

function buildListDescription(item: StoryItem) {
  return item.itemKind === 'instance'
    ? item.plotFunction || item.summary || item.cost || item.risk || '还没有补充实例说明。'
    : item.summary || item.plotFunction || item.usageMethod || item.acquisitionMethod || '还没有补充模板说明。'
}

function buildLocationLabel(location?: MapNodeSummary | null) {
  if (!location) return '未绑定地点'
  const parts = [location.name, location.nodeType, location.structureRole].filter(Boolean)
  return parts.join(' · ')
}

function buildEventLabel(event: TimelineEvent) {
  return `${event.timeLabel} · ${event.eventTitle}`
}

function buildSegmentLabel(segment: StoryItemDetailContext['relatedSegments'][number]) {
  return `第 ${segment.chapterNum} 章 · 场景 ${String(segment.segmentOrder).padStart(2, '0')} · ${segment.title || segment.chapterTitle}`
}

function buildArcLabel(arc: StoryArc) {
  return arc.arcGoal || arc.arcSummary || '故事弧待补充摘要'
}

function buildItemLead(
  item: StoryItem | null,
  detailContext: StoryItemDetailContext,
  creating: boolean,
  activeKind: StoryItem['itemKind'],
) {
  if (item) {
    if (item.itemKind === 'template') {
      return item.plotFunction
        || item.summary
        || (detailContext.derivedInstances.length > 0
          ? `当前已有 ${detailContext.derivedInstances.length} 个实例沿用这个模板。`
          : '这个模板还没有绑定到具体实例。')
    }

    const route = [
      detailContext.ownerCharacter ? `持有人：${detailContext.ownerCharacter.fullName}` : '',
      detailContext.location ? `地点：${detailContext.location.name}` : '',
      detailContext.parentTemplate ? `来源模板：${detailContext.parentTemplate.itemName}` : '',
    ].filter(Boolean).join('，')

    return item.plotFunction || item.summary || route || '补全来源、流转和剧情作用后，这个实例才真正可追踪。'
  }

  return creating
    ? (activeKind === 'instance'
      ? '先确定来源模板、当前持有人、地点和事件锚点，再补剧情作用与代价。'
      : '先定义模板的故事职能、获得方式和使用规则，再考虑有哪些实例会沿用它。')
    : '从左侧选择一条记录，或直接新建模板 / 实例。'
}

function buildKicker(item: StoryItem | null, creating: boolean) {
  if (!item) return creating ? '新建记录' : '物品详情'
  if (item.recordStatus === 'draft') return '待确认草稿'
  return item.itemKind === 'template' ? '当前模板' : '当前实例'
}

function buildEntityTitle(item: StoryItem | null, creating: boolean, activeKind: StoryItem['itemKind']) {
  if (item) return item.itemName
  if (!creating) return '选择一条物品记录'
  return activeKind === 'template' ? '新建物品模板' : '新建物品实例'
}

function buildSummaryText(...parts: Array<string | undefined | null>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(' / ')
}

function pickCurrentItemKind(
  watchedKind: ItemFormValues['itemKind'] | undefined,
  selectedItem: StoryItem | null,
  listMode: StoryItem['itemKind'],
) {
  return watchedKind || selectedItem?.itemKind || listMode
}

export default function ItemsWorkspace({ novelId }: Props) {
  const [searchParams] = useSearchParams()
  const { currentNovel } = useNovelStore()
  const { notifyWorkspaceMutation, registerClearHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ItemFormValues>()
  const [generateForm] = Form.useForm<GenerateFormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [pageData, setPageData] = useState<PagedResult<StoryItem>>(EMPTY_PAGE)
  const [stats, setStats] = useState<StoryItemStats>(EMPTY_STATS)
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [filters, setFilters] = useState<StoryItemFilterOptions>(EMPTY_FILTERS)
  const [detailContext, setDetailContext] = useState<StoryItemDetailContext>(EMPTY_DETAIL)
  const [linkRecommendations, setLinkRecommendations] = useState<StoryItemLinkRecommendationResult | null>(null)
  const [loadingRecommendations, setLoadingRecommendations] = useState(false)
  const [applyingRecommendations, setApplyingRecommendations] = useState(false)
  const [selectedItem, setSelectedItem] = useState<StoryItem | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [activeEditorTab, setActiveEditorTab] = useState('overview')
  const [listMode, setListMode] = useState<'template' | 'instance'>('template')
  const [recordStatusFilter, setRecordStatusFilter] = useState<'confirmed' | 'draft' | 'all'>('confirmed')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const routeFocusRef = useRef<number | null>(null)
  const routeItemId = useMemo(() => parseRouteId(searchParams.get('itemId')), [searchParams])
  const [generateOpen, setGenerateOpen] = useState(false)
  const itemGenerationProfile = useMemo(
    () => getItemGenerationProfile(currentNovel?.genreName),
    [currentNovel?.genreName],
  )
  const [templateOptions, setTemplateOptions] = useState<StoryItem[]>([])
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [locationOptions, setLocationOptions] = useState<MapNodeSummary[]>([])
  const [eventOptions, setEventOptions] = useState<TimelineEvent[]>([])

  const watchedItemKind = Form.useWatch('itemKind', form)
  const currentItemKind = pickCurrentItemKind(watchedItemKind, selectedItem, listMode)
  const rarityOptions = useMemo(() => Array.from(new Set([...RARITY_OPTIONS, ...filters.rarities].filter(Boolean))), [filters.rarities])
  const generationBlockers = useMemo(() => getWorkflowBlockers('items', currentNovel, workflowStats), [currentNovel, workflowStats])
  const editorLead = useMemo(() => buildItemLead(selectedItem, detailContext, creating, currentItemKind), [creating, currentItemKind, detailContext, selectedItem])

  const searchTemplates = useCallback(async (value = '') => {
    const rows = await window.electron.item.search(novelId, value, 'template', 24)
    setTemplateOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const searchCharacters = useCallback(async (value = '') => {
    const rows = await window.electron.character.search(novelId, value, 24)
    setCharacterOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const searchLocations = useCallback(async (value = '') => {
    const rows = await window.electron.map.searchNodes(novelId, value, 24)
    setLocationOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const searchEvents = useCallback(async (value = '') => {
    const rows = await window.electron.timeline.search(novelId, value, 24)
    setEventOptions((prev) => mergeById(rows, prev))
  }, [novelId])

  const hydrateOptions = useCallback(async (
    context: StoryItemDetailContext = EMPTY_DETAIL,
    item?: StoryItem | null,
  ) => {
    const activeItem = item || context.item || null
    const parentId = context.parentTemplate?.id ?? activeItem?.parentItemId
    const ownerId = context.ownerCharacter?.id ?? activeItem?.ownerCharacterId
    const locationId = context.location?.id ?? activeItem?.locationMapId
    const linkedCharacterIds = activeItem ? parseNumberArray(activeItem.linkedCharacterIdsJson) : []
    const linkedEventIds = activeItem ? parseNumberArray(activeItem.linkedTimelineEventIdsJson) : []

    const [baseTemplates, baseCharacters, baseLocations, baseEvents, extraTemplate, extraOwner, extraLocation, extraCharacters, extraEvents] = await Promise.all([
      window.electron.item.search(novelId, '', 'template', 24),
      window.electron.character.search(novelId, '', 24),
      window.electron.map.searchNodes(novelId, '', 24),
      window.electron.timeline.search(novelId, '', 24),
      parentId ? window.electron.item.get(parentId) : Promise.resolve(null),
      ownerId ? window.electron.character.get(ownerId) : Promise.resolve(null),
      locationId ? window.electron.map.getNode(locationId) : Promise.resolve(null),
      Promise.all(
        linkedCharacterIds
          .filter((characterId) => !context.relatedCharacters.some((character) => character.id === characterId))
          .map((characterId) => window.electron.character.get(characterId)),
      ),
      Promise.all(
        linkedEventIds
          .filter((eventId) => !context.relatedEvents.some((event) => event.id === eventId))
          .map((eventId) => window.electron.timeline.get(eventId)),
      ),
    ])

    setTemplateOptions(mergeById(baseTemplates, [context.parentTemplate, extraTemplate]))
    setCharacterOptions(mergeById(baseCharacters, [context.ownerCharacter, ...context.relatedCharacters, extraOwner, ...extraCharacters]))
    setLocationOptions(mergeById(baseLocations, [context.location, ...context.relatedLocations, extraLocation]))
    setEventOptions(mergeById(baseEvents, [...context.relatedEvents, ...extraEvents]))
  }, [novelId])

  const loadLinkRecommendations = useCallback(async (itemId: number) => {
    setLoadingRecommendations(true)
    try {
      const result = await window.electron.item.getLinkRecommendations(itemId)
      setLinkRecommendations(result)
      return result
    } finally {
      setLoadingRecommendations(false)
    }
  }, [])

  const loadItemDetail = useCallback(async (itemId: number) => {
    const context = await window.electron.item.getDetailContext(itemId)
    if (!context.item) {
      setSelectedId(null)
      setSelectedItem(null)
      setDetailContext(EMPTY_DETAIL)
      setLinkRecommendations(null)
      form.resetFields()
      return
    }

    setCreating(false)
    setSelectedId(context.item.id)
    setSelectedItem(context.item)
    setDetailContext(context)
    form.setFieldsValue(toFormValues(context.item))
    await Promise.all([
      hydrateOptions(context, context.item),
      loadLinkRecommendations(context.item.id),
    ])
  }, [form, hydrateOptions, loadLinkRecommendations])

  const buildQuery = useCallback((targetPage = page): StoryItemQueryInput => ({
    novelId,
    itemKind: listMode,
    page: targetPage,
    pageSize: PAGE_SIZE,
    recordStatus: recordStatusFilter,
    ...(categoryFilter !== 'all' ? { category: categoryFilter } : {}),
    ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
  }), [categoryFilter, keyword, listMode, novelId, page, recordStatusFilter])

  const refreshListState = useCallback(async (targetPage = page) => {
    const query = buildQuery(targetPage)
    const [list, summary, nextFilters, nextWorkflowStats] = await Promise.all([
      window.electron.item.query(query),
      window.electron.item.getStats({ novelId }),
      window.electron.item.getFilterOptions(novelId),
      loadWorkflowStats(novelId),
    ])
    setPageData(list)
    setStats(summary)
    setFilters(nextFilters)
    setWorkflowStats(nextWorkflowStats)
    return list
  }, [buildQuery, novelId, page])

  const loadPage = useCallback(async (
    preferredId?: number | null,
    targetPage = page,
    options: { preserveCreating?: boolean } = {},
  ) => {
    setLoading(true)
    try {
      const list = await refreshListState(targetPage)
      const matchedId = typeof preferredId === 'number' && list.items.some((item) => item.id === preferredId)
        ? preferredId
        : null

      if (matchedId !== null) {
        await loadItemDetail(matchedId)
        return
      }

      if (options.preserveCreating) {
        return
      }

      const fallbackId = list.items[0]?.id ?? null
      if (fallbackId !== null) {
        await loadItemDetail(fallbackId)
      } else {
        setSelectedId(null)
        setSelectedItem(null)
        setDetailContext(EMPTY_DETAIL)
        setLinkRecommendations(null)
        form.resetFields()
        await hydrateOptions()
      }
    } finally {
      setLoading(false)
    }
  }, [form, hydrateOptions, loadItemDetail, page, refreshListState])

  useEffect(() => {
    void loadPage(selectedId, page, { preserveCreating: creating })
  }, [categoryFilter, creating, keyword, listMode, loadPage, novelId, page, recordStatusFilter, selectedId])
  useEffect(() => {
    if (!routeItemId || routeFocusRef.current === routeItemId) return
    routeFocusRef.current = routeItemId
    setPage(1)
    void loadPage(routeItemId, 1, { preserveCreating: false })
  }, [loadPage, routeItemId])

  useEffect(() => {
    setPage(1)
  }, [categoryFilter, keyword, listMode, recordStatusFilter])

  useEffect(() => {
    generateForm.setFieldsValue({
      count: itemGenerationProfile.defaultBatch,
      batchSize: 4,
      templateOnly: false,
      refreshTemplates: true,
      focus: '',
    })
  }, [generateForm, itemGenerationProfile.defaultBatch])

  const handleNew = (kind: 'template' | 'instance') => {
    setCreating(true)
    setListMode(kind)
    setSelectedId(null)
    setSelectedItem(null)
    setDetailContext(EMPTY_DETAIL)
    setLinkRecommendations(null)
    form.resetFields()
    form.setFieldsValue(emptyValues(kind))
    void hydrateOptions()
  }

  const refreshWorkspace = async () => {
    setLoading(true)
    try {
      const list = await refreshListState(page)
      if (selectedId) {
        await loadItemDetail(selectedId)
      } else if (!creating) {
        const fallbackId = list.items[0]?.id ?? null
        if (fallbackId !== null) await loadItemDetail(fallbackId)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (selectedItem?.id) {
        await window.electron.item.update(selectedItem.id, serialize(values))
        await Promise.all([loadItemDetail(selectedItem.id), refreshListState(page)])
      } else {
        const nextId = await window.electron.item.create(novelId, serialize(values))
        await Promise.all([loadItemDetail(nextId), refreshListState(page)])
      }
      setCreating(false)
      message.success(getUserFacingMessage(selectedItem?.recordStatus === 'draft' ? 'item.savedDraft' : 'item.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'item.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedItem?.id) return

    Modal.confirm({
      title: `删除“${selectedItem.itemName}”？`,
      content: '删除后不会自动清理其他模块里的引用，请确认这条记录已经不再使用。',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.electron.item.delete(selectedItem.id)
        const nextPage = page > 1 && pageData.items.length === 1 ? page - 1 : page
        setPage(nextPage)
        await loadPage(null, nextPage, { preserveCreating: false })
        message.success(getUserFacingMessage('item.deleted'))
      },
    })
  }

  const resolveGenerationBlockers = useCallback(async () => {
    const nextWorkflowStats = await loadWorkflowStats(novelId)
    setWorkflowStats(nextWorkflowStats)
    return getWorkflowBlockers('items', currentNovel, nextWorkflowStats)
  }, [currentNovel, novelId])

  const openGenerateModal = useCallback(async () => {
    const blockers = await resolveGenerationBlockers()
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }
    setGenerateOpen(true)
  }, [resolveGenerationBlockers])

  const handleGenerate = async () => {
    const blockers = await resolveGenerationBlockers()
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    const values = await generateForm.validateFields()
    setGenerating(true)
    try {
      await window.electron.item.generate(novelId, values)
      setGenerateOpen(false)
      setPage(1)
      await loadPage(null, 1, { preserveCreating: false })
      message.success(getUserFacingMessage(values.templateOnly ? 'item.templateSynced' : 'item.generated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'item.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleRegenerate = async () => {
    if (!selectedItem?.id) return
    setGenerating(true)
    try {
      const regenerated = await window.electron.item.regenerate(selectedItem.id)
      await loadPage(regenerated?.id || selectedItem.id, page, { preserveCreating: false })
      message.success(getUserFacingMessage('item.regenerated'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'item.regenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleApplyLinkRecommendations = async (input?: { eventIds?: number[]; segmentIds?: number[] }) => {
    if (!selectedItem?.id || !linkRecommendations) return

    const payload = input || {
      eventIds: linkRecommendations.events.map((item) => item.eventId),
      segmentIds: linkRecommendations.segments.map((item) => item.segmentId),
    }

    setApplyingRecommendations(true)
    try {
      const result = await window.electron.item.applyLinkRecommendations(selectedItem.id, payload)
      await Promise.all([
        loadItemDetail(selectedItem.id),
        refreshListState(page),
      ])
      message.success(result.message)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'item.saveFailed'))
    } finally {
      setApplyingRecommendations(false)
    }
  }

  const handleClear = useCallback(async () => {
    Modal.confirm({
      title: '清空物品系统？',
      content: '会删除当前小说下的全部模板与实例，并清空时间线里的物品链接。',
      okType: 'danger',
      okText: '确认清空',
      onOk: async () => {
        await window.electron.item.clear(novelId)
        setPage(1)
        setCreating(false)
        setSelectedId(null)
        setSelectedItem(null)
        setDetailContext(EMPTY_DETAIL)
        form.resetFields()
        await loadPage(null, 1, { preserveCreating: false })
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('item.cleared'))
      },
    })
  }, [form, loadPage, novelId, notifyWorkspaceMutation, setCreating, setDetailContext, setPage, setSelectedId, setSelectedItem])

  useEffect(() => {
    registerClearHandler(() => {
      void handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  const aiActions = selectedItem || creating ? (
    <AIGenerateButton
      novelId={novelId}
      label={currentItemKind === 'instance' ? 'AI 生成实例内容' : 'AI 生成模板内容'}
      isJson
      buildMessages={() => {
        const values = form.getFieldsValue(true)
        return buildDraftMessages({
          task: currentItemKind === 'instance' ? '剧情物品实例' : '物品模板',
          mode: values.itemName ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '简介', value: currentNovel?.synopsis || '' },
            { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
            { label: '记录类型', value: currentItemKind === 'instance' ? '实例' : '模板' },
            { label: '已选模板', value: templateOptions.find((item) => item.id === values.parentItemId)?.itemName || '' },
            { label: '已选持有人', value: characterOptions.find((item) => item.id === values.ownerCharacterId)?.fullName || '' },
            { label: '已选地点', value: locationOptions.find((item) => item.id === values.locationMapId)?.name || '' },
          ],
          fields: [
            { key: 'itemName', label: '名称', value: values.itemName, hint: '名字要像小说里真实会出现的物品。' },
            { key: 'category', label: '主分类', value: values.category, hint: '例如武器、药品、证据、信物、装备。' },
            { key: 'subType', label: '细分类', value: values.subType, hint: '进一步说明它的形态或用途。' },
            { key: 'rarity', label: '稀有度', value: values.rarity, hint: '可用常见、稀有、核心、禁用级。' },
            { key: 'summary', label: '一句话说明', value: values.summary, hint: '一句话说清它是什么。' },
            { key: 'appearance', label: '外观', value: values.appearance, hint: '写识别点，不要堆形容词。' },
            { key: 'acquisitionMethod', label: '获取方式', value: values.acquisitionMethod, hint: '说清它如何被得到。' },
            { key: 'usageMethod', label: '使用方式', value: values.usageMethod, hint: '说清它如何被用。' },
            { key: 'cost', label: '代价', value: values.cost, hint: '明确成本、门槛或条件。' },
            { key: 'risk', label: '风险', value: values.risk, hint: '明确副作用、后果或暴露风险。' },
            { key: 'plotFunction', label: '剧情作用', value: values.plotFunction, hint: '说清它推动哪条线。' },
            { key: 'factionHint', label: '关联势力', value: values.factionHint, hint: '没有可留空。' },
            { key: 'tags', label: '标签', type: 'string[]', value: values.tags, hint: '控制在 3 到 6 个。' },
          ],
          requirements: [
            '不要改动已经选中的模板、人物、地点和事件关联。',
            '不要写百科腔和口号式描述。',
          ],
        })
      }}
      onResult={(raw) => {
        const draft = parseDraftJson<Record<string, unknown>>(raw)
        const currentValues = form.getFieldsValue(true)
        form.setFieldsValue({
          ...currentValues,
          itemName: typeof draft.itemName === 'string' ? draft.itemName : currentValues.itemName,
          category: typeof draft.category === 'string' ? draft.category : currentValues.category,
          subType: typeof draft.subType === 'string' ? draft.subType : currentValues.subType,
          rarity: typeof draft.rarity === 'string' ? draft.rarity : currentValues.rarity,
          summary: typeof draft.summary === 'string' ? draft.summary : currentValues.summary,
          appearance: typeof draft.appearance === 'string' ? draft.appearance : currentValues.appearance,
          acquisitionMethod: typeof draft.acquisitionMethod === 'string' ? draft.acquisitionMethod : currentValues.acquisitionMethod,
          usageMethod: typeof draft.usageMethod === 'string' ? draft.usageMethod : currentValues.usageMethod,
          cost: typeof draft.cost === 'string' ? draft.cost : currentValues.cost,
          risk: typeof draft.risk === 'string' ? draft.risk : currentValues.risk,
          plotFunction: typeof draft.plotFunction === 'string' ? draft.plotFunction : currentValues.plotFunction,
          factionHint: typeof draft.factionHint === 'string' ? draft.factionHint : currentValues.factionHint,
          tags: normalizeStringArray(draft.tags ?? currentValues.tags),
        })
      }}
    />
  ) : null

  const listSummaryText = useMemo(() => {
    const parts = [
      `${pageData.total} 条记录`,
      listMode === 'template' ? '当前看模板' : '当前看实例',
      recordStatusFilter === 'all' ? '含全部状态' : recordStatusFilter === 'draft' ? '仅草稿' : '仅正式',
    ]
    return parts.join(' · ')
  }, [listMode, pageData.total, recordStatusFilter])

  const ownerLabel = currentItemKind === 'template' ? '默认持有人' : '当前持有人'
  const locationLabel = currentItemKind === 'template' ? '默认出现场景' : '主要地点'
  const linkedCharactersLabel = currentItemKind === 'template' ? '默认关联人物' : '关联人物'
  const linkedEventsLabel = currentItemKind === 'template' ? '默认关联事件' : '关联事件'

  const editorStats = useMemo(() => {
    const relatedCharacterCount = (detailContext.ownerCharacter ? 1 : 0) + detailContext.relatedCharacters.length
    const instanceLabel = selectedItem?.itemKind === 'template' ? '派生实例' : '同模板实例'
    const instanceValue = selectedItem?.itemKind === 'template'
      ? detailContext.derivedInstances.length
      : detailContext.siblingInstances.length

    return [
      {
        label: '关联人物',
        value: relatedCharacterCount,
        note: detailContext.ownerCharacter ? `含持有人 ${detailContext.ownerCharacter.fullName}` : '未绑定持有人',
      },
      {
        label: '关联事件',
        value: detailContext.relatedEvents.length,
        note: detailContext.relatedArcs.length > 0 ? `${detailContext.relatedArcs.length} 条故事弧` : '未绑定事件',
      },
      {
        label: instanceLabel,
        value: instanceValue,
        note: selectedItem?.itemKind === 'template'
          ? '由这个模板派生出的实例数量'
          : (detailContext.parentTemplate ? `共享模板 ${detailContext.parentTemplate.itemName}` : '没有上级模板'),
      },
      {
        label: '来源线索',
        value: detailContext.sourceContexts.length,
        note: detailContext.location ? `主地点 ${detailContext.location.name}` : '未绑定地点',
      },
    ]
  }, [detailContext, selectedItem?.itemKind])

  const overviewTabContent = (
    <div className="novel-support-grid novel-items__support-grid">
      <WorkspaceTip title="资产概览">
        <div className="novel-items__tip-list">
          <div className="novel-items__tip-item">
            <strong>一句话说明</strong>
            <span>{selectedItem?.summary || '还没有一句话摘要。'}</span>
          </div>
          <div className="novel-items__tip-item">
            <strong>外观识别点</strong>
            <span>{selectedItem?.appearance || '还没有补充外观。'}</span>
          </div>
          <div className="novel-items__tip-item">
            <strong>分类定位</strong>
            <span>{buildSummaryText(selectedItem?.category, selectedItem?.subType, selectedItem?.rarity) || '还没有分类定位。'}</span>
          </div>
          <div className="novel-items__tip-item">
            <strong>主地点</strong>
            <span>{buildLocationLabel(detailContext.location)}</span>
          </div>
        </div>
      </WorkspaceTip>

      <WorkspaceTip title="来源与流转">
        <div className="novel-items__tip-list">
          {detailContext.parentTemplate ? (
            <button
              type="button"
              className="novel-items__linked-button"
              onClick={() => void loadItemDetail(detailContext.parentTemplate!.id)}
            >
              查看来源模板 · {detailContext.parentTemplate.itemName}
            </button>
          ) : (
            <div className="novel-items__tip-item">
              <strong>来源模板</strong>
              <span>{selectedItem?.itemKind === 'template' ? '当前记录本身就是模板。' : '这是一个独立实例。'}</span>
            </div>
          )}
          <div className="novel-items__tip-item">
            <strong>获取方式</strong>
            <span>{selectedItem?.acquisitionMethod || '还没有写明如何获得。'}</span>
          </div>
          <div className="novel-items__tip-item">
            <strong>使用方式</strong>
            <span>{selectedItem?.usageMethod || '还没有写明如何使用。'}</span>
          </div>
          <div className="novel-items__tip-item">
            <strong>代价 / 风险</strong>
            <span>{buildSummaryText(selectedItem?.cost, selectedItem?.risk) || '还没有明确代价与风险。'}</span>
          </div>
          {detailContext.sourceContexts.length > 0 ? (
            <div className="novel-items__tip-item">
              <strong>自动发现来源</strong>
              <span>{detailContext.sourceContexts.map(buildSourceLabel).join('；')}</span>
            </div>
          ) : null}
        </div>
      </WorkspaceTip>
    </div>
  )

  const detailsTabContent = (
    <Form form={form} layout="vertical">
      <section className="novel-form-section">
        <div className="novel-form-section__header">
          <div className="novel-form-section__title">基础标识</div>
          <div className="novel-form-section__desc">先把类型、名称、分类和状态定准，这决定它会如何进入模板 / 实例链路。</div>
        </div>
        <div className="novel-grid novel-grid--3">
          <Form.Item name="itemKind" label="记录类型" rules={[{ required: true, message: '请选择记录类型' }]}>
            <Select options={ITEM_KIND_OPTIONS as unknown as Array<{ value: StoryItem['itemKind']; label: string }>} />
          </Form.Item>
          <Form.Item name="category" label="主分类">
            <Input placeholder="例如：武器、证据、药品、装备" />
          </Form.Item>
          <Form.Item name="subType" label="细分类">
            <Input placeholder="进一步说明形态或用途" />
          </Form.Item>
        </div>
        <div className="novel-grid novel-grid--3">
          <Form.Item name="itemName" label="名称" rules={[{ required: true, message: '请输入物品名称' }]}>
            <Input placeholder="写得像剧情里真实会出现的物品" />
          </Form.Item>
          <Form.Item name="rarity" label="稀有度">
            <Select allowClear options={rarityOptions.map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={STATUS_OPTIONS as unknown as Array<{ value: StoryItem['status']; label: string }>} />
          </Form.Item>
        </div>
      </section>

      <section className="novel-form-section">
        <div className="novel-form-section__header">
          <div className="novel-form-section__title">叙事概览</div>
          <div className="novel-form-section__desc">把“它是什么、长什么样、为什么重要”讲清楚，否则实例无法形成完整闭环。</div>
        </div>
        <div className="novel-grid novel-grid--2">
          <Form.Item name="summary" label="一句话说明">
            <Input.TextArea rows={6} placeholder="一句话说清它是什么" />
          </Form.Item>
          <Form.Item name="appearance" label="外观识别点">
            <Input.TextArea rows={6} placeholder="写辨识点，不要堆砌形容词" />
          </Form.Item>
        </div>
        <Form.Item name="plotFunction" label="剧情作用">
          <Input.TextArea rows={6} placeholder="说清它推动哪条冲突、哪段转折或哪次回收" />
        </Form.Item>
      </section>

      <section className="novel-form-section">
        <div className="novel-form-section__header">
          <div className="novel-form-section__title">流转与代价</div>
          <div className="novel-form-section__desc">把得到方式、使用条件、代价和风险写全，才能避免物品只是“有名字没用法”。</div>
        </div>
        <div className="novel-grid novel-grid--2">
          <Form.Item name="acquisitionMethod" label="获取方式">
            <Input.TextArea rows={6} placeholder="是谁给的、在哪拿到、付出了什么" />
          </Form.Item>
          <Form.Item name="usageMethod" label="使用方式">
            <Input.TextArea rows={6} placeholder="如何触发、如何维护、如何消耗" />
          </Form.Item>
        </div>
        <div className="novel-grid novel-grid--2">
          <Form.Item name="cost" label="代价">
            <Input.TextArea rows={6} placeholder="明确资源消耗、身份代价或行动门槛" />
          </Form.Item>
          <Form.Item name="risk" label="风险">
            <Input.TextArea rows={6} placeholder="明确副作用、暴露风险或后果" />
          </Form.Item>
        </div>
      </section>

      <section className="novel-form-section">
        <div className="novel-form-section__header">
          <div className="novel-form-section__title">关系与锚点</div>
          <div className="novel-form-section__desc">这里决定它和人物、地点、事件的闭环关系。实例应尽量填满，模板至少留下可派生的锚点。</div>
        </div>
        {currentItemKind === 'instance' ? (
          <div className="novel-grid novel-grid--3">
            <Form.Item name="parentItemId" label="来源模板">
              <Select
                allowClear
                showSearch
                filterOption={false}
                options={templateOptions.map((item) => ({ value: item.id, label: item.itemName }))}
                onFocus={() => void searchTemplates('')}
                onSearch={(value) => void searchTemplates(value)}
                placeholder="实例可选择一个模板作为来源"
              />
            </Form.Item>
            <Form.Item name="ownerCharacterId" label={ownerLabel}>
              <Select
                allowClear
                showSearch
                filterOption={false}
                options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
                onFocus={() => void searchCharacters('')}
                onSearch={(value) => void searchCharacters(value)}
              />
            </Form.Item>
            <Form.Item name="locationMapId" label={locationLabel}>
              <Select
                allowClear
                showSearch
                filterOption={false}
                options={locationOptions.map((item) => ({ value: item.id, label: item.name }))}
                onFocus={() => void searchLocations('')}
                onSearch={(value) => void searchLocations(value)}
              />
            </Form.Item>
          </div>
        ) : (
          <div className="novel-grid novel-grid--2">
            <Form.Item name="ownerCharacterId" label={ownerLabel}>
              <Select
                allowClear
                showSearch
                filterOption={false}
                options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
                onFocus={() => void searchCharacters('')}
                onSearch={(value) => void searchCharacters(value)}
              />
            </Form.Item>
            <Form.Item name="locationMapId" label={locationLabel}>
              <Select
                allowClear
                showSearch
                filterOption={false}
                options={locationOptions.map((item) => ({ value: item.id, label: item.name }))}
                onFocus={() => void searchLocations('')}
                onSearch={(value) => void searchLocations(value)}
              />
            </Form.Item>
          </div>
        )}
        <div className="novel-grid novel-grid--2">
          <Form.Item name="linkedCharacterIds" label={linkedCharactersLabel}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={false}
              options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))}
              onFocus={() => void searchCharacters('')}
              onSearch={(value) => void searchCharacters(value)}
              placeholder="补充争夺者、线索角色、知情角色"
            />
          </Form.Item>
          <Form.Item name="linkedTimelineEventIds" label={linkedEventsLabel}>
            <Select
              mode="multiple"
              allowClear
              showSearch
              filterOption={false}
              options={eventOptions.map((item) => ({ value: item.id, label: buildEventLabel(item) }))}
              onFocus={() => void searchEvents('')}
              onSearch={(value) => void searchEvents(value)}
              placeholder="绑定首次出现、转手、丢失、回收等事件"
            />
          </Form.Item>
        </div>
        <div className="novel-grid novel-grid--2">
          <Form.Item name="factionHint" label="关联势力">
            <Input placeholder="例如：宗门库房、调查组、军械署" />
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" open={false} placeholder="输入后回车，例如：证据、禁物、回收伏笔" />
          </Form.Item>
        </div>
      </section>
    </Form>
  )

  const connectionsTabContent = (
    <div className="novel-support-grid novel-items__support-grid workspace-margin-top-16">
      <WorkspaceTip title="关联人物">
        {detailContext.ownerCharacter || detailContext.relatedCharacters.length > 0 ? (
          <div className="novel-items__tip-list">
            {detailContext.ownerCharacter ? (
              <div className="novel-items__tip-item">
                <strong>持有人</strong>
                <span>{detailContext.ownerCharacter.fullName}</span>
              </div>
            ) : null}
            {detailContext.relatedCharacters.map((character) => (
              <div key={character.id} className="novel-items__tip-item">
                <strong>{character.fullName}</strong>
                <span>{buildSummaryText(character.occupation, character.rankLevel, character.background) || '与该物品直接相关的人物。'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div>这条记录还没有绑定关键人物。</div>
        )}
      </WorkspaceTip>

      <WorkspaceTip title="关联事件与故事弧">
        {detailContext.relatedEvents.length > 0
          || detailContext.relatedArcs.length > 0
          || detailContext.relatedLocations.length > 0
          || detailContext.relatedSegments.length > 0 ? (
          <div className="novel-items__tip-list">
            {detailContext.relatedEvents.map((event) => (
              <div key={event.id} className="novel-items__tip-item">
                <strong>{buildEventLabel(event)}</strong>
                <span>{event.eventSummary || event.eventResult || event.eventProcess || '事件内容待补充。'}</span>
              </div>
            ))}
            {detailContext.relatedSegments.map((segment) => (
              <div key={segment.segmentId} className="novel-items__tip-item">
                <strong>{buildSegmentLabel(segment)}</strong>
                <span>{segment.summary || segment.purpose || segment.locationName || '场景内容待补充。'}</span>
              </div>
            ))}
            {detailContext.relatedArcs.map((arc) => (
              <div key={arc.id} className="novel-items__tip-item">
                <strong>{arc.arcName}</strong>
                <span>{buildArcLabel(arc)}</span>
              </div>
            ))}
            {detailContext.relatedLocations.map((location) => (
              <div key={location.id} className="novel-items__tip-item">
                <strong>{location.name}</strong>
                <span>{buildSummaryText(location.nodeType, location.structureRole, location.plotRelevance) || '关联地点待补充。'}</span>
              </div>
            ))}
          </div>
        ) : (
          <div>还没有把这条物品挂到时间线或地点上。</div>
        )}
      </WorkspaceTip>

      <WorkspaceTip title="自动关联推荐">
        {selectedItem ? (
          loadingRecommendations ? (
            <div className="novel-empty"><Spin size="small" /></div>
          ) : (
            <div className="novel-items__tip-list">
              <div className="novel-items__tip-item">
                <strong>推荐摘要</strong>
                <span>{linkRecommendations?.summary || '还没有推荐结果。'}</span>
              </div>
              {linkRecommendations?.events.map((event) => (
                <div key={`event-${event.eventId}`} className="novel-items__tip-item">
                  <strong>{`${event.timeLabel} · ${event.eventTitle}`}</strong>
                  <span>{`${event.reason} · 匹配分 ${event.score}`}</span>
                  <Space size={8}>
                    <Tag color="processing">事件</Tag>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      loading={applyingRecommendations}
                      onClick={() => void handleApplyLinkRecommendations({ eventIds: [event.eventId] })}
                    >
                      接受
                    </Button>
                  </Space>
                </div>
              ))}
              {linkRecommendations?.segments.map((segment) => (
                <div key={`segment-${segment.segmentId}`} className="novel-items__tip-item">
                  <strong>{`第 ${segment.chapterNum} 章 · 场景 ${String(segment.segmentOrder).padStart(2, '0')} · ${segment.segmentTitle}`}</strong>
                  <span>{`${segment.reason} · 匹配分 ${segment.score}`}</span>
                  <Space size={8}>
                    <Tag color="geekblue">场景</Tag>
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      loading={applyingRecommendations}
                      onClick={() => void handleApplyLinkRecommendations({ segmentIds: [segment.segmentId] })}
                    >
                      接受
                    </Button>
                  </Space>
                </div>
              ))}
              {!linkRecommendations || (linkRecommendations.events.length === 0 && linkRecommendations.segments.length === 0) ? (
                <div className="novel-items__tip-item">
                  <strong>当前状态</strong>
                  <span>暂时没有命中推荐。优先补充名称、剧情作用、地点或持有人后再刷新。</span>
                </div>
              ) : null}
              <Space wrap>
                <Button size="small" onClick={() => void loadLinkRecommendations(selectedItem.id)}>
                  刷新推荐
                </Button>
                <Button
                  size="small"
                  type="primary"
                  loading={applyingRecommendations}
                  disabled={Boolean(!linkRecommendations || (linkRecommendations.events.length === 0 && linkRecommendations.segments.length === 0))}
                  onClick={() => void handleApplyLinkRecommendations()}
                >
                  接受全部推荐
                </Button>
              </Space>
            </div>
          )
        ) : (
          <div>先选择一条物品记录，系统再根据人物、地点、时间轴和场景文本给出关联建议。</div>
        )}
      </WorkspaceTip>

      {selectedItem?.itemKind === 'template' ? (
        <WorkspaceTip title="派生实例">
          {detailContext.derivedInstances.length > 0 ? (
            <div className="novel-items__link-grid">
              {detailContext.derivedInstances.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="novel-items__linked-card"
                  onClick={() => void loadItemDetail(item.id)}
                >
                  <strong>{item.itemName}</strong>
                  <span>{item.plotFunction || item.summary || '这个实例还没有补剧情说明。'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div>这个模板还没有派生出实例。</div>
          )}
        </WorkspaceTip>
      ) : (
        <WorkspaceTip title="同模板实例">
          {detailContext.siblingInstances.length > 0 ? (
            <div className="novel-items__link-grid">
              {detailContext.siblingInstances.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="novel-items__linked-card"
                  onClick={() => void loadItemDetail(item.id)}
                >
                  <strong>{item.itemName}</strong>
                  <span>{item.plotFunction || item.summary || '这个实例还没有补剧情说明。'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div>{detailContext.parentTemplate ? '同模板下暂时没有其他实例。' : '当前实例还没有来源模板。'}</div>
          )}
        </WorkspaceTip>
      )}
    </div>
  )

  return (
    <WorkspacePage
      className="novel-items-page"
      eyebrow="物品系统"
      title="物品与装备工作台"
      description="模板、实例与自动发现草稿现在统一管理。你可以直接查看实例来源、持有人、地点、事件链以及同模板流转，不再只是停留在单条表单。"
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void refreshWorkspace()}>刷新</Button>
          <Button icon={<AppstoreAddOutlined />} onClick={() => handleNew('template')}>新建模板</Button>
          <Button icon={<InboxOutlined />} onClick={() => handleNew('instance')}>新建实例</Button>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => void openGenerateModal()}>AI 生成·批量物品</Button>
          <Button danger icon={<DeleteOutlined />} onClick={() => void handleClear()}>清空</Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '当前列表', value: listMode === 'template' ? '模板' : '实例' },
            {
              label: '当前状态',
              value: recordStatusFilter === 'confirmed' ? '正式记录' : recordStatusFilter === 'draft' ? '草稿记录' : '全部状态',
            },
            { label: '当前焦点', value: selectedItem?.itemName || (creating ? '新建记录' : '未选择') },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="模板" value={stats.templateCount} tone="warm" />
          <WorkspaceMetric label="实例" value={stats.instanceCount} />
          <WorkspaceMetric label="草稿" value={stats.draftCount || 0} tone="cool" />
          <WorkspaceMetric label="事件关联" value={stats.linkedEventCount} />
          <WorkspaceMetric label="分类" value={stats.categoryCount} />
        </>
      )}
    >
      {stats.draftCount ? (
        <Alert
          type="info"
          showIcon
          message={`当前还有 ${stats.draftCount} 条待确认物品草稿`}
          description="这些草稿通常来自自动发现。补全并保存后，它们会转为正式记录，并进入模板 / 实例链路。"
          action={recordStatusFilter !== 'draft' ? <Button size="small" onClick={() => setRecordStatusFilter('draft')}>查看草稿</Button> : undefined}
        />
      ) : null}

      {generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="当前还不适合批量生成物品"
          description={(
            <div>
              {generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="资产列表"
          description="筛选、分页和关键词都走后端查询。左侧用于快速筛选，右侧负责查看与编辑完整上下文。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Input.Search
                  allowClear
                  placeholder="搜索名称、分类、剧情作用"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  onSearch={setKeyword}
                />
                <Select
                  value={listMode}
                  options={ITEM_KIND_OPTIONS as unknown as Array<{ value: StoryItem['itemKind']; label: string }>}
                  onChange={(value) => setListMode(value)}
                />
              </div>
              <div className="novel-filter-bar__row">
                <Select
                  value={categoryFilter}
                  options={[{ value: 'all', label: '全部分类' }, ...filters.categories.map((item) => ({ value: item, label: item }))]}
                  onChange={setCategoryFilter}
                />
                <Select
                  value={recordStatusFilter}
                  options={[
                    { value: 'confirmed', label: '正式' },
                    { value: 'draft', label: '草稿' },
                    { value: 'all', label: '全部状态' },
                  ]}
                  onChange={setRecordStatusFilter}
                />
              </div>
              <div className="novel-filter-bar__summary">{listSummaryText}</div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><Spin /></div>
          ) : pageData.total === 0 ? (
            <div className="novel-empty">当前筛选下还没有记录。</div>
          ) : (
            <div className="workspace-stack-12">
              <VirtualList data={pageData.items} height={480} itemHeight={136} itemKey="id">
                {(item: StoryItem) => {
                  const relatedCharacterCount = parseNumberArray(item.linkedCharacterIdsJson).length + (item.ownerCharacterId ? 1 : 0)
                  const relatedEventCount = parseNumberArray(item.linkedTimelineEventIdsJson).length

                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`novel-list-card workspace-button-card ${selectedId === item.id ? 'novel-list-card--active' : ''}`}
                      onClick={() => void loadItemDetail(item.id)}
                    >
                      <div className="novel-list-card__title">
                        <span>{item.itemName}</span>
                        {item.recordStatus === 'draft' ? <Tag color="processing">草稿</Tag> : null}
                      </div>
                      <div className="novel-list-card__meta">
                        <Tag color={ITEM_KIND_META[item.itemKind].color}>{ITEM_KIND_META[item.itemKind].label}</Tag>
                        {item.category ? <Tag>{item.category}</Tag> : null}
                        {item.subType ? <Tag>{item.subType}</Tag> : null}
                        {item.rarity ? <Tag color="gold">{item.rarity}</Tag> : null}
                        <Tag color={STATUS_META[item.status].color}>{STATUS_META[item.status].label}</Tag>
                      </div>
                      <div className="novel-list-card__desc">{buildListDescription(item)}</div>
                      <div className="novel-items__list-facts">
                        <span>{relatedCharacterCount} 个相关人物</span>
                        <span>{relatedEventCount} 个相关事件</span>
                        {item.parentItemId ? <span>有来源模板</span> : null}
                      </div>
                    </button>
                  )
                }}
              </VirtualList>
              <Pagination
                current={pageData.page}
                pageSize={pageData.pageSize}
                total={pageData.total}
                size="small"
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          title={selectedItem ? `编辑 · ${selectedItem.itemName}` : creating ? '新建物品' : '物品详情'}
          description="右侧把详情视图与编辑视图合并：先看清上下文，再改字段。"
          extra={(
            <Space wrap>
              {aiActions}
              {selectedItem ? <Button icon={<ReloadOutlined />} loading={generating} onClick={() => void handleRegenerate()}>AI 修复·重做当前物品</Button> : null}
              {selectedItem ? <Button danger icon={<DeleteOutlined />} onClick={() => void handleDelete()}>删除</Button> : null}
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>
            </Space>
          )}
        >
          {!selectedItem && !creating && !loading ? (
            <div className="novel-empty">从左侧选择一条记录，或直接新建模板 / 实例。</div>
          ) : (
            <>
              <div className="novel-items__editor-intro">
                <div className="novel-items__editor-intro-copy">
                  <div className="novel-kicker">{buildKicker(selectedItem, creating)}</div>
                  <strong>{buildEntityTitle(selectedItem, creating, currentItemKind)}</strong>
                  <span>{editorLead}</span>
                  <div className="novel-items__editor-tags">
                    {selectedItem ? <Tag color={ITEM_KIND_META[selectedItem.itemKind].color}>{ITEM_KIND_META[selectedItem.itemKind].label}</Tag> : null}
                    {selectedItem?.recordStatus === 'draft' ? <Tag color="processing">自动发现草稿</Tag> : null}
                    {selectedItem?.rarity ? <Tag color="gold">{selectedItem.rarity}</Tag> : null}
                    {selectedItem?.category ? <Tag>{selectedItem.category}</Tag> : null}
                    {selectedItem?.status ? <Tag color={STATUS_META[selectedItem.status].color}>{STATUS_META[selectedItem.status].label}</Tag> : null}
                    {detailContext.parentTemplate ? <Tag color="cyan">来源模板 · {detailContext.parentTemplate.itemName}</Tag> : null}
                    {detailContext.location ? <Tag color="geekblue">地点 · {detailContext.location.name}</Tag> : null}
                  </div>
                </div>
                <div className="novel-items__editor-stats">
                  {editorStats.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                      <small>{item.note}</small>
                    </div>
                  ))}
                </div>
              </div>

              {selectedItem?.recordStatus === 'draft' && detailContext.sourceContexts.length > 0 ? (
                <Alert
                  className="novel-items__source-alert"
                  type="warning"
                  showIcon
                  message="这条物品来自自动发现"
                  description={detailContext.sourceContexts.map((source, index) => (
                    <div key={`${source.label || source.page || 'source'}-${index}`}>{buildSourceLabel(source)}</div>
                  ))}
                />
              ) : null}

              <Tabs
                activeKey={activeEditorTab}
                onChange={setActiveEditorTab}
                items={[
                  {
                    key: 'overview',
                    label: '概览',
                    children: (
                      <React.Suspense fallback={<div className="novel-empty"><Spin /></div>}>
                        <OverviewTab content={overviewTabContent} />
                      </React.Suspense>
                    ),
                  },
                  {
                    key: 'details',
                    label: '字段编辑',
                    children: (
                      <React.Suspense fallback={<div className="novel-empty"><Spin /></div>}>
                        <DetailsTab content={detailsTabContent} />
                      </React.Suspense>
                    ),
                  },
                  {
                    key: 'connections',
                    label: '关联上下文',
                    children: (
                      <React.Suspense fallback={<div className="novel-empty"><Spin /></div>}>
                        <ConnectionsTab content={connectionsTabContent} />
                      </React.Suspense>
                    ),
                  },
                ]}
              />
            </>
          )}
        </WorkspacePanel>
      </div>

      <Modal
        title="AI 生成·批量物品"
        open={generateOpen}
        forceRender
        onCancel={() => setGenerateOpen(false)}
        onOk={() => void handleGenerate()}
        confirmLoading={generating}
        okText="开始生成"
      >
        <Form form={generateForm} layout="vertical">
          <Alert
            showIcon
            type="info"
            style={{ marginBottom: 12 }}
            message={`题材建议：${itemGenerationProfile.title}`}
            description={`${itemGenerationProfile.overview} 默认建议本轮生成 ${itemGenerationProfile.defaultBatch} 条，可按当前剧情密度手动调整。`}
          />
          <Form.Item name="templateOnly" label="生成模式">
            <Select
              options={[
                { value: false, label: '同时生成模板与实例' },
                { value: true, label: '只同步模板' },
              ]}
            />
          </Form.Item>
          <Form.Item name="refreshTemplates" label="模板同步策略">
            <Select
              options={[
                { value: true, label: '按当前题材刷新模板库' },
                { value: false, label: '保留已有模板，只补缺口' },
              ]}
            />
          </Form.Item>
          <Form.Item name="count" label="本轮目标数量">
            <Select options={Array.from(new Set([itemGenerationProfile.defaultBatch, 8, 10, 12, 14, 18])).sort((left, right) => left - right).map((count) => ({ value: count, label: `${count} 条${count === itemGenerationProfile.defaultBatch ? ' · 题材推荐' : ''}` }))} />
          </Form.Item>
          <Form.Item name="batchSize" label="每批数量">
            <Select options={[2, 3, 4, 5, 6].map((count) => ({ value: count, label: `${count} 条 / 批` }))} />
          </Form.Item>
          <Form.Item name="focus" label="额外聚焦">
            <Input.TextArea rows={6} placeholder="例如：主角团装备、关键证据、宗门资源、禁用器具" />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
