import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Space, Tag, Tooltip, message } from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  DeleteOutlined,
  ArrowRightOutlined,
  EditOutlined,
  CheckOutlined,
  ToolOutlined,
  SearchOutlined,
  ClearOutlined,
} from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AIGenerateButton from '../../../components/AIGenerateButton'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import type { NovelConsistencyReport, NovelContextStatus, RevisionTask } from '../../../types'
import { useNovelStore } from '../../../stores/novel.store'
import { buildDraftMessages, parseDraftJson } from '../shared/ai-draft'
import { usePlanningDraft } from '../shared/planning-draft'
import { generateRevisionDraft } from '../shared/planning-ai-service'
import { buildRevisionTaskTargetPath } from '../shared/workspace-navigation'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import {
  WorkspaceContextSummary,
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../components/WorkspaceShell'
import {
  getConsistencySeverityColor,
  getConsistencySeverityLabel,
  getRevisionSeverityColor,
  getRevisionSeverityLabel,
} from '../shared/revision-quality'
import './RevisionCenter.css'

interface Props {
  novelId: number
}

interface RevisionTaskFormValues {
  taskType: string
  title: string
  description: string
  fixBrief: string
  status: RevisionTask['status']
  severity: RevisionTask['severity']
  relatedPage: string
}

const STATUS_OPTIONS = [
  { value: 'open', label: '待处理' },
  { value: 'in_progress', label: '处理中' },
  { value: 'resolved', label: '已解决' },
  { value: 'ignored', label: '已忽略' },
]

const SEVERITY_OPTIONS = [
  { value: 'high', label: '高优先' },
  { value: 'medium', label: '中优先' },
  { value: 'low', label: '低优先' },
]

const RELATED_PAGE_OPTIONS = [
  { value: 'project-brief', label: '项目立项' },
  { value: 'core-settings', label: '基础设定' },
  { value: 'theme-voice', label: '主题与文风' },
  { value: 'world-rules', label: '世界规则' },
  { value: 'map', label: '地图结构' },
  { value: 'characters', label: '角色系统' },
  { value: 'items', label: '物品装备' },
  { value: 'threads', label: '故事线程' },
  { value: 'story-design', label: '故事设计' },
  { value: 'outline', label: '故事大纲' },
  { value: 'timeline', label: '时间轴' },
  { value: 'writing', label: '正文写作' },
  { value: 'revision', label: '修订中心' },
]

const TASK_TYPE_LABELS: Record<string, string> = {
  continuity: '连续性',
  timeline: '时间线',
  character: '人物设定',
  map: '地图结构',
  plot: '剧情逻辑',
  rule: '世界规则',
}

const EMPTY_VALUES: RevisionTaskFormValues = {
  taskType: 'continuity',
  title: '',
  description: '',
  fixBrief: '',
  status: 'open',
  severity: 'medium',
  relatedPage: 'writing',
}

const REVISION_PAGE_SIZE = 50

function getStatusColor(status: RevisionTask['status']) {
  if (status === 'resolved') return 'success'
  if (status === 'in_progress') return 'processing'
  if (status === 'ignored') return 'default'
  return 'gold'
}

function getSourceColor(source: RevisionTask['taskSource']) {
  return source === 'system' ? 'purple' : 'blue'
}

function getSourceLabel(source: RevisionTask['taskSource']) {
  return source === 'system' ? '系统' : '人工'
}

function getStatusLabel(status: RevisionTask['status']) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status
}

function formatDate(value?: string | null): string {
  if (!value) return '-'
  try {
    const d = new Date(value)
    if (isNaN(d.getTime())) return '-'
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const hours = String(d.getHours()).padStart(2, '0')
    const minutes = String(d.getMinutes()).padStart(2, '0')
    return `${month}-${day} ${hours}:${minutes}`
  } catch {
    return '-'
  }
}

