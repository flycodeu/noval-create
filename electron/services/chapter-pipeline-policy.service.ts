import type { ChapterRewriteScope } from '../../src/types'
import { computeCandidateSimilarity } from './variation-control.service'

export type ReviewPriorityLevel = 'high' | 'medium' | 'low'

export type ReviewPrioritySource =
  | 'critical_fixes'
  | 'continuity_risks'
  | 'arc_progress_risks'
  | 'context_drift_risks'
  | 'realism_risks'
  | 'coherence_risks'
  | 'reader_hook_risks'
  | 'typed_ref_risks'
  | 'source_grounding_risks'
  | 'operating_mode_risks'
  | 'long_window_humanization_risks'
  | 'dialogue_separability_risks'
  | 'language_risks'
  | 'human_language_repairs'
  | 'genre_hollowing_risks'
  | 'missing_payoffs'
  | 'dialogue_homogenization_risks'
  | 'dialogue_filler_risks'
  | 'dialogue_info_density_risks'
  | 'contract_validation'

export interface ReviewPriorityIssue {
  source: ReviewPrioritySource
  label: string
  detail: string
  priority: ReviewPriorityLevel
}

export interface ReviewPrioritySummary {
  topIssues: ReviewPriorityIssue[]
  deferredIssues: ReviewPriorityIssue[]
  rewriteScope: ChapterRewriteScope
  requiresFullRewrite: boolean
  forceMaxCoverage: boolean
  counts: Record<ReviewPriorityLevel, number>
  reasons: string[]
}

export interface RewriteAdaptivePolicy {
  temperatureCap: number
  contextStrategy: 'balanced' | 'max_coverage'
  reviewDepth: 'standard' | 'deep'
  contextBudgetMultiplier: number
  rewriteScope: ChapterRewriteScope
  requiresFullRewrite: boolean
  reasons: string[]
}

export interface RewriteMiniReviewVerdict {
  improved: boolean
  needsHumanReview: boolean
  reason: string
  similarityToOriginal: number
}

interface ContractValidationLike {
  status?: 'pass' | 'warning' | 'blocker'
  rewriteHints?: string[]
}

export interface ChapterReviewNotesLike {
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks: string[]
  context_drift_risks: string[]
  realism_risks: string[]
  coherence_risks: string[]
  reader_hook_risks: string[]
  typed_ref_risks: string[]
  source_grounding_risks: string[]
  operating_mode_risks: string[]
  long_window_humanization_risks: string[]
  dialogue_separability_risks: string[]
  language_risks: string[]
  human_language_repairs: string[]
  genre_hollowing_risks: string[]
  missing_payoffs: string[]
  dialogue_homogenization_risks: string[]
  dialogue_filler_risks: string[]
  dialogue_info_density_risks: string[]
  severity: 'low' | 'medium' | 'high'
  rewrite_required: boolean
  cost_resolution_state?: 'new' | 'ongoing' | 'resolved' | 'evaporated'
  reversal_support_state?: 'supported' | 'weak' | 'forced'
  contract_validation?: ContractValidationLike
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  values.forEach((value) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    result.push(normalized)
  })
  return result
}

function pushIssues(
  result: ReviewPriorityIssue[],
  values: string[] | undefined,
  source: ReviewPrioritySource,
  label: string,
  priority: ReviewPriorityLevel,
): void {
  dedupeStrings(values || []).forEach((detail) => {
    result.push({
      source,
      label,
      detail,
      priority,
    })
  })
}

