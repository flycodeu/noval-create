import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapterWritebackDiffs, chapterWritebackRuns, chapters, characterRelations, characters, factions, genres, glossary, novels, storyArcs, storyItems, storyThreads, templates, timelineEvents, worldMap } from '../database/schema'
import { buildWorldRulesSummary, parseWorldRulesJson } from '../../src/shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefDocument } from '../../src/shared/project-brief'
import { parseFactionExternalRelations } from '../../src/shared/factions'
import { parseGlossaryAliases } from '../../src/shared/glossary'
import { findSimilarFragments, type SimilarFragmentHit } from './embedding.service'
import { buildStyleFingerprintPromptSection, listStyleFingerprints } from './style-analysis.service'
import {
  buildEndgameDesignSummary,
  buildPremiseSummary,
  buildStoryDesignSummary,
  buildWritingRulesSummary,
  parseStorySettingsDocument,
  type StoryEndgameDesignSettings,
  type StoryPremiseSettings,
  type StoryWritingRulesSettings,
} from '../../src/shared/story-settings'
import { buildThemeVoiceSummary, parseThemeVoiceDocument } from '../../src/shared/theme-voice'
import { buildWritingContractSummary } from '../../src/shared/writing-contract'
import { buildStoryMemoryPromptSummary } from './story-memory.service'
import { ensureStoryStructure } from './story-structure.service'
import { resolveModelRuntimeBudget } from './model.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import {
  buildCharacterContextCards,
  buildFactionContextCards,
  buildRelationContextCards,
  buildItemContextCards,
  buildTimelineContextCards,
  buildChapterThreadContextCards,
  buildGenericThreadCardsFromTexts,
  renderCharacterCards,
  renderFactionCards,
  renderRelationCards,
  renderItemCards,
  renderTimelineCards,
  renderThreadCards,
} from './context-cards'
import {
  buildFactionCatalog,
  resolveFactionRowsByReferences,
} from './faction-reference.service'
import { getCharacterDialogueHintMap } from './dialogue-fingerprint.service'
import { getCharacterStateContextHintMap, listLatestCharacterStates } from './character-state.service'
import { getWorldStateContextSnapshot } from './world-state.service'
import { getChapterContractContext } from './endgame-asset.service'

