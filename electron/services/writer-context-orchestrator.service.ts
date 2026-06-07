import { createHash } from 'node:crypto'
import type {
  StoryItem,
  StoryItemDetailContext,
  TimelineEvent,
  WriterContextAllocatorInputBucketSummary,
  WriterContextAllocatorInputSummary,
  WriterContextFallbackEvent,
  WriterContextOrchestratorInput,
  WriterContextOrchestratorResolution,
  WriterContextQueryBucket,
  WriterContextQueryPlanStep,
  WriterContextRenderedOverrides,
  WriterContextRetrievalFingerprint,
  WriterContextToolCall,
  WriterContextToolTarget,
  WriterOrchestratedCharacterPackEntry,
  WriterOrchestratedItemPackEntry,
  WriterOrchestratedMapLocationPackEntry,
  WriterOrchestratedRecallHit,
  WriterOrchestratedSourceGroundingPack,
  WriterOrchestratedStoryMemoryPack,
  WriterOrchestratedThreadPack,
  WriterOrchestratedTimelinePackEntry,
  WriterOrchestratedWorldStatePack,
} from '../../src/types'
import { assessHistoricalGrounding } from '../../src/shared/genre-system'
import { getCharacterDetailContext, listCharacters } from './character.service'
import type { CharacterStateSummary as ServiceCharacterStateSummary } from './character-state.service'
import { searchSimilarFragments } from './embedding.service'
import { getStoryItemDetailContext, listStoryItems } from './item.service'
import { getMapNode, getMapRelations, searchMapNodes } from './map.service'
import { buildStoryMemorySnapshot } from './story-memory.service'
import { getForeshadowSnapshot, listStoryThreads } from './story-thread.service'
import { listTimelineEvents } from './timeline.service'
import { getWorldStateContextSnapshot, type WorldStateContextSnapshot } from './world-state.service'

type ServiceOverrides = {
  listCharacters?: typeof listCharacters
  getCharacterDetailContext?: typeof getCharacterDetailContext
  listStoryItems?: typeof listStoryItems
  getStoryItemDetailContext?: typeof getStoryItemDetailContext
  searchMapNodes?: typeof searchMapNodes
  getMapNode?: typeof getMapNode
  getMapRelations?: typeof getMapRelations
  buildStoryMemorySnapshot?: typeof buildStoryMemorySnapshot
  listStoryThreads?: typeof listStoryThreads
  getForeshadowSnapshot?: typeof getForeshadowSnapshot
  listTimelineEvents?: typeof listTimelineEvents
  getWorldStateContextSnapshot?: typeof getWorldStateContextSnapshot
  searchSimilarFragments?: typeof searchSimilarFragments
}

type ServiceBundle = Required<ServiceOverrides>
type StoryMemorySnapshot = ReturnType<ServiceBundle['buildStoryMemorySnapshot']>

interface MemoryCacheEntry {
  value: WriterContextOrchestratorResolution
  createdAt: number
}

interface WriterToolAccumulator {
  storyMemoryPack?: WriterOrchestratedStoryMemoryPack
  sourceGroundingPack?: WriterOrchestratedSourceGroundingPack
  characterEntries: WriterOrchestratedCharacterPackEntry[]
  itemEntries: WriterOrchestratedItemPackEntry[]
  mapLocationEntries: WriterOrchestratedMapLocationPackEntry[]
  timelineEntries: WriterOrchestratedTimelinePackEntry[]
  worldStatePack?: WriterOrchestratedWorldStatePack
  threadPack?: WriterOrchestratedThreadPack
  recallHits: WriterOrchestratedRecallHit[]
}

interface WriterToolRuntimeLimits {
  maxCharacters: number
  maxItems: number
  maxMapLocations: number
  maxTimelineEvents: number
  maxThreads: number
  maxRecallHits: number
}

interface WriterToolExecutionContext {
  input: WriterContextOrchestratorInput
  services: ServiceBundle
  runtimeLimits: WriterToolRuntimeLimits
  getStoryMemorySnapshot: () => StoryMemorySnapshot
  getCharacterStateByName: () => Map<string, ServiceCharacterStateSummary>
}

interface WriterToolExecutionResult {
  status: WriterContextToolCall['status']
  resultCount?: number
  errorMessage?: string
  fallbackEvent?: WriterContextFallbackEvent
}

interface RegisteredWriterTool {
  bucket: WriterContextQueryBucket
  toolName: string
  execute: (
    step: WriterContextQueryPlanStep,
    context: WriterToolExecutionContext,
    accumulator: WriterToolAccumulator,
  ) => Promise<WriterToolExecutionResult> | WriterToolExecutionResult
}

const memoryCache = new Map<string, MemoryCacheEntry>()
const MEMORY_CACHE_TTL_MS = 30_000
const MEMORY_CACHE_MAX = 64

function now() {
  return Date.now()
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupe(values: string[], limit?: number): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
    if (limit && result.length >= limit) break
  }
  return result
}

function hashOf(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex')
}

