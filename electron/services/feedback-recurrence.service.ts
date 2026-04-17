import { eq } from 'drizzle-orm'
import type {
  FeedbackRecurrenceAlert,
  FeedbackRecurrenceIssueDetail,
  FeedbackRecurrenceIssueType,
  FeedbackRecurrencePromotedIssueSummary,
  FeedbackRecurrenceSource,
  FeedbackRecurrenceTrendSummary,
} from '../../src/types'
import { getDb } from '../database/db'
import { antiAiRuleHits, chapterGateRuns, chapters, revisionTasks } from '../database/schema'
import { safeParseStringArray } from './chapter-gate-utils'

type ReviewSeverity = 'low' | 'medium' | 'high'

type FeedbackDescriptor = {
  title: string
  avoid: string
  prefer?: string
  pauseOnBatch: boolean
  relatedPage: 'writing' | 'contracts' | 'threads'
}

type FeedbackRecurrenceHitRowLike = {
  chapterId: number | null
  chapterNum: number | null
  issueType: FeedbackRecurrenceIssueType
  title: string
  severity: ReviewSeverity
  source: FeedbackRecurrenceSource
  detail: string
}

type FeedbackRecurrenceChapterSignal = {
  chapterId: number
  chapterNum: number
  hitCount: number
  promotedIssueCount: number
  highRiskIssueCount: number
  pauseSuggestedIssueCount: number
  issues: FeedbackRecurrenceIssueDetail[]
}

export interface FeedbackRecurrenceDashboardSummary {
  overview: {
    totalHitCount: number
    hitChapterCount: number
    recurringIssueCount: number
    promotedIssueCount: number
    highRiskIssueCount: number
    pauseSuggestedIssueCount: number
  }
  topRepeatedIssues: FeedbackRecurrenceTrendSummary[]
  promotedIssues: FeedbackRecurrencePromotedIssueSummary[]
  recentAlerts: FeedbackRecurrenceAlert[]
  chapterSignals: FeedbackRecurrenceChapterSignal[]
}

type ParsedReviewState = {
  severity: ReviewSeverity
  costEvaporation: boolean
  costSummary: string
  forcedReversal: boolean
  reversalSummary: string
  tooSmooth: boolean
  continuityRisks: string[]
  contextDriftRisks: string[]
  arcProgressRisks: string[]
  missingPayoffs: string[]
  dialogueHomogenizationRisks: string[]
  dialogueDriftAlerts: string[]
  crossCharacterSimilarity: string[]
  dialogueFillerRisks: string[]
  dialogueInfoDensityRisks: string[]
  contractValidationStatus?: 'pass' | 'warning' | 'blocker'
}

const FEEDBACK_DESCRIPTOR_MAP: Record<FeedbackRecurrenceIssueType, FeedbackDescriptor> = {
  cost_evaporation: {
    title: '代价蒸发',
    avoid: '不要把伤势、资源损耗或关系裂痕写成无后果收束。',
    prefer: '让代价继续挤压角色选择，并在行动里兑现余波。',
    pauseOnBatch: true,
    relatedPage: 'writing',
  },
  forced_reversal: {
    title: '强行反转',
    avoid: '不要先抛反转结果，再回头补理由。',
    prefer: '先补触发链、铺垫证据和角色误判，再推反转。',
    pauseOnBatch: true,
    relatedPage: 'writing',
  },
  too_smooth: {
    title: '过度顺滑',
    avoid: '不要让主角在几乎无受挫、无代价的情况下连续拿到回报。',
    prefer: '补出阻力、失误、交换成本或延迟兑现。',
    pauseOnBatch: false,
    relatedPage: 'writing',
  },
  ai_slogan: {
    title: '口号化升华',
    avoid: '不要让口号化判断、伪哲学总结和抽象升华替代叙事本身。',
    prefer: '把判断落到动作、代价和可验证后果。',
    pauseOnBatch: false,
    relatedPage: 'writing',
  },
  template_emotion: {
    title: '模板情绪',
    avoid: '不要用通用情绪句和模板动作包办人物反应。',
    prefer: '改成角色特有的身体反应、说话方式和即时选择。',
    pauseOnBatch: false,
    relatedPage: 'writing',
  },
  pov_drift: {
    title: '视角漂移',
    avoid: '不要在固定视角作品中混用 POV、越权读取他人认知或跳出当前视点。',
    prefer: '把信息限制在当前视角能看到、听到、推断到的范围内。',
    pauseOnBatch: true,
    relatedPage: 'contracts',
  },
  thread_stalled: {
    title: '线程停滞',
    avoid: '不要让已承诺的主线、伏笔或章节目标停在只提及不推进的状态。',
    prefer: '让线索、冲突或兑现状态产生可验证变化。',
    pauseOnBatch: true,
    relatedPage: 'threads',
  },
  dialogue_homogenized: {
    title: '对白同质化',
    avoid: '不要让角色对白在句长、口气和用词上越来越像同一个人。',
    prefer: '按身份、关系和处境拆开对白节奏与潜台词，并把高风险角色升级为下一章 voice lock。',
    pauseOnBatch: false,
    relatedPage: 'writing',
  },
}

