import { Select } from 'antd'
import type { ChapterContextPreview, HardConstraintSourceLabel } from '../../../../../types'
import { InsightCard, StringList } from './InsightCard'
import {
  HARD_CONSTRAINT_PRESERVE_OPTIONS,
  assetImpactTargetLabel,
  chapterContextStageLabel,
  fallbackReasonLabel,
  recallBucketLabel,
  writerFallbackModeLabel,
  writerToolStatusLabel,
} from './insight-utils'

export function ConstraintInjectionCard({
  preview,
  preserveConstraintLabels,
  onPreserveConstraintChange,
}: {
  preview: ChapterContextPreview | null
  preserveConstraintLabels: HardConstraintSourceLabel[]
  onPreserveConstraintChange: (labels: HardConstraintSourceLabel[]) => void
}) {
  if (!preview || preview.stages.length === 0) {
    return <div className="novel-copy-block">先切到具体章节并生成上下文预览，再核对四个阶段的约束注入状态。</div>
  }

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="writing-layout-stack writing-layout-stack--sm">
        <div className="novel-copy-block">手动保留后，预览与正式生成都会优先保障这些硬约束不先被踢出。</div>
        <Select
          mode="multiple"
          allowClear
          className="workspace-max-400"
          value={preserveConstraintLabels}
          options={HARD_CONSTRAINT_PRESERVE_OPTIONS}
          placeholder="手动保留关键约束"
          onChange={(values) => onPreserveConstraintChange(values as HardConstraintSourceLabel[])}
        />
      </div>
      {preview.stages.map((stage) => {
        const injectedTitles = stage.hardConstraintEntries.map((entry) => entry.title)
        const truncatedTitles = stage.hardConstraintEntries.filter((entry) => entry.truncated).map((entry) => entry.title)
        const hasDrop = stage.droppedConstraintCount > 0
        const report = stage.contextBudgetReport
        const droppedByPriority = report.droppedByPriority
          .filter((entry) => entry.count > 0)
          .map((entry) => `P${entry.priority} ${entry.count}项`)
          .join('，')
        const decisionLines = stage.softContextDecisions
          .filter((entry) => entry.status !== 'kept' || entry.reason === 'covered_by_hard_constraint')
          .map((entry) => {
            if (entry.reason === 'covered_by_hard_constraint') {
              return `${entry.title}：走硬约束通道${entry.status === 'truncated' ? `，已压缩到 ${entry.allocatedTokens}/${entry.originalTokens}` : '，未占用软预算'}`
            }
            return `${entry.title}：${entry.status === 'dropped'
              ? `被踢出（${entry.originalTokens}）`
              : `被压缩 ${entry.originalTokens}→${entry.allocatedTokens}`}`
          })
        return (
          <div key={stage.stage} className="novel-note-list">
            <div className="novel-note-list__item">
              <strong>{chapterContextStageLabel(stage.stage)}</strong>
              {` · 复杂度 ${preview.complexity} · 硬约束 ${stage.constraintInjectionStatus.hardConstraintUsed}/${stage.constraintInjectionStatus.hardConstraintBudget} · 软上下文 ${stage.constraintInjectionStatus.softContextUsed}/${stage.constraintInjectionStatus.softContextBudget}`}
            </div>
            <div className="novel-note-list__item">
              {`预算：上下文 ${report.hardConstraintUsed + report.softContextUsed}/${report.availableContextBudget} · 总窗口 ${report.effectiveBudget} · 输出预留 ${report.reservedForOutput}`}
            </div>
            <div className="novel-note-list__item">
              {report.overflowLevel === 'hard_failed'
                ? '阻塞：关键约束已超出预算，当前阶段不能安全生成。'
                : report.overflowLevel === 'soft_trimmed'
                  ? '已降级：低优先级上下文已被自动裁剪。'
                  : '预算充足，当前阶段未触发裁剪。'}
            </div>
            <div className="novel-note-list__item">{stage.hardConstraintSummary}</div>
            <div className="novel-note-list__item">
              已注入：{injectedTitles.length > 0 ? injectedTitles.join('、') : '无'}
            </div>
            <div className="novel-note-list__item">
              {stage.constraintInjectionStatus.preservedLabels.length > 0
                ? `保留优先：${stage.constraintInjectionStatus.preservedLabels.join('、')}`
                : '当前没有额外手动保留项，系统只保底默认关键约束。'}
            </div>
            <div className="novel-note-list__item">
              {truncatedTitles.length > 0
                ? `已压缩：${truncatedTitles.join('、')}`
                : '硬约束未发生压缩。'}
            </div>
            <div className="novel-note-list__item">
              {hasDrop
                ? `警告：仍有 ${stage.droppedConstraintCount} 项关键约束未注入。`
                : '关键约束未发生丢失。'}
            </div>
            <div className="novel-note-list__item">
              {report.droppedLabels.length > 0
                ? `被踢出：${report.droppedLabels.join('、')}${droppedByPriority ? ` · ${droppedByPriority}` : ''}`
                : '没有字段因预算被整体踢出。'}
            </div>
            <div className="novel-note-list__item">
              {report.truncatedLabels.length > 0
                ? `被压缩：${report.truncatedLabels.join('、')}`
                : '没有字段因预算被截断。'}
            </div>
            <div className="novel-note-list__item">
              {decisionLines.length > 0
                ? `软预算决策：${decisionLines.join('；')}`
                : '软上下文没有额外裁剪，也没有字段改走硬约束。'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PreviousChapterFeedCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对上一章承接采样、覆盖率和实际喂给模型的文本。</div>
  }

  const report = preview.previousChapterSampleReport
  const segmentSummary = report.segments.map((segment) => `${segment.label} ${segment.chars}字`)

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">
          {report.sourceChapterNum ? `来源第${report.sourceChapterNum}章` : '当前还没有上一章可供采样'}
        </div>
        <div className="novel-insight-list__item">采样 {report.sampledChars} 字</div>
        <div className="novel-insight-list__item">覆盖率 {report.coverageRate}%</div>
        <div className="novel-insight-list__item">{report.fullyInjected ? '短章全文注入' : `片段 ${report.segmentCount} 段`}</div>
      </div>
      <StringList items={segmentSummary} empty="上一章没有命中可直接注入的承接片段。" />
      {preview.previousChapterContext
        ? <div className="novel-copy-block writing-layout-copy-prewrap">{preview.previousChapterContext}</div>
        : <div className="novel-copy-block">当前章节前没有可注入的上一章先验。</div>}
    </div>
  )
}

export function ChapterBridgeMemoryCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对本章开头会怎样承接上一章的时间、地点、情绪和视角。</div>
  }

  const bridgeLines = (preview.chapterBridgePlan || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const stepMemoryLines = (preview.stepMemorySummary || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const runtimeAssertionLines = Array.from(new Set(preview.stages.flatMap((stage) => stage.upstreamArtifacts?.runtimeAssertions || [])))
    .map((line) => `运行时断言：${line}`)
  const buildStageDecisionLines = (label: 'chapterBridgePlan' | 'stepMemorySummary', title: string) => preview.stages.map((stage) => {
    const decision = stage.softContextDecisions.find((entry) => entry.label === label)
    const upstreamInjected = label === 'stepMemorySummary' && Boolean(stage.upstreamArtifacts?.stepMemorySummary?.trim())
    if (!decision) return `${chapterContextStageLabel(stage.stage)}：${title}${upstreamInjected ? '已作为上游步骤记忆注入，未进入软上下文分配记录' : '未进入软上下文分配'}`
    const status = decision.status === 'kept'
      ? '已保留'
      : decision.status === 'truncated'
        ? `已压缩 ${decision.originalTokens}->${decision.allocatedTokens}`
        : `已裁剪 ${decision.originalTokens}`
    return `${chapterContextStageLabel(stage.stage)}：${title}${status} · P${decision.priority}`
  })
  const bridgeStageLines = buildStageDecisionLines('chapterBridgePlan', '章节桥')
  const stepMemoryStageLines = buildStageDecisionLines('stepMemorySummary', '步骤记忆')

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <StringList items={bridgeLines} empty="当前章节没有可用的章节衔接桥，通常是第一章或上一章资料不足。" />
      <StringList items={stepMemoryLines} empty="当前预览没有合成步骤接力记忆。" />
      <StringList items={runtimeAssertionLines} empty="当前预览没有运行时接力断言。" />
      <StringList items={[...bridgeStageLines, ...stepMemoryStageLines]} empty="当前还没有阶段分配记录。" />
    </div>
  )
}

export function RecallDiagnosticsCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对召回来源、过期拦截和依赖率。</div>
  }

  const diagnostics = preview.recallDiagnostics
  const snapshot = preview.recallSnapshot
  const freshSources = preview.recalledMemorySources
    .filter((source) => !source.stale
      && !source.overriddenByConstraint
      && source.entityValidated
      && source.similarity >= (
        source.searchMode === 'vector'
          ? diagnostics.minVectorSimilarity
          : diagnostics.minKeywordSimilarity
      ))
    .slice(0, 4)
  const staleSources = preview.recalledMemorySources.filter((source) => source.stale).slice(0, 4)
  const bucketLines = Object.entries(snapshot.bucketStats)
    .map(([bucket, stats]) => `${recallBucketLabel(bucket)}：命中 ${stats.hitCount} / 采用 ${stats.selectedHitCount}${stats.fallbackReason ? ` / ${fallbackReasonLabel(stats.fallbackReason)}` : ''}`)

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">{snapshot.retrievalUsed ? '本章已实际使用召回' : '本章未实际使用召回'}</div>
        <div className="novel-insight-list__item">命中 {snapshot.hitCount}</div>
        <div className="novel-insight-list__item">召回依赖率 {diagnostics.recallDependencyRate}%</div>
        <div className="novel-insight-list__item">过期召回率 {diagnostics.staleRecallRate}%</div>
        <div className="novel-insight-list__item">可用片段 {diagnostics.selectedHitCount}</div>
        <div className="novel-insight-list__item">过期拦截 {diagnostics.staleRecallCount}</div>
        <div className="novel-insight-list__item">低相似拒绝 {diagnostics.lowSimilarityRejectedCount}</div>
        <div className="novel-insight-list__item">实体校验拦截 {diagnostics.entityValidationRejectedCount}</div>
      </div>
      <StringList
        items={[
          snapshot.fallbackReason ? `降级原因：${fallbackReasonLabel(snapshot.fallbackReason)}` : '当前未记录召回降级原因。',
          ...bucketLines,
        ]}
        empty="当前还没有召回桶统计。"
      />
      <StringList items={diagnostics.summaryLines} empty="当前还没有召回诊断摘要。" />
      <StringList
        items={freshSources.map((source) => `${source.sourceLabel}：${source.summary}`)}
        empty="本次没有额外背景补充片段进入上下文。"
      />
      {staleSources.length > 0 ? (
        <div className="novel-note-list">
          {staleSources.map((source, index) => (
            <div key={`${source.sourceLabel}-${index}`} className="novel-note-list__item">
              已拦截 · {source.sourceLabel}：{source.staleReasons.join('；')}
            </div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有命中过期召回片段。</div>
      )}
      {preview.recalledMemory ? <div className="novel-copy-block writing-layout-copy-prewrap">{preview.recalledMemory}</div> : null}
    </div>
  )
}

export function ContextUsageImpactCard({ preview }: { preview: ChapterContextPreview | null }) {
  if (!preview) {
    return <div className="novel-copy-block">先生成上下文预览，再核对本次真正用了哪些资产、合同约束，以及当前章节挂着哪些待同步影响。</div>
  }

  const snapshot = preview.usageSnapshot
  const linkedImpactLines = snapshot.linkedImpacts.map((item) => {
    const prefix = item.eventAssetLabel ? `${item.eventAssetLabel} -> ` : ''
    return `${prefix}${item.targetLabel}：${item.impactReason}`
  })

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <StringList items={snapshot.usedAssets} empty="本次生成还没记录到实际命中的关键资产。" />
      <StringList items={snapshot.usedContracts} empty="本次生成还没记录到注入的合同与硬约束。" />
      <StringList items={snapshot.recentStateChanges} empty="本次生成没有新增状态变化汇总。" />
      {snapshot.ignoredConstraints.length > 0 ? (
        <div className="novel-note-list">
          {snapshot.ignoredConstraints.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">忽略 / 压缩：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有约束被压缩或忽略。</div>
      )}
      {snapshot.linkedImpacts.length > 0 ? (
        <div className="writing-layout-stack writing-layout-stack--xs">
          <StringList items={linkedImpactLines} empty="当前章节没有挂起的影响项。" />
          <div className="novel-insight-list">
            {snapshot.linkedImpacts.map((item) => (
              <div key={item.id} className="novel-insight-list__item">
                {item.resolutionStatus === 'pending' ? '待同步' : '已复核'} · {assetImpactTargetLabel(item.targetType)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="novel-copy-block">当前章节没有挂起的资产影响任务。</div>
      )}
    </div>
  )
}

export function AiExplainabilityCard({ preview }: { preview: ChapterContextPreview | null }) {
  const explainability = preview?.generationExplainability
  if (!preview || !explainability) {
    return <div className="novel-copy-block">先生成上下文预览，再查看模型路由、结构化输出、风格锁和低置信度事实。</div>
  }

  const routeLines = explainability.stageReports.map((stage) => {
    const route = stage.route
    return `${stage.stageLabel}：${route.modelLabel} · 温度 ${route.temperature.toFixed(2)} · 输出 ${route.maxTokens} · ${route.reviewDepth}${route.tokenSafetyMarginPct ? ` · 裕量 ${route.tokenSafetyMarginPct}%` : ''}`
  })
  const structuredLines = explainability.structuredOutputs
  const overrideLines = (explainability.activePromptOverrideKeys || []).map((item) => `提示词覆盖：${item}`)
  const inferredLines = explainability.inferredFacts.map((item) => `${item.label}：${item.detail}${item.needsConfirmation ? ' · 待确认' : ''}`)
  const lowConfidenceLines = explainability.lowConfidenceFacts.map((item) => `${item.label}：${item.detail}`)
  const assemblyLayers = explainability.contextAssemblyReport?.layers.map((layer) => `${layer.label} · ${layer.itemCount} 项：${layer.summary}`) || []
  const styleLock = explainability.authorStyleLock
  const styleLockLines = styleLock?.enabled
    ? [
        styleLock.sourceLabel ? `来源：${styleLock.sourceLabel}` : '',
        styleLock.sentenceLengthHint ? `句长：${styleLock.sentenceLengthHint}` : '',
        styleLock.dialogueRhythmHint ? `对白：${styleLock.dialogueRhythmHint}` : '',
        styleLock.narrativeDensityHint ? `密度：${styleLock.narrativeDensityHint}` : '',
        styleLock.paceHint ? `节奏：${styleLock.paceHint}` : '',
        styleLock.targetWorkSampleGuide ? `真实样章对照：${styleLock.targetWorkSampleGuide}` : '',
        styleLock.humanStyleSampleLock ? `人工风格样本锁定：${styleLock.humanStyleSampleLock}` : '',
        styleLock.toneKeywords.length > 0 ? `语调：${styleLock.toneKeywords.join('、')}` : '',
        styleLock.preferredLexicon.length > 0 ? `偏好词汇：${styleLock.preferredLexicon.join('、')}` : '',
        styleLock.forbiddenPatterns.length > 0 ? `禁用表达：${styleLock.forbiddenPatterns.join('、')}` : '',
        styleLock.hardRules.length > 0 ? `硬约束：${styleLock.hardRules.join('；')}` : '',
      ].filter(Boolean)
    : []

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="novel-copy-block">{explainability.routeSummary}</div>
      <StringList items={routeLines} empty="当前还没有模型路由记录。" />
      <StringList items={overrideLines} empty="当前没有启用章节提示词覆盖。" />
      <StringList items={structuredLines} empty="本次没有新增结构化输出节点记录。" />
      <StringList items={assemblyLayers} empty="当前还没有上下文组装层说明。" />
      <StringList items={styleLockLines} empty="还没有作者风格锁，可去主题与文风页补样本。" />
      <StringList items={inferredLines} empty="本次没有新增推断候选。" />
      {lowConfidenceLines.length > 0 ? (
        <div className="novel-note-list">
          {lowConfidenceLines.map((item, index) => (
            <div key={`${item}-${index}`} className="novel-note-list__item">低置信度：{item}</div>
          ))}
        </div>
      ) : (
        <div className="novel-copy-block">本次没有低置信度事实或被压缩约束。</div>
      )}
    </div>
  )
}

export function WriterToolsTraceCard({ preview }: { preview: ChapterContextPreview | null }) {
  const resolution = preview?.writerContextResolution
  if (!preview || !resolution) {
    return <div className="novel-copy-block">当前章节还没有写作调度追踪，先刷新上下文预览或执行一次生成。</div>
  }

  const planLines = resolution.queryPlan.map((step) => {
    const terms = step.terms.length > 0 ? ` · ${step.terms.join('、')}` : ''
    const callSummary = step.serviceCalls.length > 0 ? ` · 工具 ${step.serviceCalls.length} 个` : ''
    return `${step.enabled ? '启用' : '跳过'} · ${recallBucketLabel(step.bucket)}${callSummary}${terms}`
  })
  const toolLines = resolution.toolCalls.map((call) => {
    const result = typeof call.resultCount === 'number' ? ` · 命中 ${call.resultCount}` : ''
    const issue = call.errorMessage ? ` · ${call.errorMessage}` : ''
    return `${writerToolStatusLabel(call.status)} · ${recallBucketLabel(call.target)}${result}${issue}`
  })
  const fallbackLines = resolution.fallbackEvents.map((event) => (
    `${writerFallbackModeLabel(event.fallbackMode)} · ${recallBucketLabel(event.target)} · ${fallbackReasonLabel(event.reason)} · ${event.detail}`
  ))
  const overrideLines = resolution.allocatorInputSummary.overrideLabels.map((label) => {
    const text = resolution.renderedContextOverrides[label] || ''
    const previewText = text.length > 120 ? `${text.slice(0, 117)}...` : text
    return `${label}：${previewText || '空'}`
  })

  return (
    <div className="writing-layout-stack writing-layout-stack--sm">
      <div className="novel-insight-list">
        <div className="novel-insight-list__item">{resolution.cacheHit ? '本次命中内存缓存' : '本次实时执行检索'}</div>
        <div className="novel-insight-list__item">计划桶 {resolution.queryPlan.filter((step) => step.enabled).length}</div>
        <div className="novel-insight-list__item">工具调用 {resolution.toolCalls.length}</div>
        <div className="novel-insight-list__item">降级 {resolution.fallbackEvents.length}</div>
        <div className="novel-insight-list__item">覆盖 {resolution.allocatorInputSummary.overrideLabels.length}</div>
      </div>
      <StringList items={planLines} empty="当前没有写作检索计划。" />
      <StringList items={toolLines} empty="当前没有写作工具调用记录。" />
      <StringList items={fallbackLines} empty="本次没有触发降级。" />
      <StringList items={overrideLines} empty="本次没有生成召回覆盖。" />
    </div>
  )
}

export function ChapterFocusCard({
  summary,
  nextChapterSeed,
  continuityItems,
  bridgeItems,
  qualityItems,
}: {
  summary?: string | null
  nextChapterSeed?: string | null
  continuityItems: string[]
  bridgeItems: string[]
  qualityItems: string[]
}) {
  const hasSummary = Boolean(summary?.trim())
  const hasNextChapterSeed = Boolean(nextChapterSeed?.trim())
  const hasContinuity = continuityItems.length > 0
  const hasBridge = bridgeItems.length > 0
  const hasQuality = qualityItems.length > 0

  return (
    <InsightCard title="本章聚焦" eyebrow="主线锚点" tone="hero">
      {hasSummary || hasNextChapterSeed || hasContinuity || hasBridge || hasQuality ? (
        <div className="novel-writing-shell__focus-card">
          {hasSummary ? <section className="novel-writing-shell__focus-block"><div className="novel-writing-shell__focus-label">一句话摘要</div><div className="novel-writing-shell__focus-copy">{summary}</div></section> : null}
          {hasNextChapterSeed ? <section className="novel-writing-shell__focus-block novel-writing-shell__focus-block--accent"><div className="novel-writing-shell__focus-label">下一章引子</div><div className="novel-writing-shell__focus-copy">{nextChapterSeed}</div></section> : null}
          {hasBridge ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">章节衔接桥</div><div className="novel-insight-list">{bridgeItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
          {hasContinuity ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">连续性提醒</div><div className="novel-insight-list">{continuityItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
          {hasQuality ? <section className="novel-writing-shell__focus-notes"><div className="novel-writing-shell__focus-label">健康提示</div><div className="novel-insight-list">{qualityItems.map((item, index) => <div key={`${item}-${index}`} className="novel-insight-list__item novel-insight-list__item--compact">{item}</div>)}</div></section> : null}
        </div>
      ) : <div className="novel-copy-block">章节流水线完成后，会在这里收束本章摘要、承接提醒与下一章引子。</div>}
    </InsightCard>
  )
}