function summarizeText(value: string, maxChars = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars - 3).trim()}...`
}

function compactLines(lines: string[], maxLines = 6, maxChars = 820): string {
  const joined = dedupe(lines, maxLines).join('\n')
  if (joined.length <= maxChars) return joined
  return `${joined.slice(0, maxChars - 3).trim()}...`
}

function mergePreservingBase(baseValue: string | undefined, retrievedValue: string | undefined, maxLines = 8, maxChars = 760): string | undefined {
  if (!retrievedValue) return baseValue
  if (!baseValue) return retrievedValue
  return compactLines([baseValue, retrievedValue], maxLines, maxChars)
}

function resolveCharacterRoleRank(roleType?: string | null): number {
  switch (roleType) {
    case 'protagonist':
      return 0
    case 'major':
      return 1
    case 'antagonist':
      return 2
    case 'supporting':
      return 3
    case 'minor':
    default:
      return 4
  }
}

function sortCharactersForWriterPack<T extends { roleType?: string | null; fullName?: string | null; sortOrder?: number | null; id?: number }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const roleDelta = resolveCharacterRoleRank(left.roleType) - resolveCharacterRoleRank(right.roleType)
    if (roleDelta !== 0) return roleDelta
    const sortDelta = Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
    if (sortDelta !== 0) return sortDelta
    return String(left.fullName || '').localeCompare(String(right.fullName || '')) || Number(left.id || 0) - Number(right.id || 0)
  })
}

function extractTerms(values: Array<string | undefined>, limit = 8): string[] {
  return dedupe(values.flatMap((value) => (
    (value || '')
      .split(/[\n,，、；;。]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )), limit)
}

function buildSignalSearchText(values: Array<string | undefined>): string {
  return values.map((value) => value || '').filter(Boolean).join('\n')
}

function expandMatchTerms(terms: string[]): string[] {
  return dedupe(terms.flatMap((rawTerm) => {
    const term = rawTerm.trim()
    if (term.length < 2) return []
    const variants = [term]
    const chineseChunks = term.match(/[\u4e00-\u9fff]{2,}/gu) || []
    chineseChunks.forEach((chunk) => {
      if (chunk.length >= 3) variants.push(chunk.slice(-3))
      if (chunk.length >= 4) variants.push(chunk.slice(-4))
    })
    return variants
  }), 24)
}

function matchesAnyTerm(haystack: string, terms: string[]): boolean {
  const normalized = haystack.trim()
  if (!normalized) return false
  return expandMatchTerms(terms)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .some((term) => normalized.includes(term))
}

function parseJsonArrayText(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function parseJsonRecord(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
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

function collectJsonTextLeaves(value: unknown, depth = 0): string[] {
  if (depth >= 3) return []
  if (typeof value === 'string') {
    const text = value.trim()
    return text ? [text] : []
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => collectJsonTextLeaves(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectJsonTextLeaves(item, depth + 1))
  }
  return []
}

function renderJsonValueSummary(value: unknown, maxChars = 72): string {
  const text = collectJsonTextLeaves(value).join('；')
  return text ? summarizeText(text, maxChars) : ''
}

function collectAliasText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectAliasText(item))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return [
      ...['alias', 'aliases', 'name', 'displayName', 'entityName', 'refName', 'aliasNames', 'nicknames', 'titles', 'codenames', 'mentionNames', 'addressTerms', 'relationTerms', '别名', '称号', '代号', '称谓']
        .flatMap((key) => collectAliasText(record[key])),
      ...['pointers', 'refs', 'references', 'entities', 'items'].flatMap((key) => collectAliasText(record[key])),
    ]
  }
  const text = asText(value)
  if (!text) return []
  return text.split(/[\n,，、;；/|]+/u).map((item) => item.trim()).filter((item) => item.length >= 2)
}

function parseAliasTextFromJson(raw?: string | null): string[] {
  if (!raw) return []
  try {
    return dedupe(collectAliasText(JSON.parse(raw) as unknown), 16)
  } catch {
    return []
  }
}

function computeSignalHash(input: WriterContextOrchestratorInput): string {
  return hashOf({
    signals: input.signals,
    baseContextParts: input.baseContextParts || {},
  }).slice(0, 16)
}

function buildQueryStep(
  bucket: WriterContextQueryBucket,
  enabled: boolean,
  reason: string,
  terms: string[],
  serviceCalls: string[],
  queryText?: string,
  resultLimit?: number,
): WriterContextQueryPlanStep {
  return {
    bucket,
    enabled,
    reason,
    terms,
    serviceCalls,
    queryText,
    resultLimit,
  }
}

function buildWriterQueryPlan(input: WriterContextOrchestratorInput): WriterContextQueryPlanStep[] {
  const signals = input.signals
  const mentionedCharacters = dedupe(signals.mentionedCharacters || [], Math.max(8, input.runtime?.maxCharacters || 8))
  const mentionedItems = dedupe(signals.mentionedItems || [], Math.max(8, input.runtime?.maxItems || 8))
  const mentionedLocations = dedupe(signals.mentionedLocations || [], Math.max(8, input.runtime?.maxMapLocations || input.runtime?.maxTimelineEvents || 8))
  const mentionedFactions = dedupe(signals.mentionedFactions || [], 12)
  const chapterGoal = asText(signals.chapterGoal)
  const relationSummary = asText(signals.relationSummary)
  const activeThreads = asText(signals.activeThreads)
  const openLoops = asText(signals.openLoops)
  const dueForeshadows = asText(signals.dueForeshadows)
  const chapterBridgePlan = asText(signals.chapterBridgePlan)
  const stepMemorySummary = asText(signals.stepMemorySummary || input.baseContextParts?.stepMemorySummary)
  const worldStates = asText(signals.worldStates)
  const timelineSummary = asText(signals.timelineSummary)
  const timelineOpenThreads = asText(signals.timelineOpenThreads)
  const genre = asText(signals.genre)
  const worldRules = asText(signals.worldRules || input.baseContextParts?.worldRules)
  const sourceText = [
    signals.historicalProfileJson,
    signals.projectCanonProfileJson,
    signals.canonConstraintSetJson,
    signals.sourceLedgerJson,
    signals.canonSourceLedgerJson,
    signals.canonFactCardsJson,
  ].map(asText).filter(Boolean).join('\n')

  const storyMemoryEnabled = Boolean(
    chapterGoal
    || activeThreads
    || openLoops
    || dueForeshadows
    || chapterBridgePlan
    || stepMemorySummary
    || timelineSummary
    || timelineOpenThreads,
  )
  const characterEnabled = mentionedCharacters.length > 0 || Boolean(relationSummary)
  const itemEnabled = mentionedItems.length > 0
  const mapLocationEnabled = mentionedLocations.length > 0
  const worldStateTerms = dedupe([
    ...mentionedCharacters,
    ...mentionedItems,
    ...mentionedLocations,
    ...mentionedFactions,
    ...extractTerms([worldStates], 4),
  ], 12)
  const worldStateEnabled = worldStateTerms.length > 0
  const timelineEnabled = mentionedLocations.length > 0 || /\S/.test(timelineSummary)
  const threadEnabled = Boolean(activeThreads || openLoops || dueForeshadows || chapterBridgePlan || stepMemorySummary)
  const recallCharacterEnabled = mentionedCharacters.length > 0 || mentionedFactions.length > 0
  const recallRuleEnabled = Boolean(worldStates || timelineSummary || mentionedFactions.length > 0)
  const recallThreadEnabled = Boolean(activeThreads || openLoops || dueForeshadows || chapterBridgePlan || stepMemorySummary)
  const groundingAssessment = assessHistoricalGrounding({
    genreName: genre,
    worldRulesJson: worldRules,
    backgroundText: signals.backgroundText,
    glossaryTerms: signals.glossaryTerms,
    historicalProfileJson: signals.historicalProfileJson,
    projectCanonProfileJson: signals.projectCanonProfileJson,
    canonConstraintSetJson: signals.canonConstraintSetJson,
    sourceLedgerJson: signals.sourceLedgerJson,
    canonSourceLedgerJson: signals.canonSourceLedgerJson,
    canonFactCardsJson: signals.canonFactCardsJson,
  })
  const sourceGroundingEnabled = groundingAssessment.mode !== 'none' || sourceText.length > 0

  return [
    buildQueryStep(
      'story_memory',
      storyMemoryEnabled,
      storyMemoryEnabled ? '当前章节存在承接或全局记忆需求。' : '当前章节不需要额外长程记忆包。',
      extractTerms([chapterGoal, activeThreads, openLoops, dueForeshadows, chapterBridgePlan, stepMemorySummary], 6),
      ['story_memory.get_pack'],
    ),
    buildQueryStep(
      'source_grounding',
      sourceGroundingEnabled,
      sourceGroundingEnabled
        ? '当前题材或项目来源账本需要来源 grounding 约束。'
        : '没有真实历史或来源账本信号。',
      dedupe([
        genre,
        ...extractTerms([worldRules, signals.backgroundText], 8),
        ...(signals.glossaryTerms || []),
      ], 12),
      ['source_grounding.get_pack'],
      [genre, chapterGoal, worldRules, signals.backgroundText, sourceText].filter(Boolean).join('\n'),
      6,
    ),
    buildQueryStep(
      'character',
      characterEnabled,
      characterEnabled ? '人物信号明确，需要定向人物包。' : '没有显著人物信号。',
      mentionedCharacters,
      ['character.get_pack'],
      mentionedCharacters.join('、'),
      input.runtime?.maxCharacters || 6,
    ),
    buildQueryStep(
      'item',
      itemEnabled,
      itemEnabled ? '道具信号明确，需要定向道具包。' : '没有显著道具信号。',
      mentionedItems,
      ['item.get_pack'],
      mentionedItems.join('、'),
      input.runtime?.maxItems || 4,
    ),
    buildQueryStep(
      'map_location',
      mapLocationEnabled,
      mapLocationEnabled ? '地点信号明确，需要地图节点包。' : '没有显著地图地点信号。',
      mentionedLocations,
      ['map.get_pack'],
      mentionedLocations.join('、'),
      input.runtime?.maxMapLocations || input.runtime?.maxTimelineEvents || 4,
    ),
    buildQueryStep(
      'timeline',
      timelineEnabled,
      timelineEnabled ? '存在地点/时间轴信号，需要时间线切片。' : '没有显著时间线信号。',
      dedupe([...mentionedLocations, ...extractTerms([timelineSummary, timelineOpenThreads], 4)], 6),
      ['timeline.get_pack'],
      mentionedLocations.join('、') || timelineSummary || timelineOpenThreads,
      input.runtime?.maxTimelineEvents || 4,
    ),
    buildQueryStep(
      'world_state',
      worldStateEnabled,
      worldStateEnabled ? '存在人物、物品、地点、势力或世界状态信号，需要世界状态切片。' : '没有显著世界状态信号。',
      worldStateTerms,
      ['world_state.get_pack'],
      worldStateTerms.join('、') || worldStates,
      4,
    ),
    buildQueryStep(
      'thread',
      threadEnabled,
      threadEnabled ? '存在活跃线程、开放问题或待回收伏笔。' : '没有显著线程压力。',
      extractTerms([activeThreads, openLoops, dueForeshadows, chapterBridgePlan, stepMemorySummary], 8),
      ['thread.get_pack'],
      [chapterBridgePlan, stepMemorySummary, activeThreads, openLoops, dueForeshadows].filter(Boolean).join('\n'),
      input.runtime?.maxThreads || 4,
    ),
    buildQueryStep(
      'recall_character',
      recallCharacterEnabled,
      recallCharacterEnabled ? '需要补充人物相关历史片段。' : '没有人物召回需求。',
      dedupe([...mentionedCharacters, ...mentionedFactions], 12),
      ['recall.search_fragments'],
      [chapterGoal, relationSummary, ...mentionedCharacters, ...mentionedFactions].filter(Boolean).join('\n'),
      input.runtime?.maxRecallHitsPerBucket || 3,
    ),
    buildQueryStep(
      'recall_rule',
      recallRuleEnabled,
      recallRuleEnabled ? '需要补充规则/状态相关历史片段。' : '没有规则召回需求。',
      dedupe([...mentionedFactions, ...extractTerms([worldStates, timelineSummary], 6)], 12),
      ['recall.search_fragments'],
      [chapterGoal, worldStates, timelineSummary, ...mentionedFactions].filter(Boolean).join('\n'),
      input.runtime?.maxRecallHitsPerBucket || 3,
    ),
    buildQueryStep(
      'recall_thread',
      recallThreadEnabled,
      recallThreadEnabled ? '需要补充线程/伏笔相关历史片段。' : '没有线程召回需求。',
      extractTerms([activeThreads, openLoops, dueForeshadows, chapterBridgePlan, stepMemorySummary], 6),
      ['recall.search_fragments'],
      [chapterGoal, chapterBridgePlan, stepMemorySummary, activeThreads, openLoops, dueForeshadows].filter(Boolean).join('\n'),
      input.runtime?.maxRecallHitsPerBucket || 3,
    ),
  ]
}

function buildRetrievalFingerprint(
  input: WriterContextOrchestratorInput,
  plan: WriterContextQueryPlanStep[],
): WriterContextRetrievalFingerprint {
  const enabledBuckets = plan.filter((step) => step.enabled).map((step) => step.bucket)
  const signalHash = computeSignalHash(input)
  const planHash = hashOf(plan.map((step) => ({
    bucket: step.bucket,
    enabled: step.enabled,
    terms: step.terms,
    queryText: step.queryText,
    resultLimit: step.resultLimit,
  }))).slice(0, 16)
  const invalidationHash = hashOf(input.invalidation || {}).slice(0, 16)
  const inputs = {
    novelId: input.novelId,
    chapterId: input.chapterId,
    chapterNum: input.chapterNum,
    chapterContextVersion: input.invalidation?.chapterContextVersion,
    novelContextVersion: input.invalidation?.novelContextVersion,
    assetFingerprint: input.invalidation?.assetFingerprint,
    cacheSalt: input.invalidation?.cacheSalt,
    stage: input.invalidation?.stage,
    executionMode: input.invalidation?.executionMode,
    preserveConstraintLabels: input.invalidation?.preserveConstraintLabels || [],
    mentionedCharacterCount: (input.signals.mentionedCharacters || []).length,
    mentionedItemCount: (input.signals.mentionedItems || []).length,
    mentionedLocationCount: (input.signals.mentionedLocations || []).length,
    mentionedFactionCount: (input.signals.mentionedFactions || []).length,
    enabledBuckets,
  }
  const digest = hashOf({
    signalHash,
    planHash,
    invalidationHash,
    inputs,
  })
  return {
    digest,
    cacheKey: `writer-orchestrator:${digest}`,
    signalHash,
    planHash,
    invalidationHash,
    inputs,
  }
}

function makeToolCall(
  target: WriterContextToolTarget,
  toolName: string,
  startedAt: number,
  status: WriterContextToolCall['status'],
  extras: Partial<WriterContextToolCall> = {},
): WriterContextToolCall {
  return {
    target,
    toolName,
    status,
    durationMs: Math.max(0, now() - startedAt),
    ...extras,
  }
}

function makeFallbackEvent(
  target: WriterContextToolTarget,
  reason: WriterContextFallbackEvent['reason'],
  detail: string,
  fallbackMode: WriterContextFallbackEvent['fallbackMode'],
): WriterContextFallbackEvent {
  return {
    target,
    reason,
    detail,
    fallbackMode,
  }
}

function renderStoryMemoryPack(snapshot: ReturnType<typeof buildStoryMemorySnapshot>): WriterOrchestratedStoryMemoryPack {
  return {
    generatedAt: snapshot.generatedAt,
    coverageSummary: snapshot.coverageSummary,
    phaseDigest: snapshot.phaseDigest.slice(0, 4),
    plotMilestones: snapshot.plotMilestones.slice(0, 6),
    activeThreads: snapshot.activeThreads.slice(0, 6),
    continuityDirectives: snapshot.continuityDirectives.slice(0, 6),
    timelineAnchors: snapshot.timelineAnchors.slice(0, 6),
    itemLedger: snapshot.itemLedger.slice(0, 6),
  }
}

function renderSourceGroundingPack(signals: WriterContextOrchestratorInput['signals']): WriterOrchestratedSourceGroundingPack {
  const assessment = assessHistoricalGrounding({
    genreName: signals.genre,
    worldRulesJson: signals.worldRules,
    backgroundText: signals.backgroundText,
    glossaryTerms: signals.glossaryTerms,
    historicalProfileJson: signals.historicalProfileJson,
    projectCanonProfileJson: signals.projectCanonProfileJson,
    canonConstraintSetJson: signals.canonConstraintSetJson,
    sourceLedgerJson: signals.sourceLedgerJson,
    canonSourceLedgerJson: signals.canonSourceLedgerJson,
    canonFactCardsJson: signals.canonFactCardsJson,
  })
  const historicalProfile = parseJsonRecord(signals.historicalProfileJson)
  const projectCanonProfile = parseJsonRecord(signals.projectCanonProfileJson)
  const canonConstraintSet = parseJsonRecord(signals.canonConstraintSetJson)
  const sourceLedgerEntries = [
    ...parseJsonRecordArray(signals.sourceLedgerJson),
    ...parseJsonRecordArray(signals.canonSourceLedgerJson),
  ]
  const canonFactCards = parseJsonRecordArray(signals.canonFactCardsJson)

  const profileLines = [
    historicalProfile.mode ? `历史模式：${renderJsonValueSummary(historicalProfile.mode, 40)}` : '',
    historicalProfile.eraPackId ? `时代包：${renderJsonValueSummary(historicalProfile.eraPackId, 40)}` : '',
    historicalProfile.regionPackId ? `地域包：${renderJsonValueSummary(historicalProfile.regionPackId, 40)}` : '',
    projectCanonProfile.worldType ? `世界类型：${renderJsonValueSummary(projectCanonProfile.worldType, 48)}` : '',
    projectCanonProfile.technologyCeiling ? `技术上限：${renderJsonValueSummary(projectCanonProfile.technologyCeiling, 64)}` : '',
    projectCanonProfile.supernaturalCeiling ? `超自然上限：${renderJsonValueSummary(projectCanonProfile.supernaturalCeiling, 64)}` : '',
  ].filter(Boolean)
  const constraintLines = [
    ...profileLines,
    ...Object.entries(canonConstraintSet)
      .map(([key, value]) => {
        const summary = renderJsonValueSummary(value, 82)
        return summary ? `${key}：${summary}` : ''
      })
      .filter(Boolean),
  ].slice(0, 8)
  const sourceLines = sourceLedgerEntries
    .map((entry) => {
      const title = asText(entry.factTitle) || asText(entry.title) || asText(entry.sourceKey)
      const sourceText = asText(entry.sourceText) || asText(entry.summary) || collectJsonTextLeaves(entry).join('；')
      const sourceUrl = asText(entry.sourceUrl) || asText(entry.url)
      const verificationStatus = asText(entry.verificationStatus)
      const sourceDate = asText(entry.publishedAt) || asText(entry.recordedAt) || asText(entry.updatedAt)
      const meta = [
        sourceUrl ? `url=${summarizeText(sourceUrl, 120)}` : '',
        verificationStatus ? `status=${verificationStatus}` : '',
        sourceDate ? `date=${sourceDate.slice(0, 10)}` : '',
      ].filter(Boolean).join('；')
      const body = [title, summarizeText(sourceText, 96)].filter(Boolean).join('：')
      return meta ? `${body}（${meta}）` : body
    })
    .filter(Boolean)
    .slice(-6)
  const canonFactLines = canonFactCards
    .map((entry) => {
      const title = asText(entry.title) || asText(entry.cardKey)
      const summary = asText(entry.summary) || collectJsonTextLeaves(entry).join('；')
      return [title, summarizeText(summary, 96)].filter(Boolean).join('：')
    })
    .filter(Boolean)
    .slice(-8)
  const hasProjectSources = sourceLines.length > 0 || canonFactLines.length > 0 || constraintLines.length > 0

  return {
    assessmentSummary: assessment.mode === 'none' && hasProjectSources
      ? '项目来源账本已加载；正文只能把来源支持的事实写成定论，缺少来源的内容必须写成推断、传闻或待确认。'
      : assessment.summary,
    mode: assessment.mode,
    coverage: assessment.coverage,
    conservativeFallbackActive: assessment.conservativeFallbackActive,
    sourceLines,
    canonFactLines,
    constraintLines,
    missingSignals: assessment.missingSignals,
  }
}

function renderCharacterEntries(
  characters: ReturnType<typeof listCharacters>,
  stateByName: Map<string, ServiceCharacterStateSummary>,
  signals: WriterContextOrchestratorInput['signals'],
  getCharacterDetailContextImpl: typeof getCharacterDetailContext,
  maxCharacters: number,
): WriterOrchestratedCharacterPackEntry[] {
  const explicitNames = dedupe(signals.mentionedCharacters || [], Math.max(maxCharacters * 3, 24))
  const signalText = buildSignalSearchText([
    signals.chapterTitle,
    signals.chapterOutline,
    signals.chapterGoal,
    signals.arcSummary,
    signals.arcGoal,
    signals.relationSummary,
    signals.dialogueVoiceLocks,
    signals.chapterBridgePlan,
    signals.activeThreads,
    signals.openLoops,
    signals.dueForeshadows,
  ])
  const prioritizedCharacters = sortCharactersForWriterPack(characters)
  const inferredNames = explicitNames.length > 0
    ? prioritizedCharacters
      .filter((character) => {
        const candidateTerms = dedupe([
          character.fullName || '',
          character.surname && character.givenName ? `${character.surname}${character.givenName}` : '',
          character.surname || '',
          character.givenName || '',
          character.occupation || '',
          character.rankLevel || '',
          character.socialIdentity || '',
          ...parseJsonArrayText(character.contextHooksJson),
          ...parseAliasTextFromJson(character.sourceContextJson),
        ], 24)
        return matchesAnyTerm(candidateTerms.join(' '), explicitNames)
      })
      .map((character) => character.fullName || '')
      .filter(Boolean)
      .slice(0, maxCharacters)
    : prioritizedCharacters
      .map((character) => character.fullName || '')
      .filter((name) => name.length >= 2 && signalText.includes(name))
      .slice(0, maxCharacters)
  const mentioned = new Set(inferredNames)
  if (mentioned.size === 0) return []

  return prioritizedCharacters
    .filter((character) => mentioned.has(character.fullName))
    .slice(0, maxCharacters)
    .map((character) => {
      const detail = getCharacterDetailContextImpl(character.id)
      const state = stateByName.get(character.fullName)
      const relationSummaries = (detail.relatedRelations || [])
        .slice(0, 3)
        .map((relation) => [relation.relationLabel, relation.description].filter(Boolean).join('：'))
        .filter(Boolean)
      const voiceHints = [
        character.speechPattern || '',
        character.catchphrases || '',
        character.vocabularyLevel || '',
      ].filter(Boolean).slice(0, 3)
      return {
        characterId: character.id,
        name: character.fullName,
        roleType: (character.roleType || undefined) as WriterOrchestratedCharacterPackEntry['roleType'],
        stateSummary: state?.summaryText || character.innerConflict || character.relationshipTension || character.goals || '',
        relationSummaries,
        relatedItemNames: (detail.relatedItems || []).slice(0, 3).map((item) => item.itemName).filter(Boolean),
        voiceHints,
      }
    })
}

function renderItemEntries(
  items: ReturnType<typeof listStoryItems>,
  signals: WriterContextOrchestratorInput['signals'],
  getStoryItemDetailContextImpl: typeof getStoryItemDetailContext,
  maxItems: number,
): WriterOrchestratedItemPackEntry[] {
  const mentionTerms = dedupe(signals.mentionedItems || [], maxItems)
  if (mentionTerms.length === 0) return []

  return items
    .filter((item) => item.itemKind === 'instance')
    .filter((item) => matchesAnyTerm(dedupe([
      item.itemName || '',
      item.category || '',
      item.subType || '',
      ...parseJsonArrayText(item.tagsJson),
      ...parseAliasTextFromJson(item.sourceContextJson),
      ...parseAliasTextFromJson(item.typedRefsJson),
    ], 24).join(' '), mentionTerms))
    .slice(0, maxItems)
    .map((item) => {
      const detail = getStoryItemDetailContextImpl(item.id)
      return {
        itemId: item.id,
        name: item.itemName,
        status: (item.status || undefined) as WriterOrchestratedItemPackEntry['status'],
        ownerName: detail.ownerCharacter?.fullName,
        summary: [item.summary, item.plotFunction, item.risk].filter(Boolean).join('；'),
        relatedEventTitles: (detail.relatedEvents || []).slice(0, 3).map((event) => event.eventTitle).filter(Boolean),
      }
    })
}

function renderTimelineEntries(
  events: ReturnType<typeof listTimelineEvents>,
  signals: WriterContextOrchestratorInput['signals'],
  maxTimelineEvents: number,
): WriterOrchestratedTimelinePackEntry[] {
  const terms = dedupe([
    ...(signals.mentionedLocations || []),
    ...extractTerms([
      signals.timelineSummary,
      signals.timelineOpenThreads,
      signals.chapterGoal,
      signals.chapterOutline,
      signals.chapterBridgePlan,
    ], 8),
  ], 10)
  const filtered = events
    .filter((event) => {
      const haystack = [event.eventTitle, event.eventSummary, event.timeLabel, event.notes].filter(Boolean).join(' ')
      return matchesAnyTerm(haystack, terms)
    })
  return filtered
    .slice(0, maxTimelineEvents)
    .map((event) => ({
      eventId: event.id,
      title: event.eventTitle,
      timeLabel: event.timeLabel,
      status: (event.status || 'planned') as WriterOrchestratedTimelinePackEntry['status'],
      summary: [event.eventSummary, event.eventResult, event.eventCause].filter(Boolean).join('；'),
      openThreads: (() => {
        try {
          const parsed = event.openThreadsJson ? JSON.parse(event.openThreadsJson) : []
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 3) : []
        } catch {
          return []
        }
      })(),
    }))
}

function renderWorldStatePack(
  snapshot: WorldStateContextSnapshot,
  signals: WriterContextOrchestratorInput['signals'],
): WriterOrchestratedWorldStatePack {
  const terms = dedupe([
    ...(signals.mentionedCharacters || []),
    ...(signals.mentionedItems || []),
    ...(signals.mentionedLocations || []),
    ...(signals.mentionedFactions || []),
    ...extractTerms([signals.worldStates, signals.chapterGoal, signals.chapterOutline, signals.chapterBridgePlan], 8),
  ], 16)
  const currentStates = snapshot.currentStates.filter((state) => {
    const haystack = [state.entityName, state.summaryText, ...(state.stateItems || [])].filter(Boolean).join(' ')
    return matchesAnyTerm(haystack, terms)
  })
  const alerts = snapshot.alerts.filter((alert) => {
    const haystack = [alert.entityName, alert.summary, ...(alert.reasons || [])].filter(Boolean).join(' ')
    return matchesAnyTerm(haystack, terms)
  })

  return {
    stateLines: currentStates
      .slice(0, 4)
      .map((state: WorldStateContextSnapshot['currentStates'][number]) => `${state.entityName}：${state.summaryText || state.stateItems.join('；') || ''}`.trim())
      .filter(Boolean),
    alertLines: alerts
      .slice(0, 3)
      .map((alert: WorldStateContextSnapshot['alerts'][number]) => `${alert.entityName}：${alert.summary}`.trim())
      .filter(Boolean),
  }
}

function buildMapNodePath(
  node: NonNullable<ReturnType<typeof getMapNode>>,
  getMapNodeImpl: typeof getMapNode,
): { path: string; parentName?: string } {
  const names = [node.name]
  let parentName: string | undefined
  let parentId = node.parentId
  const seen = new Set<number>([node.id])
  while (typeof parentId === 'number' && !seen.has(parentId) && names.length < 6) {
    seen.add(parentId)
    const parent = getMapNodeImpl(parentId)
    if (!parent) break
    parentName ||= parent.name
    names.unshift(parent.name)
    parentId = parent.parentId
  }
  return {
    path: names.join(' -> '),
    parentName,
  }
}

function renderMapLocationEntries(
  context: WriterToolExecutionContext,
  maxMapLocations: number,
): WriterOrchestratedMapLocationPackEntry[] {
  const terms = dedupe(context.input.signals.mentionedLocations || [], Math.max(1, maxMapLocations))
  if (terms.length === 0) return []

  const candidateById = new Map<number, NonNullable<ReturnType<typeof getMapNode>>>()
  for (const term of terms) {
    const hits = context.services.searchMapNodes(context.input.novelId, term, Math.max(6, maxMapLocations * 2))
    hits.forEach((node) => {
      if (!candidateById.has(node.id)) {
        candidateById.set(node.id, node)
      }
    })
  }

  const scoreNode = (node: NonNullable<ReturnType<typeof getMapNode>>) => {
    const haystack = [
      node.name,
      node.nodeType,
      node.locationType,
      node.structureRole,
      node.description,
      node.plotRelevance,
      node.dangerLevel,
    ].filter(Boolean).join(' ')
    const termScore = terms.reduce((sum, term, index) => {
      if (node.name === term) return sum + 100 - index
      if (node.name.includes(term) || term.includes(node.name)) return sum + 60 - index
      return matchesAnyTerm(haystack, [term]) ? sum + 20 - index : sum
    }, 0)
    return termScore + Math.max(0, 8 - node.level)
  }

  const selected = [...candidateById.values()]
    .map((node) => ({ node, score: scoreNode(node) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.node.level - right.node.level || left.node.sortOrder - right.node.sortOrder)
    .slice(0, maxMapLocations)

  const nodeNameCache = new Map<number, string>()
  const getNodeName = (id: number) => {
    if (!nodeNameCache.has(id)) {
      nodeNameCache.set(id, context.services.getMapNode(id)?.name || `地点#${id}`)
    }
    return nodeNameCache.get(id) || `地点#${id}`
  }

  return selected.map(({ node }) => {
    const pathInfo = buildMapNodePath(node, context.services.getMapNode)
    const relationLines = context.services.getMapRelations(context.input.novelId, node.id)
      .slice(0, 3)
      .map((relation) => {
        const otherId = relation.mapAId === node.id ? relation.mapBId : relation.mapAId
        const relationLabel = relation.relationLabel || relation.relationType || '关联'
        return `${relationLabel}：${getNodeName(otherId)}${relation.description ? `（${relation.description}）` : ''}`
      })
      .filter(Boolean)
    return {
      mapId: node.id,
      name: node.name,
      level: node.level,
      path: pathInfo.path,
      parentName: pathInfo.parentName,
      nodeType: node.nodeType,
      locationType: node.locationType,
      structureRole: node.structureRole,
      description: node.description,
      plotRelevance: node.plotRelevance,
      dangerLevel: node.dangerLevel,
      relationLines,
    }
  })
}

