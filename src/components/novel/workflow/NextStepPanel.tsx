import React from 'react'
import { Button, Tag } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import type { NextStep } from '../../../shared/workspace-types'
import './workflow-panels.css'

interface NextStepPanelProps {
  nextStep: NextStep
  onOpen: () => void
}

export default function NextStepPanel({ nextStep, onOpen }: NextStepPanelProps) {
  return (
    <section className="workflow-panel workflow-panel--next-step">
      <div className="workflow-panel__header">
        <div className="workflow-panel__header-copy">
          <span className="workflow-panel__eyebrow workflow-panel__eyebrow--accent">
            推荐下一步
          </span>
          <strong className="workflow-panel__title">{nextStep.title}</strong>
        </div>
        <Tag color={nextStep.priority === 'high' ? 'volcano' : nextStep.priority === 'medium' ? 'gold' : 'default'}>
          {nextStep.priority === 'high' ? '高优先' : nextStep.priority === 'medium' ? '中优先' : '低优先'}
        </Tag>
      </div>

      <div className="workflow-panel__body-copy">{nextStep.reason}</div>

      <div className="workflow-panel__footer">
        <span className="workflow-panel__meta">
          {nextStep.estimatedMinutes ? `预计 ${nextStep.estimatedMinutes} 分钟` : '预计耗时未记录'}
        </span>
        <Button type="primary" icon={<ThunderboltOutlined />} onClick={onOpen}>
          {nextStep.actionLabel}
        </Button>
      </div>
    </section>
  )
}
