import type { ChapterOptimizationQualityGate, ChapterStructuralRepairGate, LanguageDriftMetrics } from '../types'
import { collectQualityGuardrailFindings } from './content-guardrails'
import { analyzeLanguageDrift } from './language-drift'

const STRONG_AI_FLAVOR_CODES = new Set([
  'ai_process_leak',
  'prompt_leak',
  'dash_abuse',
  'parenthetical_explanation_abuse',
  'not_but_definition_pattern',
  'double_metaphor_or_simile_stack',
  'paragraph_simile_stacking',
  'parallelism_overuse',
  'low_value_body_detail',
  'eye_open_close_standalone_paragraph',
  'soft_voice_cliche',
])

const DRIFT_GATE_KEYS: Array<keyof LanguageDriftMetrics> = [
  'dashDensity',
  'parentheticalExplanationDensity',
  'metaphorStackRate',
  'parallelismRate',
  'bodyDetailClicheRate',
  'isolatedTemplateParagraphRate',
]

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

function scoreAiFlavorDrift(metrics: LanguageDriftMetrics): number {
  return roundScore(
    DRIFT_GATE_KEYS.reduce((sum, key) => sum + (Number(metrics[key]) || 0), 0) / DRIFT_GATE_KEYS.length,
  )
}

function countStrongAiFlavor(codes: string[]): number {
  return codes.filter((code) => STRONG_AI_FLAVOR_CODES.has(code)).length
}

export function buildChapterOptimizationQualityGate(
  originalContent: string,
  optimizedContent: string,
  genre?: string,
  knownTerms: string[] = [],
): ChapterOptimizationQualityGate {
  const guardrailOptions = { knownTerms }
  const originalFindings = collectQualityGuardrailFindings(originalContent, genre, guardrailOptions)
  const optimizedFindings = collectQualityGuardrailFindings(optimizedContent, genre, guardrailOptions)
  const originalGuardrailHits = originalFindings.map((finding) => finding.code)
  const optimizedGuardrailHits = optimizedFindings.map((finding) => finding.code)
  const originalHighSeverityCount = originalFindings.filter((finding) => finding.severity === 'high').length
  const optimizedHighSeverityCount = optimizedFindings.filter((finding) => finding.severity === 'high').length
  const originalStrongAiFlavorCount = countStrongAiFlavor(originalGuardrailHits)
  const optimizedStrongAiFlavorCount = countStrongAiFlavor(optimizedGuardrailHits)
  const languageDriftBefore = analyzeLanguageDrift(originalContent)
  const languageDriftAfter = analyzeLanguageDrift(optimizedContent)
  const originalDriftScore = scoreAiFlavorDrift(languageDriftBefore)
  const optimizedDriftScore = scoreAiFlavorDrift(languageDriftAfter)
  const optimizedStrongSamples = optimizedFindings
    .filter((finding) => STRONG_AI_FLAVOR_CODES.has(finding.code))
    .map((finding) => finding.code)
    .slice(0, 6)

  const warnings = [
    optimizedHighSeverityCount > originalHighSeverityCount
      ? `优化稿高危质量问题由 ${originalHighSeverityCount} 增至 ${optimizedHighSeverityCount}。`
      : '',
    optimizedStrongAiFlavorCount > originalStrongAiFlavorCount
      ? `优化稿强 AI 味命中由 ${originalStrongAiFlavorCount} 增至 ${optimizedStrongAiFlavorCount}：${optimizedStrongSamples.join('、') || '新增规则命中'}。`
      : '',
    optimizedDriftScore > originalDriftScore + 8
      ? `优化稿语言漂移分升高：${originalDriftScore} -> ${optimizedDriftScore}。`
      : '',
  ].filter(Boolean)

  return {
    safeToApply: warnings.length === 0,
    warnings,
    originalGuardrailHits,
    optimizedGuardrailHits,
    originalStrongAiFlavorCount,
    optimizedStrongAiFlavorCount,
    originalHighSeverityCount,
    optimizedHighSeverityCount,
    originalDriftScore,
    optimizedDriftScore,
    languageDriftBefore,
    languageDriftAfter,
  }
}

