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

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

const STATUS_META: Record<Novel['status'], { label: string; color: string; background: string }> = {
  draft: { label: '草稿', color: '#6B7280', background: 'rgba(107, 114, 128, 0.1)' },
  writing: { label: '写作中', color: '#2563EB', background: 'rgba(37, 99, 235, 0.1)' },
  completed: { label: '已完成', color: '#2F855A', background: 'rgba(47, 133, 90, 0.1)' },
  archived: { label: '已归档', color: '#9CA3AF', background: 'rgba(156, 163, 175, 0.12)' },
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
}

export default function ProjectCard({
  novel,
  snapshot,
  onOpen,
  onDelete,
  onExport,
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
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: onDelete },
  ]

  return (
    <article
      style={{
        display: 'grid',
        gap: 14,
        minHeight: 0,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-light)',
        background: '#fff',
        cursor: 'pointer',
      }}
      onClick={onOpen}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0, display: 'grid', gap: 8 }}>
          <strong
            style={{
              fontSize: 16,
              lineHeight: 1.35,
              color: 'var(--text-main)',
              wordBreak: 'break-word',
            }}
          >
            {novel.title}
          </strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Tag style={{ margin: 0, color: status.color, background: status.background, borderColor: `${status.color}22` }}>
              {status.label}
            </Tag>
            <Tag style={{ margin: 0 }}>{novel.genreName || '未分类'}</Tag>
            <Tag style={{ margin: 0 }}>{novel.launchMode === 'fast_launch' ? '快速模式' : '专业模式'}</Tag>
            {snapshot.blockers.length > 0 ? (
              <Tag color="volcano" style={{ margin: 0 }}>{`${snapshot.blockers.length} 个 blocker`}</Tag>
            ) : null}
          </div>
        </div>
        <div onClick={(event) => event.stopPropagation()}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button size="small" icon={<MoreOutlined />} />
          </Dropdown>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 10,
          fontSize: 12,
          color: 'var(--text-sub)',
        }}
      >
        <div>当前阶段：<strong style={{ color: 'var(--text-main)' }}>{snapshot.stage.label}</strong></div>
        <div>主任务：<strong style={{ color: 'var(--text-main)' }}>{snapshot.nextStep.title}</strong></div>
        <div>字数：<strong style={{ color: 'var(--text-main)' }}>{formatWordCount(novel.totalWords)}</strong></div>
        <div>目标：<strong style={{ color: 'var(--text-main)' }}>{targetWords > 0 ? formatWordCount(targetWords) : '未设置'}</strong></div>
        <div>模块完成：<strong style={{ color: 'var(--text-main)' }}>{`${snapshot.moduleDoneCount}/${snapshot.moduleTotalCount}`}</strong></div>
        <div>最近修改：<strong style={{ color: 'var(--text-main)' }}>{dayjs(novel.updatedAt).fromNow()}</strong></div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>总进度</span>
          <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{`${progress}%`}</span>
        </div>
        <Progress percent={progress} showInfo={false} strokeColor="var(--primary)" trailColor="rgba(166, 106, 43, 0.08)" size="small" />
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: 12,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-soft)',
          border: '1px solid rgba(166, 106, 43, 0.14)',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>推荐下一步</span>
        <strong style={{ fontSize: 14, color: 'var(--text-main)' }}>{snapshot.nextStep.title}</strong>
        <span style={{ fontSize: 12, lineHeight: 1.7, color: 'var(--text-sub)' }}>{snapshot.nextStep.reason}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
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
