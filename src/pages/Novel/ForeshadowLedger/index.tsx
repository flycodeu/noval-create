import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  message,
} from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { getErrorMessage } from '@/utils/user-facing-message'
import type {
  Chapter,
  ChapterSegment,
  EndgameCommitment,
  ForeshadowLedgerEntry,
  StoryThread,
  StoryVolume,
} from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
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

type LedgerViewMode = 'board' | 'table'
type LedgerLaneKey = 'pending' | 'dueSoon' | 'overdue' | 'resolved'

interface ForeshadowFormValues {
  title: string
  detail: string
  sourceChapterId?: number
  sourceSegmentId?: number
  plantMethod: string
  salienceLevel: string
  targetPayoffChapter?: number
  payoffMethod: string
  payoffSceneAction: string
  requiredEvidence: string
  readerVisibleOutcome: string
  allowedDelayReason: string
  impactScope: string
  status: string
  linkedThreadId?: number
  linkedEndgameCommitmentId?: number
  linkedVolumeId?: number
}

const STATUS_OPTIONS = [
  { value: 'draft', label: '草稿' },
  { value: 'active', label: '进行中' },
  { value: 'resolved', label: '已回收' },
  { value: 'archived', label: '归档' },
]

const SALIENCE_OPTIONS = [
  { value: 'low', label: '低显著' },
  { value: 'medium', label: '中显著' },
  { value: 'high', label: '高显著' },
]

const IMPACT_SCOPE_OPTIONS = [
  { value: 'local', label: '局部' },
  { value: 'character', label: '人物线' },
  { value: 'world', label: '世界观线' },
  { value: 'global', label: '全局主线' },
]

const DEFAULT_FORM_VALUES: ForeshadowFormValues = {
  title: '',
  detail: '',
  sourceChapterId: undefined,
  sourceSegmentId: undefined,
  plantMethod: '',
  salienceLevel: 'medium',
  targetPayoffChapter: undefined,
  payoffMethod: '',
  payoffSceneAction: '',
  requiredEvidence: '',
  readerVisibleOutcome: '',
  allowedDelayReason: '',
  impactScope: 'global',
  status: 'draft',
  linkedThreadId: undefined,
  linkedEndgameCommitmentId: undefined,
  linkedVolumeId: undefined,
}

function normalizeText(value?: string | null): string {
  return value?.trim() || ''
}

function toFormValues(entry?: ForeshadowLedgerEntry | null): ForeshadowFormValues {
  if (!entry) return DEFAULT_FORM_VALUES
  return {
    title: entry.title || '',
    detail: entry.detail || '',
    sourceChapterId: entry.sourceChapterId || undefined,
    sourceSegmentId: entry.sourceSegmentId || undefined,
    plantMethod: entry.plantMethod || '',
    salienceLevel: entry.salienceLevel || 'medium',
    targetPayoffChapter: entry.targetPayoffChapter || undefined,
    payoffMethod: entry.payoffMethod || '',
    payoffSceneAction: entry.payoffSceneAction || '',
    requiredEvidence: entry.requiredEvidence || '',
    readerVisibleOutcome: entry.readerVisibleOutcome || '',
    allowedDelayReason: entry.allowedDelayReason || '',
    impactScope: entry.impactScope || 'global',
    status: entry.status || 'draft',
    linkedThreadId: entry.linkedThreadId || undefined,
    linkedEndgameCommitmentId: entry.linkedEndgameCommitmentId || undefined,
    linkedVolumeId: entry.linkedVolumeId || undefined,
  }
}

function normalizeFormValues(values: ForeshadowFormValues): ForeshadowFormValues {
  return {
    ...values,
    title: normalizeText(values.title),
    detail: normalizeText(values.detail),
    plantMethod: normalizeText(values.plantMethod),
    payoffMethod: normalizeText(values.payoffMethod),
    payoffSceneAction: normalizeText(values.payoffSceneAction),
    requiredEvidence: normalizeText(values.requiredEvidence),
    readerVisibleOutcome: normalizeText(values.readerVisibleOutcome),
    allowedDelayReason: normalizeText(values.allowedDelayReason),
  }
}

function getStatusTagColor(status: string): string {
  if (status === 'resolved') return 'success'
  if (status === 'active') return 'processing'
  if (status === 'archived') return 'default'
  return 'gold'
}

