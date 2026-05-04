import React from 'react'

interface ActionBarProps {
  children: React.ReactNode
  align?: 'start' | 'end' | 'between'
}

export default function ActionBar({
  children,
  align = 'end',
}: ActionBarProps) {
  const alignClass = align === 'between'
    ? 'novel-action-bar--between'
    : align === 'start'
      ? 'novel-action-bar--start'
      : 'novel-action-bar--end'

  return (
    <div
      className={`novel-action-bar ${alignClass}`}
    >
      {children}
    </div>
  )
}
