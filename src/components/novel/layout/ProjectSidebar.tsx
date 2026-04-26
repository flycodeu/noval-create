import React, { useEffect, useMemo, useState } from 'react'
import { CaretDownFilled, CaretRightFilled, ThunderboltOutlined } from '@ant-design/icons'
import type { WorkspaceNavGroup } from '../../../shared/workspace-types'
import { type WorkspaceViewMode, getWorkspaceModeOptions } from '../../../shared/novel-workspace'
import StatusTag from '../common/StatusTag'
import './ProjectSidebar.css'

interface ProjectSidebarProps {
  title: string
  stageLabel: string
  progressText: string
  currentTask: string
  navGroups: WorkspaceNavGroup[]
  activeKey: string
  mode: WorkspaceViewMode
  onModeChange: (mode: WorkspaceViewMode) => void
  onNavigate: (route: string) => void
}

export default function ProjectSidebar({
  title,
  stageLabel,
  progressText,
  currentTask,
  navGroups,
  activeKey,
  mode,
  onModeChange,
  onNavigate,
}: ProjectSidebarProps) {
  const modeOptions = getWorkspaceModeOptions()
  const activeGroup = useMemo(
    () => navGroups.find((group) => group.items.some((item) => item.key === activeKey))?.key || navGroups[0]?.key,
    [activeKey, navGroups],
  )
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!activeGroup) return
    setOpenGroups((current) => ({ ...current, [activeGroup]: true }))
  }, [activeGroup])

  return (
    <div className="project-sidebar">
      <div className="project-sidebar__card project-sidebar__header">
        <div className="project-sidebar__title-block">
          <strong className="project-sidebar__title">{title}</strong>
          <span className="project-sidebar__meta">{`当前阶段：${stageLabel}`}</span>
          <span className="project-sidebar__meta project-sidebar__meta--muted">{`模块完成：${progressText}`}</span>
        </div>
        <div className="project-sidebar__task">
          <span className="project-sidebar__task-label">当前主任务</span>
          <strong className="project-sidebar__task-value">{currentTask}</strong>
        </div>
      </div>

      <div className="project-sidebar__card project-sidebar__mode">
        <div className="project-sidebar__section-label">工作模式</div>
        <div className="project-sidebar__mode-list">
          {modeOptions.map((option) => {
            const active = mode === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onModeChange(option.value)}
                className={`project-sidebar__mode-button${active ? ' is-active' : ''}`}
              >
                <strong className="project-sidebar__mode-button-label">{option.label}</strong>
                <span className="project-sidebar__mode-button-copy">{option.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="project-sidebar__groups">
        {navGroups.map((group) => {
          const isOpen = openGroups[group.key] ?? group.key === activeGroup
          const canCollapse = group.items.length > 0

          return (
            <section key={group.key} className="project-sidebar__card project-sidebar__group">
              <button
                type="button"
                onClick={() => canCollapse && setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                className={`project-sidebar__group-toggle${canCollapse ? '' : ' is-static'}`}
              >
                <div className="project-sidebar__group-toggle-main">
                  <span className="project-sidebar__group-toggle-icon">
                    {canCollapse ? (isOpen ? <CaretDownFilled /> : <CaretRightFilled />) : <ThunderboltOutlined />}
                  </span>
                  <strong className="project-sidebar__group-title">{group.title}</strong>
                </div>
                {group.progress ? (
                  <span className="project-sidebar__group-progress">{`${group.progress.done}/${group.progress.total}`}</span>
                ) : null}
              </button>

              {isOpen ? (
                <div className="project-sidebar__group-items">
                  {group.items.map((item) => {
                    const active = item.key === activeKey

                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => onNavigate(item.route)}
                        className={`project-sidebar__group-item${active ? ' is-active' : ''}`}
                      >
                        <div className="project-sidebar__group-item-head">
                          <span className="project-sidebar__group-item-label">{item.label}</span>
                          <StatusTag status={item.status} size="small" />
                        </div>
                        {item.meta ? (
                          <span className={`project-sidebar__group-item-meta${item.hasBlocker ? ' is-danger' : ''}`}>
                            {item.meta}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
