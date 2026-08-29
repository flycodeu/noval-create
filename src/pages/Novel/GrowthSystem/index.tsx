import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { GrowthSystemDashboard, GrowthTrack, ResourcePool, RewardCostEvent } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'
import './index.css'

interface Props { novelId: number }

type GrowthSection = 'tracks' | 'pools' | 'events'

interface TrackValues {
  trackType: GrowthTrack['trackType']
  title: string
  currentTier: string
  stageGoal: string
  nextGoal: string
  bottleneck: string
  scarceResource: string
  acquirePath: string
  consumptionRule: string
  failureCost: string
  rewardCadence: string
  linkedVolumeId?: number
  linkedChapterId?: number
}

interface PoolValues {
  name: string
  poolType: ResourcePool['poolType']
  scarcityLevel: ResourcePool['scarcityLevel']
  currentReserve: string
  replenishPath: string
  consumptionRule: string
  failureCost: string
  pressureSource: string
  linkedVolumeId?: number
}

interface EventValues {
  chapterId?: number
  eventType: RewardCostEvent['eventType']
  title: string
  summary: string
  trackId?: number
  resourcePoolId?: number
  deltaValue: string
  costResolutionState: 'new' | 'ongoing' | 'resolved' | 'evaporated'
  rewardLevel: 'none' | 'partial' | 'major'
  nextBottleneck: string
  linkedVolumeId?: number
}

function text(value?: string | null): string {
  return value?.trim() || ''
}

function scarcityTone(level: ResourcePool['scarcityLevel']) {
  if (level === 'critical') return 'error'
  if (level === 'scarce') return 'warning'
  if (level === 'abundant') return 'success'
  return 'processing'
}

function trackLabel(type: GrowthTrack['trackType']) {
  if (type === 'organization') return '组织成长'
  if (type === 'relationship') return '关系成长'
  return '人物成长'
}

function poolTypeLabel(type: ResourcePool['poolType']) {
  const labels: Record<ResourcePool['poolType'], string> = {
    material: '物资',
    authority: '权力',
    relationship: '关系',
    knowledge: '知识',
    time: '时间',
  }
  return labels[type] || type
}

function scarcityLabel(level: ResourcePool['scarcityLevel']) {
  const labels: Record<ResourcePool['scarcityLevel'], string> = {
    abundant: '充裕',
    balanced: '平衡',
    scarce: '稀缺',
    critical: '临界',
  }
  return labels[level] || level
}

function eventTypeLabel(type: RewardCostEvent['eventType']) {
  if (type === 'cost') return '代价'
  if (type === 'bottleneck') return '瓶颈'
  return '收益'
}

