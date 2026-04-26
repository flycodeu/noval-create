import React from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeftOutlined,
  BarChartOutlined,
  EllipsisOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'

interface ProjectTopbarProps {
  pageTitle: string
  onBack: () => void
  onSearch: () => void
  onQuality?: () => void
  onNextStep?: () => void
  nextStepLabel?: string
  showQuality?: boolean
  showNextStep?: boolean
  moreMenu: MenuProps
}

export default function ProjectTopbar({
  pageTitle,
  onBack,
  onSearch,
  onQuality,
  onNextStep,
  nextStepLabel,
  showQuality = true,
  showNextStep = true,
  moreMenu,
}: ProjectTopbarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        minHeight: 60,
        padding: '10px 20px',
        borderBottom: '1px solid var(--border-light)',
        background: 'rgba(255, 255, 255, 0.96)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回项目列表
        </Button>
        <strong
          style={{
            fontSize: 18,
            lineHeight: 1.2,
            color: 'var(--text-main)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {pageTitle}
        </strong>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <Button icon={<SearchOutlined />} onClick={onSearch}>
          全局搜索
        </Button>
        {showQuality && onQuality ? (
          <Button icon={<BarChartOutlined />} onClick={onQuality}>
            AI质量
          </Button>
        ) : null}
        {showNextStep && onNextStep ? (
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={onNextStep}>
            {nextStepLabel || '推荐下一步'}
          </Button>
        ) : null}
        <Dropdown menu={moreMenu} trigger={['click']}>
          <Button icon={<EllipsisOutlined />}>更多</Button>
        </Dropdown>
      </div>
    </div>
  )
}
