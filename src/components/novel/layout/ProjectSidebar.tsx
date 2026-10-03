import React from 'react'
import { ApartmentOutlined, BookOutlined, ClockCircleOutlined, EditOutlined, HistoryOutlined, SendOutlined } from '@ant-design/icons'
import type { WorkspaceNavGroup } from '../../../shared/workspace-types'
import { AUTHOR_WORKSPACE_PAGES, getAuthorWorkspaceKey } from '../../../shared/author-workspace'
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
const ICONS = { guide: SendOutlined, 'story-design': BookOutlined, 'narrative-board': ApartmentOutlined, timeline: ClockCircleOutlined, writing: EditOutlined, revision: HistoryOutlined }

export default function ProjectSidebar({ activeKey, pendingKey, onDismissDrawer, onNavigate, onPrefetchRoute }: ProjectSidebarProps) {
  const active = getAuthorWorkspaceKey(activeKey)
  const pending = pendingKey ? getAuthorWorkspaceKey(pendingKey) : null
  return (
    <nav className="author-navigation" aria-label="小说工作区">
      <div className="author-navigation__pages">
        {AUTHOR_WORKSPACE_PAGES.map((page) => {
          const Icon = ICONS[page.key]
          return <button key={page.key} type="button"
            className={`author-navigation__page${active === page.key ? ' is-active' : ''}${pending === page.key && active !== page.key ? ' is-pending' : ''}`}
            aria-current={active === page.key ? 'page' : undefined}
            onMouseEnter={() => onPrefetchRoute?.(page.route)} onFocus={() => onPrefetchRoute?.(page.route)}
            onClick={() => { onNavigate(page.route); onDismissDrawer?.() }}>
            <Icon /><strong>{page.label}</strong>
          </button>
        })}
      </div>
    </nav>
  )
}