const POV_KEYWORDS = ['POV', '视角', '视点', '人称', '认知', '越权', '旁白']
const AI_SLOGAN_RULE_CODES = new Set([
  'ai_slogan',
  'ai_pseudo_philosophy',
  'abstract_emotion_packaging',
  'ai_ending_summary',
])
const TEMPLATE_EMOTION_RULE_CODES = new Set([
  'template_emotion',
  'ai_emotional_cliche',
  'ai_action_cliche',
  'ai_description_cliche',
  'ai_transition_cliche',
  'ai_dialogue_filler',
])

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function runQueryAll<T>(query: unknown): T[] {
  if (!query || typeof query !== 'object') return []
  const direct = query as { all?: () => T[]; orderBy?: (...args: unknown[]) => { all?: () => T[] } }
  if (typeof direct.all === 'function') return direct.all()
  if (typeof direct.orderBy === 'function') {
    const ordered = direct.orderBy()
    if (ordered && typeof ordered.all === 'function') return ordered.all()
  }
  return []
}

function severityRank(value: ReviewSeverity): number {
  if (value === 'high') return 3
  if (value === 'medium') return 2
  return 1
}

function compactLine(text: string, maxLength = 96): string {
  const normalized = asText(text).replace(/\s+/g, ' ')
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function buildSection(title: string, lines: string[]): string {
  const normalized = [...new Set(lines.map((line) => compactLine(line)).filter(Boolean))].slice(0, 6)
  if (normalized.length === 0) return ''
  return [`${title}`, ...normalized.map((line) => `- ${line}`)].join('\n')
}

function parseUnknownStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = asText(text)
  return Boolean(normalized) && keywords.some((keyword) => normalized.includes(keyword))
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function latestGateRowComparator(
  left: typeof chapterGateRuns.$inferSelect,
  right: typeof chapterGateRuns.$inferSelect,
): number {
  const leftTime = Date.parse(left.createdAt || '')
  const rightTime = Date.parse(right.createdAt || '')
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return rightTime - leftTime
  }
  return (right.id || 0) - (left.id || 0)
}

function countConsecutivePromotions(chapterNums: number[]): number {
  const sorted = [...new Set(chapterNums)].sort((left, right) => left - right)
  let count = 0
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] === 1) count += 1
  }
  return count
}

function hasThreeHitsWithinFiveChapters(chapterNums: number[]): boolean {
  const sorted = [...new Set(chapterNums)].sort((left, right) => left - right)
  for (let index = 0; index <= sorted.length - 3; index += 1) {
    if (sorted[index + 2] - sorted[index] <= 4) return true
  }
  return false
}

function isPromotedForUpcomingChapter(chapterNums: number[], targetChapterNum: number): boolean {
  const sorted = [...new Set(chapterNums.filter((num) => num < targetChapterNum))].sort((left, right) => left - right)
  if (sorted.includes(targetChapterNum - 1) && sorted.includes(targetChapterNum - 2)) return true
  return hasThreeHitsWithinFiveChapters(sorted)
}

function buildAlertDetail(summary: FeedbackRecurrenceTrendSummary, highRisk: boolean): string {
  if (highRisk) {
    return summary.pauseSuggested
      ? `${summary.title} 在 5 章窗口内已至少出现 3 次，建议暂停批量生成并回查 ${summary.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}。`
      : `${summary.title} 在 5 章窗口内已至少出现 3 次，需要回头做专项修订。`
  }
  return `${summary.title} 已连续两章复现，下一章应升级为硬约束。`
}

