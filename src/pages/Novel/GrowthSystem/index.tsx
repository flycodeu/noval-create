import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { GrowthSystemDashboard, GrowthTrack, ResourcePool, RewardCostEvent } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { WorkspaceContextSummary, WorkspaceMetric, WorkspacePage, WorkspacePanel } from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

interface Props { novelId: number }

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

export default function GrowthSystemPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
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
  const [editingEvent, setEditingEvent] = useState<RewardCostEvent | null>(null)
  const [bindChapterId, setBindChapterId] = useState<number | null>(null)
  const [bindVolumeId, setBindVolumeId] = useState<number | null>(null)
  const [bindTrackIds, setBindTrackIds] = useState<number[]>([])
  const [bindPoolIds, setBindPoolIds] = useState<number[]>([])
  const [bindEventIds, setBindEventIds] = useState<number[]>([])
  const [bindCadence, setBindCadence] = useState('')

  const tracks = dashboard?.tracks || []
  const pools = dashboard?.pools || []
  const events = dashboard?.events || []
  const chapters = dashboard?.chapters || []
  const volumes = dashboard?.volumes || []

  const health = useMemo(() => {
    if (!dashboard) return 0
    const raw = 82 + Math.min(20, dashboard.summary.trackCount * 3)
      - dashboard.summary.criticalPoolCount * 10
      - dashboard.summary.unresolvedCostCount * 4
      + Math.round(dashboard.summary.chapterWritebackCoverage * 18)
    return Math.max(0, Math.min(100, raw))
  }, [dashboard])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electron.growthSystem.getDashboard(novelId)
      setDashboard(result)
      if (!bindChapterId && result.chapters.length > 0) setBindChapterId(result.chapters[0].id)
      if (!bindVolumeId && result.volumes.length > 0) setBindVolumeId(result.volumes[0].id)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [bindChapterId, bindVolumeId, novelId])

  useEffect(() => { void refresh() }, [mutationToken, refresh])

  const openTrack = (track?: GrowthTrack) => {
    setEditingTrack(track || null)
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

  const saveTrack = async () => {
    const values = await trackForm.validateFields()
    if (!text(values.title)) return message.warning(getUserFacingMessage('growthSystem.trackTitleRequired'))
    setSaving(true)
    try {
      await window.electron.growthSystem.upsertTrack(novelId, { ...values, id: editingTrack?.id, title: text(values.title) })
      setTrackOpen(false)
      await refresh(); notifyWorkspaceMutation()
    } finally { setSaving(false) }
  }
  const savePool = async () => {
    const values = await poolForm.validateFields()
    if (!text(values.name)) return message.warning(getUserFacingMessage('growthSystem.poolNameRequired'))
    setSaving(true)
    try {
      await window.electron.growthSystem.upsertPool(novelId, { ...values, id: editingPool?.id, name: text(values.name) })
      setPoolOpen(false)
      await refresh(); notifyWorkspaceMutation()
    } finally { setSaving(false) }
  }
  const saveEvent = async () => {
    const values = await eventForm.validateFields()
    if (!text(values.title)) return message.warning(getUserFacingMessage('growthSystem.writebackTitleRequired'))
    setSaving(true)
    try {
      await window.electron.growthSystem.upsertEvent(novelId, { ...values, id: editingEvent?.id, title: text(values.title) })
      setEventOpen(false)
      await refresh(); notifyWorkspaceMutation()
    } finally { setSaving(false) }
  }

  useEffect(() => {
    registerSaveHandler(trackOpen ? () => { void saveTrack() } : poolOpen ? () => { void savePool() } : eventOpen ? () => { void saveEvent() } : null)
    return () => registerSaveHandler(null)
  }, [eventOpen, poolOpen, registerSaveHandler, trackOpen])
  useEffect(() => {
    registerEscapeHandler(() => {
      if (trackOpen) setTrackOpen(false)
      if (poolOpen) setPoolOpen(false)
      if (eventOpen) setEventOpen(false)
    })
    return () => registerEscapeHandler(null)
  }, [eventOpen, poolOpen, registerEscapeHandler, trackOpen])

  return (
    <WorkspacePage
      className="novel-growth-system-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="成长资源代价系统"
      title="成长资源代价系统"
      description="统一维护阶段目标、瓶颈、获取路径、消耗机制与失败代价，并把收益/代价回写绑定到合同与卷级节奏。"
      actions={<Space wrap><Button type="primary" icon={<PlusOutlined />} onClick={() => openTrack()}>新建成长轨道</Button><Button icon={<PlusOutlined />} onClick={() => openPool()}>新建资源池</Button><Button icon={<PlusOutlined />} onClick={() => openEvent()}>章节回写</Button></Space>}
      contextSummary={<WorkspaceContextSummary items={[{ label: '当前项目', value: currentNovel?.title || '未命名小说' }, { label: '章节数', value: chapters.length }, { label: '卷数', value: volumes.length }, { label: '回写事件', value: events.length }]} />}
      metrics={<><WorkspaceMetric label="收益循环健康度" value={`${health}/100`} tone={health < 60 ? 'warm' : 'cool'} /><WorkspaceMetric label="成长轨道" value={dashboard?.summary.trackCount || 0} /><WorkspaceMetric label="临界资源池" value={dashboard?.summary.criticalPoolCount || 0} tone={(dashboard?.summary.criticalPoolCount || 0) > 0 ? 'warm' : 'default'} /><WorkspaceMetric label="未解代价链" value={dashboard?.summary.unresolvedCostCount || 0} tone={(dashboard?.summary.unresolvedCostCount || 0) > 0 ? 'warm' : 'default'} /></>}
    >
      {(dashboard?.summary.criticalPoolCount || 0) > 0 ? <Alert showIcon type="warning" message="存在稀缺/临界资源池" description="建议优先绑定到卷级节奏和章节合同，避免正文资源无限化。" /> : null}
      <WorkspacePanel title="统一推进引擎" description="人物/组织/关系成长共用同一轨道面板。"><Table<GrowthTrack> rowKey="id" loading={loading} pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={tracks} columns={[{ title: '轨道', dataIndex: 'title', width: 220 }, { title: '类型', dataIndex: 'trackType', width: 110, render: (v) => <Tag color={v === 'organization' ? 'purple' : v === 'relationship' ? 'cyan' : 'blue'}>{trackLabel(v)}</Tag> }, { title: '阶段目标', dataIndex: 'stageGoal', render: (v) => v || '未设置' }, { title: '瓶颈', dataIndex: 'bottleneck', render: (v) => v || '未设置' }, { title: '操作', width: 140, render: (_v, r) => <Space><Button size="small" onClick={() => openTrack(r)}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={() => void window.electron.growthSystem.deleteTrack(novelId, r.id).then(async () => { await refresh(); notifyWorkspaceMutation() })}>删除</Button></Space> }]} /></WorkspacePanel>
      <WorkspacePanel title="跨章资源池与稀缺度管理"><Table<ResourcePool> rowKey="id" loading={loading} pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={pools} columns={[{ title: '资源池', dataIndex: 'name', width: 220 }, { title: '类型', dataIndex: 'poolType', width: 110 }, { title: '稀缺度', dataIndex: 'scarcityLevel', width: 110, render: (v) => <Tag color={scarcityTone(v)}>{v}</Tag> }, { title: '补给路径', dataIndex: 'replenishPath', render: (v) => v || '未设置' }, { title: '消耗机制', dataIndex: 'consumptionRule', render: (v) => v || '未设置' }, { title: '操作', width: 140, render: (_v, r) => <Space><Button size="small" onClick={() => openPool(r)}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={() => void window.electron.growthSystem.deletePool(novelId, r.id).then(async () => { await refresh(); notifyWorkspaceMutation() })}>删除</Button></Space> }]} /></WorkspacePanel>
      <WorkspacePanel title="章节回写（获得/失去/下一阶段卡点）"><Table<RewardCostEvent> rowKey="id" loading={loading} pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={events} columns={[{ title: '章节', width: 110, render: (_v, r) => `第${r.chapterNumSnapshot || '?'}章` }, { title: '类型', dataIndex: 'eventType', width: 90, render: (v) => <Tag color={v === 'cost' ? 'volcano' : v === 'bottleneck' ? 'orange' : 'green'}>{v}</Tag> }, { title: '标题', dataIndex: 'title', width: 220 }, { title: '说明', dataIndex: 'summary', render: (v) => v || '无' }, { title: '操作', width: 140, render: (_v, r) => <Space><Button size="small" onClick={() => openEvent(r)}>编辑</Button><Button size="small" danger icon={<DeleteOutlined />} onClick={() => void window.electron.growthSystem.deleteEvent(novelId, r.id).then(async () => { await refresh(); notifyWorkspaceMutation() })}>删除</Button></Space> }]} /></WorkspacePanel>
      <WorkspacePanel title="合同与卷级绑定" description="直接把奖励/代价约束挂到章节合同和卷级节奏。">
        <div className="guided-step__field-grid">
          <div className="guided-step__field-card"><div className="workspace-field-heading">绑定章节合同</div><Space direction="vertical" className="workspace-full-width"><Select value={bindChapterId || undefined} onChange={(v) => setBindChapterId(v || null)} options={chapters.map((c) => ({ value: c.id, label: `第${c.chapterNum}章 · ${c.title || '未命名章节'}` }))} /><Select mode="multiple" value={bindTrackIds} onChange={(v) => setBindTrackIds(v as number[])} options={tracks.map((t) => ({ value: t.id, label: t.title }))} placeholder="成长轨道" /><Select mode="multiple" value={bindPoolIds} onChange={(v) => setBindPoolIds(v as number[])} options={pools.map((p) => ({ value: p.id, label: `${p.name}[${p.scarcityLevel}]` }))} placeholder="资源池" /><Select mode="multiple" value={bindEventIds} onChange={(v) => setBindEventIds(v as number[])} options={events.map((e) => ({ value: e.id, label: `第${e.chapterNumSnapshot || '?'}章·${e.title}` }))} placeholder="回写事件" /><Button type="primary" icon={<SaveOutlined />} onClick={() => void window.electron.growthSystem.bindChapterContract(novelId, { chapterId: bindChapterId || 0, trackIds: bindTrackIds, poolIds: bindPoolIds, eventIds: bindEventIds }).then(() => message.success(getUserFacingMessage('growthSystem.chapterBound'))).catch((error) => message.error(getErrorMessage(error, 'common.saveFailed')))}>绑定章节合同</Button></Space></div>
          <div className="guided-step__field-card"><div className="workspace-field-heading">绑定卷级节奏</div><Space direction="vertical" className="workspace-full-width"><Select value={bindVolumeId || undefined} onChange={(v) => setBindVolumeId(v || null)} options={volumes.map((v) => ({ value: v.id, label: v.title?.trim() || `第${v.volumeNumber}卷` }))} /><Select mode="multiple" value={bindTrackIds} onChange={(v) => setBindTrackIds(v as number[])} options={tracks.map((t) => ({ value: t.id, label: t.title }))} placeholder="卷级轨道" /><Select mode="multiple" value={bindPoolIds} onChange={(v) => setBindPoolIds(v as number[])} options={pools.map((p) => ({ value: p.id, label: `${p.name}[${p.scarcityLevel}]` }))} placeholder="卷级资源池" /><Input.TextArea rows={6} value={bindCadence} onChange={(e) => setBindCadence(e.target.value)} placeholder="卷级奖励节奏约束说明" /><Button type="primary" icon={<SaveOutlined />} onClick={() => void window.electron.growthSystem.bindVolumeDesign(novelId, { volumeId: bindVolumeId || 0, trackIds: bindTrackIds, poolIds: bindPoolIds, rewardCadence: text(bindCadence) || undefined }).then(() => message.success(getUserFacingMessage('growthSystem.volumeBound'))).catch((error) => message.error(getErrorMessage(error, 'common.saveFailed')))}>绑定卷级节奏</Button></Space></div>
        </div>
      </WorkspacePanel>
      <Modal width={860} title={editingTrack ? `编辑成长轨道 #${editingTrack.id}` : '新建成长轨道'} open={trackOpen} onCancel={() => setTrackOpen(false)} onOk={() => void saveTrack()} confirmLoading={saving}><Form form={trackForm} layout="vertical"><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="trackType" label="轨道类型"><Select options={[{ value: 'character', label: '人物成长' }, { value: 'organization', label: '组织成长' }, { value: 'relationship', label: '关系成长' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="title" label="轨道标题" rules={[{ required: true, message: '请填写轨道标题' }]}><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="stageGoal" label="阶段目标"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="bottleneck" label="当前瓶颈"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="acquirePath" label="获取路径"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="consumptionRule" label="消耗机制"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="failureCost" label="失败代价"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="rewardCadence" label="奖励节奏"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="currentTier" label="当前层级"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="nextGoal" label="下一目标"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="scarceResource" label="稀缺资源"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="linkedVolumeId" label="关联卷"><Select allowClear options={volumes.map((v) => ({ value: v.id, label: v.title?.trim() || `第${v.volumeNumber}卷` }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="linkedChapterId" label="关联章节"><Select allowClear options={chapters.map((c) => ({ value: c.id, label: `第${c.chapterNum}章` }))} /></Form.Item></div></div></Form></Modal>
      <Modal width={760} title={editingPool ? `编辑资源池 #${editingPool.id}` : '新建资源池'} open={poolOpen} onCancel={() => setPoolOpen(false)} onOk={() => void savePool()} confirmLoading={saving}><Form form={poolForm} layout="vertical"><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="name" label="资源池名称" rules={[{ required: true, message: '请填写资源池名称' }]}><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="poolType" label="资源类型"><Select options={[{ value: 'material', label: '物资' }, { value: 'authority', label: '权力' }, { value: 'relationship', label: '关系' }, { value: 'knowledge', label: '知识' }, { value: 'time', label: '时间' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="scarcityLevel" label="稀缺度"><Select options={[{ value: 'abundant', label: '充裕' }, { value: 'balanced', label: '平衡' }, { value: 'scarce', label: '稀缺' }, { value: 'critical', label: '临界' }]} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="currentReserve" label="当前存量"><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="replenishPath" label="补给路径"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="consumptionRule" label="消耗机制"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="failureCost" label="耗尽后果"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="pressureSource" label="压力来源"><Input.TextArea rows={6} /></Form.Item></div></div></Form></Modal>
      <Modal width={760} title={editingEvent ? `编辑章节回写 #${editingEvent.id}` : '新增章节回写'} open={eventOpen} onCancel={() => setEventOpen(false)} onOk={() => void saveEvent()} confirmLoading={saving}><Form form={eventForm} layout="vertical"><div className="guided-step__field-grid"><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="chapterId" label="章节"><Select allowClear options={chapters.map((c) => ({ value: c.id, label: `第${c.chapterNum}章` }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="eventType" label="类型"><Select options={[{ value: 'reward', label: '收益' }, { value: 'cost', label: '代价' }, { value: 'bottleneck', label: '瓶颈' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--full"><Form.Item name="title" label="回写标题" rules={[{ required: true, message: '请填写回写标题' }]}><Input /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="summary" label="回写说明"><Input.TextArea rows={6} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="trackId" label="关联轨道"><Select allowClear options={tracks.map((t) => ({ value: t.id, label: t.title }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="resourcePoolId" label="关联资源池"><Select allowClear options={pools.map((p) => ({ value: p.id, label: p.name }))} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="deltaValue" label="变化量"><Input /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="costResolutionState" label="代价状态"><Select options={[{ value: 'new', label: 'new' }, { value: 'ongoing', label: 'ongoing' }, { value: 'resolved', label: 'resolved' }, { value: 'evaporated', label: 'evaporated' }]} /></Form.Item></div><div className="guided-step__field-card guided-step__field-card--compact"><Form.Item name="rewardLevel" label="回报级别"><Select options={[{ value: 'none', label: 'none' }, { value: 'partial', label: 'partial' }, { value: 'major', label: 'major' }]} /></Form.Item></div><div className="guided-step__field-card"><Form.Item name="nextBottleneck" label="下一阶段卡点"><Input.TextArea rows={6} /></Form.Item></div></div></Form></Modal>
    </WorkspacePage>
  )
}