/**
 * 改进的 token 估算：中文字符约 1 token/字，英文约 0.25 token/word (4 chars/token)，
 * 标点和空格按 0.5 token 计。比固定 length/1.5 精确 20-30%。
 * 保留 10% 安全余量。
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const punctuation = (text.match(/[\u3000-\u303f\uff00-\uffef，。！？；：、""''（）【】《》…—\s]/g) || []).length
  const asciiChars = text.length - chineseChars - punctuation
  const rawEstimate = chineseChars * 1.0 + asciiChars * 0.25 + punctuation * 0.5
  // 10% 安全余量
  return Math.ceil(rawEstimate * 1.1)
}

function truncateToTokens(text: string, maxTokens: number): string {
  // 保守估算：按反向计算最大字符数
  // 假设平均每个字符约 0.6 token（中英混合平均值）
  const avgTokenPerChar = 0.6
  const maxChars = Math.max(Math.floor(maxTokens / avgTokenPerChar), 0)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}...`
}

function resolveRecentContextWindow(targetWords: number, chapterCount: number): number {
  if (targetWords >= 1500000 || chapterCount >= 600) return 40
  if (targetWords >= 1000000 || chapterCount >= 400) return 35
  if (targetWords >= 800000 || chapterCount >= 280) return 28
  if (targetWords >= 500000 || chapterCount >= 180) return 22
  if (targetWords >= 350000 || chapterCount >= 80) return 15
  if (targetWords >= 150000 || chapterCount >= 40) return 10
  return 8
}

interface ContextPart {
  priority: 0 | 1 | 2 | 3
  label: string
  content: string
}

interface HardConstraintDraft {
  label: HardConstraintSourceLabel
  title: string
  content: string
}

export type ChapterContextPromptProfile = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export type ChapterContextComplexity = 'simple' | 'standard' | 'key'
export type HardConstraintSourceLabel =
  | 'chapterGoal'
  | 'characterStates'
  | 'worldStates'
  | 'relationSummary'
  | 'itemSummary'
  | 'openLoops'
  | 'continuityNotes'

export interface BuildChapterContextOptions {
  totalBudget?: number
  promptProfile?: ChapterContextPromptProfile
  chapterComplexity?: ChapterContextComplexity
}

export type ContextBudgetOverflowLevel = 'none' | 'soft_trimmed' | 'hard_failed'

export interface ContextBudgetWarningSummary {
  priority: 0 | 1 | 2 | 3
  count: number
  labels: string[]
}

export interface ContextBudgetReport {
  modelContextLimit: number
  requestedBudget: number
  effectiveBudget: number
  promptFixedOverhead: number
  reservedForOutput: number
  availableContextBudget: number
  hardConstraintBudget: number
  hardConstraintUsed: number
  softContextBudget: number
  softContextUsed: number
  overflowLevel: ContextBudgetOverflowLevel
  warningCount: number
  droppedLabels: string[]
  truncatedLabels: string[]
  droppedByPriority: ContextBudgetWarningSummary[]
}

export interface StorySubPlot {
  name: string
  characters: string
  conflict: string
  mainlineLink: string
  endChapter: string
}

export interface StorySettings {
  premise: StoryPremiseSettings
  endgameDesign: StoryEndgameDesignSettings
  writingRules: StoryWritingRulesSettings
  storyGoal: string
  coreConflict: string
  mainPlot: string
  ending: string
  subPlotsText: string
  subPlotsList: StorySubPlot[]
  rhythmSetup?: number
  rhythmConflict?: number
  rhythmEnding?: number
  endgameDesignSummary: string
}

export interface StoryProfile {
  novelId: number
  novelTitle: string
  genre: string
  background: string
  projectBriefSummary: string
  premiseSummary: string
  storyDesignSummary: string
  endgameDesignSummary: string
  themeVoiceSummary: string
  writingContractSummary: string
  writingRulesSummary: string
  storyThreadsSummary: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  subPlots: string
  ending: string
  rhythmSummary: string
  worldRulesSummary: string
  styleTemplateSummary: string
  hasProtagonist: boolean
  protagonistName: string
  protagonistReference: string
  protagonistRule: string
}

export interface ContinuityState {
  plotProgress: string[]
  characterStateChanges: string[]
  worldStateChanges: string[]
  openLoops: string[]
  continuityNotes: string[]
  arcProgress: string
}

export interface OutlineGenerationContext {
  profile: StoryProfile
  arc: typeof storyArcs.$inferSelect
  previousSummary: string
  characterStates: string
  worldStates: string
  continuitySummary: string
  openLoops: string
  worldRulesSummary: string
}

export interface ChapterContextParts {
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates: string
  itemSummary: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  styleTemplate: string
  chapterGoal: string
  continuitySummary: string
  openLoops: string
  dueForeshadows: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  activeThreads: string
  writingContractSummary: string
  relationSummary: string
  recalledMemory: string
}

export interface HardConstraintEntry {
  label: HardConstraintSourceLabel
  title: string
  content: string
  originalTokens: number
  allocatedTokens: number
  truncated: boolean
}

export type PreviousChapterSampleSegmentType =
  | 'full_text'
  | 'opening'
  | 'summary'
  | 'continuity'
  | 'scene_anchor'
  | 'review'
  | 'writeback'
  | 'seed'
  | 'tail'

export interface PreviousChapterSampleSegment {
  type: PreviousChapterSampleSegmentType
  label: string
  text: string
  chars: number
}

export interface PreviousChapterSampleReport {
  sourceChapterId: number | null
  sourceChapterNum: number | null
  sourceChapterChars: number
  sampledChars: number
  coverageRate: number
  segmentCount: number
  fullyInjected: boolean
  segments: PreviousChapterSampleSegment[]
}

export interface PreviousChapterFeedSource {
  id: number
  chapterNum: number
  content?: string | null
  nextChapterSeed?: string | null
  summary?: string | null
  continuityStateJson?: string | null
  scenePlanJson?: string | null
  reviewNotesJson?: string | null
}

export type ContextDecisionStatus = 'kept' | 'truncated' | 'dropped'
export type ContextDecisionReason = 'budget_fit' | 'budget_insufficient' | 'covered_by_hard_constraint'

export interface ContextDecisionEntry {
  label: string
  title: string
  priority: 0 | 1 | 2 | 3 | 'hard'
  originalTokens: number
  allocatedTokens: number
  status: ContextDecisionStatus
  reason: ContextDecisionReason
}

export interface SoftContextBudgetUsage {
  budget: number
  used: number
  warningCount: number
  droppedLabels: string[]
  truncatedLabels: string[]
}

export interface ConstraintInjectionStatus {
  promptProfile: ChapterContextPromptProfile
  hardConstraintBudget: number
  hardConstraintUsed: number
  softContextBudget: number
  softContextUsed: number
  droppedConstraintCount: number
  truncatedHardConstraintCount: number
  injectedLabels: HardConstraintSourceLabel[]
  truncatedLabels: HardConstraintSourceLabel[]
}

export interface ChapterContext extends ChapterContextParts {
  hardConstraintContext: string
  hardConstraintSummary: string
  hardConstraintEntries: HardConstraintEntry[]
  constraintInjectionStatus: ConstraintInjectionStatus
  softContextBudgetUsage: SoftContextBudgetUsage
  contextBudgetReport: ContextBudgetReport
  droppedConstraintCount: number
  previousChapterSampleReport: PreviousChapterSampleReport
  softContextDecisions: ContextDecisionEntry[]
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
}

export class ContextOverflowError extends Error {
  readonly context: ChapterContext
  readonly contextBudgetReport: ContextBudgetReport

  constructor(message: string, context: ChapterContext, contextBudgetReport: ContextBudgetReport) {
    super(message)
    this.name = 'ContextOverflowError'
    this.context = context
    this.contextBudgetReport = contextBudgetReport
  }
}

export class HardConstraintOverflowError extends ContextOverflowError {
  constructor(message: string, context: ChapterContext, contextBudgetReport: ContextBudgetReport) {
    super(message, context, contextBudgetReport)
    this.name = 'HardConstraintOverflowError'
  }
}

type ChapterContextLabel = keyof ChapterContextParts

export interface ChapterContextRawData {
  novel: typeof novels.$inferSelect
  profile: StoryProfile
  chapterRows: Array<typeof chapters.$inferSelect>
  currentChapter?: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
  contextParts: ChapterContextParts
  previousChapterSampleReport: PreviousChapterSampleReport
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
}

interface ChapterWithContinuity {
  chapterNum: number
  summary: string
  nextChapterSeed: string
  content: string
  continuityState: ContinuityState
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asLooseText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asText).filter(Boolean)
}

function parseJsonRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function parseJsonStringArray(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return toStringArray(JSON.parse(raw))
  } catch {
    return []
  }
}

function parseJsonNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => asNumber(item))
      .filter((item): item is number => typeof item === 'number')
  } catch {
    return []
  }
}

function dedupe(values: string[], limit?: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values.map(v => v.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

type RecallBucketKey = 'character' | 'rule' | 'thread'

export type RecallSearchMode = 'vector' | 'keyword'

export interface RecallMemorySource {
  bucket: RecallBucketKey
  chapterId: number
  chapterNum: number
  fragmentType: string
  similarity: number
  searchMode: RecallSearchMode
  sourceLabel: string
  summary: string
  stale: boolean
  staleReasons: string[]
  overriddenByConstraint: boolean
}

export interface RecallDiagnostics {
  searchedBucketCount: number
  selectedBucketCount: number
  totalHitCount: number
  selectedHitCount: number
  staleRecallCount: number
  staleRecallRate: number
  recallDependencyRate: number
  overriddenHitCount: number
  fallbackHitCount: number
  summaryLines: string[]
}

interface RecallQueryBucket {
  bucket: RecallBucketKey
  query: string
  topK: number
}

interface RecallQueryBuildInput {
  chapterGoal: string
  outline: string
  arcGoal: string
  arcSummary: string
  storyGoal: string
  coreConflict: string
  mainPlot: string
  themeVoiceSummary: string
  worldRules: string
  relationSummary: string
  characterStates: string
  worldStates?: string
  itemSummary: string
  timelineSummary: string
  timelineOpenThreads: string
  activeThreads: string
  openLoops: string
  dueForeshadows: string
  continuityNotes: string
  storyThreadsSummary: string
  mentionedCharacters: string[]
  mentionedItems: string[]
  mentionedLocations: string[]
}

interface RecallHit extends SimilarFragmentHit {
  bucket: RecallBucketKey
  stale: boolean
  staleReasons: string[]
  overriddenByConstraint: boolean
}

function compactRecallLine(text: string, maxLength = 96): string {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/\s*\n+\s*/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return ''
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trim()}…`
}

function splitRecallLines(text: string, maxLines = 4, maxLength = 96): string[] {
  if (!text) return []
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => compactRecallLine(line, maxLength))
    .filter(Boolean)
  if (lines.length > 0) return dedupe(lines, maxLines)
  return dedupe([compactRecallLine(text, maxLength)].filter(Boolean), maxLines)
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = asText(text)
  return normalized ? keywords.some((keyword) => normalized.includes(keyword)) : false
}

function buildConstraintSection(title: string, lines: string[]): string {
  const normalizedLines = dedupe(lines.map((line) => compactRecallLine(line, 92)).filter(Boolean), 6)
  if (normalizedLines.length === 0) return ''
  return [`${title}:`, ...normalizedLines.map((line) => `- ${line}`)].join('\n')
}

function formatContractLine(label: string, values: string[]): string {
  const normalized = dedupe(values.map((value) => compactRecallLine(value, 88)).filter(Boolean), 4)
  if (normalized.length === 0) return ''
  return `${label}：${normalized.join('；')}`
}

function buildSceneContractSummaryLines(sceneContracts: Array<{
  segmentOrder?: number
  segmentTitle: string
  sceneGoal: string
  obstacle: string
  conflictType: string
  emotionShift: string
  revealPayload: string[]
  resultState: string
}>): string[] {
  return sceneContracts
    .map((scene) => {
      const pieces = [
        scene.sceneGoal ? `目标 ${compactRecallLine(scene.sceneGoal, 36)}` : '',
        scene.obstacle ? `障碍 ${compactRecallLine(scene.obstacle, 28)}` : '',
        scene.conflictType ? `冲突 ${compactRecallLine(scene.conflictType, 20)}` : '',
        scene.emotionShift ? `情绪 ${compactRecallLine(scene.emotionShift, 20)}` : '',
        scene.revealPayload.length > 0 ? `揭示 ${scene.revealPayload.slice(0, 2).map((item) => compactRecallLine(item, 18)).join('、')}` : '',
        scene.resultState ? `结果 ${compactRecallLine(scene.resultState, 24)}` : '',
      ].filter(Boolean)
      if (pieces.length === 0) return ''
      const sceneLabel = typeof scene.segmentOrder === 'number'
        ? `场景${scene.segmentOrder}`
        : scene.segmentTitle
      return `${sceneLabel}：${pieces.join('；')}`
    })
    .filter(Boolean)
}

const HARD_CONSTRAINT_SIGNAL_KEYWORDS = ['必须', '承接', '回收', '未清', '告警', '漂移', '冲突', '失效', '损坏', '伤势', '立场', '目标', '去向', '约束']
const RELATION_CONSTRAINT_KEYWORDS = ['关系', '张力', '亲密', '敌对', '决裂', '背叛', '盟友', '称呼', '潜台词']
const ITEM_CONSTRAINT_KEYWORDS = ['物品', '持有', '去向', '状态', '损坏', '失效', '遗失', '位置', '装备', '资源']

function selectConstraintLines(
  text: string,
  options: {
    keywords?: string[]
    fallbackLines?: number
    maxLines?: number
    maxLength?: number
  } = {},
): string[] {
  const lines = splitRecallLines(text, options.maxLines || 4, options.maxLength || 92)
  if (lines.length === 0) return []
  const matched = options.keywords?.length
    ? lines.filter((line) => containsAny(line, options.keywords || []))
    : lines
  if (matched.length > 0) return matched.slice(0, options.maxLines || 4)
  if (options.fallbackLines && options.fallbackLines > 0) return lines.slice(0, options.fallbackLines)
  return []
}

function resolveHardConstraintBudget(
  promptProfile: ChapterContextPromptProfile,
  chapterComplexity: ChapterContextComplexity,
  targetWords: number,
): number {
  const baseByProfile: Record<ChapterContextPromptProfile, number> = {
    scenePlan: 1200,
    draft: 1600,
    review: 1400,
    rewrite: 1700,
  }
  const complexityOffset: Record<ChapterContextComplexity, number> = {
    simple: -180,
    standard: 0,
    key: 280,
  }
  const largeNovelOffset = targetWords >= 800000 ? 240 : targetWords >= 350000 ? 120 : 0
  return Math.max(800, baseByProfile[promptProfile] + complexityOffset[chapterComplexity] + largeNovelOffset)
}

function buildHardConstraintDrafts(parts: ChapterContextParts): HardConstraintDraft[] {
  const relationLines = selectConstraintLines(parts.relationSummary, {
    keywords: RELATION_CONSTRAINT_KEYWORDS,
    fallbackLines: 1,
    maxLines: 2,
  })
  const itemLines = selectConstraintLines(parts.itemSummary, {
    keywords: ITEM_CONSTRAINT_KEYWORDS,
    fallbackLines: 1,
    maxLines: 2,
  })
  const openLoopLines = selectConstraintLines(parts.openLoops, {
    keywords: HARD_CONSTRAINT_SIGNAL_KEYWORDS,
    maxLines: 3,
  })
  const continuityLines = selectConstraintLines(parts.continuityNotes, {
    keywords: HARD_CONSTRAINT_SIGNAL_KEYWORDS,
    fallbackLines: 1,
    maxLines: 3,
  })

  const drafts: HardConstraintDraft[] = [
    {
      label: 'chapterGoal',
      title: '章节目标',
      content: buildConstraintSection('章节目标', [parts.chapterGoal]),
    },
    {
      label: 'characterStates',
      title: '人物当前状态',
      content: buildConstraintSection('人物当前状态', selectConstraintLines(parts.characterStates, { fallbackLines: 4, maxLines: 4 })),
    },
    {
      label: 'worldStates',
      title: '当前世界状态',
      content: buildConstraintSection('当前世界状态', selectConstraintLines(parts.worldStates, { fallbackLines: 4, maxLines: 4 })),
    },
    {
      label: 'relationSummary',
      title: '关键人物关系',
      content: buildConstraintSection('关键人物关系', relationLines),
    },
    {
      label: 'itemSummary',
      title: '关键物品去向',
      content: buildConstraintSection('关键物品去向', itemLines),
    },
    {
      label: 'openLoops',
      title: '必须回收事项',
      content: buildConstraintSection('必须回收事项', openLoopLines),
    },
    {
      label: 'continuityNotes',
      title: '必须承接',
      content: buildConstraintSection('必须承接', continuityLines),
    },
  ]

  return drafts.filter((entry) => Boolean(entry.content))
}

function allocateHardConstraintEntries(
  drafts: HardConstraintDraft[],
  budget: number,
): {
  entries: HardConstraintEntry[]
  text: string
  used: number
} {
  if (drafts.length === 0 || budget <= 0) {
    return { entries: [], text: '', used: 0 }
  }

  const originals = drafts.map((draft) => estimateTokens(draft.content))
  const totalOriginal = originals.reduce((sum, value) => sum + value, 0)
  let remainingBudget = Math.max(budget, drafts.length)
  let remainingOriginal = totalOriginal
  const allocations = drafts.map((draft, index) => {
    const originalTokens = originals[index]
    const remainingEntries = drafts.length - index
    const minimumForRest = Math.max(remainingEntries - 1, 0)
    const proportional = remainingOriginal > 0
      ? Math.max(1, Math.floor((originalTokens / remainingOriginal) * remainingBudget))
      : 1
    const maxAllowed = Math.max(1, remainingBudget - minimumForRest)
    const allocatedTokens = Math.min(originalTokens, Math.max(1, Math.min(maxAllowed, proportional)))
    remainingBudget -= allocatedTokens
    remainingOriginal -= originalTokens
    return allocatedTokens
  })

  let distributable = remainingBudget
  for (let index = 0; index < drafts.length && distributable > 0; index += 1) {
    const originalTokens = originals[index]
    const room = originalTokens - allocations[index]
    if (room <= 0) continue
    const extra = Math.min(room, distributable)
    allocations[index] += extra
    distributable -= extra
  }

  const entries = drafts.map((draft, index) => {
    const originalTokens = originals[index]
    const allocatedTokens = Math.max(1, allocations[index] || 1)
    const content = truncateToTokens(draft.content, allocatedTokens)
    return {
      label: draft.label,
      title: draft.title,
      content,
      originalTokens,
      allocatedTokens: estimateTokens(content),
      truncated: estimateTokens(content) < originalTokens,
    }
  })

  return {
    entries,
    text: entries.map((entry) => entry.content).filter(Boolean).join('\n\n'),
    used: entries.reduce((sum, entry) => sum + entry.allocatedTokens, 0),
  }
}

const SOFT_CONTEXT_EXCLUDED_LABELS = new Set<ChapterContextLabel>([
  'characterStates',
  'worldStates',
])

function buildHardConstraintSummary(
  entries: HardConstraintEntry[],
  droppedConstraintCount: number,
): string {
  if (entries.length === 0) {
    return droppedConstraintCount > 0
      ? `关键约束注入失败，丢失 ${droppedConstraintCount} 项。`
      : '当前章节没有额外关键约束。'
  }

  const injectedTitles = entries.map((entry) => entry.title)
  const truncatedTitles = entries.filter((entry) => entry.truncated).map((entry) => entry.title)
  const summaryParts = [
    `已注入 ${entries.length} 项关键约束：${injectedTitles.join('、')}`,
  ]

  if (truncatedTitles.length > 0) {
    summaryParts.push(`压缩 ${truncatedTitles.length} 项：${truncatedTitles.join('、')}`)
  }
  if (droppedConstraintCount > 0) {
    summaryParts.push(`丢失 ${droppedConstraintCount} 项`)
  }

  return summaryParts.join('；')
}

function collectMentionedEntityNames(
  sourceText: string,
  candidateNames: string[],
  limit: number,
): string[] {
  if (!sourceText.trim()) return []
  return dedupe(
    candidateNames
      .map((name) => name.trim())
      .filter((name) => Boolean(name) && sourceText.includes(name))
      .sort((left, right) => right.length - left.length),
    limit,
  )
}

function buildGlossaryContextSummary(
  novelId: number,
  signalTexts: string[],
  limit = 12,
): string {
  const signalText = signalTexts
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!signalText) return ''

  const db = getDb()
  const rows = db.select().from(glossary)
    .where(eq(glossary.novelId, novelId))
    .orderBy(asc(glossary.sortOrder), asc(glossary.id))
    .all()
    .filter((row) => (row.isCanonical ?? 0) > 0)

  const matched = rows.filter((row) => {
    const candidates = [row.term, ...parseGlossaryAliases(row.aliasesJson)]
      .map((item) => item.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)
    return candidates.some((candidate) => signalText.includes(candidate))
  })

  if (matched.length === 0) return ''

  return [
    '术语词典：',
    ...matched.slice(0, limit).map((row) => {
      const aliases = parseGlossaryAliases(row.aliasesJson).slice(0, 3)
      const parts = [
        row.category ? `[${row.category}]` : '',
        row.definition || '',
        typeof row.firstAppearChapter === 'number' ? `首见第${row.firstAppearChapter}章` : '',
        aliases.length > 0 ? `别名：${aliases.join('、')}` : '',
      ].filter(Boolean)
      return `- ${row.term}${parts.length > 0 ? `：${parts.join('；')}` : ''}`
    }),
  ].join('\n')
}

function buildFactionContextSummary(
  novelId: number,
  mentionedCharacters: Array<typeof characters.$inferSelect>,
  limit = 6,
): string {
  if (mentionedCharacters.length === 0) return ''

  const catalog = buildFactionCatalog(novelId)
  const selected = new Map<number, typeof factions.$inferSelect>()

  mentionedCharacters.forEach((character) => {
    resolveFactionRowsByReferences(novelId, character.campFactionIdsJson).forEach((row) => {
      selected.set(row.id, row)
    })
  })

  if (selected.size === 0) return ''

  const baseIds = [...selected.keys()]
  catalog.rows.forEach((row) => {
    const relations = parseFactionExternalRelations(row.externalRelationsJson)
    const directlyRelated = relations.some((relation) =>
      (relation.relation === 'enemy' || relation.relation === 'subordinate')
      && typeof relation.targetFactionId === 'number'
      && baseIds.includes(relation.targetFactionId))
    if (directlyRelated) {
      selected.set(row.id, row)
    }
  })

  baseIds.forEach((id) => {
    const row = catalog.byId.get(id)
    if (!row) return
    parseFactionExternalRelations(row.externalRelationsJson).forEach((relation) => {
      if (
        (relation.relation === 'enemy' || relation.relation === 'subordinate')
        && typeof relation.targetFactionId === 'number'
      ) {
        const target = catalog.byId.get(relation.targetFactionId)
        if (target) selected.set(target.id, target)
      }
    })
  })

  const rows = [...selected.values()].slice(0, limit)
  if (rows.length === 0) return ''
  const db = getDb()
  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const locationRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const cards = buildFactionContextCards({
    factions: rows,
    characterNameMap: new Map(characterRows.map((row) => [row.id, row.fullName])),
    locationNameMap: new Map(locationRows.map((row) => [row.id, row.name])),
    limit,
  })

  return cards.length > 0 ? `势力卡：\n${renderFactionCards(cards)}` : ''
}

function buildRecallQueryText(
  title: string,
  sections: Array<{ title: string; lines: string[] }>,
  maxTokens = 450,
): string {
  const content = sections
    .filter((section) => section.lines.length > 0)
    .flatMap((section) => [
      `${section.title}：`,
      ...section.lines.map((line) => `- ${line}`),
    ])
    .join('\n')
  if (!content) return ''
  return truncateToTokens(`${title}\n${content}`, maxTokens)
}

function buildRecallQueryBuckets(input: RecallQueryBuildInput): RecallQueryBucket[] {
  const characterQuery = buildRecallQueryText('角色关系召回', [
    {
      title: '本章任务',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        ...splitRecallLines(input.outline, 3, 84),
        compactRecallLine(input.arcGoal, 80),
      ], 4),
    },
    {
      title: '当前涉及人物物品地点',
      lines: dedupe([
        input.mentionedCharacters.length > 0 ? `人物=${input.mentionedCharacters.join('、')}` : '',
        input.mentionedItems.length > 0 ? `物品=${input.mentionedItems.join('、')}` : '',
        input.mentionedLocations.length > 0 ? `地点=${input.mentionedLocations.join('、')}` : '',
      ], 3),
    },
    {
      title: '关系冲突',
      lines: splitRecallLines(input.relationSummary, 4, 96),
    },
    {
      title: '人物状态',
      lines: splitRecallLines(input.characterStates, 4, 96),
    },
  ])

  const ruleQuery = buildRecallQueryText('规则主题召回', [
    {
      title: '本章任务',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        compactRecallLine(input.arcGoal, 80),
        compactRecallLine(input.arcSummary, 84),
      ], 3),
    },
    {
      title: '主线与主题',
      lines: dedupe([
        compactRecallLine(input.storyGoal, 80),
        compactRecallLine(input.coreConflict, 80),
        compactRecallLine(input.mainPlot, 84),
        ...splitRecallLines(input.themeVoiceSummary, 3, 84),
      ], 5),
    },
    {
      title: '世界规则与边界',
      lines: splitRecallLines(input.worldRules, 5, 96),
    },
    {
      title: '时序与物品约束',
      lines: dedupe([
        ...splitRecallLines(input.timelineSummary, 2, 90),
        ...splitRecallLines(input.itemSummary, 2, 90),
      ], 4),
    },
  ])

  const threadQuery = buildRecallQueryText('线程伏笔召回', [
    {
      title: '本章与故事弧',
      lines: dedupe([
        compactRecallLine(input.chapterGoal, 80),
        compactRecallLine(input.arcGoal, 80),
        compactRecallLine(input.arcSummary, 84),
      ], 3),
    },
    {
      title: '活跃线程',
      lines: dedupe([
        ...splitRecallLines(input.activeThreads, 4, 96),
        ...splitRecallLines(input.storyThreadsSummary, 3, 96),
      ], 6),
    },
    {
      title: '待回收事项',
      lines: dedupe([
        ...splitRecallLines(input.openLoops, 4, 90),
        ...splitRecallLines(input.dueForeshadows, 3, 90),
        ...splitRecallLines(input.timelineOpenThreads, 3, 90),
        ...splitRecallLines(input.continuityNotes, 3, 90),
      ], 6),
    },
  ])

  return [
    characterQuery ? { bucket: 'character' as const, query: characterQuery, topK: 4 } : null,
    ruleQuery ? { bucket: 'rule' as const, query: ruleQuery, topK: 3 } : null,
    threadQuery ? { bucket: 'thread' as const, query: threadQuery, topK: 4 } : null,
  ].filter((bucket): bucket is RecallQueryBucket => Boolean(bucket))
}

function summarizeRecallHit(hit: RecallHit): string {
  const lines = hit.fragmentText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => compactRecallLine(line, 96))
    .filter(Boolean)

  if (lines.length === 0) return ''
  if (hit.fragmentType !== 'continuity') {
    return compactRecallLine(lines.slice(0, 2).join('；'), 110)
  }

  const preferredPrefixes = hit.bucket === 'character'
    ? ['人物变化：', '剧情推进：', '承接提醒：']
    : hit.bucket === 'rule'
      ? ['世界变化：', '承接提醒：', '剧情推进：', '故事弧推进：']
      : ['未回收事项：', '承接提醒：', '故事弧推进：', '剧情推进：']

  const preferred = lines.filter((line) => preferredPrefixes.some((prefix) => line.startsWith(prefix)))
  return compactRecallLine((preferred.length > 0 ? preferred : lines).slice(0, 2).join('；'), 110)
}

function buildRecallEntityFreshnessMap(
  novelId: number,
  upToChapterNum?: number,
): Map<string, number> {
  const result = new Map<string, number>()
  listLatestCharacterStates(novelId, { upToChapterNum, limit: 240 }).forEach((state) => {
    if (state.characterName) {
      result.set(state.characterName, state.chapterNum)
    }
  })
  getWorldStateContextSnapshot(novelId, {
    upToChapterNum,
    limit: 240,
  }).currentStates.forEach((state) => {
    if (state.entityName) {
      result.set(state.entityName, state.chapterNum)
    }
  })
  return result
}

function enrichRecallHits(
  hits: SimilarFragmentHit[],
  bucket: RecallBucketKey,
  currentChapterNum: number,
  entityFreshnessMap: Map<string, number>,
  constraintText: string,
): RecallHit[] {
  const candidateNames = [...entityFreshnessMap.keys()].sort((left, right) => right.length - left.length)

  return hits.map((hit) => {
    const staleReasons: string[] = []
    const matchedNames = candidateNames.filter((name) => hit.fragmentText.includes(name)).slice(0, 4)
    matchedNames.forEach((name) => {
      const freshnessChapterNum = entityFreshnessMap.get(name) || 0
      if (freshnessChapterNum > 0 && freshnessChapterNum > hit.chapterNum) {
        staleReasons.push(`${name} 已在第${freshnessChapterNum}章后更新，旧片段不可直接当作当前事实`)
      }
    })
    if (bucket !== 'thread' && hit.chapterNum >= currentChapterNum) {
      staleReasons.push(`命中片段来自第${hit.chapterNum}章，不应反向作为当前章之前的历史依据`)
    }
    const overriddenByConstraint = matchedNames.length > 0
      && matchedNames.some((name) => constraintText.includes(name))
      && staleReasons.length > 0

    return {
      ...hit,
      bucket,
      stale: staleReasons.length > 0,
      staleReasons: dedupe(staleReasons, 4),
      overriddenByConstraint,
    }
  })
}

function buildEmptyRecallDiagnostics(summaryLines: string[] = []): RecallDiagnostics {
  return {
    searchedBucketCount: 0,
    selectedBucketCount: 0,
    totalHitCount: 0,
    selectedHitCount: 0,
    staleRecallCount: 0,
    staleRecallRate: 0,
    recallDependencyRate: 0,
    overriddenHitCount: 0,
    fallbackHitCount: 0,
    summaryLines,
  }
}

function formatRecalledMemory(sources: RecallMemorySource[]): string {
  const labels: Record<RecallBucketKey, string> = {
    character: '角色/关系召回',
    rule: '规则/主题召回',
    thread: '线程/伏笔召回',
  }
  const selectedSources = sources
    .filter((source) => !source.stale && !source.overriddenByConstraint)
    .slice(0, 6)
  if (selectedSources.length === 0) return ''

  const lines = ['以下内容仅作背景补充，不定义当前事实。']
  selectedSources.forEach((source) => {
    lines.push(`[${labels[source.bucket]}·第${source.chapterNum}章·${source.fragmentType}] ${source.summary}`)
  })

  return lines.join('\n')
}

function buildRecallSnapshot(
  bucketResults: Array<{ bucket: RecallBucketKey; hits: RecallHit[] }>,
): {
  recalledMemory: string
  recalledMemorySources: RecallMemorySource[]
  recallDiagnostics: RecallDiagnostics
} {
  const sources: RecallMemorySource[] = []
  const seen = new Set<string>()
  const selectedKeys = new Set<string>()
  let selectedBucketCount = 0

  bucketResults.forEach((result) => {
    const significant = result.hits.filter((hit) => !hit.stale && !hit.overriddenByConstraint && hit.similarity > 0.08)
    const fallback = result.hits.filter((hit) => !hit.stale && !hit.overriddenByConstraint && hit.similarity > 0)
    const selected = significant.length > 0 ? significant.slice(0, 2) : fallback.slice(0, 1)
    if (selected.length > 0) {
      selectedBucketCount += 1
    }
    selected.forEach((hit) => {
      const summary = summarizeRecallHit(hit)
      if (!summary) return
      selectedKeys.add(`${result.bucket}:${hit.chapterId}:${hit.fragmentType}:${summary}`)
    })

    result.hits.forEach((hit) => {
      const summary = summarizeRecallHit(hit)
      if (!summary) return
      const dedupeKey = `${result.bucket}:${hit.chapterId}:${hit.fragmentType}:${summary}`
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)
      sources.push({
        bucket: result.bucket,
        chapterId: hit.chapterId,
        chapterNum: hit.chapterNum,
        fragmentType: hit.fragmentType,
        similarity: hit.similarity,
        searchMode: hit.searchMode,
        sourceLabel: `第${hit.chapterNum}章 · ${hit.fragmentType}`,
        summary,
        stale: hit.stale,
        staleReasons: hit.staleReasons,
        overriddenByConstraint: hit.overriddenByConstraint,
      })
    })
  })

  const searchedBucketCount = bucketResults.length
  const totalHitCount = sources.length
  const selectedHitCount = sources.filter((source) =>
    selectedKeys.has(`${source.bucket}:${source.chapterId}:${source.fragmentType}:${source.summary}`)).length
  const staleRecallCount = sources.filter((source) => source.stale).length
  const overriddenHitCount = sources.filter((source) => source.overriddenByConstraint).length
  const fallbackHitCount = sources.filter((source) => source.searchMode === 'keyword').length
  const staleRecallRate = totalHitCount > 0 ? Math.round((staleRecallCount / totalHitCount) * 100) : 0
  const recallDependencyRate = totalHitCount > 0 ? Math.round((selectedHitCount / totalHitCount) * 100) : 0
  const recallDiagnostics: RecallDiagnostics = {
    searchedBucketCount,
    selectedBucketCount,
    totalHitCount,
    selectedHitCount,
    staleRecallCount,
    staleRecallRate,
    recallDependencyRate,
    overriddenHitCount,
    fallbackHitCount,
    summaryLines: [
      '向量召回只作背景补充，当前事实以硬约束和结构化状态为准。',
      searchedBucketCount > 0
        ? `召回覆盖 ${selectedBucketCount}/${searchedBucketCount} 个查询桶，补充片段 ${selectedHitCount} 条。`
        : '当前章节没有可用的召回查询桶。',
      staleRecallCount > 0
        ? `拦截过期召回 ${staleRecallCount} 条，过期召回率 ${staleRecallRate}%。`
        : '最近召回片段未命中过期状态。',
      overriddenHitCount > 0
        ? `${overriddenHitCount} 条片段已被硬约束覆盖，不再参与当前事实定义。`
        : '当前没有片段被硬约束直接覆盖。',
    ].filter(Boolean),
  }

  return {
    recalledMemory: formatRecalledMemory(sources),
    recalledMemorySources: sources,
    recallDiagnostics,
  }
}

export interface TokenAllocationWarning {
  label: string
  priority: number
  originalTokens: number
  allocatedTokens: number
  reason: 'truncated' | 'dropped'
}

export interface TokenAllocationResult {
  allocated: Record<string, string>
  warnings: TokenAllocationWarning[]
  decisions: ContextDecisionEntry[]
  totalUsed: number
  totalBudget: number
}

function resolveContextLabelTitle(label: ChapterContextLabel): string {
  const titleMap: Record<ChapterContextLabel, string> = {
    storyCore: '小说核心约束',
    currentArc: '当前故事弧',
    worldRules: '世界规则',
    characterStates: '人物当前状态',
    worldStates: '当前世界状态',
    itemSummary: '关键物品与去向',
    previousSummaries: '最近章节摘要',
    previousChapterContext: '上一章关键先验',
    lastChapterEnding: '上章结尾',
    styleTemplate: '文风参考',
    chapterGoal: '本章目标',
    continuitySummary: '连续性记忆',
    openLoops: '未回收事项',
    dueForeshadows: '本章应回收伏笔',
    continuityNotes: '必须承接',
    timelineSummary: '时间轴锚点',
    timelineOpenThreads: '时间轴待回收',
    longTermMemory: '长文压缩记忆',
    activeThreads: '活跃支线与伏笔',
    writingContractSummary: '写作类型',
    relationSummary: '关键人物关系',
    recalledMemory: '向量召回记忆',
  }
  return titleMap[label]
}

function summarizeBudgetWarnings(warnings: TokenAllocationWarning[]): ContextBudgetWarningSummary[] {
  return ([0, 1, 2, 3] as const).map((priority) => {
    const matched = warnings.filter((warning) => warning.priority === priority && warning.reason === 'dropped')
    return {
      priority,
      count: matched.length,
      labels: matched.map((warning) => warning.label),
    }
  })
}

function allocateTokens(parts: ContextPart[], totalBudget: number): TokenAllocationResult {
  const result: Record<string, string> = {}
  const warnings: TokenAllocationWarning[] = []
  const decisions = new Map<string, ContextDecisionEntry>()
  const p0Parts = parts.filter((part) => part.priority === 0)

  let usedTokens = 0
  for (const part of p0Parts) {
    result[part.label] = part.content
    const originalTokens = estimateTokens(part.content)
    usedTokens += originalTokens
    decisions.set(part.label, {
      label: part.label,
      title: resolveContextLabelTitle(part.label as ChapterContextLabel),
      priority: 0,
      originalTokens,
      allocatedTokens: originalTokens,
      status: 'kept',
      reason: 'budget_fit',
    })
  }

  const remaining = totalBudget - usedTokens
  if (remaining <= 0) {
    // P0 已经超出预算，需要截断
    const perP0Budget = Math.floor(totalBudget / Math.max(p0Parts.length, 1))
    usedTokens = 0
    for (const part of p0Parts) {
      const originalTokens = estimateTokens(part.content)
      result[part.label] = truncateToTokens(part.content, perP0Budget)
      const allocatedTokens = estimateTokens(result[part.label])
      usedTokens += allocatedTokens
      decisions.set(part.label, {
        label: part.label,
        title: resolveContextLabelTitle(part.label as ChapterContextLabel),
        priority: 0,
        originalTokens,
        allocatedTokens,
        status: allocatedTokens < originalTokens ? 'truncated' : 'kept',
        reason: allocatedTokens < originalTokens ? 'budget_insufficient' : 'budget_fit',
      })
      if (allocatedTokens < originalTokens) {
        warnings.push({ label: part.label, priority: 0, originalTokens, allocatedTokens, reason: 'truncated' })
      }
    }
    for (const part of parts.filter((part) => part.priority > 0)) {
      result[part.label] = ''
      const originalTokens = estimateTokens(part.content)
      if (originalTokens > 0) {
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority: part.priority,
          originalTokens,
          allocatedTokens: 0,
          status: 'dropped',
          reason: 'budget_insufficient',
        })
        warnings.push({ label: part.label, priority: part.priority, originalTokens, allocatedTokens: 0, reason: 'dropped' })
      }
    }
    if (warnings.length > 0) {
      console.warn(`[context] 上下文预算不足(${totalBudget} tokens)，${warnings.length} 个部分被截断或丢弃:`,
        warnings.map(w => `${w.label}(P${w.priority}): ${w.reason === 'dropped' ? '完全丢弃' : `${w.originalTokens}→${w.allocatedTokens}`}`).join(', '))
    }
    return { allocated: result, warnings, decisions: [...decisions.values()], totalUsed: usedTokens, totalBudget }
  }

  let budget = remaining
  for (const priority of [1, 2, 3] as const) {
    for (const part of parts.filter((item) => item.priority === priority)) {
      const needed = estimateTokens(part.content)
      if (budget <= 0) {
        result[part.label] = ''
        if (needed > 0) {
          decisions.set(part.label, {
            label: part.label,
            title: resolveContextLabelTitle(part.label as ChapterContextLabel),
            priority,
            originalTokens: needed,
            allocatedTokens: 0,
            status: 'dropped',
            reason: 'budget_insufficient',
          })
          warnings.push({ label: part.label, priority, originalTokens: needed, allocatedTokens: 0, reason: 'dropped' })
        }
      } else if (needed <= budget) {
        result[part.label] = part.content
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority,
          originalTokens: needed,
          allocatedTokens: needed,
          status: 'kept',
          reason: 'budget_fit',
        })
        budget -= needed
      } else {
        result[part.label] = truncateToTokens(part.content, budget)
        const allocatedTokens = estimateTokens(result[part.label])
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority,
          originalTokens: needed,
          allocatedTokens,
          status: 'truncated',
          reason: 'budget_insufficient',
        })
        warnings.push({ label: part.label, priority, originalTokens: needed, allocatedTokens, reason: 'truncated' })
        budget = 0
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(`[context] 上下文分配警告(预算${totalBudget}, 剩余${budget}):`,
      warnings.map(w => `${w.label}(P${w.priority}): ${w.reason === 'dropped' ? '丢弃' : `截断${w.originalTokens}→${w.allocatedTokens}`}`).join(', '))
  }

  return { allocated: result, warnings, decisions: [...decisions.values()], totalUsed: totalBudget - budget, totalBudget }
}

function resolveChapterBudgetFloor(targetWords: number, requestedBudget: number): number {
  if (targetWords >= 1500000) return Math.max(requestedBudget, 22000)
  if (targetWords >= 800000) return Math.max(requestedBudget, 18000)
  if (targetWords >= 350000) return Math.max(requestedBudget, 14000)
  return requestedBudget
}

function resolvePromptFixedOverhead(
  promptProfile: ChapterContextPromptProfile,
  chapterComplexity: ChapterContextComplexity,
  targetWords: number,
): number {
  const baseByProfile: Record<ChapterContextPromptProfile, number> = {
    scenePlan: 950,
    draft: 1200,
    review: 1100,
    rewrite: 1500,
  }
  const complexityOffset: Record<ChapterContextComplexity, number> = {
    simple: -180,
    standard: 0,
    key: 320,
  }
  const largeNovelOffset = targetWords >= 800000 ? 180 : targetWords >= 350000 ? 80 : 0
  return Math.max(500, baseByProfile[promptProfile] + complexityOffset[chapterComplexity] + largeNovelOffset)
}

function resolvePromptOutputReserve(
  promptProfile: ChapterContextPromptProfile,
  chapterComplexity: ChapterContextComplexity,
  targetWords: number,
): number {
  const baseByProfile: Record<ChapterContextPromptProfile, number> = {
    scenePlan: 1600,
    draft: 3000,
    review: 1700,
    rewrite: 3400,
  }
  const complexityOffset: Record<ChapterContextComplexity, number> = {
    simple: -150,
    standard: 0,
    key: 280,
  }
  const largeNovelOffset = targetWords >= 800000 && (promptProfile === 'draft' || promptProfile === 'rewrite')
    ? 260
    : targetWords >= 350000 && promptProfile === 'rewrite'
      ? 160
      : 0
  return Math.max(1200, baseByProfile[promptProfile] + complexityOffset[chapterComplexity] + largeNovelOffset)
}

function createStagePriorityMap(
  promptProfile: ChapterContextPromptProfile,
  chapterComplexity: ChapterContextComplexity,
  targetWords: number,
  chapterCount: number,
): Partial<Record<ChapterContextLabel, ContextPart['priority'] | null>> {
  const priorities: Partial<Record<ChapterContextLabel, ContextPart['priority'] | null>> = (() => {
    switch (promptProfile) {
      case 'scenePlan':
        return {
          chapterGoal: 0,
          storyCore: 0,
          currentArc: 0,
          worldRules: 0,
          continuityNotes: 0,
          openLoops: 0,
          dueForeshadows: 0,
          characterStates: 0,
          worldStates: 0,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          continuitySummary: 2,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 2,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 3,
          writingContractSummary: 1,
          relationSummary: 1,
          recalledMemory: 2,
        }
      case 'draft':
        return {
          chapterGoal: 0,
          storyCore: 0,
          currentArc: 0,
          worldRules: 0,
          continuityNotes: 0,
          openLoops: 0,
          dueForeshadows: 0,
          characterStates: 0,
          worldStates: 0,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          continuitySummary: 1,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 2,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 2,
          writingContractSummary: 1,
          relationSummary: 1,
          recalledMemory: 2,
        }
      case 'review':
        return {
          chapterGoal: 0,
          storyCore: 0,
          currentArc: 0,
          worldRules: 0,
          continuityNotes: 1,
          openLoops: 0,
          dueForeshadows: 0,
          characterStates: 0,
          worldStates: 0,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 2,
          continuitySummary: 0,
          timelineSummary: 0,
          timelineOpenThreads: 2,
          longTermMemory: 1,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: null,
          writingContractSummary: 1,
          relationSummary: 1,
          recalledMemory: 2,
        }
      case 'rewrite':
      default:
        return {
          chapterGoal: 0,
          storyCore: 0,
          currentArc: 0,
          worldRules: 0,
          continuityNotes: 0,
          openLoops: 0,
          dueForeshadows: 0,
          characterStates: 0,
          worldStates: 0,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          continuitySummary: 1,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 1,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 2,
          writingContractSummary: 1,
          relationSummary: 1,
          recalledMemory: 2,
        }
    }
  })()

  if (chapterComplexity === 'simple') {
    priorities.styleTemplate = null
    priorities.previousSummaries = 3
    priorities.activeThreads = Math.min(3, (priorities.activeThreads ?? 2) + 1) as ContextPart['priority']
    priorities.longTermMemory = targetWords >= 350000 || chapterCount >= 80
      ? 2
      : null
    priorities.relationSummary = Math.min(2, (priorities.relationSummary ?? 1) + 1) as ContextPart['priority']
  } else if (chapterComplexity === 'key') {
    const promote = (label: ChapterContextLabel) => {
      const current = priorities[label]
      if (typeof current !== 'number') return
      priorities[label] = Math.max(0, current - 1) as ContextPart['priority']
    }

    promote('continuitySummary')
    promote('relationSummary')
    promote('activeThreads')
    promote('previousChapterContext')
    promote('previousSummaries')
    promote('lastChapterEnding')
    promote('timelineSummary')
  }

  if (targetWords >= 350000 || chapterCount >= 80) {
    const currentLongTermPriority = priorities.longTermMemory
    if (typeof currentLongTermPriority === 'number') {
      priorities.longTermMemory = Math.min(currentLongTermPriority, 1) as ContextPart['priority']
    }
  }

  return priorities
}

function parseSubPlots(value: unknown): StorySubPlot[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => {
      const subplot = item as Record<string, unknown>
      return {
        name: asText(subplot.name),
        characters: asText(subplot.characters),
        conflict: asText(subplot.conflict),
        mainlineLink: asText(subplot.mainlineLink),
        endChapter: asLooseText(subplot.endChapter),
      }
    })
    .filter((subplot) => Object.values(subplot).some(Boolean))
}

export function parseStorySettings(raw?: string | null): StorySettings {
  const settings = parseStorySettingsDocument(raw)

  return {
    premise: settings.premise,
    endgameDesign: settings.endgameDesign,
    writingRules: settings.writingRules,
    storyGoal: settings.storyDesign.storyGoal,
    coreConflict: settings.storyDesign.coreConflict,
    mainPlot: settings.storyDesign.mainPlot,
    ending: settings.storyDesign.ending,
    subPlotsText: settings.storyDesign.subPlotsText,
    subPlotsList: parseSubPlots(settings.storyDesign.subPlotsList),
    rhythmSetup: settings.storyDesign.rhythmSetup,
    rhythmConflict: settings.storyDesign.rhythmConflict,
    rhythmEnding: settings.storyDesign.rhythmEnding,
    endgameDesignSummary: buildEndgameDesignSummary(settings.endgameDesign),
  }
}

function formatSubPlots(settings: StorySettings): string {
  if (settings.subPlotsList.length > 0) {
    return settings.subPlotsList
      .map((subplot, index) => {
        const parts = [
          subplot.name ? `名称：${subplot.name}` : '',
          subplot.characters ? `人物：${subplot.characters}` : '',
          subplot.conflict ? `冲突：${subplot.conflict}` : '',
          subplot.mainlineLink ? `关联：${subplot.mainlineLink}` : '',
          subplot.endChapter ? `收束章节：${subplot.endChapter}` : '',
        ].filter(Boolean)
        return `${index + 1}. ${parts.join('；')}`
      })
      .join('\n')
  }

  return settings.subPlotsText || '（暂无支线）'
}

function formatRhythmSummary(settings: StorySettings): string {
  const parts = [
    settings.rhythmSetup ? `前期铺垫 ${settings.rhythmSetup}%` : '',
    settings.rhythmConflict ? `中期冲突 ${settings.rhythmConflict}%` : '',
    settings.rhythmEnding ? `后期收束 ${settings.rhythmEnding}%` : '',
  ].filter(Boolean)

  return parts.length > 0 ? parts.join('；') : '（未配置）'
}

function formatWorldRulesSummary(raw?: string | null): string {
  return buildWorldRulesSummary(parseWorldRulesJson(raw))
}

function formatStyleTemplateSummary(contentJson?: string | null): string {
  const content = parseJsonRecord(contentJson)
  if (Object.keys(content).length === 0) return ''

  const lines: string[] = []
  const fields: Array<[string, string]> = [
    ['perspective', '视角'],
    ['sentence_style', '句式'],
    ['emotion_style', '情感表达'],
    ['dialogue_style', '对话风格'],
    ['description_style', '描写风格'],
    ['example_tone', '整体语气'],
  ]

  for (const [key, label] of fields) {
    const value = asText(content[key])
    if (value) lines.push(`${label}：${value}`)
  }

  const forbidden = toStringArray(content.forbidden)
  if (forbidden.length > 0) {
    lines.push(`避免：${forbidden.slice(0, 5).join('、')}`)
  }

  return lines.join('\n')
}

function enrichStyleTemplateWithFingerprint(baseTemplate: string, novelId: number): string {
  try {
    const fingerprints = listStyleFingerprints(novelId)
    if (fingerprints.length === 0) return baseTemplate

    // Use the most recent fingerprint for this novel
    const latest = fingerprints[fingerprints.length - 1]
    const section = buildStyleFingerprintPromptSection(latest.id)
    if (!section) return baseTemplate

    return baseTemplate ? `${baseTemplate}\n\n${section}` : section
  } catch {
    return baseTemplate
  }
}

function formatWorldTemplateSummary(template?: typeof templates.$inferSelect | null): string {
  if (!template) return ''

  const content = parseJsonRecord(template.contentJson)
  const lines: string[] = []

  if (template.name?.trim()) {
    lines.push(`模板名称：${template.name.trim()}`)
  }
  if (template.description?.trim()) {
    lines.push(`模板说明：${template.description.trim()}`)
  }

  for (const [key, value] of Object.entries(content)) {
    if (typeof value === 'string' && value.trim()) {
      lines.push(`${key}：${value.trim()}`)
      continue
    }

    if (Array.isArray(value) && value.length > 0) {
      const items = value.map(asLooseText).filter(Boolean).slice(0, 6)
      if (items.length > 0) {
        lines.push(`${key}：${items.join('、')}`)
      }
      continue
    }

    if (value && typeof value === 'object') {
      const nested = Object.entries(value as Record<string, unknown>)
        .map(([nestedKey, nestedValue]) => `${nestedKey}=${asLooseText(nestedValue)}`)
        .filter((item) => !item.endsWith('='))
        .slice(0, 6)
      if (nested.length > 0) {
        lines.push(`${key}：${nested.join('；')}`)
      }
    }
  }

  return lines.join('\n')
}

function buildBackgroundText(novel: typeof novels.$inferSelect): string {
  return novel.expandedBackground || novel.synopsis || novel.userBackground || ''
}

function getCanonicalProtagonist(
  allCharacters: Array<typeof characters.$inferSelect>,
): typeof characters.$inferSelect | null {
  return allCharacters.find((character) =>
    character.roleType === 'protagonist' && Boolean(character.fullName?.trim())) || null
}

function buildProtagonistPolicy(allCharacters: Array<typeof characters.$inferSelect>) {
  const protagonist = getCanonicalProtagonist(allCharacters)
  const protagonistName = protagonist?.fullName?.trim() || ''

  if (!protagonistName) {
    return {
      hasProtagonist: false,
      protagonistName: '',
      protagonistReference: '主角',
      protagonistRule: '当前尚未创建主角。若涉及核心人物，只能使用“主角”指代，禁止新增任何具体姓名、化名或变体名；若上下文出现旧名字，也应统一视为“主角”。',
    }
  }

  return {
    hasProtagonist: true,
    protagonistName,
    protagonistReference: protagonistName,
    protagonistRule: `当前主角已创建，唯一合法姓名为“${protagonistName}”。若上下文出现“主角”或其他旧名字，都应视为同一人，并统一改写为“${protagonistName}”；禁止新增、替换或变体化主角姓名。`,
  }
}

function buildStoryCoreText(profile: StoryProfile): string {
  return [
    profile.projectBriefSummary,
    profile.premiseSummary,
    profile.storyDesignSummary,
    profile.endgameDesignSummary,
    profile.themeVoiceSummary,
    profile.writingContractSummary,
    profile.writingRulesSummary,
    profile.storyThreadsSummary,
  ].filter(Boolean).join('\n\n')
}

function formatArcContext(arc?: typeof storyArcs.$inferSelect | null): string {
  if (!arc) return ''

  return [
    `故事弧：${arc.arcName}`,
    `章节范围：第${arc.chapterStart || '?'}章 - 第${arc.chapterEnd || '?'}章`,
    `本弧目标：${arc.arcGoal || '（未填写）'}`,
    `本弧概述：${arc.arcSummary || '（未填写）'}`,
    `当前推进度：${arc.progressPercent || 0}%`,
    typeof arc.stalledChapterCount === 'number' && arc.stalledChapterCount > 0
      ? `连续空转章节：${arc.stalledChapterCount}`
      : '',
    typeof arc.lastProgressChapterNum === 'number'
      ? `最近推进章节：第${arc.lastProgressChapterNum}章`
      : '',
    arc.growthLedger ? `成长账本：${arc.growthLedger}` : '',
    arc.costLedger ? `代价账本：${arc.costLedger}` : '',
  ].filter(Boolean).join('\n')
}

function buildCharacterStates(
  allCharacters: Array<typeof characters.$inferSelect>,
  recentChapters: ChapterWithContinuity[],
  mentionedNames?: Set<string>,
): string {
  if (allCharacters.length === 0) return ''
  const db = getDb()
  const novelId = allCharacters[0]?.novelId
  const relationRows = typeof novelId === 'number'
    ? db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
    : []
  const dialogueHintMap = typeof novelId === 'number' ? getCharacterDialogueHintMap(novelId) : undefined
  const stateHintMap = typeof novelId === 'number'
    ? getCharacterStateContextHintMap(novelId, {
        upToChapterNum: recentChapters[recentChapters.length - 1]?.chapterNum,
        mentionedNames,
        limit: 15,
      })
    : undefined
  const cards = buildCharacterContextCards({
    allCharacters,
    relationRows,
    recentStateEntries: recentChapters.flatMap((chapter) =>
      chapter.continuityState.characterStateChanges.map((entry) => ({
        chapterNum: chapter.chapterNum,
        entry,
      }))),
    dialogueHintMap,
    stateHintMap,
    mentionedNames,
    limit: 15,
  })
  return renderCharacterCards(cards)
}

function extractChapterGoal(outline?: string | null): string {
  if (!outline) return ''
  const match = outline.match(/(?:^|\n)(?:目标|本章目标)[:：]?\s*(.+)/)
  if (match?.[1]) return match[1].trim()

  const firstLine = outline.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine || ''
}

export function parseContinuityState(raw?: string | null): ContinuityState {
  const parsed = parseJsonRecord(raw)
  return {
    plotProgress: toStringArray(parsed.plot_progress),
    characterStateChanges: toStringArray(parsed.character_state_changes),
    worldStateChanges: toStringArray(parsed.world_state_changes),
    openLoops: toStringArray(parsed.open_loops),
    continuityNotes: toStringArray(parsed.continuity_notes),
    arcProgress: asText(parsed.arc_progress),
  }
}

function hasContinuityContent(state: ContinuityState): boolean {
  return Boolean(
    state.plotProgress.length > 0 ||
    state.characterStateChanges.length > 0 ||
    state.worldStateChanges.length > 0 ||
    state.openLoops.length > 0 ||
    state.continuityNotes.length > 0 ||
    state.arcProgress,
  )
}

function formatContinuityEntry(chapter: ChapterWithContinuity): string {
  const parts = [
    chapter.summary ? `摘要：${chapter.summary}` : '',
    chapter.continuityState.plotProgress.length > 0 ? `推进：${chapter.continuityState.plotProgress.join('；')}` : '',
    chapter.continuityState.characterStateChanges.length > 0 ? `人物变化：${chapter.continuityState.characterStateChanges.join('；')}` : '',
    chapter.continuityState.worldStateChanges.length > 0 ? `世界变化：${chapter.continuityState.worldStateChanges.join('；')}` : '',
    chapter.continuityState.arcProgress ? `故事弧推进：${chapter.continuityState.arcProgress}` : '',
  ].filter(Boolean)

  return `第${chapter.chapterNum}章：${parts.join(' | ')}`
}

export function buildStoryRelationSummary(
  novelId: number,
  allCharacters: Array<typeof characters.$inferSelect>,
  focusText: string,
  limit = 8,
): string {
  const db = getDb()
  const relationRows = db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
  if (relationRows.length === 0 || allCharacters.length < 2) return ''

  return renderRelationCards(buildRelationContextCards({
    allCharacters,
    relationRows,
    focusText,
    limit,
  }))
}

function collectOpenLoops(chapterRows: ChapterWithContinuity[]): string {
  const values = dedupe(chapterRows.flatMap((chapter) => chapter.continuityState.openLoops), 8)
  return values.join('\n')
}

function collectContinuityNotes(chapterRows: ChapterWithContinuity[]): string {
  const values = dedupe(chapterRows.flatMap((chapter) => chapter.continuityState.continuityNotes), 8)
  return values.join('\n')
}

function buildTimelineContext(
  novelId: number,
  chapterNum: number,
  currentArcId: number | null | undefined,
  chapterRows: Array<typeof chapters.$inferSelect>,
  characterRows: Array<typeof characters.$inferSelect>,
): { timelineSummary: string; timelineOpenThreads: string } {
  const db = getDb()
  const eventRows = db.select().from(timelineEvents)
    .where(eq(timelineEvents.novelId, novelId))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .all()
  if (eventRows.length === 0) {
    return { timelineSummary: '', timelineOpenThreads: '' }
  }

  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const chapterNumMap = new Map(chapterRows.map((row) => [row.id, row.chapterNum]))
  const arcNameMap = new Map(arcRows.map((row) => [row.id, row.arcName]))
  const characterNameMap = new Map(characterRows.map((row) => [row.id, row.fullName]))
  const locationNameMap = new Map(mapRows.map((row) => [row.id, row.name]))

  const hasHappened = (event: typeof timelineEvents.$inferSelect) => {
    const end = event.chapterEndId ? chapterNumMap.get(event.chapterEndId) : undefined
    const start = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
    if (typeof end === 'number') return end < chapterNum
    if (typeof start === 'number') return start < chapterNum
    return event.status === 'written' || event.status === 'resolved'
  }

  const isNearFuture = (event: typeof timelineEvents.$inferSelect) => {
    const start = event.chapterStartId ? chapterNumMap.get(event.chapterStartId) : undefined
    if (typeof start === 'number') {
      return start >= chapterNum && start <= chapterNum + 3
    }
    return event.status === 'planned' || event.status === 'seeded'
  }

  const selectedIds = new Set<number>()
  eventRows.filter(hasHappened).slice(-4).forEach((event) => selectedIds.add(event.id))
  eventRows.filter((event) => event.arcId && event.arcId === currentArcId).slice(-3).forEach((event) => selectedIds.add(event.id))
  eventRows.filter(isNearFuture).slice(0, 3).forEach((event) => selectedIds.add(event.id))

  const selectedRows = eventRows
    .filter((event) => selectedIds.has(event.id))
    .slice(-6)

  const timelineSummary = renderTimelineCards(buildTimelineContextCards(selectedRows, {
    chapterNumMap,
    arcNameMap,
    characterNameMap,
    locationNameMap,
  }, 6))

  const timelineOpenThreads = renderThreadCards(buildGenericThreadCardsFromTexts(
    dedupe(selectedRows.flatMap((event) => parseJsonStringArray(event.openThreadsJson)), 10),
    '时间轴待回收',
    10,
  ))

  return { timelineSummary, timelineOpenThreads }
}

function buildItemSummary(novelId: number): string {
  const db = getDb()
  const characterNameMap = new Map(
    db.select({ id: characters.id, fullName: characters.fullName }).from(characters).all()
      .map((row) => [row.id, row.fullName]),
  )
  const locationNameMap = new Map(
    db.select({ id: worldMap.id, name: worldMap.name }).from(worldMap).all()
      .map((row) => [row.id, row.name]),
  )
  const rows = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
    .filter((item) => item.itemKind === 'instance')

  if (rows.length === 0) return ''

  return renderItemCards(buildItemContextCards({
    items: rows,
    characterNameMap,
    locationNameMap,
    limit: 12,
  }))
}

function buildActiveThreadsContextData(
  novelId: number,
  chapterNum: number,
  currentArc?: typeof storyArcs.$inferSelect | null,
): { summary: string; pressureCount: number } {
  const db = getDb()
  const rows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()

  if (rows.length === 0) {
    return { summary: '', pressureCount: 0 }
  }
  const threadContext = buildChapterThreadContextCards({
    threads: rows,
    chapterNum,
    currentArc,
    limit: 10,
  })

  return {
    summary: renderThreadCards(threadContext.cards),
    pressureCount: threadContext.pressureCount,
  }
}

function isForeshadowThreadCandidate(thread: typeof storyThreads.$inferSelect): boolean {
  return Boolean(
    typeof thread.targetPayoffChapter === 'number'
    || (thread.payoffCondition && thread.payoffCondition.trim())
    || thread.threadType === 'mystery'
    || thread.threadType === 'payoff',
  )
}

function isCurrentArcThread(
  thread: typeof storyThreads.$inferSelect,
  currentArc?: typeof storyArcs.$inferSelect | null,
): boolean {
  if (!currentArc || typeof currentArc.chapterStart !== 'number' || typeof currentArc.chapterEnd !== 'number') return false
  const spanStart = thread.startChapter || thread.plantedChapter || thread.lastReferencedChapter || 0
  const spanEnd = thread.targetPayoffChapter || thread.lastReferencedChapter || thread.plantedChapter || thread.startChapter || 0
  if (!spanStart && !spanEnd) return false
  const rangeStart = spanStart || spanEnd
  const rangeEnd = spanEnd || spanStart
  return rangeStart <= currentArc.chapterEnd && rangeEnd >= currentArc.chapterStart
}

function threadPriorityRank(priority?: string | null): number {
  if (priority === 'high') return 0
  if (priority === 'medium') return 1
  return 2
}

function buildDueForeshadowContext(
  novelId: number,
  chapterNum: number,
  currentArc?: typeof storyArcs.$inferSelect | null,
): string {
  const db = getDb()
  const rows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
    .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')
    .filter(isForeshadowThreadCandidate)
    .filter((thread) => typeof thread.targetPayoffChapter === 'number' && thread.targetPayoffChapter > 0)

  if (rows.length === 0) return ''

  return rows
    .filter((thread) => {
      const distance = thread.targetPayoffChapter! - chapterNum
      return distance <= 0 || distance <= 3
    })
    .sort((left, right) => {
      const leftOverdue = left.targetPayoffChapter! < chapterNum ? 0 : 1
      const rightOverdue = right.targetPayoffChapter! < chapterNum ? 0 : 1
      if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue

      const leftArc = isCurrentArcThread(left, currentArc) ? 0 : 1
      const rightArc = isCurrentArcThread(right, currentArc) ? 0 : 1
      if (leftArc !== rightArc) return leftArc - rightArc

      const leftDistance = Math.abs(left.targetPayoffChapter! - chapterNum)
      const rightDistance = Math.abs(right.targetPayoffChapter! - chapterNum)
      if (leftDistance !== rightDistance) return leftDistance - rightDistance

      const leftPriority = threadPriorityRank(left.priority)
      const rightPriority = threadPriorityRank(right.priority)
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      return (left.sortOrder || 0) - (right.sortOrder || 0)
    })
    .slice(0, 6)
    .map((thread) => compactRecallLine([
      thread.targetPayoffChapter! < chapterNum ? '超期' : '到期',
      thread.title,
      thread.plantedChapter || thread.startChapter ? `埋设=第${thread.plantedChapter || thread.startChapter}章` : '',
      `目标=第${thread.targetPayoffChapter}章`,
      thread.currentState || thread.summary || '',
      thread.payoffCondition ? `条件=${thread.payoffCondition}` : '',
    ].filter(Boolean).join(' · '), 120))
    .filter(Boolean)
    .join('\n')
}

function buildActiveThreadsContext(
  novelId: number,
  chapterNum: number,
  currentArc?: typeof storyArcs.$inferSelect | null,
): string {
  return buildActiveThreadsContextData(novelId, chapterNum, currentArc).summary
}

function buildStoryThreadsSummary(novelId: number): string {
  const db = getDb()
  const rows = db.select().from(storyThreads)
    .where(eq(storyThreads.novelId, novelId))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .all()
    .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')

  if (rows.length === 0) return ''

  return rows
    .slice(0, 8)
    .map((thread) => {
      const parts = [
        thread.threadType || 'subplot',
        thread.status || 'planned',
        thread.targetPayoffChapter ? `目标回收=第${thread.targetPayoffChapter}章` : '',
        thread.currentState || thread.summary || thread.premise || '',
      ].filter(Boolean)
      return `${thread.title}${parts.length > 0 ? `：${parts.join(' | ')}` : ''}`
    })
    .join('\n')
}

function resolveArcForChapter(
  chapterNum: number,
  chapterArcId: number | null | undefined,
  arcs: Array<typeof storyArcs.$inferSelect>,
): typeof storyArcs.$inferSelect | null {
  if (chapterArcId) {
    const linkedArc = arcs.find((arc) => arc.id === chapterArcId)
    if (linkedArc) return linkedArc
  }

  return arcs.find((arc) => {
    const start = arc.chapterStart ?? Number.MIN_SAFE_INTEGER
    const end = arc.chapterEnd ?? Number.MAX_SAFE_INTEGER
    return chapterNum >= start && chapterNum <= end
  }) || null
}

function toChapterWithContinuity(row: typeof chapters.$inferSelect): ChapterWithContinuity {
  return {
    chapterNum: row.chapterNum,
    summary: row.summary || '',
    nextChapterSeed: row.nextChapterSeed || '',
    content: row.content || '',
    continuityState: parseContinuityState(row.continuityStateJson),
  }
}

function createEmptyPreviousChapterSampleReport(): PreviousChapterSampleReport {
  return {
    sourceChapterId: null,
    sourceChapterNum: null,
    sourceChapterChars: 0,
    sampledChars: 0,
    coverageRate: 0,
    segmentCount: 0,
    fullyInjected: false,
    segments: [],
  }
}

function extractTextWindow(text: string, mode: 'head' | 'middle' | 'tail', maxChars: number): string {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized

  if (mode === 'head') return normalized.slice(0, maxChars).trim()
  if (mode === 'tail') return normalized.slice(-maxChars).trim()

  const start = Math.max(Math.floor((normalized.length - maxChars) / 2), 0)
  return normalized.slice(start, start + maxChars).trim()
}

function parseSceneAnchorLines(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return dedupe(parsed
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => {
        const record = item as Record<string, unknown>
        const title = asText(record.scene_title)
        const purpose = asText(record.purpose)
        const conflict = asText(record.conflict)
        const exitHook = asText(record.exit_hook)
        const parts = [
          purpose ? `目标 ${compactRecallLine(purpose, 28)}` : '',
          conflict ? `冲突 ${compactRecallLine(conflict, 24)}` : '',
          exitHook ? `收尾 ${compactRecallLine(exitHook, 22)}` : '',
        ].filter(Boolean)
        if (!title && parts.length === 0) return ''
        return `${title || '场景'}：${parts.join('；')}`
      })
      .filter(Boolean), 3)
  } catch {
    return []
  }
}

function parseReviewHighlightLines(raw?: string | null): string[] {
  const parsed = parseJsonRecord(raw)
  return dedupe([
    ...toStringArray(parsed.critical_fixes).map((item) => `修订重点：${compactRecallLine(item, 42)}`),
    ...toStringArray(parsed.continuity_risks).map((item) => `连续性风险：${compactRecallLine(item, 42)}`),
    ...toStringArray(parsed.human_language_repairs).map((item) => `语言修复：${compactRecallLine(item, 42)}`),
  ], 3)
}

function loadPreviousChapterWritebackLines(chapterId: number): string[] {
  const db = getDb()
  const latestRun = db.select().from(chapterWritebackRuns).where(eq(chapterWritebackRuns.chapterId, chapterId)).all()
    .sort((left, right) => right.id - left.id)[0]
  if (!latestRun) return []

  const diffLines = db.select().from(chapterWritebackDiffs).where(eq(chapterWritebackDiffs.runId, latestRun.id)).all()
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id)
    .map((row) => compactRecallLine(row.diffReason || '', 42))
    .filter(Boolean)

  return dedupe([
    latestRun.summaryText ? `Canon 摘要：${compactRecallLine(latestRun.summaryText, 56)}` : '',
    ...diffLines.map((item) => `状态回写：${item}`),
  ].filter(Boolean), 3)
}

function formatPreviousChapterContextText(segments: PreviousChapterSampleSegment[]): string {
  return segments
    .map((segment) => `${segment.label}：\n${segment.text}`)
    .join('\n\n')
    .trim()
}

export function buildPreviousChapterContextFeed(previousChapter?: PreviousChapterFeedSource | null): {
  previousChapterContext: string
  lastChapterEnding: string
  previousChapterSampleReport: PreviousChapterSampleReport
} {
  if (!previousChapter) {
    return {
      previousChapterContext: '',
      lastChapterEnding: '',
      previousChapterSampleReport: createEmptyPreviousChapterSampleReport(),
    }
  }

  const sourceText = (previousChapter.content || '').trim()
  const sourceChars = sourceText.length
  const continuity = parseContinuityState(previousChapter.continuityStateJson)
  const seedText = previousChapter.nextChapterSeed
    ? `下章引子：${compactRecallLine(previousChapter.nextChapterSeed, 88)}`
    : ''
  const continuityLines = dedupe([
    ...continuity.plotProgress.map((item) => `推进：${compactRecallLine(item, 42)}`),
    ...continuity.characterStateChanges.map((item) => `人物变化：${compactRecallLine(item, 42)}`),
    ...continuity.worldStateChanges.map((item) => `世界变化：${compactRecallLine(item, 42)}`),
    ...continuity.openLoops.map((item) => `未回收：${compactRecallLine(item, 42)}`),
    ...continuity.continuityNotes.map((item) => `承接提醒：${compactRecallLine(item, 42)}`),
    continuity.arcProgress ? `故事弧：${compactRecallLine(continuity.arcProgress, 42)}` : '',
  ].filter(Boolean), 4)
  const sceneAnchorLines = parseSceneAnchorLines(previousChapter.scenePlanJson)
  const reviewLines = parseReviewHighlightLines(previousChapter.reviewNotesJson)
  const writebackLines = loadPreviousChapterWritebackLines(previousChapter.id)

  const segments: PreviousChapterSampleSegment[] = []
  const seenTexts = new Set<string>()
  const pushSegment = (
    type: PreviousChapterSampleSegmentType,
    label: string,
    text: string,
  ) => {
    const normalized = text.replace(/\r\n/g, '\n').trim()
    if (!normalized || seenTexts.has(normalized)) return
    seenTexts.add(normalized)
    segments.push({
      type,
      label,
      text: normalized,
      chars: normalized.length,
    })
  }

  if (sourceChars > 0 && sourceChars < 1000) {
    pushSegment('full_text', '上一章全文', sourceText)
    if (seedText) pushSegment('seed', '衔接提示', seedText)
  } else {
    pushSegment('opening', '上一章开场', extractTextWindow(sourceText, 'head', 220))
    if (previousChapter.summary) {
      pushSegment('summary', '上一章摘要', compactRecallLine(previousChapter.summary, 140))
    }
    if (continuityLines.length > 0) {
      pushSegment('continuity', '状态变化与承接', continuityLines.join('\n'))
    }
    if (sceneAnchorLines.length > 0) {
      pushSegment('scene_anchor', '场景锚点', sceneAnchorLines.join('\n'))
    }
    if (reviewLines.length > 0) {
      pushSegment('review', '审校重点', reviewLines.join('\n'))
    }
    if (writebackLines.length > 0) {
      pushSegment('writeback', 'Canon / 状态回写', writebackLines.join('\n'))
    }
    if (seedText) pushSegment('seed', '衔接提示', seedText)
    if (sourceChars > 0) {
      pushSegment('tail', '上章结尾原文', extractTextWindow(sourceText, 'tail', 300))
    }

    let composed = formatPreviousChapterContextText(segments)
    if (composed.length < 1000 && sourceChars > 0) {
      pushSegment('scene_anchor', '上章中段片段', extractTextWindow(sourceText, 'middle', 220))
      composed = formatPreviousChapterContextText(segments)
    }
    if (composed.length > 1800) {
      const optionalTypes: PreviousChapterSampleSegmentType[] = ['review', 'writeback', 'summary', 'opening']
      for (const type of optionalTypes) {
        const index = segments.findIndex((segment) => segment.type === type)
        if (index < 0) continue
        segments.splice(index, 1)
        composed = formatPreviousChapterContextText(segments)
        if (composed.length <= 1800) break
      }
    }
  }

  const previousChapterContext = formatPreviousChapterContextText(segments)
  const lastChapterEnding = [
    extractTextWindow(sourceText, 'tail', 300),
    seedText,
  ].filter(Boolean).join('\n')
  const sampledChars = previousChapterContext.length
  const coverageBase = sourceChars > 0
    ? Math.min(sampledChars, sourceChars)
    : 0
  const previousChapterSampleReport: PreviousChapterSampleReport = {
    sourceChapterId: previousChapter.id,
    sourceChapterNum: previousChapter.chapterNum,
    sourceChapterChars: sourceChars,
    sampledChars,
    coverageRate: sourceChars > 0 ? Math.round((coverageBase / sourceChars) * 1000) / 10 : 0,
    segmentCount: segments.length,
    fullyInjected: sourceChars > 0 && sourceChars < 1000,
    segments,
  }

  return {
    previousChapterContext,
    lastChapterEnding,
    previousChapterSampleReport,
  }
}

export async function buildStoryProfile(novelId: number): Promise<StoryProfile> {
  const db = getDb()
  ensureStoryStructure(novelId)
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const genre = novel.genreId
    ? db.select().from(genres).where(eq(genres.id, novel.genreId)).all()[0]
    : null
  const styleTemplate = novel.styleTemplateId
    ? db.select().from(templates).where(eq(templates.id, novel.styleTemplateId)).all()[0]
    : null
  const worldTemplate = novel.worldTemplateId
    ? db.select().from(templates).where(eq(templates.id, novel.worldTemplateId)).all()[0]
    : null
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).all()

  const settings = parseStorySettings(novel.settingsJson)
  const projectBrief = parseProjectBriefDocument(novel.projectBriefJson)
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const writingContractSummary = buildWritingContractSummary(themeVoice.writingContractTags)
  const protagonistPolicy = buildProtagonistPolicy(allCharacters)

  return {
    novelId,
    novelTitle: novel.title,
    genre: genre?.name || '未知题材',
    background: buildBackgroundText(novel),
    projectBriefSummary: buildProjectBriefSummary(projectBrief),
    premiseSummary: buildPremiseSummary(settings.premise),
    storyDesignSummary: buildStoryDesignSummary({
      storyGoal: settings.storyGoal,
      coreConflict: settings.coreConflict,
      mainPlot: settings.mainPlot,
      subPlotsText: settings.subPlotsText,
      subPlotsList: settings.subPlotsList,
      rhythmSetup: settings.rhythmSetup,
      rhythmConflict: settings.rhythmConflict,
      rhythmEnding: settings.rhythmEnding,
      ending: settings.ending,
    }),
    endgameDesignSummary: settings.endgameDesignSummary,
    themeVoiceSummary: buildThemeVoiceSummary(themeVoice),
    writingContractSummary,
    writingRulesSummary: buildWritingRulesSummary(settings.writingRules),
    storyThreadsSummary: buildStoryThreadsSummary(novelId),
    storyGoal: settings.storyGoal,
    coreConflict: settings.coreConflict,
    mainPlot: settings.mainPlot,
    subPlots: formatSubPlots(settings),
    ending: settings.ending,
    rhythmSummary: formatRhythmSummary(settings),
    worldRulesSummary: [
      formatWorldRulesSummary(novel.worldRulesJson),
      formatWorldTemplateSummary(worldTemplate),
    ].filter(Boolean).join('\n\n'),
    styleTemplateSummary: formatStyleTemplateSummary(styleTemplate?.contentJson),
    hasProtagonist: protagonistPolicy.hasProtagonist,
    protagonistName: protagonistPolicy.protagonistName,
    protagonistReference: protagonistPolicy.protagonistReference,
    protagonistRule: protagonistPolicy.protagonistRule,
  }
}

export async function buildOutlineGenerationContext(arcId: number): Promise<OutlineGenerationContext> {
  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
  if (arc) ensureStoryStructure(arc.novelId)
  if (!arc) throwUserFacingError('storyArc.notFound')
  const novel = db.select().from(novels).where(eq(novels.id, arc.novelId)).all()[0]

  const profile = await buildStoryProfile(arc.novelId)
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, arc.novelId)).all()
  const previousRows = db.select().from(chapters)
    .where(eq(chapters.novelId, arc.novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
    .filter((chapter) => chapter.chapterNum < (arc.chapterStart || 1))

  const recentWindow = resolveRecentContextWindow(novel?.targetWords || 0, previousRows.length)
  const recentChapters = previousRows.slice(-recentWindow).map(toChapterWithContinuity)
  const previousSummary = recentChapters
    .filter((chapter) => chapter.summary)
    .map((chapter) => `第${chapter.chapterNum}章：${chapter.summary}`)
    .join('\n')

  const continuityChapters = recentChapters.filter((chapter) => hasContinuityContent(chapter.continuityState))

  return {
    profile,
    arc,
    previousSummary,
    characterStates: buildCharacterStates(allCharacters, recentChapters),
    worldStates: getWorldStateContextSnapshot(novel.id, {
      upToChapterNum: recentChapters[recentChapters.length - 1]?.chapterNum,
      limit: 10,
    }).worldStatesText,
    continuitySummary: continuityChapters.map(formatContinuityEntry).join('\n'),
    openLoops: collectOpenLoops(continuityChapters),
    worldRulesSummary: profile.worldRulesSummary,
  }
}

export async function collectChapterContextRawData(
  novelId: number,
  chapterNum: number,
): Promise<ChapterContextRawData> {
  const db = getDb()
  ensureStoryStructure(novelId)
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const chapterRows = db.select().from(chapters)
    .where(eq(chapters.novelId, novelId))
    .orderBy(asc(chapters.chapterNum))
    .all()
  const currentChapter = chapterRows.find((chapter) => chapter.chapterNum === chapterNum)
  const arcs = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const currentArc = resolveArcForChapter(chapterNum, currentChapter?.arcId, arcs)
  const previousRows = chapterRows.filter((chapter) => chapter.chapterNum < chapterNum)
  const targetWords = Number(novel.targetWords || 0)
  const recentWindow = resolveRecentContextWindow(targetWords, chapterRows.length)
  const recentChapters = previousRows.slice(-recentWindow).map(toChapterWithContinuity)
  const continuityChapters = recentChapters.filter((chapter) => hasContinuityContent(chapter.continuityState))
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const allItems = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const allLocations = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const timelineContext = buildTimelineContext(
    novelId,
    chapterNum,
    currentArc?.id,
    chapterRows,
    allCharacters,
  )
  const longTermMemory = buildStoryMemoryPromptSummary(novelId, { chapterId: currentChapter?.id })
  const itemSummary = buildItemSummary(novelId)
  const activeThreadsContext = buildActiveThreadsContextData(novelId, chapterNum, currentArc)
  const contractContext = currentChapter ? getChapterContractContext(currentChapter.id) : null
  const chapterContract = contractContext?.chapterContract || null
  const chapterGoal = [
    chapterContract?.chapterGoal || '',
    extractChapterGoal(currentChapter?.outline),
  ].filter(Boolean).join('\n')
  const chapterContractRules = [
    chapterContract?.hookType ? `本章钩子：${chapterContract.hookType}` : '',
    formatContractLine('本章禁止', chapterContract?.forbiddenActions || []),
    formatContractLine('验收要求', chapterContract?.acceptanceNotes || []),
    formatContractLine('必须推进', chapterContract?.requiredArcProgress || []),
    formatContractLine('必须出现资产', chapterContract?.requiredAssetRefs || []),
  ].filter(Boolean)
  const requiredCommitments = contractContext?.requiredCommitments || []
  const requiredForeshadows = contractContext?.requiredForeshadows || []
  const promiseCommitmentLines = requiredCommitments
    .filter((item) => item.commitmentKind === 'promise')
    .map((item) => `终局承诺：${compactRecallLine(item.title, 30)}${item.description ? ` · ${compactRecallLine(item.description, 44)}` : ''}`)
  const payoffCommitmentLines = requiredCommitments
    .filter((item) => item.commitmentKind === 'payoff')
    .map((item) => `终局回收：${compactRecallLine(item.title, 30)}${item.description ? ` · ${compactRecallLine(item.description, 44)}` : ''}`)
  const requiredForeshadowLines = requiredForeshadows
    .map((item) => `合同伏笔：${compactRecallLine(item.title, 28)}${item.detail ? ` · ${compactRecallLine(item.detail, 44)}` : ''}`)
  const sceneContractLines = buildSceneContractSummaryLines(contractContext?.sceneContracts || [])

  // 从当前章节任务相关文本里提取实体名，用于动态召回
  const recallSignalText = [
    currentChapter?.title,
    chapterGoal,
    currentChapter?.outline,
    currentArc?.arcSummary,
    currentArc?.arcGoal,
  ].filter(Boolean).join('\n')
  const mentionedCharacterNames = new Set<string>(collectMentionedEntityNames(
    recallSignalText,
    allCharacters.map((character) => character.fullName || ''),
    8,
  ))
  const mentionedItemNames = collectMentionedEntityNames(
    recallSignalText,
    allItems.map((item) => item.itemName || ''),
    8,
  )
  const mentionedLocationNames = collectMentionedEntityNames(
    recallSignalText,
    allLocations.map((location) => location.name || ''),
    6,
  )
  const outlineMentionedCharacterCount = allCharacters.filter((character) => {
    if (!character.fullName) return false
    return Boolean(currentChapter?.outline && currentChapter.outline.includes(character.fullName))
  }).length

  const previousSummaries = recentChapters
    .filter((chapter) => chapter.summary)
    .map((chapter) => `第${chapter.chapterNum}章：${chapter.summary}`)
    .join('\n')

  const matchedCharacterRows = allCharacters.filter((character) =>
    character.fullName && mentionedCharacterNames.has(character.fullName))
  const glossaryContextSummary = buildGlossaryContextSummary(novelId, [
    currentChapter?.title || '',
    currentChapter?.outline || '',
    previousSummaries,
  ])
  const factionContextSummary = buildFactionContextSummary(novelId, matchedCharacterRows)
  const worldRulesContext = [
    profile.worldRulesSummary,
    glossaryContextSummary,
    factionContextSummary,
  ].filter(Boolean).join('\n\n')

  const relationSummary = buildStoryRelationSummary(
    novelId,
    allCharacters,
    [currentChapter?.outline, currentArc?.arcSummary, currentArc?.arcGoal, previousSummaries].filter(Boolean).join("\n"),
  )

  const previousChapterFeed = buildPreviousChapterContextFeed(previousRows[previousRows.length - 1])
  const worldStateSnapshot = getWorldStateContextSnapshot(novelId, {
    upToChapterNum: recentChapters[recentChapters.length - 1]?.chapterNum,
    limit: 12,
  })
  const entityFreshnessMap = buildRecallEntityFreshnessMap(
    novelId,
    recentChapters[recentChapters.length - 1]?.chapterNum,
  )

  const result = {
    novel,
    profile,
    chapterRows,
    currentChapter,
    currentArc,
    outlineMentionedCharacterCount,
    activeThreadPressureCount: activeThreadsContext.pressureCount,
    contextParts: {
      chapterGoal,
      storyCore: buildStoryCoreText(profile),
      writingContractSummary: [
        profile.writingContractSummary,
        chapterContractRules.length > 0 ? `章节合同：${chapterContractRules.join('；')}` : '',
      ].filter(Boolean).join('\n'),
      currentArc: formatArcContext(currentArc),
      continuityNotes: [
        collectContinuityNotes(continuityChapters),
        ...chapterContractRules,
        ...sceneContractLines,
      ].filter(Boolean).join('\n'),
      previousChapterContext: previousChapterFeed.previousChapterContext,
      lastChapterEnding: previousChapterFeed.lastChapterEnding,
      openLoops: [
        collectOpenLoops(continuityChapters),
        ...promiseCommitmentLines,
      ].filter(Boolean).join('\n'),
      dueForeshadows: [
        buildDueForeshadowContext(novelId, chapterNum, currentArc),
        ...payoffCommitmentLines,
        ...requiredForeshadowLines,
      ].filter(Boolean).join('\n'),
      timelineOpenThreads: timelineContext.timelineOpenThreads,
      worldRules: worldRulesContext,
      itemSummary,
      longTermMemory,
      characterStates: buildCharacterStates(allCharacters, recentChapters, mentionedCharacterNames),
      worldStates: worldStateSnapshot.worldStatesText,
      continuitySummary: continuityChapters.map(formatContinuityEntry).join('\n'),
      timelineSummary: timelineContext.timelineSummary,
      relationSummary,
      activeThreads: activeThreadsContext.summary,
      styleTemplate: enrichStyleTemplateWithFingerprint(profile.styleTemplateSummary, novelId),
      previousSummaries,
      recalledMemory: '', // placeholder, filled below
    },
    previousChapterSampleReport: previousChapterFeed.previousChapterSampleReport,
    recallDiagnostics: buildEmptyRecallDiagnostics(['召回尚未执行。']),
    recalledMemorySources: [] as RecallMemorySource[],
  }

  // 多信号向量召回：同时补足角色、规则、线程三类历史约束
  try {
    const recallBuckets = buildRecallQueryBuckets({
      chapterGoal,
      outline: currentChapter?.outline || '',
      arcGoal: currentArc?.arcGoal || '',
      arcSummary: currentArc?.arcSummary || '',
      storyGoal: profile.storyGoal,
      coreConflict: profile.coreConflict,
      mainPlot: profile.mainPlot,
      themeVoiceSummary: profile.themeVoiceSummary,
      worldRules: result.contextParts.worldRules,
      relationSummary,
      characterStates: result.contextParts.characterStates,
      worldStates: result.contextParts.worldStates,
      itemSummary,
      timelineSummary: timelineContext.timelineSummary,
      timelineOpenThreads: timelineContext.timelineOpenThreads,
      activeThreads: activeThreadsContext.summary,
      openLoops: result.contextParts.openLoops,
      dueForeshadows: result.contextParts.dueForeshadows,
      continuityNotes: result.contextParts.continuityNotes,
      storyThreadsSummary: profile.storyThreadsSummary,
      mentionedCharacters: [...mentionedCharacterNames],
      mentionedItems: mentionedItemNames,
      mentionedLocations: mentionedLocationNames,
    })

    if (recallBuckets.length > 0) {
      const constraintText = [
        result.contextParts.characterStates,
        result.contextParts.worldStates,
        relationSummary,
        itemSummary,
        result.contextParts.openLoops,
        result.contextParts.dueForeshadows,
        result.contextParts.continuityNotes,
      ].filter(Boolean).join('\n')
      const bucketResults = await Promise.all(recallBuckets.map(async (bucket) => ({
        bucket: bucket.bucket,
        hits: (await findSimilarFragments(novelId, bucket.query, bucket.topK, novel.modelConfigId || undefined))
          .filter((hit) => hit.chapterNum < chapterNum)
          .map((hit) => enrichRecallHits([hit], bucket.bucket, chapterNum, entityFreshnessMap, constraintText)[0]),
      })))
      const recallSnapshot = buildRecallSnapshot(bucketResults)
      result.contextParts.recalledMemory = recallSnapshot.recalledMemory
      result.recallDiagnostics = recallSnapshot.recallDiagnostics
      result.recalledMemorySources = recallSnapshot.recalledMemorySources
    }
  } catch {
    result.recallDiagnostics = buildEmptyRecallDiagnostics([
      '向量召回当前不可用，已自动降级，不影响硬约束与结构化状态注入。',
    ])
  }

  return result
}

export function allocateChapterContext(
  rawData: ChapterContextRawData,
  options: number | BuildChapterContextOptions = 10000,
): ChapterContext {
  const normalizedOptions: BuildChapterContextOptions = typeof options === 'number'
    ? { totalBudget: options }
    : options || {}
  const requestedBudget = normalizedOptions.totalBudget ?? 10000
  const promptProfile = normalizedOptions.promptProfile || 'draft'
  const chapterComplexity = normalizedOptions.chapterComplexity || 'standard'
  const targetWords = Number(rawData.novel.targetWords || 0)
  const modelRuntimeBudget = resolveModelRuntimeBudget(rawData.novel.modelConfigId)
  const modelContextLimit = modelRuntimeBudget.maxContextTokens && modelRuntimeBudget.maxContextTokens > 0
    ? modelRuntimeBudget.maxContextTokens
    : 32000
  const totalBudget = Math.min(requestedBudget, modelContextLimit)
  const modelBudgetLimited = modelContextLimit < requestedBudget
  const effectiveBudget = Math.min(modelContextLimit, resolveChapterBudgetFloor(targetWords, totalBudget))
  const promptFixedOverhead = resolvePromptFixedOverhead(promptProfile, chapterComplexity, targetWords)
  const requestedOutputReserve = resolvePromptOutputReserve(promptProfile, chapterComplexity, targetWords)
  const configuredOutputLimit = modelRuntimeBudget.maxTokens && modelRuntimeBudget.maxTokens > 0
    ? modelRuntimeBudget.maxTokens
    : requestedOutputReserve
  const reservedForOutput = modelBudgetLimited
    ? Math.max(0, Math.min(
      Math.max(requestedOutputReserve, configuredOutputLimit),
      Math.max(0, effectiveBudget - promptFixedOverhead),
    ))
    : requestedOutputReserve
  const remainingContextBudget = effectiveBudget - promptFixedOverhead - reservedForOutput
  const contextBudget = modelBudgetLimited
    ? Math.max(0, remainingContextBudget)
    : Math.max(3600, remainingContextBudget)
  const priorityMap = createStagePriorityMap(promptProfile, chapterComplexity, targetWords, rawData.chapterRows.length)
  const hardConstraintDrafts = buildHardConstraintDrafts(rawData.contextParts)
  const desiredHardConstraintBudget = resolveHardConstraintBudget(promptProfile, chapterComplexity, targetWords)
  const minimumSoftContextBudget = Math.min(2400, Math.max(1200, Math.floor(contextBudget * 0.28)))
  const initialHardConstraintBudget = contextBudget <= minimumSoftContextBudget
    ? contextBudget
    : Math.min(desiredHardConstraintBudget, contextBudget - minimumSoftContextBudget)
  const requiredHardConstraintTokens = hardConstraintDrafts.reduce((sum, draft) => sum + estimateTokens(draft.content), 0)
  const hardConstraintBudget = requiredHardConstraintTokens <= contextBudget
    ? Math.max(initialHardConstraintBudget, requiredHardConstraintTokens)
    : contextBudget
  const hardConstraintAllocation = allocateHardConstraintEntries(hardConstraintDrafts, hardConstraintBudget)
  const softContextBudget = Math.max(0, contextBudget - hardConstraintAllocation.used)

  const partDefinitions = (Object.keys(rawData.contextParts) as ChapterContextLabel[]).map((label) => ({
    label,
    content: rawData.contextParts[label],
  }))

  const parts = partDefinitions.reduce<ContextPart[]>((result, part) => {
    if (SOFT_CONTEXT_EXCLUDED_LABELS.has(part.label)) return result
    const priority = priorityMap[part.label]
    if (typeof priority !== 'number' || !part.content) return result
    result.push({
      priority,
      label: part.label,
      content: part.content,
    })
    return result
  }, [])

  const softAllocation = allocateTokens(parts, softContextBudget)
  const truncatedHardConstraintLabels = hardConstraintAllocation.entries
    .filter((entry) => entry.truncated)
    .map((entry) => entry.label)
  const droppedConstraintCount = Math.max(0, hardConstraintDrafts.length - hardConstraintAllocation.entries.length)
  const hardOverflowLabels = hardConstraintDrafts
    .map((draft) => draft.label)
    .filter((label) => !hardConstraintAllocation.entries.some((entry) => entry.label === label))
  const hardConstraintFailed = droppedConstraintCount > 0
    || truncatedHardConstraintLabels.length > 0
    || softAllocation.warnings.some((warning) => warning.priority === 0)
  const constraintInjectionStatus: ConstraintInjectionStatus = {
    promptProfile,
    hardConstraintBudget,
    hardConstraintUsed: hardConstraintAllocation.used,
    softContextBudget,
    softContextUsed: softAllocation.totalUsed,
    droppedConstraintCount,
    truncatedHardConstraintCount: truncatedHardConstraintLabels.length,
    injectedLabels: hardConstraintAllocation.entries.map((entry) => entry.label),
    truncatedLabels: truncatedHardConstraintLabels,
  }
  const softContextBudgetUsage: SoftContextBudgetUsage = {
    budget: softContextBudget,
    used: softAllocation.totalUsed,
    warningCount: softAllocation.warnings.length,
    droppedLabels: softAllocation.warnings
      .filter((warning) => warning.reason === 'dropped')
      .map((warning) => warning.label),
    truncatedLabels: softAllocation.warnings
      .filter((warning) => warning.reason === 'truncated')
      .map((warning) => warning.label),
  }
  const hardCoveredDecisions: ContextDecisionEntry[] = hardConstraintAllocation.entries
    .filter((entry) => SOFT_CONTEXT_EXCLUDED_LABELS.has(entry.label as ChapterContextLabel))
    .map((entry) => ({
      label: entry.label,
      title: entry.title,
      priority: 'hard',
      originalTokens: entry.originalTokens,
      allocatedTokens: entry.allocatedTokens,
      status: entry.truncated ? 'truncated' : 'kept',
      reason: 'covered_by_hard_constraint',
    }))
  const softContextDecisions = [...hardCoveredDecisions, ...softAllocation.decisions]
  const hardConstraintSummary = buildHardConstraintSummary(hardConstraintAllocation.entries, droppedConstraintCount)
  const droppedLabels = [...new Set([
    ...hardOverflowLabels,
    ...softContextBudgetUsage.droppedLabels,
  ])]
  const truncatedLabels = [...new Set([
    ...truncatedHardConstraintLabels,
    ...softContextBudgetUsage.truncatedLabels,
  ])]
  const overflowLevel: ContextBudgetOverflowLevel = hardConstraintFailed
    ? 'hard_failed'
    : softAllocation.warnings.length > 0
      ? 'soft_trimmed'
      : 'none'
  const contextBudgetReport: ContextBudgetReport = {
    modelContextLimit,
    requestedBudget,
    effectiveBudget,
    promptFixedOverhead,
    reservedForOutput,
    availableContextBudget: contextBudget,
    hardConstraintBudget,
    hardConstraintUsed: hardConstraintAllocation.used,
    softContextBudget,
    softContextUsed: softAllocation.totalUsed,
    overflowLevel,
    warningCount: softAllocation.warnings.length + droppedConstraintCount + truncatedHardConstraintLabels.length,
    droppedLabels,
    truncatedLabels,
    droppedByPriority: summarizeBudgetWarnings(softAllocation.warnings),
  }

  if (droppedConstraintCount > 0) {
    console.error(`[context] 硬约束注入异常，丢失 ${droppedConstraintCount} 项:`,
      hardConstraintDrafts
        .map((draft) => draft.label)
        .filter((label) => !constraintInjectionStatus.injectedLabels.includes(label))
        .join(', '))
  }
  const result: ChapterContext = {
    storyCore: softAllocation.allocated.storyCore || '',
    currentArc: softAllocation.allocated.currentArc || '',
    worldRules: softAllocation.allocated.worldRules || '',
    characterStates: softAllocation.allocated.characterStates || '',
    worldStates: softAllocation.allocated.worldStates || '',
    itemSummary: softAllocation.allocated.itemSummary || '',
    previousSummaries: softAllocation.allocated.previousSummaries || '',
    previousChapterContext: softAllocation.allocated.previousChapterContext || '',
    lastChapterEnding: softAllocation.allocated.lastChapterEnding || '',
    styleTemplate: softAllocation.allocated.styleTemplate || '',
    chapterGoal: softAllocation.allocated.chapterGoal || rawData.contextParts.chapterGoal || '',
    continuitySummary: softAllocation.allocated.continuitySummary || '',
    openLoops: softAllocation.allocated.openLoops || '',
    dueForeshadows: softAllocation.allocated.dueForeshadows || rawData.contextParts.dueForeshadows || '',
    continuityNotes: softAllocation.allocated.continuityNotes || '',
    timelineSummary: softAllocation.allocated.timelineSummary || '',
    timelineOpenThreads: softAllocation.allocated.timelineOpenThreads || '',
    longTermMemory: softAllocation.allocated.longTermMemory || '',
    activeThreads: softAllocation.allocated.activeThreads || '',
    writingContractSummary: softAllocation.allocated.writingContractSummary || rawData.profile.writingContractSummary || '',
    relationSummary: softAllocation.allocated.relationSummary || rawData.contextParts.relationSummary || '',
    recalledMemory: softAllocation.allocated.recalledMemory || '',
    hardConstraintContext: hardConstraintAllocation.text,
    hardConstraintSummary,
    hardConstraintEntries: hardConstraintAllocation.entries,
    constraintInjectionStatus,
    softContextBudgetUsage,
    contextBudgetReport,
    droppedConstraintCount,
    previousChapterSampleReport: rawData.previousChapterSampleReport,
    softContextDecisions,
    recallDiagnostics: rawData.recallDiagnostics,
    recalledMemorySources: rawData.recalledMemorySources,
  }

  if (hardConstraintFailed) {
    throw new HardConstraintOverflowError(
      '当前章节上下文超出预算，关键约束无法完整注入。请缩小本章范围、减少必须承接项，或先拆分章节后再生成。',
      result,
      contextBudgetReport,
    )
  }

  if (softAllocation.warnings.length > 0) {
    throw new ContextOverflowError(
      '当前章节上下文已超出推荐预算，系统已自动裁剪低优先级信息。',
      result,
      contextBudgetReport,
    )
  }

  return result
}

export async function buildChapterContext(
  novelId: number,
  chapterNum: number,
  options: number | BuildChapterContextOptions = 10000,
): Promise<ChapterContext> {
  const rawData = await collectChapterContextRawData(novelId, chapterNum)
  return allocateChapterContext(rawData, options)
}
