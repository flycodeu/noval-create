import { useScopedState } from '@/hooks/useScopedState'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Collapse, Empty, Modal, Pagination, Select, Tag, message, type CollapseProps } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { AssetReviewObservability, ModelAttempt, NovelContextStatus, PagedResult, Task, TaskQueryInput, TaskStats } from '../../types'
import { useTaskStore } from '../../stores/task.store'
import { hasPendingCreativeWorkflowCheckpoint, hasResumableWorkflowCheckpoint } from '../../shared/workflow-resilience'
import { formatFailure } from '../../shared/task-labels'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildTaskRecoveryAction } from '../Novel/shared/workspace-navigation'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../Novel/components/WorkspaceShell'
import './index.css'
import JsonViewer from '../../components/JsonViewer'
import { prepareJsonView } from '../../components/json-view'
import HistoryCleanup from './HistoryCleanup'

const DEFAULT_PAGE_SIZE = 10
const PAGE_SIZE_OPTIONS = ['10', '20', '50']
const EMPTY_TASK_PAGE: PagedResult<Task> = {
  items: [],
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  hasMore: false,
}
const EMPTY_TASK_STATS: TaskStats = {
  total: 0,
  pendingCount: 0,
  runningCount: 0,
  cancelRequestedCount: 0,
  pausedCount: 0,
  successCount: 0,
  failedCount: 0,
  cancelledCount: 0,
}
const ENDED_TASK_STATUSES = new Set<Task['status']>(['success', 'failed', 'cancelled'])

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '等待执行', color: '#5c6378', icon: <ClockCircleOutlined /> },
  running: { label: '执行中', color: '#2E86AB', icon: <LoadingOutlined spin /> },
  cancel_requested: { label: '正在取消', color: '#faad14', icon: <StopOutlined /> },
  paused: { label: '已暂停', color: '#d48806', icon: <ClockCircleOutlined /> },
  blocked: { label: '已阻断', color: '#d48806', icon: <StopOutlined /> },
  success: { label: '已完成', color: '#52c41a', icon: <CheckCircleOutlined /> },
  failed: { label: '执行失败', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
  cancelled: { label: '任务已取消', color: '#faad14', icon: <StopOutlined /> },
}

const TYPE_LABELS: Record<string, string> = {
  init: '初始化',
  character_gen: 'AI 生成人物',
  character_cast_plan: 'AI 分析人物需求',
  character_cast_review: 'AI 审校人物计划',
  faction_generate: 'AI 生成势力',
  chapter_planner: 'Planner · 合同规划',
  chapter_writer: 'Writer · 正文初稿',
  chapter_critic: 'Critic · 审校结论',
  chapter_rewriter: 'Rewriter · 修正文稿',
  chapter_canonizer: 'Canonizer · 回写草案',
  chapter_finalize: 'Finalize · 刷新记忆',
  chapter_scene_plan: 'AI 场景规划',
  chapter_draft: 'AI 草稿生成',
  chapter_outline: 'AI 章节细纲',
  chapter_review: 'AI 审校建议',
  chapter_write: 'AI 章节正文',
  summary: '刷新章节记忆',
  continuity: '连续性检查',
  review: 'AI 评审·修订建议',
  ai_check: 'AI 检测·AI 痕迹',
  expand_background: 'AI 扩展背景',
  generate_relations: 'AI 生成人物关系',
  generate_map: 'AI 生成地图',
  map_auto_generate: 'AI 自动生成地图',
  faction_auto_generate: 'AI 自动生成势力',
  generate_arcs: 'AI 生成故事弧',
  generate_items: 'AI 生成物品',
  item_auto_generate: 'AI 自动生成物品',
  generate_timeline: 'AI 生成时间轴',
  timeline_auto_generate: 'AI 自动生成时间轴',
  subplot_framework: 'AI 生成支线',
  subplot_auto_generate: 'AI 自动生成支线',
  premise_generate: 'AI 基础设定',
  core_settings_generate: 'AI 生成核心设定',
  project_brief_generate: 'AI 生成项目立项',
  theme_voice_generate: 'AI 生成主题与文风',
  world_rules_generate: 'AI 生成世界规则',
  world_rules_auto_generate: 'AI 自动生成世界规则',
  story_thread_generate: 'AI 生成故事线程',
  story_thread_auto_generate: 'AI 自动生成故事线程',
  character_auto_generate: 'AI 自动生成人物',
  chapter_quality_analysis: '逐章 AI 体检队列',
  planning_draft: 'AI 规划草稿',
}

const RUNNER_LABELS: Record<string, string> = {
  chat: '单次执行',
  stream: '流式执行',
  workflow: '后台流程',
}

const PIPELINE_ROLE_LABELS: Record<string, string> = {
  planner: 'Planner',
  writer: 'Writer',
  critic: 'Critic',
  enforcer: 'Enforcer',
  rewriter: 'Rewriter',
  canonizer: 'Canonizer',
  finalize: 'Finalize',
}

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  pending: '等待执行',
  running: '执行中',
  paused: '已暂停',
  failed: '执行失败',
  success: '已完成',
  blocked: '已阻断',
}

function formatTaskPayload(raw?: string): string {
  const view = prepareJsonView(raw)
  if (!view.structured) return view.text.slice(0, 140)
  const data = view.value as Record<string, unknown>
  const summary = ['summary', 'message', 'title', 'description'].map(key => data[key]).find(value => typeof value === 'string' && value.trim())
  return typeof summary === 'string' ? summary.slice(0, 140) : `结构化数据 · ${Object.keys(data).length} 项`
}

