import React from 'react'

interface MetricCardProps {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'warm' | 'success' | 'danger'
}

const toneMap: Record<NonNullable<MetricCardProps['tone']>, { border: string; background: string; value: string }> = {
  default: {
    border: 'var(--border-light)',
    background: 'var(--bg-panel)',
    value: 'var(--text-main)',
  },
  warm: {
    border: 'rgba(166, 106, 43, 0.22)',
    background: 'var(--primary-soft)',
    value: 'var(--primary)',
  },
  success: {
    border: 'rgba(47, 133, 90, 0.2)',
    background: 'rgba(47, 133, 90, 0.08)',
    value: 'var(--success)',
  },
  danger: {
    border: 'rgba(194, 65, 12, 0.22)',
    background: 'rgba(194, 65, 12, 0.08)',
    value: 'var(--danger)',
  },
}

export default function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: MetricCardProps) {
  const colors = toneMap[tone]

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        minWidth: 0,
        padding: '16px 18px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${colors.border}`,
        background: colors.background,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sub)' }}>{label}</span>
      <strong style={{ fontSize: 24, lineHeight: 1.1, color: colors.value }}>{value}</strong>
      {hint ? (
        <span style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-muted)' }}>{hint}</span>
      ) : null}
    </div>
  )
}
