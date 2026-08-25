import { Button } from 'antd'
import type { PipelineBarItem } from '../../../../components/novel/writing/PipelineBar'

interface Props {
  items: PipelineBarItem[]
}

const STATUS_LABELS: Record<PipelineBarItem['status'], string> = {
  pending: '待执行',
  running: '运行中',
  success: '完成',
  failed: '失败',
  blocked: '阻塞',
}

export default function WritingPipelineStrip({ items }: Props) {
  return (
    <section className="writing-pipeline-strip" aria-label="章节流水线" data-writing-pipeline="compact">
      <strong className="writing-pipeline-strip__label">流程</strong>
      <div className="writing-pipeline-strip__stages">
        {items.map((item) => (
          <div
            key={item.key}
            className={`writing-pipeline-strip__stage is-${item.status}`}
            title={[item.detail, item.error].filter(Boolean).join('；') || STATUS_LABELS[item.status]}
          >
            <span className="writing-pipeline-strip__dot" />
            <span>{item.label}</span>
            <small>{STATUS_LABELS[item.status]}</small>
            {item.canRetry && item.onRetry ? <Button type="link" size="small" onClick={item.onRetry}>重试</Button> : null}
          </div>
        ))}
      </div>
    </section>
  )
}
