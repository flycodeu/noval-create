import type { WebContents } from 'electron'
import { asc, eq } from 'drizzle-orm'
import type {
  Character as AppCharacter,
  EntityRegenerateOptions,
  MapNodeSummary,
  StoryArc as AppStoryArc,
  StoryItemEventLinkRecommendation,
  StoryItemLinkApplyResult,
  StoryItemLinkRecommendationResult,
  StoryItemLinkedSegmentSummary,
  StoryItemSegmentLinkRecommendation,
  StoryItem as AppStoryItem,
  StoryItemDetailContext,
  StoryItemSourceContext,
  TimelineEvent as AppTimelineEvent,
} from '../../src/types'
import { getDb, getSqlite } from '../database/db'
import { chapterSegments, chapters, characters, novels, storyArcs, storyItems, timelineEvents, worldMap } from '../database/schema'
import { safeParseJson } from '../utils/json'
import { buildStoryProfile } from './context.service'
import {
  getAttemptCount,
  getRecentRejectedDigests,
  markRejected,
  recordGeneration,
} from './generation-history.service'
import { createTask, executeChatTask, runChatTask, updateTask } from './task.service'
import { syncStoryItemTimelineLinks } from './link-sync.service'
import { recordAssetChangeEvent } from './asset-impact.service'
import {
  buildItemTemplateSummary,
  getItemGenerationProfile,
  resolveGenreFamily,
} from '../../src/shared/creation-tools'
import { getFactionNameOptions, parseWorldRulesJson } from '../../src/shared/genre-system'
import {
  buildContextAlignmentRules,
  buildGenreRealityRules,
  buildHumanLanguageRules,
  buildOutputQualityRules,
} from '../../src/shared/prompt-library'
import {
  buildNameFallbackPointer,
  buildTypedRefOverlay,
  parseTypedRefOverlay,
  stringifyTypedRefOverlay,
} from '../../src/shared/typed-ref'
import { cleanAiFieldText, cleanAiStringArray, cleanAiValue } from '../../src/utils/text'
import { markNovelContextChanged } from './context-impact.service'
import { runAssetQualityLoop, summarizeAssetQualityWarnings } from './asset-quality.service'
import {
  appendVariationMessage,
  buildVariationDigest,
  isRejectedDigestTooSimilar,
} from './variation-control.service'
import { resolveFactionNamesFromReferences } from './faction-reference.service'
import { cleanupStoryItemSoftReferences } from './data-cascade.service'
import { refreshWorldStateVersionsForNovel } from './world-state.service'
import { throwUserFacingError } from '../utils/user-facing-error'

type StoryItemStatus = 'available' | 'consumed' | 'hidden' | 'destroyed'

export interface StoryItemGenerateOptions {
  count?: number
  batchSize?: number
  focus?: string
  templateOnly?: boolean
  refreshTemplates?: boolean
}

export interface StoryItemBatchChunkResult {
  ids: number[]
  warning?: string
  batchDigest?: string
}

interface GeneratedStoryItem {
  template_name?: unknown
  item_name?: unknown
  category?: unknown
  sub_type?: unknown
  rarity?: unknown
  owner_name?: unknown
  location_name?: unknown
  event_title?: unknown
  summary?: unknown
  acquisition_method?: unknown
  usage_method?: unknown
  cost?: unknown
  risk?: unknown
  plot_function?: unknown
  appearance?: unknown
  faction_hint?: unknown
  linked_character_names?: unknown
  typed_refs?: unknown
  tags?: unknown
}

interface StoryItemQueryFilters {
  novelId: number
  itemKind?: 'template' | 'instance'
  recordStatus?: 'draft' | 'confirmed' | 'all'
  category?: string
  status?: StoryItemStatus
  keyword?: string
  page?: number
  pageSize?: number
}

function asText(value: unknown): string {
  return typeof value === 'string' ? cleanAiFieldText(value) : ''
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return cleanAiStringArray(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    )
  }

  const text = asText(value)
  if (!text) return []
  return cleanAiStringArray(text.split(/[\n,]/))
}

function stringifyNumberArray(value: number[]): string {
  return JSON.stringify(value.filter((item) => Number.isFinite(item)))
}

function stringifyStringArray(value: string[]): string {
  return JSON.stringify(cleanAiStringArray(value))
}

function resolveFactionJson(novelId: number, raw?: string | null): string | undefined {
  const names = resolveFactionNamesFromReferences(novelId, raw)
  return names.length > 0 ? JSON.stringify(names) : undefined
}

function normalizeLookup(input: string): string {
  return input.trim().replace(/\s+/g, '').toLowerCase()
}

function resolveIdByName<T extends { id: number }>(
  rows: T[],
  getName: (row: T) => string,
  value: unknown,
): number | undefined {
  const target = normalizeLookup(asText(value))
  if (!target) return undefined

  const exact = rows.find((row) => normalizeLookup(getName(row)) === target)
  if (exact) return exact.id

  const fuzzy = rows.find((row) => {
    const current = normalizeLookup(getName(row))
    return current.includes(target) || target.includes(current)
  })
  return fuzzy?.id
}

function resolveCharacterIds(
  rows: Array<typeof characters.$inferSelect>,
  names: string[],
): number[] {
  return [...new Set(names
    .map((name) => resolveIdByName(rows, (row) => row.fullName, name))
    .filter((value): value is number => typeof value === 'number'))]
}

function normalizeStatus(value: unknown): StoryItemStatus {
  const text = asText(value)
  if (text === 'consumed' || text === 'hidden' || text === 'destroyed') return text
  return 'available'
}

function normalizeRecordStatus(value: unknown): 'draft' | 'confirmed' {
  return asText(value) === 'draft' ? 'draft' : 'confirmed'
}

function getNextSortOrder(novelId: number): number {
  const rows = listStoryItems(novelId)
  return rows.length > 0 ? Math.max(...rows.map((row) => row.sortOrder || 0)) + 1 : 1
}

function sanitizeStoryItemPayload(
  data: Partial<typeof storyItems.$inferInsert>,
): Partial<typeof storyItems.$inferInsert> {
  const next: Partial<typeof storyItems.$inferInsert> = {}

  if (typeof data.itemKind === 'string') next.itemKind = data.itemKind
  if (typeof data.parentItemId === 'number') next.parentItemId = Math.round(data.parentItemId)
  if (typeof data.itemName === 'string') next.itemName = cleanAiFieldText(data.itemName)
  if (typeof data.genreFamily === 'string') next.genreFamily = cleanAiFieldText(data.genreFamily)
  if (typeof data.category === 'string') next.category = cleanAiFieldText(data.category)
  if (typeof data.subType === 'string') next.subType = cleanAiFieldText(data.subType)
  if (typeof data.rarity === 'string') next.rarity = cleanAiFieldText(data.rarity)
  if (typeof data.recordStatus === 'string') next.recordStatus = normalizeRecordStatus(data.recordStatus)
  if ('ownerCharacterId' in data) next.ownerCharacterId = data.ownerCharacterId ?? null
  if ('locationMapId' in data) next.locationMapId = data.locationMapId ?? null
  if (typeof data.status === 'string') next.status = normalizeStatus(data.status)
  if (typeof data.summary === 'string') next.summary = cleanAiFieldText(data.summary)
  if (typeof data.acquisitionMethod === 'string') next.acquisitionMethod = cleanAiFieldText(data.acquisitionMethod)
  if (typeof data.usageMethod === 'string') next.usageMethod = cleanAiFieldText(data.usageMethod)
  if (typeof data.cost === 'string') next.cost = cleanAiFieldText(data.cost)
  if (typeof data.risk === 'string') next.risk = cleanAiFieldText(data.risk)
  if (typeof data.plotFunction === 'string') next.plotFunction = cleanAiFieldText(data.plotFunction)
  if (typeof data.appearance === 'string') next.appearance = cleanAiFieldText(data.appearance)
  if (typeof data.factionHint === 'string') next.factionHint = cleanAiFieldText(data.factionHint)
  if (typeof data.linkedCharacterIdsJson === 'string') next.linkedCharacterIdsJson = data.linkedCharacterIdsJson
  if (typeof data.linkedTimelineEventIdsJson === 'string') next.linkedTimelineEventIdsJson = data.linkedTimelineEventIdsJson
  if (typeof data.typedRefsJson === 'string') next.typedRefsJson = data.typedRefsJson
  if (typeof data.tagsJson === 'string') next.tagsJson = data.tagsJson
  if (typeof data.sourceContextJson === 'string') next.sourceContextJson = data.sourceContextJson
  if (typeof data.sortOrder === 'number') next.sortOrder = Math.round(data.sortOrder)

  return next
}

function buildCharacterSummary(rows: Array<typeof characters.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => {
      const pieces = [row.roleType, row.species, row.occupation, row.rankLevel].filter(Boolean)
      return `- ${row.fullName}${pieces.length > 0 ? `\uFF08${pieces.join(' / ')}\uFF09` : ''}`
    })
    .join('\n')
}

function buildLocationSummary(rows: Array<typeof worldMap.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => {
      const pieces = [row.nodeType, row.structureRole].filter(Boolean)
      return `- ${row.name}${pieces.length > 0 ? `\uFF08${pieces.join(' / ')}\uFF09` : ''}`
    })
    .join('\n')
}

function buildArcSummary(rows: Array<typeof storyArcs.$inferSelect>): string {
  return rows
    .sort((left, right) => left.arcOrder - right.arcOrder)
    .slice(0, 8)
    .map((row) => `- ${row.arcName}\uFF1A${row.arcGoal || row.arcSummary || '\u672A\u8865\u5145'}`)
    .join('\n')
}

function buildEventSummary(rows: Array<typeof timelineEvents.$inferSelect>): string {
  return rows
    .slice(0, 10)
    .map((row) => `- ${row.timeLabel}\uFF1A${row.eventTitle}`)
    .join('\n')
}

function buildExistingItemSummary(rows: Array<typeof storyItems.$inferSelect>): string {
  return rows
    .filter((row) => row.itemKind === 'instance')
    .slice(0, 12)
    .map((row) => {
      const parts = [row.category, row.locationMapId ? 'linked location' : '', row.ownerCharacterId ? 'linked owner' : '']
        .filter(Boolean)
        .join(' / ')
      return `- ${row.itemName}${parts ? ` (${parts})` : ''}`
    })
    .join('\n')
}

function parseJsonNumberArray(raw?: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : Number(item)))
      .filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function uniqueNumberArray(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)))]
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function parseSourceContexts(raw?: string | null): StoryItemSourceContext[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
      .map((item) => ({
        page: typeof item.page === 'string' ? item.page : undefined,
        label: typeof item.label === 'string' ? item.label : undefined,
        detectedAt: typeof item.detectedAt === 'string' ? item.detectedAt : undefined,
        typedRefJson: typeof item.typedRefJson === 'string' ? item.typedRefJson : undefined,
      }))
      .filter((item) => item.page || item.label || item.detectedAt || item.typedRefJson)
  } catch {
    return []
  }
}

