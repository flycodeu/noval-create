import React, { useEffect, useMemo, useState } from 'react'
import { Button, Select, Tag, Tooltip } from 'antd'
import { CompassOutlined, SettingOutlined } from '@ant-design/icons'
import type { CreativeStage } from '../../types'
import { formatCreativeStageRange } from '../../shared/creative-stages'
import { buildWorkspaceRoute } from '../../shared/novel-workspace'
import './CreativeStageScope.css'

interface Props {
  novelId: number
  value?: number | null
  onChange: (stageId: number | null) => void
}

export default function CreativeStageScope({ novelId, value, onChange }: Props) {
  const [stages, setStages] = useState<CreativeStage[]>([])
  const selected = useMemo(() => stages.find((stage) => stage.id === value) || null, [stages, value])

  useEffect(() => {
    let disposed = false
    void window.electron.creativeStage.list(novelId).then((nextStages) => {
      if (!disposed) setStages(nextStages)
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [novelId])

  return (
    <div className="creative-stage-scope">
      <div className="creative-stage-scope__label"><CompassOutlined /><span>当前生成窗口</span></div>
      <Select
        allowClear
        value={value || undefined}
        placeholder="全项目范围（未绑定阶段）"
        options={stages.map((stage) => ({
          value: stage.id,
          label: `${stage.name} · ${formatCreativeStageRange(stage)}`,
        }))}
        onChange={(nextValue) => onChange(nextValue || null)}
        className="creative-stage-scope__select"
      />
      {selected ? <Tag color={selected.status === 'active' ? 'processing' : 'default'}>{selected.activeAssetCount} 个活跃资产</Tag> : null}
      <Tooltip title="建立或调整阶段窗口">
        <Button
          type="text"
          icon={<SettingOutlined />}
          aria-label="打开阶段计划"
          onClick={() => { window.location.hash = buildWorkspaceRoute(novelId, 'stage-planner') }}
        />
      </Tooltip>
    </div>
  )
}
