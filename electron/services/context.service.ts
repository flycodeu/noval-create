import { asc, eq } from 'drizzle-orm'
import { getDb } from '../database/db'
import { chapters, characterRelations, characters, genres, novels, storyArcs, storyItems, storyThreads, templates, timelineEvents, worldMap } from '../database/schema'
import { buildWorldRulesSummary, parseWorldRulesJson } from '../../src/shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefDocument } from '../../src/shared/project-brief'
import { findSimilarFragments } from './embedding.service'
import { buildStyleFingerprintPromptSection, listStyleFingerprints } from './style-analysis.service'
import {
  buildPremiseSummary,
  buildStoryDesignSummary,
  buildWritingRulesSummary,
  parseStorySettingsDocument,
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
  buildRelationContextCards,
  buildItemContextCards,
  buildTimelineContextCards,
  buildChapterThreadContextCards,
  buildGenericThreadCardsFromTexts,
  renderCharacterCards,
  renderRelationCards,
  renderItemCards,
  renderTimelineCards,
  renderThreadCards,
} from './context-cards'

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

export type ChapterContextPromptProfile = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export type ChapterContextComplexity = 'simple' | 'standard' | 'key'

export interface BuildChapterContextOptions {
  totalBudget?: number
  promptProfile?: ChapterContextPromptProfile
  chapterComplexity?: ChapterContextComplexity
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
}

export interface StoryProfile {
  novelId: number
  novelTitle: string
  genre: string
  background: string
  projectBriefSummary: string
  premiseSummary: string
  storyDesignSummary: string
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
  continuitySummary: string
  openLoops: string
  worldRulesSummary: string
}

export interface ChapterContext {
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  itemSummary: string
  previousSummaries: string
  lastChapterEnding: string
  styleTemplate: string
  chapterGoal: string
  continuitySummary: string
  openLoops: string
  continuityNotes: string
  timelineSummary: string
  timelineOpenThreads: string
  longTermMemory: string
  activeThreads: string
  writingContractSummary: string
  relationSummary: string
  recalledMemory: string
}

type ChapterContextLabel = keyof ChapterContext

export interface ChapterContextRawData {
  novel: typeof novels.$inferSelect
  profile: StoryProfile
  chapterRows: Array<typeof chapters.$inferSelect>
  currentChapter?: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
  contextParts: ChapterContext
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
  itemSummary: string
  timelineSummary: string
  timelineOpenThreads: string
  activeThreads: string
  openLoops: string
  continuityNotes: string
  storyThreadsSummary: string
  mentionedCharacters: string[]
  mentionedItems: string[]
  mentionedLocations: string[]
}