function deriveItemTypedRefsJson(params: {
  typedRefsJson?: string | null
  linkedCharacterIdsJson?: string | null
  linkedTimelineEventIdsJson?: string | null
  ownerCharacterId?: number | null
}): string | undefined {
  const explicit = parseTypedRefOverlay(params.typedRefsJson)
  if (explicit) return stringifyTypedRefOverlay(explicit)

  const characterIds = parseJsonNumberArray(params.linkedCharacterIdsJson)
  const eventIds = parseJsonNumberArray(params.linkedTimelineEventIdsJson)
  const overlay = buildTypedRefOverlay([
    ...(typeof params.ownerCharacterId === 'number'
      ? [buildNameFallbackPointer('character', { id: params.ownerCharacterId, confidence: 1 })]
      : []),
    ...characterIds.map((id) => buildNameFallbackPointer('character', { id, confidence: 1 })),
    ...eventIds.map((id) => buildNameFallbackPointer('timeline_event', { id, confidence: 1 })),
  ])
  return stringifyTypedRefOverlay(overlay)
}

function resolveTypedRefIds<T extends { id: number }>(
  raw: unknown,
  assetType: 'character' | 'timeline_event',
  rows: T[],
  getName: (row: T) => string,
): number[] {
  const overlay = parseTypedRefOverlay(typeof raw === 'string' ? raw : raw == null ? undefined : JSON.stringify(raw))
  if (!overlay) return []
  return [...new Set(overlay.pointers
    .filter((pointer) => pointer.assetType === assetType)
    .map((pointer) => {
      if (typeof pointer.id === 'number') return pointer.id
      const candidates = [pointer.name, ...(pointer.alias || [])].filter((item): item is string => Boolean(item))
      for (const candidate of candidates) {
        const resolved = resolveIdByName(rows, getName, candidate)
        if (typeof resolved === 'number') return resolved
      }
      return undefined
    })
    .filter((value): value is number => typeof value === 'number'))]
}

function mapMapNodeSummary(
  row: typeof worldMap.$inferSelect,
  childCountByParentId: Map<number, number>,
): MapNodeSummary {
  return {
    id: row.id,
    novelId: row.novelId,
    level: row.level,
    parentId: row.parentId ?? undefined,
    name: row.name,
    locationType: row.locationType ?? undefined,
    nodeType: row.nodeType ?? undefined,
    structureRole: row.structureRole ?? undefined,
    parentRuleType: row.parentRuleType ?? undefined,
    description: row.description ?? undefined,
    atmosphere: row.atmosphere ?? undefined,
    plotRelevance: row.plotRelevance ?? undefined,
    tagsJson: row.tagsJson ?? undefined,
    affiliatedFactionIdsJson: resolveFactionJson(row.novelId, row.affiliatedFactionIdsJson),
    dangerLevel: row.dangerLevel ?? undefined,
    sortOrder: row.sortOrder || 0,
    childCount: childCountByParentId.get(row.id) || 0,
  }
}

function mapStoryItemEntity(row: typeof storyItems.$inferSelect): AppStoryItem {
  return {
    ...row,
    itemKind: row.itemKind === 'template' ? 'template' : 'instance',
    parentItemId: row.parentItemId ?? undefined,
    genreFamily: row.genreFamily ?? undefined,
    category: row.category ?? undefined,
    subType: row.subType ?? undefined,
    rarity: row.rarity ?? undefined,
    recordStatus: row.recordStatus === 'draft' ? 'draft' : 'confirmed',
    ownerCharacterId: row.ownerCharacterId ?? undefined,
    locationMapId: row.locationMapId ?? undefined,
    status: row.status === 'consumed' || row.status === 'hidden' || row.status === 'destroyed' ? row.status : 'available',
    summary: row.summary ?? undefined,
    acquisitionMethod: row.acquisitionMethod ?? undefined,
    usageMethod: row.usageMethod ?? undefined,
    cost: row.cost ?? undefined,
    risk: row.risk ?? undefined,
    plotFunction: row.plotFunction ?? undefined,
    appearance: row.appearance ?? undefined,
    factionHint: row.factionHint ?? undefined,
    linkedCharacterIdsJson: row.linkedCharacterIdsJson ?? undefined,
    linkedTimelineEventIdsJson: row.linkedTimelineEventIdsJson ?? undefined,
    typedRefsJson: row.typedRefsJson ?? undefined,
    tagsJson: row.tagsJson ?? undefined,
    sourceContextJson: row.sourceContextJson ?? undefined,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  } as AppStoryItem
}

function mapCharacterEntity(row: typeof characters.$inferSelect): AppCharacter {
  return {
    ...row,
    roleType: row.roleType === 'protagonist' || row.roleType === 'major' || row.roleType === 'antagonist' || row.roleType === 'supporting'
      ? row.roleType
      : 'minor',
    recordStatus: row.recordStatus === 'draft' ? 'draft' : 'confirmed',
    entityType: row.entityType ?? undefined,
    species: row.species ?? undefined,
    surname: row.surname ?? undefined,
    givenName: row.givenName ?? undefined,
    gender: row.gender ?? undefined,
    age: row.age ?? undefined,
    birthplace: row.birthplace ?? undefined,
    occupation: row.occupation ?? undefined,
    rankLevel: row.rankLevel ?? undefined,
    socialIdentity: row.socialIdentity ?? undefined,
    background: row.background ?? undefined,
    personalityTraitsJson: row.personalityTraitsJson ?? undefined,
    flawsJson: row.flawsJson ?? undefined,
    habitsJson: row.habitsJson ?? undefined,
    campFactionIdsJson: resolveFactionJson(row.novelId, row.campFactionIdsJson),
    powerSystemRefsJson: row.powerSystemRefsJson ?? undefined,
    contextHooksJson: row.contextHooksJson ?? undefined,
    goals: row.goals ?? undefined,
    firstImpression: row.firstImpression ?? undefined,
    surfaceDesire: row.surfaceDesire ?? undefined,
    deepNeed: row.deepNeed ?? undefined,
    coreFear: row.coreFear ?? undefined,
    innerConflict: row.innerConflict ?? undefined,
    hiddenSecret: row.hiddenSecret ?? undefined,
    moralLine: row.moralLine ?? undefined,
    selfDeception: row.selfDeception ?? undefined,
    trauma: row.trauma ?? undefined,
    contradiction: row.contradiction ?? undefined,
    relationshipTension: row.relationshipTension ?? undefined,
    resonancePoint: row.resonancePoint ?? undefined,
    characterArc: row.characterArc ?? undefined,
    appearanceJson: row.appearanceJson ?? undefined,
    abilitiesJson: row.abilitiesJson ?? undefined,
    sourceContextJson: row.sourceContextJson ?? undefined,
    appearChapter: row.appearChapter ?? undefined,
    sortOrder: row.sortOrder || 0,
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  } as AppCharacter
}

function mapTimelineEventEntity(row: typeof timelineEvents.$inferSelect): AppTimelineEvent {
  return {
    ...row,
    sortOrder: row.sortOrder || 0,
    eventSummary: row.eventSummary ?? undefined,
    timeMode: row.timeMode || 'custom-era',
    timeLabel: row.timeLabel || '',
    timeSortValue: row.timeSortValue || 0,
    timePrecision: row.timePrecision ?? undefined,
    isMajorEvent: row.isMajorEvent || 0,
    eventType: row.eventType ?? undefined,
    arcId: row.arcId ?? undefined,
    volumeId: row.volumeId ?? undefined,
    partId: row.partId ?? undefined,
    chapterStartId: row.chapterStartId ?? undefined,
    chapterEndId: row.chapterEndId ?? undefined,
    segmentId: row.segmentId ?? undefined,
    locationMapId: row.locationMapId ?? undefined,
    presentCharacterIdsJson: row.presentCharacterIdsJson ?? undefined,
    affectedCharacterIdsJson: row.affectedCharacterIdsJson ?? undefined,
    protagonistPresent: row.protagonistPresent || 0,
    protagonistAction: row.protagonistAction ?? undefined,
    eventCause: row.eventCause ?? undefined,
    eventProcess: row.eventProcess ?? undefined,
    eventResult: row.eventResult ?? undefined,
    linkedItemIdsJson: row.linkedItemIdsJson ?? undefined,
    directConsequencesJson: row.directConsequencesJson ?? undefined,
    openThreadsJson: row.openThreadsJson ?? undefined,
    notes: row.notes ?? undefined,
    anchorInvalid: row.anchorInvalid || 0,
    status: row.status === 'seeded' || row.status === 'written' || row.status === 'resolved' ? row.status : 'planned',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
  } as AppTimelineEvent
}

function mapStoryArcEntity(row: typeof storyArcs.$inferSelect): AppStoryArc {
  return {
    ...row,
    chapterStart: row.chapterStart ?? undefined,
    chapterEnd: row.chapterEnd ?? undefined,
    arcGoal: row.arcGoal ?? undefined,
    arcSummary: row.arcSummary ?? undefined,
    growthLedger: row.growthLedger ?? undefined,
    costLedger: row.costLedger ?? undefined,
    targetWords: row.targetWords || 0,
  } as AppStoryArc
}

function buildEmptyStoryItemDetailContext(): StoryItemDetailContext {
  return {
    item: null,
    parentTemplate: null,
    ownerCharacter: null,
    location: null,
    relatedCharacters: [],
    relatedEvents: [],
    relatedArcs: [],
    relatedLocations: [],
    relatedSegments: [],
    derivedInstances: [],
    siblingInstances: [],
    sourceContexts: [],
  }
}

function normalizeMatchText(value?: string | null): string {
  return (value || '').replace(/\s+/g, '').trim().toLowerCase()
}

