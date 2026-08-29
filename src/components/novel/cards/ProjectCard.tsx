import React from 'react'
import { Button, Dropdown, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  DeleteOutlined,
  ExportOutlined,
  MoreOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { Novel } from '../../../types'
import type { WorkspaceSnapshot } from '../../../shared/novel-workspace'
import './cards.css'

const STATUS_META: Record<Novel['status'], { label: string }> = {
  draft: { label: '草稿' },
  writing: { label: '写作中' },
  completed: { label: '已完成' },
  archived: { label: '已归档' },
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
          </div>
        </div>
        <div className="novel-project-card__menu" onClick={(event) => event.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button size="small" icon={<MoreOutlined />} aria-label="更多操作" title="更多操作" />
          </Dropdown>
        </div>
      </div>

      <div className="novel-project-card__next-step">
        <span className="novel-project-card__next-step-label">下一步</span>
        <Tag
          color="gold"
          className="novel-project-card__next-step-tag"
          title={snapshot.nextStep.reason}
        >
          {snapshot.nextStep.title}
        </Tag>
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
