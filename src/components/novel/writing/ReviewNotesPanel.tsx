import React, { useMemo, useState } from 'react'
import { Alert, Badge, Button, Collapse, Drawer, Table, Tag } from 'antd'
import {
  buildReviewNotesViewModel,
  type ReviewNotesViewItem,
} from './review-notes-presentation'

interface ReviewNotesPanelProps {
  /** 原始审校 notes 对象（parseReviewNotes 的结果），字段可为任意后端版本。 */
  notes: Record<string, unknown> | null | undefined
}

function ItemLines({ item }: { item: ReviewNotesViewItem }) {
  return (
    <div className="novel-note-list">
      {item.texts.map((text, index) => (
        <div key={`${item.key}-${index}`} className="novel-note-list__item">{text}</div>
      ))}
    </div>
  )
}

/**
 * 审校意见三层信息架构：
 * - critical：默认展开的红色 Alert 列表（必须处理）
 * - advisory：Collapse + 计数徽标（建议处理）
 * - reference：抽屉内表格（仅参考，含未知字段兜底）
 */
export default function ReviewNotesPanel({ notes }: ReviewNotesPanelProps) {
  const model = useMemo(() => buildReviewNotesViewModel(notes), [notes])
  const [referenceOpen, setReferenceOpen] = useState(false)

  const total = model.critical.length + model.advisory.length + model.reference.length
  if (total === 0) {
    return <div className="novel-copy-block">先运行审校流水线，这里会按「必须处理 / 建议处理 / 仅参考」分层展示审校意见。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {model.critical.length > 0 ? (
        <div className="writing-layout-stack writing-layout-stack--sm">
          {model.critical.map((item) => (
            <Alert
              key={item.key}
              type="error"
              showIcon
              message={`必须处理 · ${item.label}`}
              description={<ItemLines item={item} />}
            />
          ))}
        </div>
      ) : (
        <Alert type="success" showIcon message="没有必须处理的审校阻塞项" />
      )}

      {model.advisory.length > 0 ? (
        <Collapse
          size="small"
          items={[
            {
              key: 'advisory',
              label: (
                <span>
                  建议处理
                  <Badge
                    count={model.advisory.reduce((sum, item) => sum + item.texts.length, 0)}
                    style={{ marginLeft: 8 }}
                    color="orange"
                  />
                </span>
              ),
              children: (
                <div className="writing-layout-stack writing-layout-stack--sm">
                  {model.advisory.map((item) => (
                    <div key={item.key}>
                      <Tag color="warning">{item.label}</Tag>
                      <ItemLines item={item} />
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      ) : null}

      {model.reference.length > 0 ? (
        <div>
          <Button type="link" size="small" onClick={() => setReferenceOpen(true)}>
            {`查看全部参考信息（${model.reference.length} 项）`}
          </Button>
          <Drawer
            title="审校参考信息"
            width={520}
            open={referenceOpen}
            onClose={() => setReferenceOpen(false)}
          >
            <Table<ReviewNotesViewItem>
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={model.reference}
              columns={[
                { title: '字段', dataIndex: 'label', width: 160 },
                {
                  title: '内容',
                  dataIndex: 'texts',
                  render: (_: unknown, record: ReviewNotesViewItem) => <ItemLines item={record} />,
                },
              ]}
            />
          </Drawer>
        </div>
      ) : null}
    </div>
  )
}