function renderThreadPack(
  threadRows: ReturnType<typeof listStoryThreads>,
  foreshadowSnapshot: ReturnType<typeof getForeshadowSnapshot>,
  signals: WriterContextOrchestratorInput['signals'],
  maxThreads: number,
): WriterOrchestratedThreadPack {
  const threadLimit = Math.max(1, maxThreads)
  const terms = extractTerms([
    signals.activeThreads,
    signals.openLoops,
    signals.dueForeshadows,
    signals.chapterBridgePlan,
    signals.chapterGoal,
    signals.chapterOutline,
  ], 10)
  const matchedThreads = threadRows.map((thread) => {
    const haystack = [
      thread.title,
      thread.summary,
      thread.currentState,
      thread.payoffCondition,
      thread.premise,
    ].filter(Boolean).join(' ')
    const score = terms.reduce((sum, term, index) => (
      matchesAnyTerm(haystack, [term])
        ? sum + (thread.title && matchesAnyTerm(thread.title, [term]) ? 30 : 12) - index
        : sum
    ), 0)
      + (thread.status === 'active' ? 6 : thread.status === 'planned' ? 3 : thread.status === 'stalled' ? 2 : 0)
      + (thread.priority === 'high' ? 4 : thread.priority === 'medium' ? 2 : 0)
    return { thread, score }
  })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || (left.thread.sortOrder || 0) - (right.thread.sortOrder || 0))
    .slice(0, threadLimit)
    .map((entry) => entry.thread)

  return {
    activeThreadLines: matchedThreads
      .filter((thread) => thread.status === 'active' || thread.status === 'planned' || thread.status === 'stalled')
      .slice(0, threadLimit)
      .map((thread) => `${thread.title}${thread.currentState ? `：${thread.currentState}` : thread.summary ? `：${thread.summary}` : ''}`),
    openLoopLines: matchedThreads
      .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')
      .slice(0, threadLimit)
      .map((thread) => thread.payoffCondition || thread.premise || thread.summary || thread.title)
      .filter(Boolean),
    dueForeshadowLines: foreshadowSnapshot.dueSoon
      .slice(0, threadLimit)
      .map((entry) => `${entry.title}${entry.summary ? `：${entry.summary}` : ''}`),
    continuityLines: [
      ...foreshadowSnapshot.overdue.map((entry) => entry.warningText || entry.title),
      ...foreshadowSnapshot.pending.map((entry) => entry.summary || entry.title),
    ].filter(Boolean).slice(0, threadLimit),
  }
}