const STRUCTURAL_STATE_MARKERS = [
  '改为', '改成', '不再', '拿走', '带走', '交出', '交给', '收进', '抽出来', '塞进', '折成',
  '扣住', '拉着', '推开', '上车', '下车', '离开', '进入', '调成', '收回', '取回', '留下',
  '发出', '扣死', '拉开', '退后', '移到', '揭下来', '切断', '暴露', '关系', '失去', '破裂',
  '被扣', '改变', '决定',
]
const STRUCTURAL_PAYOFF_MARKERS = ['确认', '证实', '查明', '承认', '签名', '签字', '收到', '拿到', '交出', '打开', '兑现', '回答', '不是']
const STRUCTURAL_COST_MARKERS = [
  '代价', '失去', '错过', '暴露', '受伤', '扣留', '泄露', '丢失', '被拿走', '失败', '来不及',
  '烧掉', '失联', '无法', '不能告诉', '不告诉', '拒绝', '不给', '做不了', '不再', '当没见过',
  '没有了', '被发现', '被截', '毁掉', '空掉', '关系破裂', '被带走',
]
const STRUCTURAL_CHOICE_MARKERS = ['选择', '决定', '拒绝', '隐瞒', '改口', '坚持', '取消', '改变', '转移', '提前', '绕开', '销毁', '切断', '报警', '要求', '临时改', '交换', '阻止', '不肯']
const STRUCTURAL_MISJUDGMENT_MARKERS = [
  '误判', '判断错', '猜错', '看错', '没想到', '没料到', '假装', '误以为', '以为', '没确认',
  '没有确认', '没追问', '没有追问', '未确认', '没有核实', '未核实', '未经核实', '没有验证', '未验证',
  '没有证实', '未证实',
]
// Generic kinship/profession nouns only. Novel-specific character names must be
// injected by the caller — hardcoding sample-chapter names silently breaks the
// gate for every other novel.
const GENERIC_SUPPORTING_ROLE_NOUNS = ['母亲', '父亲', '护士', '女人', '男人']
const SUPPORTING_AGENCY_ACTION_FRAGMENT = '(?:隐瞒|交换|阻止|按住|推过来|推开|拦|藏|烧|倒|拿出|收进|改口|拒绝|提前|离开|转身|挣脱|塞给|不让|没说|没有告诉|没有拦|退后)'
const MAX_INJECTED_SUPPORTING_ROLE_NAMES = 12

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeInjectedRoleNames(roleNames: string[]): string[] {
  return [...new Set(roleNames.map((name) => String(name || '').trim()).filter((name) => name.length >= 2))]
    .slice(0, MAX_INJECTED_SUPPORTING_ROLE_NAMES)
}

export function buildSupportingRolePattern(roleNames: string[] = []): RegExp {
  const subjects = [...GENERIC_SUPPORTING_ROLE_NOUNS, ...normalizeInjectedRoleNames(roleNames).map(escapeRegExp)]
  return new RegExp(`(?:${subjects.join('|')})[^。！？!?\n]{0,36}${SUPPORTING_AGENCY_ACTION_FRAGMENT}`, 'gu')
}
// Structural repair is a bounded patch, not a second authoring pass. Keeping
// the candidate close to the source limits the surface on which a model can
// invent new facts while still leaving room for one or two repaired beats.
const MAX_STRUCTURAL_SCOPE_EXPANSION_RATIO = 1.6
const MIN_STRUCTURAL_CHANGED_SENTENCE_RATE = 15
const MAX_STRUCTURAL_CHANGED_SENTENCE_RATE = 45

function uniqueMarkers(text: string, markers: string[]): string[] {
  return [...new Set(markers.filter((marker) => text.includes(marker)))]
}

function collectSupportingAgencySignals(text: string, roleNames: string[] = []): string[] {
  const pattern = buildSupportingRolePattern(roleNames)
  return [...new Set(Array.from(String(text || '').matchAll(pattern), (match) => match[0].trim()))].slice(0, 8)
}

function sentenceFragments(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?；;\n]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function calculateChangedSentenceRate(originalContent: string, optimizedContent: string): number {
  const original = sentenceFragments(originalContent)
  const optimized = sentenceFragments(optimizedContent)
  if (optimized.length === 0) return 0
  const originalSet = new Set(original)
  const changed = optimized.filter((sentence) => !originalSet.has(sentence)).length
  return Math.round((changed / Math.max(original.length, optimized.length, 1)) * 100)
}

export interface ChapterStructuralRepairGateOptions {
  /** Non-protagonist character names of the current novel, used to detect supporting-cast agency. */
  supportingRoleNames?: string[]
  /** Chapters where structural repair is enforced. Defaults to the golden-three opening chapters. */
  goldenChapterNums?: number[]
  /** Chapters that must show supporting-cast agency and protagonist misjudgment. */
  agencyChapterNums?: number[]
  /** Chapters that must pay off an established local question before escalating. */
  payoffChapterNums?: number[]
}

