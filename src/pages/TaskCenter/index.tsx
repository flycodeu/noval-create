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
import { AssetReviewObservability, PagedResult, Task, TaskQueryInput, TaskStats } from '../../types'
import { useTaskStore } from '../../stores/task.store'
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
  chapter_scene_plan: 'AI 场景规划',
  chapter_draft: 'AI 草稿生成',
  chapter_outline: 'AI 章节细纲',
  chapter_review: 'AI 审校建议',
  chapter_write: 'AI 章节正文',
  summary: '刷新章节记忆',
  continuity: '连续性检查',
  review: 'AI 审校修订',
  ai_check: 'AI 痕迹检测',
  expand_background: 'AI 扩展背景',
  generate_relations: 'AI 生成人物关系',
  generate_map: 'AI 生成地图',
  map_auto_generate: 'AI 自动生成地图',
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
  planning_draft: 'AI 规划草稿',
}

const RUNNER_LABELS: Record<string, string> = {
  chat: '单次执行',
  stream: '流式执行',
  workflow: '后台流程',
}

const RESUMABLE_WORKFLOW_TYPES = new Set([
  'map_auto_generate',
  'world_rules_auto_generate',
  'character_auto_generate',
  'item_auto_generate',
  'timeline_auto_generate',
  'story_thread_auto_generate',
  'subplot_auto_generate',
])

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

function isTaskRetryable(task: Task): boolean {
  if (task.runnerType === 'workflow') return false
  if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) return true
  if (task.type === 'subplot_framework') return true
  return Boolean(task.retryable)
}

function isWorkflowResumable(task: Task): boolean {
  return task.runnerType === 'workflow' && RESUMABLE_WORKFLOW_TYPES.has(task.type)
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
  return '这条任务还没有可直接查看的结果摘要。'
}