function buildIssueSummary(report: NovelConsistencyReport | null) {
  if (!report || report.issues.length === 0) return '最近一轮诊断暂无高风险问题。'
  return report.issues.slice(0, 5).map((issue) => `${getConsistencySeverityLabel(issue.severity)}：${issue.title}`).join('\n')
}

export default function RevisionCenterPage({ novelId }: Props) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const currentNovel = useNovelStore((state) => state.currentNovel)
  const [form] = Form.useForm<RevisionTaskFormValues>()
  const [tasks, setTasks] = useState<RevisionTask[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [stats, setStats] = useState({ total: 0, openCount: 0, inProgressCount: 0, resolvedCount: 0, blockerCount: 0 })
  const [contextStatus, setContextStatus] = useState<NovelContextStatus | null>(null)
  const [consistencyReport, setConsistencyReport] = useState<NovelConsistencyReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<RevisionTask | null>(null)
  const [sourceFilter, setSourceFilter] = useState<'all' | RevisionTask['taskSource']>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | RevisionTask['status']>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [draftWarnings, setDraftWarnings] = useState<string[]>([])
  const draftWarningsRef = React.useRef<string[]>([])
  const draftObservabilityRef = React.useRef<{ inputSummary: string; lintWarnings: string[]; rawOutputs: string[] } | null>(null)
  const refreshRequestRef = React.useRef(0)
  const relatedPageFilter = searchParams.get('relatedPage')?.trim() || undefined
  const entityTypeFilter = searchParams.get('entityType')?.trim() || undefined
  const entityIdFilter = (() => {
    const raw = searchParams.get('entityId')
    if (!raw) return undefined
    const numeric = Number(raw)
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined
  })()
  const scopedFilterSummary = [relatedPageFilter ? `页面=${relatedPageFilter}` : '', entityTypeFilter ? `实体=${entityTypeFilter}${entityIdFilter ? `#${entityIdFilter}` : ''}` : '']
    .filter(Boolean)
    .join('，')

  const refresh = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    setLoading(true)
    try {
      const [queryResult, nextStats, nextContextStatus, report] = await Promise.all([
        window.electron.revision.query({
          novelId,
          page,
          pageSize: REVISION_PAGE_SIZE,
          taskSource: sourceFilter === 'all' ? undefined : sourceFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          keyword: keyword.trim() || undefined,
          relatedPage: relatedPageFilter,
          entityType: entityTypeFilter,
          entityId: entityIdFilter,
        }),
        window.electron.revision.getStats({ novelId }),
        window.electron.novel.getContextStatus(novelId),
        window.electron.novel.runConsistencyCheck(novelId),
      ])
      if (refreshRequestRef.current !== requestId) return
      setTasks(queryResult.items)
      setTaskTotal(queryResult.total)
      setStats(nextStats)
      setContextStatus(nextContextStatus)
      setConsistencyReport(report)
    } catch (error) {
      if (refreshRequestRef.current !== requestId) return
      console.error(error)
      message.error(getErrorMessage(error, 'revisionCenter.loadFailed'))
    } finally {
      if (refreshRequestRef.current === requestId) setLoading(false)
    }
  }, [entityIdFilter, entityTypeFilter, keyword, novelId, page, relatedPageFilter, sourceFilter, statusFilter])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setPage(1)
  }, [entityIdFilter, entityTypeFilter, keyword, relatedPageFilter, sourceFilter, statusFilter])

  const manualCount = useMemo(
    () => tasks.filter((task) => task.taskSource === 'manual').length,
    [tasks],
  )
  const systemCount = tasks.length - manualCount
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [selectedTaskId, tasks],
  )

  const hasActiveFilters = sourceFilter !== 'all' || statusFilter !== 'all' || Boolean(keyword.trim()) || Boolean(scopedFilterSummary)

  useEffect(() => {
    if (!tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0]?.id || null)
    }
  }, [selectedTaskId, tasks])

  const clearAllFilters = useCallback(() => {
    setSourceFilter('all')
    setStatusFilter('all')
    setKeyword('')
    if (scopedFilterSummary) {
      setSearchParams({})
    }
  }, [scopedFilterSummary, setSearchParams])

  const applyRevisionDraft = useCallback((draft: Partial<RevisionTaskFormValues>) => {
    const currentValues = form.getFieldsValue(true)
    form.setFieldsValue({
      ...currentValues,
      taskType: typeof draft.taskType === 'string' ? draft.taskType : currentValues.taskType,
      title: typeof draft.title === 'string' ? draft.title : currentValues.title,
      description: typeof draft.description === 'string' ? draft.description : currentValues.description,
      fixBrief: typeof draft.fixBrief === 'string' ? draft.fixBrief : currentValues.fixBrief,
      status: typeof draft.status === 'string' ? draft.status as RevisionTask['status'] : currentValues.status,
      severity: typeof draft.severity === 'string' ? draft.severity as RevisionTask['severity'] : currentValues.severity,
      relatedPage: typeof draft.relatedPage === 'string' ? draft.relatedPage : currentValues.relatedPage,
    })
  }, [form])

  const { clearDraft, draft, finalizeDraft, saveAppliedDraft } = usePlanningDraft<RevisionTaskFormValues>({
    novelId,
    pageKey: 'revision',
    applyDraft: applyRevisionDraft,
  })

  const taskDraftButton = (
    <AIGenerateButton
      novelId={novelId}
      label="AI 生成·修订任务"
      intent="generate"
      isJson
      runGeneration={async (input) => {
        const result = await generateRevisionDraft(input, { genre: currentNovel?.genreName })
        draftWarningsRef.current = result.warnings
        draftObservabilityRef.current = result.observability
        setDraftWarnings(result.warnings)
        return result.outputs
      }}
      buildMessages={() => {
        const values = form.getFieldsValue(true)
        return buildDraftMessages({
          task: '人工修订任务',
          mode: values.title ? 'optimize' : 'replace',
          context: [
            { label: '小说名', value: currentNovel?.title || '' },
            { label: '题材', value: currentNovel?.genreName || '' },
            { label: '待同步章节', value: contextStatus?.staleChapterCount ?? 0 },
            { label: '高优先问题', value: consistencyReport?.highCount ?? 0 },
            { label: '诊断摘要', value: buildIssueSummary(consistencyReport) },
          ],
          fields: [
            { key: 'taskType', label: '任务类型', value: values.taskType, hint: '例如 continuity（连续性）、timeline（时间线）、character（人物）、map（地图）。' },
            { key: 'title', label: '任务标题', value: values.title, hint: '一句话说清要修什么。' },
            { key: 'description', label: '问题描述', value: values.description, hint: '写清问题和影响范围。' },
            { key: 'fixBrief', label: '修订方案', value: values.fixBrief, hint: '写成可执行的检查清单或修订动作。' },
            { key: 'status', label: '状态', value: values.status, hint: '只用 open、in_progress、resolved、ignored 之一。' },
            { key: 'severity', label: '优先级', value: values.severity, hint: '只用 high、medium、low 之一。' },
            { key: 'relatedPage', label: '关联页面', value: values.relatedPage, hint: '只填已有页面键，例如 writing、timeline、outline。' },
          ],
          requirements: [
            '只生成人工任务，不要复述系统提示原文。',
            '标题和方案都要具体，不要写空泛的“完善设定”“优化逻辑”。',
          ],
        })
      }}
      onResult={(raw) => {
        const parsedDraft = parseDraftJson<RevisionTaskFormValues>(raw)
        applyRevisionDraft(parsedDraft)
        void saveAppliedDraft(parsedDraft, draftWarningsRef.current, 'revision', draftObservabilityRef.current || undefined).catch(console.error)
      }}
    />
  )

  const openEditor = useCallback((task?: RevisionTask) => {
    setEditingTask(task || null)
    form.setFieldsValue(task ? {
      taskType: task.taskType || 'continuity',
      title: task.title,
      description: task.description || '',
      fixBrief: task.fixBrief || '',
      status: task.status,
      severity: task.severity,
      relatedPage: task.relatedPage || 'writing',
    } : EMPTY_VALUES)
    setModalOpen(true)
  }, [form])

  const handleSave = async () => {
    const values = await form.validateFields().catch(() => null)
    if (!values) return
    setSaving(true)

    try {
      if (editingTask) {
        await window.electron.revision.update(editingTask.id, values)
      } else {
        await window.electron.revision.create(novelId, values)
      }
      await finalizeDraft(values)
      await clearDraft()
      setModalOpen(false)
      setEditingTask(null)
      message.success(getUserFacingMessage(editingTask ? 'revisionCenter.updated' : 'revisionCenter.created'))
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, editingTask ? 'revisionCenter.updateFailed' : 'revisionCenter.createFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = useCallback((task: RevisionTask) => {
    if (task.taskSource !== 'manual') return
    Modal.confirm({
      title: `删除修订任务「${task.title}」？`,
      content: '删除后无法恢复；如果问题仍存在，请重新创建修订任务。',
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await window.electron.revision.delete(task.id)
          message.success(getUserFacingMessage('revisionCenter.deleted'))
          await refresh()
        } catch (error) {
          console.error(error)
          message.error(getErrorMessage(error, 'revisionCenter.deleteFailed'))
        }
      },
    })
  }, [refresh])

  const handleQuickStatus = useCallback(async (task: RevisionTask, status: RevisionTask['status']) => {
    setActionKey(`status:${task.id}:${status}`)
    try {
      await window.electron.revision.update(task.id, { status })
      message.success(getUserFacingMessage('revisionCenter.statusUpdated'))
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'revisionCenter.statusUpdateFailed'))
    } finally {
      setActionKey(null)
    }
  }, [refresh])

  const handleAutoFix = useCallback(async (task: RevisionTask) => {
    setActionKey(`autofix:${task.id}`)
    try {
      const result = await window.electron.revision.autoFix(task.id)
      if (result.status === 'failed') {
        message.error(result.message)
      } else if (result.status === 'unsupported') {
        message.warning(result.message)
      } else {
        message.success(result.message)
      }
      await refresh()
    } catch (error) {
      console.error(error)
      message.error(getErrorMessage(error, 'revision.autofixFailed'))
    } finally {
      setActionKey(null)
    }
  }, [refresh])

  const openRelatedPage = useCallback((task: RevisionTask) => {
    navigate(buildRevisionTaskTargetPath(novelId, task))
  }, [navigate, novelId])

  const renderTaskActions = useCallback((task: RevisionTask) => (
    <Space size={6} wrap>
      <Tooltip title="跳转至对应工作区定位问题">
        <Button size="small" icon={<ArrowRightOutlined />} onClick={() => openRelatedPage(task)}>定位</Button>
      </Tooltip>
      {task.taskSource === 'manual' ? (
        <>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(task)}>编辑</Button>
          {task.status !== 'resolved' ? (
            <Button size="small" type="primary" icon={<CheckOutlined />} loading={actionKey === `status:${task.id}:resolved`} onClick={() => void handleQuickStatus(task, 'resolved')}>解决</Button>
          ) : null}
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => void handleDelete(task)}>删除</Button>
        </>
      ) : (
        <>
          {task.autoFixable ? <Button size="small" type="primary" icon={<ToolOutlined />} loading={actionKey === `autofix:${task.id}`} onClick={() => void handleAutoFix(task)}>AI 修复</Button> : null}
          <Button size="small" loading={actionKey === `status:${task.id}:${task.status === 'ignored' ? 'open' : 'ignored'}`} onClick={() => void handleQuickStatus(task, task.status === 'ignored' ? 'open' : 'ignored')}>
            {task.status === 'ignored' ? '恢复' : '忽略'}
          </Button>
          {task.status !== 'resolved' ? <Button size="small" icon={<CheckOutlined />} loading={actionKey === `status:${task.id}:resolved`} onClick={() => void handleQuickStatus(task, 'resolved')}>完成</Button> : null}
        </>
      )}
    </Space>
  ), [actionKey, handleAutoFix, handleDelete, handleQuickStatus, openEditor, openRelatedPage])

  return (
    <WorkspacePage
      className="novel-revision-center-page"
      layout="wide"
      heroVariant="compact"
      title="修订中心"
      asidePlacement="below"
      chrome="shared"
      actionContract={{
        primary: {
          key: 'create-revision-task',
          label: '新建人工任务',
          icon: <PlusOutlined />,
          onClick: () => openEditor(),
        },
        secondary: [
          {
            key: 'refresh-revision',
            label: '刷新诊断',
            icon: <ReloadOutlined />,
            loading,
            onClick: () => void refresh(),
          },
          {
            key: 'open-writing',
            label: '去正文页',
            icon: <ArrowRightOutlined />,
            onClick: () => navigate(buildWorkspaceRoute(novelId, 'writing')),
          },
        ],
      }}
      contextSummary={(
        <WorkspaceContextSummary
          items={[
            { label: '体检评分', value: consistencyReport ? `${consistencyReport.readinessScore} 分` : '加载中' },
            { label: '未解决任务', value: `${stats.openCount + stats.inProgressCount} 项` },
            { label: '待同步章节', value: contextStatus ? `${contextStatus.staleChapterCount} 章` : '加载中' },
            { label: '高优先问题', value: consistencyReport ? `${consistencyReport.highCount} 项` : '加载中' },
          ]}
        />
      )}
      metrics={(
        <>
          <WorkspaceMetric label="阻塞项" value={stats.blockerCount} tone={stats.blockerCount > 0 ? 'warm' : 'default'} />
          <WorkspaceMetric label="待处理" value={stats.openCount} />
          <WorkspaceMetric label="处理中" value={stats.inProgressCount} />
          <WorkspaceMetric label="人工 / 系统" value={`${manualCount} / ${systemCount}`} />
        </>
      )}
    >
      {stats.blockerCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`当前存在 ${stats.blockerCount} 个阻塞项，建议优先处理以保障后续生成与同步。`}
        />
      ) : null}

      {scopedFilterSummary ? (
        <Alert
          type="info"
          showIcon
          message={`当前处于定向筛选视图：${scopedFilterSummary}`}
          action={
            <Button size="small" onClick={clearAllFilters}>
              查看全部
            </Button>
          }
        />
      ) : null}

      {contextStatus && contextStatus.staleChapterCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`检测到 ${contextStatus.staleChapterCount} 个章节引用了旧上下文，建议在正文或大纲中同步更新。`}
        />
      ) : null}

      {draftWarnings.length > 0 ? (
        <Alert
          type="info"
          showIcon
          message="AI 任务生成提示"
          description={draftWarnings.map((warning) => <div key={warning}>{warning}</div>)}
        />
      ) : null}

      {draft?.appliedAt ? (
        <Alert
          type="info"
          showIcon
          message="已恢复最近一次未保存的 AI 草稿，提交后自动生效。"
        />
      ) : null}

      <WorkspacePanel
        title="待处理队列"
        description="在这里选择一项问题、定位影响范围并完成修订；全书体检只保留在按需诊断中。"
      >
        <div className="revision-toolbar">
          <div className="revision-toolbar__filters">
            <Select
              value={sourceFilter}
              style={{ width: 130 }}
              options={[
                { value: 'all', label: '全部来源' },
                { value: 'system', label: '系统任务' },
                { value: 'manual', label: '人工任务' },
              ]}
              onChange={(value) => setSourceFilter(value)}
            />
            <Select
              value={statusFilter}
              style={{ width: 130 }}
              options={[
                { value: 'all', label: '全部状态' },
                ...STATUS_OPTIONS,
              ]}
              onChange={(value) => setStatusFilter(value)}
            />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索任务标题、说明或建议"
              prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
              allowClear
              style={{ maxWidth: 300, flex: 1 }}
            />
            {hasActiveFilters ? (
              <Button size="small" icon={<ClearOutlined />} onClick={clearAllFilters}>
                重置筛选
              </Button>
            ) : null}
          </div>
        </div>

        <div className="revision-workspace" data-revision-workspace>
          <aside className="revision-workspace__queue" aria-label="修订任务队列">
            <div className="revision-workspace__queue-heading">
              <span>当前结果</span>
              <strong>{taskTotal} 项</strong>
            </div>
            <div className="revision-workspace__task-list" data-revision-task-list>
              {tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  data-revision-task-id={task.id}
                  aria-current={selectedTask?.id === task.id ? 'true' : undefined}
                  className={`revision-workspace__task${selectedTask?.id === task.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <span className="revision-workspace__task-head">
                    <Tag color={getRevisionSeverityColor(task.severity)}>{getRevisionSeverityLabel(task.severity)}</Tag>
                    <Tag color={getStatusColor(task.status)}>{getStatusLabel(task.status)}</Tag>
                  </span>
                  <strong>{task.title}</strong>
                  <span>{task.fixBrief || task.description || '尚未填写修订说明。'}</span>
                </button>
              ))}
              {!loading && tasks.length === 0 ? (
                <div className="revision-workspace__empty" data-revision-empty-queue>
                  <strong>当前筛选下没有修订任务</strong>
                  <span>可调整筛选，或新建一条人工修订任务。</span>
                </div>
              ) : null}
            </div>
            {taskTotal > REVISION_PAGE_SIZE ? (
              <div className="revision-workspace__pagination">
                <Button size="small" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</Button>
                <span>{page} / {Math.max(1, Math.ceil(taskTotal / REVISION_PAGE_SIZE))}</span>
                <Button size="small" disabled={page * REVISION_PAGE_SIZE >= taskTotal} onClick={() => setPage((current) => current + 1)}>下一页</Button>
              </div>
            ) : null}
          </aside>

          <article className="revision-workspace__detail" data-revision-current-task>
            {selectedTask ? (
              <>
                <div className="revision-workspace__detail-head">
                  <div>
                    <span className="revision-workspace__kicker">当前问题</span>
                    <h3>{selectedTask.title}</h3>
                    <span className="revision-workspace__meta">{TASK_TYPE_LABELS[selectedTask.taskType] || selectedTask.taskType || '连续性'} · 更新于 {formatDate(selectedTask.updatedAt)}</span>
                  </div>
                  <Space size={6} wrap>
                    <Tag color={getSourceColor(selectedTask.taskSource)}>{getSourceLabel(selectedTask.taskSource)}</Tag>
                    <Tag color={getStatusColor(selectedTask.status)}>{getStatusLabel(selectedTask.status)}</Tag>
                  </Space>
                </div>
                <div className="revision-workspace__problem">
                  <span>问题与影响</span>
                  <strong>{selectedTask.description || '此任务尚未补充问题描述，请先明确影响范围。'}</strong>
                </div>
                <div className="revision-workspace__fix">
                  <span>修订方案</span>
                  <p>{selectedTask.fixBrief || '暂未提供修订方案，可编辑任务补充检查清单。'}</p>
                </div>
                <div className="revision-workspace__detail-meta">
                  <span>关联模块：{RELATED_PAGE_OPTIONS.find((item) => item.value === selectedTask.relatedPage)?.label || selectedTask.relatedPage || '正文写作'}</span>
                  <span>优先级：{getRevisionSeverityLabel(selectedTask.severity)}</span>
                </div>
                <div className="revision-workspace__actions" data-revision-task-actions>{renderTaskActions(selectedTask)}</div>
              </>
            ) : (
              <div className="revision-workspace__empty" data-revision-empty-detail>
                <strong>选择一条修订任务</strong>
                <span>队列中的每项任务都会在此处显示问题、方案与可执行动作。</span>
              </div>
            )}
          </article>
        </div>
      </WorkspacePanel>

      {consistencyReport ? (
        <details className="revision-diagnostics" data-revision-diagnostics>
          <summary>
            <span><strong>系统体检与诊断</strong><small>{consistencyReport.highCount} 个高优先问题 · 按需展开</small></span>
          </summary>
          <div className="revision-diagnostics__content">
            <p>{consistencyReport.overview || '综合多维度设定与章节连续性的一致性检查报告'}</p>
            <div className="revision-health-grid">
              <div className="revision-health-card"><span className="revision-health-card__label">健康评分</span><span className="revision-health-card__value">{consistencyReport.readinessScore} 分</span></div>
              <div className="revision-health-card"><span className="revision-health-card__label">高优先级风险</span><span className="revision-health-card__value">{consistencyReport.highCount} 项</span></div>
              <div className="revision-health-card"><span className="revision-health-card__label">中优先级预警</span><span className="revision-health-card__value">{consistencyReport.mediumCount} 项</span></div>
              <div className="revision-health-card"><span className="revision-health-card__label">低优先级提示</span><span className="revision-health-card__value">{consistencyReport.lowCount} 项</span></div>
            </div>
            {consistencyReport.issues.length > 0 ? (
              <div className="novel-issue-list">
                {consistencyReport.issues.slice(0, 8).map((issue) => (
                  <div key={issue.id} className="novel-issue-item">
                    <div className="novel-issue-item__head"><Tag color={getConsistencySeverityColor(issue.severity)}>{getConsistencySeverityLabel(issue.severity)}</Tag><strong>{issue.title}</strong></div>
                    <div className="novel-issue-item__desc">{issue.description}</div>
                    <div className="novel-issue-item__suggestion">建议：{issue.suggestion}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {/* 新建/编辑任务弹窗 */}
      <Modal
        title={editingTask ? '编辑人工修订任务' : '新建人工修订任务'}
        open={modalOpen}
        forceRender
        onCancel={() => setModalOpen(false)}
        onOk={() => void handleSave()}
        confirmLoading={saving}
        okText={editingTask ? '保存修改' : '创建任务'}
        width={720}
      >
        <div style={{ marginBottom: 16 }}>
          {taskDraftButton}
        </div>
        <Form form={form} layout="vertical" initialValues={EMPTY_VALUES}>
          <div className="guided-step__field-grid">
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="taskType" label="任务类型" rules={[{ required: true, message: '请填写任务类型' }]}>
                <Input placeholder="例如：continuity（连续性）/ character（人物）/ timeline（时间线）" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="status" label="当前状态" rules={[{ required: true, message: '请选择状态' }]}>
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="severity" label="优先级" rules={[{ required: true, message: '请选择优先级' }]}>
                <Select options={SEVERITY_OPTIONS} />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请填写任务标题' }]}>
                <Input placeholder="例如：回查第 18 章人物动机 / 统一补给线时间顺序" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="description" label="问题描述">
                <Input.TextArea rows={4} placeholder="写清具体问题、影响范围和现状。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--full">
              <Form.Item name="fixBrief" label="修订方案 / 检查清单">
                <Input.TextArea rows={4} placeholder="写清修订动作，例如需要回查哪些章节、人物、时间轴或线程。" />
              </Form.Item>
            </div>
            <div className="guided-step__field-card guided-step__field-card--compact">
              <Form.Item name="relatedPage" label="关联模块">
                <Select options={RELATED_PAGE_OPTIONS} />
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
    </WorkspacePage>
  )
}
