import type { WebContents } from 'electron'
import type { AssetReviewObservability, AssetReviewResult, AssetReviewTarget } from '../../src/types'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { safeParseJson } from '../utils/json'
import { assetReviewPrompt, assetRewritePrompt } from './prompts'
import {
  createTask,
  executeChatTask,
  getTaskRecord,
  parseTaskProgress,
  runChatTask,
  updateTask,
  updateTaskProgress,
} from './task.service'

type ReviewSeverity = AssetReviewResult['severity']

export interface AssetQualityLoopOptions {
  targetType: AssetReviewTarget
  novelId: number
  modelConfigId?: number
  relatedEntityType?: string
  relatedEntityId?: number
  parentTaskId?: number
  sender?: WebContents
  contextSummary: string
  generatedOutput: string
  schemaHint?: string
  reviewFocus?: string[]
  rewriteConstraints?: string[]
}

export interface AssetQualityLoopResult {
  stage: 'accepted' | 'rewritten' | 'rejected'
  finalOutput: string
  review: AssetReviewResult
  rewrittenReview?: AssetReviewResult
  warnings: string[]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return cleanAiStringArray(
    value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  return value === 'high' || value === 'medium' ? value : 'low'
}

function uniqueLines(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))]
}

function collectReviewRisks(review: AssetReviewResult): string[] {
  return uniqueLines([
    ...review.genreDriftRisks,
    ...review.themeDriftRisks,
    ...review.backgroundDriftRisks,
    ...review.languageRisks,
    ...review.conflictRisks,
  ]).slice(0, 8)
}

function fallbackReview(summary: string, warning?: string): AssetReviewResult {
  const finalSummary = warning ? `${summary} ${warning}`.trim() : summary
  return {
    summary: finalSummary,
    severity: 'medium',
    rewriteRequired: false,
    rejectRequired: false,
    genreDriftRisks: [],
    themeDriftRisks: [],
    backgroundDriftRisks: [],
    languageRisks: warning ? [warning] : [],
    humanLanguageRepairs: [],
    conflictRisks: [],
    topFixes: [],
    strengths: [],
  }
}

function parseAssetReviewResult(raw: string): AssetReviewResult {
  const parsed = cleanAiValue(safeParseJson<Record<string, unknown>>(raw))
  return {
    summary: asText(parsed.summary) || '未返回可用审校摘要。',
    severity: normalizeSeverity(parsed.severity),
    rewriteRequired: parsed.rewrite_required === true,
    rejectRequired: parsed.reject_required === true,
    genreDriftRisks: toStringArray(parsed.genre_drift_risks),
    themeDriftRisks: toStringArray(parsed.theme_drift_risks),
    backgroundDriftRisks: toStringArray(parsed.background_drift_risks),
    languageRisks: toStringArray(parsed.language_risks),
    humanLanguageRepairs: toStringArray(parsed.human_language_repairs),
    conflictRisks: toStringArray(parsed.conflict_risks),
    topFixes: toStringArray(parsed.top_fixes),
    strengths: toStringArray(parsed.strengths),
  }
}

function buildProgressPatch(
  current: Record<string, unknown>,
  patch: Partial<AssetReviewObservability> & { message?: string },
): Record<string, unknown> {
  const currentAsset = current.assetReview && typeof current.assetReview === 'object' && !Array.isArray(current.assetReview)
    ? current.assetReview as Record<string, unknown>
    : {}

  const nextAsset: AssetReviewObservability = {
    targetType: (patch.targetType || currentAsset.targetType || 'character') as AssetReviewTarget,
    stage: (patch.stage || currentAsset.stage || 'drafted') as AssetReviewObservability['stage'],
    reviewSummary: String(patch.reviewSummary || currentAsset.reviewSummary || ''),
    severity: (patch.severity || currentAsset.severity || 'low') as ReviewSeverity,
    rewriteRequired: patch.rewriteRequired ?? Boolean(currentAsset.rewriteRequired),
    rejectRequired: patch.rejectRequired ?? Boolean(currentAsset.rejectRequired),
    topFixes: Array.isArray(patch.topFixes) ? patch.topFixes : Array.isArray(currentAsset.topFixes) ? currentAsset.topFixes as string[] : [],
    risks: Array.isArray(patch.risks) ? patch.risks : Array.isArray(currentAsset.risks) ? currentAsset.risks as string[] : [],
    warnings: Array.isArray(patch.warnings)
      ? patch.warnings
      : Array.isArray(currentAsset.warnings)
        ? currentAsset.warnings as string[]
        : undefined,
  }

  return {
    ...current,
    ...(typeof patch.message === 'string' && patch.message.trim() ? { message: patch.message.trim() } : {}),
    assetReview: nextAsset,
  }
}

