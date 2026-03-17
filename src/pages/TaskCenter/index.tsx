import React, { useEffect, useState, useCallback } from 'react'
import {
  Button, Select, Tag, Collapse, Empty, Spin, message, Timeline, Tooltip
} from 'antd'
import {
  StopOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined,
  LoadingOutlined, ClockCircleOutlined, DeleteOutlined
} from '@ant-design/icons'
import { Task } from '../../types'
import { useTaskStore } from '../../stores/task.store'

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '等待中', color: '#5c6378', icon: <ClockCircleOutlined /> },
  running: { label: '运行中', color: '#2E86AB', icon: <LoadingOutlined spin /> },
  success: { label: '成功', color: '#52c41a', icon: <CheckCircleOutlined /> },
  failed: { label: '失败', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
  cancelled: { label: '已取消', color: '#faad14', icon: <StopOutlined /> },
}

const TYPE_LABELS: Record<string, string> = {
  init: '初始化',
  character_gen: '生成人物',
  chapter_outline: '生成大纲',
  chapter_write: '生成正文',
  summary: '生成摘要',
  review: '内容重写',
  ai_check: 'AI 检测',
  expand_background: '背景扩充',
  generate_relations: '生成关系',
  generate_map: '生成地图',
  generate_arcs: '生成故事弧',
  generate_timeline: '生成时间轴',
  subplot_framework: '生成支线',
  core_settings_generate: '生成核心设定',
}

function formatTaskPayload(raw?: string): string {
  if (!raw) return ''

  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export default function TaskCenter() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const { streams } = useTaskStore()

  const loadTasks = useCallback(async () => {
    const list = await window.electron.task.list()
    setTasks(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTasks()
    // 每5秒自动刷新
    const timer = setInterval(loadTasks, 5000)
    return () => clearInterval(timer)
  }, [loadTasks])

  const filteredTasks = tasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false
    if (typeFilter !== 'all' && t.type !== typeFilter) return false
    return true
  })

  const handleCancel = async (taskId: number) => {
    await window.electron.task.cancel(taskId)
    message.info('已发送取消请求')
    setTimeout(loadTasks, 500)
  }

  const handleRetry = async (taskId: number) => {
    try {
      await window.electron.task.retry(taskId)
      message.success('已重新提交任务')
      setTimeout(loadTasks, 500)
    } catch {
      message.error('重试失败')
    }
  }

  const handleClearCompleted = async () => {
    // 清除所有完成/失败/取消的任务（这里只做前端过滤展示，实际删除可通过后端实现）
    message.info('暂不支持批量清除，可通过数据库直接操作')
  }

  const timelineItems = filteredTasks.map(task => {
    const status = STATUS_LABELS[task.status] || STATUS_LABELS.pending
    const stream = streams[task.id]

    return {
      key: task.id,
      dot: <span style={{ color: status.color }}>{status.icon}</span>,
      children: (
        <div style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          padding: 12,
          marginBottom: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Tag style={{
              background: 'transparent',
              border: `1px solid ${status.color}`,
              color: status.color,
              fontSize: 11,
            }}>
              {status.label}
            </Tag>
            <Tag style={{ background: 'rgba(255,255,255,0.06)', border: 'none', fontSize: 11 }}>
              {TYPE_LABELS[task.type] || task.type}
            </Tag>
            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
              {new Date(task.createdAt).toLocaleString('zh-CN')}
            </span>
            {task.durationMs && (
              <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                {(task.durationMs / 1000).toFixed(1)}s
              </span>
            )}
            {task.tokensUsed && (
              <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                {task.tokensUsed} tokens
              </span>
            )}
            <div style={{ flex: 1 }} />
            {task.status === 'running' && (
              <Button size="small" danger icon={<StopOutlined />} onClick={() => handleCancel(task.id)}>
                取消
              </Button>
            )}
            {(task.status === 'failed' || task.status === 'cancelled') && (
              <Button size="small" icon={<ReloadOutlined />} onClick={() => handleRetry(task.id)}>
                重试
              </Button>
            )}
          </div>

          {task.errorMessage && (
            <div style={{
              color: task.status === 'success' ? '#faad14' : '#ff4d4f',
              fontSize: 12,
              background: task.status === 'success'
                ? 'rgba(250,173,20,0.12)'
                : 'rgba(255,77,79,0.1)',
              padding: '4px 8px',
              borderRadius: 4,
              marginBottom: 6,
            }}>
              {task.errorMessage}
            </div>
          )}

          {/* 流式实时内容 */}
          {stream && (
            <Collapse
              size="small"
              items={[{
                key: 'stream',
                label: '实时输出',
                children: (
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}>
                    {stream.content}
                    {stream.status === 'running' && <span className="streaming-cursor" />}
                  </div>
                ),
              }]}
              defaultActiveKey={['stream']}
            />
          )}

          {/* 已完成任务的输出 */}
          {task.outputText && !stream && (
            <Collapse
              size="small"
              items={[{
                key: 'output',
                label: task.status === 'success'
                  ? `输出内容（${task.outputText.length} 字）`
                  : `原始返回（${task.outputText.length} 字）`,
                children: (
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}>
                    {task.outputText.slice(0, 2000)}
                    {task.outputText.length > 2000 && '...（截断显示）'}
                  </div>
                ),
              }]}
            />
          )}

          {task.inputJson && (
            <Collapse
              size="small"
              items={[{
                key: 'input',
                label: '请求上下文',
                children: (
                  <div style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    maxHeight: 220,
                    overflow: 'auto',
                  }}>
                    {formatTaskPayload(task.inputJson)}
                  </div>
                ),
              }]}
            />
          )}
        </div>
      ),
    }
  })

  return (
    <div style={{ padding: 24, height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ color: 'var(--color-text-primary)', margin: 0 }}>任务中心</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 110 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'running', label: '运行中' },
              { value: 'success', label: '已完成' },
              { value: 'failed', label: '失败' },
              { value: 'cancelled', label: '已取消' },
            ]}
          />
          <Select
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 120 }}
            options={[
              { value: 'all', label: '全部类型' },
              ...Object.entries(TYPE_LABELS).map(([k, v]) => ({ value: k, label: v })),
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={loadTasks}>
            刷新
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : filteredTasks.length === 0 ? (
        <Empty description="暂无任务记录" style={{ paddingTop: 60 }} />
      ) : (
        <Timeline items={timelineItems} />
      )}
    </div>
  )
}
