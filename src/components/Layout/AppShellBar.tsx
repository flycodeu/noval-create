import React, { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { WORKSPACE_MODULE_DEFINITIONS } from '../../shared/novel-workspace'
import { isElectronRuntime } from '../../runtime/environment'
import WindowControls from './WindowControls'
import './AppLayout.css'

const SECTION_LABELS = [
  { key: '/novels', label: '我的小说' },
  { key: '/models', label: '模型管理' },
  { key: '/templates', label: '风格模板' },
  { key: '/prompts', label: '提示词' },
  { key: '/tasks', label: '任务中心' },
]

export default function AppShellBar() {
  const location = useLocation()
  const showWindowControls = isElectronRuntime()

  const { title } = useMemo(() => {
    if (location.pathname.startsWith('/novels/')) {
      const segments = location.pathname.split('/')
      const workspaceKey = segments[3]
      const workspace = WORKSPACE_MODULE_DEFINITIONS.find((item) => item.key === workspaceKey)
      return {
        title: workspace?.label || '小说工作区',
      }
    }

    const section = SECTION_LABELS.find((item) => location.pathname.startsWith(item.key))
    return {
      title: section?.label || '小说工作台',
    }
  }, [location.pathname])

  return (
    <header className={`app-shell-bar${showWindowControls ? '' : ' app-shell-bar--windowless'}`}>
      {showWindowControls ? <div className="app-shell-bar__drag-region" aria-hidden="true" /> : null}
      <div className="app-shell-bar__content">
        <div className="app-shell-bar__meta">
          <strong className="app-shell-bar__title">{title}</strong>
        </div>
        {showWindowControls ? (
          <WindowControls
            className="app-shell-bar__window-controls"
            buttonClassName="app-shell-bar__window-button"
            dangerButtonClassName="app-shell-bar__window-button--danger"
          />
        ) : null}
      </div>
    </header>
  )
}
