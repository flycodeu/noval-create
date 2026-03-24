import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Collapse, Empty, Select, Space, Tag, type CollapseProps } from 'antd'
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { Task } from '../../types'
import { useTaskStore } from '../../stores/task.store'
import {
  WorkspaceMetric,
  WorkspacePage,
  WorkspacePanel,
} from '../Novel/components/WorkspaceShell'

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '等待中', color: '#5c6378', icon: <ClockCircleOutlined /> },
  running: { label: '运行中', color: '#2E86AB', icon: <LoadingOutlined spin /> },
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
  generate_arcs: 'AI 生成故事弧',
  generate_items: 'AI 生成物品',
  generate_timeline: 'AI 生成时间轴',
  subplot_framework: 'AI 生成支线',
  core_settings_generate: 'AI 生成核心设定',
  world_rules_generate: 'AI 生成世界规则',
}

const RUNNER_LABELS: Record<string, string> = {
  chat: '单次执行',
  stream: '流式执行',
}

function formatTaskPayload(raw?: string): string {
  if (!raw) return ''

  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function getTaskTypeLabel(type: string): string {
  return TYPE_LABELS[type] || type
}

function getTaskRunnerLabel(task: Task): string {
  return RUNNER_LABELS[task.runnerType || 'chat'] || (task.runnerType || 'chat')
}

function isTaskRetryable(task: Task): boolean {
  if (task.type === 'chapter_write' && task.relatedEntityType === 'chapter' && task.relatedEntityId) return true
  if (task.type === 'subplot_framework') return true
  return Boolean(task.retryable)
}

function getTaskRetryabilityLabel(task: Task): string {
  return isTaskRetryable(task) ? '支持安全重试' : '需回到功能页重新发起'
}

function getTaskSummary(task: Task, stream?: { content: string }): string {
  if (task.errorMessage) return task.errorMessage
  if (stream?.content) return stream.content.slice(0, 140)
  if (task.outputText) return task.outputText.slice(0, 140)
  if (task.inputJson) return formatTaskPayload(task.inputJson).slice(0, 140)
  return '这条任务还没有可直接查看的结果摘要。'
}

export default function TaskCenter() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const { streams } = useTaskStore()

  const loadTasks = useCallback(async () => {
    const list = await window.electron.task.list()
    setTasks(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadTasks()
    const timer = setInterval(() => {
      void loadTasks()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  const filteredTasks = useMemo(
    () => tasks
      .filter((task) => {
        if (statusFilter !== 'all' && task.status !== statusFilter) return false
        if (typeFilter !== 'all' && task.type !== typeFilter) return false
        return true
      })
      .sort((left, right) => {
        const rightTime = new Date(right.updatedAt || right.createdAt).getTime()
        const leftTime = new Date(left.updatedAt || left.createdAt).getTime()
        return rightTime - leftTime
      }),
    [statusFilter, tasks, typeFilter],
  )

  useEffect(() => {
    if (filteredTasks.length === 0) {
      setSelectedId(null)
      return
    }

    if (!selectedId || !filteredTasks.some((task) => task.id === selectedId)) {
      setSelectedId(filteredTasks[0].id)
    }
  }, [filteredTasks, selectedId])

  const selectedTask = useMemo(
    () => filteredTasks.find((task) => task.id === selectedId) || null,
    [filteredTasks, selectedId],
  )

  const handleCancel = async (taskId: number) => {
    await window.electron.task.cancel(taskId)
    await loadTasks()
  }

  const handleRetry = async (taskId: number) => {
    try {
      await window.electron.task.retry(taskId)
      await loadTasks()
    } catch {
      // Keep the page quiet and let the detail panel explain retry availability.
    }
  }

  const runningCount = tasks.filter((task) => task.status === 'running').length
  const failedCount = tasks.filter((task) => task.status === 'failed').length
  const successCount = tasks.filter((task) => task.status === 'success').length
  const pendingCount = tasks.filter((task) => task.status === 'pending').length
  const selectedStream = selectedTask ? streams[selectedTask.id] : undefined

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

    return items
  }, [selectedStream, selectedTask])

  return (
    <WorkspacePage
      className="task-center-page"
      eyebrow="任务运行台"
      title="任务中心"
      description="把 AI 生成、重试、取消、报错和流式输出放在同一套工作台里，便于判断流程卡在哪一步。"
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadTasks()}>刷新</Button>
          <div className="novel-pill">当前筛选 {filteredTasks.length} 条任务</div>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label="运行中" value={runningCount} tone="cool" hint="当前仍在执行的 AI 任务" />
          <WorkspaceMetric label="等待中" value={pendingCount} hint="已入队但尚未开始的任务" />
          <WorkspaceMetric label="已成功" value={successCount} tone="warm" hint="最近已经完成的任务" />
          <WorkspaceMetric label="已失败" value={failedCount} hint="需要重试或回查提示词的任务" />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title="任务列表"
          description="左侧按状态和类型筛选，右侧看完整输出、请求上下文和错误信息。"
          extra={(
            <div className="novel-filter-bar">
              <div className="novel-filter-bar__row">
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: 'all', label: '全部状态' },
                    { value: 'running', label: '运行中' },
                    { value: 'pending', label: '等待中' },
                    { value: 'success', label: '成功' },
                    { value: 'failed', label: '失败' },
                    { value: 'cancelled', label: '已取消' },
                  ]}
                />
                <Select
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: 'all', label: '全部类型' },
                    ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </div>
              <div className="novel-filter-bar__summary">
                同类任务可以集中查看失败原因和重试结果，不再被时间线打散。
              </div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><LoadingOutlined spin /></div>
          ) : filteredTasks.length === 0 ? (
            <Empty description="当前筛选下暂无任务记录" style={{ paddingTop: 40 }} />
          ) : (
            <div className="task-center-list">
              {filteredTasks.map((task) => {
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