function renderRecallHits(
  bucket: 'character' | 'rule' | 'thread',
  hits: Awaited<ReturnType<typeof searchSimilarFragments>>['hits'],
): WriterOrchestratedRecallHit[] {
  return hits.map((hit) => ({
    bucket,
    chapterId: hit.chapterId,
    chapterNum: hit.chapterNum,
    fragmentType: hit.fragmentType,
    summary: hit.fragmentText,
    similarity: hit.similarity,
    searchMode: hit.searchMode,
  }))
}

function resolveRecallTermsForBucket(
  bucket: 'recall_character' | 'recall_rule' | 'recall_thread',
  signals: WriterContextOrchestratorInput['signals'],
): string[] {
  const characterTerms = dedupe(signals.mentionedCharacters || [], 10)
  const itemTerms = dedupe(signals.mentionedItems || [], 10)
  const locationTerms = dedupe(signals.mentionedLocations || [], 10)
  const factionTerms = dedupe(signals.mentionedFactions || [], 10)
  if (bucket === 'recall_character') return dedupe([...characterTerms, ...factionTerms], 12)
  if (bucket === 'recall_rule') return dedupe([...locationTerms, ...itemTerms, ...characterTerms, ...factionTerms], 14)
  return dedupe([...characterTerms, ...itemTerms, ...locationTerms, ...factionTerms], 14)
}