export default function TaskCenter() {
  const navigate = useNavigate()
  const loadVersionRef = useRef(0)
  const [pageData, setPageData] = useState<PagedResult<Task>>(EMPTY_TASK_PAGE)
  const [stats, setStats] = useState<TaskStats>(EMPTY_TASK_STATS)
  const [loading, setLoading] = useState(true)
  const [clearingHistory, setClearingHistory] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selectedId, setSelectedId] = useState<number | null>(null)
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
        message.error(error instanceof Error ? error.message : '任务中心加载失败，请稍后再试。')
      }
      return null
    } finally {
      if (requestId === loadVersionRef.current && !options.silent) {
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
    } catch {
      // Keep the page quiet and let the detail panel explain retry availability.
    }
  }

  const handleResume = async (taskId: number) => {
    try {
      await window.electron.workflow.resume(taskId)
      message.success('后台流程已继续执行。')
      await loadTasks({ silent: true })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '继续任务失败，请稍后再试。')
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
              ? `已清空 ${result.deletedCount} 条历史任务。`
              : '当前筛选下暂无可清理的历史任务。',
          )
        } catch (error) {
          message.error(error instanceof Error ? error.message : '清空历史任务失败，请稍后再试。')
        } finally {
          setClearingHistory(false)
        }
      },
    })
  }, [clearStream, fetchTaskData, page, selectedId, statusFilter, typeFilter])

  const handleRecoverDraft = useCallback((path?: string) => {
    if (!path) return
    navigate(path)
    message.success('已打开对应工作台，草稿会自动恢复。')
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
    const observabilityLines = [
      typeof draft?.inputSummary === 'string' && draft.inputSummary.trim() ? `输入摘要：${draft.inputSummary.trim()}` : '',
      Array.isArray(draft?.warnings) && draft.warnings.length > 0 ? `生成提醒：${draft.warnings.join('；')}` : '',
      Array.isArray(draft?.lintWarnings) && draft.lintWarnings.length > 0 ? `语言 lint：${draft.lintWarnings.join('；')}` : '',
      Array.isArray(draft?.diffSummary) && draft.diffSummary.length > 0 ? `人工修改差异：${draft.diffSummary.join('；')}` : '',
      assetReview?.targetType ? `资产类型：${assetReview.targetType}` : '',
      assetReview?.stage ? `质检阶段：${assetReview.stage}` : '',
      assetReview?.reviewSummary ? `质检结论：${assetReview.reviewSummary}` : '',
      assetReview?.severity ? `风险等级：${assetReview.severity}` : '',
      Array.isArray(assetReview?.topFixes) && assetReview.topFixes.length > 0 ? `优先修法：${assetReview.topFixes.join('；')}` : '',
      Array.isArray(assetReview?.risks) && assetReview.risks.length > 0 ? `质检风险：${assetReview.risks.join('；')}` : '',
      Array.isArray(assetReview?.warnings) && assetReview.warnings.length > 0 ? `质检备注：${assetReview.warnings.join('；')}` : '',
    ].filter(Boolean)

    if (observabilityLines.length > 0) {
      items.push({
        key: 'observability',
        label: '草稿观测',
        children: <div className="task-center-code">{observabilityLines.join('\n\n')}</div>,
      })
    }

    return items
  }, [selectedStream, selectedTask])

  return (
    <WorkspacePage
      className="task-center-page"
      eyebrow="任务运行台"
      title="任务中心"
      description="把 AI 生成、重试、取消、报错和流式输出放在同一套工作台里，支持按每页 10 / 20 / 50 条查看任务历史。"
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
          <div className="novel-pill">{`当前筛选共 ${pageData.total} 条，每页 ${pageData.pageSize} 条`}</div>
        </div>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="运行中" value={runningCount} tone="cool" hint="当前仍在执行或收尾中的 AI 任务" />
          <WorkspaceMetric label="等待中" value={pendingCount} hint="已入队但尚未开始的任务" />
          <WorkspaceMetric label="已成功" value={successCount} tone="warm" hint="最近已经完成的任务" />
          <WorkspaceMetric label="已失败" value={failedCount} hint="需要重试或回查提示词的任务" />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="任务列表"
          description="左侧按状态和类型筛选并分页查看，右侧看完整输出、请求上下文和错误信息。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Select
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
                  value={typeFilter}
                  onChange={handleTypeFilterChange}
                  options={[
                    { value: 'all', label: '全部类型' },
                    ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </div>
              <div className="novel-filter-bar__summary">
                同类任务可以集中查看失败原因和重试结果；当前按每页 10 / 20 / 50 条分页查看。
              </div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><LoadingOutlined spin /></div>
          ) : pageData.items.length === 0 ? (
            <Empty description="当前筛选下暂无任务记录" style={{ paddingTop: 40 }} />
          ) : (
            <>
              <div className="task-center-list">
                {pageData.items.map((task) => {
                  const status = STATUS_LABELS[task.status] || STATUS_LABELS.pending
                  const stream = streams[task.id]
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
                            {isTaskRetryable(task) ? <Tag color="processing">可重试</Tag> : null}
                            {task.durationMs ? <Tag>{`${(task.durationMs / 1000).toFixed(1)}s`}</Tag> : null}
                            {task.tokensUsed ? <Tag>{`${task.tokensUsed} tokens`}</Tag> : null}
                          </div>
                        </div>
                        <div className="task-center-card__summary">{getTaskSummary(task, stream)}</div>
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
          title={selectedTask ? `任务详情 · ${getTaskTypeLabel(selectedTask.type)}` : '任务详情'}
          description="集中查看状态、报错、流式输出和请求上下文。"
          extra={selectedTask ? (
            <div className="task-center-detail__actions">
              {selectedTask.status === 'running' ? (
                <Button danger icon={<StopOutlined />} onClick={() => void handleCancel(selectedTask.id)}>
                  取消
                </Button>
              ) : null}
              {selectedTask.status === 'paused' && isWorkflowResumable(selectedTask) ? (
                <Button icon={<ReloadOutlined />} onClick={() => void handleResume(selectedTask.id)}>
                  继续
                </Button>
              ) : null}
              {selectedRecoveryAction?.kind === 'recover_draft' ? (
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
            <div className="novel-empty">从左侧选择一条任务，这里会显示完整详情。</div>
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
                  description="这类任务会直接改动数据库状态，不能只靠重放原始 prompt 再跑一遍。请回到对应功能页重新发起。"
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

              {selectedRecoveryAction?.kind === 'recover_draft' ? (
                <Alert
                  type="info"
                  showIcon
                  message={selectedRecoveryAction.label}
                  description={selectedRecoveryAction.description}
                />
              ) : null}

              <div className="novel-note-list">
                <div className="novel-note-list__item">{`任务 ID：${selectedTask.id}`}</div>
                <div className="novel-note-list__item">{`执行方式：${getTaskRunnerLabel(selectedTask)}`}</div>
                <div className="novel-note-list__item">{`重试能力：${getTaskRetryabilityLabel(selectedTask)}`}</div>
                <div className="novel-note-list__item">{`模型配置：${selectedTask.modelConfigId || '-'}`}</div>
                <div className="novel-note-list__item">{`耗时：${selectedTask.durationMs ? `${(selectedTask.durationMs / 1000).toFixed(1)}s` : '-'}`}</div>
                <div className="novel-note-list__item">{`Token 消耗：${selectedTask.tokensUsed || '-'}`}</div>
              </div>

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
