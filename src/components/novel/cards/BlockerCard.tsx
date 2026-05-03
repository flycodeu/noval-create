import React from 'react'
import { Button, Tag } from 'antd'
import { BLOCKER_LEVEL_CONFIG, type ProjectBlocker } from '../../../shared/workspace-types'
import './cards.css'

interface BlockerCardProps {
  blocker: ProjectBlocker
  onOpen?: (blocker: ProjectBlocker) => void
  onIgnore?: (blocker: ProjectBlocker) => void
}

export default function BlockerCard({ blocker, onOpen, onIgnore }: BlockerCardProps) {
  const level = BLOCKER_LEVEL_CONFIG[blocker.level]

  return (
    <article className={`novel-blocker-card novel-blocker-card--${blocker.level}`}>
      <div className="novel-blocker-card__head">
        <Tag color={blocker.level === 'fatal' ? 'error' : blocker.level === 'high' ? 'volcano' : blocker.level === 'medium' ? 'gold' : 'default'}>
          {level.label}
        </Tag>
        <strong className="novel-blocker-card__title">{blocker.title}</strong>
      </div>

      <div className="novel-blocker-card__body">
        <span className="novel-blocker-card__reason">{blocker.reason}</span>
        <span className="novel-blocker-card__meta">影响范围：{blocker.affectedModules.join('、')}</span>
      </div>

      <div className="novel-blocker-card__actions">
        <Button size="small" type="primary" onClick={() => onOpen?.(blocker)}>
          {blocker.suggestedAction.label}
        </Button>
        {blocker.canIgnoreOnce ? (
          <Button size="small" onClick={() => onIgnore?.(blocker)}>
            暂时忽略
          </Button>
        ) : null}
        {blocker.suggestedAction.actionType !== 'open_page' ? (
          <Tag className="novel-blocker-card__hint-tag">
            {blocker.suggestedAction.actionType === 'auto_fix' ? '支持 AI 自动修复' : '支持 AI 生成草稿'}
          </Tag>
        ) : null}
      </div>
    </article>
  )
}
