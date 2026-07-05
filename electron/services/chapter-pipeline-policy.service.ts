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
  | 'step_memory_risks'
  | 'opening_hook_risks'
  | 'title_alignment_risks'
  | 'hallucination_risks'
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
  | 'reading_experience'
  | 'rewrite_delta'
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
  /** 拦截仅由重写差异门触发（正文非空且相似度硬条件未命中），可走结构性自动重试与发布门短路 */
  deltaDrivenOnly: boolean
  reason: string
  similarityToOriginal: number
  narrativeDelta: RewriteNarrativeDeltaReport
  readingExperience?: ChapterReadingExperienceScore
}

export interface ChapterReadingExperienceScore {
  score: number
  status: 'pass' | 'warning' | 'rewrite'
  summary: string
  risks: string[]
  recommendations: string[]
  metrics: {
    avgSentenceLength: number
    avgParagraphLength: number
    dialogueParagraphRate: number
    paragraphCount: number
    sentenceCount: number
  }
}

export interface RewriteNarrativeDeltaReport {
  status: 'pass' | 'weak' | 'fail'
  structuralIssueCount: number
  similarityToOriginal: number
  changedSentenceRate: number
  narrativeAnchorChangeRate: number
  actionVerbDeltaRate: number
  conflictChain: RewriteDeltaChainScore
  costChain: RewriteDeltaChainScore
  goalChain: RewriteDeltaChainScore
  findings: string[]
  recommendation: string
}

export interface RewriteDeltaChainScore {
  score: number
  status: 'pass' | 'weak' | 'fail'
  originalHitRate: number
  rewrittenHitRate: number
  deltaRate: number
  findings: string[]
}

interface ContractValidationLike {
  status?: 'pass' | 'warning' | 'blocker'
  rewriteHints?: string[]
}

function hasContractValidationBlocker(contractValidation?: ContractValidationLike): boolean {
  return contractValidation?.status === 'blocker'
}

export interface ChapterReviewNotesLike {
  critical_fixes: string[]
  continuity_risks: string[]
  arc_progress_risks: string[]
  context_drift_risks: string[]
  realism_risks: string[]
  coherence_risks: string[]
  reader_hook_risks: string[]
  step_memory_risks: string[]
  opening_hook_risks: string[]
  title_alignment_risks: string[]
  hallucination_risks: string[]
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
  reading_experience?: ChapterReadingExperienceScore
  rewrite_delta?: RewriteNarrativeDeltaReport
  contract_validation?: ContractValidationLike
}

const STRUCTURAL_REWRITE_SOURCES = new Set<ReviewPrioritySource>([
  'critical_fixes',
  'continuity_risks',
  'arc_progress_risks',
  'context_drift_risks',
  'realism_risks',
  'coherence_risks',
  'reader_hook_risks',
  'step_memory_risks',
  'opening_hook_risks',
  'title_alignment_risks',
  'hallucination_risks',
  'typed_ref_risks',
  'source_grounding_risks',
  'operating_mode_risks',
  'missing_payoffs',
  'contract_validation',
])

const ACTION_TOKENS = [
  '推', '拉', '撞', '抓', '拽', '按', '抬', '落', '走', '跑', '退', '躲', '藏',
  '打', '砸', '踢', '杀', '救', '拦', '追', '逃', '开', '关', '拿', '放', '递',
  '问', '答', '说', '喊', '盯', '看', '听', '站', '坐', '跪', '倒', '醒',
]

const RESULT_TOKENS = [
  '因此', '于是', '只好', '不得不', '结果', '后果', '代价', '失去', '失败',
  '暴露', '发现', '决定', '选择', '留下', '换来', '受伤', '死亡', '中断',
  '承认', '拒绝', '背叛', '回收', '兑现', '推进',
]

const CONFLICT_CHAIN_TOKENS = [
  '拦', '追', '逼', '压', '争', '抢', '拒', '阻', '威胁', '怀疑',
  '质问', '审问', '埋伏', '袭', '打', '伤', '逃', '躲', '骗', '失手',
  '冲突', '反制', '暴露',
]

