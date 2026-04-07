import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Form, Input, InputNumber, Modal, Pagination, Segmented, Select, Space, Spin, Tag, message } from 'antd'
import VirtualList from 'rc-virtual-list'
import { useRef } from 'react'
import { ArrowRightOutlined, DeleteOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { ForeshadowSnapshot, StoryThread } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import type { StoryThreadBatchGenerateOptions } from '../../../shared/story-thread-generation'
import {
  EMPTY_WORKFLOW_STATS,
  getWorkflowBlockers,
  loadWorkflowStats,
  type WorkflowStats,
} from '../workflow'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import { useNovelWorkspaceActions } from '../workspace-shortcuts-context'

interface Props {
  novelId: number
}

interface StoryThreadFormValues {
  threadType: StoryThread['threadType']
  title: string
  summary: string
  premise: string
  status: StoryThread['status']
  priority: StoryThread['priority']
  startChapter?: number
  targetPayoffChapter?: number
  payoffCondition: string
  currentState: string
  notes: string
}

interface GenerateFormValues {
  count: number
  batchSize: number
  focus: string
}

const THREAD_TYPE_OPTIONS: Array<{ value: StoryThread['threadType']; label: string }> = [
  { value: 'main', label: '主线' },
  { value: 'subplot', label: '支线' },
  { value: 'mystery', label: '悬念' },
  { value: 'payoff', label: '回收线' },
  { value: 'relationship', label: '关系线' },
]

const THREAD_STATUS_OPTIONS: Array<{ value: StoryThread['status']; label: string }> = [
  { value: 'planned', label: '待推进' },
  { value: 'active', label: '推进中' },
  { value: 'stalled', label: '卡住' },
  { value: 'resolved', label: '已回收' },
  { value: 'abandoned', label: '废弃' },
]

const PRIORITY_OPTIONS: Array<{ value: StoryThread['priority']; label: string }> = [
  { value: 'high', label: '高优先级' },
  { value: 'medium', label: '中优先级' },
  { value: 'low', label: '低优先级' },
]

const EMPTY_EDITOR_VALUES: StoryThreadFormValues = {
  threadType: 'subplot',
  title: '',
  summary: '',
  premise: '',
  status: 'planned',
  priority: 'medium',
  startChapter: undefined,
  targetPayoffChapter: undefined,
  payoffCondition: '',
  currentState: '',
  notes: '',
}

const DEFAULT_GENERATE_VALUES: GenerateFormValues = {
  count: 8,
  batchSize: 4,
  focus: '',
}

const THREADS_PAGE_SIZE = 50

function compactText(value?: string | null, max = 44): string {
  const text = value?.trim() || ''
  if (!text) return '待补充'
  return text.length > max ? `${text.slice(0, max)}...` : text
}

function getStatusColor(status: StoryThread['status']) {
  if (status === 'resolved') return 'success'
  if (status === 'stalled') return 'warning'
  if (status === 'abandoned') return 'default'
  if (status === 'active') return 'processing'
  return 'blue'
}

function getPriorityColor(priority: StoryThread['priority']) {
  if (priority === 'high') return 'error'
  if (priority === 'low') return 'default'
  return 'gold'
}

function buildEditorValues(thread?: StoryThread | null): StoryThreadFormValues {
  if (!thread) return EMPTY_EDITOR_VALUES

  return {
    threadType: thread.threadType,
    title: thread.title,
    summary: thread.summary || '',
    premise: thread.premise || '',
    status: thread.status,
    priority: thread.priority,
    startChapter: thread.startChapter || undefined,
    targetPayoffChapter: thread.targetPayoffChapter || undefined,
    payoffCondition: thread.payoffCondition || '',
    currentState: thread.currentState || '',
    notes: thread.notes || '',
  }
}

function normalizeEditorValues(values: StoryThreadFormValues): StoryThreadFormValues {
  return {
    threadType: values.threadType,
    title: values.title.trim(),
    summary: values.summary.trim(),
    premise: values.premise.trim(),
    status: values.status,
    priority: values.priority,
    startChapter: values.startChapter,
    targetPayoffChapter: values.targetPayoffChapter,
    payoffCondition: values.payoffCondition.trim(),
    currentState: values.currentState.trim(),
    notes: values.notes.trim(),
  }
}

function normalizeGenerateValues(values: GenerateFormValues): StoryThreadBatchGenerateOptions {
  return {
    count: Math.max(1, Math.min(20, Math.round(values.count || 8))),
    batchSize: Math.max(1, Math.min(6, Math.round(values.batchSize || 4))),
    focus: values.focus.trim() || undefined,
  }
}

function formatChapter(value?: number | null): string {
  if (typeof value !== 'number' || value <= 0) return '未安排'
  return `第 ${value} 章`
}

function StoryThreadRow({
  thread,
  selected,
  onSelect,
  onEdit,
  onRegenerate,
  onDelete,
  regenerating,
}: {
  thread: StoryThread
  selected: boolean
  onSelect: (id: number, checked: boolean) => void
  onEdit: (thread: StoryThread) => void
  onRegenerate: (thread: StoryThread) => void
  onDelete: (thread: StoryThread) => void
  regenerating: boolean
}) {
  return (
    <div className={`story-threads__row ${selected ? 'story-threads__row--selected' : ''}`}>
      <Checkbox
        checked={selected}
        onChange={(e) => onSelect(thread.id, e.target.checked)}
      />
      <div className="story-threads__table-cell">
        <strong>{thread.title}</strong>
        <div className="story-threads__table-copy">
          {thread.summary || thread.premise || '还没有写清这条线程在持续推动什么。'}
        </div>
      </div>
      <Tag>{THREAD_TYPE_OPTIONS.find((item) => item.value === thread.threadType)?.label || thread.threadType}</Tag>
      <Tag color={getStatusColor(thread.status)}>{THREAD_STATUS_OPTIONS.find((item) => item.value === thread.status)?.label || thread.status}</Tag>
      <Tag color={getPriorityColor(thread.priority)}>{PRIORITY_OPTIONS.find((item) => item.value === thread.priority)?.label || thread.priority}</Tag>
      <span className="story-threads__row-chapter">{formatChapter(thread.targetPayoffChapter)}</span>
      <Space size={4}>
        <Button size="small" onClick={() => onEdit(thread)}>编辑</Button>
        <Button size="small" loading={regenerating} onClick={() => onRegenerate(thread)}>AI 重生成</Button>
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onDelete(thread)} />
      </Space>
    </div>
  )
}

function parseRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function ForeshadowColumn({
  title,
  items,
}: {
  title: string
  items: ForeshadowSnapshot['pending']
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <Tag color="blue">{items.length}</Tag>
      </div>
      {items.length === 0 ? (
        <div className="novel-empty">当前为空。</div>
      ) : (
        items.map((item) => (
          <section key={item.id} className="novel-panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <strong>{item.title}</strong>
              <Tag color={item.status === 'resolved' ? 'success' : item.warningText ? 'warning' : 'default'}>
                {item.status}
              </Tag>
            </div>
            <div style={{ color: 'var(--workspace-ink-soft)', marginBottom: 8 }}>
              {item.summary || item.currentState || '这条伏笔还没有补足说明。'}
            </div>
            <div style={{ display: 'grid', gap: 4, fontSize: 13, color: 'var(--workspace-ink-soft)' }}>
              <div>{`埋设：${formatChapter(item.plantedChapter || item.startChapter)}`}</div>
              <div>{`目标回收：${formatChapter(item.targetPayoffChapter)}`}</div>
              <div>{`当前距离：${typeof item.currentDistance === 'number' ? `${item.currentDistance} 章` : '未设定'}`}</div>
              <div>{`关联角色：${item.relatedCharacterCount}`}</div>
              {item.payoffCondition ? <div>{`回收条件：${item.payoffCondition}`}</div> : null}
              {item.warningText ? <div style={{ color: '#ad6800' }}>{item.warningText}</div> : null}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

export default function StoryThreadsPage({ novelId }: Props) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { mutationToken, notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const { currentNovel } = useNovelStore()
  const [editorForm] = Form.useForm<StoryThreadFormValues>()
  const [generateForm] = Form.useForm<GenerateFormValues>()
  const [threads, setThreads] = useState<StoryThread[]>([])
  const [threadTotal, setThreadTotal] = useState(0)
  const [stats, setStats] = useState({ total: 0, activeCount: 0, resolvedCount: 0, stalledCount: 0, overdueCount: 0 })
  const [foreshadowSnapshot, setForeshadowSnapshot] = useState<ForeshadowSnapshot>({
    currentChapterNum: 0,
    pending: [],
    dueSoon: [],
    resolved: [],
    overdue: [],
  })
  const [workflowStats, setWorkflowStats] = useState<WorkflowStats>(EMPTY_WORKFLOW_STATS)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [editingThread, setEditingThread] = useState<StoryThread | null>(null)
  const [generationWarnings, setGenerationWarnings] = useState<string[]>([])
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [batchStatus, setBatchStatus] = useState<StoryThread['status']>('planned')
  const [batchPriority, setBatchPriority] = useState<StoryThread['priority']>('medium')
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState<'board' | 'foreshadow'>('board')
  const routeEditorRef = useRef<number | null>(null)
  const routeThreadId = useMemo(() => parseRouteId(searchParams.get('threadId')), [searchParams])
  const routeAction = useMemo(() => searchParams.get('action'), [searchParams])
  const generationBlockers = useMemo(
    () => getWorkflowBlockers('threads', currentNovel, workflowStats),
    [currentNovel, workflowStats],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [queryResult, nextStats, nextForeshadowSnapshot, nextWorkflowStats] = await Promise.all([
        window.electron.thread.query({ novelId, page, pageSize: THREADS_PAGE_SIZE }),
        window.electron.thread.getStats({ novelId, page: 1, pageSize: 1 }),
        window.electron.thread.getForeshadowSnapshot(novelId),
        loadWorkflowStats(novelId),
      ])
      setThreads(queryResult.items)
      setThreadTotal(queryResult.total)
      setStats(nextStats)
      setForeshadowSnapshot(nextForeshadowSnapshot)
      setWorkflowStats(nextWorkflowStats)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [novelId, page])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])
  const openEditor = useCallback((thread?: StoryThread) => {
    setEditingThread(thread || null)
    editorForm.resetFields()
    editorForm.setFieldsValue(buildEditorValues(thread))
    setEditorOpen(true)
  }, [editorForm])

  useEffect(() => {
    if (!routeThreadId || routeAction !== 'edit' || routeEditorRef.current === routeThreadId) return
    const target = threads.find((thread) => thread.id === routeThreadId)
    if (target) {
      routeEditorRef.current = routeThreadId
      openEditor(target)
      return
    }
    void window.electron.thread.get(routeThreadId).then((thread) => {
      if (!thread) return
      routeEditorRef.current = routeThreadId
      openEditor(thread)
    })
  }, [openEditor, routeAction, routeThreadId, threads])

  useEffect(() => {
    generateForm.setFieldsValue(DEFAULT_GENERATE_VALUES)
  }, [generateForm])

  const openGenerateModal = async () => {
    const nextWorkflowStats = await loadWorkflowStats(novelId)
    setWorkflowStats(nextWorkflowStats)
    const blockers = getWorkflowBlockers('threads', currentNovel, nextWorkflowStats)
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    generateForm.resetFields()
    generateForm.setFieldsValue(DEFAULT_GENERATE_VALUES)
    setGenerateOpen(true)
  }

  const handleDelete = (thread: StoryThread) => {
    Modal.confirm({
      title: `删除线程「${thread.title}」`,
      content: '删除后不会自动回滚结构页、时间轴页或正文中已经引用到的内容，请确认。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.thread.batchDelete([thread.id])
          message.success(getUserFacingMessage('storyThread.deleted'))
          await refresh()
          notifyWorkspaceMutation()
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'storyThread.deleteFailed'))
        }
      },
    })
  }

  const handleSave = useCallback(async () => {
    const values = normalizeEditorValues(await editorForm.validateFields())
    setSaving(true)

    try {
      if (editingThread) {
        await window.electron.thread.update(editingThread.id, values)
        message.success(getUserFacingMessage('storyThread.updated'))
      } else {
        await window.electron.thread.create(novelId, values)
        message.success(getUserFacingMessage('storyThread.created'))
      }

      setEditorOpen(false)
      setEditingThread(null)
      await refresh()
      notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [editingThread, editorForm, novelId, notifyWorkspaceMutation, refresh])

  useEffect(() => {
    registerSaveHandler(editorOpen ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  }, [editorOpen, handleSave, registerSaveHandler])

  useEffect(() => {
    registerEscapeHandler(() => {
      setSelectedRowKeys([])
    })
    return () => registerEscapeHandler(null)
  }, [registerEscapeHandler])

  const handleBatchStatusUpdate = async () => {
    if (selectedRowKeys.length === 0) return
    try {
      await window.electron.thread.batchUpdate(selectedRowKeys, { status: batchStatus })
      setSelectedRowKeys([])
      await refresh()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('storyThread.batchStatusUpdated', { count: selectedRowKeys.length }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.batchStatusUpdateFailed'))
    }
  }

  const handleBatchPriorityUpdate = async () => {
    if (selectedRowKeys.length === 0) return
    try {
      await window.electron.thread.batchUpdate(selectedRowKeys, { priority: batchPriority })
      setSelectedRowKeys([])
      await refresh()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage('storyThread.batchPriorityUpdated', { count: selectedRowKeys.length }))
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.batchPriorityUpdateFailed'))
    }
  }

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return
    Modal.confirm({
      title: `删除选中的 ${selectedRowKeys.length} 条故事线程？`,
      content: '会创建恢复点，可通过“撤销最近操作”恢复。',
      okType: 'danger',
      onOk: async () => {
        await window.electron.thread.batchDelete(selectedRowKeys)
        setSelectedRowKeys([])
        await refresh()
        notifyWorkspaceMutation()
        message.success(getUserFacingMessage('storyThread.batchDeleted'))
      },
    })
  }

  const handleGenerate = async () => {
    const nextWorkflowStats = await loadWorkflowStats(novelId)
    setWorkflowStats(nextWorkflowStats)
    const blockers = getWorkflowBlockers('threads', currentNovel, nextWorkflowStats)
    if (blockers.length > 0) {
      message.warning(blockers.join('\n'))
      return
    }

    const values = normalizeGenerateValues(await generateForm.validateFields())
    setGenerating(true)
    setGenerationWarnings([])

    try {
      const result = await window.electron.thread.generate(novelId, values)
      setGenerationWarnings(result.warnings)
      setGenerateOpen(false)
      await refresh()
      notifyWorkspaceMutation()

      if (result.warnings.length > 0) {
        message.warning(getUserFacingMessage('storyThread.generatedWithWarnings', {
          createdCount: result.createdCount,
          requestedCount: result.requestedCount,
          warningCount: result.warnings.length,
        }))
      } else {
        message.success(getUserFacingMessage('storyThread.generated', { createdCount: result.createdCount }))
      }
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleRegenerate = async (thread: StoryThread) => {
    setGenerating(true)
    try {
      await window.electron.thread.regenerate(thread.id)
      message.success(getUserFacingMessage('storyThread.regenerated'))
      await refresh()
      notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'storyThread.regenerateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <WorkspacePage
      className="novel-story-threads-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="故事线程"
      title="故事线程"
      description="把主线、支线、悬念、关系线和回收点统一管理成可追踪卡片。结构页、时间轴页和正文都应引用这些线程，而不是各写各的。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建线程
          </Button>
          <Button icon={<RobotOutlined />} loading={generating} onClick={() => void openGenerateModal()}>
            AI 批量生成
          </Button>
          <Button icon={<ArrowRightOutlined />} onClick={() => navigate(`/novels/${novelId}/structure`)}>
            去结构页
          </Button>
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '书名', value: currentNovel?.title || '未命名小说' },
            { label: '故事设计', value: currentNovel?.settingsJson ? '已存在' : '建议先补故事设计' },
            { label: '背景摘要', value: compactText(currentNovel?.expandedBackground || currentNovel?.synopsis) },
            { label: '线程总数', value: stats.total },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="推进中" value={stats.activeCount} tone="warm" hint="仍在施压主线或人物关系的线程。" />
          <WorkspaceMetric label="已回收" value={stats.resolvedCount} hint="已经完成回收或兑现代价的线程。" />
          <WorkspaceMetric label="卡住" value={stats.stalledCount} hint="最容易拖累后续章节推进的线程。" />
          <WorkspaceMetric label="过期" value={stats.overdueCount} hint="目标回收章位已过但仍未处理的线程。" />
        </>
      )}
    >
      {generationBlockers.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="当前还不适合批量生成故事线程"
          description={(
            <div>
              {generationBlockers.map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      {!currentNovel?.settingsJson ? (
        <Alert
          type="info"
          showIcon
          message="建议先把故事设计页里的主线目标、核心冲突和结局落点写稳，再批量生成线程，结果会更贴合主推进链。"
        />
      ) : null}

      {generationWarnings.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="最近一次批量生成带有提醒"
          description={(
            <div>
              {generationWarnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
        />
      ) : null}

      <WorkspacePanel title="使用原则" description="每条线程都要有起点、当前状态和回收条件。">
        <div className="guided-step__checklist">
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>线程必须服务主线</strong></div>
            <p>如果一条线既不推动主线、也不压迫人物关系、也不承担悬念回收，就不该继续保留。</p>
          </div>
          <div className="guided-step__checkitem guided-step__checkitem--done">
            <div className="guided-step__checkhead"><strong>回收条件要可判断</strong></div>
            <p>不要只写“情绪到位”或“关系升温”，要写清楚什么事件发生后才算真正回收。</p>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="线程看板" description="可手工维护，也可以先批量生成再逐条修。">
        <div style={{ marginBottom: 16 }}>
          <Segmented
            value={viewMode}
            onChange={(value) => setViewMode(value as 'board' | 'foreshadow')}
            options={[
              { value: 'board', label: '线程看板' },
              { value: 'foreshadow', label: '伏笔追踪' },
            ]}
          />
        </div>
        {viewMode === 'foreshadow' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <Alert
              style={{ gridColumn: '1 / -1' }}
              type="info"
              showIcon
              message={`当前正文进度：第 ${foreshadowSnapshot.currentChapterNum || 0} 章`}
              description="这里只显示具备回收目标、回收条件或承担悬念/回收职责的线程。"
            />
            <ForeshadowColumn title="待回收" items={foreshadowSnapshot.pending} />
            <ForeshadowColumn title="即将到期" items={foreshadowSnapshot.dueSoon} />
            <ForeshadowColumn title="已回收" items={foreshadowSnapshot.resolved} />
            <ForeshadowColumn title="超期未收" items={foreshadowSnapshot.overdue} />
          </div>
        ) : (
          <>
            {selectedRowKeys.length > 0 ? (
              <div className="novel-filter-bar" style={{ marginBottom: 16 }}>
                <div className="novel-filter-bar__row">
                  <Tag color="processing">{`已选 ${selectedRowKeys.length} 条`}</Tag>
                  <Select
                    value={batchStatus}
                    style={{ width: 160 }}
                    options={THREAD_STATUS_OPTIONS}
                    onChange={(value) => setBatchStatus(value)}
                  />
                  <Button onClick={() => void handleBatchStatusUpdate()}>批量改状态</Button>
                  <Select
                    value={batchPriority}
                    style={{ width: 160 }}
                    options={PRIORITY_OPTIONS}
                    onChange={(value) => setBatchPriority(value)}
                  />
                  <Button onClick={() => void handleBatchPriorityUpdate()}>批量改优先级</Button>
                  <Button danger onClick={handleBatchDelete}>批量删除</Button>
                </div>
                <div className="novel-filter-bar__summary">危险操作会自动创建恢复点，`Esc` 可清空当前批量选择。</div>
              </div>
            ) : null}
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin /></div>
            ) : threads.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 48, color: 'var(--workspace-ink-soft)' }}>暂无线程数据</div>
            ) : (
              <>
                <div className="story-threads__row story-threads__row--header">
                  <Checkbox
                    checked={selectedRowKeys.length === threads.length && threads.length > 0}
                    indeterminate={selectedRowKeys.length > 0 && selectedRowKeys.length < threads.length}
                    onChange={(e) => setSelectedRowKeys(e.target.checked ? threads.map((t) => t.id) : [])}
                  />
                  <span>线程</span>
                  <span>类型</span>
                  <span>状态</span>
                  <span>优先级</span>
                  <span>目标回收</span>
                  <span>操作</span>
                </div>
                <VirtualList data={threads} height={520} itemHeight={72} itemKey="id">
                  {(thread: StoryThread) => (
                    <StoryThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selectedRowKeys.includes(thread.id)}
                      onSelect={(id, checked) => {
                        setSelectedRowKeys((prev) =>
                          checked ? [...prev, id] : prev.filter((k) => k !== id),
                        )
                      }}
                      onEdit={openEditor}
                      onRegenerate={(t) => void handleRegenerate(t)}
                      onDelete={handleDelete}
                      regenerating={generating}
                    />
                  )}
                </VirtualList>
                {threadTotal > THREADS_PAGE_SIZE ? (
                  <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <Pagination
                      current={page}
                      pageSize={THREADS_PAGE_SIZE}
                      total={threadTotal}
                      showSizeChanger={false}
                      onChange={setPage}
                    />
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
      </WorkspacePanel>

      <Modal
        title={editingThread ? '编辑故事线程' : '新建故事线程'}
        open={editorOpen}
        forceRender
        onCancel={() => {
          setEditorOpen(false)
          setEditingThread(null)
        }}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingThread ? '保存修改' : '创建线程'}
        width={760}
      >
        <Form form={editorForm} layout="vertical" initialValues={EMPTY_EDITOR_VALUES}>
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="threadType" label="线程类型" rules={[{ required: true, message: '请选择线程类型' }]}>
                <Select options={THREAD_TYPE_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="当前状态" rules={[{ required: true, message: '请选择当前状态' }]}>
                <Select options={THREAD_STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="priority" label="优先级" rules={[{ required: true, message: '请选择优先级' }]}>
                <Select options={PRIORITY_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="线程标题" rules={[{ required: true, message: '请填写线程标题' }]}>
                <Input placeholder="例如：主角身份暴露 / 南区补给线崩盘 / 姐弟关系修复" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="summary" label="线程摘要">
                <Input.TextArea rows={3} placeholder="用 1-2 句话说明这条线程在持续推动什么。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="premise" label="触发前提 / 起始条件">
                <Input.TextArea rows={3} placeholder="写这条线程从哪里开始，为什么会成立。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="startChapter" label="开始章位">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetPayoffChapter" label="目标回收章位">
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="currentState" label="当前状态描述">
                <Input.TextArea rows={3} placeholder="写现在推进到了哪一步，阻力在哪，谁正在承受代价。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="payoffCondition" label="回收条件">
                <Input.TextArea rows={3} placeholder="写清楚发生什么以后，这条线程才算真正回收。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="notes" label="补充说明">
                <Input.TextArea rows={3} placeholder="补充风险点、伏笔位置，或与其他线程的耦合关系。" />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>

      <Modal
        title="AI 批量生成故事线程"
        open={generateOpen}
        forceRender
        onCancel={() => setGenerateOpen(false)}
        onOk={() => void handleGenerate()}
        confirmLoading={generating}
        okText="开始生成"
        width={560}
      >
        <Form form={generateForm} layout="vertical" initialValues={DEFAULT_GENERATE_VALUES}>
          <Form.Item name="count" label="目标数量" rules={[{ required: true, message: '请填写数量' }]}>
            <InputNumber min={1} max={20} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="batchSize" label="单批数量" rules={[{ required: true, message: '请填写单批数量' }]}>
            <InputNumber min={1} max={6} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="focus" label="本轮聚焦方向">
            <Input.TextArea rows={4} placeholder="例如：优先补悬念线和关系线；避免重复主线冲突；重点围绕第 20-40 章的中段压力。" />
          </Form.Item>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
