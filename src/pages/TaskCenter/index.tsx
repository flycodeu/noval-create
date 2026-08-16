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
import { AssetReviewObservability, NovelContextStatus, PagedResult, Task, TaskQueryInput, TaskStats } from '../../types'
import { useTaskStore } from '../../stores/task.store'
import { hasResumableWorkflowCheckpoint } from '../../shared/workflow-resilience'
import { formatFailure } from '../../shared/task-labels'
import { getErrorMessage, getUserFacingMessage } from '@/utils/user-facing-message'
import { buildTaskRecoveryAction } from '../Novel/shared/workspace-navigation'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../Novel/components/WorkspaceShell'

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
  pending: { label: '等待中', color: '#5c6378', icon: <ClockCircleOutlined /> },
  running: { label: '运行中', color: '#2E86AB', icon: <LoadingOutlined spin /> },
  cancel_requested: { label: '停止中', color: '#faad14', icon: <StopOutlined /> },
  paused: { label: '已暂停', color: '#d48806', icon: <ClockCircleOutlined /> },
  success: { label: '成功', color: '#52c41a', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
  cancelled: { label: '已取消', color: '#faad14', icon: <StopOutlined /> },
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
  pending: '待执行',
  running: '执行中',
  paused: '已暂停',
  failed: '失败',
  success: '已完成',
  blocked: '已阻断',
}

