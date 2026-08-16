import { asc, eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../database/db'
import { and, desc, gte, inArray, isNull, lte, lt, notInArray, or, sql } from 'drizzle-orm'
import { chapterWritebackDiffs, chapterWritebackRuns, chapters, characterRelations, characters, factions, genres, glossary, novels, storyArcs, storyItems, storyThreads, templates, timelineEvents, worldMap } from '../database/schema'
import { assessHistoricalGrounding, buildWorldRulesSummary, getGroundingSourceLedgerEntries, parseWorldRulesJson } from '../../src/shared/genre-system'
import { buildProjectBriefSummary, parseProjectBriefDocument } from '../../src/shared/project-brief'
import { parseFactionExternalRelations } from '../../src/shared/factions'
import { parseGlossaryAliases } from '../../src/shared/glossary'
import {
  buildStyleFingerprintPromptSection,
  buildStyleHardGuardPromptSection,
  resolveActiveStyleFingerprint,
} from './style-analysis.service'
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
import { buildGenrePacingGuidance } from '../../src/shared/content-guardrails'
import { buildWritingContractSummary } from '../../src/shared/writing-contract'
import { getOperatingModePolicy, getOperatingModeRuntimePolicy } from '../../src/shared/operating-mode'
import { buildStoryMemoryPromptPackage } from './story-memory.service'
import { buildAntiAiHardConstraintContext, getPromotedAntiAiRulesForChapter } from './anti-ai-rule.service'
import { buildFeedbackRecurrenceHardConstraintContext, getPromotedFeedbackIssuesForChapter } from './feedback-recurrence.service'
import { ensureStoryStructure } from './story-structure.service'
import { resolveModelRuntimeBudget } from './model.service'
import { throwUserFacingError } from '../utils/user-facing-error'
import type { AssetChangeImpact, WritingContextUsageSnapshot } from '../../src/types'
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
  createFactionCatalog,
  resolveFactionRowsFromCatalog,
  type FactionCatalog,
} from './faction-reference.service'
import { getCharacterDialogueHintMap, getChapterDialogueVoiceLocks } from './dialogue-fingerprint.service'
import { getCharacterStateContextHintMap, listLatestCharacterStates } from './character-state.service'
import { getWorldStateContextSnapshot } from './world-state.service'
import { getChapterContractContext, listForeshadowLedgerByIds } from './endgame-asset.service'
import { buildGlobalLockContext } from './batch-workbench.service'
import { buildChapterBridgePlan, formatChapterBridgePlan } from './generation-integrity.service'
import {
  resolveCreativeStageContextForChapter,
} from './creative-stage.service'
import type { CreativeStageContext } from '../../src/shared/creative-stages'
import {
  buildCharacterMentionCandidates,
  buildFactionMentionCandidates,
  buildItemMentionCandidates,
  buildLocationMentionCandidates,
  collectExplicitEntityNamesFromReferences,
  collectMentionedEntityNamesFromCandidates,
  collectMentionedEntityValidationTermsFromCandidates,
  collectRelationMentionedCharacterNames,
  collectRelationMentionValidationTerms,
  resolveMentionedEntityLimits,
} from './context-entity-mentions'
import { loadTimelineContextEventIds } from './context-timeline-projection'
import { loadChapterThreadContextProjection } from './context-thread-projection'
import {
  loadChapterEntityMentionCatalogs,
  loadProjectedChapterEntityRows,
  getChapterEntityMentionCatalogLookups,
  resolveChapterEntityContextProjection,
  type CharacterMentionCatalogRow,
  type LocationMentionCatalogRow,
} from './context-entity-projection'
import {
  buildEmptyRecallDiagnostics,
  compactRecallLine,
  containsAny,
  createEmptyRecallSnapshot,
  finalizeRecallSnapshot,
  isAcceptedRecallSource,
  splitRecallLines,
  type RecallDiagnostics,
  type RecallMemorySource,
  type RecallSnapshot,
} from './context-recall-core'
import { runRecallAugmentation } from './context-recall-runtime'
import { estimateTokens, truncateToTokens } from './context-token-budget'

export { resolveMentionedEntityLimits } from './context-entity-mentions'
export { buildRecallSnapshot } from './context-recall-core'
export type {
  RecallBucketKey,
  RecallBucketStats,
  RecallDiagnostics,
  RecallFallbackReason,
  RecallMemorySource,
  RecallSearchMode,
  RecallSnapshot,
} from './context-recall-core'

function resolveRecentContextWindow(
  targetWords: number,
  chapterCount: number,
  launchMode?: string | null,
  settingsJson?: string | null,
  options: {
    signalText?: string
    mentionedCharacters?: string[]
    mentionedItems?: string[]
    mentionedLocations?: string[]
    mentionedFactions?: string[]
  } = {},
): number {
  const baseWindow = getOperatingModePolicy({
    launchMode,
    targetWords,
    chapterCount,
    settingsJson,
  }).recentContextWindow

  const signalDensity = (
    Math.min(splitRecallLines(options.signalText || '', 8, 24).length, 4)
    + Math.min(options.mentionedCharacters?.length || 0, 3)
    + Math.min(options.mentionedItems?.length || 0, 2)
    + Math.min(options.mentionedLocations?.length || 0, 2)
    + Math.min(options.mentionedFactions?.length || 0, 2)
  )

  if (signalDensity >= 8) return baseWindow + 4
  if (signalDensity >= 4) return baseWindow + 2
  return baseWindow
}

interface ContextPart {
  priority: 0 | 1 | 2 | 3
  label: string
  content: string
}

type ContextAssemblyStage = 'base' | 'recall' | 'allocation'

interface BaseChapterContextParts {
  assemblyStage: Extract<ContextAssemblyStage, 'base'>
  contextParts: ChapterContextParts
  previousChapterSampleReport: PreviousChapterSampleReport
  recallSnapshot: RecallSnapshot
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
}

interface HardConstraintDraft {
  label: HardConstraintSourceLabel
  title: string
  content: string
  relevanceScore: number
  pinned: boolean
}

export type ChapterContextPromptProfile = 'scenePlan' | 'draft' | 'review' | 'rewrite'
export type ChapterContextComplexity = 'simple' | 'standard' | 'key'
export type HardConstraintSourceLabel =
  | 'chapterGoal'
  | 'characterStates'
  | 'worldStates'
  | 'writingContractSummary'
  | 'relationSummary'
  | 'itemSummary'
  | 'openLoops'
  | 'continuityNotes'
  | 'feedbackRecurrence'
  | 'antiAiRules'
  | 'styleHardGuard'
  | 'genrePacing'

export interface BuildChapterContextOptions {
  totalBudget?: number
  promptProfile?: ChapterContextPromptProfile
  chapterComplexity?: ChapterContextComplexity
  preserveConstraintLabels?: HardConstraintSourceLabel[]
}

export type ContextBudgetOverflowLevel = 'none' | 'soft_trimmed' | 'hard_failed'

export interface ContextBudgetWarningSummary {
  priority: 0 | 1 | 2 | 3
  count: number
  labels: string[]
}

export interface ContextBudgetReport {
  modelContextLimit: number
  safeModelContextLimit?: number
  modelProvider?: string
  tokenSafetyMarginPct?: number
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
  preservedConstraintLabels: HardConstraintSourceLabel[]
  droppedConstraintLabels: HardConstraintSourceLabel[]
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
  historicalGroundingSummary: string
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
  creativeStageContext?: CreativeStageContext
}

export interface ChapterContextParts {
  storyCore: string
  currentArc: string
  worldRules: string
  characterStates: string
  worldStates: string
  mapSummary: string
  itemSummary: string
  previousSummaries: string
  previousChapterContext: string
  lastChapterEnding: string
  chapterBridgePlan: string
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
  dialogueVoiceLocks: string
  recalledMemory: string
  scenePlanSummary: string
  draftTextSummary: string
  contractVersionSummary: string
  reviewRiskSummary: string
  reviewProofSummary: string
  rewriteDeltaSummary: string
  publishGateRiskSummary: string
  stepMemorySummary: string
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
  | 'middle'
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
export type ContextDecisionSourceKind = 'hard_constraint' | 'previous_chapter' | 'chapter_bridge' | 'recent_summary' | 'vector_recall'

export interface ContextDecisionEntry {
  label: string
  title: string
  priority: 0 | 1 | 2 | 3 | 'hard'
  originalTokens: number
  allocatedTokens: number
  status: ContextDecisionStatus
  reason: ContextDecisionReason
  sourceKind?: ContextDecisionSourceKind
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
  preservedLabels: HardConstraintSourceLabel[]
  droppedLabels: HardConstraintSourceLabel[]
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
  recallSnapshot: RecallSnapshot
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
  chapterCount?: number
  currentChapter?: typeof chapters.$inferSelect
  currentArc: typeof storyArcs.$inferSelect | null
  outlineMentionedCharacterCount: number
  activeThreadPressureCount: number
  mentionedCharacters: string[]
  mentionedItems: string[]
  mentionedLocations: string[]
  mentionedFactions: string[]
  contextParts: ChapterContextParts
  previousChapterSampleReport: PreviousChapterSampleReport
  recallSnapshot: RecallSnapshot
  recallDiagnostics: RecallDiagnostics
  recalledMemorySources: RecallMemorySource[]
  creativeStageContext?: CreativeStageContext
}

const BOUNDED_CONTEXT_CHAPTER_THRESHOLD = 2000
const BOUNDED_CONTEXT_MAX_ROWS = 192

function getNovelChapterCount(novelId: number): number {
  const row = getDb().select({ count: sql<number>`count(*)` })
    .from(chapters)
    .where(eq(chapters.novelId, novelId))
    .all()[0]
  return Math.max(0, Number(row?.count || 0))
}

function mergeChapterRows(rows: Array<typeof chapters.$inferSelect>): Array<typeof chapters.$inferSelect> {
  const byId = new Map<number, typeof chapters.$inferSelect>()
  rows.forEach((row) => byId.set(row.id, row))
  return [...byId.values()].sort((left, right) => left.chapterNum - right.chapterNum || left.id - right.id)
}

function loadBoundedChapterRows(
  novelId: number,
  chapterNum: number,
  novel: typeof novels.$inferSelect,
  currentArc: typeof storyArcs.$inferSelect | null,
): Array<typeof chapters.$inferSelect> {
  const db = getDb()
  const recentWindow = Math.max(35, resolveRecentContextWindow(
    Number(novel.targetWords || 0),
    BOUNDED_CONTEXT_CHAPTER_THRESHOLD,
    novel.launchMode,
    novel.settingsJson,
  ))
  const recentRows = db.select().from(chapters)
    .where(and(eq(chapters.novelId, novelId), lt(chapters.chapterNum, chapterNum)))
    .orderBy(desc(chapters.chapterNum), desc(chapters.id))
    .limit(Math.min(BOUNDED_CONTEXT_MAX_ROWS, recentWindow * 2))
    .all()
  const anchorRows = db.select().from(chapters)
    .where(and(eq(chapters.novelId, novelId), lte(chapters.chapterNum, 3)))
    .orderBy(asc(chapters.chapterNum), asc(chapters.id))
    .limit(6)
    .all()
  const arcRows = currentArc && typeof currentArc.chapterStart === 'number' && typeof currentArc.chapterEnd === 'number'
    ? db.select().from(chapters)
      .where(and(
        eq(chapters.novelId, novelId),
        gte(chapters.chapterNum, currentArc.chapterStart),
        lte(chapters.chapterNum, currentArc.chapterEnd),
      ))
      .orderBy(desc(chapters.chapterNum), desc(chapters.id))
      .limit(48)
      .all()
    : []
  const keyRows = db.select().from(chapters)
    .where(and(
      eq(chapters.novelId, novelId),
      or(
        sql`${chapters.summary} IS NOT NULL AND length(trim(${chapters.summary})) > 0`,
        sql`${chapters.nextChapterSeed} IS NOT NULL AND length(trim(${chapters.nextChapterSeed})) > 0`,
        sql`${chapters.continuityStateJson} IS NOT NULL AND ${chapters.continuityStateJson} <> '{}'`,
      ),
    ))
    .orderBy(desc(chapters.chapterNum), desc(chapters.id))
    .limit(48)
    .all()
  const currentRow = db.select().from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.chapterNum, chapterNum)))
    .limit(1)
    .all()
  return mergeChapterRows([...currentRow, ...recentRows, ...anchorRows, ...arcRows, ...keyRows])
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