function updateAssetReviewProgress(
  taskId: number | undefined,
  sender: WebContents | undefined,
  patch: Partial<AssetReviewObservability> & { message?: string },
): void {
  if (typeof taskId !== 'number') return
  const task = getTaskRecord(taskId)
  if (!task) return
  const progress = parseTaskProgress<Record<string, unknown>>(task)
  updateTaskProgress(taskId, buildProgressPatch(progress, patch), sender)
}

async function runNestedReviewTask(params: {
  parentTaskId?: number
  novelId: number
  modelConfigId?: number
  sender?: WebContents
  relatedEntityType?: string
  relatedEntityId?: number
  prompt: string
}): Promise<string> {
  const messages = [{ role: 'user' as const, content: params.prompt }]

  if (typeof params.parentTaskId !== 'number') {
    return runChatTask({
      type: 'review',
      novelId: params.novelId,
      modelConfigId: params.modelConfigId,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
      messages,
      sender: params.sender,
    })
  }

  const childTaskId = await createTask({
    type: 'review',
    novelId: params.novelId,
    modelConfigId: params.modelConfigId,
    relatedEntityType: params.relatedEntityType,
    relatedEntityId: params.relatedEntityId,
    inputJson: JSON.stringify(messages),
    runnerType: 'chat',
    parentTaskId: params.parentTaskId,
  })

  updateTask(params.parentTaskId, { currentChildTaskId: childTaskId })

  try {
    return await executeChatTask(childTaskId, {
      type: 'review',
      novelId: params.novelId,
      modelConfigId: params.modelConfigId,
      relatedEntityType: params.relatedEntityType,
      relatedEntityId: params.relatedEntityId,
      inputJson: JSON.stringify(messages),
      messages,
      sender: params.sender,
    })
  } finally {
    updateTask(params.parentTaskId, { currentChildTaskId: null })
  }
}

export async function reviewGeneratedAsset(options: AssetQualityLoopOptions): Promise<AssetReviewResult> {
  const raw = await runNestedReviewTask({
    parentTaskId: options.parentTaskId,
    novelId: options.novelId,
    modelConfigId: options.modelConfigId,
    sender: options.sender,
    relatedEntityType: options.relatedEntityType,
    relatedEntityId: options.relatedEntityId,
    prompt: assetReviewPrompt({
      targetType: options.targetType,
      contextSummary: options.contextSummary,
      generatedOutput: options.generatedOutput,
      schemaHint: options.schemaHint,
      reviewFocus: options.reviewFocus,
    }),
  })

  return parseAssetReviewResult(raw)
}

export async function rewriteGeneratedAsset(
  options: AssetQualityLoopOptions,
  review: AssetReviewResult,
): Promise<string> {
  return runNestedReviewTask({
    parentTaskId: options.parentTaskId,
    novelId: options.novelId,
    modelConfigId: options.modelConfigId,
    sender: options.sender,
    relatedEntityType: options.relatedEntityType,
    relatedEntityId: options.relatedEntityId,
    prompt: assetRewritePrompt({
      targetType: options.targetType,
      contextSummary: options.contextSummary,
      generatedOutput: options.generatedOutput,
      reviewSummary: review.summary,
      topFixes: review.topFixes,
      humanLanguageRepairs: review.humanLanguageRepairs,
      schemaHint: options.schemaHint,
      rewriteConstraints: options.rewriteConstraints,
    }),
  })
}