function formatTaskPayload(raw?: string): string {
  if (!raw) return ''

  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
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
  if (task.outputText) return task.outputText.slice(0, 140)
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
  const pollingLoadRef = useRef(false)
  const [pageData, setPageData] = useState<PagedResult<Task>>(EMPTY_TASK_PAGE)
  const [stats, setStats] = useState<TaskStats>(EMPTY_TASK_STATS)
  const [loading, setLoading] = useState(true)
  const [clearingHistory, setClearingHistory] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedContextStatus, setSelectedContextStatus] = useState<NovelContextStatus | null>(null)
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

  const loadTasks = useCallback(async (options: { silent?: boolean; overrides?: Partial<TaskQueryInput> } = {}) => {
    if (options.silent && (foregroundLoadRef.current || pollingLoadRef.current)) return null
    if (options.silent) pollingLoadRef.current = true
    else foregroundLoadRef.current = true
    const requestId = ++loadVersionRef.current
    if (!options.silent) setLoading(true)

    try {
      const [result, nextStats] = await fetchTaskData(options.overrides)
      if (requestId !== loadVersionRef.current) return null
      setPageData(result)
      setStats(nextStats)
      return result
    } catch (error) {
      if (requestId !== loadVersionRef.current) return null
      if (!options.silent) {
        message.error(getErrorMessage(error, 'taskCenter.loadFailed'))
      }
      return null
    } finally {
      if (options.silent) {
        pollingLoadRef.current = false
      } else if (requestId === loadVersionRef.current) {
        foregroundLoadRef.current = false
        setLoading(false)
      }
    }
  }, [fetchTaskData])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadTasks({ silent: true })
    }, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  useEffect(() => {
    if (pageData.items.length === 0) {
      setSelectedId(null)
      return
    }

    if (!selectedId || !pageData.items.some((task) => task.id === selectedId)) {
      setSelectedId(pageData.items[0].id)
    }
  }, [pageData.items, selectedId])

  const selectedTask = useMemo(
    () => pageData.items.find((task) => task.id === selectedId) || null,
    [pageData.items, selectedId],
  )
  const selectedRecoveryAction = useMemo(
    () => (selectedTask ? buildTaskRecoveryAction(selectedTask) : null),
    [selectedTask],
  )
  const selectedStream = selectedTask ? streams[selectedTask.id] : undefined
  const isPausedWorkflowTask = Boolean(selectedTask && selectedTask.runnerType === 'workflow' && selectedTask.status === 'paused')
  const selectedStaleAssetTags = getFreshnessTags(selectedContextStatus?.staleAssetLabels || [])
  const selectedFreshnessCards = selectedTask?.novelId
    ? [
        {
          title: '章节同步',
          value: selectedContextStatus
            ? selectedContextStatus.staleChapterCount > 0
              ? `${selectedContextStatus.staleChapterCount} 章待同步`
              : selectedContextStatus.totalChapterCount > 0
                ? `已同步到第 ${selectedContextStatus.totalChapterCount} 章`
                : '尚未生成章节'
            : '加载中',
          desc: selectedContextStatus
            ? selectedContextStatus.staleChapterCount > 0
              ? '当前任务关联小说里仍有章节挂着旧上下文。'
              : '当前正文与最新设定保持一致。'
            : '正在读取当前小说的章节同步状态。',
          hint: selectedContextStatus
            ? selectedContextStatus.staleChapterCount > 0
              ? '需要先回查相关章节。'
              : '章节层不需要额外回补，可以继续当前任务。'
            : '稍后会自动补全状态。',
          tone: selectedContextStatus?.staleChapterCount ? 'stale' : 'ok',
          tags: [] as string[],
        },
        {
          title: '记忆检查点',
          value: selectedContextStatus
            ? selectedContextStatus.staleCheckpointCount > 0
              ? `${selectedContextStatus.staleCheckpointCount} 份待刷新`
              : '检查点已同步'
            : '加载中',
          desc: selectedContextStatus
            ? selectedContextStatus.staleCheckpointCount > 0
              ? '长期记忆还是旧版本，恢复流程后会继续引用旧长程记忆。'
              : '长期记忆检查点已跟上当前设定。'
            : '正在读取长期记忆检查点状态。',
          hint: selectedContextStatus
            ? selectedContextStatus.staleCheckpointCount > 0
              ? '需要先刷新故事记忆。'
              : '当前可以直接继续恢复或查看后续结果。'
            : '稍后会自动补全状态。',
          tone: selectedContextStatus?.staleCheckpointCount
            ? (isPausedWorkflowTask ? 'stale' : 'warn')
            : 'ok',
          tags: [] as string[],
        },
        {
          title: '资产校准',
          value: selectedContextStatus
            ? selectedContextStatus.staleAssetCount > 0
              ? `${selectedContextStatus.staleAssetCount} 类待校准`
              : '资产状态最新'
            : '加载中',
          desc: selectedContextStatus
            ? selectedContextStatus.staleAssetCount > 0
              ? '相关世界资产可能还挂着旧设定，继续流程会把旧资产带进后续结果。'
              : '关键世界资产没有发现明显的设定滞后。'
            : '正在读取资产新鲜度状态。',
          hint: selectedContextStatus
            ? selectedContextStatus.staleAssetCount > 0
              ? '需要先处理相关资产。'
              : '当前资产可以继续支撑该任务。'
            : '稍后会自动补全状态。',
          tone: selectedContextStatus?.staleAssetCount
            ? (isPausedWorkflowTask ? 'stale' : 'warn')
            : 'ok',
          tags: selectedContextStatus?.staleAssetCount ? selectedStaleAssetTags : [],
        },
      ]
    : []

  useEffect(() => {
    let active = true
    const novelId = selectedTask?.novelId
    if (!novelId) {
      setSelectedContextStatus(null)
      return () => {
        active = false
      }
    }

    void window.electron.novel.getContextStatus(novelId).then((status) => {
      if (active) setSelectedContextStatus(status)
    }).catch(() => {
      if (active) setSelectedContextStatus(null)
    })

    return () => {
      active = false
    }
  }, [selectedTask?.novelId, selectedTask?.updatedAt])

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

  const handleCancel = async (taskId: number) => {
    await window.electron.task.cancel(taskId)
    await loadTasks({ silent: true })
  }

  const handleRetry = async (taskId: number) => {
    try {
      await window.electron.task.retry(taskId)
      await loadTasks({ silent: true })
    } catch (error) {
      message.error(getErrorMessage(error, 'taskCenter.retryFailed'))
    }
  }

  const handleResume = async (task: Task, recoveryAction?: ReturnType<typeof buildTaskRecoveryAction> | null) => {
    try {
      if (isChapterPipelineResumeSupported(task, recoveryAction || null)) {
        await window.electron.chapter.resumeContent(task.id)
      } else if (task.runnerType === 'workflow' && (task.status === 'paused' || task.status === 'blocked') && isWorkflowResumable(task)) {
        await window.electron.workflow.resume(task.id)
      } else {
        return
      }
      message.success(getUserFacingMessage('taskCenter.resumed'))
      await loadTasks({ silent: true })
    } catch (error) {
      message.error(getErrorMessage(error, 'taskCenter.resumeFailed'))
    }
  }

  const handleClearHistory = useCallback(() => {
    Modal.confirm({
      title: '清空历史任务记录？',
      content: '只会清空当前筛选范围内已结束的任务记录，不影响运行中、等待中、停止中或已暂停的任务。',
      okText: '确认清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setClearingHistory(true)
        try {
          const result = await window.electron.task.clearHistory({
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
              : getUserFacingMessage('taskCenter.historyNothingToClear'),
          )
        } catch (error) {
          message.error(getErrorMessage(error, 'taskCenter.clearHistoryFailed'))
        } finally {
          setClearingHistory(false)
        }
      },
    })
  }, [clearStream, fetchTaskData, page, selectedId, statusFilter, typeFilter])

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

  const detailSections = useMemo<CollapseProps['items']>(() => {
    const items: NonNullable<CollapseProps['items']> = []

    if (selectedStream?.content) {
      items.push({
        key: 'stream',
        label: '实时输出',
        children: <div className="task-center-code">{selectedStream.content}</div>,
      })
    }

    if (selectedTask?.outputText) {
      items.push({
        key: 'output',
        label: '结果输出',
        children: <div className="task-center-code">{selectedTask.outputText}</div>,
      })
    }

    if (selectedTask?.inputJson) {
      items.push({
        key: 'input',
        label: '请求上下文',
        children: <div className="task-center-code">{formatTaskPayload(selectedTask.inputJson)}</div>,
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
        children: <div className="task-center-code">{[...observabilityLines, ...pipelineRoleLines].join('\n\n')}</div>,
      })
    }

    return items
  }, [selectedStream, selectedTask])

  return (
    <WorkspacePage
      className="task-center-page"
      title="任务中心"
      description="集中管理 AI 任务的执行状态、报错追踪与重试恢复。"
      heroVariant="compact"
      actions={(
        <div className="task-center-toolbar">
          <Button icon={<ReloadOutlined />} loading={loading && !clearingHistory} onClick={() => void loadTasks()}>
            刷新
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={clearingHistory}
            disabled={!canClearHistory}
            onClick={handleClearHistory}
          >
            清空历史
          </Button>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="运行中" value={runningCount} tone="cool" />
          <WorkspaceMetric label="等待中" value={pendingCount} />
          <WorkspaceMetric label="已成功" value={successCount} tone="warm" />
          <WorkspaceMetric label="已失败" value={failedCount} />
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
                  onChange={handleStatusFilterChange}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'running', label: '运行中' },
                    { value: 'cancel_requested', label: '停止中' },
                    { value: 'paused', label: '已暂停' },
                    { value: 'pending', label: '等待中' },
                    { value: 'success', label: '成功' },
                    { value: 'failed', label: '失败' },
                    { value: 'cancelled', label: '已取消' },
                  ]}
                />
                <Select
                  className="task-center-filter-control"
                  value={typeFilter}
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
                  ? '当前筛选下没有匹配任务，清空筛选后再看完整记录。'
                  : '这里还没有任务记录，去创作页发起生成、审校或批处理后会在这里汇总。'
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
              <div className="task-center-list">
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
                            {task.pipelineStage ? <Tag color={task.pipelineStage === 'failed' ? 'red' : task.pipelineStage === 'blocked' ? 'warning' : task.pipelineStage === 'running' ? 'processing' : 'default'}>{getTaskPipelineStageLabel(task)}</Tag> : null}
                            {isTaskRetryable(task) ? <Tag color="processing">可重试</Tag> : null}
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
          title={selectedTask ? `任务详情 · ${getTaskTypeLabel(selectedTask.type)}` : '任务详情'}
          extra={selectedTask ? (
            <div className="task-center-detail__actions">
              {selectedTask.status === 'running' ? (
                <Button danger icon={<StopOutlined />} onClick={() => void handleCancel(selectedTask.id)}>
                  取消
                </Button>
              ) : null}
              {((selectedTask.status === 'paused' || selectedTask.status === 'blocked') && isWorkflowResumable(selectedTask))
                || isChapterPipelineResumeSupported(selectedTask, selectedRecoveryAction) ? (
                <Button icon={<ReloadOutlined />} onClick={() => void handleResume(selectedTask, selectedRecoveryAction)}>
                  继续
                </Button>
              ) : null}
              {selectedRecoveryAction?.kind === 'recover_draft' || selectedRecoveryAction?.kind === 'open_page' ? (
                <Button icon={<ReloadOutlined />} onClick={() => handleRecoverDraft(selectedRecoveryAction.path)}>
                  {selectedRecoveryAction.label}
                </Button>
              ) : null}
              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') && isTaskRetryable(selectedTask) ? (
                <Button icon={<ReloadOutlined />} onClick={() => void handleRetry(selectedTask.id)}>
                  重试
                </Button>
              ) : null}
            </div>
          ) : null}
        >
          {!selectedTask ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="先从左侧选择一条任务，右侧会集中显示状态、恢复入口和请求上下文。"
            />
          ) : (
            <div className="task-center-detail">
              <div className="task-center-detail__header">
                <div>
                  <div className="task-center-detail__title">{getTaskTypeLabel(selectedTask.type)}</div>
                  <div className="task-center-detail__summary">
                    {selectedTask.relatedEntityType
                      ? `${selectedTask.relatedEntityType} #${selectedTask.relatedEntityId || '-'}`
                      : '未绑定关联实体'}
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
                  description="这类任务会直接改动小说数据，不能在这里简单重试。请回到对应功能页重新发起。"
                />
              ) : null}

              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') && isTaskRetryable(selectedTask) ? (
                <Alert
                  type="success"
                  showIcon
                  message="当前任务支持安全重试"
                  description="系统已经保留本次请求上下文，可以直接重放同一组消息，不需要回到原页面重新填写。"
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

              <div className="novel-note-list">
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
              </div>

              {selectedTask.novelId ? (
                <div className="task-context-health-card">
                  <div className="task-context-health-card__head">
                    <div className="task-context-health-card__title">上下文健康</div>
                    <div className="task-context-health-card__meta">
                      <span>{`上下文版本 v${selectedContextStatus?.contextVersion ?? '--'}`}</span>
                      <span>{selectedContextStatus?.totalChapterCount ? `已纳入 ${selectedContextStatus.totalChapterCount} 章正文` : '尚未生成正文章节'}</span>
                    </div>
                  </div>
                  <div className="novel-freshness-grid novel-freshness-grid--compact">
                    {selectedFreshnessCards.map((card) => (
                      <section key={card.title} className={`novel-freshness-card novel-freshness-card--${card.tone}`}>
                        <div className="novel-freshness-card__title">{card.title}</div>
                        <strong className="novel-freshness-card__value">{card.value}</strong>
                        <div className="novel-freshness-card__desc">{card.desc}</div>
                        {card.tags.length > 0 ? (
                          <div className="novel-freshness-card__tags">
                            {card.tags.map((tag) => (
                              <span key={`${card.title}-${tag}`} className="novel-freshness-card__tag">{tag}</span>
                            ))}
                          </div>
                        ) : null}
                        <div className="novel-freshness-card__hint">{card.hint}</div>
                      </section>
                    ))}
                  </div>
                  {isPausedWorkflowTask ? (
                    <div className="task-context-health-card__recovery">
                      {selectedContextStatus?.staleCheckpointCount || selectedContextStatus?.staleAssetCount || selectedContextStatus?.staleChapterCount
                        ? '当前流程已暂停，恢复前最好先处理上面的滞后项，避免继续沿用旧上下文。'
                        : '当前流程已暂停，但上下文仍稳定，可以直接恢复继续执行。'}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Collapse
                items={detailSections}
                defaultActiveKey={selectedStream?.content ? ['stream'] : selectedTask.outputText ? ['output'] : undefined}
              />
            </div>
          )}
        </WorkspacePanel>
      </div>
    </WorkspacePage>
  )
}