function splitContextLines(value?: string | null, limit = 6): string[] {
  if (!value) return []
  return [...new Set(value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, limit)
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

function parseJsonRecordArray(raw?: string | null): Record<string, unknown>[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      : []
  } catch {
    return []
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
const DEFAULT_PRESERVED_CONSTRAINT_LABELS: HardConstraintSourceLabel[] = [
  'chapterGoal',
  'characterStates',
  'worldStates',
  'writingContractSummary',
  'openLoops',
  'continuityNotes',
]
const MIN_HARD_CONSTRAINT_TOKENS = 28
const MIN_PINNED_HARD_CONSTRAINT_TOKENS = 18

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

function buildPreservedConstraintSet(labels?: HardConstraintSourceLabel[]): Set<HardConstraintSourceLabel> {
  return new Set([
    ...DEFAULT_PRESERVED_CONSTRAINT_LABELS,
    ...(labels || []),
  ])
}

function buildConstraintSignalTerms(rawData: ChapterContextRawData): string[] {
  return dedupe([
    ...rawData.mentionedCharacters,
    ...rawData.mentionedItems,
    ...rawData.mentionedLocations,
    ...rawData.mentionedFactions,
    ...splitRecallLines(rawData.contextParts.chapterGoal, 4, 24),
    ...splitRecallLines(rawData.currentChapter?.outline || '', 4, 24),
    ...splitRecallLines(rawData.currentArc?.arcSummary || '', 3, 24),
    ...splitRecallLines(rawData.currentArc?.arcGoal || '', 3, 24),
  ], 16)
}

function computeHardConstraintRelevance(
  label: HardConstraintSourceLabel,
  content: string,
  rawData: ChapterContextRawData,
): number {
  const baseScore: Record<HardConstraintSourceLabel, number> = {
    chapterGoal: 120,
    characterStates: 110,
    worldStates: 100,
    writingContractSummary: 88,
    relationSummary: 72,
    itemSummary: 68,
    openLoops: 96,
    continuityNotes: 92,
    feedbackRecurrence: 54,
    antiAiRules: 48,
    styleHardGuard: 44,
    genrePacing: 50,
  }
  const signalTerms = buildConstraintSignalTerms(rawData)
  const signalScore = signalTerms.reduce((sum, term) => {
    if (term.length < 2 || !content.includes(term)) return sum
    return sum + (term.length >= 4 ? 6 : 3)
  }, 0)
  const entityBoost = (
    (label === 'relationSummary' && rawData.mentionedCharacters.length >= 2 ? 12 : 0)
    + (label === 'characterStates' && rawData.mentionedCharacters.length > 0 ? 10 : 0)
    + (label === 'itemSummary' && rawData.mentionedItems.length > 0 ? 10 : 0)
    + (label === 'worldStates' && rawData.mentionedLocations.length > 0 ? 8 : 0)
    + (label === 'writingContractSummary' ? 8 : 0)
    + (label === 'openLoops' && rawData.activeThreadPressureCount > 0 ? 8 : 0)
  )
  return baseScore[label] + signalScore + entityBoost
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

function buildHardConstraintDrafts(
  rawData: ChapterContextRawData,
  preservedLabels: Set<HardConstraintSourceLabel>,
): HardConstraintDraft[] {
  const { contextParts: parts } = rawData
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
  const writingContractLines = selectConstraintLines(parts.writingContractSummary, {
    keywords: HARD_CONSTRAINT_SIGNAL_KEYWORDS,
    fallbackLines: 3,
    maxLines: 5,
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
  const antiAiConstraintText = buildAntiAiHardConstraintContext({
    genre: rawData.profile.genre,
    settingsJson: rawData.novel.settingsJson,
    promotedRules: rawData.currentChapter?.chapterNum
      ? getPromotedAntiAiRulesForChapter(rawData.novel.id, rawData.currentChapter.chapterNum)
      : [],
  })
  const feedbackConstraintText = buildFeedbackRecurrenceHardConstraintContext({
    promotedIssues: rawData.currentChapter?.chapterNum
      ? getPromotedFeedbackIssuesForChapter(rawData.novel.id, rawData.currentChapter.chapterNum)
      : [],
  })
  const styleHardGuardText = buildStyleHardConstraintForNovel(rawData.novel.id, rawData.novel.themeVoiceJson)

  const draftSpecs: Array<Pick<HardConstraintDraft, 'label' | 'title' | 'content'>> = [
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
      label: 'writingContractSummary',
      title: '写作合同/章节合同',
      content: buildConstraintSection('写作合同/章节合同', writingContractLines),
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
    {
      label: 'feedbackRecurrence',
      title: '审校复现硬约束',
      content: feedbackConstraintText,
    },
    {
      label: 'styleHardGuard',
      title: '文风硬约束',
      content: styleHardGuardText,
    },
    {
      label: 'genrePacing',
      title: '题材节拍硬约束',
      content: buildGenrePacingGuidance(rawData.profile.genre),
    },
    {
      label: 'antiAiRules',
      title: '反 AI 味硬约束',
      content: antiAiConstraintText,
    },
  ]

  return draftSpecs
    .filter((entry) => Boolean(entry.content))
    .map((entry) => ({
      ...entry,
      pinned: preservedLabels.has(entry.label),
      relevanceScore: computeHardConstraintRelevance(entry.label, entry.content, rawData),
    }))
    .sort((left, right) =>
      Number(right.pinned) - Number(left.pinned)
      || right.relevanceScore - left.relevanceScore
      || estimateTokens(left.content) - estimateTokens(right.content))
}

function allocateHardConstraintEntries(
  drafts: HardConstraintDraft[],
  budget: number,
): {
  entries: HardConstraintEntry[]
  text: string
  used: number
  dropped: HardConstraintDraft[]
} {
  if (drafts.length === 0 || budget <= 0) {
    return { entries: [], text: '', used: 0, dropped: [...drafts] }
  }

  const originals = new Map(drafts.map((draft) => [draft.label, estimateTokens(draft.content)] as const))
  const entries: HardConstraintEntry[] = []
  const dropped: HardConstraintDraft[] = []
  let remainingBudget = budget

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]
    const originalTokens = originals.get(draft.label) || estimateTokens(draft.content)
    if (remainingBudget <= 0) {
      dropped.push(draft)
      continue
    }

    const remainingPinnedReserve = drafts
      .slice(index + 1)
      .filter((candidate) => candidate.pinned)
      .reduce((sum, candidate) => {
        const candidateTokens = originals.get(candidate.label) || estimateTokens(candidate.content)
        return sum + Math.min(candidateTokens, MIN_PINNED_HARD_CONSTRAINT_TOKENS)
      }, 0)
    const maxAllocatable = Math.max(draft.pinned ? 1 : 0, remainingBudget - remainingPinnedReserve)
    if (maxAllocatable <= 0) {
      dropped.push(draft)
      continue
    }

    if (originalTokens <= maxAllocatable) {
      entries.push({
        label: draft.label,
        title: draft.title,
        content: draft.content,
        originalTokens,
        allocatedTokens: originalTokens,
        truncated: false,
      })
      remainingBudget -= originalTokens
      continue
    }

    const minimumUsefulTokens = draft.pinned ? MIN_PINNED_HARD_CONSTRAINT_TOKENS : MIN_HARD_CONSTRAINT_TOKENS
    if (!draft.pinned && maxAllocatable < minimumUsefulTokens) {
      dropped.push(draft)
      continue
    }

    const targetTokens = draft.pinned
      ? maxAllocatable
      : Math.max(minimumUsefulTokens, Math.min(maxAllocatable, Math.floor(originalTokens * 0.72)))
    const content = truncateToTokens(draft.content, targetTokens)
    const allocatedTokens = estimateTokens(content)
    if (!content.trim() || allocatedTokens <= 0) {
      dropped.push(draft)
      continue
    }

    entries.push({
      label: draft.label,
      title: draft.title,
      content,
      originalTokens,
      allocatedTokens,
      truncated: allocatedTokens < originalTokens,
    })
    remainingBudget -= allocatedTokens
  }

  return {
    entries,
    text: entries.map((entry) => entry.content).filter(Boolean).join('\n\n'),
    used: entries.reduce((sum, entry) => sum + entry.allocatedTokens, 0),
    dropped,
  }
}

const SOFT_CONTEXT_EXCLUDED_LABELS = new Set<ChapterContextLabel>([
  'characterStates',
  'worldStates',
])

// 这些软上下文是本章生成的最小核心；连它们都注入不了才升级为硬失败。
const CRITICAL_SOFT_CONTEXT_LABELS = new Set<string>([
  'chapterGoal',
  'chapterBridgePlan',
])
const CRITICAL_SOFT_CONTEXT_MIN_TOKENS = 120

function buildHardConstraintSummary(
  entries: HardConstraintEntry[],
  droppedDrafts: HardConstraintDraft[],
  preservedLabels: Set<HardConstraintSourceLabel>,
): string {
  if (entries.length === 0) {
    return droppedDrafts.length > 0
      ? `关键约束注入失败，丢失 ${droppedDrafts.length} 项：${droppedDrafts.map((entry) => entry.title).join('、')}`
      : '当前章节没有额外关键约束。'
  }

  const injectedTitles = entries.map((entry) => entry.title)
  const truncatedTitles = entries.filter((entry) => entry.truncated).map((entry) => entry.title)
  const preservedTitles = entries
    .filter((entry) => preservedLabels.has(entry.label))
    .map((entry) => entry.title)
  const summaryParts = [
    `已注入 ${entries.length} 项关键约束：${injectedTitles.join('、')}`,
  ]

  if (preservedTitles.length > 0) {
    summaryParts.push(`显式保留 ${preservedTitles.length} 项：${preservedTitles.join('、')}`)
  }
  if (truncatedTitles.length > 0) {
    summaryParts.push(`压缩 ${truncatedTitles.length} 项：${truncatedTitles.join('、')}`)
  }
  if (droppedDrafts.length > 0) {
    summaryParts.push(`丢失 ${droppedDrafts.length} 项：${droppedDrafts.map((entry) => entry.title).join('、')}`)
  }

  return summaryParts.join('；')
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
  catalog: FactionCatalog,
  mentionedCharacters: Array<typeof characters.$inferSelect>,
  characterNameMap: Map<number, string>,
  locationNameMap: Map<number, string>,
  mentionedFactionNames: string[] = [],
  limit = 6,
): string {
  if (mentionedCharacters.length === 0 && mentionedFactionNames.length === 0) return ''

  const selected = new Map<number, typeof factions.$inferSelect>()
  const mentionedFactionSet = new Set(mentionedFactionNames)

  mentionedCharacters.forEach((character) => {
    resolveFactionRowsFromCatalog(catalog, character.campFactionIdsJson).forEach((row) => {
      selected.set(row.id, row)
    })
  })

  catalog.rows.forEach((row) => {
    if (mentionedFactionSet.has(row.name)) {
      selected.set(row.id, row)
    }
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
  const cards = buildFactionContextCards({
    factions: rows,
    characterNameMap,
    locationNameMap,
    limit,
  })

  return cards.length > 0 ? `势力卡：\n${renderFactionCards(cards)}` : ''
}

function buildRecallEntityFreshnessMap(
  novelId: number,
  upToChapterNum?: number,
  worldStatesOverride?: ReturnType<typeof getWorldStateContextSnapshot>['currentStates'],
): Map<string, number> {
  const result = new Map<string, number>()
  listLatestCharacterStates(novelId, { upToChapterNum, limit: 240 }).forEach((state) => {
    if (state.characterName) {
      result.set(state.characterName, state.chapterNum)
    }
  })
  const worldStates = worldStatesOverride || getWorldStateContextSnapshot(novelId, {
    upToChapterNum,
    limit: 240,
  }).currentStates
  worldStates.forEach((state) => {
    if (state.entityName) {
      result.set(state.entityName, state.chapterNum)
    }
  })
  return result
}

function buildBaseChapterContextParts(input: {
  contextParts: Omit<ChapterContextParts, 'recalledMemory'>
  previousChapterSampleReport: PreviousChapterSampleReport
}): BaseChapterContextParts {
  return {
    assemblyStage: 'base',
    contextParts: {
      ...input.contextParts,
      recalledMemory: '',
    },
    previousChapterSampleReport: input.previousChapterSampleReport,
    recallSnapshot: createEmptyRecallSnapshot(),
    recallDiagnostics: buildEmptyRecallDiagnostics(['召回尚未执行。']),
    recalledMemorySources: [],
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

function resolveContextSourceKind(label: ChapterContextLabel | string): ContextDecisionSourceKind | undefined {
  switch (label) {
    case 'chapterGoal':
    case 'continuityNotes':
    case 'dueForeshadows':
    case 'characterStates':
    case 'worldStates':
    case 'dialogueVoiceLocks':
    case 'writingContractSummary':
      return 'hard_constraint'
    case 'previousChapterContext':
    case 'lastChapterEnding':
      return 'previous_chapter'
    case 'chapterBridgePlan':
    case 'stepMemorySummary':
      return 'chapter_bridge'
    case 'previousSummaries':
      return 'recent_summary'
    case 'recalledMemory':
      return 'vector_recall'
    default:
      return undefined
  }
}

function resolveContextLabelTitle(label: ChapterContextLabel): string {
  const titleMap: Record<ChapterContextLabel, string> = {
    storyCore: '小说核心约束',
    currentArc: '当前故事弧',
    worldRules: '世界规则',
    characterStates: '人物当前状态',
    worldStates: '当前世界状态',
    mapSummary: '地图地点上下文',
    itemSummary: '关键物品与去向',
    previousSummaries: '最近章节摘要',
    previousChapterContext: '上一章关键先验',
    lastChapterEnding: '上章结尾',
    chapterBridgePlan: '章节衔接桥',
    stepMemorySummary: '步骤接力记忆',
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
    dialogueVoiceLocks: '角色 Voice Lock',
    recalledMemory: '向量召回记忆',
    scenePlanSummary: '场景计划摘要',
    draftTextSummary: '当前稿件摘要',
    contractVersionSummary: '合同版本摘要',
    reviewRiskSummary: '审校风险摘要',
    reviewProofSummary: '审校证据摘要',
    rewriteDeltaSummary: '重写差量摘要',
    publishGateRiskSummary: '发布门风险',
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
  const criticalP1Floors: Record<string, number> = {
    writingContractSummary: 260,
    mapSummary: 220,
    itemSummary: 220,
    // 跨章接力不是可有可无的“历史摘要”：即使本阶段预算紧张，也要
    // 给上一章的关键先验和章尾留下一个可执行的压缩窗口。
    previousChapterContext: 260,
    lastChapterEnding: 180,
    // 连续性摘要承载更长程的因果链；保留一个压缩窗口，避免只记住
    // 上一章的局部动作，却丢失前面已经建立的伏笔、代价和关系变化。
    continuitySummary: 520,
    // 长篇进入中段后，结构化长期记忆至少保留一个可执行窗口；否则
    // recent summary 会把所有历史预算吃完，角色/线程的跨阶段状态反而消失。
    longTermMemory: 220,
    previousSummaries: 320,
    dialogueVoiceLocks: 160,
    scenePlanSummary: 220,
    reviewRiskSummary: 220,
  }
  const buildFloorReserves = (availableBudget: number) => {
    const floorParts = parts
      .filter((item) => item.priority === 1)
      .map((part) => ({
        label: part.label,
        demand: Math.min(criticalP1Floors[part.label] || 0, estimateTokens(part.content)),
      }))
      .filter((part) => part.demand > 0)
    const reserves = new Map<string, number>()
    let floorBudget = Math.min(
      Math.max(availableBudget, 0),
      floorParts.reduce((sum, part) => sum + part.demand, 0),
    )
    // Give every protected P1 section a share before filling any one section.
    while (floorBudget > 0 && floorParts.some((part) => (reserves.get(part.label) || 0) < part.demand)) {
      let progressed = false
      for (const part of floorParts) {
        const allocated = reserves.get(part.label) || 0
        if (allocated >= part.demand || floorBudget <= 0) continue
        reserves.set(part.label, allocated + 1)
        floorBudget -= 1
        progressed = true
      }
      if (!progressed) break
    }
    return {
      reserves,
      used: Array.from(reserves.values()).reduce((sum, value) => sum + value, 0),
    }
  }

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
      sourceKind: resolveContextSourceKind(part.label),
    })
  }

  const remaining = totalBudget - usedTokens
  if (remaining <= 0) {
    // P0 已经超出预算，需要截断，但仍保留一小段可用的 P1 证据。
    // 否则世界观摘要一旦过长，物品/场景计划会全部消失，导致生成失去
    // 当前章节的可执行约束。
    const floorAllocation = buildFloorReserves(Math.floor(totalBudget * 0.2))
    const perP0Budget = Math.floor(
      Math.max(0, totalBudget - floorAllocation.used) / Math.max(p0Parts.length, 1),
    )
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
        sourceKind: resolveContextSourceKind(part.label),
      })
      if (allocatedTokens < originalTokens) {
        warnings.push({ label: part.label, priority: 0, originalTokens, allocatedTokens, reason: 'truncated' })
      }
    }
    for (const part of parts.filter((part) => part.priority > 0)) {
      const originalTokens = estimateTokens(part.content)
      const reserve = floorAllocation.reserves.get(part.label) || 0
      if (reserve > 0) {
        result[part.label] = truncateToTokens(part.content, reserve)
        const allocatedTokens = estimateTokens(result[part.label])
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority: part.priority,
          originalTokens,
          allocatedTokens,
          status: allocatedTokens < originalTokens ? 'truncated' : 'kept',
          reason: allocatedTokens < originalTokens ? 'budget_insufficient' : 'budget_fit',
          sourceKind: resolveContextSourceKind(part.label),
        })
        if (allocatedTokens < originalTokens) {
          warnings.push({ label: part.label, priority: part.priority, originalTokens, allocatedTokens, reason: 'truncated' })
        }
      } else {
        result[part.label] = ''
      }
      if (originalTokens > 0 && reserve <= 0) {
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority: part.priority,
          originalTokens,
          allocatedTokens: 0,
          status: 'dropped',
          reason: 'budget_insufficient',
          sourceKind: resolveContextSourceKind(part.label),
        })
        warnings.push({ label: part.label, priority: part.priority, originalTokens, allocatedTokens: 0, reason: 'dropped' })
      }
    }
    if (warnings.length > 0) {
      console.warn(`[context] 上下文预算不足(${totalBudget} tokens)，${warnings.length} 个部分被截断或丢弃:`,
        warnings.map(w => `${w.label}(P${w.priority}): ${w.reason === 'dropped' ? '完全丢弃' : `${w.originalTokens}→${w.allocatedTokens}`}`).join(', '))
    }
    return {
      allocated: result,
      warnings,
      decisions: [...decisions.values()],
      totalUsed: usedTokens + Array.from(decisions.values())
        .filter((entry) => entry.priority !== 0)
        .reduce((sum, entry) => sum + entry.allocatedTokens, 0),
      totalBudget,
    }
  }

  let budget = remaining
  // 关键 P1 上下文保底：审校/重写高度依赖前情摘要，预算紧张时至少保留压缩版，不允许整体丢弃
  const floorAllocation = buildFloorReserves(Math.max(budget, 0))
  const floorReserves = floorAllocation.reserves
  budget -= floorAllocation.used
  for (const priority of [1, 2, 3] as const) {
    for (const part of parts.filter((item) => item.priority === priority)) {
      const needed = estimateTokens(part.content)
      const reserve = floorReserves.get(part.label) || 0
      if (reserve > 0) floorReserves.delete(part.label)
      const available = budget + reserve
      if (available <= 0) {
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
          sourceKind: resolveContextSourceKind(part.label),
        })
          warnings.push({ label: part.label, priority, originalTokens: needed, allocatedTokens: 0, reason: 'dropped' })
        }
      } else if (needed <= available) {
        result[part.label] = part.content
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority,
          originalTokens: needed,
          allocatedTokens: needed,
          status: 'kept',
          reason: 'budget_fit',
          sourceKind: resolveContextSourceKind(part.label),
        })
        budget = available - needed
      } else {
        result[part.label] = truncateToTokens(part.content, available)
        const allocatedTokens = estimateTokens(result[part.label])
        decisions.set(part.label, {
          label: part.label,
          title: resolveContextLabelTitle(part.label as ChapterContextLabel),
          priority,
          originalTokens: needed,
          allocatedTokens,
          status: 'truncated',
          reason: 'budget_insufficient',
          sourceKind: resolveContextSourceKind(part.label),
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
          mapSummary: 1,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          chapterBridgePlan: 0,
          stepMemorySummary: 0,
          continuitySummary: 2,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 2,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 3,
          writingContractSummary: 0,
          relationSummary: 1,
          dialogueVoiceLocks: 0,
          recalledMemory: 2,
          scenePlanSummary: null,
          draftTextSummary: null,
          contractVersionSummary: 1,
          reviewRiskSummary: null,
          reviewProofSummary: null,
          rewriteDeltaSummary: null,
          publishGateRiskSummary: null,
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
          mapSummary: 1,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          chapterBridgePlan: 0,
          stepMemorySummary: 0,
          continuitySummary: 1,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 2,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 2,
          writingContractSummary: 0,
          relationSummary: 1,
          dialogueVoiceLocks: 0,
          recalledMemory: 2,
          scenePlanSummary: 1,
          draftTextSummary: null,
          contractVersionSummary: 1,
          reviewRiskSummary: null,
          reviewProofSummary: null,
          rewriteDeltaSummary: null,
          publishGateRiskSummary: null,
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
          mapSummary: 1,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          chapterBridgePlan: 0,
          stepMemorySummary: 0,
          continuitySummary: 0,
          timelineSummary: 0,
          timelineOpenThreads: 2,
          longTermMemory: 1,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: null,
          writingContractSummary: 0,
          relationSummary: 1,
          dialogueVoiceLocks: 0,
          recalledMemory: 2,
          scenePlanSummary: 0,
          draftTextSummary: 0,
          contractVersionSummary: 0,
          reviewRiskSummary: 0,
          reviewProofSummary: 1,
          rewriteDeltaSummary: null,
          publishGateRiskSummary: 0,
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
          mapSummary: 1,
          itemSummary: 1,
          previousChapterContext: 1,
          lastChapterEnding: 1,
          chapterBridgePlan: 0,
          stepMemorySummary: 0,
          continuitySummary: 1,
          timelineSummary: 1,
          timelineOpenThreads: 1,
          longTermMemory: 1,
          activeThreads: 1,
          previousSummaries: 2,
          styleTemplate: 2,
          writingContractSummary: 0,
          relationSummary: 1,
          dialogueVoiceLocks: 0,
          recalledMemory: 2,
          scenePlanSummary: 1,
          draftTextSummary: 1,
          contractVersionSummary: 0,
          reviewRiskSummary: 0,
          reviewProofSummary: 0,
          rewriteDeltaSummary: 0,
          publishGateRiskSummary: 1,
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
    promote('chapterBridgePlan')
    promote('stepMemorySummary')
    promote('timelineSummary')
  }

  if (targetWords >= 350000 || chapterCount >= 80) {
    const currentLongTermPriority = priorities.longTermMemory
    if (typeof currentLongTermPriority === 'number') {
      priorities.longTermMemory = Math.min(currentLongTermPriority, 1) as ContextPart['priority']
    }
  }

  // 20 章以上的中长篇已经需要跨章节 checkpoint；让 draft/review/rewrite
  // 看见一个压缩后的长期记忆窗口。scenePlan 仍优先当前章合同与场景桥，
  // 不强行抢占它的结构设计预算。
  if (promptProfile !== 'scenePlan' && (targetWords >= 180000 || chapterCount >= 12)) {
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
  const fields: Array<[string[], string]> = [
    [['perspective', '视角', '叙事视角'], '视角'],
    [['sentence_style', '句式', '句式风格'], '句式'],
    [['emotion_style', '情感表达', '情绪表达'], '情感表达'],
    [['dialogue_style', '对话风格'], '对话风格'],
    [['description_style', '描写风格', '描写方式'], '描写风格'],
    [['example_tone', '整体语气', '示例语气'], '整体语气'],
  ]

  const usedKeys = new Set<string>()
  for (const [aliases, label] of fields) {
    for (const alias of aliases) {
      const value = asText(content[alias])
      if (value) {
        lines.push(`${label}：${value}`)
        usedKeys.add(alias)
        break
      }
    }
  }

  const forbiddenAliases = ['forbidden', '避免', '禁用', '禁止出现']
  for (const alias of forbiddenAliases) {
    const forbidden = toStringArray(content[alias])
    if (forbidden.length > 0) {
      lines.push(`避免：${forbidden.slice(0, 5).join('、')}`)
      usedKeys.add(alias)
      break
    }
  }

  // 用户自定义的其他字段也带入文风摘要，避免自建模板内容被静默丢弃
  for (const [key, rawValue] of Object.entries(content)) {
    if (usedKeys.has(key)) continue
    const value = asText(rawValue)
    if (value) {
      lines.push(`${key}：${value}`)
      continue
    }
    const items = toStringArray(rawValue)
    if (items.length > 0) {
      lines.push(`${key}：${items.slice(0, 5).join('、')}`)
    }
  }

  return lines.join('\n')
}

function enrichStyleTemplateWithFingerprint(baseTemplate: string, novelId: number): string {
  try {
    const resolved = resolveActiveStyleFingerprint(novelId)
    if (!resolved) return baseTemplate

    const section = buildStyleFingerprintPromptSection(resolved.record.id)
    if (!section) return baseTemplate

    return baseTemplate ? `${baseTemplate}\n\n${section}` : section
  } catch {
    return baseTemplate
  }
}

function buildManualStyleSampleConstraint(themeVoiceJson?: string | null): string {
  const themeVoice = parseThemeVoiceDocument(themeVoiceJson)
  const lines = [
    themeVoice.targetWorkSampleGuide ? `真实样章对照：${themeVoice.targetWorkSampleGuide}` : '',
    themeVoice.humanStyleSampleLock ? `人工风格样本锁定：${themeVoice.humanStyleSampleLock}` : '',
  ].filter(Boolean)
  if (lines.length === 0) return ''

  return [
    '【真实样章与人工风格锁】',
    ...lines.map((line) => `- ${line}`),
    '- 写作、审校和重写都必须用这些标准判断“读起来像不像目标作品”。',
    '- 如果只是语言更顺，但节奏、句式、信息密度、对白比例或现场质感偏离样章口径，应触发重写。',
  ].join('\n')
}

function buildStyleHardConstraintForNovel(novelId: number, themeVoiceJson?: string | null): string {
  const manualConstraint = buildManualStyleSampleConstraint(themeVoiceJson)
  try {
    const resolved = resolveActiveStyleFingerprint(novelId)
    if (!resolved) return manualConstraint
    return [
      buildStyleHardGuardPromptSection(resolved.record.id),
      manualConstraint,
    ].filter(Boolean).join('\n\n')
  } catch {
    return manualConstraint
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

export function buildBackgroundText(novel: typeof novels.$inferSelect): string {
  const original = novel.userBackground?.trim() || ''
  const expanded = novel.expandedBackground?.trim() || ''
  const synopsis = novel.synopsis?.trim() || ''

  return [
    original ? `作者原始描述：\n${original}` : '',
    expanded && expanded !== original ? `整理后的背景：\n${expanded}` : '',
    !original && !expanded ? synopsis : '',
  ].filter(Boolean).join('\n\n')
}

function formatSourceCanonValue(value: unknown, maxLength = 56): string {
  if (Array.isArray(value)) {
    const text = value
      .map((item) => asLooseText(item))
      .filter(Boolean)
      .slice(0, 2)
      .join('、')
    return text ? compactRecallLine(text, maxLength) : ''
  }

  if (value && typeof value === 'object') {
    const text = Object.entries(value as Record<string, unknown>)
      .map(([key, nestedValue]) => {
        const nestedText = asLooseText(nestedValue)
        return nestedText ? `${key}=${nestedText}` : ''
      })
      .filter(Boolean)
      .slice(0, 2)
      .join('；')
    return text ? compactRecallLine(text, maxLength) : ''
  }

  const text = asLooseText(value)
  return text ? compactRecallLine(text, maxLength) : ''
}

function buildSourceCanonGroundingSummary(input: {
  historicalProfileJson?: string | null
  projectCanonProfileJson?: string | null
  canonConstraintSetJson?: string | null
  sourceLedgerJson?: string | null
  canonSourceLedgerJson?: string | null
  canonFactCardsJson?: string | null
}): string {
  const historicalProfile = parseJsonRecord(input.historicalProfileJson)
  const projectCanonProfile = parseJsonRecord(input.projectCanonProfileJson)
  const canonConstraintSet = parseJsonRecord(input.canonConstraintSetJson)
  const sourceLedgerEntries = getGroundingSourceLedgerEntries(input)
  const canonFactCards = parseJsonRecordArray(input.canonFactCardsJson)

  const historicalProfilePieces = [
    asText(historicalProfile.mode) ? `mode=${asText(historicalProfile.mode)}` : '',
    asText(historicalProfile.eraPackId) ? `era=${asText(historicalProfile.eraPackId)}` : '',
    asText(historicalProfile.regionPackId) ? `region=${asText(historicalProfile.regionPackId)}` : '',
    asText(historicalProfile.institutionStrictness) ? `institution=${asText(historicalProfile.institutionStrictness)}` : '',
    asText(historicalProfile.terminologyStrictness) ? `terminology=${asText(historicalProfile.terminologyStrictness)}` : '',
  ].filter(Boolean).slice(0, 4)

  const canonProfilePieces = [
    asText(projectCanonProfile.worldType) ? `world=${asText(projectCanonProfile.worldType)}` : '',
    asText(projectCanonProfile.namingSystem) ? `naming=${compactRecallLine(asText(projectCanonProfile.namingSystem), 28)}` : '',
    asText(projectCanonProfile.narrativeView) ? `view=${asText(projectCanonProfile.narrativeView)}` : '',
    asText(projectCanonProfile.toneRegisterProfile) ? `tone=${compactRecallLine(asText(projectCanonProfile.toneRegisterProfile), 28)}` : '',
    asText(projectCanonProfile.technologyCeiling) ? `tech=${compactRecallLine(asText(projectCanonProfile.technologyCeiling), 24)}` : '',
    asText(projectCanonProfile.supernaturalCeiling) ? `supernatural=${compactRecallLine(asText(projectCanonProfile.supernaturalCeiling), 24)}` : '',
  ].filter(Boolean).slice(0, 4)

  const constraintPieces = Object.entries(canonConstraintSet)
    .map(([key, value]) => {
      const text = formatSourceCanonValue(value, 44)
      return text ? `${key}=${text}` : ''
    })
    .filter(Boolean)
    .slice(0, 3)

  const sourceLedgerPieces = sourceLedgerEntries
    .map((entry) => compactRecallLine(asText(entry.factTitle) || asText(entry.sourceText), 36))
    .filter(Boolean)
    .slice(-3)

  const canonFactPieces = canonFactCards
    .map((entry) => {
      const title = asText(entry.title)
      if (!title) return ''
      const summary = compactRecallLine(asText(entry.summary), 32)
      return summary ? `${title}：${summary}` : title
    })
    .filter(Boolean)
    .slice(-4)

  const lines = [
    historicalProfilePieces.length > 0 ? `项目历史 profile：${historicalProfilePieces.join('；')}` : '',
    canonProfilePieces.length > 0 ? `项目 canon profile：${canonProfilePieces.join('；')}` : '',
    constraintPieces.length > 0 ? `项目约束：${constraintPieces.join('；')}` : '',
    sourceLedgerPieces.length > 0 ? `已沉淀来源：${sourceLedgerPieces.join('；')}` : '',
    canonFactPieces.length > 0 ? `已确认 canon facts：${canonFactPieces.join('；')}` : '',
  ].filter(Boolean)

  return lines.join('\n')
}

function buildHistoricalGroundingSummary(input: {
  genreName?: string | null
  worldRulesJson?: string | null
  backgroundText?: string | null
  glossaryTerms?: string[]
  historicalProfileJson?: string | null
  projectCanonProfileJson?: string | null
  canonConstraintSetJson?: string | null
  sourceLedgerJson?: string | null
  canonSourceLedgerJson?: string | null
  canonFactCardsJson?: string | null
}): string {
  const assessment = assessHistoricalGrounding(input)
  if (assessment.mode === 'none') return ''

  const lines = [
    `历史 grounding：${assessment.summary}`,
    assessment.sourceSignals.length > 0 ? `已命中来源信号：${assessment.sourceSignals.join('、')}` : '',
    assessment.conservativeFallbackActive
      ? assessment.mode === 'historical_realist'
        ? '硬约束：未确认官制、礼制、器物、地理与纪年时，不得编造具体细节；改用保守表达并优先触发重写。'
        : assessment.mode === 'alternate_history'
          ? '硬约束：允许架空分歧，但未声明分歧点或制度依据时，不得伪装成真实史实细节。'
          : '硬约束：允许超自然元素，但制度、身份秩序、器物与措辞仍需保持历史框架，避免退化成 generic 奇幻说明文。'
      : '当前来源覆盖足以支撑历史题材写作，但仍需保持时代一致性。',
  ].filter(Boolean)

  return lines.join('\n')
}

function getCanonicalProtagonist(
  allCharacters: Array<Pick<typeof characters.$inferSelect, 'fullName' | 'roleType'>>,
): Pick<typeof characters.$inferSelect, 'fullName' | 'roleType'> | null {
  return allCharacters.find((character) =>
    character.roleType === 'protagonist' && Boolean(character.fullName?.trim())) || null
}

function buildProtagonistPolicy(
  allCharacters: Array<Pick<typeof characters.$inferSelect, 'fullName' | 'roleType'>>,
) {
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
  relationRowsOverride?: Array<typeof characterRelations.$inferSelect>,
): string {
  if (allCharacters.length === 0) return ''
  const db = getDb()
  const novelId = allCharacters[0]?.novelId
  const relationRows = relationRowsOverride || (
    typeof novelId === 'number'
      ? db.select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
      : []
  )
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

function formatDialogueVoiceLocksSection(locks: Array<{
  characterName: string
  mustKeep: string[]
  mustAvoid: string[]
  relationTone: string
  sampleHint: string
}>): string {
  if (locks.length === 0) return ''
  return locks.map((lock) => [
    `${lock.characterName}`,
    lock.mustKeep.length > 0 ? `- 必保留：${lock.mustKeep.join('；')}` : '',
    lock.mustAvoid.length > 0 ? `- 必避免：${lock.mustAvoid.join('；')}` : '',
    lock.relationTone ? `- 当前关系语气：${lock.relationTone}` : '',
    lock.sampleHint ? `- 差异化抓手：${lock.sampleHint}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
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

export function formatContinuityEntry(chapter: ChapterWithContinuity): string {
  const compactList = (values: string[], maxItems: number, maxLength = 88) => dedupe(
    values
      .map((value) => compactRecallLine(value, maxLength))
      .filter(Boolean),
    maxItems,
  ).join('；')

  const parts = [
    chapter.summary ? `摘要：${compactRecallLine(chapter.summary, 220)}` : '',
    compactList(chapter.continuityState.plotProgress, 3) ? `推进：${compactList(chapter.continuityState.plotProgress, 3)}` : '',
    compactList(chapter.continuityState.characterStateChanges, 2) ? `人物变化：${compactList(chapter.continuityState.characterStateChanges, 2)}` : '',
    compactList(chapter.continuityState.worldStateChanges, 2) ? `世界变化：${compactList(chapter.continuityState.worldStateChanges, 2)}` : '',
    compactList(chapter.continuityState.openLoops, 3) ? `未回收：${compactList(chapter.continuityState.openLoops, 3)}` : '',
    compactList(chapter.continuityState.continuityNotes, 2) ? `承接提醒：${compactList(chapter.continuityState.continuityNotes, 2)}` : '',
    chapter.continuityState.arcProgress
      ? `故事弧推进：${compactRecallLine(chapter.continuityState.arcProgress, 120)}`
      : '',
  ].filter(Boolean)

  return `第${chapter.chapterNum}章：${parts.join(' | ')}`
}

export interface ContinuityRetrievalOptions {
  signalText?: string
  mentionedCharacters?: string[]
  mentionedItems?: string[]
  mentionedLocations?: string[]
  mentionedFactions?: string[]
  maxEntries?: number
  maxChars?: number
}

function scoreContinuityRetrievalEntry(
  chapter: ChapterWithContinuity,
  options: ContinuityRetrievalOptions,
  latestChapterNum: number,
): number {
  const continuity = chapter.continuityState
  const chapterText = [
    chapter.summary,
    chapter.nextChapterSeed,
    continuity.plotProgress.join('\n'),
    continuity.characterStateChanges.join('\n'),
    continuity.worldStateChanges.join('\n'),
    continuity.openLoops.join('\n'),
    continuity.continuityNotes.join('\n'),
    continuity.arcProgress,
  ].filter(Boolean).join('\n')
  const signalLines = splitRecallLines(options.signalText || '', 8, 28)
  const entityTerms = [
    ...(options.mentionedCharacters || []),
    ...(options.mentionedItems || []),
    ...(options.mentionedLocations || []),
    ...(options.mentionedFactions || []),
  ]

  return (
    // Keep the latest continuity state in the candidate set even when it has
    // fewer explicit open loops than an older chapter.
    Math.max(0, 6 - Math.max(latestChapterNum - chapter.chapterNum, 0))
    + Math.min(continuity.openLoops.length, 3) * 8
    + Math.min(continuity.continuityNotes.length, 3) * 6
    + Math.min(continuity.arcProgress ? 1 : 0, 1) * 4
    + Math.min(signalLines.filter((line) => chapterText.includes(line)).length, 4) * 12
    + Math.min(entityTerms.filter((term) => term.length >= 2 && chapterText.includes(term)).length, 4) * 8
  )
}

function formatCompactContinuityRetrievalEntry(
  chapter: ChapterWithContinuity,
  maxChars: number,
): string {
  const compactList = (values: string[], maxItems: number, maxLength: number) => dedupe(
    values
      .map((value) => compactRecallLine(value, maxLength))
      .filter(Boolean),
    maxItems,
  ).join('；')

  const prefix = `第${chapter.chapterNum}章：`
  const sections = [
    compactList(chapter.continuityState.openLoops, 2, 58)
      ? `未回收=${compactList(chapter.continuityState.openLoops, 2, 58)}`
      : '',
    compactList(chapter.continuityState.continuityNotes, 1, 58)
      ? `承接=${compactList(chapter.continuityState.continuityNotes, 1, 58)}`
      : '',
    chapter.continuityState.arcProgress
      ? `弧=${compactRecallLine(chapter.continuityState.arcProgress, 64)}`
      : '',
    compactList(chapter.continuityState.plotProgress, 1, 58)
      ? `推进=${compactList(chapter.continuityState.plotProgress, 1, 58)}`
      : '',
    compactList(chapter.continuityState.characterStateChanges, 1, 48)
      ? `人物=${compactList(chapter.continuityState.characterStateChanges, 1, 48)}`
      : '',
    compactList(chapter.continuityState.worldStateChanges, 1, 48)
      ? `世界=${compactList(chapter.continuityState.worldStateChanges, 1, 48)}`
      : '',
    chapter.summary ? `摘要=${compactRecallLine(chapter.summary, 76)}` : '',
  ].filter(Boolean)

  if (sections.length === 0) return ''
  let result = prefix
  for (const section of sections) {
    const candidate = `${result}${result === prefix ? '' : ' | '}${section}`
    if (candidate.length <= maxChars) {
      result = candidate
      continue
    }
    // The first sections are the high-value handoff signals. If the entry is
    // very small, keep at least one bounded fact instead of emitting a bare
    // chapter number.
    if (result === prefix && maxChars > prefix.length + 12) {
      result = `${prefix}${compactRecallLine(section, maxChars - prefix.length)}`
    }
    break
  }
  return result
}

/**
 * Build a bounded, signal-aware continuity index for the prompt. The full
 * entry formatter remains useful for author-facing summaries, while the
 * generation prompt needs a smaller retrieval view so one long history block
 * cannot consume the budget before chapter-specific constraints are injected.
 */
export function buildContinuityRetrievalSummary(
  chapters: ChapterWithContinuity[],
  options: ContinuityRetrievalOptions = {},
): string {
  if (chapters.length === 0) return ''

  const latestChapterNum = chapters[chapters.length - 1]?.chapterNum || 0
  const maxEntries = Math.max(1, Math.min(
    options.maxEntries ?? 8,
    chapters.length,
  ))
  const maxChars = Math.max(240, options.maxChars ?? 1800)
  const budgetedMaxEntries = Math.max(1, Math.min(
    maxEntries,
    Math.floor((maxChars + 1) / 81),
  ))
  const ranked = chapters
    .map((chapter) => ({
      chapter,
      score: scoreContinuityRetrievalEntry(chapter, options, latestChapterNum),
    }))
    .sort((left, right) => right.score - left.score || right.chapter.chapterNum - left.chapter.chapterNum)
    .slice(0, budgetedMaxEntries)
    .sort((left, right) => left.chapter.chapterNum - right.chapter.chapterNum)

  const selected: string[] = []
  let usedChars = 0
  for (let index = 0; index < ranked.length; index += 1) {
    const remainingEntries = ranked.length - index
    const remainingChars = maxChars - usedChars - (selected.length > 0 ? 1 : 0)
    if (remainingChars <= 0) break
    const entryMaxChars = Math.max(80, Math.floor(remainingChars / remainingEntries))
    const entry = formatCompactContinuityRetrievalEntry(ranked[index].chapter, entryMaxChars)
    if (!entry) continue
    selected.push(entry)
    usedChars += entry.length + (selected.length > 1 ? 1 : 0)
  }

  return selected.join('\n')
}

export interface PreviousSummaryRetrievalOptions {
  signalText?: string
  maxEntries?: number
  maxChars?: number
}

export function buildPreviousSummaryRetrievalSummary(
  chapters: Array<Pick<ChapterWithContinuity, 'chapterNum' | 'summary'>>,
  options: PreviousSummaryRetrievalOptions = {},
): string {
  const candidates = chapters.filter((chapter) => chapter.summary)
  if (candidates.length === 0) return ''

  const latestChapterNum = candidates[candidates.length - 1]?.chapterNum || 0
  const signalLines = splitRecallLines(options.signalText || '', 8, 28)
  const maxEntries = Math.max(1, Math.min(options.maxEntries ?? 8, candidates.length))
  const maxChars = Math.max(240, options.maxChars ?? 1800)
  const budgetedMaxEntries = Math.max(1, Math.min(
    maxEntries,
    Math.floor((maxChars + 1) / 81),
  ))
  const ranked = candidates
    .map((chapter) => ({
      chapter,
      score: Math.max(0, 6 - Math.max(latestChapterNum - chapter.chapterNum, 0))
        + Math.min(signalLines.filter((line) => chapter.summary.includes(line)).length, 4) * 12,
    }))
    .sort((left, right) => right.score - left.score || right.chapter.chapterNum - left.chapter.chapterNum)
    .slice(0, budgetedMaxEntries)
    .sort((left, right) => left.chapter.chapterNum - right.chapter.chapterNum)

  const selected: string[] = []
  let usedChars = 0
  for (let index = 0; index < ranked.length; index += 1) {
    const remainingEntries = ranked.length - index
    const remainingChars = maxChars - usedChars - (selected.length > 0 ? 1 : 0)
    if (remainingChars <= 0) break
    const entryMaxChars = Math.max(80, Math.floor(remainingChars / remainingEntries))
    const prefix = `第${ranked[index].chapter.chapterNum}章：`
    const summary = compactRecallLine(
      ranked[index].chapter.summary,
      Math.max(12, entryMaxChars - prefix.length),
    )
    const entry = `${prefix}${summary}`
    selected.push(entry)
    usedChars += entry.length + (selected.length > 1 ? 1 : 0)
  }
  return selected.join('\n')
}

export function buildStoryRelationSummary(
  novelId: number,
  allCharacters: Array<typeof characters.$inferSelect>,
  focusText: string,
  limit = 8,
  relationRowsOverride?: Array<typeof characterRelations.$inferSelect>,
): string {
  const relationRows = relationRowsOverride
    || getDb().select().from(characterRelations).where(eq(characterRelations.novelId, novelId)).all()
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
  characterRows: Array<Pick<CharacterMentionCatalogRow, 'id' | 'fullName'>>,
  arcRows: Array<typeof storyArcs.$inferSelect>,
  mapRows: Array<Pick<LocationMentionCatalogRow, 'id' | 'name'>>,
): { timelineSummary: string; timelineOpenThreads: string } {
  const db = getDb()
  const selectedEventIds = loadTimelineContextEventIds(
    getSqlite(),
    novelId,
    chapterNum,
    currentArcId,
  )
  if (selectedEventIds.length === 0) {
    return { timelineSummary: '', timelineOpenThreads: '' }
  }

  const selectedRows = db.select().from(timelineEvents)
    .where(and(
      eq(timelineEvents.novelId, novelId),
      inArray(timelineEvents.id, selectedEventIds),
    ))
    .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
    .limit(selectedEventIds.length)
    .all()
  if (selectedRows.length === 0) {
    return { timelineSummary: '', timelineOpenThreads: '' }
  }

  const anchorChapterIds = [...new Set(selectedRows.flatMap((event) => [
    event.chapterStartId,
    event.chapterEndId,
  ]).filter((id): id is number => typeof id === 'number'))].slice(0, 12)
  const anchorChapterRows = anchorChapterIds.length > 0
    ? db.select({
        id: chapters.id,
        chapterNum: chapters.chapterNum,
      }).from(chapters)
      .where(and(
        eq(chapters.novelId, novelId),
        inArray(chapters.id, anchorChapterIds),
      ))
      .limit(anchorChapterIds.length)
      .all()
    : []
  const chapterNumMap = new Map(anchorChapterRows.map((row) => [row.id, row.chapterNum]))
  const arcNameMap = new Map(arcRows.map((row) => [row.id, row.arcName]))
  const characterNameMap = new Map(characterRows.map((row) => [row.id, row.fullName]))
  const locationNameMap = new Map(mapRows.map((row) => [row.id, row.name]))

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

function buildMapContextSummary(
  locationRows: Array<typeof worldMap.$inferSelect>,
  mentionedLocationNames: string[],
  limit = 8,
): string {
  if (locationRows.length === 0 || mentionedLocationNames.length === 0) return ''
  const terms = dedupe(mentionedLocationNames, limit)
  const rowById = new Map(locationRows.map((row) => [row.id, row]))
  const buildPath = (row: typeof worldMap.$inferSelect): string => {
    const names = [row.name]
    const seen = new Set<number>([row.id])
    let parentId = row.parentId
    while (typeof parentId === 'number' && !seen.has(parentId) && names.length < 6) {
      seen.add(parentId)
      const parent = rowById.get(parentId)
      if (!parent) break
      names.unshift(parent.name)
      parentId = parent.parentId
    }
    return names.join(' -> ')
  }
  const scoreRow = (row: typeof worldMap.$inferSelect): number => {
    const haystack = [
      row.name,
      row.nodeType,
      row.locationType,
      row.structureRole,
      row.description,
      row.plotRelevance,
      row.dangerLevel,
    ].filter(Boolean).join(' ')
    return terms.reduce((sum, term, index) => {
      if (row.name === term) return sum + 100 - index
      if (row.name.includes(term) || term.includes(row.name)) return sum + 60 - index
      return haystack.includes(term) ? sum + 20 - index : sum
    }, 0)
  }

  const selected = locationRows
    .map((row) => ({ row, score: scoreRow(row) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.row.level - right.row.level || (left.row.sortOrder || 0) - (right.row.sortOrder || 0))
    .slice(0, limit)

  if (selected.length === 0) return ''

  return selected.map(({ row }) => {
    const meta = [
      `层级${row.level}`,
      row.locationType || row.nodeType || '',
      row.structureRole || '',
      row.dangerLevel ? `风险=${row.dangerLevel}` : '',
    ].filter(Boolean).join(' / ')
    const details = [
      row.description || '',
      row.plotRelevance ? `剧情作用=${row.plotRelevance}` : '',
    ].filter(Boolean).join('；')
    return `${buildPath(row)}${meta ? `（${meta}）` : ''}${details ? `：${details}` : ''}`
  }).join('\n')
}

function buildItemSummary(
  rows: Array<typeof storyItems.$inferSelect>,
  characterNameMap: Map<number, string>,
  locationNameMap: Map<number, string>,
  limit = 12,
  mentionedItemNames: string[] = [],
): string {
  const instanceRows = rows
    .filter((item) => item.itemKind === 'instance')
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id)

  if (instanceRows.length === 0) return ''
  const mentionedSet = new Set(mentionedItemNames)
  const orderedRows = mentionedSet.size === 0
    ? instanceRows
    : [
        ...instanceRows.filter((item) => mentionedSet.has(item.itemName)),
        ...instanceRows.filter((item) => !mentionedSet.has(item.itemName)),
      ]

  return renderItemCards(buildItemContextCards({
    items: orderedRows,
    characterNameMap,
    locationNameMap,
    limit,
  }))
}

function buildActiveThreadsContextData(
  rows: Array<typeof storyThreads.$inferSelect>,
  chapterNum: number,
  currentArc?: typeof storyArcs.$inferSelect | null,
  limit = 10,
  pressureCount?: number,
): { summary: string; pressureCount: number } {
  if (rows.length === 0) {
    return { summary: '', pressureCount: 0 }
  }
  const threadContext = buildChapterThreadContextCards({
    threads: rows,
    chapterNum,
    currentArc,
    limit,
  })

  return {
    summary: renderThreadCards(threadContext.cards),
    pressureCount: pressureCount ?? threadContext.pressureCount,
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
  dueThreadRows: Array<typeof storyThreads.$inferSelect>,
  foreshadowLinkedThreadRows: Array<typeof storyThreads.$inferSelect>,
  foreshadowLedger: ReturnType<typeof listForeshadowLedgerByIds>,
  chapterNum: number,
  currentArc?: typeof storyArcs.$inferSelect | null,
  limit = 2,
): string {
  const threadById = new Map(
    [...dueThreadRows, ...foreshadowLinkedThreadRows]
      .map((thread) => [thread.id, thread] as const),
  )
  const ledgerLines = foreshadowLedger
    .filter((entry) => entry.status !== 'resolved' && entry.status !== 'archived')
    .filter((entry) => typeof entry.targetPayoffChapter === 'number' && entry.targetPayoffChapter > 0)
    .filter((thread) => {
      const distance = thread.targetPayoffChapter! - chapterNum
      return distance <= 0 || distance <= 3
    })
    .sort((left, right) => {
      const leftOverdue = left.targetPayoffChapter! < chapterNum ? 0 : 1
      const rightOverdue = right.targetPayoffChapter! < chapterNum ? 0 : 1
      if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue

      const leftThread = typeof left.linkedThreadId === 'number' ? threadById.get(left.linkedThreadId) : null
      const rightThread = typeof right.linkedThreadId === 'number' ? threadById.get(right.linkedThreadId) : null
      const leftArc = leftThread && isCurrentArcThread(leftThread, currentArc) ? 0 : 1
      const rightArc = rightThread && isCurrentArcThread(rightThread, currentArc) ? 0 : 1
      if (leftArc !== rightArc) return leftArc - rightArc

      const leftDistance = Math.abs(left.targetPayoffChapter! - chapterNum)
      const rightDistance = Math.abs(right.targetPayoffChapter! - chapterNum)
      if (leftDistance !== rightDistance) return leftDistance - rightDistance

      const leftPriority = threadPriorityRank(leftThread?.priority)
      const rightPriority = threadPriorityRank(rightThread?.priority)
      if (leftPriority !== rightPriority) return leftPriority - rightPriority

      return left.id - right.id
    })
    .slice(0, limit)
    .map((entry) => compactRecallLine([
      entry.targetPayoffChapter! < chapterNum ? '超期必处理' : '到期必处理',
      entry.title,
      entry.sourceChapterNum ? `埋设=第${entry.sourceChapterNum}章` : '',
      `目标=第${entry.targetPayoffChapter}章`,
      entry.payoffSceneAction ? `动作=${entry.payoffSceneAction}` : '',
      entry.requiredEvidence ? `证据=${entry.requiredEvidence}` : '',
      entry.readerVisibleOutcome ? `结果=${entry.readerVisibleOutcome}` : entry.payoffMethod ? `回收=${entry.payoffMethod}` : '',
      entry.allowedDelayReason ? `仅可延期=${entry.allowedDelayReason}` : '',
    ].filter(Boolean).join(' · '), 120))
    .filter(Boolean)

  const coveredThreadIds = new Set(foreshadowLedger
    .map((entry) => entry.linkedThreadId)
    .filter((id): id is number => typeof id === 'number'))

  const threadLines = dueThreadRows
    .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')
    .filter(isForeshadowThreadCandidate)
    .filter((thread) => !coveredThreadIds.has(thread.id))
    .filter((thread) => typeof thread.targetPayoffChapter === 'number' && thread.targetPayoffChapter > 0)
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
    .slice(0, Math.max(0, limit - ledgerLines.length))
    .map((thread) => compactRecallLine([
      thread.targetPayoffChapter! < chapterNum ? '超期必处理' : '到期必处理',
      thread.title,
      thread.plantedChapter || thread.startChapter ? `埋设=第${thread.plantedChapter || thread.startChapter}章` : '',
      `目标=第${thread.targetPayoffChapter}章`,
      thread.currentState || thread.summary || '',
      thread.payoffCondition ? `条件=${thread.payoffCondition}` : '',
    ].filter(Boolean).join(' · '), 120))
    .filter(Boolean)

  // 长期悬置通道：没填目标回收章、但埋设已超过阈值的伏笔，周期性浮出提醒安排回收，
  // 避免长篇（几十万到百万字）里"无目标章"的伏笔被永久遗忘。
  const STALE_FORESHADOW_CHAPTER_GAP = 40
  const staleLedgerLines = foreshadowLedger
    .filter((entry) => entry.status !== 'resolved' && entry.status !== 'archived')
    .filter((entry) => !(typeof entry.targetPayoffChapter === 'number' && entry.targetPayoffChapter > 0))
    .filter((entry) => typeof entry.sourceChapterNum === 'number'
      && entry.sourceChapterNum > 0
      && chapterNum - entry.sourceChapterNum >= STALE_FORESHADOW_CHAPTER_GAP)
    .sort((left, right) => (left.sourceChapterNum || 0) - (right.sourceChapterNum || 0))
    .slice(0, 2)
    .map((entry) => compactRecallLine([
      '长期悬置待安排回收',
      entry.title,
      `埋设=第${entry.sourceChapterNum}章（已悬置${chapterNum - (entry.sourceChapterNum || 0)}章）`,
      entry.payoffMethod ? `回收=${entry.payoffMethod}` : '',
      '本章至少要给出推进线索或明确回收章位',
    ].filter(Boolean).join(' · '), 120))
    .filter(Boolean)

  const dueLines = [...ledgerLines, ...threadLines].slice(0, limit)
  // 悬置伏笔不挤占到期/超期名额：至多额外附加 1 条
  return [...dueLines, ...staleLedgerLines.slice(0, Math.max(1, limit - dueLines.length))]
    .join('\n')
}

function buildStoryThreadsSummary(
  threadRows: Array<typeof storyThreads.$inferSelect>,
  limit = 24,
): string {
  const rows = [...threadRows]
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0) || left.id - right.id)
    .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')

  if (rows.length === 0) return ''

  return rows
    .slice(0, limit)
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

function resolveStoryThreadSummaryLimit(novel: typeof novels.$inferSelect): number {
  const targetWords = Number(novel.targetWords || 0)
  if (targetWords >= 1500000) return 40
  if (targetWords >= 800000) return 32
  if (targetWords >= 350000) return 24
  return 16
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

function scoreKeyChapterRetention(
  row: typeof chapters.$inferSelect,
  options: {
    signalText?: string
    mentionedCharacters?: string[]
    mentionedItems?: string[]
    mentionedLocations?: string[]
    mentionedFactions?: string[]
  } = {},
): number {
  const continuity = parseContinuityState(row.continuityStateJson)
  const chapterText = [
    row.title || '',
    row.summary || '',
    row.outline || '',
    row.nextChapterSeed || '',
    continuity.plotProgress.join('\n'),
    continuity.characterStateChanges.join('\n'),
    continuity.worldStateChanges.join('\n'),
    continuity.openLoops.join('\n'),
    continuity.continuityNotes.join('\n'),
    continuity.arcProgress,
  ].filter(Boolean).join('\n')

  let score = 0
  if (row.chapterNum <= 3) score += 10 - row.chapterNum
  score += Math.min(continuity.openLoops.length, 3) * 4
  score += Math.min(continuity.continuityNotes.length, 3) * 3
  score += Math.min(continuity.characterStateChanges.length, 3) * 2
  score += Math.min(continuity.worldStateChanges.length, 2) * 2
  if (containsAny(chapterText, options.mentionedCharacters || [])) score += 10
  if (containsAny(chapterText, options.mentionedItems || [])) score += 8
  if (containsAny(chapterText, options.mentionedLocations || [])) score += 6
  if (containsAny(chapterText, options.mentionedFactions || [])) score += 8
  if (options.signalText) {
    const signalMatches = splitRecallLines(options.signalText, 6, 24).filter((line) =>
      line.length >= 2 && chapterText.includes(line))
    score += signalMatches.length * 5
  }
  return score
}

export function selectRecentContextRows(
  previousRows: Array<typeof chapters.$inferSelect>,
  targetWords: number,
  chapterCount: number,
  options: {
    launchMode?: string | null
    settingsJson?: string | null
    signalText?: string
    mentionedCharacters?: string[]
    mentionedItems?: string[]
    mentionedLocations?: string[]
    mentionedFactions?: string[]
    maxCarryover?: number
  } = {},
): Array<typeof chapters.$inferSelect> {
  if (previousRows.length === 0) return []

  const recentWindow = resolveRecentContextWindow(
    targetWords,
    chapterCount,
    options.launchMode,
    options.settingsJson,
    options,
  )
  const recentRows = previousRows.slice(-recentWindow)
  const recentIds = new Set(recentRows.map((row) => row.id))
  const defaultCarryover = recentWindow >= 22 ? 4 : 2
  const maxCarryover = Math.max(0, options.maxCarryover ?? defaultCarryover)
  if (maxCarryover === 0) return recentRows

  const keyCarryovers = previousRows
    .filter((row) => !recentIds.has(row.id))
    .map((row) => ({
      row,
      score: scoreKeyChapterRetention(row, options),
    }))
    .filter((entry) => entry.score >= 8)
    .sort((left, right) => right.score - left.score || left.row.chapterNum - right.row.chapterNum)
    .slice(0, maxCarryover)
    .map((entry) => entry.row)

  return [...keyCarryovers, ...recentRows]
    .sort((left, right) => left.chapterNum - right.chapterNum)
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

const SOURCE_DERIVED_PREVIOUS_CHAPTER_SEGMENT_TYPES = new Set<PreviousChapterSampleSegmentType>([
  'full_text',
  'opening',
  'middle',
  'tail',
])

function calculatePreviousChapterSampledChars(segments: PreviousChapterSampleSegment[]): number {
  return segments.reduce((sum, segment) => (
    SOURCE_DERIVED_PREVIOUS_CHAPTER_SEGMENT_TYPES.has(segment.type)
      ? sum + segment.chars
      : sum
  ), 0)
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
      pushSegment('middle', '上章中段片段', extractTextWindow(sourceText, 'middle', 220))
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
  const sampledChars = calculatePreviousChapterSampledChars(segments)
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

export interface StoryProfileBuildOptions {
  /**
   * Structure initialization is an explicit write-side concern. Callers that
   * are about to write chapter/outline data can opt in; context reads and
   * draft/agent workflows stay side-effect free by default.
   */
  ensureStructure?: boolean
}

export async function buildStoryProfile(
  novelId: number,
  options: StoryProfileBuildOptions = {},
): Promise<StoryProfile> {
  const db = getDb()
  if (options.ensureStructure === true) ensureStoryStructure(novelId)
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  const protagonistRows = db.select().from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      eq(characters.roleType, 'protagonist'),
      sql`trim(${characters.fullName}) <> ''`,
    ))
    .orderBy(asc(characters.id))
    .limit(1)
    .all()
  const threadRows = loadStoryProfileThreadRows(novel)
  return buildStoryProfileFromSourceRows(novel, protagonistRows, threadRows)
}

function loadStoryProfileThreadRows(
  novel: typeof novels.$inferSelect,
): Array<typeof storyThreads.$inferSelect> {
  const threadLimit = resolveStoryThreadSummaryLimit(novel)
  return getDb().select().from(storyThreads)
    .where(and(
      eq(storyThreads.novelId, novel.id),
      or(
        isNull(storyThreads.status),
        notInArray(storyThreads.status, ['resolved', 'abandoned']),
      ),
    ))
    .orderBy(asc(storyThreads.sortOrder), asc(storyThreads.id))
    .limit(threadLimit)
    .all()
}

function loadStoryThreadRowsByIds(
  novelId: number,
  ids: number[],
): Array<typeof storyThreads.$inferSelect> {
  const normalizedIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))]
  if (normalizedIds.length === 0) return []
  return getDb().select().from(storyThreads)
    .where(and(
      eq(storyThreads.novelId, novelId),
      inArray(storyThreads.id, normalizedIds),
    ))
    .limit(normalizedIds.length)
    .all()
}

function buildStoryProfileFromSourceRows(
  novel: typeof novels.$inferSelect,
  allCharacters: Array<Pick<typeof characters.$inferSelect, 'fullName' | 'roleType'>>,
  threadRows: Array<typeof storyThreads.$inferSelect>,
): StoryProfile {
  const db = getDb()
  const novelId = novel.id
  const genre = novel.genreId
    ? db.select().from(genres).where(eq(genres.id, novel.genreId)).all()[0]
    : null
  const styleTemplate = novel.styleTemplateId
    ? db.select().from(templates).where(eq(templates.id, novel.styleTemplateId)).all()[0]
    : null
  const worldTemplate = novel.worldTemplateId
    ? db.select().from(templates).where(eq(templates.id, novel.worldTemplateId)).all()[0]
    : null

  const settings = parseStorySettings(novel.settingsJson)
  const projectBrief = parseProjectBriefDocument(novel.projectBriefJson)
  const themeVoice = parseThemeVoiceDocument(novel.themeVoiceJson)
  const writingContractSummary = [
    buildWritingContractSummary(themeVoice.writingContractTags),
    themeVoice.themeChapterTest ? `章节级主题验证：${themeVoice.themeChapterTest}` : '',
  ].filter(Boolean).join('\n')
  const protagonistPolicy = buildProtagonistPolicy(allCharacters)
  const glossaryTerms = db.select({ term: glossary.term }).from(glossary)
    .where(eq(glossary.novelId, novelId))
    .orderBy(asc(glossary.sortOrder), asc(glossary.id))
    .all()
    .map((row) => row.term || '')
    .filter(Boolean)
  const backgroundText = buildBackgroundText(novel)
  const historicalGroundingSummary = buildHistoricalGroundingSummary({
    genreName: genre?.name,
    worldRulesJson: novel.worldRulesJson,
    backgroundText,
    glossaryTerms,
    historicalProfileJson: novel.historicalProfileJson,
    projectCanonProfileJson: novel.projectCanonProfileJson,
    canonConstraintSetJson: novel.canonConstraintSetJson,
    sourceLedgerJson: novel.sourceLedgerJson,
    canonSourceLedgerJson: novel.canonSourceLedgerJson,
    canonFactCardsJson: novel.canonFactCardsJson,
  })
  const sourceCanonGroundingSummary = buildSourceCanonGroundingSummary({
    historicalProfileJson: novel.historicalProfileJson,
    projectCanonProfileJson: novel.projectCanonProfileJson,
    canonConstraintSetJson: novel.canonConstraintSetJson,
    sourceLedgerJson: novel.sourceLedgerJson,
    canonSourceLedgerJson: novel.canonSourceLedgerJson,
    canonFactCardsJson: novel.canonFactCardsJson,
  })

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
    storyThreadsSummary: buildStoryThreadsSummary(threadRows, resolveStoryThreadSummaryLimit(novel)),
    storyGoal: settings.storyGoal,
    coreConflict: settings.coreConflict,
    mainPlot: settings.mainPlot,
    subPlots: formatSubPlots(settings),
    ending: settings.ending,
    rhythmSummary: formatRhythmSummary(settings),
    worldRulesSummary: [
      formatWorldRulesSummary(novel.worldRulesJson),
      formatWorldTemplateSummary(worldTemplate),
      historicalGroundingSummary,
      sourceCanonGroundingSummary,
    ].filter(Boolean).join('\n\n'),
    styleTemplateSummary: formatStyleTemplateSummary(styleTemplate?.contentJson),
    hasProtagonist: protagonistPolicy.hasProtagonist,
    protagonistName: protagonistPolicy.protagonistName,
    protagonistReference: protagonistPolicy.protagonistReference,
    protagonistRule: protagonistPolicy.protagonistRule,
    historicalGroundingSummary,
  }
}

export async function buildOutlineGenerationContext(arcId: number, stageId?: number): Promise<OutlineGenerationContext> {
  const db = getDb()
  const arc = db.select().from(storyArcs).where(eq(storyArcs.id, arcId)).all()[0]
  if (!arc) throwUserFacingError('storyArc.notFound')
  const novel = db.select().from(novels).where(eq(novels.id, arc.novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')
  ensureStoryStructure(arc.novelId)

  const profile = await buildStoryProfile(arc.novelId)
  const chapterStart = arc.chapterStart || 1
  const creativeStageContext = resolveCreativeStageContextForChapter(
    arc.novelId,
    chapterStart,
    stageId,
  )
  const allCharacters = db.select().from(characters).where(eq(characters.novelId, arc.novelId)).all()
  const chapterCount = getNovelChapterCount(arc.novelId)
  const chapterRows = chapterCount > BOUNDED_CONTEXT_CHAPTER_THRESHOLD
    ? loadBoundedChapterRows(arc.novelId, chapterStart, novel, arc)
    : db.select().from(chapters)
      .where(eq(chapters.novelId, arc.novelId))
      .orderBy(asc(chapters.chapterNum))
      .all()
  const previousRows = chapterRows.filter((chapter) => chapter.chapterNum < chapterStart)

  const recentChapters = selectRecentContextRows(
    previousRows,
    novel.targetWords || 0,
    chapterCount,
    {
      launchMode: novel.launchMode,
      settingsJson: novel.settingsJson,
      signalText: [arc.arcGoal || '', arc.arcSummary || ''].filter(Boolean).join('\n'),
    },
  ).map(toChapterWithContinuity)
  const previousSummary = buildPreviousSummaryRetrievalSummary(recentChapters, {
    signalText: [arc.arcGoal || '', arc.arcSummary || ''].filter(Boolean).join('\n'),
  })

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
    continuitySummary: buildContinuityRetrievalSummary(continuityChapters, {
      signalText: [arc.arcGoal || '', arc.arcSummary || ''].filter(Boolean).join('\n'),
    }),
    openLoops: collectOpenLoops(continuityChapters),
    worldRulesSummary: profile.worldRulesSummary,
    creativeStageContext: creativeStageContext || undefined,
  }
}

export async function collectChapterContextRawData(
  novelId: number,
  chapterNum: number,
  stageId?: number,
): Promise<ChapterContextRawData> {
  const db = getDb()
  ensureStoryStructure(novelId)
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const entityCatalogs = loadChapterEntityMentionCatalogs(novelId, {
    contextVersion: novel.contextVersion || 1,
  })
  const profileThreadRows = loadStoryProfileThreadRows(novel)
  const profile = buildStoryProfileFromSourceRows(novel, entityCatalogs.characters, profileThreadRows)
  const chapterCount = getNovelChapterCount(novelId)
  const arcs = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const currentChapterBase = db.select().from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.chapterNum, chapterNum)))
    .limit(1)
    .all()[0]
  const currentArc = resolveArcForChapter(chapterNum, currentChapterBase?.arcId, arcs)
  const chapterRows = chapterCount > BOUNDED_CONTEXT_CHAPTER_THRESHOLD
    ? loadBoundedChapterRows(novelId, chapterNum, novel, currentArc)
    : db.select().from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(asc(chapters.chapterNum))
      .all()
  const currentChapter = chapterRows.find((chapter) => chapter.chapterNum === chapterNum) || currentChapterBase
  const creativeStageContext = resolveCreativeStageContextForChapter(novelId, chapterNum, stageId)
  const previousRows = chapterRows.filter((chapter) => chapter.chapterNum < chapterNum)
  const targetWords = Number(novel.targetWords || 0)
  const contractContext = currentChapter ? getChapterContractContext(currentChapter.id) : null
  const worldRules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const maxMapDepth = Math.max(
    ...worldRules.mapBlueprint.levels.map((level) => level.depth),
    entityCatalogs.maxMapDepth,
    1,
  )
  const chapterGoalPreview = [
    extractChapterGoal(currentChapter?.outline),
    currentArc?.arcGoal || '',
  ].filter(Boolean).join('\n')
  const previousChapterFeed = buildPreviousChapterContextFeed(previousRows[previousRows.length - 1])
  const chapterSignalText = [
    currentChapter?.title,
    chapterGoalPreview,
    currentChapter?.outline,
    previousChapterFeed.previousChapterContext,
    previousChapterFeed.lastChapterEnding,
    currentArc?.arcSummary,
    currentArc?.arcGoal,
    contractContext?.chapterContract.chapterGoal,
    ...(contractContext?.chapterContract.requiredAssetRefs || []),
    ...(contractContext?.chapterContract.requiredArcProgress || []),
    ...(contractContext?.chapterContract.requiredResistanceActions || []),
    ...(contractContext?.chapterContract.acceptanceNotes || []),
    ...(contractContext?.sceneContracts || []).flatMap((scene) => [
      scene.segmentTitle,
      scene.pov,
      scene.timeLocation,
      scene.sceneGoal,
      scene.obstacle,
      scene.conflictType,
      scene.emotionShift,
      ...scene.revealPayload,
      scene.resultState,
      scene.linkageMode,
    ]),
    ...(contractContext?.requiredCommitments || []).flatMap((item) => [item.title, item.description]),
    ...(contractContext?.requiredForeshadows || []).flatMap((item) => [
      item.title,
      item.detail,
      item.payoffMethod,
      item.payoffSceneAction,
      item.requiredEvidence,
      item.readerVisibleOutcome,
    ]),
  ].filter(Boolean).join('\n')
  const mentionedEntityLimits = resolveMentionedEntityLimits({
    targetWords,
    chapterCount,
    launchMode: novel.launchMode,
    settingsJson: novel.settingsJson,
    mapDepth: maxMapDepth,
    factionCount: Math.max(worldRules.factionSystem.length, entityCatalogs.factions.length),
    speciesCount: Math.max(worldRules.speciesSystem.length, entityCatalogs.speciesCount),
    powerSystemCount: worldRules.powerSystems.length,
  })
  const characterMentionCandidates = buildCharacterMentionCandidates(entityCatalogs.characters)
  const itemMentionCandidates = buildItemMentionCandidates(entityCatalogs.items)
  const locationMentionCandidates = buildLocationMentionCandidates(entityCatalogs.locations)
  const factionMentionCandidates = buildFactionMentionCandidates(entityCatalogs.factions)
  const entityCatalogLookups = getChapterEntityMentionCatalogLookups(entityCatalogs)
  const characterNameById = entityCatalogLookups.characterNameById
  const locationNameById = entityCatalogLookups.locationNameById
  const mentionedCharacterNames = new Set<string>(collectMentionedEntityNamesFromCandidates(
    chapterSignalText,
    characterMentionCandidates,
    mentionedEntityLimits.characters,
  ))
  const relationRowsForMention = entityCatalogs.relations
  collectRelationMentionedCharacterNames(
    chapterSignalText,
    relationRowsForMention,
    characterNameById,
    mentionedEntityLimits.characters,
  ).forEach((name) => {
    if (mentionedCharacterNames.size < mentionedEntityLimits.characters) mentionedCharacterNames.add(name)
  })
  const explicitlyRequiredItemNames = collectExplicitEntityNamesFromReferences(
    contractContext?.chapterContract.requiredAssetRefs,
    itemMentionCandidates,
  )
  const mentionedItemNames = dedupe([
    ...explicitlyRequiredItemNames,
    ...collectMentionedEntityNamesFromCandidates(
      chapterSignalText,
      itemMentionCandidates,
      mentionedEntityLimits.items,
    ),
  ], Math.max(mentionedEntityLimits.items, explicitlyRequiredItemNames.length))
  const mentionedLocationNames = collectMentionedEntityNamesFromCandidates(
    chapterSignalText,
    locationMentionCandidates,
    mentionedEntityLimits.locations,
  )
  const explicitlyRequiredLocationNames = collectExplicitEntityNamesFromReferences(
    (contractContext?.sceneContracts || []).map((scene) => scene.timeLocation || ''),
    locationMentionCandidates,
  )
  const mergedMentionedLocationNames = dedupe([
    ...explicitlyRequiredLocationNames,
    ...mentionedLocationNames,
  ], Math.max(mentionedEntityLimits.locations, explicitlyRequiredLocationNames.length))
  const factionMentionLimit = Math.max(8, Math.ceil(mentionedEntityLimits.characters / 2))
  const mentionedFactionNames = collectMentionedEntityNamesFromCandidates(
    chapterSignalText,
    factionMentionCandidates,
    factionMentionLimit,
  )
  const mentionValidationCharacters = dedupe([
    ...collectMentionedEntityValidationTermsFromCandidates(chapterSignalText, characterMentionCandidates, mentionedEntityLimits.characters),
    ...collectRelationMentionValidationTerms(chapterSignalText, relationRowsForMention, characterNameById, mentionedEntityLimits.characters),
  ], mentionedEntityLimits.characters * 3)
  const mentionValidationItems = collectMentionedEntityValidationTermsFromCandidates(chapterSignalText, itemMentionCandidates, mentionedEntityLimits.items)
  const mentionValidationLocations = dedupe([
    ...collectMentionedEntityValidationTermsFromCandidates(chapterSignalText, locationMentionCandidates, mentionedEntityLimits.locations),
    ...explicitlyRequiredLocationNames,
  ], Math.max(mentionedEntityLimits.locations * 3, explicitlyRequiredLocationNames.length))
  const mentionValidationFactions = collectMentionedEntityValidationTermsFromCandidates(chapterSignalText, factionMentionCandidates, factionMentionLimit)
  const recentChapters = selectRecentContextRows(
    previousRows,
    targetWords,
    chapterCount,
    {
      launchMode: novel.launchMode,
      settingsJson: novel.settingsJson,
      signalText: chapterSignalText,
      mentionedCharacters: [...mentionedCharacterNames],
      mentionedItems: mentionedItemNames,
      mentionedLocations: mergedMentionedLocationNames,
      mentionedFactions: mentionedFactionNames,
    },
  ).map(toChapterWithContinuity)
  const continuityChapters = recentChapters.filter((chapter) => hasContinuityContent(chapter.continuityState))
  const previousSummaries = buildPreviousSummaryRetrievalSummary(recentChapters, {
    signalText: chapterSignalText,
  })
  const entityProjection = resolveChapterEntityContextProjection(entityCatalogs, {
    mentionedCharacterNames: [...mentionedCharacterNames],
    mentionedItemNames,
    mentionedLocationNames: mergedMentionedLocationNames,
    mentionedFactionNames,
    relationFocusText: [
      currentChapter?.outline,
      currentArc?.arcSummary,
      currentArc?.arcGoal,
      previousSummaries,
    ].filter(Boolean).join('\n'),
    characterLimit: mentionedEntityLimits.characters,
    itemLimit: mentionedEntityLimits.items,
    locationLimit: mentionedEntityLimits.locations,
    factionLimit: factionMentionLimit,
    relationLimit: 8,
  })
  const projectedEntities = loadProjectedChapterEntityRows(novelId, entityProjection)
  const allCharacters = projectedEntities.characters
  const allItems = projectedEntities.items
  const allLocations = projectedEntities.locations
  const factionRows = projectedEntities.factions
  const relationRowsForContext = projectedEntities.relations
  const factionCatalog = createFactionCatalog(factionRows)
  const timelineContext = buildTimelineContext(
    novelId,
    chapterNum,
    currentArc?.id,
    entityCatalogs.characters,
    arcs,
    entityCatalogs.locations,
  )
  const storyMemoryRuntimePolicy = getOperatingModeRuntimePolicy({
    launchMode: novel.launchMode,
    targetWords,
    settingsJson: novel.settingsJson,
    chapterCount,
  })
  const storyMemoryPromptPackage = buildStoryMemoryPromptPackage(novelId, {
    chapterId: currentChapter?.id,
    refreshMode: storyMemoryRuntimePolicy.backgroundPrecomputeEnabled ? 'schedule_only' : 'sync',
  })
  const longTermMemory = storyMemoryPromptPackage.summary
  const threadContextLimit = Math.max(10, Math.min(32, mentionedEntityLimits.characters))
  const dueForeshadowLimit = Math.max(2, Math.ceil(threadContextLimit / 4))
  const threadProjection = loadChapterThreadContextProjection(getSqlite(), {
    novelId,
    chapterNum,
    dueLimit: dueForeshadowLimit,
    currentArc,
  })
  const projectedThreadRows = loadStoryThreadRowsByIds(novelId, [
    ...threadProjection.activeThreadIds,
    ...threadProjection.dueThreadIds,
    ...threadProjection.foreshadowLinkedThreadIds,
  ])
  const projectedThreadById = new Map(projectedThreadRows.map((row) => [row.id, row] as const))
  const activeThreadRows = threadProjection.activeThreadIds
    .flatMap((id) => projectedThreadById.get(id) || [])
  const dueThreadRows = threadProjection.dueThreadIds
    .flatMap((id) => projectedThreadById.get(id) || [])
  const foreshadowLinkedThreadRows = threadProjection.foreshadowLinkedThreadIds
    .flatMap((id) => projectedThreadById.get(id) || [])
  const foreshadowRows = listForeshadowLedgerByIds(novelId, [
    ...threadProjection.dueForeshadowIds,
    ...threadProjection.staleForeshadowIds,
  ])
  const itemSummary = buildItemSummary(
    allItems,
    characterNameById,
    locationNameById,
    Math.max(12, mentionedEntityLimits.items),
    mentionedItemNames,
  )
  const activeThreadsContext = buildActiveThreadsContextData(
    activeThreadRows,
    chapterNum,
    currentArc,
    threadContextLimit,
    threadProjection.pressureCount,
  )
  const chapterContract = contractContext?.chapterContract || null
  const chapterGoal = [
    chapterContract?.chapterGoal || '',
    extractChapterGoal(currentChapter?.outline),
  ].filter(Boolean).join('\n')
  const chapterContractRules = [
    chapterContract?.openingStyle ? `开场方式：${chapterContract.openingStyle}` : '',
    chapterContract?.endingStyle ? `收尾方式：${chapterContract.endingStyle}` : '',
    chapterContract?.expositionMode ? `说明方式：${chapterContract.expositionMode}` : '',
    chapterContract?.emotionFocus ? `情绪主基调：${chapterContract.emotionFocus}` : '',
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
    .map((item) => `合同伏笔：${compactRecallLine([
      item.title,
      item.detail || '',
      item.payoffSceneAction ? `动作=${item.payoffSceneAction}` : '',
      item.requiredEvidence ? `证据=${item.requiredEvidence}` : '',
      item.readerVisibleOutcome ? `结果=${item.readerVisibleOutcome}` : item.payoffMethod ? `回收=${item.payoffMethod}` : '',
      item.allowedDelayReason ? `延期=${item.allowedDelayReason}` : '',
    ].filter(Boolean).join(' · '), 120)}`)
  const sceneContractLines = buildSceneContractSummaryLines(contractContext?.sceneContracts || [])

  // 从当前章节任务相关文本里提取实体名，用于动态召回
  const outlineMentionedCharacterCount = collectMentionedEntityNamesFromCandidates(
    currentChapter?.outline || '',
    characterMentionCandidates,
    mentionedEntityLimits.characters,
  ).length

  const matchedCharacterRows = allCharacters.filter((character) =>
    character.fullName && mentionedCharacterNames.has(character.fullName))
  const glossaryContextSummary = buildGlossaryContextSummary(novelId, [
    currentChapter?.title || '',
    currentChapter?.outline || '',
    previousSummaries,
  ])
  const factionContextSummary = buildFactionContextSummary(
    factionCatalog,
    matchedCharacterRows,
    characterNameById,
    locationNameById,
    mentionedFactionNames,
  )
  const worldRulesContext = [
    profile.worldRulesSummary,
    glossaryContextSummary,
    factionContextSummary,
  ].filter(Boolean).join('\n\n')

  const relationSummary = buildStoryRelationSummary(
    novelId,
    allCharacters,
    [currentChapter?.outline, currentArc?.arcSummary, currentArc?.arcGoal, previousSummaries].filter(Boolean).join("\n"),
    8,
    relationRowsForContext,
  )
  const dialogueVoiceLocks = formatDialogueVoiceLocksSection(getChapterDialogueVoiceLocks(novelId, {
    chapterNum,
    chapterGoal,
    outline: currentChapter?.outline || '',
    scenePlan: currentChapter?.scenePlanJson || '',
    relationSummary,
    continuityNotes: collectContinuityNotes(continuityChapters),
    limit: 4,
  }))

  const chapterBridgePlan = currentChapter
    ? formatChapterBridgePlan(buildChapterBridgePlan(currentChapter.id, {
        themeVoice: parseThemeVoiceDocument(novel.themeVoiceJson),
        chapterGoal,
      }))
    : ''
  const worldStateSnapshot = getWorldStateContextSnapshot(novelId, {
    upToChapterNum: recentChapters[recentChapters.length - 1]?.chapterNum,
    limit: 12,
  })
  const globalLockContext = buildGlobalLockContext(novelId)
  const entityFreshnessMap = buildRecallEntityFreshnessMap(
    novelId,
    recentChapters[recentChapters.length - 1]?.chapterNum,
    worldStateSnapshot.currentStates,
  )

  const baseContext = buildBaseChapterContextParts({
    contextParts: {
      chapterGoal,
      storyCore: buildStoryCoreText(profile),
      writingContractSummary: [
        creativeStageContext?.promptSummary ? `当前创作阶段硬边界：\n${creativeStageContext.promptSummary}` : '',
        profile.writingContractSummary,
        chapterContractRules.length > 0 ? `章节合同：${chapterContractRules.join('；')}` : '',
        globalLockContext.canonFactSummary,
        globalLockContext.styleRuleSummary,
      ].filter(Boolean).join('\n'),
      currentArc: formatArcContext(currentArc),
      continuityNotes: [
        collectContinuityNotes(continuityChapters),
        creativeStageContext?.stage.handoffSummary ? `阶段交接：${creativeStageContext.stage.handoffSummary}` : '',
        ...chapterContractRules,
        ...sceneContractLines,
        globalLockContext.lockedParagraphSummary,
      ].filter(Boolean).join('\n'),
      previousChapterContext: previousChapterFeed.previousChapterContext,
      lastChapterEnding: previousChapterFeed.lastChapterEnding,
      chapterBridgePlan,
      openLoops: [
        collectOpenLoops(continuityChapters),
        ...promiseCommitmentLines,
      ].filter(Boolean).join('\n'),
      dueForeshadows: [
        buildDueForeshadowContext(
          dueThreadRows,
          foreshadowLinkedThreadRows,
          foreshadowRows,
          chapterNum,
          currentArc,
          dueForeshadowLimit,
        ),
        ...payoffCommitmentLines,
        ...requiredForeshadowLines,
      ].filter(Boolean).join('\n'),
      timelineOpenThreads: timelineContext.timelineOpenThreads,
      worldRules: worldRulesContext,
      mapSummary: buildMapContextSummary(allLocations, mergedMentionedLocationNames, mentionedEntityLimits.locations),
      itemSummary,
      longTermMemory,
      characterStates: buildCharacterStates(
        allCharacters,
        recentChapters,
        mentionedCharacterNames,
        relationRowsForContext,
      ),
      worldStates: worldStateSnapshot.worldStatesText,
      continuitySummary: buildContinuityRetrievalSummary(continuityChapters, {
        signalText: chapterSignalText,
        mentionedCharacters: [...mentionedCharacterNames],
        mentionedItems: mentionedItemNames,
        mentionedLocations: mergedMentionedLocationNames,
        mentionedFactions: mentionedFactionNames,
      }),
      timelineSummary: timelineContext.timelineSummary,
      relationSummary,
      dialogueVoiceLocks: [
        dialogueVoiceLocks,
        globalLockContext.characterVoiceSummary,
      ].filter(Boolean).join('\n'),
      activeThreads: activeThreadsContext.summary,
      styleTemplate: enrichStyleTemplateWithFingerprint(profile.styleTemplateSummary, novelId),
      previousSummaries,
      scenePlanSummary: '',
      draftTextSummary: '',
      contractVersionSummary: '',
      reviewRiskSummary: '',
      reviewProofSummary: '',
      rewriteDeltaSummary: '',
      publishGateRiskSummary: '',
      stepMemorySummary: '',
    },
    previousChapterSampleReport: previousChapterFeed.previousChapterSampleReport,
  })

  const recallAugmentation = await runRecallAugmentation({
    novelId,
    chapterNum,
    modelConfigId: novel.modelConfigId,
    entityFreshnessMap,
    constraintText: [
      baseContext.contextParts.characterStates,
      baseContext.contextParts.worldStates,
      relationSummary,
      itemSummary,
      baseContext.contextParts.openLoops,
      baseContext.contextParts.dueForeshadows,
      baseContext.contextParts.continuityNotes,
      baseContext.contextParts.chapterBridgePlan,
    ].filter(Boolean).join('\n'),
    chapterGoal,
    outline: currentChapter?.outline || '',
    arcGoal: currentArc?.arcGoal || '',
    arcSummary: currentArc?.arcSummary || '',
    storyGoal: profile.storyGoal,
    coreConflict: profile.coreConflict,
    mainPlot: profile.mainPlot,
    themeVoiceSummary: profile.themeVoiceSummary,
    worldRules: baseContext.contextParts.worldRules,
    mapSummary: baseContext.contextParts.mapSummary,
    relationSummary,
    characterStates: baseContext.contextParts.characterStates,
    worldStates: baseContext.contextParts.worldStates,
    itemSummary,
    timelineSummary: timelineContext.timelineSummary,
    timelineOpenThreads: timelineContext.timelineOpenThreads,
    activeThreads: activeThreadsContext.summary,
    openLoops: baseContext.contextParts.openLoops,
    dueForeshadows: baseContext.contextParts.dueForeshadows,
    continuityNotes: baseContext.contextParts.continuityNotes,
    chapterBridgePlan: baseContext.contextParts.chapterBridgePlan,
    storyThreadsSummary: profile.storyThreadsSummary,
    mentionedCharacters: [...mentionedCharacterNames],
    mentionedItems: mentionedItemNames,
    mentionedLocations: mergedMentionedLocationNames,
    mentionedFactions: mentionedFactionNames,
    mentionValidationCharacters,
    mentionValidationItems,
    mentionValidationLocations,
    mentionValidationFactions,
  })

  return {
    novel,
    profile,
    chapterRows,
    currentChapter,
    currentArc,
    outlineMentionedCharacterCount,
    activeThreadPressureCount: activeThreadsContext.pressureCount,
    mentionedCharacters: [...mentionedCharacterNames],
    mentionedItems: mentionedItemNames,
    mentionedLocations: mergedMentionedLocationNames,
    mentionedFactions: mentionedFactionNames,
    contextParts: {
      ...baseContext.contextParts,
      recalledMemory: recallAugmentation.recalledMemory,
    },
    previousChapterSampleReport: baseContext.previousChapterSampleReport,
    recallSnapshot: recallAugmentation.recallSnapshot,
    recallDiagnostics: recallAugmentation.recallDiagnostics,
    recalledMemorySources: recallAugmentation.recalledMemorySources,
    creativeStageContext: creativeStageContext || undefined,
  }
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
  const rawModelContextLimit = modelRuntimeBudget.maxContextTokens && modelRuntimeBudget.maxContextTokens > 0
    ? modelRuntimeBudget.maxContextTokens
    : 32000
  const tokenSafetyMarginPct = modelRuntimeBudget.tokenSafetyMarginPct || 0
  const safeModelContextLimit = Math.max(
    2048,
    Math.floor(rawModelContextLimit * (1 - tokenSafetyMarginPct / 100)),
  )
  const modelContextLimit = rawModelContextLimit
  const desiredBudget = resolveChapterBudgetFloor(targetWords, requestedBudget)
  const effectiveBudget = Math.min(safeModelContextLimit, desiredBudget)
  const promptFixedOverhead = resolvePromptFixedOverhead(promptProfile, chapterComplexity, targetWords)
  const requestedOutputReserve = resolvePromptOutputReserve(promptProfile, chapterComplexity, targetWords)
  const configuredOutputLimit = modelRuntimeBudget.maxTokens && modelRuntimeBudget.maxTokens > 0
    ? modelRuntimeBudget.maxTokens
    : requestedOutputReserve
  // Adapter 的 maxTokens 是本次请求真实可能占用的输出上限。即使调用方
  // 请求的上下文预算尚未碰到模型窗口，也必须预留两者较大值；否则长篇
  // 模式抬高 effectiveBudget 后可能出现 prompt + output 超过模型窗口。
  const reservedForOutput = Math.max(0, Math.min(
    Math.max(requestedOutputReserve, configuredOutputLimit),
    Math.max(0, effectiveBudget - promptFixedOverhead),
  ))
  const remainingContextBudget = effectiveBudget - promptFixedOverhead - reservedForOutput
  const contextBudget = Math.max(0, remainingContextBudget)
  const priorityMap = createStagePriorityMap(promptProfile, chapterComplexity, targetWords, rawData.chapterCount || rawData.chapterRows.length)
  const preservedConstraintSet = buildPreservedConstraintSet(normalizedOptions.preserveConstraintLabels)
  const hardConstraintDrafts = buildHardConstraintDrafts(rawData, preservedConstraintSet)
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
  const contextPartLabels = new Set<string>(Object.keys(rawData.contextParts))
  const hardCoveredSoftLabels = new Set<ChapterContextLabel>(
    hardConstraintAllocation.entries
      .map((entry) => entry.label)
      .filter((label) => contextPartLabels.has(label))
      .map((label) => label as ChapterContextLabel),
  )

  const partDefinitions = (Object.keys(rawData.contextParts) as ChapterContextLabel[]).map((label) => ({
    label,
    content: rawData.contextParts[label],
  }))

  const parts = partDefinitions.reduce<ContextPart[]>((result, part) => {
    if (SOFT_CONTEXT_EXCLUDED_LABELS.has(part.label) || hardCoveredSoftLabels.has(part.label)) return result
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
  const droppedConstraintCount = hardConstraintAllocation.dropped.length
  const hardOverflowLabels = hardConstraintAllocation.dropped.map((draft) => draft.label)
  const preservedConstraintLabels = hardConstraintAllocation.entries
    .map((entry) => entry.label)
    .filter((label) => preservedConstraintSet.has(label))
  // P0 软上下文被截断属于可降级情况（分配器已按比例压缩注入）；只有整章无法注入
  // 最小核心（章节目标/桥接）或硬约束整段丢弃，才值得中断生成让用户拆章。
  const criticalP0Starved = softAllocation.warnings.some((warning) =>
    warning.priority === 0
    && CRITICAL_SOFT_CONTEXT_LABELS.has(warning.label)
    && warning.allocatedTokens < Math.min(CRITICAL_SOFT_CONTEXT_MIN_TOKENS, warning.originalTokens))
  const hardConstraintFailed = droppedConstraintCount > 0 || criticalP0Starved
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
    preservedLabels: preservedConstraintLabels,
    droppedLabels: hardOverflowLabels,
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
    .filter((entry) => hardCoveredSoftLabels.has(entry.label as ChapterContextLabel))
    .map((entry) => ({
      label: entry.label,
      title: entry.title,
      priority: 'hard',
      originalTokens: entry.originalTokens,
      allocatedTokens: entry.allocatedTokens,
      status: entry.truncated ? 'truncated' : 'kept',
      reason: 'covered_by_hard_constraint',
      sourceKind: resolveContextSourceKind(entry.label),
    }))
  const softContextDecisions = [...hardCoveredDecisions, ...softAllocation.decisions]
  const hardConstraintSummary = buildHardConstraintSummary(
    hardConstraintAllocation.entries,
    hardConstraintAllocation.dropped,
    preservedConstraintSet,
  )
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
    safeModelContextLimit,
    modelProvider: modelRuntimeBudget.provider,
    tokenSafetyMarginPct,
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
    preservedConstraintLabels,
    droppedConstraintLabels: hardOverflowLabels,
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
    mapSummary: softAllocation.allocated.mapSummary || '',
    itemSummary: softAllocation.allocated.itemSummary || '',
    previousSummaries: softAllocation.allocated.previousSummaries || '',
    previousChapterContext: softAllocation.allocated.previousChapterContext || '',
    lastChapterEnding: softAllocation.allocated.lastChapterEnding || '',
    chapterBridgePlan: softAllocation.allocated.chapterBridgePlan || '',
    styleTemplate: softAllocation.allocated.styleTemplate || '',
    chapterGoal: softAllocation.allocated.chapterGoal
      || hardConstraintAllocation.entries.find((entry) => entry.label === 'chapterGoal')?.content
      || '',
    continuitySummary: softAllocation.allocated.continuitySummary || '',
    openLoops: softAllocation.allocated.openLoops || '',
    dueForeshadows: softAllocation.allocated.dueForeshadows || '',
    continuityNotes: softAllocation.allocated.continuityNotes || '',
    timelineSummary: softAllocation.allocated.timelineSummary || '',
    timelineOpenThreads: softAllocation.allocated.timelineOpenThreads || '',
    longTermMemory: softAllocation.allocated.longTermMemory || '',
    activeThreads: softAllocation.allocated.activeThreads || '',
    // 写作合同同时承担“软上下文摘要”和“硬约束注入”两条路径。
    // 当分配器判定它已被硬约束覆盖时，softAllocation 不会再分配该字段；
    // 此时必须保留章节级 contextParts（其中包含阶段/章节合同），不能只回退到 profile。
    writingContractSummary: softAllocation.allocated.writingContractSummary
      || hardConstraintAllocation.entries.find((entry) => entry.label === 'writingContractSummary')?.content
      || '',
    relationSummary: softAllocation.allocated.relationSummary
      || hardConstraintAllocation.entries.find((entry) => entry.label === 'relationSummary')?.content
      || '',
    dialogueVoiceLocks: softAllocation.allocated.dialogueVoiceLocks || '',
    recalledMemory: softAllocation.allocated.recalledMemory || '',
    scenePlanSummary: softAllocation.allocated.scenePlanSummary || '',
    draftTextSummary: softAllocation.allocated.draftTextSummary || '',
    contractVersionSummary: softAllocation.allocated.contractVersionSummary || '',
    reviewRiskSummary: softAllocation.allocated.reviewRiskSummary || '',
    reviewProofSummary: softAllocation.allocated.reviewProofSummary || '',
    rewriteDeltaSummary: softAllocation.allocated.rewriteDeltaSummary || '',
    publishGateRiskSummary: softAllocation.allocated.publishGateRiskSummary || '',
    stepMemorySummary: softAllocation.allocated.stepMemorySummary || '',
    hardConstraintContext: hardConstraintAllocation.text,
    hardConstraintSummary,
    hardConstraintEntries: hardConstraintAllocation.entries,
    constraintInjectionStatus,
    softContextBudgetUsage,
    contextBudgetReport,
    droppedConstraintCount,
    previousChapterSampleReport: rawData.previousChapterSampleReport,
    softContextDecisions,
    recallSnapshot: finalizeRecallSnapshot(rawData.recallSnapshot, softAllocation.allocated.recalledMemory || ''),
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

export function buildWritingContextUsageSnapshot(
  rawData: ChapterContextRawData,
  context: ChapterContext,
  linkedImpacts: AssetChangeImpact[] = [],
): WritingContextUsageSnapshot {
  const usedAssets = [...new Set([
    context.characterStates ? '人物状态与角色设定' : '',
    context.worldStates ? '世界状态总账' : '',
    context.itemSummary ? '关键物品账本' : '',
    context.timelineSummary ? '时间轴锚点' : '',
    context.activeThreads ? '活跃线程' : '',
    context.dueForeshadows ? '伏笔与到期回收' : '',
    context.chapterBridgePlan ? '章节衔接桥' : '',
    context.stepMemorySummary ? '步骤接力记忆' : '',
    ...rawData.recalledMemorySources
      .filter((item) => isAcceptedRecallSource(item))
      .slice(0, 4)
      .map((item) => item.sourceLabel),
  ].filter(Boolean))]

  const usedContracts = [...new Set([
    ...context.hardConstraintEntries.map((entry) => entry.title),
    context.writingContractSummary ? '写作合同摘要' : '',
    context.dialogueVoiceLocks ? '角色对白锁' : '',
  ].filter(Boolean))]

  const ignoredConstraints = [...new Set([
    ...context.hardConstraintEntries
      .filter((entry) => entry.truncated)
      .map((entry) => `${entry.title} 已压缩`),
    ...context.contextBudgetReport.droppedLabels.map((label) => `${label} 已被裁剪`),
    ...context.softContextDecisions
      .filter((entry) => entry.status !== 'kept')
      .map((entry) => `${entry.title}：${entry.status === 'dropped' ? '已忽略' : '已压缩'}`),
  ])].slice(0, 8)

  const recentStateChanges = [...new Set([
    ...splitContextLines(rawData.contextParts.continuitySummary, 4),
    ...splitContextLines(rawData.contextParts.continuityNotes, 3),
    ...splitContextLines(rawData.contextParts.chapterBridgePlan, 3),
    ...splitContextLines(rawData.contextParts.stepMemorySummary, 3),
    ...splitContextLines(rawData.contextParts.worldStates, 2),
  ])].slice(0, 8)

  return {
    usedAssets,
    usedContracts,
    ignoredConstraints,
    recentStateChanges,
    linkedImpacts: linkedImpacts.slice(0, 6),
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