function getLane(entry: ForeshadowLedgerEntry, currentChapterNum: number): LedgerLaneKey {
  if (entry.status === 'resolved' || entry.status === 'archived') return 'resolved'
  const target = typeof entry.targetPayoffChapter === 'number' ? entry.targetPayoffChapter : null
  if (target == null || target <= 0) return 'pending'
  if (target < currentChapterNum) return 'overdue'
  if (target <= currentChapterNum + 2) return 'dueSoon'
  return 'pending'
}

function laneMeta(lane: LedgerLaneKey): { title: string; hint: string } {
  if (lane === 'pending') return { title: '待回收', hint: '未到期或未设回收章位。' }
  if (lane === 'dueSoon') return { title: '即将到期', hint: '目标章位接近当前进度。' }
  if (lane === 'overdue') return { title: '超期未收', hint: '目标章位已落后于当前进度。' }
  return { title: '已回收', hint: '已登记回收/归档。' }
}

export default function ForeshadowLedgerPage({ novelId }: Props) {
  const { currentNovel } = useNovelStore()
  const { mutationToken, notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ForeshadowFormValues>()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<LedgerViewMode>('board')
  const [laneFilter, setLaneFilter] = useState<'all' | LedgerLaneKey>('all')
  const [entries, setEntries] = useState<ForeshadowLedgerEntry[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [volumes, setVolumes] = useState<StoryVolume[]>([])
  const [threads, setThreads] = useState<StoryThread[]>([])
  const [commitments, setCommitments] = useState<EndgameCommitment[]>([])
  const [segments, setSegments] = useState<ChapterSegment[]>([])
  const [segmentsLoading, setSegmentsLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ForeshadowLedgerEntry | null>(null)

  const sourceChapterId = Form.useWatch('sourceChapterId', form)

  const chapterById = useMemo(
    () => new Map(chapters.map((chapter) => [chapter.id, chapter] as const)),
    [chapters],
  )
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread] as const)),
    [threads],
  )
  const commitmentById = useMemo(
    () => new Map(commitments.map((item) => [item.id, item] as const)),
    [commitments],
  )
  const currentChapterNum = useMemo(
    () => Math.max(0, ...chapters.map((chapter) => chapter.chapterNum || 0)),
    [chapters],
  )

  const laneBuckets = useMemo(() => {
    const buckets: Record<LedgerLaneKey, ForeshadowLedgerEntry[]> = {
      pending: [],
      dueSoon: [],
      overdue: [],
      resolved: [],
    }
    entries.forEach((entry) => {
      buckets[getLane(entry, currentChapterNum)].push(entry)
    })
    return buckets
  }, [currentChapterNum, entries])

  const filteredTableRows = useMemo(() => {
    const sorted = [...entries].sort((left, right) => right.id - left.id)
    if (laneFilter === 'all') return sorted
    return sorted.filter((entry) => getLane(entry, currentChapterNum) === laneFilter)
  }, [currentChapterNum, entries, laneFilter])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [ledgerRows, chapterRows, volumeRows, threadRows, commitmentRows] = await Promise.all([
        window.electron.foreshadow.listLedger(novelId),
        window.electron.chapter.list(novelId),
        window.electron.structure.listVolumes(novelId),
        window.electron.thread.list(novelId),
        window.electron.endgameAsset.listCommitments(novelId),
      ])
      setEntries(ledgerRows)
      setChapters(chapterRows)
      setVolumes(volumeRows)
      setThreads(threadRows)
      setCommitments(commitmentRows)
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [novelId])

  const loadSegments = useCallback(async (chapterId?: number) => {
    if (!chapterId) {
      setSegments([])
      return
    }
    setSegmentsLoading(true)
    try {
      const rows = await window.electron.structure.listSegments(chapterId)
      setSegments(rows)
    } catch (error) {
      console.error(error)
      setSegments([])
    } finally {
      setSegmentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    if (!editorOpen) return
    void loadSegments(sourceChapterId)
  }, [editorOpen, loadSegments, sourceChapterId])

  const openEditor = useCallback((entry?: ForeshadowLedgerEntry | null) => {
    const target = entry || null
    setEditingEntry(target)
    form.resetFields()
    form.setFieldsValue(toFormValues(target))
    setEditorOpen(true)
  }, [form])

  const closeEditor = useCallback(() => {
    setEditorOpen(false)
    setEditingEntry(null)
    setSegments([])
  }, [])

  const handleSave = useCallback(async () => {
    const rawValues = await form.validateFields()
    const values = normalizeFormValues(rawValues)
    if (!values.title) {
      message.warning('请先填写伏笔标题。')
      return
    }
    setSaving(true)
    try {
      const payload: Partial<ForeshadowLedgerEntry> = {
        title: values.title,
        detail: values.detail || undefined,
        sourceChapterId: values.sourceChapterId || null,
        sourceSegmentId: values.sourceSegmentId || null,
        plantMethod: values.plantMethod || undefined,
        salienceLevel: values.salienceLevel || 'medium',
        targetPayoffChapter: values.targetPayoffChapter || null,
        payoffMethod: values.payoffMethod || undefined,
        payoffSceneAction: values.payoffSceneAction || undefined,
        requiredEvidence: values.requiredEvidence || undefined,
        readerVisibleOutcome: values.readerVisibleOutcome || undefined,
        allowedDelayReason: values.allowedDelayReason || undefined,
        impactScope: values.impactScope || 'global',
        status: values.status || 'draft',
        linkedThreadId: values.linkedThreadId || null,
        linkedEndgameCommitmentId: values.linkedEndgameCommitmentId || null,
        linkedVolumeId: values.linkedVolumeId || null,
      }
      if (editingEntry) {
        payload.id = editingEntry.id
      }
      await window.electron.foreshadow.upsertLedger(novelId, payload)
      closeEditor()
      await refresh()
      notifyWorkspaceMutation()
      message.success(editingEntry ? '伏笔账本已更新。' : '伏笔账本已新增。')
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [closeEditor, editingEntry, form, novelId, notifyWorkspaceMutation, refresh])

  const handleDelete = useCallback((entry: ForeshadowLedgerEntry) => {
    Modal.confirm({
      title: `删除伏笔「${entry.title}」`,
      content: '删除后会立即从伏笔账本移除，相关章节合同/场景合同不会自动改写。',
      okType: 'danger',
      onOk: async () => {
        try {
          await window.electron.foreshadow.deleteLedger(novelId, entry.id)
          await refresh()
          notifyWorkspaceMutation()
          message.success('伏笔已删除。')
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'common.saveFailed'))
        }
      },
    })
  }, [novelId, notifyWorkspaceMutation, refresh])

  const handleQuickStatusChange = useCallback(async (entry: ForeshadowLedgerEntry, nextStatus: string) => {
    setUpdatingStatusId(entry.id)
    try {
      await window.electron.foreshadow.upsertLedger(novelId, {
        id: entry.id,
        status: nextStatus,
      })
      await refresh()
      notifyWorkspaceMutation()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'common.saveFailed'))
    } finally {
      setUpdatingStatusId(null)
    }
  }, [novelId, notifyWorkspaceMutation, refresh])

  useEffect(() => {
    registerSaveHandler(editorOpen ? () => { void handleSave() } : null)
    return () => registerSaveHandler(null)
  }, [editorOpen, handleSave, registerSaveHandler])

  useEffect(() => {
    registerEscapeHandler(() => {
      if (editorOpen) closeEditor()
    })
    return () => registerEscapeHandler(null)
  }, [closeEditor, editorOpen, registerEscapeHandler])

  return (
    <WorkspacePage
      className="novel-foreshadow-ledger-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="伏笔与回收账本"
      title="伏笔与回收账本"
      description="独立维护伏笔资产，支持章节/场景回写、回收状态追踪和终局绑定。"
      actions={(
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建伏笔资产
          </Button>
          <Select
            value={viewMode}
            style={{ minWidth: 140 }}
            onChange={(value) => setViewMode(value as LedgerViewMode)}
            options={[
              { value: 'board', label: '看板视图' },
              { value: 'table', label: '表格视图' },
            ]}
          />
        </Space>
      )}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '当前项目', value: currentNovel?.title || '未命名小说' },
            { label: '章节进度', value: currentChapterNum > 0 ? `第${currentChapterNum}章` : '尚未建章' },
            { label: '故事线程', value: `${threads.length} 条` },
            { label: '终局承诺', value: `${commitments.length} 条` },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="伏笔总数" value={entries.length} tone="warm" />
          <WorkspaceMetric label="待回收" value={laneBuckets.pending.length} />
          <WorkspaceMetric label="即将到期" value={laneBuckets.dueSoon.length} tone="cool" />
          <WorkspaceMetric label="超期未收" value={laneBuckets.overdue.length} tone={laneBuckets.overdue.length > 0 ? 'warm' : 'default'} />
          <WorkspaceMetric label="已回收/归档" value={laneBuckets.resolved.length} />
        </>
      )}
    >
      {chapters.length <= 0 ? (
        <Alert
          showIcon
          type="info"
          message="当前尚未建立章节"
          description="你仍可先建伏笔草稿，但建议先在结构规划里建立章节，便于绑定埋设位置和目标回收章位。"
        />
      ) : null}

      {viewMode === 'board' ? (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {(['pending', 'dueSoon', 'overdue', 'resolved'] as LedgerLaneKey[]).map((lane) => {
            const meta = laneMeta(lane)
            const laneRows = laneBuckets[lane]
            return (
              <WorkspacePanel
                key={lane}
                title={`${meta.title} · ${laneRows.length}`}
                description={meta.hint}
              >
                {laneRows.length <= 0 ? (
                  <div className="novel-copy-block">当前没有条目。</div>
                ) : (
                  <div className="novel-note-list">
                    {laneRows.map((entry) => {
                      const chapter = entry.sourceChapterId ? chapterById.get(entry.sourceChapterId) : null
                      return (
                        <div key={entry.id} className="novel-note-list__item">
                          <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <strong>{entry.title}</strong>
                              <Tag color={getStatusTagColor(entry.status)}>{entry.status || 'draft'}</Tag>
                              {typeof entry.targetPayoffChapter === 'number' ? <Tag>{`目标第${entry.targetPayoffChapter}章`}</Tag> : null}
                            </div>
                            <div style={{ opacity: 0.85 }}>
                              {chapter ? `埋设：第${chapter.chapterNum}章` : '埋设章节：未设置'}
                              {entry.sourceSegmentId ? ` · 场景#${entry.sourceSegmentId}` : ''}
                            </div>
                            {entry.detail ? <div>{entry.detail}</div> : null}
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <Button size="small" onClick={() => openEditor(entry)}>编辑</Button>
                              <Button
                                size="small"
                                loading={updatingStatusId === entry.id}
                                disabled={entry.status === 'active'}
                                onClick={() => void handleQuickStatusChange(entry, 'active')}
                              >
                                标记推进
                              </Button>
                              <Button
                                size="small"
                                loading={updatingStatusId === entry.id}
                                disabled={entry.status === 'resolved'}
                                onClick={() => void handleQuickStatusChange(entry, 'resolved')}
                              >
                                标记回收
                              </Button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </WorkspacePanel>
            )
          })}
        </div>
      ) : (
        <WorkspacePanel
          title="伏笔账本表格"
          extra={(
            <Select
              value={laneFilter}
              style={{ width: 160 }}
              onChange={(value) => setLaneFilter(value as 'all' | LedgerLaneKey)}
              options={[
                { value: 'all', label: '全部条目' },
                { value: 'pending', label: '待回收' },
                { value: 'dueSoon', label: '即将到期' },
                { value: 'overdue', label: '超期未收' },
                { value: 'resolved', label: '已回收/归档' },
              ]}
            />
          )}
        >
          <Table<ForeshadowLedgerEntry>
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 12, showSizeChanger: false }}
            dataSource={filteredTableRows}
            columns={[
              {
                title: '伏笔',
                dataIndex: 'title',
                key: 'title',
                width: 320,
                render: (_value, record) => (
                  <div style={{ display: 'grid', gap: 4 }}>
                    <strong>{record.title}</strong>
                    {record.detail ? <span style={{ opacity: 0.85 }}>{record.detail}</span> : null}
                    {record.payoffSceneAction ? <span style={{ opacity: 0.72 }}>{`动作：${record.payoffSceneAction}`}</span> : null}
                    {record.requiredEvidence ? <span style={{ opacity: 0.72 }}>{`证据：${record.requiredEvidence}`}</span> : null}
                  </div>
                ),
              },
              {
                title: '埋设位置',
                key: 'source',
                width: 180,
                render: (_value, record) => {
                  const chapter = record.sourceChapterId ? chapterById.get(record.sourceChapterId) : null
                  return (
                    <div style={{ display: 'grid', gap: 2 }}>
                      <span>{chapter ? `第${chapter.chapterNum}章` : '未设置章节'}</span>
                      <span style={{ opacity: 0.75 }}>{record.sourceSegmentId ? `场景#${record.sourceSegmentId}` : '未设置场景'}</span>
                    </div>
                  )
                },
              },
              {
                title: '目标回收',
                key: 'target',
                width: 120,
                render: (_value, record) => (typeof record.targetPayoffChapter === 'number' ? `第${record.targetPayoffChapter}章` : '未设置'),
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 180,
                render: (value, record) => (
                  <Space size={8}>
                    <Tag color={getStatusTagColor(value)}>{value || 'draft'}</Tag>
                    <Select
                      size="small"
                      value={value || 'draft'}
                      style={{ width: 92 }}
                      loading={updatingStatusId === record.id}
                      onChange={(nextStatus) => {
                        if (nextStatus !== record.status) {
                          void handleQuickStatusChange(record, String(nextStatus))
                        }
                      }}
                      options={STATUS_OPTIONS}
                    />
                  </Space>
                ),
              },
              {
                title: '绑定',
                key: 'links',
                width: 240,
                render: (_value, record) => (
                  <div style={{ display: 'grid', gap: 2 }}>
                    <span>{record.linkedThreadId ? `线程：${threadById.get(record.linkedThreadId)?.title || `#${record.linkedThreadId}`}` : '线程：未绑定'}</span>
                    <span>{record.linkedEndgameCommitmentId ? `终局：${commitmentById.get(record.linkedEndgameCommitmentId)?.title || `#${record.linkedEndgameCommitmentId}`}` : '终局：未绑定'}</span>
                  </div>
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 150,
                render: (_value, record) => (
                  <Space size={8}>
                    <Button size="small" onClick={() => openEditor(record)}>编辑</Button>
                    <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </WorkspacePanel>
      )}

      <Modal
        width={860}
        title={editingEntry ? `编辑伏笔 #${editingEntry.id}` : '新建伏笔'}
        open={editorOpen}
        onCancel={closeEditor}
        onOk={() => void handleSave()}
        okText={editingEntry ? '保存修改' : '创建伏笔'}
        confirmLoading={saving}
      >
        <Form form={form} layout="vertical">
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="伏笔标题" rules={[{ required: true, message: '请填写伏笔标题' }]}>
                <Input placeholder="例如：父亲留下的无名戒指" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="detail" label="伏笔说明">
                <Input.TextArea rows={3} placeholder="补充伏笔内容、触发条件或误导结构。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="plantMethod" label="埋设方式">
                <Input.TextArea rows={3} placeholder="例如：道具特写 / 对话暗示 / 行为异常。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="sourceChapterId" label="埋设章节">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={chapters.map((chapter) => ({
                    value: chapter.id,
                    label: `第${chapter.chapterNum}章 · ${chapter.title || '未命名章节'}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="sourceSegmentId" label="埋设场景">
                <Select
                  allowClear
                  loading={segmentsLoading}
                  disabled={!sourceChapterId}
                  options={segments.map((segment) => ({
                    value: segment.id,
                    label: `场景${String(segment.segmentOrder || 0).padStart(2, '0')} · ${segment.title || '未命名场景'}`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="targetPayoffChapter" label="目标回收章位">
                <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="例如：24" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="salienceLevel" label="显著度">
                <Select options={SALIENCE_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="impactScope" label="影响范围">
                <Select options={IMPACT_SCOPE_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="payoffMethod" label="回收方式">
                <Input.TextArea rows={3} placeholder="例如：庭审反转时作为关键证据揭示。 " />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="payoffSceneAction" label="回收动作">
                <Input.TextArea rows={3} placeholder="正文里必须发生的具体动作，例如：当众出示戒指并逼出供词。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredEvidence" label="可见证据">
                <Input.TextArea rows={3} placeholder="读者必须看到的证据，例如：戒指内圈刻字、监控残片、伤口特征。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="readerVisibleOutcome" label="读者可见结果">
                <Input.TextArea rows={3} placeholder="本章结束后读者明确知道了什么。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="allowedDelayReason" label="允许延期理由">
                <Input.TextArea rows={3} placeholder="如果本章不回收，正文允许写出的延期原因。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="linkedThreadId" label="关联故事线程">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={threads.map((thread) => ({
                    value: thread.id,
                    label: `${thread.title} (${thread.threadType})`,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="linkedEndgameCommitmentId" label="关联终局承诺">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  options={commitments.map((item) => ({
                    value: item.id,
                    label: item.title,
                  }))}
                />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="linkedVolumeId" label="关联卷">
                <Select
                  allowClear
                  options={volumes.map((volume) => ({
                    value: volume.id,
                    label: volume.title?.trim() || `第${volume.volumeNumber}卷`,
                  }))}
                />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
