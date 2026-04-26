import React from 'react'
import { type ModuleStatus, MODULE_STATUS_CONFIG } from '../../../shared/workspace-types'

interface StatusTagProps {
  status: ModuleStatus
  size?: 'small' | 'default'
}

const baseStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontWeight: 600,
  borderRadius: 6,
  lineHeight: 1,
  whiteSpace: 'nowrap',
}

export default function StatusTag({ status, size = 'default' }: StatusTagProps) {
  const config = MODULE_STATUS_CONFIG[status]
  const isSmall = size === 'small'

  return (
    <span
      style={{
        ...baseStyle,
        padding: isSmall ? '2px 6px' : '3px 8px',
        fontSize: isSmall ? 10 : 11,
        color: config.color,
        background: `${config.color}14`,
        border: `1px solid ${config.color}28`,
      }}
    >
      <span
        style={{
          width: isSmall ? 5 : 6,
          height: isSmall ? 5 : 6,
          borderRadius: '50%',
          background: config.dotColor,
          flexShrink: 0,
        }}
      />
      {config.label}
    </span>
  )
}
