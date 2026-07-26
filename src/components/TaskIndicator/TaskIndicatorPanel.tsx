import React from 'react'
import { Button, Empty, Progress, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useRunningTasks } from '../../stores/task.selectors'
import { formatStageLabel } from '../../shared/task-labels'
import type { TaskStream } from '../../stores/task.store'

function taskTitle(stream: TaskStream): string {
  if (stream.meta.title) return stream.meta.title
  if (stream.stageLabel) return stream.stageLabel
  if (stream.meta.taskType === 'chapter_generation') return '章节生成'
  return `任务 #${stream.taskId}`
}

function TaskRow({ stream, onNavigate }: { stream: TaskStream; onNavigate: () => void }) {
  const navigate = useNavigate()
  const stageText = stream.stageLabel || formatStageLabel(stream.stage)

  const handleOpen = () => {
    if (stream.meta.novelId && stream.meta.chapterId) {
      navigate(`/novels/${stream.meta.novelId}/writing?chapterId=${stream.meta.chapterId}`)
    } else {
      navigate('/tasks')
    }
    onNavigate()
  }

  const handleCancel = async () => {
    try {
      await window.electron.task?.cancel?.(stream.taskId)
    } catch (error) {
      console.warn('[TaskIndicator] cancel failed', error)
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
        <Button size="small" danger onClick={handleCancel}>取消</Button>
      </div>
    </div>
  )
}

export default function TaskIndicatorPanel({ onNavigate }: { onNavigate: () => void }) {
  const runningTasks = useRunningTasks()
  const navigate = useNavigate()

  return (
    <div className="task-indicator-panel">
      {runningTasks.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有进行中的任务" />
      ) : (
        runningTasks.map((stream) => (
          <TaskRow key={stream.taskId} stream={stream} onNavigate={onNavigate} />
        ))
      )}
      <div className="task-indicator-panel__footer">
        <Button
          type="link"
          size="small"
          onClick={() => {
            navigate('/tasks')
            onNavigate()
          }}
        >
          打开任务中心
        </Button>
      </div>
    </div>
  )
}
