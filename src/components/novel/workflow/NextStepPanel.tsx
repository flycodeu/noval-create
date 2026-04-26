import React from 'react'
import { Button, Tag } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import type { NextStep } from '../../../shared/workspace-types'

interface NextStepPanelProps {
  nextStep: NextStep
  onOpen: () => void
}

export default function NextStepPanel({ nextStep, onOpen }: NextStepPanelProps) {
  return (
    <section
      style={{
        display: 'grid',
        gap: 12,
        padding: 18,
        borderRadius: 'var(--radius-md)',
        border: '1px solid rgba(166, 106, 43, 0.22)',
        background: 'var(--primary-soft)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            推荐下一步
          </span>
          <strong style={{ fontSize: 18, color: 'var(--text-main)' }}>{nextStep.title}</strong>
        </div>
        <Tag color={nextStep.priority === 'high' ? 'volcano' : nextStep.priority === 'medium' ? 'gold' : 'default'}>
          {nextStep.priority === 'high' ? '高优先' : nextStep.priority === 'medium' ? '中优先' : '低优先'}
        </Tag>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-sub)' }}>{nextStep.reason}</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {nextStep.estimatedMinutes ? `预计 ${nextStep.estimatedMinutes} 分钟` : '预计耗时未记录'}
        </span>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={onOpen}>
          {nextStep.actionLabel}
        </Button>
      </div>
    </section>
  )
}
