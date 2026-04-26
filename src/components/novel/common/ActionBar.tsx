import React from 'react'

interface ActionBarProps {
  children: React.ReactNode
  align?: 'start' | 'end' | 'between'
}

export default function ActionBar({
  children,
  align = 'end',
}: ActionBarProps) {
  const justifyContent = align === 'between'
    ? 'space-between'
    : align === 'start'
      ? 'flex-start'
      : 'flex-end'

  return (
    <div
      className="novel-action-bar"
      style={{ justifyContent }}
    >
      {children}
    </div>
  )
}