function buildMatchTokens(values: Array<string | null | undefined>): string[] {
  const tokens = values.flatMap((value) => {
    const text = cleanAiFieldText(value || '')
    if (!text) return []
    const parts = text
      .split(/[\s,，。；、\/|（）()：:《》“”"'‘’\[\]【】\n\r\t-]+/)
      .map((item) => cleanAiFieldText(item))
      .filter((item) => item.length >= 2)
    return [text, ...parts]
  })

  return [...new Set(tokens.map((item) => normalizeMatchText(item)).filter((item) => item.length >= 2))]
}

function buildReasonSummary(reasons: string[]): string {
  return [...new Set(reasons.filter(Boolean))].join('；')
}

function clipMatchText(value?: string | null, maxLength = 72): string {
  const text = cleanAiFieldText(value || '')
  if (!text) return ''
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function buildSegmentLabel(chapterNum: number, segmentOrder: number, title?: string | null): string {
  const base = `第${chapterNum}章 · 场景${String(segmentOrder).padStart(2, '0')}`
  return title?.trim() ? `${base} · ${title.trim()}` : base
}

function mapStoryItemLinkedSegmentSummary(
  segment: typeof chapterSegments.$inferSelect,
  chapter: typeof chapters.$inferSelect | undefined,
): StoryItemLinkedSegmentSummary {
  const chapterNum = chapter?.chapterNum || 0
  return {
    segmentId: segment.id,
    chapterId: segment.chapterId,
    chapterNum,
    chapterTitle: chapter?.title?.trim() || `第${chapterNum}章`,
    segmentOrder: segment.segmentOrder,
    title: segment.title?.trim() || buildSegmentLabel(chapterNum, segment.segmentOrder, ''),
    purpose: segment.purpose ?? undefined,
    summary: segment.summary ?? undefined,
    locationName: segment.locationName ?? undefined,
  }
}

function scoreStoryItemEventRecommendation(input: {
  item: AppStoryItem
  event: AppTimelineEvent
  ownerName: string
  locationName: string
  directTokens: string[]
  detailTokens: string[]
  eventCharacterNames: string[]
  eventLocationName: string
  alreadyLinked: boolean
}): StoryItemEventLinkRecommendation | null {
  if (input.alreadyLinked) return null

  const eventText = [
    input.event.eventTitle,
    input.event.eventSummary,
    input.event.eventCause,
    input.event.eventProcess,
    input.event.eventResult,
    input.event.notes,
    input.eventLocationName,
    ...input.eventCharacterNames,
  ].filter(Boolean).join('\n')
  const normalizedEventText = normalizeMatchText(eventText)
  if (!normalizedEventText) return null

  let score = 0
  const reasons: string[] = []

  for (const token of input.directTokens) {
    if (!token || !normalizedEventText.includes(token)) continue
    score += 60
    reasons.push(`物品名命中“${input.item.itemName}”`)
    break
  }

  const detailHits = input.detailTokens.filter((token) => token && normalizedEventText.includes(token))
  if (detailHits.length > 0) {
    score += Math.min(detailHits.length * 12, 36)
    reasons.push(`剧情说明命中 ${detailHits.length} 处`)
  }

  const normalizedOwner = normalizeMatchText(input.ownerName)
  if (normalizedOwner && input.eventCharacterNames.some((name) => normalizeMatchText(name) === normalizedOwner)) {
    score += 20
    reasons.push(`角色共现：${input.ownerName}`)
  }

  const normalizedLocation = normalizeMatchText(input.locationName)
  if (normalizedLocation && (normalizeMatchText(input.eventLocationName) === normalizedLocation || normalizedEventText.includes(normalizedLocation))) {
    score += 16
    reasons.push(`地点共现：${input.locationName}`)
  }

  if (score < 28) return null

  return {
    eventId: input.event.id,
    eventTitle: input.event.eventTitle,
    timeLabel: input.event.timeLabel,
    score,
    reason: buildReasonSummary(reasons) || '与当前物品的文本线索高度重叠。',
    alreadyLinked: false,
  }
}

function scoreStoryItemSegmentRecommendation(input: {
  item: AppStoryItem
  segment: typeof chapterSegments.$inferSelect
  chapter: typeof chapters.$inferSelect | undefined
  ownerName: string
  locationName: string
  directTokens: string[]
  detailTokens: string[]
  segmentCharacterNames: string[]
  alreadyLinked: boolean
}): StoryItemSegmentLinkRecommendation | null {
  if (input.alreadyLinked) return null

  const segmentText = [
    input.segment.title,
    input.segment.purpose,
    input.segment.summary,
    input.segment.content,
    input.segment.inputState,
    input.segment.outputState,
    input.segment.timeAnchor,
    input.segment.locationName,
    ...input.segmentCharacterNames,
  ].filter(Boolean).join('\n')
  const normalizedSegmentText = normalizeMatchText(segmentText)
  if (!normalizedSegmentText) return null

  let score = 0
  const reasons: string[] = []

  for (const token of input.directTokens) {
    if (!token || !normalizedSegmentText.includes(token)) continue
    score += 60
    reasons.push(`物品名命中“${input.item.itemName}”`)
    break
  }

  const detailHits = input.detailTokens.filter((token) => token && normalizedSegmentText.includes(token))
  if (detailHits.length > 0) {
    score += Math.min(detailHits.length * 12, 36)
    reasons.push(`剧情说明命中 ${detailHits.length} 处`)
  }

  const normalizedOwner = normalizeMatchText(input.ownerName)
  if (normalizedOwner && input.segmentCharacterNames.some((name) => normalizeMatchText(name) === normalizedOwner)) {
    score += 20
    reasons.push(`角色共现：${input.ownerName}`)
  }

  const normalizedLocation = normalizeMatchText(input.locationName)
  if (normalizedLocation && normalizeMatchText(input.segment.locationName) === normalizedLocation) {
    score += 16
    reasons.push(`地点共现：${input.locationName}`)
  }

  if (score < 28) return null

  const chapterNum = input.chapter?.chapterNum || 0
  return {
    segmentId: input.segment.id,
    chapterId: input.segment.chapterId,
    chapterNum,
    chapterTitle: input.chapter?.title?.trim() || `第${chapterNum}章`,
    segmentOrder: input.segment.segmentOrder,
    segmentTitle: input.segment.title?.trim() || buildSegmentLabel(chapterNum, input.segment.segmentOrder, ''),
    score,
    reason: buildReasonSummary(reasons) || '与当前物品的文本线索高度重叠。',
    alreadyLinked: false,
  }
}

function normalizeSignaturePart(value?: string | null): string {
  return (value || '').replace(/\s+/g, '').trim().toLowerCase()
}

function buildItemSignature(payload: Partial<typeof storyItems.$inferInsert>): string {
  return [
    normalizeSignaturePart(typeof payload.itemName === 'string' ? payload.itemName : ''),
    normalizeSignaturePart(typeof payload.category === 'string' ? payload.category : ''),
    normalizeSignaturePart(typeof payload.subType === 'string' ? payload.subType : ''),
    normalizeSignaturePart(typeof payload.plotFunction === 'string' ? payload.plotFunction : ''),
    typeof payload.ownerCharacterId === 'number' ? String(payload.ownerCharacterId) : '',
    typeof payload.locationMapId === 'number' ? String(payload.locationMapId) : '',
    parseJsonNumberArray(typeof payload.linkedTimelineEventIdsJson === 'string' ? payload.linkedTimelineEventIdsJson : '')
      .sort((left, right) => left - right)
      .join(','),
  ].filter(Boolean).join('|')
}

function buildItemCurrentSummary(item: typeof storyItems.$inferSelect): string {
  return [
    `名称：${item.itemName}`,
    item.category ? `分类：${item.category}` : '',
    item.subType ? `子类：${item.subType}` : '',
    item.rarity ? `稀有度：${item.rarity}` : '',
    typeof item.ownerCharacterId === 'number' ? `拥有者ID：${item.ownerCharacterId}` : '',
    typeof item.locationMapId === 'number' ? `地点ID：${item.locationMapId}` : '',
    item.summary ? `摘要：${item.summary}` : '',
    item.plotFunction ? `剧情功能：${item.plotFunction}` : '',
    item.acquisitionMethod ? `获取方式：${item.acquisitionMethod}` : '',
    item.usageMethod ? `使用方式：${item.usageMethod}` : '',
    item.cost ? `代价：${item.cost}` : '',
    item.risk ? `风险：${item.risk}` : '',
    item.appearance ? `外观：${item.appearance}` : '',
    item.factionHint ? `势力线索：${item.factionHint}` : '',
  ].filter(Boolean).join('\n')
}

function buildStoryCoreSummary(profile: Awaited<ReturnType<typeof buildStoryProfile>>): string {
  return [
    `故事目标：${profile.storyGoal || '未提供'}`,
    `核心冲突：${profile.coreConflict || '未提供'}`,
    `主线剧情：${profile.mainPlot || '未提供'}`,
    `结局方向：${profile.ending || '未提供'}`,
  ].join('\n')
}

function buildItemReviewContext(input: {
  profile: Awaited<ReturnType<typeof buildStoryProfile>>
  storyCore: string
  characterSummary: string
  locationSummary: string
  factionSummary: string
  arcSummary: string
  eventSummary: string
  existingItemSummary: string
  currentSummary?: string
  focus?: string
  mode?: 'repair' | 'replace'
}): string {
  return [
    `题材：${input.profile.genre}`,
    input.profile.background ? `背景：${input.profile.background}` : '',
    input.profile.worldRulesSummary ? `世界规则：${input.profile.worldRulesSummary}` : '',
    input.storyCore ? `故事核心：\n${input.storyCore}` : '',
    input.currentSummary ? `当前物品：\n${input.currentSummary}` : '',
    input.characterSummary ? `人物：\n${input.characterSummary}` : '',
    input.locationSummary ? `地点：\n${input.locationSummary}` : '',
    input.factionSummary ? `势力：\n${input.factionSummary}` : '',
    input.arcSummary ? `故事弧：\n${input.arcSummary}` : '',
    input.eventSummary ? `时间轴事件：\n${input.eventSummary}` : '',
    input.existingItemSummary ? `已有物品：\n${input.existingItemSummary}` : '',
    input.focus ? `本轮聚焦：${input.focus}` : '',
    input.mode ? `当前模式：${input.mode}` : '',
  ].filter(Boolean).join('\n\n')
}

function itemSchemaHint(expectedCount?: number): string {
  return [
    typeof expectedCount === 'number'
      ? `输出必须保持为 ${expectedCount} 个物品对象组成的 JSON 数组。`
      : '输出必须保持为单个物品 JSON 对象。',
    '不要改变字段结构，不要把物品卡改写成散文说明。',
    '名称、功能、代价、风险、剧情作用等核心字段必须保留并具体化。',
  ].join('\n')
}

function buildItemRepairPrompt(input: {
  novelTitle: string
  genre: string
  background: string
  worldSummary: string
  storyCore: string
  characterSummary: string
  locationSummary: string
  eventSummary: string
  currentSummary: string
  mode: 'repair' | 'replace'
}) {
  return [
    `你是中文长篇小说的物品编辑。现在要${input.mode === 'replace' ? '重做' : '修正'}下面这个故事物品，同时保留它在当前小说里的功能槽位。`,
    buildSection('故事上下文', [
      `小说：${input.novelTitle}`,
      `题材：${input.genre || '未提供'}`,
      `背景：${input.background || '未提供'}`,
      `世界规则：${input.worldSummary || '未提供'}`,
      `故事核心：${input.storyCore || '未提供'}`,
    ]),
    buildSection('当前物品', [input.currentSummary]),
    buildSection('周边资产', [
      input.characterSummary ? `人物：\n${input.characterSummary}` : '',
      input.locationSummary ? `地点：\n${input.locationSummary}` : '',
      input.eventSummary ? `时间轴事件：\n${input.eventSummary}` : '',
    ]),
    buildSection('修复目标', [
      input.mode === 'replace'
        ? '保留同一个资产槽位，但把名称、钩子、博弈点和回收作用换成明显不同的新方向。'
        : '保留同一个资产槽位，但去掉重复、空泛、AI 味和缺少剧情用途的问题。',
      '物品必须保持具体、可复用，并至少挂到一个人物、地点或事件上。',
      '只返回 1 个 JSON 对象，字段结构与批量物品生成保持一致。',
    ]),
    buildSection('输出格式', [
      '{"template_name":"existing template name or empty","item_name":"concrete item name","category":"category","sub_type":"specific subtype","rarity":"common/rare/core/forbidden","owner_name":"existing owner name or empty","location_name":"existing location name or empty","event_title":"existing event title or empty","summary":"one-sentence description","acquisition_method":"how it is obtained","usage_method":"how it is used","cost":"concrete cost","risk":"concrete risk","plot_function":"specific story function","appearance":"recognizable appearance","faction_hint":"related faction or organization","linked_character_names":["related character A"],"tags":["tag1","tag2"]}',
    ]),
  ].filter(Boolean).join('\n\n')
}

function buildSection(title: string, lines: Array<string | undefined | null | false>): string {
  const body = lines
    .map((line) => (typeof line === 'string' ? line.trim() : ''))
    .filter(Boolean)
    .join('\n')

  return body ? `【${title}】\n${body}` : ''
}

function buildPrompt(input: {
  novelTitle: string
  genre: string
  background: string
  worldSummary: string
  storyCore: string
  templateSummary: string
  characterSummary: string
  locationSummary: string
  factionSummary: string
  arcSummary: string
  eventSummary: string
  existingItemSummary: string
  focus?: string
  count: number
}) {
  return [
    `你是中文长篇小说的物品编辑。请为《${input.novelTitle}》生成 ${input.count} 个具体可用的故事物品实例。`,
    buildSection('本轮目标', [
      '生成的是能直接进入剧情的具体物品实例，不是抽象概念，也不是松散的分类名。',
      '每个物品都必须挂到人物、地点、事件、势力，或明确的流转路径上，方便后续章节直接回查。',
      '所有字段都必须是自然中文，除非上下文已经明确确立了外文术语。',
      input.focus ? `本轮侧重：${input.focus}` : '',
    ]),
    buildSection('故事上下文', [
      `题材：${input.genre}`,
      `背景：${input.background || '未提供'}`,
      `世界规则：${input.worldSummary || '未提供'}`,
      `故事核心：${input.storyCore || '未提供'}`,
    ]),
    buildSection('已有模板', [input.templateSummary || '当前没有可用模板摘要']),
    buildSection('人物', [input.characterSummary || '当前没有可用人物']),
    buildSection('地点', [input.locationSummary || '当前没有可用地点']),
    buildSection('势力', [input.factionSummary || '当前没有可用势力']),
    buildSection('故事弧', [input.arcSummary || '当前没有可用故事弧']),
    buildSection('时间轴事件', [input.eventSummary || '当前没有可用时间轴事件']),
    buildSection('已有物品实例', [input.existingItemSummary || '当前没有已有物品实例']),
    buildSection('上下文护栏', [
      buildContextAlignmentRules({
        background: input.background,
        storyCore: input.storyCore,
        worldSummary: input.worldSummary,
        taskFocus: '生成能被追踪、可复用，并能在后续章节被回收的具体物品。',
        extraLines: [
          '优先复用已有的人物、地点、事件、势力和模板，再考虑新增。',
          '每个物品都要回答：它为什么现在出现、谁在使用或争夺、它出现后改变了什么。',
        ],
      }),
    ]),
    buildSection('真实度护栏', [
      buildGenreRealityRules({
        genre: input.genre,
        worldSummary: input.worldSummary,
        extraLines: [
          '物品的强度、稀有度、流通方式、维护成本和危险性都必须服从当前世界秩序与资源逻辑。',
          '不要突然引入黑箱神器、万能道具，或没有解释的跨题材技术跳级。',
        ],
      }),
    ]),
    buildSection('输出质量底线', [
      buildOutputQualityRules([
        'summary、plot_function、cost 和 risk 必须具体、可验证，优先写条件、动作、限制和后果。',
        '每个物品至少要绑定一个人物、地点或事件；如果做不到，就在字段里写清它的来源和去向。',
        '不要输出万能道具、命运道具、空壳象征物，或只会空喊“推动剧情”的工具物。',
        '不要重复已有物品的名字、功能、来源或回收作用。',
        '避免口号句、伪诗化比喻、悬空抽象词和假深刻表达。',
      ], input.genre),
    ]),
    buildSection('语言要求', [
      buildHumanLanguageRules([
        '物品命名要像编辑会放进资产板里的名字，不要像营销口号。',
        'summary、plot_function、cost 和 risk 用短而自然的句子写，不要用抽象宣言。',
        '只写和这个物品直接相关的信息，不要滑进百科腔或无关世界观扩写。',
      ]),
    ]),
    buildSection('生成要求', [
      `必须返回 ${input.count} 个物品实例，JSON array 长度必须等于 ${input.count}。`,
      'template_name 优先对齐已有模板；如果没有合适模板，可以留空，但 item_name 必须具体。',
      'owner_name、location_name 和 event_title 优先复用已有资产；没有把握就留空，不要硬造新专有名词。',
      'summary 回答“这是什么”；plot_function 回答“它影响了哪条冲突、回收或博弈点”；cost 和 risk 要写清代价与后果。',
      'linked_character_names 填 0 到 3 个强相关角色；tags 填 2 到 5 个短标签。',
      'rarity、acquisition_method、usage_method、appearance 和 faction_hint 都必须具体、落地。',
    ]),
    buildSection('输出格式', [
      '只输出 JSON array，不要解释，不要 Markdown，不要代码块。',
      '[{"template_name":"existing template name or empty","item_name":"concrete item name","category":"category","sub_type":"specific subtype","rarity":"common/rare/core/forbidden","owner_name":"existing owner name or empty","location_name":"existing location name or empty","event_title":"existing event title or empty","summary":"one-sentence description","acquisition_method":"how it is obtained","usage_method":"how it is used","cost":"concrete cost","risk":"concrete risk","plot_function":"specific story function","appearance":"recognizable appearance","faction_hint":"related faction or organization","linked_character_names":["related character A"],"tags":["tag1","tag2"]}]',
    ]),
  ].filter(Boolean).join('\n\n')
}

function buildGeneratedPayload(
  raw: GeneratedStoryItem,
  context: {
    genreFamily: string
    templateRows: Array<typeof storyItems.$inferSelect>
    characterRows: Array<typeof characters.$inferSelect>
    mapRows: Array<typeof worldMap.$inferSelect>
    eventRows: Array<typeof timelineEvents.$inferSelect>
    sortOrder: number
  },
): Partial<typeof storyItems.$inferInsert> | null {
  const item = cleanAiValue(raw)
  const itemName = asText(item.item_name)
  if (!itemName) return null

  const templateId = resolveIdByName(context.templateRows, (row) => row.itemName, item.template_name)
  const ownerCharacterId = resolveIdByName(context.characterRows, (row) => row.fullName, item.owner_name) ?? null
  const locationMapId = resolveIdByName(context.mapRows, (row) => row.name, item.location_name) ?? null
  const eventId = resolveIdByName(context.eventRows, (row) => row.eventTitle, item.event_title)
  const typedCharacterIds = resolveTypedRefIds(item.typed_refs, 'character', context.characterRows, (row) => row.fullName)
  const typedEventIds = resolveTypedRefIds(item.typed_refs, 'timeline_event', context.eventRows, (row) => row.eventTitle)
  const linkedCharacterIds = typedCharacterIds.length > 0
    ? typedCharacterIds
    : resolveCharacterIds(
        context.characterRows,
        toStringArray(item.linked_character_names).concat(ownerCharacterId ? [] : toStringArray(item.owner_name)),
      )
  const resolvedEventIds = typedEventIds.length > 0
    ? typedEventIds
    : (typeof eventId === 'number' ? [eventId] : [])
  const typedRefsJson = stringifyTypedRefOverlay(buildTypedRefOverlay([
    ...(typeof ownerCharacterId === 'number'
      ? [buildNameFallbackPointer('character', {
          id: ownerCharacterId,
          name: context.characterRows.find((row) => row.id === ownerCharacterId)?.fullName,
          confidence: 0.95,
        })]
      : []),
    ...linkedCharacterIds
      .filter((id) => id !== ownerCharacterId)
      .map((id) => buildNameFallbackPointer('character', {
        id,
        name: context.characterRows.find((row) => row.id === id)?.fullName,
        confidence: typedCharacterIds.includes(id) ? 0.98 : 0.78,
      })),
    ...resolvedEventIds.map((id) => buildNameFallbackPointer('timeline_event', {
      id,
      name: context.eventRows.find((row) => row.id === id)?.eventTitle,
      confidence: typedEventIds.includes(id) ? 0.98 : 0.78,
    })),
  ]))

  return {
    itemKind: 'instance',
    parentItemId: templateId ?? null,
    itemName,
    genreFamily: context.genreFamily,
    category: asText(item.category),
    subType: asText(item.sub_type),
    rarity: asText(item.rarity),
    ownerCharacterId,
    locationMapId,
    status: normalizeStatus('available'),
    summary: asText(item.summary),
    acquisitionMethod: asText(item.acquisition_method),
    usageMethod: asText(item.usage_method),
    cost: asText(item.cost),
    risk: asText(item.risk),
    plotFunction: asText(item.plot_function),
    appearance: asText(item.appearance),
    factionHint: asText(item.faction_hint),
    linkedCharacterIdsJson: stringifyNumberArray(linkedCharacterIds),
    linkedTimelineEventIdsJson: stringifyNumberArray(resolvedEventIds),
    ...(typedRefsJson ? { typedRefsJson } : {}),
    tagsJson: stringifyStringArray(toStringArray(item.tags)),
    sortOrder: context.sortOrder,
  }
}

function normalizePaging(page?: number, pageSize?: number, fallbackPageSize = 24) {
  const nextPageSize = Math.max(1, Math.min(pageSize || fallbackPageSize, 200))
  const nextPage = Math.max(1, page || 1)
  const offset = (nextPage - 1) * nextPageSize
  return { page: nextPage, pageSize: nextPageSize, offset }
}

function buildPagedResult<T>(items: T[], page: number, pageSize: number, total: number) {
  return {
    items,
    page,
    pageSize,
    total,
    hasMore: page * pageSize < total,
  }
}

function mapStoryItemRecord(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    novelId: Number(row.novel_id),
    itemKind: String(row.item_kind || 'instance') as 'template' | 'instance',
    parentItemId: row.parent_item_id == null ? undefined : Number(row.parent_item_id),
    itemName: String(row.item_name || ''),
    genreFamily: typeof row.genre_family === 'string' ? row.genre_family : undefined,
    category: typeof row.category === 'string' ? row.category : undefined,
    subType: typeof row.sub_type === 'string' ? row.sub_type : undefined,
    rarity: typeof row.rarity === 'string' ? row.rarity : undefined,
    recordStatus: normalizeRecordStatus(row.record_status),
    ownerCharacterId: row.owner_character_id == null ? undefined : Number(row.owner_character_id),
    locationMapId: row.location_map_id == null ? undefined : Number(row.location_map_id),
    status: String(row.status || 'available') as StoryItemStatus,
    summary: typeof row.summary === 'string' ? row.summary : undefined,
    acquisitionMethod: typeof row.acquisition_method === 'string' ? row.acquisition_method : undefined,
    usageMethod: typeof row.usage_method === 'string' ? row.usage_method : undefined,
    cost: typeof row.cost === 'string' ? row.cost : undefined,
    risk: typeof row.risk === 'string' ? row.risk : undefined,
    plotFunction: typeof row.plot_function === 'string' ? row.plot_function : undefined,
    appearance: typeof row.appearance === 'string' ? row.appearance : undefined,
    factionHint: typeof row.faction_hint === 'string' ? row.faction_hint : undefined,
    linkedCharacterIdsJson: typeof row.linked_character_ids_json === 'string' ? row.linked_character_ids_json : undefined,
    linkedTimelineEventIdsJson: typeof row.linked_timeline_event_ids_json === 'string' ? row.linked_timeline_event_ids_json : undefined,
    typedRefsJson: typeof row.typed_refs_json === 'string' ? row.typed_refs_json : undefined,
    tagsJson: typeof row.tags_json === 'string' ? row.tags_json : undefined,
    sourceContextJson: typeof row.source_context_json === 'string' ? row.source_context_json : undefined,
    sortOrder: Number(row.sort_order || 0),
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

function parseTimelineLinkCount(raw?: unknown) {
  if (typeof raw !== 'string' || !raw) return 0
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function buildItemWhere(filters: StoryItemQueryFilters) {
  const whereClauses = ['i.novel_id = ?']
  const params: Array<number | string> = [filters.novelId]

  if (filters.itemKind) {
    whereClauses.push('i.item_kind = ?')
    params.push(filters.itemKind)
  }

  if (filters.recordStatus && filters.recordStatus !== 'all') {
    whereClauses.push("COALESCE(i.record_status, 'confirmed') = ?")
    params.push(filters.recordStatus)
  }

  if (filters.category) {
    whereClauses.push('i.category = ?')
    params.push(filters.category)
  }

  if (filters.status) {
    whereClauses.push('i.status = ?')
    params.push(filters.status)
  }

  const keyword = typeof filters.keyword === 'string' ? filters.keyword.trim() : ''
  if (keyword) {
    const like = `%${keyword}%`
    whereClauses.push(`
      (
        i.item_name LIKE ?
        OR COALESCE(i.category, '') LIKE ?
        OR COALESCE(i.sub_type, '') LIKE ?
        OR COALESCE(i.summary, '') LIKE ?
        OR COALESCE(i.plot_function, '') LIKE ?
        OR COALESCE(i.faction_hint, '') LIKE ?
      )
    `)
    params.push(like, like, like, like, like, like)
  }

  return {
    whereSql: whereClauses.join(' AND '),
    params,
  }
}

export function queryStoryItems(filters: StoryItemQueryFilters) {
  const sqlite = getSqlite()
  const paging = normalizePaging(filters.page, filters.pageSize, 24)
  const query = buildItemWhere(filters)
  const countRow = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM story_items i
    WHERE ${query.whereSql}
  `).get(...query.params) as { total?: number } | undefined

  const rows = sqlite.prepare(`
    SELECT i.*
    FROM story_items i
    WHERE ${query.whereSql}
    ORDER BY
      CASE i.item_kind WHEN 'template' THEN 0 ELSE 1 END ASC,
      i.sort_order ASC,
      i.id ASC
    LIMIT ? OFFSET ?
  `).all(...query.params, paging.pageSize, paging.offset) as Array<Record<string, unknown>>

  const items = rows.map(mapStoryItemRecord)
  return buildPagedResult(items, paging.page, paging.pageSize, Number(countRow?.total || 0))
}

export function getStoryItemStats(filters: StoryItemQueryFilters) {
  const sqlite = getSqlite()
  const query = buildItemWhere(filters)
  const row = sqlite.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(i.record_status, 'confirmed') = 'confirmed' THEN 1 ELSE 0 END) AS confirmedCount,
      SUM(CASE WHEN COALESCE(i.record_status, 'confirmed') = 'draft' THEN 1 ELSE 0 END) AS draftCount,
      SUM(CASE WHEN i.item_kind = 'template' THEN 1 ELSE 0 END) AS templateCount,
      SUM(CASE WHEN i.item_kind = 'instance' THEN 1 ELSE 0 END) AS instanceCount,
      COUNT(DISTINCT NULLIF(TRIM(COALESCE(i.category, '')), '')) AS categoryCount
    FROM story_items i
    WHERE ${query.whereSql}
  `).get(...query.params) as Record<string, unknown> | undefined

  const linkedRows = sqlite.prepare(`
    SELECT i.linked_timeline_event_ids_json AS linkedTimelineEventIdsJson
    FROM story_items i
    WHERE ${query.whereSql}
  `).all(...query.params) as Array<{ linkedTimelineEventIdsJson?: string | null }>

  return {
    total: Number(row?.total || 0),
    confirmedCount: Number(row?.confirmedCount || 0),
    draftCount: Number(row?.draftCount || 0),
    templateCount: Number(row?.templateCount || 0),
    instanceCount: Number(row?.instanceCount || 0),
    linkedEventCount: linkedRows.reduce((total, item) => total + parseTimelineLinkCount(item.linkedTimelineEventIdsJson), 0),
    categoryCount: Number(row?.categoryCount || 0),
  }
}

export function getStoryItemFilterOptions(novelId: number) {
  const sqlite = getSqlite()
  const categoryRows = sqlite.prepare(`
    SELECT DISTINCT category
    FROM story_items
    WHERE novel_id = ?
      AND category IS NOT NULL
      AND TRIM(category) <> ''
    ORDER BY category ASC
  `).all(novelId) as Array<{ category?: string | null }>
  const rarityRows = sqlite.prepare(`
    SELECT DISTINCT rarity
    FROM story_items
    WHERE novel_id = ?
      AND rarity IS NOT NULL
      AND TRIM(rarity) <> ''
    ORDER BY rarity ASC
  `).all(novelId) as Array<{ rarity?: string | null }>

  return {
    categories: categoryRows
      .map((row) => (typeof row.category === 'string' ? row.category.trim() : ''))
      .filter(Boolean),
    rarities: rarityRows
      .map((row) => (typeof row.rarity === 'string' ? row.rarity.trim() : ''))
      .filter(Boolean),
  }
}

export function searchStoryItems(
  novelId: number,
  keyword = '',
  itemKind?: 'template' | 'instance',
  limit = 20,
) {
  return queryStoryItems({
    novelId,
    keyword,
    itemKind,
    page: 1,
    pageSize: Math.max(1, Math.min(limit, 50)),
  }).items
}

function ensureTemplateRows(
  novelId: number,
  options: {
    genreName?: string | null
    refreshTemplates?: boolean
  } = {},
): Array<typeof storyItems.$inferSelect> {
  const db = getDb()
  const profile = getItemGenerationProfile(options.genreName)
  const existing = db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
    .filter((row) => row.itemKind === 'template')

  const existingByName = new Map(existing.map((row) => [row.itemName, row]))

  for (const [index, template] of profile.templates.entries()) {
    const current = existingByName.get(template.name)
    if (current && !options.refreshTemplates) continue

    if (current && options.refreshTemplates) {
      updateStoryItem(current.id, {
        genreFamily: profile.genreFamily,
        category: template.category,
        subType: template.key,
        status: 'available',
        summary: template.summary,
        acquisitionMethod: template.circulation,
        usageMethod: template.holders,
        cost: '',
        risk: '',
        plotFunction: template.storyValue,
        appearance: template.examples.join(', '),
        tagsJson: stringifyStringArray(template.examples),
      }, { skipContextTracking: true })
      continue
    }

    createStoryItem(novelId, {
      itemKind: 'template',
      itemName: template.name,
      genreFamily: profile.genreFamily,
      category: template.category,
      subType: template.key,
      status: 'available',
      summary: template.summary,
      acquisitionMethod: template.circulation,
      usageMethod: template.holders,
      cost: '',
      risk: '',
      plotFunction: template.storyValue,
      appearance: template.examples.join(', '),
      tagsJson: stringifyStringArray(template.examples),
      sortOrder: index + 1,
    }, { skipContextTracking: true })
  }

  return db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
    .filter((row) => row.itemKind === 'template')
}

export function listStoryItems(novelId: number) {
  const db = getDb()
  return db.select().from(storyItems)
    .where(eq(storyItems.novelId, novelId))
    .orderBy(asc(storyItems.itemKind), asc(storyItems.sortOrder), asc(storyItems.id))
    .all()
}

export function getStoryItem(id: number) {
  const db = getDb()
  return db.select().from(storyItems).where(eq(storyItems.id, id)).all()[0] || null
}

export function getStoryItemDetailContext(id: number): StoryItemDetailContext {
  const current = getStoryItem(id)
  if (!current) {
    return buildEmptyStoryItemDetailContext()
  }

  const db = getDb()
  const [itemRows, characterRows, eventRows, arcRows, mapRows, chapterRows, segmentRows] = [
    db.select().from(storyItems)
      .where(eq(storyItems.novelId, current.novelId))
      .orderBy(asc(storyItems.itemKind), asc(storyItems.sortOrder), asc(storyItems.id))
      .all(),
    db.select().from(characters)
      .where(eq(characters.novelId, current.novelId))
      .orderBy(asc(characters.sortOrder), asc(characters.id))
      .all(),
    db.select().from(timelineEvents)
      .where(eq(timelineEvents.novelId, current.novelId))
      .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
      .all(),
    db.select().from(storyArcs)
      .where(eq(storyArcs.novelId, current.novelId))
      .orderBy(asc(storyArcs.arcOrder), asc(storyArcs.id))
      .all(),
    db.select().from(worldMap)
      .where(eq(worldMap.novelId, current.novelId))
      .orderBy(asc(worldMap.level), asc(worldMap.parentId), asc(worldMap.sortOrder), asc(worldMap.id))
      .all(),
    db.select().from(chapters)
      .where(eq(chapters.novelId, current.novelId))
      .orderBy(asc(chapters.chapterNum), asc(chapters.id))
      .all(),
    db.select().from(chapterSegments)
      .where(eq(chapterSegments.novelId, current.novelId))
      .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
      .all(),
  ]

  const mappedCurrent = mapStoryItemEntity(current)
  const mappedItems = itemRows.map(mapStoryItemEntity)
  const mappedCharacters = characterRows.map(mapCharacterEntity)
  const mappedEvents = eventRows.map(mapTimelineEventEntity)
  const mappedArcs = arcRows.map(mapStoryArcEntity)
  const itemById = new Map(mappedItems.map((row) => [row.id, row]))
  const characterById = new Map(mappedCharacters.map((row) => [row.id, row]))
  const eventById = new Map(mappedEvents.map((row) => [row.id, row]))
  const arcById = new Map(mappedArcs.map((row) => [row.id, row]))
  const mapById = new Map(mapRows.map((row) => [row.id, row]))
  const chapterById = new Map(chapterRows.map((row) => [row.id, row]))
  const childCountByParentId = new Map<number, number>()

  mapRows.forEach((row) => {
    if (typeof row.parentId === 'number') {
      childCountByParentId.set(row.parentId, (childCountByParentId.get(row.parentId) || 0) + 1)
    }
  })

  const toMapSummary = (mapId?: number | null) => {
    if (typeof mapId !== 'number') return null
    const row = mapById.get(mapId)
    return row ? mapMapNodeSummary(row, childCountByParentId) : null
  }

  const linkedCharacterIds = uniqueNumberArray(parseJsonNumberArray(mappedCurrent.linkedCharacterIdsJson))
  const linkedEventIds = uniqueNumberArray(parseJsonNumberArray(mappedCurrent.linkedTimelineEventIdsJson))
  const relatedEvents = linkedEventIds
    .map((eventId) => eventById.get(eventId) || null)
    .filter((event): event is AppTimelineEvent => Boolean(event))
  const relatedArcs = uniqueNumberArray(relatedEvents.map((event) => event.arcId ?? null))
    .map((arcId) => arcById.get(arcId) || null)
    .filter((arc): arc is AppStoryArc => Boolean(arc))
  const primaryLocation = toMapSummary(mappedCurrent.locationMapId)
  const relatedLocations = uniqueNumberArray(relatedEvents.map((event) => event.locationMapId ?? null))
    .map((mapId) => toMapSummary(mapId))
    .filter((location): location is NonNullable<ReturnType<typeof toMapSummary>> => Boolean(location))
    .filter((location) => location.id !== primaryLocation?.id)
  const derivedInstances = mappedCurrent.itemKind === 'template'
    ? mappedItems.filter((row) => row.itemKind === 'instance' && row.parentItemId === mappedCurrent.id)
    : []
  const siblingInstances = mappedCurrent.itemKind === 'instance' && typeof mappedCurrent.parentItemId === 'number'
    ? mappedItems.filter((row) => row.itemKind === 'instance' && row.parentItemId === mappedCurrent.parentItemId && row.id !== mappedCurrent.id)
    : []
  const relatedSegments = segmentRows
    .filter((segment) => parseJsonNumberArray(segment.linkedItemIdsJson).includes(mappedCurrent.id))
    .map((segment) => mapStoryItemLinkedSegmentSummary(segment, chapterById.get(segment.chapterId)))

  return {
    item: mappedCurrent,
    parentTemplate: typeof mappedCurrent.parentItemId === 'number' ? itemById.get(mappedCurrent.parentItemId) || null : null,
    ownerCharacter: typeof mappedCurrent.ownerCharacterId === 'number' ? characterById.get(mappedCurrent.ownerCharacterId) || null : null,
    location: primaryLocation,
    relatedCharacters: linkedCharacterIds
      .filter((characterId) => characterId !== mappedCurrent.ownerCharacterId)
      .map((characterId) => characterById.get(characterId) || null)
      .filter((character): character is AppCharacter => Boolean(character)),
    relatedEvents,
    relatedArcs,
    relatedLocations,
    relatedSegments,
    derivedInstances,
    siblingInstances,
    sourceContexts: parseSourceContexts(mappedCurrent.sourceContextJson),
  }
}

export function getStoryItemLinkRecommendations(id: number): StoryItemLinkRecommendationResult {
  const current = getStoryItem(id)
  if (!current) {
    throwUserFacingError('common.loadFailed')
  }

  const db = getDb()
  const [characterRows, eventRows, mapRows, chapterRows, segmentRows] = [
    db.select().from(characters)
      .where(eq(characters.novelId, current.novelId))
      .orderBy(asc(characters.sortOrder), asc(characters.id))
      .all(),
    db.select().from(timelineEvents)
      .where(eq(timelineEvents.novelId, current.novelId))
      .orderBy(asc(timelineEvents.timeSortValue), asc(timelineEvents.sortOrder), asc(timelineEvents.id))
      .all(),
    db.select().from(worldMap)
      .where(eq(worldMap.novelId, current.novelId))
      .orderBy(asc(worldMap.level), asc(worldMap.parentId), asc(worldMap.sortOrder), asc(worldMap.id))
      .all(),
    db.select().from(chapters)
      .where(eq(chapters.novelId, current.novelId))
      .orderBy(asc(chapters.chapterNum), asc(chapters.id))
      .all(),
    db.select().from(chapterSegments)
      .where(eq(chapterSegments.novelId, current.novelId))
      .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
      .all(),
  ]

  const item = mapStoryItemEntity(current)
  const characterById = new Map(characterRows.map((row) => [row.id, row]))
  const mapById = new Map(mapRows.map((row) => [row.id, row]))
  const chapterById = new Map(chapterRows.map((row) => [row.id, row]))
  const linkedEventIds = new Set(parseJsonNumberArray(item.linkedTimelineEventIdsJson))
  const ownerName = typeof item.ownerCharacterId === 'number' ? characterById.get(item.ownerCharacterId)?.fullName || '' : ''
  const locationName = typeof item.locationMapId === 'number' ? mapById.get(item.locationMapId)?.name || '' : ''
  const directTokens = buildMatchTokens([item.itemName])
  const detailTokens = buildMatchTokens([
    item.category,
    item.subType,
    item.summary,
    item.plotFunction,
    item.acquisitionMethod,
    item.usageMethod,
    item.cost,
    item.risk,
    item.factionHint,
    ...parseSourceContexts(item.sourceContextJson).map((source) => source.label || source.page || ''),
  ])

  const eventRecommendations = eventRows
    .map((event) => {
      const presentIds = parseJsonNumberArray(event.presentCharacterIdsJson)
      const affectedIds = parseJsonNumberArray(event.affectedCharacterIdsJson)
      const eventCharacterNames = [...new Set([...presentIds, ...affectedIds]
        .map((characterId) => characterById.get(characterId)?.fullName || '')
        .filter(Boolean))]
      return scoreStoryItemEventRecommendation({
        item,
        event: mapTimelineEventEntity(event),
        ownerName,
        locationName,
        directTokens,
        detailTokens,
        eventCharacterNames,
        eventLocationName: typeof event.locationMapId === 'number' ? mapById.get(event.locationMapId)?.name || '' : '',
        alreadyLinked: linkedEventIds.has(event.id),
      })
    })
    .filter((event): event is StoryItemEventLinkRecommendation => Boolean(event))
    .sort((left, right) => right.score - left.score || left.eventId - right.eventId)
    .slice(0, 8)

  const segmentRecommendations = segmentRows
    .map((segment) => {
      const presentIds = parseJsonNumberArray(segment.presentCharacterIdsJson)
      const segmentCharacterNames = [...new Set(presentIds
        .map((characterId) => characterById.get(characterId)?.fullName || '')
        .filter(Boolean))]
      return scoreStoryItemSegmentRecommendation({
        item,
        segment,
        chapter: chapterById.get(segment.chapterId),
        ownerName,
        locationName,
        directTokens,
        detailTokens,
        segmentCharacterNames,
        alreadyLinked: parseJsonNumberArray(segment.linkedItemIdsJson).includes(item.id),
      })
    })
    .filter((segment): segment is StoryItemSegmentLinkRecommendation => Boolean(segment))
    .sort((left, right) => right.score - left.score || left.chapterNum - right.chapterNum || left.segmentOrder - right.segmentOrder)
    .slice(0, 10)

  const summaryParts = [
    eventRecommendations.length > 0 ? `${eventRecommendations.length} 条事件推荐` : '',
    segmentRecommendations.length > 0 ? `${segmentRecommendations.length} 个场景推荐` : '',
  ].filter(Boolean)

  return {
    itemId: item.id,
    generatedAt: new Date().toISOString(),
    summary: summaryParts.length > 0
      ? `根据名称、剧情作用、角色和地点共现，筛出 ${summaryParts.join('，')}。`
      : `暂时没有命中的剧情关联推荐，可先补充 ${clipMatchText(item.plotFunction || item.summary || item.itemName, 24) || '剧情作用'} 后再刷新。`,
    events: eventRecommendations,
    segments: segmentRecommendations,
  }
}

export function applyStoryItemLinkRecommendations(
  id: number,
  data: {
    eventIds?: number[]
    segmentIds?: number[]
  },
): StoryItemLinkApplyResult {
  const current = getStoryItem(id)
  if (!current) {
    throwUserFacingError('common.loadFailed')
  }

  const db = getDb()
  const timestamp = new Date().toISOString()
  const acceptedEventIds = uniqueNumberArray(data.eventIds || [])
  const acceptedSegmentIds = uniqueNumberArray(data.segmentIds || [])
  let linkedEventCount = 0
  let linkedSegmentCount = 0

  if (acceptedEventIds.length > 0) {
    const currentEventIds = new Set(parseJsonNumberArray(current.linkedTimelineEventIdsJson))
    acceptedEventIds.forEach((eventId) => {
      if (currentEventIds.has(eventId)) return
      currentEventIds.add(eventId)
      linkedEventCount += 1
    })

    if (linkedEventCount > 0) {
      db.update(storyItems).set({
        linkedTimelineEventIdsJson: stringifyNumberArray([...currentEventIds]),
        updatedAt: timestamp,
      }).where(eq(storyItems.id, id)).run()
      syncStoryItemTimelineLinks(id)
    }
  }

  if (acceptedSegmentIds.length > 0) {
    const segments = db.select().from(chapterSegments)
      .where(eq(chapterSegments.novelId, current.novelId))
      .orderBy(asc(chapterSegments.chapterId), asc(chapterSegments.segmentOrder), asc(chapterSegments.id))
      .all()
      .filter((segment) => acceptedSegmentIds.includes(segment.id))

    segments.forEach((segment) => {
      const currentItemIds = new Set(parseJsonNumberArray(segment.linkedItemIdsJson))
      if (currentItemIds.has(id)) return
      currentItemIds.add(id)
      linkedSegmentCount += 1
      db.update(chapterSegments).set({
        linkedItemIdsJson: stringifyNumberArray([...currentItemIds]),
        updatedAt: timestamp,
      }).where(eq(chapterSegments.id, segment.id)).run()
    })
  }

  if (linkedEventCount > 0 || linkedSegmentCount > 0) {
    markNovelContextChanged(current.novelId, 'Story item links changed')
    refreshWorldStateVersionsForNovel(current.novelId)
    recordAssetChangeEvent({
      novelId: current.novelId,
      assetType: 'item',
      assetId: id,
      assetLabel: current.itemName,
      operation: 'update',
      changeReason: 'Story item links changed',
      impactLevel: linkedSegmentCount > 0 ? 'high' : 'medium',
      triggeredBy: 'item.service',
      payload: {
        eventIds: acceptedEventIds,
        segmentIds: acceptedSegmentIds,
      },
    })
  }

  return {
    itemId: id,
    linkedEventCount,
    linkedSegmentCount,
    message: linkedEventCount > 0 || linkedSegmentCount > 0
      ? `已接受 ${linkedEventCount} 条事件推荐、${linkedSegmentCount} 个场景推荐。`
      : '没有新增可写入的推荐关联。',
  }
}

export function createStoryItem(
  novelId: number,
  data: Partial<typeof storyItems.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const sortOrder = typeof data.sortOrder === 'number' ? data.sortOrder : getNextSortOrder(novelId)
  const payload = sanitizeStoryItemPayload(data)
  const typedRefsJson = deriveItemTypedRefsJson({
    typedRefsJson: typeof payload.typedRefsJson === 'string' ? payload.typedRefsJson : undefined,
    linkedCharacterIdsJson: payload.linkedCharacterIdsJson,
    linkedTimelineEventIdsJson: payload.linkedTimelineEventIdsJson,
    ownerCharacterId: payload.ownerCharacterId,
  })
  const result = db.insert(storyItems).values({
    novelId,
    itemKind: 'instance',
    itemName: data.itemName || 'Unnamed item',
    recordStatus: normalizeRecordStatus(data.recordStatus),
    status: 'available',
    linkedCharacterIdsJson: '[]',
    linkedTimelineEventIdsJson: '[]',
    ...(typedRefsJson ? { typedRefsJson } : {}),
    tagsJson: '[]',
    sortOrder,
    ...payload,
  }).run()
  const id = Number(result.lastInsertRowid)
  syncStoryItemTimelineLinks(id)
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Story items changed')
    refreshWorldStateVersionsForNovel(novelId)
    recordAssetChangeEvent({
      novelId,
      assetType: 'item',
      assetId: id,
      assetLabel: payload.itemName || data.itemName || 'Unnamed item',
      operation: 'create',
      changeReason: 'Story items changed',
      impactLevel: 'medium',
      triggeredBy: 'item.service',
      payload,
    })
  }
  return id
}

export function updateStoryItem(
  id: number,
  data: Partial<typeof storyItems.$inferInsert>,
  options: { skipContextTracking?: boolean } = {},
) {
  const db = getDb()
  const current = getStoryItem(id)
  const sanitized = sanitizeStoryItemPayload(data)
  const shouldRefreshTypedRefs = (
    hasOwn(data, 'linkedCharacterIdsJson')
    || hasOwn(data, 'linkedTimelineEventIdsJson')
    || hasOwn(data, 'ownerCharacterId')
  )
  const shouldWriteTypedRefs = shouldRefreshTypedRefs || typeof sanitized.typedRefsJson === 'string'
  const typedRefsJson = deriveItemTypedRefsJson({
    typedRefsJson: typeof sanitized.typedRefsJson === 'string'
      ? sanitized.typedRefsJson
      : shouldRefreshTypedRefs
        ? undefined
        : current?.typedRefsJson,
    linkedCharacterIdsJson: typeof sanitized.linkedCharacterIdsJson === 'string'
      ? sanitized.linkedCharacterIdsJson
      : current?.linkedCharacterIdsJson,
    linkedTimelineEventIdsJson: typeof sanitized.linkedTimelineEventIdsJson === 'string'
      ? sanitized.linkedTimelineEventIdsJson
      : current?.linkedTimelineEventIdsJson,
    ownerCharacterId: hasOwn(data, 'ownerCharacterId')
      ? sanitized.ownerCharacterId ?? null
      : current?.ownerCharacterId,
  })
  db.update(storyItems).set({
    ...sanitized,
    ...(shouldWriteTypedRefs ? { typedRefsJson: typedRefsJson ?? null } : typedRefsJson ? { typedRefsJson } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(storyItems.id, id)).run()
  syncStoryItemTimelineLinks(id)
  if (!options.skipContextTracking) {
    if (current) {
      markNovelContextChanged(current.novelId, 'Story items changed')
      refreshWorldStateVersionsForNovel(current.novelId)
      recordAssetChangeEvent({
        novelId: current.novelId,
        assetType: 'item',
        assetId: id,
        assetLabel: (typeof data.itemName === 'string' && data.itemName.trim()) ? data.itemName.trim() : current.itemName,
        operation: 'update',
        changeReason: 'Story items changed',
        impactLevel: 'medium',
        triggeredBy: 'item.service',
        payload: data,
      })
    }
  }
}

export function deleteStoryItem(id: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const current = db.select().from(storyItems).where(eq(storyItems.id, id)).all()[0]
  getSqlite().transaction(() => {
    if (current) {
      cleanupStoryItemSoftReferences(current.novelId, id)
    }
    db.delete(storyItems).where(eq(storyItems.id, id)).run()
  })()
  if (!options.skipContextTracking && current) {
    markNovelContextChanged(current.novelId, 'Story items changed')
    refreshWorldStateVersionsForNovel(current.novelId)
    recordAssetChangeEvent({
      novelId: current.novelId,
      assetType: 'item',
      assetId: id,
      assetLabel: current.itemName,
      operation: 'delete',
      changeReason: 'Story items changed',
      impactLevel: 'medium',
      triggeredBy: 'item.service',
    })
  }
}

export function clearStoryItemsByNovel(novelId: number, options: { skipContextTracking?: boolean } = {}) {
  const db = getDb()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()

  eventRows.forEach((event) => {
    db.update(timelineEvents).set({
      linkedItemIdsJson: JSON.stringify([]),
      updatedAt: new Date().toISOString(),
    }).where(eq(timelineEvents.id, event.id)).run()
  })

  db.delete(storyItems).where(eq(storyItems.novelId, novelId)).run()
  if (!options.skipContextTracking) {
    markNovelContextChanged(novelId, 'Story items changed')
    refreshWorldStateVersionsForNovel(novelId)
  }
}

export async function generateStoryItemsBatchChunk(
  novelId: number,
  options: StoryItemGenerateOptions = {},
  runtime: {
    parentTaskId?: number
    sender?: WebContents
    batchIndex?: number
    totalBatches?: number
  } = {},
): Promise<StoryItemBatchChunkResult> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const templateRows = ensureTemplateRows(novelId, {
    genreName: profile.genre,
    refreshTemplates: options.refreshTemplates,
  })

  if (options.templateOnly) {
    return {
      ids: templateRows.map((row) => row.id),
      batchDigest: `模板 ${templateRows.length} 条`,
    }
  }

  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const currentItems = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
  const itemProfile = getItemGenerationProfile(profile.genre, {
    launchMode: novel.launchMode,
    targetWords: novel.targetWords,
    settingsJson: novel.settingsJson,
    mapDepth: Math.max(
      ...rules.mapBlueprint.levels.map((level) => level.depth),
      ...mapRows.map((row) => Number(row.level || 0)),
      1,
    ),
    factionCount: rules.factionSystem.length,
    speciesCount: Math.max(
      rules.speciesSystem.length,
      new Set(characterRows.map((character) => character.species).filter(Boolean)).size,
    ),
    powerSystemCount: rules.powerSystems.length,
  })
  const requestedCount = Math.max(1, Math.min(options.count || itemProfile.defaultBatch, 200))
  const historyEntityType = 'item'
  const historyTaskType = 'story_item_generate_batch'
  let nextSort = getNextSortOrder(novelId)
  let resultPayload: StoryItemBatchChunkResult | null = null
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const characterSummary = buildCharacterSummary(characterRows)
  const locationSummary = buildLocationSummary(mapRows)
  const arcSummary = buildArcSummary(arcRows)
  const eventSummary = buildEventSummary(eventRows)
  const existingItemSummary = buildExistingItemSummary(currentItems)
  const factionSummary = getFactionNameOptions(rules).join('、')
  const reviewContext = buildItemReviewContext({
    profile,
    storyCore: storyCoreSummary,
    characterSummary,
    locationSummary,
    factionSummary,
    arcSummary,
    eventSummary,
    existingItemSummary,
    focus: options.focus,
  })

  const prompt = buildPrompt({
    novelTitle: novel.title,
    genre: profile.genre,
    background: profile.background,
    worldSummary: profile.worldRulesSummary,
    storyCore: storyCoreSummary,
    templateSummary: buildItemTemplateSummary(itemProfile),
    characterSummary,
    locationSummary,
    factionSummary,
    arcSummary,
    eventSummary,
    existingItemSummary,
    focus: [
      options.focus,
      `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批：新增 ${requestedCount} 个物品实例，并主动避开已有物品的重复功能。`,
    ].filter(Boolean).join('\n'),
    count: requestedCount,
  })
  const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
  const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
    attemptNumber,
    rejectedDigests,
  })
  const inputJson = JSON.stringify(messages)
  const taskId = await createTask({
    type: 'generate_items',
    novelId,
    modelConfigId: novel.modelConfigId || undefined,
    relatedEntityType: 'novel',
    relatedEntityId: novelId,
    inputJson,
    runnerType: 'chat',
    parentTaskId: runtime.parentTaskId,
  })

  if (typeof runtime.parentTaskId === 'number') {
    updateTask(runtime.parentTaskId, { currentChildTaskId: taskId })
  }

  try {
    await executeChatTask(taskId, {
      type: 'generate_items',
      novelId,
      modelConfigId: novel.modelConfigId || undefined,
      relatedEntityType: 'novel',
      relatedEntityId: novelId,
      inputJson,
      messages,
      sender: runtime.sender,
      onSuccess: async (result) => {
        const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
        const quality = await runAssetQualityLoop({
          targetType: 'item',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          sender: runtime.sender,
          contextSummary: reviewContext,
          generatedOutput: result,
          schemaHint: itemSchemaHint(requestedCount),
          reviewFocus: [
            '物品必须具体可追踪，不能只剩抽象概念、模板道具名或空泛象征。',
            '功能、代价、风险和剧情作用必须能落到人物、地点、事件或势力关系上。',
          ],
          rewriteConstraints: [
            '保持物品数组长度不变。',
            '保持对象顺序和字段语义稳定，不要把数组改成说明文。',
          ],
        })
        if (quality.stage === 'rejected') {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批物品被审校拒收。`,
          }
          return resultPayload
        }
        let parsed: GeneratedStoryItem[]
        try {
          parsed = cleanAiValue(safeParseJson<GeneratedStoryItem[]>(quality.finalOutput))
        } catch (error) {
          markRejected(historyId)
          throw error
        }
        const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
        if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
          markRejected(historyId)
          resultPayload = {
            ids: [],
            warning: `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批物品与近期拒绝结果过于相近，已自动跳过。`,
          }
          return resultPayload
        }
        if (!Array.isArray(parsed)) {
          markRejected(historyId)
          throwUserFacingError('item.generatedArrayInvalid')
        }

        const usedSignatures = new Set(
          currentItems
            .filter((item) => item.itemKind === 'instance')
            .map((item) => buildItemSignature(item))
            .filter(Boolean),
        )
        let acceptedInBatch = 0
        const createdIds: number[] = []
        const acceptedNames: string[] = []

        for (const rawItem of parsed) {
          const payload = buildGeneratedPayload(rawItem, {
            genreFamily: resolveGenreFamily(profile.genre),
            templateRows,
            characterRows,
            mapRows,
            eventRows,
            sortOrder: nextSort,
          })
          if (!payload) continue
          const signature = buildItemSignature(payload)
          if (!signature || usedSignatures.has(signature)) continue
          const id = createStoryItem(novelId, payload, { skipContextTracking: true })
          createdIds.push(id)
          usedSignatures.add(signature)
          acceptedInBatch += 1
          nextSort += 1
          acceptedNames.push(payload.itemName || `物品#${id}`)
        }

        if (acceptedInBatch === 0) {
          markRejected(historyId)
        }
        if (createdIds.length > 0) {
          markNovelContextChanged(novelId, 'Story items changed')
          refreshWorldStateVersionsForNovel(novelId)
        }

        resultPayload = {
          ids: createdIds,
          warning: createdIds.length > 0
            ? summarizeAssetQualityWarnings(quality)
            : (summarizeAssetQualityWarnings(quality) || `第 ${runtime.batchIndex || 1}/${runtime.totalBatches || 1} 批没有生成可用物品。`),
          batchDigest: acceptedNames.slice(0, 4).join('、'),
        }
        return resultPayload
      },
    })
  } finally {
    if (typeof runtime.parentTaskId === 'number') {
      updateTask(runtime.parentTaskId, { currentChildTaskId: null })
    }
  }

  return resultPayload || { ids: [] }
}

export async function generateStoryItems(
  novelId: number,
  options: StoryItemGenerateOptions = {},
): Promise<number[]> {
  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, novelId)).all()[0]
  if (!novel) throwUserFacingError('novel.notFound')

  const profile = await buildStoryProfile(novelId)
  const rules = parseWorldRulesJson(novel.worldRulesJson, profile.genre)
  const templateRows = ensureTemplateRows(novelId, {
    genreName: profile.genre,
    refreshTemplates: options.refreshTemplates,
  })

  if (options.templateOnly) {
    return templateRows.map((row) => row.id)
  }

  const characterRows = db.select().from(characters).where(eq(characters.novelId, novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, novelId)).all()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, novelId)).all()
  const arcRows = db.select().from(storyArcs).where(eq(storyArcs.novelId, novelId)).all()
  const itemProfile = getItemGenerationProfile(profile.genre, {
    launchMode: novel.launchMode,
    targetWords: novel.targetWords,
    settingsJson: novel.settingsJson,
    mapDepth: Math.max(
      ...rules.mapBlueprint.levels.map((level) => level.depth),
      ...mapRows.map((row) => Number(row.level || 0)),
      1,
    ),
    factionCount: rules.factionSystem.length,
    speciesCount: Math.max(
      rules.speciesSystem.length,
      new Set(characterRows.map((character) => character.species).filter(Boolean)).size,
    ),
    powerSystemCount: rules.powerSystems.length,
  })
  const totalCount = Math.min(Math.max(options.count || itemProfile.defaultBatch, 4), 200)
  const batchSize = Math.max(1, Math.min(totalCount, options.batchSize || Math.min(totalCount, itemProfile.batchSize || 4), 12))

  const createdIds: number[] = []
  const historyEntityType = 'item'
  const historyTaskType = 'story_item_generate_batch'
  let nextSort = getNextSortOrder(novelId)
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const characterSummary = buildCharacterSummary(characterRows)
  const locationSummary = buildLocationSummary(mapRows)
  const arcSummary = buildArcSummary(arcRows)
  const eventSummary = buildEventSummary(eventRows)
  const factionSummary = getFactionNameOptions(rules).join('、')

  for (let generatedCount = 0; generatedCount < totalCount; generatedCount += batchSize) {
    const currentBatchCount = Math.min(batchSize, totalCount - generatedCount)
    const currentItems = db.select().from(storyItems).where(eq(storyItems.novelId, novelId)).all()
    const existingItemSummary = buildExistingItemSummary(currentItems)
    const reviewContext = buildItemReviewContext({
      profile,
      storyCore: storyCoreSummary,
      characterSummary,
      locationSummary,
      factionSummary,
      arcSummary,
      eventSummary,
      existingItemSummary,
      focus: options.focus,
    })

    const prompt = buildPrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      background: profile.background,
      worldSummary: profile.worldRulesSummary,
      storyCore: storyCoreSummary,
      templateSummary: buildItemTemplateSummary(itemProfile),
      characterSummary,
      locationSummary,
      factionSummary,
      arcSummary,
      eventSummary,
      existingItemSummary,
      focus: [
        options.focus,
        `第 ${Math.floor(generatedCount / batchSize) + 1} 批：新增 ${currentBatchCount} 个物品实例，并主动避开已有物品的重复功能。`,
      ].filter(Boolean).join('\n'),
      count: currentBatchCount,
    })
    const attemptNumber = getAttemptCount(novelId, historyEntityType, null, historyTaskType) + 1
    const rejectedDigests = getRecentRejectedDigests(novelId, historyEntityType, null, historyTaskType)
    const messages = appendVariationMessage([{ role: 'user', content: prompt }], {
      attemptNumber,
      rejectedDigests,
    })

    let acceptedBatch: GeneratedStoryItem[] | null = null
    let rejectedByQuality = false
    const result = await runChatTask({
      type: 'generate_items',
      novelId,
      messages,
      modelConfigId: novel.modelConfigId || undefined,
      onSuccess: async (rawOutput, taskId) => {
        const quality = await runAssetQualityLoop({
          targetType: 'item',
          novelId,
          modelConfigId: novel.modelConfigId || undefined,
          relatedEntityType: 'novel',
          relatedEntityId: novelId,
          parentTaskId: taskId,
          contextSummary: reviewContext,
          generatedOutput: rawOutput,
          schemaHint: itemSchemaHint(currentBatchCount),
          reviewFocus: [
            '物品必须具体可复用，不能沦为空泛模板或万能道具。',
            '剧情功能、代价和风险要能和现有人物、地点、事件形成挂钩。',
          ],
          rewriteConstraints: [
            '保持物品数组长度不变。',
            '保持对象顺序和字段结构稳定。',
          ],
        })
        if (quality.stage === 'rejected') {
          rejectedByQuality = true
          return quality
        }
        acceptedBatch = cleanAiValue(safeParseJson<GeneratedStoryItem[]>(quality.finalOutput))
        return quality
      },
    })
    const historyId = recordGeneration(novelId, historyEntityType, null, historyTaskType, result, attemptNumber)
    if (rejectedByQuality) {
      markRejected(historyId)
      continue
    }
    let parsed: GeneratedStoryItem[]
    try {
      parsed = acceptedBatch || cleanAiValue(safeParseJson<GeneratedStoryItem[]>(result))
    } catch (error) {
      markRejected(historyId)
      throw error
    }
    const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
    if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
      markRejected(historyId)
      continue
    }
    if (!Array.isArray(parsed)) {
      markRejected(historyId)
      throwUserFacingError('item.generatedArrayInvalid')
    }

    const usedSignatures = new Set(
      currentItems
        .filter((item) => item.itemKind === 'instance')
        .map((item) => buildItemSignature(item))
        .filter(Boolean),
    )
    let acceptedInBatch = 0

    for (const rawItem of parsed) {
      const payload = buildGeneratedPayload(rawItem, {
        genreFamily: resolveGenreFamily(profile.genre),
        templateRows,
        characterRows,
        mapRows,
        eventRows,
        sortOrder: nextSort,
      })
      if (!payload) continue
      const signature = buildItemSignature(payload)
      if (!signature || usedSignatures.has(signature)) continue
      const id = createStoryItem(novelId, payload, { skipContextTracking: true })
      createdIds.push(id)
      usedSignatures.add(signature)
      acceptedInBatch += 1
      nextSort += 1
    }

    if (acceptedInBatch === 0) {
      markRejected(historyId)
    }
  }

  if (createdIds.length > 0) {
    markNovelContextChanged(novelId, 'Story items changed')
    refreshWorldStateVersionsForNovel(novelId)
  }

  return createdIds
}

