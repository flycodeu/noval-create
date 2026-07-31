import React from 'react'
import './cards.css'

interface MetricCardProps {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'warm' | 'success' | 'danger'
}

export default function MetricCard({
  label,
  value,
  tone = 'default',
}: MetricCardProps) {
  return (
    <div className={`novel-metric-card novel-metric-card--${tone}`}>
      <span className="novel-metric-card__label">{label}</span>
      <strong className="novel-metric-card__value">{value}</strong>
    </div>
  )
}