const COST_CHAIN_TOKENS = [
  '代价', '失去', '失败', '受伤', '暴露', '欠', '牺牲', '放弃', '不得不',
  '只好', '换来', '留下', '后果', '惩罚', '损失', '破裂', '背叛', '拖累',
]

const GOAL_CHAIN_TOKENS = [
  '目标', '要', '为了', '决定', '选择', '追查', '找到', '拿到', '确认',
  '推进', '完成', '达成', '阻止', '夺回', '交出', '救出', '揭开', '回收',
]

const ABSTRACT_READING_TOKENS = [
  '命运', '意义', '情绪', '复杂', '沉重', '不可言说', '未来', '过去',
  '力量', '氛围', '似乎', '仿佛', '某种', '意识到', '理解', '背后',
]

const TEMPLATE_READING_CONNECTORS = [
  '然而', '与此同时', '这一刻', '于是', '就这样', '某种程度上',
]

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

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 10) / 10
}

function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/[。！？!?；;\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
}

function isDialogueParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim()
  return /^[“"「『]/.test(trimmed) || /^[^，。！？!?]{1,18}[：:]/.test(trimmed)
}

function countParagraphsWithTokens(paragraphs: string[], tokens: string[]): number {
  return paragraphs.filter((paragraph) => tokens.some((token) => paragraph.includes(token))).length
}

function countSentencesWithTokens(sentences: string[], tokens: string[]): number {
  return sentences.filter((sentence) => tokens.some((token) => sentence.includes(token))).length
}

function calculateSentenceTokenRate(sentences: string[], tokens: string[]): number {
  if (sentences.length === 0) return 0
  return roundMetric((countSentencesWithTokens(sentences, tokens) / sentences.length) * 100)
}

function buildRewriteDeltaChainScore(
  originalSentences: string[],
  rewrittenSentences: string[],
  tokens: string[],
  label: string,
  structuralPressure: boolean,
  surfaceRewriteSuspected: boolean,
): RewriteDeltaChainScore {
  const originalHitRate = calculateSentenceTokenRate(originalSentences, tokens)
  const rewrittenHitRate = calculateSentenceTokenRate(rewrittenSentences, tokens)
  const deltaRate = roundMetric(rewrittenHitRate - originalHitRate)
  const hasEnoughRewrittenEvidence = rewrittenHitRate >= 18
  const originalAlreadyDense = originalHitRate >= 18
  const score = clampScore(
    70
    + Math.max(-10, deltaRate) * 1.5
    + (rewrittenHitRate >= 24 ? 12 : rewrittenHitRate >= 18 ? 7 : rewrittenHitRate >= 14 ? 2 : -14),
  )
  const findings: string[] = []
  // 初稿与重写稿在该链上都几乎没有词面信号时（克制白描文风常见），链证据不可判定，不作为拦截依据
  const chainSignalAvailable = originalHitRate >= 8 || rewrittenHitRate >= 8

  if (structuralPressure && chainSignalAvailable && rewrittenHitRate < 14) {
    findings.push(`${label}证据密度仅 ${rewrittenHitRate}%，重写后仍缺少可见链条。`)
  }
  if (structuralPressure && chainSignalAvailable && !hasEnoughRewrittenEvidence && !originalAlreadyDense && deltaRate < 3) {
    findings.push(`${label}增量仅 ${deltaRate}%，更像改词句而不是修结构。`)
  }
  if (structuralPressure && chainSignalAvailable && surfaceRewriteSuspected && deltaRate < 3) {
    findings.push(`${label}几乎没有新增结构证据，整体改动幅度也偏低。`)
  }
  if (structuralPressure && originalAlreadyDense && deltaRate < -6) {
    findings.push(`${label}证据密度从 ${originalHitRate}% 降到 ${rewrittenHitRate}%，重写削弱了原有剧情链。`)
  }

  const status: RewriteDeltaChainScore['status'] = !structuralPressure || findings.length === 0
    ? 'pass'
    : findings.length >= 2 || score < 55
      ? 'fail'
      : 'weak'

  return {
    score,
    status,
    originalHitRate,
    rewrittenHitRate,
    deltaRate,
    findings,
  }
}

