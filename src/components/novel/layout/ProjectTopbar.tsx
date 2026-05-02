import React from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { type WorkspaceViewMode, getWorkspaceModeOptions } from '../../../shared/novel-workspace'
import './ProjectTopbar.css'

interface ProjectTopbarProps {
  projectTitle: string
  mode: WorkspaceViewMode
  onModeChange: (mode: WorkspaceViewMode) => void
  onBack: () => void
  onClear?: () => void
  onShortcuts: () => void
  onSearch: () => void
  onQuality?: () => void
  onNextStep?: () => void
  nextStepLabel?: string
  exportMenu: MenuProps
  showQuality?: boolean
  showNextStep?: boolean
  moreMenu: MenuProps
}

export default function ProjectTopbar({
  projectTitle,
  mode,
  onModeChange,
  onBack,
  onClear,
  onShortcuts,
  onSearch,
  onQuality,
  onNextStep,
  nextStepLabel,
  exportMenu,
  showQuality = true,
  showNextStep = true,
  moreMenu,
}: ProjectTopbarProps) {
  const modeOptions = getWorkspaceModeOptions()

  return (
    <div className="project-topbar">
      <div className="project-topbar__main">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回项目列表
        </Button>
        <span className="project-topbar__project-name">{projectTitle}</span>
      </div>

      <div className="project-topbar__actions">
        <div className="project-topbar__mode-switch" role="tablist" aria-label="工作模式切换">
          {modeOptions.map((option) => {
            const active = mode === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onModeChange(option.value)}
                className={`project-topbar__mode-button${active ? ' is-active' : ''}`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        <Button icon={<SearchOutlined />} onClick={onSearch}>
          全局搜索
        </Button>
        {showQuality && onQuality ? (
          <Button icon={<BarChartOutlined />} onClick={onQuality}>
            AI质量
          </Button>
        ) : null}
        {showNextStep && onNextStep ? (
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={onNextStep}>
            {nextStepLabel || '推荐下一步'}
          </Button>
        ) : null}
        {onClear ? (
          <Button icon={<DeleteOutlined />} danger onClick={onClear}>
            清空步骤
          </Button>
        ) : null}
        <Button icon={<QuestionCircleOutlined />} onClick={onShortcuts}>
          快捷键
        </Button>
        <Dropdown menu={exportMenu} trigger={['click']}>
          <Button icon={<ExportOutlined />}>导出</Button>
        </Dropdown>
        <Dropdown menu={moreMenu} trigger={['click']}>
          <Button icon={<EllipsisOutlined />}>更多</Button>
        </Dropdown>
      </div>
    </div>
  )
}
