import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, InputNumber, List, Modal, Select, Space, Spin, Switch, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, ShareAltOutlined, StopOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { useNavigate } from 'react-router-dom'
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
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { loadWorkflowStats } from '../workflow'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import FactionGraphCanvas from './FactionGraphCanvas'
import './index.css'

interface Props {
  novelId: number
}

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
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation, registerClearHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<FactionFormValues>()
  const [generateForm] = Form.useForm<FactionBatchGenerationOptions>()
  const [items, setItems] = useState<Faction[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [stats, setStats] = useState({ total: 0, withLeaderCount: 0, territoryBoundCount: 0, relationCount: 0 })
  const [workflowStats, setWorkflowStats] = useState({ characterCount: 0, mapCount: 0 })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [graphLoading, setGraphLoading] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [generateOpen, setGenerateOpen] = useState(false)
  const [characterOptions, setCharacterOptions] = useState<Character[]>([])
  const [mapOptions, setMapOptions] = useState<MapNodeSummary[]>([])
  const [graphData, setGraphData] = useState<FactionGraphPayload>(EMPTY_FACTION_GRAPH)
  const [autoTask, setAutoTask] = useState<Task | null>(null)
  const [autoStatus, setAutoStatus] = useState<FactionAutoGenerateStatus>(EMPTY_AUTO_STATUS)
  const [autoStopping, setAutoStopping] = useState(false)

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId])
  const selectedValues = Form.useWatch([], form) as FactionFormValues | undefined
  const leaderNameMap = useMemo(
    () => new Map(characterOptions.map((item) => [item.id, item.fullName])),
    [characterOptions],
  )
  const selectedCharacterIds = useMemo(() => {
    if (!selectedItem) return []
    const selectedName = selectedItem.name.trim()
    return characterOptions
      .filter((character) => parseStringArray(character.campFactionIdsJson).some((value) => value === selectedName))
      .map((character) => character.id)
  }, [characterOptions, selectedItem])

  const refreshAutoStatus = useCallback(async () => {
    const latestTask = await window.electron.faction.getLatestAutoGenerateTask(novelId)
    setAutoTask(latestTask)
    if (!latestTask) {
      setAutoStatus(EMPTY_AUTO_STATUS)
      return
    }
    const status = await window.electron.faction.getAutoGenerateStatus(latestTask.id)
    setAutoStatus(status || EMPTY_AUTO_STATUS)
  }, [novelId])

  const refreshGraph = useCallback(async () => {
    setGraphLoading(true)
    try {
      const nextGraph = await window.electron.faction.getGraph({
        novelId,
        ...(selectedId ? { focusFactionId: selectedId } : {}),
      })
      setGraphData(normalizeFactionGraphPayload(nextGraph))
    } catch (error) {
      console.error(error)
    } finally {
      setGraphLoading(false)
    }
  }, [novelId, selectedId])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [page, nextStats, nextWorkflowStats, nextCharacters, nextMaps] = await Promise.all([
        window.electron.faction.query({ novelId, keyword, page: 1, pageSize: 500 }),
        window.electron.faction.getStats({ novelId }),
        loadWorkflowStats(novelId),
        window.electron.character.search(novelId, '', 120),
        window.electron.map.searchNodes(novelId, '', 120),
      ])
      setItems(page.items)
      setStats(nextStats)
      setWorkflowStats({ characterCount: nextWorkflowStats.characterCount, mapCount: nextWorkflowStats.mapCount })
      setCharacterOptions(nextCharacters)
      setMapOptions(nextMaps)
      setSelectedId((current) => {
        if (current && page.items.some((item) => item.id === current)) return current
        return page.items[0]?.id || null
      })
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [keyword, novelId])

  useEffect(() => { void refresh() }, [mutationToken, refresh])
  useEffect(() => { void refreshGraph() }, [refreshGraph])
  useEffect(() => { void refreshAutoStatus() }, [refreshAutoStatus])
  useEffect(() => { form.setFieldsValue(buildFormValues(selectedItem)) }, [form, selectedItem])
  useEffect(() => {
    registerSaveHandler(selectedId ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  })

  useEffect(() => {
    const reload = () => {
      void refresh()
      void refreshGraph()
      void refreshAutoStatus()
    }
    const unsubProgress = window.electron.on('task:progress', (payload: unknown) => {
      const data = payload as { taskId?: number }
      if (data?.taskId === autoTask?.id) reload()
    })
    const unsubStatus = window.electron.on('task:status-change', (payload: unknown) => {
      const data = payload as { taskId?: number }
      if (data?.taskId === autoTask?.id) reload()
    })
    const unsubComplete = window.electron.on('task:complete', (payload: unknown) => {
      const data = payload as { taskId?: number }
      if (data?.taskId === autoTask?.id) reload()
    })
    return () => {
      unsubProgress()
      unsubStatus()
      unsubComplete()
    }
  }, [autoTask?.id, refresh, refreshAutoStatus, refreshGraph])

  const handleCreate = () => {
    setSelectedId(null)
    form.setFieldsValue(EMPTY_VALUES)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
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
      }
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

  const handleDelete = async () => {
    if (!selectedItem) return
    try {
      await window.electron.faction.delete(selectedItem.id)
      setSelectedId(null)
      form.setFieldsValue(EMPTY_VALUES)
      notifyWorkspaceMutation()
      await Promise.all([refresh(), refreshGraph()])
      message.success(getUserFacingMessage('faction.deleted'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.deleteFailed'))
    }
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
          setSelectedId(null)
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
  }, [autoTask, form, novelId, notifyWorkspaceMutation, refresh, refreshAutoStatus])

  useEffect(() => {
    registerClearHandler(() => {
      handleClear()
    })
    return () => registerClearHandler(null)
  }, [handleClear, registerClearHandler])

  const handleStartAutoGenerate = async () => {
    try {
      const values = await generateForm.validateFields()
      await window.electron.faction.startAutoGenerate(novelId, values)
      setGenerateOpen(false)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoStarted'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'faction.autoStartFailed'))
    }
  }

  const handleResumeAutoGenerate = async () => {
    if (!autoTask?.id) return
    try {
      await window.electron.faction.resumeAutoGenerate(autoTask.id)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoResumed'))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'faction.autoResumeFailed'))
    }
  }

  const handleStopAutoGenerate = async () => {
    if (!autoTask?.id) return
    setAutoStopping(true)
    try {
      await window.electron.workflow.cancel(autoTask.id)
      await refreshAutoStatus()
      message.success(getUserFacingMessage('faction.autoStopRequested'))
    } catch (error) {
      console.error(error)
      message.error(getUserFacingMessage('faction.autoStopFailed'))
    } finally {
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

  return (
    <WorkspacePage
      className="novel-factions-page"
      layout="wide"
      eyebrow="世界与资源"
      title="势力系统"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => {
            generateForm.setFieldsValue({ count: Math.max(1, Math.min(48, 48 - items.length)), batchSize: 4, relationshipDensity: 'balanced', allowCharacterlessFactions: true, preferExistingCharacters: true, preferredTypes: ['organization', 'sect', 'family'], specialRequirements: '势力必须像小说里的真实组织主体，服务人物归属、资源争夺或主线冲突。' })
            setGenerateOpen(true)
          }}>AI 生成·分批势力</Button>
          {autoTask?.status === 'paused' ? <Button icon={<ShareAltOutlined />} onClick={() => void handleResumeAutoGenerate()}>继续任务</Button> : null}
          {hasRunningAutoTask ? <Button danger icon={<StopOutlined />} loading={autoStopping} onClick={() => void handleStopAutoGenerate()}>停止任务</Button> : null}
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存势力</Button>
          <Button icon={<ShareAltOutlined />} onClick={() => navigate(selectedItem ? `/novels/${novelId}/resistance?tab=factions&factionId=${selectedItem.id}` : `/novels/${novelId}/resistance?tab=factions`)}>去反派与阻力</Button>
          <Button icon={<PlusOutlined />} onClick={handleCreate}>新建势力</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { void refresh(); void refreshGraph(); void refreshAutoStatus() }}>刷新</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!selectedItem} onClick={() => void handleDelete()}>删除势力</Button>
        </Space>
      )}
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
          <WorkspaceMetric label="势力总数" value={stats.total} tone="warm" hint="建议让真正影响主线的主体先入场。" />
          <WorkspaceMetric label="已绑领袖" value={stats.withLeaderCount} hint="领袖越明确，人物归属越稳定。" />
          <WorkspaceMetric label="已绑地盘" value={stats.territoryBoundCount} hint="地图绑定后，冲突空间才会更具体。" />
          <WorkspaceMetric label="势力关系" value={stats.relationCount} hint="联盟、操控、交易、渗透都算有效关系。" />
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

      <div className="faction-workspace">
        <WorkspacePanel className="faction-workspace__sidebar" title="势力列表">
          <Input.Search value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索势力、目标、资源或阶段" allowClear />
          <List
            loading={loading}
            size="small"
            dataSource={items}
            locale={{ emptyText: '当前没有势力记录' }}
            renderItem={(item) => (
              <List.Item className={`faction-list-card ${selectedId === item.id ? 'faction-list-card--active' : ''}`} onClick={() => setSelectedId(item.id)}>
                <List.Item.Meta
                  title={<div className="faction-list-card__title"><strong>{item.name}</strong><Tag>{getFactionTypeLabel(item.type)}</Tag></div>}
                  description={<div className="faction-list-card__desc">{buildFactionListSummary(item, typeof item.leaderCharacterId === 'number' ? leaderNameMap.get(item.leaderCharacterId) : undefined)}</div>}
                />
              </List.Item>
            )}
          />
        </WorkspacePanel>

        <div className="faction-workspace__main">
          <WorkspacePanel
            title="势力关系图谱"
            extra={<Tag color="processing">{selectedId ? '当前聚焦已收窄' : '当前显示全局网络'}</Tag>}
          >
            {graphLoading ? <div className="faction-workspace__empty"><Spin /></div> : <FactionGraphCanvas data={graphData} selectedFactionId={selectedId} onFactionSelect={setSelectedId} />}
            {graphData.unalignedCharacters.length > 0 ? (
              <div className="faction-workspace__orphans">
                <strong>当前无固定势力的人物</strong>
                <div className="faction-workspace__chips">
                  {graphData.unalignedCharacters.slice(0, 10).map((character) => <Tag key={character.id}>{character.fullName}</Tag>)}
                </div>
              </div>
            ) : null}
          </WorkspacePanel>

          <WorkspacePanel
            title={selectedItem ? `编辑：${selectedItem.name}` : '新建势力'}
            extra={(
              <Space wrap>
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
                    ],
                    requirements: ['不要写成善恶二元阵营。', '要让势力之间存在真实利益关系。', '势力名称必须像组织主体，不要写成动物、种族或单体角色。', '不要改动已选中的人物和地图绑定。'],
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
                    })
                  }}
                />
                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void handleSave()}>保存</Button>
              </Space>
            )}
          >
            <Form form={form} layout="vertical" initialValues={EMPTY_VALUES} className="faction-editor">
              <div className="faction-editor__grid">
                <Form.Item name="name" label="势力名称" rules={[{ required: true, message: '请填写势力名称' }]}><Input placeholder="例如：沉灯会 / 北陵军府 / 清川盐盟" /></Form.Item>
                <Form.Item
                  name="type"
                  label="势力类型"
                  rules={[{ required: true, message: '请选择势力类型' }]}
                >
                  <Select
                    options={[...new Set(items.map((item) => item.type).concat(FACTION_TYPE_OPTIONS.map((item) => item.value)))]
                      .map((value) => ({ value, label: getFactionTypeLabel(value) }))}
                  />
                </Form.Item>
                <Form.Item name="leaderCharacterId" label="领袖角色"><Select allowClear showSearch optionFilterProp="label" options={characterOptions.map((item) => ({ value: item.id, label: item.fullName }))} placeholder="可留空" /></Form.Item>
                <Form.Item name="territoryMapNodeIds" label="地盘节点"><Select mode="multiple" allowClear optionFilterProp="label" options={mapOptions.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
                <Form.Item name="goal" label="目标"><Input.TextArea rows={6} /></Form.Item>
                <Form.Item name="currentPhase" label="当前阶段"><Input.TextArea rows={6} /></Form.Item>
                <Form.Item name="resources" label="资源"><Input.TextArea rows={6} /></Form.Item>
                <Form.Item name="memberPolicy" label="成员规则"><Input.TextArea rows={6} /></Form.Item>
                <Form.List name="externalRelations">
                  {(fields, { add, remove }) => (
                    <div className="faction-editor__relations">
                      <div className="faction-editor__relations-title">外部关系</div>
                      {fields.map((field) => (
                        <div key={field.key} className="faction-editor__relation-row">
                          <Form.Item name={[field.name, 'targetFactionName']} rules={[{ required: true, message: '请填写目标势力' }]}><Input placeholder="目标势力名称" /></Form.Item>
                          <Form.Item name={[field.name, 'relation']} rules={[{ required: true, message: '请选择关系' }]}><Select options={FACTION_RELATION_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} /></Form.Item>
                          <Form.Item name={[field.name, 'note']}><Input placeholder="具体利益、旧怨、交易或秘密" /></Form.Item>
                          <Button danger onClick={() => remove(field.name)}>删除</Button>
                        </div>
                      ))}
                      <Button onClick={() => add({ relation: 'neutral' })}>新增关系</Button>
                    </div>
                  )}
                </Form.List>
              </div>
            </Form>

            <div className="faction-editor__meta">
              <div className="faction-editor__meta-block"><strong>关联人物</strong><div className="faction-workspace__chips">{selectedCharacters.length > 0 ? selectedCharacters.map((item) => <Tag key={item.id}>{item.fullName}</Tag>) : <span>当前还没有绑定人物。</span>}</div></div>
              <div className="faction-editor__meta-block"><strong>关联地盘</strong><div className="faction-workspace__chips">{selectedTerritories.length > 0 ? selectedTerritories.map((item) => <Tag key={item.id}>{item.name}</Tag>) : <span>当前还没有绑定地图节点。</span>}</div></div>
              <div className="faction-editor__meta-block"><strong>当前关系摘要</strong><div className="faction-workspace__chips">{selectedRelations.length > 0 ? selectedRelations.map((item, index) => <Tag key={`${item.targetFactionName}-${index}`}>{`${item.targetFactionName || '未命名对象'} · ${FACTION_RELATION_TYPE_OPTIONS.find((option) => option.value === item.relation)?.label || item.relation}`}</Tag>) : <span>当前还没有录入外部关系。</span>}</div></div>
            </div>
          </WorkspacePanel>
        </div>
      </div>

      <Modal title="AI 生成·分批势力" open={generateOpen} onCancel={() => setGenerateOpen(false)} onOk={() => void handleStartAutoGenerate()} okText="启动后台生成" destroyOnHidden>
        <Form form={generateForm} layout="vertical">
          <Form.Item name="count" label="目标总数" rules={[{ required: true, message: '请输入目标总数' }]}><InputNumber min={1} max={FACTION_AUTO_GENERATE_MAX_COUNT} className="workspace-input-number-full" /></Form.Item>
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