function parseReviewState(raw?: string | null): ParsedReviewState {
  const fallback: ParsedReviewState = {
    severity: 'low',
    costEvaporation: false,
    costSummary: '',
    forcedReversal: false,
    reversalSummary: '',
    tooSmooth: false,
    continuityRisks: [],
    contextDriftRisks: [],
    arcProgressRisks: [],
    missingPayoffs: [],
    dialogueHomogenizationRisks: [],
    dialogueDriftAlerts: [],
    crossCharacterSimilarity: [],
    dialogueFillerRisks: [],
    dialogueInfoDensityRisks: [],
  }
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const protagonistSetback = typeof parsed.protagonist_setback === 'string' ? parsed.protagonist_setback : 'none'
    const rewardState = typeof parsed.reward_state === 'string' ? parsed.reward_state : 'none'
    const costPresent = parsed.cost_present === true
    const contractValidation = parsed.contract_validation && typeof parsed.contract_validation === 'object'
      ? parsed.contract_validation as Record<string, unknown>
      : null
    return {
      severity: normalizeSeverity(parsed.severity),
      costEvaporation: parsed.cost_resolution_state === 'evaporated',
      costSummary: asText(parsed.cost_summary),
      forcedReversal: parsed.reversal_marker === true && parsed.reversal_support_state === 'forced',
      reversalSummary: asText(parsed.reversal_summary),
      tooSmooth: protagonistSetback === 'none' && (rewardState === 'partial' || rewardState === 'major') && !costPresent,
      continuityRisks: parseUnknownStringArray(parsed.continuity_risks),
      contextDriftRisks: parseUnknownStringArray(parsed.context_drift_risks),
      arcProgressRisks: parseUnknownStringArray(parsed.arc_progress_risks),
      missingPayoffs: parseUnknownStringArray(parsed.missing_payoffs),
      dialogueHomogenizationRisks: parseUnknownStringArray(parsed.dialogue_homogenization_risks),
      dialogueDriftAlerts: Array.isArray(parsed.dialogue_drift_alerts)
        ? parsed.dialogue_drift_alerts
          .map((item) => item && typeof item === 'object' ? asText((item as Record<string, unknown>).reason) : '')
          .filter(Boolean)
        : [],
      crossCharacterSimilarity: Array.isArray(parsed.cross_character_similarity)
        ? parsed.cross_character_similarity
          .map((item) => item && typeof item === 'object' ? asText((item as Record<string, unknown>).reason) : '')
          .filter(Boolean)
        : [],
      dialogueFillerRisks: parseUnknownStringArray(parsed.dialogue_filler_risks),
      dialogueInfoDensityRisks: parseUnknownStringArray(parsed.dialogue_info_density_risks),
      contractValidationStatus: contractValidation?.status === 'pass' || contractValidation?.status === 'warning' || contractValidation?.status === 'blocker'
        ? contractValidation.status
        : undefined,
    }
  } catch {
    return fallback
  }
}

function pushHit(
  rows: FeedbackRecurrenceHitRowLike[],
  hit: FeedbackRecurrenceHitRowLike,
): void {
  const alreadyExists = rows.some((row) =>
    row.chapterId === hit.chapterId
    && row.issueType === hit.issueType
    && row.source === hit.source
    && row.detail === hit.detail,
  )
  if (!alreadyExists) rows.push(hit)
}

function mapAntiAiRuleCodeToIssueType(ruleCode: string): FeedbackRecurrenceIssueType | null {
  if (AI_SLOGAN_RULE_CODES.has(ruleCode)) return 'ai_slogan'
  if (TEMPLATE_EMOTION_RULE_CODES.has(ruleCode)) return 'template_emotion'
  return null
}

