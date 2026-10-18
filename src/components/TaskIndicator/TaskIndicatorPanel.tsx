import React, { useRef, useState } from 'react'
import { Button, Empty, Progress, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { getErrorMessage } from '@/utils/user-facing-message'
import { useRunningTasks } from '../../stores/task.selectors'
import { formatStageLabel } from '../../shared/task-labels'
import { buildWorkspaceRoute } from '../../shared/novel-workspace'
import type { TaskStream } from '../../stores/task.store'

function taskTitle(stream: TaskStream): string {
  if (stream.meta.title) return stream.meta.title
  if (stream.stageLabel) return stream.stageLabel
  if (stream.meta.taskType === 'chapter_generation') return '章节生成'
  return `任务 #${stream.taskId}`
}

function TaskRow({ stream, onNavigate, onRequestNavigate }: { stream: TaskStream; onNavigate: () => void; onRequestNavigate?: (path: string) => void }) {
  const navigate = useNavigate()
  const [cancelling, setCancelling] = useState(false)
  const cancelInFlight = useRef(false)
  const stageText = stream.stageLabel || formatStageLabel(stream.stage)

  const handleOpen = () => {
    const requestNavigate = onRequestNavigate || navigate
    if (stream.meta.novelId && stream.meta.chapterId) {
      requestNavigate(`${buildWorkspaceRoute(stream.meta.novelId, 'writing/editor')}?chapterId=${stream.meta.chapterId}`)
    } else {
      requestNavigate('/tasks')
    }
    onNavigate()
  }

  const handleCancel = async () => {
    if (cancelInFlight.current) return
    cancelInFlight.current = true
    setCancelling(true)
    try {
      await window.electron.task.cancel(stream.taskId)
    } catch (error) {
      message.error(getErrorMessage(error, 'taskCenter.cancelFailed'))
    } finally {
      cancelInFlight.current = false
      setCancelling(false)
    }
  }

  return (
    <div className="task-indicator-panel__row">
      <div className="task-indicator-panel__row-head">
        <button type="button" className="task-indicator-panel__row-title" onClick={handleOpen}>
          {taskTitle(stream)}
        </button>
        {stageText ? <Tag color="processing">{stageText}</Tag> : null}
      </div>
      {stream.progress && stream.progress.total > 0 ? (
        <Progress
          percent={stream.progress.percent ?? 0}
          size="small"
          format={() => `${stream.progress?.current}/${stream.progress?.total}`}
        />
      ) : (
        <Progress percent={100} size="small" status="active" showInfo={false} />
      )}
      <div className="task-indicator-panel__row-actions">
        <Button size="small" onClick={handleOpen}>查看</Button>
        <Button size="small" danger loading={cancelling} onClick={handleCancel}>取消任务</Button>
      </div>
    </div>
  )
}

export default function TaskIndicatorPanel({ onNavigate, onRequestNavigate }: { onNavigate: () => void; onRequestNavigate?: (path: string) => void }) {
  const runningTasks = useRunningTasks()
  const navigate = useNavigate()

  return (
    <div className="task-indicator-panel">
      {runningTasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有进行中的任务" />
      ) : (
        runningTasks.map((stream) => (
          <TaskRow key={stream.taskId} stream={stream} onNavigate={onNavigate} onRequestNavigate={onRequestNavigate} />
        ))
      )}
      <div className="task-indicator-panel__footer">
        <Button
          type="link"
          size="small"
          onClick={() => {
            if (onRequestNavigate) onRequestNavigate('/tasks')
            else navigate('/tasks')
            onNavigate()
          }}
        >
          打开运行记录
        </Button>
      </div>
    </div>
  )
}