const DEFAULT_GOLDEN_CHAPTER_NUMS = [2, 3]
const DEFAULT_AGENCY_CHAPTER_NUMS = [2]
const DEFAULT_PAYOFF_CHAPTER_NUMS = [3]

/**
 * Structural repair is intentionally stricter than language optimization.
 * It is only enabled for golden-three chapters, where a candidate that merely
 * replaces words must not be presented as a successful story repair.
 */
export function buildChapterStructuralRepairGate(
  originalContent: string,
  optimizedContent: string,
  chapterNum: number,
  options: ChapterStructuralRepairGateOptions = {},
): ChapterStructuralRepairGate {
  const goldenChapterNums = options.goldenChapterNums ?? DEFAULT_GOLDEN_CHAPTER_NUMS
  const agencyChapterNums = options.agencyChapterNums ?? DEFAULT_AGENCY_CHAPTER_NUMS
  const payoffChapterNums = options.payoffChapterNums ?? DEFAULT_PAYOFF_CHAPTER_NUMS
  const required = goldenChapterNums.includes(chapterNum)
  if (!required) {
    return {
      required: false,
      safeToApply: true,
      warnings: [],
      stateChangeSignals: [],
      payoffSignals: [],
      costSignals: [],
      choiceSignals: [],
      supportingAgencySignals: [],
      misjudgmentSignals: [],
      changedSentenceRate: calculateChangedSentenceRate(originalContent, optimizedContent),
      scopeExpansionRatio: Number((optimizedContent.length / Math.max(originalContent.length, 1)).toFixed(2)),
    }
  }

  const text = String(optimizedContent || '')
  const stateChangeSignals = uniqueMarkers(text, STRUCTURAL_STATE_MARKERS)
  const payoffSignals = uniqueMarkers(text, STRUCTURAL_PAYOFF_MARKERS)
  const costSignals = uniqueMarkers(text, STRUCTURAL_COST_MARKERS)
  const choiceSignals = uniqueMarkers(text, STRUCTURAL_CHOICE_MARKERS)
  const misjudgmentSignals = uniqueMarkers(text, STRUCTURAL_MISJUDGMENT_MARKERS)
  const supportingAgencySignals = collectSupportingAgencySignals(text, options.supportingRoleNames ?? [])
  const requiresAgency = agencyChapterNums.includes(chapterNum)
  const requiresPayoff = payoffChapterNums.includes(chapterNum)
  const changedSentenceRate = calculateChangedSentenceRate(originalContent, optimizedContent)
  const scopeExpansionRatio = Number((optimizedContent.length / Math.max(originalContent.length, 1)).toFixed(2))
  const warnings = [
    changedSentenceRate < MIN_STRUCTURAL_CHANGED_SENTENCE_RATE
      ? `结构性改写幅度不足：仅 ${changedSentenceRate}% 句子发生变化，低于 ${MIN_STRUCTURAL_CHANGED_SENTENCE_RATE}% 下限。`
      : '',
    stateChangeSignals.length < 2 ? '没有形成至少两项可见的现实状态变化。' : '',
    requiresAgency && supportingAgencySignals.length === 0 ? `第 ${chapterNum} 章没有检测到配角基于自身目的采取行动的信号。` : '',
    requiresAgency && misjudgmentSignals.length === 0 ? `第 ${chapterNum} 章没有检测到主角误判或错误选择信号。` : '',
    requiresPayoff && payoffSignals.length === 0 ? `第 ${chapterNum} 章没有先回收已建立的局部问题或证据。` : '',
    costSignals.length === 0 ? '没有检测到回收或选择带来的持续代价。' : '',
    changedSentenceRate > MAX_STRUCTURAL_CHANGED_SENTENCE_RATE
      ? `结构修订改动句比例过高：达到 ${changedSentenceRate}%，超过 ${MAX_STRUCTURAL_CHANGED_SENTENCE_RATE}% 上限；请保留原文大部分句子，只局部修复冲突链。`
      : '',
    originalContent.length >= 240 && scopeExpansionRatio > MAX_STRUCTURAL_SCOPE_EXPANSION_RATIO
      ? `结构修订扩写比例过高：达到原文 ${scopeExpansionRatio} 倍，超过 ${MAX_STRUCTURAL_SCOPE_EXPANSION_RATIO} 倍上限；请从原有动作和结果中修复，不要新增背景。`
      : '',
  ].filter(Boolean)
  return {
    required: true,
    safeToApply: warnings.length === 0,
    warnings,
    stateChangeSignals,
    payoffSignals,
    costSignals,
    choiceSignals,
    supportingAgencySignals,
    misjudgmentSignals,
    changedSentenceRate,
    scopeExpansionRatio,
  }
}