interface RecallHit {
  bucket: RecallBucketKey
  chapterId: number
  fragmentType: string
  fragmentText: string
  similarity: number
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

function formatRecalledMemory(bucketResults: Array<{ bucket: RecallBucketKey; hits: RecallHit[] }>): string {
  const labels: Record<RecallBucketKey, string> = {
    character: '角色/关系召回',
    rule: '规则/主题召回',
    thread: '线程/伏笔召回',
  }
  const lines: string[] = []
  const seen = new Set<string>()

  for (const result of bucketResults) {
    const significant = result.hits.filter((hit) => hit.similarity > 0.08)
    const selected = significant.length > 0
      ? significant.slice(0, 2)
      : result.hits.filter((hit) => hit.similarity > 0).slice(0, 1)

    for (const hit of selected) {
      const summary = summarizeRecallHit(hit)
      if (!summary) continue
      const dedupeKey = `${hit.fragmentType}:${summary}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      lines.push(`[${labels[result.bucket]}·${hit.fragmentType}] ${summary}`)
      if (lines.length >= 6) return lines.join('\n')
    }
  }

  return lines.join('\n')
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
  totalUsed: number
  totalBudget: number
}

function allocateTokens(parts: ContextPart[], totalBudget: number): TokenAllocationResult {
  const result: Record<string, string> = {}
  const warnings: TokenAllocationWarning[] = []
  const p0Parts = parts.filter((part) => part.priority === 0)

  let usedTokens = 0
  for (const part of p0Parts) {
    result[part.label] = part.content
    usedTokens += estimateTokens(part.content)
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
      if (allocatedTokens < originalTokens) {
        warnings.push({ label: part.label, priority: 0, originalTokens, allocatedTokens, reason: 'truncated' })
      }
    }
    for (const part of parts.filter((part) => part.priority > 0)) {
      result[part.label] = ''
      const originalTokens = estimateTokens(part.content)
      if (originalTokens > 0) {
        warnings.push({ label: part.label, priority: part.priority, originalTokens, allocatedTokens: 0, reason: 'dropped' })
      }
    }
    if (warnings.length > 0) {
      console.warn(`[context] 上下文预算不足(${totalBudget} tokens)，${warnings.length} 个部分被截断或丢弃:`,
        warnings.map(w => `${w.label}(P${w.priority}): ${w.reason === 'dropped' ? '完全丢弃' : `${w.originalTokens}→${w.allocatedTokens}`}`).join(', '))
    }
    return { allocated: result, warnings, totalUsed: usedTokens, totalBudget }
  }

  let budget = remaining
  for (const priority of [1, 2, 3] as const) {
    for (const part of parts.filter((item) => item.priority === priority)) {
      const needed = estimateTokens(part.content)
      if (budget <= 0) {
        result[part.label] = ''
        if (needed > 0) {
          warnings.push({ label: part.label, priority, originalTokens: needed, allocatedTokens: 0, reason: 'dropped' })
        }
      } else if (needed <= budget) {
        result[part.label] = part.content
        budget -= needed
      } else {
        result[part.label] = truncateToTokens(part.content, budget)
        const allocatedTokens = estimateTokens(result[part.label])
        warnings.push({ label: part.label, priority, originalTokens: needed, allocatedTokens, reason: 'truncated' })
        budget = 0
      }
    }
  }

  if (warnings.length > 0) {
    console.warn(`[context] 上下文分配警告(预算${totalBudget}, 剩余${budget}):`,
      warnings.map(w => `${w.label}(P${w.priority}): ${w.reason === 'dropped' ? '丢弃' : `截断${w.originalTokens}→${w.allocatedTokens}`}`).join(', '))
  }

  return { allocated: result, warnings, totalUsed: totalBudget - budget, totalBudget }
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
          characterStates: 0,
          itemSummary: 1,
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
          characterStates: 0,
          itemSummary: 1,
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
          characterStates: 0,
          itemSummary: 1,
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
          characterStates: 0,
          itemSummary: 1,
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
  const cards = buildCharacterContextCards({
    allCharacters,
    relationRows,
    recentStateEntries: recentChapters.flatMap((chapter) =>
      chapter.continuityState.characterStateChanges.map((entry) => ({
        chapterNum: chapter.chapterNum,
        entry,
      }))),
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
  const chapterGoal = extractChapterGoal(currentChapter?.outline)

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

  const relationSummary = buildStoryRelationSummary(
    novelId,
    allCharacters,
    [currentChapter?.outline, currentArc?.arcSummary, currentArc?.arcGoal, previousSummaries].filter(Boolean).join("\n"),
  )

  const previousChapter = recentChapters[recentChapters.length - 1]
  const lastChapterEnding = previousChapter
    ? [
        previousChapter.content ? previousChapter.content.slice(-300) : '',
        previousChapter.nextChapterSeed ? `[衔接提示] ${previousChapter.nextChapterSeed}` : '',
      ].filter(Boolean).join('\n')
    : ''

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
      writingContractSummary: profile.writingContractSummary,
      currentArc: formatArcContext(currentArc),
      continuityNotes: collectContinuityNotes(continuityChapters),
      lastChapterEnding,
      openLoops: collectOpenLoops(continuityChapters),
      timelineOpenThreads: timelineContext.timelineOpenThreads,
      worldRules: profile.worldRulesSummary,
      itemSummary,
      longTermMemory,
      characterStates: buildCharacterStates(allCharacters, recentChapters, mentionedCharacterNames),
      continuitySummary: continuityChapters.map(formatContinuityEntry).join('\n'),
      timelineSummary: timelineContext.timelineSummary,
      relationSummary,
      activeThreads: activeThreadsContext.summary,
      styleTemplate: enrichStyleTemplateWithFingerprint(profile.styleTemplateSummary, novelId),
      previousSummaries,
      recalledMemory: '', // placeholder, filled below
    },
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
      itemSummary,
      timelineSummary: timelineContext.timelineSummary,
      timelineOpenThreads: timelineContext.timelineOpenThreads,
      activeThreads: activeThreadsContext.summary,
      openLoops: result.contextParts.openLoops,
      continuityNotes: result.contextParts.continuityNotes,
      storyThreadsSummary: profile.storyThreadsSummary,
      mentionedCharacters: [...mentionedCharacterNames],
      mentionedItems: mentionedItemNames,
      mentionedLocations: mentionedLocationNames,
    })

    if (recallBuckets.length > 0) {
      const bucketResults = await Promise.all(recallBuckets.map(async (bucket) => ({
        bucket: bucket.bucket,
        hits: (await findSimilarFragments(novelId, bucket.query, bucket.topK, novel.modelConfigId || undefined))
          .map((hit) => ({
            bucket: bucket.bucket,
            chapterId: hit.chapterId,
            fragmentType: hit.fragmentType,
            fragmentText: hit.fragmentText,
            similarity: hit.similarity,
          })),
      })))
      result.contextParts.recalledMemory = formatRecalledMemory(bucketResults)
    }
  } catch { /* vector recall failure is non-blocking */ }

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
  const totalBudget = modelRuntimeBudget.maxContextTokens
    ? Math.min(requestedBudget, modelRuntimeBudget.maxContextTokens)
    : requestedBudget
  const modelBudgetLimited = Boolean(
    modelRuntimeBudget.maxContextTokens
    && modelRuntimeBudget.maxContextTokens < requestedBudget,
  )

  const effectiveBudget = modelRuntimeBudget.maxContextTokens
    ? Math.min(modelRuntimeBudget.maxContextTokens, resolveChapterBudgetFloor(targetWords, totalBudget))
    : resolveChapterBudgetFloor(targetWords, totalBudget)
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

  const partDefinitions = (Object.keys(rawData.contextParts) as ChapterContextLabel[]).map((label) => ({
    label,
    content: rawData.contextParts[label],
  }))

  const parts = partDefinitions.reduce<ContextPart[]>((result, part) => {
    const priority = priorityMap[part.label]
    if (typeof priority !== 'number' || !part.content) return result
    result.push({
      priority,
      label: part.label,
      content: part.content,
    })
    return result
  }, [])

  const { allocated } = allocateTokens(parts, contextBudget)

  return {
    storyCore: allocated.storyCore || '',
    currentArc: allocated.currentArc || '',
    worldRules: allocated.worldRules || '',
    characterStates: allocated.characterStates || '',
    itemSummary: allocated.itemSummary || '',
    previousSummaries: allocated.previousSummaries || '',
    lastChapterEnding: allocated.lastChapterEnding || '',
    styleTemplate: allocated.styleTemplate || '',
    chapterGoal: allocated.chapterGoal || '',
    continuitySummary: allocated.continuitySummary || '',
    openLoops: allocated.openLoops || '',
    continuityNotes: allocated.continuityNotes || '',
    timelineSummary: allocated.timelineSummary || '',
    timelineOpenThreads: allocated.timelineOpenThreads || '',
    longTermMemory: allocated.longTermMemory || '',
    activeThreads: allocated.activeThreads || '',
    writingContractSummary: allocated.writingContractSummary || rawData.profile.writingContractSummary || '',
    relationSummary: allocated.relationSummary || rawData.contextParts.relationSummary || '',
    recalledMemory: allocated.recalledMemory || '',
  }
}

export async function buildChapterContext(
  novelId: number,
  chapterNum: number,
  options: number | BuildChapterContextOptions = 10000,
): Promise<ChapterContext> {
  const rawData = await collectChapterContextRawData(novelId, chapterNum)
  return allocateChapterContext(rawData, options)
}