export async function runAssetQualityLoop(options: AssetQualityLoopOptions): Promise<AssetQualityLoopResult> {
  updateAssetReviewProgress(options.parentTaskId, options.sender, {
    targetType: options.targetType,
    stage: 'drafted',
    reviewSummary: '已拿到初稿，准备进入资产审校。',
    severity: 'low',
    rewriteRequired: false,
    rejectRequired: false,
    topFixes: [],
    risks: [],
    message: '已生成初稿，正在进行资产审校。',
  })

  let review: AssetReviewResult
  try {
    review = await reviewGeneratedAsset(options)
  } catch (error) {
    const warning = error instanceof Error ? error.message : '资产审校失败，已保留原始输出。'
    review = fallbackReview('资产审校失败，已保留原始输出。', warning)
    updateAssetReviewProgress(options.parentTaskId, options.sender, {
      targetType: options.targetType,
      stage: 'accepted',
      reviewSummary: review.summary,
      severity: review.severity,
      rewriteRequired: false,
      rejectRequired: false,
      topFixes: [],
      risks: [],
      warnings: [warning],
      message: '资产审校失败，已保留原始输出。',
    })
    return {
      stage: 'accepted',
      finalOutput: options.generatedOutput,
      review,
      warnings: [warning],
    }
  }

  updateAssetReviewProgress(options.parentTaskId, options.sender, {
    targetType: options.targetType,
    stage: 'reviewed',
    reviewSummary: review.summary,
    severity: review.severity,
    rewriteRequired: review.rewriteRequired,
    rejectRequired: review.rejectRequired,
    topFixes: review.topFixes,
    risks: collectReviewRisks(review),
    message: review.rejectRequired
      ? '资产审校判定当前结果应拒收。'
      : review.rewriteRequired
        ? '资产审校要求先做定向重写。'
        : '资产审校通过，准备进入落库校验。',
  })

  if (review.rejectRequired) {
    return {
      stage: 'rejected',
      finalOutput: options.generatedOutput,
      review,
      warnings: [review.summary],
    }
  }

  if (!review.rewriteRequired) {
    updateAssetReviewProgress(options.parentTaskId, options.sender, {
      targetType: options.targetType,
      stage: 'accepted',
      reviewSummary: review.summary,
      severity: review.severity,
      rewriteRequired: false,
      rejectRequired: false,
      topFixes: review.topFixes,
      risks: collectReviewRisks(review),
      message: '资产审校通过。',
    })
    return {
      stage: 'accepted',
      finalOutput: options.generatedOutput,
      review,
      warnings: [],
    }
  }

  updateAssetReviewProgress(options.parentTaskId, options.sender, {
    targetType: options.targetType,
    stage: 'rewritten',
    reviewSummary: review.summary,
    severity: review.severity,
    rewriteRequired: true,
    rejectRequired: false,
    topFixes: review.topFixes,
    risks: collectReviewRisks(review),
    message: '正在根据审校结论进行资产重写。',
  })

  let rewrittenOutput: string
  try {
    rewrittenOutput = await rewriteGeneratedAsset(options, review)
  } catch (error) {
    const warning = error instanceof Error ? error.message : '资产重写失败，已保留原始输出。'
    updateAssetReviewProgress(options.parentTaskId, options.sender, {
      targetType: options.targetType,
      stage: 'accepted',
      reviewSummary: review.summary,
      severity: review.severity,
      rewriteRequired: false,
      rejectRequired: false,
      topFixes: review.topFixes,
      risks: collectReviewRisks(review),
      warnings: [warning],
      message: '资产重写失败，已保留原始输出。',
    })
    return {
      stage: 'accepted',
      finalOutput: options.generatedOutput,
      review,
      warnings: [warning],
    }
  }

  const recheckOptions: AssetQualityLoopOptions = {
    ...options,
    generatedOutput: rewrittenOutput,
    reviewFocus: uniqueLines([
      ...(options.reviewFocus || []),
      '这是重写后的资产，请重点确认原有高优先风险是否已被修掉。',
    ]),
  }

  let rewrittenReview: AssetReviewResult
  try {
    rewrittenReview = await reviewGeneratedAsset(recheckOptions)
  } catch (error) {
    const warning = error instanceof Error ? error.message : '重写复检失败，已采用重写结果。'
    const fallback = fallbackReview('重写后复检失败，已采用重写结果。', warning)
    updateAssetReviewProgress(options.parentTaskId, options.sender, {
      targetType: options.targetType,
      stage: 'accepted',
      reviewSummary: fallback.summary,
      severity: fallback.severity,
      rewriteRequired: false,
      rejectRequired: false,
      topFixes: review.topFixes,
      risks: collectReviewRisks(review),
      warnings: [warning],
      message: '重写复检失败，已采用重写结果。',
    })
    return {
      stage: 'rewritten',
      finalOutput: rewrittenOutput,
      review,
      rewrittenReview: fallback,
      warnings: [warning],
    }
  }

  updateAssetReviewProgress(options.parentTaskId, options.sender, {
    targetType: options.targetType,
    stage: rewrittenReview.rejectRequired ? 'rejected' : 'accepted',
    reviewSummary: rewrittenReview.summary,
    severity: rewrittenReview.severity,
    rewriteRequired: rewrittenReview.rewriteRequired,
    rejectRequired: rewrittenReview.rejectRequired,
    topFixes: rewrittenReview.topFixes,
    risks: collectReviewRisks(rewrittenReview),
    message: rewrittenReview.rejectRequired
      ? '资产重写后复检仍不通过，当前结果已拒收。'
      : '资产重写完成并通过复检。',
  })

  return {
    stage: rewrittenReview.rejectRequired ? 'rejected' : 'rewritten',
    finalOutput: rewrittenOutput,
    review,
    rewrittenReview,
    warnings: rewrittenReview.rejectRequired ? [rewrittenReview.summary] : [],
  }
}

export function summarizeAssetQualityWarnings(result: AssetQualityLoopResult): string | undefined {
  const lines = uniqueLines([
    result.stage === 'rewritten' ? '资产已按审校结论自动重写。' : '',
    result.stage === 'rejected' ? `资产审校拒收：${result.review.summary}` : '',
    ...result.warnings,
    result.rewrittenReview?.summary && result.stage === 'rewritten'
      ? `重写复检：${result.rewrittenReview.summary}`
      : '',
  ])
  return lines.length > 0 ? lines.join('；') : undefined
}
