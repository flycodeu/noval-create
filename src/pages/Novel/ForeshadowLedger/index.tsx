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
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
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
import {
  buildDraftMessages,
  matchSelectionIdByLabels,
  parseDraftJson,
} from '../shared/ai-draft'
import { buildPlanningContextSections } from '../shared/planning-context'
import { useNovelWorkspaceActions, useRegisterWorkspaceLeaveGuard } from '../workspace-shortcuts-context'
import './index.css'

interface Props {
  novelId: number
}

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

function getStatusLabel(status: string): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status || '草稿'
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

function compareLedgerEntries(left: ForeshadowLedgerEntry, right: ForeshadowLedgerEntry, currentChapterNum: number): number {
  const laneRank: Record<LedgerLaneKey, number> = { overdue: 0, dueSoon: 1, pending: 2, resolved: 3 }
  const leftLane = getLane(left, currentChapterNum)
  const rightLane = getLane(right, currentChapterNum)
  if (laneRank[leftLane] !== laneRank[rightLane]) return laneRank[leftLane] - laneRank[rightLane]

  const leftTarget = typeof left.targetPayoffChapter === 'number' ? left.targetPayoffChapter : Number.MAX_SAFE_INTEGER
  const rightTarget = typeof right.targetPayoffChapter === 'number' ? right.targetPayoffChapter : Number.MAX_SAFE_INTEGER
  if (leftTarget !== rightTarget) return leftTarget - rightTarget
  return right.id - left.id
}

function hasFilledValues(values: Array<string | undefined | null>): boolean {
  return values.some((value) => Boolean(value && value.trim()))
}

