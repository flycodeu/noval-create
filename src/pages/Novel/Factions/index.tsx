import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebouncedSearch } from '../../../hooks/useDebouncedSearch'
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Spin, Switch, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, ShareAltOutlined, StopOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type {
  Character,
  Faction,
  FactionAutoGenerateStatus,
  FactionBatchGenerationOptions,
  FactionGraphPayload,
  MapNodeSummary,
  Task,
} from '../../../types'
import {
  FACTION_RELATION_TYPE_OPTIONS,
  FACTION_RELATIONSHIP_DENSITY_OPTIONS,
  FACTION_TYPE_OPTIONS,
  buildFactionExternalRelationsPayload,
  getFactionTypeLabel,
  normalizeFactionTypeValue,
  parseFactionExternalRelations,
} from '../../../shared/factions'
import { useNovelStore } from '../../../stores/novel.store'
import { getFactionGenerationPreset } from '../../../shared/creation-tools'
import { parseTaskEventId } from '../../../shared/task-stream-events'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import FactionGraphCanvas from './FactionGraphCanvas'
import './index.css'

interface Props {
  novelId: number
}

type FactionFocusView = 'detail' | 'graph'

interface FactionFormValues {
  name: string
  type: Faction['type']
  goal: string
  resources: string
  territoryMapNodeIds: number[]
  leaderCharacterId?: number
  memberPolicy: string
  currentPhase: string
  externalRelations: ReturnType<typeof parseFactionExternalRelations>
  notes: string
}

const EMPTY_VALUES: FactionFormValues = {
  name: '',
  type: 'faction',
  goal: '',
  resources: '',
  territoryMapNodeIds: [],
  leaderCharacterId: undefined,
  memberPolicy: '',
  currentPhase: '',
  externalRelations: [],
  notes: '',
}

const EMPTY_AUTO_STATUS: FactionAutoGenerateStatus = {
  taskId: 0,
  novelId: 0,
  status: 'pending',
  requestedCount: 0,
  batchSize: 1,
  currentBatch: 0,
  totalBatches: 0,
  resumeCursor: 0,
  generatedCount: 0,
  retryCount: 0,
  completed: false,
  message: '',
  batchDigest: '',
  acceptedIds: [],
  warnings: [],
}

const EMPTY_FACTION_GRAPH: FactionGraphPayload = { nodes: [], edges: [], unalignedCharacters: [] }
const FACTION_AUTO_GENERATE_MAX_COUNT = 200
const FACTION_AUTO_GENERATE_MAX_BATCH_SIZE = 8

function ensureArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeFactionGraphPayload(graph: FactionGraphPayload | null | undefined): FactionGraphPayload {
  if (!graph) return EMPTY_FACTION_GRAPH
  return {
    ...EMPTY_FACTION_GRAPH,
    ...graph,
    nodes: ensureArray(graph.nodes),
    edges: ensureArray(graph.edges),
    unalignedCharacters: ensureArray(graph.unalignedCharacters),
  }
}

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

function buildFactionListSummary(item: Faction, leaderName?: string) {
  const relationCount = parseFactionExternalRelations(item.externalRelationsJson).length
  const territoryCount = parseNumberArray(item.territoryMapNodeIdsJson).length
  return [
    item.currentPhase ? `阶段：${item.currentPhase}` : '',
    leaderName ? `领袖：${leaderName}` : '',
    territoryCount > 0 ? `${territoryCount} 处地盘` : '',
    relationCount > 0 ? `${relationCount} 条关系` : '',
  ].filter(Boolean).join(' · ') || '仅保留基础设定，等待补齐关键关系。'
}

function buildFormValues(item?: Faction | null): FactionFormValues {
  if (!item) return EMPTY_VALUES
  return {
    name: item.name,
    type: item.type,
    goal: item.goal || '',
    resources: item.resources || '',
    territoryMapNodeIds: parseNumberArray(item.territoryMapNodeIdsJson),
    leaderCharacterId: item.leaderCharacterId,
    memberPolicy: item.memberPolicy || '',
    currentPhase: item.currentPhase || '',
    externalRelations: parseFactionExternalRelations(item.externalRelationsJson),
    notes: item.notes || '',
  }
}