function buildSentenceSet(text: string): Set<string> {
  return new Set(splitSentences(text).map((item) => item.replace(/\s+/g, '')))
}

function calculateChangedSentenceRate(originalContent: string, rewrittenContent: string): number {
  const original = buildSentenceSet(originalContent)
  const rewritten = [...buildSentenceSet(rewrittenContent)]
  if (rewritten.length === 0) return 0
  const changed = rewritten.filter((sentence) => !original.has(sentence)).length
  return roundMetric((changed / rewritten.length) * 100)
}

function calculateNarrativeAnchorChangeRate(originalContent: string, rewrittenContent: string): number {
  const originalParagraphs = splitParagraphs(originalContent)
  const rewrittenParagraphs = splitParagraphs(rewrittenContent)
  if (rewrittenParagraphs.length === 0) return 0
  const originalAnchorCount = countParagraphsWithTokens(originalParagraphs, [...ACTION_TOKENS, ...RESULT_TOKENS])
  const rewrittenAnchorCount = countParagraphsWithTokens(rewrittenParagraphs, [...ACTION_TOKENS, ...RESULT_TOKENS])
  return roundMetric(((rewrittenAnchorCount - originalAnchorCount) / Math.max(rewrittenParagraphs.length, 1)) * 100)
}

function calculateActionVerbDeltaRate(originalContent: string, rewrittenContent: string): number {
  const originalSentences = splitSentences(originalContent)
  const rewrittenSentences = splitSentences(rewrittenContent)
  if (rewrittenSentences.length === 0) return 0
  const originalRate = countSentencesWithTokens(originalSentences, ACTION_TOKENS) / Math.max(originalSentences.length, 1)
  const rewrittenRate = countSentencesWithTokens(rewrittenSentences, ACTION_TOKENS) / Math.max(rewrittenSentences.length, 1)
  return roundMetric((rewrittenRate - originalRate) * 100)
}

function hasStructuralRewritePressure(summary: ReviewPrioritySummary, reviewNotes: ChapterReviewNotesLike): boolean {
  if (reviewNotes.cost_resolution_state === 'evaporated' || reviewNotes.reversal_support_state === 'forced') {
    return true
  }
  const structuralIssueCount = summary.topIssues
    .filter((issue) => STRUCTURAL_REWRITE_SOURCES.has(issue.source))
    .length
    + summary.deferredIssues
      .filter((issue) => STRUCTURAL_REWRITE_SOURCES.has(issue.source) && issue.priority === 'high')
      .length
  // 审校没有要求重写时，零散结构风险按润色处理，不触发强制结构差异门
  if (!reviewNotes.rewrite_required) return structuralIssueCount >= 3
  return structuralIssueCount >= 1
}

