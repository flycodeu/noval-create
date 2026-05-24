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
  WriterOrchestratedRecallHit,
  WriterOrchestratedStoryMemoryPack,
  WriterOrchestratedThreadPack,
  WriterOrchestratedTimelinePackEntry,
  WriterOrchestratedWorldStatePack,
} from '../../src/types'
import { getCharacterDetailContext, listCharacters } from './character.service'
import type { CharacterStateSummary as ServiceCharacterStateSummary } from './character-state.service'
import { searchSimilarFragments } from './embedding.service'
import { getStoryItemDetailContext, listStoryItems } from './item.service'
import { buildStoryMemorySnapshot } from './story-memory.service'
import { getForeshadowSnapshot, listStoryThreads } from './story-thread.service'
import { listTimelineEvents } from './timeline.service'
import { getWorldStateContextSnapshot, type WorldStateContextSnapshot } from './world-state.service'

type ServiceOverrides = {
  listCharacters?: typeof listCharacters
  getCharacterDetailContext?: typeof getCharacterDetailContext
  listStoryItems?: typeof listStoryItems
  getStoryItemDetailContext?: typeof getStoryItemDetailContext
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
  characterEntries: WriterOrchestratedCharacterPackEntry[]
  itemEntries: WriterOrchestratedItemPackEntry[]
  timelineEntries: WriterOrchestratedTimelinePackEntry[]
  worldStatePack?: WriterOrchestratedWorldStatePack
  threadPack?: WriterOrchestratedThreadPack
  recallHits: WriterOrchestratedRecallHit[]
}

interface WriterToolRuntimeLimits {
  maxCharacters: number
  maxItems: number
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
  const mentionedCharacters = dedupe(signals.mentionedCharacters || [], 8)
  const mentionedItems = dedupe(signals.mentionedItems || [], 8)
  const mentionedLocations = dedupe(signals.mentionedLocations || [], 8)
  const chapterGoal = asText(signals.chapterGoal)
  const relationSummary = asText(signals.relationSummary)
  const activeThreads = asText(signals.activeThreads)
  const openLoops = asText(signals.openLoops)
  const dueForeshadows = asText(signals.dueForeshadows)
  const worldStates = asText(signals.worldStates)
  const timelineSummary = asText(signals.timelineSummary)
  const timelineOpenThreads = asText(signals.timelineOpenThreads)

  const storyMemoryEnabled = Boolean(
    chapterGoal
    || activeThreads
    || openLoops
    || dueForeshadows
    || timelineSummary
    || timelineOpenThreads,
  )
  const characterEnabled = mentionedCharacters.length > 0 || Boolean(relationSummary)
  const itemEnabled = mentionedItems.length > 0
  const worldStateEnabled = mentionedLocations.length > 0
  const timelineEnabled = mentionedLocations.length > 0 || /\S/.test(timelineSummary)
  const threadEnabled = Boolean(activeThreads || openLoops || dueForeshadows)
  const recallCharacterEnabled = mentionedCharacters.length > 0
  const recallRuleEnabled = Boolean(worldStates || timelineSummary)
  const recallThreadEnabled = Boolean(activeThreads || openLoops || dueForeshadows)