export async function regenerateStoryItem(
  id: number,
  options: EntityRegenerateOptions = {},
): Promise<typeof storyItems.$inferSelect | null> {
  const current = getStoryItem(id)
  if (!current) return null

  const db = getDb()
  const novel = db.select().from(novels).where(eq(novels.id, current.novelId)).all()[0]
  if (!novel) return null

  const profile = await buildStoryProfile(current.novelId)
  const mode = options.mode === 'replace' ? 'replace' : 'repair'
  const characterRows = db.select().from(characters).where(eq(characters.novelId, current.novelId)).all()
  const mapRows = db.select().from(worldMap).where(eq(worldMap.novelId, current.novelId)).all()
  const eventRows = db.select().from(timelineEvents).where(eq(timelineEvents.novelId, current.novelId)).all()
  const templateRows = ensureTemplateRows(current.novelId, {
    genreName: profile.genre,
    refreshTemplates: false,
  })
  const historyEntityType = 'item'
  const historyTaskType = 'story_item_regenerate'
  const attemptNumber = getAttemptCount(current.novelId, historyEntityType, current.id, historyTaskType) + 1
  const rejectedDigests = getRecentRejectedDigests(current.novelId, historyEntityType, current.id, historyTaskType)
  const currentSignature = buildItemSignature(current)
  const storyCoreSummary = buildStoryCoreSummary(profile)
  const characterSummary = buildCharacterSummary(characterRows)
  const locationSummary = buildLocationSummary(mapRows)
  const eventSummary = buildEventSummary(eventRows)
  const reviewContext = buildItemReviewContext({
    profile,
    storyCore: storyCoreSummary,
    characterSummary,
    locationSummary,
    factionSummary: '',
    arcSummary: '',
    eventSummary,
    existingItemSummary: buildExistingItemSummary(db.select().from(storyItems).where(eq(storyItems.novelId, current.novelId)).all()),
    currentSummary: buildItemCurrentSummary(current),
    mode,
  })
  const messages = appendVariationMessage([{
    role: 'user',
    content: buildItemRepairPrompt({
      novelTitle: novel.title,
      genre: profile.genre,
      background: profile.background,
      worldSummary: profile.worldRulesSummary,
      storyCore: [
        `Story goal: ${profile.storyGoal || 'not provided'}`,
        `Core conflict: ${profile.coreConflict || 'not provided'}`,
        `Main plot: ${profile.mainPlot || 'not provided'}`,
        `Ending direction: ${profile.ending || 'not provided'}`,
      ].join('\n'),
      characterSummary,
      locationSummary,
      eventSummary,
      currentSummary: buildItemCurrentSummary(current),
      mode,
    }),
  }], {
    attemptNumber,
    rejectedDigests,
  })

  let acceptedCandidate: GeneratedStoryItem | null = null
  let rejectedByQuality = false
  const result = await runChatTask({
    type: 'generate_items',
    novelId: current.novelId,
    relatedEntityType: 'item',
    relatedEntityId: current.id,
    messages,
    modelConfigId: novel.modelConfigId || undefined,
    onSuccess: async (rawOutput, taskId) => {
      const quality = await runAssetQualityLoop({
        targetType: 'item',
        novelId: current.novelId,
        modelConfigId: novel.modelConfigId || undefined,
        relatedEntityType: 'item',
        relatedEntityId: current.id,
        parentTaskId: taskId,
        contextSummary: reviewContext,
        generatedOutput: rawOutput,
        schemaHint: itemSchemaHint(),
        reviewFocus: [
          '修复后的物品必须继续承担原功能位，但去掉空泛、重复和失真问题。',
          '名称、作用、代价、风险要与题材和现有上下文一致。',
        ],
        rewriteConstraints: [
          '保持单个物品 JSON 对象结构稳定。',
          '不要把单条物品卡改写成说明文。',
        ],
      })
      if (quality.stage === 'rejected') {
        rejectedByQuality = true
        return quality
      }
      acceptedCandidate = cleanAiValue(safeParseJson<GeneratedStoryItem>(quality.finalOutput))
      return quality
    },
  })
  const historyId = recordGeneration(current.novelId, historyEntityType, current.id, historyTaskType, result, attemptNumber)
  if (rejectedByQuality) {
    markRejected(historyId)
    return current
  }
  let parsed: GeneratedStoryItem
  try {
    parsed = acceptedCandidate || cleanAiValue(safeParseJson<GeneratedStoryItem>(result))
  } catch {
    markRejected(historyId)
    return current
  }
  const candidateDigest = buildVariationDigest(JSON.stringify(parsed))
  if (isRejectedDigestTooSimilar(candidateDigest, rejectedDigests)) {
    markRejected(historyId)
    return current
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    markRejected(historyId)
    return current
  }

  const payload = buildGeneratedPayload(parsed, {
    genreFamily: resolveGenreFamily(profile.genre),
    templateRows,
    characterRows,
    mapRows,
    eventRows,
    sortOrder: current.sortOrder || 0,
  })
  const nextSignature = payload ? buildItemSignature(payload) : ''
  if (!payload || !payload.itemName || !nextSignature || nextSignature === currentSignature) {
    markRejected(historyId)
    return current
  }

  updateStoryItem(id, payload, { skipContextTracking: true })
  markNovelContextChanged(current.novelId, 'Story items changed')
  refreshWorldStateVersionsForNovel(current.novelId)
  return getStoryItem(id)
}

