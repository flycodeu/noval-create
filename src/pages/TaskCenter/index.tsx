import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Collapse, Empty, Select, Space, Tag } from 'antd'
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
  chapter_outline: 'AI 生成细纲',
  chapter_write: 'AI 生成正文',
  summary: '更新章节记忆',
  review: 'AI 审校修订',
  ai_check: 'AI 检测',
  expand_background: 'AI 扩展背景',
  generate_relations: 'AI 生成人物关系',
  generate_map: 'AI 生成地图',
  generate_arcs: 'AI 生成故事弧',
  generate_timeline: 'AI 生成时间轴',
  subplot_framework: 'AI 生成支线',
  core_settings_generate: 'AI 生成核心设定',
  world_rules_generate: 'AI 生成世界规则',
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
    loadTasks()
    const timer = setInterval(loadTasks, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  const filteredTasks = useMemo(() => tasks
    .filter((task) => {
      if (statusFilter !== 'all' && task.status !== statusFilter) return false
      if (typeFilter !== 'all' && task.type !== typeFilter) return false
      return true
    })
    .sort((left, right) => {
      const rightTime = new Date(right.updatedAt || right.createdAt).getTime()
      const leftTime = new Date(left.updatedAt || left.createdAt).getTime()
      return rightTime - leftTime
    }), [statusFilter, tasks, typeFilter])

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
    loadTasks()
  }

  const handleRetry = async (taskId: number) => {
    try {
      await window.electron.task.retry(taskId)
      loadTasks()
    } catch {
      // keep page quiet and let detail state show retry availability
    }
  }

  const runningCount = tasks.filter((task) => task.status === 'running').length
  const failedCount = tasks.filter((task) => task.status === 'failed').length
  const successCount = tasks.filter((task) => task.status === 'success').length
  const pendingCount = tasks.filter((task) => task.status === 'pending').length
  const selectedStream = selectedTask ? streams[selectedTask.id] : undefined

  return (
    <WorkspacePage
      className="task-center-page"
      eyebrow="任务运行台"
      title={'任务中心'}
      description="把 AI 生成、重试、取消、报错和流式输出放在同一套工作台里，便于快速判断当前流程卡在哪一步。"
      actions={(
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>{'刷新'}</Button>
          <div className="novel-pill">{`当前筛选 ${filteredTasks.length} 条任务`}</div>
        </Space>
      )}
      metrics={(
        <>
          <WorkspaceMetric label={'运行中'} value={runningCount} tone="cool" hint={'正在执行的 AI 任务'} />
          <WorkspaceMetric label={'等待中'} value={pendingCount} hint={'还没开始的队列任务'} />
          <WorkspaceMetric label={'已成功'} value={successCount} tone="warm" hint={'最近已完成的任务'} />
          <WorkspaceMetric label={'已失败'} value={failedCount} hint={'需要重试或检查提示词的任务'} />
        </>
      )}
    >
      <div className="novel-split novel-split--sidebar">
        <WorkspacePanel
          title={'任务列表'}
          description={'左侧按状态和类型筛选，右侧看完整输出、请求上下文和错误信息。'}
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
                {'同类任务可以集中查看失败原因和重试结果，不再被时间线打散。'}
              </div>
            </div>
          )}
        >
          {loading ? (
            <div className="novel-empty"><LoadingOutlined spin /></div>
          ) : filteredTasks.length === 0 ? (
            <Empty description={'当前筛选下暂无任务记录'} style={{ paddingTop: 40 }} />
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
                          {task.durationMs ? <Tag>{`${(task.durationMs / 1000).toFixed(1)}s`}</Tag> : null}
                          {task.tokensUsed ? <Tag>{`${task.tokensUsed} 令牌`}</Tag> : null}
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
                <Button danger icon={<StopOutlined />} onClick={() => handleCancel(selectedTask.id)}>
                  {'取消'}
                </Button>
              ) : null}
              {(selectedTask.status === 'failed' || selectedTask.status === 'cancelled') ? (
                <Button icon={<ReloadOutlined />} onClick={() => handleRetry(selectedTask.id)}>
                  {'重试'}
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
                  <div className="task-center-detail__summary">{selectedTask.relatedEntityType ? `${selectedTask.relatedEntityType} #${selectedTask.relatedEntityId || '-'}` : '未绑定关联实体'}</div>
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
                  message={'运行提示'}
                  description={selectedTask.errorMessage}
                />
              ) : null}

              <div className="novel-note-list">
                <div className="novel-note-list__item">{`任务 ID：${selectedTask.id}`}</div>
                <div className="novel-note-list__item">{`模型配置：${selectedTask.modelConfigId || '-'}`}</div>
                <div className="novel-note-list__item">{`耗时：${selectedTask.durationMs ? `${(selectedTask.durationMs / 1000).toFixed(1)}s` : '-'}`}</div>
                <div className="novel-note-list__item">{`令牌消耗：${selectedTask.tokensUsed || '-'}`}</div>
              </div>

              <Collapse
                items={[
                  selectedStream ? {
                    key: 'stream',
                    label: '实时输出',
                    children: (
                      <div className="task-center-code">
                        {selectedStream.content}
                      </div>
                    ),
                  } : null,
                  selectedTask.outputText ? {
                    key: 'output',
                    label: '结果输出',
                    children: (
                      <div className="task-center-code">
                        {selectedTask.outputText}
                      </div>
                    ),
                  } : null,
                  selectedTask.inputJson ? {
                    key: 'input',
                    label: '请求上下文',
                    children: (
                      <div className="task-center-code">
                        {formatTaskPayload(selectedTask.inputJson)}
                      </div>
                    ),
                  } : null,
                ].filter(Boolean)}
                defaultActiveKey={selectedStream ? ['stream'] : selectedTask.outputText ? ['output'] : undefined}
              />
            </div>
          )}
        </WorkspacePanel>
      </div>
    </WorkspacePage>
  )
}
