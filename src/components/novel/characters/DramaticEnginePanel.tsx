import React from 'react'
import { Collapse } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'

interface DramaticEnginePanelProps {
  /** 戏剧引擎文本：欲望/恐惧/矛盾如何驱动剧情的一段文字。 */
  text?: string | null
  /** 折叠面板默认是否展开，默认展开。 */
  defaultOpen?: boolean
}

const EMPTY_GUIDE = '这个角色还没有戏剧引擎。生成人物时会自动产出；老角色可通过「AI 修复·重做人物」重新生成档案补齐。'

/**
 * 折叠卡片展示人物的「戏剧引擎」——贯穿全书、解释角色每场戏选择的驱动力。
 * DB 列 dramatic_engine 一直存在但此前未在前端展示。
 */
export default function DramaticEnginePanel({ text, defaultOpen = true }: DramaticEnginePanelProps) {
  const trimmed = typeof text === 'string' ? text.trim() : ''

  return (
    <Collapse
      size="small"
      defaultActiveKey={defaultOpen ? ['dramatic-engine'] : []}
      items={[
        {
          key: 'dramatic-engine',
          label: (
            <span>
              <ThunderboltOutlined style={{ marginRight: 6 }} />
              戏剧引擎
              <span style={{ marginLeft: 8, opacity: 0.65, fontSize: 12 }}>欲望 / 恐惧 / 矛盾如何驱动剧情</span>
            </span>
          ),
          children: trimmed ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{trimmed}</div>
          ) : (
            <div style={{ opacity: 0.65 }}>{EMPTY_GUIDE}</div>
          ),
        },
      ]}
    />
  )
}
