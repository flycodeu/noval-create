import React, { useMemo } from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  BulbOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  ExportOutlined,
  HighlightOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  RollbackOutlined,
  SearchOutlined,
  SunOutlined,
  SwapOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { type WorkspaceViewMode, getWorkspaceModeOptions } from '../../../shared/novel-workspace'
import { useThemeStore, type Theme } from '../../../stores/theme.store'
import WindowControls from '../../Layout/WindowControls'
import TaskIndicator from '../../TaskIndicator'
import './ProjectTopbar.css'

const THEME_OPTIONS: Array<{ value: Theme; label: string; icon: React.ReactNode }> = [
  { value: 'dark', label: '深色', icon: <MoonOutlined /> },
  { value: 'light', label: '浅色', icon: <SunOutlined /> },
  { value: 'soft', label: '柔和', icon: <HighlightOutlined /> },
]

interface ProjectTopbarProps {
  projectTitle: string
  workspaceLabel: string
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
  showWindowControls?: boolean
  sidebarToggleActive?: boolean
  onToggleSidebar?: () => void
  onToggleAssistant?: () => void
  assistantToggleActive?: boolean
  statusTone?: 'default' | 'processing' | 'warning'
  statusText?: string
}

export default function ProjectTopbar({
  projectTitle,
  workspaceLabel,
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
  showWindowControls = true,
  sidebarToggleActive = false,
  onToggleSidebar,
  onToggleAssistant,
  assistantToggleActive = false,
  statusTone = 'default',
  statusText,
}: ProjectTopbarProps) {
  const modeOptions = getWorkspaceModeOptions()
  const { theme, setTheme } = useThemeStore()
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

    items.push({
      key: 'workspace-shortcuts',
      icon: <QuestionCircleOutlined />,
      label: '快捷键',
      onClick: onShortcuts,
    })

    items.push({
      key: 'workspace-jump-chapter',
      icon: <SwapOutlined />,
      label: '章节跳转',
      onClick: onJumpChapter,
    })

    items.push({
      key: 'workspace-undo',
      icon: <RollbackOutlined />,
      label: '撤销最近操作',
      disabled: !canUndo,
      onClick: onUndo,
    })

    items.push({
      key: 'workspace-theme',
      icon: <BulbOutlined />,
      label: `主题：${THEME_OPTIONS.find((option) => option.value === theme)?.label || '跟随当前设置'}`,
      children: THEME_OPTIONS.map((option) => ({
        key: `workspace-theme-${option.value}`,
        icon: option.icon,
        label: option.label,
        onClick: () => setTheme(option.value),
      })),
    })

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
  }, [
    canUndo,
    exportMenu.items,
    moreMenu.items,
    onClear,
    onJumpChapter,
    onQuality,
    onShortcuts,
    onUndo,
    setTheme,
    showQuality,
    theme,
  ])

  return (
    <header className={`project-topbar${showWindowControls ? '' : ' project-topbar--windowless'}`}>
      {showWindowControls ? (
        <div className="project-topbar__titlebar">
          <div className="project-topbar__drag-region" aria-hidden="true" />
          <WindowControls
            className="project-topbar__window-controls"
            buttonClassName="project-topbar__window-button"
            dangerButtonClassName="project-topbar__window-button--danger"
          />
        </div>
      ) : null}

      <div className="project-topbar__main-row">
        <div className="project-topbar__identity">
          <div className="project-topbar__identity-actions">
            <Button
              className="project-topbar__control project-topbar__control--ghost"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              aria-label="返回项目列表"
              title="返回项目列表"
            >
              返回
            </Button>
            {onToggleSidebar ? (
              <Button
                className={`project-topbar__control project-topbar__control--ghost${sidebarToggleActive ? ' is-active' : ''}`}
                icon={sidebarToggleActive ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                onClick={onToggleSidebar}
                aria-label="切换工作区导航"
                title="切换工作区导航"
              >
                导航
              </Button>
            ) : null}
          </div>

          <div className="project-topbar__title-group">
            <div className="project-topbar__title-copy">
              <div className="project-topbar__project-name" title={projectTitle}>{projectTitle}</div>
              <div className="project-topbar__workspace-line">
                <strong className="project-topbar__workspace-name" title={workspaceLabel}>{workspaceLabel}</strong>
              </div>
              <div className={`project-topbar__status-line project-topbar__status-line--${statusTone}`}>
                <span className="project-topbar__status-dot" aria-hidden="true" />
                <span>{statusText || '工作区已就绪'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="project-topbar__toolbar">
          <TaskIndicator className="project-topbar__task-indicator" />

          <div className="project-topbar__action-cluster">
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
            <Button className="project-topbar__control project-topbar__control--icon" icon={<SearchOutlined />} onClick={onSearch} aria-label="搜索工作区" title="搜索工作区" />
            {onToggleAssistant ? (
              <Button
                className={`project-topbar__control project-topbar__control--icon${assistantToggleActive ? ' is-active' : ''}`}
                icon={<RobotOutlined />}
                onClick={onToggleAssistant}
                aria-label="AI 助手"
                aria-pressed={assistantToggleActive}
                title="AI 助手"
              />
            ) : null}
            {showNextStep && onNextStep ? (
              <Button
                className="project-topbar__control project-topbar__control--accent"
                type="primary"
                icon={<ThunderboltOutlined />}
                onClick={onNextStep}
                aria-label={nextStepLabel || '推荐下一步'}
                title={nextStepLabel || '推荐下一步'}
              >
                {nextStepLabel || '推荐下一步'}
              </Button>
            ) : null}
            <Dropdown menu={overflowMenu} trigger={['click']}>
              <Button className="project-topbar__control project-topbar__control--icon" icon={<EllipsisOutlined />} aria-label="更多操作" title="更多操作" />
            </Dropdown>
          </div>
        </div>
      </div>
    </header>
  )
}