function buildChapterHits(params: {
  chapter: Pick<typeof chapters.$inferSelect, 'id' | 'chapterNum' | 'reviewNotesJson'>
  gate?: typeof chapterGateRuns.$inferSelect
  antiAiRows: Array<typeof antiAiRuleHits.$inferSelect>
}): FeedbackRecurrenceHitRowLike[] {
  const hits: FeedbackRecurrenceHitRowLike[] = []
  const review = parseReviewState(params.chapter.reviewNotesJson)
  const gateIssueKeys = params.gate ? safeParseStringArray(params.gate.topIssueKeysJson) : []
  const gateIssueSet = new Set(gateIssueKeys)
  const chapterId = params.chapter.id
  const chapterNum = params.chapter.chapterNum

  if (review.costEvaporation) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'cost_evaporation',
      title: FEEDBACK_DESCRIPTOR_MAP.cost_evaporation.title,
      severity: 'high',
      source: 'review',
      detail: review.costSummary || '本章已经出现代价被快速抹平的问题。',
    })
  }

  if (review.forcedReversal) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'forced_reversal',
      title: FEEDBACK_DESCRIPTOR_MAP.forced_reversal.title,
      severity: 'high',
      source: 'review',
      detail: review.reversalSummary || '本章反转缺少足够铺垫与触发链。',
    })
  }

  if (review.tooSmooth) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'too_smooth',
      title: FEEDBACK_DESCRIPTOR_MAP.too_smooth.title,
      severity: review.severity === 'high' ? 'high' : 'medium',
      source: 'review',
      detail: '主角回报明显高于受挫与代价，章节阻力不足。',
    })
  }

  const driftSignals = [...review.contextDriftRisks, ...review.continuityRisks]
  const povDriftDetail = driftSignals.find((item) => containsAny(item, POV_KEYWORDS)) || review.contextDriftRisks[0] || review.continuityRisks[0] || ''
  if (gateIssueSet.has('pov_purity') || povDriftDetail) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'pov_drift',
      title: FEEDBACK_DESCRIPTOR_MAP.pov_drift.title,
      severity: gateIssueSet.has('pov_purity') || review.severity === 'high' ? 'high' : 'medium',
      source: gateIssueSet.has('pov_purity') ? 'chapter_gate' : 'review',
      detail: povDriftDetail || '章节视角边界已经开始漂移。',
    })
  }

  const threadDetail = review.missingPayoffs[0] || review.arcProgressRisks[0] || ''
  const hasThreadGateSignal = gateIssueSet.has('thread_progress')
    || gateIssueSet.has('line_progress')
    || gateIssueKeys.some((key) => key.startsWith('contract_delivery:foreshadow_delivery:'))
    || gateIssueKeys.some((key) => key.startsWith('contract_delivery:story_thread_progress:'))
  if (hasThreadGateSignal || review.missingPayoffs.length > 0 || review.arcProgressRisks.length > 0) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'thread_stalled',
      title: FEEDBACK_DESCRIPTOR_MAP.thread_stalled.title,
      severity: hasThreadGateSignal || review.contractValidationStatus === 'blocker' ? 'high' : 'medium',
      source: hasThreadGateSignal
        ? 'chapter_gate'
        : review.contractValidationStatus && review.contractValidationStatus !== 'pass'
          ? 'contract_validation'
          : 'review',
      detail: threadDetail || '本章承诺的主线、伏笔或推进事项没有形成有效变化。',
    })
  }

  const dialogueSignals = [
    ...review.dialogueHomogenizationRisks,
    ...review.dialogueDriftAlerts,
    ...review.crossCharacterSimilarity,
    ...review.dialogueFillerRisks,
    ...review.dialogueInfoDensityRisks,
  ]
  if (gateIssueSet.has('dialogue_voice') || dialogueSignals.length > 0) {
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType: 'dialogue_homogenized',
      title: FEEDBACK_DESCRIPTOR_MAP.dialogue_homogenized.title,
      severity: gateIssueSet.has('dialogue_voice') || dialogueSignals.length >= 3 || review.severity === 'high'
        ? 'high'
        : 'medium',
      source: gateIssueSet.has('dialogue_voice') ? 'chapter_gate' : 'review',
      detail: dialogueSignals[0] || '角色对白辨识度正在下降，口吻越来越同质化。',
    })
  }

  params.antiAiRows.forEach((row) => {
    const issueType = mapAntiAiRuleCodeToIssueType(asText(row.ruleCode))
    if (!issueType) return
    pushHit(hits, {
      chapterId,
      chapterNum,
      issueType,
      title: FEEDBACK_DESCRIPTOR_MAP[issueType].title,
      severity: normalizeSeverity(row.severity),
      source: 'anti_ai',
      detail: asText(row.detail) || asText(row.ruleTitle) || asText(row.excerpt) || FEEDBACK_DESCRIPTOR_MAP[issueType].avoid,
    })
  })

  return hits
}