  return [
    buildQueryStep(
      'story_memory',
      storyMemoryEnabled,
      storyMemoryEnabled ? '当前章节存在承接或全局记忆需求。' : '当前章节不需要额外长程记忆包。',
      extractTerms([chapterGoal, activeThreads, openLoops, dueForeshadows], 6),
      ['story_memory.get_pack'],
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
      worldStateEnabled ? '存在地点或世界状态信号，需要世界状态切片。' : '没有显著世界状态信号。',
      dedupe([...mentionedLocations, ...extractTerms([worldStates], 4)], 6),
      ['world_state.get_pack'],
      mentionedLocations.join('、') || worldStates,
      4,
    ),
    buildQueryStep(
      'thread',
      threadEnabled,
      threadEnabled ? '存在活跃线程、开放问题或待回收伏笔。' : '没有显著线程压力。',
      extractTerms([activeThreads, openLoops, dueForeshadows], 8),
      ['thread.get_pack'],
      [activeThreads, openLoops, dueForeshadows].filter(Boolean).join('\n'),
      input.runtime?.maxThreads || 4,
    ),
    buildQueryStep(
      'recall_character',
      recallCharacterEnabled,
      recallCharacterEnabled ? '需要补充人物相关历史片段。' : '没有人物召回需求。',
      mentionedCharacters,
      ['recall.search_fragments'],
      [chapterGoal, relationSummary, ...mentionedCharacters].filter(Boolean).join('\n'),
      input.runtime?.maxRecallHitsPerBucket || 3,
    ),
    buildQueryStep(
      'recall_rule',
      recallRuleEnabled,
      recallRuleEnabled ? '需要补充规则/状态相关历史片段。' : '没有规则召回需求。',
      extractTerms([worldStates, timelineSummary], 6),
      ['recall.search_fragments'],
      [chapterGoal, worldStates, timelineSummary].filter(Boolean).join('\n'),
      input.runtime?.maxRecallHitsPerBucket || 3,
    ),
    buildQueryStep(
      'recall_thread',
      recallThreadEnabled,
      recallThreadEnabled ? '需要补充线程/伏笔相关历史片段。' : '没有线程召回需求。',
      extractTerms([activeThreads, openLoops, dueForeshadows], 6),
      ['recall.search_fragments'],
      [chapterGoal, activeThreads, openLoops, dueForeshadows].filter(Boolean).join('\n'),
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

function renderCharacterEntries(
  characters: ReturnType<typeof listCharacters>,
  stateByName: Map<string, ServiceCharacterStateSummary>,
  signals: WriterContextOrchestratorInput['signals'],
  getCharacterDetailContextImpl: typeof getCharacterDetailContext,
  maxCharacters: number,
): WriterOrchestratedCharacterPackEntry[] {
  const explicitNames = dedupe(signals.mentionedCharacters || [], maxCharacters)
  const signalText = buildSignalSearchText([
    signals.chapterTitle,
    signals.chapterOutline,
    signals.chapterGoal,
    signals.arcSummary,
    signals.arcGoal,
    signals.relationSummary,
    signals.dialogueVoiceLocks,
    signals.activeThreads,
    signals.openLoops,
    signals.dueForeshadows,
  ])
  const inferredNames = explicitNames.length > 0
    ? explicitNames
    : characters
      .map((character) => character.fullName || '')
      .filter((name) => name.length >= 2 && signalText.includes(name))
      .slice(0, maxCharacters)
  const mentioned = new Set(inferredNames)
  if (mentioned.size === 0) return []

  return characters
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
  const mentioned = new Set(signals.mentionedItems || [])
  if (mentioned.size === 0) return []

  return items
    .filter((item) => item.itemKind === 'instance')
    .filter((item) => mentioned.has(item.itemName))
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
    ...(signals.mentionedLocations || []),
    ...extractTerms([signals.worldStates, signals.chapterGoal, signals.chapterOutline], 8),
  ], 10)
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

function renderThreadPack(
  threadRows: ReturnType<typeof listStoryThreads>,
  foreshadowSnapshot: ReturnType<typeof getForeshadowSnapshot>,
  signals: WriterContextOrchestratorInput['signals'],
): WriterOrchestratedThreadPack {
  const terms = extractTerms([
    signals.activeThreads,
    signals.openLoops,
    signals.dueForeshadows,
    signals.chapterGoal,
    signals.chapterOutline,
  ], 10)
  const matchedThreads = threadRows.filter((thread) => {
    const haystack = [
      thread.title,
      thread.summary,
      thread.currentState,
      thread.payoffCondition,
      thread.premise,
    ].filter(Boolean).join(' ')
    return matchesAnyTerm(haystack, terms)
  })

  return {
    activeThreadLines: matchedThreads
      .filter((thread) => thread.status === 'active' || thread.status === 'planned' || thread.status === 'stalled')
      .slice(0, 4)
      .map((thread) => `${thread.title}${thread.currentState ? `：${thread.currentState}` : thread.summary ? `：${thread.summary}` : ''}`),
    openLoopLines: matchedThreads
      .filter((thread) => thread.status !== 'resolved' && thread.status !== 'abandoned')
      .slice(0, 3)
      .map((thread) => thread.payoffCondition || thread.premise || thread.summary || thread.title)
      .filter(Boolean),
    dueForeshadowLines: foreshadowSnapshot.dueSoon
      .slice(0, 3)
      .map((entry) => `${entry.title}${entry.summary ? `：${entry.summary}` : ''}`),
    continuityLines: [
      ...foreshadowSnapshot.overdue.slice(0, 2).map((entry) => entry.warningText || entry.title),
      ...foreshadowSnapshot.pending.slice(0, 2).map((entry) => entry.summary || entry.title),
    ].filter(Boolean),
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

function buildRenderedOverrides(
  storyMemoryPack: WriterOrchestratedStoryMemoryPack | undefined,
  characters: WriterOrchestratedCharacterPackEntry[],
  items: WriterOrchestratedItemPackEntry[],
  timeline: WriterOrchestratedTimelinePackEntry[],
  worldStatePack: WriterOrchestratedWorldStatePack | undefined,
  threadPack: WriterOrchestratedThreadPack | undefined,
  recallHits: WriterOrchestratedRecallHit[],
  baseContextParts?: WriterContextRenderedOverrides,
): WriterContextRenderedOverrides {
  const result: WriterContextRenderedOverrides = {
    characterStates: '',
    relationSummary: '',
    dialogueVoiceLocks: '',
    itemSummary: '',
    timelineSummary: '',
    timelineOpenThreads: '',
    worldStates: '',
    recalledMemory: '',
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
      compactLines(storyMemoryPack.activeThreads, 6, 600),
      8,
      760,
    )
    result.continuityNotes = mergePreservingBase(
      baseContextParts?.continuityNotes,
      compactLines(storyMemoryPack.continuityDirectives, 6, 600),
      8,
      760,
    )
  }
  if (characters.length > 0) {
    result.characterStates = compactLines(characters.map((character) => `${character.name}：${character.stateSummary}`), 6, 760)
    result.relationSummary = compactLines(
      characters.flatMap((character) => character.relationSummaries.map((line) => `${character.name}：${line}`)),
      8,
      760,
    ) || ''
    result.dialogueVoiceLocks = mergePreservingBase(
      baseContextParts?.dialogueVoiceLocks,
      compactLines(
        characters.flatMap((character) => character.voiceHints.map((hint) => `${character.name}：${hint}`)),
        8,
        760,
      ),
      10,
      820,
    )
  }
  if (items.length > 0) {
    result.itemSummary = compactLines(items.map((item) => `${item.name}：${item.summary}`), 6, 720)
  }
  if (timeline.length > 0) {
    result.timelineSummary = compactLines(
      timeline.map((item) => `${item.timeLabel || '时间未标注'} · ${item.title}${item.summary ? `：${item.summary}` : ''}`),
      6,
      760,
    )
    result.timelineOpenThreads = compactLines(
      timeline.flatMap((item) => item.openThreads.map((thread) => `${item.title}：${thread}`)),
      6,
      640,
    ) || result.timelineOpenThreads
  }
  if (worldStatePack) {
    result.worldStates = compactLines([
      ...worldStatePack.stateLines,
      ...worldStatePack.alertLines,
    ], 6, 760) || result.worldStates
  }
  if (threadPack) {
    result.activeThreads = mergePreservingBase(
      result.activeThreads || baseContextParts?.activeThreads,
      compactLines(threadPack.activeThreadLines, 6, 720),
      8,
      760,
    )
    result.openLoops = mergePreservingBase(
      baseContextParts?.openLoops,
      compactLines(threadPack.openLoopLines, 6, 640),
      8,
      760,
    )
    result.dueForeshadows = mergePreservingBase(
      baseContextParts?.dueForeshadows,
      compactLines(threadPack.dueForeshadowLines, 6, 640),
      8,
      760,
    )
    result.continuityNotes = mergePreservingBase(
      result.continuityNotes || baseContextParts?.continuityNotes,
      compactLines(threadPack.continuityLines, 6, 640),
      8,
      760,
    )
  }
  if (recallHits.length > 0) {
    result.recalledMemory = compactLines(
      recallHits.map((hit) => `[${hit.bucket}] Ch.${hit.chapterNum} ${hit.fragmentType}：${hit.summary}`),
      6,
      860,
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
          if (step.bucket === 'story_memory') return key === 'longTermMemory' || key === 'activeThreads' || key === 'continuityNotes'
          if (step.bucket === 'character') return key === 'characterStates' || key === 'relationSummary' || key === 'dialogueVoiceLocks'
          if (step.bucket === 'item') return key === 'itemSummary'
          if (step.bucket === 'timeline') return key === 'timelineSummary' || key === 'timelineOpenThreads'
          if (step.bucket === 'world_state') return key === 'worldStates'
          if (step.bucket === 'thread') return key === 'activeThreads' || key === 'openLoops' || key === 'dueForeshadows' || key === 'continuityNotes'
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
          status: 'failed',
          resultCount,
          errorMessage: 'world state pack empty',
          fallbackEvent: makeFallbackEvent('world_state', 'empty_result', '世界状态查询无有效结果。', 'legacy_empty'),
        }
      },
    },
    thread: {
      bucket: 'thread',
      toolName: 'thread.get_pack',
      execute: (_step, context, accumulator) => {
        const threadRows = context.services.listStoryThreads(context.input.novelId)
          .slice(0, Math.max(context.runtimeLimits.maxThreads, 6))
        const foreshadowSnapshot = context.services.getForeshadowSnapshot(context.input.novelId, context.input.chapterNum)
        accumulator.threadPack = renderThreadPack(threadRows, foreshadowSnapshot, context.input.signals)
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
        const filteredHits = result.hits
          .filter((hit) => hit.chapterNum < context.input.chapterNum)
          .slice(0, step.resultLimit || context.runtimeLimits.maxRecallHits)
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
        const filteredHits = result.hits
          .filter((hit) => hit.chapterNum < context.input.chapterNum)
          .slice(0, step.resultLimit || context.runtimeLimits.maxRecallHits)
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
        const filteredHits = result.hits
          .filter((hit) => hit.chapterNum < context.input.chapterNum)
          .slice(0, step.resultLimit || context.runtimeLimits.maxRecallHits)
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
    accumulator.characterEntries,
    accumulator.itemEntries,
    accumulator.timelineEntries,
    accumulator.worldStatePack,
    accumulator.threadPack,
    accumulator.recallHits,
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
      characters: accumulator.characterEntries,
      items: accumulator.itemEntries,
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