export default function ForeshadowLedgerPage({ novelId }: Props) {
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const { mutationToken, notifyWorkspaceMutation, registerEscapeHandler, registerSaveHandler } = useNovelWorkspaceActions()
  const [form] = Form.useForm<ForeshadowFormValues>()

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingStatusId, setUpdatingStatusId] = useState<number | null>(null)
  const [laneFilter, setLaneFilter] = useState<'all' | LedgerLaneKey>('all')
  const [keyword, setKeyword] = useState('')
  const [entries, setEntries] = useState<ForeshadowLedgerEntry[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [volumes, setVolumes] = useState<StoryVolume[]>([])
  const [threads, setThreads] = useState<StoryThread[]>([])
  const [commitments, setCommitments] = useState<EndgameCommitment[]>([])
  const [segments, setSegments] = useState<ChapterSegment[]>([])
  const [segmentsLoading, setSegmentsLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<ForeshadowLedgerEntry | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  useRegisterWorkspaceLeaveGuard(hasUnsavedChanges)
  const refreshRequestRef = React.useRef(0)
  const segmentsRequestRef = React.useRef(0)
  const editorDirtyRef = React.useRef(false)

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
  const watchedFormValues = Form.useWatch([], form) as Partial<ForeshadowFormValues> | undefined
  const formValues = useMemo<Partial<ForeshadowFormValues>>(
    () => watchedFormValues ?? {},
    [watchedFormValues],
  )
  const currentFormValues = useMemo<ForeshadowFormValues>(() => ({
    ...toFormValues(editingEntry),
    ...formValues,
  }), [editingEntry, formValues])
  const threadOptions = useMemo(() => threads.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, item.summary || '', item.premise || ''],
  })), [threads])
  const commitmentOptions = useMemo(() => commitments.map((item) => ({
    id: item.id,
    label: item.title,
    aliases: [item.title, `${item.commitmentKind === 'payoff' ? '回收' : '承诺'}${item.title}`],
  })), [commitments])
  const volumeOptions = useMemo(() => volumes.map((item) => ({
    id: item.id,
    label: item.title?.trim() || `第${item.volumeNumber}卷`,
    aliases: [item.title?.trim() || '', `第${item.volumeNumber}卷`],
  })), [volumes])

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
    const sorted = [...entries].sort((left, right) => compareLedgerEntries(left, right, currentChapterNum))
    const normalizedKeyword = keyword.trim().toLowerCase()
    return sorted.filter((entry) => {
      if (laneFilter !== 'all' && getLane(entry, currentChapterNum) !== laneFilter) return false
      if (!normalizedKeyword) return true
      return [entry.title, entry.detail, entry.payoffSceneAction, entry.requiredEvidence]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedKeyword))
    })
  }, [currentChapterNum, entries, keyword, laneFilter])

  const selectedEntry = useMemo(
    () => filteredTableRows.find((entry) => entry.id === selectedEntryId) || filteredTableRows[0] || null,
    [filteredTableRows, selectedEntryId],
  )
  const selectedEntryLane = selectedEntry ? getLane(selectedEntry, currentChapterNum) : null

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [ledgerRows, chapterRows, volumeRows, threadRows, commitmentRows] = await Promise.all([
        window.electron.foreshadow.listLedger(novelId),
        window.electron.chapter.list(novelId),
        window.electron.structure.listVolumes(novelId),
        window.electron.thread.list(novelId),
        window.electron.endgameAsset.listCommitments(novelId),
      ])
      if (refreshRequestRef.current !== requestId) return
      setEntries(ledgerRows)
      setChapters(chapterRows)
      setVolumes(volumeRows)
      setThreads(threadRows)
      setCommitments(commitmentRows)
      setSelectedEntryId((current) => current && ledgerRows.some((entry) => entry.id === current)
        ? current
        : [...ledgerRows].sort((left, right) => compareLedgerEntries(left, right, currentChapterNum))[0]?.id || null)
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'common.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [currentChapterNum, novelId])

  const loadSegments = useCallback(async (chapterId?: number) => {
    const requestId = ++segmentsRequestRef.current
    if (!chapterId) {
      if (segmentsRequestRef.current === requestId) setSegments([])
      return
    }
    setSegmentsLoading(true)
    try {
      const rows = await window.electron.structure.listSegments(chapterId)
      if (segmentsRequestRef.current === requestId) setSegments(rows)
    } catch (error) {
      console.error(error)
      if (segmentsRequestRef.current === requestId) setSegments([])
    } finally {
      if (segmentsRequestRef.current === requestId) setSegmentsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [mutationToken, refresh])

  useEffect(() => {
    if (!editorOpen) return
    void loadSegments(sourceChapterId)
  }, [editorOpen, loadSegments, sourceChapterId])

  useEffect(() => {
    setSelectedEntryId((current) => filteredTableRows.some((entry) => entry.id === current)
      ? current
      : filteredTableRows[0]?.id || null)
  }, [filteredTableRows])

  const openEditor = useCallback((entry?: ForeshadowLedgerEntry | null) => {
    const target = entry || null
    setEditingEntry(target)
    editorDirtyRef.current = false
    setHasUnsavedChanges(false)
    form.resetFields()
    form.setFieldsValue(toFormValues(target))
    setEditorOpen(true)
  }, [form])

  const closeEditor = useCallback((force = false) => {
    const commit = () => {
      editorDirtyRef.current = false
      setHasUnsavedChanges(false)
      setEditorOpen(false)
      setEditingEntry(null)
      setSegments([])
    }
    if (!force && editorDirtyRef.current) {
      Modal.confirm({
        title: '当前伏笔还有未保存修改',
        content: '关闭编辑会丢弃当前修改，是否继续？',
        okText: '放弃修改并关闭',
        cancelText: '留下继续编辑',
        onOk: commit,
      })
      return
    }
    commit()
  }, [])

  const handleSave = useCallback(async () => {
    const rawValues = await form.validateFields().catch(() => null)
    if (!rawValues) return
    const values = normalizeFormValues(rawValues)
    if (!values.title) {
      message.warning(getUserFacingMessage('foreshadow.titleRequired'))
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
      closeEditor(true)
      await refresh()
      notifyWorkspaceMutation()
      message.success(getUserFacingMessage(editingEntry ? 'foreshadow.updated' : 'foreshadow.created'))
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
          message.success(getUserFacingMessage('foreshadow.deleted'))
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
      className="novel-foreshadow-ledger-page"
      layout="wide"
      heroVariant="compact"
      eyebrow="剧情与伏笔 / 回收账本"
      title="伏笔与回收账本"
      chrome="shared"
      actionContract={{
        primary: { key: 'create-foreshadow', label: '新建伏笔资产', icon: <PlusOutlined />, onClick: () => openEditor() },
      }}
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

      <div className="novel-foreshadow-ledger__status-rail" data-foreshadow-save-state={hasUnsavedChanges ? 'unsaved' : 'saved'}>
        <span className={`novel-foreshadow-ledger__status-dot${hasUnsavedChanges ? ' is-unsaved' : ''}`} aria-hidden="true" />
        <strong>{hasUnsavedChanges ? '伏笔编辑器有未保存修改' : '账本与当前项目数据同步'}</strong>
      </div>

      <div className="novel-foreshadow-ledger__workspace">
        <WorkspacePanel
          title="伏笔目录"
          className="novel-foreshadow-ledger__list-panel"
          bodyClassName="novel-foreshadow-ledger__list-body"
        >
          <div className="novel-foreshadow-ledger__filters" data-foreshadow-filters>
            <Input
              allowClear
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索伏笔标题、说明或回收动作"
              className="novel-foreshadow-ledger__search"
            />
            <Select
              value={laneFilter}
              className="novel-foreshadow-ledger__filter-select"
              onChange={(value) => setLaneFilter(value as 'all' | LedgerLaneKey)}
              options={[
                { value: 'all', label: '全部风险' },
                { value: 'pending', label: '待回收' },
                { value: 'dueSoon', label: '即将到期' },
                { value: 'overdue', label: '超期未收' },
                { value: 'resolved', label: '已回收/归档' },
              ]}
            />
          </div>
          <div className="novel-foreshadow-ledger__list-scroll" data-foreshadow-list>
            <Table<ForeshadowLedgerEntry>
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 12, showSizeChanger: false }}
              dataSource={filteredTableRows}
              rowClassName={(record) => record.id === selectedEntry?.id ? 'is-selected' : ''}
              onRow={(record) => ({ onClick: () => setSelectedEntryId(record.id) })}
              columns={[
                {
                  title: '伏笔资产',
                  dataIndex: 'title',
                  key: 'title',
                  width: 230,
                  render: (_value, record) => (
                    <div className="novel-foreshadow-ledger__table-copy">
                      <strong>{record.title}</strong>
                      <span>{record.detail || record.payoffSceneAction || '尚未填写简述'}</span>
                    </div>
                  ),
                },
                {
                  title: '到期风险',
                  key: 'risk',
                  width: 104,
                  render: (_value, record) => {
                    const lane = getLane(record, currentChapterNum)
                    return <Tag color={lane === 'overdue' ? 'error' : lane === 'dueSoon' ? 'warning' : lane === 'resolved' ? 'success' : 'processing'}>{laneMeta(lane).title}</Tag>
                  },
                },
                {
                  title: '埋设 / 回收',
                  key: 'chapters',
                  width: 136,
                  responsive: ['md'],
                  render: (_value, record) => {
                    const chapter = record.sourceChapterId ? chapterById.get(record.sourceChapterId) : null
                    return <div className="novel-foreshadow-ledger__table-meta"><span>{chapter ? `埋设第${chapter.chapterNum}章` : '未设埋设章'}</span><span>{typeof record.targetPayoffChapter === 'number' ? `回收第${record.targetPayoffChapter}章` : '未设回收章'}</span></div>
                  },
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 142,
                  responsive: ['md'],
                  render: (value, record) => (
                    <Space size={8}>
                      <Tag color={getStatusTagColor(value)}>{getStatusLabel(value)}</Tag>
                      <Select
                        size="small"
                        value={value || 'draft'}
                        className="novel-foreshadow-ledger__status-select"
                        loading={updatingStatusId === record.id}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(nextStatus) => {
                          if (nextStatus !== record.status) void handleQuickStatusChange(record, String(nextStatus))
                        }}
                        options={STATUS_OPTIONS}
                      />
                    </Space>
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 116,
                  render: (_value, record) => (
                    <Space size={8}>
                      <Button size="small" onClick={(event) => { event.stopPropagation(); openEditor(record) }}>编辑</Button>
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={`删除伏笔 ${record.title}`} onClick={(event) => { event.stopPropagation(); handleDelete(record) }}>删除</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        </WorkspacePanel>

        <WorkspacePanel
          title={selectedEntry ? '当前伏笔详情' : '当前详情'}
          sticky
          className="novel-foreshadow-ledger__detail-panel"
          bodyClassName="novel-foreshadow-ledger__detail-body"
        >
          {selectedEntry ? (
            <div data-foreshadow-current-detail>
              <div className="novel-foreshadow-ledger__detail-heading">
                <div>
                  <span className="novel-kicker">{selectedEntryLane ? laneMeta(selectedEntryLane).title : '状态待计算'}</span>
                  <h3>{selectedEntry.title}</h3>
                </div>
                {selectedEntryLane ? <Tag color={selectedEntryLane === 'overdue' ? 'error' : selectedEntryLane === 'dueSoon' ? 'warning' : selectedEntryLane === 'resolved' ? 'success' : 'processing'} data-foreshadow-due-risk>{laneMeta(selectedEntryLane).hint}</Tag> : null}
              </div>
              <div className="novel-foreshadow-ledger__detail-facts" data-foreshadow-chapter-mount>
                <div><span>埋设位置</span><strong>{selectedEntry.sourceChapterId ? `第${chapterById.get(selectedEntry.sourceChapterId)?.chapterNum || '?'}章${selectedEntry.sourceSegmentId ? ` · 场景#${selectedEntry.sourceSegmentId}` : ''}` : '未绑定章节'}</strong></div>
                <div><span>目标回收</span><strong>{typeof selectedEntry.targetPayoffChapter === 'number' ? `第${selectedEntry.targetPayoffChapter}章` : '未设章位'}</strong></div>
                <div><span>显著度</span><strong>{SALIENCE_OPTIONS.find((item) => item.value === selectedEntry.salienceLevel)?.label || selectedEntry.salienceLevel}</strong></div>
                <div><span>影响范围</span><strong>{IMPACT_SCOPE_OPTIONS.find((item) => item.value === selectedEntry.impactScope)?.label || selectedEntry.impactScope}</strong></div>
                <div><span>关联线程</span><strong>{selectedEntry.linkedThreadId ? threadById.get(selectedEntry.linkedThreadId)?.title || `线程#${selectedEntry.linkedThreadId}` : '未绑定'}</strong></div>
                <div><span>终局承诺</span><strong>{selectedEntry.linkedEndgameCommitmentId ? commitmentById.get(selectedEntry.linkedEndgameCommitmentId)?.title || `承诺#${selectedEntry.linkedEndgameCommitmentId}` : '未绑定'}</strong></div>
              </div>
              <details className="novel-foreshadow-ledger__detail-disclosure" open>
                <summary>回收条件与正文动作</summary>
                <div className="novel-foreshadow-ledger__detail-copy">
                  <p>{selectedEntry.detail || '尚未填写伏笔说明。'}</p>
                  <p><strong>埋设方式：</strong>{selectedEntry.plantMethod || '未填写'}</p>
                  <p><strong>回收方式：</strong>{selectedEntry.payoffMethod || '未填写'}</p>
                  <p><strong>场景动作：</strong>{selectedEntry.payoffSceneAction || '未填写'}</p>
                  <p><strong>读者可见结果：</strong>{selectedEntry.readerVisibleOutcome || '未填写'}</p>
                  <p><strong>必需证据：</strong>{selectedEntry.requiredEvidence || '未填写'}</p>
                  {selectedEntry.allowedDelayReason ? <p><strong>允许延迟：</strong>{selectedEntry.allowedDelayReason}</p> : null}
                </div>
              </details>
              <div className="novel-foreshadow-ledger__detail-actions">
                <Button type="primary" onClick={() => openEditor(selectedEntry)}>编辑伏笔</Button>
                <Button loading={updatingStatusId === selectedEntry.id} disabled={selectedEntry.status === 'active'} onClick={() => void handleQuickStatusChange(selectedEntry, 'active')}>标记推进</Button>
                <Button loading={updatingStatusId === selectedEntry.id} disabled={selectedEntry.status === 'resolved'} onClick={() => void handleQuickStatusChange(selectedEntry, 'resolved')}>标记回收</Button>
                <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(selectedEntry)}>删除</Button>
              </div>
            </div>
          ) : <div className="novel-empty">当前没有可展示的伏笔详情。</div>}
        </WorkspacePanel>
      </div>

      <Modal
        width={860}
        title={editingEntry ? `编辑伏笔 #${editingEntry.id}` : '新建伏笔'}
        open={editorOpen}
        onCancel={() => closeEditor()}
        onOk={() => void handleSave()}
        okText={editingEntry ? '保存修改' : '创建伏笔'}
        confirmLoading={saving}
      >
        <Form
          form={form}
          layout="vertical"
          onValuesChange={() => {
            editorDirtyRef.current = true
            setHasUnsavedChanges(true)
          }}
        >
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--full">
              <AIGenerateButton
                novelId={novelId}
                label={editingEntry ? 'AI 补全·当前伏笔' : 'AI 生成·伏笔草稿'}
                intent={hasFilledValues([
                  currentFormValues.title,
                  currentFormValues.detail,
                  currentFormValues.plantMethod,
                  currentFormValues.payoffMethod,
                  currentFormValues.payoffSceneAction,
                  currentFormValues.requiredEvidence,
                ]) ? 'complete' : 'generate'}
                isJson
                buildMessages={() => buildDraftMessages({
                  task: editingEntry ? `伏笔资产 · ${editingEntry.title}` : '伏笔资产草稿',
                  mode: hasFilledValues([
                    currentFormValues.title,
                    currentFormValues.detail,
                    currentFormValues.plantMethod,
                    currentFormValues.payoffMethod,
                    currentFormValues.payoffSceneAction,
                    currentFormValues.requiredEvidence,
                  ]) ? 'optimize' : 'replace',
                  context: buildPlanningContextSections(currentNovel, {
                    includeSubplots: true,
                    extraSections: [
                      { label: '当前章节进度', value: currentChapterNum > 0 ? `第${currentChapterNum}章` : '' },
                      { label: '可绑定故事线程', value: threads.map((item) => item.title) },
                      { label: '可绑定终局承诺', value: commitments.map((item) => item.title) },
                      { label: '可绑定卷', value: volumes.map((item) => item.title?.trim() || `第${item.volumeNumber}卷`) },
                    ],
                  }),
                  fields: [
                    { key: 'title', label: '伏笔标题', value: currentFormValues.title, hint: '写成可复用、可追踪的资产名称。' },
                    { key: 'detail', label: '伏笔说明', value: currentFormValues.detail, hint: '写清内容、误导结构或触发条件。' },
                    { key: 'plantMethod', label: '埋设方式', value: currentFormValues.plantMethod, hint: '写正文里如何埋设。' },
                    { key: 'targetPayoffChapter', label: '目标回收章位', type: 'number', value: currentFormValues.targetPayoffChapter, hint: '给出正整数章位。' },
                    { key: 'payoffMethod', label: '回收方式', value: currentFormValues.payoffMethod, hint: '写如何被真正回收。' },
                    { key: 'payoffSceneAction', label: '回收动作', value: currentFormValues.payoffSceneAction, hint: '写正文里必须发生的具体动作。' },
                    { key: 'requiredEvidence', label: '可见证据', value: currentFormValues.requiredEvidence, hint: '写读者必须看到的证据。' },
                    { key: 'readerVisibleOutcome', label: '读者可见结果', value: currentFormValues.readerVisibleOutcome, hint: '写回收后读者明确知道了什么。' },
                    { key: 'allowedDelayReason', label: '允许延期理由', value: currentFormValues.allowedDelayReason, hint: '若不能按期回收，写合理延期理由。' },
                    { key: 'linkedThreadTitle', label: '关联故事线程标题', value: threads.find((item) => item.id === currentFormValues.linkedThreadId)?.title || '', hint: '只能从可绑定故事线程中选标题。' },
                    { key: 'linkedEndgameCommitmentTitle', label: '关联终局承诺标题', value: commitments.find((item) => item.id === currentFormValues.linkedEndgameCommitmentId)?.title || '', hint: '只能从可绑定终局承诺中选标题。' },
                    { key: 'linkedVolumeTitle', label: '关联卷标题', value: volumes.find((item) => item.id === currentFormValues.linkedVolumeId)?.title?.trim() || '', hint: '只能从可绑定卷中选标题。' },
                  ],
                  requirements: [
                    '必须与故事线程、终局承诺和当前世界规则一致。',
                    '不要生成无法在正文里被看见和核对的空泛伏笔。',
                  ],
                })}
                onResult={(raw) => {
                  const draft = parseDraftJson<Record<string, unknown>>(raw)
                  form.setFieldsValue({
                    title: typeof draft.title === 'string' ? draft.title : undefined,
                    detail: typeof draft.detail === 'string' ? draft.detail : undefined,
                    plantMethod: typeof draft.plantMethod === 'string' ? draft.plantMethod : undefined,
                    targetPayoffChapter: typeof draft.targetPayoffChapter === 'number' ? draft.targetPayoffChapter : undefined,
                    payoffMethod: typeof draft.payoffMethod === 'string' ? draft.payoffMethod : undefined,
                    payoffSceneAction: typeof draft.payoffSceneAction === 'string' ? draft.payoffSceneAction : undefined,
                    requiredEvidence: typeof draft.requiredEvidence === 'string' ? draft.requiredEvidence : undefined,
                    readerVisibleOutcome: typeof draft.readerVisibleOutcome === 'string' ? draft.readerVisibleOutcome : undefined,
                    allowedDelayReason: typeof draft.allowedDelayReason === 'string' ? draft.allowedDelayReason : undefined,
                    linkedThreadId: Object.prototype.hasOwnProperty.call(draft, 'linkedThreadTitle')
                      ? matchSelectionIdByLabels(draft.linkedThreadTitle, threadOptions)
                      : undefined,
                    linkedEndgameCommitmentId: Object.prototype.hasOwnProperty.call(draft, 'linkedEndgameCommitmentTitle')
                      ? matchSelectionIdByLabels(draft.linkedEndgameCommitmentTitle, commitmentOptions)
                      : undefined,
                    linkedVolumeId: Object.prototype.hasOwnProperty.call(draft, 'linkedVolumeTitle')
                      ? matchSelectionIdByLabels(draft.linkedVolumeTitle, volumeOptions)
                      : undefined,
                  })
                }}
              />
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="伏笔标题" rules={[{ required: true, message: '请填写伏笔标题' }]}>
                <Input placeholder="例如：父亲留下的无名戒指" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="detail" label="伏笔说明">
                <Input.TextArea rows={6} placeholder="补充伏笔内容、触发条件或误导结构。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="plantMethod" label="埋设方式">
                <Input.TextArea rows={6} placeholder="例如：道具特写 / 对话暗示 / 行为异常。" />
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
                <InputNumber min={1} precision={0} className="novel-foreshadow-ledger__full-width-input" placeholder="例如：24" />
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
                <Input.TextArea rows={6} placeholder="例如：庭审反转时作为关键证据揭示。 " />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="payoffSceneAction" label="回收动作">
                <Input.TextArea rows={6} placeholder="正文里必须发生的具体动作，例如：当众出示戒指并逼出供词。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="requiredEvidence" label="可见证据">
                <Input.TextArea rows={6} placeholder="读者必须看到的证据，例如：戒指内圈刻字、监控残片、伤口特征。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="readerVisibleOutcome" label="读者可见结果">
                <Input.TextArea rows={6} placeholder="本章结束后读者明确知道了什么。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card">
              <Form.Item name="allowedDelayReason" label="允许延期理由">
                <Input.TextArea rows={6} placeholder="如果本章不回收，正文允许写出的延期原因。" />
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