export function summarizeFeedbackRecurrenceHits(rows: FeedbackRecurrenceHitRowLike[]): FeedbackRecurrenceDashboardSummary {
  const grouped = new Map<FeedbackRecurrenceIssueType, FeedbackRecurrenceTrendSummary>()
  const chapterSignals = new Map<number, {
    chapterId: number
    chapterNum: number
    issues: Map<FeedbackRecurrenceIssueType, FeedbackRecurrenceIssueDetail>
    hitCount: number
  }>()
  const hitChapterNums = new Set<number>()

  rows.forEach((row) => {
    const chapterId = typeof row.chapterId === 'number' ? row.chapterId : null
    const chapterNum = typeof row.chapterNum === 'number' ? row.chapterNum : null
    if (!chapterId || !chapterNum) return

    hitChapterNums.add(chapterNum)
    const descriptor = FEEDBACK_DESCRIPTOR_MAP[row.issueType]
    const currentSummary = grouped.get(row.issueType) || {
      issueType: row.issueType,
      title: descriptor.title,
      severity: row.severity,
      chapterCount: 0,
      hitCount: 0,
      promotedCount: 0,
      chapterNums: [],
      lastChapterNum: chapterNum,
      sourceBreakdown: {
        review: 0,
        chapter_gate: 0,
        contract_validation: 0,
        anti_ai: 0,
      },
      detail: row.detail || descriptor.avoid,
      pauseSuggested: false,
    }
    currentSummary.hitCount += 1
    currentSummary.sourceBreakdown[row.source] += 1
    if (!currentSummary.chapterNums.includes(chapterNum)) {
      currentSummary.chapterNums.push(chapterNum)
      currentSummary.chapterNums.sort((left, right) => left - right)
      currentSummary.chapterCount = currentSummary.chapterNums.length
      currentSummary.promotedCount = countConsecutivePromotions(currentSummary.chapterNums)
    }
    currentSummary.lastChapterNum = Math.max(currentSummary.lastChapterNum, chapterNum)
    if (severityRank(row.severity) > severityRank(currentSummary.severity)) currentSummary.severity = row.severity
    if (!currentSummary.detail) currentSummary.detail = row.detail || descriptor.avoid
    currentSummary.pauseSuggested = descriptor.pauseOnBatch && hasThreeHitsWithinFiveChapters(currentSummary.chapterNums)
    grouped.set(row.issueType, currentSummary)

    const currentChapter = chapterSignals.get(chapterId) || {
      chapterId,
      chapterNum,
      issues: new Map<FeedbackRecurrenceIssueType, FeedbackRecurrenceIssueDetail>(),
      hitCount: 0,
    }
    currentChapter.hitCount += 1
    const currentIssue = currentChapter.issues.get(row.issueType) || {
      issueType: row.issueType,
      title: descriptor.title,
      severity: row.severity,
      source: row.source,
      detail: row.detail || descriptor.avoid,
      promotedToHardConstraint: false,
      pauseSuggested: false,
    }
    if (severityRank(row.severity) > severityRank(currentIssue.severity)) {
      currentIssue.severity = row.severity
      currentIssue.source = row.source
      currentIssue.detail = row.detail || descriptor.avoid
    }
    currentChapter.issues.set(row.issueType, currentIssue)
    chapterSignals.set(chapterId, currentChapter)
  })

  const summaries = [...grouped.values()]
    .map((summary) => ({
      ...summary,
      promotedCount: countConsecutivePromotions(summary.chapterNums),
      pauseSuggested: FEEDBACK_DESCRIPTOR_MAP[summary.issueType].pauseOnBatch && hasThreeHitsWithinFiveChapters(summary.chapterNums),
    }))
    .sort((left, right) => right.chapterCount - left.chapterCount || right.lastChapterNum - left.lastChapterNum || left.title.localeCompare(right.title))

  const promotedIssues = summaries
    .filter((summary) => summary.promotedCount > 0 || hasThreeHitsWithinFiveChapters(summary.chapterNums))
    .map<FeedbackRecurrencePromotedIssueSummary>((summary) => {
      const descriptor = FEEDBACK_DESCRIPTOR_MAP[summary.issueType]
      return {
        issueType: summary.issueType,
        title: summary.title,
        chapterNums: summary.chapterNums.slice(-5),
        avoid: descriptor.avoid,
        prefer: descriptor.prefer,
        pauseSuggested: descriptor.pauseOnBatch && hasThreeHitsWithinFiveChapters(summary.chapterNums),
      }
    })
    .slice(0, 6)

  const recentAlerts = summaries
    .filter((summary) => summary.promotedCount > 0 || hasThreeHitsWithinFiveChapters(summary.chapterNums))
    .map<FeedbackRecurrenceAlert>((summary) => {
      const highRisk = hasThreeHitsWithinFiveChapters(summary.chapterNums)
      const pauseSuggested = FEEDBACK_DESCRIPTOR_MAP[summary.issueType].pauseOnBatch && highRisk
      return {
        issueType: summary.issueType,
        title: summary.title,
        severity: highRisk ? 'critical' : 'warning',
        chapterNums: summary.chapterNums.slice(-5),
        lastChapterNum: summary.lastChapterNum,
        detail: buildAlertDetail({ ...summary, pauseSuggested }, highRisk),
        pauseSuggested,
      }
    })
    .sort((left, right) => {
      const severityDelta = (right.severity === 'critical' ? 1 : 0) - (left.severity === 'critical' ? 1 : 0)
      if (severityDelta !== 0) return severityDelta
      return right.lastChapterNum - left.lastChapterNum || left.title.localeCompare(right.title)
    })

  const chapterSignalList = [...chapterSignals.values()]
    .map<FeedbackRecurrenceChapterSignal>((signal) => {
      const issues = [...signal.issues.values()]
        .map((issue) => {
          const summary = grouped.get(issue.issueType)
          const chapterNums = summary?.chapterNums || []
          const promotedToHardConstraint = chapterNums.includes(signal.chapterNum) && chapterNums.includes(signal.chapterNum - 1)
          const pauseSuggested = FEEDBACK_DESCRIPTOR_MAP[issue.issueType].pauseOnBatch && hasThreeHitsWithinFiveChapters(chapterNums)
          return {
            ...issue,
            promotedToHardConstraint,
            pauseSuggested,
          }
        })
        .sort((left, right) => severityRank(right.severity) - severityRank(left.severity) || left.title.localeCompare(right.title))
      return {
        chapterId: signal.chapterId,
        chapterNum: signal.chapterNum,
        hitCount: signal.hitCount,
        promotedIssueCount: issues.filter((issue) => issue.promotedToHardConstraint).length,
        highRiskIssueCount: issues.filter((issue) => hasThreeHitsWithinFiveChapters(grouped.get(issue.issueType)?.chapterNums || [])).length,
        pauseSuggestedIssueCount: issues.filter((issue) => issue.pauseSuggested).length,
        issues,
      }
    })
    .sort((left, right) => right.chapterNum - left.chapterNum)

  const highRiskIssueCount = summaries.filter((summary) => hasThreeHitsWithinFiveChapters(summary.chapterNums)).length
  const pauseSuggestedIssueCount = summaries.filter((summary) => summary.pauseSuggested).length

  return {
    overview: {
      totalHitCount: rows.length,
      hitChapterCount: hitChapterNums.size,
      recurringIssueCount: summaries.filter((summary) => summary.chapterCount >= 2).length,
      promotedIssueCount: summaries.filter((summary) => summary.promotedCount > 0).length,
      highRiskIssueCount,
      pauseSuggestedIssueCount,
    },
    topRepeatedIssues: summaries.slice(0, 8),
    promotedIssues,
    recentAlerts: recentAlerts.slice(0, 8),
    chapterSignals: chapterSignalList,
  }
}

