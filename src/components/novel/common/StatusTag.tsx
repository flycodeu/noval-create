import React from 'react'
import { type ModuleStatus, MODULE_STATUS_CONFIG } from '../../../shared/workspace-types'
import './StatusTag.css'

interface StatusTagProps {
  status: ModuleStatus
  size?: 'small' | 'default'
}

export default function StatusTag({ status, size = 'default' }: StatusTagProps) {
  const config = MODULE_STATUS_CONFIG[status]
  const isSmall = size === 'small'
  const cssVars = {
    '--status-tag-color': config.color,
    '--status-tag-dot-color': config.dotColor,
  } as React.CSSProperties

  return (
    <span
      className={`status-tag status-tag--${status}${isSmall ? ' status-tag--small' : ''}`}
      style={cssVars}
    >
      <span className="status-tag__dot" />
      {config.label}
    </span>
  )
}