function filterValidatedRecallHits(
  bucket: 'recall_character' | 'recall_rule' | 'recall_thread',
  hits: Awaited<ReturnType<typeof searchSimilarFragments>>['hits'],
  context: WriterToolExecutionContext,
  limit: number,
) {
  const minSimilarity = (searchMode: string) => (searchMode === 'keyword' ? 0.5 : 0.6)
  const validationTerms = resolveRecallTermsForBucket(bucket, context.input.signals)
  return hits
    .filter((hit) => hit.chapterNum < context.input.chapterNum)
    .filter((hit) => hit.similarity >= minSimilarity(hit.searchMode))
    .filter((hit) => validationTerms.length === 0 || matchesAnyTerm(hit.fragmentText, validationTerms))
    .slice(0, limit)
}

function buildRenderedOverrides(
  storyMemoryPack: WriterOrchestratedStoryMemoryPack | undefined,
  sourceGroundingPack: WriterOrchestratedSourceGroundingPack | undefined,
  characters: WriterOrchestratedCharacterPackEntry[],
  items: WriterOrchestratedItemPackEntry[],
  mapLocations: WriterOrchestratedMapLocationPackEntry[],
  timeline: WriterOrchestratedTimelinePackEntry[],
  worldStatePack: WriterOrchestratedWorldStatePack | undefined,
  threadPack: WriterOrchestratedThreadPack | undefined,
  recallHits: WriterOrchestratedRecallHit[],
  runtimeLimits: WriterToolRuntimeLimits,
  baseContextParts?: WriterContextRenderedOverrides,
): WriterContextRenderedOverrides {
  const characterLineLimit = Math.max(6, runtimeLimits.maxCharacters)
  const itemLineLimit = Math.max(6, runtimeLimits.maxItems)
  const mapLineLimit = Math.max(6, runtimeLimits.maxMapLocations)
  const timelineLineLimit = Math.max(6, runtimeLimits.maxTimelineEvents)
  const threadLineLimit = Math.max(6, runtimeLimits.maxThreads)
  const characterCharLimit = Math.max(760, Math.min(3600, characterLineLimit * 150))
  const itemCharLimit = Math.max(720, Math.min(2600, itemLineLimit * 130))
  const mapCharLimit = Math.max(760, Math.min(3000, mapLineLimit * 140))
  const timelineCharLimit = Math.max(760, Math.min(3000, timelineLineLimit * 140))
  const threadCharLimit = Math.max(720, Math.min(3000, threadLineLimit * 140))
  const result: WriterContextRenderedOverrides = {
    worldRules: baseContextParts?.worldRules || '',
    characterStates: '',
    relationSummary: '',
    dialogueVoiceLocks: '',
    itemSummary: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    worldStates: '',
    mapSummary: '',
    recalledMemory: '',
    chapterBridgePlan: baseContextParts?.chapterBridgePlan || '',
    stepMemorySummary: baseContextParts?.stepMemorySummary || '',
  }
  if (storyMemoryPack) {
    result.longTermMemory = compactLines([
      storyMemoryPack.coverageSummary,
      ...storyMemoryPack.phaseDigest,
      ...storyMemoryPack.plotMilestones,
      ...storyMemoryPack.timelineAnchors,
      ...storyMemoryPack.itemLedger,
    ], 12, 1200)
    result.activeThreads = mergePreservingBase(
      baseContextParts?.activeThreads,
      compactLines(storyMemoryPack.activeThreads, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
    result.continuityNotes = mergePreservingBase(
      baseContextParts?.continuityNotes,
      compactLines(storyMemoryPack.continuityDirectives, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
  }
  if (sourceGroundingPack) {
    const groundingLines = [
      sourceGroundingPack.assessmentSummary ? `来源状态：${sourceGroundingPack.assessmentSummary}` : '',
      sourceGroundingPack.sourceLines.length > 0 ? `来源摘录：\n${sourceGroundingPack.sourceLines.map((line) => `- ${line}`).join('\n')}` : '',
      sourceGroundingPack.canonFactLines.length > 0 ? `已确认事实：\n${sourceGroundingPack.canonFactLines.map((line) => `- ${line}`).join('\n')}` : '',
      sourceGroundingPack.constraintLines.length > 0 ? `来源约束：\n${sourceGroundingPack.constraintLines.map((line) => `- ${line}`).join('\n')}` : '',
      sourceGroundingPack.conservativeFallbackActive
        ? '保守 fallback：缺少来源支持的真实历史、制度、官称、器物、地理和纪年细节不得写成定论；只能写成待确认、传闻或低承诺描述。'
        : '',
    ].filter(Boolean)
    result.worldRules = mergePreservingBase(
      baseContextParts?.worldRules,
      compactLines(groundingLines, 12, 1800),
      16,
      3600,
    )
  }
  if (characters.length > 0) {
    result.characterStates = compactLines(
      characters.map((character) => `${character.name}：${character.stateSummary}`),
      characterLineLimit,
      characterCharLimit,
    )
    result.relationSummary = compactLines(
      characters.flatMap((character) => character.relationSummaries.map((line) => `${character.name}：${line}`)),
      Math.max(8, characterLineLimit),
      characterCharLimit,
    ) || ''
    result.dialogueVoiceLocks = mergePreservingBase(
      baseContextParts?.dialogueVoiceLocks,
      compactLines(
        characters.flatMap((character) => character.voiceHints.map((hint) => `${character.name}：${hint}`)),
        Math.max(8, characterLineLimit),
        characterCharLimit,
      ),
      Math.max(10, characterLineLimit),
      Math.max(820, characterCharLimit),
    )
  }
  if (items.length > 0) {
    result.itemSummary = compactLines(items.map((item) => `${item.name}：${item.summary}`), itemLineLimit, itemCharLimit)
  }
  if (mapLocations.length > 0) {
    result.mapSummary = compactLines(
      mapLocations.map((location) => {
        const meta = [
          `层级${location.level}`,
          location.locationType || location.nodeType || '',
          location.structureRole || '',
          location.dangerLevel ? `风险=${location.dangerLevel}` : '',
        ].filter(Boolean).join(' / ')
        const summary = [
          location.description,
          location.plotRelevance ? `剧情作用=${location.plotRelevance}` : '',
          location.relationLines.length > 0 ? `关系=${location.relationLines.join('；')}` : '',
        ].filter(Boolean).join('；')
        return `${location.path}${meta ? `（${meta}）` : ''}${summary ? `：${summary}` : ''}`
      }),
      mapLineLimit,
      mapCharLimit,
    )
  }
  if (timeline.length > 0) {
    result.timelineSummary = compactLines(
      timeline.map((item) => `${item.timeLabel || '时间未标注'} · ${item.title}${item.summary ? `：${item.summary}` : ''}`),
      timelineLineLimit,
      timelineCharLimit,
    )
    result.timelineOpenThreads = compactLines(
      timeline.flatMap((item) => item.openThreads.map((thread) => `${item.title}：${thread}`)),
      timelineLineLimit,
      timelineCharLimit,
    ) || result.timelineOpenThreads
  }
  if (worldStatePack) {
    result.worldStates = compactLines([
      ...worldStatePack.stateLines,
      ...worldStatePack.alertLines,
    ], timelineLineLimit, timelineCharLimit) || result.worldStates
  }
  if (threadPack) {
    result.activeThreads = mergePreservingBase(
      result.activeThreads || baseContextParts?.activeThreads,
      compactLines(threadPack.activeThreadLines, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
    result.openLoops = mergePreservingBase(
      baseContextParts?.openLoops,
      compactLines(threadPack.openLoopLines, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
    result.dueForeshadows = mergePreservingBase(
      baseContextParts?.dueForeshadows,
      compactLines(threadPack.dueForeshadowLines, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
    result.continuityNotes = mergePreservingBase(
      result.continuityNotes || baseContextParts?.continuityNotes,
      compactLines(threadPack.continuityLines, threadLineLimit, threadCharLimit),
      Math.max(8, threadLineLimit),
      Math.max(760, threadCharLimit),
    )
  }
  if (recallHits.length > 0) {
    result.recalledMemory = compactLines(
      recallHits.map((hit) => `[${hit.bucket}] Ch.${hit.chapterNum} ${hit.fragmentType}：${hit.summary}`),
      Math.max(6, runtimeLimits.maxRecallHits),
      Math.max(860, Math.min(1600, runtimeLimits.maxRecallHits * 180)),
    )
  }
  return result
}

function buildAllocatorInputSummary(
  overrides: WriterContextRenderedOverrides,
  plan: WriterContextQueryPlanStep[],
  input: WriterContextOrchestratorInput,
): WriterContextAllocatorInputSummary {
  const overrideEntries = Object.entries(overrides).filter(([, value]) => Boolean(value))
  const buckets: WriterContextAllocatorInputBucketSummary[] = plan
    .filter((step) => step.enabled)
    .map((step) => {
      const renderedLabels = overrideEntries
        .filter(([key]) => {
          if (step.bucket === 'story_memory') return key === 'longTermMemory' || key === 'activeThreads' || key === 'continuityNotes' || key === 'chapterBridgePlan' || key === 'stepMemorySummary'
          if (step.bucket === 'source_grounding') return key === 'worldRules'
          if (step.bucket === 'character') return key === 'characterStates' || key === 'relationSummary' || key === 'dialogueVoiceLocks'
          if (step.bucket === 'item') return key === 'itemSummary'
          if (step.bucket === 'map_location') return key === 'mapSummary'
          if (step.bucket === 'timeline') return key === 'timelineSummary' || key === 'timelineOpenThreads'
          if (step.bucket === 'world_state') return key === 'worldStates'
          if (step.bucket === 'thread') return key === 'activeThreads' || key === 'openLoops' || key === 'dueForeshadows' || key === 'continuityNotes' || key === 'chapterBridgePlan' || key === 'stepMemorySummary'
          return key === 'recalledMemory'
        })
        .map(([key]) => key) as WriterContextAllocatorInputBucketSummary['renderedLabels']
      const text = renderedLabels.map((label) => overrides[label] || '').join('\n')
      return {
        bucket: step.bucket,
        renderedLabels,
        itemCount: renderedLabels.length,
        charCount: text.length,
      }
    })
    .filter((item) => item.renderedLabels.length > 0)
  const overrideLabels = overrideEntries.map(([key]) => key) as WriterContextAllocatorInputSummary['overrideLabels']
  const overrideText = overrideEntries.map(([, value]) => value || '').join('\n')
  const signalCharCount = JSON.stringify(input.signals).length
  return {
    overrideLabels,
    overrideCharCount: overrideText.length,
    overrideLineCount: overrideText.split('\n').filter(Boolean).length,
    enabledBucketCount: plan.filter((step) => step.enabled).length,
    signalCharCount,
    buckets,
  }
}

function createWriterToolAccumulator(): WriterToolAccumulator {
  return {
    characterEntries: [],
    itemEntries: [],
    mapLocationEntries: [],
    timelineEntries: [],
    recallHits: [],
  }
}

function createWriterToolExecutionContext(
  input: WriterContextOrchestratorInput,
  services: ServiceBundle,
  runtimeLimits: WriterToolRuntimeLimits,
): WriterToolExecutionContext {
  let storyMemorySnapshot: StoryMemorySnapshot | undefined
  let stateByName: Map<string, ServiceCharacterStateSummary> | undefined

  const getStoryMemorySnapshot = () => {
    if (!storyMemorySnapshot) {
      storyMemorySnapshot = services.buildStoryMemorySnapshot(input.novelId)
    }
    return storyMemorySnapshot
  }

  const getCharacterStateByName = () => {
    if (!stateByName) {
      stateByName = new Map(
        (getStoryMemorySnapshot().characterCurrentStates || [])
          .map((state) => [state.characterName, state] as const),
      )
    }
    return stateByName
  }

  return {
    input,
    services,
    runtimeLimits,
    getStoryMemorySnapshot,
    getCharacterStateByName,
  }
}

function buildWriterToolRegistry(): Record<WriterContextQueryBucket, RegisteredWriterTool> {
  return {
    story_memory: {
      bucket: 'story_memory',
      toolName: 'story_memory.get_pack',
      execute: (_step, context, accumulator) => {
        const snapshot = context.getStoryMemorySnapshot()
        accumulator.storyMemoryPack = renderStoryMemoryPack(snapshot)
        return {
          status: 'success',
          resultCount: accumulator.storyMemoryPack.phaseDigest.length + accumulator.storyMemoryPack.plotMilestones.length,
        }
      },
    },
    source_grounding: {
      bucket: 'source_grounding',
      toolName: 'source_grounding.get_pack',
      execute: (_step, context, accumulator) => {
        accumulator.sourceGroundingPack = renderSourceGroundingPack(context.input.signals)
        const resultCount = accumulator.sourceGroundingPack.sourceLines.length
          + accumulator.sourceGroundingPack.canonFactLines.length
          + accumulator.sourceGroundingPack.constraintLines.length
        if (accumulator.sourceGroundingPack.mode !== 'none' || resultCount > 0) {
          return {
            status: 'success',
            resultCount,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: 'source grounding pack empty',
          fallbackEvent: makeFallbackEvent('source_grounding', 'empty_result', '来源 grounding 查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    character: {
      bucket: 'character',
      toolName: 'character.get_pack',
      execute: (_step, context, accumulator) => {
        const rows = context.services.listCharacters(context.input.novelId)
        accumulator.characterEntries = renderCharacterEntries(
          rows,
          context.getCharacterStateByName(),
          context.input.signals,
          context.services.getCharacterDetailContext,
          context.runtimeLimits.maxCharacters,
        )
        if (accumulator.characterEntries.length > 0) {
          return {
            status: 'success',
            resultCount: accumulator.characterEntries.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: 'no character entries rendered',
          fallbackEvent: makeFallbackEvent('character', 'empty_result', '人物查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    item: {
      bucket: 'item',
      toolName: 'item.get_pack',
      execute: (_step, context, accumulator) => {
        const rows = context.services.listStoryItems(context.input.novelId)
        accumulator.itemEntries = renderItemEntries(
          rows,
          context.input.signals,
          context.services.getStoryItemDetailContext,
          context.runtimeLimits.maxItems,
        )
        if (accumulator.itemEntries.length > 0) {
          return {
            status: 'success',
            resultCount: accumulator.itemEntries.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: 'no item entries rendered',
          fallbackEvent: makeFallbackEvent('item', 'empty_result', '道具查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    map_location: {
      bucket: 'map_location',
      toolName: 'map.get_pack',
      execute: (_step, context, accumulator) => {
        accumulator.mapLocationEntries = renderMapLocationEntries(context, context.runtimeLimits.maxMapLocations)
        if (accumulator.mapLocationEntries.length > 0) {
          return {
            status: 'success',
            resultCount: accumulator.mapLocationEntries.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: 'no map location entries rendered',
          fallbackEvent: makeFallbackEvent('map_location', 'empty_result', '地图地点查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    timeline: {
      bucket: 'timeline',
      toolName: 'timeline.get_pack',
      execute: (_step, context, accumulator) => {
        const rows = context.services.listTimelineEvents(context.input.novelId)
        accumulator.timelineEntries = renderTimelineEntries(
          rows,
          context.input.signals,
          context.runtimeLimits.maxTimelineEvents,
        )
        if (accumulator.timelineEntries.length > 0) {
          return {
            status: 'success',
            resultCount: accumulator.timelineEntries.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: 'no timeline entries rendered',
          fallbackEvent: makeFallbackEvent('timeline', 'empty_result', '时间线查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    world_state: {
      bucket: 'world_state',
      toolName: 'world_state.get_pack',
      execute: (_step, context, accumulator) => {
        const snapshot = context.services.getWorldStateContextSnapshot(context.input.novelId, {
          upToChapterNum: context.input.chapterNum,
          limit: context.runtimeLimits.maxTimelineEvents,
        })
        accumulator.worldStatePack = renderWorldStatePack(snapshot, context.input.signals)
        const resultCount = accumulator.worldStatePack.stateLines.length + accumulator.worldStatePack.alertLines.length
        if (resultCount > 0) {
          return {
            status: 'success',
            resultCount,
          }
        }
        return {
          status: 'success',
          resultCount,
        }
      },
    },
    thread: {
      bucket: 'thread',
      toolName: 'thread.get_pack',
      execute: (_step, context, accumulator) => {
        const threadRows = context.services.listStoryThreads(context.input.novelId)
        const foreshadowSnapshot = context.services.getForeshadowSnapshot(context.input.novelId, context.input.chapterNum)
        accumulator.threadPack = renderThreadPack(
          threadRows,
          foreshadowSnapshot,
          context.input.signals,
          context.runtimeLimits.maxThreads,
        )
        const resultCount = accumulator.threadPack.activeThreadLines.length
          + accumulator.threadPack.dueForeshadowLines.length
          + accumulator.threadPack.openLoopLines.length
        if (resultCount > 0) {
          return {
            status: 'success',
            resultCount,
          }
        }
        return {
          status: 'failed',
          resultCount,
          errorMessage: 'thread pack empty',
          fallbackEvent: makeFallbackEvent('thread', 'empty_result', '线程/伏笔查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    recall_character: {
      bucket: 'recall_character',
      toolName: 'recall.search_fragments',
      execute: async (step, context, accumulator) => {
        const result = await context.services.searchSimilarFragments(
          context.input.novelId,
          step.queryText || step.terms.join('\n'),
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        const filteredHits = filterValidatedRecallHits(
          'recall_character',
          result.hits,
          context,
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        accumulator.recallHits.push(...renderRecallHits('character', filteredHits))
        if (filteredHits.length > 0) {
          return {
            status: 'success',
            resultCount: filteredHits.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: result.fallbackReason || 'no recall hits',
          fallbackEvent: makeFallbackEvent(
            'recall_character',
            result.fallbackReason || 'empty_result',
            `召回未命中：${step.queryText || step.terms.join('、')}`,
            'conservative',
          ),
        }
      },
    },
    recall_rule: {
      bucket: 'recall_rule',
      toolName: 'recall.search_fragments',
      execute: async (step, context, accumulator) => {
        const result = await context.services.searchSimilarFragments(
          context.input.novelId,
          step.queryText || step.terms.join('\n'),
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        const filteredHits = filterValidatedRecallHits(
          'recall_rule',
          result.hits,
          context,
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        accumulator.recallHits.push(...renderRecallHits('rule', filteredHits))
        if (filteredHits.length > 0) {
          return {
            status: 'success',
            resultCount: filteredHits.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: result.fallbackReason || 'no recall hits',
          fallbackEvent: makeFallbackEvent(
            'recall_rule',
            result.fallbackReason || 'empty_result',
            `召回未命中：${step.queryText || step.terms.join('、')}`,
            'conservative',
          ),
        }
      },
    },
    recall_thread: {
      bucket: 'recall_thread',
      toolName: 'recall.search_fragments',
      execute: async (step, context, accumulator) => {
        const result = await context.services.searchSimilarFragments(
          context.input.novelId,
          step.queryText || step.terms.join('\n'),
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        const filteredHits = filterValidatedRecallHits(
          'recall_thread',
          result.hits,
          context,
          step.resultLimit || context.runtimeLimits.maxRecallHits,
        )
        accumulator.recallHits.push(...renderRecallHits('thread', filteredHits))
        if (filteredHits.length > 0) {
          return {
            status: 'success',
            resultCount: filteredHits.length,
          }
        }
        return {
          status: 'failed',
          resultCount: 0,
          errorMessage: result.fallbackReason || 'no recall hits',
          fallbackEvent: makeFallbackEvent(
            'recall_thread',
            result.fallbackReason || 'empty_result',
            `召回未命中：${step.queryText || step.terms.join('、')}`,
            'conservative',
          ),
        }
      },
    },
  }
}

function getServiceBundle(overrides?: ServiceOverrides) {
  return {
    listCharacters: overrides?.listCharacters || listCharacters,
    getCharacterDetailContext: overrides?.getCharacterDetailContext || getCharacterDetailContext,
    listStoryItems: overrides?.listStoryItems || listStoryItems,
    getStoryItemDetailContext: overrides?.getStoryItemDetailContext || getStoryItemDetailContext,
    searchMapNodes: overrides?.searchMapNodes || searchMapNodes,
    getMapNode: overrides?.getMapNode || getMapNode,
    getMapRelations: overrides?.getMapRelations || getMapRelations,
    buildStoryMemorySnapshot: overrides?.buildStoryMemorySnapshot || buildStoryMemorySnapshot,
    listStoryThreads: overrides?.listStoryThreads || listStoryThreads,
    getForeshadowSnapshot: overrides?.getForeshadowSnapshot || getForeshadowSnapshot,
    listTimelineEvents: overrides?.listTimelineEvents || listTimelineEvents,
    getWorldStateContextSnapshot: overrides?.getWorldStateContextSnapshot || getWorldStateContextSnapshot,
    searchSimilarFragments: overrides?.searchSimilarFragments || searchSimilarFragments,
  }
}

function pruneCache() {
  const current = now()
  for (const [key, entry] of memoryCache.entries()) {
    if ((current - entry.createdAt) > MEMORY_CACHE_TTL_MS) {
      memoryCache.delete(key)
    }
  }
  while (memoryCache.size > MEMORY_CACHE_MAX) {
    const firstKey = memoryCache.keys().next().value
    if (!firstKey) break
    memoryCache.delete(firstKey)
  }
}

export function clearWriterOrchestratorMemoryCache() {
  memoryCache.clear()
}

export async function resolveWriterOrchestratedContext(
  input: WriterContextOrchestratorInput,
  overrides?: ServiceOverrides,
): Promise<WriterContextOrchestratorResolution> {
  const services = getServiceBundle(overrides)
  const startedAt = now()
  const queryPlan = buildWriterQueryPlan(input)
  const retrievalFingerprint = buildRetrievalFingerprint(input, queryPlan)
  const cacheKey = retrievalFingerprint.cacheKey
  const useMemoryCache = input.runtime?.useMemoryCache !== false
  const forceRefresh = Boolean(input.runtime?.forceRefresh)

  pruneCache()
  if (useMemoryCache && !forceRefresh) {
    const cached = memoryCache.get(cacheKey)
    if (cached && (now() - cached.createdAt) <= MEMORY_CACHE_TTL_MS) {
      return {
        ...cached.value,
        cacheHit: true,
        toolCalls: [
          {
            target: 'cache',
            toolName: 'memory_cache',
            status: 'cache_hit',
            durationMs: 0,
            argsSummary: cacheKey,
          },
          ...cached.value.toolCalls,
        ],
      }
    }
  }

  const toolCalls: WriterContextToolCall[] = []
  const fallbackEvents: WriterContextFallbackEvent[] = []
  const runtimeLimits: WriterToolRuntimeLimits = {
    maxCharacters: input.runtime?.maxCharacters || 6,
    maxItems: input.runtime?.maxItems || 4,
    maxMapLocations: input.runtime?.maxMapLocations || input.runtime?.maxTimelineEvents || 4,
    maxTimelineEvents: input.runtime?.maxTimelineEvents || 4,
    maxThreads: input.runtime?.maxThreads || 4,
    maxRecallHits: input.runtime?.maxRecallHitsPerBucket || 3,
  }
  const accumulator = createWriterToolAccumulator()
  const toolContext = createWriterToolExecutionContext(input, services, runtimeLimits)
  const toolRegistry = buildWriterToolRegistry()

  for (const step of queryPlan) {
    if (!step.enabled) {
      toolCalls.push({
        target: step.bucket,
        toolName: step.serviceCalls[0] || step.bucket,
        status: 'skipped',
        durationMs: 0,
        argsSummary: summarizeText(step.queryText || step.terms.join('、') || step.reason, 120),
      })
      continue
    }

    const bucketStartedAt = now()
    const registeredTool = toolRegistry[step.bucket]
    if (!registeredTool) {
      toolCalls.push(makeToolCall(step.bucket, step.serviceCalls[0] || step.bucket, bucketStartedAt, 'failed', {
        argsSummary: summarizeText(step.queryText || step.terms.join('、'), 120),
        errorMessage: `no registered tool for bucket: ${step.bucket}`,
      }))
      fallbackEvents.push(makeFallbackEvent(
        step.bucket,
        'service_failed',
        `未找到 bucket 对应的 tool registry：${step.bucket}`,
        'conservative',
      ))
      continue
    }

    try {
      const result = await registeredTool.execute(step, toolContext, accumulator)
      toolCalls.push(makeToolCall(step.bucket, registeredTool.toolName, bucketStartedAt, result.status, {
        argsSummary: summarizeText(step.queryText || step.terms.join('、') || step.reason, 120),
        resultCount: result.resultCount,
        errorMessage: result.errorMessage,
      }))
      if (result.fallbackEvent) {
        fallbackEvents.push(result.fallbackEvent)
      }
    } catch (error) {
      toolCalls.push(makeToolCall(step.bucket, registeredTool.toolName, bucketStartedAt, 'failed', {
        argsSummary: summarizeText(step.queryText || step.terms.join('、'), 120),
        errorMessage: error instanceof Error ? error.message : 'unknown error',
      }))
      fallbackEvents.push(makeFallbackEvent(
        step.bucket,
        'service_failed',
        error instanceof Error ? error.message : 'unknown error',
        'conservative',
      ))
    }
  }

  const renderedContextOverrides = buildRenderedOverrides(
    accumulator.storyMemoryPack,
    accumulator.sourceGroundingPack,
    accumulator.characterEntries,
    accumulator.itemEntries,
    accumulator.mapLocationEntries,
    accumulator.timelineEntries,
    accumulator.worldStatePack,
    accumulator.threadPack,
    accumulator.recallHits,
    runtimeLimits,
    input.baseContextParts,
  )
  const allocatorInputSummary = buildAllocatorInputSummary(renderedContextOverrides, queryPlan, input)
  const resolution: WriterContextOrchestratorResolution = {
    cacheKey,
    cacheHit: false,
    queryPlan,
    retrievalFingerprint,
    structuredPack: {
      storyMemory: accumulator.storyMemoryPack,
      sourceGrounding: accumulator.sourceGroundingPack,
      characters: accumulator.characterEntries,
      items: accumulator.itemEntries,
      mapLocations: accumulator.mapLocationEntries,
      timeline: accumulator.timelineEntries,
      worldState: accumulator.worldStatePack,
      threads: accumulator.threadPack,
      recall: { hits: accumulator.recallHits },
    },
    renderedContextOverrides,
    toolCalls,
    fallbackEvents,
    allocatorInputSummary,
  }

  if (useMemoryCache) {
    memoryCache.set(cacheKey, {
      value: resolution,
      createdAt: startedAt,
    })
    pruneCache()
  }

  return resolution
}

export const __writerOrchestratorTestUtils = {
  buildWriterQueryPlan,
  buildRetrievalFingerprint,
}