export default function FactionsPage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<FactionFormValues>()
  const [generateForm] = Form.useForm<FactionBatchGenerationOptions>()
  const [items, setItems] = useState<Faction[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<FactionFocusView>('detail')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const [stats, setStats] = useState({ total: 0, withLeaderCount: 0, territoryBoundCount: 0, relationCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ characterCount: 0, mapCount: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [keywordInput, setKeywordInput, keyword] = useDebouncedSearch('')
  const [generateOpen, setGenerateOpen] = useState(false)
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [mapOptions, setMapOptions] = useState<MapNodeSummary[]>([])
  const [graphData, setGraphData] = useState<FactionGraphPayload>(EMPTY_FACTION_GRAPH)
  const [autoTask, setAutoTask] = useState<Task | null>(null)
  const [autoStatus, setAutoStatus] = useState<FactionAutoGenerateStatus>(EMPTY_AUTO_STATUS)
  const [autoStopping, setAutoStopping] = useState(false)
  const refreshRequestRef = useRef(0)
  const graphRequestRef = useRef(0)
  const autoStatusRequestRef = useRef(0)
  const creatingRef = useRef(false)
  const autoActionRef = useRef(false)
  const draftDirtyRef = useRef(false)
  const formSelectionRef = useRef<string | null>(null)

  const setDraftDirty = useCallback((value: boolean) => {
    draftDirtyRef.current = value
    setHasUnsavedChanges(value)
  }, [])

  const markDraftDirty = useCallback(() => setDraftDirty(true), [setDraftDirty])

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])
  const selectedValues = Form.useWatch([], form) as FactionFormValues | undefined
  const leaderNameMap = useMemo(
    () => new Map(characterOptions.map((item) => [item.id, item.fullName])),
    [characterOptions],
  )
  const selectedCharacterIds = useMemo(() => {
    const selectedName = (selectedValues?.name || selectedItem?.name || '').trim()
    if (!selectedName) return []
    return characterOptions
      .filter((character) => parseStringArray(character.campFactionIdsJson).some((value) => value === selectedName))
      .map((character) => character.id)
  }, [characterOptions, selectedItem, selectedValues?.name])

  const refreshAutoStatus = useCallback(async () => {
    const requestId = ++autoStatusRequestRef.current
    const latestTask = await window.electron.faction.getLatestAutoGenerateTask(novelId)
    if (autoStatusRequestRef.current !== requestId) return
    setAutoTask(latestTask)
    if (!latestTask) {
      setAutoStatus(EMPTY_AUTO_STATUS)
      return
    }
    const status = await window.electron.faction.getAutoGenerateStatus(latestTask.id)
    if (autoStatusRequestRef.current !== requestId) return
    setAutoStatus(status || EMPTY_AUTO_STATUS)
  }, [novelId])

  const refreshGraph = useCallback(async () => {
    const requestId = ++graphRequestRef.current
    setGraphLoading(true)
    try {
      const nextGraph = await window.electron.faction.getGraph({
        novelId,
        ...(selectedId ? { focusFactionId: selectedId } : {}),
      })
      if (graphRequestRef.current === requestId) setGraphData(normalizeFactionGraphPayload(nextGraph))
    } catch (error) {
      if (graphRequestRef.current === requestId) console.error(error)
    } finally {
      if (graphRequestRef.current === requestId) setGraphLoading(false)
    }
  }, [novelId, selectedId])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats, nextCharacters, nextMaps] = await Promise.all([
        window.electron.faction.query({ novelId, keyword, page: 1, pageSize: 500 }),
        window.electron.faction.getStats({ novelId }),
        loadWorkflowStats(novelId),
        window.electron.character.search(novelId, '', 120),
        window.electron.map.searchNodes(novelId, '', 120),
      ])
      if (refreshRequestRef.current !== requestId) return
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ characterCount: nextWorkflowStats.characterCount, mapCount: nextWorkflowStats.mapCount })
      setCharacterOptions(nextCharacters)
      setMapOptions(nextMaps)
      setSelectedId((current) => {
        if (creatingRef.current) return null
        if (current && page.items.some((item) => item.id === current)) return current
        return page.items[0]?.id || null
      })
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [keyword, novelId])

  useEffect(() => { void refresh() }, [mutationToken, refresh])
  useEffect(() => { void refreshGraph() }, [refreshGraph])
  useEffect(() => {
    void refreshAutoStatus().catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }, [refreshAutoStatus])
  useEffect(() => {
    const queryId = Number(searchParams.get('factionId') || '')
    if (!creatingRef.current && queryId > 0 && items.some((item) => item.id === queryId)) {
      setSelectedId((current) => current === queryId ? current : queryId)
    }
    const queryView = searchParams.get('view')
    if (queryView === 'detail' || queryView === 'graph') setViewMode(queryView)
  }, [items, searchParams])
  useEffect(() => {
    const selectionKey = selectedItem ? `${novelId}:${selectedItem.id}` : null
    const selectionChanged = formSelectionRef.current !== selectionKey
    if (!selectionChanged && draftDirtyRef.current) return
    form.setFieldsValue(buildFormValues(selectedItem))
    setDraftDirty(false)
    setDetailsOpen(false)
    formSelectionRef.current = selectionKey
  }, [form, novelId, selectedItem, setDraftDirty])
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])
  useEffect(() => {
    registerSaveHandler(() => { void handleSave() })
    return () => registerSaveHandler(null)
  })

  useEffect(() => {
    const reload = () => {
      void refresh()
      void refreshGraph()
      void refreshAutoStatus().catch(console.error)
    }
    const unsubProgress = window.electron.on('task:progress', (payload: unknown) => {
      if (parseTaskEventId(payload) === autoTask?.id) reload()
    })
    const unsubStatus = window.electron.on('task:status-change', (payload: unknown) => {
      if (parseTaskEventId(payload) === autoTask?.id) reload()
    })
    const unsubComplete = window.electron.on('task:complete', (payload: unknown) => {
      if (parseTaskEventId(payload) === autoTask?.id) reload()
    })
    return () => {
      unsubProgress()
      unsubStatus()
      unsubComplete()
    }
  }, [autoTask?.id, refresh, refreshAutoStatus, refreshGraph])

  const updateFocusRoute = useCallback((id: number | null, nextView: FactionFocusView) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (id) next.set('factionId', String(id))
      else next.delete('factionId')
      next.set('view', nextView)
      return next
    })
  }, [setSearchParams])

  const commitFactionSelection = useCallback((id: number, nextView: FactionFocusView = viewMode) => {
    creatingRef.current = false
    setSelectedId(id)
    setDraftDirty(false)
    setDetailsOpen(false)
    setViewMode(nextView)
    updateFocusRoute(id, nextView)
  }, [setDraftDirty, updateFocusRoute, viewMode])

  const selectFaction = useCallback((id: number, nextView?: FactionFocusView) => {
    if (id === selectedId && (!nextView || nextView === viewMode)) return
    const commit = () => commitFactionSelection(id, nextView || viewMode)
    if (!draftDirtyRef.current) {
      commit()
      return
    }
    Modal.confirm({
      title: '当前势力还有未保存修改',
      content: '切换后这些修改会被丢弃，是否继续？',
      okText: '放弃修改并切换',
      cancelText: '留下继续编辑',
      onOk: commit,
    })
  }, [commitFactionSelection, selectedId, viewMode])

  const handleCreate = () => {
    const commit = () => {
      creatingRef.current = true
      setSelectedId(null)
      setDraftDirty(false)
      setDetailsOpen(false)
      setViewMode('detail')
      updateFocusRoute(null, 'detail')
      form.setFieldsValue(EMPTY_VALUES)
    }
    if (!draftDirtyRef.current) {
      commit()
      return
    }
    Modal.confirm({
      title: '当前势力还有未保存修改',
      content: '新建势力会清空当前编辑内容，是否继续？',
      okText: '放弃修改并新建',
      cancelText: '留下继续编辑',
      onOk: commit,
    })
  }

  const handleViewChange = (nextView: FactionFocusView) => {
    setViewMode(nextView)
    updateFocusRoute(selectedId, nextView)
  }

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)
    try {
      const payload: Partial<Faction> = {
        name: values.name.trim(),
        type: values.type,
        goal: values.goal.trim(),
        resources: values.resources.trim(),
        territoryMapNodeIdsJson: JSON.stringify(values.territoryMapNodeIds || []),
        leaderCharacterId: values.leaderCharacterId || undefined,
        memberPolicy: values.memberPolicy.trim(),
        currentPhase: values.currentPhase.trim(),
        externalRelationsJson: buildFactionExternalRelationsPayload(values.externalRelations || []),
        notes: values.notes?.trim() || '',
      }

      if (selectedId) {
        await window.electron.faction.update(selectedId, payload)
      } else {
        const id = await window.electron.faction.create(novelId, payload)
        setSelectedId(id)
        updateFocusRoute(id, 'detail')
      }
      creatingRef.current = false
      setDraftDirty(false)
      notifyWorkspaceMutation()
      await Promise.all([refresh(), refreshGraph()])
      message.success(getUserFacingMessage('faction.saved'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!selectedItem) return
    Modal.confirm({
      title: `删除势力「${selectedItem.name}」？`,
      content: '删除后不会自动清理其他模块中的引用，请确认这个势力已不再使用。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.faction.delete(selectedItem.id)
          creatingRef.current = false
          setSelectedId(null)
          setDraftDirty(false)
          updateFocusRoute(null, 'detail')
          form.setFieldsValue(EMPTY_VALUES)
          notifyWorkspaceMutation()
          await Promise.all([refresh(), refreshGraph()])
          message.success(getUserFacingMessage('faction.deleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }

  const handleClear = useCallback(() => {
    Modal.confirm({
      title: '清空势力系统？',
      content: '会删除当前小说下的全部势力、势力关系和相关绑定引用，请确认。',
      okText: '确认清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          if (autoTask?.id && (autoTask.status === 'running' || autoTask.status === 'cancel_requested')) {
            await window.electron.workflow.cancel(autoTask.id)
          }
          await window.electron.faction.clear(novelId)
          creatingRef.current = false
          setSelectedId(null)
          setDraftDirty(false)
          updateFocusRoute(null, 'detail')
          form.setFieldsValue(EMPTY_VALUES)
          setGraphData(EMPTY_FACTION_GRAPH)
          setAutoTask(null)
          setAutoStatus(EMPTY_AUTO_STATUS)
          notifyWorkspaceMutation()
          await Promise.all([refresh(), refreshAutoStatus()])
          message.success(getUserFacingMessage('faction.cleared'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }, [autoTask, form, novelId, notifyWorkspaceMutation, refresh, refreshAutoStatus, setDraftDirty, updateFocusRoute])

  useEffect(() => {
    registerClearHandler(() => {
      handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  const handleStartAutoGenerate = async () => {
    if (autoActionRef.current) return
    autoActionRef.current = true
    try {
      const values = await generateForm.validateFields().catch(() => null)
      if (!values) return
      await window.electron.faction.startAutoGenerate(novelId, values)
      setGenerateOpen(false)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoStarted'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'faction.autoStartFailed'))
    } finally {
      autoActionRef.current = false
    }
  }

  const handleResumeAutoGenerate = async () => {
    if (!autoTask?.id || autoActionRef.current) return
    autoActionRef.current = true
    try {
      await window.electron.faction.resumeAutoGenerate(autoTask.id)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoResumed'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'faction.autoResumeFailed'))
    } finally {
      autoActionRef.current = false
    }
  }

  const handleStopAutoGenerate = async () => {
    if (!autoTask?.id || autoActionRef.current) return
    autoActionRef.current = true
    setAutoStopping(true)
    try {
      await window.electron.workflow.cancel(autoTask.id)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoStopRequested'))
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('faction.autoStopFailed'))
    } finally {
      autoActionRef.current = false
      setAutoStopping(false)
    }
  }

  const selectedTerritories = useMemo(
    () => mapOptions.filter((item) => (selectedValues?.territoryMapNodeIds || []).includes(item.id)),
    [mapOptions, selectedValues?.territoryMapNodeIds],
  )
  const selectedCharacters = useMemo(
    () => characterOptions.filter((item) => selectedCharacterIds.includes(item.id)),
    [characterOptions, selectedCharacterIds],
  )
  const selectedRelations = selectedValues?.externalRelations || []
  const hasRunningAutoTask = autoTask?.status === 'running' || autoTask?.status === 'cancel_requested'
  const existingFactionCount = Math.max(items.length, stats.total)
  const generationPreset = useMemo(() => getFactionGenerationPreset(currentNovel?.genreName, {
    launchMode: currentNovel?.launchMode,
    operatingMode: currentNovel?.operatingMode,
    targetWords: currentNovel?.targetWords,
    settingsJson: currentNovel?.settingsJson,
    factionCount: existingFactionCount,
  }), [
    currentNovel?.genreName,
    currentNovel?.launchMode,
    currentNovel?.operatingMode,
    currentNovel?.settingsJson,
    currentNovel?.targetWords,
    existingFactionCount,
  ])
  const recommendedGenerateCount = Math.max(
    1,
    Math.min(FACTION_AUTO_GENERATE_MAX_COUNT, generationPreset.count - existingFactionCount),
  )

  const openGenerateDialog = () => {
    generateForm.setFieldsValue({
      count: recommendedGenerateCount,
      batchSize: Math.max(1, Math.min(FACTION_AUTO_GENERATE_MAX_BATCH_SIZE, generationPreset.batchSize)),
      relationshipDensity: 'balanced',
      allowCharacterlessFactions: true,
      preferExistingCharacters: true,
      preferredTypes: ['organization', 'sect', 'family'],
      specialRequirements: generationPreset.focus,
    })
    setGenerateOpen(true)
  }

  const refreshEverything = () => {
    void refresh()
    void refreshGraph()
    void refreshAutoStatus().catch((error) => {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    })
  }

  return (
    <WorkspacePage
      chrome="shared"
      className="novel-factions-page"
      layout="wide"
      eyebrow="阵营与组织"
      title="势力系统"
      actionContract={{
        primary: { key: 'save', label: '保存势力', icon: <SaveOutlined />, loading: saving, onClick: () => void handleSave() },
        secondary: [
          { key: 'create', label: '新建势力', icon: <PlusOutlined />, onClick: handleCreate },
          { key: 'resistance', label: '去反派与阻力', icon: <ShareAltOutlined />, onClick: () => navigate(buildWorkspaceRoute(novelId, selectedItem ? `resistance?tab=factions&factionId=${selectedItem.id}` : 'resistance?tab=factions')) },
        ],
        more: {
          items: [
            { key: 'generate', label: 'AI 生成·分批势力', icon: <RobotOutlined />, onClick: openGenerateDialog },
            ...(autoTask?.status === 'paused' ? [{ key: 'resume', label: '继续任务', icon: <ShareAltOutlined />, onClick: () => void handleResumeAutoGenerate() }] : []),
            ...(hasRunningAutoTask ? [{ key: 'stop', label: '停止任务', icon: <StopOutlined />, danger: true, disabled: autoStopping, onClick: () => void handleStopAutoGenerate() }] : []),
            { type: 'divider' },
            { key: 'refresh', label: '刷新势力数据', icon: <ReloadOutlined />, onClick: refreshEverything },
            { key: 'delete', label: '删除势力', icon: <DeleteOutlined />, danger: true, disabled: !selectedItem, onClick: () => void handleDelete() },
          ],
        },
      }}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '角色池', value: `${workflowStats.characterCount} 人` },
            { label: '地图节点', value: `${workflowStats.mapCount} 处` },
            { label: '游离人物', value: `${graphData.unalignedCharacters.length} 人` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="势力总数" value={stats.total} tone="warm" />
          <WorkspaceMetric label="已绑领袖" value={stats.withLeaderCount} />
          <WorkspaceMetric label="已绑地盘" value={stats.territoryBoundCount} />
          <WorkspaceMetric label="势力关系" value={stats.relationCount} />
        </>
      )}
    >
      {autoTask ? (
        <Alert
          className="faction-workspace__status"
          type={autoTask.status === 'success' ? 'success' : autoTask.status === 'paused' || autoTask.status === 'cancelled' ? 'warning' : autoTask.status === 'failed' ? 'error' : 'info'}
          showIcon
          message={`后台任务：${autoStatus.message || '等待执行'}`}
          description={`已完成 ${autoStatus.generatedCount}/${autoStatus.requestedCount} 个；第 ${autoStatus.currentBatch}/${autoStatus.totalBatches} 批；最近摘要：${autoStatus.batchDigest || '暂无'}`}
        />
      ) : null}

      <div className="faction-workspace__status-rail" data-faction-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`faction-workspace__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{hasUnsavedChanges ? '有未保存修改' : '已与当前势力同步'}</strong>
        <span>{selectedItem ? `当前：${selectedItem.name}` : '准备新建势力'}</span>
      </div>

      <div className="faction-workspace">
        <WorkspacePanel
          className="faction-workspace__sidebar"
          title={<div className="faction-list-heading"><span>势力列表</span><small>{items.length} 个</small></div>}
        >
          <Input.Search value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索势力、目标、资源或阶段" allowClear />
          <div className="faction-list-scroll" data-faction-list>
            {loading ? <div className="faction-workspace__empty"><Spin size="small" /></div> : null}
            {!loading && items.length > 0 ? items.map((item) => (
              <button
                key={item.id}
                type="button"
                data-faction-list-row
                data-faction-id={item.id}
                aria-pressed={selectedId === item.id}
                className={`faction-list-card ${selectedId === item.id ? 'faction-list-card--active' : ''}`}
                onClick={() => selectFaction(item.id, 'detail')}
              >
                <span className="faction-list-card__title"><strong>{item.name}</strong><Tag>{getFactionTypeLabel(item.type)}</Tag></span>
                <span className="faction-list-card__desc">{buildFactionListSummary(item, typeof item.leaderCharacterId === 'number' ? leaderNameMap.get(item.leaderCharacterId) : undefined)}</span>
              </button>
            )) : null}
            {!loading && items.length <= 0 ? <div className="faction-workspace__empty">{keyword.trim() ? '没有匹配的势力' : '当前没有势力记录'}</div> : null}
          </div>
        </WorkspacePanel>

        <div className="faction-workspace__focus">
          <div className="faction-workspace__view-switch" role="tablist" aria-label="势力工作视图">
            <button type="button" role="tab" aria-selected={viewMode === 'detail'} className={viewMode === 'detail' ? 'is-active' : ''} onClick={() => handleViewChange('detail')}>当前详情</button>
            <button type="button" role="tab" aria-selected={viewMode === 'graph'} className={viewMode === 'graph' ? 'is-active' : ''} onClick={() => handleViewChange('graph')}>关系图谱</button>
            <span className="faction-workspace__view-note">一次只处理一个焦点</span>
          </div>

          <div hidden={viewMode !== 'graph'}>
            <WorkspacePanel
              className="faction-workspace__view-panel"
              title="势力关系图谱"
              extra={<Tag color="processing">{selectedId ? '当前聚焦已收窄' : '当前显示全局网络'}</Tag>}
            >
              <div data-faction-view="graph" className="faction-workspace__graph-view">
                <div className="faction-workspace__graph-scroll">
                  {graphLoading ? <div className="faction-workspace__empty"><Spin /></div> : <FactionGraphCanvas data={graphData} selectedFactionId={selectedId} onFactionSelect={(id) => selectFaction(id, 'graph')} />}
                </div>
                {graphData.unalignedCharacters.length > 0 ? (
                  <div className="faction-workspace__orphans">
                    <strong>当前无固定势力的人物</strong>
                    <div className="faction-workspace__chips faction-workspace__chips--bounded" data-faction-orphans-scroll>
                      {graphData.unalignedCharacters.slice(0, 40).map((character) => <Tag key={character.id}>{character.fullName}</Tag>)}
                    </div>
                  </div>
                ) : null}
              </div>
            </WorkspacePanel>
          </div>
          <div hidden={viewMode !== 'detail'}>
            <WorkspacePanel
              className="faction-workspace__view-panel"
              title={selectedItem ? `当前详情：${selectedItem.name}` : '新建势力'}
              extra={(
                <AIGenerateButton
                  novelId={novelId}
                  label={selectedItem ? 'AI 补当前势力' : 'AI 生成势力草稿'}
                  isJson
                  buildMessages={() => buildDraftMessages({
                    task: '势力档案',
                    mode: selectedItem ? 'optimize' : 'replace',
                    context: [
                      { label: '书名', value: currentNovel?.title || '' },
                      { label: '题材', value: currentNovel?.genreName || '' },
                      { label: '简介', value: currentNovel?.synopsis || '' },
                      { label: '扩展背景', value: currentNovel?.expandedBackground || '' },
                      { label: '现有势力', value: items.filter((item) => item.id !== selectedId).slice(0, 8).map((item) => item.name).join('、') },
                      { label: '现有人物', value: characterOptions.slice(0, 12).map((item) => item.fullName).join('、') },
                      { label: '地图节点', value: mapOptions.slice(0, 12).map((item) => item.name).join('、') },
                    ],
                    fields: [
                      { key: 'name', label: '势力名称', value: selectedValues?.name, hint: '名字要像小说中的真实组织。' },
                      { key: 'type', label: '势力类型', value: selectedValues?.type, hint: '只用已有类型。' },
                      { key: 'goal', label: '目标', value: selectedValues?.goal, hint: '写清现实目标与推进方向。' },
                      { key: 'resources', label: '资源', value: selectedValues?.resources, hint: '写出真正能形成优势的资源。' },
                      { key: 'memberPolicy', label: '成员规则', value: selectedValues?.memberPolicy, hint: '写成员来源、晋升与控制结构。' },
                      { key: 'currentPhase', label: '当前阶段', value: selectedValues?.currentPhase, hint: '写当下压力、变化和临界点。' },
                      { key: 'notes', label: '召回别名 / 备注', value: selectedValues?.notes, hint: '用“别名：...；代号：...”记录公开称呼、隐秘代号和召回提示。' },
                    ],
                    requirements: ['不要写成善恶二元阵营。', '要让势力之间存在真实利益关系。', '势力名称必须像组织主体，不要写成动物、种族或单体角色。', 'notes 必须补可用于正文召回的别名、简称、称号或代号。', '不要改动已选中的人物和地图绑定。'],
                  })}
                  onResult={(raw) => {
                    const draft = parseDraftJson<Record<string, unknown>>(raw)
                    const values = form.getFieldsValue(true)
                    form.setFieldsValue({
                      ...values,
                      name: typeof draft.name === 'string' ? draft.name : values.name,
                      type: typeof draft.type === 'string'
                        ? normalizeFactionTypeValue(draft.type, values.type || 'faction')
                        : values.type,
                      goal: typeof draft.goal === 'string' ? draft.goal : values.goal,
                      resources: typeof draft.resources === 'string' ? draft.resources : values.resources,
                      memberPolicy: typeof draft.memberPolicy === 'string' ? draft.memberPolicy : values.memberPolicy,
                      currentPhase: typeof draft.currentPhase === 'string' ? draft.currentPhase : values.currentPhase,
                      notes: typeof draft.notes === 'string' ? draft.notes : values.notes,
                    })
                    markDraftDirty()
                  }}
                />
              )}
            >
              <div data-faction-view="detail" className="faction-workspace__detail-view">
                <div className="faction-editor__selection-summary">
                  <span>当前编辑对象</span>
                  <strong>{selectedValues?.name || selectedItem?.name || '未命名势力'}</strong>
                  <small>{selectedItem ? `${getFactionTypeLabel(selectedItem.type)} · 变更会在保存后写入正文召回上下文` : '保存后会成为可被人物、地图和阻力系统引用的组织主体。'}</small>
                </div>
                <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} className="faction-editor" onValuesChange={markDraftDirty}>
                  <div className="faction-editor__grid faction-editor__grid--core">
                    <Form.Item name="name" label="势力名称" rules={[{ required: true, message: '请填写势力名称' }]}><Input placeholder="例如：沉灯会 / 北陵军府 / 清川盐盟" /></Form.Item>
                    <Form.Item name="type" label="势力类型" rules={[{ required: true, message: '请选择势力类型' }]}>
                      <Select options={[...new Set(items.map((item) => item.type).concat(FACTION_TYPE_OPTIONS.map((item) => item.value)))].map((value) => ({ value, label: getFactionTypeLabel(value) }))} />
                    </Form.Item>
                    <Form.Item name="leaderCharacterId" label="领袖角色"><Select allowClear showSearch optionFilterProp="label" options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} placeholder="可留空" /></Form.Item>
                    <Form.Item name="currentPhase" label="当前阶段"><Input placeholder="例如：扩张前夜 / 关系重组" /></Form.Item>
                    <Form.Item name="goal" label="核心目标" className="faction-editor__full-row"><Input.TextArea rows={4} placeholder="写清现实目标、推进方向与不可退让的利益。" /></Form.Item>
                  </div>

                  <details className="faction-editor__advanced" open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
                    <summary><span>展开势力细节</span><small>地盘、资源、成员规则、召回备注和外部关系按需维护</small></summary>
                    <div className="faction-editor__grid">
                      <Form.Item name="territoryMapNodeIds" label="地盘节点"><Select mode="multiple" allowClear optionFilterProp="label" options={mapOptions.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
                      <Form.Item name="resources" label="资源"><Input.TextArea rows={4} /></Form.Item>
                      <Form.Item name="memberPolicy" label="成员规则"><Input.TextArea rows={4} /></Form.Item>
                      <Form.Item name="notes" label="召回别名 / 备注"><Input.TextArea rows={4} placeholder="例如：别名：影阁、暗阁；代号：夜灯。" /></Form.Item>
                      <Form.List name="externalRelations">
                        {(fields, { add, remove }) => (
                          <div className="faction-editor__relations">
                            <div className="faction-editor__relations-title"><span>外部关系</span><small>{fields.length} 条</small></div>
                            <div className="faction-editor__relations-scroll" data-faction-relations-scroll>
                              {fields.length > 0 ? fields.map((field) => (
                                <div key={field.key} className="faction-editor__relation-row">
                                  <Form.Item name={[field.name, 'targetFactionName']} rules={[{ required: true, message: '请填写目标势力' }]}><Input placeholder="目标势力名称" /></Form.Item>
                                  <Form.Item name={[field.name, 'relation']} rules={[{ required: true, message: '请选择关系' }]}><Select options={FACTION_RELATION_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} /></Form.Item>
                                  <Form.Item name={[field.name, 'note']}><Input placeholder="具体利益、旧怨、交易或秘密" /></Form.Item>
                                  <Button danger onClick={() => remove(field.name)}>删除</Button>
                                </div>
                              )) : <span className="faction-editor__empty">当前还没有录入外部关系。</span>}
                            </div>
                            <Button onClick={() => add({ relation: 'neutral' })}>新增关系</Button>
                          </div>
                        )}
                      </Form.List>
                    </div>
                  </details>
                </Form>

                <div className="faction-editor__meta">
                  <div className="faction-editor__meta-block faction-editor__meta-block--members">
                    <div className="faction-editor__meta-heading"><strong>关联人物</strong><small>{selectedCharacters.length} 人</small></div>
                    <div className="faction-workspace__chips faction-workspace__chips--bounded" data-faction-members-scroll>{selectedCharacters.length > 0 ? selectedCharacters.map((item) => <Tag key={item.id}>{item.fullName}</Tag>) : <span>当前还没有绑定人物。</span>}</div>
                  </div>
                  <div className="faction-editor__meta-block">
                    <div className="faction-editor__meta-heading"><strong>关联地盘</strong><small>{selectedTerritories.length} 处</small></div>
                    <div className="faction-workspace__chips faction-workspace__chips--bounded">{selectedTerritories.length > 0 ? selectedTerritories.map((item) => <Tag key={item.id}>{item.name}</Tag>) : <span>当前还没有绑定地图节点。</span>}</div>
                  </div>
                  <div className="faction-editor__meta-block faction-editor__meta-block--relations">
                    <div className="faction-editor__meta-heading"><strong>当前关系摘要</strong><small>{selectedRelations.length} 条</small></div>
                    <div className="faction-workspace__chips faction-workspace__chips--bounded" data-faction-relations-summary-scroll>{selectedRelations.length > 0 ? selectedRelations.map((item, index) => <Tag key={`${item.targetFactionName}-${index}`}>{`${item.targetFactionName || '未命名对象'} · ${FACTION_RELATION_TYPE_OPTIONS.find((option) => option.value === item.relation)?.label || item.relation}`}</Tag>) : <span>当前还没有录入外部关系。</span>}</div>
                  </div>
                </div>
              </div>
            </WorkspacePanel>
          </div>
        </div>
      </div>

      <Modal title="AI 生成·分批势力" open={generateOpen} onCancel={() => setGenerateOpen(false)} onOk={() => void handleStartAutoGenerate()} okText="启动后台生成" destroyOnHidden>
        <Form form={generateForm} layout="vertical">
          <Alert
            className="faction-workspace__generate-preset"
            type="info"
            showIcon
            message={`${generationPreset.scaleLabel}推荐总量：${generationPreset.count} 个；当前 ${existingFactionCount} 个，建议本次补 ${recommendedGenerateCount} 个`}
            description={`${generationPreset.rationale || '系统会按当前题材和目标字数估算势力规模。'} 每批建议 ${generationPreset.batchSize} 个。`}
          />
          <Form.Item name="count" label="生成数量" rules={[{ required: true, message: '请输入生成数量' }]}><InputNumber min={1} max={FACTION_AUTO_GENERATE_MAX_COUNT} className="workspace-input-number-full" /></Form.Item>
          <Form.Item name="batchSize" label="每批生成" rules={[{ required: true, message: '请输入每批数量' }]}><InputNumber min={1} max={FACTION_AUTO_GENERATE_MAX_BATCH_SIZE} className="workspace-input-number-full" /></Form.Item>
          <Form.Item name="relationshipDensity" label="关系密度"><Select options={FACTION_RELATIONSHIP_DENSITY_OPTIONS} /></Form.Item>
          <Form.Item name="preferredTypes" label="优先类型"><Select mode="multiple" options={FACTION_TYPE_OPTIONS} /></Form.Item>
          <Form.Item name="allowCharacterlessFactions" label="允许无人归属的隐性势力" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="preferExistingCharacters" label="优先复用现有人物" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="specialRequirements" label="额外要求"><Input.TextArea rows={6} placeholder="例如：强调商路、地下秩序、宗教化治理、家族继承危机等。" /></Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
