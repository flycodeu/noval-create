import type {
  AiContextAssemblyReport,
  AiExecutionMode,
  AiExplainabilityReport,
  AiStageExecutionReport,
  AuthorStyleLockSummary,
  WritingContextUsageSnapshot,
} from '../../src/types'
import {
  buildAiExplainabilityReport,
  buildAiModelRouteReport,
  buildAiStageExecutionReport,
  buildAuthorStyleLockSummary,
} from './ai-engine.service'
import { listActiveImpactsForChapter } from './asset-impact.service'
import {
  buildWritingContextUsageSnapshot,
  type ChapterContext,
  type ChapterContextRawData,
} from './context.service'

export interface ChapterAiStageReportOptions {
  rewriteTemperatureCap?: number
  rewriteContextStrategy?: 'balanced' | 'max_coverage'
  rewriteReviewDepth?: 'standard' | 'deep'
  rewriteReasons?: string[]
}

export function buildChapterAiStageReports(
  executionMode: AiExecutionMode,
  resolutionSource: 'request_override' | 'global_default' | 'fallback_default',
  modelConfigId?: number | null,
  options: ChapterAiStageReportOptions = {},
): AiStageExecutionReport[] {
  const plannerRoute = buildAiModelRouteReport({
    taskKind: 'chapter_planning', stageLabel: 'Planner', executionMode, resolutionSource, modelConfigId,
  })
  const writerRoute = buildAiModelRouteReport({
    taskKind: 'chapter_generation', stageLabel: 'Writer', executionMode, resolutionSource, modelConfigId,
  })
  const criticRoute = buildAiModelRouteReport({
    taskKind: 'chapter_review', stageLabel: 'Critic', executionMode, resolutionSource, modelConfigId,
  })
  const rewriterRoute = buildAiModelRouteReport({
    taskKind: 'chapter_rewrite',
    stageLabel: 'Rewriter',
    executionMode,
    resolutionSource,
    modelConfigId,
    temperatureCap: options.rewriteTemperatureCap,
    contextStrategy: options.rewriteContextStrategy,
    reviewDepth: options.rewriteReviewDepth,
    extraReasons: options.rewriteReasons,
  })
  const finalizeRoute = buildAiModelRouteReport({
    taskKind: 'chapter_finalize', stageLabel: 'Canon / Finalize', executionMode, resolutionSource, modelConfigId,
  })

  return [
    buildAiStageExecutionReport({
      stageKey: 'planner', stageLabel: 'Planner', taskKind: 'chapter_planning', executionMode, outputShape: 'json',
      summary: '先输出场景计划 JSON，再渲染为可读场景链。', route: plannerRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'writer', stageLabel: 'Writer', taskKind: 'chapter_generation', executionMode, outputShape: 'text',
      summary: '基于章节合同、场景计划与统一上下文生成正文初稿。', route: writerRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'critic', stageLabel: 'Critic', taskKind: 'chapter_review', executionMode, outputShape: 'json',
      summary: '输出结构化审校意见，再回写为 reviewNotes。', route: criticRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'rewriter', stageLabel: 'Rewriter', taskKind: 'chapter_rewrite', executionMode, outputShape: 'text',
      summary: '按审校结论修正文稿，并保留人味与合同兑现检查。', route: rewriterRoute,
    }),
    buildAiStageExecutionReport({
      stageKey: 'canon-finalize', stageLabel: 'Canon / Finalize', taskKind: 'chapter_finalize', executionMode, outputShape: 'workflow',
      summary: '生成 Canon 差异草案，并刷新摘要、连续性与记忆写回。', route: finalizeRoute,
    }),
  ]
}

