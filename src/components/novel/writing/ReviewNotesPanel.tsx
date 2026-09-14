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

export default function ReviewNotesPanel({ notes }: ReviewNotesPanelProps) {
  const model = useMemo(() => buildReviewNotesViewModel(notes), [notes])
  const [referenceOpen, setReferenceOpen] = useState(false)
  const criticalFixes = model.critical.filter((item) => item.key === 'critical_fixes')
  const populatedFocusGroups = model.focusGroups.filter((group) => group.items.length > 0)
  const groupedKeys = new Set(model.focusGroups.flatMap((group) => group.items.map((item) => item.key)))
  const supplementalReference = model.reference.filter((item) => !groupedKeys.has(item.key))

  const total = model.critical.length + model.advisory.length + model.reference.length
  if (total === 0) {
    return <div className="novel-copy-block">先运行审校流水线，这里会分别显示事实连续性、人物声音和语言读感。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      {criticalFixes.length > 0 ? (
        <div className="writing-layout-stack writing-layout-stack--sm">
          {criticalFixes.map((item) => (
            <Alert
              key={item.key}
              type="error"
              showIcon
              message={`必须处理 · ${item.label}`}
              description={<ItemLines item={item} />}
            />
          ))}
        </div>
      ) : model.critical.length === 0 ? (
        <Alert type="success" showIcon message="没有必须处理的审校阻塞项" />
      ) : null}

      {populatedFocusGroups.length > 0 ? (
        <Collapse
          size="small"
          defaultActiveKey={populatedFocusGroups.map((group) => group.key)}
          items={populatedFocusGroups.map((group) => ({
              key: group.key,
              label: (
                <span>
                  {group.label}
                  <Badge
                    count={group.items.reduce((sum, item) => sum + item.texts.length, 0)}
                    style={{ marginLeft: 8 }}
                    color={group.key === 'continuity' ? 'red' : group.key === 'voice' ? 'blue' : 'orange'}
                  />
                </span>
              ),
              children: (
                <div className="writing-layout-stack writing-layout-stack--sm">
                  <div className="workspace-text-small workspace-text-muted">{group.description}</div>
                  {group.items.map((item) => (
                    <div key={item.key}>
                      <Tag color={item.severity === 'critical' ? 'error' : item.severity === 'advisory' ? 'warning' : 'default'}>{item.label}</Tag>
                      <ItemLines item={item} />
                    </div>
                  ))}
                </div>
              ),
            }))}
        />
      ) : null}

      {supplementalReference.length > 0 ? (
        <div>
          <Button type="link" size="small" onClick={() => setReferenceOpen(true)}>
            {`查看其他参考信息（${supplementalReference.length} 项）`}
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
              dataSource={supplementalReference}
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