function loadFeedbackRecurrenceHits(
  novelId: number,
  maxExclusiveChapterNum?: number,
): FeedbackRecurrenceHitRowLike[] {
  const db = getDb()
  if (!db || typeof db.select !== 'function') return []

  const chapterRows = runQueryAll<Pick<typeof chapters.$inferSelect, 'id' | 'chapterNum' | 'reviewNotesJson'>>(
    db.select({
    id: chapters.id,
    chapterNum: chapters.chapterNum,
    reviewNotesJson: chapters.reviewNotesJson,
  }).from(chapters)
      .where(eq(chapters.novelId, novelId)),
  )
    .filter((row) => typeof row.chapterNum === 'number')
    .filter((row) => typeof maxExclusiveChapterNum === 'number' ? row.chapterNum < maxExclusiveChapterNum : true)
    .sort((left, right) => left.chapterNum - right.chapterNum)
  const latestGateByChapterId = runQueryAll<typeof chapterGateRuns.$inferSelect>(
    db.select().from(chapterGateRuns)
      .where(eq(chapterGateRuns.novelId, novelId)),
  )
    .filter((row) => typeof row.chapterId === 'number' && typeof row.chapterNum === 'number')
    .filter((row) => typeof maxExclusiveChapterNum === 'number' ? (row.chapterNum || 0) < maxExclusiveChapterNum : true)
    .reduce<Map<number, typeof chapterGateRuns.$inferSelect>>((result, row) => {
      const current = result.get(row.chapterId)
      if (!current || latestGateRowComparator(current, row) > 0) {
        result.set(row.chapterId, row)
      }
      return result
    }, new Map())
  const antiAiByChapterId = runQueryAll<typeof antiAiRuleHits.$inferSelect>(
    db.select().from(antiAiRuleHits)
      .where(eq(antiAiRuleHits.novelId, novelId)),
  )
    .filter((row) => typeof row.chapterId === 'number' && typeof row.chapterNum === 'number')
    .filter((row) => typeof maxExclusiveChapterNum === 'number' ? (row.chapterNum || 0) < maxExclusiveChapterNum : true)
    .reduce<Map<number, Array<typeof antiAiRuleHits.$inferSelect>>>((result, row) => {
      const current = result.get(row.chapterId) || []
      current.push(row)
      result.set(row.chapterId, current)
      return result
    }, new Map())

  return chapterRows.flatMap((chapter) => buildChapterHits({
    chapter,
    gate: latestGateByChapterId.get(chapter.id),
    antiAiRows: antiAiByChapterId.get(chapter.id) || [],
  }))
}