function getPriorityWeight(priority: ReviewPriorityLevel): number {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function getSourceWeight(source: ReviewPrioritySource): number {
  const weights: Record<ReviewPrioritySource, number> = {
    critical_fixes: 15,
    continuity_risks: 14,
    arc_progress_risks: 13,
    typed_ref_risks: 12,
    source_grounding_risks: 11,
    operating_mode_risks: 10,
    dialogue_separability_risks: 9,
    reader_hook_risks: 8,
    missing_payoffs: 7,
    contract_validation: 6,
    context_drift_risks: 5,
    coherence_risks: 4,
    realism_risks: 3,
    long_window_humanization_risks: 7,
    language_risks: 6,
    human_language_repairs: 5,
    genre_hollowing_risks: 1,
    dialogue_homogenization_risks: 3,
    dialogue_info_density_risks: 2,
    dialogue_filler_risks: 1,
  }
  return weights[source]
}

function normalizePriorityIssues(reviewNotes: ChapterReviewNotesLike): ReviewPriorityIssue[] {
  const issues: ReviewPriorityIssue[] = []
  pushIssues(issues, reviewNotes.critical_fixes, 'critical_fixes', '关键修订', 'high')
  pushIssues(issues, reviewNotes.continuity_risks, 'continuity_risks', '连续性风险', 'high')
  pushIssues(issues, reviewNotes.arc_progress_risks, 'arc_progress_risks', '故事弧推进风险', 'high')
  pushIssues(issues, reviewNotes.typed_ref_risks, 'typed_ref_risks', 'Typed Ref 缺口', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.source_grounding_risks, 'source_grounding_risks', '来源 Grounding 风险', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.operating_mode_risks, 'operating_mode_risks', 'OperatingMode 违规', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.dialogue_separability_risks, 'dialogue_separability_risks', '对白可分离度', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.reader_hook_risks, 'reader_hook_risks', '追读风险', 'high')
  pushIssues(issues, reviewNotes.missing_payoffs, 'missing_payoffs', '伏笔未兑现', 'high')

  pushIssues(
    issues,
    reviewNotes.contract_validation?.status === 'blocker'
      ? reviewNotes.contract_validation?.rewriteHints || []
      : [],
    'contract_validation',
    '合同修补',
    'high',
  )

  pushIssues(issues, reviewNotes.context_drift_risks, 'context_drift_risks', '上下文漂移', reviewNotes.severity === 'high' ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.realism_risks, 'realism_risks', '真实度风险', reviewNotes.severity === 'high' ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.coherence_risks, 'coherence_risks', '连贯性风险', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.long_window_humanization_risks, 'long_window_humanization_risks', '长窗人类化风险', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.language_risks, 'language_risks', '语言风险', 'medium')
  pushIssues(issues, reviewNotes.human_language_repairs, 'human_language_repairs', '语言替换', 'medium')
  pushIssues(issues, reviewNotes.genre_hollowing_risks, 'genre_hollowing_risks', '体裁空心化', 'medium')
  pushIssues(issues, reviewNotes.dialogue_homogenization_risks, 'dialogue_homogenization_risks', '对白同质化', 'medium')
  pushIssues(issues, reviewNotes.dialogue_info_density_risks, 'dialogue_info_density_risks', '对白信息密度', 'medium')
  pushIssues(issues, reviewNotes.dialogue_filler_risks, 'dialogue_filler_risks', '对白空转', 'low')

  return issues.sort((left, right) => {
    const byPriority = getPriorityWeight(right.priority) - getPriorityWeight(left.priority)
    if (byPriority !== 0) return byPriority
    return getSourceWeight(right.source) - getSourceWeight(left.source)
  })
}

function resolveRewriteScope(
  topIssues: ReviewPriorityIssue[],
  requiresFullRewrite: boolean,
): ChapterRewriteScope {
  if (requiresFullRewrite) return 'chapter_rewrite'
  const onlyLanguageFixes = topIssues.length > 0 && topIssues.every((issue) => (
    issue.source === 'language_risks'
    || issue.source === 'human_language_repairs'
    || issue.source === 'dialogue_homogenization_risks'
    || issue.source === 'dialogue_filler_risks'
    || issue.source === 'dialogue_info_density_risks'
  ))
  if (onlyLanguageFixes) return 'paragraph_patch'
  return topIssues.length <= 2 ? 'scene_rewrite' : 'chapter_rewrite'
}

export function buildReviewPrioritySummary(reviewNotes: ChapterReviewNotesLike): ReviewPrioritySummary {
  const normalizedIssues = normalizePriorityIssues(reviewNotes)
  const topIssues = normalizedIssues.slice(0, 6)
  const deferredIssues = normalizedIssues.slice(6)
  const highIssueCount = normalizedIssues.filter((issue) => issue.priority === 'high').length
  const mediumIssueCount = normalizedIssues.filter((issue) => issue.priority === 'medium').length
  const lowIssueCount = normalizedIssues.filter((issue) => issue.priority === 'low').length
  const fullRewriteReasons = dedupeStrings([
    reviewNotes.critical_fixes.length >= 3 ? '关键修订达到 3 条以上，需要整章重写消化。' : '',
    reviewNotes.severity === 'high' ? '审校严重度为 high。' : '',
    reviewNotes.rewrite_required && highIssueCount >= 3 ? '高优先问题过多，局部修补不够。' : '',
    reviewNotes.contract_validation?.status === 'blocker' ? '合同兑现存在 blocker。' : '',
    reviewNotes.cost_resolution_state === 'evaporated' ? '代价被快速抹平，需要回到整章重排。' : '',
    reviewNotes.reversal_support_state === 'forced' ? '反转支撑不足，需要重排因果链。' : '',
  ])
  const requiresFullRewrite = fullRewriteReasons.length > 0
  const forceMaxCoverage = normalizedIssues.some((issue) => (
    issue.source === 'continuity_risks'
    || issue.source === 'arc_progress_risks'
    || issue.source === 'context_drift_risks'
    || issue.source === 'realism_risks'
    || issue.source === 'coherence_risks'
    || issue.source === 'missing_payoffs'
    || issue.source === 'contract_validation'
    || issue.source === 'typed_ref_risks'
    || issue.source === 'source_grounding_risks'
    || issue.source === 'operating_mode_risks'
    || issue.source === 'long_window_humanization_risks'
    || issue.source === 'dialogue_separability_risks'
  ))
  const rewriteScope = resolveRewriteScope(topIssues, requiresFullRewrite)

  return {
    topIssues,
    deferredIssues,
    rewriteScope,
    requiresFullRewrite,
    forceMaxCoverage,
    counts: {
      high: highIssueCount,
      medium: mediumIssueCount,
      low: lowIssueCount,
    },
    reasons: fullRewriteReasons.length > 0
      ? fullRewriteReasons
      : dedupeStrings([
        topIssues.length > 0 ? `本轮优先处理 ${topIssues.length} 个最高优先问题。` : '',
        deferredIssues.length > 0 ? `${deferredIssues.length} 个次级问题可延后到人工精修。` : '',
      ]),
  }
}

export function buildReviewPriorityPrompt(summary: ReviewPrioritySummary): string {
  const urgentLines = summary.topIssues.map((issue, index) => `${index + 1}. [${issue.label}] ${issue.detail}`)
  const deferredLines = summary.deferredIssues.slice(0, 4).map((issue, index) => `${index + 1}. [${issue.label}] ${issue.detail}`)
  return [
    '【重写优先级摘要】',
    `重写范围：${summary.rewriteScope}`,
    `整章重写：${summary.requiresFullRewrite ? '是' : '否'}`,
    `上下文覆盖：${summary.forceMaxCoverage ? '拉满' : '常规'}`,
    `优先问题统计：高 ${summary.counts.high} / 中 ${summary.counts.medium} / 低 ${summary.counts.low}`,
    summary.reasons.length > 0 ? `判断依据：${summary.reasons.join('；')}` : '',
    urgentLines.length > 0 ? '本轮先修：\n' + urgentLines.join('\n') : '',
    deferredLines.length > 0 ? '可延后处理：\n' + deferredLines.join('\n') : '',
  ].filter(Boolean).join('\n')
}

export function buildAdaptiveRewritePolicy(summary: ReviewPrioritySummary): RewriteAdaptivePolicy {
  return {
    temperatureCap: summary.requiresFullRewrite ? 0.7 : 0.55,
    contextStrategy: summary.forceMaxCoverage ? 'max_coverage' : 'balanced',
    reviewDepth: summary.requiresFullRewrite || summary.forceMaxCoverage ? 'deep' : 'standard',
    contextBudgetMultiplier: summary.forceMaxCoverage ? 1.28 : 1,
    rewriteScope: summary.rewriteScope,
    requiresFullRewrite: summary.requiresFullRewrite,
    reasons: dedupeStrings([
      summary.requiresFullRewrite ? '本轮按整章重写策略执行，放宽重写温度。': '',
      summary.forceMaxCoverage ? '高优先问题涉及连续性/上下文链，重写上下文扩大到 max coverage。' : '',
      !summary.requiresFullRewrite && !summary.forceMaxCoverage ? '问题集中在局部修补，可维持常规重写预算。': '',
    ]),
  }
}

export function buildRewriteMiniReviewVerdict(options: {
  originalContent: string
  rewrittenContent: string
  reviewPrioritySummary: ReviewPrioritySummary
  reviewNotes: ChapterReviewNotesLike
}): RewriteMiniReviewVerdict {
  const similarityToOriginal = computeCandidateSimilarity(options.originalContent, options.rewrittenContent)
  const needsHumanReview = Boolean(
    !options.rewrittenContent.trim()
    || (options.reviewPrioritySummary.requiresFullRewrite && similarityToOriginal >= 0.86)
    || (options.reviewNotes.severity === 'high' && similarityToOriginal >= 0.8)
  )
  const improved = !needsHumanReview && similarityToOriginal < 0.8
  const reason = !options.rewrittenContent.trim()
    ? '重写结果为空，需要人工介入。'
    : options.reviewPrioritySummary.requiresFullRewrite && similarityToOriginal >= 0.86
      ? '整章重写后与初稿仍高度相似，关键问题大概率没有被真正消化。'
      : options.reviewNotes.severity === 'high' && similarityToOriginal >= 0.8
        ? '高风险章节重写幅度不足，建议转人工复核。'
        : improved
          ? '重写结果与初稿已拉开差异，可继续走后续章节门。'
          : '重写结果有所调整，但仍建议重点复核关键问题。'

  return {
    improved,
    needsHumanReview,
    reason,
    similarityToOriginal,
  }
}