export function buildChapterContextAssemblyReport(
  context: Pick<ChapterContext,
    'recalledMemorySources' | 'recallDiagnostics' | 'recallSnapshot' | 'timelineSummary'
    | 'timelineOpenThreads' | 'chapterBridgePlan' | 'hardConstraintEntries'>,
  usageSnapshot: WritingContextUsageSnapshot,
): AiContextAssemblyReport {
  const graphItems = usageSnapshot.usedAssets.length
  const timelineItems = [
    context.timelineSummary,
    context.timelineOpenThreads,
    ...usageSnapshot.recentStateChanges,
  ].filter(Boolean).length
  const bridgeItems = context.chapterBridgePlan
    ? context.chapterBridgePlan.split('\n').map((line) => line.trim()).filter(Boolean).length
    : 0
  const contractItems = usageSnapshot.usedContracts.length + context.hardConstraintEntries.length

  return {
    assemblyVersion: 'v2-unified',
    summary: `统一上下文组装器已合并资产图谱、时间线索、章节衔接与合同硬约束，本章共装配 ${graphItems + timelineItems + bridgeItems + contractItems} 个有效上下文入口。`,
    layers: [
      {
        key: 'graph_recall', label: '图谱召回', itemCount: graphItems,
        summary: graphItems > 0
          ? `命中 ${graphItems} 个已使用资产，并补入 ${context.recalledMemorySources.filter((item) =>
            !item.stale
            && !item.overriddenByConstraint
            && item.entityValidated
            && item.similarity >= (
              item.searchMode === 'vector'
                ? context.recallDiagnostics.minVectorSimilarity
                : context.recallDiagnostics.minKeywordSimilarity
            )).length} 条召回片段。`
          : '当前没有命中的资产图谱引用。',
      },
      {
        key: 'timeline_recall', label: '时间召回', itemCount: timelineItems,
        summary: timelineItems > 0
          ? '已把时间轴、开放线索和近期状态变化共同纳入写作上下文。'
          : '当前章节没有额外时间召回补充。',
      },
      {
        key: 'chapter_bridge', label: '章节衔接', itemCount: bridgeItems,
        summary: bridgeItems > 0
          ? '已把上章结尾、时间地点、情绪惯性和 POV 边界纳入开篇承接计划。'
          : '当前章节没有可用的章节衔接桥，通常是第一章或前章资料不足。',
      },
      {
        key: 'contract_recall', label: '合同召回', itemCount: contractItems,
        summary: contractItems > 0
          ? `硬约束 ${context.hardConstraintEntries.length} 项，显式合同引用 ${usageSnapshot.usedContracts.length} 项。`
          : '当前没有识别到显式合同约束。',
      },
    ],
    notes: [
      context.recallSnapshot.assemblyStage === 'unified_recall'
        ? '召回层已进入 unified_recall，并与合同约束联合裁剪。'
        : '召回层仍以基础召回为主，但已统一呈现在 v2 解释报告中。',
      usageSnapshot.ignoredConstraints.length > 0
        ? `存在 ${usageSnapshot.ignoredConstraints.length} 项约束被压缩或忽略，已列入低置信度提示。`
        : '本次没有检测到被忽略的硬约束。',
    ],
  }
}

export function buildChapterPipelineStageObservability(input: {
  executionMode: AiExecutionMode
  resolutionSource: 'request_override' | 'global_default' | 'fallback_default'
  modelConfigId?: number | null
  usageSnapshot: WritingContextUsageSnapshot
  contextAssemblyReport: AiContextAssemblyReport
  authorStyleLock: AuthorStyleLockSummary
  activePromptOverrideKeys: string[]
  stageReportOptions?: ChapterAiStageReportOptions
}): {
  stageReports: AiStageExecutionReport[]
  generationExplainability: AiExplainabilityReport
} {
  const stageReports = buildChapterAiStageReports(
    input.executionMode,
    input.resolutionSource,
    input.modelConfigId,
    input.stageReportOptions,
  )
  const generationExplainability = buildAiExplainabilityReport({
    taskKind: 'chapter_generation',
    executionMode: input.executionMode,
    usageSnapshot: input.usageSnapshot,
    stageReports,
    contextAssemblyReport: input.contextAssemblyReport,
    authorStyleLock: input.authorStyleLock,
    structuredOutputs: ['场景计划 JSON', '审校意见 JSON', 'Canon 差异草案'],
    activePromptOverrideKeys: input.activePromptOverrideKeys,
  })
  return { stageReports, generationExplainability }
}

export function buildChapterPipelineObservability(input: {
  chapterId: number
  novelId: number
  themeVoiceJson?: string | null
  rawContext: ChapterContextRawData
  draftContext: ChapterContext
  executionMode: AiExecutionMode
  resolutionSource: 'request_override' | 'global_default' | 'fallback_default'
  modelConfigId?: number | null
  activePromptOverrideKeys: string[]
  stageReportOptions?: ChapterAiStageReportOptions
}): {
  usageSnapshot: WritingContextUsageSnapshot
  contextAssemblyReport: AiContextAssemblyReport
  authorStyleLock: AuthorStyleLockSummary
  stageReports: AiStageExecutionReport[]
  generationExplainability: AiExplainabilityReport
} {
  const linkedImpacts = listActiveImpactsForChapter(input.novelId, input.chapterId)
  const usageSnapshot = buildWritingContextUsageSnapshot(input.rawContext, input.draftContext, linkedImpacts)
  const contextAssemblyReport = buildChapterContextAssemblyReport(input.draftContext, usageSnapshot)
  const authorStyleLock = buildAuthorStyleLockSummary(input.novelId, input.themeVoiceJson)
  const { stageReports, generationExplainability } = buildChapterPipelineStageObservability({
    executionMode: input.executionMode,
    resolutionSource: input.resolutionSource,
    modelConfigId: input.modelConfigId,
    usageSnapshot,
    contextAssemblyReport,
    authorStyleLock,
    activePromptOverrideKeys: input.activePromptOverrideKeys,
    stageReportOptions: input.stageReportOptions,
  })
  return { usageSnapshot, contextAssemblyReport, authorStyleLock, stageReports, generationExplainability }
}
