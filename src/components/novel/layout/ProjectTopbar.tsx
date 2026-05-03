import React, { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BorderOutlined,
  CloseOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  ExportOutlined,
  MinusOutlined,
  QuestionCircleOutlined,
  RollbackOutlined,
  SearchOutlined,
  ShrinkOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { type WorkspaceViewMode, getWorkspaceModeOptions } from '../../../shared/novel-workspace'
import './ProjectTopbar.css'

interface ProjectTopbarProps {
  projectTitle: string
  workspaceLabel: string
  workspaceSummary?: string
  mode: WorkspaceViewMode
  onModeChange: (mode: WorkspaceViewMode) => void
  onBack: () => void
  onClear?: () => void
  onJumpChapter: () => void
  onShortcuts: () => void
  onSearch: () => void
  onQuality?: () => void
  onUndo?: () => void
  canUndo?: boolean
  onNextStep?: () => void
  nextStepLabel?: string
  exportMenu: MenuProps
  showQuality?: boolean
  showNextStep?: boolean
  moreMenu: MenuProps
}

export default function ProjectTopbar({
  projectTitle,
  workspaceLabel,
  workspaceSummary,
  mode,
  onModeChange,
  onBack,
  onClear,
  onJumpChapter,
  onShortcuts,
  onSearch,
  onQuality,
  onUndo,
  canUndo = false,
  onNextStep,
  nextStepLabel,
  exportMenu,
  showQuality = true,
  showNextStep = true,
  moreMenu,
}: ProjectTopbarProps) {
  const modeOptions = getWorkspaceModeOptions()
  const activeMode = modeOptions.find((option) => option.value === mode)
  const [isMaximized, setIsMaximized] = useState(false)
  const overflowMenu = useMemo<MenuProps>(() => {
    const items: NonNullable<MenuProps['items']> = []
    const appendDivider = () => {
      if (items.length > 0 && items[items.length - 1]?.type !== 'divider') {
        items.push({ type: 'divider' })
      }
    }

    if (showQuality && onQuality) {
      items.push({
        key: 'workspace-quality',
        icon: <BarChartOutlined />,
        label: 'AI质量',
        onClick: onQuality,
      })
    }

    if (onShortcuts) {
      items.push({
        key: 'workspace-shortcuts',
        icon: <QuestionCircleOutlined />,
        label: '快捷键',
        onClick: onShortcuts,
      })
    }

    if (exportMenu.items && exportMenu.items.length > 0) {
      appendDivider()
      items.push({
        key: 'workspace-export',
        icon: <ExportOutlined />,
        label: '导出',
        children: exportMenu.items,
      })
    }

    if (onClear) {
      appendDivider()
      items.push({
        key: 'workspace-clear',
        icon: <DeleteOutlined />,
        label: '清空步骤',
        danger: true,
        onClick: onClear,
      })
    }

    if (moreMenu.items && moreMenu.items.length > 0) {
      appendDivider()
      moreMenu.items.forEach((item) => {
        if (!item) return
        if (item.type === 'divider') {
          appendDivider()
          return
        }
        items.push(item)
      })
    }

    while (items[items.length - 1]?.type === 'divider') {
      items.pop()
    }

    return { items }
  }, [exportMenu.items, moreMenu.items, onClear, onQuality, onShortcuts, showQuality])

  useEffect(() => {
    let active = true
    void window.electron.windowControls.isMaximized().then((value) => {
      if (active) setIsMaximized(value)
    }).catch(() => {})

    const unsubscribe = window.electron.windowControls.onMaximizedStateChange((value) => {
      setIsMaximized(value)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return (
    <header className="project-topbar">
      <div className="project-topbar__titlebar">
        <div className="project-topbar__drag-region" aria-hidden="true" />
        <div className="project-topbar__window-controls">
          <Tooltip title="最小化">
            <button
              type="button"
              className="project-topbar__window-button"
              onClick={() => void window.electron.windowControls.minimize()}
              aria-label="最小化窗口"
            >
              <MinusOutlined />
            </button>
          </Tooltip>
          <Tooltip title={isMaximized ? '还原窗口' : '最大化'}>
            <button
              type="button"
              className="project-topbar__window-button"
              onClick={() => void window.electron.windowControls.toggleMaximize()}
              aria-label={isMaximized ? '还原窗口' : '最大化窗口'}
            >
              {isMaximized ? <ShrinkOutlined /> : <BorderOutlined />}
            </button>
          </Tooltip>
          <Tooltip title="关闭">
            <button
              type="button"
              className="project-topbar__window-button project-topbar__window-button--danger"
              onClick={() => void window.electron.windowControls.close()}
              aria-label="关闭窗口"
            >
              <CloseOutlined />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="project-topbar__main-row">
        <div className="project-topbar__identity">
          <Button
            className="project-topbar__back project-topbar__control project-topbar__control--ghost"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
          >
            返回项目列表
          </Button>
          <div className="project-topbar__title-group">
            <div className="project-topbar__title-copy">
              <div className="project-topbar__project-line">
                <strong className="project-topbar__project-name" title={projectTitle}>{projectTitle}</strong>
                <span className="project-topbar__project-separator" aria-hidden="true" />
                <span className="project-topbar__workspace-name" title={workspaceLabel}>{workspaceLabel}</span>
              </div>
              {workspaceSummary ? (
                <div className="project-topbar__workspace-summary" title={workspaceSummary}>
                  {workspaceSummary}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="project-topbar__toolbar">
          <div className="project-topbar__toolbar-group project-topbar__toolbar-group--primary">
            <div className="project-topbar__mode-meta">
              <span className="project-topbar__mode-meta-label">工作模式</span>
              <strong className="project-topbar__mode-meta-value">{activeMode?.label || '未设置'}</strong>
            </div>
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
          </div>

          <div className="project-topbar__toolbar-group project-topbar__toolbar-group--secondary">
            <div className="project-topbar__primary-actions">
              <Button className="project-topbar__control" icon={<SearchOutlined />} onClick={onSearch}>
                全局搜索
              </Button>
              <Button className="project-topbar__control" icon={<SwapOutlined />} onClick={onJumpChapter}>
                跳转章节
              </Button>
              <Button className="project-topbar__control" icon={<RollbackOutlined />} onClick={onUndo} disabled={!canUndo}>
                撤销
              </Button>
            </div>
            {showNextStep && onNextStep ? (
              <Button
                className="project-topbar__control project-topbar__control--accent"
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={onNextStep}
              >
                {nextStepLabel || '推荐下一步'}
              </Button>
            ) : null}
            <Dropdown menu={overflowMenu} trigger={['click']}>
              <Button className="project-topbar__control" icon={<EllipsisOutlined />}>更多</Button>
            </Dropdown>
          </div>
        </div>
      </div>
    </header>
  )
}
