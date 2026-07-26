import React, { useState } from 'react'
import { Badge, Popover } from 'antd'
import { SyncOutlined, HistoryOutlined } from '@ant-design/icons'
import { useRunningTaskCount } from '../../stores/task.selectors'
import TaskIndicatorPanel from './TaskIndicatorPanel'
import './TaskIndicator.css'

/**
 * Global running-task badge. Mounted in both the app shell bar and the novel
 * workspace topbar so background generations stay visible across pages.
 */
export default function TaskIndicator({ className }: { className?: string }) {
  const runningCount = useRunningTaskCount()
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      overlayClassName="task-indicator-popover"
      content={<TaskIndicatorPanel onNavigate={() => setOpen(false)} />}
    >
      <button
        type="button"
        className={`task-indicator${runningCount > 0 ? ' task-indicator--active' : ''}${className ? ` ${className}` : ''}`}
        aria-label={runningCount > 0 ? `${runningCount} 个任务进行中` : '任务面板'}
        title={runningCount > 0 ? `${runningCount} 个任务进行中` : '任务面板'}
      >
        <Badge count={runningCount} size="small" offset={[2, -2]}>
          {runningCount > 0 ? <SyncOutlined spin /> : <HistoryOutlined />}
        </Badge>
      </button>
    </Popover>
  )
}
