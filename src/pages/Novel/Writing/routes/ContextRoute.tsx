import React from 'react'
import { CharacterStateMemoryCard, InsightCard, StringList } from '../components/InsightPanel'
import type { MemoryInspectorViewModel } from '../writing-inspector-view-model'

interface Props {
  model: MemoryInspectorViewModel
  title?: string
}

export default function ContextRoute({ model, title = '上下文视图' }: Props) {
  return (
    <section className="writing-route-view writing-route-view--context" data-route="context">
      <header className="writing-route-view__header">
        <strong>{title}</strong>
      </header>
      <div className="writing-route-view__body">
        <div className="novel-writing-shell__insight-stack">
          <InsightCard title="阶段摘要" eyebrow={model.coverageSummary} tone="soft">
            <StringList items={model.phaseDigest} empty="章节量还不大，阶段摘要会在长篇推进后逐步显现。" />
          </InsightCard>
          <InsightCard title="剧情里程碑" eyebrow="压缩摘要">
            <StringList items={model.plotMilestones} empty="长篇记忆还没刷新到可复盘里程碑。" />
          </InsightCard>
          <InsightCard title="人物与世界状态" eyebrow="统一总账" tone="soft">
            <CharacterStateMemoryCard storyMemory={model.storyMemory} />
          </InsightCard>
          <InsightCard title="活跃线程" eyebrow="待持续追踪" tone="soft">
            <StringList items={model.activeThreads} empty="当前章没有命中持续追踪线程，适合回查线程挂载是否缺失。" />
          </InsightCard>
          <InsightCard title="时间锚点" eyebrow="时序参照" tone="soft">
            <StringList items={model.timelineAnchors} empty="时间轴锚点会在这里同步展示。" />
          </InsightCard>
          <InsightCard title="道具账本" eyebrow="状态同步" tone="soft">
            <StringList items={model.itemLedger} empty="关键道具与线索的状态变化会记录在这里。" />
          </InsightCard>
        </div>
      </div>
    </section>
  )
}