export function getFeedbackRecurrenceDashboardSummary(novelId: number): FeedbackRecurrenceDashboardSummary {
  try {
    return summarizeFeedbackRecurrenceHits(loadFeedbackRecurrenceHits(novelId))
  } catch {
    return summarizeFeedbackRecurrenceHits([])
  }
}

export function getPromotedFeedbackIssuesForChapter(
  novelId: number,
  chapterNum: number,
): FeedbackRecurrencePromotedIssueSummary[] {
  if (chapterNum <= 2) return []
  const summary = summarizeFeedbackRecurrenceHits(loadFeedbackRecurrenceHits(novelId, chapterNum))
  return summary.topRepeatedIssues
    .filter((issue) => isPromotedForUpcomingChapter(issue.chapterNums, chapterNum))
    .map<FeedbackRecurrencePromotedIssueSummary>((issue) => {
      const descriptor = FEEDBACK_DESCRIPTOR_MAP[issue.issueType]
      return {
        issueType: issue.issueType,
        title: issue.title,
        chapterNums: issue.chapterNums.filter((num) => num < chapterNum).slice(-5),
        avoid: descriptor.avoid,
        prefer: descriptor.prefer,
        pauseSuggested: descriptor.pauseOnBatch && hasThreeHitsWithinFiveChapters(issue.chapterNums.filter((num) => num < chapterNum)),
      }
    })
    .slice(0, 6)
}

export function buildFeedbackRecurrenceHardConstraintContext(options: {
  promotedIssues?: FeedbackRecurrencePromotedIssueSummary[]
}): string {
  const promotedIssues = options.promotedIssues || []
  if (promotedIssues.length === 0) return ''

  const avoidLines = promotedIssues.map((issue) => {
    const prefix = issue.pauseSuggested ? '高频阻断' : '近章复现'
    return `${prefix}${issue.title}：${issue.avoid}`
  })
  const preferLines = promotedIssues
    .map((issue) => issue.prefer ? `${issue.title}：${issue.prefer}` : '')
    .filter(Boolean)

  return [
    buildSection('【近章必须避免】', avoidLines),
    buildSection('【近章纠偏重点】', preferLines),
  ].filter(Boolean).join('\n\n')
}