export function analyzeChapterReadingExperience(content: string): ChapterReadingExperienceScore {
  const paragraphs = splitParagraphs(content)
  const sentences = splitSentences(content)
  const totalSentenceChars = sentences.reduce((sum, sentence) => sum + sentence.replace(/\s+/g, '').length, 0)
  const totalParagraphChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.replace(/\s+/g, '').length, 0)
  const dialogueParagraphCount = paragraphs.filter(isDialogueParagraph).length
  const avgSentenceLength = roundMetric(sentences.length > 0 ? totalSentenceChars / sentences.length : 0)
  const avgParagraphLength = roundMetric(paragraphs.length > 0 ? totalParagraphChars / paragraphs.length : 0)
  const dialogueParagraphRate = roundMetric((dialogueParagraphCount / Math.max(paragraphs.length, 1)) * 100)
  const actionSentenceRate = roundMetric((countSentencesWithTokens(sentences, ACTION_TOKENS) / Math.max(sentences.length, 1)) * 100)
  const resultSentenceRate = roundMetric((countSentencesWithTokens(sentences, RESULT_TOKENS) / Math.max(sentences.length, 1)) * 100)
  const abstractSentenceRate = roundMetric((countSentencesWithTokens(sentences, ABSTRACT_READING_TOKENS) / Math.max(sentences.length, 1)) * 100)
  const templateConnectorRate = roundMetric((countSentencesWithTokens(sentences, TEMPLATE_READING_CONNECTORS) / Math.max(sentences.length, 1)) * 100)
  const veryLongSentenceRate = roundMetric((sentences.filter((sentence) => sentence.length >= 42).length / Math.max(sentences.length, 1)) * 100)
  const risks: string[] = []
  const recommendations: string[] = []
  let penalty = 0

  if (sentences.length < 8 && content.trim().length >= 600) {
    penalty += 18
    risks.push('句子切分过少，正文可能存在长句堆叠或标点异常。')
    recommendations.push('拆开长句，把动作、判断和结果分成更清楚的句群。')
  }
  if (avgSentenceLength > 34) {
    penalty += 18
    risks.push(`平均句长 ${avgSentenceLength} 字，阅读阻力偏高。`)
    recommendations.push('压缩解释句，改成动作句和短对白穿插。')
  } else if (avgSentenceLength < 9 && sentences.length >= 12) {
    penalty += 10
    risks.push(`平均句长 ${avgSentenceLength} 字，节奏可能过碎。`)
    recommendations.push('合并连续碎句，让关键动作和结果形成完整节拍。')
  }
  if (veryLongSentenceRate >= 22) {
    penalty += 14
    risks.push(`长句占比 ${veryLongSentenceRate}%，容易出现拖沓和信息拥堵。`)
    recommendations.push('把超过 40 字的句子拆成动作、反应和后果。')
  }
  if (avgParagraphLength > 260) {
    penalty += 16
    risks.push(`平均段长 ${avgParagraphLength} 字，段落过厚，连载阅读不够轻。`)
    recommendations.push('把大段说明拆成现场动作、对白和结果段。')
  }
  if (dialogueParagraphRate < 6 && paragraphs.length >= 8) {
    penalty += 10
    risks.push(`对白段占比 ${dialogueParagraphRate}%，人物互动偏少。`)
    recommendations.push('补一到两处带立场的对白，不要只让旁白解释。')
  }
  if (actionSentenceRate < 30 && sentences.length >= 4) {
    penalty += 16
    risks.push(`动作句占比 ${actionSentenceRate}%，场景推进偏弱。`)
    recommendations.push('每个关键段落补出人物动作、阻力和即时选择。')
  }
  if (resultSentenceRate < 12 && sentences.length >= 4) {
    penalty += 14
    risks.push(`结果/代价句占比 ${resultSentenceRate}%，剧情落点可能偏虚。`)
    recommendations.push('补清每场冲突带来的结果、损耗或下一步压力。')
  }
  if (abstractSentenceRate >= 55 && sentences.length >= 4) {
    penalty += 18
    risks.push(`抽象解释句占比 ${abstractSentenceRate}%，现场感和人物选择被概念判断挤掉。`)
    recommendations.push('把抽象解释改成具体动作、对白潜台词和可见后果。')
  }
  if (templateConnectorRate >= 35 && sentences.length >= 4) {
    penalty += 12
    risks.push(`模板承接句占比 ${templateConnectorRate}%，段落衔接容易像自动拼接。`)
    recommendations.push('用时间、空间、动作反馈承接段落，少用万能转场词。')
  }

  const score = clampScore(100 - penalty)
  const status: ChapterReadingExperienceScore['status'] = score < 62 || risks.length >= 4
    ? 'rewrite'
    : score < 80 || risks.length >= 2
      ? 'warning'
      : 'pass'

  return {
    score,
    status,
    summary: status === 'pass'
      ? `读感通过，当前得分 ${score}。`
      : status === 'rewrite'
        ? `读感未达长篇连载门槛，当前得分 ${score}。`
        : `读感存在可修复问题，当前得分 ${score}。`,
    risks,
    recommendations: dedupeStrings(recommendations).slice(0, 6),
    metrics: {
      avgSentenceLength,
      avgParagraphLength,
      dialogueParagraphRate,
      paragraphCount: paragraphs.length,
      sentenceCount: sentences.length,
    },
  }
}

