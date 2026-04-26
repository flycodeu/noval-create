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
import './ProjectTopbar.css'

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
    <div className="project-topbar">
      <div className="project-topbar__main">
        <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
          返回项目列表
        </Button>
        <strong className="project-topbar__title">{pageTitle}</strong>
      </div>

      <div className="project-topbar__actions">
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