function syncFeedbackRecurrenceRevisionTasks(novelId: number, alerts: FeedbackRecurrenceAlert[]): number {
  const db = getDb()
  if (!db || typeof db.select !== 'function' || typeof db.insert !== 'function' || typeof db.update !== 'function') return 0
  const now = new Date().toISOString()
  const existingRows = runQueryAll<typeof revisionTasks.$inferSelect>(
    db.select().from(revisionTasks)
      .where(eq(revisionTasks.novelId, novelId)),
  )
    .filter((row) => asText(row.taskSource) === 'system')
    .filter((row) => asText(row.issueKey).startsWith('feedback_recurrence:'))
  const existingByKey = new Map(existingRows.map((row) => [asText(row.issueKey), row] as const))
  const activeKeys = new Set<string>()

  alerts
    .filter((alert) => alert.severity === 'critical')
    .forEach((alert) => {
      const descriptor = FEEDBACK_DESCRIPTOR_MAP[alert.issueType]
      const issueKey = `feedback_recurrence:${alert.issueType}`
      const existing = existingByKey.get(issueKey)
      const title = `[审校反哺][复现预警] ${alert.title}`
      const description = alert.detail
      const fixBrief = `回查 ${alert.chapterNums.map((chapterNum) => `第${chapterNum}章`).join('、')}，并把“${alert.title}”固化为下一章硬约束。`
      const originMetaJson = JSON.stringify({
        issueCategory: 'feedback_recurrence',
        issueType: alert.issueType,
        chapterNums: alert.chapterNums,
        pauseSuggested: alert.pauseSuggested,
        suggestion: fixBrief,
      })
      activeKeys.add(issueKey)

      if (!existing) {
        db.insert(revisionTasks).values({
          novelId,
          taskSource: 'system',
          issueKey,
          taskType: 'continuity',
          status: 'open',
          severity: alert.pauseSuggested ? 'high' : 'medium',
          title,
          description,
          fixBrief,
          relatedPage: descriptor.relatedPage,
          entityType: 'novel',
          entityId: novelId,
          chapterId: null,
          originMetaJson,
          lastDetectedAt: now,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now,
        }).run()
        return
      }

      const nextStatus = asText(existing.status) === 'ignored'
        ? 'ignored'
        : asText(existing.status) === 'resolved'
          ? 'open'
          : asText(existing.status) || 'open'
      db.update(revisionTasks).set({
        status: nextStatus,
        severity: alert.pauseSuggested ? 'high' : 'medium',
        title,
        description,
        fixBrief,
        relatedPage: descriptor.relatedPage,
        entityType: 'novel',
        entityId: novelId,
        chapterId: null,
        originMetaJson,
        lastDetectedAt: now,
        resolvedAt: null,
        updatedAt: now,
      }).where(eq(revisionTasks.id, existing.id)).run()
    })

  existingRows
    .filter((row) => {
      const issueKey = asText(row.issueKey)
      return issueKey && !activeKeys.has(issueKey)
    })
    .forEach((row) => {
      const currentStatus = asText(row.status)
      if (currentStatus === 'ignored' || currentStatus === 'resolved') return
      db.update(revisionTasks).set({
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
      }).where(eq(revisionTasks.id, row.id)).run()
    })

  return activeKeys.size
}

export function syncFeedbackRecurrenceState(novelId: number): {
  summary: FeedbackRecurrenceDashboardSummary
  taskCount: number
} {
  const summary = getFeedbackRecurrenceDashboardSummary(novelId)
  const taskCount = syncFeedbackRecurrenceRevisionTasks(novelId, summary.recentAlerts)
  return {
    summary,
    taskCount,
  }
}

export function getFeedbackRecurrenceBatchPauseSignal(
  novelId: number,
  chapterNum: number,
): {
  issueType: FeedbackRecurrenceIssueType
  title: string
  detail: string
  chapterNums: number[]
} | null {
  const alert = getFeedbackRecurrenceDashboardSummary(novelId).recentAlerts
    .find((item) => item.severity === 'critical' && item.pauseSuggested && item.lastChapterNum === chapterNum)
  if (!alert) return null
  return {
    issueType: alert.issueType,
    title: alert.title,
    detail: alert.detail,
    chapterNums: alert.chapterNums,
  }
}