export function analyzeRewriteNarrativeDelta(options: {
  originalContent: string
  rewrittenContent: string
  reviewPrioritySummary: ReviewPrioritySummary
  reviewNotes: ChapterReviewNotesLike
  similarityToOriginal?: number
}): RewriteNarrativeDeltaReport {
  const similarityToOriginal = typeof options.similarityToOriginal === 'number'
    ? options.similarityToOriginal
    : computeCandidateSimilarity(options.originalContent, options.rewrittenContent)
  const structuralIssueCount = [...options.reviewPrioritySummary.topIssues, ...options.reviewPrioritySummary.deferredIssues]
    .filter((issue) => STRUCTURAL_REWRITE_SOURCES.has(issue.source))
    .length
  const originalSentences = splitSentences(options.originalContent)
  const rewrittenSentences = splitSentences(options.rewrittenContent)
  if (
    Math.min(originalSentences.length, rewrittenSentences.length) < 4
    || Math.min(options.originalContent.trim().length, options.rewrittenContent.trim().length) < 120
  ) {
    const passChain = (): RewriteDeltaChainScore => ({
      score: 100,
      status: 'pass',
      originalHitRate: 0,
      rewrittenHitRate: 0,
      deltaRate: 0,
      findings: [],
    })
    return {
      status: 'pass',
      structuralIssueCount,
      similarityToOriginal: roundMetric(similarityToOriginal),
      changedSentenceRate: calculateChangedSentenceRate(options.originalContent, options.rewrittenContent),
      narrativeAnchorChangeRate: calculateNarrativeAnchorChangeRate(options.originalContent, options.rewrittenContent),
      actionVerbDeltaRate: calculateActionVerbDeltaRate(options.originalContent, options.rewrittenContent),
      conflictChain: passChain(),
      costChain: passChain(),
      goalChain: passChain(),
      findings: [],
      recommendation: '文本过短，跳过重写差异门禁。实际章节会继续走相似度和发布门检查。',
    }
  }
  const changedSentenceRate = calculateChangedSentenceRate(options.originalContent, options.rewrittenContent)
  const narrativeAnchorChangeRate = calculateNarrativeAnchorChangeRate(options.originalContent, options.rewrittenContent)
  const actionVerbDeltaRate = calculateActionVerbDeltaRate(options.originalContent, options.rewrittenContent)
  const structuralPressure = hasStructuralRewritePressure(options.reviewPrioritySummary, options.reviewNotes)
  const surfaceRewriteSuspected = similarityToOriginal >= 0.82 || changedSentenceRate < 24
  const conflictChain = buildRewriteDeltaChainScore(originalSentences, rewrittenSentences, CONFLICT_CHAIN_TOKENS, '冲突链', structuralPressure, surfaceRewriteSuspected)
  const costChain = buildRewriteDeltaChainScore(originalSentences, rewrittenSentences, COST_CHAIN_TOKENS, '代价链', structuralPressure, surfaceRewriteSuspected)
  const goalChain = buildRewriteDeltaChainScore(originalSentences, rewrittenSentences, GOAL_CHAIN_TOKENS, '目标链', structuralPressure, surfaceRewriteSuspected)
  const findings: string[] = []

  if (structuralPressure && similarityToOriginal >= 0.82) {
    findings.push('存在结构性问题，但重写后与初稿整体仍高度相似。')
  }
  if (structuralPressure && changedSentenceRate < 24) {
    findings.push(`新增/改动句比例仅 ${changedSentenceRate}%，不足以证明剧情链已重排。`)
  }
  if (structuralPressure && narrativeAnchorChangeRate < 4) {
    findings.push(`动作/结果锚点增量仅 ${narrativeAnchorChangeRate}%，更像语言润色而非剧情修复。`)
  }
  if (structuralPressure && actionVerbDeltaRate < 3) {
    findings.push(`动作句增量仅 ${actionVerbDeltaRate}%，冲突推进证据不足。`)
  }
  findings.push(...conflictChain.findings, ...costChain.findings, ...goalChain.findings)

  const status: RewriteNarrativeDeltaReport['status'] = !structuralPressure
    ? 'pass'
    : findings.length >= 3 || [conflictChain, costChain, goalChain].filter((chain) => chain.status === 'fail').length >= 2
      ? 'fail'
    : findings.length > 0
        ? 'weak'
        : 'pass'

  return {
    status,
    structuralIssueCount,
    similarityToOriginal: roundMetric(similarityToOriginal),
    changedSentenceRate,
    narrativeAnchorChangeRate,
    actionVerbDeltaRate,
    conflictChain,
    costChain,
    goalChain,
    findings,
    recommendation: status === 'pass'
      ? '重写差异足以进入后续门禁。'
      : '回到审校高优先项，补真实事件变化、冲突结果、代价和伏笔推进；不要只替换词句。',
  }
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
    step_memory_risks: 9,
    opening_hook_risks: 9,
    title_alignment_risks: 8,
    hallucination_risks: 8,
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
    reading_experience: 6,
    rewrite_delta: 12,
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
  pushIssues(issues, reviewNotes.step_memory_risks, 'step_memory_risks', '步骤接力风险', 'high')
  pushIssues(issues, reviewNotes.opening_hook_risks, 'opening_hook_risks', '开篇吸引力风险', 'high')
  pushIssues(issues, reviewNotes.title_alignment_risks, 'title_alignment_risks', '标题贴合风险', reviewNotes.rewrite_required ? 'high' : 'medium')
  pushIssues(issues, reviewNotes.hallucination_risks, 'hallucination_risks', '幻觉/无来源新增', 'high')
  pushIssues(issues, reviewNotes.reader_hook_risks, 'reader_hook_risks', '追读风险', 'high')
  pushIssues(issues, reviewNotes.missing_payoffs, 'missing_payoffs', '伏笔未兑现', 'high')

  pushIssues(
    issues,
    hasContractValidationBlocker(reviewNotes.contract_validation)
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
  pushIssues(
    issues,
    reviewNotes.reading_experience && reviewNotes.reading_experience.status !== 'pass'
      ? reviewNotes.reading_experience.risks
      : [],
    'reading_experience',
    '章节读感',
    reviewNotes.reading_experience?.status === 'rewrite' ? 'high' : 'medium',
  )
  pushIssues(
    issues,
    reviewNotes.rewrite_delta && reviewNotes.rewrite_delta.status !== 'pass'
      ? reviewNotes.rewrite_delta.findings
      : [],
    'rewrite_delta',
    '重写差异验证',
    reviewNotes.rewrite_delta?.status === 'fail' ? 'high' : 'medium',
  )

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
    hasContractValidationBlocker(reviewNotes.contract_validation) ? '合同兑现存在 blocker。' : '',
    reviewNotes.cost_resolution_state === 'evaporated' ? '代价被快速抹平，需要回到整章重排。' : '',
    reviewNotes.reversal_support_state === 'forced' ? '反转支撑不足，需要重排因果链。' : '',
    reviewNotes.reading_experience?.status === 'rewrite' ? '章节读感低于长篇连载门槛。' : '',
    reviewNotes.rewrite_delta?.status === 'fail' ? '重写差异验证失败，疑似只润色语言没有修剧情。' : '',
    reviewNotes.opening_hook_risks.length > 0 && reviewNotes.rewrite_required ? '开篇吸引力未过线，需要优先重排章首和章尾递进。' : '',
    reviewNotes.step_memory_risks.length > 0 && reviewNotes.rewrite_required ? '步骤接力断裂，需要回到上游计划与正文执行链整体修复。' : '',
    reviewNotes.hallucination_risks.length > 0 ? '存在无来源新增或推断升级，必须回收幻觉设定。' : '',
  ])
  const requiresFullRewrite = fullRewriteReasons.length > 0
  const forceMaxCoverage = normalizedIssues.some((issue) => (
    issue.source === 'continuity_risks'
    || issue.source === 'arc_progress_risks'
    || issue.source === 'context_drift_risks'
    || issue.source === 'realism_risks'
    || issue.source === 'coherence_risks'
    || issue.source === 'step_memory_risks'
    || issue.source === 'opening_hook_risks'
    || issue.source === 'title_alignment_risks'
    || issue.source === 'hallucination_risks'
    || issue.source === 'missing_payoffs'
    || issue.source === 'contract_validation'
    || issue.source === 'typed_ref_risks'
    || issue.source === 'source_grounding_risks'
    || issue.source === 'operating_mode_risks'
    || issue.source === 'long_window_humanization_risks'
    || issue.source === 'dialogue_separability_risks'
    || issue.source === 'reading_experience'
    || issue.source === 'rewrite_delta'
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
  const readingExperience = analyzeChapterReadingExperience(options.rewrittenContent)
  const narrativeDelta = analyzeRewriteNarrativeDelta({
    originalContent: options.originalContent,
    rewrittenContent: options.rewrittenContent,
    reviewPrioritySummary: options.reviewPrioritySummary,
    reviewNotes: options.reviewNotes,
    similarityToOriginal,
  })
  const surfaceSimilarityTripped = Boolean(
    !options.rewrittenContent.trim()
    || (options.reviewPrioritySummary.requiresFullRewrite && similarityToOriginal >= 0.86)
    || (options.reviewNotes.severity === 'high' && similarityToOriginal >= 0.8),
  )
  const needsHumanReview = Boolean(
    surfaceSimilarityTripped
    || narrativeDelta.status === 'fail'
    || (narrativeDelta.status === 'weak' && readingExperience.status === 'rewrite')
  )
  const deltaDrivenOnly = needsHumanReview && !surfaceSimilarityTripped
  const improved = !needsHumanReview
    && similarityToOriginal < 0.8
    && narrativeDelta.status === 'pass'
    && readingExperience.status !== 'rewrite'
  const reason = !options.rewrittenContent.trim()
    ? '重写结果为空，需要人工介入。'
    : options.reviewPrioritySummary.requiresFullRewrite && similarityToOriginal >= 0.86
      ? '整章重写后与初稿仍高度相似，关键问题大概率没有被真正消化。'
      : options.reviewNotes.severity === 'high' && similarityToOriginal >= 0.8
        ? '高风险章节重写幅度不足，建议转人工复核。'
        : narrativeDelta.status === 'fail'
          ? `重写差异验证失败：${narrativeDelta.findings.join('；') || narrativeDelta.recommendation}`
          : narrativeDelta.status === 'weak' && readingExperience.status === 'rewrite'
            ? `重写差异仍偏弱，且读感未过线：${readingExperience.summary}`
            : improved
              ? '重写结果与初稿已拉开差异，可继续走后续章节门。'
              : readingExperience.status === 'rewrite'
                ? `重写结果有所调整，但章节读感仍需复核：${readingExperience.summary}`
                : narrativeDelta.status === 'weak'
                  ? `重写结果有所调整，但结构修复证据偏弱：${narrativeDelta.findings.join('；')}`
                  : '重写结果有所调整，但仍建议重点复核关键问题。'

  return {
    improved,
    needsHumanReview,
    deltaDrivenOnly,
    reason,
    similarityToOriginal,
    narrativeDelta,
    readingExperience,
  }
}

export function buildStructuralRepairDirective(delta: RewriteNarrativeDeltaReport): string {
  if (delta.status === 'pass') return ''
  return [
    '【结构性修复指令（重写差异门未过，本轮必须改事件，不是改词句）】',
    `上一轮重写与初稿相似度 ${delta.similarityToOriginal}，改动句比例 ${delta.changedSentenceRate}%，动作/结果锚点增量 ${delta.narrativeAnchorChangeRate}%。`,
    delta.findings.length > 0
      ? `差异门具体不通过项：\n${delta.findings.map((item) => `- ${item}`).join('\n')}`
      : '',
    '本轮硬性要求：',
    '- 对照审校高优先项，至少改变 2 处事件走向、结果状态或代价落点（新增阻力、失败、暴露、损失或让步），并让后文自然承接这些变化。',
    '- 冲突必须有正面交锋和明确结果，不允许停在气氛渲染和心理描写；每个主要场景以可见的状态变化收束。',
    '- 主角每获得一次进展，同一场景内写出为此付出的代价或新增的风险。',
    '- 不改变已确认的人物设定、世界规则和前文事实；结构修复以本章事件层为限。',
  ].filter(Boolean).join('\n')
}