function eventStateLabel(state?: EventValues['costResolutionState'] | null) {
  if (state === 'ongoing') return '进行中'
  if (state === 'resolved') return '已解决'
  if (state === 'evaporated') return '已蒸发'
  return '待处理'
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

const EMPTY_GROWTH_SUMMARY: GrowthSystemDashboard['summary'] = {
  trackCount: 0,
  characterTrackCount: 0,
  organizationTrackCount: 0,
  relationshipTrackCount: 0,
  criticalPoolCount: 0,
  unresolvedCostCount: 0,
  chapterWritebackCoverage: 0,
}

export default function GrowthSystemPage({ novelId }: Props) {
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [trackForm] = Form.useForm<TrackValues>()
  const [poolForm] = Form.useForm<PoolValues>()
  const [eventForm] = Form.useForm<EventValues>()
  const [dashboard, setDashboard] = useState<GrowthSystemDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [trackOpen, setTrackOpen] = useState(false)
  const [poolOpen, setPoolOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)
  const [editingTrack, setEditingTrack] = useState<GrowthTrack | null>(null)
  const [editingPool, setEditingPool] = useState<ResourcePool | null>(null)
  const refreshRequestRef = React.useRef(0)
  const saveActionRef = React.useRef(false)
  const [editingEvent, setEditingEvent] = useState<RewardCostEvent | null>(null)
  const [bindChapterId, setBindChapterId] = useState<number | null>(null)
  const [bindVolumeId, setBindVolumeId] = useState<number | null>(null)
  const [bindTrackIds, setBindTrackIds] = useState<number[]>([])
  const [bindPoolIds, setBindPoolIds] = useState<number[]>([])
  const [bindEventIds, setBindEventIds] = useState<number[]>([])
  const [bindCadence, setBindCadence] = useState('')
  const [activeSection, setActiveSection] = useState<GrowthSection>('tracks')
  const [selectedTrackId, setSelectedTrackId] = useState<number | null>(null)
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const editorDirtyRef = React.useRef(false)

  const tracks = useMemo(() => dashboard?.tracks || [], [dashboard])
  const pools = useMemo(() => dashboard?.pools || [], [dashboard])
  const events = useMemo(() => dashboard?.events || [], [dashboard])
  const chapters = dashboard?.chapters || []
  const volumes = dashboard?.volumes || []
  const summary = dashboard?.summary || EMPTY_GROWTH_SUMMARY
  const trackValues = (Form.useWatch([], trackForm) as Partial<TrackValues> | undefined) || {}
  const poolValues = (Form.useWatch([], poolForm) as Partial<PoolValues> | undefined) || {}
  const eventValues = (Form.useWatch([], eventForm) as Partial<EventValues> | undefined) || {}
  const selectedTrack = useMemo(() => tracks.find((item) => item.id === selectedTrackId) || tracks[0] || null, [selectedTrackId, tracks])
  const selectedPool = useMemo(() => pools.find((item) => item.id === selectedPoolId) || pools[0] || null, [pools, selectedPoolId])
  const selectedEvent = useMemo(() => events.find((item) => item.id === selectedEventId) || events[0] || null, [events, selectedEventId])

  const health = useMemo(() => {
    if (!dashboard) return 0
    const raw = 82 + Math.min(20, summary.trackCount * 3)
      - summary.criticalPoolCount * 10
      - summary.unresolvedCostCount * 4
      + Math.round(summary.chapterWritebackCoverage * 18)
    return Math.max(0, Math.min(100, raw))
  }, [dashboard, summary])

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const result = await window.electron.growthSystem.getDashboard(novelId)
      if (refreshRequestRef.current !== requestId) return
      setDashboard(result)
      const nextChapters = result.chapters || []
      const nextVolumes = result.volumes || []
      setSelectedTrackId((current) => current && result.tracks.some((item) => item.id === current) ? current : result.tracks[0]?.id || null)
      setSelectedPoolId((current) => current && result.pools.some((item) => item.id === current) ? current : result.pools[0]?.id || null)
      setSelectedEventId((current) => current && result.events.some((item) => item.id === current) ? current : result.events[0]?.id || null)
      const nextTrackIds = new Set((result.tracks || []).map((item) => item.id))
      const nextPoolIds = new Set((result.pools || []).map((item) => item.id))
      const nextEventIds = new Set((result.events || []).map((item) => item.id))
      setBindChapterId((current) => current && nextChapters.some((item) => item.id === current)
        ? current
        : nextChapters[0]?.id || null)
      setBindVolumeId((current) => current && nextVolumes.some((item) => item.id === current)
        ? current
        : nextVolumes[0]?.id || null)
      setBindTrackIds((current) => current.filter((id) => nextTrackIds.has(id)))
      setBindPoolIds((current) => current.filter((id) => nextPoolIds.has(id)))
      setBindEventIds((current) => current.filter((id) => nextEventIds.has(id)))
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [novelId])

  useEffect(() => { void refresh() }, [mutationToken, refresh])

  const openTrack = (track?: GrowthTrack) => {
    setEditingTrack(track || null)
    editorDirtyRef.current = false
    setHasUnsavedChanges(false)
    trackForm.setFieldsValue(track ? {
      trackType: track.trackType,
      title: track.title,
      currentTier: track.currentTier || '',
      stageGoal: track.stageGoal || '',
      nextGoal: track.nextGoal || '',
      bottleneck: track.bottleneck || '',
      scarceResource: track.scarceResource || '',
      acquirePath: track.acquirePath || '',
      consumptionRule: track.consumptionRule || '',
      failureCost: track.failureCost || '',
      rewardCadence: track.rewardCadence || '',
      linkedVolumeId: track.linkedVolumeId || undefined,
      linkedChapterId: track.linkedChapterId || undefined,
    } : {
      trackType: 'character',
      title: '',
      currentTier: '',
      stageGoal: '',
      nextGoal: '',
      bottleneck: '',
      scarceResource: '',
      acquirePath: '',
      consumptionRule: '',
      failureCost: '',
      rewardCadence: '',
      linkedVolumeId: undefined,
      linkedChapterId: undefined,
    })
    setTrackOpen(true)
  }

  const openPool = (pool?: ResourcePool) => {
    setEditingPool(pool || null)
    editorDirtyRef.current = false
    setHasUnsavedChanges(false)
    poolForm.setFieldsValue(pool ? {
      name: pool.name,
      poolType: pool.poolType,
      scarcityLevel: pool.scarcityLevel,
      currentReserve: pool.currentReserve || '',
      replenishPath: pool.replenishPath || '',
      consumptionRule: pool.consumptionRule || '',
      failureCost: pool.failureCost || '',
      pressureSource: pool.pressureSource || '',
      linkedVolumeId: pool.linkedVolumeId || undefined,
    } : {
      name: '',
      poolType: 'material',
      scarcityLevel: 'balanced',
      currentReserve: '',
      replenishPath: '',
      consumptionRule: '',
      failureCost: '',
      pressureSource: '',
      linkedVolumeId: undefined,
    })
    setPoolOpen(true)
  }

  const openEvent = (event?: RewardCostEvent) => {
    setEditingEvent(event || null)
    editorDirtyRef.current = false
    setHasUnsavedChanges(false)
    eventForm.setFieldsValue(event ? {
      chapterId: event.chapterId || undefined,
      eventType: event.eventType,
      title: event.title,
      summary: event.summary || '',
      trackId: event.trackId || undefined,
      resourcePoolId: event.resourcePoolId || undefined,
      deltaValue: event.deltaValue || '',
      costResolutionState: event.costResolutionState || 'new',
      rewardLevel: event.rewardLevel || 'none',
      nextBottleneck: event.nextBottleneck || '',
      linkedVolumeId: event.linkedVolumeId || undefined,
    } : {
      chapterId: undefined,
      eventType: 'reward',
      title: '',
      summary: '',
      trackId: undefined,
      resourcePoolId: undefined,
      deltaValue: '',
      costResolutionState: 'new',
      rewardLevel: 'none',
      nextBottleneck: '',
      linkedVolumeId: undefined,
    })
    setEventOpen(true)
  }

  const closeEditor = useCallback((force = false) => {
    const commit = () => {
      editorDirtyRef.current = false
      setHasUnsavedChanges(false)
      setTrackOpen(false)
      setPoolOpen(false)
      setEventOpen(false)
      setEditingTrack(null)
      setEditingPool(null)
      setEditingEvent(null)
    }
    if (!force && editorDirtyRef.current) {
      Modal.confirm({
        title: '当前成长编辑还有未保存修改',
        content: '关闭编辑会丢弃当前修改，是否继续？',
        okText: '放弃修改并关闭',
        cancelText: '留下继续编辑',
        onOk: commit,
      })
      return
    }
    commit()
  }, [])

  const confirmDelete = useCallback((title: string, content: string, action: () => Promise<unknown>) => {
    Modal.confirm({
      title,
      content,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await action()
          await refresh()
          notifyWorkspaceMutation()
          message.success(getUserFacingMessage('growthSystem.deleted'))
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.deleteFailed'))
        }
      },
    })
  }, [notifyWorkspaceMutation, refresh])

  const handleDeleteTrack = useCallback((track: GrowthTrack) => {
    confirmDelete(`删除成长轨道「${track.title}」？`, '删除后相关绑定不会自动改写，请确认这条轨道已经不再使用。', () => (
      window.electron.growthSystem.deleteTrack(novelId, track.id)
    ))
  }, [confirmDelete, novelId])

  const handleDeletePool = useCallback((pool: ResourcePool) => {
    confirmDelete(`删除资源池「${pool.name}」？`, '删除后相关章节合同和卷级绑定不会自动改写，请确认这条资源池已经不再使用。', () => (
      window.electron.growthSystem.deletePool(novelId, pool.id)
    ))
  }, [confirmDelete, novelId])

  const handleDeleteEvent = useCallback((event: RewardCostEvent) => {
    confirmDelete(`删除章节回写「${event.title}」？`, '删除后相关章节合同和卷级绑定不会自动改写，请确认这条回写记录已经不再使用。', () => (
      window.electron.growthSystem.deleteEvent(novelId, event.id)
    ))
  }, [confirmDelete, novelId])

  const saveTrack = useCallback(async () => {
    if (saveActionRef.current) return
    saveActionRef.current = true
    try {
      const values = await trackForm.validateFields().catch(() => null)
      if (!values) return
      if (!text(values.title)) {
        message.warning(getUserFacingMessage('growthSystem.trackTitleRequired'))
        return
      }
      setSaving(true)
      await window.electron.growthSystem.upsertTrack(novelId, { ...values, id: editingTrack?.id, title: text(values.title) })
      closeEditor(true)
      await refresh(); notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      saveActionRef.current = false
      setSaving(false)
    }
  }, [closeEditor, editingTrack?.id, notifyWorkspaceMutation, refresh, trackForm, novelId])

  const savePool = useCallback(async () => {
    if (saveActionRef.current) return
    saveActionRef.current = true
    try {
      const values = await poolForm.validateFields().catch(() => null)
      if (!values) return
      if (!text(values.name)) {
        message.warning(getUserFacingMessage('growthSystem.poolNameRequired'))
        return
      }
      setSaving(true)
      await window.electron.growthSystem.upsertPool(novelId, { ...values, id: editingPool?.id, name: text(values.name) })
      closeEditor(true)
      await refresh(); notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      saveActionRef.current = false
      setSaving(false)
    }
  }, [closeEditor, editingPool?.id, notifyWorkspaceMutation, poolForm, refresh, novelId])

  const saveEvent = useCallback(async () => {
    if (saveActionRef.current) return
    saveActionRef.current = true
    try {
      const values = await eventForm.validateFields().catch(() => null)
      if (!values) return
      if (!text(values.title)) {
        message.warning(getUserFacingMessage('growthSystem.writebackTitleRequired'))
        return
      }
      setSaving(true)
      await window.electron.growthSystem.upsertEvent(novelId, { ...values, id: editingEvent?.id, title: text(values.title) })
      closeEditor(true)
      await refresh(); notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      saveActionRef.current = false
      setSaving(false)
    }
  }, [closeEditor, editingEvent?.id, eventForm, notifyWorkspaceMutation, novelId, refresh])

  const saveHandler = useCallback(() => {
    if (trackOpen) {
      void saveTrack()
      return
    }
    if (poolOpen) {
      void savePool()
      return
    }
    if (eventOpen) {
      void saveEvent()
    }
  }, [eventOpen, poolOpen, saveEvent, savePool, saveTrack, trackOpen])

  useEffect(() => {
    registerSaveHandler(trackOpen || poolOpen || eventOpen ? saveHandler : null)
    return () => registerSaveHandler(null)
  }, [eventOpen, poolOpen, registerSaveHandler, saveHandler, trackOpen])
  useEffect(() => {
    registerEscapeHandler(() => {
      if (trackOpen || poolOpen || eventOpen) closeEditor()
    })
    return () => registerEscapeHandler(null)
  }, [closeEditor, eventOpen, poolOpen, registerEscapeHandler, trackOpen])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorDirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return (
    <WorkspacePage
      className="novel-growth-system-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="剧情与伏笔 / 成长代价"
      title="成长资源代价系统"
      description="统一维护阶段目标、瓶颈、获取路径、消耗机制与失败代价，并把收益/代价回写绑定到合同与卷级节奏。"
      chrome="shared"
      actionContract={{
        primary: { key: 'create-track', label: '新建成长轨道', icon: <PlusOutlined />, onClick: () => openTrack() },
        secondary: [
          { key: 'create-pool', label: '新建资源池', icon: <PlusOutlined />, onClick: () => openPool() },
          { key: 'create-event', label: '章节回写', icon: <PlusOutlined />, onClick: () => openEvent() },
        ],
      }}
      contextSummary={<WorkspaceContextSummary items={[{ label: '当前项目', value: currentNovel?.title || '未命名小说' }, { label: '章节数', value: chapters.length }, { label: '卷数', value: volumes.length }, { label: '回写事件', value: events.length }]} />}
      metrics={<><WorkspaceMetric label="收益循环健康度" value={`${health}/100`} tone={health < 60 ? 'warm' : 'cool'} /><WorkspaceMetric label="成长轨道" value={summary.trackCount} /><WorkspaceMetric label="临界资源池" value={summary.criticalPoolCount} tone={summary.criticalPoolCount > 0 ? 'warm' : 'default'} /><WorkspaceMetric label="未解代价链" value={summary.unresolvedCostCount} tone={summary.unresolvedCostCount > 0 ? 'warm' : 'default'} /></>}
    >
      {summary.criticalPoolCount > 0 ? <Alert showIcon type="warning" message="存在稀缺/临界资源池" description="建议先处理临界资源，再把收益/代价挂到正文合同。" /> : null}
      <div className="novel-growth-system__status-rail" data-growth-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`novel-growth-system__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{hasUnsavedChanges ? '成长编辑器有未保存修改' : '成长系统与当前项目数据同步'}</strong>
      </div>

      <div className="novel-growth-system__workspace">
        <WorkspacePanel
          title="成长系统目录"
          description="一次只处理一个对象，避免轨道、资源池和回写事件互相抢占注意力。"
          className="novel-growth-system__list-panel"
          bodyClassName="novel-growth-system__list-body"
        >
          <div className="novel-growth-system__section-tabs" role="tablist" data-growth-focus-tabs>
            {([
              ['tracks', '成长轨道', summary.trackCount],
              ['pools', '资源池', pools.length],
              ['events', '章节回写', events.length],
            ] as Array<[GrowthSection, string, number]>).map(([key, label, count]) => (
              <button type="button" role="tab" aria-selected={activeSection === key} className={activeSection === key ? 'is-active' : ''} key={key} onClick={() => setActiveSection(key)}>
                <span>{label}</span><strong>{count}</strong>
              </button>
            ))}
          </div>

          {activeSection === 'tracks' ? (
            <div className="novel-growth-system__table-scroll" data-growth-track-list>
              <Table<GrowthTrack>
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                dataSource={tracks}
                rowClassName={(record) => record.id === selectedTrack?.id ? 'is-selected' : ''}
                onRow={(record) => ({ onClick: () => setSelectedTrackId(record.id) })}
                columns={[
                  { title: '轨道', dataIndex: 'title', width: 230 },
                  { title: '类型', dataIndex: 'trackType', width: 104, responsive: ['md'], render: (value) => <Tag color={value === 'organization' ? 'purple' : value === 'relationship' ? 'cyan' : 'blue'}>{trackLabel(value)}</Tag> },
                  { title: '当前瓶颈', dataIndex: 'bottleneck', width: 220, responsive: ['lg'], render: (value) => value || '未设置' },
                  { title: '操作', width: 116, render: (_value, record) => <Space wrap><Button size="small" onClick={(event) => { event.stopPropagation(); openTrack(record) }}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除成长轨道 ${record.title}`} onClick={(event) => { event.stopPropagation(); handleDeleteTrack(record) }}>删除</Button></Space> },
                ]}
              />
            </div>
          ) : null}
          {activeSection === 'pools' ? (
            <div className="novel-growth-system__table-scroll" data-growth-pool-list>
              <Table<ResourcePool>
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                dataSource={pools}
                rowClassName={(record) => record.id === selectedPool?.id ? 'is-selected' : ''}
                onRow={(record) => ({ onClick: () => setSelectedPoolId(record.id) })}
                columns={[
                  { title: '资源池', dataIndex: 'name', width: 220 },
                  { title: '类型', dataIndex: 'poolType', width: 104, responsive: ['md'], render: (value) => poolTypeLabel(value) },
                  { title: '稀缺度', dataIndex: 'scarcityLevel', width: 104, responsive: ['md'], render: (value) => <Tag color={scarcityTone(value)}>{scarcityLabel(value)}</Tag> },
                  { title: '补给路径', dataIndex: 'replenishPath', width: 220, responsive: ['lg'], render: (value) => value || '未设置' },
                  { title: '操作', width: 116, render: (_value, record) => <Space wrap><Button size="small" onClick={(event) => { event.stopPropagation(); openPool(record) }}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除资源池 ${record.name}`} onClick={(event) => { event.stopPropagation(); handleDeletePool(record) }}>删除</Button></Space> },
                ]}
              />
            </div>
          ) : null}
          {activeSection === 'events' ? (
            <div className="novel-growth-system__table-scroll" data-growth-event-list>
              <Table<RewardCostEvent>
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                dataSource={events}
                rowClassName={(record) => record.id === selectedEvent?.id ? 'is-selected' : ''}
                onRow={(record) => ({ onClick: () => setSelectedEventId(record.id) })}
                columns={[
                  { title: '章节', width: 80, responsive: ['md'], render: (_value, record) => `第${record.chapterNumSnapshot || '?'}章` },
                  { title: '类型', dataIndex: 'eventType', width: 90, responsive: ['md'], render: (value) => <Tag color={value === 'cost' ? 'volcano' : value === 'bottleneck' ? 'orange' : 'green'}>{eventTypeLabel(value)}</Tag> },
                  { title: '回写事件', dataIndex: 'title', width: 230 },
                  { title: '状态', dataIndex: 'costResolutionState', width: 120, responsive: ['lg'], render: (value) => eventStateLabel(value) },
                  { title: '操作', width: 116, render: (_value, record) => <Space wrap><Button size="small" onClick={(event) => { event.stopPropagation(); openEvent(record) }}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除回写事件 ${record.title}`} onClick={(event) => { event.stopPropagation(); handleDeleteEvent(record) }}>删除</Button></Space> },
                ]}
              />
            </div>
          ) : null}
        </WorkspacePanel>

        <WorkspacePanel
          title="当前详情"
          description={activeSection === 'tracks' ? selectedTrack?.title || '选择一条成长轨道' : activeSection === 'pools' ? selectedPool?.name || '选择一个资源池' : selectedEvent?.title || '选择一条章节回写'}
          sticky
          className="novel-growth-system__detail-panel"
          bodyClassName="novel-growth-system__detail-body"
        >
          {activeSection === 'tracks' && selectedTrack ? (
            <div data-growth-current-detail>
              <div className="novel-growth-system__detail-heading"><div><span className="novel-kicker">{trackLabel(selectedTrack.trackType)}</span><h3>{selectedTrack.title}</h3></div><Tag color="blue">当前轨道</Tag></div>
              <div className="novel-growth-system__detail-facts">
                <div><span>当前层级</span><strong>{selectedTrack.currentTier || '未设置'}</strong></div>
                <div><span>下一目标</span><strong>{selectedTrack.nextGoal || '未设置'}</strong></div>
                <div><span>阶段目标</span><strong>{selectedTrack.stageGoal || '未设置'}</strong></div>
                <div><span>当前瓶颈</span><strong>{selectedTrack.bottleneck || '未设置'}</strong></div>
                <div><span>稀缺资源</span><strong>{selectedTrack.scarceResource || '未设置'}</strong></div>
                <div><span>关联章节</span><strong>{selectedTrack.linkedChapterId ? `章节#${selectedTrack.linkedChapterId}` : '未绑定'}</strong></div>
              </div>
              <details className="novel-growth-system__detail-disclosure" open><summary>获取、消耗与失败代价</summary><div className="novel-growth-system__detail-copy"><p><strong>获取路径：</strong>{selectedTrack.acquirePath || '未设置'}</p><p><strong>消耗机制：</strong>{selectedTrack.consumptionRule || '未设置'}</p><p><strong>失败代价：</strong>{selectedTrack.failureCost || '未设置'}</p><p><strong>奖励节奏：</strong>{selectedTrack.rewardCadence || '未设置'}</p></div></details>
              <div className="novel-growth-system__detail-actions"><Button type="primary" onClick={() => openTrack(selectedTrack)}>编辑轨道</Button><Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteTrack(selectedTrack)}>删除</Button></div>
            </div>
          ) : null}
          {activeSection === 'pools' && selectedPool ? (
            <div data-growth-current-detail>
              <div className="novel-growth-system__detail-heading"><div><span className="novel-kicker">{poolTypeLabel(selectedPool.poolType)}</span><h3>{selectedPool.name}</h3></div><Tag color={scarcityTone(selectedPool.scarcityLevel)}>{scarcityLabel(selectedPool.scarcityLevel)}</Tag></div>
              <div className="novel-growth-system__detail-facts"><div><span>当前存量</span><strong>{selectedPool.currentReserve || '未设置'}</strong></div><div><span>压力来源</span><strong>{selectedPool.pressureSource || '未设置'}</strong></div><div><span>补给路径</span><strong>{selectedPool.replenishPath || '未设置'}</strong></div><div><span>关联卷</span><strong>{selectedPool.linkedVolumeId ? `卷#${selectedPool.linkedVolumeId}` : '未绑定'}</strong></div></div>
              <details className="novel-growth-system__detail-disclosure" open><summary>资源消耗规则</summary><div className="novel-growth-system__detail-copy"><p><strong>消耗机制：</strong>{selectedPool.consumptionRule || '未设置'}</p><p><strong>耗尽后果：</strong>{selectedPool.failureCost || '未设置'}</p></div></details>
              <div className="novel-growth-system__detail-actions"><Button type="primary" onClick={() => openPool(selectedPool)}>编辑资源池</Button><Button danger icon={<DeleteOutlined />} onClick={() => handleDeletePool(selectedPool)}>删除</Button></div>
            </div>
          ) : null}
          {activeSection === 'events' && selectedEvent ? (
            <div data-growth-current-detail>
              <div className="novel-growth-system__detail-heading"><div><span className="novel-kicker">第{selectedEvent.chapterNumSnapshot || '?'}章 · {eventTypeLabel(selectedEvent.eventType)}</span><h3>{selectedEvent.title}</h3></div><Tag>{eventStateLabel(selectedEvent.costResolutionState)}</Tag></div>
              <div className="novel-growth-system__detail-facts"><div><span>变化量</span><strong>{selectedEvent.deltaValue || '未设置'}</strong></div><div><span>回报级别</span><strong>{selectedEvent.rewardLevel || 'none'}</strong></div><div><span>关联轨道</span><strong>{selectedEvent.trackId ? tracks.find((item) => item.id === selectedEvent.trackId)?.title || `轨道#${selectedEvent.trackId}` : '未绑定'}</strong></div><div><span>关联资源池</span><strong>{selectedEvent.resourcePoolId ? pools.find((item) => item.id === selectedEvent.resourcePoolId)?.name || `资源池#${selectedEvent.resourcePoolId}` : '未绑定'}</strong></div></div>
              <details className="novel-growth-system__detail-disclosure" open><summary>章节回写说明</summary><div className="novel-growth-system__detail-copy"><p>{selectedEvent.summary || '未填写回写说明。'}</p><p><strong>下一阶段卡点：</strong>{selectedEvent.nextBottleneck || '未设置'}</p></div></details>
              <div className="novel-growth-system__detail-actions"><Button type="primary" onClick={() => openEvent(selectedEvent)}>编辑回写</Button><Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteEvent(selectedEvent)}>删除</Button></div>
            </div>
          ) : <div className="novel-empty">当前没有可展示的详情。</div>}
        </WorkspacePanel>
      </div>

      <details className="novel-growth-system__binding-disclosure" data-growth-binding>
        <summary>展开合同与卷级绑定</summary>
        <div className="novel-growth-system__binding-grid">
          <div className="novel-growth-system__binding-group"><strong>绑定章节合同</strong><Select value={bindChapterId || undefined} onChange={(value) => setBindChapterId(value || null)} options={chapters.map((chapter) => ({ value: chapter.id, label: `第${chapter.chapterNum}章 · ${chapter.title || '未命名章节'}` }))} placeholder="选择章节" /><Select mode="multiple" value={bindTrackIds} onChange={(value) => setBindTrackIds(value as number[])} options={tracks.map((track) => ({ value: track.id, label: track.title }))} placeholder="成长轨道" /><Select mode="multiple" value={bindPoolIds} onChange={(value) => setBindPoolIds(value as number[])} options={pools.map((pool) => ({ value: pool.id, label: pool.name }))} placeholder="资源池" /><Select mode="multiple" value={bindEventIds} onChange={(value) => setBindEventIds(value as number[])} options={events.map((event) => ({ value: event.id, label: `第${event.chapterNumSnapshot || '?'}章 · ${event.title}` }))} placeholder="回写事件" /><Button type="primary" disabled={!bindChapterId} onClick={() => bindChapterId && void window.electron.growthSystem.bindChapterContract(novelId, { chapterId: bindChapterId, trackIds: bindTrackIds, poolIds: bindPoolIds, eventIds: bindEventIds }).then(() => message.success(getUserFacingMessage('growthSystem.chapterBound'))).catch((error) => message.error(getErrorMessage(error, 'common.saveFailed')))}>绑定章节合同</Button></div>
          <div className="novel-growth-system__binding-group"><strong>绑定卷级节奏</strong><Select value={bindVolumeId || undefined} onChange={(value) => setBindVolumeId(value || null)} options={volumes.map((volume) => ({ value: volume.id, label: volume.title?.trim() || `第${volume.volumeNumber}卷` }))} placeholder="选择卷" /><Select mode="multiple" value={bindTrackIds} onChange={(value) => setBindTrackIds(value as number[])} options={tracks.map((track) => ({ value: track.id, label: track.title }))} placeholder="卷级轨道" /><Select mode="multiple" value={bindPoolIds} onChange={(value) => setBindPoolIds(value as number[])} options={pools.map((pool) => ({ value: pool.id, label: pool.name }))} placeholder="卷级资源池" /><Input.TextArea rows={3} value={bindCadence} onChange={(event) => setBindCadence(event.target.value)} placeholder="卷级奖励节奏约束说明" /><Button type="primary" disabled={!bindVolumeId} onClick={() => bindVolumeId && void window.electron.growthSystem.bindVolumeDesign(novelId, { volumeId: bindVolumeId, trackIds: bindTrackIds, poolIds: bindPoolIds, rewardCadence: text(bindCadence) || undefined }).then(() => message.success(getUserFacingMessage('growthSystem.volumeBound'))).catch((error) => message.error(getErrorMessage(error, 'common.saveFailed')))}>绑定卷级节奏</Button></div>
        </div>
      </details>
      <Modal width={860} title={editingTrack ? `编辑成长轨道 #${editingTrack.id}` : '新建成长轨道'} open={trackOpen} onCancel={() => closeEditor()} onOk={() => void saveTrack()} confirmLoading={saving}><Form form={trackForm} layout="vertical" onValuesChange={() => { editorDirtyRef.current = true; setHasUnsavedChanges(true) }}><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--full"><AIGenerateButton novelId={novelId} label={editingTrack ? 'AI 补全·当前轨道' : 'AI 生成·成长轨道'} intent={hasFilledValues([trackValues.title, trackValues.stageGoal, trackValues.bottleneck, trackValues.acquirePath, trackValues.failureCost]) ? 'complete' : 'generate'} isJson buildMessages={() => buildDraftMessages({ task: editingTrack ? `成长轨道 · ${editingTrack.title}` : '成长轨道草稿', mode: hasFilledValues([trackValues.title, trackValues.stageGoal, trackValues.bottleneck, trackValues.acquirePath, trackValues.failureCost]) ? 'optimize' : 'replace', context: buildPlanningContextSections(currentNovel, { includeSubplots: true, extraSections: [{ label: '当前成长系统概况', value: [`轨道数：${tracks.length}`, `资源池：${pools.length}`, `回写事件：${events.length}`].join('\n') }] }), fields: [{ key: 'trackType', label: '轨道类型', value: trackValues.trackType, hint: '只用 character、organization、relationship 之一。' }, { key: 'title', label: '轨道标题', value: trackValues.title, hint: '写成持续成长主题。' }, { key: 'stageGoal', label: '阶段目标', value: trackValues.stageGoal, hint: '写当前阶段必须拿到的成长结果。' }, { key: 'bottleneck', label: '当前瓶颈', value: trackValues.bottleneck, hint: '写卡点。' }, { key: 'acquirePath', label: '获取路径', value: trackValues.acquirePath, hint: '写成长资源如何获得。' }, { key: 'consumptionRule', label: '消耗机制', value: trackValues.consumptionRule, hint: '写使用和消耗方式。' }, { key: 'failureCost', label: '失败代价', value: trackValues.failureCost, hint: '写失败会失去什么。' }, { key: 'rewardCadence', label: '奖励节奏', value: trackValues.rewardCadence, hint: '写奖励释放节奏。' }, { key: 'currentTier', label: '当前层级', value: trackValues.currentTier, hint: '简写当前层级。' }, { key: 'nextGoal', label: '下一目标', value: trackValues.nextGoal, hint: '简写下个目标。' }, { key: 'scarceResource', label: '稀缺资源', value: trackValues.scarceResource, hint: '写受限资源。' }], requirements: ['必须与角色、关系、卷级节奏和正文代价体系一致。'] })} onResult={(raw) => { const draft = parseDraftJson<Partial<TrackValues>>(raw); trackForm.setFieldsValue({ trackType: draft.trackType, title: typeof draft.title === 'string' ? draft.title : undefined, stageGoal: typeof draft.stageGoal === 'string' ? draft.stageGoal : undefined, bottleneck: typeof draft.bottleneck === 'string' ? draft.bottleneck : undefined, acquirePath: typeof draft.acquirePath === 'string' ? draft.acquirePath : undefined, consumptionRule: typeof draft.consumptionRule === 'string' ? draft.consumptionRule : undefined, failureCost: typeof draft.failureCost === 'string' ? draft.failureCost : undefined, rewardCadence: typeof draft.rewardCadence === 'string' ? draft.rewardCadence : undefined, currentTier: typeof draft.currentTier === 'string' ? draft.currentTier : undefined, nextGoal: typeof draft.nextGoal === 'string' ? draft.nextGoal : undefined, scarceResource: typeof draft.scarceResource === 'string' ? draft.scarceResource : undefined }) }} /></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="trackType" label="轨道类型"><Select options={[{ value: 'character', label: '人物成长' }, { value: 'organization', label: '组织成长' }, { value: 'relationship', label: '关系成长' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="title" label="轨道标题" rules={[{ required: true, message: '请填写轨道标题' }]}><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="stageGoal" label="阶段目标"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="bottleneck" label="当前瓶颈"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="acquirePath" label="获取路径"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="consumptionRule" label="消耗机制"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="failureCost" label="失败代价"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="rewardCadence" label="奖励节奏"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="currentTier" label="当前层级"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="nextGoal" label="下一目标"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="scarceResource" label="稀缺资源"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="linkedVolumeId" label="关联卷"><Select allowClear options={volumes.map((v) => ({ value: v.id, label: v.title?.trim() || `第${v.volumeNumber}卷` }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="linkedChapterId" label="关联章节"><Select allowClear options={chapters.map((c) => ({ value: c.id, label: `第${c.chapterNum}章` }))} /></Form.Item></div></div></Form></Modal>
      <Modal width={760} title={editingPool ? `编辑资源池 #${editingPool.id}` : '新建资源池'} open={poolOpen} onCancel={() => closeEditor()} onOk={() => void savePool()} confirmLoading={saving}><Form form={poolForm} layout="vertical" onValuesChange={() => { editorDirtyRef.current = true; setHasUnsavedChanges(true) }}><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--full"><AIGenerateButton novelId={novelId} label={editingPool ? 'AI 补全·当前资源池' : 'AI 生成·资源池'} intent={hasFilledValues([poolValues.name, poolValues.currentReserve, poolValues.replenishPath, poolValues.consumptionRule, poolValues.failureCost]) ? 'complete' : 'generate'} isJson buildMessages={() => buildDraftMessages({ task: editingPool ? `资源池 · ${editingPool.name}` : '资源池草稿', mode: hasFilledValues([poolValues.name, poolValues.currentReserve, poolValues.replenishPath, poolValues.consumptionRule, poolValues.failureCost]) ? 'optimize' : 'replace', context: buildPlanningContextSections(currentNovel, { includeSubplots: true, extraSections: [{ label: '成长系统概况', value: [`轨道数：${tracks.length}`, `临界资源池：${summary.criticalPoolCount}`].join('\n') }] }), fields: [{ key: 'name', label: '资源池名称', value: poolValues.name, hint: '写资源池名。' }, { key: 'poolType', label: '资源类型', value: poolValues.poolType, hint: '只用 material、authority、relationship、knowledge、time 之一。' }, { key: 'scarcityLevel', label: '稀缺度', value: poolValues.scarcityLevel, hint: '只用 abundant、balanced、scarce、critical 之一。' }, { key: 'currentReserve', label: '当前存量', value: poolValues.currentReserve, hint: '写当前可用存量。' }, { key: 'replenishPath', label: '补给路径', value: poolValues.replenishPath, hint: '写如何补给。' }, { key: 'consumptionRule', label: '消耗机制', value: poolValues.consumptionRule, hint: '写如何被消耗。' }, { key: 'failureCost', label: '耗尽后果', value: poolValues.failureCost, hint: '写耗尽的代价。' }, { key: 'pressureSource', label: '压力来源', value: poolValues.pressureSource, hint: '写谁在压迫该资源。' }], requirements: ['资源池必须可被正文和合同直接引用。'] })} onResult={(raw) => { const draft = parseDraftJson<Partial<PoolValues>>(raw); poolForm.setFieldsValue({ name: typeof draft.name === 'string' ? draft.name : undefined, poolType: draft.poolType, scarcityLevel: draft.scarcityLevel, currentReserve: typeof draft.currentReserve === 'string' ? draft.currentReserve : undefined, replenishPath: typeof draft.replenishPath === 'string' ? draft.replenishPath : undefined, consumptionRule: typeof draft.consumptionRule === 'string' ? draft.consumptionRule : undefined, failureCost: typeof draft.failureCost === 'string' ? draft.failureCost : undefined, pressureSource: typeof draft.pressureSource === 'string' ? draft.pressureSource : undefined }) }} /></div><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="name" label="资源池名称" rules={[{ required: true, message: '请填写资源池名称' }]}><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="poolType" label="资源类型"><Select options={[{ value: 'material', label: '物资' }, { value: 'authority', label: '权力' }, { value: 'relationship', label: '关系' }, { value: 'knowledge', label: '知识' }, { value: 'time', label: '时间' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="scarcityLevel" label="稀缺度"><Select options={[{ value: 'abundant', label: '充裕' }, { value: 'balanced', label: '平衡' }, { value: 'scarce', label: '稀缺' }, { value: 'critical', label: '临界' }]} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="currentReserve" label="当前存量"><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="replenishPath" label="补给路径"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="consumptionRule" label="消耗机制"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="failureCost" label="耗尽后果"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="pressureSource" label="压力来源"><Input.TextArea rows={6} /></Form.Item></div></div></Form></Modal>
      <Modal width={760} title={editingEvent ? `编辑章节回写 #${editingEvent.id}` : '新增章节回写'} open={eventOpen} onCancel={() => closeEditor()} onOk={() => void saveEvent()} confirmLoading={saving}><Form form={eventForm} layout="vertical" onValuesChange={() => { editorDirtyRef.current = true; setHasUnsavedChanges(true) }}><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--full"><AIGenerateButton novelId={novelId} label={editingEvent ? 'AI 补全·当前回写' : 'AI 生成·章节回写'} intent={hasFilledValues([eventValues.title, eventValues.summary, eventValues.deltaValue, eventValues.nextBottleneck]) ? 'complete' : 'generate'} isJson buildMessages={() => buildDraftMessages({ task: editingEvent ? `章节回写 · ${editingEvent.title}` : '章节回写草稿', mode: hasFilledValues([eventValues.title, eventValues.summary, eventValues.deltaValue, eventValues.nextBottleneck]) ? 'optimize' : 'replace', context: buildPlanningContextSections(currentNovel, { includeSubplots: true, extraSections: [{ label: '成长系统概况', value: [`轨道数：${tracks.length}`, `资源池：${pools.length}`].join('\n') }] }), fields: [{ key: 'eventType', label: '类型', value: eventValues.eventType, hint: '只用 reward、cost、bottleneck 之一。' }, { key: 'title', label: '回写标题', value: eventValues.title, hint: '写回写事件标题。' }, { key: 'summary', label: '回写说明', value: eventValues.summary, hint: '写获得/失去/卡点发生了什么。' }, { key: 'deltaValue', label: '变化量', value: eventValues.deltaValue, hint: '写数值或变化描述。' }, { key: 'costResolutionState', label: '代价状态', value: eventValues.costResolutionState, hint: '只用 new、ongoing、resolved、evaporated 之一。' }, { key: 'rewardLevel', label: '回报级别', value: eventValues.rewardLevel, hint: '只用 none、partial、major 之一。' }, { key: 'nextBottleneck', label: '下一阶段卡点', value: eventValues.nextBottleneck, hint: '写接下来会卡在哪。' }], requirements: ['必须与章节合同、成长轨道和资源池状态一致。'] })} onResult={(raw) => { const draft = parseDraftJson<Partial<EventValues>>(raw); eventForm.setFieldsValue({ eventType: draft.eventType, title: typeof draft.title === 'string' ? draft.title : undefined, summary: typeof draft.summary === 'string' ? draft.summary : undefined, deltaValue: typeof draft.deltaValue === 'string' ? draft.deltaValue : undefined, costResolutionState: draft.costResolutionState, rewardLevel: draft.rewardLevel, nextBottleneck: typeof draft.nextBottleneck === 'string' ? draft.nextBottleneck : undefined }) }} /></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="chapterId" label="章节"><Select allowClear options={chapters.map((c) => ({ value: c.id, label: `第${c.chapterNum}章` }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="eventType" label="类型"><Select options={[{ value: 'reward', label: '收益' }, { value: 'cost', label: '代价' }, { value: 'bottleneck', label: '瓶颈' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="title" label="回写标题" rules={[{ required: true, message: '请填写回写标题' }]}><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="summary" label="回写说明"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="trackId" label="关联轨道"><Select allowClear options={tracks.map((t) => ({ value: t.id, label: t.title }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="resourcePoolId" label="关联资源池"><Select allowClear options={pools.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="deltaValue" label="变化量"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="costResolutionState" label="代价状态"><Select options={[{ value: 'new', label: 'new' }, { value: 'ongoing', label: 'ongoing' }, { value: 'resolved', label: 'resolved' }, { value: 'evaporated', label: 'evaporated' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="rewardLevel" label="回报级别"><Select options={[{ value: 'none', label: 'none' }, { value: 'partial', label: 'partial' }, { value: 'major', label: 'major' }]} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="nextBottleneck" label="下一阶段卡点"><Input.TextArea rows={6} /></Form.Item></div></div></Form></Modal>
    </WorkspacePage>
  )
}
