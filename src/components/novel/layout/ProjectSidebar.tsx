import React from 'react'
import { ApartmentOutlined, BookOutlined, EditOutlined, HistoryOutlined, SendOutlined } from '@ant-design/icons'
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
const ICONS = [SendOutlined, BookOutlined, ApartmentOutlined, EditOutlined, HistoryOutlined]

export default function ProjectSidebar({ activeKey, pendingKey, onDismissDrawer, onNavigate, onPrefetchRoute }: ProjectSidebarProps) {
  const active = getAuthorWorkspaceKey(activeKey)
  const pending = pendingKey ? getAuthorWorkspaceKey(pendingKey) : null
  return (
    <nav className="author-navigation" aria-label="小说工作区">
      <div className="author-navigation__heading"><span>你的作品</span><small>NovelForge</small></div>
      <div className="author-navigation__pages">
        {AUTHOR_WORKSPACE_PAGES.map((page, index) => {
          const Icon = ICONS[index]
          return <button key={page.key} type="button"
            className={`author-navigation__page${active === page.key ? ' is-active' : ''}${pending === page.key && active !== page.key ? ' is-pending' : ''}`}
            aria-current={active === page.key ? 'page' : undefined}
            onMouseEnter={() => onPrefetchRoute?.(page.route)} onFocus={() => onPrefetchRoute?.(page.route)}
            onClick={() => { onNavigate(page.route); onDismissDrawer?.() }}>
            <Icon /><span><strong>{page.label}</strong><small>{page.description}</small></span>
          </button>
        })}
      </div>
      <div className="author-navigation__note">从一个想法开始。<br />让每一次生成，接得上前文。</div>
    </nav>
  )
}
