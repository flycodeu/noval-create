import React, { useMemo, useState } from 'react'
import { CaretDownFilled, CaretRightFilled, ClockCircleOutlined } from '@ant-design/icons'
import type { WorkspaceNavGroup } from '../../../shared/workspace-types'
import StatusTag from '../common/StatusTag'
import './ProjectSidebar.css'

interface ProjectSidebarProps {
  stageLabel: string
  progressText: string
  currentTask: string
  navGroups: WorkspaceNavGroup[]
  activeKey: string
  pendingKey?: string | null
  recentKey?: string | null
  onDismissDrawer?: () => void
  onNavigate: (route: string) => void
  onPrefetchRoute?: (route: string) => void
}

export default function ProjectSidebar({
  stageLabel,
  progressText,
  currentTask,
  navGroups,
  activeKey,
  pendingKey,
  recentKey,
  onDismissDrawer,
  onNavigate,
  onPrefetchRoute,
}: ProjectSidebarProps) {
  const activeGroup = useMemo(
    () => navGroups.find((group) => group.items.some((item) => item.key === activeKey))?.key || navGroups[0]?.key,
    [activeKey, navGroups],
  )
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  const handleNavigate = (route: string) => {
    onNavigate(route)
    onDismissDrawer?.()
  }

  return (
    <div className="project-sidebar">
      <div className="project-sidebar__summary">
        <div className="project-sidebar__summary-copy">
          <strong className="project-sidebar__summary-title">{stageLabel}</strong>
          <span className="project-sidebar__summary-meta">{`已完成 ${progressText}`}</span>
          <div className="project-sidebar__current-task">
            <ClockCircleOutlined />
            <span>{currentTask}</span>
          </div>
        </div>
      </div>

      <div className="project-sidebar__groups">
        {navGroups.map((group, groupIndex) => {
          const isOpen = openGroups[group.key] ?? group.key === activeGroup
          const canCollapse = group.items.length > 0

          return (
            <section key={group.key} className="project-sidebar__group">
              <button
                type="button"
                onClick={() => canCollapse && setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                className={`project-sidebar__group-toggle${canCollapse ? '' : ' is-static'}`}
              >
                <div className="project-sidebar__group-toggle-main">
                  <span className="project-sidebar__group-toggle-icon">
                    {canCollapse ? (isOpen ? <CaretDownFilled /> : <CaretRightFilled />) : <ClockCircleOutlined />}
                  </span>
                  <span className="project-sidebar__group-index">{String(groupIndex + 1).padStart(2, '0')}</span>
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
                    const pending = !active && item.key === pendingKey
                    const recent = !active && item.key === recentKey
                    const attention = item.hasBlocker
                    const metaText = recent ? '最近访问' : item.meta?.trim()

                    return (
                      <button
                        key={item.key}
                        type="button"
                        onMouseEnter={() => !active && onPrefetchRoute?.(item.route)}
                        onFocus={() => !active && onPrefetchRoute?.(item.route)}
                        onPointerDown={() => !active && onPrefetchRoute?.(item.route)}
                        onClick={() => handleNavigate(item.route)}
                        aria-current={active ? 'page' : undefined}
                        className={`project-sidebar__group-item${active ? ' is-active' : ''}${pending ? ' is-pending' : ''}${recent ? ' is-recent' : ''}${attention ? ' has-attention' : ''}`}
                        title={item.label}
                      >
                        <span className="project-sidebar__group-item-bar" aria-hidden="true" />
                        <div className="project-sidebar__group-item-head">
                          <span className="project-sidebar__group-item-copy">
                            <span className="project-sidebar__group-item-label">{item.label}</span>
                            {metaText ? <span className="project-sidebar__group-item-meta">{metaText}</span> : null}
                          </span>
                          <StatusTag status={item.status} size="small" />
                        </div>
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
