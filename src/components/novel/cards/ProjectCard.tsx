import React from 'react'
import { Button, Dropdown, Progress, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  DeleteOutlined,
  ExportOutlined,
  MoreOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import type { Novel } from '../../../types'
import type { WorkspaceSnapshot } from '../../../shared/novel-workspace'
import './cards.css'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const STATUS_META: Record<Novel['status'], { label: string }> = {
  draft: { label: '草稿' },
  writing: { label: '写作中' },
  completed: { label: '已完成' },
  archived: { label: '已归档' },
}

function formatWordCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return `${value.toLocaleString()} 字`
}

interface ProjectCardProps {
  novel: Novel
  snapshot: WorkspaceSnapshot
  onOpen: () => void
  onDelete: () => void
  onExport: (format: string) => void
  onStatusChange: (status: Novel['status']) => void
}

export default function ProjectCard({
  novel,
  snapshot,
  onOpen,
  onDelete,
  onExport,
  onStatusChange,
}: ProjectCardProps) {
  const status = STATUS_META[novel.status]
  const targetWords = typeof novel.targetWords === 'number' ? novel.targetWords : 0
  const progress = targetWords > 0
    ? Math.min(100, Math.round((novel.totalWords / targetWords) * 100))
    : 0
  const menuItems: MenuProps['items'] = [
    { key: 'export-txt', icon: <ExportOutlined />, label: '导出 TXT', onClick: () => onExport('txt') },
    { key: 'export-md', icon: <ExportOutlined />, label: '导出 Markdown', onClick: () => onExport('md') },
    { key: 'export-docx', icon: <ExportOutlined />, label: '导出 DOCX', onClick: () => onExport('docx') },
    { key: 'export-epub', icon: <ExportOutlined />, label: '导出 EPUB', onClick: () => onExport('epub') },
    { type: 'divider' },
    ...(['draft', 'writing', 'completed', 'archived'] as Novel['status'][])
      .filter((nextStatus) => nextStatus !== novel.status)
      .map((nextStatus) => ({
        key: `status-${nextStatus}`,
        label: `标记为${STATUS_META[nextStatus].label}`,
        onClick: () => onStatusChange(nextStatus),
      })),
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: onDelete },
  ]

  return (
    <article className="novel-project-card" onClick={onOpen}>
      <div className="novel-project-card__head">
        <div className="novel-project-card__title-block">
          <strong className="novel-project-card__title">{novel.title}</strong>
          <div className="novel-project-card__tag-row">
            <Tag
              title={novel.lifecycle?.reason || undefined}
              className={`novel-project-card__status-tag novel-project-card__status-tag--${novel.status}`}
            >
              {status.label}
            </Tag>
            <Tag className="novel-project-card__tag">{novel.genreName || '未分类'}</Tag>
            {snapshot.blockers.length > 0 ? (
              <Tag color="volcano" className="novel-project-card__tag">{`${snapshot.blockers.length} 个阻塞项`}</Tag>
            ) : null}
          </div>
        </div>
        <div className="novel-project-card__menu" onClick={(event) => event.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button size="small" icon={<MoreOutlined />} aria-label="更多操作" title="更多操作" />
          </Dropdown>
        </div>
      </div>

      <div className="novel-project-card__summary">
        <div>阶段 <strong>{snapshot.stage.label}</strong></div>
        <div>字数 <strong>{targetWords > 0 ? `${formatWordCount(novel.totalWords)} / ${formatWordCount(targetWords)}` : formatWordCount(novel.totalWords)}</strong></div>
        <div>模块 <strong>{`${snapshot.moduleDoneCount}/${snapshot.moduleTotalCount}`}</strong></div>
        <div>更新 <strong>{dayjs(novel.updatedAt).fromNow()}</strong></div>
      </div>

      <div className="novel-project-card__progress">
        <div className="novel-project-card__progress-meta">
          <span className="novel-project-card__progress-label">总进度</span>
          <span className="novel-project-card__progress-value">{`${progress}%`}</span>
        </div>
        <Progress percent={progress} showInfo={false} strokeColor="var(--accent)" trailColor="rgba(166, 106, 43, 0.08)" size="small" />
      </div>

      <div className="novel-project-card__next-step">
        <span className="novel-project-card__next-step-label">下一步</span>
        <strong className="novel-project-card__next-step-title">{snapshot.nextStep.title}</strong>
        <span className="novel-project-card__next-step-copy">{snapshot.nextStep.reason}</span>
      </div>

      <div className="novel-project-card__actions">
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          继续创作
        </Button>
      </div>
    </article>
  )
}