function parseTaskProgress(raw?: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function getTaskTypeLabel(type: string): string {
  return TYPE_LABELS[type] || type
}

function getTaskRunnerLabel(task: Task): string {
  return RUNNER_LABELS[task.runnerType || 'chat'] || (task.runnerType || 'chat')
}

function getTaskPipelineRoleLabel(task: Task): string {
  return task.pipelineRole ? (PIPELINE_ROLE_LABELS[task.pipelineRole] || task.pipelineRole) : ''
}

function getTaskPipelineStageLabel(task: Task): string {
  return task.pipelineStage ? (PIPELINE_STAGE_LABELS[task.pipelineStage] || task.pipelineStage) : ''
}

function getAssetReviewTargetLabel(value?: string): string {
  switch (value) {
    case 'character':
      return '人物资产'
    case 'faction':
      return '势力资产'
    case 'item':
      return '物品资产'
    case 'thread':
      return '故事线程'
    case 'timeline':
      return '时间轴事件'
    case 'subplot':
      return '支线资产'
    case 'map':
      return '地图资产'
    case 'world_rules':
      return '世界规则分区'
    default:
      return value || '故事资产'
  }
}

function getAssetReviewStageLabel(value?: string): string {
  switch (value) {
    case 'drafted':
      return '已拿到初稿'
    case 'reviewed':
      return '已完成审校'
    case 'rewritten':
      return '正在重写'
    case 'accepted':
      return '已通过'
    default:
      return value || '未知阶段'
  }
}

function getReviewSeverityLabel(value?: string): string {
  switch (value) {
    case 'high':
      return '高'
    case 'medium':
      return '中'
    case 'low':
      return '低'
    default:
      return value || '未知'
  }
}

function isTaskRetryable(task: Task): boolean {
  if (task.runnerType === 'workflow') return false
  if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) return true
  if (task.type === 'subplot_framework') return true
  return Boolean(task.retryable)
}

function isWorkflowResumable(task: Task): boolean {
  if (task.type === 'planning_draft') return hasPendingCreativeWorkflowCheckpoint(task)
  return hasResumableWorkflowCheckpoint(task)
}

function isChapterPipelineResumeSupported(task: Task, recoveryAction: ReturnType<typeof buildTaskRecoveryAction> | null): boolean {
  return Boolean(
    recoveryAction?.kind === 'resume'
    && task.relatedEntityType === 'chapter'
    && (task.type === 'chapter_write' || task.parentTaskId),
  )
}

function getTaskRetryabilityLabel(task: Task): string {
  return isTaskRetryable(task) ? '支持安全重试' : '需回到功能页重新发起'
}

function getTaskSummary(task: Task, stream?: { content: string }): string {
  const progress = parseTaskProgress(task.progressJson)
  if (task.errorMessage) return task.errorMessage
  if (typeof progress.message === 'string' && progress.message.trim()) return progress.message
  if (stream?.content) return stream.content.slice(0, 140)
  if (task.outputText) return formatTaskPayload(task.outputText)
  if (task.inputJson) return formatTaskPayload(task.inputJson).slice(0, 140)
  return '任务已创建，等待执行输出。'
}

function getFreshnessTags(labels: string[], visibleCount = 2) {
  if (labels.length <= visibleCount) return labels
  return [...labels.slice(0, visibleCount), `+${labels.length - visibleCount}`]
}

export default function TaskCenter() {
  const navigate = useNavigate()
  const loadVersionRef = useRef(0)
  const foregroundLoadRef = useRef(false)
  const pollingLoadRef = useRef(0)
  const [pageData, setPageData] = useState<PagedResult<Task>>(EMPTY_TASK_PAGE)
  const [stats, setStats] = useState<TaskStats>(EMPTY_TASK_STATS)
  const [clearingHistory, setClearingHistory] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const actionInFlightRef = useRef(false)
  const clearingHistoryRef = useRef(false)
  const [pendingActionId, setPendingActionId] = useState<number | null>(null)
  const [requestedTaskId, setSelectedId] = useState<number | null>(null)
  const { streams, clearStream } = useTaskStore()

  const buildTaskQueryInput = useCallback((overrides: Partial<TaskQueryInput> = {}): TaskQueryInput => ({
    novelId: overrides.novelId,
    page: overrides.page ?? page,
    pageSize: overrides.pageSize ?? pageSize,
    status: overrides.status ?? (statusFilter === 'all' ? undefined : statusFilter),
    type: overrides.type ?? (typeFilter === 'all' ? undefined : typeFilter),
  }), [page, pageSize, statusFilter, typeFilter])

  const fetchTaskData = useCallback(
    (overrides: Partial<TaskQueryInput> = {}) => Promise.all([
      window.electron.task.query(buildTaskQueryInput(overrides)),
      window.electron.task.getStats(overrides.novelId),
    ]),
    [buildTaskQueryInput],
  )

  const [loading, setLoading] = useScopedState(fetchTaskData, true)
  const applyTasks = useCallback(([result, nextStats]: Awaited<ReturnType<typeof fetchTaskData>>) => {
    setPageData(result)
    setStats(nextStats)
  }, [])
  const loadTasks = useCallback(async (options: { silent?: boolean; overrides?: Partial<TaskQueryInput> } = {}) => {
    if (options.silent && (foregroundLoadRef.current || pollingLoadRef.current)) return null
    const requestId = ++loadVersionRef.current
    if (options.silent) pollingLoadRef.current = requestId
    else foregroundLoadRef.current = true
    if (!options.silent) setLoading(true)

    try {
      const [result, nextStats] = await fetchTaskData(options.overrides)
      if (requestId !== loadVersionRef.current) return null
      applyTasks([result, nextStats])
      return result
    } catch (error) {
      if (requestId !== loadVersionRef.current) return null
      if (!options.silent) {
        message.error(getErrorMessage(error, 'taskCenter.loadFailed'))
      }
      return null
    } finally {
      if (options.silent) {
        if (pollingLoadRef.current === requestId) pollingLoadRef.current = 0
      } else if (requestId === loadVersionRef.current) {
        foregroundLoadRef.current = false
        setLoading(false)
      }
    }
  }, [applyTasks, fetchTaskData, setLoading])

  useEffect(() => {
    const requestId = ++loadVersionRef.current
    foregroundLoadRef.current = true
    void fetchTaskData().then(result => {
      if (loadVersionRef.current === requestId) applyTasks(result)
    }).catch(error => {
      if (loadVersionRef.current === requestId) message.error(getErrorMessage(error, 'taskCenter.loadFailed'))
    }).finally(() => {
      if (loadVersionRef.current !== requestId) return
      foregroundLoadRef.current = false
      setLoading(false)
    })
    return () => { loadVersionRef.current += 1; foregroundLoadRef.current = false }
  }, [applyTasks, fetchTaskData, setLoading])

  useEffect(() => () => { loadVersionRef.current += 1 }, [])


  useEffect(() => {
    const timer = setInterval(() => {
      void loadTasks({ silent: true })
    }, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])


  const selectedTask = useMemo(
    () => pageData.items.find((task) => task.id === requestedTaskId) || pageData.items[0] || null,
    [pageData.items, requestedTaskId],
  )
  const selectedId = selectedTask?.id ?? null
  const [draftOpen, setDraftOpen] = useScopedState(selectedId, false)
  const attemptsKey = JSON.stringify([selectedId, selectedTask?.status, selectedTask?.updatedAt])
  const [attemptsResult, setAttemptsResult] = useScopedState<{ data: ModelAttempt[]; error: boolean } | null>(attemptsKey, null)
  const modelAttempts = useMemo(() => attemptsResult?.data ?? [], [attemptsResult])
  const modelAttemptsError = attemptsResult?.error ?? false
  const modelAttemptsLoading = selectedId !== null && attemptsResult === null
  const contextNovelId = selectedTask?.novelId
  const contextKey = JSON.stringify([contextNovelId, selectedTask?.updatedAt])
  const [contextResult, setContextResult] = useScopedState<{ data: NovelContextStatus | null; error: boolean } | null>(contextKey, null)
  const selectedContextStatus = contextResult?.data ?? null
  const selectedContextStatusError = contextResult?.error ?? false

  useEffect(() => {
    if (!selectedId) return
    let active = true
    void window.electron.task.modelAttempts(selectedId).then((attempts) => {
      if (active) setAttemptsResult({ data: attempts, error: false })
    }).catch(() => {
      if (active) setAttemptsResult({ data: [], error: true })
    })
    return () => { active = false }
  }, [selectedId, setAttemptsResult])
  const selectedRecoveryAction = useMemo(
    () => (selectedTask ? buildTaskRecoveryAction(selectedTask) : null),
    [selectedTask],
  )
  const selectedStream = selectedTask ? streams[selectedTask.id] : undefined
  const selectedStaleAssetTags = getFreshnessTags(selectedContextStatus?.staleAssetLabels || [])
  const selectedFreshnessCards = selectedTask?.novelId ? [
    {
      title: '章节同步',
      value: !selectedContextStatus ? selectedContextStatusError ? '无法读取' : '加载中'
        : selectedContextStatus.staleChapterCount ? `${selectedContextStatus.staleChapterCount} 章待同步`
          : selectedContextStatus.totalChapterCount ? '已同步' : '尚无章节',
      desc: selectedContextStatus?.staleChapterCount ? '相关章节仍使用旧上下文，需回查。' : '',
      tone: selectedContextStatus?.staleChapterCount ? 'stale' : 'ok',
      tags: [] as string[],
    },
    {
      title: '记忆检查点',
      value: !selectedContextStatus ? selectedContextStatusError ? '无法读取' : '加载中'
        : selectedContextStatus.staleCheckpointCount ? `${selectedContextStatus.staleCheckpointCount} 份待刷新` : '已同步',
      desc: selectedContextStatus?.staleCheckpointCount ? '恢复前请刷新长期记忆，避免沿用旧设定。' : '',
      tone: selectedContextStatus?.staleCheckpointCount ? 'warn' : 'ok',
      tags: [] as string[],
    },
    {
      title: '资产校准',
      value: !selectedContextStatus ? selectedContextStatusError ? '无法读取' : '加载中'
        : selectedContextStatus.staleAssetCount ? `${selectedContextStatus.staleAssetCount} 类待校准` : '已同步',
      desc: selectedContextStatus?.staleAssetCount ? '相关资产仍使用旧设定，继续执行前需核对。' : '',
      tone: selectedContextStatus?.staleAssetCount ? 'warn' : 'ok',
      tags: selectedContextStatus?.staleAssetCount ? selectedStaleAssetTags : [],
    },
  ] : []
  useEffect(() => {
    if (!contextNovelId) return
    let active = true
    void window.electron.novel.getContextStatus(contextNovelId).then((status) => {
      if (active) setContextResult({ data: status, error: false })
    }).catch(() => {
      if (active) setContextResult({ data: null, error: true })
    })
    return () => { active = false }
  }, [contextNovelId, setContextResult])

  const handleStatusFilterChange = (value: 'all' | Task['status']) => {
    setStatusFilter(value)
    setPage(1)
  }

  const handleTypeFilterChange = (value: string) => {
    setTypeFilter(value)
    setPage(1)
  }

  const handlePageChange = (nextPage: number, nextPageSize: number) => {
    if (nextPageSize !== pageSize) {
      setPageSize(nextPageSize)
      setPage(1)
      return
    }
    setPage(nextPage)
  }

  const runTaskAction = async (taskId: number, operation: () => Promise<unknown>, errorKey: Parameters<typeof getErrorMessage>[1]) => {
    if (actionInFlightRef.current) return
    actionInFlightRef.current = true
    setPendingActionId(taskId)
    try {
      await operation()
      await loadTasks({ silent: true })
    } catch (error) {
      message.error(getErrorMessage(error, errorKey))
    } finally {
      actionInFlightRef.current = false
      setPendingActionId(null)
    }
  }

  const handleCancel = (taskId: number) => runTaskAction(taskId, () => window.electron.task.cancel(taskId), 'taskCenter.cancelFailed')
  const handleRetry = (taskId: number) => runTaskAction(taskId, () => window.electron.task.retry(taskId), 'taskCenter.retryFailed')

  const handleResume = async (task: Task, recoveryAction?: ReturnType<typeof buildTaskRecoveryAction> | null) => {
    await runTaskAction(task.id, async () => {
      if (isChapterPipelineResumeSupported(task, recoveryAction || null)) {
        await window.electron.chapter.resumeContent(task.id)
      } else if (task.runnerType === 'workflow' && (task.status === 'paused' || task.status === 'blocked') && isWorkflowResumable(task)) {
        await window.electron.workflow.resume(task.id)
      } else {
        return
      }
      message.success(getUserFacingMessage('taskCenter.resumed'))
    }, 'taskCenter.resumeFailed')
  }

  const handleClearHistory = useCallback((taskId?: number) => {
    Modal.confirm({
      title: taskId ? '删除这条运行记录？' : '删除筛选范围内的历史记录？',
      content: '仅删除已结束且未被草稿、成果或恢复链路引用的任务及调用记录，不影响正文。删除后不可恢复。',
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (clearingHistoryRef.current) return
        clearingHistoryRef.current = true
        foregroundLoadRef.current = true
        loadVersionRef.current += 1
        setClearingHistory(true)
        try {
          const result = await window.electron.task.clearHistory({
            ...(taskId ? { taskIds: [taskId] } : {}),
            status: statusFilter === 'all' ? undefined : statusFilter,
            type: typeFilter === 'all' ? undefined : typeFilter,
          })

          result.deletedTaskIds.forEach((taskId) => clearStream(taskId))
          if (selectedId && result.deletedTaskIds.includes(selectedId)) {
            setSelectedId(null)
          }

          const [refreshedPage, nextStats] = await fetchTaskData()
          const lastPage = Math.max(1, Math.ceil(refreshedPage.total / refreshedPage.pageSize))

          setStats(nextStats)
          if (page > lastPage) {
            setPage(lastPage)
          } else {
            setPageData(refreshedPage)
          }

          message.success(
            result.deletedCount > 0
              ? getUserFacingMessage('taskCenter.historyCleared', { count: result.deletedCount })
              : result.protectedCount ? getUserFacingMessage('taskCenter.historyProtected') : getUserFacingMessage('taskCenter.historyNothingToClear'),
          )
        } catch (error) {
          message.error(getErrorMessage(error, 'taskCenter.clearHistoryFailed'))
          throw error
        } finally {
          clearingHistoryRef.current = false
          foregroundLoadRef.current = false
          setLoading(false)
          setClearingHistory(false)
        }
      },
    })
  }, [clearStream, fetchTaskData, page, selectedId, statusFilter, typeFilter, setLoading])

  const handleRetentionCleaned = useCallback(async (result: import('../../types').TaskHistoryClearResult) => {
    result.deletedTaskIds.forEach(clearStream)
    if (selectedId && result.deletedTaskIds.includes(selectedId)) setSelectedId(null)
    const requestId = ++loadVersionRef.current
    foregroundLoadRef.current = true
    try {
      const [refreshedPage, nextStats] = await fetchTaskData()
      if (requestId !== loadVersionRef.current) return
      setStats(nextStats)
      const lastPage = Math.max(1, Math.ceil(refreshedPage.total / refreshedPage.pageSize))
      if (page > lastPage) setPage(lastPage)
      else setPageData(refreshedPage)
    } finally { if (requestId === loadVersionRef.current) foregroundLoadRef.current = false }
  }, [clearStream, fetchTaskData, page, selectedId])

  const handleRecoverDraft = useCallback((path?: string) => {
    if (!path) return
    navigate(path)
    message.success(getUserFacingMessage('taskCenter.openedWorkspace'))
  }, [navigate])

  const runningCount = stats.runningCount + stats.cancelRequestedCount
  const pendingCount = stats.pendingCount
  const successCount = stats.successCount
  const failedCount = stats.failedCount
  const canClearHistory = pageData.total > 0 && (statusFilter === 'all' || ENDED_TASK_STATUSES.has(statusFilter))

  const exportModelAttempts = useCallback(() => {
    if (!selectedTask || modelAttempts.length === 0) return
    const payload = {
      task: {
        id: selectedTask.id,
        novelId: selectedTask.novelId,
        type: selectedTask.type,
        relatedEntityType: selectedTask.relatedEntityType,
        relatedEntityId: selectedTask.relatedEntityId,
        contractVersion: selectedTask.contractVersion,
      },
      attempts: modelAttempts,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `novelforge-model-attempts-task-${selectedTask.id}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [selectedTask, modelAttempts])

  const detailSections = useMemo<CollapseProps['items']>(() => {
    const items: NonNullable<CollapseProps['items']> = []

    if (selectedStream?.content) {
      items.push({
        key: 'stream',
        label: '实时输出',
        children: <div className="task-center-code" data-p3-05-task-log>{selectedStream.content}</div>,
      })
    }

    if (selectedTask?.outputText) {
      items.push({
        key: 'output',
        label: '结果输出',
        children: <div data-p3-05-task-log><JsonViewer raw={selectedTask.outputText} label="结果" /></div>,
      })
    }

    if (selectedTask?.inputJson) {
      items.push({
        key: 'input',
        label: '请求上下文',
        children: <div data-p3-05-task-log><JsonViewer raw={selectedTask.inputJson} label="请求上下文" /></div>,
      })
    }

    if (selectedTask) {
      items.push({
        key: 'model-attempts',
        label: `模型调用记录${modelAttempts.length ? ` · ${modelAttempts.length} 次` : ''}`,
        children: modelAttemptsError ? (
          <Alert type="warning" showIcon message="模型调用记录暂时无法读取" />
        ) : modelAttemptsLoading ? (
          <span>正在读取模型调用记录…</span>
        ) : modelAttempts.length === 0 ? (
          <span>暂无模型调用记录</span>
        ) : (
          <div className="task-center-model-attempts">
            <Button size="small" onClick={exportModelAttempts}>导出提示词与输出 JSON</Button>

            <Collapse items={modelAttempts.map((attempt) => ({
              key: attempt.request_id,
              label: <div className="task-attempt-heading"><strong>{attempt.provider} / {attempt.model_id}</strong><span>{attempt.status} · {new Date(attempt.started_at).toLocaleString('zh-CN')}</span></div>,
              children: (
                <div className="task-center-model-attempt">
                  <div>{`任务 #${attempt.task_id ?? '-'} · 第 ${attempt.attempt_index} 次 · 提示词 SHA-256：${attempt.prompt_hash || '-'}`}</div>
                  <JsonViewer raw={attempt.options_json} label="模型参数" />
                  {attempt.error_code ? <div>{`错误代码：${attempt.error_code}`}</div> : null}
                  <div>实际提示词快照（常见凭据已脱敏）{attempt.prompt_truncated ? '（超出本地记录上限，已截断）' : ''}</div>
                  <pre className="task-center-code">{attempt.prompt_text || '无提示词快照'}</pre>
                  <div>模型输出快照（常见凭据已脱敏）{attempt.output_truncated ? `（仅显示前段，完整长度 ${attempt.output_chars} 字）` : ''}</div>
                  <JsonViewer raw={attempt.output_text} label="模型输出" />
                </div>
              ),
            }))} />
          </div>
        ),
      })
    }

    const progress = selectedTask ? parseTaskProgress(selectedTask.progressJson) : {}
    const draft = progress.draft && typeof progress.draft === 'object' && !Array.isArray(progress.draft)
      ? progress.draft as Record<string, unknown>
      : null
    const assetReview = progress.assetReview && typeof progress.assetReview === 'object' && !Array.isArray(progress.assetReview)
      ? progress.assetReview as AssetReviewObservability
      : null
    const pipeline = progress.kind === 'chapter_pipeline' && progress.roles && typeof progress.roles === 'object'
      ? progress as Record<string, unknown>
      : null
    const observabilityLines = [
      typeof pipeline?.message === 'string' && pipeline.message.trim() ? `流水线摘要：${pipeline.message.trim()}` : '',
      typeof pipeline?.currentRole === 'string' ? `当前角色：${PIPELINE_ROLE_LABELS[pipeline.currentRole] || pipeline.currentRole}` : '',
      typeof pipeline?.contractVersion === 'string' && pipeline.contractVersion.trim() ? `合同版本：${pipeline.contractVersion.trim()}` : '',
      typeof pipeline?.failureCode === 'string'
        ? `失败原因：${formatFailure(pipeline.failureCode).title} · ${formatFailure(pipeline.failureCode).action}`
        : '',
      typeof pipeline?.rewriteScope === 'string' ? `重写粒度：${pipeline.rewriteScope}` : '',
      typeof pipeline?.targetSegmentId === 'number' ? `目标场景：#${pipeline.targetSegmentId}` : '',
      typeof pipeline?.canonRunId === 'number' ? `Canon Run：#${pipeline.canonRunId}` : '',
      typeof pipeline?.totalDurationMs === 'number' && pipeline.totalDurationMs > 0 ? `总耗时：${(pipeline.totalDurationMs / 1000).toFixed(1)}s` : '',
      typeof pipeline?.totalTokensUsed === 'number' && pipeline.totalTokensUsed > 0 ? `总 tokens：${pipeline.totalTokensUsed}` : '',
      typeof draft?.inputSummary === 'string' && draft.inputSummary.trim() ? `输入摘要：${draft.inputSummary.trim()}` : '',
      Array.isArray(draft?.warnings) && draft.warnings.length > 0 ? `生成修补提示：${draft.warnings.join('；')}` : '',
      Array.isArray(draft?.lintWarnings) && draft.lintWarnings.length > 0 ? `语言 lint：${draft.lintWarnings.join('；')}` : '',
      Array.isArray(draft?.diffSummary) && draft.diffSummary.length > 0 ? `人工修改差异：${draft.diffSummary.join('；')}` : '',
      assetReview?.targetType ? `资产类型：${getAssetReviewTargetLabel(assetReview.targetType)}` : '',
      assetReview?.stage ? `质检阶段：${getAssetReviewStageLabel(assetReview.stage)}` : '',
      assetReview?.reviewSummary ? `质检结论：${assetReview.reviewSummary}` : '',
      assetReview?.severity ? `风险等级：${getReviewSeverityLabel(assetReview.severity)}` : '',
      Array.isArray(assetReview?.topFixes) && assetReview.topFixes.length > 0 ? `优先修法：${assetReview.topFixes.join('；')}` : '',
      Array.isArray(assetReview?.risks) && assetReview.risks.length > 0 ? `质检风险：${assetReview.risks.join('；')}` : '',
      Array.isArray(assetReview?.warnings) && assetReview.warnings.length > 0 ? `质检备注：${assetReview.warnings.join('；')}` : '',
    ].filter(Boolean)
    const pipelineRoleLines = pipeline && pipeline.roles && typeof pipeline.roles === 'object'
      ? Object.values(pipeline.roles as Record<string, unknown>)
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
        .map((item) => {
          const label = typeof item.label === 'string' ? item.label : (typeof item.role === 'string' ? (PIPELINE_ROLE_LABELS[item.role] || item.role) : '阶段')
          const status = typeof item.status === 'string' ? (PIPELINE_STAGE_LABELS[item.status] || item.status) : '未知'
          const detail = typeof item.detail === 'string' ? item.detail : ''
          const failureCode = typeof item.failureCode === 'string' ? ` · ${formatFailure(item.failureCode).title}` : ''
          const rewriteScope = typeof item.rewriteScope === 'string' ? ` · ${item.rewriteScope}` : ''
          const segment = typeof item.targetSegmentId === 'number' ? ` · scene#${item.targetSegmentId}` : ''
          return detail ? `${label}：${status}${failureCode}${rewriteScope}${segment} · ${detail}` : `${label}：${status}${failureCode}${rewriteScope}${segment}`
        })
      : []

    if (observabilityLines.length > 0 || pipelineRoleLines.length > 0) {
      items.push({
        key: 'observability',
        label: '草稿观测',
        children: <div className="task-center-code" data-p3-05-task-log>{[...observabilityLines, ...pipelineRoleLines].join('\n\n')}</div>,
      })
    }

    return items
  }, [selectedStream, selectedTask, modelAttempts, modelAttemptsError, modelAttemptsLoading, exportModelAttempts])

  return (
    <WorkspacePage
      className="task-center-page"
      title="运行记录"
      heroVariant="compact"
      actions={(
        <div className="task-center-toolbar">
          <Button icon={<ReloadOutlined />} disabled={clearingHistory} loading={loading && !clearingHistory} onClick={() => void loadTasks()}>
            刷新
          </Button>
          <HistoryCleanup onCleaned={handleRetentionCleaned} />
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={clearingHistory}
            disabled={!canClearHistory}
            onClick={() => handleClearHistory()}
          >
            删除历史
          </Button>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="执行中" value={runningCount} tone="cool" />
          <WorkspaceMetric label="等待执行" value={pendingCount} />
          <WorkspaceMetric label="已完成" value={successCount} tone="warm" />
          <WorkspaceMetric label="执行失败" value={failedCount} />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          className="task-center-list-panel"
          scrollable
          extra={(
            <div className="novel-filter-bar task-center-filter-bar">
              <div className="novel-filter-bar__row">
                <Select
                  className="task-center-filter-control"
                  value={statusFilter}
                  disabled={clearingHistory}
                  aria-label="任务状态"
                  onChange={handleStatusFilterChange}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'running', label: '执行中' },
                    { value: 'cancel_requested', label: '正在取消' },
                    { value: 'paused', label: '已暂停' },
                    { value: 'blocked', label: '已阻断' },
                    { value: 'pending', label: '等待执行' },
                    { value: 'success', label: '已完成' },
                    { value: 'failed', label: '执行失败' },
                    { value: 'cancelled', label: '任务已取消' },
                  ]}
                />
                <Select
                  className="task-center-filter-control"
                  value={typeFilter}
                  disabled={clearingHistory}
                  aria-label="任务类型"
                  onChange={handleTypeFilterChange}
                  options={[
                    { value: 'all', label: '全部类型' },
                    ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </div>
              <div className="novel-filter-bar__summary task-center-filter-summary">
                {`当前筛选 ${pageData.total} 条 · 每页 ${pageData.pageSize} 条`}
              </div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><LoadingOutlined spin /></div>
          ) : pageData.items.length === 0 ? (
            <Empty
              description={
                statusFilter !== 'all' || typeFilter !== 'all'
                  ? '没有匹配任务'
                  : '暂无任务记录'
              }
              style={{ paddingTop: 40 }}
            >
              {statusFilter !== 'all' || typeFilter !== 'all' ? (
                <Button
                  onClick={() => {
                    setStatusFilter('all')
                    setTypeFilter('all')
                    setPage(1)
                  }}
                >
                  查看全部任务
                </Button>
              ) : null}
            </Empty>
          ) : (
            <>
              <div className="task-center-list" data-p3-05-task-list>
                {pageData.items.map((task) => {
                  const status = STATUS_LABELS[task.status] || STATUS_LABELS.pending
                  const stream = streams[task.id]
                  const hasError = Boolean(task.errorMessage)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`novel-list-card ${selectedId === task.id ? 'novel-list-card--active' : ''}`}
                      onClick={() => setSelectedId(task.id)}
                      style={{ cursor: 'pointer', textAlign: 'left' }}
                    >
                      <div className="task-center-card">
                        <div className="task-center-card__header">
                          <div>
                            <div className="task-center-card__title">{getTaskTypeLabel(task.type)}</div>
                            <div className="task-center-card__summary">{new Date(task.createdAt).toLocaleString('zh-CN')}</div>
                          </div>
                          <div className="task-center-card__meta">
                            <Tag style={{ background: 'transparent', border: `1px solid ${status.color}`, color: status.color }}>
                              {status.label}
                            </Tag>
                            <Tag>{getTaskRunnerLabel(task)}</Tag>
                            {task.pipelineRole ? <Tag color="geekblue">{getTaskPipelineRoleLabel(task)}</Tag> : null}
                            {task.durationMs ? <Tag>{`${(task.durationMs / 1000).toFixed(1)}s`}</Tag> : null}
                            {task.tokensUsed ? <Tag>{`${task.tokensUsed} tokens`}</Tag> : null}
                          </div>
                        </div>
                        <div
                          className={`task-center-card__summary${hasError ? ' is-error' : ''}`}
                        >
                          {hasError ? (
                            <>
                              <strong style={{ marginRight: 6 }}>失败原因：</strong>
                              {task.errorMessage}
                            </>
                          ) : (
                            getTaskSummary(task, stream)
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <Pagination
                className="task-center-pagination"
                current={pageData.page}
                pageSize={pageData.pageSize}
                total={pageData.total}
                showSizeChanger
                disabled={clearingHistory}
                pageSizeOptions={PAGE_SIZE_OPTIONS}
                onChange={handlePageChange}
                showTotal={(total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`}
              />
            </>
          )}
        </WorkspacePanel>

        <WorkspacePanel
          className="task-center-detail-panel"
          scrollable
          title={selectedTask ? getTaskTypeLabel(selectedTask.type) : '任务详情'}
          extra={selectedTask ? (
            <div className="task-center-detail__actions">
              {ENDED_TASK_STATUSES.has(selectedTask.status) ? <Button danger disabled={clearingHistory || pendingActionId !== null} icon={<DeleteOutlined />} onClick={() => handleClearHistory(selectedTask.id)}>删除记录</Button> : null}
              {selectedTask.status === 'running' ? (
                <Button danger disabled={pendingActionId !== null} loading={pendingActionId === selectedTask.id} icon={<StopOutlined />} onClick={() => void handleCancel(selectedTask.id)}>
                  取消
                </Button>
              ) : null}
              {((selectedTask.status === 'paused' || selectedTask.status === 'blocked') && isWorkflowResumable(selectedTask))
                || isChapterPipelineResumeSupported(selectedTask, selectedRecoveryAction) ? (
                <Button disabled={pendingActionId !== null} loading={pendingActionId === selectedTask.id} icon={<ReloadOutlined />} onClick={() => void handleResume(selectedTask, selectedRecoveryAction)}>
                  继续
                </Button>
              ) : null}
              {selectedRecoveryAction?.kind === 'recover_draft' || selectedRecoveryAction?.kind === 'open_page' ? (
                <Button icon={<ReloadOutlined />} onClick={() => handleRecoverDraft(selectedRecoveryAction.path)}>
                  {selectedRecoveryAction.label}
                </Button>
              ) : null}
              {selectedRecoveryAction?.kind === 'view_draft' ? <Button onClick={() => setDraftOpen(true)}>{selectedRecoveryAction.label}</Button> : null}
              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') && isTaskRetryable(selectedTask) ? (
                <Button disabled={pendingActionId !== null} loading={pendingActionId === selectedTask.id} icon={<ReloadOutlined />} onClick={() => void handleRetry(selectedTask.id)}>
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
        >
          {!selectedTask ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择任务"
            />
          ) : (
            <div className="task-center-detail">
              <div className="task-center-detail__header">
                <div>
                  <div className="task-center-detail__summary">
                    {selectedTask.relatedEntityType && selectedTask.relatedEntityId
                      ? `${selectedTask.relatedEntityType} #${selectedTask.relatedEntityId || '-'}`
                      : `任务 #${selectedTask.id}`}
                  </div>
                </div>
                <div className="task-center-detail__meta">
                  <Tag style={{ background: 'transparent', border: `1px solid ${(STATUS_LABELS[selectedTask.status] || STATUS_LABELS.pending).color}`, color: (STATUS_LABELS[selectedTask.status] || STATUS_LABELS.pending).color }}>
                    {(STATUS_LABELS[selectedTask.status] || STATUS_LABELS.pending).label}
                  </Tag>
                  <Tag>{new Date(selectedTask.createdAt).toLocaleString('zh-CN')}</Tag>
                  {selectedTask.updatedAt ? <Tag>{`更新于 ${new Date(selectedTask.updatedAt).toLocaleString('zh-CN')}`}</Tag> : null}
                </div>
              </div>

              {selectedTask.errorMessage ? (
                <Alert
                  type={selectedTask.status === 'success' ? 'warning' : 'error'}
                  showIcon
                  message="运行提示"
                  description={selectedTask.errorMessage}
                />
              ) : null}

              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') && !isTaskRetryable(selectedTask) ? (
                <Alert
                  type="info"
                  showIcon
                  message="当前任务不支持安全重试"
                  description="请从对应功能页重新发起。"
                />
              ) : null}

              {selectedRecoveryAction?.kind === 'recover_draft' || selectedRecoveryAction?.kind === 'open_page' ? (
                <Alert
                  type="info"
                  showIcon
                  message={selectedRecoveryAction.label}
                  description={selectedRecoveryAction.description}
                />
              ) : null}

              {selectedTask.runnerType === 'workflow' && selectedTask.status === 'paused' && selectedContextStatus?.staleCheckpointCount ? (
                <Alert
                  type="warning"
                  showIcon
                  message="恢复前需刷新故事记忆"
                  description={`当前有 ${selectedContextStatus.staleCheckpointCount} 份长期记忆检查点待刷新。直接继续后台流程，会沿用旧的长程记忆。`}
                />
              ) : null}

              {selectedTask.runnerType === 'workflow' && selectedTask.status === 'paused' && selectedContextStatus?.staleAssetCount ? (
                <Alert
                  type="warning"
                  showIcon
                  message="恢复前需处理相关世界资产"
                  description={`这些资产可能还挂着旧设定：${selectedContextStatus.staleAssetLabels.join('、')}。直接继续流程会把旧资产继续写进后续结果。`}
                />
              ) : null}

              <details className="task-center-diagnostics"><summary>执行参数与诊断</summary><div className="novel-note-list">
                <div className="novel-note-list__item">{`任务 ID：${selectedTask.id}`}</div>
                <div className="novel-note-list__item">{`执行方式：${getTaskRunnerLabel(selectedTask)}`}</div>
                {selectedTask.pipelineRole ? <div className="novel-note-list__item">{`角色：${getTaskPipelineRoleLabel(selectedTask)}`}</div> : null}
                {selectedTask.pipelineStage ? <div className="novel-note-list__item">{`阶段：${getTaskPipelineStageLabel(selectedTask)}`}</div> : null}
                {selectedTask.upstreamTaskId ? <div className="novel-note-list__item">{`上游任务：#${selectedTask.upstreamTaskId}`}</div> : null}
                {selectedTask.contractVersion ? <div className="novel-note-list__item">{`合同版本：${selectedTask.contractVersion}`}</div> : null}
                {selectedTask.canonRunId ? <div className="novel-note-list__item">{`Canon Run：#${selectedTask.canonRunId}`}</div> : null}
                <div className="novel-note-list__item">{`重试能力：${getTaskRetryabilityLabel(selectedTask)}`}</div>
                <div className="novel-note-list__item">{`模型配置：${selectedTask.modelConfigId || '-'}`}</div>
                <div className="novel-note-list__item">{`耗时：${selectedTask.durationMs ? `${(selectedTask.durationMs / 1000).toFixed(1)}s` : '-'}`}</div>
                <div className="novel-note-list__item">{`Token 消耗：${selectedTask.tokensUsed || '-'}`}</div>
              </div></details>

              {selectedTask.novelId ? (
                <details className="task-context-health-card">
                  <summary>上下文状态{selectedContextStatus ? ` · ${selectedContextStatus.staleChapterCount ? `${selectedContextStatus.staleChapterCount} 章待同步` : '章节已同步'}` : ''}</summary>
                  <div className="task-context-health-card__head">
                    <div className="task-context-health-card__title">上下文健康</div>
                    <div className="task-context-health-card__meta">
                      <span>{`上下文版本 v${selectedContextStatus?.contextVersion ?? '--'}`}</span>
                      <span>{!selectedContextStatus ? selectedContextStatusError ? '状态无法读取' : '读取中…' : selectedContextStatus.totalChapterCount ? `已纳入 ${selectedContextStatus.totalChapterCount} 章正文` : '尚无正文章节'}</span>
                    </div>
                  </div>
                  <div className="novel-freshness-grid novel-freshness-grid--compact">
                    {selectedFreshnessCards.map((card) => (
                      <section key={card.title} className={`novel-freshness-card novel-freshness-card--${card.tone}`}>
                        <div className="novel-freshness-card__title">{card.title}</div>
                        <strong className="novel-freshness-card__value">{card.value}</strong>
                        {card.desc ? <div className="novel-freshness-card__desc">{card.desc}</div> : null}
                        {card.tags.length > 0 ? (
                          <div className="novel-freshness-card__tags">
                            {card.tags.map((tag) => (
                              <span key={`${card.title}-${tag}`} className="novel-freshness-card__tag">{tag}</span>
                            ))}
                          </div>
                        ) : null}
                      </section>
                    ))}
                  </div>
                </details>
              ) : null}

              <Collapse
                key={selectedTask.id}
                items={detailSections}
                defaultActiveKey={selectedStream?.content ? ['stream'] : selectedTask.outputText ? ['output'] : undefined}
              />
            </div>
          )}
        </WorkspacePanel>
      </div>
      <Modal title={`历史草稿 · 任务 #${selectedTask?.id ?? ''}`} open={draftOpen} onCancel={() => setDraftOpen(false)} footer={<Button onClick={() => setDraftOpen(false)}>关闭</Button>} width="min(880px, calc(100vw - 32px))" className="task-center-draft-modal" destroyOnHidden>
        <JsonViewer raw={JSON.stringify(parseTaskProgress(selectedTask?.progressJson).draft ?? {})} label="历史草稿" />
      </Modal>
    </WorkspacePage>
  )
}
